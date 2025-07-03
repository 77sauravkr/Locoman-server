const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const bcrypt = require('bcrypt');


dotenv.config();

const app = express();
app.use(express.json());
app.use(cookieParser());

const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",");

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow exact match
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow wildcard for Vercel preview URLs
    if (
      allowedOrigins.some(o =>
        o.includes("*") &&
        origin.endsWith(o.replace("*", ""))
      )
    ) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));
app.use("/uploads", express.static("uploads"));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI);

// Import and use routes
app.use("/", require("./routes/authRoutes"));
app.use("/", require("./routes/chatRoutes"));
app.use("/", require("./routes/audioRoutes"));

app.get("/", (req, res) => {
  res.send("Server is live!");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;