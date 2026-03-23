import { Order } from '../domain/Order.entity';
import { Result } from '../../../shared/domain/Result';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface EligibleOrderFilters {
  clientId?: string;
  brandId?: string;
}

export class GetEligibleOrdersUseCase {
  async execute(filters?: EligibleOrderFilters): Promise<Result<Order[]>> {
    try {
      // Build where clause
      const where: Prisma.OrderWhereInput = {
        status: 'ENTREGADO',
        parentOrderId: null, // Exclude shadow orders
        exchangeBatchItems: {
          none: {
            batch: {
              status: {
                in: ['ENVIADO', 'EN_BODEGA']
              }
            }
          }
        }
      };

      // Apply optional filters
      if (filters?.clientId) {
        where.clientId = filters.clientId;
      }
      if (filters?.brandId) {
        where.brandId = filters.brandId;
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          items: true,
          payments: {
            include: {
              financialRecords: {
                select: {
                  id: true,
                  paymentMethod: true,
                  amount: true,
                  bankAccountId: true,
                  notes: true,
                  createdBy: true,
                  referenceNumber: true,
                  bankAccount: { select: { name: true } }
                }
              }
            }
          },
          brand: true
        },
        orderBy: { createdAt: 'desc' }
      });

      // Convert to domain entities
      const domainOrders = orders.map(order => this.toDomain(order));

      return Result.ok(domainOrders);
    } catch (error) {
      return Result.fail(
        error instanceof Error ? error.message : 'Failed to get eligible orders'
      );
    }
  }

  private toDomain(raw: any): Order {
    return Order.create(
      {
        receiptNumber: raw.receiptNumber,
        salesChannel: raw.salesChannel,
        type: raw.type,
        brandId: raw.brandId,
        brandName: raw.brand?.name || 'Sin marca',
        total: raw.total ? Number(raw.total) : 0,
        realInvoiceTotal: raw.realInvoiceTotal !== null ? Number(raw.realInvoiceTotal) : undefined,
        paymentMethod: raw.paymentMethod,
        bankAccountId: raw.bankAccountId,
        transactionDate: raw.transactionDate,
        possibleDeliveryDate: raw.possibleDeliveryDate,
        receptionDate: raw.receptionDate,
        deliveryDate: raw.deliveryDate,
        invoiceNumber: raw.invoiceNumber,
        status: raw.status,
        clientId: raw.clientId,
        clientName: raw.clientName,
        notes: raw.notes,
        createdByName: raw.createdByName || undefined,
        receivedByName: raw.receivedByName || undefined,
        deliveredByName: raw.deliveredByName || undefined,
        parentOrderId: raw.parentOrderId || undefined,
        orderNumber: raw.orderNumber || undefined,
        exchangeItemId: raw.exchangeItemId || undefined,
        items: raw.items.map((item: any) => ({
          id: item.id,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice ? Number(item.unitPrice) : 0,
          brandId: item.brandId,
          brandName: item.brandName,
          link: item.link
        })),
        payments: raw.payments.map((payment: any) => ({
          id: payment.id,
          amount: payment.amount ? Number(payment.amount) : 0,
          method: payment.method,
          reference: payment.reference,
          receiptNumber: payment.receiptNumber,
          description: payment.description,
          createdAt: payment.createdAt,
          financialRecords: payment.financialRecords
            ? payment.financialRecords.map((fr: any) => ({
                id: fr.id,
                paymentMethod: fr.paymentMethod,
                amount: Number(fr.amount),
                bankAccountId: fr.bankAccountId,
                bankAccountName: fr.bankAccount?.name,
                notes: fr.notes,
                createdBy: fr.createdBy,
                referenceNumber: fr.referenceNumber
              }))
            : []
        })),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        version: raw.version
      },
      raw.id
    );
  }
}
