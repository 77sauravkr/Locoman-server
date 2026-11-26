class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express 4 does not forward rejected promises on its own.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Never send internal error details to the client.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Recording is too large" });
  if (err.name === "MulterError") return res.status(400).json({ error: "Invalid upload" });
  const status = err instanceof HttpError ? err.status : err.type ? err.status : 500;
  if (!(err instanceof HttpError) && (status >= 500 || !status)) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
  res.status(status).json({ error: err instanceof HttpError ? err.message : "Invalid request" });
}

module.exports = { HttpError, asyncHandler, errorHandler };
