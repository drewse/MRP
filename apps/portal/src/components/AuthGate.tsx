'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { api } from '@/lib/api-client';

interface AuthGateProps {
  children: React.ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string; role: string; tenantId: string; tenantSlug: string } | null>(null);
  const hasCheckedAuth = useRef(false);

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
      
      // No token - redirect to login (but not if already on login)
      if (!token) {
        setLoading(false);
        if (currentPath !== '/login') {
          const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
          router.push(loginUrl);
        }
        return;
      }

      // Verify token with server - call /auth/me exactly once
      try {
        const response = await api.getMe();
        if (response.user) {
          setUser(response.user);
          setLoading(false);
        } else {
          // Invalid token - redirect to login
          setLoading(false);
          if (currentPath !== '/login') {
            const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
            router.push(loginUrl);
          }
        }
      } catch (error) {
        // Token invalid or expired - redirect to login
        console.error('Auth check failed:', error);
        setLoading(false);
        if (currentPath !== '/login') {
          const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
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

