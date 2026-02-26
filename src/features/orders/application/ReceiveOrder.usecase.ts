import { IOrderRepository } from '../domain/IOrderRepository';
import { IFinancialRecordRepository } from '../../financial/domain/IFinancialRecordRepository';
import { prisma } from '../../../lib/prisma';

export interface ReceiveOrderDTO {
  finalTotal: number;
  invoiceNumber?: string;
  abonoRecepcion?: number;
  bankAccountId?: string;
  paymentMethod?: string;
  reference?: string;
  receivedByName?: string; // Username del que recibe en bodega
}

export class ReceiveOrderUseCase {
  constructor(
    private orderRepository: IOrderRepository,
    private financialRepository: IFinancialRecordRepository
  ) { }

  async execute(orderId: string, data: ReceiveOrderDTO, userId: string) {
    // Validaciones iniciales
    if (!data.finalTotal || data.finalTotal <= 0) {
      throw new Error('El valor real de factura debe ser mayor a 0');
    }

    if (data.abonoRecepcion && data.abonoRecepcion > 0) {
      if (!data.paymentMethod) {
        throw new Error('Debe seleccionar un método de pago para el abono');
      }

      // Validar cuenta bancaria solo si NO es efectivo
      if (data.paymentMethod !== 'EFECTIVO' && !data.bankAccountId) {
        throw new Error('Debe seleccionar una cuenta bancaria para pagos con transferencia, depósito o cheque');
      }
    }

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
          brand: true
        }
      });

      if (!order) {
        throw new Error('Pedido no encontrado');
      }

      if (order.status !== 'POR_RECIBIR') {
        throw new Error('El pedido ya fue recibido anteriormente');
      }

      // 2. Actualizar pedido con datos de recepción
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'RECIBIDO_EN_BODEGA',
          realInvoiceTotal: data.finalTotal,
          invoiceNumber: data.invoiceNumber || null,
          receptionDate: new Date(),
          receivedByName: data.receivedByName || null,
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

      // 3. Crear movimiento de inventario (ENTRY)
      await tx.inventoryMovement.create({
        data: {
          orderId: order.id,
          clientId: order.clientId,
          brandId: order.brandId,
          type: 'ENTRY',
          createdBy: userId,
          notes: `Recepción de pedido ${order.receiptNumber} - Factura: ${data.invoiceNumber || 'N/A'}`
        }
      });

      // 4. Calcular saldo actual
      const paidAmount = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      let newPaidAmount = paidAmount;

      // 5. Si hay abono adicional en recepción
      if (data.abonoRecepcion && data.abonoRecepcion > 0) {
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

        // Crear pago en el pedido
        await tx.orderPayment.create({
          data: {
            orderId: order.id,
            amount: data.abonoRecepcion,
            method: data.paymentMethod!,
            reference: data.reference || null,
            description: 'Abono en recepción de bodega'
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
              amount: data.abonoRecepcion,
              date: new Date(),
              clientId: order.clientId,
              clientName: order.clientName,
              orderId: order.id,
              bankAccountId: bankAccountId,
              source: 'ORDER_PAYMENT',
              paymentMethod: data.paymentMethod!,
              movementType: 'INCOME',
              createdBy: userId,
              notes: `Abono en recepción - Pedido ${order.receiptNumber}`
            }
          });

          // Actualizar saldo de cuenta bancaria
          await tx.bankAccount.update({
            where: { id: bankAccountId },
            data: {
              currentBalance: { increment: data.abonoRecepcion },
              updatedAt: new Date(),
              version: { increment: 1 }
            }
          });
        }

        newPaidAmount += data.abonoRecepcion;
      }

      // 6. Calcular saldo pendiente con el total real
      const pendingAmount = data.finalTotal - newPaidAmount;

      // 7. Si hay crédito a favor del cliente (pendingAmount < 0)
      if (pendingAmount < -0.01) {
        const creditAmount = Math.abs(pendingAmount);

        // Verificar si el cliente tiene ClientAccount, si no, crearlo
        let clientAccount = order.client.clientAccount;
        if (!clientAccount) {
          clientAccount = await tx.clientAccount.create({
            data: {
              clientId: order.clientId,
              totalCreditAvailable: 0,
              totalRewardPoints: 0,
              totalOrders: 0,
              totalSpent: 0,
              rewardLevel: 'BRONCE'
            }
          });
        }

        // Crear crédito del cliente
        await tx.clientCredit.create({
          data: {
            clientAccountId: clientAccount.id,
            amount: creditAmount,
            remainingAmount: creditAmount,
            originTransactionId: `RECEPTION-${order.id}-${Date.now()}`,
            originOrderId: order.id,
            status: 'AVAILABLE'
          }
        });

        // Actualizar cuenta del cliente
        await tx.clientAccount.update({
          where: { id: clientAccount.id },
          data: {
            totalCreditAvailable: { increment: creditAmount },
            updatedAt: new Date(),
            version: { increment: 1 }
          }
        });
      }

      // Retornar pedido actualizado con cálculos
      return {
        ...updatedOrder,
        paidAmount: newPaidAmount,
        pendingAmount: data.finalTotal - newPaidAmount
      };
    });
  }
}
