/**
 * scripts/financial-brutal-test.ts
 */
import { prisma } from '../src/lib/prisma';
import { BatchCreateOrderUseCase } from '../src/features/orders/application/BatchCreateOrder.usecase';
import { BatchUpdateOrdersUseCase } from '../src/features/orders/application/BatchUpdateOrders.usecase';
import { PrismaOrderRepository } from '../src/features/orders/infrastructure/PrismaOrderRepository';
import * as crypto from 'crypto';

async function run() {
    console.log('--- 🚀 BRUTAL TEST RE-START ---');
    const orderRepo = new PrismaOrderRepository();
    const createUC = new BatchCreateOrderUseCase(orderRepo, null as any, null as any);
    const updateUC = new BatchUpdateOrdersUseCase();

    const client = await prisma.client.findFirst();
    const bank = await prisma.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
    const brand = await prisma.brand.findFirst();

    if (!client || !bank || !brand) { console.log('Setup data missing'); return; }

    for (let i = 1; i <= 20; i++) { // Reducido a 20 para velocidad, pero brutal
        process.stdout.write(`It ${i}/20... `);
        const receipt = `BRUTAL-${i}-${crypto.randomUUID().slice(0,4)}`;
        const price = 100;
        const dep = 10;

        // CREATE
        const res = await createUC.execute({
            receiptNumber: receipt, clientId: client.id, salesChannel: 'OFFICE', createdAt: new Date(), paymentMethod: 'EFECTIVO', bankAccountId: bank.id, transactionDate: new Date(),
            initialPayment: { amount: dep, method: 'EFECTIVO' },
            orders: [{ brandId: brand.id, brandName: brand.name, total: price, type: 'ORDEN', possibleDeliveryDate: new Date(), items: [], deposit: dep }]
        }, 'SYS');

        if (!res.isSuccess) { console.log('❌ CREATE FAIL:', res.error); break; }
        const orderId = (res as any).value[0].id;

        // 3 EDITS
        for (let j = 1; j <= 3; j++) {
            const nextPrice = 100 + (j * 10);
            const nextDep = 10 + (j * 20); // 10 -> 30 -> 50 -> 70
            
            await updateUC.execute({
                receiptNumber: receipt, clientId: client.id, salesChannel: 'OFFICE', createdAt: new Date(), paymentMethod: 'EFECTIVO', bankAccountId: bank.id, transactionDate: new Date(),
                toDelete: [], orders: [{ id: orderId, brandId: brand.id, brandName: brand.name, total: nextPrice, deposit: nextDep, type: 'ORDEN', possibleDeliveryDate: new Date(), quantity: 1 }]
            }, 'SYS');
        }

        // VALIDATE
        const payments: any[] = await prisma.$queryRaw`SELECT SUM(amount)::float as total FROM order_payments WHERE order_id = ${orderId}`;
        const totalPaid = payments[0].total;
        
        if (totalPaid > 70.01 || totalPaid < 69.99) {
            console.log(`❌ FAIL: Expected 70, got ${totalPaid}`);
            process.exit(1);
        }
        console.log('✅ OK');
    }
}
run().finally(() => prisma.$disconnect());
