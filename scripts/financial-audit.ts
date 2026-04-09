/**
 * scripts/financial-audit.ts
 * 
 * FASE 1 & 2: Auditoría Integral de la Base de Datos
 */
import { prisma } from '../src/lib/prisma';

async function runAudit() {
    console.log('--- 🔍 INICIANDO AUDITORÍA FINANCIERA INTEGRAL ---');

    console.log('\n[FASE 1] Verificando Sobre-pagos (Overpayments)...');
    const overpayments: any[] = await prisma.$queryRaw`
        SELECT 
            o.id,
            o.order_number as "orderNumber",
            o.total::float,
            SUM(p.amount)::float as "paid"
        FROM orders o
        LEFT JOIN order_payments p ON p.order_id = o.id
        GROUP BY o.id, o.order_number, o.total
        HAVING SUM(p.amount) > o.total + 0.01;
    `;

    if (overpayments.length > 0) {
        console.log('❌ ERROR: Se encontraron órdenes con sobre-pago:');
        for (const op of overpayments) {
            const details = await prisma.orderPayment.findMany({ where: { orderId: op.id } });
            console.log(`- Order: ${op.orderNumber} (ID: ${op.id}) | Total: ${op.total} | Pagado: ${op.paid}`);
            console.log(`  Pagos:`, details.map(d => ({ amount: Number(d.amount), date: d.createdAt, method: d.method })));
        }
    } else {
        console.log('✅ OK: No hay sobre-pagos.');
    }

    console.log('\n[FASE 2] Verificando Consistencia entre Tablas (Payments vs FinancialRecords)...');
    
    // Scan all orders that have at least one payment
    const ordersWithPayments = await prisma.order.findMany({
        where: { payments: { some: {} } },
        select: { id: true, orderNumber: true }
    });

    let inconsistencies = 0;
    for (const order of ordersWithPayments) {
        const pSum: any[] = await prisma.$queryRaw`SELECT SUM(amount)::float as total FROM order_payments WHERE order_id = ${order.id}`;
        // Note: Financial records use orderId in metadata or notes since they group by receipt or movement.
        // But some use cases might not have linked them directly yet. 
        // We look for any record referencing this order ID in notes or clientId if it's the only one.
        // Actually, let's use the transactionGroupId or receipt mapping if available.
        // For now, only validate if they are exactly equal in a direct sum expectation.
        
        // This is tricky because one FinancialRecord might cover 5 orders.
        // So we sum by Receipt level instead.
    }

    // AUDITORÍA POR RECIBO (Más precisa)
    console.log('\n[FASE 2.1] Auditoría por Recibo...');
    const receipts: any[] = await prisma.$queryRaw`
        SELECT 
            r.receipt_number as "receiptNumber",
            SUM(p.amount)::float as "totalPayments"
        FROM order_receipts r
        JOIN orders o ON o.receipt_number = r.receipt_number
        JOIN order_payments p ON p.order_id = o.id
        GROUP BY r.receipt_number;
    `;

    for (const r of receipts) {
        const frSum: any[] = await prisma.$queryRaw`
            SELECT SUM(CASE WHEN "movement_type" = 'INCOME' THEN amount ELSE -amount END)::float as "totalFR"
            FROM financial_records
            WHERE notes LIKE '%' || ${r.receiptNumber} || '%';
        `;
        
        const frTotal = Number(frSum[0].totalFR || 0);
        const diff = Math.abs(r.totalPayments - frTotal);
        
        if (diff > 0.05) {
            console.log(`❌ DESINCRONIZACIÓN: Recibo ${r.receiptNumber} | Payments: ${r.totalPayments} | Financial: ${frTotal} | Diff: ${diff}`);
            inconsistencies++;
        }
    }

    if (inconsistencies === 0) console.log('✅ OK: Consistencia entre tablas verificada.');
    
    console.log('\n--- AUDITORÍA FINALIZADA ---');
}

runAudit().finally(() => prisma.$disconnect());
