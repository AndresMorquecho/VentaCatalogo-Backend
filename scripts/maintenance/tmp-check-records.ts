import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const records = await prisma.financialRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      balanceBefore: true,
      balanceAfter: true,
      amount: true,
      notes: true,
      userReference: true,
      createdAt: true
    }
  })
  console.log(JSON.stringify(records, null, 2))
}
main().finally(() => prisma.$disconnect())
