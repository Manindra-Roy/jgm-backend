const { User } = require("../models/user");
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

// Define the limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per window
    message: {
        message:
            "Too many attempts from this IP, please try again after 15 minutes",
    },
});

router.get(`/`, async (req, res) => {
    const userList = await User.find().select("-passwordHash");

    if (!userList) {
        res.status(500).json({ success: false });
    }
    res.send(userList);
});

// --- FIX: MUST BE ABOVE THE /:id ROUTE ---
// GET: Verify Active Admin Session
router.get("/verify-session", (req, res) => {
    // Because authJwt() protects the whole API, if a request makes it to this route,
    // it guarantees the user has a valid, unexpired HttpOnly cookie.
    res.status(200).json({ success: true, message: "Session is valid" });
});
// -----------------------------------------

router.get("/:id", async (req, res) => {
    const user = await User.findById(req.params.id).select("-passwordHash");

    if (!user) {
        res
            .status(500)
            .json({ message: "The user with the given ID was not found." });
    }
    res.status(200).send(user);
});

// GET: Verify Active Admin Session
router.get("/verify-session", (req, res) => {
    // Because authJwt() protects the whole API, if a request makes it to this route,
    // it guarantees the user has a valid, unexpired HttpOnly cookie.
    res.status(200).json({ success: true, message: "Session is valid" });
});

router.post("/", async (req, res) => {
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
    });
    user = await user.save();

    if (!user) return res.status(400).send("the user cannot be created!");

    res.send(user);
});

router.put("/:id", async (req, res) => {
    const userExist = await User.findById(req.params.id);
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
        // { new: true}
        { returnDocument: "after" },
    );

    if (!user) return res.status(400).send("the user cannot be created!");

    res.send(user);
});

router.post("/login", authLimiter, async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    const secret = process.env.secret;

    if (!user) return res.status(400).send("The user not found");

    if (user && bcrypt.compareSync(req.body.password, user.passwordHash)) {
        const token = jwt.sign({ userId: user.id, isAdmin: user.isAdmin }, secret, {
            expiresIn: "1d",
        });

        // Attach token as an HttpOnly cookie
        res.cookie("jgm_token", token, {
            httpOnly: true,
            secure: false, // Keep false for localhost HTTP
            sameSite: "lax", // Changed from strict to lax for different localhost ports
            maxAge: 24 * 60 * 60 * 1000, // 1 Day
        });

        res
            .status(200)
            .send({ message: "Logged in successfully", user: user.email });
    } else {
        res.status(400).send("password is wrong!");
    }
});

// NEW: Logout Route
router.post("/logout", (req, res) => {
    // Must match the exact settings we used to create the cookie
    res.clearCookie("jgm_token", {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
    });
    res.status(200).json({ message: "Logged out successfully" });
});

router.post("/register", authLimiter, async (req, res) => {
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
    });
    user = await user.save();

    if (!user) return res.status(400).send("the user cannot be created!");

    res.send(user);
});

router.delete("/:id", (req, res) => {
    User.findByIdAndDelete(req.params.id)
        .then((user) => {
            if (user) {
                return res
                    .status(200)
                    .json({ success: true, message: "the user is deleted!" });
            } else {
                return res
                    .status(404)
                    .json({ success: false, message: "user not found!" });
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
