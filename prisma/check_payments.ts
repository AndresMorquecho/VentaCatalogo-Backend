import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    const orders = await prisma.order.findMany({
        where: {
            status: { in: ['POR_ENVIAR', 'EN_TRANSITO', 'POR_RECIBIR', 'RECIBIDO_EN_BODEGA'] }
        },
        include: {
            payments: true
        }
    });

    const data = JSON.stringify(orders.map(o => ({
        id: o.id,
        receipt: o.receiptNumber,
        total: o.total,
        realTotal: o.realInvoiceTotal,
        payments: o.payments.map(p => ({ amount: p.amount, method: p.method, createdAt: p.createdAt }))
    })), null, 2);
    
    fs.writeFileSync('payments_dump.json', data);
}

main().catch(console.error).finally(() => prisma.$disconnect());
