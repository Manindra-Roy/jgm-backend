const { expressjwt: expressJwt } = require("express-jwt");

function authJwt() {
    const secret = process.env.secret;
    const api = process.env.API_URL;
    return expressJwt({
        secret,
        algorithms: ["HS256"],
        isRevoked: isRevoked,
        // NEW: Tell it to extract the token from the cookie!
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
            `${api}/users/login`,
            `${api}/users/register`,
            `${api}/users/logout` // Add logout to unprotected paths
        ],
    });
}

async function isRevoked(req, token) {
    if (!token.payload.isAdmin) {
        return true; 
    }
    return false; 
}

module.exports = authJwt;