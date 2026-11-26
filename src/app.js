const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chats");
const tripRoutes = require("./routes/trips");
const placeRoutes = require("./routes/places");
const publicRoutes = require("./routes/public");
const requireAuth = require("./middleware/auth");
const { errorHandler, asyncHandler } = require("./middleware/errors");

function createApp({ config, ai, places, verifyGoogle = null, ready = async () => {} }) {
  const app = express();
  app.set("trust proxy", config.trustProxy);
  app.use(helmet());
  // The web client calls the API same-origin through a proxy; CORS is only for other listed origins.
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: true }));
  // The message route parses its own, larger body (photos) after the login check.
  const smallJson = express.json({ limit: "32kb" });
  const tripJson = express.json({ limit: "512kb" }); // a long itinerary
  app.use((req, res, next) => (/^\/api\/chats\/[^/]+\/messages\/?$/i.test(req.path) ? next() : (/^\/api\/trips\/[a-f0-9]{24}\/?$/i.test(req.path) ? tripJson : smallJson)(req, res, next)));
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
  app.get("/api/config", (req, res) => res.json({ googleClientId: config.googleClientId || null }));
  app.use("/api/public", publicRoutes);
  app.use("/api/auth", authRoutes(config, { verifyGoogle }));
  app.use("/api/trips", requireAuth(config), tripRoutes({ config, ai }));
  app.use("/api/places", requireAuth(config), placeRoutes({ places }));
  app.use("/api/chats", requireAuth(config), chatRoutes({ config, ai }));

  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
