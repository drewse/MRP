/**
 * Simple script to test database connection
 * Run with: pnpm --filter @mrp/db exec tsx test-connection.ts
 */
import { checkDbConnection, disconnectPrisma } from './src/index.js';

async function main() {
  try {
    await checkDbConnection();
    process.exit(0);
  } catch (error) {
    console.error('Connection test failed:', error);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

main();

