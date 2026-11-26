const rateLimit = require("express-rate-limit");
const Usage = require("../../models/Usage");
const { HttpError, asyncHandler } = require("./errors");

const limiter = (options) =>
  rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a bit and try again." },
    ...options,
  });

// Counts are stored in MongoDB so a restart does not reset the spending cap.
async function consume(key, limit) {
  const usage = await Usage.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, new: true },
  );
  return usage.count <= limit;
}

const dailyQuota = (config) =>
  asyncHandler(async (req, res, next) => {
    const day = new Date().toISOString().slice(0, 10);
    if (!(await consume(`user:${req.user.id}:${day}`, config.userDailyLimit)))
      throw new HttpError(429, "You have reached today's message limit. Try again tomorrow.");
    if (!(await consume(`global:${day}`, config.globalDailyLimit)))
      throw new HttpError(429, "LocoMan is very busy today. Please try again tomorrow.");
    next();
  });

module.exports = { limiter, dailyQuota };
