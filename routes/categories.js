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

// PUT: Update Category with optional Image
router.put('/:id', uploadOptions.single('image'), async (req, res) => {
    const categoryExists = await Category.findById(req.params.id);
    if (!categoryExists) return res.status(400).send('Invalid Category!');

    const file = req.file;
    let imagepath;

    if (file) {
        imagepath = file.path; // New image uploaded
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

router.delete('/:id', (req, res) => {
    Category.findByIdAndDelete(req.params.id).then(category => {
        if (category) {
            return res.status(200).json({ success: true, message: 'The category is deleted!' });
        } else {
            return res.status(404).json({ success: false, message: "Category not found!" });
        }
    }).catch(err => {
        return res.status(500).json({ success: false, error: err });
    });
});

module.exports = router;