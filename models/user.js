/**
 * @fileoverview User Database Model.
 * Defines the schema for administrators and customers, including 
 * authentication fields, shipping addresses, and OTP verification data.
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    phone: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    
    // Address Details
    street: { type: String, default: '' },
    apartment: { type: String, default: '' },
    zip: { type: String, default: '' },
    city: { type: String, default: '' },
    country: { type: String, default: '' },
    
    // Security & Verification
    isEmailVerified: { type: Boolean, default: false }, // Users are unverified by default
    otp: { type: String }, // Stores the temporary 6-digit code
    otpExpires: { type: Date } // Expiration timestamp for the OTP
}, { timestamps: true });

// --- VIRTUAL ID MAPPING ---
// Converts MongoDB's default '_id' object into a clean 'id' string for the React frontend
userSchema.virtual('id').get(function () {
    return this._id.toHexString();
});

userSchema.set('toJSON', { virtuals: true });

exports.User = mongoose.model('User', userSchema);
exports.userSchema = userSchema;