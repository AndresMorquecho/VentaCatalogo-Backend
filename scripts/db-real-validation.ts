/**
 * scripts/db-real-validation.ts
 */
import { prisma } from '../src/lib/prisma';
import { BatchCreateOrderUseCase } from '../src/features/orders/application/BatchCreateOrder.usecase';
import { BatchUpdateOrdersUseCase } from '../src/features/orders/application/BatchUpdateOrders.usecase';
import { PrismaOrderRepository } from '../src/features/orders/infrastructure/PrismaOrderRepository';
import * as crypto from 'crypto';

async function run() {
    console.log('--- 🛡️ FINAL REAL DB VALIDATION ---');

    const client = await prisma.client.findFirst();
    const bank = await prisma.bankAccount.findFirst({ where: { type: 'CASH' } });
    const brand = await prisma.brand.findFirst();

    if (!client || !bank || !brand) {
        console.log('Setup data missing'); return;
    }

    const receipt = 'VAL-FINAL-' + crypto.randomUUID().slice(0, 5);
    const createUC = new BatchCreateOrderUseCase(new PrismaOrderRepository(), null as any, null as any);
    const updateUC = new BatchUpdateOrdersUseCase();

    // 1. CREATE $1
    console.log('CREATING $1...');
    await createUC.execute({
        receiptNumber: receipt, clientId: client.id, salesChannel: 'OFFICE', createdAt: new Date(), paymentMethod: 'EFECTIVO', bankAccountId: bank.id, transactionDate: new Date(),
        initialPayment: { amount: 1, method: 'EFECTIVO' },
        orders: [{ brandId: brand.id, brandName: brand.name, total: 20, type: 'ORDEN', possibleDeliveryDate: new Date(), items: [], deposit: 1 }]
    }, 'SYS');

    const order = await prisma.order.findFirst({ where: { receiptNumber: receipt } });

    // 2. UPDATE $1 -> $10
    console.log('UPDATING $1 -> $10...');
    await updateUC.execute({
        receiptNumber: receipt, clientId: client.id, salesChannel: 'OFFICE', createdAt: new Date(), paymentMethod: 'EFECTIVO', bankAccountId: bank.id, transactionDate: new Date(),
        toDelete: [], orders: [{ id: order!.id, brandId: brand.id, brandName: brand.name, total: 20, deposit: 10, type: 'ORDEN', possibleDeliveryDate: new Date(), quantity: 1 }]
    }, 'SYS');

    // 3. RAW DB QUERY
    const payments: any[] = await prisma.$queryRaw`SELECT amount::float FROM order_payments WHERE order_id = ${order!.id}`;
    const total = payments.reduce((s, p) => s + p.amount, 0);

    console.log('--- DB RESULTS ---');
    console.log('Records:', payments);
    console.log('SUM TOTAL:', total);

    if (total === 10) {
        console.log('✅ PASS: NO DUPLICATION');
    } else {
        console.log('❌ FAIL: DUPLICATION');
    }
}

run().catch(console.error).finally(() => prisma.$disconnect());
