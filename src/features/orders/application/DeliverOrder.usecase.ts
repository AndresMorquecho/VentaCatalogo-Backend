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

        // Crear registro financiero
        const isCredit = data.paymentMethod === 'CREDITO_CLIENTE';
        const referenceNumber = !isCredit && data.paymentMethod !== 'EFECTIVO' && data.reference
          ? data.reference
          : `REF-${Date.now()}`;

        let finalBankAccountId = bankAccountId;
        if (!finalBankAccountId || finalBankAccountId === 'default') {
          const cashAcc = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
          if (cashAcc) finalBankAccountId = cashAcc.id;
        }

        await tx.financialRecord.create({
          data: {
            type: 'PAYMENT',
            referenceNumber,
            amount: data.finalPayment,
            date: new Date(),
            clientId: order.clientId,
            clientName: order.clientName,
            orderId: order.id,
            bankAccountId: finalBankAccountId!,
            source: 'ORDER_PAYMENT',
            paymentMethod: data.paymentMethod,
            movementType: 'INCOME',
            createdBy: userId,
            notes: data.notes || `Pago final en entrega${isCredit ? ' (Crédito)' : ''} - Pedido ${order.receiptNumber}`
          }
        });

        if (isCredit) {
          // REDUCE CLIENT CREDITS
          const availableCredits = await tx.clientCredit.findMany({
            where: {
              clientAccount: { clientId: order.clientId },
              status: 'AVAILABLE'
            },
            orderBy: { createdAt: 'asc' }
          });

          let remainingToSubtract = data.finalPayment;
          for (const credit of availableCredits) {
            if (remainingToSubtract <= 0) break;
            const amountToSubtract = Math.min(Number(credit.remainingAmount), remainingToSubtract);

            await tx.clientCredit.update({
              where: { id: credit.id },
              data: {
                remainingAmount: { decrement: amountToSubtract },
                status: Number(credit.remainingAmount) - amountToSubtract <= 0.01 ? 'USED' : 'AVAILABLE'
              }
            });
            remainingToSubtract -= amountToSubtract;
          }
          if (remainingToSubtract > 0.01) {
            throw new Error(`Saldo a favor insuficiente. Faltan $${remainingToSubtract.toFixed(2)}`);
          }
        } else if (bankAccountId) {
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

      // SISTEMA DE LEALTAD
      // 1. Obtener reglas activas
      const activeRules = await tx.loyaltyRule.findMany({
        where: { isActive: true }
      });

      // 2. Calcular puntos ganados basados en reglas
      let pointsEarned = 0;
      const newPaidAmount = paidAmount + (data.finalPayment || 0);
      const isFullPayment = newPaidAmount >= effectiveTotal - 0.01;

      if (activeRules.length > 0) {
        for (const rule of activeRules) {
          if (rule.type === 'POR_MONTO') {
            // Ejemplo: 1 punto por cada $10 (condition="10")
            const divisor = parseFloat(rule.condition || '10');
            const safeDivisor = isNaN(divisor) || divisor <= 0 ? 10 : divisor;
            pointsEarned += Math.floor(effectiveTotal / safeDivisor) * rule.pointsValue;
          } else if (rule.type === 'POR_PEDIDO') {
            // Ejemplo: 5 puntos fijos por pedido
            pointsEarned += rule.pointsValue;
          } else if (rule.type === 'BONUS_PAGO_COMPLETO' && isFullPayment) {
            // Ejemplo: 10 puntos extra por pagar todo
            pointsEarned += rule.pointsValue;
          }
        }
      } else {
        // Fallback a lógica básica si no hay reglas configuradas
        pointsEarned += Math.floor(effectiveTotal / 10);
        pointsEarned += 5;
        if (isFullPayment) pointsEarned += 10;
      }

      // Obtener o crear cuenta del cliente
      let clientAccount = order.client.clientAccount;
      if (!clientAccount) {
        clientAccount = await tx.clientAccount.create({
          data: {
            clientId: order.clientId,
            totalRewardPoints: 0,
            totalOrders: 0,
            totalSpent: 0,
            rewardLevel: 'BRONCE'
          }
        });
      }

      // Actualizar saldos de cuenta
      const updatedPoints = clientAccount.totalRewardPoints + pointsEarned;
      const updatedOrders = clientAccount.totalOrders + 1;
      const updatedSpent = Number(clientAccount.totalSpent) + effectiveTotal;

      // Calcular nuevo nivel
      let newLevel = 'BRONCE';
      if (updatedPoints >= 600) newLevel = 'PLATINO';
      else if (updatedPoints >= 300) newLevel = 'ORO';
      else if (updatedPoints >= 100) newLevel = 'PLATA';

      await tx.clientAccount.update({
        where: { id: clientAccount.id },
        data: {
          totalRewardPoints: updatedPoints,
          totalOrders: updatedOrders,
          totalSpent: updatedSpent,
          rewardLevel: newLevel,
          version: { increment: 1 }
        }
      });

      // Registrar aplicación de puntos
      await tx.rewardApplication.create({
        data: {
          clientAccountId: clientAccount.id,
          orderId: order.id,
          pointsEarned: pointsEarned
        }
      });

      // 7. Calcular nuevo saldo pendiente
      const newPendingAmount = effectiveTotal - newPaidAmount;

      // Retornar pedido actualizado con cálculos
      return {
        ...updatedOrder,
        paidAmount: newPaidAmount,
        pendingAmount: newPendingAmount,
        loyalty: {
          pointsEarned,
          currentTotalPoints: updatedPoints,
          newLevel
        }
      };
    });
  }
}
