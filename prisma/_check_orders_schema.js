const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe(
      "select to_regclass('public.orders')::text as orders_table, to_regclass('public.order_payments')::text as order_payments_table"
    );
    const cols = await prisma.$queryRawUnsafe(
      "select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='orders' and column_name in ('order_number','receipt_number','parent_order_id') order by column_name"
    );

    console.log("tables:", tables);
    console.log("orders columns:", cols);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

