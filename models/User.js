const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true },
    // Absent for accounts created with Google.
    password: String,
    recoveryHash: String,
    googleId: { type: String, index: { unique: true, sparse: true } },
    // Raising this signs the user out everywhere.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
