import { PrismaClient } from '@prisma/client';
import { PrismaPortfolioRecoveryRepository } from './src/features/portfolio-recovery/infrastructure/PrismaPortfolioRecoveryRepository';

const prisma = new PrismaClient();
const repo = new PrismaPortfolioRecoveryRepository(prisma);

async function testTrends() {
  try {
    console.log('Testing recovery trends...\n');

    const trends = await repo.getRecoveryTrends({}, 'WEEK');

    console.log(`Found ${trends.length} trend data points:\n`);
    
    trends.forEach((trend) => {
      console.log(`Period: ${trend.period}`);
      console.log(`  Total in Warehouse: $${trend.totalInWarehouse}`);
      console.log(`  Total Recovered: $${trend.totalRecovered}`);
      console.log(`  Recovery Rate: ${trend.recoveryRate.toFixed(2)}%`);
      console.log(`  Order Count: ${trend.orderCount}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testTrends();
