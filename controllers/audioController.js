const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.audioTravelQuery = async (req, res) => {
  try {
    const audioFile = req.file;
    if (!audioFile) return res.status(400).json({ error: "No audio file uploaded" });

    // 1. Buffer ko temp file me likho
    const tempPath = path.join(__dirname, "../../uploads", `temp_${Date.now()}_${audioFile.originalname}`);
    fs.writeFileSync(tempPath, audioFile.buffer);

    // 2. OpenAI Whisper ko file stream do
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1"
    });

    const query = transcript.text;

    // 3. ChatGPT se answer lo
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: query }]
    });
    const answer = chatResponse.choices[0].message.content;

    // 4. TTS audio banao
    const ttsResponse = await openai.audio.speech.create({
      model: "tts-1",
      input: answer,
      voice: "alloy"
    });

    const ttsFilePath = path.join("uploads", `tts_${Date.now()}.mp3`);
    const buffer = Buffer.from(await ttsResponse.arrayBuffer());
    fs.writeFileSync(ttsFilePath, buffer);

    // 5. Temp file delete karo
    fs.unlinkSync(tempPath);

    res.json({
      query,
      answer,
      audio_url: `http://${req.headers.host}/${ttsFilePath.replace(/\\/g, "/")}`
    });
  } catch (err) {
    console.log("AUDIO ERROR:", err);
    res.status(500).json({ error: "Audio processing failed", details: err.message });
  }
};