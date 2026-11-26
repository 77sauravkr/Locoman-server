const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const { asyncHandler } = require("./errors");

const requireAuth = (config) =>
  asyncHandler(async (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ error: "Session expired, please log in again" });
    }
    // The account may have been deleted or signed out everywhere since the token was issued.
    const user = await User.findById(payload.id).select("username tokenVersion");
    if (!user || (payload.v || 0) !== user.tokenVersion)
      return res.status(401).json({ error: "Session expired, please log in again" });
    req.user = { id: String(user._id), username: user.username };
    next();
  });

module.exports = requireAuth;
