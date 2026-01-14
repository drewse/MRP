/**
 * Seed default check configurations for tenants
 * 
 * Run with: pnpm --filter @mrp/db seed:check-configs
 */

import { PrismaClient } from '@prisma/client';
import { ALL_CHECKS } from '@mrp/checks';

const prisma = new PrismaClient();

async function seedCheckConfigs() {
  console.log('🌱 Seeding check configurations for all tenants...');

  // Get all tenants
  const tenants = await prisma.tenant.findMany();

  if (tenants.length === 0) {
    console.log('⚠️  No tenants found. Create a tenant first.');
    return;
  }

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const tenant of tenants) {
    console.log(`\n📋 Processing tenant: ${tenant.slug} (${tenant.id})`);

    for (const check of ALL_CHECKS) {
      // Check if config already exists
      const existing = await prisma.checkConfig.findUnique({
        where: {
          tenantId_checkKey: {
            tenantId: tenant.id,
            checkKey: check.key,
          },
        },
      });

      if (existing) {
        totalSkipped++;
        continue;
      }

      // Create default config (enabled, no overrides)
      await prisma.checkConfig.create({
        data: {
          tenantId: tenant.id,
          checkKey: check.key,
          enabled: true,
          severityOverride: null,
          thresholds: undefined,
        },
      });

      totalCreated++;
    }

    console.log(`   ✅ Created ${ALL_CHECKS.length - totalSkipped} configs for ${tenant.slug}`);
  }

  console.log(`\n✨ Seeding complete!`);
  console.log(`   Created: ${totalCreated} configs`);
  console.log(`   Skipped: ${totalSkipped} existing configs`);
  console.log(`   Total checks: ${ALL_CHECKS.length}`);
}

seedCheckConfigs()
  .catch((error) => {
    console.error('❌ Error seeding check configs:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

