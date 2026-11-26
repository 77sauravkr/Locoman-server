const jwt = require("jsonwebtoken");

const requireAuth = (config) => (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please log in again" });
  }
};

module.exports = requireAuth;
