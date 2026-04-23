const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRaw`
  SELECT o.id, o."receipt_number", o.total, o."real_invoice_total", COALESCE(SUM(p.amount), 0) as payments
  FROM "orders" o
  LEFT JOIN "order_payments" p ON o.id = p."order_id"
  WHERE o."receipt_number" = '320987'
  GROUP BY o.id
  HAVING CASE WHEN o."real_invoice_total" IS NULL OR o."real_invoice_total" = 0 THEN o.total ELSE o."real_invoice_total" END > COALESCE(SUM(p.amount), 0)
`
  .then(console.log)
  .finally(() => prisma.$disconnect());
