const nodemailer = require('nodemailer');

// Configure the email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail', // You can use 'gmail', 'sendgrid', 'mailgun', etc.
    auth: {
        user: process.env.EMAIL_USER, // e.g., your-store@gmail.com
        pass: process.env.EMAIL_PASS  // e.g., your Gmail App Password
    }
});

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