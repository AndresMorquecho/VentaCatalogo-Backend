import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("Fixing unlinked financial records from CREDIT_DISTRIBUTION...");
    
    // Find all order payments of method CREDITO_CLIENTE 
    const creditPayments = await prisma.orderPayment.findMany({
        where: { method: 'CREDITO_CLIENTE' },
        include: { financialRecords: true }
    });

    let fixedCount = 0;

    for (const payment of creditPayments) {
        // Find if there is an unlinked financialRecord for this order with the same amount and approximate date
        if (payment.financialRecords.length === 0) {
            const unlinkedFr = await prisma.financialRecord.findFirst({
                where: {
                    orderId: payment.orderId,
                    movementType: 'INCOME',
                    source: 'CREDIT_DISTRIBUTION',
                    amount: payment.amount,
                    orderPaymentId: null
                }
            });

            if (unlinkedFr) {
                console.log(`Linking payment ${payment.id} to FR ${unlinkedFr.id} for order ${payment.orderId}`);
                await prisma.financialRecord.update({
                    where: { id: unlinkedFr.id },
                    data: { orderPaymentId: payment.id }
                });
                fixedCount++;
            }
        }
    }
    
    console.log(`Fixed ${fixedCount} unlinked financial records.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
