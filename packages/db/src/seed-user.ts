/**
 * Seed default user for tenant "dev"
 * Run with: pnpm --filter @mrp/db tsx src/seed-user.ts
 */

import { prisma } from './index.js';
import { getOrCreateTenantBySlug } from './tenant.js';
import { createHash } from 'crypto';

async function seedUser() {
  console.log('🌱 Seeding default user...');

  // Get or create "dev" tenant
  const tenant = await getOrCreateTenantBySlug('dev');
  console.log(`✅ Tenant: ${tenant.slug} (${tenant.id})`);

  // Create default user: admin@quickiter.com / password: admin123
  const email = 'admin@quickiter.com';
  const password = 'admin123';
  const passwordHash = createHash('sha256').update(password).digest('hex');

  const user = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email,
      },
    },
    create: {
      tenantId: tenant.id,
      email,
      passwordHash,
      role: 'OWNER',
    },
    update: {
      // Don't update password if user exists
      role: 'OWNER',
    },
  });

  console.log(`✅ User created/updated: ${user.email} (${user.id})`);
  console.log(`   Role: ${user.role}`);
  console.log(`   Password: ${password} (change this in production!)`);
  console.log('\n🎉 Seeding complete!');
}

seedUser()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

