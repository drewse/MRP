/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Optional: proxy API requests in dev
  async rewrites() {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (apiBaseUrl && process.env.NODE_ENV === 'development') {
      // If API base URL is set, we'll use it directly (no proxy needed)
      return [];
    }
    // Otherwise, no rewrites
    return [];
  },
};

export default nextConfig;

