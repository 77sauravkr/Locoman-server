const OpenAI = require("openai");
const { toFile } = require("openai");

const SYSTEM_PROMPT = `You are LocoMan, a friendly and practical travel guide.
Help with destinations, itineraries, food, transport, budgets, safety, culture and packing.
Reply in the language the user writes or speaks in (including Hinglish).
Be concise and use short Markdown headings and lists when they help.
Say clearly when prices, visa rules or opening hours may be out of date and should be checked.
If a question is not about travel, answer briefly and steer back to travel.`;

function createAi(config) {
  const client = new OpenAI({ apiKey: config.openaiApiKey, timeout: 60_000, maxRetries: 1 });

  return {
    async *streamReply(history, { signal } = {}) {
      const stream = await client.chat.completions.create(
        {
          model: config.chatModel,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
          max_tokens: 1000,
          stream: true,
        },
        { signal },
      );
      for await (const part of stream) {
        const text = part.choices[0]?.delta?.content;
        if (text) yield text;
      }
    },

    async transcribe(buffer, filename, type) {
      const result = await client.audio.transcriptions.create({
        file: await toFile(buffer, filename, { type }),
        model: config.sttModel,
      });
      return result.text.trim();
    },

    async speak(text) {
      const result = await client.audio.speech.create({
        model: config.ttsModel,
        voice: config.ttsVoice,
        input: text.slice(0, 4000),
      });
      return Buffer.from(await result.arrayBuffer());
    },
  };
}

module.exports = { createAi };
