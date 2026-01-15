import Link from 'next/link';

export default function PricingPage() {
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

      {/* Pricing Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Simple, transparent pricing</h1>
            <p className="text-xl text-gray-600">
              Choose the plan that fits your team
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Starter Plan */}
            <div className="bg-white border border-gray-200 rounded-lg p-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Starter</h3>
              <div className="mb-4">
                <span className="text-4xl font-bold text-gray-900">$29</span>
                <span className="text-gray-600">/month</span>
              </div>
              <p className="text-gray-600 mb-6">Perfect for small teams getting started</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Up to 10 repositories</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Unlimited merge requests</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Automated code checks</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">AI suggestions (limited)</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Email support</span>
                </li>
              </ul>
              <a
                href="https://portal.quickiter.com/login"
                className="block w-full text-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Get Started
              </a>
            </div>

            {/* Professional Plan */}
            <div className="bg-blue-50 border-2 border-blue-600 rounded-lg p-8 relative">
              <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-semibold">
                  Most Popular
                </span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Professional</h3>
              <div className="mb-4">
                <span className="text-4xl font-bold text-gray-900">$99</span>
                <span className="text-gray-600">/month</span>
              </div>
              <p className="text-gray-600 mb-6">For growing teams and organizations</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Unlimited repositories</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Unlimited merge requests</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">All automated checks</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Unlimited AI suggestions</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Custom check rules</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Priority support</span>
                </li>
              </ul>
              <a
                href="https://portal.quickiter.com/login"
                className="block w-full text-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Get Started
              </a>
            </div>

            {/* Enterprise Plan */}
            <div className="bg-white border border-gray-200 rounded-lg p-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Enterprise</h3>
              <div className="mb-4">
                <span className="text-4xl font-bold text-gray-900">Custom</span>
              </div>
              <p className="text-gray-600 mb-6">For large organizations with specific needs</p>
              <ul className="space-y-3 mb-8">
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Everything in Professional</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Self-hosted option</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">SLA guarantee</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Dedicated support</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  <span className="text-gray-600">Custom integrations</span>
                </li>
              </ul>
              <a
                href="mailto:sales@quickiter.com"
                className="block w-full text-center rounded-md bg-gray-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-700"
              >
                Contact Sales
              </a>
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

