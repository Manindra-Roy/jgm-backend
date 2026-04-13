/**
 * @fileoverview Payment Gateway Routes (PhonePe Integration).
 * Handles payment initiation cryptography and secure webhook verification.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { Order } = require("../models/order");

// Environment Constants (Fallback to sandbox credentials if undefined)
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "PGTESTPAYUAT";
const SALT_KEY = process.env.PHONEPE_SALT_KEY || "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399";
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || "1";
const PHONEPE_URL = "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay";

/**
 * @route   POST /api/v1/payments/checkout/:orderId
 * @desc    Initiates a PhonePe payment session and generates a secure redirect URL.
 * @access  Public (Called by user after order creation)
 */
router.post("/checkout/:orderId", async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) return res.status(404).send("Order not found");

        // PhonePe requires amounts to be strictly in PAISE (Multiply INR by 100)
        const amountInPaise = Math.round(order.totalPrice * 100);

        // Generate unique tracking ID: JGM-[last 6 of order ID]-[timestamp]
        const merchantTransactionId = `JGM-${order._id.toString().slice(-6)}-${Date.now()}`;

        // Grab the base URLs from your environment variables, but fall back to localhost for local testing!
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        
        // You can use a dedicated webhook URL, or just dynamically build it from your live backend URL
        const backendWebhookUrl = process.env.PHONEPE_WEBHOOK_URL || `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/v1/payments/webhook`;

        // Construct base payload
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
        // const payload = {
        //     merchantId: MERCHANT_ID,
        //     merchantTransactionId: merchantTransactionId,
        //     merchantUserId: order.user ? order.user.toString() : "GUEST-USER",
        //     amount: amountInPaise,
        //     redirectUrl: `http://localhost:5173/payment-success/${order._id}`, 
        //     redirectMode: "REDIRECT",
        //     callbackUrl: process.env.PHONEPE_WEBHOOK_URL || `https://vcdoq-1-39-125-254.run.pinggy-free.link/api/v1/payments/webhook`,
        //     paymentInstrument: { type: "PAY_PAGE" },
        // };

        // --- CRYPTOGRAPHIC SIGNATURE GENERATION ---
        const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
        const stringToHash = base64Payload + "/pg/v1/pay" + SALT_KEY;
        const sha256 = crypto.createHash("sha256").update(stringToHash).digest("hex");
        const checksum = sha256 + "###" + SALT_INDEX;

        // Dispatch to PhonePe Gateway
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

        // Link pending transaction ID to the database order
        order.transactionId = merchantTransactionId;
        await order.save();

        // Return secure payment URL to frontend
        res.status(200).json({
            success: true,
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
        });
    } catch (error) {
        console.error("PhonePe Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Payment initiation failed" });
    }
});

/**
 * @route   POST /api/v1/payments/webhook
 * @desc    Server-to-Server callback from PhonePe upon payment completion.
 * @access  Public (Secured via cryptographic checksum verification)
 */
router.post("/webhook", async (req, res) => {
    try {
        const receivedChecksum = req.headers['x-verify'];
        const base64Response = req.body.response;

        // --- AUTHENTICITY VERIFICATION ---
        // Recalculate checksum using our secure Salt Key to ensure the payload is genuinely from PhonePe
        const stringToHash = base64Response + SALT_KEY;
        const expectedChecksum = crypto.createHash("sha256").update(stringToHash).digest("hex") + "###" + SALT_INDEX;

        if (receivedChecksum !== expectedChecksum) {
            console.error("🚨 Invalid Webhook Checksum detected!");
            return res.status(400).send("Invalid Checksum");
        }

        // Decode verified payload
        const decodedResponse = Buffer.from(base64Response, "base64").toString("utf8");
        const responseData = JSON.parse(decodedResponse);

        const merchantTransactionId = responseData.data.merchantTransactionId;
        const bankTransactionId = responseData.data.transactionId; 
        const status = responseData.code;

        // Locate corresponding order
        const order = await Order.findOne({ transactionId: merchantTransactionId });
        if (!order) return res.status(404).send("Order not found");

        // Update database based on bank response
        if (status === "PAYMENT_SUCCESS") {
            order.paymentStatus = "Paid";
            order.transactionId = bankTransactionId; // Store actual bank reference
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
