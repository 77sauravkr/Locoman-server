const mongoose = require("mongoose");

const usageSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  createdAt: { type: Date, expires: "2d" },
});

module.exports = mongoose.model("Usage", usageSchema);
