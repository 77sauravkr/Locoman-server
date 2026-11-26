const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const mongoose = require("mongoose");
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");

const URI = process.env.MONGODB_URI_TEST || "mongodb://127.0.0.1:27017/locoman_test";
const config = loadConfig({
  MONGODB_URI: URI,
  JWT_SECRET: "test-secret-that-is-long-enough-0123456789",
  GEMINI_API_KEY: "test",
  USER_DAILY_LIMIT: "4",
});

let lastHistory;
let lastOptions;
let failReply = false;
const ai = {
  async *streamReply(history, options) {
    lastHistory = history;
    lastOptions = options;
    if (failReply) throw Object.assign(new Error("secret upstream detail"), { status: failReply });
    yield "Hello ";
    yield "traveller";
  },
  transcribe: async () => "Best food in Jaipur?",
};
const app = createApp({ config, ai });

before(() => mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 }));
beforeEach(async () => {
  failReply = false;
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});
after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

async function signUp(username = "asha") {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ username, password: "password123" }).expect(200);
  return agent;
}
const events = (res) =>
  res.text.split("\n\n").filter(Boolean).map((line) => JSON.parse(line.replace(/^data: /, "")));

test("config refuses missing or weak secrets", () => {
  assert.throws(() => loadConfig({}), /Missing environment variables/);
  assert.throws(
    () => loadConfig({ MONGODB_URI: "x", JWT_SECRET: "short", GEMINI_API_KEY: "x" }),
    /at least 32/,
  );
});

test("register, session, logout, login", async () => {
  const agent = await signUp();
  const me = await agent.get("/api/auth/me").expect(200);
  assert.equal(me.body.user.username, "asha");
  assert.equal(me.body.user.password, undefined);
  await agent.post("/api/auth/logout").expect(200);
  await agent.get("/api/auth/me").expect(401);
  await agent.post("/api/auth/login").send({ username: "asha", password: "wrong-password" }).expect(401);
  await agent.post("/api/auth/login").send({ username: "asha", password: "password123" }).expect(200);
});

test("rejects bad input and operator injection", async () => {
  await request(app).post("/api/auth/register").send({ username: "ab", password: "password123" }).expect(400);
  await request(app).post("/api/auth/register").send({ username: "asha", password: "short" }).expect(400);
  await signUp();
  await request(app).post("/api/auth/register").send({ username: "asha", password: "password123" }).expect(409);
  await request(app).post("/api/auth/login").send({ username: { $ne: null }, password: "x" }).expect(400);
  await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bad").expect(400);
});

test("chat routes need a session", async () => {
  await request(app).get("/api/chats").expect(401);
  await request(app).post("/api/chats/abc/messages").send({ text: "hi" }).expect(401);
  await request(app).post("/api/chats/abc/voice").expect(401);
});

test("streams a reply, saves it and sends history to the model", async () => {
  const agent = await signUp();
  const first = await agent.post("/api/chats/c1/messages").send({ text: "Trip to Goa" }).expect(200);
  const out = events(first);
  assert.equal(out.filter((e) => e.delta).map((e) => e.delta).join(""), "Hello traveller");
  assert.equal(out.at(-1).title, "Trip to Goa");
  await agent.post("/api/chats/c1/messages").send({ text: "And food?" }).expect(200);
  assert.deepEqual(lastHistory.map((m) => m.role), ["user", "assistant", "user"]);
  const chat = await agent.get("/api/chats/c1").expect(200);
  assert.equal(chat.body.messages.length, 4);
});

test("users cannot reach each other's chats", async () => {
  const asha = await signUp("asha");
  const ravi = await signUp("ravi");
  await asha.post("/api/chats/c1/messages").send({ text: "private" }).expect(200);
  await ravi.get("/api/chats/c1").expect(404);
  await ravi.patch("/api/chats/c1").send({ title: "x" }).expect(404);
  await ravi.delete("/api/chats/c1").expect(404);
  assert.equal((await ravi.get("/api/chats")).body.chats.length, 0);
});

test("rename and delete", async () => {
  const agent = await signUp();
  await agent.post("/api/chats/c1/messages").send({ text: "Goa" }).expect(200);
  await agent.patch("/api/chats/c1").send({ title: "Holiday" }).expect(200);
  assert.equal((await agent.get("/api/chats")).body.chats[0].title, "Holiday");
  await agent.delete("/api/chats/c1").expect(200);
  await agent.get("/api/chats/c1").expect(404);
});

test("upstream failure hides details and saves nothing", async () => {
  const agent = await signUp();
  failReply = 500;
  const res = await agent.post("/api/chats/c1/messages").send({ text: "hi" }).expect(200);
  assert.match(events(res)[0].error, /Could not get a reply/);
  assert.doesNotMatch(res.text, /secret upstream detail/);
  await agent.get("/api/chats/c1").expect(404);
});

test("voice query returns transcript and reply", async () => {
  const agent = await signUp();
  const res = await agent
    .post("/api/chats/v1/voice")
    .attach("audio", Buffer.from("fake"), { filename: "a.webm", contentType: "audio/webm" })
    .expect(200);
  assert.deepEqual(res.body.messages.map((m) => m.text), ["Best food in Jaipur?", "Hello traveller"]);
  await agent
    .post("/api/chats/v1/voice")
    .attach("audio", Buffer.from("x"), { filename: "a.txt", contentType: "text/plain" })
    .expect(415);
});

test("daily quota stops further AI calls", async () => {
  const agent = await signUp();
  for (let i = 0; i < 4; i++) await agent.post("/api/chats/q/messages").send({ text: "hi" }).expect(200);
  await agent.post("/api/chats/q/messages").send({ text: "hi" }).expect(429);
});

test("message length is limited", async () => {
  const agent = await signUp();
  await agent.post("/api/chats/c1/messages").send({ text: "   " }).expect(400);
  await agent.post("/api/chats/c1/messages").send({ text: "a".repeat(4001) }).expect(400);
});

test("a failed database connection is retried by the next request", async () => {
  let attempts = 0;
  const ready = async () => {
    if (++attempts === 1) throw new Error("connect timeout");
  };
  const flaky = createApp({ config, ai, ready });
  await request(flaky).get("/api/health").expect(503);
  await request(flaky).get("/api/health").expect(200);
});

test("photo and location reach the model; only a flag is stored", async () => {
  const agent = await signUp();
  const image = { mimeType: "image/jpeg", data: Buffer.alloc(200_000, 1).toString("base64") };
  await agent.post("/api/chats/p/messages").send({ image, location: { lat: 26.912345, lng: 75.787654 } }).expect(200);
  assert.deepEqual(lastHistory.at(-1).image, image);
  assert.deepEqual(lastOptions.location, { lat: 26.91, lng: 75.79 });
  const chat = await agent.get("/api/chats/p").expect(200);
  assert.equal(chat.body.messages[0].hasImage, true);
  assert.doesNotMatch(JSON.stringify(chat.body), /26\.9/);
});

test("bad or oversized photos and large bodies are rejected", async () => {
  const agent = await signUp();
  await agent.post("/api/chats/p/messages").send({ image: { mimeType: "text/html", data: "aGk=" } }).expect(400);
  await agent.post("/api/chats/p/messages").send({ image: { mimeType: "image/png", data: "<script>" } }).expect(400);
  await agent.post("/api/chats/p/messages").send({ image: { mimeType: "image/png", data: "A".repeat(2_900_000) } }).expect(413);
  await agent.patch("/api/chats/p").send({ title: "a".repeat(40_000) }).expect(413);
  await request(app).post("/api/chats/p/messages").send({ text: "a".repeat(100_000) }).expect(401);
});

test("an AI rate limit is explained without leaking details", async () => {
  const agent = await signUp();
  failReply = 429;
  const res = await agent.post("/api/chats/c1/messages").send({ text: "hi" }).expect(200);
  assert.match(events(res)[0].error, /usage limit/);
  assert.doesNotMatch(res.text, /secret upstream detail/);
});
