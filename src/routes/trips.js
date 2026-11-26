const crypto = require("node:crypto");
const express = require("express");
const Trip = require("../../models/Trip");
const { limiter, dailyQuota } = require("../middleware/limits");
const { HttpError, asyncHandler } = require("../middleware/errors");
const { newId, text, cleanDays, cleanPeople, cleanPacking, cleanIdeas, isDate } = require("../lib/trip");

const MAX_TRIPS = 50;
const MAX_MEMBERS = 20;
const MAX_EXPENSES = 300;
const MAX_COMMENTS = 500;
const ID = /^[a-f0-9]{24}$/;

module.exports = ({ config, ai }) => {
  const router = express.Router();
  const joinLimit = limiter({ windowMs: 15 * 60 * 1000, limit: 20, keyGenerator: (req) => req.user.id });
  const generateLimit = limiter({ windowMs: 60 * 1000, limit: 8, keyGenerator: (req) => req.user.id });

  // A trip is visible to its owner and members only.
  const access = (req) => {
    if (!ID.test(req.params.id)) throw new HttpError(404, "Trip not found");
    return { _id: req.params.id, $or: [{ owner: req.user.id }, { "members.user": req.user.id }] };
  };
  const find = async (req) => {
    const trip = await Trip.findOne(access(req));
    if (!trip) throw new HttpError(404, "Trip not found");
    return trip;
  };
  const findOwned = async (req) => {
    const trip = await find(req);
    if (trip.owner !== req.user.id) throw new HttpError(403, "Only the person who created this trip can do that");
    return trip;
  };

  const view = (trip, req) => {
    const isOwner = trip.owner === req.user.id;
    return {
      id: String(trip._id),
      title: trip.title,
      destination: trip.destination || "",
      startDate: trip.startDate || "",
      days: trip.days,
      packing: trip.packing,
      votes: trip.votes.map((v) => ({ itemId: v.itemId, mine: v.user === req.user.id })),
      comments: trip.comments.map((c) => ({ id: c.id, itemId: c.itemId, name: c.name, text: c.text, canDelete: isOwner || c.user === req.user.id })),
      updatedAt: trip.updatedAt,
      people: trip.people,
      expenses: trip.expenses.map(({ id, description, amount, paidBy, splitAmong }) => ({ id, description, amount, paidBy, splitAmong })),
      members: trip.members.map((m) => ({ id: m.user, name: m.name })),
      role: isOwner ? "owner" : "member",
      version: trip.version,
      ...(isOwner && { inviteToken: trip.inviteToken || null, publicToken: trip.publicToken || null }),
    };
  };

  const checkRoom = asyncHandler(async (req, res, next) => {
    if ((await Trip.countDocuments({ owner: req.user.id })) >= MAX_TRIPS)
      throw new HttpError(409, "Trip limit reached. Delete an old trip first.");
    next();
  });

  const create = (req, { title, destination, startDate, days }) =>
    Trip.create({
      owner: req.user.id,
      title: text(title, 100) || `Trip to ${destination}`,
      destination,
      startDate: isDate(startDate) ? startDate : "",
      days: cleanDays(days),
      people: [req.user.username],
    });

  // Every AI call is rate limited, counted against the daily quota and has its errors reworded.
  const quota = dailyQuota(config);
  const askAi = async (run) => {
    try {
      return await run();
    } catch (err) {
      console.error("Trip AI request failed:", err.status || "", err.message);
      throw new HttpError(err.status === 429 ? 429 : 502, "The AI could not do that right now. Please try again.");
    }
  };

  router.post(
    "/recommend",
    generateLimit,
    quota,
    asyncHandler(async (req, res) => {
      const days = Number(req.body?.days);
      const request = {
        from: text(req.body?.from, 80),
        budget: text(req.body?.budget, 60),
        month: text(req.body?.month, 20),
        interests: text(req.body?.interests, 300),
        days: Number.isInteger(days) && days > 0 && days <= 30 ? days : 0,
      };
      const suggestions = cleanIdeas((await askAi(() => ai.recommend(request)))?.suggestions);
      if (!suggestions.length) throw new HttpError(502, "No suggestions this time. Please try again.");
      res.json({ suggestions });
    }),
  );

  // Returns a proposed plan; nothing changes until the user saves it.
  router.post(
    "/:id/revise",
    generateLimit,
    asyncHandler(async (req, res, next) => {
      req.trip = await find(req);
      req.instruction = text(req.body?.instruction, 300);
      if (!req.instruction) throw new HttpError(400, "Say what you want to change");
      next();
    }),
    quota,
    asyncHandler(async (req, res) => {
      const plan = await askAi(() =>
        ai.reviseTrip({ destination: req.trip.destination, days: cleanDays(req.trip.toObject().days), instruction: req.instruction }),
      );
      const ids = new Map(req.trip.days.flatMap((d) => d.items.map((i) => [i.name.toLowerCase(), i.id])));
      const days = cleanDays(plan?.days).map((day) => ({
        ...day,
        items: day.items.map((item) => ({ ...item, id: ids.get(item.name.toLowerCase()) || item.id })),
      }));
      if (!days.some((d) => d.items.length)) throw new HttpError(502, "The AI could not do that right now. Please try again.");
      res.json({ days });
    }),
  );

  router.post(
    "/:id/packing",
    generateLimit,
    asyncHandler(async (req, res, next) => {
      req.trip = await find(req);
      next();
    }),
    quota,
    asyncHandler(async (req, res) => {
      const { destination, startDate, days, title } = req.trip;
      const activities = days.flatMap((d) => d.items.map((i) => i.name)).slice(0, 30).join(", ");
      const result = await askAi(() => ai.packingList({ destination: destination || title, startDate, days: days.length || 1, activities }));
      const items = cleanPacking(result?.items);
      if (!items.length) throw new HttpError(502, "The AI could not do that right now. Please try again.");
      res.json({ items });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const trips = await Trip.find({ $or: [{ owner: req.user.id }, { "members.user": req.user.id }] })
        .sort({ updatedAt: -1 })
        .select("title destination startDate owner");
      res.json({
        trips: trips.map((t) => ({
          id: String(t._id),
          title: t.title,
          destination: t.destination || "",
          startDate: t.startDate || "",
          role: t.owner === req.user.id ? "owner" : "member",
        })),
      });
    }),
  );

  router.post(
    "/",
    checkRoom,
    asyncHandler(async (req, res) => {
      const destination = text(req.body?.destination, 100);
      if (!destination) throw new HttpError(400, "Destination is required");
      const trip = await create(req, { ...req.body, destination, days: [{ title: "Day 1", items: [] }] });
      res.json({ trip: view(trip, req) });
    }),
  );

  router.post(
    "/generate",
    generateLimit,
    checkRoom,
    asyncHandler(async (req, res, next) => {
      const destination = text(req.body?.destination, 100);
      const days = Number(req.body?.days);
      if (!destination) throw new HttpError(400, "Destination is required");
      if (!Number.isInteger(days) || days < 1 || days > 14) throw new HttpError(400, "Choose between 1 and 14 days");
      req.plan = {
        destination,
        days,
        budget: text(req.body.budget, 60),
        interests: text(req.body.interests, 300),
        notes: text(req.body.notes, 6000),
      };
      next();
    }),
    quota,
    asyncHandler(async (req, res) => {
      let plan;
      try {
        plan = await ai.planTrip(req.plan);
      } catch (err) {
        console.error("Trip planning failed:", err.status || "", err.message);
        throw new HttpError(err.status === 429 ? 429 : 502, "Could not plan the trip right now. Please try again.");
      }
      if (!cleanDays(plan?.days).some((d) => d.items.length))
        throw new HttpError(502, "Could not plan the trip right now. Please try again.");
      const trip = await create(req, {
        title: plan.title,
        destination: req.plan.destination,
        startDate: req.body.startDate,
        days: plan.days.slice(0, req.plan.days),
      });
      res.json({ trip: view(trip, req) });
    }),
  );

  router.post(
    "/join",
    joinLimit,
    asyncHandler(async (req, res) => {
      const token = req.body?.token;
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(token))
        throw new HttpError(404, "This invite link is not valid any more");
      const trip = await Trip.findOne({ inviteToken: token });
      if (!trip) throw new HttpError(404, "This invite link is not valid any more");
      if (trip.owner !== req.user.id && !trip.members.some((m) => m.user === req.user.id)) {
        if (trip.members.length >= MAX_MEMBERS) throw new HttpError(409, "This trip is full");
        await Trip.updateOne(
          { _id: trip._id, "members.user": { $ne: req.user.id } },
          { $push: { members: { user: req.user.id, name: req.user.username } }, $addToSet: { people: req.user.username } },
        );
      }
      res.json({ id: String(trip._id) });
    }),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      res.json({ trip: view(await find(req), req) });
    }),
  );

  // Edits carry the version they started from, so two people cannot overwrite each other unnoticed.
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const set = {};
      if (body.title !== undefined) {
        set.title = text(body.title, 100);
        if (!set.title) throw new HttpError(400, "Title is required");
      }
      if (body.destination !== undefined) set.destination = text(body.destination, 100);
      if (body.startDate !== undefined) set.startDate = isDate(body.startDate) ? body.startDate : "";
      if (body.days !== undefined) set.days = cleanDays(body.days);
      if (body.people !== undefined) set.people = cleanPeople(body.people);
      if (body.packing !== undefined) set.packing = cleanPacking(body.packing);
      if (!Number.isInteger(body.version)) throw new HttpError(400, "Missing version");
      const trip = await Trip.findOneAndUpdate(
        { ...access(req), version: body.version },
        { $set: set, $inc: { version: 1 } },
        { new: true },
      );
      if (!trip) {
        await find(req);
        throw new HttpError(409, "Someone else changed this trip. Reload to see the latest version.");
      }
      res.json({ trip: view(trip, req) });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await (await findOwned(req)).deleteOne();
      res.json({ success: true });
    }),
  );

  router.post(
    "/:id/invite",
    asyncHandler(async (req, res) => {
      const trip = await findOwned(req);
      trip.inviteToken = crypto.randomBytes(18).toString("base64url");
      await trip.save();
      res.json({ trip: view(trip, req) });
    }),
  );

  router.delete(
    "/:id/invite",
    asyncHandler(async (req, res) => {
      const trip = await findOwned(req);
      trip.inviteToken = undefined;
      await trip.save();
      res.json({ trip: view(trip, req) });
    }),
  );

  router.delete(
    "/:id/members/:userId",
    asyncHandler(async (req, res) => {
      const self = req.params.userId === req.user.id;
      const trip = self ? await find(req) : await findOwned(req);
      trip.members = trip.members.filter((m) => m.user !== req.params.userId);
      // Turn the old link off, so a removed person cannot walk back in.
      if (!self) trip.inviteToken = undefined;
      await trip.save();
      res.json(self ? { success: true } : { trip: view(trip, req) });
    }),
  );

  // Cheap check used to notice changes by other group members.
  router.get(
    "/:id/stamp",
    asyncHandler(async (req, res) => {
      const trip = await Trip.findOne(access(req)).select("updatedAt");
      if (!trip) throw new HttpError(404, "Trip not found");
      res.json({ updatedAt: trip.updatedAt });
    }),
  );

  const itemOf = async (req) => {
    const trip = await find(req);
    if (!trip.days.some((d) => d.items.some((i) => i.id === req.params.itemId)))
      throw new HttpError(404, "That place is no longer in the plan");
    return trip;
  };
  const respond = async (req, res, update, filter = {}) => {
    const trip = await Trip.findOneAndUpdate({ ...access(req), ...filter }, update, { new: true });
    res.json({ trip: view(trip || (await find(req)), req) });
  };

  // PUT adds this user's vote, DELETE removes it. Both are safe to repeat.
  router.put(
    "/:id/items/:itemId/vote",
    asyncHandler(async (req, res) => {
      await itemOf(req);
      const mine = { itemId: req.params.itemId, user: req.user.id };
      await respond(req, res, { $push: { votes: mine } }, { votes: { $not: { $elemMatch: mine } } });
    }),
  );
  router.delete(
    "/:id/items/:itemId/vote",
    asyncHandler(async (req, res) => {
      await respond(req, res, { $pull: { votes: { itemId: String(req.params.itemId), user: req.user.id } } });
    }),
  );

  router.post(
    "/:id/items/:itemId/comments",
    asyncHandler(async (req, res) => {
      await itemOf(req);
      const body = text(req.body?.text, 300);
      if (!body) throw new HttpError(400, "Write a comment first");
      const comment = { id: newId(), itemId: req.params.itemId, user: req.user.id, name: req.user.username, text: body, createdAt: new Date() };
      const trip = await Trip.findOneAndUpdate(
        { ...access(req), [`comments.${MAX_COMMENTS - 1}`]: { $exists: false } },
        { $push: { comments: comment } },
        { new: true },
      );
      if (!trip) throw new HttpError(409, "This trip has too many comments");
      res.json({ trip: view(trip, req) });
    }),
  );
  router.delete(
    "/:id/comments/:commentId",
    asyncHandler(async (req, res) => {
      const trip = await find(req);
      const comment = trip.comments.find((c) => c.id === req.params.commentId);
      if (comment && comment.user !== req.user.id && trip.owner !== req.user.id)
        throw new HttpError(403, "You can only delete your own comments");
      await respond(req, res, { $pull: { comments: { id: String(req.params.commentId) } } });
    }),
  );

  // A public, read-only page of the plan. Off until the owner turns it on.
  router.post(
    "/:id/public",
    asyncHandler(async (req, res) => {
      const trip = await findOwned(req);
      trip.publicToken ||= crypto.randomBytes(18).toString("base64url");
      await trip.save();
      res.json({ trip: view(trip, req) });
    }),
  );
  router.delete(
    "/:id/public",
    asyncHandler(async (req, res) => {
      const trip = await findOwned(req);
      trip.publicToken = undefined;
      await trip.save();
      res.json({ trip: view(trip, req) });
    }),
  );

  router.post(
    "/:id/expenses",
    asyncHandler(async (req, res) => {
      const description = text(req.body?.description, 120);
      const amount = req.body?.amount;
      const paidBy = text(req.body?.paidBy, 64);
      const splitAmong = cleanPeople(req.body?.splitAmong);
      const trip = await find(req);
      if (!description) throw new HttpError(400, "Add a short description");
      if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new HttpError(400, "Enter a valid amount");
      if (!trip.people.includes(paidBy) || !splitAmong.length || !splitAmong.every((p) => trip.people.includes(p)))
        throw new HttpError(400, "Choose who paid and who shares it");
      const updated = await Trip.findOneAndUpdate(
        { ...access(req), [`expenses.${MAX_EXPENSES - 1}`]: { $exists: false } },
        { $push: { expenses: { id: newId(), description, amount, paidBy, splitAmong, createdBy: req.user.id } } },
        { new: true },
      );
      if (!updated) throw new HttpError(409, "This trip has too many expenses");
      res.json({ trip: view(updated, req) });
    }),
  );

  router.delete(
    "/:id/expenses/:expenseId",
    asyncHandler(async (req, res) => {
      const trip = await Trip.findOneAndUpdate(
        access(req),
        { $pull: { expenses: { id: String(req.params.expenseId) } } },
        { new: true },
      );
      if (!trip) throw new HttpError(404, "Trip not found");
      res.json({ trip: view(trip, req) });
    }),
  );

  return router;
};
