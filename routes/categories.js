// routes/categories.js
const { Category } = require('../models/category');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// --- Cloudinary Configuration ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'jgm-categories', // Saves to a specific folder in Cloudinary
        allowedFormats: ['jpeg', 'png', 'jpg'],
    },
});

const uploadOptions = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});
// --------------------------------

router.get(`/`, async (req, res) => {
    const categoryList = await Category.find();
    if (!categoryList) return res.status(500).json({ success: false });
    res.status(200).send(categoryList);
});

router.get('/:id', async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(500).json({ message: 'The category with the given ID was not found.' });
    res.status(200).send(category);
});

// POST: Create Category with Image
router.post('/', uploadOptions.single('image'), async (req, res) => {
    const file = req.file;
    let imagepath = '';
    if (file) {
        imagepath = file.path; // Cloudinary URL
    }

    let category = new Category({
        name: req.body.name,
        icon: req.body.icon,
        color: req.body.color,
        image: imagepath
    });

    category = await category.save();
    if (!category) return res.status(400).send('The category cannot be created!');
    res.send(category);
});

router.put('/:id', uploadOptions.single('image'), async (req, res) => {
    const categoryExists = await Category.findById(req.params.id);
    if (!categoryExists) return res.status(400).send('Invalid Category!');

    const file = req.file;
    let imagepath;

    if (file) {
        imagepath = file.path; // New image uploaded
        
        // --- NEW: Delete the old image from Cloudinary ---
        if (categoryExists.image) {
            const urlParts = categoryExists.image.split('/');
            const filename = urlParts[urlParts.length - 1];
            const publicId = `jgm-categories/${filename.split('.')[0]}`; // Match category folder
            
            try {
                await cloudinary.uploader.destroy(publicId);
            } catch (err) {
                console.error("Failed to delete old category image:", err);
            }
        }
        // -------------------------------------------------
        
    } else {
        imagepath = categoryExists.image; // Keep the old image
    }

    const category = await Category.findByIdAndUpdate(
        req.params.id,
        {
            name: req.body.name,
            icon: req.body.icon || categoryExists.icon,
            color: req.body.color,
            image: imagepath
        },
        { returnDocument: 'after' }
    );

    if (!category) return res.status(400).send('The category cannot be updated!');
    res.send(category);
});

router.delete('/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found!" });
        }

        // Delete image from Cloudinary
        if (category.image) {
            const urlParts = category.image.split('/');
            const filename = urlParts[urlParts.length - 1];
            const publicId = `jgm-categories/${filename.split('.')[0]}`;
            
            try {
                await cloudinary.uploader.destroy(publicId);
            } catch (err) {
                console.error("Failed to delete category image:", err);
            }
        }

        // Delete from Database
        await Category.findByIdAndDelete(req.params.id);
        
        return res.status(200).json({ success: true, message: 'The category and image are deleted!' });
        
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});


module.exports = router;