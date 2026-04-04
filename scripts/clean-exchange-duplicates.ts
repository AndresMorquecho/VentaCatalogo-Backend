import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Cleaning duplicate exchanges based on sourceOrderId...');
    
    const duplicates = await prisma.order.groupBy({
        by: ['sourceOrderId'],
        where: {
            sourceOrderId: { not: null }
        },
        _count: {
            _all: true
        },
        having: {
            sourceOrderId: {
                _count: {
                    gt: 1
                }
            }
        }
    });

    console.log(`Found ${duplicates.length} duplicate exchange groups.`);

    for (const dup of duplicates) {
        const sourceOrderId = dup.sourceOrderId as string;
        
        const orders = await prisma.order.findMany({
            where: { sourceOrderId },
            select: { id: true, orderNumber: true, status: true, createdAt: true },
            orderBy: { createdAt: 'asc' } // Keep the first one created
        });

        const [toKeep, ...toDelete] = orders;
        console.log(`\nSource ${sourceOrderId}: Keeping ${toKeep.id} (${toKeep.orderNumber}). Deleting ${toDelete.length} duplicates.`);
        
        for (const order of toDelete) {
            // Check for dependent records before deleting
            // OrderItems, OrderPayments, FinancialRecords, etc.
            // But since these are fresh duplicates, we can try cascade or just clean them.
            // If they are part of a receipt, they might be alone or not.
            
            try {
                await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
                await prisma.orderPayment.deleteMany({ where: { orderId: order.id } });
                await prisma.financialRecord.deleteMany({ where: { orderId: order.id } });
                await prisma.order.delete({ where: { id: order.id } });
                console.log(`  Deleted ${order.id}`);
            } catch (err) {
                console.error(`  Failed to delete ${order.id}:`, err);
            }
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
