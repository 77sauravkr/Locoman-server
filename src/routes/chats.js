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
const AUDIO_TYPES = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

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

const publicMessage = (m) => ({ id: String(m._id), role: m.role, text: m.text, createdAt: m.createdAt });

const toModel = (messages) =>
  messages
    .filter((m) => m.text)
    .slice(-HISTORY)
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text.slice(0, MAX_TEXT * 2),
    }));

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

  const saveExchange = async (filter, question, answer) => {
    const chat = (await Chat.findOne(filter)) || new Chat({ ...filter, messages: [] });
    if (!chat.title || chat.title === "New Chat") chat.title = titleFrom(question);
    chat.messages.push({ role: "user", text: question }, { role: "bot", text: answer });
    await chat.save();
    return { title: chat.title, messages: chat.messages.slice(-2).map(publicMessage) };
  };

  const historyFor = async (filter, question) => {
    const chat = await Chat.findOne(filter);
    return toModel([...(chat?.messages || []), { role: "user", text: question }]);
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
    asyncHandler(async (req, res, next) => {
      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) throw new HttpError(400, "Message is empty");
      if (text.length > MAX_TEXT) throw new HttpError(400, `Message is too long (max ${MAX_TEXT} characters)`);
      req.text = text;
      next();
    }),
    checkRoom,
    quota,
    asyncHandler(async (req, res) => {
      const filter = mine(req);
      const history = await historyFor(filter, req.text);
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
        for await (const delta of ai.streamReply(history, { signal: abort.signal })) {
          answer += delta;
          send({ delta });
        }
        if (!answer) throw new Error("Empty reply from model");
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("Chat reply failed:", err.message);
          send({ error: "Could not get a reply. Please try again." });
          return res.end();
        }
      }
      // If the user pressed Stop, keep what was already generated.
      if (answer) {
        try {
          send({ done: true, ...(await saveExchange(filter, req.text, answer)) });
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
      const question = (await ai.transcribe(buffer, `voice.${AUDIO_TYPES[mimetype]}`, mimetype)).slice(0, MAX_TEXT);
      if (!question) throw new HttpError(422, "Could not hear anything. Please try again.");

      let answer = "";
      for await (const delta of ai.streamReply(await historyFor(filter, question))) answer += delta;
      if (!answer) throw new Error("Empty reply from model");

      const saved = await saveExchange(filter, question, answer);
      // Speech is optional: the text reply is still returned if it fails.
      const speech = await ai.speak(answer).catch((err) => console.error("TTS failed:", err.message));
      res.json({ ...saved, audio: speech ? speech.toString("base64") : null });
    }),
  );

  return router;
};
