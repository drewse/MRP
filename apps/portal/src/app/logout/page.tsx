'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    // Clear auth data
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    
    // Redirect to login
    router.push('/login');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p>Logging out...</p>
    </div>
  );
}

