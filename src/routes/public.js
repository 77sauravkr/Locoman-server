const express = require("express");
const Trip = require("../../models/Trip");
const { limiter } = require("../middleware/limits");
const { HttpError, asyncHandler } = require("../middleware/errors");

const router = express.Router();

// No login. Only the plan is returned: no names, expenses, comments or packing.
router.get(
  "/trips/:token",
  limiter({ windowMs: 60 * 1000, limit: 60 }),
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const trip = /^[A-Za-z0-9_-]{20,64}$/.test(token) && (await Trip.findOne({ publicToken: token }));
    if (!trip) throw new HttpError(404, "This page is not available");
    res.json({
      trip: {
        title: trip.title,
        destination: trip.destination || "",
        startDate: trip.startDate || "",
        days: trip.days.map((d) => ({
          title: d.title,
          items: d.items.map(({ time, name, notes, lat, lng }) => ({ time, name, notes, lat, lng })),
        })),
      },
    });
  }),
);

module.exports = router;
