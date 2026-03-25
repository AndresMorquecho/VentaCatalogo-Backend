import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function inspect() {
  const records = await prisma.financialRecord.findMany({
    take: 100,
    orderBy: { createdAt: 'desc' },
    include: {
      bankAccount: true
    }
  });

  console.log('--- REPORTE DE TRANSACCIONES REALES ---');
  records.forEach((r: any) => {
    let section = 'OTROS';
    const notes = (r.notes || '').toLowerCase();
    const source = r.source || '';
    const type = r.type || '';
    const method = r.paymentMethod || '';

    if (notes.includes('inicial')) {
        section = 'ABONOS INICIALES';
    } else if (notes.includes('tipo: entrega') || notes.includes('entrega')) {
        section = 'ENTREGA';
    } else if (notes.includes('tipo: normal') || notes.includes('abono')) {
        if (source === 'ORDER_PAYMENT') section = 'ABONOS';
    } else if (source === 'CATALOG_SALE') {
        section = 'VENTAS';
    } else if (method === 'BILLETERA_VIRTUAL' || r.movementType === 'INTERNAL' && r.fromAccountType === 'WALLET') {
        section = 'BILLETERA VIRTUAL';
    }

    console.log(`[${section}] | ${r.createdAt.toISOString().slice(0, 16)} | ${r.clientName} | $${r.amount} | Tipo: ${r.type} | Method: ${method} | Notes: ${r.notes}`);
  });
}

inspect().catch(console.error).finally(() => prisma.$disconnect());
