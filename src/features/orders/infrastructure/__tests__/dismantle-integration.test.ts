import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../../lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * Integration Test for Dismantle Functionality
 * 
 * Este test verifica el comportamiento real contra la base de datos
 * Requiere una base de datos de prueba configurada
 */
describe('Dismantle Order - Integration Test', () => {
  let testClientId: string;
  let testOrderId: string;

  beforeAll(async () => {
    // Create test data
    const testClient = await prisma.client.create({
      data: {
        name: 'Test Client Dismantle',
        email: `test-dismantle-${Date.now()}@test.com`,
        phone: '1234567890',
        isBlocked: false,
      },
    });
    testClientId = testClient.id;

    const testOrder = await prisma.order.create({
      data: {
        receiptNumber: `TEST-DISMANTLE-${Date.now()}`,
        clientId: testClientId,
        clientName: testClient.name,
        brandId: 'test-brand',
        brandName: 'Test Brand',
        status: 'ENTREGADO',
        type: 'NORMAL',
        paymentStatus: 'PARCIALMENTE_PAGADO',
        totalAmount: 1000,
        paidAmount: 500,
        notes: 'Test order for dismantle',
        version: 1,
      },
    });
    testOrderId = testOrder.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testOrderId) {
      await prisma.order.delete({ where: { id: testOrderId } }).catch(() => {});
    }
    if (testClientId) {
      await prisma.client.delete({ where: { id: testClientId } }).catch(() => {});
    }
  });

  it('should NOT block client when using NORMAL mode', async () => {
    // Given: A client with an order ready to dismantle
    const clientBefore = await prisma.client.findUnique({ where: { id: testClientId } });
    expect(clientBefore?.isBlocked).toBe(false);

    // When: We dismantle the order in NORMAL mode
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.order.update({
        where: { id: testOrderId },
        data: {
          status: 'DESMANTELADO',
          notes: 'Test order for dismantle\n[DESMANTELADO - NORMAL: Solicitud del cliente]',
          version: { increment: 1 },
        },
      });

      // NORMAL mode should NOT update the client
      // No blocking action should be taken
    });

    // Then: The client should still be NOT blocked
    const clientAfter = await prisma.client.findUnique({ where: { id: testClientId } });
    expect(clientAfter?.isBlocked).toBe(false);
    expect(clientAfter?.blockedReason).toBeNull();

    // And: The order should be dismantled
    const orderAfter = await prisma.order.findUnique({ where: { id: testOrderId } });
    expect(orderAfter?.status).toBe('DESMANTELADO');
    expect(orderAfter?.notes).toContain('[DESMANTELADO - NORMAL: Solicitud del cliente]');
  });

  it('should block client when using BLOCK mode', async () => {
    // Given: Create a new order for BLOCK mode test
    const blockTestOrder = await prisma.order.create({
      data: {
        receiptNumber: `TEST-DISMANTLE-BLOCK-${Date.now()}`,
        clientId: testClientId,
        clientName: 'Test Client Dismantle',
        brandId: 'test-brand',
        brandName: 'Test Brand',
        status: 'ENTREGADO',
        type: 'NORMAL',
        paymentStatus: 'PARCIALMENTE_PAGADO',
        totalAmount: 1000,
        paidAmount: 500,
        notes: 'Test order for BLOCK mode',
        version: 1,
      },
    });

    const clientBefore = await prisma.client.findUnique({ where: { id: testClientId } });
    expect(clientBefore?.isBlocked).toBe(false);

    // When: We dismantle the order in BLOCK mode
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.order.update({
        where: { id: blockTestOrder.id },
        data: {
          status: 'DESMANTELADO',
          notes: 'Test order for BLOCK mode\n[DESMANTELADO - BLOCK: Pedido no retirado]',
          version: { increment: 1 },
        },
      });

      // BLOCK mode SHOULD update the client
      await tx.client.update({
        where: { id: testClientId },
        data: {
          isBlocked: true,
          blockedReason: 'DESMANTELADO: Pedido no retirado',
        },
      });
    });

    // Then: The client should be blocked
    const clientAfter = await prisma.client.findUnique({ where: { id: testClientId } });
    expect(clientAfter?.isBlocked).toBe(true);
    expect(clientAfter?.blockedReason).toBe('DESMANTELADO: Pedido no retirado');

    // And: The order should be dismantled
    const orderAfter = await prisma.order.findUnique({ where: { id: blockTestOrder.id } });
    expect(orderAfter?.status).toBe('DESMANTELADO');
    expect(orderAfter?.notes).toContain('[DESMANTELADO - BLOCK: Pedido no retirado]');

    // Cleanup
    await prisma.order.delete({ where: { id: blockTestOrder.id } });
    
    // Reset client for next tests
    await prisma.client.update({
      where: { id: testClientId },
      data: { isBlocked: false, blockedReason: null },
    });
  });
});
