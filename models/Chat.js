const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    user: { type: String, required: true },
    chatId: { type: String, required: true },
    title: String,
    messages: [
      {
        role: { type: String, enum: ["user", "bot"], required: true },
        // Not required: documents saved by the old client may have empty text.
        text: String,
        image: Boolean,
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

chatSchema.index({ user: 1, chatId: 1 });

module.exports = mongoose.model("Chat", chatSchema);
