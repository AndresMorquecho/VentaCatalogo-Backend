const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const receiptNumber = 'OR-2026-005';
  const orders = await prisma.order.findMany({
    where: { receiptNumber },
    include: {
      payments: true,
      financialRecords: true
    }
  });

  let output = "";
  orders.forEach(o => {
    output += `Order: ${o.receiptNumber}, Total: ${o.total}, ID: ${o.id}\n`;
    o.payments.forEach(p => {
      output += `  Payment Amount: ${p.amount}, Method: ${p.method}, ID: ${p.id}\n`;
    });
    o.financialRecords.forEach(fr => {
      output += `  FR Amount: ${fr.amount}, Type: ${fr.type}, OP_ID: ${fr.orderPaymentId}\n`;
    });
  });
  fs.writeFileSync('bug_debug.txt', output);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(() => prisma.$disconnect());
