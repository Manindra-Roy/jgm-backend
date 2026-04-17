/**
 * @fileoverview User Authentication & Profile Routes.
 * PRODUCTION MODE: Strict Cross-Domain Cookie Management.
 */

const { User } = require("../models/user");
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { loginSchema, registerSchema, updateUserSchema } = require("../helpers/validator");
const { sendOtpEmail, sendContactEmail } = require("../helpers/mailer");

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: { message: "Too many attempts from this IP, please try again after 15 minutes" }
});

router.post("/register", authLimiter, async (req, res) => {
    const { error } = registerSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    // SECURITY: Prevent duplicate registrations
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) return res.status(400).send("A user with this email already exists.");

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000); 

    let user = new User({
        name: req.body.name,
        email: req.body.email,
        passwordHash: bcrypt.hashSync(req.body.password, 10),
        phone: req.body.phone,
        isAdmin: false, // SECURITY: Never trust client input for admin status. Admins are created only via the Admin Panel.
        otp: otpCode,
        otpExpires: expiryTime
    });

    user = await user.save();
    if (!user) return res.status(400).send("The user cannot be created!");

    try {
        await sendOtpEmail(user.email, otpCode);
        res.status(200).send({ message: "Registration successful. Please check your email for the OTP." });
    } catch (emailError) {
        console.error("❌ Failed to send OTP email:", emailError.message);
        console.error("❌ Full error:", JSON.stringify(emailError, Object.getOwnPropertyNames(emailError)));
        res.status(500).send("Account created but failed to send OTP email. Please try 'Resend OTP' or contact support.");
    }
});

router.post("/verify-email", async (req, res) => {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).send("User not found.");
    if (user.isEmailVerified) return res.status(400).send("Email is already verified.");

    if (user.otp !== otp) return res.status(400).send("Invalid OTP code.");
    if (user.otpExpires < Date.now()) return res.status(400).send("OTP has expired. Please request a new one.");

    user.isEmailVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: "Email verified successfully! You can now log in." });
});

router.post("/login", authLimiter, async (req, res) => {
    const { error } = loginSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const user = await User.findOne({ email: req.body.email });
    const secret = process.env.secret || process.env.SECRET;

    if (!user) return res.status(400).send("The user not found");

    if (!user.isEmailVerified && !user.isAdmin) {
        return res.status(403).send("Please verify your email address before logging in.");
    }

    if (user && bcrypt.compareSync(req.body.password, user.passwordHash)) {
        const token = jwt.sign({ userId: user.id, isAdmin: user.isAdmin }, secret, {
            expiresIn: "1d",
        });

        // CRITICAL: Production Cross-Domain Cookie
        res.cookie('jgm_token', token, {
            httpOnly: true,
            secure: true,        
            sameSite: 'none',    
            maxAge: 30 * 24 * 60 * 60 * 1000 
        });

        res.status(200).send({ message: "Logged in successfully", user: user.email });
    } else {
        res.status(400).send("password is wrong!");
    }
});

router.post("/logout", (req, res) => {
    // CRITICAL: Must match the exact settings used to create the cookie
    res.clearCookie("jgm_token", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
    });
    res.status(200).json({ message: "Logged out successfully" });
});

router.post("/forgot-password", authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).send("Email is required");

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).send("User with this email does not exist.");

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000); 

    user.otp = otpCode;
    user.otpExpires = expiryTime;
    await user.save();

    try {
        await sendOtpEmail(user.email, otpCode);
        res.status(200).send({ message: "Password reset OTP sent to your email." });
    } catch (emailError) {
        console.error("Failed to send OTP email:", emailError);
        res.status(500).send("Failed to send email. Please try again later.");
    }
});

router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) return res.status(400).send("All fields are required.");
    if (newPassword.length < 6) return res.status(400).send("Password must be at least 6 characters long.");

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).send("User not found.");

    if (user.otp !== otp) return res.status(400).send("Invalid OTP code.");
    if (user.otpExpires < Date.now()) return res.status(400).send("OTP has expired. Please request a new one.");

    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: "Password reset successfully! You can now log in." });
});

router.get("/verify-session", (req, res) => {
    res.status(200).json({ success: true, message: "Session is valid" });
});

router.get("/me/profile", async (req, res) => {
    try {
        if (!req.auth || !req.auth.userId) return res.status(401).send("Not authenticated");
        const user = await User.findById(req.auth.userId).select("-passwordHash -otp -otpExpires");
        if (!user) return res.status(404).send("User not found");
        res.status(200).send(user);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    try {
        await sendContactEmail(name, email, subject, message);
        res.status(200).json({ success: true, message: "Message sent successfully!" });
    } catch (error) {
        console.error('Contact Form Error:', error);
        res.status(500).json({ success: false, message: "Failed to send message." });
    }
});

router.get(`/`, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const userList = await User.find().select("-passwordHash").skip(skip).limit(limit);
        const totalCount = await User.countDocuments();

        if (!userList) return res.status(500).json({ success: false });
        res.send({ users: userList, totalCount, page, limit });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/:id", async (req, res) => {
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) return res.status(500).json({ message: "The user with the given ID was not found." });
    res.status(200).send(user);
});

router.post("/", async (req, res) => {
    const { error } = registerSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    let user = new User({
        name: req.body.name,
        email: req.body.email,
        passwordHash: bcrypt.hashSync(req.body.password, 10),
        phone: req.body.phone,
        isAdmin: req.body.isAdmin,
        street: req.body.street,
        apartment: req.body.apartment,
        zip: req.body.zip,
        city: req.body.city,
        country: req.body.country,
        isEmailVerified: true 
    });
    
    user = await user.save();
    if (!user) return res.status(400).send("The user cannot be created!");
    res.send(user);
});

router.put("/:id", async (req, res) => {
    const { error } = updateUserSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const userExist = await User.findById(req.params.id);
    if (!userExist) return res.status(400).send("Invalid User");

    let newPassword = req.body.password ? bcrypt.hashSync(req.body.password, 10) : userExist.passwordHash;

    const user = await User.findByIdAndUpdate(
        req.params.id,
        {
            name: req.body.name,
            email: req.body.email,
            passwordHash: newPassword,
            phone: req.body.phone,
            isAdmin: req.body.isAdmin,
            street: req.body.street,
            apartment: req.body.apartment,
            zip: req.body.zip,
            city: req.body.city,
            country: req.body.country,
        },
        { returnDocument: "after" }
    );

    if (!user) return res.status(400).send("the user cannot be updated!");
    res.send(user);
});

router.delete("/:id", (req, res) => {
    User.findByIdAndDelete(req.params.id)
        .then((user) => {
            if (user) return res.status(200).json({ success: true, message: "the user is deleted!" });
            else return res.status(404).json({ success: false, message: "user not found!" });
        })
        .catch((err) => res.status(500).json({ success: false, error: err }));
});

router.get(`/get/count`, async (req, res) => {
    try {
        const userCount = await User.countDocuments();
        res.status(200).send({ userCount: userCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
