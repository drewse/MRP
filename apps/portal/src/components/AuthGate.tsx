'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api, AuthError } from '@/lib/api-client';

interface AuthGateProps {
  children: React.ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string; role: string; tenantId: string; tenantSlug: string } | null>(null);
  const hasCheckedAuth = useRef(false);
  const isDev = process.env.NODE_ENV === 'development';
  const enableDebugLogs = isDev || process.env.NEXT_PUBLIC_ENABLE_AUTH_DEBUG === 'true';

  useEffect(() => {
    // Prevent redirect loops: never redirect if already on /login
    if (pathname === '/login') {
      setLoading(false);
      return;
    }

    // Call /auth/me exactly once per mount
    if (hasCheckedAuth.current) {
      return;
    }

    async function checkAuth() {
      hasCheckedAuth.current = true;
      const token = getToken();
      const currentPath = pathname; // Capture pathname at mount time
      const currentQuery = searchParams.toString(); // Capture query params
      const currentPathWithQuery = currentQuery 
        ? `${currentPath}?${currentQuery}` 
        : currentPath;
      
      // Debug logging
      if (enableDebugLogs) {
        console.debug('[AuthGate] Starting auth check', {
          pathname: currentPath,
          query: currentQuery,
          hasToken: !!token,
          tokenLength: token?.length || 0,
          storageKey: 'auth_token',
        });
      }
      
      // No token - redirect to login (but not if already on login)
      if (!token) {
        if (enableDebugLogs) {
          console.debug('[AuthGate] No token found, redirecting to login');
        }
        setLoading(false);
        if (currentPath !== '/login') {
          const loginUrl = `/login?next=${encodeURIComponent(currentPathWithQuery)}`;
          router.push(loginUrl);
        }
        return;
      }

      // Verify token with server - call /auth/me exactly once
      // api-client handles 401 centrally (clears auth and throws AuthError)
      try {
        if (enableDebugLogs) {
          console.debug('[AuthGate] Calling /auth/me to verify token');
        }
        const response = await api.getMe();
        if (response.user) {
          if (enableDebugLogs) {
            console.debug('[AuthGate] Auth check successful', {
              userId: response.user.id,
              email: response.user.email,
            });
          }
          setUser(response.user);
          setLoading(false);
        } else {
          // Invalid token response (no user) - redirect to login
          // Note: api-client already cleared auth on 401, so we just redirect
          if (enableDebugLogs) {
            console.warn('[AuthGate] Invalid token response (no user)');
          }
          setLoading(false);
          if (currentPath !== '/login') {
            const loginUrl = `/login?next=${encodeURIComponent(currentPathWithQuery)}`;
            router.push(loginUrl);
          }
        }
      } catch (error: any) {
        // AuthError(401) means api-client already cleared auth
        // Other errors are unexpected but we still redirect to login
        if (error instanceof AuthError) {
          if (enableDebugLogs) {
            console.error('[AuthGate] AuthError caught (auth already cleared by api-client):', {
              code: error.code,
              message: error.message,
              pathname: currentPath,
            });
          }
        } else {
          // Unexpected error - log it
          const errorMessage = error?.message || 'Unknown error';
          if (enableDebugLogs) {
            console.error('[AuthGate] Unexpected error during auth check:', {
              error: errorMessage,
              pathname: currentPath,
            });
          } else {
            console.error('Auth check failed:', { error: errorMessage });
          }
        }
        
        setLoading(false);
        if (currentPath !== '/login') {
          const loginUrl = `/login?next=${encodeURIComponent(currentPathWithQuery)}`;
          router.push(loginUrl);
        }
      }
    }

    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount - call /auth/me exactly once

  // Show loading spinner while checking - DO NOT redirect while loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Only redirect to /login when loading === false AND user === null
  // Never redirect if already on /login
  if (!user && pathname !== '/login') {
    return null; // Will redirect via useEffect
  }

  return <>{children}</>;
}

