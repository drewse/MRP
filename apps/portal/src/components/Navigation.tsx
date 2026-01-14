'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav>
      <div className="container">
        <Link href="/" className={pathname === '/' ? 'active' : ''}>
          Connect
        </Link>
        <Link
          href="/settings"
          className={pathname === '/settings' ? 'active' : ''}
        >
          Settings
        </Link>
        <Link
          href="/uploads"
          className={pathname === '/uploads' ? 'active' : ''}
        >
          Uploads
        </Link>
        <Link
          href="/reviews"
          className={pathname === '/reviews' ? 'active' : ''}
        >
          Reviews
        </Link>
      </div>
    </nav>
  );
}

