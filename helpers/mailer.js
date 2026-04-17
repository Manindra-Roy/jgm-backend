/**
 * @fileoverview Email Service Helper.
 * Configures Nodemailer to dispatch transactional emails (e.g., OTPs) securely.
 * Uses explicit SMTP config with timeouts for Railway compatibility.
 */

const nodemailer = require('nodemailer');

// --- DIAGNOSTIC: Check if email credentials are loaded ---
console.log('📧 Email Config Check:');
console.log('  EMAIL_USER loaded:', !!process.env.EMAIL_USER, process.env.EMAIL_USER ? `(${process.env.EMAIL_USER.substring(0, 3)}***)` : '(MISSING!)');
console.log('  EMAIL_PASS loaded:', !!process.env.EMAIL_PASS, process.env.EMAIL_PASS ? `(${process.env.EMAIL_PASS.length} chars)` : '(MISSING!)');

// Configure the SMTP transporter with explicit settings (not 'service' shorthand)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,  // Use SSL on port 465
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS  // Requires a Google App Password
    },
    connectionTimeout: 10000,  // 10 seconds to establish connection
    greetingTimeout: 10000,    // 10 seconds for SMTP greeting
    socketTimeout: 15000,      // 15 seconds for socket inactivity
    tls: {
        rejectUnauthorized: false  // Accept self-signed certs on cloud platforms
    }
});

// --- DIAGNOSTIC: Verify SMTP connection on startup ---
transporter.verify()
    .then(() => console.log('✅ SMTP connection verified (port 465 SSL) — Gmail is ready'))
    .catch((err) => {
        console.error('❌ SMTP port 465 FAILED:', err.message);
        console.error('❌ Full error code:', err.code);
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

/**
 * Dispatches a contact form message to the admin inbox.
 * @param {string} name - Sender's name.
 * @param {string} email - Sender's email (used as replyTo).
 * @param {string} subject - Message subject.
 * @param {string} message - Message body.
 * @returns {Promise<any>} A promise that resolves when the email is sent.
 */
const sendContactEmail = async (name, email, subject, message) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        replyTo: email,
        subject: `JGM Contact Form: ${subject}`,
        html: `
            <h3>New Message from JGM Industries Contact Form</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr/>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
        `
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { sendOtpEmail, sendContactEmail };
