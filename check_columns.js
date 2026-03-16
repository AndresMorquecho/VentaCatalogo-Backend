const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const columns = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'clients'
      ORDER BY column_name
    `;
    console.log('ALL columns in clients table:');
    columns.forEach(c => console.log(`- ${c.column_name}`));
  } catch (error) {
    console.error('Error checking columns:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
