import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Find the order by orderNumber
  const order = await prisma.order.findFirst({
    where: { orderNumber: '320997' },
    include: {
      items: true,
      payments: true,
      receipt: true,
      receptionBatch: true,
      deliveryBatch: true,
      financialRecords: true,
      brand: { select: { name: true } },
      client: { select: { id: true, firstName: true, identificationNumber: true } }
    }
  });

  if (!order) {
    console.log('Order 320997 not found, trying with receipt_number...');
    const orderByReceipt = await prisma.order.findFirst({
      where: { receiptNumber: '320997' },
      include: {
        items: true,
        payments: true,
        receipt: true,
        receptionBatch: true,
        deliveryBatch: true,
        financialRecords: true,
        brand: { select: { name: true } },
        client: { select: { id: true, firstName: true, identificationNumber: true } }
      }
    });
    console.log('By receiptNumber:', JSON.stringify(orderByReceipt, null, 2));
  } else {
    console.log('Order found:', JSON.stringify(order, null, 2));
  }

  // 2. List available order statuses used in the system
  const statuses = await prisma.order.groupBy({
    by: ['status'],
    _count: { status: true }
  });
  console.log('\n--- Available statuses ---');
  console.log(JSON.stringify(statuses, null, 2));

  // 3. Find user DDCA
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: 'DDCA', mode: 'insensitive' } },
        { username: { contains: 'ddca', mode: 'insensitive' } },
        { username: { contains: 'diego', mode: 'insensitive' } },
        { username: { contains: 'carrillo', mode: 'insensitive' } }
      ]
    }
  });
  console.log('\n--- Users matching DDCA ---');
  console.log(JSON.stringify(users, null, 2));

  // 4. Find bank accounts (cash boxes)
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true, currentBalance: true, holderName: true, bankName: true }
  });
  console.log('\n--- Bank accounts (cajas) ---');
  console.log(JSON.stringify(bankAccounts, null, 2));

  // 5. Check existing packing numbers for reference
  const recentPackings = await prisma.receptionBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, packingNumber: true, packingTotal: true, receptionDate: true, receivedByName: true }
  });
  console.log('\n--- Recent packing batches ---');
  console.log(JSON.stringify(recentPackings, null, 2));

  // 6. Check existing delivery batches for reference
  const recentDeliveries = await prisma.deliveryBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, deliveryNumber: true, deliveryDate: true, deliveredByName: true }
  });
  console.log('\n--- Recent delivery batches ---');
  console.log(JSON.stringify(recentDeliveries, null, 2));

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); });
