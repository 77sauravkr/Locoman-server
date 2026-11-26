const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const Chat = require("../../models/Chat");
const Trip = require("../../models/Trip");
const requireAuth = require("../middleware/auth");
const { limiter } = require("../middleware/limits");
const { HttpError, asyncHandler } = require("../middleware/errors");

const WEEK = 7 * 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9._+@-]{3,64}$/;
// Compared against when there is nothing to compare, so timing does not reveal usernames.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);
// No 0/O or 1/I, so the code is easy to copy by hand.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const newRecoveryCode = () =>
  Array.from({ length: 16 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)])
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");
const normalizeCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");

function readCredentials(body) {
  const { username, password } = body || {};
  // Type checks also block MongoDB operator injection such as {"$ne": null}.
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password)
    throw new HttpError(400, "Username and password are required");
  return { username: username.trim(), password };
}

function checkNewPassword(password) {
  // bcrypt only reads the first 72 bytes.
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password) > 72)
    throw new HttpError(400, "Password must be 8-72 characters");
}

const publicUser = (user) => ({
  _id: user._id,
  username: user.username,
  hasPassword: Boolean(user.password),
  hasRecovery: Boolean(user.recoveryHash),
});

async function issueRecoveryCode(user) {
  const code = newRecoveryCode();
  user.recoveryHash = await bcrypt.hash(normalizeCode(code), 10);
  await user.save();
  return code;
}

module.exports = (config, { verifyGoogle }) => {
  const router = express.Router();
  const cookie = { httpOnly: true, sameSite: "lax", secure: config.isProduction, path: "/" };
  const auth = requireAuth(config);

  const startSession = (res, user, extra = {}) => {
    const token = jwt.sign({ id: String(user._id), v: user.tokenVersion }, config.jwtSecret, { expiresIn: "7d" });
    res.cookie("token", token, { ...cookie, maxAge: WEEK });
    res.json({ user: publicUser(user), ...extra });
  };

  const guessLimit = limiter({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.username).toLowerCase().slice(0, 64)}`,
  });
  const registerLimit = limiter({ windowMs: 60 * 60 * 1000, limit: config.registerHourlyLimit });
  const accountLimit = limiter({ windowMs: 15 * 60 * 1000, limit: 20, keyGenerator: (req) => req.user.id });

  // Checks the password again before sensitive account changes.
  const confirmPassword = async (user, password) => {
    if (typeof password !== "string" || !(await bcrypt.compare(password, user.password || DUMMY_HASH)) || !user.password)
      throw new HttpError(403, "Current password is incorrect");
  };

  router.post(
    "/register",
    registerLimit,
    asyncHandler(async (req, res) => {
      const { username, password } = readCredentials(req.body);
      if (!USERNAME.test(username))
        throw new HttpError(400, "Username must be 3-64 characters: letters, numbers or . _ + @ -");
      checkNewPassword(password);
      if (await User.exists({ username })) throw new HttpError(409, "Username already taken");
      let user;
      try {
        user = await User.create({ username, password: await bcrypt.hash(password, 12) });
      } catch (err) {
        if (err.code === 11000) throw new HttpError(409, "Username already taken");
        throw err;
      }
      // Shown once; only its hash is kept.
      const recoveryCode = await issueRecoveryCode(user);
      startSession(res, user, { recoveryCode });
    }),
  );

  router.post(
    "/login",
    guessLimit,
    asyncHandler(async (req, res) => {
      const { username, password } = readCredentials(req.body);
      const user = await User.findOne({ username });
      const match = await bcrypt.compare(password, user?.password || DUMMY_HASH);
      if (!user?.password || !match) throw new HttpError(401, "Invalid username or password");
      startSession(res, user);
    }),
  );

  router.post(
    "/reset",
    guessLimit,
    asyncHandler(async (req, res) => {
      const { username, recoveryCode, newPassword } = req.body || {};
      if (typeof username !== "string" || typeof recoveryCode !== "string")
        throw new HttpError(400, "Username and recovery code are required");
      checkNewPassword(newPassword);
      const user = await User.findOne({ username: username.trim() });
      const match = await bcrypt.compare(normalizeCode(recoveryCode), user?.recoveryHash || DUMMY_HASH);
      if (!user?.recoveryHash || !match) throw new HttpError(401, "Username or recovery code is incorrect");
      user.password = await bcrypt.hash(newPassword, 12);
      user.tokenVersion += 1;
      // A recovery code works once.
      const next = await issueRecoveryCode(user);
      startSession(res, user, { recoveryCode: next });
    }),
  );

  router.post(
    "/google",
    guessLimit,
    asyncHandler(async (req, res) => {
      if (!verifyGoogle) throw new HttpError(404, "Google sign-in is not set up");
      const { credential } = req.body || {};
      if (typeof credential !== "string" || !credential) throw new HttpError(400, "Missing Google credential");
      const identity = await verifyGoogle(credential).catch(() => {
        throw new HttpError(401, "Google sign-in failed");
      });
      let user = await User.findOne({ googleId: identity.sub });
      if (!user) {
        // Never attach to an existing account by name: anyone could have registered that email.
        let username = identity.email.slice(0, 64);
        if (await User.exists({ username })) username = `${username.slice(0, 55)}-g${crypto.randomBytes(3).toString("hex")}`;
        user = await User.create({ username, googleId: identity.sub });
      }
      startSession(res, user);
    }),
  );

  router.post("/logout", (req, res) => {
    res.clearCookie("token", cookie);
    res.json({ success: true });
  });

  router.get(
    "/me",
    auth,
    asyncHandler(async (req, res) => {
      res.json({ user: publicUser(await User.findById(req.user.id)) });
    }),
  );

  router.post(
    "/password",
    auth,
    accountLimit,
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user.id);
      await confirmPassword(user, req.body?.currentPassword);
      checkNewPassword(req.body?.newPassword);
      user.password = await bcrypt.hash(req.body.newPassword, 12);
      user.tokenVersion += 1;
      await user.save();
      startSession(res, user);
    }),
  );

  router.post(
    "/recovery-code",
    auth,
    accountLimit,
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user.id);
      await confirmPassword(user, req.body?.password);
      res.json({ recoveryCode: await issueRecoveryCode(user) });
    }),
  );

  router.delete(
    "/account",
    auth,
    accountLimit,
    asyncHandler(async (req, res) => {
      const user = await User.findById(req.user.id);
      if (user.password) await confirmPassword(user, req.body?.password);
      else if (req.body?.confirm !== user.username) throw new HttpError(403, "Type your username to confirm");
      const id = String(user._id);
      await Promise.all([
        Chat.deleteMany({ user: id }),
        Trip.deleteMany({ owner: id }),
        Trip.updateMany({ "members.user": id }, { $pull: { members: { user: id } } }),
      ]);
      await user.deleteOne();
      res.clearCookie("token", cookie);
      res.json({ success: true });
    }),
  );

  return router;
};
