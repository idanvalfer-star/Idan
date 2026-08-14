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

// Must match AVATARS in app.html. Kept as an explicit whitelist rather than
// just a length check, since this value ends up in another family member's
// innerHTML — validating it here means a client bypassing the picker's UI
// and calling the API directly can't push arbitrary content into that.
const AVATARS = new Set(["👤","🧑","👩","👨","🧔","👵","👴","🧑‍🍳","👩‍🍳","🦸",
  "🐱","🐶","🦊","🐼","🐨","🦁","🐵","🐰","🦉","🐢",
  "🌟","🌸","🍀","🍎","🥑","🍕","🍩","☕","🚀","🎧"]);

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

/*
 * True only if userId actually belongs to familyId. Every route below writes
 * with the service key, which bypasses RLS entirely — without this check a
 * request could send anyone else's familyId and read or write their family's
 * data no matter what the database's row-level policies say.
 */
async function isFamilyMember(userId, familyId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=id&id=eq.${userId}&family_id=eq.${familyId}`,
    { headers: sbHeaders() }
  );
  const rows = await resp.json().catch(() => []);
  return resp.ok && Array.isArray(rows) && rows.length > 0;
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

// avatar is a newer column on `users` — fall back to a query without it so
// this route keeps working on a database that hasn't added it yet.
async function fetchFamilyMembers(familyId) {
  let resp = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=id,nickname,email,avatar&family_id=eq.${familyId}`,
    { headers: sbHeaders() }
  );
  if (!resp.ok) {
    resp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=id,nickname,email&family_id=eq.${familyId}`,
      { headers: sbHeaders() }
    );
  }
  if (!resp.ok) return [];
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

// Family details: code, name and member nicknames/avatars for the family
// header button. Served with the service key because the anon client cannot
// read sibling rows in `users` under RLS.
app.get('/api/family/:familyId', async (req, res) => {
  try {
    const { familyId } = req.params;

    if (!familyId) {
      return res.json({ success: false, error: 'Missing family id' });
    }

    const [familyResp, members] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/families?select=family_code,family_name&id=eq.${familyId}`, { headers: sbHeaders() }),
      fetchFamilyMembers(familyId)
    ]);

    const family = await familyResp.json();

    if (!familyResp.ok || !Array.isArray(family) || !family.length) {
      return res.json({ success: false, error: 'Family not found' });
    }

    res.json({
      success: true,
      familyCode: family[0].family_code,
      familyName: family[0].family_name || '',
      // ids come back too so the list can label who last touched each row
      members: members.map(m => ({
        id: m.id,
        nickname: m.nickname || (m.email || '').split('@')[0] || 'Member',
        avatar: m.avatar || null
      }))
    });
  } catch (error) {
    console.error('Error in /api/family/:familyId:', error);
    res.json({ success: false, error: error.message });
  }
});

// Update a user's own avatar. Was device-local (localStorage) before this —
// now it's a users column so the rest of the family can see it too.
app.put('/api/user/:userId/avatar', async (req, res) => {
  try {
    const { userId } = req.params;
    const { avatar } = req.body;

    if (!userId || !AVATARS.has(avatar)) {
      return res.json({ success: false, error: 'Invalid avatar' });
    }

    const result = await supabaseWrite(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      'PATCH',
      { avatar }
    );

    if (!result.ok) {
      console.error('❌ Error updating avatar:', result.error);
      return res.json({ success: false, error: result.error });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error in /api/user/:userId/avatar:', error);
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
    if (!(await isFamilyMember(userId, familyId))) {
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

    if (!(await isFamilyMember(userId, familyId))) {
      return res.json({ success: false, error: 'Not a member of this family' });
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
        // added_by is who gets credit on the "who added this" badge; it's
        // set once here and update-item must never touch it, unlike
        // updated_by which every edit overwrites.
        added_by: userId,
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

    if (!(await isFamilyMember(userId, familyId))) {
      return res.json({ success: false, error: 'Not a member of this family' });
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

    if (!(await isFamilyMember(userId, familyId))) {
      return res.json({ success: false, error: 'Not a member of this family' });
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

    if (!(await isFamilyMember(userId, familyId))) {
      return res.json({ success: false, error: 'Not a member of this family' });
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

    if (!(await isFamilyMember(userId, familyId))) {
      return res.json({ success: false, error: 'Not a member of this family' });
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

    if (!(await isFamilyMember(userId, familyId))) {
      return res.json({ success: false, error: 'Not a member of this family' });
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
