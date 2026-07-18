// Shared authentication utility for Cartly
// Handles login, signup, guest mode, and session management

const AUTH_KEY = "cartly.auth";
const USERS_KEY = "cartly.users";
const FAMILIES_KEY = "cartly.families";
const GUEST_SESSION_KEY = "cartly.guest.session";

// Get current auth state from localStorage or sessionStorage
export function getCurrentAuth() {
  try {
    // Check localStorage first (persistent login)
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      return { ...JSON.parse(stored), isGuest: false };
    }
    // Check sessionStorage (guest session)
    const guestStored = sessionStorage.getItem(GUEST_SESSION_KEY);
    if (guestStored) {
      return { ...JSON.parse(guestStored), isGuest: true };
    }
  } catch (e) {}
  return null;
}

// Check if user is authenticated
export function isAuthenticated() {
  return getCurrentAuth() !== null;
}

// Get the appropriate storage key for list data based on auth
export function getListStorageKey() {
  const auth = getCurrentAuth();
  if (!auth) return "cartly.v1";
  return auth.isGuest
    ? "cartly.guest.list"
    : `cartly.v1.family.${auth.familyCode}`;
}

// Get auth data (users and families) - only from localStorage
function getAuthData() {
  try {
    return {
      users: JSON.parse(localStorage.getItem(USERS_KEY) || "{}"),
      families: JSON.parse(localStorage.getItem(FAMILIES_KEY) || "{}"),
    };
  } catch (e) {
    return { users: {}, families: {} };
  }
}

// Save auth data to localStorage
function saveAuthData(users, families) {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    localStorage.setItem(FAMILIES_KEY, JSON.stringify(families));
  } catch (e) {}
}

// Handle user signup
export function signup(name, nickname, familyName, familyCode) {
  if (!name || !nickname || !familyName || !familyCode) {
    return { success: false, error: "All fields are required" };
  }

  if (nickname.length < 2) {
    return { success: false, error: "Nickname must be at least 2 characters" };
  }

  if (familyCode.length < 4) {
    return { success: false, error: "Family code must be at least 4 characters" };
  }

  const authData = getAuthData();

  // Check if nickname already exists
  if (authData.users[nickname]) {
    return { success: false, error: "This nickname is already taken" };
  }

  // Create family if it doesn't exist
  if (!authData.families[familyCode]) {
    authData.families[familyCode] = {
      name: familyName,
      code: familyCode,
      members: [],
    };
  }

  // Create user
  authData.users[nickname] = {
    name,
    nickname,
    familyCode,
    createdAt: new Date().toISOString(),
  };

  // Add user to family
  if (!authData.families[familyCode].members.includes(nickname)) {
    authData.families[familyCode].members.push(nickname);
  }

  saveAuthData(authData.users, authData.families);

  // Auto-login
  const user = { name, nickname, familyCode };
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));

  return { success: true, user };
}

// Handle user login
export function login(nameInput, familyCode) {
  if (!nameInput || !familyCode) {
    return {
      success: false,
      error: "Name/Nickname and Family Code are required",
    };
  }

  const authData = getAuthData();

  // Find user by name or nickname
  let user = null;
  for (const u of Object.values(authData.users)) {
    if (
      (u.name.toLowerCase() === nameInput.toLowerCase() ||
        u.nickname.toLowerCase() === nameInput.toLowerCase()) &&
      u.familyCode === familyCode
    ) {
      user = u;
      break;
    }
  }

  if (!user) {
    return { success: false, error: "Invalid name/nickname or family code" };
  }

  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  return { success: true, user };
}

// Handle guest login (session-only)
export function guestLogin() {
  const guest = {
    nickname: "Guest",
    isGuest: true,
    startedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(guest));
  return { success: true, user: guest };
}

// Handle logout
export function logout() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(GUEST_SESSION_KEY);
}

// Navigate to appropriate page based on auth state
export function enforceAuthRouting(currentPath) {
  const auth = getCurrentAuth();
  const isAuthPage = currentPath === "/login" || currentPath === "/signup" || currentPath === "/";
  const isAppPage = currentPath === "/app";

  if (auth && isAuthPage) {
    // Logged in but on auth page - redirect to app
    window.location.href = "/app";
  } else if (!auth && isAppPage) {
    // Not logged in but trying to access app - redirect to login
    window.location.href = "/login";
  }
}
