'use client';

import { useState, useEffect } from 'react';
import { api, getStoredConfig, type TenantSettings } from '@/lib/api-client';

export default function SettingsPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [allowedExtensions, setAllowedExtensions] = useState('');
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(0);
  const [allowedMimePrefixes, setAllowedMimePrefixes] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const config = getStoredConfig();
    if (!config) {
      setMessage({ type: 'error', text: 'Please configure connection first' });
      setLoading(false);
      return;
    }

    try {
      const data = await api.getSettings();
      setSettings(data);
      setAllowedExtensions(data.allowedExtensions.join(', '));
      setMaxFileSizeMB(Math.round(data.maxFileSizeBytes / (1024 * 1024)));
      setAllowedMimePrefixes(data.allowedMimePrefixes.join(', '));
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to load settings',
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
      // Normalize extensions (lowercase, trim, filter empty)
      const extensions = allowedExtensions
        .split(',')
        .map((ext) => ext.trim().toLowerCase())
        .filter((ext) => ext.length > 0)
        .map((ext) => ext.replace(/^\./, '')); // Remove leading dots

      // Normalize MIME prefixes
      const mimePrefixes = allowedMimePrefixes
        .split(',')
        .map((prefix) => prefix.trim())
        .filter((prefix) => prefix.length > 0);

      const updated = await api.updateSettings({
        allowedExtensions: extensions,
        maxFileSizeBytes: maxFileSizeMB * 1024 * 1024,
        allowedMimePrefixes: mimePrefixes,
      });

      setSettings(updated);
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to save settings',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading settings...</div>;
  }

  if (!settings) {
    return (
      <div>
        <h1>Settings</h1>
        <div className="alert error">
          Please configure your connection on the Connect page first.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Settings</h1>
      <form onSubmit={handleSave}>
        <div className="form-group">
          <label htmlFor="allowedExtensions">Allowed Extensions</label>
          <input
            id="allowedExtensions"
            type="text"
            value={allowedExtensions}
            onChange={(e) => setAllowedExtensions(e.target.value)}
            placeholder="pdf, docx, txt, md"
          />
          <small style={{ display: 'block', marginTop: '0.5rem', color: '#666' }}>
            Comma-separated list (e.g., pdf, docx, txt). Leading dots are automatically removed.
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="maxFileSizeMB">Max File Size (MB)</label>
          <input
            id="maxFileSizeMB"
            type="number"
            value={maxFileSizeMB}
            onChange={(e) => setMaxFileSizeMB(Number(e.target.value))}
            min="1"
            max="200"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="allowedMimePrefixes">Allowed MIME Prefixes</label>
          <input
            id="allowedMimePrefixes"
            type="text"
            value={allowedMimePrefixes}
            onChange={(e) => setAllowedMimePrefixes(e.target.value)}
            placeholder="text/, application/"
          />
          <small style={{ display: 'block', marginTop: '0.5rem', color: '#666' }}>
            Comma-separated list (e.g., text/, application/). Must end with /.
          </small>
        </div>

        {message && (
          <div className={`alert ${message.type}`}>{message.text}</div>
        )}

        <button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

