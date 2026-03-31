// routes/payments.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { Order } = require('../models/order');

// Load environment variables or fallback to test credentials
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT';
const SALT_KEY = process.env.PHONEPE_SALT_KEY || '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399';
const SALT_INDEX = process.env.PHONEPE_SALT_INDEX || '1';

// PhonePe Sandbox/Testing URL
const PHONEPE_URL = 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay';

// 1. INITIATE PAYMENT: The customer's frontend calls this after creating an order
router.post('/checkout/:orderId', async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        if (!order) return res.status(404).send('Order not found');

        // PhonePe strictly requires the amount to be in PAISE, not Rupees! (Multiply by 100)
        const amountInPaise = Math.round(order.totalPrice * 100);
        
        // Generate a unique tracking ID for this specific payment attempt
        // Grabs the last 6 characters of the Order ID + the Timestamp (Total: ~24 chars)
const merchantTransactionId = `JGM-${order._id.toString().slice(-6)}-${Date.now()}`;

        // Construct the payload exactly how PhonePe documentation requires
        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: merchantTransactionId,
            merchantUserId: order.user ? order.user.toString() : 'GUEST-USER',
            amount: amountInPaise,
            redirectUrl: `http://localhost:5173/payment-success/${order._id}`, // Where the user goes after paying
            redirectMode: "REDIRECT",
            callbackUrl: `https://purple-women-argue.loca.lt/api/v1/payments/webhook`, // Server-to-server hidden webhook
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        // --- THE CRYPTOGRAPHY ---
        // 1. Convert JSON payload to Base64 String
        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
        // 2. Append API endpoint and Salt Key
        const stringToHash = base64Payload + '/pg/v1/pay' + SALT_KEY;
        // 3. Hash it using SHA-256
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        // 4. Append Salt Index to create the final X-VERIFY checksum signature
        const checksum = sha256 + '###' + SALT_INDEX;

        // Send request to PhonePe
        const response = await axios.post(PHONEPE_URL, { request: base64Payload }, {
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': checksum,
                'accept': 'application/json'
            }
        });

        // Save the pending transaction ID to our database
        order.transactionId = merchantTransactionId;
        await order.save();

        // Return the secure PhonePe URL to the frontend so the user can be redirected
        res.status(200).json({ 
            success: true, 
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url 
        });

    } catch (error) {
        console.error("PhonePe Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: 'Payment initiation failed' });
    }
});

// 2. THE WEBHOOK: PhonePe's servers will secretly hit this URL after the user pays
router.post('/webhook', async (req, res) => {
    try {
        // PhonePe sends the response back encoded in Base64
        const base64Response = req.body.response;
        const decodedResponse = Buffer.from(base64Response, 'base64').toString('utf8');
        const responseData = JSON.parse(decodedResponse);

        const merchantTransactionId = responseData.data.merchantTransactionId;
        const bankTransactionId = responseData.data.transactionId; // PhonePe's official bank ID
        const status = responseData.code; 

        // Find the specific order waiting for this payment
        const order = await Order.findOne({ transactionId: merchantTransactionId });
        if (!order) return res.status(404).send('Order not found');

        // Update the payment status in our database
        if (status === 'PAYMENT_SUCCESS') {
            order.paymentStatus = 'Paid';
            order.transactionId = bankTransactionId; // Overwrite our temp ID with the official Bank Receipt ID
        } else {
            order.paymentStatus = 'Failed';
        }

        await order.save();

        // You MUST return a 200 OK, otherwise PhonePe will keep spamming this route for 24 hours
        res.status(200).send('OK'); 
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).send('Webhook Processing Failed');
    }
});

module.exports = router;