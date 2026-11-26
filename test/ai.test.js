const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createAi } = require("../src/services/ai");

// A local stand-in for Gemini: the main model is always overloaded.
async function withGemini(status, run) {
  const called = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const model = req.url.match(/models\/([^:]+):/)[1];
      called.push(model);
      if (model === "main" && status === "hang") return; // never answers
      if (model === "main") {
        res.writeHead(status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: status, message: "busy" } }));
      }
      const body = JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] });
      const stream = req.url.includes("stream");
      res.writeHead(200, { "content-type": stream ? "text/event-stream" : "application/json" });
      res.end(stream ? `data: ${body}\n\n` : body);
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const ai = createAi({
    geminiApiKey: "test",
    model: "main",
    fallbackModel: "backup",
    modelTimeoutMs: 300,
    geminiBaseUrl: `http://127.0.0.1:${server.address().port}`,
  });
  try {
    await run(ai, called);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const read = async (ai) => {
  let out = "";
  for await (const text of ai.streamReply([{ role: "user", content: "hi" }])) out += text;
  return out;
};

test("falls back to the second model when the first is overloaded", () =>
  withGemini(503, async (ai, called) => {
    assert.equal(await read(ai), "ok");
    assert.equal(await ai.transcribe(Buffer.from("x"), "audio/webm"), "ok");
    assert.equal(called.at(-1), "backup");
    assert.ok(called.includes("main"));
  }));

test("does not retry a rejected request on another model", () =>
  withGemini(400, async (ai, called) => {
    await assert.rejects(read(ai), (err) => err.status === 400);
    assert.ok(!called.includes("backup"));
  }));

test("falls back when the first model never answers", () =>
  withGemini("hang", async (ai, called) => {
    assert.equal(await read(ai), "ok");
    assert.equal(await ai.transcribe(Buffer.from("x"), "audio/webm"), "ok");
    assert.ok(called.includes("main") && called.includes("backup"));
  }));

test("structured answers ask the lighter model first", () =>
  withGemini(503, async (ai, called) => {
    await assert.rejects(ai.planTrip({ destination: "Goa", days: 1 }), SyntaxError); // the fake replies "ok", not JSON
    assert.deepEqual(called, ["backup"]);
  }));
