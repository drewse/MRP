'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { clearAuth } from '@/lib/auth';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    // Clear auth data using single source of truth
    clearAuth();
    
    // Redirect to login
    router.push('/login');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p>Logging out...</p>
    </div>
  );
}

