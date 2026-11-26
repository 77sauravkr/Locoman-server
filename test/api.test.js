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
  REGISTER_HOURLY_LIMIT: "1000",
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
ai.planTrip = async (request) => {
  lastPlanRequest = request;
  return {
    title: "Jaipur getaway",
    days: Array.from({ length: 5 }, (_, i) => ({
      title: `Day ${i + 1}`,
      items: [{ time: "09:00", name: "Amber Fort", lat: 26.98, lng: 75.85 }, { name: "" }, { name: "Bad pin", lat: 999, lng: 0 }],
    })),
  };
};
let lastPlanRequest;
const places = {
  weather: async (q) => (q === "Nowhere" ? null : { place: q, days: [] }),
  locate: async () => {
    throw new Error("internal upstream detail");
  },
};
const verifyGoogle = async (credential) => {
  const [sub, email] = credential.split("|");
  if (!email) throw new Error("bad token");
  return { sub, email };
};
const app = createApp({ config, ai, places, verifyGoogle });

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

test("recovery code resets the password once and ends old sessions", async () => {
  const old = request.agent(app);
  const created = await old.post("/api/auth/register").send({ username: "asha", password: "password123" }).expect(200);
  const code = created.body.recoveryCode;
  assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const reset = (recoveryCode) =>
    request(app).post("/api/auth/reset").send({ username: "asha", recoveryCode, newPassword: "newpassword456" });
  await reset("AAAA-AAAA-AAAA-AAAA").expect(401);
  const ok = await reset(code.toLowerCase()).expect(200);
  assert.notEqual(ok.body.recoveryCode, code);
  await reset(code).expect(401);
  await old.get("/api/auth/me").expect(401);
  await request(app).post("/api/auth/login").send({ username: "asha", password: "newpassword456" }).expect(200);
});

test("changing the password needs the current one", async () => {
  const agent = await signUp();
  await agent.post("/api/auth/password").send({ currentPassword: "nope", newPassword: "another-pass-1" }).expect(403);
  await agent.post("/api/auth/password").send({ currentPassword: "password123", newPassword: "another-pass-1" }).expect(200);
  await agent.get("/api/auth/me").expect(200);
});

test("Google sign-in never takes over a password account with the same name", async () => {
  await signUp("a@example.com");
  const google = request.agent(app);
  const first = await google.post("/api/auth/google").send({ credential: "sub1|a@example.com" }).expect(200);
  assert.notEqual(first.body.user.username, "a@example.com");
  assert.equal(first.body.user.hasPassword, false);
  const again = await google.post("/api/auth/google").send({ credential: "sub1|a@example.com" }).expect(200);
  assert.equal(again.body.user._id, first.body.user._id);
  await google.post("/api/auth/google").send({ credential: "garbage" }).expect(401);
  await request(app).post("/api/auth/login").send({ username: first.body.user.username, password: "anything1" }).expect(401);
  await google.delete("/api/auth/account").send({ confirm: "wrong" }).expect(403);
  await google.delete("/api/auth/account").send({ confirm: first.body.user.username }).expect(200);
});

test("deleting an account removes its data and sessions", async () => {
  const asha = await signUp("asha");
  const ravi = await signUp("ravi");
  await asha.post("/api/chats/c1/messages").send({ text: "hi" }).expect(200);
  const own = (await asha.post("/api/trips").send({ destination: "Goa" }).expect(200)).body.trip;
  const theirs = (await ravi.post("/api/trips").send({ destination: "Leh" }).expect(200)).body.trip;
  const token = (await ravi.post(`/api/trips/${theirs.id}/invite`).expect(200)).body.trip.inviteToken;
  await asha.post("/api/trips/join").send({ token }).expect(200);
  await asha.delete("/api/auth/account").send({ password: "wrong-password" }).expect(403);
  await asha.delete("/api/auth/account").send({ password: "password123" }).expect(200);
  await asha.get("/api/auth/me").expect(401);
  assert.equal(await mongoose.models.Chat.countDocuments(), 0);
  assert.equal(await mongoose.models.Trip.countDocuments({ _id: own.id }), 0);
  assert.equal((await ravi.get(`/api/trips/${theirs.id}`)).body.trip.members.length, 0);
});

test("AI plan is cleaned and limited to the asked days", async () => {
  const agent = await signUp();
  const res = await agent.post("/api/trips/generate").send({ destination: "Jaipur", days: 2, budget: "10000" }).expect(200);
  const { trip } = res.body;
  assert.equal(trip.days.length, 2);
  assert.deepEqual(trip.days[0].items.map((i) => i.name), ["Amber Fort", "Bad pin"]);
  assert.equal(trip.days[0].items[1].lat, undefined);
  assert.equal(lastPlanRequest.budget, "10000");
  await agent.post("/api/trips/generate").send({ destination: "Jaipur", days: 40 }).expect(400);
});

test("only invited people can see or edit a trip", async () => {
  const asha = await signUp("asha");
  const ravi = await signUp("ravi");
  const { trip } = (await asha.post("/api/trips").send({ destination: "Goa" }).expect(200)).body;
  const url = `/api/trips/${trip.id}`;
  await ravi.get(url).expect(404);
  await ravi.patch(url).send({ version: 1, title: "mine" }).expect(404);
  await ravi.post(`${url}/expenses`).send({ description: "x", amount: 1, paidBy: "asha", splitAmong: ["asha"] }).expect(404);
  await ravi.post("/api/trips/join").send({ token: "x".repeat(24) }).expect(404);

  const token = (await asha.post(`${url}/invite`).expect(200)).body.trip.inviteToken;
  await ravi.post("/api/trips/join").send({ token }).expect(200);
  const seen = (await ravi.get(url).expect(200)).body.trip;
  assert.equal(seen.role, "member");
  assert.equal(seen.inviteToken, undefined);
  assert.deepEqual(seen.people, ["asha", "ravi"]);
  await ravi.delete(url).expect(403);
  await ravi.post(`${url}/invite`).expect(403);

  // Stale edits are refused instead of overwriting.
  await ravi.patch(url).send({ version: 1, title: "Goa with friends" }).expect(200);
  await asha.patch(url).send({ version: 1, title: "Old copy" }).expect(409);

  const raviId = (await ravi.get("/api/auth/me")).body.user._id;
  await asha.delete(`${url}/members/${raviId}`).expect(200);
  await ravi.get(url).expect(404);
  await ravi.post("/api/trips/join").send({ token }).expect(404);
});

test("expenses are validated, added and removed", async () => {
  const agent = await signUp("asha");
  const { trip } = (await agent.post("/api/trips").send({ destination: "Goa" })).body;
  const url = `/api/trips/${trip.id}`;
  await agent.patch(url).send({ version: 1, people: ["asha", "Ravi"] }).expect(200);
  const base = { description: "Hotel", amount: 250000, paidBy: "asha", splitAmong: ["asha", "Ravi"] };
  await agent.post(`${url}/expenses`).send({ ...base, amount: 10.5 }).expect(400);
  await agent.post(`${url}/expenses`).send({ ...base, paidBy: "stranger" }).expect(400);
  const added = (await agent.post(`${url}/expenses`).send(base).expect(200)).body.trip;
  assert.equal(added.expenses.length, 1);
  const removed = await agent.delete(`${url}/expenses/${added.expenses[0].id}`).expect(200);
  assert.equal(removed.body.trip.expenses.length, 0);
});

test("a long itinerary can be saved, and lookups hide upstream errors", async () => {
  const agent = await signUp();
  const { trip } = (await agent.post("/api/trips").send({ destination: "Goa" })).body;
  const days = Array.from({ length: 14 }, () => ({ items: Array.from({ length: 8 }, () => ({ name: "Place", notes: "n".repeat(400) })) }));
  await agent.patch(`/api/trips/${trip.id}`).send({ version: 1, days }).expect(200);
  await agent.get("/api/places/weather?q=Goa").expect(200);
  await agent.get("/api/places/weather?q=Nowhere").expect(404);
  const failed = await agent.get("/api/places/locate?q=Goa").expect(502);
  assert.doesNotMatch(failed.text, /upstream detail/);
  await request(app).get("/api/places/weather?q=Goa").expect(401);
});

test("recommendations are cleaned", async () => {
  const agent = await signUp();
  ai.recommend = async (r) => ({ suggestions: [{ place: "Pushkar", why: r.budget, highlights: ["lake", 5] }, { why: "no place" }] });
  const res = await agent.post("/api/trips/recommend").send({ budget: "5000", days: "x" }).expect(200);
  assert.deepEqual(res.body.suggestions, [{ place: "Pushkar", why: "5000", cost: "", bestTime: "", highlights: ["lake"] }]);
  await request(app).post("/api/trips/recommend").expect(401);
});

test("AI changes are only proposed, and packing is saved by the user", async () => {
  const agent = await signUp();
  const { trip } = (await agent.post("/api/trips").send({ destination: "Goa" })).body;
  const url = `/api/trips/${trip.id}`;
  ai.reviseTrip = async ({ instruction }) => ({ days: [{ title: instruction, items: [{ name: "Beach" }] }] });
  ai.packingList = async () => ({ items: ["Sunscreen", "", "Cap"] });
  await agent.post(`${url}/revise`).send({}).expect(400);
  const proposed = (await agent.post(`${url}/revise`).send({ instruction: "relaxed" }).expect(200)).body;
  assert.equal(proposed.days[0].title, "relaxed");
  assert.equal((await agent.get(url)).body.trip.days[0].items.length, 0);
  const { items } = (await agent.post(`${url}/packing`).expect(200)).body;
  assert.deepEqual(items.map((i) => i.text), ["Sunscreen", "Cap"]);
  const saved = await agent.patch(url).send({ version: 1, packing: [{ ...items[0], done: true }] }).expect(200);
  assert.equal(saved.body.trip.packing[0].done, true);
  const stranger = await signUp("stranger");
  await stranger.post(`${url}/packing`).expect(404);
  await stranger.post(`${url}/revise`).send({ instruction: "x" }).expect(404);
});

test("group members vote and comment; only the author or owner deletes", async () => {
  const asha = await signUp("asha");
  const ravi = await signUp("ravi");
  const { trip } = (await asha.post("/api/trips/generate").send({ destination: "Jaipur", days: 1 })).body;
  const url = `/api/trips/${trip.id}`;
  const item = trip.days[0].items[0].id;
  await ravi.put(`${url}/items/${item}/vote`).expect(404);
  const token = (await asha.post(`${url}/invite`)).body.trip.inviteToken;
  await ravi.post("/api/trips/join").send({ token }).expect(200);
  const before = (await asha.get(`${url}/stamp`).expect(200)).body.updatedAt;
  await ravi.put(`${url}/items/${item}/vote`).expect(200);
  const twice = (await ravi.put(`${url}/items/${item}/vote`).expect(200)).body.trip;
  assert.deepEqual(twice.votes, [{ itemId: item, mine: true }]);
  assert.notEqual((await asha.get(`${url}/stamp`)).body.updatedAt, before);
  await ravi.put(`${url}/items/nope/vote`).expect(404);
  const mine = (await asha.post(`${url}/items/${item}/comments`).send({ text: "must see" }).expect(200)).body.trip.comments[0];
  await ravi.delete(`${url}/comments/${mine.id}`).expect(403);
  await ravi.post(`${url}/items/${item}/comments`).send({ text: "agreed" }).expect(200);
  await ravi.delete("/api/auth/account").send({ password: "password123" }).expect(200);
  const after = (await asha.get(url)).body.trip;
  assert.equal(after.votes.length, 0);
  assert.deepEqual(after.comments.map((c) => c.text), ["must see"]);
});

test("a public page shows only the plan and can be turned off", async () => {
  const asha = await signUp("asha");
  const { trip } = (await asha.post("/api/trips/generate").send({ destination: "Jaipur", days: 1 })).body;
  const url = `/api/trips/${trip.id}`;
  const token = (await asha.post(`${url}/public`).expect(200)).body.trip.publicToken;
  const res = await request(app).get(`/api/public/trips/${token}`).expect(200);
  assert.deepEqual(Object.keys(res.body.trip).sort(), ["days", "destination", "startDate", "title"]);
  assert.doesNotMatch(res.text, /asha|expenses|comments/);
  await asha.delete(`${url}/public`).expect(200);
  await request(app).get(`/api/public/trips/${token}`).expect(404);
  places.rates = async (base) => (base === "XXX" ? null : { base, rates: { USD: 0.012 } });
  await asha.get("/api/places/rates?base=inr").expect(200);
  await asha.get("/api/places/rates?base=XXX").expect(404);
  await asha.get("/api/places/rates?base=../x").expect(400);
});
