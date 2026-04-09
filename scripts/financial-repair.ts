/**
 * scripts/financial-repair.ts
 * 
 * FASE 4: Reparación Automática de Inconsistencias
 */
import { prisma } from '../src/lib/prisma';
import crypto from 'crypto';

async function runRepair() {
    console.log('--- 🛠️ INICIANDO REPARACIÓN FINANCIERA ---');

    // 1. Buscar órdenes corruptas (Sobre-pagos)
    const corruptOrders: any[] = await prisma.$queryRaw`
        SELECT 
            o.id,
            o."order_number" as "orderNumber",
            o.total::float,
            SUM(p.amount)::float as "paid",
            o."receipt_number" as "receiptNumber",
            o."client_id" as "clientId",
            o."client_name" as "clientName"
        FROM orders o
        JOIN order_payments p ON p.order_id = o.id
        GROUP BY o.id, o."order_number", o.total, o."receipt_number", o."client_id", o."client_name"
        HAVING SUM(p.amount) > o.total + 0.01;
    `;

    if (corruptOrders.length === 0) {
        console.log('✅ No se detectaron órdenes con sobre-pago que requieran reparación.');
    } else {
        console.log(`⚠️ Se detectaron ${corruptOrders.length} órdenes corruptas. Iniciando reparación segura...`);
        
        for (const order of corruptOrders) {
            const overpaidAmount = Number((order.paid - order.total).toFixed(2));
            console.log(`Repairing ${order.orderNumber}: Overpaid $${overpaidAmount}`);

            await prisma.$transaction(async (tx) => {
                // A. Crear pago de ajuste NEGATIVO para cuadrar la orden
                const adjustmentPayment = await tx.orderPayment.create({
                    data: {
                        id: crypto.randomUUID(),
                        orderId: order.id,
                        amount: -overpaidAmount,
                        method: 'AJUSTE_AUTO',
                        isAdjustment: true,
                        receiptNumber: `FIX-${crypto.randomUUID().slice(0, 6)}`,
                        description: 'REPARACIÓN AUTOMÁTICA DE SOBRE-PAGO (HARDENING FASE 4)'
                    } as any
                });

                // B. Crear FinancialRecord compensatorio (Money moves to Wallet)
                // Esto asegura que el cliente no pierda su dinero excedente, 
                // se le acredita en su billetera virtual.
                await tx.financialRecord.create({
                    data: {
                        id: crypto.randomUUID(),
                        type: 'PAYMENT',
                        source: 'RECEPTION',
                        movementType: 'INCOME',
                        fromAccountType: 'INTERNAL',
                        toAccountType: 'WALLET',
                        amount: overpaidAmount,
                        date: new Date(),
                        clientId: order.clientId,
                        clientName: order.clientName,
                        referenceNumber: `FIX-WAL-${crypto.randomUUID().slice(0, 12)}`,
                        paymentMethod: 'BILLETERA_VIRTUAL',
                        isReversal: false,
                        notes: JSON.stringify({
                            title: 'AJUSTE_REPARACION',
                            description: `Corrección automática de sobre-pago en pedido ${order.orderNumber}. Saldo excedente acreditado a billetera.`
                        })
                    } as any
                });

                // C. Incrementar crédito del cliente
                await tx.clientAccount.update({
                    where: { clientId: order.clientId },
                    data: { totalCreditAvailable: { increment: overpaidAmount } }
                });
            });

            console.log(`✅ ${order.orderNumber} remediado. +$${overpaidAmount} acreditados a billetera.`);
        }
    }

    console.log('\n--- REPARACIÓN FINALIZADA ---');
}

runRepair().catch(console.error).finally(() => prisma.$disconnect());
