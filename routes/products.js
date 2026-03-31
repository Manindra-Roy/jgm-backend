// routes/products.js
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





    // NEW: Search Filter (Case-insensitive regex search on the product name)
    if(req.query.search) {
         filter.name = { $regex: req.query.search, $options: 'i' };
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
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).send('Invalid Product Id');
    }
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

// PUT Product (Update existing product, handle optional image change)
router.put('/:id', uploadOptions.single('image'), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).send('Invalid Product Id');
    }

    const category = await Category.findById(req.body.category);
    if (!category) return res.status(400).send('Invalid Category');

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(400).send('Invalid Product!');

    const file = req.file;
    let imagepath;

    // If a new file was uploaded, use the new Cloudinary path
    // Otherwise, keep the old image path that is already in the database
    if (file) {
        imagepath = file.path;
    } else {
        imagepath = product.image;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        {
            name: req.body.name,
            description: req.body.description,
            richDescription: req.body.richDescription,
            image: imagepath,
            brand: req.body.brand,
            price: req.body.price,
            category: req.body.category,
            countInStock: req.body.countInStock,
            rating: req.body.rating,
            numReviews: req.body.numReviews,
            isFeatured: req.body.isFeatured,
        },
        // { new: true } // returns the newly updated data
        { returnDocument: 'after' }
    );

    if (!updatedProduct) return res.status(500).send('the product cannot be updated!');
    res.send(updatedProduct);
});

// DELETE Product
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

// GET Product Count (Useful for your dashboard)
router.get(`/get/count`, async (req, res) => {
    try {
        const productCount = await Product.countDocuments();
        res.status(200).send({ productCount: productCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


module.exports = router;