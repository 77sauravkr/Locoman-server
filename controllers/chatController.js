const Chat = require("../models/Chat");
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.listChats = async (req, res) => {
  const chats = await Chat.find({ user: req.user.id }).select("chatId title");
  res.json({ chats });
};

exports.loadChat = async (req, res) => {
  const { chatId } = req.query;
  if (!chatId) return res.status(400).json({ error: "Missing chatId" });
  const chat = await Chat.findOne({ user: req.user.id, chatId });
  res.json({ messages: chat ? chat.messages : [] });
};

exports.saveChat = async (req, res) => {
  const { chatId, messages, title } = req.body;
  if (!chatId || !messages) return res.status(400).json({ error: "Missing chatId or messages" });
  await Chat.findOneAndUpdate(
    { user: req.user.id, chatId },
    { $set: { messages, title } },
    { upsert: true }
  );
  res.json({ success: true });
};

exports.clearChat = async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ error: "Missing chatId" });
  await Chat.findOneAndUpdate({ user: req.user.id, chatId }, { $set: { messages: [] } });
  res.json({ success: true });
};

exports.textQuery = async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: "Missing query" });

    const chatResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: query }]
    });
    const answer = chatResponse.choices[0].message.content;
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: "Failed to get response", details: err.message });
  }
};