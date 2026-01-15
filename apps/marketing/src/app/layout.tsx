import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quickiter - Automated Code Review for GitLab',
  description: 'AI-powered code review automation for GitLab merge requests. Get instant feedback, catch bugs early, and maintain code quality.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

