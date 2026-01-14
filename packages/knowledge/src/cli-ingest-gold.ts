/**
 * CLI script to ingest a Gold Merge Request
 * 
 * Usage: pnpm knowledge:ingest:gold --tenant dev --projectId 77381939 --mrIid 1
 */

import { initEnv } from '@mrp/config';
import { prisma, getOrCreateTenantBySlug } from '@mrp/db';
import { createGitLabClient } from '@mrp/gitlab';
import { ingestGoldMergeRequest } from './ingest.js';

// Load env (centralized)
initEnv();

async function main() {
  const args = process.argv.slice(2);
  
  let tenantSlug = 'default';
  let projectId: string | null = null;
  let mrIid: number | null = null;
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant' && args[i + 1]) {
      tenantSlug = args[i + 1];
      i++;
    } else if (args[i] === '--projectId' && args[i + 1]) {
      projectId = args[i + 1];
      i++;
    } else if (args[i] === '--mrIid' && args[i + 1]) {
      mrIid = parseInt(args[i + 1], 10);
      i++;
    }
  }
  
  if (!projectId || !mrIid) {
    console.error('Usage: pnpm knowledge:ingest:gold --tenant <slug> --projectId <id> --mrIid <iid>');
    process.exit(1);
  }
  
  console.log(`🌱 Ingesting Gold MR: projectId=${projectId}, mrIid=${mrIid}, tenant=${tenantSlug}`);
  
  try {
    // Resolve tenant
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    console.log(`   Tenant: ${tenant.slug} (${tenant.id})`);
    
    // Create GitLab client
    const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlab.com';
    const gitlabToken = process.env.GITLAB_TOKEN;
    
    if (!gitlabToken) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    
    const gitlabClient = createGitLabClient({
      baseUrl: gitlabBaseUrl,
      token: gitlabToken,
    });
    
    console.log(`   GitLab: ${gitlabBaseUrl}`);
    
    // Ingest
    const startTime = Date.now();
    console.log(`\n📥 Starting ingestion...`);
    
    const result = await ingestGoldMergeRequest(
      {
        tenantId: tenant.id,
        projectId,
        mrIid,
      },
      gitlabClient
    );
    
    const duration = Date.now() - startTime;
    
    console.log(`\n✅ Ingestion complete!`);
    console.log(`   ID: ${result.id}`);
    console.log(`   Content Hash: ${result.contentHash.substring(0, 16)}...`);
    console.log(`   Bytes: ${result.bytes.toLocaleString()}`);
    console.log(`   Created: ${result.created ? 'Yes' : 'No (updated existing)'}`);
    console.log(`   Duration: ${duration}ms`);
    
    console.log(JSON.stringify({
      event: 'knowledge.ingest.success',
      tenantId: tenant.id,
      type: 'GOLD_MR',
      provider: 'GITLAB',
      providerId: `${projectId}:${mrIid}`,
      contentHash: result.contentHash,
      bytes: result.bytes,
      durationMs: duration,
      created: result.created,
    }));
    
  } catch (error) {
    const err = error as Error;
    console.error(`\n❌ Ingestion failed: ${err.message}`);
    console.error(err.stack);
    
    console.log(JSON.stringify({
      event: 'knowledge.ingest.fail',
      tenantSlug,
      projectId,
      mrIid,
      error: err.message,
    }));
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

