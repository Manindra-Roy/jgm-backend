/**
 * @fileoverview Standalone Order Item Model (Legacy/Reference).
 * Note: While defined here, best practice (as implemented in order.js) 
 * is to embed this schema directly into the parent Order document.
 */

const mongoose = require('mongoose');

const orderItemSchema = mongoose.Schema({
    quantity: { type: Number, required: true },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }
});

exports.OrderItem = mongoose.model('OrderItem', orderItemSchema);