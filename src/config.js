function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function loadConfig(env = process.env) {
  const missing = ["MONGODB_URI", "JWT_SECRET", "GEMINI_API_KEY"].filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  if (env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

  return {
    port: int(env.PORT, 10000),
    isProduction: env.NODE_ENV === "production",
    mongoUri: env.MONGODB_URI,
    jwtSecret: env.JWT_SECRET,
    geminiApiKey: env.GEMINI_API_KEY.trim(),
    geminiBaseUrl: env.GEMINI_BASE_URL,
    model: env.GEMINI_MODEL || "gemini-3.8-flash",
    fallbackModel: env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite",
    modelTimeoutMs: int(env.GEMINI_TIMEOUT_MS, 20_000),
    corsOrigins: (env.CORS_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean),
    trustProxy: int(env.TRUST_PROXY, 1),
    userDailyLimit: int(env.USER_DAILY_LIMIT, 50),
    globalDailyLimit: int(env.GLOBAL_DAILY_LIMIT, 500),
  };
}

module.exports = { loadConfig };
