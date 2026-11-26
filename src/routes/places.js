const express = require("express");
const { limiter } = require("../middleware/limits");
const { HttpError, asyncHandler } = require("../middleware/errors");

module.exports = ({ places }) => {
  const router = express.Router();
  const limit = limiter({ windowMs: 60 * 1000, limit: 30, keyGenerator: (req) => req.user.id });

  const lookup = (name, missing) =>
    asyncHandler(async (req, res) => {
      const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
      if (!query) throw new HttpError(400, "Missing place name");
      const result = await places[name](query).catch((err) => {
        console.error(`${name} lookup failed:`, err.message);
        throw new HttpError(502, "That information is not available right now.");
      });
      if (!result) throw new HttpError(404, missing);
      res.json(result);
    });

  router.get("/weather", limit, lookup("weather", "Weather not found for this place"));
  router.get("/locate", limit, lookup("locate", "Place not found"));
  router.get(
    "/rates",
    limit,
    asyncHandler(async (req, res) => {
      const base = String(req.query.base || "").toUpperCase();
      if (!/^[A-Z]{3}$/.test(base)) throw new HttpError(400, "Unknown currency");
      const result = await places.rates(base).catch((err) => {
        console.error("rates lookup failed:", err.message);
        throw new HttpError(502, "Exchange rates are not available right now.");
      });
      if (!result) throw new HttpError(404, "Unknown currency");
      res.json(result);
    }),
  );
  return router;
};
