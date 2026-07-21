# Supabase Setup Guide for Cartly

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Create a new project:
   - Name: `cartly`
   - Database password: (save this securely)
   - Region: (pick closest to you)
3. Wait for the project to be created (2-3 minutes)

## Step 2: Get Your Credentials

1. Go to **Settings** → **API**
2. Copy:
   - `Project URL` (your VITE_SUPABASE_URL)
   - `anon public` key (your VITE_SUPABASE_ANON_KEY)

## Step 3: Configure Environment Variables

1. Copy `.env.local.example` to `.env.local`:
   ```bash
   cp frontend/.env.local.example frontend/.env.local
   ```

2. Edit `frontend/.env.local` and paste your credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key-here
   ```

## Step 4: Run Database Migrations

1. In Supabase, go to **SQL Editor**
2. Create a new query and copy-paste the entire contents of:
   - `supabase/migrations/001_initial_schema.sql`
   - Run it (click play button)
3. Create another query and copy-paste:
   - `supabase/migrations/002_rls_policies.sql`
   - Run it

After both migrations run successfully, your database is ready!

## Step 5: Enable Realtime (for live updates)

1. In Supabase, go to **Database** → **Replication** 
2. Under "Replication" section, enable replication for:
   - `list_items`
   - `home_inventory`
3. This enables real-time subscriptions on these tables

## Step 6: Test the App

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173` and try signing up!

## Troubleshooting

### "Missing Supabase configuration" error
- Make sure `.env.local` exists in the `frontend/` directory
- Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not empty
- Restart the dev server after adding environment variables

### "Invalid family code" when joining
- Make sure the code is exactly right (case-insensitive)
- The code is automatically generated when the first family member signs up

### Real-time updates not working
- Make sure you enabled Replication (Step 5)
- Check browser console for WebSocket errors

## For Deployment

When you deploy the app:
1. Add environment variables to your hosting platform:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
2. The PWA will work on any HTTPS domain

## Video Analysis Backend

The existing video analysis backend (for Gemini API calls) will be kept separate and can run on a Node.js server. You can:
- Keep it running locally during development
- Deploy it to Render.com or Heroku in production
- Update the frontend to call it via `VITE_API_URL` environment variable

---

Next: Run Phase 1 setup, then we'll build the React components!
