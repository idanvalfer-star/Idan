# 🛒 Cartly — Smart Grocery List

A clean, fun grocery shopping app that can **watch a recipe video and pull out the
ingredients for you**. Your lists save on your device and the core app works
offline; a small local server adds the real video-watching.

## Two ways to run it

### 1. Just the app (no setup)
Open **`index.html`** in any browser (phone or desktop). Everything works —
lists, aisle sorting, tips, recipes, dark mode — and saves locally. On a phone,
*Share → Add to Home Screen* installs it like a real app.

In this mode the video feature reads a **caption you paste** to find ingredients
(a plain web page can't download or watch a video).

### 2. With the server (real video watching)
Run the server and Cartly will actually **watch** an Instagram / YouTube / TikTok
video — reading its spoken audio and on-screen text — and extract the ingredients.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...      # required: Claude reads the recipe
export OPENAI_API_KEY=sk-...             # optional: Whisper transcribes audio
npm start
```

Then open **http://localhost:3000**.

**Extra tools the server needs on your machine:**
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — fetches the video, captions, audio
- [`ffmpeg`](https://ffmpeg.org/) — extracts audio and sample frames

Install them with e.g. `brew install yt-dlp ffmpeg` (macOS) or your package manager.

**How the watching works, per platform:**
- **YouTube** — uses the video's real captions when available (needs only the
  Anthropic key); falls back to audio transcription if there are none.
- **Instagram / TikTok** — no captions, so the server downloads the audio and
  transcribes it with **Whisper** (needs the OpenAI key). Without an OpenAI key it
  still reads **on-screen text from sampled frames** using Claude's vision.
- In every case Claude turns the transcript + frames into a short description and a
  structured ingredient list, which you pick from and add to your list.

If a link can't be read (private video, missing tool, no key), Cartly falls back to
the caption you pasted so you're never stuck.

## Features
- ✅ **List** — add items, tick them off (they sink to a "Got it" group), delete,
  clear-ticked; every item auto-tagged with a grocery category + emoji
- 📋 **Starter list** — one tap adds the everyday essentials (de-duplicated)
- 🏪 **Sort by aisle** — regroups the list by supermarket section in walking order
- 🔪 **Tips** — cutting/prep tips tailored to what's on your list, plus money-saving
  shopping habits
- 🍳 **Recipes** — quick recipes with ingredients + steps; matches to your list float
  to the top and add all ingredients in one tap
- 🎬 **Add from a video** — see above
- 🌙 Light/dark mode, mobile-first design

## Files
- `index.html` — the whole app (UI + logic, works standalone)
- `server.js` — Express server: serves the app + the `/api/analyze` endpoint
- `lib/analyze.js` — the video pipeline (yt-dlp → captions/Whisper → frames → Claude)

## Notes
- List data lives in your browser's `localStorage` — on that one device, not synced.
- The server uses your keys only to analyse videos you submit; nothing is stored
  server-side (temp files are deleted after each request).
