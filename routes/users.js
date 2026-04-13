/**
 * @fileoverview User Authentication & Profile Routes.
 * Handles JWT-based login/logout, OTP email verification, password resets, 
 * Contact Form emails, and Admin user management.
 */

const { User } = require("../models/user");
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { loginSchema, registerSchema, updateUserSchema } = require("../helpers/validator");
const { sendOtpEmail } = require("../helpers/mailer");
const nodemailer = require('nodemailer');

// --- SECURITY: RATE LIMITING ---
// Prevents brute-force attacks on authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { message: "Too many attempts from this IP, please try again after 15 minutes" }
});

/* =========================================================
   1. AUTHENTICATION & REGISTRATION
========================================================= */

/**
 * @route   POST /api/v1/users/register
 * @desc    Registers a new user and sends a 6-digit OTP to their email.
 * @access  Public
 */
router.post("/register", authLimiter, async (req, res) => {
    const { error } = registerSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    // Generate a 6-digit OTP valid for 10 minutes
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryTime = new Date(Date.now() + 10 * 60 * 1000); 

    let user = new User({
        name: req.body.name,
        email: req.body.email,
        passwordHash: bcrypt.hashSync(req.body.password, 10),
        phone: req.body.phone,
        isAdmin: req.body.isAdmin || false,
        otp: otpCode,
        otpExpires: expiryTime
    });

    user = await user.save();
    if (!user) return res.status(400).send("The user cannot be created!");

    // Dispatch OTP email asynchronously
    try {
        await sendOtpEmail(user.email, otpCode);
    } catch (emailError) {
        console.error("Failed to send OTP email:", emailError);
    }

    res.status(200).send({ message: "Registration successful. Please check your email for the OTP." });
});

/**
 * @route   POST /api/v1/users/verify-email
 * @desc    Verifies a user's account using the emailed OTP.
 * @access  Public
 */
router.post("/verify-email", async (req, res) => {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).send("User not found.");
    if (user.isEmailVerified) return res.status(400).send("Email is already verified.");

    if (user.otp !== otp) return res.status(400).send("Invalid OTP code.");
    if (user.otpExpires < Date.now()) return res.status(400).send("OTP has expired. Please request a new one.");

    // Verification successful
    user.isEmailVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: "Email verified successfully! You can now log in." });
});

/**
 * @route   POST /api/v1/users/login
 * @desc    Authenticates a user and issues an HTTP-Only JWT Cookie.
 * @access  Public
 */
router.post("/login", authLimiter, async (req, res) => {
    const { error } = loginSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    const user = await User.findOne({ email: req.body.email });
    const secret = process.env.secret;

    if (!user) return res.status(400).send("The user not found");

    if (!user.isEmailVerified && !user.isAdmin) {
        return res.status(403).send("Please verify your email address before logging in.");
    }

    if (user && bcrypt.compareSync(req.body.password, user.passwordHash)) {
        const token = jwt.sign({ userId: user.id, isAdmin: user.isAdmin }, secret, {
            expiresIn: "1d",
        });

        // Set secure HTTP-Only cookie
        // res.cookie("jgm_token", token, {
        //     httpOnly: true,
        //     secure: process.env.NODE_ENV === 'production', // True in production, False on localhost
        //     sameSite: "lax", 
        //     maxAge: 24 * 60 * 60 * 1000, 
        // });

        // Inside your login route (and register route if you log them in automatically)
        res.cookie('jgm_token', token, {
            httpOnly: true,
            secure: true,        // CRITICAL: Must be true for cross-domain cookies
            sameSite: 'none',    // CRITICAL: Allows Vercel to talk to Render
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 Days
        });

        res.status(200).send({ message: "Logged in successfully", user: user.email });
    } else {
        res.status(400).send("password is wrong!");
    }
});

/**
 * @route   POST /api/v1/users/logout
 * @desc    Clears the JWT auth cookie.
 * @access  Public
 */
router.post("/logout", (req, res) => {
    res.clearCookie("jgm_token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: "lax",
    });
    res.status(200).json({ message: "Logged out successfully" });
});

/* =========================================================
   2. PASSWORD RECOVERY
========================================================= */

/**
 * @route   POST /api/v1/users/forgot-password
 * @desc    Generates an OTP and emails it to the user for password recovery.
 * @access  Public
 */
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

/**
 * @route   POST /api/v1/users/reset-password
 * @desc    Verifies OTP and updates the user's password.
 * @access  Public
 */
router.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) return res.status(400).send("All fields are required.");

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).send("User not found.");

    if (user.otp !== otp) return res.status(400).send("Invalid OTP code.");
    if (user.otpExpires < Date.now()) return res.status(400).send("OTP has expired. Please request a new one.");

    // Apply new password
    user.passwordHash = bcrypt.hashSync(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: "Password reset successfully! You can now log in." });
});

/* =========================================================
   3. USER PROFILE & COMMUNICATIONS
========================================================= */

/**
 * @route   GET /api/v1/users/verify-session
 * @desc    Checks if the user's current HTTP cookie session is valid.
 * @access  Authenticated User
 */
router.get("/verify-session", (req, res) => {
    res.status(200).json({ success: true, message: "Session is valid" });
});

/**
 * @route   GET /api/v1/users/me/profile
 * @desc    Fetches the profile data of the currently logged-in user.
 * @access  Authenticated User
 */
router.get("/me/profile", async (req, res) => {
    try {
        if (!req.auth || !req.auth.userId) return res.status(401).send("Not authenticated");
        
        // Hide sensitive fields
        const user = await User.findById(req.auth.userId).select("-passwordHash -otp -otpExpires");
        if (!user) return res.status(404).send("User not found");
        
        res.status(200).send(user);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   POST /api/v1/users/contact
 * @desc    Processes the "Contact Us" form and forwards it to the Admin email via Nodemailer.
 * @access  Public
 */
router.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS 
            }
        });

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

        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true, message: "Message sent successfully!" });
    } catch (error) {
        console.error('Contact Form Error:', error);
        res.status(500).json({ success: false, message: "Failed to send message." });
    }
});

/* =========================================================
   4. ADMIN DASHBOARD OPERATIONS
========================================================= */

/**
 * @route   GET /api/v1/users/
 * @desc    Get a paginated list of all registered users.
 * @access  Admin
 */
router.get(`/`, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const userList = await User.find().select("-passwordHash").skip(skip).limit(limit);

        if (!userList) return res.status(500).json({ success: false });
        res.send(userList);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get a specific user by ID.
 * @access  Admin
 */
router.get("/:id", async (req, res) => {
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) return res.status(500).json({ message: "The user with the given ID was not found." });
    res.status(200).send(user);
});

/**
 * @route   POST /api/v1/users/
 * @desc    Admin manually creates a user (bypasses email verification).
 * @access  Admin
 */
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
        isEmailVerified: true // Auto-verify admin creations
    });
    
    user = await user.save();
    if (!user) return res.status(400).send("The user cannot be created!");
    res.send(user);
});

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Admin updates a user's details or overrides their password.
 * @access  Admin
 */
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

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Deletes a user account.
 * @access  Admin
 */
router.delete("/:id", (req, res) => {
    User.findByIdAndDelete(req.params.id)
        .then((user) => {
            if (user) return res.status(200).json({ success: true, message: "the user is deleted!" });
            else return res.status(404).json({ success: false, message: "user not found!" });
        })
        .catch((err) => res.status(500).json({ success: false, error: err }));
});

/**
 * @route   GET /api/v1/users/get/count
 * @desc    Gets the total number of registered users.
 * @access  Admin
 */
router.get(`/get/count`, async (req, res) => {
    try {
        const userCount = await User.countDocuments();
        res.status(200).send({ userCount: userCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
