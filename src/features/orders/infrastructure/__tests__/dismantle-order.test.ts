import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaOrderRepository } from '../PrismaOrderRepository';

// Mock Prisma
vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    client: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

import { prisma } from '@/lib/prisma';

describe('Order Dismantle Functionality', () => {
  let orderRepository: PrismaOrderRepository;
  
  const mockOrder = {
    id: 'order-123',
    clientId: 'client-456',
    receiptNumber: 'TEST-001',
    status: 'ENTREGADO',
    notes: 'Test order',
    brandName: 'Test Brand',
    clientName: 'Test Client',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    orderRepository = new PrismaOrderRepository();
    
    // Setup default mock behavior
    prisma.order.findUnique.mockResolvedValue(mockOrder);
    
    // Mock transaction to execute callback immediately with tx context
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        order: {
          update: vi.fn().mockResolvedValue({ ...mockOrder, status: 'DESMANTELADO' }),
        },
        client: {
          update: vi.fn().mockResolvedValue({ id: mockOrder.clientId, isBlocked: true }),
        },
      };
      return await callback(tx);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('BLOCK Mode', () => {
    it('should dismantle order and BLOCK the client when mode is BLOCK', async () => {
      let capturedTx: any;
      
      prisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          order: {
            update: vi.fn().mockResolvedValue({ ...mockOrder, status: 'DESMANTELADO' }),
          },
          client: {
            update: vi.fn().mockResolvedValue({ 
              id: mockOrder.clientId, 
              isBlocked: true,
              blockedReason: 'DESMANTELADO: Pedido no retirado'
            }),
          },
        };
        capturedTx = tx;
        return await callback(tx);
      });

      await orderRepository.dismantle('order-123', 'BLOCK', 'Pedido no retirado');

      // Verify order was found
      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-123' }
      });

      // Verify order status was updated to DESMANTELADO
      expect(capturedTx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'DESMANTELADO',
          notes: 'Test order\n[DESMANTELADO - BLOCK: Pedido no retirado]',
          version: { increment: 1 }
        }
      });

      // Verify client WAS BLOCKED
      expect(capturedTx.client.update).toHaveBeenCalledWith({
        where: { id: 'client-456' },
        data: {
          isBlocked: true,
          blockedReason: 'DESMANTELADO: Pedido no retirado'
        }
      });
    });

    it('should handle order with no previous notes in BLOCK mode', async () => {
      const orderWithoutNotes = { ...mockOrder, notes: null };
      prisma.order.findUnique.mockResolvedValue(orderWithoutNotes);

      let capturedTx: any;
      prisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          order: {
            update: vi.fn().mockResolvedValue({ ...orderWithoutNotes, status: 'DESMANTELADO' }),
          },
          client: {
            update: vi.fn().mockResolvedValue({ id: mockOrder.clientId, isBlocked: true }),
          },
        };
        capturedTx = tx;
        return await callback(tx);
      });

      await orderRepository.dismantle('order-123', 'BLOCK', 'Test reason');

      expect(capturedTx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'DESMANTELADO',
          notes: '[DESMANTELADO - BLOCK: Test reason]',
          version: { increment: 1 }
        }
      });
    });
  });

  describe('NORMAL Mode', () => {
    it('should dismantle order but NOT BLOCK the client when mode is NORMAL', async () => {
      let capturedTx: any;
      
      prisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          order: {
            update: vi.fn().mockResolvedValue({ ...mockOrder, status: 'DESMANTELADO' }),
          },
          client: {
            update: vi.fn(),
          },
        };
        capturedTx = tx;
        return await callback(tx);
      });

      await orderRepository.dismantle('order-123', 'NORMAL', 'Solicitud del cliente');

      // Verify order was found
      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'order-123' }
      });

      // Verify order status was updated to DESMANTELADO
      expect(capturedTx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'DESMANTELADO',
          notes: 'Test order\n[DESMANTELADO - NORMAL: Solicitud del cliente]',
          version: { increment: 1 }
        }
      });

      // Verify client WAS NOT BLOCKED - this is the key assertion
      expect(capturedTx.client.update).not.toHaveBeenCalled();
    });

    it('should handle order with no previous notes in NORMAL mode', async () => {
      const orderWithoutNotes = { ...mockOrder, notes: null };
      prisma.order.findUnique.mockResolvedValue(orderWithoutNotes);

      let capturedTx: any;
      prisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          order: {
            update: vi.fn().mockResolvedValue({ ...orderWithoutNotes, status: 'DESMANTELADO' }),
          },
          client: {
            update: vi.fn(),
          },
        };
        capturedTx = tx;
        return await callback(tx);
      });

      await orderRepository.dismantle('order-123', 'NORMAL', 'Acordado con cliente');

      expect(capturedTx.order.update).toHaveBeenCalledWith({
        where: { id: 'order-123' },
        data: {
          status: 'DESMANTELADO',
          notes: '[DESMANTELADO - NORMAL: Acordado con cliente]',
          version: { increment: 1 }
        }
      });

      // Client should not be blocked in NORMAL mode
      expect(capturedTx.client.update).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when order is not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        orderRepository.dismantle('non-existent-order', 'BLOCK', 'Test')
      ).rejects.toThrow('Order not found');

      // Transaction should not be called if order doesn't exist
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle transaction errors properly', async () => {
      const transactionError = new Error('Database transaction failed');
      prisma.$transaction.mockRejectedValue(transactionError);

      await expect(
        orderRepository.dismantle('order-123', 'BLOCK', 'Test')
      ).rejects.toThrow('Database transaction failed');
    });
  });

  describe('Mode Comparison', () => {
    it('should treat BLOCK and NORMAL modes differently', async () => {
      // Test BLOCK mode
      let blockTx: any;
      prisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          order: { update: vi.fn().mockResolvedValue({ ...mockOrder, status: 'DESMANTELADO' }) },
          client: { update: vi.fn().mockResolvedValue({ id: mockOrder.clientId, isBlocked: true }) },
        };
        blockTx = tx;
        return await callback(tx);
      });

      await orderRepository.dismantle('order-123', 'BLOCK', 'Test block');
      const blockClientUpdateCalls = blockTx.client.update.mock.calls.length;

      // Test NORMAL mode
      vi.clearAllMocks();
      prisma.order.findUnique.mockResolvedValue(mockOrder);
      
      let normalTx: any;
      prisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          order: { update: vi.fn().mockResolvedValue({ ...mockOrder, status: 'DESMANTELADO' }) },
          client: { update: vi.fn() },
        };
        normalTx = tx;
        return await callback(tx);
      });

      await orderRepository.dismantle('order-123', 'NORMAL', 'Test normal');
      const normalClientUpdateCalls = normalTx.client.update.mock.calls.length;

      // Assert BLOCK called client.update but NORMAL did not
      expect(blockClientUpdateCalls).toBe(1);
      expect(normalClientUpdateCalls).toBe(0);
    });
  });
});
