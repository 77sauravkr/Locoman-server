const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const requireAuth = require("../middleware/auth");
const { limiter } = require("../middleware/limits");
const { HttpError, asyncHandler } = require("../middleware/errors");

const WEEK = 7 * 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9._+@-]{3,64}$/;
// Compared against when the user does not exist, so response time does not reveal usernames.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

function readCredentials(body) {
  const { username, password } = body || {};
  // Type checks also block MongoDB operator injection such as {"$ne": null}.
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password)
    throw new HttpError(400, "Username and password are required");
  return { username: username.trim(), password };
}

module.exports = (config) => {
  const router = express.Router();
  const cookie = { httpOnly: true, sameSite: "lax", secure: config.isProduction, path: "/" };

  const startSession = (res, user) => {
    const token = jwt.sign({ id: String(user._id), username: user.username }, config.jwtSecret, {
      expiresIn: "7d",
    });
    res.cookie("token", token, { ...cookie, maxAge: WEEK });
    res.json({ user: { _id: user._id, username: user.username } });
  };

  const loginLimit = limiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.username).toLowerCase().slice(0, 64)}`,
  });
  const registerLimit = limiter({ windowMs: 60 * 60 * 1000, limit: 20 });

  router.post(
    "/register",
    registerLimit,
    asyncHandler(async (req, res) => {
      const { username, password } = readCredentials(req.body);
      if (!USERNAME.test(username))
        throw new HttpError(400, "Username must be 3-64 characters: letters, numbers or . _ + @ -");
      // bcrypt only reads the first 72 bytes.
      if (password.length < 8 || Buffer.byteLength(password) > 72)
        throw new HttpError(400, "Password must be 8-72 characters");
      if (await User.exists({ username })) throw new HttpError(409, "Username already taken");
      try {
        startSession(res, await User.create({ username, password: await bcrypt.hash(password, 12) }));
      } catch (err) {
        if (err.code === 11000) throw new HttpError(409, "Username already taken");
        throw err;
      }
    }),
  );

  router.post(
    "/login",
    loginLimit,
    asyncHandler(async (req, res) => {
      const { username, password } = readCredentials(req.body);
      const user = await User.findOne({ username });
      const match = await bcrypt.compare(password, user?.password || DUMMY_HASH);
      if (!user || !match) throw new HttpError(401, "Invalid username or password");
      startSession(res, user);
    }),
  );

  router.post("/logout", (req, res) => {
    res.clearCookie("token", cookie);
    res.json({ success: true });
  });

  router.get(
    "/me",
    requireAuth(config),
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user.id).select("username");
      if (!user) throw new HttpError(401, "Not authenticated");
      res.json({ user });
    }),
  );

  return router;
};
