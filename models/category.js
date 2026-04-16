/**
 * @fileoverview Category Database Model.
 * Defines the structural classification for products, including 
 * metadata for frontend rendering (icons, colors, cover images).
 */

const mongoose = require('mongoose');

const categorySchema = mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String },
    color: { type: String },
    image: { type: String, default: '' } // Cloudinary URL for the category banner
}, { timestamps: true });

// --- VIRTUAL ID MAPPING ---
categorySchema.virtual('id').get(function () {
    return this._id.toHexString();
});

categorySchema.set('toJSON', { virtuals: true });

exports.Category = mongoose.model('Category', categorySchema);