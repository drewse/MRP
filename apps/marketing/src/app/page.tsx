import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">Quickiter</h1>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                href="/pricing"
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Pricing
              </Link>
              <Link
                href="/security"
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium"
              >
                Security
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

      {/* Hero Section */}
      <section className="relative bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
          <div className="text-center">
            <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 mb-6">
              Automated Code Review
              <br />
              <span className="text-blue-600">for GitLab</span>
            </h1>
            <p className="mt-6 text-xl text-gray-600 max-w-3xl mx-auto">
              Get instant, AI-powered feedback on your merge requests. Catch bugs early,
              maintain code quality, and ship with confidence.
            </p>
            <div className="mt-10 flex items-center justify-center gap-x-6">
              <a
                href="https://portal.quickiter.com/login"
                className="rounded-md bg-blue-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Get Started
              </a>
              <a
                href="#demo"
                className="text-base font-semibold leading-7 text-gray-900 hover:text-gray-700"
              >
                See Demo <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Product Features */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              Everything you need for better code reviews
            </h2>
            <p className="text-lg text-gray-600">
              Automated checks, AI suggestions, and actionable feedback
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="text-blue-600 text-3xl mb-4">⚡</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Instant Feedback
              </h3>
              <p className="text-gray-600">
                Get automated code review results within seconds of opening a merge request.
                No waiting, no delays.
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="text-blue-600 text-3xl mb-4">🤖</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                AI-Powered Suggestions
              </h3>
              <p className="text-gray-600">
                Leverage AI to catch subtle bugs, suggest improvements, and learn from
                your codebase's best practices.
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="text-blue-600 text-3xl mb-4">🔒</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Privacy-First
              </h3>
              <p className="text-gray-600">
                Your code never leaves your infrastructure. All processing happens securely
                with full tenant isolation.
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="text-blue-600 text-3xl mb-4">📊</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Comprehensive Checks
              </h3>
              <p className="text-gray-600">
                Automated checks for security, performance, style, and best practices.
                Customizable rules per tenant.
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="text-blue-600 text-3xl mb-4">🔗</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                GitLab Native
              </h3>
              <p className="text-gray-600">
                Seamless integration with GitLab. Works with GitLab.com and self-hosted
                instances via webhooks.
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="text-blue-600 text-3xl mb-4">📈</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Actionable Insights
              </h3>
              <p className="text-gray-600">
                Get clear, prioritized feedback with file paths, line numbers, and
                suggested fixes. No noise, just signal.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Demo Section */}
      <section id="demo" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">See it in action</h2>
            <p className="text-lg text-gray-600">
              Watch how Quickiter reviews your code automatically
            </p>
          </div>

          <div className="bg-gray-100 rounded-lg p-8 flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="text-6xl mb-4">📹</div>
              <p className="text-gray-600 text-lg">Demo video coming soon</p>
              <p className="text-gray-500 text-sm mt-2">
                Screenshots and video walkthrough will be added here
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-blue-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to improve your code reviews?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join teams using Quickiter to ship better code, faster.
          </p>
          <div className="flex items-center justify-center gap-x-6">
            <a
              href="https://portal.quickiter.com/login"
              className="rounded-md bg-white px-6 py-3 text-base font-semibold text-blue-600 shadow-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Get Started
            </a>
            <a
              href="/pricing"
              className="text-base font-semibold leading-7 text-white hover:text-blue-100"
            >
              View Pricing <span aria-hidden="true">→</span>
            </a>
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
                  <a href="#demo" className="hover:text-white">
                    Features
                  </a>
                </li>
                <li>
                  <a href="/pricing" className="hover:text-white">
                    Pricing
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="/security" className="hover:text-white">
                    Security
                  </a>
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

