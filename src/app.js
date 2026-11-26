const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chats");
const requireAuth = require("./middleware/auth");
const { errorHandler, asyncHandler } = require("./middleware/errors");

function createApp({ config, ai, ready = async () => {} }) {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.use(helmet());
  // The web client calls the API same-origin through a proxy; CORS is only for other listed origins.
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  app.get("/", (req, res) => res.send("Server is live!"));
  app.get("/api/health", async (req, res) => {
    const db = await ready().then(
      () => mongoose.connection.readyState === 1,
      (err) => {
        console.error("MongoDB connection failed:", err.message);
        return false;
      },
    );
    res.status(db ? 200 : 503).json({ ok: db });
  });

  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    asyncHandler(async (req, res, next) => {
      await ready();
      next();
    }),
  );
  app.use("/api/auth", authRoutes(config));
  app.use("/api/chats", requireAuth(config), chatRoutes({ config, ai }));

  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
