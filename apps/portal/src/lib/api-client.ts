/**
 * API client for portal
 * Handles tenant slug and admin token headers
 */

const STORAGE_KEYS = {
  TENANT_SLUG: 'mrp_portal_tenant_slug',
  ADMIN_TOKEN: 'mrp_portal_admin_token',
  API_BASE_URL: 'mrp_portal_api_base_url',
} as const;

export interface ConnectionConfig {
  tenantSlug: string;
  adminToken: string;
  apiBaseUrl?: string;
}

export function getStoredConfig(): ConnectionConfig | null {
  if (typeof window === 'undefined') return null;

  const tenantSlug = localStorage.getItem(STORAGE_KEYS.TENANT_SLUG);
  const adminToken = localStorage.getItem(STORAGE_KEYS.ADMIN_TOKEN);
  const apiBaseUrl = localStorage.getItem(STORAGE_KEYS.API_BASE_URL);

  if (!tenantSlug || !adminToken) {
    return null;
  }

  return {
    tenantSlug,
    adminToken,
    apiBaseUrl: apiBaseUrl || undefined,
  };
}

export function storeConfig(config: ConnectionConfig): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(STORAGE_KEYS.TENANT_SLUG, config.tenantSlug);
  localStorage.setItem(STORAGE_KEYS.ADMIN_TOKEN, config.adminToken);
  if (config.apiBaseUrl) {
    localStorage.setItem(STORAGE_KEYS.API_BASE_URL, config.apiBaseUrl);
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEYS.API_BASE_URL);
    if (stored) {
      // Runtime assertion: detect if portal is pointing at itself
      const currentOrigin = window.location.origin;
      try {
        const apiUrlOrigin = new URL(stored, window.location.href).origin;
        if (apiUrlOrigin === currentOrigin) {
          console.error(
            '⚠️ PORTAL CONFIGURATION ERROR: API base URL points to portal itself!',
            { apiBaseUrl: stored, portalOrigin: currentOrigin }
          );
          // In development, show a visible warning
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              'Portal is configured to point at itself. API should run on port 3001, portal on 3000.'
            );
          }
        }
      } catch (e) {
        // Invalid URL, will be caught by apiRequest
      }
      return stored;
    }
  }
  
  // In production build, require NEXT_PUBLIC_API_BASE_URL to be set
  // Never default to localhost in production
  const isProduction = process.env.NODE_ENV === 'production';
  const envApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  
  if (isProduction && !envApiBaseUrl) {
    // Production build without API base URL - this is a configuration error
    // Return empty string so caller can detect and show warning
    return '';
  }
  
  // Development or production with env var set
  // Default to localhost:3001 in development (API port), not 3000 (portal port)
  const defaultUrl = envApiBaseUrl || (isProduction ? 'https://api.quickiter.com' : 'http://localhost:3001');
  
  // Runtime assertion: detect if portal is pointing at itself
  if (typeof window !== 'undefined' && defaultUrl) {
    const currentOrigin = window.location.origin;
    try {
      const apiUrlOrigin = new URL(defaultUrl, window.location.href).origin;
      if (apiUrlOrigin === currentOrigin) {
        console.error(
          '⚠️ PORTAL CONFIGURATION ERROR: API base URL points to portal itself!',
          { apiBaseUrl: defaultUrl, portalOrigin: currentOrigin }
        );
        // In development, show a visible warning
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            'Portal is configured to point at itself. API should run on port 3001, portal on 3000.'
          );
        }
      }
    } catch (e) {
      // Invalid URL, will be caught by apiRequest
    }
  }
  
  return defaultUrl;
}

function getTenantSlug(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEYS.TENANT_SLUG);
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || '';
}

function getAdminToken(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEYS.ADMIN_TOKEN);
    if (stored) return stored;
  }
  return process.env.NEXT_PUBLIC_PORTAL_ADMIN_TOKEN || '';
}

export interface ApiError {
  error: string;
  message?: string;
  reasonCode?: string;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  signal?: AbortSignal
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  
  // In production, require API base URL to be configured
  if (!baseUrl) {
    throw new Error(
      'API base URL not configured. Please set NEXT_PUBLIC_API_BASE_URL environment variable.'
    );
  }
  
  const tenantSlug = getTenantSlug();
  const adminToken = getAdminToken();

  if (!tenantSlug) {
    throw new Error('Tenant slug not configured');
  }
  if (!adminToken) {
    throw new Error('Admin token not configured');
  }

  const url = `${baseUrl}${path}`;
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-MRP-Tenant-Slug', tenantSlug);
  headers.set('X-MRP-Admin-Token', adminToken);

  // Dev-only: log request URL once per route (not spammy)
  if (process.env.NODE_ENV === 'development') {
    console.debug('[API Request]', {
      method: options.method || 'GET',
      url,
      path,
      baseUrl,
      hasSignal: !!signal,
      tenantSlug,
    });
  }

  const response = await fetch(url, {
    ...options,
    headers,
    signal: signal || options.signal,
  });

  // Dev-only: log response status
  if (process.env.NODE_ENV === 'development') {
    console.debug('[API Response]', {
      url,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });
  }

  if (!response.ok) {
    let error: ApiError;
    try {
      error = await response.json();
    } catch {
      error = {
        error: 'Request failed',
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    throw error;
  }

  return response.json();
}

export interface TenantSettings {
  allowedExtensions: string[];
  maxFileSizeBytes: number;
  allowedMimePrefixes: string[];
}

export const api = {
  async getSettings(): Promise<TenantSettings> {
    return apiRequest<TenantSettings>('/tenant/settings');
  },

  async updateSettings(settings: Partial<TenantSettings>): Promise<TenantSettings> {
    return apiRequest<TenantSettings>('/tenant/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  async presignUpload(params: {
    fileName: string;
    sizeBytes: number;
    mimeType: string;
  }): Promise<{
    uploadId: string;
    objectKey: string;
    presignedUrl: string;
    expiresInSeconds: number;
  }> {
    return apiRequest('/uploads/presign', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async completeUpload(uploadId: string): Promise<{
    id: string;
    objectKey: string;
    originalFileName: string;
    sizeBytes: number;
    mimeType: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }> {
    return apiRequest('/uploads/complete', {
      method: 'POST',
      body: JSON.stringify({ uploadId }),
    });
  },

  async listUploads(): Promise<{
    uploads: Array<{
      id: string;
      objectKey: string;
      originalFileName: string;
      sizeBytes: number;
      mimeType: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    return apiRequest('/uploads');
  },

  async getMergeRequests(params?: {
    limit?: number;
    offset?: number;
    repositoryId?: string;
  }, signal?: AbortSignal): Promise<{
    mergeRequests: Array<{
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
    }>;
    total: number;
  }> {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.offset) queryParams.set('offset', params.offset.toString());
    if (params?.repositoryId) queryParams.set('repositoryId', params.repositoryId);
    
    const queryString = queryParams.toString();
    const path = `/merge-requests${queryString ? `?${queryString}` : ''}`;
    return apiRequest(path, {}, signal);
  },

  async getReviewRun(reviewRunId: string, signal?: AbortSignal): Promise<{
    id: string;
    status: string;
    phase: string | null;
    progressMessage: string | null;
    score: number | null;
    summary: string | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
    mergeRequest: {
      id: string;
      iid: number;
      title: string;
      state: string;
      webUrl: string | null;
      authorName: string | null;
      repository: {
        id: string;
        name: string;
        namespace: string;
        projectId: string | null;
      };
    };
    checkResults: Array<{
      id: string;
      checkKey: string;
      category: string;
      status: string;
      severity: string;
      message: string | null;
      filePath: string | null;
      startLine: number | null;
      endLine: number | null;
    }>;
    aiSuggestions: Array<{
      id: string;
      checkKey: string | null;
      title: string;
      rationale: string | null;
      suggestedFix: string | null;
      filePath: string | null;
      startLine: number | null;
      endLine: number | null;
    }>;
    postedComments: Array<{
      id: string;
      provider: string;
      externalId: string | null;
      url: string | null;
      createdAt: string;
    }>;
  }> {
    return apiRequest(`/review-runs/${reviewRunId}`, {}, signal);
  },

  async triggerReview(params: {
    projectId: string | number;
    mrIid: number;
    headSha?: string;
  }): Promise<{
    ok: boolean;
    tenantId: string;
    repositoryId: string;
    mergeRequestId: string;
    reviewRunId: string;
    jobId: string;
    headSha: string;
  }> {
    return apiRequest(`/merge-requests/${params.projectId}/${params.mrIid}/trigger-review`, {
      method: 'POST',
      body: JSON.stringify(params.headSha ? { headSha: params.headSha } : {}),
    });
  },

  async retryReviewRun(reviewRunId: string): Promise<{
    ok: boolean;
    reviewRunId: string;
    jobId: string;
    status: string;
  }> {
    return apiRequest(`/review-runs/${reviewRunId}/retry`, {
      method: 'POST',
    });
  },

  async resolveGitLabProject(projectPath: string): Promise<{
    projectId: string;
    name: string;
    path: string;
    pathWithNamespace: string;
    namespace: string;
  }> {
    const encodedPath = encodeURIComponent(projectPath);
    return apiRequest(`/gitlab/resolve-project?path=${encodedPath}`);
  },

  async getMergeRequest(projectId: string | number, mrIid: number, signal?: AbortSignal): Promise<{
    mergeRequest: {
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
        headSha: string;
      } | null;
    };
  }> {
    return apiRequest(`/merge-requests/${projectId}/${mrIid}`, {}, signal);
  },

  async getActivity(limit?: number, signal?: AbortSignal): Promise<{
    activities: Array<{
      ts: number;
      type: string;
      projectId?: string | null;
      mrIid?: number | null;
      headSha?: string | null;
      detail?: string | null;
      reviewRunId?: string | null;
      jobId?: string | null;
    }>;
  }> {
    const queryParams = new URLSearchParams();
    if (limit) queryParams.set('limit', limit.toString());
    const queryString = queryParams.toString();
    const path = `/debug/activity${queryString ? `?${queryString}` : ''}`;
    return apiRequest(path, {}, signal);
  },
};

