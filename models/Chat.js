const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
  user: String,
  chatId: String,
  title: String,
  messages: [
    {
      role: String,
      text: String,
      audio: String,
      createdAt: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model("Chat", chatSchema);


