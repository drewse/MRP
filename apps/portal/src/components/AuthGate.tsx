'use client';

import { useEffect, useState } from 'react';
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
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const token = getToken();
      
      // No token - redirect to login
      if (!token) {
        const loginUrl = `/login?next=${encodeURIComponent(pathname)}`;
        router.push(loginUrl);
        return;
      }

      // Verify token with server
      try {
        const response = await api.getMe();
        if (response.user) {
          setAuthenticated(true);
          setLoading(false);
        } else {
          // Invalid token - redirect to login
          const loginUrl = `/login?next=${encodeURIComponent(pathname)}`;
          router.push(loginUrl);
        }
      } catch (error) {
        // Token invalid or expired - redirect to login
        console.error('Auth check failed:', error);
        const loginUrl = `/login?next=${encodeURIComponent(pathname)}`;
        router.push(loginUrl);
      }
    }

    checkAuth();
  }, [router, pathname]);

  // Show loading spinner while checking
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

  // Only render children if authenticated
  if (!authenticated) {
    return null;
  }

  return <>{children}</>;
}

