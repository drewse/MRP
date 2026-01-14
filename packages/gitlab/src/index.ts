/**
 * GitLab REST API client
 * 
 * Features:
 * - Retry logic with exponential backoff (429, 5xx)
 * - 10s request timeout
 * - Structured logging (no secrets)
 * - Type-safe API methods
 */

export interface GitLabClientConfig {
  baseUrl: string;
  token: string;
}

export interface GitLabMergeRequest {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  source_branch: string;
  target_branch: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  sha: string;
  merge_commit_sha: string | null;
  web_url: string;
  merged_at?: string | null;
  merged_by?: {
    id: number;
    username: string;
    name: string;
  } | null;
}

export interface GitLabApprovalState {
  approvals_required: number;
  approvals_left: number;
  approved_by: Array<{
    user: {
      id: number;
      username: string;
      name: string;
    };
  }>;
}

export interface GitLabNote {
  id: number;
  body: string;
  author: {
    id: number;
    username: string;
    name: string;
  };
  created_at: string;
  updated_at: string;
  system: boolean;
  noteable_type: string;
  noteable_id: number;
}

export interface GitLabChange {
  old_path: string;
  new_path: string;
  a_mode?: string;
  b_mode?: string;
  diff?: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export interface GitLabMergeRequestChanges {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  target_branch: string;
  source_branch: string;
  changes: GitLabChange[];
}

export interface GitLabNoteList {
  notes: GitLabNote[];
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  email: string;
  avatar_url: string;
}

export interface GitLabClient {
  getUser(): Promise<GitLabUser>;
  getMergeRequest(projectId: string, mrIid: number): Promise<GitLabMergeRequest>;
  getMergeRequestApprovals(projectId: string, mrIid: number): Promise<GitLabApprovalState | null>;
  createMergeRequestNote(projectId: string, mrIid: number, body: string): Promise<GitLabNote>;
  getMergeRequestChanges(projectId: string, mrIid: number): Promise<GitLabMergeRequestChanges>;
  updateMergeRequestNote(projectId: string, mrIid: number, noteId: string, body: string): Promise<GitLabNote>;
  getMergeRequestNotes(projectId: string, mrIid: number): Promise<GitLabNote[]>;
  getProjectFileRaw(projectId: string, filePath: string, ref?: string): Promise<string>;
}

export interface GitLabError extends Error {
  statusCode?: number;
  responseBody?: string;
}

/**
 * Create a GitLab REST API client
 */
export function createGitLabClient(config: GitLabClientConfig): GitLabClient {
  const { baseUrl, token } = config;
  
  // Normalize baseUrl (remove trailing slash)
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  
  /**
   * Make HTTP request with retry logic
   */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    projectId?: string,
    mrIid?: number
  ): Promise<T> {
    const url = `${normalizedBaseUrl}${path}`;
    const startTime = Date.now();
    
    // Log request start (no secrets)
    const logContext: Record<string, unknown> = {
      event: 'gitlab.request.start',
      method,
      path,
    };
    if (projectId) logContext.projectId = projectId;
    if (mrIid) logContext.mrIid = mrIid;
    console.log(JSON.stringify(logContext));
    
    const maxRetries = 3;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
        
        try {
          const response = await fetch(url, {
            method,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          const durationMs = Date.now() - startTime;
          
          // Handle rate limiting (429)
          if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            const waitMs = retryAfter 
              ? parseInt(retryAfter, 10) * 1000 
              : Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff, max 10s
            
            if (attempt < maxRetries) {
              console.log(JSON.stringify({
                event: 'gitlab.request.retry',
                method,
                path,
                status: response.status,
                attempt: attempt + 1,
                waitMs,
              }));
              
              await new Promise(resolve => setTimeout(resolve, waitMs));
              continue;
            }
          }
          
          // Handle 5xx errors with retry
          if (response.status >= 500 && response.status < 600) {
            if (attempt < maxRetries) {
              const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff
              console.log(JSON.stringify({
                event: 'gitlab.request.retry',
                method,
                path,
                status: response.status,
                attempt: attempt + 1,
                waitMs,
              }));
              
              await new Promise(resolve => setTimeout(resolve, waitMs));
              continue;
            }
          }
          
          // Read response body once
          let responseText: string;
          try {
            responseText = await response.text();
          } catch {
            responseText = '';
          }
          
          if (!response.ok) {
            // Limit response body to first 500 chars for error logging
            const errorBody = responseText.length > 500 
              ? responseText.substring(0, 500) + '...' 
              : responseText;
            
            const error: GitLabError = new Error(
              `GitLab API error: ${response.status} ${response.statusText}`
            ) as GitLabError;
            error.statusCode = response.status;
            error.responseBody = errorBody;
            
            console.log(JSON.stringify({
              event: 'gitlab.request.fail',
              method,
              path,
              status: response.status,
              durationMs,
              message: error.message,
            }));
            
            throw error;
          }
          
          // Parse JSON response
          let data: T;
          try {
            data = JSON.parse(responseText || '{}') as T;
          } catch (parseError) {
            const error: GitLabError = new Error(
              `Failed to parse GitLab API response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
            ) as GitLabError;
            error.statusCode = response.status;
            error.responseBody = responseText.length > 500 
              ? responseText.substring(0, 500) + '...' 
              : responseText;
            throw error;
          }
          
          console.log(JSON.stringify({
            event: 'gitlab.request.success',
            method,
            path,
            status: response.status,
            durationMs,
          }));
          
          return data;
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);
          
          // Handle timeout
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            const error: GitLabError = new Error('GitLab API request timeout (10s)') as GitLabError;
            error.statusCode = 408;
            
            if (attempt < maxRetries) {
              const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
              console.log(JSON.stringify({
                event: 'gitlab.request.retry',
                method,
                path,
                reason: 'timeout',
                attempt: attempt + 1,
                waitMs,
              }));
              
              await new Promise(resolve => setTimeout(resolve, waitMs));
              continue;
            }
            
            console.log(JSON.stringify({
              event: 'gitlab.request.fail',
              method,
              path,
              status: 408,
              durationMs: Date.now() - startTime,
              message: error.message,
            }));
            
            throw error;
          }
          
          throw fetchError;
        }
      } catch (error: unknown) {
        lastError = error as Error;
        
        // If this is the last attempt, log and throw
        if (attempt === maxRetries) {
          const durationMs = Date.now() - startTime;
          const err = error as GitLabError;
          
          console.log(JSON.stringify({
            event: 'gitlab.request.fail',
            method,
            path,
            status: err.statusCode,
            durationMs,
            message: err.message || 'Unknown error',
          }));
          
          throw error;
        }
      }
    }
    
    // Should never reach here, but TypeScript needs it
    throw lastError || new Error('Request failed after retries');
  }
  
  return {
    /**
     * Get current authenticated user
     * GET /api/v4/user
     */
    async getUser(): Promise<GitLabUser> {
      const path = '/api/v4/user';
      return request<GitLabUser>('GET', path);
    },
    
    /**
     * Get merge request details
     * GET /api/v4/projects/:id/merge_requests/:iid
     */
    async getMergeRequest(projectId: string, mrIid: number): Promise<GitLabMergeRequest> {
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}`;
      return request<GitLabMergeRequest>('GET', path, undefined, projectId, mrIid);
    },
    
    /**
     * Get merge request approval state
     * GET /api/v4/projects/:id/merge_requests/:iid/approvals
     * Returns null if endpoint is unavailable or returns 404/403 (graceful degradation)
     */
    async getMergeRequestApprovals(projectId: string, mrIid: number): Promise<GitLabApprovalState | null> {
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/approvals`;
      try {
        return await request<GitLabApprovalState>('GET', path, undefined, projectId, mrIid);
      } catch (error: unknown) {
        const err = error as { statusCode?: number; message?: string };
        // Graceful degradation: if 403/404, return null (approvals unknown)
        if (err.statusCode === 403 || err.statusCode === 404) {
          console.log(JSON.stringify({
            event: 'gitlab.approvals.unavailable',
            projectId,
            mrIid,
            statusCode: err.statusCode,
          }));
          return null;
        }
        // Re-throw other errors
        throw error;
      }
    },
    
    /**
     * Create a note (comment) on a merge request
     * POST /api/v4/projects/:id/merge_requests/:iid/notes
     */
    async createMergeRequestNote(
      projectId: string,
      mrIid: number,
      body: string
    ): Promise<GitLabNote> {
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/notes`;
      return request<GitLabNote>('POST', path, { body }, projectId, mrIid);
    },
    
    /**
     * Get merge request changes (diff)
     * GET /api/v4/projects/:id/merge_requests/:iid/changes
     */
    async getMergeRequestChanges(
      projectId: string,
      mrIid: number
    ): Promise<GitLabMergeRequestChanges> {
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/changes`;
      return request<GitLabMergeRequestChanges>('GET', path, undefined, projectId, mrIid);
    },
    
    /**
     * Update a note (comment) on a merge request
     * PUT /api/v4/projects/:id/merge_requests/:iid/notes/:note_id
     */
    async updateMergeRequestNote(
      projectId: string,
      mrIid: number,
      noteId: string,
      body: string
    ): Promise<GitLabNote> {
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/notes/${encodeURIComponent(noteId)}`;
      return request<GitLabNote>('PUT', path, { body }, projectId, mrIid);
    },
    
    /**
     * Get all notes (comments) on a merge request
     * GET /api/v4/projects/:id/merge_requests/:iid/notes
     */
    async getMergeRequestNotes(
      projectId: string,
      mrIid: number
    ): Promise<GitLabNote[]> {
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${mrIid}/notes`;
      return request<GitLabNote[]>('GET', path, undefined, projectId, mrIid);
    },
    
    /**
     * Get raw file content from repository
     * GET /api/v4/projects/:id/repository/files/:file_path/raw
     */
    async getProjectFileRaw(
      projectId: string,
      filePath: string,
      ref: string = 'main'
    ): Promise<string> {
      const encodedPath = encodeURIComponent(filePath);
      const path = `/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`;
      
      // Use the request helper but handle text response
      const url = `${normalizedBaseUrl}${path}`;
      const startTime = Date.now();
      
      console.log(JSON.stringify({
        event: 'gitlab.request.start',
        method: 'GET',
        path,
        projectId,
      }));
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.log(JSON.stringify({
            event: 'gitlab.request.fail',
            method: 'GET',
            path,
            status: response.status,
            durationMs,
            message: `GitLab API error: ${response.status} ${response.statusText}`,
          }));
          
          const error: GitLabError = new Error(
            `GitLab API error: ${response.status} ${response.statusText}`
          ) as GitLabError;
          error.statusCode = response.status;
          error.responseBody = errorText.length > 500 ? errorText.substring(0, 500) + '...' : errorText;
          throw error;
        }
        
        const text = await response.text();
        
        console.log(JSON.stringify({
          event: 'gitlab.request.success',
          method: 'GET',
          path,
          status: response.status,
          durationMs,
        }));
        
        return text;
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);
        
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          const error: GitLabError = new Error('GitLab API request timeout (10s)') as GitLabError;
          error.statusCode = 408;
          console.log(JSON.stringify({
            event: 'gitlab.request.fail',
            method: 'GET',
            path,
            status: 408,
            durationMs: Date.now() - startTime,
            message: error.message,
          }));
          throw error;
        }
        
        throw fetchError;
      }
    },
  };
}
