
const { expressjwt: expressJwt } = require("express-jwt");

function authJwt() {
    const secret = process.env.secret;
    const api = process.env.API_URL;
    return expressJwt({
        secret,
        algorithms: ["HS256"],
        isRevoked: isRevoked,
        getToken: function (req) {
            if (req.cookies && req.cookies.jgm_token) {
                return req.cookies.jgm_token;
            }
            return null;
        }
    }).unless({
        path: [
            { url: /\/public\/uploads(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/products(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/categories(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/orders(.*)/, methods: ["GET", "OPTIONS", "POST"] },
            { url: /\/api\/v1\/payments\/webhook(.*)/, methods: ["POST"] },
            { url: /\/api\/v1\/payments\/checkout(.*)/, methods: ["POST"] },
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

async function isRevoked(req, token) {
    const path = req.originalUrl || req.url;

    // 1. ALLOW normal customers to fetch their own profile and order history
    if (path.includes('/users/me/profile') || path.includes('/orders/get/userorders')) {
        return false; // Do not revoke
    }

    // 2. BLOCK normal customers from all other protected routes (Admin Panel routes)
    if (!token.payload.isAdmin) {
        return true; // Revoke!
    }
    
    return false; 
}

module.exports = authJwt;