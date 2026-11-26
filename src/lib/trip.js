const crypto = require("node:crypto");

const MAX_DAYS = 30;
const MAX_ITEMS = 20;
const MAX_PEOPLE = 30;

const newId = () => crypto.randomBytes(8).toString("hex");
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
const coordinate = (value, limit) => (Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined);
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

// Used for both user edits and AI output: neither is trusted to have the right shape.
function cleanDays(days) {
  return list(days, MAX_DAYS).map((d, i) => ({
    title: text(d?.title, 100) || `Day ${i + 1}`,
    items: list(d?.items, MAX_ITEMS)
      .map((it) => {
        const lat = coordinate(it?.lat, 90);
        const lng = coordinate(it?.lng, 180);
        return {
          id: /^[a-f0-9]{1,32}$/.test(it?.id) ? it.id : newId(),
          time: text(it?.time, 20),
          name: text(it?.name, 120),
          notes: text(it?.notes, 500),
          ...(lat !== undefined && lng !== undefined && { lat, lng }),
        };
      })
      .filter((it) => it.name),
  }));
}

const cleanPeople = (people) => [...new Set(list(people, MAX_PEOPLE).map((p) => text(p, 64)).filter(Boolean))];

const cleanPacking = (packing) =>
  list(packing, 100)
    .map((p) => ({
      id: /^[a-f0-9]{1,32}$/.test(p?.id) ? p.id : newId(),
      text: text(typeof p === "string" ? p : p?.text, 100),
      done: p?.done === true,
    }))
    .filter((p) => p.text);

const cleanIdeas = (ideas) =>
  list(ideas, 8)
    .map((i) => ({
      place: text(i?.place, 100),
      why: text(i?.why, 400),
      cost: text(i?.cost, 80),
      bestTime: text(i?.bestTime, 80),
      highlights: list(i?.highlights, 5).map((h) => text(h, 120)).filter(Boolean),
    }))
    .filter((i) => i.place);

module.exports = { newId, text, cleanDays, cleanPeople, cleanPacking, cleanIdeas, isDate };
