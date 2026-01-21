/**
 * Unit tests for api-client.ts
 * Tests: 401 handling, token expiry pre-check, non-JWT token handling
 * 
 * Run with: pnpm test api-client.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

// Mock window.localStorage
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// Mock crypto.subtle for hash function
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: vi.fn(async (algorithm: string, data: Uint8Array) => {
        // Simple mock hash - return a predictable hash
        const hash = new ArrayBuffer(32);
        return hash;
      }),
    },
  },
  writable: true,
});

// Mock clearAuth
const mockClearAuth = vi.fn();
vi.mock('../auth', async () => {
  const actual = await vi.importActual('../auth');
  return {
    ...actual,
    clearAuth: mockClearAuth,
    getToken: () => localStorageMock.getItem('auth_token'),
  };
});

describe('api-client auth handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    // Reset environment
    process.env.NODE_ENV = 'test';
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('401 handling with token', () => {
    it('should clear auth and throw AuthError on 401 when Authorization header was present', async () => {
      const { AuthError } = await import('../api-client');
      const { api } = await import('../api-client');
      
      // Set a valid (non-expired) token
      const validTime = Date.now() + (60 * 60 * 1000); // 1 hour from now
      const validPayload = `user123:tenant456:${validTime}:signature`;
      const validToken = Buffer.from(validPayload).toString('base64url');
      localStorageMock.setItem('auth_token', validToken);
      
      // Mock fetch to return 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized', message: 'Invalid or expired token' }),
      });

      // Call getMe (which uses apiRequest internally)
      await expect(api.getMe()).rejects.toThrow(AuthError);
      
      // Verify clearAuth was called
      expect(mockClearAuth).toHaveBeenCalledTimes(1);
      
      // Verify AuthError has correct properties
      try {
        await api.getMe();
      } catch (error: any) {
        expect(error).toBeInstanceOf(AuthError);
        expect(error.status).toBe(401);
        expect(error.code).toBe('UNAUTHORIZED');
      }
    });

    it('should NOT clear auth on 401 when Authorization header was NOT present', async () => {
      // No token set - will use header-based auth
      localStorageMock.removeItem('auth_token');
      
      // Set env vars for header-based auth
      process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG = 'dev';
      process.env.NEXT_PUBLIC_PORTAL_ADMIN_TOKEN = 'admin-token';
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
      
      // Mock fetch to return 401 (public endpoint returning 401)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      });

      const { api, AuthError } = await import('../api-client');
      
      // Should throw AuthError but NOT clear auth (no Authorization header was sent)
      await expect(api.getMe()).rejects.toThrow(AuthError);
      
      // Verify clearAuth was NOT called (no Authorization header was present)
      expect(mockClearAuth).not.toHaveBeenCalled();
    });
  });

  describe('expired JWT token pre-check', () => {
    it('should clear auth and throw AuthError for expired JWT without making fetch', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
      
      // Create an expired token (custom format: userId:tenantId:expiry:signature)
      // Expiry is in milliseconds, expired 1 hour ago
      const expiredTime = Date.now() - (60 * 60 * 1000);
      const expiredPayload = `user123:tenant456:${expiredTime}:signature`;
      const expiredToken = Buffer.from(expiredPayload).toString('base64url');
      
      localStorageMock.setItem('auth_token', expiredToken);
      
      const { api, AuthError } = await import('../api-client');
      
      // Should throw AuthError before making fetch
      await expect(api.getMe()).rejects.toThrow(AuthError);
      
      // Verify clearAuth was called
      expect(mockClearAuth).toHaveBeenCalledTimes(1);
      
      // Verify fetch was NOT called (token expired locally)
      expect(mockFetch).not.toHaveBeenCalled();
      
      // Verify error properties
      try {
        await api.getMe();
      } catch (error: any) {
        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe('TOKEN_EXPIRED');
      }
    });

    it('should clear auth for token expiring within 30 seconds', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
      
      // Create a token expiring in 20 seconds (within 30s buffer)
      const expiringTime = Date.now() + (20 * 1000);
      const expiringPayload = `user123:tenant456:${expiringTime}:signature`;
      const expiringToken = Buffer.from(expiringPayload).toString('base64url');
      
      localStorageMock.setItem('auth_token', expiringToken);
      
      const { api, AuthError } = await import('../api-client');
      
      // Should throw AuthError before making fetch
      await expect(api.getMe()).rejects.toThrow(AuthError);
      
      // Verify clearAuth was called
      expect(mockClearAuth).toHaveBeenCalledTimes(1);
      
      // Verify fetch was NOT called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('non-JWT token handling', () => {
    it('should NOT throw for non-JWT token and proceed with fetch', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
      
      // Set a non-JWT token (doesn't match our custom format)
      const nonJwtToken = 'not-a-jwt-token-just-random-string';
      localStorageMock.setItem('auth_token', nonJwtToken);
      
      // Mock fetch to return success (token might be valid for server)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: '123', email: 'test@example.com', role: 'USER', tenantId: 't1', tenantSlug: 'dev' } }),
      });

      const { api } = await import('../api-client');
      
      // Should NOT throw locally (let server verify)
      const result = await api.getMe();
      
      // Verify fetch WAS called (token passed local check)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Verify result
      expect(result.user).toBeDefined();
      
      // Verify clearAuth was NOT called (token passed local check)
      expect(mockClearAuth).not.toHaveBeenCalled();
    });

    it('should NOT throw for malformed token and proceed with fetch', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
      
      // Set a malformed token (can't decode)
      const malformedToken = 'not-base64!!!';
      localStorageMock.setItem('auth_token', malformedToken);
      
      // Mock fetch to return success (let server verify)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: '123', email: 'test@example.com', role: 'USER', tenantId: 't1', tenantSlug: 'dev' } }),
      });

      const { api } = await import('../api-client');
      
      // Should NOT throw locally (let server verify)
      await api.getMe();
      
      // Verify fetch WAS called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Verify clearAuth was NOT called
      expect(mockClearAuth).not.toHaveBeenCalled();
    });

    it('should NOT throw for token with missing expiry and proceed with fetch', async () => {
      process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
      
      // Create a token with missing expiry (only 3 parts instead of 4)
      const payloadWithoutExpiry = 'user123:tenant456:signature';
      const tokenWithoutExpiry = Buffer.from(payloadWithoutExpiry).toString('base64url');
      
      localStorageMock.setItem('auth_token', tokenWithoutExpiry);
      
      // Mock fetch to return success (let server verify)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: '123', email: 'test@example.com', role: 'USER', tenantId: 't1', tenantSlug: 'dev' } }),
      });

      const { api } = await import('../api-client');
      
      // Should NOT throw locally (let server verify)
      await api.getMe();
      
      // Verify fetch WAS called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Verify clearAuth was NOT called
      expect(mockClearAuth).not.toHaveBeenCalled();
    });
  });
});
