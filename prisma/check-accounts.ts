
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const accounts = await prisma.bankAccount.findMany();
  console.log('Bank Accounts:', JSON.stringify(accounts, null, 2));
}

check();
