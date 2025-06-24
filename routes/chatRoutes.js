const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const requireAuth = require("../middlewares/auth");
// const audioController = require("../controllers/audioController");
// const audioUpload = require("../middlewares/audioUpload");

router.get("/list-chats", requireAuth, chatController.listChats);
router.get("/load-chat", requireAuth, chatController.loadChat);
router.post("/save-chat", requireAuth, chatController.saveChat);
router.post("/clear-chat", requireAuth, chatController.clearChat);
router.post("/text-query", chatController.textQuery);
// router.post("/audio-query", audioUpload.single("audio"), audioController.audioQuery);

module.exports = router;