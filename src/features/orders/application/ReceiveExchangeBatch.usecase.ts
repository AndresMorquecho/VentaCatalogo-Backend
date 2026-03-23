import { prisma } from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

export interface ReceiveExchangeBatchItemDTO {
  batchItemId: string;
  orderId: string;
  newInvoiceValue: number;
  creditDestination?: 'WALLET' | 'CASH_RETURN' | 'DISTRIBUTE';
  bankAccountId?: string;
}

export interface ReceiveExchangeBatchDTO {
  batchId: string;
  items: ReceiveExchangeBatchItemDTO[];
  receivedBy: string;
}

export class ReceiveExchangeBatchUseCase {
  async execute(dto: ReceiveExchangeBatchDTO) {
    const { batchId, items, receivedBy } = dto;

    const batch = await prisma.exchangeBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    if (!batch) throw new Error('Lote no encontrado');
    if (batch.status !== 'SENT') throw new Error('Solo se pueden receptar lotes en estado Enviado');

    // Validate all batchItemIds belong to this batch
    const batchItemIds = new Set(batch.items.map((i) => i.id));
    for (const item of items) {
      if (!batchItemIds.has(item.batchItemId)) {
        throw new Error(`El ítem ${item.batchItemId} no pertenece a este lote`);
      }
    }

    // Validate CASH_RETURN items have bankAccountId
    for (const item of items) {
      const diff = item.newInvoiceValue - Number(batch.items.find((i) => i.id === item.batchItemId)!.orderTotal);
      if (diff < 0 && item.creditDestination === 'CASH_RETURN' && !item.bankAccountId) {
        throw new Error('Se requiere una cuenta bancaria para registrar la devolución en efectivo');
      }
    }

    return await prisma.$transaction(async (tx) => {
      const results: Array<{
        batchItemId: string;
        differenceValue: number;
        action: string;
        movementType: string;
      }> = [];

      for (const itemDTO of items) {
        const batchItem = batch.items.find((i) => i.id === itemDTO.batchItemId)!;

        if (batchItem.financialProcessed) {
          throw new Error('El procesamiento financiero de este pedido ya fue ejecutado');
        }

        const originalTotal = Number(batchItem.orderTotal);
        const diff = itemDTO.newInvoiceValue - originalTotal;
        const absAmount = Math.abs(diff);
        const baseNotes = `Lote ${batch.batchNumber} | Pedido ${itemDTO.orderId}`;
        let action: string;
        let movementType: string;

        if (diff === 0) {
          await tx.financialRecord.create({
            data: {
              type: 'EXCHANGE_SAME_VALUE',
              referenceNumber: `LT-SV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              amount: new Prisma.Decimal(0),
              date: new Date(),
              clientId: batchItem.clientId,
              clientName: batchItem.clientName,
              orderId: itemDTO.orderId,
              createdBy: receivedBy,
              notes: `${baseNotes} | Mismo valor`,
              bankAccountId: await getDefaultBankAccountId(tx),
              source: 'EXCHANGE',
              movementType: 'INTERNAL',
            },
          });
          action = 'SAME_VALUE';
          movementType = 'INTERNAL';

        } else if (diff > 0) {
          const payment = await tx.orderPayment.create({
            data: {
              orderId: itemDTO.orderId,
              amount: new Prisma.Decimal(diff),
              method: 'EXCHANGE_CHARGE',
              description: `Saldo adicional por cambio - Lote ${batch.batchNumber}`,
            },
          });

          await tx.financialRecord.create({
            data: {
              type: 'EXCHANGE_ADDITIONAL_CHARGE',
              referenceNumber: `LT-AC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              amount: new Prisma.Decimal(diff),
              date: new Date(),
              clientId: batchItem.clientId,
              clientName: batchItem.clientName,
              orderId: itemDTO.orderId,
              orderPaymentId: payment.id,
              createdBy: receivedBy,
              notes: `${baseNotes} | Saldo adicional por cambio`,
              bankAccountId: await getDefaultBankAccountId(tx),
              source: 'EXCHANGE',
              movementType: 'INCOME',
            },
          });
          action = 'DEBT_CREATED';
          movementType = 'INCOME';

        } else {
          // diff < 0
          if (itemDTO.creditDestination === 'WALLET') {
            let clientAccount = await tx.clientAccount.findUnique({
              where: { clientId: batchItem.clientId },
            });
            if (!clientAccount) {
              clientAccount = await tx.clientAccount.create({
                data: {
                  clientId: batchItem.clientId,
                  totalRewardPoints: 0,
                  totalOrders: 0,
                  totalSpent: 0,
                  rewardLevel: 'BRONCE',
                },
              });
            }

            await tx.clientCredit.create({
              data: {
                clientAccountId: clientAccount.id,
                amount: new Prisma.Decimal(absAmount),
                remainingAmount: new Prisma.Decimal(absAmount),
                originTransactionId: itemDTO.batchItemId,
                originOrderId: itemDTO.orderId,
                status: 'AVAILABLE',
              },
            });

            await tx.clientAccount.update({
              where: { id: clientAccount.id },
              data: { totalCreditAvailable: { increment: absAmount } },
            });

            await tx.financialRecord.create({
              data: {
                type: 'EXCHANGE_CREDIT',
                referenceNumber: `LT-CR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                amount: new Prisma.Decimal(absAmount),
                date: new Date(),
                clientId: batchItem.clientId,
                clientName: batchItem.clientName,
                orderId: itemDTO.orderId,
                createdBy: receivedBy,
                notes: `${baseNotes} | Crédito a billetera`,
                bankAccountId: await getDefaultBankAccountId(tx),
                source: 'EXCHANGE',
                movementType: 'INTERNAL',
              },
            });
            action = 'CREDIT_CREATED';
            movementType = 'INTERNAL';

          } else if (itemDTO.creditDestination === 'CASH_RETURN') {
            await tx.financialRecord.create({
              data: {
                type: 'CASH_RETURN',
                referenceNumber: `LT-RT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                amount: new Prisma.Decimal(absAmount),
                date: new Date(),
                clientId: batchItem.clientId,
                clientName: batchItem.clientName,
                orderId: itemDTO.orderId,
                createdBy: receivedBy,
                notes: `${baseNotes} | Devolución en efectivo`,
                bankAccountId: itemDTO.bankAccountId!,
                source: 'EXCHANGE',
                movementType: 'EXPENSE',
              },
            });
            action = 'CASH_RETURNED';
            movementType = 'EXPENSE';

          } else {
            // DISTRIBUTE
            await tx.financialRecord.create({
              data: {
                type: 'EXCHANGE_CREDIT',
                referenceNumber: `LT-DT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                amount: new Prisma.Decimal(absAmount),
                date: new Date(),
                clientId: batchItem.clientId,
                clientName: batchItem.clientName,
                orderId: itemDTO.orderId,
                createdBy: receivedBy,
                notes: `${baseNotes} | Crédito para distribuir`,
                bankAccountId: await getDefaultBankAccountId(tx),
                source: 'EXCHANGE',
                movementType: 'INTERNAL',
              },
            });
            action = 'DISTRIBUTE';
            movementType = 'INTERNAL';
          }
        }

        // Mark batch item as financially processed
        await tx.exchangeBatchItem.update({
          where: { id: itemDTO.batchItemId },
          data: { financialProcessed: true },
        });

        results.push({ batchItemId: itemDTO.batchItemId, differenceValue: diff, action, movementType });
      }

      // Mark batch as RECEIVED
      const updatedBatch = await tx.exchangeBatch.update({
        where: { id: batchId },
        data: { status: 'RECEIVED', receivedAt: new Date() },
        include: { items: true },
      });

      return { batchId, status: 'RECEIVED', items: results, batch: updatedBatch };
    });
  }
}

async function getDefaultBankAccountId(tx: any): Promise<string> {
  const account = await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
  if (!account) throw new Error('No se encontró una cuenta de caja activa');
  return account.id;
}
