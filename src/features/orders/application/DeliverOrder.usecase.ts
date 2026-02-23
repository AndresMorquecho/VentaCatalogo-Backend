import { IOrderRepository } from '../domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { prisma } from '../../../lib/prisma';

export interface DeliverOrderDTO {
  finalPayment?: number;
  bankAccountId?: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
}

export class DeliverOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository
  ) { }

  async execute(orderId: string, data: DeliverOrderDTO, userId: string) {
    // Ejecutar todo en una transacción
    return await prisma.$transaction(async (tx) => {
      // 1. Obtener pedido con relaciones
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          client: {
            include: {
              clientAccount: true
            }
          },
          payments: true,
          brand: true,
          bankAccount: true
        }
      });

      if (!order) {
        throw new Error('Pedido no encontrado');
      }

      if (order.status !== 'RECIBIDO_EN_BODEGA') {
        throw new Error('El pedido debe estar recibido en bodega para poder entregarlo');
      }

      // 2. Calcular saldo pendiente
      const effectiveTotal = order.realInvoiceTotal ? Number(order.realInvoiceTotal) : Number(order.total);
      const paidAmount = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const pendingAmount = effectiveTotal - paidAmount;

      // 3. Si hay pago final, validar y registrar
      if (data.finalPayment && data.finalPayment > 0) {
        if (!data.paymentMethod) {
          throw new Error('Debe seleccionar un método de pago');
        }

        // Validar cuenta bancaria solo si NO es efectivo
        if (data.paymentMethod !== 'EFECTIVO' && !data.bankAccountId) {
          throw new Error('Debe seleccionar una cuenta bancaria para pagos con transferencia, depósito o cheque');
        }

        // Validar que el pago no exceda el saldo pendiente
        if (data.finalPayment > pendingAmount + 0.01) {
          throw new Error(`El pago final (${data.finalPayment}) no puede ser mayor al saldo pendiente (${pendingAmount.toFixed(2)})`);
        }

        // Buscar cuenta bancaria (para efectivo, buscar cuenta de tipo CASH)
        let bankAccountId = data.bankAccountId;
        if (data.paymentMethod === 'EFECTIVO' && !bankAccountId) {
          const cashAccount = await tx.bankAccount.findFirst({
            where: { type: 'CASH' }
          });
          if (cashAccount) {
            bankAccountId = cashAccount.id;
          }
        }

        // Validar referencia duplicada para métodos que no son efectivo
        if (data.paymentMethod !== 'EFECTIVO' && data.reference) {
          const whereClause: any = {
            paymentMethod: data.paymentMethod,
            referenceNumber: data.reference
          };
          if (data.paymentMethod === 'CHEQUE' && bankAccountId) {
            whereClause.bankAccountId = bankAccountId;
          }
          const existingPayment = await tx.financialRecord.findFirst({
            where: whereClause
          });

          if (existingPayment) {
            throw new Error(`La referencia ${data.reference} ya fue utilizada en otro pago con método ${data.paymentMethod}`);
          }
        }

        // Crear pago final
        await tx.orderPayment.create({
          data: {
            orderId: order.id,
            amount: data.finalPayment,
            method: data.paymentMethod,
            reference: data.reference || null,
            description: 'Pago final en entrega'
          }
        });

        // Crear registro financiero (solo si hay cuenta bancaria)
        if (bankAccountId) {
          const referenceNumber = data.paymentMethod !== 'EFECTIVO' && data.reference
            ? data.reference
            : await this.financialRepository.generateReferenceNumber();
          await tx.financialRecord.create({
            data: {
              type: 'PAYMENT',
              referenceNumber,
              amount: data.finalPayment,
              date: new Date(),
              clientId: order.clientId,
              clientName: order.clientName,
              orderId: order.id,
              bankAccountId: bankAccountId,
              source: 'ORDER_PAYMENT',
              paymentMethod: data.paymentMethod,
              movementType: 'INCOME',
              createdBy: userId,
              notes: data.notes || `Pago final en entrega - Pedido ${order.receiptNumber}`
            }
          });

          // Actualizar saldo de cuenta bancaria
          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: {
              currentBalance: { increment: data.finalPayment },
              updatedAt: new Date(),
              version: { increment: 1 }
            }
          });
        }
      }

      // 4. Actualizar pedido a ENTREGADO
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'ENTREGADO',
          deliveryDate: new Date(),
          updatedAt: new Date(),
          version: { increment: 1 }
        },
        include: {
          client: true,
          brand: true,
          bankAccount: true,
          items: true,
          payments: true
        }
      });

      // 5. Crear movimiento de inventario (DELIVERED)
      await tx.inventoryMovement.create({
        data: {
          orderId: order.id,
          clientId: order.clientId,
          brandId: order.brandId,
          type: 'DELIVERED',
          createdBy: userId,
          notes: data.notes || `Entrega de pedido ${order.receiptNumber}`
        }
      });

      // 6. Calcular nuevo saldo pendiente
      const newPaidAmount = paidAmount + (data.finalPayment || 0);
      const newPendingAmount = effectiveTotal - newPaidAmount;

      // Retornar pedido actualizado con cálculos
      return {
        ...updatedOrder,
        paidAmount: newPaidAmount,
        pendingAmount: newPendingAmount
      };
    });
  }
}
