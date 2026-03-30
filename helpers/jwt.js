const { expressjwt: expressJwt } = require("express-jwt");

function authJwt() {
    const secret = process.env.secret;
    const api = process.env.API_URL;
    return expressJwt({
        secret,
        algorithms: ["HS256"],
        isRevoked: isRevoked,
    }).unless({
        path: [
            { url: /\/public\/uploads(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/products(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/categories(.*)/, methods: ["GET", "OPTIONS"] },
            { url: /\/api\/v1\/orders(.*)/, methods: ["GET", "OPTIONS", "POST"] },
            `${api}/users/login`,
            `${api}/users/register`,
        ],
    });
}

// Updated isRevoked function for express-jwt v8+
async function isRevoked(req, token) {
    // token.payload contains the decoded JWT data (like isAdmin)
    if (!token.payload.isAdmin) {
        return true; // Return true to revoke access
    }

    return false; // Return false to allow access
}

module.exports = authJwt;