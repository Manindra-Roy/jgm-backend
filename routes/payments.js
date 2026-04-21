/**
 * @fileoverview Payment Gateway Routes (PhonePe Integration).
 * PRODUCTION MODE: Dynamic URL Switching and Strict Checksum Verification.
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const axios = require("axios");
const { Order } = require("../models/order");
const { restoreStock } = require("../helpers/stock-manager");

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

        const expectedAmountInPaise = Math.round(order.totalPrice * 100);
        const actualAmountReceived = responseData.data.amount;

        // SECURITY: Verify the amount paid exactly matches the order total
        if (status === "PAYMENT_SUCCESS" && actualAmountReceived === expectedAmountInPaise) {
            order.paymentStatus = "Paid";
            order.status = "Processing";
            order.transactionId = bankTransactionId; 
        } else {
            // LOGIC: Restore stock before marking the order as cancelled
            await restoreStock(order);
            order.paymentStatus = "Failed";
            order.status = "Cancelled";
        }

        await order.save();
        res.status(200).send("OK");
    } catch (error) {
        console.error("Webhook Processing Error:", error);
        res.status(500).send("Webhook Processing Failed");
    }
});
// =============================================================================
// PHONEPE STATUS CHECK API
// Allows admins (or the frontend polling) to manually verify the real-time
// payment status for orders stuck in "Pending" state.
// =============================================================================

const PHONEPE_STATUS_URL = isProd
    ? "https://api.phonepe.com/apis/hermes/pg/v1/status"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status";

router.get("/check-status/:orderId", async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) return res.status(404).json({ message: "Order not found" });

        // If payment is already resolved, return immediately
        if (order.paymentStatus === "Paid" || order.paymentStatus === "Failed") {
            return res.json({ 
                paymentStatus: order.paymentStatus, 
                orderStatus: order.status,
                message: `Payment already resolved as ${order.paymentStatus}` 
            });
        }

        // If no transaction ID exists, the user never reached PhonePe
        if (!order.transactionId) {
            // LOGIC: Restore stock before marking the order as cancelled
            await restoreStock(order);
            order.paymentStatus = "Failed";
            order.status = "Cancelled";
            await order.save();
            return res.json({ 
                paymentStatus: "Failed", 
                orderStatus: "Cancelled",
                message: "No payment was ever initiated for this order" 
            });
        }

        // Query PhonePe's Status Check API
        const statusPath = `/pg/v1/status/${MERCHANT_ID}/${order.transactionId}`;
        const stringToHash = statusPath + SALT_KEY;
        const checksum = crypto.createHash("sha256").update(stringToHash).digest("hex") + "###" + SALT_INDEX;

        const response = await axios.get(`${PHONEPE_STATUS_URL}/${MERCHANT_ID}/${order.transactionId}`, {
            headers: {
                "Content-Type": "application/json",
                "X-VERIFY": checksum,
                "X-MERCHANT-ID": MERCHANT_ID,
            },
        });

        const phonepeStatus = response.data.code;
        const actualAmount = response.data.data.amount;
        const expectedAmount = Math.round(order.totalPrice * 100);

        // SECURITY: Deep verification of code, amount, and internal state
        if (phonepeStatus === "PAYMENT_SUCCESS" && actualAmount === expectedAmount) {
            order.paymentStatus = "Paid";
            order.status = "Processing";
            order.transactionId = response.data.data.transactionId || order.transactionId;
            await order.save();
            return res.json({ paymentStatus: "Paid", orderStatus: order.status, message: "Payment confirmed by PhonePe" });
        } else if (phonepeStatus === "PAYMENT_PENDING") {
            return res.json({ paymentStatus: "Pending", orderStatus: order.status, message: "Payment is still being processed by PhonePe" });
        } else {
            // PAYMENT_ERROR, PAYMENT_DECLINED, etc.
            // LOGIC: Restore stock before marking the order as cancelled
            await restoreStock(order);
            order.paymentStatus = "Failed";
            order.status = "Cancelled";
            await order.save();
            return res.json({ paymentStatus: "Failed", orderStatus: "Cancelled", message: "Payment failed or was declined" });
        }
    } catch (error) {
        console.error("Status Check Error:", error.response?.data || error.message);
        res.status(500).json({ message: "Failed to check payment status" });
    }
});

// =============================================================================
// STALE ORDER CLEANUP
// Automatically cancels orders that have been in "Pending" payment status
// for more than 30 minutes. These are abandoned checkouts where the user
// never completed payment on PhonePe's page.
// Runs every 15 minutes.
// =============================================================================

const STALE_ORDER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;     // Run every 15 minutes

const cleanupStaleOrders = async () => {
    try {
        const cutoffTime = new Date(Date.now() - STALE_ORDER_TIMEOUT_MS);

        // Fetch orders that need to be cleaned up
        const staleOrders = await Order.find({ 
            paymentStatus: "Pending", 
            dateOrdered: { $lt: cutoffTime } 
        });

        if (staleOrders.length > 0) {
            let processedCount = 0;
            
            for (const order of staleOrders) {
                try {
                    // 1. Return stock to inventory
                    await restoreStock(order);
                    
                    // 2. Mark order as failed/cancelled
                    order.paymentStatus = "Failed";
                    order.status = "Cancelled";
                    await order.save();
                    
                    processedCount++;
                } catch (err) {
                    console.error(`❌ Cleanup failed for stale order ${order._id}:`, err.message);
                }
            }
            
            console.log(`🧹 Auto-cancelled ${processedCount} stale pending order(s) and restored inventory.`);
        }
    } catch (error) {
        console.error("Stale order cleanup error:", error.message);
    }
};

// Start the cleanup interval when the server boots
setInterval(cleanupStaleOrders, CLEANUP_INTERVAL_MS);
// Also run once after a delay to ensure database connection is established
setTimeout(cleanupStaleOrders, 10000);

module.exports = router;
