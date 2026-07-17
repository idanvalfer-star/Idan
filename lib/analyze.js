// Cartly — video recipe extraction pipeline.
//
// Given a YouTube / Instagram / TikTok URL, this actually *watches* the video:
//   1. Pull metadata (title, description, thumbnail) with yt-dlp.
//   2. Get the spoken words — YouTube captions when present, otherwise download
//      the audio and transcribe it with OpenAI Whisper.
//   3. Sample a few frames so Claude can read on-screen ingredient text too.
//   4. Ask Claude to turn all of that into a short description + ingredient list.
//
// Everything is best-effort and degrades gracefully: no Whisper key → frames
// only; no yt-dlp → a clear error the caller can fall back from.

import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";
const MAX_TRANSCRIPT_CHARS = 12000;
const MAX_FRAMES = 4;
const FRAME_WIDTH = 512;

// ---------- small process helper ----------
function run(cmd, args, { timeout = 120000, cwd } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "";
    let child;
    try {
      child = spawn(cmd, args, { cwd });
    } catch (e) {
      return resolve({ code: -1, out: "", err: String(e), spawnError: true });
    }
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeout);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: err + String(e), spawnError: true }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

async function have(cmd) {
  const r = await run(cmd, ["--version"], { timeout: 8000 });
  return !r.spawnError && r.code === 0;
}

// ---------- platform detection ----------
export function detectPlatform(url) {
  if (/youtu\.?be/.test(url)) return "youtube";
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  return "video";
}
function ytId(url) {
  const m = (url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}

// ---------- vtt / subtitle parsing ----------
function parseVtt(text) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const words = [];
  for (let line of lines) {
    if (!line || line.startsWith("WEBVTT") || line.includes("-->") || /^\d+$/.test(line.trim())) continue;
    line = line.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim(); // strip inline timing tags
    if (!line) continue;
    if (seen.has(line)) continue; // auto-subs repeat lines heavily
    seen.add(line);
    words.push(line);
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

// ---------- yt-dlp metadata ----------
async function fetchMeta(url, dir) {
  const r = await run("yt-dlp", [
    "--no-warnings", "--dump-single-json", "--no-playlist", url,
  ], { timeout: 60000 });
  if (r.spawnError) return { missingTool: true };
  if (r.code !== 0) return { error: r.err.split("\n").filter(Boolean).slice(-1)[0] || "yt-dlp failed" };
  try {
    const j = JSON.parse(r.out);
    return {
      title: j.title || "",
      description: j.description || "",
      thumbnail: j.thumbnail || "",
      duration: j.duration || 0,
      hasSubs: !!(j.subtitles && Object.keys(j.subtitles).length),
      hasAutoSubs: !!(j.automatic_captions && Object.keys(j.automatic_captions).length),
    };
  } catch (e) {
    return { error: "could not parse video metadata" };
  }
}

// ---------- captions (YouTube) ----------
async function fetchCaptions(url, dir) {
  const r = await run("yt-dlp", [
    "--no-warnings", "--skip-download",
    "--write-subs", "--write-auto-subs",
    "--sub-langs", "en.*,en",
    "--sub-format", "vtt",
    "--convert-subs", "vtt",
    "-o", join(dir, "sub.%(ext)s"),
    url,
  ], { timeout: 60000 });
  if (r.spawnError || r.code !== 0) return "";
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".vtt"));
    if (!files.length) return "";
    const text = await readFile(join(dir, files[0]), "utf8");
    return parseVtt(text);
  } catch { return ""; }
}

// ---------- audio download + Whisper transcription ----------
async function transcribeAudio(url, dir, openaiKey) {
  if (!openaiKey) return "";
  const audio = join(dir, "audio.mp3");
  const r = await run("yt-dlp", [
    "--no-warnings", "--no-playlist",
    "-x", "--audio-format", "mp3", "--audio-quality", "5",
    "-o", join(dir, "audio.%(ext)s"),
    url,
  ], { timeout: 180000 });
  if (r.spawnError || r.code !== 0) return "";
  let buf;
  try { buf = await readFile(audio); } catch { return ""; }
  if (buf.length > 24 * 1024 * 1024) return ""; // Whisper 25MB cap; skip huge files
  try {
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", "whisper-1");
    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!resp.ok) return "";
    const j = await resp.json();
    return (j.text || "").trim();
  } catch { return ""; }
}

// ---------- frame sampling ----------
async function sampleFrames(url, dir) {
  // Download a compact copy, then extract evenly-spaced frames.
  const video = join(dir, "clip.mp4");
  const dl = await run("yt-dlp", [
    "--no-warnings", "--no-playlist",
    "-f", "mp4/best[height<=480]/best",
    "-o", video,
    url,
  ], { timeout: 180000 });
  if (dl.spawnError || dl.code !== 0) return [];
  if (!(await have("ffmpeg"))) return [];
  const fr = await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", video,
    "-vf", `fps=1/6,scale=${FRAME_WIDTH}:-1`, // ~1 frame per 6s
    "-frames:v", String(MAX_FRAMES),
    join(dir, "frame_%02d.jpg"),
  ], { timeout: 60000 });
  if (fr.spawnError) return [];
  try {
    const files = (await readdir(dir)).filter((f) => /^frame_\d+\.jpg$/.test(f)).sort().slice(0, MAX_FRAMES);
    const frames = [];
    for (const f of files) {
      const b = await readFile(join(dir, f));
      if (b.length) frames.push(b.toString("base64"));
    }
    return frames;
  } catch { return []; }
}

// ---------- AI extraction (Claude or Gemini) ----------
function buildEvidence(title, description, transcript) {
  const parts = [];
  if (title) parts.push(`VIDEO TITLE: ${title}`);
  if (description) parts.push(`VIDEO DESCRIPTION / CAPTION:\n${description.slice(0, 4000)}`);
  if (transcript) parts.push(`SPOKEN TRANSCRIPT (from the video's audio/captions):\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`);
  return parts.join("\n\n") || "(no text available — rely on the frames)";
}
function prompt(platform, evidence) {
  return `You are analysing a cooking/recipe video from ${platform}. Using the evidence below (spoken transcript, caption, and any still frames), do two things:

1. Write a friendly one- or two-sentence description of what the recipe is.
2. List every grocery ingredient the recipe needs, with a quantity when one is stated ("2 cups", "1 tbsp", "a pinch"). Use "" for quantity when none is given. Use plain ingredient names ("olive oil", not "extra virgin olive oil drizzle"). Do not include equipment, steps, or non-grocery items. Deduplicate.

If the material clearly is not a recipe, return an empty ingredients list and say so in the description.

Respond ONLY with JSON of the form:
{"description": string, "ingredients": [{"name": string, "quantity": string}]}

EVIDENCE:
${evidence}`;
}
function normalizeExtract(data) {
  const ingredients = Array.isArray(data && data.ingredients)
    ? data.ingredients.filter((x) => x && x.name)
        .map((x) => ({ name: String(x.name).trim(), quantity: String(x.quantity || "").trim() }))
    : [];
  return { description: String((data && data.description) || "").trim(), ingredients };
}

const CLAUDE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    description: { type: "string" },
    ingredients: { type: "array", items: {
      type: "object", additionalProperties: false,
      properties: { name: { type: "string" }, quantity: { type: "string" } },
      required: ["name", "quantity"] } },
  },
  required: ["description", "ingredients"],
};

async function extractWithClaude({ anthropicKey, title, description, transcript, frames, platform }) {
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const content = [];
  for (const b64 of frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  content.push({ type: "text", text: prompt(platform, buildEvidence(title, description, transcript)) });
  const resp = await anthropic.messages.create({
    model: MODEL, max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: CLAUDE_SCHEMA } },
    messages: [{ role: "user", content }],
  });
  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("no response from Claude");
  let data; try { data = JSON.parse(textBlock.text); } catch { throw new Error("Claude returned unparseable output"); }
  return normalizeExtract(data);
}

// Google Gemini — free tier (no billing required). REST, no SDK needed.
async function geminiGenerate({ geminiKey, model, parts }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`;
  const resp = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    let msg = `Gemini error (${resp.status})`;
    try { const j = JSON.parse(t); if (j.error && j.error.message) msg = "Gemini: " + j.error.message; } catch {}
    const e = new Error(msg); e.code = "GEMINI_FAILED"; throw e;
  }
  const j = await resp.json();
  const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || "").join("") || "";
  let data; try { data = JSON.parse(text); } catch { throw new Error("Gemini returned unparseable output"); }
  return normalizeExtract(data);
}
// From sampled frames + any transcript/caption (Instagram/TikTok path).
async function extractWithGemini({ geminiKey, model, title, description, transcript, frames, platform }) {
  const parts = [];
  for (const b64 of frames) parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
  parts.push({ text: prompt(platform, buildEvidence(title, description, transcript)) });
  return geminiGenerate({ geminiKey, model, parts });
}
// Gemini watches a YouTube URL directly — Google fetches it server-side, so there's
// no download and no "confirm you're not a bot" block from the hosting IP.
async function extractYouTubeWithGemini({ geminiKey, model, url }) {
  const parts = [
    { fileData: { fileUri: url } },
    { text: prompt("youtube", "(Watch the linked YouTube video and base your answer on what is shown and said in it.)") },
  ];
  return geminiGenerate({ geminiKey, model, parts });
}

// ---------- orchestration ----------
export async function analyzeVideo(url, { anthropicKey, openaiKey, geminiKey, geminiModel } = {}) {
  const provider = anthropicKey ? "claude" : geminiKey ? "gemini" : null;
  if (!provider) {
    const err = new Error("Server has no AI key (set ANTHROPIC_API_KEY or GEMINI_API_KEY).");
    err.code = "NO_AI_KEY";
    throw err;
  }
  const platform = detectPlatform(url);
  const model = geminiModel || "gemini-2.0-flash";

  // YouTube + Gemini: let Gemini watch the video directly (no yt-dlp download,
  // which YouTube blocks from cloud IPs with "confirm you're not a bot").
  if (provider === "gemini" && platform === "youtube") {
    const id = ytId(url);
    const watchUrl = id ? `https://www.youtube.com/watch?v=${id}` : url;
    const { description, ingredients } = await extractYouTubeWithGemini({ geminiKey, model, url: watchUrl });
    return {
      platform, title: "",
      thumb: id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "",
      description, ingredients, source: "gemini-watched",
    };
  }

  // Everything else needs yt-dlp (download frames/audio for Instagram/TikTok, or
  // the full pipeline for Claude).
  if (!(await have("yt-dlp"))) {
    const err = new Error("yt-dlp is not installed on the server.");
    err.code = "NO_YTDLP";
    throw err;
  }
  const dir = await mkdtemp(join(tmpdir(), "cartly-"));
  try {
    const meta = await fetchMeta(url, dir);
    if (meta.missingTool) { const e = new Error("yt-dlp is not installed."); e.code = "NO_YTDLP"; throw e; }
    if (meta.error) { const e = new Error(meta.error); e.code = "FETCH_FAILED"; throw e; }

    // 1) spoken words: captions first (free, YouTube), else Whisper (needs OpenAI key).
    let transcript = "";
    let source = "";
    if (platform === "youtube" && (meta.hasSubs || meta.hasAutoSubs)) {
      transcript = await fetchCaptions(url, dir);
      if (transcript) source = "captions";
    }
    if (!transcript && openaiKey) {
      const t = await transcribeAudio(url, dir, openaiKey);
      if (t) { transcript = t; source = "whisper"; }
    }

    // 2) frames — always useful, and the only signal when there's no transcript
    //    (both Claude and Gemini can read on-screen text from them).
    const frames = await sampleFrames(url, dir);
    if (frames.length && !source) source = "frames";
    else if (frames.length && source) source += "+frames";

    if (!transcript && !frames.length && !meta.description) {
      const e = new Error("Could not read the video's audio, captions, or frames.");
      e.code = "NO_CONTENT";
      throw e;
    }

    // 3) The chosen model turns the evidence into a description + ingredient list.
    const args = { title: meta.title, description: meta.description, transcript, frames, platform };
    const { description, ingredients } = provider === "gemini"
      ? await extractWithGemini({ geminiKey, model, ...args })
      : await extractWithClaude({ anthropicKey, ...args });

    return {
      platform,
      title: meta.title || "",
      thumb: meta.thumbnail || "",
      description,
      ingredients,
      source: source || "description",
    };
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
