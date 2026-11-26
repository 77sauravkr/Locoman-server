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

const PLAN_SCHEMA = {
  type: "OBJECT",
  required: ["title", "days"],
  properties: {
    title: { type: "STRING" },
    days: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["title", "items"],
        properties: {
          title: { type: "STRING" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              required: ["name"],
              properties: {
                time: { type: "STRING" },
                name: { type: "STRING" },
                notes: { type: "STRING" },
                lat: { type: "NUMBER" },
                lng: { type: "NUMBER" },
              },
            },
          },
        },
      },
    },
  },
};

const object = (properties, required) => ({ type: "OBJECT", properties, required });
const arrayOf = (items) => ({ type: "ARRAY", items });
const STRING = { type: "STRING" };

const IDEAS_SCHEMA = object(
  { suggestions: arrayOf(object({ place: STRING, why: STRING, cost: STRING, bestTime: STRING, highlights: arrayOf(STRING) }, ["place", "why"])) },
  ["suggestions"],
);
const PACKING_SCHEMA = object({ items: arrayOf(STRING) }, ["items"]);

const ideasPrompt = ({ from, days, budget, month, interests }) =>
  [
    "Suggest 5 different travel destinations.",
    from && `Starting from: ${from}.`,
    days && `Trip length: ${days} days.`,
    budget && `Total budget: ${budget}.`,
    month && `Travel month: ${month}.`,
    interests && `Interests: ${interests}.`,
    "For each give why it fits, a rough total cost in the user's currency, the best time to go and 3 highlights.",
    "Only suggest places that realistically fit the budget, length and season.",
  ]
    .filter(Boolean)
    .join("\n");

const revisePrompt = ({ destination, days, instruction }) =>
  [
    `This is a trip itinerary for ${destination} as JSON:`,
    JSON.stringify(days),
    `Change it as the traveller asks: ${instruction}`,
    "Return the whole itinerary. Keep everything the request does not affect exactly as it is.",
  ].join("\n");

const packingPrompt = ({ destination, startDate, days, activities }) =>
  [
    `Make a packing list for a ${days}-day trip to ${destination}${startDate ? ` starting ${startDate}` : ""}.`,
    activities && `Planned places: ${activities}.`,
    "Consider the usual weather in that season. Give 12 to 25 short items, most important first.",
  ]
    .filter(Boolean)
    .join("\n");

function planPrompt({ destination, days, budget, interests, notes }) {
  return [
    `Plan a ${days}-day trip to ${destination}.`,
    budget && `Budget: ${budget}.`,
    interests && `Interests: ${interests}.`,
    notes && `Follow this earlier suggestion where it makes sense:\n${notes}`,
    "Give 3 to 6 items per day in visiting order, with a time like 09:00, the real place name, one short practical note,",
    "and approximate latitude and longitude only when you are confident of them.",
  ]
    .filter(Boolean)
    .join("\n");
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
  async function* tryModels(run, userSignal, { order = models, firstLimitMs = config.modelTimeoutMs } = {}) {
    for (let i = 0; ; i++) {
      const last = i === order.length - 1;
      const limit = new AbortController();
      const timer = setTimeout(() => limit.abort(), last ? LAST_TRY_MS : firstLimitMs);
      let started = false;
      const answered = () => {
        started = true;
        clearTimeout(timer);
      };
      try {
        const signal = userSignal ? AbortSignal.any([userSignal, limit.signal]) : limit.signal;
        yield* run(order[i], signal, answered);
        // Some versions end the stream quietly when aborted.
        if (!started && limit.signal.aborted) throw new Error("Model timed out");
        return;
      } catch (err) {
        const timedOut = limit.signal.aborted && !userSignal?.aborted;
        if (timedOut) err = Object.assign(new Error(`${order[i]} timed out`), { status: 503 });
        // Part of an answer is already on screen, so do not start a second one.
        if (started || last || userSignal?.aborted || !BUSY.has(err.status)) throw err;
        console.warn(`${order[i]} unavailable (${err.status}), trying ${order[i + 1]}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  // Structured answers arrive all at once, and the main model has often been too slow for
  // that, so the lighter model goes first and the main one is the backup.
  const jsonOrder = [...models].reverse();

  async function generateJson(prompt, schema) {
    let json = "";
    for await (const part of tryModels(async function* (model, abortSignal, answered) {
      const result = await client.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema, abortSignal },
      });
      answered();
      yield result.text || "";
    }, undefined, { order: jsonOrder, firstLimitMs: config.modelTimeoutMs * 2 })) {
      json += part;
    }
    return JSON.parse(json);
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

    planTrip: (request) => generateJson(planPrompt(request), PLAN_SCHEMA),
    reviseTrip: (request) => generateJson(revisePrompt(request), PLAN_SCHEMA),
    recommend: (request) => generateJson(ideasPrompt(request), IDEAS_SCHEMA),
    packingList: (request) => generateJson(packingPrompt(request), PACKING_SCHEMA),

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
