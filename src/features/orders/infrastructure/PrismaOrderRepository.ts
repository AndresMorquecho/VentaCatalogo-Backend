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

    // REGLA DE NEGOCIO: Las órdenes tipo CAMBIO en estado POR_ENVIAR
    // no deben aparecer en la lista general de pedidos hasta que se emita guía (POR_RECIBIR)
    if (!filters.status && (!filters.type || filters.type !== 'CAMBIO')) {
      where.NOT = [
        ...(Array.isArray(where.NOT) ? where.NOT : (where.NOT ? [where.NOT] : [])),
        { type: 'CAMBIO', status: 'POR_ENVIAR' }
      ];
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        where.status = { in: filters.status as OrderStatus[] };
      } else if (typeof filters.status === 'string' && filters.status.includes(',')) {
        where.status = { in: filters.status.split(',') as OrderStatus[] };
      } else {
        where.status = filters.status as OrderStatus;
      }
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
    if (filters.receiptNumber) {
      where.receiptNumber = { contains: filters.receiptNumber, mode: 'insensitive' };
    }
    if (filters.sourceOrderNumber) {
      where.sourceOrderNumber = { contains: filters.sourceOrderNumber, mode: 'insensitive' };
    }
    if (filters.trackingGuide) {
      where.trackingGuide = { contains: filters.trackingGuide, mode: 'insensitive' };
    }
    if (filters.search) {
      where.OR = [
        { receiptNumber: { contains: filters.search, mode: 'insensitive' } },
        { clientName: { contains: filters.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
        { creditNoteNumber: { contains: filters.search, mode: 'insensitive' } },
        { orderNumber: { contains: filters.search, mode: 'insensitive' } },
        { brand: { name: { contains: filters.search, mode: 'insensitive' } } },
        { sourceOrderNumber: { contains: filters.search, mode: 'insensitive' } },
        { trackingGuide: { contains: filters.search, mode: 'insensitive' } },
        {
          childOrders: {
            some: {
              OR: [
                { orderNumber: { contains: filters.search, mode: 'insensitive' } },
                { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
                { creditNoteNumber: { contains: filters.search, mode: 'insensitive' } },
                { sourceOrderNumber: { contains: filters.search, mode: 'insensitive' } },
                { trackingGuide: { contains: filters.search, mode: 'insensitive' } }
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

    const orderBy: any = filters.sortBy 
      ? { [filters.sortBy]: filters.order || 'desc' }
      : { createdAt: 'desc' };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy,
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
          client: { select: { identificationNumber: true } },
          receipt: true,
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
              brand: true,
              client: { select: { identificationNumber: true } },
              receipt: true
            }
          },
          _count: {
            select: { childOrders: true }
          },
        },
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
        client: { select: { identificationNumber: true } },
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
            brand: true,
            client: { select: { identificationNumber: true } },
            receipt: true
          }
        },
        receipt: true
      }
    });

    return order ? this.toDomain(order) : null;
  }

  async findByReceiptNumber(receiptNumber: string): Promise<Order | null> {
    const order = await prisma.order.findFirst({
      where: { receiptNumber },
      include: {
        payments: true,
        brand: true,
        receipt: true,
        items: true,
        childOrders: {
          include: {
            items: true,
            payments: true,
            brand: true,
            receipt: true
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
    
    // 1. Get the max PD number
    const lastPD = await prisma.order.findFirst({
      where: { orderNumber: { startsWith: `PD-${year}-` } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true }
    });

    // 2. Get the max CAM number
    const lastCAM = await prisma.order.findFirst({
      where: { orderNumber: { startsWith: `CAM-${year}-` } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true }
    });

    // 3. Get the max OR receipt number (only if prefix is OR)
    let lastORValue = 0;
    if (prefix === 'OR') {
      const lastOROrder = await prisma.order.findFirst({
        where: { receiptNumber: { startsWith: `OR-${year}-` } },
        orderBy: { receiptNumber: 'desc' },
        select: { receiptNumber: true }
      });
      const lastORReceipt = await prisma.orderReceipt.findFirst({
        where: { receiptNumber: { startsWith: `OR-${year}-` } },
        orderBy: { receiptNumber: 'desc' },
        select: { receiptNumber: true }
      });
      
      const v1 = lastOROrder?.receiptNumber ? (parseInt(lastOROrder.receiptNumber.split('-')[2]) || 0) : 0;
      const v2 = lastORReceipt?.receiptNumber ? (parseInt(lastORReceipt.receiptNumber.split('-')[2]) || 0) : 0;
      lastORValue = Math.max(v1, v2);
    }

    // Extraction function
    const getNum = (val?: string | null) => {
      if (!val) return 0;
      const parts = val.split('-');
      return parts.length >= 3 ? (parseInt(parts[2]) || 0) : 0;
    };

    const maxPD = getNum(lastPD?.orderNumber);
    const maxCAM = getNum(lastCAM?.orderNumber);
    
    let finalMax = Math.max(maxPD, maxCAM);
    if (prefix === 'OR') finalMax = lastORValue;

    return `${prefix}-${year}-${String(finalMax + 1).padStart(3, '0')}`;
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
        clientIdentification: raw.client?.identificationNumber || undefined,
        notes: raw.notes,
        createdByName: raw.createdByName || undefined,
        receivedByName: raw.receivedByName || undefined,
        deliveredByName: raw.deliveredByName || undefined,
        parentOrderId: raw.parentOrderId || undefined,
        orderNumber: raw.orderNumber || undefined,
        trackingGuide: raw.trackingGuide || undefined,
        exchangeItemId: raw.exchangeItemId || undefined,
        sourceOrderId: raw.sourceOrderId || undefined,
        sourceOrderNumber: raw.sourceOrderNumber || undefined,
        sourceBrandName: raw.sourceBrandName || undefined,
        sourceQuantity: raw.sourceQuantity !== null ? Number(raw.sourceQuantity) : undefined,
        sourceDescription: raw.sourceDescription || undefined,
        description: raw.description || undefined,
        changeStatus: raw.changeStatus || undefined,
        receptionBatchId: raw.receptionBatchId || undefined,
        deliveryBatchId: raw.deliveryBatchId || undefined,
        packingNumber: raw.packingNumber || undefined,
        packingTotal: raw.packingTotal !== null ? Number(raw.packingTotal) : undefined,
        deliveryNumber: raw.deliveryNumber || undefined,
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
              createdBy: financialRecords[0]?.createdBy || undefined,
              financialRecords
            };
          });

          // Add dummy payments for Expenses/Refunds not linked to a specific payment object
          if (raw.financialRecords) {
            raw.financialRecords.forEach((fr: any) => {
              // Si es REVERSE_DELIVERY, no lo agregamos como pago negativo porque el pago original ya fue eliminado
              // y agregarlo duplicaría la deuda (paidAmount: -1, pendingAmount: 2).
              if (fr.source === 'REVERSE_DELIVERY' && fr.movementType === 'EXPENSE') {
                  return;
              }

              // Intentar parsear las notas si son JSON (formato buildNotesJSON)
              let processedDescription = fr.notes || '';
              try {
                  const parsed = JSON.parse(fr.notes);
                  if (parsed && typeof parsed === 'object' && parsed.v) {
                      processedDescription = `${parsed.title || 'MOVIMIENTO'}: ${parsed.extra || ''}`;
                  }
              } catch (e) {
                  // No es JSON, usar original
              }

              if (fr.movementType === 'EXPENSE') {
                mappedPayments.push({
                  id: fr.id,
                  amount: -Number(fr.amount),
                  method: fr.paymentMethod || 'EFECTIVO',
                  description: `Devolución/Gasto: ${processedDescription}`,
                  createdAt: fr.createdAt || raw.createdAt,
                  financialRecords: [fr]
                });
              } else if (fr.movementType === 'INCOME' && !fr.orderPaymentId && !raw.payments.some((p: any) => p.id === fr.orderPaymentId)) {
                // Income not linked to a payment (e.g. legacy or direct FR)
                mappedPayments.push({
                  id: fr.id,
                  amount: Number(fr.amount),
                  method: fr.paymentMethod || 'EFECTIVO',
                  description: `Abono directo: ${processedDescription}`,
                  createdAt: fr.createdAt || raw.createdAt,
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
      trackingGuide: json.trackingGuide,
      exchangeItemId: json.exchangeItemId,
      sourceOrderId: json.sourceOrderId,
      sourceOrderNumber: json.sourceOrderNumber,
      sourceBrandName: json.sourceBrandName,
      sourceQuantity: json.sourceQuantity,
      sourceDescription: json.sourceDescription,
      description: json.description,
      changeStatus: json.changeStatus,
      receptionBatchId: json.receptionBatchId,
      deliveryBatchId: json.deliveryBatchId,
      packingNumber: json.packingNumber,
      packingTotal: json.packingTotal,
      deliveryNumber: json.deliveryNumber,
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
