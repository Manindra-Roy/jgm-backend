/**
 * @fileoverview Email Service Helper.
 * Uses Brevo (Sendinblue) SMTP relay for production (Railway blocks Gmail SMTP ports).
 * Falls back to Gmail SMTP for local development.
 */

const nodemailer = require('nodemailer');

const isProduction = process.env.NODE_ENV === 'production';

// --- DIAGNOSTIC: Check email config ---
console.log('📧 Email Config:');
console.log('  Environment:', isProduction ? 'PRODUCTION (Brevo SMTP)' : 'LOCAL (Gmail SMTP)');
console.log('  EMAIL_USER loaded:', !!process.env.EMAIL_USER);
console.log('  EMAIL_PASS loaded:', !!process.env.EMAIL_PASS);
if (isProduction) {
    console.log('  BREVO_USER loaded:', !!process.env.BREVO_USER);
    console.log('  BREVO_PASS loaded:', !!process.env.BREVO_PASS);
}

// --- TRANSPORTER CONFIG ---
// Production: Brevo SMTP on port 587 (Railway blocks Gmail SMTP ports 465/587)
// Local Dev:  Gmail SMTP directly
const transportConfig = isProduction
    ? {
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.BREVO_USER,  // Your Brevo login email
            pass: process.env.BREVO_PASS   // Your Brevo SMTP key
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    }
    : {
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    };

const transporter = nodemailer.createTransport(transportConfig);

// --- DIAGNOSTIC: Verify SMTP connection on startup ---
transporter.verify()
    .then(() => console.log(`✅ SMTP verified — ${isProduction ? 'Brevo' : 'Gmail'} is ready to send emails`))
    .catch((err) => {
        console.error('❌ SMTP verification FAILED:', err.message);
        console.error('❌ Error code:', err.code);
    });

// The "from" address: In production use the verified Brevo sender, locally use Gmail
const getFromAddress = () => {
    return process.env.BREVO_SENDER || process.env.EMAIL_USER;
};

/**
 * Dispatches an HTML-formatted email containing a 6-digit OTP code.
 * @param {string} userEmail - The recipient's email address.
 * @param {string} otpCode - The 6-digit security code.
 * @returns {Promise<any>} A promise that resolves when the email is sent.
 */
const sendOtpEmail = async (userEmail, otpCode) => {
    const mailOptions = {
        from: `"JGM Industries" <${getFromAddress()}>`,
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
        from: getFromAddress(),
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
