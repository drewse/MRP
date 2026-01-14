/**
 * CLI script to ingest documentation from local filesystem
 * 
 * Usage: pnpm knowledge:ingest:docs --tenant dev --path .
 */

import { resolve } from 'path';
import { initEnv } from '@mrp/config';
import { prisma, getOrCreateTenantBySlug } from '@mrp/db';
import { ingestDocsFromRepo } from './ingest.js';

// Load env (centralized)
initEnv();

async function main() {
  const args = process.argv.slice(2);
  
  let tenantSlug = 'default';
  let rootPath = '.';
  
  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tenant' && args[i + 1]) {
      tenantSlug = args[i + 1];
      i++;
    } else if (args[i] === '--path' && args[i + 1]) {
      rootPath = args[i + 1];
      i++;
    }
  }
  
  const resolvedPath = resolve(rootPath);
  console.log(`🌱 Ingesting docs from: ${resolvedPath}, tenant=${tenantSlug}`);
  
  try {
    // Resolve tenant
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    console.log(`   Tenant: ${tenant.slug} (${tenant.id})`);
    
    // Ingest
    const startTime = Date.now();
    console.log(`\n📥 Starting ingestion...`);
    
    const results = await ingestDocsFromRepo({
      tenantId: tenant.id,
      rootPath: resolvedPath,
    });
    
    const duration = Date.now() - startTime;
    const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
    const createdCount = results.filter(r => r.created).length;
    const updatedCount = results.length - createdCount;
    
    console.log(`\n✅ Ingestion complete!`);
    console.log(`   Files processed: ${results.length}`);
    console.log(`   Created: ${createdCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Total bytes: ${totalBytes.toLocaleString()}`);
    console.log(`   Duration: ${duration}ms`);
    
    if (results.length > 0) {
      console.log(`\n   IDs:`);
      for (const result of results.slice(0, 10)) {
        console.log(`     - ${result.id.substring(0, 12)}... (${result.bytes.toLocaleString()} bytes, ${result.created ? 'created' : 'updated'})`);
      }
      if (results.length > 10) {
        console.log(`     ... and ${results.length - 10} more`);
      }
    }
    
    console.log(JSON.stringify({
      event: 'knowledge.ingest.success',
      tenantId: tenant.id,
      type: 'DOC',
      provider: 'LOCAL',
      rootPath: resolvedPath,
      fileCount: results.length,
      createdCount,
      updatedCount,
      totalBytes,
      durationMs: duration,
    }));
    
  } catch (error) {
    const err = error as Error;
    console.error(`\n❌ Ingestion failed: ${err.message}`);
    console.error(err.stack);
    
    console.log(JSON.stringify({
      event: 'knowledge.ingest.fail',
      tenantSlug,
      rootPath: resolvedPath,
      error: err.message,
    }));
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

