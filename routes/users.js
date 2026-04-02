const { User } = require("../models/user");
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { loginSchema, registerSchema, updateUserSchema } = require("../helpers/validator");
const { sendOtpEmail } = require("../helpers/mailer");

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: { message: "Too many attempts from this IP, please try again after 15 minutes" }
});

router.get(`/`, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const userList = await User.find()
            .select("-passwordHash")
            .skip(skip)
            .limit(limit);

        if (!userList) {
            return res.status(500).json({ success: false });
        }
        res.send(userList);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get("/verify-session", (req, res) => {
    res.status(200).json({ success: true, message: "Session is valid" });
});

router.get("/:id", async (req, res) => {
    const user = await User.findById(req.params.id).select("-passwordHash");
    if (!user) {
        res.status(500).json({ message: "The user with the given ID was not found." });
    }
    res.status(200).send(user);
});

// Admin Route: Create User directly
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
        // THE FIX: Automatically verify users created by the Admin
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

    let newPassword;
    if (req.body.password) {
        newPassword = bcrypt.hashSync(req.body.password, 10);
    } else {
        newPassword = userExist.passwordHash;
    }

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

        res.cookie("jgm_token", token, {
            httpOnly: true,
            secure: false, 
            sameSite: "lax", 
            maxAge: 24 * 60 * 60 * 1000, 
        });

        res.status(200).send({ message: "Logged in successfully", user: user.email });
    } else {
        res.status(400).send("password is wrong!");
    }
});

router.post("/logout", (req, res) => {
    res.clearCookie("jgm_token", {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
    });
    res.status(200).json({ message: "Logged out successfully" });
});

router.post("/register", authLimiter, async (req, res) => {
    const { error } = registerSchema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    // Generate a 6-digit OTP and expiration time (10 mins from now)
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

    // Send the email asynchronously 
    try {
        await sendOtpEmail(user.email, otpCode);
    } catch (emailError) {
        console.error("Failed to send OTP email:", emailError);
        // We still return 200 because the user was created, but log the error
    }

    res.status(200).send({ message: "Registration successful. Please check your email for the OTP." });
});

router.post("/verify-email", async (req, res) => {
    const { email, otp } = req.body;

    const user = await User.findOne({ email: email });
    if (!user) return res.status(400).send("User not found.");

    if (user.isEmailVerified) return res.status(400).send("Email is already verified.");

    // Check if OTP matches and is not expired
    if (user.otp !== otp) {
        return res.status(400).send("Invalid OTP code.");
    }
    if (user.otpExpires < Date.now()) {
        return res.status(400).send("OTP has expired. Please request a new one.");
    }

    // Success! Verify the user and clear the OTP fields
    user.isEmailVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).send({ message: "Email verified successfully! You can now log in." });
});

router.delete("/:id", (req, res) => {
    User.findByIdAndDelete(req.params.id)
        .then((user) => {
            if (user) {
                return res.status(200).json({ success: true, message: "the user is deleted!" });
            } else {
                return res.status(404).json({ success: false, message: "user not found!" });
            }
        })
        .catch((err) => {
            return res.status(500).json({ success: false, error: err });
        });
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
