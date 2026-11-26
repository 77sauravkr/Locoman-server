require("dotenv").config();

const { loadConfig } = require("./src/config");
const { createApp } = require("./src/app");
const { connectDb, disconnectDb } = require("./src/db");
const { createAi } = require("./src/services/ai");

const config = loadConfig();
const app = createApp({ config, ai: createAi(config) });

connectDb(config.mongoUri).catch((err) => {
  console.error("MongoDB connection failed:", err.message);
  if (require.main === module) process.exit(1);
});

// Vercel imports the app; Render and Docker run this file directly.
if (require.main === module) {
  const server = app.listen(config.port, () => console.log(`LocoMan API on port ${config.port}`));
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      server.close(() => disconnectDb().finally(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

module.exports = app;
