import Link from 'next/link';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">Quickiter</h1>
            </Link>
            <div className="flex items-center space-x-4">
              <Link
                href="/"
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Home
              </Link>
              <Link
                href="/pricing"
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Pricing
              </Link>
              <a
                href="https://portal.quickiter.com/login"
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
              >
                Login
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Security Content */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Security & Privacy</h1>
            <p className="text-xl text-gray-600">
              Your code and data are protected with enterprise-grade security
            </p>
          </div>

          <div className="prose prose-lg max-w-none">
            <div className="bg-gray-50 rounded-lg p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Data Protection</h2>
              <ul className="space-y-3 text-gray-700">
                <li>
                  <strong>Tenant Isolation:</strong> All data is strictly isolated by tenant.
                  Your code and review results are never accessible to other tenants.
                </li>
                <li>
                  <strong>Encryption in Transit:</strong> All API communications use TLS 1.3 encryption.
                </li>
                <li>
                  <strong>Encryption at Rest:</strong> Sensitive data such as GitLab tokens and
                  webhook secrets are encrypted in the database.
                </li>
                <li>
                  <strong>No Code Storage:</strong> Your source code is processed in memory only.
                  We never store your code permanently.
                </li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Authentication & Access</h2>
              <ul className="space-y-3 text-gray-700">
                <li>
                  <strong>JWT-Based Authentication:</strong> Secure token-based authentication
                  with configurable expiration.
                </li>
                <li>
                  <strong>Role-Based Access:</strong> Support for owner, admin, and member roles
                  with granular permissions.
                </li>
                <li>
                  <strong>Webhook Security:</strong> Each tenant has a unique webhook secret
                  for secure GitLab integration.
                </li>
                <li>
                  <strong>Password Security:</strong> Passwords are hashed using industry-standard
                  algorithms (SHA-256, with plans for bcrypt/argon2).
                </li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-8 mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Infrastructure</h2>
              <ul className="space-y-3 text-gray-700">
                <li>
                  <strong>Hosting:</strong> Deployed on Railway with enterprise-grade infrastructure.
                </li>
                <li>
                  <strong>Database:</strong> PostgreSQL with automated backups and point-in-time recovery.
                </li>
                <li>
                  <strong>Monitoring:</strong> Comprehensive logging and monitoring for security events.
                </li>
                <li>
                  <strong>Compliance:</strong> Regular security audits and compliance reviews.
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Reporting Security Issues</h2>
              <p className="text-gray-700 mb-4">
                If you discover a security vulnerability, please report it to{' '}
                <a href="mailto:security@quickiter.com" className="text-blue-600 hover:text-blue-800">
                  security@quickiter.com
                </a>
                . We take security seriously and will respond promptly.
              </p>
              <p className="text-sm text-gray-600">
                Please do not publicly disclose vulnerabilities until we have had a chance to address them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-white text-lg font-semibold mb-4">Quickiter</h3>
              <p className="text-sm">
                Automated code review for GitLab merge requests.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/" className="hover:text-white">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="/pricing" className="hover:text-white">
                    Pricing
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="/security" className="hover:text-white">
                    Security
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Account</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a
                    href="https://portal.quickiter.com/login"
                    className="hover:text-white"
                  >
                    Login
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-800 text-center text-sm">
            <p>&copy; {new Date().getFullYear()} Quickiter. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

