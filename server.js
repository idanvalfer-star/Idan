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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import nodemailer from "nodemailer";
import { analyzeVideo } from "./lib/analyze.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));

// User database file path
const usersDbPath = join(__dirname, "users-db.json");

// Load users database
function loadUsersDb() {
  try {
    if (existsSync(usersDbPath)) {
      return JSON.parse(readFileSync(usersDbPath, "utf8"));
    }
  } catch (e) {
    console.error("Error loading users database:", e);
  }
  return {};
}

// Save users database
function saveUsersDb(users) {
  try {
    writeFileSync(usersDbPath, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error("Error saving users database:", e);
  }
}

// Setup email transporter (uses test account by default, override with env vars)
async function getEmailTransporter() {
  // Check for SMTP configuration in environment
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // For development: use Ethereal test account
  console.warn("⚠️  Using test email transporter (Ethereal). Set SMTP_HOST, SMTP_USER, SMTP_PASS for production.");
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
}

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

// Register user on server (called during signup)
app.post("/api/register-user", (req, res) => {
  const { email, nickname, familyCode, name } = req.body || {};

  if (!email || !nickname || !familyCode) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const users = loadUsersDb();

  // Check if email already exists
  for (const user of Object.values(users)) {
    if (user.email.toLowerCase() === email.toLowerCase()) {
      return res.status(400).json({ error: "Email already registered" });
    }
  }

  // Store user (key by email for easy lookup)
  users[email.toLowerCase()] = {
    email,
    nickname,
    familyCode,
    name,
    registeredAt: new Date().toISOString(),
  };

  saveUsersDb(users);
  res.json({ success: true, message: "User registered on server" });
});

// Send family code via email
app.post("/api/send-family-code", async (req, res) => {
  const email = (req.body && req.body.email ? String(req.body.email) : "").trim();

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const users = loadUsersDb();
  const user = users[email.toLowerCase()];

  if (!user) {
    // Don't reveal whether email exists for security
    return res.status(200).json({
      success: true,
      message: "If an account with this email exists, a recovery email has been sent",
    });
  }

  try {
    const transporter = await getEmailTransporter();

    const mailOptions = {
      from: process.env.SMTP_FROM || "cartly@example.com",
      to: email,
      subject: "Cartly - Your Family Code",
      html: `
        <h2>Cartly Family Code Recovery</h2>
        <p>Hello ${user.name || user.nickname},</p>
        <p>Your family code is:</p>
        <h3 style="background-color: #f0f0f0; padding: 10px; border-radius: 5px; font-family: monospace;">
          ${user.familyCode}
        </h3>
        <p>Use this code along with your email to sign in to Cartly.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <p>— Cartly Team</p>
      `,
      text: `Your Cartly family code is: ${user.familyCode}`,
    };

    const info = await transporter.sendMail(mailOptions);

    console.log("✉️  Email sent:", info.response);

    // If using test account, log the preview URL
    if (!process.env.SMTP_HOST) {
      console.log("Preview URL:", nodemailer.getTestMessageUrl(info));
    }

    res.json({
      success: true,
      message: "Family code sent to your email",
    });
  } catch (err) {
    console.error("Email send error:", err);
    res.status(500).json({
      error: "Failed to send email. Please try again later.",
    });
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
