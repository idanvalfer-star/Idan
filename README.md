# 🛒 Cartly — Smart Grocery List

A clean, fun, single-file grocery shopping app. No install, no server, no account —
just open it and go. Everything is saved on your device and works offline.

## How to use it

**Open `index.html` in any browser** (phone or desktop). That's it.

On a phone you can tap your browser's *Share → Add to Home Screen* to install it
like a real app (it ships with an app icon and runs full-screen).

## What it does

- **📝 Shopping list** — add items with an optional quantity, tick them off (they
  slide down into a *Got it* group), and delete or clear the ticked ones. Every
  item is auto-tagged with its grocery category and an emoji.
- **📋 Starter list** — one tap drops in the everyday essentials (milk, eggs,
  bread…), skipping anything you already have.
- **🏪 Sort by aisle** — flip the toggle and the list regroups by supermarket
  section in a natural walking order (Produce → Bakery → … → Household), so
  everything in the same part of the store sits together.
- **🔪 Tips** — cutting & prep tips tailored to what's on your list right now
  (how to dice an onion, cube an avocado, slice chicken…), plus money-saving
  shopping habits.
- **🍳 Recipes** — a set of quick recipes with ingredients and steps. Recipes
  that match what's already on your list float to the top, and one tap adds all
  the ingredients.
- **🎬 Add from a video** — paste an **Instagram or YouTube** link and the
  caption. Cartly pulls the thumbnail (YouTube) and title, writes a quick
  summary, and auto-detects the ingredients with their quantities. Pick which
  ones to add to your list. Saved videos stay in the app so you can re-add them
  later.
- **🌙 Light & dark mode**, mobile-first design, smooth animations.

## Notes

- All data lives in your browser's `localStorage` — it stays on the one device
  and isn't synced anywhere.
- The video feature reads the **caption you paste** (a browser can't watch the
  video itself), then matches it against a built-in food dictionary. Paste more
  of the caption for better ingredient detection. It never needs an API key.
- The whole app is one self-contained `index.html` — no build step and no
  external network calls required to run.
