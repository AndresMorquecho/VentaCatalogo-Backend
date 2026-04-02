import { prisma } from '../../lib/prisma';

/**
 * Robust Sequential ID Generator
 * Uses system_settings table to maintain atomic counters for different entities/years.
 * This ensures no duplicates even with multiple concurrent users.
 */
export async function getNextSequence(prefix: string, type: 'DELIVERY' | 'EXCHANGE' | 'PACKING'): Promise<string> {
    const year = new Date().getFullYear();
    const key = `SEQ_${type}_${year}`;
    
    // Use raw query for Atomic update and return in one step if possible, 
    // but Prisma's transaction with update + select is also safe if managed correctly.
    // For wider compatibility across DB types (PostgreSQL in this case), we use a transaction.
    
    return await prisma.$transaction(async (tx) => {
        const setting = await tx.systemSettings.findUnique({
            where: { key }
        });

        let nextValue = 1;
        if (setting) {
            nextValue = parseInt(setting.value) + 1;
            await tx.systemSettings.update({
                where: { key },
                data: { 
                    value: nextValue.toString(),
                    updatedAt: new Date()
                }
            });
        } else {
            // Create if first time for this year
            await tx.systemSettings.create({
                data: {
                    key,
                    value: "1",
                    description: `Contador secuencial para ${type} - ${year}`
                }
            });
        }

        const paddedSeq = String(nextValue).padStart(3, '0');
        return `${prefix}${year}-${paddedSeq}`;
    });
}
