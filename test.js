const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const frs = await prisma.financialRecord.findMany({
        where: { source: 'WALLET_WITHDRAWAL' }
    });

    for (const record of frs) {
        if (record.notes && !record.notes.includes('"v":2') && record.notes.includes('DEVOLUCION_BILLETERA')) {
            try {
                const parsed = JSON.parse(record.notes);
                parsed.v = 2;
                parsed.orders = [];
                await prisma.financialRecord.update({
                    where: { id: record.id },
                    data: { notes: JSON.stringify(parsed) }
                });
                console.log(`Updated notes for record ${record.id}`);
            } catch (e) {
                console.error(`Failed to parse notes for ${record.id}`);
            }
        }
    }
}

main().finally(() => prisma.$disconnect());
