const Joi = require('joi');

const registerSchema = Joi.object({
    name: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    phone: Joi.string().min(10).max(15).required(),
    isAdmin: Joi.boolean(),
    street: Joi.string().allow(''),
    apartment: Joi.string().allow(''),
    zip: Joi.string().allow(''),
    city: Joi.string().allow(''),
    country: Joi.string().allow('')
});

const updateUserSchema = Joi.object({
    name: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).allow(''), // Optional when updating
    phone: Joi.string().min(10).max(15).required(),
    isAdmin: Joi.boolean(),
    street: Joi.string().allow(''),
    apartment: Joi.string().allow(''),
    zip: Joi.string().allow(''),
    city: Joi.string().allow(''),
    country: Joi.string().allow('')
});

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

const productSchema = Joi.object({
    name: Joi.string().required(),
    description: Joi.string().required(),
    richDescription: Joi.string().allow(''),
    brand: Joi.string().allow(''),
    price: Joi.number().min(0).required(),
    category: Joi.string().hex().length(24).required(),
    countInStock: Joi.number().min(0).max(255).required(),
    rating: Joi.number().min(0).max(5).allow(''),
    numReviews: Joi.number().min(0).allow(''),
    isFeatured: Joi.boolean()
});

const orderItemSchema = Joi.object({
    product: Joi.string().hex().length(24).required(),
    quantity: Joi.number().min(1).required()
});

const orderSchema = Joi.object({
    orderItems: Joi.array().items(orderItemSchema).min(1).required(),
    shippingAddress1: Joi.string().required(),
    shippingAddress2: Joi.string().allow(''),
    city: Joi.string().required(),
    zip: Joi.string().required(),
    country: Joi.string().required(),
    phone: Joi.string().required(),
    status: Joi.string().valid('Pending', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'),
    user: Joi.string().hex().length(24).allow(null)
});

module.exports = {
    registerSchema,
    updateUserSchema,
    loginSchema,
    productSchema,
    orderSchema
};