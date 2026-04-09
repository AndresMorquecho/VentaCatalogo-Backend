import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    const orders = await prisma.order.findMany({
        where: { receiptNumber: 'OR-2026-001' },
        include: { payments: true }
    });

    const out = orders.map(o => {
        const sum = o.payments.reduce((acc, p) => acc + Number(p.amount), 0);
        return {
            id: o.id,
            total: o.total,
            realTotal: o.realInvoiceTotal,
            status: o.status,
            paymentsLength: o.payments.length,
            sum,
            payments: o.payments.map(p => ({
                id: p.id,
                amount: p.amount,
                method: p.method,
                desc: p.description,
                date: p.createdAt
            }))
        };
    });
    
    fs.writeFileSync('check_sum.json', JSON.stringify(out, null, 2), 'utf8');
}

main().catch(console.error).finally(() => prisma.$disconnect());
