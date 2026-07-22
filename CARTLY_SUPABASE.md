# Cartly + Supabase Integration

Your Cartly app is now integrated with Supabase for real-time family list sharing!

## What Changed

✅ **Same beautiful UI** — No changes to the interface you built
✅ **Real-time sync** — Family members see list updates instantly
✅ **Family codes** — Share a code with family, they join with it
✅ **Guest mode** — Continue using localStorage if not signed in
✅ **Offline-first** — Works offline, syncs when reconnected

## How It Works

### Sign Up
1. Go to `/signup`
2. Enter email, name, password
3. **Create new family** — Leave family code blank, you'll get a code to share
4. **Join existing family** — Paste the family code you received

### Sign In
1. Go to `/login`
2. Enter email + your family code
3. Access the shared family list

### Sharing with Family
1. After signup, save your **family code** (e.g., `ABC123`)
2. Tell family members to sign up at `/signup`
3. They enter the same family code to join your family
4. Everyone sees the same shopping list in real-time

## File Structure

```
/app.html                 — Main shopping list app (unchanged UI)
/login.html              — Sign in page (family code + email)
/signup.html             — Sign up page (create family or join)
/supabase-service.js     — Supabase auth + data sync
/server.js               — Express routing server
```

## Supabase Setup (Already Done)

Your Supabase project has:
- **Database tables**: families, users, list_items, home_inventory, videos, recipes
- **Row Level Security**: Users only see their family's data
- **Real-time enabled**: list_items updates push to all family members
- **Family codes**: 6-character alphanumeric, generated on signup

## Deploying to Render

1. Push this code to GitHub
2. Go to [render.com](https://render.com)
3. Create new "Web Service" from your Git repo
4. Set build command: `npm install` (Express is already in package.json)
5. Set start command: `npm start` (runs server.js)
6. Add environment variable `PORT=3000`
7. Deploy!

The app will run at `https://your-app.onrender.com`

## How Real-Time Works

When one family member adds an item:
1. It saves to Supabase database
2. Supabase Realtime pushes update to all connected users
3. Everyone's app updates instantly (no refresh needed)

## Guest Mode

If you're not signed in, the app works exactly like before:
- All data saved to localStorage on your device
- Works offline
- No sync with other devices

Sign in anytime to enable family sharing.

## Troubleshooting

**"Invalid path specified in request URL"**
- Supabase credentials are correct (they are in supabase-service.js)
- Make sure your Supabase project has the tables created
- Check that migrations were run in Supabase SQL Editor

**"User not found"**
- The email/family code combination doesn't exist
- Make sure you're using the right family code from signup

**Real-time updates not showing**
- Check browser console for errors
- Make sure realtime is enabled in Supabase dashboard
- Refresh the page to manually sync

## Next Steps

1. Deploy to Render (or your hosting)
2. Test signup → creates family code
3. Test login with family code
4. Add an item on one device
5. See it appear on another device's browser instantly ✨

That's it! Your Cartly app now has real-time family sharing!
