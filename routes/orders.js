const { Order } = require("../models/order");
const { Product } = require("../models/product");
const express = require("express");
const router = express.Router();
const { orderSchema } = require("../helpers/validator");

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

        if (!orderList) {
            return res.status(500).json({ success: false });
        }
        res.send(orderList);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get(`/:id`, async (req, res) => {
    const order = await Order.findById(req.params.id)
        .populate("user", "name")
        .populate("orderItems.product"); // Simplified embed population

    if (!order) {
        res.status(500).json({ success: false });
    }
    res.send(order);
});

router.get("/get/dashboard-stats", async (req, res) => {
    try {
        const totalOrders = await Order.countDocuments();

        const statusCountsAgg = await Order.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        const statusCounts = statusCountsAgg.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
        }, {});

        const salesAgg = await Order.aggregate([
            { $match: { status: { $ne: "Cancelled" } } },
            {
                $group: {
                    _id: null,
                    totalSales: {
                        $sum: {
                            $convert: { input: "$totalPrice", to: "double", onError: 0, onNull: 0 },
                        },
                    },
                },
            },
        ]);
        const totalSales = salesAgg.length > 0 ? salesAgg[0].totalSales : 0;

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
                        $sum: {
                            $convert: { input: "$totalPrice", to: "double", onError: 0, onNull: 0 },
                        },
                    },
                },
            },
            { $sort: { _id: 1 } }, 
        ]);

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

router.post("/", async (req, res) => {
    const { error } = orderSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    try {
        let calculatedTotalPrice = 0;
        
        // Calculate total and check stock availability
        for (const item of req.body.orderItems) {
            const product = await Product.findById(item.product).select("price countInStock name");
            if (!product) return res.status(400).send(`Product not found: ${item.product}`);
            
            if (product.countInStock < item.quantity) {
                return res.status(400).send(`Insufficient stock for product: ${product.name}`);
            }
            
            calculatedTotalPrice += product.price * item.quantity;
        }

        let order = new Order({
            orderItems: req.body.orderItems, // Embedded array
            shippingAddress1: req.body.shippingAddress1,
            shippingAddress2: req.body.shippingAddress2,
            city: req.body.city,
            zip: req.body.zip,
            country: req.body.country,
            phone: req.body.phone,
            status: req.body.status,
            totalPrice: calculatedTotalPrice,
            user: req.body.user,
        });

        order = await order.save();
        if (!order) return res.status(400).send("the order cannot be created!");

        // Decrease stock inventory
        for (const item of order.orderItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { countInStock: -item.quantity } 
            });
        }

        res.send(order);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

router.put("/:id", async (req, res) => {
    const order = await Order.findByIdAndUpdate(
        req.params.id,
        {
            status: req.body.status,
            courierName: req.body.courierName,
            trackingNumber: req.body.trackingNumber
        },
        { returnDocument: "after" },
    );

    if (!order) return res.status(400).send("the order cannot be update!");
    res.send(order);
});

router.delete("/:id", async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found!" });
        }

        // Restore the product stock based on the embedded items
        for (const item of order.orderItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { countInStock: item.quantity }
            });
        }

        await Order.findByIdAndDelete(req.params.id);

        return res.status(200).json({
            success: true,
            message: "The order was deleted and stock was restored!",
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.get(`/get/count`, async (req, res) => {
    try {
        const orderCount = await Order.countDocuments();
        res.status(200).send({ orderCount: orderCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get(`/get/userorders/:userid`, async (req, res) => {
    const userOrderList = await Order.find({ user: req.params.userid })
        .populate("orderItems.product")
        .sort({ dateOrdered: -1 });

    if (!userOrderList) {
        res.status(500).json({ success: false });
    }
    res.send(userOrderList);
});

module.exports = router;