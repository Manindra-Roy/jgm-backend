/**
 * @fileoverview Order Management Routes.
 * Handles order creation, dashboard analytics, user order history, and 
 * safe inventory synchronization using MongoDB Transactions.
 */

const { Order } = require("../models/order");
const { Product } = require("../models/product");
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { orderSchema } = require("../helpers/validator");

/**
 * @route   GET /api/v1/orders/
 * @desc    Get a paginated list of all orders (sorted newest first).
 * @access  Admin
 */
router.get(`/`, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const orderList = await Order.find()
            .populate("user", "name")
            .sort({ dateOrdered: -1 })
            .skip(skip)
            .limit(limit);

        const totalCount = await Order.countDocuments();

        if (!orderList) return res.status(500).json({ success: false });
        res.send({ orders: orderList, totalCount, page, limit });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/:id
 * @desc    Get details of a specific order, including embedded product data.
 * @access  Admin / Authenticated User
 */
router.get(`/:id`, async (req, res) => {
    const order = await Order.findById(req.params.id)
        .populate("user", "name")
        .populate("orderItems.product"); 

    if (!order) return res.status(500).json({ success: false });
    res.send(order);
});

/**
 * @route   GET /api/v1/orders/get/dashboard-stats
 * @desc    Aggregates complex store data (Total Sales, Daily Revenue, Status Counts) for the Admin Dashboard.
 * @access  Admin
 */
router.get("/get/dashboard-stats", async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();

        // 1. Group orders by their current status (e.g., Pending, Delivered)
        const statusCountsAgg = await Order.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        const statusCounts = statusCountsAgg.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        // 2. Calculate lifetime total sales (excluding cancelled orders)
        const salesAgg = await Order.aggregate([
            { $match: { status: { $ne: "Cancelled" } } },
            {
                $group: {
                    _id: null,
                    totalSales: {
                        $sum: { $convert: { input: "$totalPrice", to: "double", onError: 0, onNull: 0 } },
                    },
                },
            },
        ]);
        const totalSales = salesAgg.length > 0 ? salesAgg[0].totalSales : 0;

        // 3. Calculate daily sales revenue for the past 14 days
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 14);

        const dailySales = await Order.aggregate([
            {
                $match: {
                    dateOrdered: { $gte: pastDate },
                    status: { $ne: "Cancelled" },
                },
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$dateOrdered" } },
                    totalSales: {
                        $sum: { $convert: { input: "$totalPrice", to: "double", onError: 0, onNull: 0 } },
                    },
                },
            },
            { $sort: { _id: 1 } }, 
        ]);

        // 4. Fetch the 5 most recent orders for the quick-view table
        const recentOrders = await Order.find()
            .populate("user", "name")
            .sort({ dateOrdered: -1 })
            .limit(5);

        res.status(200).json({
            totalOrders,
            statusCounts,
            totalSales,
            dailySales,
            recentOrders,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/v1/orders/
 * @desc    Creates a new order and securely decrements inventory using a MongoDB Transaction.
 * @access  Public / Authenticated User
 */
router.post("/", async (req, res) => {
    const { error } = orderSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    // --- MONGODB TRANSACTION INITIATION ---
    // Ensures that if stock reduction fails, the order creation is completely rolled back.
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        let calculatedTotalPrice = 0;
        
        // Step 1: Verify stock and calculate true server-side price
        for (const item of req.body.orderItems) {
            const product = await Product.findById(item.product).select("price countInStock name").session(session);
            if (!product) throw new Error(`Product not found: ${item.product}`);
            if (product.countInStock < item.quantity) throw new Error(`Insufficient stock for product: ${product.name}`);
            
            calculatedTotalPrice += product.price * item.quantity;
        }

        // SECURITY: Prefer the authenticated user's ID from JWT when available.
        // Falls back to the client-provided user ID for guest/public checkout routes
        // where express-jwt is skipped, or null for fully anonymous guests.
        const userId = (req.auth && req.auth.userId) ? req.auth.userId : (req.body.user || null);

        // Step 2: Create the Order
        let order = new Order({
            orderItems: req.body.orderItems,
            shippingAddress1: req.body.shippingAddress1,
            shippingAddress2: req.body.shippingAddress2,
            city: req.body.city,
            zip: req.body.zip,
            country: req.body.country,
            phone: req.body.phone,
            status: 'Pending', // SECURITY: Always start as Pending, never trust client
            totalPrice: calculatedTotalPrice,
            user: userId,
        });

        order = await order.save({ session });

        // Step 3: Decrement Inventory
        for (const item of order.orderItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { countInStock: -item.quantity } 
            }, { session });
        }

        // --- TRANSACTION COMMIT ---
        await session.commitTransaction();
        session.endSession();
        
        res.send(order);
    } catch (err) {
        // --- TRANSACTION ROLLBACK ---
        await session.abortTransaction();
        session.endSession();
        
        const status = err.message.includes('Insufficient') || err.message.includes('not found') ? 400 : 500;
        res.status(status).send(err.message);
    }
});

/**
 * @route   PUT /api/v1/orders/:id
 * @desc    Updates order status/logistics. Restores stock if marked as 'Cancelled'.
 * @access  Admin
 */
router.put("/:id", async (req, res) => {
    try {
        const orderId = req.params.id;
        const existingOrder = await Order.findById(orderId);
        
        if (!existingOrder) return res.status(404).send("Order not found!");

        const updatedOrder = await Order.findByIdAndUpdate(
            orderId,
            {
                status: req.body.status,
                courierName: req.body.courierName,
                trackingNumber: req.body.trackingNumber
            },
            { returnDocument: "after" },
        );

        // LOGIC: Restore inventory if an active order is cancelled
        if (req.body.status === 'Cancelled' && existingOrder.status !== 'Cancelled') {
            for (const item of existingOrder.orderItems) {
                await Product.findByIdAndUpdate(item.product, {
                    $inc: { countInStock: item.quantity }
                });
            }
        }

        res.send(updatedOrder);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/**
 * @route   DELETE /api/v1/orders/:id
 * @desc    Deletes an order from the database and restores associated inventory.
 * @access  Admin
 */
router.delete("/:id", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) return res.status(404).json({ success: false, message: "Order not found!" });

        // LOGIC: Only restore stock if the order wasn't already mathematically cancelled
        if (order.status !== 'Cancelled') {
            for (const item of order.orderItems) {
                if (item.product) {
                    await Product.findByIdAndUpdate(item.product, {
                        $inc: { countInStock: item.quantity }
                    });
                }
            }
        }

        await Order.findByIdAndDelete(req.params.id);

        return res.status(200).json({
            success: true,
            message: "The order was deleted and inventory synchronized!",
        });
    } catch (err) {
        console.error("Delete Order Error:", err); 
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/get/count
 * @desc    Get the total number of orders in the database.
 * @access  Admin
 */
router.get(`/get/count`, async (req, res) => {
    try {
        const orderCount = await Order.countDocuments();
        res.status(200).send({ orderCount: orderCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/get/userorders/:userid
 * @desc    Get all orders belonging to a specific user for their Profile page.
 * @access  Authenticated User
 */
router.get(`/get/userorders/:userid`, async (req, res) => {
    const userOrderList = await Order.find({ user: req.params.userid })
        .populate("orderItems.product")
        .sort({ dateOrdered: -1 });

    if (!userOrderList) return res.status(500).json({ success: false });
    res.send(userOrderList);
});

module.exports = router;