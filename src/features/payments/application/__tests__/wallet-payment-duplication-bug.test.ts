import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../../lib/prisma';
import { RegisterOrderPaymentUseCase } from '../RegisterOrderPayment.usecase';
import { PrismaOrderRepository } from '../../../orders/infrastructure/PrismaOrderRepository';
import { PrismaFinancialRecordRepository } from '../../../financial/infrastructure/PrismaFinancialRecordRepository';
import { PrismaBankAccountRepository } from '../../../financial/infrastructure/PrismaBankAccountRepository';

/**
 * EXPLORATORY BUG CONDITION TEST
 * 
 * This test MUST FAIL on unfixed code - the failure confirms the bug exists.
 * DO NOT try to fix the test or the code when it fails.
 * 
 * Bug Condition: When registering a payment with BILLETERA_VIRTUAL method,
 * the system creates duplicate payment records causing getPaidAmount() to return double the amount.
 * 
 * Expected Behavior (after fix):
 * - Only ONE payment record should be created
 * - getPaidAmount() should return the correct amount (not doubled)
 * - Receipt PDF should show the correct amount in "Abono" column
 */
describe('Wallet Payment Duplication Bug - Exploratory Test', () => {
    let useCase: RegisterOrderPaymentUseCase;
    let orderRepository: PrismaOrderRepository;
    let financialRepository: PrismaFinancialRecordRepository;
    let bankAccountRepository: PrismaBankAccountRepository;
    
    let testOrderId: string;
    let testClientId: string;
    let testBrandId: string;
    let cashAccountId: string;

    beforeEach(async () => {
        // Setup repositories
        orderRepository = new PrismaOrderRepository();
        financialRepository = new PrismaFinancialRecordRepository();
        bankAccountRepository = new PrismaBankAccountRepository();
        useCase = new RegisterOrderPaymentUseCase(
            orderRepository,
            financialRepository,
            bankAccountRepository
        );

        // Create test data
        const brand = await prisma.brand.create({
            data: {
                name: `Test Brand ${Date.now()}`,
                description: 'Test brand for wallet payment bug test'
            }
        });
        testBrandId = brand.id;

        const client = await prisma.client.create({
            data: {
                firstName: 'Test',
                identificationNumber: `${Date.now()}`,
                identificationType: 'CEDULA',
                phone1: '0999999999',
                operator1: 'CLARO',
                country: 'Ecuador',
                province: 'Pichincha',
                city: 'Quito',
                address: 'Test Address',
                email: `test${Date.now()}@test.com`
            }
        });
        testClientId = client.id;

        // Create client account with credit
        const clientAccount = await prisma.clientAccount.create({
            data: {
                clientId: testClientId,
                totalCreditAvailable: 200, // Client has $200 credit
                version: 1
            }
        });

        // Create a client credit record
        await prisma.clientCredit.create({
            data: {
                clientAccountId: clientAccount.id,
                amount: 200,
                remainingAmount: 200,
                status: 'AVAILABLE',
                originTransactionId: `test-tx-${Date.now()}`
            }
        });

        const cashAccount = await prisma.bankAccount.findFirst({
            where: { type: 'CASH' }
        });
        if (!cashAccount) {
            const newCashAccount = await prisma.bankAccount.create({
                data: {
                    name: 'Caja Principal',
                    type: 'CASH',
                    holderName: 'Test Holder',
                    bankName: 'Test Bank',
                    accountNumber: '123456789',
                    currentBalance: 1000,
                    version: 1
                }
            });
            cashAccountId = newCashAccount.id;
        } else {
            cashAccountId = cashAccount.id;
        }

        // Create test order
        const order = await prisma.order.create({
            data: {
                receiptNumber: `TEST-${Date.now()}`,
                orderNumber: `ORD-${Date.now()}`,
                type: 'NORMAL',
                brandId: testBrandId,
                clientId: testClientId,
                clientName: 'Test Client',
                total: 123, // Order total is $123
                status: 'POR_RECIBIR',
                createdByName: 'test-user',
                salesChannel: 'DIRECTO',
                paymentMethod: 'EFECTIVO',
                possibleDeliveryDate: new Date(),
                transactionDate: new Date()
            }
        });
        testOrderId = order.id;
    });

    it('should create only ONE payment record when using BILLETERA_VIRTUAL', async () => {
        // Arrange: Payment of $123 using virtual wallet
        const paymentAmount = 123;
        const dto = {
            orderId: testOrderId,
            amount: 0, // No manual payment
            method: 'EFECTIVO', // Dummy method
            bankAccountId: 'default',
            notes: 'Pago con billetera virtual',
            creditAmount: paymentAmount // Using credit
        };

        // Act: Register payment
        const result = await useCase.execute(dto, 'test-user');

        // Assert: Should succeed
        expect(result.isSuccess).toBe(true);

        // Fetch order with payments
        const order = await prisma.order.findUnique({
            where: { id: testOrderId },
            include: { payments: true }
        });

        // BUG CONDITION CHECK: Should have only ONE payment record
        // EXPECTED TO FAIL on unfixed code (will have 2 records)
        expect(order?.payments.length).toBe(1);
        
        // The single payment should be CREDITO_CLIENTE with amount $123
        const payment = order?.payments[0];
        expect(payment?.method).toBe('CREDITO_CLIENTE');
        expect(Number(payment?.amount)).toBe(paymentAmount);
    });

    it('should calculate correct paid amount (not doubled) for wallet payment', async () => {
        // Arrange: Payment of $123 using virtual wallet
        const paymentAmount = 123;
        const dto = {
            orderId: testOrderId,
            amount: 0,
            method: 'EFECTIVO',
            bankAccountId: 'default',
            notes: 'Pago con billetera virtual',
            creditAmount: paymentAmount
        };

        // Act: Register payment
        await useCase.execute(dto, 'test-user');

        // Fetch order with payments
        const order = await prisma.order.findUnique({
            where: { id: testOrderId },
            include: { payments: true }
        });

        // Calculate paid amount (simulating getPaidAmount logic)
        const payments = order?.payments || [];
        const hasSplitPayment = payments.some(p => p.method === 'SPLIT_PAYMENT');
        const paidAmount = payments
            .filter(p => {
                if (hasSplitPayment && p.method === 'CREDITO_CLIENTE') return false;
                return true;
            })
            .reduce((acc, p) => acc + Number(p.amount || 0), 0);

        // BUG CONDITION CHECK: Paid amount should be $123, not $246
        // EXPECTED TO FAIL on unfixed code (will be $246)
        expect(paidAmount).toBe(paymentAmount);
        expect(paidAmount).not.toBe(paymentAmount * 2); // Should NOT be doubled
    });

    it('should show correct amount in receipt for split payment with wallet', async () => {
        // Arrange: Split payment - $20 wallet + $103 cash = $123 total
        const walletAmount = 20;
        const cashAmount = 103;
        const totalAmount = 123;

        // Register wallet payment
        const walletDto = {
            orderId: testOrderId,
            amount: 0,
            method: 'EFECTIVO',
            bankAccountId: 'default',
            notes: 'Pago con billetera virtual',
            creditAmount: walletAmount
        };
        await useCase.execute(walletDto, 'test-user');

        // Register cash payment
        const cashDto = {
            orderId: testOrderId,
            amount: cashAmount,
            method: 'EFECTIVO',
            bankAccountId: cashAccountId,
            notes: 'Pago en efectivo',
            creditAmount: 0
        };
        await useCase.execute(cashDto, 'test-user');

        // Fetch order with payments
        const order = await prisma.order.findUnique({
            where: { id: testOrderId },
            include: { payments: true }
        });

        // Calculate paid amount
        const payments = order?.payments || [];
        const hasSplitPayment = payments.some(p => p.method === 'SPLIT_PAYMENT');
        const paidAmount = payments
            .filter(p => {
                if (hasSplitPayment && p.method === 'CREDITO_CLIENTE') return false;
                return true;
            })
            .reduce((acc, p) => acc + Number(p.amount || 0), 0);

        // BUG CONDITION CHECK: Total paid should be $123, not $143 (20*2 + 103)
        // EXPECTED TO FAIL on unfixed code (will be $143 because wallet is doubled)
        expect(paidAmount).toBe(totalAmount);
        expect(paidAmount).not.toBe(walletAmount * 2 + cashAmount);
    });
});
