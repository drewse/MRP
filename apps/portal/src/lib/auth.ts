/**
 * Authentication helpers for portal
 */

const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth_token',
  USER: 'user',
} as const;

export interface User {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  tenantSlug: string;
}

/**
 * Get auth token from localStorage
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
}

/**
 * Get current user from localStorage
 */
export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  const userStr = localStorage.getItem(STORAGE_KEYS.USER);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr) as User;
  } catch {
    return null;
  }
}

/**
 * Set auth token and user
 */
export function setAuth(token: string, user: User): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
}

/**
 * Clear auth data
 */
export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
}

/**
 * Check if user is authenticated (has token)
 */
export function isAuthenticated(): boolean {
  return !!getToken();
}

