'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getStoredConfig } from '@/lib/api-client';

interface MergeRequest {
  id: string;
  iid: number;
  title: string;
  state: string;
  webUrl: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  repository: {
    id: string;
    name: string;
    namespace: string;
    projectId: string | null;
  };
  latestReview: {
    id: string;
    status: string;
    score: number | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
}

function ReviewsPageContent() {
  const router = useRouter();
  const [mergeRequests, setMergeRequests] = useState<MergeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mrUrl, setMrUrl] = useState('');
  const [processingUrl, setProcessingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const loadData = async (signal?: AbortSignal) => {
    const config = getStoredConfig();
    if (!config) {
      setError('Please configure your connection on the Connect page first.');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await api.getMergeRequests({ limit: 50, offset: 0 }, signal);
      
      // Only update if component is still mounted
      if (isMountedRef.current) {
        setMergeRequests(data.mergeRequests);
        setLastUpdated(new Date());
      }
    } catch (err: any) {
      // Ignore abort errors
      if (err.name === 'AbortError') return;
      
      if (isMountedRef.current) {
        console.error('Failed to load merge requests:', err);
        setError(
          err.message || 'Failed to load merge requests. Please check your connection.'
        );
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    
    // Initial load
    abortControllerRef.current = new AbortController();
    loadData(abortControllerRef.current.signal);

    // Set up auto-refresh polling every 10 seconds
    pollingIntervalRef.current = setInterval(() => {
      // Abort previous request if still in flight
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      loadData(abortControllerRef.current.signal);
    }, 10000);

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    // Abort any in-flight request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    loadData(abortControllerRef.current.signal);
  };

  /**
   * Parse GitLab MR URL to extract project path/ID and MR IID
   * Supports formats:
   * - https://gitlab.com/group/subgroup/repo/-/merge_requests/123
   * - https://gitlab.com/group/subgroup/repo/merge_requests/123
   * - https://gitlab.com/group/subgroup/repo/-/merge_requests/123/diffs
   * - https://gitlab.com/group/subgroup/repo/-/merge_requests/123#note_456
   */
  const parseGitLabMrUrl = (url: string): { projectPath: string | null; projectId: string | null; mrIid: number | null } => {
    try {
      const urlObj = new URL(url);
      
      // Extract MR IID from path
      // Pattern: /group/subgroup/repo/-/merge_requests/123 or /group/subgroup/repo/merge_requests/123
      const mrMatch = urlObj.pathname.match(/\/merge_requests\/(\d+)/);
      if (!mrMatch) {
        return { projectPath: null, projectId: null, mrIid: null };
      }
      
      const mrIid = parseInt(mrMatch[1], 10);
      if (isNaN(mrIid) || mrIid < 1) {
        return { projectPath: null, projectId: null, mrIid: null };
      }
      
      // Extract project path (everything before /merge_requests)
      const pathBeforeMr = urlObj.pathname.split('/merge_requests')[0];
      // Remove leading slash and trailing /- if present
      const projectPath = pathBeforeMr.replace(/^\/+/, '').replace(/\/-$/, '');
      
      // Check if projectPath is numeric (projectId)
      const numericProjectId = /^\d+$/.test(projectPath);
      
      if (numericProjectId) {
        return { projectPath: null, projectId: projectPath, mrIid };
      } else if (projectPath) {
        return { projectPath, projectId: null, mrIid };
      }
      
      return { projectPath: null, projectId: null, mrIid: null };
    } catch {
      return { projectPath: null, projectId: null, mrIid: null };
    }
  };

  const handlePasteMrUrl = async () => {
    if (!mrUrl.trim()) {
      setUrlError('Please enter a GitLab MR URL');
      return;
    }

    setProcessingUrl(true);
    setUrlError(null);
    setError(null);

    try {
      const config = getStoredConfig();
      if (!config) {
        setUrlError('Please configure your connection on the Connect page first.');
        setProcessingUrl(false);
        return;
      }

      // Parse URL
      const { projectPath, projectId, mrIid } = parseGitLabMrUrl(mrUrl.trim());
      
      if (!mrIid) {
        setUrlError('Invalid GitLab MR URL. Could not extract MR number.');
        setProcessingUrl(false);
        return;
      }

      if (!projectPath && !projectId) {
        setUrlError('Invalid GitLab MR URL. Could not extract project path or ID.');
        setProcessingUrl(false);
        return;
      }

      // Resolve project path to projectId if needed
      let finalProjectId = projectId;
      if (projectPath && !projectId) {
        try {
          const resolved = await api.resolveGitLabProject(projectPath);
          finalProjectId = resolved.projectId;
        } catch (err: any) {
          setUrlError(`Failed to resolve project: ${err.message || 'Unknown error'}`);
          setProcessingUrl(false);
          return;
        }
      }

      if (!finalProjectId) {
        setUrlError('Could not determine project ID');
        setProcessingUrl(false);
        return;
      }

      // Trigger review
      const result = await api.triggerReview({
        projectId: finalProjectId,
        mrIid,
      });

      // Navigate to review detail page
      router.push(`/reviews/${result.reviewRunId}`);
    } catch (err: any) {
      console.error('Failed to trigger review from URL:', err);
      setUrlError(err.message || 'Failed to trigger review. Please try again.');
      setProcessingUrl(false);
    }
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadgeClass = (status: string): string => {
    const statusLower = status.toLowerCase();
    if (statusLower === 'succeeded') return 'success';
    if (statusLower === 'failed') return 'error';
    if (statusLower === 'running') return 'info';
    if (statusLower === 'queued') return 'pending';
    return '';
  };

  if (loading) {
    return (
      <div>
        <h1>Reviews</h1>
        <div>Loading...</div>
      </div>
    );
  }

  const config = getStoredConfig();
  if (!config) {
    return (
      <div>
        <h1>Reviews</h1>
        <div className="alert error">
          Please configure your connection on the Connect page first.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Reviews</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Paste GitLab MR URL Section */}
      <div style={{ 
        marginBottom: '2rem', 
        padding: '1rem', 
        background: 'white', 
        borderRadius: '8px', 
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)' 
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '1.1rem' }}>Paste GitLab MR URL</h2>
        <p style={{ marginBottom: '1rem', color: '#666', fontSize: '0.9rem' }}>
          Paste a GitLab merge request URL to trigger a review
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
          <input
            type="text"
            value={mrUrl}
            onChange={(e) => setMrUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !processingUrl) {
                handlePasteMrUrl();
              }
            }}
            placeholder="https://gitlab.com/group/subgroup/repo/-/merge_requests/123"
            disabled={processingUrl}
            style={{
              flex: 1,
              padding: '0.5rem',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '0.9rem',
            }}
          />
          <button
            onClick={handlePasteMrUrl}
            disabled={processingUrl || !mrUrl.trim()}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: processingUrl || !mrUrl.trim() ? '#ccc' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: processingUrl || !mrUrl.trim() ? 'not-allowed' : 'pointer',
              opacity: processingUrl || !mrUrl.trim() ? 0.6 : 1,
            }}
          >
            {processingUrl ? 'Processing...' : 'Trigger Review'}
          </button>
        </div>
        {urlError && (
          <div style={{ marginTop: '0.5rem', color: '#d32f2f', fontSize: '0.85rem' }}>
            {urlError}
          </div>
        )}
      </div>

      {lastUpdated && (
        <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Last updated: {formatDate(lastUpdated.toISOString())}
        </div>
      )}

      {error && (
        <div className="alert error" style={{ marginBottom: '2rem' }}>
          {error}
        </div>
      )}

      {mergeRequests.length === 0 ? (
        <p>No merge requests found.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Repo</th>
              <th>Author</th>
              <th>State</th>
              <th>Latest Review</th>
              <th>Score</th>
              <th>Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {mergeRequests.map((mr) => (
              <tr key={mr.id}>
                <td>
                  {mr.webUrl ? (
                    <a
                      href={mr.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#0070f3', textDecoration: 'none' }}
                    >
                      {mr.title}
                    </a>
                  ) : (
                    mr.title
                  )}
                </td>
                <td>
                  {mr.repository.namespace}/{mr.repository.name}
                </td>
                <td>{mr.authorName || 'Unknown'}</td>
                <td>
                  <span
                    className={`status-badge ${mr.state.toLowerCase()}`}
                  >
                    {mr.state}
                  </span>
                </td>
                <td>
                  {mr.latestReview ? (
                    <span
                      className={`status-badge ${getStatusBadgeClass(
                        mr.latestReview.status
                      )}`}
                    >
                      {mr.latestReview.status}
                    </span>
                  ) : (
                    <span style={{ color: '#666' }}>No reviews yet</span>
                  )}
                </td>
                <td>
                  {mr.latestReview?.score !== null && mr.latestReview?.score !== undefined
                    ? mr.latestReview.score
                    : '-'}
                </td>
                <td>{formatDate(mr.updatedAt)}</td>
                <td>
                  {mr.latestReview ? (
                    <Link
                      href={`/reviews/${mr.latestReview.id}`}
                      style={{
                        padding: '0.25rem 0.75rem',
                        backgroundColor: '#0070f3',
                        color: 'white',
                        textDecoration: 'none',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                      }}
                    >
                      View
                    </Link>
                  ) : (
                    <span style={{ color: '#666' }}>No reviews yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Recent Activity Panel */}
      <RecentActivityPanel />
    </div>
  );
}

interface ActivityEvent {
  ts: number;
  type: string;
  projectId?: string | null;
  mrIid?: number | null;
  headSha?: string | null;
  detail?: string | null;
  reviewRunId?: string | null;
  jobId?: string | null;
}

function RecentActivityPanel() {
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const loadActivity = async (signal?: AbortSignal) => {
    const config = getStoredConfig();
    if (!config) {
      return;
    }

    try {
      const data = await api.getActivity(20, signal);
      
      if (isMountedRef.current) {
        setActivities(data.activities);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      
      if (isMountedRef.current) {
        // Non-blocking error - just log, don't show error state
        console.error('Failed to load activity:', err);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    
    // Initial load
    abortControllerRef.current = new AbortController();
    loadActivity(abortControllerRef.current.signal);

    // Poll every 5 seconds
    pollingIntervalRef.current = setInterval(() => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      loadActivity(abortControllerRef.current.signal);
    }, 5000);

    return () => {
      isMountedRef.current = false;
      
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const handleCopyActivity = async () => {
    if (activities.length === 0) {
      return;
    }

    const lines: string[] = [];
    lines.push('Recent Activity');
    lines.push('');
    
    for (const activity of activities) {
      const time = new Date(activity.ts).toLocaleString();
      const type = activity.type;
      const mr = activity.projectId && activity.mrIid 
        ? `${activity.projectId}/${activity.mrIid}` 
        : '-';
      const sha = activity.headSha ? activity.headSha.substring(0, 8) : '-';
      const detail = activity.detail || '';
      const reviewRunId = activity.reviewRunId || '';
      const jobId = activity.jobId || '';
      
      lines.push(`[${time}] ${type}`);
      lines.push(`  MR: ${mr} | SHA: ${sha}`);
      if (detail) lines.push(`  ${detail}`);
      if (reviewRunId) lines.push(`  ReviewRun: ${reviewRunId}`);
      if (jobId) lines.push(`  JobId: ${jobId}`);
      lines.push('');
    }
    
    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      // Show brief success message (could use a toast library, but keeping it simple)
      alert('Activity copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy activity:', error);
      alert('Failed to copy activity to clipboard');
    }
  };

  const formatTime = (ts: number): string => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) {
      return `${diffSec}s ago`;
    } else if (diffSec < 3600) {
      return `${Math.floor(diffSec / 60)}m ago`;
    } else {
      return date.toLocaleTimeString();
    }
  };

  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'webhook.received': 'Webhook Received',
      'webhook.reviewrun.created': 'ReviewRun Created',
      'webhook.ignored': 'Ignored',
      'webhook.headsha.changed': 'SHA Changed',
    };
    return labels[type] || type;
  };

  const getTypeColor = (type: string): string => {
    if (type === 'webhook.reviewrun.created') return '#28a745';
    if (type === 'webhook.ignored') return '#ffc107';
    if (type === 'webhook.headsha.changed') return '#17a2b8';
    return '#0070f3';
  };

  return (
    <div style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid #ddd' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Recent Activity</h2>
        {activities.length > 0 && (
          <button
            type="button"
            onClick={handleCopyActivity}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.9rem',
              cursor: 'pointer',
              backgroundColor: '#f0f0f0',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          >
            Copy Activity
          </button>
        )}
      </div>

      {loading && activities.length === 0 ? (
        <div style={{ color: '#666' }}>Loading activity...</div>
      ) : activities.length === 0 ? (
        <div style={{ color: '#666' }}>No activity yet. Trigger a webhook to see events here.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9rem',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>MR</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>SHA</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity, index) => (
                <tr key={`${activity.ts}-${index}`} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
                    {formatTime(activity.ts)}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        fontWeight: '500',
                        backgroundColor: getTypeColor(activity.type) + '20',
                        color: getTypeColor(activity.type),
                      }}
                    >
                      {getTypeLabel(activity.type)}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {activity.projectId && activity.mrIid
                      ? `${activity.projectId}/${activity.mrIid}`
                      : '-'}
                  </td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#666' }}>
                    {activity.headSha ? activity.headSha.substring(0, 8) : '-'}
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                    {activity.detail || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

