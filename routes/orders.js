/**
 * @fileoverview Order Management Routes.
 * Refactored to use OrderRepository for cleaner architecture.
 */

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const orderRepository = require("../repositories/OrderRepository");
const { Product } = require("../models/product"); // Still needed for stock check in route
const { orderSchema } = require("../helpers/validator");

/**
 * @route   GET /api/v1/orders/
 */
router.get(`/`, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const { orders, totalCount } = await orderRepository.findAll(page, limit);
        res.send({ orders, totalCount, page, limit });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/:id
 */
router.get(`/:id`, async (req, res) => {
    try {
        const order = await orderRepository.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });
        res.send(order);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/get/dashboard-stats
 */
router.get("/get/dashboard-stats", async (req, res) => {
    try {
        const stats = await orderRepository.getDashboardStats();
        res.status(200).json(stats);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/v1/orders/
 */
router.post("/", async (req, res) => {
    const { error } = orderSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        let calculatedTotalPrice = 0;
        for (const item of req.body.orderItems) {
            const product = await Product.findById(item.product).select("price countInStock name").session(session);
            if (!product) throw new Error(`Product not found: ${item.product}`);
            if (product.countInStock < item.quantity) throw new Error(`Insufficient stock for product: ${product.name}`);
            calculatedTotalPrice += product.price * item.quantity;
        }

        const userId = (req.auth && req.auth.userId) ? req.auth.userId : (req.body.user || null);

        const order = await orderRepository.create({
            ...req.body,
            status: 'Pending',
            totalPrice: calculatedTotalPrice,
            user: userId,
        }, session);

        for (const item of order.orderItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { countInStock: -item.quantity } 
            }, { session });
        }

        await session.commitTransaction();
        session.endSession();
        res.send(order);
    } catch (err) {
        await session.abortTransaction();
        session.endSession();
        const status = err.message.includes('Insufficient') || err.message.includes('not found') ? 400 : 500;
        res.status(status).send(err.message);
    }
});

/**
 * @route   PUT /api/v1/orders/:id
 */
router.put("/:id", async (req, res) => {
    try {
        const existingOrder = await orderRepository.findById(req.params.id);
        if (!existingOrder) return res.status(404).send("Order not found!");

        const updatedOrder = await orderRepository.update(req.params.id, {
            status: req.body.status,
            courierName: req.body.courierName,
            trackingNumber: req.body.trackingNumber
        });

        if (req.body.status === 'Cancelled' && existingOrder.status !== 'Cancelled') {
            await orderRepository.restoreStock(req.params.id);
        }

        res.send(updatedOrder);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

/**
 * @route   DELETE /api/v1/orders/:id
 */
router.delete("/:id", async (req, res) => {
    try {
        const order = await orderRepository.findById(req.params.id);
        if (!order) return res.status(404).json({ success: false, message: "Order not found!" });

        if (order.status !== 'Cancelled') {
            await orderRepository.restoreStock(req.params.id);
        }

        await orderRepository.delete(req.params.id);
        res.status(200).json({ success: true, message: "Order deleted and inventory synchronized!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/get/count
 */
router.get(`/get/count`, async (req, res) => {
    try {
        const { totalCount } = await orderRepository.findAll(1, 1);
        res.status(200).send({ orderCount: totalCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/orders/get/userorders/:userid
 */
router.get(`/get/userorders/:userid`, async (req, res) => {
    try {
        const userOrderList = await orderRepository.findByUserId(req.params.userid);
        res.send(userOrderList);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;