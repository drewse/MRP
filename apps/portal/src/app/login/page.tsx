import { Suspense } from 'react';
import LoginClient from './LoginClient';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="p-6 text-sm text-gray-600">Loading...</div></div>}>
      <LoginClient />
    </Suspense>
  );
}
