const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const id = '3fbe18aa-fc4a-4941-b1b9-9ed1d4608f61';

async function check() {
  const [orders, receipts, financial, inventory, calls, accounts, walletRecharges] = await Promise.all([
    prisma.order.count({ where: { clientId: id } }),
    prisma.orderReceipt.count({ where: { clientId: id } }),
    prisma.financialRecord.count({ where: { clientId: id } }),
    prisma.inventoryMovement.count({ where: { clientId: id } }),
    prisma.call.count({ where: { clientId: id } }),
    prisma.clientAccount.count({ where: { clientId: id } }),
    prisma.walletRecharge.count({ where: { clientId: id } }),
  ]);
  console.log('orders:', orders);
  console.log('orderReceipts:', receipts);
  console.log('financialRecords:', financial);
  console.log('inventoryMovements:', inventory);
  console.log('calls:', calls);
  console.log('clientAccounts:', accounts);
  console.log('walletRecharges:', walletRecharges);
  await prisma.$disconnect();
}
check();
