const { GoogleGenAI } = require("@google/genai");

const SYSTEM_PROMPT = `You are LocoMan, a friendly and practical travel guide.
Help with destinations, itineraries, food, transport, budgets, safety, culture and packing.
Reply in the language the user writes or speaks in (including Hinglish).
Be concise and use short Markdown headings, lists and tables when they help.
For trip plans, give a day-by-day plan and a rough budget table in the user's currency.
When you name a specific place the user may want to visit, link its name to Google Maps like
[Hawa Mahal](https://www.google.com/maps/search/?api=1&query=Hawa+Mahal+Jaipur).
If the user shares a photo, say what you can see. If you are not sure of a place, say so instead of guessing.
You cannot browse the web. Say clearly when prices, visa rules or opening hours should be checked.
If a question is not about travel, answer briefly and steer back to travel.`;

function systemInstruction({ location } = {}) {
  const lines = [SYSTEM_PROMPT, `Today's date is ${new Date().toISOString().slice(0, 10)}.`];
  if (location) {
    lines.push(
      `The user's approximate position is latitude ${location.lat}, longitude ${location.lng}. ` +
        `Use it for "near me" questions and say it is approximate.`,
    );
  }
  return lines.join("\n");
}

const inline = (mimeType, data) => ({ inlineData: { mimeType, data } });

const toContents = (history) =>
  history.map(({ role, content, image }) => ({
    role: role === "assistant" ? "model" : "user",
    parts: [...(image ? [inline(image.mimeType, image.data)] : []), { text: content }],
  }));

// Busy, overloaded or out of quota: worth trying the other model.
const BUSY = new Set([429, 500, 503]);

function createAi(config) {
  const models = [...new Set([config.model, config.fallbackModel])].filter(Boolean);
  const canFallBack = (err, index, signal) => BUSY.has(err.status) && index < models.length - 1 && !signal?.aborted;

  const client = new GoogleGenAI({
    apiKey: config.geminiApiKey,
    apiVersion: "v1beta",
    httpOptions: { timeout: 60_000, ...(config.geminiBaseUrl && { baseUrl: config.geminiBaseUrl }) },
  });

  async function generate(request) {
    for (let i = 0; ; i++) {
      try {
        return await client.models.generateContent({ ...request, model: models[i] });
      } catch (err) {
        if (!canFallBack(err, i)) throw err;
        console.warn(`${models[i]} unavailable (${err.status}), trying ${models[i + 1]}`);
      }
    }
  }

  return {
    async *streamReply(history, { signal, location } = {}) {
      for (let i = 0; ; i++) {
        let started = false;
        try {
          const stream = await client.models.generateContentStream({
            model: models[i],
            contents: toContents(history),
            // The limit includes the model's thinking tokens, so it is generous.
            config: { systemInstruction: systemInstruction({ location }), maxOutputTokens: 8192, abortSignal: signal },
          });
          for await (const chunk of stream) {
            if (chunk.text) {
              started = true;
              yield chunk.text;
            }
          }
          return;
        } catch (err) {
          // Part of an answer is already on screen, so do not start a second one.
          if (started || !canFallBack(err, i, signal)) throw err;
          console.warn(`${models[i]} unavailable (${err.status}), trying ${models[i + 1]}`);
        }
      }
    },

    async transcribe(buffer, mimeType) {
      const result = await generate({
        contents: [
          {
            role: "user",
            parts: [
              inline(mimeType, buffer.toString("base64")),
              {
                text: "Transcribe the speech in this audio exactly, in its original language. Reply with the transcript only. If there is no speech, reply with nothing.",
              },
            ],
          },
        ],
      });
      return (result.text || "").trim();
    },
  };
}

module.exports = { createAi };
