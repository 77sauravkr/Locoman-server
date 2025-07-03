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
app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5182",
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