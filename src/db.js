const mongoose = require("mongoose");

let pending = null;

// Serverless hosts can pause the process mid-connect, so every request waits for the
// connection and a failed attempt is retried by the next one.
function connectDb(uri) {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  pending ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 }).finally(() => {
    pending = null;
  });
  return pending;
}

const disconnectDb = () => mongoose.disconnect();

module.exports = { connectDb, disconnectDb };
