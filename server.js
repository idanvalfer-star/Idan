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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

// Tells the frontend which capabilities are live so it can set expectations.
app.get("/api/config", (_req, res) => {
  res.json({
    videoBackend: !!(ANTHROPIC_API_KEY || GEMINI_API_KEY),
    provider: ANTHROPIC_API_KEY ? "claude" : GEMINI_API_KEY ? "gemini" : null,
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
      geminiKey: GEMINI_API_KEY,
      geminiModel: GEMINI_MODEL,
    });
    res.json(result);
  } catch (e) {
    const code = e.code || "ERROR";
    const status =
      code === "NO_AI_KEY" || code === "NO_YTDLP" ? 503 :
      code === "NO_CONTENT" || code === "FETCH_FAILED" ? 422 : 500;
    res.status(status).json({ error: e.message || "Analysis failed.", code });
  }
});

// Routes
app.get("/", (_req, res) => res.sendFile(join(__dirname, "login.html")));
app.get("/login", (_req, res) => res.sendFile(join(__dirname, "login.html")));
app.get("/signup", (_req, res) => res.sendFile(join(__dirname, "signup.html")));
app.get("/app", (_req, res) => res.sendFile(join(__dirname, "app.html")));

// Static files
app.use(express.static(__dirname, { index: false, extensions: ["html", "js"] }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const ai = ANTHROPIC_API_KEY ? "ON (Claude)" : GEMINI_API_KEY ? `ON (Gemini · ${GEMINI_MODEL}, free)` : "OFF — set ANTHROPIC_API_KEY or GEMINI_API_KEY";
  console.log(`\n  🛒  Cartly running at http://localhost:${PORT}`);
  console.log(`      video analysis: ${ai}`);
  console.log(`      audio (Whisper): ${OPENAI_API_KEY ? "ON" : "OFF — captions + on-screen text only"}\n`);
});
