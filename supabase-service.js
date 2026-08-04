// Supabase integration for Cartly
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

const SUPABASE_URL = 'https://xxyhrhkflexpyipttmug.supabase.co';
const SUPABASE_KEY = 'sb_publishable_S18kdYcFkvHKBKjvcXXOjg_rF7qqW94';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Current user
let currentUser = null;

// Initialize from session or local storage (for mobile app backgrounding)
export async function initAuth() {
  const stored = sessionStorage.getItem('cartly.user') || localStorage.getItem('cartly.user');
  if (stored) {
    currentUser = JSON.parse(stored);
    // Always restore to sessionStorage for consistency
    sessionStorage.setItem('cartly.user', stored);
    // Validate that family_id is set for non-guest users
    if (!currentUser.id.startsWith('guest_') && !currentUser.family_id) {
      console.warn('WARNING: User restored but family_id is missing. This will cause issues.', { currentUser });
    }
  }

  return currentUser;
}

// Sign up with family code
export async function signupWithFamilyCode(email, nickname, password, familyCode) {
  try {
    // Normalize familyCode - treat empty string as no code
    const normalizedCode = familyCode && familyCode.trim() ? familyCode.trim() : null;

    // Check the code BEFORE creating an account. Supabase keeps an auth user the
    // moment signUp succeeds, so failing after that point burns the email address
    // — the next attempt is rejected as already registered.
    if (normalizedCode) {
      const validateResp = await fetch('/api/validate-family-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyCode: normalizedCode })
      });
      const validateResult = await validateResp.json();

      if (!validateResult.success || !validateResult.exists) {
        return { success: false, error: 'That family code does not exist. Check it and try again.' };
      }
    }

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });

    let userId = authData && authData.user ? authData.user.id : null;

    if (authError) {
      const alreadyRegistered = /already registered|already exists|user already/i.test(authError.message || '');
      if (!alreadyRegistered) throw authError;

      // The address may belong to an account whose profile never got written
      // (see /api/complete-signup). Signing in lets us finish the job; if the
      // password is wrong it is simply an existing account.
      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInError || !signInData || !signInData.user) {
        return {
          success: false,
          error: 'This email already has an account. Sign in instead, or use "Forgot password" if you cannot get in.'
        };
      }
      userId = signInData.user.id;
    }

    if (!userId) throw new Error('Could not determine the new user id');

    // Resolve the family and write the profile with the service key.
    const completeResp = await fetch('/api/complete-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, email, nickname, familyCode: normalizedCode })
    });
    const complete = await completeResp.json();

    if (!complete.success) throw new Error(complete.error || 'Could not finish creating your account');

    // Nice to have for anything reading the JWT, but the users row above is the
    // source of truth — and this needs a session, which email confirmation delays.
    const { error: metaError } = await supabase.auth.updateUser({ data: { family_id: complete.familyId } });
    if (metaError) console.warn('Could not set auth metadata (non-fatal):', metaError.message);

    currentUser = { id: userId, email, nickname, family_id: complete.familyId };
    const userJson = JSON.stringify(currentUser);
    sessionStorage.setItem('cartly.user', userJson);
    localStorage.setItem('cartly.user', userJson);

    return { success: true, user: currentUser, familyCode: complete.familyCode };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Login with email + password
export async function loginWithPassword(email, password) {
  try {
    // Sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) throw authError;

    const userId = authData.user.id;

    // Fetch user profile to get family_id and nickname
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('id, family_id, nickname')
      .eq('id', userId)
      .single();

    if (userError || !userProfile) throw new Error('User profile not found');

    // Best-effort: the users row we just read is the source of truth, so a
    // metadata write that fails must not stop someone signing in.
    const { error: metaError } = await supabase.auth.updateUser({
      data: { family_id: userProfile.family_id }
    });

    if (metaError) console.warn('Could not set auth metadata on login (non-fatal):', metaError.message);
    else console.log('✓ Auth metadata set on login with family_id:', userProfile.family_id);

    currentUser = { id: userId, email, nickname: userProfile.nickname, family_id: userProfile.family_id };
    sessionStorage.setItem('cartly.user', JSON.stringify(currentUser));

    return { success: true, user: currentUser };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Login with email + family code (deprecated, kept for reference)
export async function loginWithFamilyCode(email, familyCode) {
  try {
    // Get user by email from users table (since Supabase Auth doesn't let us query by email directly)
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, family_id, nickname')
      .eq('email', email)
      .single();

    if (userError || !users) throw new Error('User not found');

    // Check if family code matches
    const { data: family, error: familyError } = await supabase
      .from('families')
      .select('family_code')
      .eq('id', users.family_id)
      .single();

    if (familyError || family.family_code !== familyCode) {
      throw new Error('Invalid family code');
    }

    currentUser = { id: users.id, email, nickname: users.nickname, family_id: users.family_id };
    sessionStorage.setItem('cartly.user', JSON.stringify(currentUser));

    return { success: true, user: currentUser };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Guest login
export function guestLogin() {
  currentUser = { id: 'guest_' + Date.now(), email: 'guest@cartly.local', nickname: 'Guest', family_id: null };
  sessionStorage.setItem('cartly.user', JSON.stringify(currentUser));
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

// Family code, name and member list for the header's family button.
export async function getFamilyInfo() {
  if (!currentUser || currentUser.id.startsWith('guest_') || !currentUser.family_id) return null;

  try {
    const response = await fetch(`/api/family/${currentUser.family_id}`);
    const result = await response.json();

    if (!result.success) {
      console.error('Error fetching family info:', result.error);
      return null;
    }

    return {
      familyCode: result.familyCode,
      familyName: result.familyName,
      members: result.members || []
    };
  } catch (error) {
    console.error('ERROR: Failed to fetch family info:', error.message);
    return null;
  }
}

export async function updateFamilyName(familyName) {
  if (!currentUser || currentUser.id.startsWith('guest_') || !currentUser.family_id) {
    throw new Error('Not signed in to a family');
  }

  const response = await fetch(`/api/family/${currentUser.family_id}/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ familyName, userId: currentUser.id })
  });

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Failed to rename family');
  }

  return result.familyName;
}

export function logout() {
  currentUser = null;
  sessionStorage.removeItem('cartly.user');
  localStorage.removeItem('cartly.user');
}

// Request password reset email
export async function requestPasswordReset(email) {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Update password with reset token
export async function updatePasswordWithToken(newPassword, token) {
  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function generateFamilyCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Data operations
export async function getListItems() {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).items || [] : [];
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot fetch items - family_id is missing from currentUser', { currentUser });
    return [];
  }

  const { data, error } = await supabase
    .from('list_items')
    .select('*')
    .eq('family_id', currentUser.family_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching items:', error, { family_id: currentUser.family_id });
    // Fallback to family-specific localStorage if Supabase fails
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).items || [] : [];
  }

  // The query succeeded, so an empty result means the family list really is
  // empty. Falling back to localStorage here would resurrect every item this
  // device had cached the moment someone else cleared the list.
  return (data || []).map(item => ({
    id: item.id,
    name: item.name,
    qty: item.quantity == null ? '' : String(item.quantity),
    category: item.category,
    emoji: item.emoji,
    checked: item.checked,
    source: item.source || '',
    img: item.img || '',
    inStock: false
  }));
}

export async function getInventoryItems() {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).inventory || [] : [];
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot fetch inventory - family_id is missing from currentUser', { currentUser });
    return [];
  }

  const { data, error } = await supabase
    .from('home_inventory')
    .select('*')
    .eq('family_id', currentUser.family_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching inventory:', error, { family_id: currentUser.family_id });
    // Fallback to family-specific localStorage if Supabase fails
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored).inventory || [] : [];
  }

  // As above: a successful query returning nothing means the family's home
  // inventory is empty, not that the read failed.
  return (data || []).map(item => ({
    id: item.id,
    name: item.name,
    qty: item.quantity == null ? '' : String(item.quantity),
    unit: item.unit || '',
    expiry: item.expiry || '',
    // Deployments whose home_inventory predates these columns return undefined;
    // app.html re-derives category/emoji from the name in that case.
    category: item.category || '',
    emoji: item.emoji || '',
    img: item.img || ''
  }));
}

export async function addListItem(item) {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    return addItemLocalStorage(item);
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot add item - family_id is not set', { currentUser });
    throw new Error('Family ID not set. Please log in again.');
  }

  // Validate family_id is a valid UUID format
  if (!isValidUUID(currentUser.family_id)) {
    console.error('ERROR: Invalid family_id format', { family_id: currentUser.family_id });
    throw new Error('Invalid family configuration. Please log in again.');
  }

  try {
    const response = await fetch('/api/add-item', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        item,
        userId: currentUser.id,
        familyId: currentUser.family_id
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('Error adding item via API:', result.error, { family_id: currentUser.family_id });
      throw new Error(result.error || 'Failed to add item');
    }

    console.log('✓ Item saved to Supabase via API with family_id:', currentUser.family_id);
    return result.data?.[0];
  } catch (error) {
    console.error('ERROR: Failed to save item:', error.message, { family_id: currentUser.family_id });
    throw error;
  }
}

export async function updateListItem(id, updates) {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    return updateItemLocalStorage(id, updates);
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot update item - family_id is not set', { currentUser });
    throw new Error('Family ID not set. Please log in again.');
  }

  try {
    const response = await fetch(`/api/update-item/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        updates,
        userId: currentUser.id,
        familyId: currentUser.family_id
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('Error updating item via API:', result.error, { family_id: currentUser.family_id });
      throw new Error(result.error || 'Failed to update item');
    }
  } catch (error) {
    console.error('ERROR: Failed to update item:', error.message, { family_id: currentUser.family_id });
    throw error;
  }
}

export async function deleteListItem(id) {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    return deleteItemLocalStorage(id);
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot delete item - family_id is not set', { currentUser });
    throw new Error('Family ID not set. Please log in again.');
  }

  try {
    const response = await fetch(`/api/delete-item/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: currentUser.id,
        familyId: currentUser.family_id
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('Error deleting item via API:', result.error, { family_id: currentUser.family_id });
      throw new Error(result.error || 'Failed to delete item');
    }
  } catch (error) {
    console.error('ERROR: Failed to delete item:', error.message, { family_id: currentUser.family_id });
    throw error;
  }
}

// Subscribe to real-time updates (Realtime API v2)
export function subscribeToListUpdates(callback) {
  if (!currentUser || currentUser.id.startsWith('guest_')) return;

  try {
    const channel = supabase
      .channel(`list_items:family_id=eq.${currentUser.family_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'list_items',
          filter: `family_id=eq.${currentUser.family_id}`
        },
        callback
      )
      .subscribe();

    return channel;
  } catch(e) {
    console.error('Realtime subscription error:', e);
  }
}

// Subscribe to inventory real-time updates
export function subscribeToInventoryUpdates(callback) {
  if (!currentUser || currentUser.id.startsWith('guest_')) return;

  try {
    const channel = supabase
      .channel(`home_inventory:family_id=eq.${currentUser.family_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'home_inventory',
          filter: `family_id=eq.${currentUser.family_id}`
        },
        callback
      )
      .subscribe();

    return channel;
  } catch(e) {
    console.error('Inventory realtime subscription error:', e);
  }
}

// Guest/localStorage fallbacks - use family_id in key to isolate per family
// MUST match getStorageKeyFallback() in app.html to avoid key mismatches!
export function getStorageKey() {
  if(currentUser && currentUser.family_id) {
    return `cartly.v1.${currentUser.family_id}`;
  }
  if(currentUser && currentUser.id && currentUser.id.startsWith('guest_')) {
    return 'cartly.v1.guest';
  }
  // Not logged in yet - use default key
  return 'cartly.v1';
}

function addItemLocalStorage(item) {
  const key = getStorageKey();
  let state = JSON.parse(localStorage.getItem(key) || '{"items":[]}');
  state.items.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ...item
  });
  localStorage.setItem(key, JSON.stringify(state));
}

function updateItemLocalStorage(id, updates) {
  const key = getStorageKey();
  let state = JSON.parse(localStorage.getItem(key) || '{"items":[]}');
  const item = state.items.find(i => i.id === id);
  if (item) Object.assign(item, updates);
  localStorage.setItem(key, JSON.stringify(state));
}

function deleteItemLocalStorage(id) {
  const key = getStorageKey();
  let state = JSON.parse(localStorage.getItem(key) || '{"items":[]}');
  state.items = state.items.filter(i => i.id !== id);
  localStorage.setItem(key, JSON.stringify(state));
}

// Inventory sync functions (Home section)
export async function addInventoryItem(item) {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    return addInventoryLocalStorage(item);
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot add inventory - family_id is not set', { currentUser });
    throw new Error('Family ID not set. Please log in again.');
  }

  try {
    const response = await fetch('/api/add-inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item,
        userId: currentUser.id,
        familyId: currentUser.family_id
      })
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to add inventory item');
    }
    console.log('✓ Inventory item saved to Supabase');
    return result.data?.[0];
  } catch (error) {
    console.error('ERROR: Failed to save inventory item:', error.message);
    throw error;
  }
}

export async function updateInventoryItem(id, updates) {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    return updateInventoryLocalStorage(id, updates);
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot update inventory - family_id is not set', { currentUser });
    throw new Error('Family ID not set. Please log in again.');
  }

  try {
    const response = await fetch(`/api/update-inventory/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates,
        userId: currentUser.id,
        familyId: currentUser.family_id
      })
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to update inventory item');
    }
    console.log('✓ Inventory item updated in Supabase');
  } catch (error) {
    console.error('ERROR: Failed to update inventory item:', error.message);
    throw error;
  }
}

export async function deleteInventoryItem(id) {
  if (!currentUser || currentUser.id.startsWith('guest_')) {
    return deleteInventoryLocalStorage(id);
  }

  if (!currentUser.family_id) {
    console.error('ERROR: Cannot delete inventory - family_id is not set', { currentUser });
    throw new Error('Family ID not set. Please log in again.');
  }

  try {
    const response = await fetch(`/api/delete-inventory/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        familyId: currentUser.family_id
      })
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete inventory item');
    }
    console.log('✓ Inventory item deleted from Supabase');
  } catch (error) {
    console.error('ERROR: Failed to delete inventory item:', error.message);
    throw error;
  }
}

// Inventory localStorage fallbacks
function addInventoryLocalStorage(item) {
  const key = getStorageKey();
  let state = JSON.parse(localStorage.getItem(key) || '{"items":[]}');
  if (!Array.isArray(state.inventory)) state.inventory = [];
  state.inventory.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ...item });
  localStorage.setItem(key, JSON.stringify(state));
}

function updateInventoryLocalStorage(id, updates) {
  const key = getStorageKey();
  let state = JSON.parse(localStorage.getItem(key) || '{"items":[]}');
  if (!Array.isArray(state.inventory)) state.inventory = [];
  const item = state.inventory.find(i => i.id === id);
  if (item) Object.assign(item, updates);
  localStorage.setItem(key, JSON.stringify(state));
}

function deleteInventoryLocalStorage(id) {
  const key = getStorageKey();
  let state = JSON.parse(localStorage.getItem(key) || '{"items":[]}');
  if (!Array.isArray(state.inventory)) state.inventory = [];
  state.inventory = state.inventory.filter(i => i.id !== id);
  localStorage.setItem(key, JSON.stringify(state));
}
