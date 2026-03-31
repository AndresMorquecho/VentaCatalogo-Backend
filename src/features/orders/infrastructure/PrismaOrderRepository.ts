import { prisma } from '../../../lib/prisma';
import { IOrderRepository, OrderFilters } from '../domain/IOrderRepository';
import { Order, OrderStatus } from '../domain/Order.entity';
import { Prisma } from '@prisma/client';

export class PrismaOrderRepository implements IOrderRepository {
  async findAll(filters: OrderFilters): Promise<{ data: Order[]; total: number }> {
    const where: Prisma.OrderWhereInput = {};

    // REGLA DE NEGOCIO: Las órdenes tipo CATALOGO no deben aparecer en la gestión de pedidos
    // Solo deben reflejarse en transacciones financieras, cierre de caja y bancos
    // A menos que se solicite explícitamente con el filtro type: 'CATALOGO'
    if (!filters.type || filters.type !== 'CATALOGO') {
      where.type = { not: 'CATALOGO' };
    }

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.brandId) where.brandId = filters.brandId;
    if (filters.onlyParents) {
      where.parentOrderId = null;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.invoiceNumber) {
      where.invoiceNumber = { contains: filters.invoiceNumber, mode: 'insensitive' };
    }
    if (filters.creditNoteNumber) {
      where.creditNoteNumber = { contains: filters.creditNoteNumber, mode: 'insensitive' };
    }
    if (filters.search) {
      where.OR = [
        { receiptNumber: { contains: filters.search, mode: 'insensitive' } },
        { clientName: { contains: filters.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
        { creditNoteNumber: { contains: filters.search, mode: 'insensitive' } },
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
        { brand: { name: { contains: filters.search, mode: 'insensitive' } } },
        {
          childOrders: {
            some: {
              OR: [
                { orderNumber: { contains: filters.search, mode: 'insensitive' } },
                { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
                { creditNoteNumber: { contains: filters.search, mode: 'insensitive' } }
              ]
            }
          }
        }
      ];
    }
    if (filters.startDate || filters.endDate) {
      where.transactionDate = {};
      if (filters.startDate) where.transactionDate.gte = filters.startDate;
      if (filters.endDate) where.transactionDate.lte = filters.endDate;
    }

    // hasPendingPayment: filter orders where (realInvoiceTotal ?? total) > sum(payments.amount)
    // Prisma doesn't support aggregate comparisons in where, so we use a raw subquery for IDs.
    if (filters.hasPendingPayment === true) {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT o.id
        FROM "orders" o
        WHERE COALESCE(o."real_invoice_total", o.total) > COALESCE(
          (SELECT SUM(p.amount) FROM "order_payments" p WHERE p."order_id" = o.id),
          0
        )
      `;
      const pendingIds = rows.map(r => r.id);
      if (pendingIds.length === 0) return { data: [], total: 0 };
      where.id = { in: pendingIds };
    } else if (filters.hasPendingPayment === false) {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT o.id
        FROM "orders" o
        WHERE COALESCE(o."real_invoice_total", o.total) <= COALESCE(
          (SELECT SUM(p.amount) FROM "order_payments" p WHERE p."order_id" = o.id),
          0
        )
      `;
      const paidIds = rows.map(r => r.id);
      if (paidIds.length === 0) return { data: [], total: 0 };
      where.id = { in: paidIds };
    }

    const { page, limit } = filters;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit || undefined;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
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
          financialRecords: {
            select: {
              id: true,
              paymentMethod: true,
              amount: true,
              bankAccountId: true,
              notes: true,
              createdBy: true,
              referenceNumber: true,
              movementType: true,
              type: true,
              orderPaymentId: true,
              bankAccount: { select: { name: true } }
            }
          },
          brand: true,
          childOrders: {
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
            }
          },
          _count: {
            select: { childOrders: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.order.count({ where })
    ]);

    return {
      data: orders.map(order => this.toDomain(order)),
      total
    };
  }

  async findById(id: string): Promise<Order | null> {
    const order = await prisma.order.findUnique({
      where: { id },
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
        financialRecords: {
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            bankAccountId: true,
            notes: true,
            createdBy: true,
            referenceNumber: true,
            movementType: true,
            type: true,
            orderPaymentId: true,
            bankAccount: { select: { name: true } }
          }
        },
        brand: true,
        childOrders: {
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
          }
        }
      }
    });

    return order ? this.toDomain(order) : null;
  }

  async findByReceiptNumber(receiptNumber: string): Promise<Order | null> {
    const order = await prisma.order.findFirst({
      where: { receiptNumber },
      include: {
        items: true,
        payments: true,
        brand: true,
        childOrders: {
          include: {
            items: true,
            payments: true,
            brand: true
          }
        }
      }
    });

    return order ? this.toDomain(order) : null;
  }

  async save(order: Order): Promise<Order> {
    const data = this.toPersistence(order);

    const created = await prisma.order.create({
      data: {
        ...data,
        items: {
          create: order.items
        },
        payments: {
          create: order.payments
        }
      },
      include: {
        items: true,
        payments: true
      }
    });

    return this.toDomain(created);
  }

  async update(order: Order): Promise<Order> {
    const data = this.toPersistence(order);

    const updated = await prisma.order.update({
      where: { id: order.id },
      data,
      include: {
        items: true,
        payments: true
      }
    });

    return this.toDomain(updated);
  }

  async delete(id: string): Promise<void> {
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { orderId: id } }),
      prisma.orderPayment.deleteMany({ where: { orderId: id } }),
      prisma.financialRecord.deleteMany({ where: { orderId: id } }),
      prisma.inventoryMovement.deleteMany({ where: { orderId: id } }),
      prisma.order.delete({ where: { id } })
    ]);
  }

  async generateReceiptNumber(): Promise<string> {
    return this.generateSequence('OR');
  }

  async generateOrderNumber(): Promise<string> {
    return this.generateSequence('PD');
  }

  async generateSequence(prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const searchPattern = `${prefix}-${year}-`;

    const lastOrder = await prisma.order.findFirst({
      where: {
        OR: [
          { receiptNumber: { startsWith: searchPattern } },
          { orderNumber: { startsWith: searchPattern } }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });

    let lastNumber = 0;
    if (lastOrder) {
      const matchTarget = prefix === 'OR' ? lastOrder.receiptNumber : (lastOrder.orderNumber || '');
      const parts = matchTarget.split('-');
      if (parts.length >= 3) {
        lastNumber = parseInt(parts[2]) || 0;
      }
    }

    return `${prefix}-${year}-${String(lastNumber + 1).padStart(3, '0')}`;
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
        creditNoteNumber: raw.creditNoteNumber,
        creditNoteTotal: raw.creditNoteTotal ? Number(raw.creditNoteTotal) : undefined,
        status: raw.status as OrderStatus,
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
        payments: (() => {
          const mappedPayments = raw.payments.map((payment: any) => {
            // For SPLIT_PAYMENT: use FRs linked to this payment, or fall back to order-level FRs
            let financialRecords = payment.financialRecords
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
              : [];

            // Fallback: if SPLIT_PAYMENT has no linked FRs, use order-level financialRecords
            if (payment.method === 'SPLIT_PAYMENT' && financialRecords.length === 0 && raw.financialRecords?.length > 0) {
              financialRecords = raw.financialRecords
                .filter((fr: any) => fr.movementType === 'INCOME')
                .map((fr: any) => ({
                  id: fr.id,
                  paymentMethod: fr.paymentMethod,
                  amount: Number(fr.amount),
                  bankAccountId: fr.bankAccountId,
                  bankAccountName: fr.bankAccount?.name,
                  notes: fr.notes,
                  createdBy: fr.createdBy,
                  referenceNumber: fr.referenceNumber
                }));
            }

            return {
              id: payment.id,
              amount: payment.amount ? Number(payment.amount) : 0,
              method: payment.method,
              reference: payment.reference,
              receiptNumber: payment.receiptNumber,
              description: payment.description,
              createdAt: payment.createdAt,
              financialRecords
            };
          });

          // Add dummy payments for Expenses/Refunds not linked to a specific payment object
          if (raw.financialRecords) {
            raw.financialRecords.forEach((fr: any) => {
              if (fr.movementType === 'EXPENSE') {
                mappedPayments.push({
                  id: fr.id,
                  amount: -Number(fr.amount),
                  method: fr.paymentMethod || 'EFECTIVO',
                  description: `Devolución/Gasto: ${fr.notes || ''}`,
                  createdAt: raw.createdAt,
                  financialRecords: [fr]
                });
              } else if (fr.movementType === 'INCOME' && !fr.orderPaymentId && !raw.payments.some((p: any) => p.id === fr.orderPaymentId)) {
                // Income not linked to a payment (e.g. legacy or direct FR)
                mappedPayments.push({
                  id: fr.id,
                  amount: Number(fr.amount),
                  method: fr.paymentMethod || 'EFECTIVO',
                  description: `Abono directo: ${fr.notes || ''}`,
                  createdAt: raw.createdAt,
                  financialRecords: [fr]
                });
              }
            });
          }
          return mappedPayments;
        })(),
        childOrders: raw.childOrders ? raw.childOrders.map((child: any) => this.toDomain(child)) : undefined,
        childOrdersCount: raw._count?.childOrders,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        version: raw.version
      },
      raw.id
    );
  }

  private toPersistence(order: Order): any {
    const json = order.toJSON();
    return {
      id: json.id,
      receiptNumber: json.receiptNumber,
      salesChannel: json.salesChannel,
      type: json.type,
      brandId: json.brandId,
      total: json.total,
      realInvoiceTotal: json.realInvoiceTotal,
      paymentMethod: json.paymentMethod,
      bankAccountId: json.bankAccountId,
      transactionDate: json.transactionDate,
      possibleDeliveryDate: json.possibleDeliveryDate,
      receptionDate: json.receptionDate,
      deliveryDate: json.deliveryDate,
      invoiceNumber: json.invoiceNumber,
      creditNoteNumber: json.creditNoteNumber,
      creditNoteTotal: json.creditNoteTotal,
      status: json.status,
      clientId: json.clientId,
      clientName: json.clientName,
      notes: json.notes,
      createdByName: json.createdByName,
      receivedByName: json.receivedByName,
      deliveredByName: json.deliveredByName,
      parentOrderId: json.parentOrderId,
      orderNumber: json.orderNumber,
      exchangeItemId: json.exchangeItemId,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
      version: json.version
    };
  }
  async dismantle(orderId: string, mode: 'BLOCK' | 'NORMAL', reason: string): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) throw new Error('Order not found');

    await prisma.$transaction(async (tx) => {
      // 1. Update Order Status
      await tx.order.update({
        where: { id: orderId },
        data: { 
          status: 'DESMANTELADO',
          notes: order.notes ? `${order.notes}\n[DESMANTELADO - ${mode}: ${reason}]` : `[DESMANTELADO - ${mode}: ${reason}]`,
          version: { increment: 1 }
        }
      });

      // 2. If mode is BLOCK, block the client
      if (mode === 'BLOCK') {
        await tx.client.update({
          where: { id: order.clientId },
          data: { 
            isBlocked: true,
            blockedReason: reason
          }
        });
      }
    });
  }
}
