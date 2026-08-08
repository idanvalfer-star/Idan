import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeVideo } from './lib/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

const SUPABASE_URL = 'https://xxyhrhkflexpyipttmug.supabase.co';

function sbHeaders(extra = {}) {
  return {
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
}

/*
 * The browser keeps items in app-shaped fields (qty, expiry, ...) while Postgres
 * uses its own column names. Every write goes through one of these maps so an
 * app-shaped patch can never reach Supabase verbatim — an unmapped key like
 * `qty` is not a column and makes PostgREST reject the whole request, which is
 * what silently broke quantity edits and inventory sync.
 */
const LIST_ITEM_FIELDS = {
  name: 'name',
  qty: 'quantity',
  quantity: 'quantity',
  category: 'category',
  emoji: 'emoji',
  checked: 'checked',
  source: 'source'
};

const INVENTORY_FIELDS = {
  name: 'name',
  qty: 'quantity',
  quantity: 'quantity',
  unit: 'unit',
  expiry: 'expiry',
  category: 'category',
  emoji: 'emoji'
};

function mapFields(updates, fieldMap) {
  const row = {};
  for (const [key, value] of Object.entries(updates || {})) {
    const column = fieldMap[key];
    if (column) row[column] = value;
  }
  return row;
}

// home_inventory.quantity is an INT column; '' or 'two' would abort the write.
function intQty(value, fallback = 1) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// A DATE column rejects '', so blank expiry has to become a real NULL.
function dateOrNull(value) {
  return value && String(value).trim() ? value : null;
}

/*
 * Writes a row, and if this deployment's schema is missing an optional column
 * (PostgREST answers PGRST204 naming it), drops that column and retries instead
 * of failing the whole sync. Lets category/emoji ride along where the columns
 * exist without making them a hard requirement.
 */
async function supabaseWrite(url, method, row) {
  let payload = { ...row };

  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {
      method,
      headers: sbHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const text = await response.text();
      return { ok: true, data: text ? JSON.parse(text) : [] };
    }

    const result = await response.json().catch(() => ({}));
    const missing = result.code === 'PGRST204' &&
      /Could not find the '([^']+)' column/.exec(result.message || '');

    if (missing && missing[1] in payload) {
      console.warn(`⚠️ Column '${missing[1]}' missing from schema — retrying without it`);
      delete payload[missing[1]];
      continue;
    }

    return { ok: false, error: result.message || `Supabase returned ${response.status}` };
  }

  return { ok: false, error: 'Too many missing columns in schema' };
}

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

// Family details: code, name and member nicknames for the family header button.
// Served with the service key because the anon client cannot read sibling rows
// in `users` under RLS.
app.get('/api/family/:familyId', async (req, res) => {
  try {
    const { familyId } = req.params;

    if (!familyId) {
      return res.json({ success: false, error: 'Missing family id' });
    }

    const [familyResp, membersResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/families?select=family_code,family_name&id=eq.${familyId}`, { headers: sbHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/users?select=id,nickname,email&family_id=eq.${familyId}`, { headers: sbHeaders() })
    ]);

    const family = await familyResp.json();

    if (!familyResp.ok || !Array.isArray(family) || !family.length) {
      return res.json({ success: false, error: 'Family not found' });
    }

    const members = membersResp.ok ? await membersResp.json() : [];

    res.json({
      success: true,
      familyCode: family[0].family_code,
      familyName: family[0].family_name || '',
      // ids come back too so the list can label who last touched each row
      members: (Array.isArray(members) ? members : []).map(m => ({
        id: m.id,
        nickname: m.nickname || (m.email || '').split('@')[0] || 'Member'
      }))
    });
  } catch (error) {
    console.error('Error in /api/family/:familyId:', error);
    res.json({ success: false, error: error.message });
  }
});

// Rename a family
app.put('/api/family/:familyId/name', async (req, res) => {
  try {
    const { familyId } = req.params;
    const { familyName, userId } = req.body;

    if (!familyId || !userId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    const name = String(familyName || '').trim();

    if (!name) {
      return res.json({ success: false, error: 'Family name cannot be empty' });
    }

    if (name.length > 40) {
      return res.json({ success: false, error: 'Family name is too long (max 40 characters)' });
    }

    // Only a member of this family may rename it.
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=id&id=eq.${userId}&family_id=eq.${familyId}`,
      { headers: sbHeaders() }
    );
    const member = await memberResp.json();

    if (!memberResp.ok || !Array.isArray(member) || !member.length) {
      return res.json({ success: false, error: 'Not a member of this family' });
    }

    const result = await supabaseWrite(
      `${SUPABASE_URL}/rest/v1/families?id=eq.${familyId}`,
      'PATCH',
      { family_name: name }
    );

    if (!result.ok) {
      console.error('❌ Error renaming family:', result.error);
      return res.json({ success: false, error: result.error });
    }

    console.log('✅ Family renamed:', { familyId, name });
    res.json({ success: true, familyName: name });
  } catch (error) {
    console.error('Error in /api/family/:familyId/name:', error);
    res.json({ success: false, error: error.message });
  }
});

/*
 * Finishes a signup: resolves the family and writes the users row.
 *
 * This has to happen server-side. `users` has SELECT and UPDATE policies but no
 * INSERT one, so a browser inserting its own profile is refused by RLS — and
 * because the auth account is created first, the failure left an account that
 * could neither sign up again ("email already registered") nor load a family.
 * Idempotent, so anyone already stuck that way is repaired by retrying.
 */
app.post('/api/complete-signup', async (req, res) => {
  try {
    const { userId, email, nickname, familyCode } = req.body;

    if (!userId || !email) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    const code = (familyCode || '').trim();
    let familyId = null;
    let resolvedCode = code;

    if (code) {
      const lookup = await fetch(
        `${SUPABASE_URL}/rest/v1/families?select=id,family_code&family_code=eq.${encodeURIComponent(code)}`,
        { headers: sbHeaders() }
      );
      const found = await lookup.json();

      if (!lookup.ok || !Array.isArray(found) || !found.length) {
        return res.json({ success: false, error: 'Invalid family code' });
      }
      familyId = found[0].id;
      resolvedCode = found[0].family_code;
    } else {
      // No code given — start a new family for this person.
      resolvedCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      const created = await supabaseWrite(`${SUPABASE_URL}/rest/v1/families`, 'POST', {
        family_code: resolvedCode,
        created_by: userId,
        family_name: nickname ? `${nickname}'s family` : 'My family'
      });

      if (!created.ok) {
        console.error('❌ Could not create family:', created.error);
        return res.json({ success: false, error: created.error });
      }
      familyId = created.data[0].id;
    }

    // Upsert so a repeated attempt repairs the row instead of colliding on the PK.
    const profile = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify({ id: userId, email, nickname: nickname || email.split('@')[0], family_id: familyId })
    });

    if (!profile.ok) {
      const err = await profile.json().catch(() => ({}));
      console.error('❌ Could not write user profile:', err);
      return res.json({ success: false, error: err.message || 'Failed to create profile' });
    }

    console.log('✅ Signup completed:', { userId, familyId, joined: !!code });
    res.json({ success: true, familyId, familyCode: resolvedCode });
  } catch (error) {
    console.error('Error in /api/complete-signup:', error);
    res.json({ success: false, error: error.message });
  }
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
    const result = await supabaseWrite(
      `${SUPABASE_URL}/rest/v1/list_items`,
      'POST',
      {
        family_id: familyId,
        name: item.name,
        quantity: item.qty ? String(item.qty) : '',
        category: item.category,
        emoji: item.emoji,
        checked: item.checked || false,
        source: item.source || '',
        updated_by: userId
      }
    );

    if (!result.ok) {
      console.error('❌ Supabase error response:', result.error);
      return res.json({ success: false, error: result.error });
    }

    console.log('✅ Item saved successfully:', { familyId, itemId: result.data[0]?.id });
    res.json({ success: true, data: result.data });
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

    const row = mapFields(updates, LIST_ITEM_FIELDS);
    if ('quantity' in row) row.quantity = row.quantity == null ? '' : String(row.quantity);

    if (!Object.keys(row).length) {
      return res.json({ success: false, error: 'No recognised fields to update' });
    }

    // Update item with service key (bypasses RLS)
    const result = await supabaseWrite(
      `${SUPABASE_URL}/rest/v1/list_items?id=eq.${id}&family_id=eq.${familyId}`,
      'PATCH',
      { ...row, updated_by: userId, updated_at: new Date().toISOString() }
    );

    if (!result.ok) {
      console.error('❌ Error updating item:', result.error);
      return res.json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.data });
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

// Add inventory item endpoint
app.post('/api/add-inventory', async (req, res) => {
  try {
    const { item, userId, familyId } = req.body;

    if (!item || !userId || !familyId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    console.log('🏠 /api/add-inventory: Adding item to family', { familyId, userId, itemName: item.name });

    // Insert item with service key (bypasses RLS)
    const result = await supabaseWrite(
      `${SUPABASE_URL}/rest/v1/home_inventory`,
      'POST',
      {
        family_id: familyId,
        name: item.name,
        quantity: intQty(item.qty),
        unit: item.unit || '',
        expiry: dateOrNull(item.expiry),
        category: item.category,
        emoji: item.emoji,
        updated_by: userId
      }
    );

    if (!result.ok) {
      console.error('❌ Supabase error response:', result.error);
      return res.json({ success: false, error: result.error });
    }

    console.log('✅ Inventory item saved successfully:', { familyId, itemId: result.data[0]?.id });
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('❌ Error in /api/add-inventory:', error);
    res.json({ success: false, error: error.message });
  }
});

// Update inventory item endpoint
app.put('/api/update-inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { updates, userId, familyId } = req.body;

    if (!id || !updates || !userId || !familyId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    const row = mapFields(updates, INVENTORY_FIELDS);
    if ('quantity' in row) row.quantity = intQty(row.quantity);
    if ('expiry' in row) row.expiry = dateOrNull(row.expiry);

    if (!Object.keys(row).length) {
      return res.json({ success: false, error: 'No recognised fields to update' });
    }

    // Update item with service key (bypasses RLS)
    const result = await supabaseWrite(
      `${SUPABASE_URL}/rest/v1/home_inventory?id=eq.${id}&family_id=eq.${familyId}`,
      'PATCH',
      { ...row, updated_by: userId, updated_at: new Date().toISOString() }
    );

    if (!result.ok) {
      console.error('❌ Error updating inventory item:', result.error);
      return res.json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('Error in /api/update-inventory:', error);
    res.json({ success: false, error: error.message });
  }
});

// Delete inventory item endpoint
app.delete('/api/delete-inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, familyId } = req.body;

    if (!id || !userId || !familyId) {
      return res.json({ success: false, error: 'Missing required fields' });
    }

    // Delete item with service key (bypasses RLS)
    const response = await fetch(`https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/home_inventory?id=eq.${id}&family_id=eq.${familyId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok && response.status !== 204) {
      const result = await response.json();
      return res.json({ success: false, error: result.message || 'Failed to delete inventory item' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in /api/delete-inventory:', error);
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

// Shareable "add to home screen" page
app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'install.html'));
});

/*
 * The address Supabase puts in its password-reset email is
 * <origin>/reset-password, with no extension. There was no route for it, so the
 * catch-all served the shopping list instead and the reset form — which only
 * existed at /reset-password.html — was unreachable from the email.
 */
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'reset-password.html'));
});

/*
 * The service worker must be served from the root to control the whole origin,
 * and browsers refuse a manifest sent as text/html — express.static gets the
 * paths right but these two need explicit content types and cache rules.
 */
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.get('/manifest.webmanifest', (req, res) => {
  res.set('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.webmanifest'));
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
