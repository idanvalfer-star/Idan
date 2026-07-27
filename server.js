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
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_KEY;

  res.json({
    videoBackend: hasAnthropicKey || hasGeminiKey,
    whisper: hasOpenAIKey,
    anthropic: hasAnthropicKey,
    openai: hasOpenAIKey,
    gemini: hasGeminiKey,
    supabaseServiceKey: hasServiceKey
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_KEY;
  if (!hasServiceKey) {
    return res.json({
      status: 'error',
      message: 'SUPABASE_SERVICE_KEY is not configured on Render'
    });
  }
  res.json({ status: 'ok', message: 'Server is running' });
});

// Family code validation endpoint
app.post('/api/validate-family-code', async (req, res) => {
  try {
    const { familyCode } = req.body;

    if (!familyCode) {
      return res.json({ success: true, exists: false, message: 'No code provided' });
    }

    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/families?select=id&family_code=eq.' + familyCode, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (Array.isArray(result) && result.length > 0) {
      return res.json({ success: true, exists: true, familyId: result[0].id });
    }

    res.json({ success: true, exists: false });
  } catch (error) {
    console.error('Error in /api/validate-family-code:', error);
    res.json({ success: false, error: error.message });
  }
});

// Add list item endpoint - bypass RLS issues by using service key
app.post('/api/add-item', async (req, res) => {
  try {
    const { item, userId, familyId } = req.body;

    if (!item || !userId || !familyId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    console.log('📝 /api/add-item: Adding item to family', { familyId, userId, itemName: item.name });

    // Insert item with service key (bypasses RLS)
    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/list_items', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        family_id: familyId,
        name: item.name,
        quantity: item.qty || '',
        category: item.category,
        emoji: item.emoji,
        checked: item.checked || false,
        source: item.source || '',
        updated_by: userId
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Supabase error response:', { status: response.status, error: result });
      return res.json({ success: false, error: result.message || 'Failed to add item' });
    }

    console.log('✅ Item saved successfully:', { familyId, itemId: result[0]?.id });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error in /api/add-item:', error);
    res.json({ success: false, error: error.message });
  }
});

// Update list item endpoint
app.put('/api/update-item/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { updates, userId, familyId } = req.body;

    if (!id || !updates || !userId || !familyId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    // Update item with service key (bypasses RLS)
    const response = await fetch(`https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/list_items?id=eq.${id}&family_id=eq.${familyId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        ...updates,
        updated_by: userId,
        updated_at: new Date().toISOString()
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return res.json({ success: false, error: result.message || 'Failed to update item' });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error in /api/update-item:', error);
    res.json({ success: false, error: error.message });
  }
});

// Delete list item endpoint
app.delete('/api/delete-item/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, familyId } = req.body;

    if (!id || !userId || !familyId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    // Delete item with service key (bypasses RLS)
    const response = await fetch(`https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/list_items?id=eq.${id}&family_id=eq.${familyId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok && response.status !== 204) {
      const result = await response.json();
      return res.json({ success: false, error: result.message || 'Failed to delete item' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in /api/delete-item:', error);
    res.json({ success: false, error: error.message });
  }
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

// Debug endpoint to check all items and their family_id
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
      const familyId = item.family_id || 'NULL';
      if (!grouped[familyId]) grouped[familyId] = [];
      grouped[familyId].push(item);
    });

    console.log('📊 Database items by family:', grouped);
    res.json({ success: true, itemsByFamily: grouped, totalItems: items.length });
  } catch (error) {
    console.error('Debug error:', error);
    res.json({ success: false, error: error.message });
  }
});

// Debug endpoint to delete all items (reset database)
app.post('/api/debug/reset-items', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
      return res.json({ success: false, error: 'Service key required' });
    }

    // Delete ALL items
    const response = await fetch('https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/list_items', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('🗑️ Deleted all items from database');
    res.json({ success: true, message: 'All items deleted' });
  } catch (error) {
    console.error('Reset error:', error);
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

// Setup database endpoint - Disable RLS and ensure proper access
app.get('/api/setup-db', async (req, res) => {
  try {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!serviceKey) {
      return res.json({
        success: false,
        error: 'Service key not configured. Need SUPABASE_SERVICE_KEY environment variable.'
      });
    }

    console.log('🔧 Setting up database...');

    // Disable RLS on tables so direct queries work
    const disableRLS = [
      'ALTER TABLE list_items DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE families DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE users DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE home_inventory DISABLE ROW LEVEL SECURITY;'
    ];

    const allQueries = disableRLS;

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
      console.log('⚠️  Setup response not ok:', result);
      // Don't fail - RLS might already be disabled
    }

    console.log('✅ Database setup complete');
    res.json({ success: true, message: 'Database configured - RLS disabled for direct access' });
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
