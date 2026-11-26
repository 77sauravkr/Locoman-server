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
const BUSY = new Set([429, 500, 503, 504]);
const LAST_TRY_MS = 45_000;

function createAi(config) {
  const client = new GoogleGenAI({
    apiKey: config.geminiApiKey,
    apiVersion: "v1beta",
    httpOptions: { timeout: 60_000, ...(config.geminiBaseUrl && { baseUrl: config.geminiBaseUrl }) },
  });
  const models = [...new Set([config.model, config.fallbackModel])].filter(Boolean);

  // Calls run(model, signal, answered) until one model works. An overloaded model can also
  // just hang, so each has a time limit that stops once it starts to answer.
  async function* tryModels(run, userSignal) {
    for (let i = 0; ; i++) {
      const last = i === models.length - 1;
      const limit = new AbortController();
      const timer = setTimeout(() => limit.abort(), last ? LAST_TRY_MS : config.modelTimeoutMs);
      let started = false;
      const answered = () => {
        started = true;
        clearTimeout(timer);
      };
      try {
        const signal = userSignal ? AbortSignal.any([userSignal, limit.signal]) : limit.signal;
        yield* run(models[i], signal, answered);
        // Some versions end the stream quietly when aborted.
        if (!started && limit.signal.aborted) throw new Error("Model timed out");
        return;
      } catch (err) {
        const timedOut = limit.signal.aborted && !userSignal?.aborted;
        if (timedOut) err = Object.assign(new Error(`${models[i]} timed out`), { status: 503 });
        // Part of an answer is already on screen, so do not start a second one.
        if (started || last || userSignal?.aborted || !BUSY.has(err.status)) throw err;
        console.warn(`${models[i]} unavailable (${err.status}), trying ${models[i + 1]}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return {
    streamReply(history, { signal, location } = {}) {
      return tryModels(async function* (model, attemptSignal, answered) {
        const stream = await client.models.generateContentStream({
          model,
          contents: toContents(history),
          // The limit includes the model's thinking tokens, so it is generous.
          config: { systemInstruction: systemInstruction({ location }), maxOutputTokens: 8192, abortSignal: attemptSignal },
        });
        for await (const chunk of stream) {
          if (chunk.text) {
            answered();
            yield chunk.text;
          }
        }
      }, signal);
    },

    async transcribe(buffer, mimeType) {
      const contents = [
        {
          role: "user",
          parts: [
            inline(mimeType, buffer.toString("base64")),
            {
              text: "Transcribe the speech in this audio exactly, in its original language. Reply with the transcript only. If there is no speech, reply with nothing.",
            },
          ],
        },
      ];
      let text = "";
      for await (const part of tryModels(async function* (model, abortSignal, answered) {
        const result = await client.models.generateContent({ model, contents, config: { abortSignal } });
        answered();
        yield result.text || "";
      })) {
        text += part;
      }
      return text.trim();
    },
  };
}

module.exports = { createAi };
