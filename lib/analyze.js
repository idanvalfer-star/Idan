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

// ---------- Claude extraction ----------
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    description: { type: "string" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: { type: "string" },
        },
        required: ["name", "quantity"],
      },
    },
  },
  required: ["description", "ingredients"],
};

async function extractWithClaude({ anthropic, title, description, transcript, frames, platform }) {
  const parts = [];
  if (title) parts.push(`VIDEO TITLE: ${title}`);
  if (description) parts.push(`VIDEO DESCRIPTION / CAPTION:\n${description.slice(0, 4000)}`);
  if (transcript) parts.push(`SPOKEN TRANSCRIPT (from the video's audio/captions):\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`);
  const evidence = parts.join("\n\n") || "(no text available — rely on the frames)";

  const content = [];
  for (const b64 of frames) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  }
  content.push({
    type: "text",
    text:
`You are analysing a cooking/recipe video from ${platform}. Using the evidence below (spoken transcript, caption, and any still frames), do two things:

1. Write a friendly one- or two-sentence description of what the recipe is.
2. List every grocery ingredient the recipe needs, with a quantity when one is stated ("2 cups", "1 tbsp", "a pinch"). Use "" for quantity when none is given. Use plain ingredient names ("olive oil", not "extra virgin olive oil drizzle"). Do not include equipment, steps, or non-grocery items. Deduplicate.

If the material clearly is not a recipe, return an empty ingredients list and say so in the description.

EVIDENCE:
${evidence}`,
  });

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  });
  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("no response from model");
  let data;
  try { data = JSON.parse(textBlock.text); }
  catch { throw new Error("model returned unparseable output"); }
  const ingredients = Array.isArray(data.ingredients)
    ? data.ingredients
        .filter((x) => x && x.name)
        .map((x) => ({ name: String(x.name).trim(), quantity: String(x.quantity || "").trim() }))
    : [];
  return { description: String(data.description || "").trim(), ingredients };
}

// ---------- orchestration ----------
export async function analyzeVideo(url, { anthropicKey, openaiKey } = {}) {
  if (!anthropicKey) {
    const err = new Error("Server is missing ANTHROPIC_API_KEY.");
    err.code = "NO_ANTHROPIC_KEY";
    throw err;
  }
  if (!(await have("yt-dlp"))) {
    const err = new Error("yt-dlp is not installed on the server.");
    err.code = "NO_YTDLP";
    throw err;
  }
  const platform = detectPlatform(url);
  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const dir = await mkdtemp(join(tmpdir(), "cartly-"));
  try {
    const meta = await fetchMeta(url, dir);
    if (meta.missingTool) { const e = new Error("yt-dlp is not installed."); e.code = "NO_YTDLP"; throw e; }
    if (meta.error) { const e = new Error(meta.error); e.code = "FETCH_FAILED"; throw e; }

    // 1) spoken words: captions first (cheap, YouTube), else Whisper on the audio.
    let transcript = "";
    let source = "";
    if (platform === "youtube" && (meta.hasSubs || meta.hasAutoSubs)) {
      transcript = await fetchCaptions(url, dir);
      if (transcript) source = "captions";
    }
    if (!transcript) {
      const t = await transcribeAudio(url, dir, openaiKey);
      if (t) { transcript = t; source = "whisper"; }
    }

    // 2) frames — always useful, and the only signal when there's no transcript.
    const frames = await sampleFrames(url, dir);
    if (frames.length && !source) source = "frames";
    else if (frames.length && source) source += "+frames";

    if (!transcript && !frames.length && !meta.description) {
      const e = new Error("Could not read the video's audio, captions, or frames.");
      e.code = "NO_CONTENT";
      throw e;
    }

    // 3) Claude turns the evidence into a description + ingredient list.
    const { description, ingredients } = await extractWithClaude({
      anthropic, title: meta.title, description: meta.description,
      transcript, frames, platform,
    });

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
