/**
 * @fileoverview Email Service Helper.
 * Configures Nodemailer to dispatch transactional emails (e.g., OTPs) securely.
 */

// const nodemailer = require('nodemailer');

// // Configure the SMTP transporter using environment variables
// const transporter = nodemailer.createTransport({
//     service: 'gmail', 
//     auth: {
//         user: process.env.EMAIL_USER, 
//         pass: process.env.EMAIL_PASS  // Requires a Google App Password, not a standard login password
//     }
// });

const nodemailer = require('nodemailer');

// Explicitly define host and secure port for production environments
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // CRITICAL: Forces secure SSL connection 
    family: 4,
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS  
    }
});

/**
 * Dispatches an HTML-formatted email containing a 6-digit OTP code.
 * @param {string} userEmail - The recipient's email address.
 * @param {string} otpCode - The 6-digit security code.
 * @returns {Promise<any>} A promise that resolves when the email is sent.
 */
const sendOtpEmail = async (userEmail, otpCode) => {
    const mailOptions = {
        from: `"JGM Industries" <${process.env.EMAIL_USER}>`,
        to: userEmail,
        subject: 'Verify Your JGM Account - OTP',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                <h2>Welcome to JGM Industries!</h2>
                <p>Please use the following 6-digit code to verify your email address. This code will expire in 10 minutes.</p>
                <h1 style="background: #f4f4f4; padding: 10px; letter-spacing: 5px; color: #3498db;">${otpCode}</h1>
                <p>If you did not request this, please ignore this email.</p>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { sendOtpEmail };
