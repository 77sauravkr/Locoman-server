const express = require("express");
const router = express.Router();
const audioController = require("../controllers/audioController");
const audioUpload = require("../middlewares/audioUpload");
const authenticate = require("../middlewares/apiKey");

router.post("/audio-travel-query", authenticate, audioUpload.single("audio"), audioController.audioTravelQuery);

module.exports = router;