import { prisma } from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

export interface ProcessExchangeFinancialDTO {
  exchangeId: string;
  itemId: string;
  creditDestination?: 'WALLET' | 'CASH_RETURN' | 'DISTRIBUTE';
  createdBy: string;
  bankAccountId?: string;
}

export class ProcessExchangeFinancialUseCase {
  async execute(dto: ProcessExchangeFinancialDTO) {
    const { exchangeId, itemId, creditDestination, createdBy, bankAccountId } = dto;

    // Pre-transaction validations
    const exchange = await prisma.orderExchange.findUnique({
      where: { id: exchangeId },
      include: { 
        items: true,
        client: { select: { identificationNumber: true } }
      },
    });
    if (!exchange) {
      throw new Error('Cambio no encontrado');
    }
    if (exchange.status !== 'RECEIVED_FROM_SUPPLIER') {
      throw new Error('El procesamiento financiero solo está disponible cuando el cambio ha sido recibido del proveedor');
    }

    const item = exchange.items.find((i) => i.id === itemId);
    if (!item) {
      throw new Error('Ítem no encontrado');
    }
    if (item.financialProcessed) {
      throw new Error('El procesamiento financiero de este ítem ya fue ejecutado');
    }

    const diff = item.differenceValue ? Number(item.differenceValue) : 0;

    if (diff < 0 && creditDestination === 'CASH_RETURN' && !bankAccountId) {
      throw new Error('Se requiere una cuenta bancaria para registrar la devolución en efectivo');
    }

    return await prisma.$transaction(async (tx) => {
      const baseNotes = `Cambio ${exchange.exchangeNumber} | Pedido ${item.originalOrderId}`;
      let financialRecordId: string | null = null;
      let action: string;

      if (diff === 0) {
        // CASO A: mismo valor — solo trazabilidad
        const fr = await (tx as any).financialRecord.create({
          data: {
            type: 'EXCHANGE_SAME_VALUE',
            referenceNumber: `EX-SV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            amount: new Prisma.Decimal(0),
            date: new Date(),
            clientId: exchange.clientId,
            clientName: exchange.clientName,
            clientDocument: (exchange as any).client?.identificationNumber ?? null,
            orderId: item.originalOrderId,
            createdBy,
            notes: `${baseNotes} | Mismo valor`,
            bankAccountId: await getDefaultBankAccountId(tx),
            source: 'EXCHANGE',
            movementType: 'INTERNAL',
          },
        });
        financialRecordId = fr.id;
        action = 'SAME_VALUE';

      } else if (diff > 0) {
        // CASO B: cliente debe pagar más — nueva deuda
        const payment = await tx.orderPayment.create({
          data: {
            orderId: item.originalOrderId,
            amount: new Prisma.Decimal(diff),
            method: 'EXCHANGE_CHARGE',
            description: `Saldo adicional por cambio ${exchange.exchangeNumber}`,
          },
        });

        const fr = await (tx as any).financialRecord.create({
          data: {
            type: 'EXCHANGE_ADDITIONAL_CHARGE',
            referenceNumber: `EX-AC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            amount: new Prisma.Decimal(diff),
            date: new Date(),
            clientId: exchange.clientId,
            clientName: exchange.clientName,
            clientDocument: (exchange as any).client?.identificationNumber ?? null,
            orderId: item.originalOrderId,
            orderPaymentId: payment.id,
            createdBy,
            notes: `${baseNotes} | Saldo adicional por cambio`,
            bankAccountId: await getDefaultBankAccountId(tx),
            source: 'EXCHANGE',
            movementType: 'INCOME',
          },
        });
        financialRecordId = fr.id;
        action = 'DEBT_CREATED';

      } else {
        // CASO C: cliente pagó de más — diff < 0
        const absAmount = Math.abs(diff);

        if (creditDestination === 'WALLET') {
          // Obtener o crear ClientAccount
          let clientAccount = await tx.clientAccount.findUnique({
            where: { clientId: exchange.clientId },
          });
          if (!clientAccount) {
            clientAccount = await tx.clientAccount.create({
              data: {
                clientId: exchange.clientId,
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
              originTransactionId: item.id,
              originOrderId: item.originalOrderId,
              status: 'AVAILABLE',
            },
          });

          await tx.clientAccount.update({
            where: { id: clientAccount.id },
            data: { totalCreditAvailable: { increment: absAmount } },
          });

          const fr = await (tx as any).financialRecord.create({
            data: {
              type: 'EXCHANGE_CREDIT',
              referenceNumber: `EX-CR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              amount: new Prisma.Decimal(absAmount),
              date: new Date(),
              clientId: exchange.clientId,
              clientName: exchange.clientName,
              clientDocument: (exchange as any).client?.identificationNumber ?? null,
              orderId: item.originalOrderId,
              createdBy,
              notes: `${baseNotes} | Crédito a billetera`,
              bankAccountId: await getDefaultBankAccountId(tx),
              source: 'EXCHANGE',
              movementType: 'INTERNAL',
            },
          });
          financialRecordId = fr.id;
          action = 'CREDIT_CREATED';

        } else if (creditDestination === 'CASH_RETURN') {
          const fr = await (tx as any).financialRecord.create({
            data: {
              type: 'CASH_RETURN',
              referenceNumber: `EX-RT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              amount: new Prisma.Decimal(absAmount),
              date: new Date(),
              clientId: exchange.clientId,
              clientName: exchange.clientName,
              clientDocument: (exchange as any).client?.identificationNumber ?? null,
              orderId: item.originalOrderId,
              createdBy,
              notes: `${baseNotes} | Devolución en efectivo`,
              bankAccountId: bankAccountId!,
              source: 'EXCHANGE',
              movementType: 'EXPENSE',
            },
          });
          financialRecordId = fr.id;
          action = 'CASH_RETURNED';

        } else {
          // DISTRIBUTE
          const fr = await (tx as any).financialRecord.create({
            data: {
              type: 'EXCHANGE_CREDIT',
              referenceNumber: `EX-DT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              amount: new Prisma.Decimal(absAmount),
              date: new Date(),
              clientId: exchange.clientId,
              clientName: exchange.clientName,
              clientDocument: (exchange as any).client?.identificationNumber ?? null,
              orderId: item.originalOrderId,
              createdBy,
              notes: `${baseNotes} | Crédito para distribuir`,
              bankAccountId: await getDefaultBankAccountId(tx),
              source: 'EXCHANGE',
              movementType: 'INTERNAL',
            },
          });
          financialRecordId = fr.id;
          action = 'DISTRIBUTE';
        }
      }

      // Marcar ítem como procesado
      await tx.orderExchangeItem.update({
        where: { id: itemId },
        data: { financialProcessed: true, status: 'PROCESSED' },
      });

      return {
        itemId,
        differenceValue: item.differenceValue,
        action,
        movementType: diff === 0 ? 'INTERNAL' : diff > 0 ? 'INCOME' : creditDestination === 'CASH_RETURN' ? 'EXPENSE' : 'INTERNAL',
        financialRecordId,
      };
    });
  }
}

async function getDefaultBankAccountId(tx: any): Promise<string> {
  const account = await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
  if (!account) throw new Error('No se encontró una cuenta de caja activa');
  return account.id;
}
