/**
 * @fileoverview Payment Gateway Routes.
 * Refactored to use OrderRepository for centralized order state management.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const orderRepository = require("../repositories/OrderRepository");

const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY = process.env.PHONEPE_SALT_KEY;
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || "1";

const isProd = process.env.PHONEPE_ENV === 'PROD';
const PHONEPE_URL = isProd 
    ? "https://api.phonepe.com/apis/hermes/pg/v1/pay"              
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay"; 

router.post("/checkout/:orderId", async (req, res) => {
    try {
        const order = await orderRepository.findById(req.params.orderId);
        if (!order) return res.status(404).send("Order not found");

        const amountInPaise = Math.round(order.totalPrice * 100);
        const merchantTransactionId = `JGM-${order._id.toString().slice(-6)}-${Date.now()}`;

        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: merchantTransactionId,
            merchantUserId: order.user ? order.user.toString() : "GUEST-USER",
            amount: amountInPaise,
            redirectUrl: `${process.env.FRONTEND_URL}/payment-success/${order._id}`, 
            redirectMode: "REDIRECT",
            callbackUrl: process.env.PHONEPE_WEBHOOK_URL, 
            paymentInstrument: { type: "PAY_PAGE" },
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
        const stringToHash = base64Payload + "/pg/v1/pay" + SALT_KEY;
        const checksum = crypto.createHash("sha256").update(stringToHash).digest("hex") + "###" + SALT_INDEX;

        const response = await axios.post(PHONEPE_URL, { request: base64Payload }, {
            headers: {
                "Content-Type": "application/json",
                "X-VERIFY": checksum,
                accept: "application/json",
            },
        });

        await orderRepository.update(order._id, { transactionId: merchantTransactionId });

        res.status(200).json({
            success: true,
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
        });
    } catch (error) {
        console.error("PhonePe Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Payment initiation failed" });
    }
});

router.post("/webhook", async (req, res) => {
    try {
        const receivedChecksum = req.headers['x-verify'];
        const base64Response = req.body.response;
        const stringToHash = base64Response + SALT_KEY;
        const expectedChecksum = crypto.createHash("sha256").update(stringToHash).digest("hex") + "###" + SALT_INDEX;

        if (receivedChecksum !== expectedChecksum) return res.status(400).send("Invalid Checksum");

        const responseData = JSON.parse(Buffer.from(base64Response, "base64").toString("utf8"));
        const order = await orderRepository.findByTransactionId(responseData.data.merchantTransactionId);
        if (!order) return res.status(404).send("Order not found");

        const expectedAmount = Math.round(order.totalPrice * 100);
        if (responseData.code === "PAYMENT_SUCCESS" && responseData.data.amount === expectedAmount) {
            await orderRepository.update(order._id, {
                paymentStatus: "Paid",
                status: "Processing",
                transactionId: responseData.data.transactionId
            });
        } else {
            await orderRepository.restoreStock(order._id);
            await orderRepository.update(order._id, { paymentStatus: "Failed", status: "Cancelled" });
        }

        res.status(200).send("OK");
    } catch (error) {
        console.error("Webhook Processing Error:", error);
        res.status(500).send("Webhook Processing Failed");
    }
});

const PHONEPE_STATUS_URL = isProd
    ? "https://api.phonepe.com/apis/hermes/pg/v1/status"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status";

router.get("/check-status/:orderId", async (req, res) => {
    try {
        const order = await orderRepository.findById(req.params.orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (order.paymentStatus === "Paid" || order.paymentStatus === "Failed") {
            return res.json({ paymentStatus: order.paymentStatus, orderStatus: order.status });
        }

        if (!order.transactionId) {
            await orderRepository.restoreStock(order._id);
            await orderRepository.update(order._id, { paymentStatus: "Failed", status: "Cancelled" });
            return res.json({ paymentStatus: "Failed", orderStatus: "Cancelled" });
        }

        const statusPath = `/pg/v1/status/${MERCHANT_ID}/${order.transactionId}`;
        const checksum = crypto.createHash("sha256").update(statusPath + SALT_KEY).digest("hex") + "###" + SALT_INDEX;

        const response = await axios.get(`${PHONEPE_STATUS_URL}/${MERCHANT_ID}/${order.transactionId}`, {
            headers: { "X-VERIFY": checksum, "X-MERCHANT-ID": MERCHANT_ID },
        });

        const phonepeStatus = response.data.code;
        if (phonepeStatus === "PAYMENT_SUCCESS" && response.data.data.amount === Math.round(order.totalPrice * 100)) {
            const updated = await orderRepository.update(order._id, {
                paymentStatus: "Paid",
                status: "Processing",
                transactionId: response.data.data.transactionId || order.transactionId
            });
            return res.json({ paymentStatus: "Paid", orderStatus: updated.status });
        } else if (phonepeStatus === "PAYMENT_PENDING") {
            return res.json({ paymentStatus: "Pending", orderStatus: order.status });
        } else {
            await orderRepository.restoreStock(order._id);
            await orderRepository.update(order._id, { paymentStatus: "Failed", status: "Cancelled" });
            return res.json({ paymentStatus: "Failed", orderStatus: "Cancelled" });
        }
    } catch (error) {
        console.error("Status Check Error:", error.message);
        res.status(500).json({ message: "Failed to check status" });
    }
});

// Stale Cleanup Logic
const STALE_ORDER_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

const cleanup = async () => {
    const count = await orderRepository.cleanupStaleOrders(STALE_ORDER_TIMEOUT_MS);
    if (count > 0) console.log(`🧹 Auto-cancelled ${count} stale order(s).`);
};

setInterval(cleanup, CLEANUP_INTERVAL_MS);
setTimeout(cleanup, 10000);

module.exports = router;
