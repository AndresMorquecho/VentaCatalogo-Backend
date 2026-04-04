import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Finding duplicate exchanges based on sourceOrderId...');
    
    // Groups orders by sourceOrderId where it is not null, counting them.
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

    console.log(`Found ${duplicates.length} duplicate exchange sources.`);

    for (const dup of duplicates) {
        const sourceOrderId = dup.sourceOrderId as string;
        const count = dup._count._all;
        
        const orders = await prisma.order.findMany({
            where: { sourceOrderId },
            select: { id: true, orderNumber: true, receiptNumber: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' }
        });

        console.log(`\nSource Order ID: ${sourceOrderId}`);
        console.log(`Count: ${count}`);
        orders.forEach((o, i) => {
            console.log(`${i === 0 ? 'KEEP' : 'DELETE'} - ID: ${o.id}, Order#: ${o.orderNumber}, Receipt#: ${o.receiptNumber}, Status: ${o.status}, Created: ${o.createdAt}`);
        });
        
        // Delete all but the most recent one (T1 and T2 race, keeping T2 since it was the "last" one, or T1, doesn't matter much as they are same source)
        const idsToDelete = orders.slice(1).map(o => o.id);
        
        // For safety, only log unless we are sure.
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
