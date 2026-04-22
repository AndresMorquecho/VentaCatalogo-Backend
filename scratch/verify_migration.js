const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  const orders = await prisma.order.count();
  const clients = await prisma.client.count();
  const payments = await prisma.orderPayment.count();
  const financials = await prisma.financialRecord.count();
  const brands = await prisma.brand.count();
  
  const totalPedido = await prisma.order.aggregate({ _sum: { total: true } });
  const totalAbonado = await prisma.orderPayment.aggregate({ _sum: { amount: true } });
  
  const caja = await prisma.bankAccount.findFirst({ where: { name: 'Caja Principal' } });

  console.log('--- Verificación de Migración ---');
  console.log('Pedidos:', orders);
  console.log('Clientes:', clients);
  console.log('Pagos:', payments);
  console.log('Registros Financieros:', financials);
  console.log('Marcas:', brands);
  console.log('Suma Total Pedidos:', totalPedido._sum.total);
  console.log('Suma Total Abonado:', totalAbonado._sum.amount);
  console.log('Balance Caja Principal:', caja.currentBalance);
}

verify().finally(() => prisma.$disconnect());
