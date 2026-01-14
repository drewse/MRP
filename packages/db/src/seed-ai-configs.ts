/**
 * Seed TenantAiConfig for all existing tenants
 * Creates default disabled configs
 */

import { prisma } from './index.js';

async function seedAiConfigs(): Promise<void> {
  console.log('Seeding TenantAiConfig for all tenants...');

  const tenants = await prisma.tenant.findMany();

  for (const tenant of tenants) {
    // Check if config already exists
    const existing = await prisma.tenantAiConfig.findUnique({
      where: { tenantId: tenant.id },
    });

    if (existing) {
      console.log(`  ✓ Tenant "${tenant.slug}" already has AI config`);
      continue;
    }

    // Create default disabled config
    await prisma.tenantAiConfig.create({
      data: {
        tenantId: tenant.id,
        enabled: false,
        provider: 'OPENAI',
        model: 'gpt-4o-mini',
        maxSuggestions: 5,
        maxPromptChars: 6000,
        maxTotalDiffBytes: 40000,
      },
    });

    console.log(`  ✓ Created AI config for tenant "${tenant.slug}" (disabled by default)`);
  }

  console.log(`\n✅ Seeded AI configs for ${tenants.length} tenant(s)`);
}

seedAiConfigs()
  .catch((error) => {
    console.error('Error seeding AI configs:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

