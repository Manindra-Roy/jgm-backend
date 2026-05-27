/**
 * @fileoverview Payment Gateway Routes.
 * Production-hardened implementation with error isolation, robust error handling, and atomic database transitions.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const orderRepository = require("../repositories/OrderRepository");

// Guard the status route against client polling flooding (e.g. max 5 requests per 10 seconds)
const statusLimiter = rateLimit({
    windowMs: 10 * 1000, // 10 seconds sliding window
    max: 5, // Limit each IP to 5 requests per window
    message: { message: "Too many status checks, please wait a few seconds before trying again." },
    skip: () => process.env.NODE_ENV === 'test' // Skip rate limiting during automated testing
});

const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY = process.env.PHONEPE_SALT_KEY;
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || "1";

if (!MERCHANT_ID || !SALT_KEY) {
    console.error("❌ CRITICAL: PhonePe environment configurations are missing!");
}

const isProd = process.env.PHONEPE_ENV === 'PROD';
const PHONEPE_URL = isProd 
    ? "https://api.phonepe.com/apis/hermes/pg/v1/pay"              
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay"; 

const PHONEPE_STATUS_URL = isProd
    ? "https://api.phonepe.com/apis/hermes/pg/v1/status"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status";

const initiatePayment = async (orderId) => {
    const order = await orderRepository.findById(orderId);
    if (!order) {
        const error = new Error("Order not found");
        error.isOrderNotFound = true;
        throw error;
    }

    if (order.paymentStatus === "Paid") {
        throw new Error("Order has already been paid for");
    }

    const amountInPaise = Math.round(order.totalPrice * 100);
    const merchantTransactionId = `JGM-${order._id.toString().slice(-6)}-${Date.now()}`;

    // Mutate state prior to remote request execution to completely mitigate webhook timing issues
    await orderRepository.update(order._id, { transactionId: merchantTransactionId });

    const payload = {
        merchantId: MERCHANT_ID,
        merchantTransactionId: merchantTransactionId,
        merchantUserId: order.user ? (order.user._id ? order.user._id.toString() : order.user.toString()) : "GUEST-USER",
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
            "Accept": "application/json",
        },
        timeout: 10000 // Mitigate infinite thread hanging
    });

    if (!response.data?.data?.instrumentResponse?.redirectInfo?.url) {
        throw new Error("Invalid malformed structural mapping returned from gateway API.");
    }

    return response.data.data.instrumentResponse.redirectInfo.url;
};

router.post("/checkout/:orderId", async (req, res) => {
    try {
        const paymentUrl = await initiatePayment(req.params.orderId);
        res.status(200).json({ success: true, paymentUrl });
    } catch (error) {
        console.error("PhonePe Checkout Error:", error.response?.data || error.message);
        if (error.isOrderNotFound) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        res.status(500).json({ success: false, message: error.message || "Payment initiation failed" });
    }
});

router.get("/checkout/:orderId", async (req, res) => {
    try {
        const paymentUrl = await initiatePayment(req.params.orderId);
        res.redirect(paymentUrl);
    } catch (error) {
        console.error("PhonePe Redirect Error:", error.response?.data || error.message);
        if (error.isOrderNotFound) {
            return res.status(404).send("Order not found");
        }
        res.status(500).send("Payment initiation failed");
    }
});

router.post("/webhook", async (req, res) => {
    try {
        const receivedChecksum = req.headers['x-verify'];
        const base64Response = req.body?.response;

        if (!receivedChecksum || !base64Response) {
            return res.status(400).send("Missing payload requirements");
        }

        const stringToHash = base64Response + SALT_KEY;
        const expectedChecksum = crypto.createHash("sha256").update(stringToHash).digest("hex") + "###" + SALT_INDEX;

        if (receivedChecksum !== expectedChecksum) return res.status(400).send("Invalid Checksum");

        let responseData;
        try {
            responseData = JSON.parse(Buffer.from(base64Response, "base64").toString("utf8"));
        } catch (parseError) {
            return res.status(400).send("Malformed Base64 JSON Payload structurally invalid");
        }

        const merchantTxnId = responseData?.data?.merchantTransactionId;
        if (!merchantTxnId) return res.status(400).send("Missing Identification parameter context");

        const order = await orderRepository.findByTransactionId(merchantTxnId);
        if (!order) return res.status(404).send("Order reference pointer mismatch");

        if (order.paymentStatus === "Paid" || order.paymentStatus === "Failed") {
            return res.status(200).send("OK");
        }

        const expectedAmount = Math.round(order.totalPrice * 100);
        if (responseData.code === "PAYMENT_SUCCESS" && responseData.data?.amount === expectedAmount) {
            await orderRepository.update(order._id, {
                paymentStatus: "Paid",
                status: "Processing",
                gatewayTransactionId: responseData.data.transactionId
            });
        } else if (responseData.code !== "PAYMENT_PENDING") {
            // Atomic cancellation and stock restoration to eliminate distributed race conditions
            await orderRepository.cancelAndRestoreStock(order._id);
        }

        res.status(200).send("OK");
    } catch (error) {
        console.error("Critical Webhook Processing Fault:", error);
        res.status(500).send("Internal Server Exception Context Captured");
    }
});

router.get("/check-status/:orderId", statusLimiter, async (req, res) => {
    try {
        const order = await orderRepository.findById(req.params.orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (order.paymentStatus === "Paid" || order.paymentStatus === "Failed") {
            return res.json({ paymentStatus: order.paymentStatus, orderStatus: order.status });
        }

        if (!order.transactionId) {
            await orderRepository.cancelAndRestoreStock(order._id);
            return res.json({ paymentStatus: "Failed", orderStatus: "Cancelled" });
        }

        const statusPath = `/pg/v1/status/${MERCHANT_ID}/${order.transactionId}`;
        const checksum = crypto.createHash("sha256").update(statusPath + SALT_KEY).digest("hex") + "###" + SALT_INDEX;

        let response;
        try {
            response = await axios.get(`${PHONEPE_STATUS_URL}/${MERCHANT_ID}/${order.transactionId}`, {
                headers: { "X-VERIFY": checksum, "X-MERCHANT-ID": MERCHANT_ID },
                timeout: 8000
            });
        } catch (axiosError) {
            // Handle network timeouts or temporary 404/500 errors from PhonePe gracefully without canceling the order
            console.warn(`⚠️ PhonePe Status API connection warning: ${axiosError.message}`);
            return res.json({ paymentStatus: "Pending", orderStatus: order.status, note: "Gateway synchronizing state." });
        }

        const phonepeStatus = response.data?.code;
        const expectedAmount = Math.round(order.totalPrice * 100);

        if (phonepeStatus === "PAYMENT_SUCCESS" && response.data?.data?.amount === expectedAmount) {
            const updated = await orderRepository.update(order._id, {
                paymentStatus: "Paid",
                status: "Processing",
                gatewayTransactionId: response.data.data.transactionId || null
            });
            return res.json({ paymentStatus: "Paid", orderStatus: updated.status });
        } else if (phonepeStatus === "PAYMENT_PENDING") {
            return res.json({ paymentStatus: "Pending", orderStatus: order.status });
        } else {
            await orderRepository.cancelAndRestoreStock(order._id);
            return res.json({ paymentStatus: "Failed", orderStatus: "Cancelled" });
        }
    } catch (error) {
        console.error("Status Check Error Runtime Exception:", error.message);
        res.status(500).json({ message: "Failed to verify current payment status context" });
    }
});

// Stale Cleanup Logic
const STALE_ORDER_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

const cleanup = async () => {
    try {
        const count = await orderRepository.cleanupStaleOrders(STALE_ORDER_TIMEOUT_MS);
        if (count > 0) console.log(`🧹 Auto-cancelled ${count} stale order(s).`);
    } catch (error) {
        console.error("❌ Background cleanup failed:", error.message);
    }
};

if (process.env.NODE_ENV !== 'test') {
    setInterval(cleanup, CLEANUP_INTERVAL_MS);
    setTimeout(cleanup, 10000);
}

module.exports = router;
