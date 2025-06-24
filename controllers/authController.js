const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";

/**
 * Register a new user
 */
exports.register = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });

    // Check if user already exists
    const existing = await User.findOne({ username });
    if (existing)
      return res.status(409).json({ error: "Username already taken" });

    // Hash password and save user
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hash });

    // Create JWT and set cookie
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ user: { username: user.username, _id: user._id } });
  } catch (err) {
    res.status(500).json({ error: "Registration failed", details: err.message });
  }
};

/**
 * Login user
 */
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "Username and password required" });

    const user = await User.findOne({ username });
    if (!user)
      return res.status(401).json({ error: "Invalid username or password" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ error: "Invalid username or password" });

    // Create JWT and set cookie
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ user: { username: user.username, _id: user._id } });
  } catch (err) {
    res.status(500).json({ error: "Login failed", details: err.message });
  }
};

/**
 * Logout user (clear cookie)
 */
exports.logout = (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
};

/**
 * Get current user info (requires auth middleware)
 */
exports.me = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("username _id");
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user", details: err.message });
  }
};