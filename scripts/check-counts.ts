import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function m() {
  console.log('Clients:', await p.client.count());
  console.log('Brands:', await p.brand.count());
  console.log('Users:', await p.user.count());
  console.log('BankAccounts:', await p.bankAccount.count());
}
m().finally(() => p.$disconnect());
