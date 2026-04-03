import { prisma } from '../../lib/prisma';

/**
 * Robust Sequential ID Generator
 * Uses system_settings table to maintain atomic counters for different entities/years.
 * This ensures no duplicates even with multiple concurrent users.
 */
export async function getNextSequence(
  prefix: string, 
  type: 'DELIVERY' | 'EXCHANGE' | 'PACKING',
  txSource?: any
): Promise<string> {
    const year = new Date().getFullYear();
    const key = `SEQ_${type}_${year}`;
    const tableMap = { 'DELIVERY': 'delivery_batches', 'PACKING': 'reception_batches', 'EXCHANGE': 'exchange_batches' };
    const colMap = { 'DELIVERY': 'delivery_number', 'PACKING': 'packing_number', 'EXCHANGE': 'exchange_number' };
    const tableName = tableMap[type];
    const columnName = colMap[type];
    const searchPrefix = `${prefix}${year}-`;

    const runner = async (tx: any) => {
        // 1. OBTENER EL MÁXIMO REAL (Realidad)
        const dbResult = await (tx as any).$queryRawUnsafe(
            `SELECT MAX(CAST(REPLACE(${columnName}, '${searchPrefix}', '') AS INTEGER)) as max_seq FROM ${tableName} WHERE ${columnName} LIKE '${searchPrefix}%'`
        ) as any[];
        const physicalMax = dbResult[0]?.max_seq || 0;

        // 2. El siguiente valor es SIEMPRE la realidad + 1
        const nextValue = physicalMax + 1;

        // 3. ACTUALIZAR TABLA DE CONTROL (Sync Reality)
        await tx.systemSettings.upsert({
            where: { key },
            update: { value: nextValue.toString(), updatedAt: new Date() },
            create: {
                key,
                value: nextValue.toString(),
                description: `Contador secuencial para ${type} - ${year}`
            }
        });

        const paddedSeq = String(nextValue).padStart(3, '0');
        return `${prefix}${year}-${paddedSeq}`;
    };

    // Si ya estamos en una transaction, usarla. Si no, crear una nueva para el lock de systemSettings.
    if (txSource) {
        return await runner(txSource);
    } else {
        return await prisma.$transaction(async (tx) => {
            return await runner(tx);
        });
    }
}

/**
 * Solo consulta el siguiente valor sin incrementarlo.
 * Útil para previsualizar en el frontend.
 */
export async function peekNextSequence(prefix: string, type: 'DELIVERY' | 'EXCHANGE' | 'PACKING'): Promise<string> {
    const year = new Date().getFullYear();
    const key = `SEQ_${type}_${year}`;
    
    // Configuración según el tipo
    const tableMap = { 'DELIVERY': 'delivery_batches', 'PACKING': 'reception_batches', 'EXCHANGE': 'exchange_batches' };
    const colMap = { 'DELIVERY': 'delivery_number', 'PACKING': 'packing_number', 'EXCHANGE': 'exchange_number' };
    const tableName = tableMap[type];
    const columnName = colMap[type];
    const searchPrefix = `${prefix}${year}-`;

    const dbResult = await prisma.$queryRawUnsafe<any[]>(
        `SELECT MAX(CAST(REPLACE(${columnName}, '${searchPrefix}', '') AS INTEGER)) as max_seq FROM ${tableName} WHERE ${columnName} LIKE '${searchPrefix}%'`
    );
    const physicalMax = dbResult[0]?.max_seq || 0;

    const setting = await prisma.systemSettings.findUnique({ where: { key } });
    const currentCounterValue = setting ? parseInt(setting.value) : 0;

    const nextValue = physicalMax + 1;
    const paddedSeq = String(nextValue).padStart(3, '0');
    return `${prefix}${year}-${paddedSeq}`;
}
