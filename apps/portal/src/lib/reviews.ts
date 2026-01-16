/**
 * Helper functions and types for reviews pages
 */

export interface MergeRequest {
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

export interface ActivityEvent {
  ts: number;
  type: string;
  projectId?: string | null;
  mrIid?: number | null;
  headSha?: string | null;
  detail?: string | null;
  reviewRunId?: string | null;
  jobId?: string | null;
}

/**
 * Parse GitLab MR URL to extract project path/ID and MR IID
 * Supports formats:
 * - https://gitlab.com/group/subgroup/repo/-/merge_requests/123
 * - https://gitlab.com/group/subgroup/repo/merge_requests/123
 * - https://gitlab.com/group/subgroup/repo/-/merge_requests/123/diffs
 * - https://gitlab.com/group/subgroup/repo/-/merge_requests/123#note_456
 */
export function parseGitLabMrUrl(
  url: string
): { projectPath: string | null; projectId: string | null; mrIid: number | null } {
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
}

