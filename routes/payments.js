/**
 * @fileoverview Payment Gateway Routes (PhonePe Integration).
 * PRODUCTION MODE: Dynamic URL Switching and Strict Checksum Verification.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { Order } = require("../models/order");

const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID;
const SALT_KEY = process.env.PHONEPE_SALT_KEY;
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || "1";

// --- DYNAMIC PRODUCTION SWITCH ---
const isProd = process.env.PHONEPE_ENV === 'PROD';
const PHONEPE_URL = isProd 
    ? "https://api.phonepe.com/apis/hermes/pg/v1/pay"              
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay"; 

router.post("/checkout/:orderId", async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) return res.status(404).send("Order not found");

        const amountInPaise = Math.round(order.totalPrice * 100);
        const merchantTransactionId = `JGM-${order._id.toString().slice(-6)}-${Date.now()}`;

        const frontendUrl = process.env.FRONTEND_URL;
        const backendWebhookUrl = process.env.PHONEPE_WEBHOOK_URL;

        if (!frontendUrl || !backendWebhookUrl || !MERCHANT_ID || !SALT_KEY) {
            console.error("🚨 Missing critical payment environment variables!");
            return res.status(500).json({ success: false, message: "Server misconfiguration" });
        }

        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: merchantTransactionId,
            merchantUserId: order.user ? order.user.toString() : "GUEST-USER",
            amount: amountInPaise,
            redirectUrl: `${frontendUrl}/payment-success/${order._id}`, 
            redirectMode: "REDIRECT",
            callbackUrl: backendWebhookUrl, 
            paymentInstrument: { type: "PAY_PAGE" },
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
        const stringToHash = base64Payload + "/pg/v1/pay" + SALT_KEY;
        const sha256 = crypto.createHash("sha256").update(stringToHash).digest("hex");
        const checksum = sha256 + "###" + SALT_INDEX;

        const response = await axios.post(
            PHONEPE_URL,
            { request: base64Payload },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-VERIFY": checksum,
                    accept: "application/json",
                },
            },
        );

        order.transactionId = merchantTransactionId;
        await order.save();

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

        if (receivedChecksum !== expectedChecksum) {
            console.error("🚨 Invalid Webhook Checksum detected!");
            return res.status(400).send("Invalid Checksum");
        }

        const decodedResponse = Buffer.from(base64Response, "base64").toString("utf8");
        const responseData = JSON.parse(decodedResponse);

        const merchantTransactionId = responseData.data.merchantTransactionId;
        const bankTransactionId = responseData.data.transactionId; 
        const status = responseData.code;

        const order = await Order.findOne({ transactionId: merchantTransactionId });
        if (!order) return res.status(404).send("Order not found");

        if (status === "PAYMENT_SUCCESS") {
            order.paymentStatus = "Paid";
            order.transactionId = bankTransactionId; 
        } else {
            order.paymentStatus = "Failed";
        }

        await order.save();
        res.status(200).send("OK");
    } catch (error) {
        console.error("Webhook Processing Error:", error);
        res.status(500).send("Webhook Processing Failed");
    }
});

module.exports = router;
