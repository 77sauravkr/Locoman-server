const mongoose = require("mongoose");

const connectDb = (uri) => mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
const disconnectDb = () => mongoose.disconnect();

module.exports = { connectDb, disconnectDb };
