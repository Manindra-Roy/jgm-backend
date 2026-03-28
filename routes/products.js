const { Product } = require('../models/product');
const express = require('express');
const { Category } = require('../models/category');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cloudinary Storage Setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'jgm-products',
    allowedFormats: ['jpeg', 'png', 'jpg'],
  },
});

// Add file size limit (5MB)
const uploadOptions = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } 
});

// GET Products with Pagination
router.get(`/`, async (req, res) => {
    let filter = {};
    if(req.query.categories) {
         filter = {category: req.query.categories.split(',')}
    }

    // Pagination logic
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const productList = await Product.find(filter)
        .populate('category')
        .skip(skip)
        .limit(limit);

    if(!productList) return res.status(500).json({success: false});
    res.send(productList);
});

// GET Single Product
router.get(`/:id`, async (req, res) => {
    const product = await Product.findById(req.params.id).populate('category');
    if(!product) return res.status(500).json({success: false});
    res.send(product);
});

// POST Product (Upload to Cloudinary)
router.post(`/`, uploadOptions.single('image'), async (req, res) => {
    const category = await Category.findById(req.body.category);
    if(!category) return res.status(400).send('Invalid Category');

    const file = req.file;
    if(!file) return res.status(400).send('No image in the request');

    let product = new Product({
        name: req.body.name,
        description: req.body.description,
        richDescription: req.body.richDescription,
        image: req.file.path, // Direct Cloudinary URL
        brand: req.body.brand,
        price: req.body.price,
        category: req.body.category,
        countInStock: req.body.countInStock,
        rating: req.body.rating,
        numReviews: req.body.numReviews,
        isFeatured: req.body.isFeatured,
    });

    product = await product.save();
    if(!product) return res.status(500).send('The product cannot be created');
    res.send(product);
});

router.delete('/:id', async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);
        if (product) {
            return res.status(200).json({ success: true, message: 'Item deleted!' });
        } else {
            return res.status(404).json({ success: false, message: 'Item not found!' });
        }
    } catch (err) {
        return res.status(500).json({ success: false, error: err });
    }
});

// ... (You can copy the PUT, DELETE, and GET COUNT routes from your original file, keeping in mind image handling requires Cloudinary for the gallery-images route as well).

module.exports = router;