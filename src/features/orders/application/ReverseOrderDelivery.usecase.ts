import { prisma } from '../../../lib/prisma';
import { buildNotesJSON } from '../../../shared/utils/transactionNotes';

export class ReverseOrderDeliveryUseCase {
  async execute(orderId: string, userId: string) {
    console.log(`[ReverseOrderDeliveryUseCase] Executing for orderId: ${orderId} by user: ${userId}`);
    
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

      if (order.status !== 'ENTREGADO') {
        throw new Error('El pedido debe estar en estado ENTREGADO para reversar la entrega');
      }

      // 2. Identificar pagos realizados durante la entrega
      // Buscamos pagos con descripción que contenga "entrega" o "lote"
      const deliveryPayments = order.payments.filter(p => 
        p.description?.toLowerCase().includes('entrega') || 
        (order.deliveryDate && Math.abs(new Date(p.createdAt).getTime() - new Date(order.deliveryDate).getTime()) < 1000 * 60 * 60 * 2) // Dentro de 2 horas
      );

      console.log(`[ReverseDelivery] Found ${deliveryPayments.length} delivery payments to reverse`);

      // 3. Reversar cada pago
      for (const payment of deliveryPayments) {
        const amount = Number(payment.amount);
        const isCredit = payment.method === 'CREDITO_CLIENTE' || payment.method === 'BILLETERA_VIRTUAL';

        // --- Determinar cuenta bancaria para la reversat ---
        let targetBankAccountId = order.bankAccountId;
        
        // Intentar encontrar el FinancialRecord del pago original
        const originalFinRecord = await tx.financialRecord.findFirst({
          where: { 
            orderPaymentId: payment.id,
            type: 'PAYMENT'
          }
        });
        
        if (originalFinRecord) {
          targetBankAccountId = originalFinRecord.bankAccountId;
        }

        // Fallback: cuenta de CAJA
        if (!targetBankAccountId) {
          const cashAccount = await tx.bankAccount.findFirst({ where: { type: 'CASH' } });
          targetBankAccountId = cashAccount?.id || (await tx.bankAccount.findFirst())?.id || '';
        }

        if (!targetBankAccountId) {
           throw new Error('No se encontró una cuenta bancaria o de caja para procesar la reversión financiera');
        }

        // --- Procesamiento de saldos ---
        if (isCredit) {
          const clientAccount = await tx.clientAccount.findUnique({
            where: { clientId: order.clientId },
            select: { id: true, version: true }
          });

          if (clientAccount) {
            await tx.clientAccount.updateMany({
              where: { id: clientAccount.id, version: clientAccount.version },
              data: {
                totalCreditAvailable: { increment: amount },
                version: { increment: 1 }
              }
            });

            await tx.clientCredit.create({
              data: {
                clientAccountId: clientAccount.id,
                amount: amount,
                remainingAmount: amount,
                status: 'AVAILABLE',
                originTransactionId: `REV-DEL-${order.id}-${payment.id.slice(-6)}`,
                originOrderId: order.id
              }
            });
          }
        } else {
          // Reversar en Cuenta Bancaria o Caja física
          const bankAccount = await tx.bankAccount.findUnique({
            where: { id: targetBankAccountId },
            select: { id: true, currentBalance: true, version: true }
          });

          if (bankAccount) {
            await tx.bankAccount.updateMany({
              where: { id: targetBankAccountId, version: bankAccount.version },
              data: {
                currentBalance: { decrement: amount },
                updatedAt: new Date(),
                version: { increment: 1 }
              }
            });
          }
        }

        // Crear registro financiero de la REVERSA (SALIDA/EGRESO para el sistema)
        const notesJson = buildNotesJSON({
          title: 'DEVOLUCION',
          module: 'DELIVERY',
          clientDoc: order.client.identificationNumber || 'S/N',
          orders: [{ receiptNumber: order.receiptNumber, orderNumber: order.orderNumber, brandName: (order as any).brand?.name ?? null }],
          extra: `Reversión automática: Cancelación de entrega y devolución de saldo ($${amount.toFixed(2)})`
        });

        await tx.financialRecord.create({
          data: {
            type: 'EXPENSE',
            referenceNumber: `REV-DEL-${Date.now()}-${payment.id.slice(-4)}`,
            amount: amount,
            date: new Date(),
            clientId: order.clientId,
            clientName: order.clientName,
            orderId: order.id,
            bankAccountId: targetBankAccountId,
            source: 'REVERSE_DELIVERY',
            paymentMethod: payment.method,
            movementType: isCredit ? 'INTERNAL' : 'EXPENSE',
            fromAccountType: isCredit ? 'ORDER' : 'CASH',
            toAccountType: isCredit ? 'WALLET' : 'EXTERNAL',
            createdBy: userId,
            notes: notesJson,
            version: 1
          }
        });

        // Eliminar el pago del pedido
        await tx.orderPayment.delete({
          where: { id: payment.id }
        });
      }

      // 4. Actualizar estado del pedido regresándolo a RECIBIDO_EN_BODEGA
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'RECIBIDO_EN_BODEGA',
          deliveryDate: null,
          deliveredByName: null,
          updatedAt: new Date(),
          version: { increment: 1 }
        }
      });

      // 5. Eliminar movimientos de inventario de entrega (DELIVERED)
      await tx.inventoryMovement.deleteMany({
        where: {
          orderId: orderId,
          type: 'DELIVERED'
        }
      });

      return { success: true };
    });
  }
}
