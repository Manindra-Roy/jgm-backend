/**
 * @fileoverview JWT Authentication Middleware.
 * Configures express-jwt to protect API routes, extract tokens from secure HTTP-only cookies,
 * and implement custom Role-Based Access Control (RBAC) for Admins vs. Customers.
 */

const { expressjwt: expressJwt } = require("express-jwt");

/**
 * Initializes the JWT middleware to secure the application.
 * Defines which routes are public (unprotected) and extracts the token from cookies.
 * @returns {Function} Express middleware function
 */
function authJwt() {
    const secret = process.env.secret;
    const api = process.env.API_URL;
    
    return expressJwt({
        secret,
        algorithms: ["HS256"],
        isRevoked: isRevoked,
        getToken: function (req) {
            // Securely extract the token from the HTTP-only cookie
            if (req.cookies && req.cookies.jgm_token) {
                return req.cookies.jgm_token;
            }
            return null;
        }
    }).unless({
        // Define all public routes that do NOT require a token here
        path: [
            { url: /\/public\/uploads(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/products(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/categories(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/orders(.*)/, methods: ["OPTIONS"] },
            { url: /\/api\/v1\/payments\/webhook(.*)/, methods: ["POST"] },
            { url: /\/api\/v1\/payments\/checkout(.*)/, methods: ["GET", "POST"] },
            { url: /\/api\/v1\/payments\/check-status(.*)/, methods: ["GET"] },
            "/",
            "/favicon.ico",
            { url: new RegExp(`^${api}/?$`), methods: ["GET", "OPTIONS"] },
            `${api}/users/login`,
            `${api}/users/register`,
            `${api}/users/logout`,
            `${api}/users/verify-email`,
            `${api}/users/contact`,
            `${api}/users/forgot-password`,
            `${api}/users/reset-password`
        ],
    });
}

/**
 * Custom logic to dynamically revoke access based on User Roles (Admin vs Customer).
 * @param {Object} req - The Express request object.
 * @param {Object} token - The decoded JWT token payload.
 * @returns {Promise<boolean>} True if access should be revoked (blocked), False if allowed.
 */
async function isRevoked(req, token) {
    // 1. ALLOW admins to access everything
    if (token.payload && token.payload.isAdmin) {
        return false; // Do not revoke
    }

    const path = req.originalUrl || req.url;
    const cleanPath = path.split('?')[0].replace(/\/$/, '');
    const method = req.method;

    // 2. ALLOW normal customers to access specific safe routes
    // Profile, Address, and verify-session
    if (cleanPath.endsWith('/users/me/profile') && method === 'GET') {
        return false;
    }
    if (cleanPath.endsWith('/users/me/address') && method === 'PUT') {
        return false;
    }
    if (cleanPath.endsWith('/users/verify-session') && method === 'GET') {
        return false;
    }

    // Order placement: POST /api/v1/orders
    if (cleanPath.endsWith('/orders') && method === 'POST') {
        return false;
    }

    // User order history: GET /api/v1/orders/get/userorders/:userid
    if (cleanPath.includes('/orders/get/userorders') && method === 'GET') {
        return false;
    }

    // Single order details: GET /api/v1/orders/:id
    const orderDetailRegex = /\/orders\/[a-fA-F0-9]{24}$/;
    if (orderDetailRegex.test(cleanPath) && method === 'GET') {
        return false;
    }

    // 3. BLOCK normal customers from all other protected routes (e.g., Admin Panel routes)
    return true; // Revoke!
}

module.exports = authJwt;