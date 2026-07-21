import { supabase } from './supabase';

// Generate a random family code (6 alphanumeric characters)
function generateFamilyCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Sign up with email and password, create family
export async function signup(email, nickname, password) {
  try {
    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create user');

    // Create user profile
    const familyCode = generateFamilyCode();

    // First create the family
    const { data: familyData, error: familyError } = await supabase
      .from('families')
      .insert([
        {
          family_code: familyCode,
          family_name: `${nickname}'s Family`,
          created_by: authData.user.id,
        }
      ])
      .select()
      .single();

    if (familyError) throw familyError;

    // Then create the user profile with family_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          email,
          nickname,
          family_id: familyData.id,
        }
      ])
      .select()
      .single();

    if (userError) throw userError;

    return {
      success: true,
      user: userData,
      family: familyData,
      familyCode,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Sign in with email and password
export async function login(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Fetch user profile with family info
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*, families(*)')
      .eq('id', data.user.id)
      .single();

    if (userError) throw userError;

    return {
      success: true,
      user: userData,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Join existing family with family code
export async function joinFamily(email, nickname, password, familyCode) {
  try {
    // First, find the family with this code
    const { data: familyData, error: familyError } = await supabase
      .from('families')
      .select('id')
      .eq('family_code', familyCode.toUpperCase())
      .single();

    if (familyError || !familyData) {
      throw new Error('Invalid family code');
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('Failed to create user');

    // Create user profile with the family
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user.id,
          email,
          nickname,
          family_id: familyData.id,
        }
      ])
      .select()
      .single();

    if (userError) throw userError;

    return {
      success: true,
      user: userData,
      family: familyData,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Get current user session
export async function getCurrentUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) return null;

    // Fetch full user profile with family
    const { data: userData } = await supabase
      .from('users')
      .select('*, families(*)')
      .eq('id', user.id)
      .single();

    return userData;
  } catch (error) {
    console.error('Error fetching current user:', error);
    return null;
  }
}

// Sign out
export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
