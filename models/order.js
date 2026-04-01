const mongoose = require('mongoose');

// 1. Define the embedded Order Item Schema first
const orderItemSchema = mongoose.Schema({
    quantity: {
        type: Number,
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    }
}, { _id: false }); // _id: false prevents Mongo from creating separate ObjectIds for these subdocuments

// 2. Define the main Order Schema
const orderSchema = mongoose.Schema({
    // Embed the items directly instead of referencing them
    orderItems: [orderItemSchema], 
    
    shippingAddress1: { type: String, required: true },
    shippingAddress2: { type: String },
    city: { type: String, required: true },
    zip: { type: String, required: true },
    country: { type: String, required: true },
    phone: { type: String, required: true },
    status: { type: String, required: true, default: 'Pending' },
    totalPrice: { type: Number },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    dateOrdered: { type: Date, default: Date.now },
    
    // Payments & Logistics
    paymentStatus: { type: String, default: 'Pending' },
    transactionId: { type: String, default: '' },
    courierName: { type: String, default: '' },
    trackingNumber: { type: String, default: '' }
});

orderSchema.virtual('id').get(function () {
    return this._id.toHexString();
});

orderSchema.set('toJSON', { virtuals: true });

exports.Order = mongoose.model('Order', orderSchema);