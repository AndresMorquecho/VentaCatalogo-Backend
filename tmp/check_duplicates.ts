
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const batches = await prisma.receptionBatch.findMany({
        select: { packingNumber: true }
    });
    
    const counts: Record<string, number> = {};
    for (const b of batches) {
        counts[b.packingNumber] = (counts[b.packingNumber] || 0) + 1;
    }
    
    const duplicates = Object.entries(counts).filter(([_, count]) => count > 1);
    console.log("DUPLICATES FOUND:", duplicates);
}

main().catch(console.error).finally(() => prisma.$disconnect());
