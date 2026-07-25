// Supabase integration for Cartly
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

const SUPABASE_URL = 'https://xxyhrhkflexpyipttmug.supabase.co';
const SUPABASE_KEY = 'sb_publishable_S18kdYcFkvHKBKjvcXXOjg_rF7qqW94';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Current user
let currentUser = null;

// Initialize from session storage
export async function initAuth() {
  const stored = sessionStorage.getItem('cartly.user');
  if (stored) {
    currentUser = JSON.parse(stored);
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
    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    const userId = authData.user.id;

    // Find or create family by code
    let familyId;
    if (familyCode) {
      // Join existing family
      const { data: families, error: familyError } = await supabase
        .from('families')
        .select('id')
        .eq('family_code', familyCode)
        .single();

      if (familyError) throw new Error('Invalid family code');
      familyId = families.id;
    } else {
      // Create new family
      const newCode = generateFamilyCode();
      const { data: newFamily, error: createError } = await supabase
        .from('families')
        .insert([{ family_code: newCode, created_by: userId, family_name: `${nickname}'s family` }])
        .select('id')
        .single();

      if (createError) throw createError;
      familyId = newFamily.id;
    }

    // Update auth user metadata with family_id
    const { error: metaError } = await supabase.auth.updateUser({
      data: { family_id: familyId }
    });

    if (metaError) throw metaError;

    // Create user profile
    const { error: userError } = await supabase
      .from('users')
      .insert([{ id: userId, email, nickname, family_id: familyId }]);

    if (userError) throw userError;

    currentUser = { id: userId, email, nickname, family_id: familyId };
    sessionStorage.setItem('cartly.user', JSON.stringify(currentUser));

    return { success: true, user: currentUser, familyCode };
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

    // Update auth metadata with family_id for RLS policies
    await supabase.auth.updateUser({
      data: { family_id: userProfile.family_id }
    });

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

export function logout() {
  currentUser = null;
  sessionStorage.removeItem('cartly.user');
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

// Data operations
export async function getListItems() {
  if (!currentUser || currentUser.id === 'guest_' + currentUser.id.match(/\d+$/)?.[0]) {
    const stored = localStorage.getItem('cartly.v1');
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
    return [];
  }

  return (data || []).map(item => ({
    id: item.id,
    name: item.name,
    qty: item.quantity || '',
    category: item.category,
    emoji: item.emoji,
    checked: item.checked,
    source: item.source || '',
    img: item.img || '',
    inStock: false
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

  const { error } = await supabase
    .from('list_items')
    .insert([{
      family_id: currentUser.family_id,
      name: item.name,
      quantity: item.qty,
      category: item.category,
      emoji: item.emoji,
      checked: item.checked || false,
      source: item.source || '',
      updated_by: currentUser.id
    }]);

  if (error) {
    console.error('Error adding item:', error, { family_id: currentUser.family_id });
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

  const { error } = await supabase
    .from('list_items')
    .update({
      ...updates,
      updated_by: currentUser.id,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('family_id', currentUser.family_id);

  if (error) {
    console.error('Error updating item:', error, { family_id: currentUser.family_id });
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

  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('id', id)
    .eq('family_id', currentUser.family_id);

  if (error) {
    console.error('Error deleting item:', error, { family_id: currentUser.family_id });
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

// Guest/localStorage fallbacks
function addItemLocalStorage(item) {
  let state = JSON.parse(localStorage.getItem('cartly.v1') || '{"items":[]}');
  state.items.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ...item
  });
  localStorage.setItem('cartly.v1', JSON.stringify(state));
}

function updateItemLocalStorage(id, updates) {
  let state = JSON.parse(localStorage.getItem('cartly.v1') || '{"items":[]}');
  const item = state.items.find(i => i.id === id);
  if (item) Object.assign(item, updates);
  localStorage.setItem('cartly.v1', JSON.stringify(state));
}

function deleteItemLocalStorage(id) {
  let state = JSON.parse(localStorage.getItem('cartly.v1') || '{"items":[]}');
  state.items = state.items.filter(i => i.id !== id);
  localStorage.setItem('cartly.v1', JSON.stringify(state));
}
