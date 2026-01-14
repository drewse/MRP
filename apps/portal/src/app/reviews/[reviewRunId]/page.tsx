'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getStoredConfig, getApiBaseUrl } from '@/lib/api-client';

type ReviewRun = Awaited<ReturnType<typeof api.getReviewRun>>;
type MergeRequestMeta = Awaited<ReturnType<typeof api.getMergeRequest>>;

type CheckResultFilter = 'all' | 'FAIL' | 'WARN' | 'PASS';

export default function ReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  
  // Normalize reviewRunId: handle string | string[] from useParams
  const reviewRunIdRaw = params.reviewRunId;
  const reviewRunIdStr = Array.isArray(reviewRunIdRaw) 
    ? (reviewRunIdRaw[0] || '') 
    : (reviewRunIdRaw || '');

  const [reviewRun, setReviewRun] = useState<ReviewRun | null>(null);
  const [mrMeta, setMrMeta] = useState<MergeRequestMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkFilter, setCheckFilter] = useState<CheckResultFilter>('all');
  const [triggering, setTriggering] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Race-safe polling refs
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const isMountedRef = useRef(true);
  const isInitialLoadRef = useRef(true);

  const loadReviewRun = async (signal?: AbortSignal, isPolling = false) => {
    const config = getStoredConfig();
    if (!config) {
      setError('Please configure your connection on the Connect page first.');
      setLoading(false);
      return;
    }

    if (!reviewRunIdStr) {
      setError('Invalid review run ID');
      setLoading(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    const url = `${getApiBaseUrl()}/review-runs/${reviewRunIdStr}`;

    try {
      setError(null);
      const data = await api.getReviewRun(reviewRunIdStr, signal);
      
      // Dev-only: log poll response
      if (isPolling && process.env.NODE_ENV === 'development') {
        console.debug('[Poll] Review Run Status', {
          url,
          reviewRunId: reviewRunIdStr,
          status: data.status,
          responseStatus: '200',
          seq,
          isLatest: seq === requestSeqRef.current,
        });
      }
      
      // For initial load, always update. For polling, use seq guard but always update if latest.
      const shouldUpdate = isMountedRef.current && (
        !isPolling || seq === requestSeqRef.current
      );
      
      if (shouldUpdate) {
        setReviewRun(data);
        setLoading(false);
        // Clear any previous polling errors on successful update
        if (isPolling && error && error.includes('Polling error')) {
          setError(null);
        }
        
        // Load MR metadata if we have projectId and mrIid
        if (data.mergeRequest.repository.projectId) {
          loadMrMeta(data.mergeRequest.repository.projectId, data.mergeRequest.iid, signal, isPolling);
        }
      } else if (!isPolling) {
        // Initial load failed seq check (shouldn't happen, but ensure loading ends)
        setLoading(false);
      }
    } catch (err: any) {
      // Ignore abort errors silently (but ensure loading ends for initial load)
      if (err.name === 'AbortError' || signal?.aborted) {
        if (!isPolling && isMountedRef.current) {
          // Initial load was aborted - ensure loading state ends
          // (This shouldn't normally happen, but handle it gracefully)
          setLoading(false);
        }
        return;
      }
      
      // For initial load, always show error. For polling, use seq guard.
      const shouldUpdate = isMountedRef.current && (
        !isPolling || seq === requestSeqRef.current
      );
      
      if (shouldUpdate) {
        const errorMessage = err.error || err.message || 'Unknown error';
        const httpStatus = err.message?.includes('HTTP') ? err.message : '';
        const apiMessage = err.message || 'Failed to load review';
        
        console.error('Failed to load review run:', {
          url,
          error: errorMessage,
          httpStatus,
          fullError: err,
          isPolling,
        });
        
        // Dev-only: log poll error
        if (isPolling && process.env.NODE_ENV === 'development') {
          console.debug('[Poll] Review Run Error', {
            url,
            reviewRunId: reviewRunIdStr,
            status: reviewRun?.status || 'unknown',
            responseStatus: httpStatus || 'unknown',
            error: errorMessage,
            seq,
            isLatest: seq === requestSeqRef.current,
          });
        }
        
        // For polling errors, show a non-blocking error message
        if (isPolling) {
          // Don't replace the review data, but show error in UI
          setError(`Polling error: ${apiMessage}${httpStatus ? ` (${httpStatus})` : ''}`);
        } else {
          // Initial load error - replace everything
          if (err.error === 'Not found' || err.message?.includes('404')) {
            setError('Review not found. It may have been deleted or you may not have access.');
          } else {
            setError(`${apiMessage}${httpStatus ? ` (${httpStatus})` : ''}`);
          }
          setLoading(false);
        }
      } else if (!isPolling) {
        // Initial load failed seq check (shouldn't happen, but ensure loading ends)
        setLoading(false);
      }
    }
  };

  const loadMrMeta = async (projectId: string | null, mrIid: number, signal?: AbortSignal, isPolling = false) => {
    if (!projectId) return;
    
    const seq = ++requestSeqRef.current;
    
    try {
      const data = await api.getMergeRequest(projectId, mrIid, signal);
      
      // For initial load, always update. For polling, use seq guard.
      const shouldUpdate = isMountedRef.current && (
        !isPolling || seq === requestSeqRef.current
      );
      
      if (shouldUpdate) {
        setMrMeta(data);
      }
    } catch (err: any) {
      // Ignore abort errors
      if (err.name === 'AbortError' || signal?.aborted) return;
      
      // Silently fail - MR metadata is not critical
      console.warn('Failed to load MR metadata:', err);
    }
  };

  // Initial load and cleanup - use normalized reviewRunIdStr as dependency
  useEffect(() => {
    isMountedRef.current = true;
    isInitialLoadRef.current = true;
    setLoading(true);
    setError(null);
    setReviewRun(null);
    setMrMeta(null);
    
    if (!reviewRunIdStr) {
      setError('Invalid review run ID');
      setLoading(false);
      return;
    }
    
    // Abort any in-flight requests from previous route
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    
    // Initial load (not polling)
    loadReviewRun(abortControllerRef.current.signal, false);
    isInitialLoadRef.current = false;

    // Cleanup on unmount or route change
    return () => {
      isMountedRef.current = false;
      
      // Stop polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      // Abort in-flight requests
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [reviewRunIdStr]);

  // Polling effect: poll every 3s if status is QUEUED or RUNNING
  useEffect(() => {
    if (!reviewRun || !reviewRunIdStr) return;

    const status = reviewRun.status.toUpperCase();
    const projectId = reviewRun.mergeRequest.repository.projectId;
    const mrIid = reviewRun.mergeRequest.iid;
    
    if (status === 'QUEUED' || status === 'RUNNING') {
      // Start polling
      pollingIntervalRef.current = setInterval(() => {
        if (!isMountedRef.current) {
          // Component unmounted, stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          return;
        }
        
        // Abort previous request if still in flight
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();
        
        const signal = abortControllerRef.current.signal;
        
        // Poll both review run and MR metadata (mark as polling)
        // Dev-only: log poll start
        if (process.env.NODE_ENV === 'development') {
          console.debug('[Poll] Starting poll', {
            reviewRunId: reviewRunIdStr,
            currentStatus: reviewRun.status,
            projectId,
            mrIid,
          });
        }
        
        loadReviewRun(signal, true);
        if (projectId) {
          loadMrMeta(projectId, mrIid, signal, true);
        }
      }, 3000);
    } else {
      // Stop polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      // Don't abort here - let the interval cleanup handle it
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRun?.status, reviewRunIdStr]);

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadgeClass = (status: string): string => {
    const statusLower = status.toLowerCase();
    if (statusLower === 'succeeded' || statusLower === 'success') return 'success';
    if (statusLower === 'failed' || statusLower === 'fail') return 'error';
    if (statusLower === 'running') return 'info';
    if (statusLower === 'queued') return 'pending';
    return '';
  };

  const formatFileLocation = (
    filePath: string | null,
    startLine: number | null,
    endLine: number | null
  ): string => {
    if (!filePath) return '';
    if (startLine === null) return filePath;
    if (endLine === null || endLine === startLine) {
      return `${filePath}:${startLine}`;
    }
    return `${filePath}:${startLine}-${endLine}`;
  };

  const handleTriggerReview = async () => {
    if (!reviewRun) return;

    const confirmed = window.confirm('Trigger a new review for this MR?');
    if (!confirmed) return;

    setTriggering(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const projectId = reviewRun.mergeRequest.repository.projectId;
      if (!projectId) {
        throw new Error('Project ID not available');
      }

      // Stop polling immediately
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      
      // Abort any in-flight requests
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      const result = await api.triggerReview({
        projectId,
        mrIid: reviewRun.mergeRequest.iid,
      });

      // Navigate to new review run (this will trigger cleanup and new load)
      router.replace(`/reviews/${result.reviewRunId}`);
      setSuccessMessage('Review triggered successfully!');
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err: any) {
      console.error('Failed to trigger review:', err);
      setError(err.message || 'Failed to trigger review. Please try again.');
    } finally {
      setTriggering(false);
    }
  };

  const filteredCheckResults = reviewRun?.checkResults.filter((result) => {
    if (checkFilter === 'all') return true;
    return result.status.toUpperCase() === checkFilter;
  }) || [];

  // Determine if trigger should be disabled based on LATEST review status, not current page's review
  const latestStatus = mrMeta?.mergeRequest?.latestReview?.status?.toUpperCase();
  const latestInProgress = latestStatus === 'QUEUED' || latestStatus === 'RUNNING';
  const shouldDisableTrigger = triggering || latestInProgress;

  if (loading) {
    return (
      <div>
        <Link href="/reviews" style={{ color: '#0070f3', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Reviews
        </Link>
        <h1>Review Detail</h1>
        <div>Loading review...</div>
      </div>
    );
  }

  const config = getStoredConfig();
  if (!config) {
    return (
      <div>
        <Link href="/reviews" style={{ color: '#0070f3', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Reviews
        </Link>
        <h1>Review Detail</h1>
        <div className="alert error">
          Please configure your connection on the Connect page first.
        </div>
      </div>
    );
  }

  if (error && !reviewRun) {
    return (
      <div>
        <Link href="/reviews" style={{ color: '#0070f3', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Reviews
        </Link>
        <h1>Review Detail</h1>
        <div className="alert error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
        <button onClick={() => {
          setError(null);
          setLoading(true);
          loadReviewRun();
        }}>
          Retry
        </button>
      </div>
    );
  }

  if (!reviewRun) {
    return (
      <div>
        <Link href="/reviews" style={{ color: '#0070f3', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Reviews
        </Link>
        <h1>Review Detail</h1>
        <div className="alert error">
          Review not found.
        </div>
      </div>
    );
  }

  const mr = reviewRun.mergeRequest;

  return (
    <div>
      <Link href="/reviews" style={{ color: '#0070f3', textDecoration: 'none', marginBottom: '1rem', display: 'inline-block' }}>
        ← Back to Reviews
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Review Detail</h1>
        {reviewRun && (
          <button
            onClick={handleTriggerReview}
            disabled={shouldDisableTrigger}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: shouldDisableTrigger ? '#ccc' : '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: shouldDisableTrigger ? 'not-allowed' : 'pointer',
              opacity: shouldDisableTrigger ? 0.6 : 1,
            }}
          >
            {triggering ? 'Triggering...' : 'Trigger Review'}
          </button>
        )}
      </div>

      {/* Debug info (dev-only) */}
      {process.env.NODE_ENV === 'development' && config && (
        <div style={{ 
          fontSize: '0.75rem', 
          color: '#666', 
          marginBottom: '1rem',
          padding: '0.5rem',
          background: '#f8f9fa',
          borderRadius: '4px',
        }}>
          <strong>Debug:</strong> API Base URL: {getApiBaseUrl()} | Tenant: {config.tenantSlug}
        </div>
      )}

      {successMessage && (
        <div className="alert success" style={{ marginBottom: '1rem' }}>
          {successMessage}
        </div>
      )}

      {/* Header Section */}
      <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)', marginBottom: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: '0.5rem' }}>
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
          </h2>
          <div style={{ color: '#666', fontSize: '0.9rem' }}>
            <span>{mr.repository.namespace}/{mr.repository.name}</span>
            {' • '}
            <span>MR !{mr.iid}</span>
            {mr.authorName && (
              <>
                {' • '}
                <span>by {mr.authorName}</span>
              </>
            )}
            {' • '}
            <span
              className={`status-badge ${mr.state.toLowerCase()}`}
              style={{ fontSize: '0.8rem' }}
            >
              {mr.state}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <strong>Status:</strong>{' '}
            <span className={`status-badge ${getStatusBadgeClass(reviewRun.status)}`}>
              {reviewRun.status}
            </span>
          </div>
          {reviewRun.score !== null && (
            <div>
              <strong>Score:</strong> {reviewRun.score}
            </div>
          )}
          <div>
            <strong>Created:</strong> {formatDate(reviewRun.createdAt)}
          </div>
          {reviewRun.finishedAt && (
            <div>
              <strong>Finished:</strong> {formatDate(reviewRun.finishedAt)}
            </div>
          )}
        </div>

        {reviewRun.summary && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f8f9fa', borderRadius: '4px' }}>
            <strong>Summary:</strong>
            <p style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{reviewRun.summary}</p>
          </div>
        )}

        {/* Warning for stuck QUEUED status */}
        {reviewRun.status === 'QUEUED' && (() => {
          const createdAt = new Date(reviewRun.createdAt);
          const now = new Date();
          const secondsQueued = Math.floor((now.getTime() - createdAt.getTime()) / 1000);
          const isStuck = secondsQueued > 30;
          
          if (isStuck) {
            return (
              <div style={{ marginTop: '1rem' }}>
                <div className="alert" style={{ background: '#fff3cd', border: '1px solid #ffc107', color: '#856404' }}>
                  <strong>⚠️ Still queued after {secondsQueued}s</strong>
                  <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    Worker may not be running or job may be deduped. Check{' '}
                    <code style={{ background: '#fff', padding: '2px 4px', borderRadius: '2px' }}>
                      /debug/queue/peek
                    </code>{' '}
                    to verify the job exists.
                  </p>
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
                    Review Run ID: <code>{reviewRun.id}</code>
                  </p>
                </div>
              </div>
            );
          }
          return null;
        })()}

        {reviewRun.status === 'FAILED' && reviewRun.error && (
          <div style={{ marginTop: '1rem' }}>
            <div className="alert error">
              <strong>Error:</strong>
              <p style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{reviewRun.error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Check Results Section */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Deterministic Check Results</h2>
        
        {reviewRun.checkResults.length === 0 ? (
          <p>No check results available.</p>
        ) : (
          <>
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setCheckFilter('all')}
                className={checkFilter === 'all' ? '' : 'secondary'}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
              >
                All ({reviewRun.checkResults.length})
              </button>
              <button
                onClick={() => setCheckFilter('FAIL')}
                className={checkFilter === 'FAIL' ? '' : 'secondary'}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
              >
                FAIL ({reviewRun.checkResults.filter(r => r.status.toUpperCase() === 'FAIL').length})
              </button>
              <button
                onClick={() => setCheckFilter('WARN')}
                className={checkFilter === 'WARN' ? '' : 'secondary'}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
              >
                WARN ({reviewRun.checkResults.filter(r => r.status.toUpperCase() === 'WARN').length})
              </button>
              <button
                onClick={() => setCheckFilter('PASS')}
                className={checkFilter === 'PASS' ? '' : 'secondary'}
                style={{ fontSize: '0.875rem', padding: '0.5rem 1rem' }}
              >
                PASS ({reviewRun.checkResults.filter(r => r.status.toUpperCase() === 'PASS').length})
              </button>
            </div>

            {filteredCheckResults.length === 0 ? (
              <p>No results match the selected filter.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Category</th>
                    <th>Check</th>
                    <th>Message</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCheckResults.map((result) => (
                    <tr key={result.id}>
                      <td>
                        <span className={`status-badge ${getStatusBadgeClass(result.status)}`}>
                          {result.status}
                        </span>
                      </td>
                      <td>{result.category}</td>
                      <td>{result.checkKey}</td>
                      <td>{result.message || '-'}</td>
                      <td>
                        {formatFileLocation(result.filePath, result.startLine, result.endLine) || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* AI Suggestions Section */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>AI Suggestions (Preview)</h2>
        {reviewRun.aiSuggestions.length === 0 ? (
          <p>No AI suggestions for this run.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {reviewRun.aiSuggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                style={{
                  background: 'white',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                }}
              >
                <h3 style={{ marginBottom: '0.5rem' }}>{suggestion.title}</h3>
                {suggestion.checkKey && (
                  <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    Check: {suggestion.checkKey}
                  </div>
                )}
                {formatFileLocation(suggestion.filePath, suggestion.startLine, suggestion.endLine) && (
                  <div style={{ color: '#666', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                    {formatFileLocation(suggestion.filePath, suggestion.startLine, suggestion.endLine)}
                  </div>
                )}
                {suggestion.rationale && (
                  <div style={{ marginBottom: '1rem' }}>
                    <strong>Rationale:</strong>
                    <p style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap' }}>{suggestion.rationale}</p>
                  </div>
                )}
                {suggestion.suggestedFix && (
                  <div>
                    <strong>Suggested Fix:</strong>
                    <pre
                      style={{
                        marginTop: '0.5rem',
                        padding: '1rem',
                        background: '#f8f9fa',
                        borderRadius: '4px',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'inherit',
                        fontSize: '0.9rem',
                      }}
                    >
                      {suggestion.suggestedFix}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Posted Comments Section */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Posted Comments</h2>
        {reviewRun.postedComments.length === 0 ? (
          <p>No comments posted for this review.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>External ID</th>
                <th>URL</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {reviewRun.postedComments.map((comment) => (
                <tr key={comment.id}>
                  <td>{comment.provider}</td>
                  <td>{comment.externalId || '-'}</td>
                  <td>
                    {comment.url ? (
                      <a
                        href={comment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#0070f3', textDecoration: 'none' }}
                      >
                        View
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td>{formatDate(comment.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

