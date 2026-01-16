'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import AuthGate from '@/components/AuthGate';

function GitLabIntegrationPageContent() {
  const [baseUrl, setBaseUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [tokenSaved, setTokenSaved] = useState(false); // Track if token was previously saved

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const config = await api.getGitLabConfig();
      setBaseUrl(config.baseUrl);
      setEnabled(config.enabled);
      setWebhookUrl(config.webhookUrl);
      setWebhookSecret(config.webhookSecret);
      
      // If token is masked (***), it means it was saved before
      if (config.token === '***') {
        setTokenSaved(true);
        setToken(''); // Don't show the actual token
      } else {
        setTokenSaved(false);
        setToken('');
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to load GitLab configuration',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await api.updateGitLabConfig({
        token: token || undefined, // Only send if provided
        baseUrl,
        enabled,
      });

      setMessage({
        type: 'success',
        text: 'GitLab configuration saved successfully!',
      });

      // If token was provided, mark it as saved
      if (token) {
        setTokenSaved(true);
        setToken(''); // Clear the input
      }

      // Reload config to get updated state
      await loadConfig();
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to save GitLab configuration',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);

    try {
      const result = await api.testGitLabConfig();
      
      if (result.success) {
        setMessage({
          type: 'success',
          text: result.message || 'Connection test successful!',
        });
      } else {
        setMessage({
          type: 'error',
          text: result.message || 'Connection test failed',
        });
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

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

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">GitLab Integration</h1>
        <p className="mt-2 text-gray-600">
          Configure your GitLab personal access token to enable automated code reviews.
        </p>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 rounded-md ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-lg shadow-md p-6 space-y-6">
        <div>
          <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700 mb-2">
            GitLab Base URL
          </label>
          <input
            id="baseUrl"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="https://gitlab.com"
          />
          <p className="mt-1 text-sm text-gray-500">
            Use <code className="bg-gray-100 px-1 rounded">https://gitlab.com</code> for GitLab.com or your self-hosted instance URL.
          </p>
        </div>

        <div>
          <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-2">
            Personal Access Token
          </label>
          {tokenSaved ? (
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value="••••••••••••••••"
                disabled
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500"
              />
              <button
                type="button"
                onClick={() => {
                  setTokenSaved(false);
                  setToken('');
                }}
                className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800"
              >
                Change
              </button>
            </div>
          ) : (
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
            />
          )}
          <p className="mt-1 text-sm text-gray-500">
            Create a personal access token with <code className="bg-gray-100 px-1 rounded">api</code> scope in your GitLab settings.
            {tokenSaved && ' Token is saved and will not be displayed.'}
          </p>
        </div>

        <div className="flex items-center">
          <input
            id="enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="enabled" className="ml-2 block text-sm text-gray-700">
            Enable GitLab integration
          </label>
        </div>

        <div className="flex space-x-4 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || (!tokenSaved && !token)}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {!tokenSaved && !token && (
          <p className="text-sm text-gray-500 italic">
            💡 Enter and save your token first, then test the connection.
          </p>
        )}
      </form>

      {/* Webhook Configuration Section */}
      <div className="mt-8 bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Webhook Configuration</h2>
        <p className="text-sm text-gray-600 mb-4">
          Configure this webhook URL in your GitLab project settings to enable automated code reviews.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook URL
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={webhookUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(webhookUrl);
                  setMessage({ type: 'success', text: 'Webhook URL copied to clipboard!' });
                  setTimeout(() => setMessage(null), 3000);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Copy
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook Secret Token
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={webhookSecret}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(webhookSecret);
                  setMessage({ type: 'success', text: 'Webhook secret copied to clipboard!' });
                  setTimeout(() => setMessage(null), 3000);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Copy
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Use this secret as the <code className="bg-gray-100 px-1 rounded">&quot;X-Gitlab-Token&quot;</code> header value in your GitLab webhook configuration.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h3 className="text-sm font-semibold text-blue-900 mb-2">GitLab Webhook Setup Instructions</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
              <li>Go to your GitLab project → Settings → Webhooks</li>
              <li>Paste the Webhook URL above</li>
              <li>Set the <code className="bg-blue-100 px-1 rounded">Secret token</code> to the Webhook Secret Token above</li>
              <li>Enable the following triggers:
                <ul className="list-disc list-inside ml-4 mt-1">
                  <li>Merge request events</li>
                </ul>
              </li>
              <li>Click &quot;Add webhook&quot;</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GitLabIntegrationPage() {
  return (
    <AuthGate>
      <GitLabIntegrationPageContent />
    </AuthGate>
  );
}

