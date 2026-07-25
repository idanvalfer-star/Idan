import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeVideo } from './lib/analyze.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Supabase admin client
const supabase = createClient(
  'https://xxyhrhkflexpyipttmug.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_S18kdYcFkvHKBKjvcXXOjg_rF7qqW94'
);

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

// Setup RLS policies endpoint
app.get('/api/setup-rls', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!serviceKey) {
      return res.json({
        success: false,
        error: 'Service key not configured. Need SUPABASE_SERVICE_KEY environment variable.'
      });
    }

    const queries = [
      'DROP POLICY IF EXISTS "list_select" ON list_items;',
      'DROP POLICY IF EXISTS "list_insert" ON list_items;',
      'DROP POLICY IF EXISTS "list_update" ON list_items;',
      'DROP POLICY IF EXISTS "list_delete" ON list_items;',
      `CREATE POLICY "list_select" ON list_items FOR SELECT USING (family_id::text = auth.jwt_claims()->>'family_id');`,
      `CREATE POLICY "list_insert" ON list_items FOR INSERT WITH CHECK (family_id::text = auth.jwt_claims()->>'family_id');`,
      `CREATE POLICY "list_update" ON list_items FOR UPDATE USING (family_id::text = auth.jwt_claims()->>'family_id') WITH CHECK (family_id::text = auth.jwt_claims()->>'family_id');`,
      `CREATE POLICY "list_delete" ON list_items FOR DELETE USING (family_id::text = auth.jwt_claims()->>'family_id');`
    ];

    // Run queries via Supabase SQL endpoint
    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/rpc/exec_sql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql: queries.join('\n') })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Failed to run migrations');
    }

    res.json({ success: true, message: 'RLS policies updated successfully' });
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
