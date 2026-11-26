const express = require("express");
const multer = require("multer");
const Chat = require("../../models/Chat");
const { limiter, dailyQuota } = require("../middleware/limits");
const { HttpError, asyncHandler } = require("../middleware/errors");

const MAX_TEXT = 4000;
const MAX_CHATS = 100;
const MAX_MESSAGES = 200;
const HISTORY = 20;
const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Upload type -> type name Gemini accepts.
const AUDIO_TYPES = {
  "audio/webm": "audio/webm",
  "video/webm": "audio/webm",
  "audio/mp4": "audio/m4a",
  "audio/x-m4a": "audio/m4a",
  "audio/ogg": "audio/ogg",
  "audio/mpeg": "audio/mp3",
  "audio/wav": "audio/wav",
};
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_CHARS = 2_800_000; // about 2 MB once decoded
const PHOTO_QUESTION = "What is this place or thing, and what should a traveller know about it?";

function readImage(image) {
  if (image === undefined || image === null) return null;
  const { mimeType, data } = image;
  if (!IMAGE_TYPES.has(mimeType) || typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new HttpError(400, "Unsupported image");
  if (data.length > MAX_IMAGE_CHARS) throw new HttpError(413, "Image is too large");
  return { mimeType, data };
}

// Rounded to about 1 km and used for this reply only; never stored.
function readLocation(location) {
  const { lat, lng } = location || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)) };
}

function aiError(err) {
  if (err instanceof HttpError) return err;
  console.error("AI request failed:", err.status || "", err.message);
  if (err.status === 429) return new HttpError(429, "The AI usage limit was reached. Please try again in a few minutes.");
  if (err.status === 503) return new HttpError(503, "The AI is very busy right now. Please try again in a minute.");
  return new HttpError(502, "Could not get a reply. Please try again.");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (req, file, done) =>
    AUDIO_TYPES[file.mimetype] ? done(null, true) : done(new HttpError(415, "Unsupported audio format")),
});

const titleFrom = (text) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
};

const publicMessage = (m) => ({
  id: String(m._id),
  role: m.role,
  text: m.text,
  createdAt: m.createdAt,
  ...(m.image && { hasImage: true }),
});

const toModel = (messages) => {
  const history = messages
    .filter((m) => m.text)
    .slice(-HISTORY)
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text.slice(0, MAX_TEXT * 2),
    }));
  // The conversation sent to the model must start with the user.
  while (history[0]?.role === "assistant") history.shift();
  return history;
};

module.exports = ({ config, ai }) => {
  const router = express.Router();
  const burst = limiter({ windowMs: 60 * 1000, limit: 12, keyGenerator: (req) => req.user.id });
  const quota = dailyQuota(config);

  // Every query is scoped to the logged-in user.
  const mine = (req) => {
    if (!CHAT_ID.test(req.params.chatId)) throw new HttpError(400, "Invalid chat id");
    return { user: req.user.id, chatId: req.params.chatId };
  };

  // A chat is created by its first message, so empty chats are never stored.
  const checkRoom = asyncHandler(async (req, res, next) => {
    const chat = await Chat.findOne(mine(req)).select("messages._id");
    if (chat && chat.messages.length >= MAX_MESSAGES)
      throw new HttpError(409, "This chat is full. Please start a new one.");
    if (!chat && (await Chat.countDocuments({ user: req.user.id })) >= MAX_CHATS)
      throw new HttpError(409, "Chat limit reached. Delete an old chat first.");
    next();
  });

  const saveExchange = async (filter, question, answer, image = false) => {
    const chat = (await Chat.findOne(filter)) || new Chat({ ...filter, messages: [] });
    if (!chat.title || chat.title === "New Chat") chat.title = titleFrom(question);
    // Photos are not stored, only the fact that one was sent.
    chat.messages.push({ role: "user", text: question, ...(image && { image: true }) }, { role: "bot", text: answer });
    await chat.save();
    return { title: chat.title, messages: chat.messages.slice(-2).map(publicMessage) };
  };

  const historyFor = async (filter, question, image) => {
    const chat = await Chat.findOne(filter);
    const history = toModel([...(chat?.messages || []), { role: "user", text: question }]);
    if (image) history[history.length - 1].image = image;
    return history;
  };

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const chats = await Chat.find({ user: req.user.id }).sort({ updatedAt: -1, _id: -1 }).select("chatId title");
      res.json({ chats: chats.map((c) => ({ chatId: c.chatId, title: c.title || "New Chat" })) });
    }),
  );

  router.get(
    "/:chatId",
    asyncHandler(async (req, res) => {
      const chat = await Chat.findOne(mine(req));
      if (!chat) throw new HttpError(404, "Chat not found");
      res.json({ messages: chat.messages.map(publicMessage) });
    }),
  );

  router.patch(
    "/:chatId",
    asyncHandler(async (req, res) => {
      const title = typeof req.body?.title === "string" ? titleFrom(req.body.title) : "";
      if (!title) throw new HttpError(400, "Title is required");
      const chat = await Chat.findOneAndUpdate(mine(req), { $set: { title } });
      if (!chat) throw new HttpError(404, "Chat not found");
      res.json({ title });
    }),
  );

  router.delete(
    "/:chatId",
    asyncHandler(async (req, res) => {
      const { deletedCount } = await Chat.deleteOne(mine(req));
      if (!deletedCount) throw new HttpError(404, "Chat not found");
      res.json({ success: true });
    }),
  );

  // Streams the reply as Server-Sent Events: {delta}, then {done} or {error}.
  router.post(
    "/:chatId/messages",
    burst,
    express.json({ limit: "3mb" }),
    asyncHandler(async (req, res, next) => {
      const image = readImage(req.body?.image);
      const text = (typeof req.body?.text === "string" ? req.body.text.trim() : "") || (image ? PHOTO_QUESTION : "");
      if (!text) throw new HttpError(400, "Message is empty");
      if (text.length > MAX_TEXT) throw new HttpError(400, `Message is too long (max ${MAX_TEXT} characters)`);
      req.input = { text, image, location: readLocation(req.body?.location) };
      next();
    }),
    checkRoom,
    quota,
    asyncHandler(async (req, res) => {
      const filter = mine(req);
      const { text, image, location } = req.input;
      const history = await historyFor(filter, text, image);
      const abort = new AbortController();
      res.on("close", () => abort.abort());

      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const send = (data) => res.writableEnded || res.destroyed || res.write(`data: ${JSON.stringify(data)}\n\n`);

      let answer = "";
      try {
        for await (const delta of ai.streamReply(history, { signal: abort.signal, location })) {
          answer += delta;
          send({ delta });
        }
        if (!answer) throw new Error("Empty reply from model");
      } catch (err) {
        if (!abort.signal.aborted) {
          send({ error: aiError(err).message });
          return res.end();
        }
      }
      // If the user pressed Stop, keep what was already generated.
      if (answer) {
        try {
          send({ done: true, ...(await saveExchange(filter, text, answer, Boolean(image))) });
        } catch (err) {
          console.error("Saving chat failed:", err.message);
          send({ error: "Reply could not be saved." });
        }
      }
      res.end();
    }),
  );

  router.post(
    "/:chatId/voice",
    burst,
    checkRoom,
    upload.single("audio"),
    asyncHandler(async (req, res, next) => {
      if (!req.file?.size) throw new HttpError(400, "No audio received");
      next();
    }),
    quota,
    asyncHandler(async (req, res) => {
      const filter = mine(req);
      const { buffer, mimetype } = req.file;
      let question;
      let answer = "";
      try {
        question = (await ai.transcribe(buffer, AUDIO_TYPES[mimetype])).slice(0, MAX_TEXT);
        if (!question) throw new HttpError(422, "Could not hear anything. Please try again.");
        for await (const delta of ai.streamReply(await historyFor(filter, question))) answer += delta;
        if (!answer) throw new Error("Empty reply from model");
      } catch (err) {
        // 4xx messages are safe to show; anything from the AI service is reworded.
        throw aiError(err);
      }
      // The browser reads the reply aloud.
      res.json(await saveExchange(filter, question, answer));
    }),
  );

  return router;
};
