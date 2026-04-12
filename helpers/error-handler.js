/**
 * @fileoverview Global Error Handler Middleware.
 * Catches unauthorized JWT tokens, validation errors, and general server faults.
 * Prevents the backend from crashing and returns clean JSON error messages.
 */

function errorHandler(err, req, res, next) {
    // 1. JWT Authentication Error (Invalid or expired token)
    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({ 
            success: false, 
            message: "The user is not authorized." 
        });
    }

    // 2. Mongoose/Joi Validation Error (Bad data submitted)
    if (err.name === 'ValidationError') {
        return res.status(400).json({ 
            success: false, 
            message: err.message 
        });
    }

    // 3. Fallback for all other unexpected server errors
    console.error("🚨 Server Error:", err.message);
    return res.status(500).json({ 
        success: false, 
        error: err.message || "An unexpected error occurred." 
    });
}

module.exports = errorHandler;