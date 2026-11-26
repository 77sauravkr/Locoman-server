const mongoose = require("mongoose");

const item = new mongoose.Schema(
  { id: String, time: String, name: String, notes: String, lat: Number, lng: Number },
  { _id: false },
);
const day = new mongoose.Schema({ title: String, items: [item] }, { _id: false });
const packingItem = new mongoose.Schema({ id: String, text: String, done: Boolean }, { _id: false });
const vote = new mongoose.Schema({ itemId: String, user: String }, { _id: false });
const comment = new mongoose.Schema(
  { id: String, itemId: String, user: String, name: String, text: String, createdAt: { type: Date, default: Date.now } },
  { _id: false },
);
const member = new mongoose.Schema({ user: String, name: String }, { _id: false });
const expense = new mongoose.Schema(
  {
    id: String,
    description: String,
    amount: Number, // in the smallest unit (paise), so sums stay exact
    paidBy: String,
    splitAmong: [String],
    createdBy: String,
  },
  { _id: false },
);

const tripSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true, index: true },
    members: [member],
    title: { type: String, required: true },
    destination: String,
    startDate: String, // YYYY-MM-DD
    days: [day],
    packing: [packingItem],
    votes: [vote],
    comments: [comment],
    publicToken: { type: String, index: { unique: true, sparse: true } },
    people: [String], // names used for splitting expenses
    expenses: [expense],
    inviteToken: { type: String, index: { unique: true, sparse: true } },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

tripSchema.index({ "members.user": 1 });

module.exports = mongoose.model("Trip", tripSchema);
