import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeVideo } from './lib/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// API Endpoints

// Config endpoint
app.get('/api/config', (req, res) => {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;

  res.json({
    videoBackend: hasAnthropicKey || hasGeminiKey,
    whisper: hasOpenAIKey,
    anthropic: hasAnthropicKey,
    openai: hasOpenAIKey,
    gemini: hasGeminiKey
  });
});

// Analyze video endpoint - uses full pipeline
app.post('/api/analyze-video', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.json({ success: false, error: 'Video URL required' });
    }

    const result = await analyzeVideo(url, {
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      openaiKey: process.env.OPENAI_API_KEY,
      geminiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL
    });

    res.json({ success: true, ...result });

  } catch (error) {
    console.error('Video analysis error:', error);
    res.json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Debug endpoint to check family isolation
app.get('/api/debug/list-items', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      return res.json({ success: false, error: 'Service key required' });
    }

    // Get all items (admin view with service key)
    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/list_items?select=id,name,family_id,created_at', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      }
    });

    const items = await response.json();
    const grouped = {};
    items.forEach(item => {
      const familyId = item.family_id || 'null';
      if (!grouped[familyId]) grouped[familyId] = [];
      grouped[familyId].push(item);
    });

    res.json({ success: true, itemsByFamily: grouped, totalItems: items.length });
  } catch (error) {
    console.error('Debug error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Debug endpoint to check users and families
app.get('/api/debug/users-families', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      return res.json({ success: false, error: 'Service key required' });
    }

    // Get all users
    const usersResp = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/users?select=id,email,family_id', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      }
    });
    const users = await usersResp.json();

    // Get all families
    const familiesResp = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/families?select=id,family_code', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      }
    });
    const families = await familiesResp.json();

    res.json({ success: true, users, families });
  } catch (error) {
    console.error('Debug error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Endpoint to verify RLS is working
app.get('/api/debug/rls-status', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      return res.json({ success: false, error: 'Service key required' });
    }

    // Check RLS status on list_items table
    const sqlQuery = `
      SELECT
        schemaname,
        tablename,
        rowsecurity
      FROM pg_tables
      WHERE tablename IN ('list_items', 'home_inventory', 'users', 'families')
      ORDER BY tablename;
    `;

    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql: sqlQuery })
    });

    const result = await response.json();

    // Also get policies
    const policiesQuery = `
      SELECT
        schemaname,
        tablename,
        policyname,
        permissive,
        cmd
      FROM pg_policies
      WHERE tablename IN ('list_items', 'home_inventory')
      ORDER BY tablename, policyname;
    `;

    const policiesResp = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql: policiesQuery })
    });

    const policiesResult = await policiesResp.json();

    res.json({
      success: true,
      tables: result,
      policies: policiesResult
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Setup RLS policies endpoint - FIXED VERSION with JWT metadata
app.get('/api/setup-rls', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!serviceKey) {
      return res.json({
        success: false,
        error: 'Service key not configured. Need SUPABASE_SERVICE_KEY environment variable.'
      });
    }

    // First, ensure RLS is enabled on list_items
    const enableRLS = `ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;`;

    // Drop all existing policies to start fresh
    const dropPolicies = [
      'DROP POLICY IF EXISTS "list_select" ON list_items;',
      'DROP POLICY IF EXISTS "list_insert" ON list_items;',
      'DROP POLICY IF EXISTS "list_update" ON list_items;',
      'DROP POLICY IF EXISTS "list_delete" ON list_items;',
      'DROP POLICY IF EXISTS "Enable read for family" ON list_items;',
      'DROP POLICY IF EXISTS "Enable insert for authenticated users" ON list_items;',
      'DROP POLICY IF EXISTS "Enable update for family" ON list_items;',
      'DROP POLICY IF EXISTS "Enable delete for family" ON list_items;'
    ];

    // Create new policies using JWT metadata (most reliable)
    // The family_id is stored in auth.user_metadata by the app during login/signup
    const createPolicies = [
      // Allow users to SELECT only their family's items
      `CREATE POLICY "list_select" ON list_items
       FOR SELECT USING (
         family_id::text = (auth.jwt()->'user_metadata'->>'family_id')
       );`,

      // Allow users to INSERT only to their family
      `CREATE POLICY "list_insert" ON list_items
       FOR INSERT WITH CHECK (
         family_id::text = (auth.jwt()->'user_metadata'->>'family_id')
       );`,

      // Allow users to UPDATE only their family's items
      `CREATE POLICY "list_update" ON list_items
       FOR UPDATE USING (
         family_id::text = (auth.jwt()->'user_metadata'->>'family_id')
       ) WITH CHECK (
         family_id::text = (auth.jwt()->'user_metadata'->>'family_id')
       );`,

      // Allow users to DELETE only their family's items
      `CREATE POLICY "list_delete" ON list_items
       FOR DELETE USING (
         family_id::text = (auth.jwt()->'user_metadata'->>'family_id')
       );`
    ];

    const allQueries = [enableRLS, ...dropPolicies, ...createPolicies];

    // Run via Supabase SQL endpoint
    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql: allQueries.join('\n') })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Failed to run migrations');
    }

    res.json({ success: true, message: 'RLS policies configured successfully with JWT metadata' });
  } catch (error) {
    console.error('Setup error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Routes - serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

// 404 - serve app for SPA fallback
app.get('*', (req, res) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.json')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'app.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cartly server running on port ${PORT}`);
});
