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

You need **one** AI key. Pick either:

```bash
npm install

# FREE — Google Gemini (get a key at aistudio.google.com, no billing/credit card):
export GEMINI_API_KEY=AIza...

# …or PAID — Anthropic Claude (console.anthropic.com):
# export ANTHROPIC_API_KEY=sk-ant-...

export OPENAI_API_KEY=sk-...             # optional: Whisper transcribes audio (Instagram/TikTok)
npm start
```

Then open **http://localhost:3000**. If both AI keys are set, Claude is used; otherwise
whichever one you provide.

**Extra tools the server needs on your machine:**
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — fetches the video, captions, audio
- [`ffmpeg`](https://ffmpeg.org/) — extracts audio and sample frames

Install them with e.g. `brew install yt-dlp ffmpeg` (macOS) or your package manager.

**How the watching works, per platform:**
- **YouTube** — uses the video's real captions when available (free, no audio
  transcription needed); falls back to audio transcription if there are none.
- **Instagram / TikTok** — no captions, so the server reads **on-screen text from
  sampled frames** using the model's vision. If you add an `OPENAI_API_KEY`, it also
  transcribes the spoken **audio with Whisper** to catch ingredients said aloud.
- In every case the AI (Gemini or Claude) turns the transcript + frames into a short
  description and a structured ingredient list, which you pick from and add to the list.

> **Fully free combo:** Gemini key + free Render hosting (below) + YouTube links =
> no cost at all. Gemini also reads frames, so Instagram/TikTok work for on-screen
> ingredients without any paid key.

If a link can't be read (private video, missing tool, no key), Cartly falls back to
the caption you pasted so you're never stuck.

### Watch videos on your phone (deploy the server)
A hosted static page (like the claude.ai preview) **cannot** watch a video or reach a
server — browsers block a plain web page from downloading video or calling out. To
paste *just a link* on your phone and have it work, run Cartly's server somewhere your
phone can reach:

- **Same Wi-Fi:** run `npm start` on your computer and open `http://<your-computer-ip>:3000`
  on your phone.
- **Anywhere (Docker):** the included `Dockerfile` bundles `yt-dlp` + `ffmpeg`, so you
  only supply a key:
  ```bash
  docker build -t cartly .
  docker run -p 3000:3000 -e GEMINI_API_KEY=AIza... cartly   # free
  ```
- **Free on Render:** the included `render.yaml` deploys the Docker image on Render's
  free plan. New → Blueprint → pick this repo/branch, paste your `GEMINI_API_KEY` when
  prompted, and open the resulting `…onrender.com` URL on your phone. (Free instances
  sleep when idle, so the first request after a break is slow.)

Instagram/TikTok downloads sometimes need your login cookies; YouTube generally does not.

## Features
- ✅ **List** — add items with a "How many?" stepper (default 1; tap −/+ or type),
  tick them off with a check animation (they stay in place, shown ticked), delete,
  or **clear the whole list**; every item auto-tagged with a grocery category + emoji
- 📋 **Starter list** — one tap adds your everyday essentials (de-duplicated), and
  it's **editable** — tap ✎ Edit starter to set your own
- 🏪 **Sort by aisle** — regroups the list by supermarket section in walking order
- 🍳 **Recipes** — your own editable recipe book: add, edit, and delete recipes, and
  send all of a recipe's ingredients to the list in one tap. Recipes matching your
  list float to the top. (Turn a video into a recipe from the Video tab → Save as
  recipe.)
- 🎬 **Add from a video** — see above; you can add the ingredients straight to the
  list or save the whole thing as a recipe
- 🌙 Light/dark mode, mobile-first design

## Files
- `index.html` — the whole app (UI + logic, works standalone)
- `server.js` — Express server: serves the app + the `/api/analyze` endpoint
- `lib/analyze.js` — the video pipeline (yt-dlp → captions/Whisper → frames → Claude)
- `Dockerfile` — bundles yt-dlp + ffmpeg for one-command hosting

## Notes
- List data lives in your browser's `localStorage` — on that one device, not synced.
- The server uses your keys only to analyse videos you submit; nothing is stored
  server-side (temp files are deleted after each request).
