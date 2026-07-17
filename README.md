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

### Watch videos on your phone (deploy the server)
A hosted static page (like the claude.ai preview) **cannot** watch a video or reach a
server — browsers block a plain web page from downloading video or calling out. To
paste *just a link* on your phone and have it work, run Cartly's server somewhere your
phone can reach:

- **Same Wi-Fi:** run `npm start` on your computer and open `http://<your-computer-ip>:3000`
  on your phone.
- **Anywhere (Docker):** the included `Dockerfile` bundles `yt-dlp` + `ffmpeg`, so you
  only supply keys:
  ```bash
  docker build -t cartly .
  docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... -e OPENAI_API_KEY=sk-... cartly
  ```
  Or deploy that image to any host (Render, Railway, Fly.io, a VPS) and open its URL on
  your phone. Add the keys as environment variables in the host's dashboard.

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
