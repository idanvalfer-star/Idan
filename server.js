// Cartly server — serves the app and provides the real "watch the video" endpoint.
//
//   ANTHROPIC_API_KEY   required for video analysis (Claude reads the recipe)
//   OPENAI_API_KEY      optional — enables Whisper audio transcription
//                       (needed for Instagram/TikTok and caption-less YouTube)
//   PORT                optional (default 3000)
//
// The frontend works without this server too — opened as a plain file it falls
// back to the caption paste-parser. Run the server to unlock real extraction.

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeVideo } from "./lib/analyze.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Tells the frontend which capabilities are live so it can set expectations.
app.get("/api/config", (_req, res) => {
  res.json({
    videoBackend: !!ANTHROPIC_API_KEY,
    whisper: !!OPENAI_API_KEY,
  });
});

app.post("/api/analyze", async (req, res) => {
  const url = (req.body && req.body.url ? String(req.body.url) : "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Please provide a valid video URL." });
  }
  try {
    const result = await analyzeVideo(url, {
      anthropicKey: ANTHROPIC_API_KEY,
      openaiKey: OPENAI_API_KEY,
    });
    res.json(result);
  } catch (e) {
    const code = e.code || "ERROR";
    const status =
      code === "NO_ANTHROPIC_KEY" || code === "NO_YTDLP" ? 503 :
      code === "NO_CONTENT" || code === "FETCH_FAILED" ? 422 : 500;
    res.status(status).json({ error: e.message || "Analysis failed.", code });
  }
});

app.get("/", (_req, res) => res.sendFile(join(__dirname, "index.html")));
app.use(express.static(__dirname, { index: false, extensions: ["html"] }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🛒  Cartly running at http://localhost:${PORT}`);
  console.log(`      video analysis: ${ANTHROPIC_API_KEY ? "ON (Claude)" : "OFF — set ANTHROPIC_API_KEY"}`);
  console.log(`      audio (Whisper): ${OPENAI_API_KEY ? "ON" : "OFF — set OPENAI_API_KEY for Instagram/TikTok"}\n`);
});
