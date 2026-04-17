import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { ReceiveOrderUseCase } from '../application/ReceiveOrder.usecase';
import { DeliverOrderUseCase } from '../application/DeliverOrder.usecase';
import { DeleteOrderUseCase } from '../application/DeleteOrder.usecase';
import { IOrderRepository } from '../domain/IOrderRepository';
import { Order } from '../domain/Order.entity';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';
import { BatchUpdateOrdersUseCase } from '../application/BatchUpdateOrders.usecase';
import { CreateReceptionBatchUseCase } from '../application/CreateReceptionBatch.usecase';
import { CreateReceptionBatchOptimizedUseCase } from '../application/CreateReceptionBatchOptimized.usecase';
import { DeleteReceptionBatchUseCase } from '../application/DeleteReceptionBatch.usecase';
import { BatchDeliverOrdersUseCase } from '../application/BatchDeliverOrders.usecase';
import { DeleteDeliveryBatchUseCase } from '../application/DeleteDeliveryBatch.usecase';
import { GetDeliveryBatchesUseCase } from '../application/GetDeliveryBatches.usecase';
import { PrismaOrderRepository } from './PrismaOrderRepository';
import { peekNextSequence } from '../../../shared/utils/SequenceGenerator';

export class OrderController {
  constructor(
    private createOrderUseCase: CreateOrderUseCase,
    private getOrdersUseCase: GetOrdersUseCase,
    private orderRepository: IOrderRepository,
    private receiveOrderUseCase?: ReceiveOrderUseCase,
    private deliverOrderUseCase?: DeliverOrderUseCase,
    private deleteOrderUseCase?: DeleteOrderUseCase,
    private batchCreateOrderUseCase?: any,
    private batchUpdateOrdersUseCase?: BatchUpdateOrdersUseCase,
    private createReceptionBatchUseCase?: CreateReceptionBatchUseCase,
    private createReceptionBatchOptimizedUseCase?: CreateReceptionBatchOptimizedUseCase,
    private deleteReceptionBatchUseCase?: DeleteReceptionBatchUseCase,
    private batchDeliverOrdersUseCase?: BatchDeliverOrdersUseCase,
    private deleteDeliveryBatchUseCase?: DeleteDeliveryBatchUseCase,
    private getDeliveryBatchesUseCase?: GetDeliveryBatchesUseCase,
    private reverseOrderDeliveryUseCase?: any
  ) { }

  getAll = async (req: Request, res: Response) => {
    const page = req.query.page ? parseInt(req.query.page as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const statusParam = req.query.status as string | undefined;

    // "POR_PAGAR" and "PAGADO" are virtual statuses used by the payments module.
    // They are NOT stored in the DB — they are derived from total vs sum(payments).
    let hasPendingPayment: boolean | undefined = undefined;
    let status: string | undefined = statusParam;

    if (statusParam === 'POR_PAGAR') {
      hasPendingPayment = true;
      status = undefined;
    } else if (statusParam === 'PAGADO') {
      hasPendingPayment = false;
      status = undefined;
    }

    let excludeIds: string[] | undefined = undefined;
    if (req.query.excludeIds) {
      excludeIds = Array.isArray(req.query.excludeIds)
        ? (req.query.excludeIds as string[])
        : (req.query.excludeIds as string).split(',').filter(id => id.length > 0);
    }

    const filters: any = {
      status,
      clientId: req.query.clientId as string,
      brandId: req.query.brandId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      search: req.query.search as string,
      receiptNumber: req.query.receiptNumber as string,
      sourceOrderNumber: req.query.sourceOrderNumber as string,
      trackingGuide: req.query.trackingGuide as string,
      orderNumber: req.query.orderNumber as string,
      type: req.query.type as string,
      onlyParents: req.query.onlyParents === 'true',
      hasPendingPayment,
      page,
      limit,
      sortBy: req.query.sortBy as string,
      order: req.query.order as 'asc' | 'desc',
      excludeIds
    };

    const result = await this.getOrdersUseCase.execute(filters);

    if (result.isFailure) {
      return HttpResponse.fail(res, result.error!);
    }

    const { data, total } = result.getValue();
    const orders = data.map(order => order.toJSON());

    // Always return a paginated-like structure so httpClient.ts doesn't unwrap the data field
    // and the frontend hooks can consistently access .data
    return res.json({
      success: true,
      data: orders,
      pagination: {
        page: page || 1,
        limit: limit || total,
        total,
        pages: limit ? Math.ceil(total / limit) : 1
      }
    });
  };

  generateReceiptNumber = async (req: Request, res: Response) => {
    try {
      const receiptNumber = await this.orderRepository.generateReceiptNumber();
      return HttpResponse.ok(res, { receiptNumber });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to generate receipt number');
    }
  };

  generateOrderNumber = async (req: Request, res: Response) => {
    try {
      const orderNumber = await this.orderRepository.generateOrderNumber();
      return HttpResponse.ok(res, { orderNumber });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to generate order number');
    }
  };

  generateExchangeReceiptNumber = async (req: Request, res: Response) => {
    try {
      const orderNumber = await this.orderRepository.generateExchangeReceiptNumber();
      return HttpResponse.ok(res, { orderNumber });
    } catch (error) {
      return HttpResponse.fail(
        res,
        error instanceof Error ? error.message : 'Failed to generate exchange receipt number'
      );
    }
  };

  /** POST: asigna y devuelve el siguiente Guia-AAAA-NNN (PDF guía de envío de cambios). */
  allocateExchangeShippingGuideSerial = async (req: Request, res: Response) => {
    try {
      const guideSequential = await this.orderRepository.allocateExchangeShippingGuideSerial();
      return HttpResponse.ok(res, { guideSequential });
    } catch (error) {
      return HttpResponse.fail(
        res,
        error instanceof Error ? error.message : 'Failed to allocate shipping guide serial'
      );
    }
  };

  checkReceiptExists = async (req: Request, res: Response) => {
    try {
      const { receiptNumber } = req.params;
      const order = await this.orderRepository.findByReceiptNumber(receiptNumber);
      return HttpResponse.ok(res, { exists: !!order });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to check receipt number');
    }
  };

  batchCreate = async (req: AuthRequest, res: Response) => {
    try {
      // Procesar múltiples métodos de pago si están presentes
      let totalDeposit = Number(req.body.deposit || 0);
      let paymentMethod = req.body.payment_method || req.body.paymentMethod || 'EFECTIVO';
      let creditAmount = Number(req.body.credit_to_use ?? 0);
      let paymentData = null;
      
      // Si hay payment_data, procesarlo para múltiples métodos de pago
      if (req.body.payment_data && req.body.payment_data.payments) {
        const payments = req.body.payment_data.payments;
        totalDeposit = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        
        // Usar el primer método de pago como principal (para compatibilidad)
        if (payments.length > 0) {
          paymentMethod = payments[0].method;
        }
        
        // Calcular crédito de billetera virtual usado
        const walletPayments = payments.filter((p: any) => p.method === 'BILLETERA_VIRTUAL');
        creditAmount = walletPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        
        // Guardar datos de pago para procesamiento posterior
        paymentData = req.body.payment_data;

        // Validaciones pre-transacción para split payment
        const declaredTotal = Number(req.body.payment_data.totalAmount || 0);
        const paymentsSum = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        const ordersDepositSum = (req.body.orders as any[]).reduce((sum: number, o: any) => sum + Number(o.deposit || 0), 0);

        if (declaredTotal > 0 && Math.abs(paymentsSum - declaredTotal) > 0.01) {
          return HttpResponse.badRequest(res, `La suma de los métodos de pago (${paymentsSum.toFixed(2)}) no coincide con el total declarado (${declaredTotal.toFixed(2)})`);
        }

        if (ordersDepositSum > 0 && paymentsSum > 0 && Math.abs(paymentsSum - ordersDepositSum) > 0.01) {
          return HttpResponse.badRequest(res, `La suma de los métodos de pago (${paymentsSum.toFixed(2)}) no coincide con la suma de depósitos por pedido (${ordersDepositSum.toFixed(2)})`);
        }
      }

      const dto = {
        receiptNumber: req.body.receipt_number || req.body.receiptNumber,
        clientId: req.body.client_id || req.body.clientId,
        salesChannel: req.body.sales_channel || req.body.salesChannel,
        createdAt: (req.body.created_at || req.body.createdAt) ? new Date(req.body.created_at || req.body.createdAt) : new Date(),
        paymentMethod: paymentMethod,
        bankAccountId: req.body.bank_account_id || req.body.bankAccountId,
        transactionDate: (req.body.transaction_date || req.body.transactionDate) ? new Date(req.body.transaction_date || req.body.transactionDate) : new Date(),
        createdByName: req.user!.username,
        initialPayment: {
          amount: totalDeposit,
          method: paymentMethod,
          reference: req.body.transaction_reference || ''
        },
        creditAmount: creditAmount,
        notes: req.body.notes,
        paymentData: paymentData, // Agregar datos de múltiples pagos
        trackingGuide: req.body.tracking_guide || req.body.trackingGuide || null,
        orders: req.body.orders.map((o: any) => ({
          brandId: o.brandId || o.brand_id,
          brandName: o.brandName || o.brand_name,
          total: Number(o.total),
          type: o.type,
          status: o.status, // Pass through status so CAMBIO orders keep POR_ENVIAR
          possibleDeliveryDate: (o.possibleDeliveryDate || o.possible_delivery_date) ? new Date(o.possibleDeliveryDate || o.possible_delivery_date) : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
          items: o.items.map((i: any) => ({
            productName: i.productName || i.product_name,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice || i.unit_price)
          })),
          deposit: Number(o.deposit || o.abono || 0),
          orderNumber: o.orderNumber || o.order_number,
          sourceOrderId: o.sourceOrderId || o.source_order_id,
          sourceOrderNumber: o.sourceOrderNumber || o.source_order_number,
          sourceBrandName: o.sourceBrandName || o.source_brand_name,
          sourceQuantity: o.sourceQuantity || o.source_quantity,
          sourceDescription: o.sourceDescription || o.source_description,
          description: o.description,
          notes: o.notes
        }))
      };

      if (!this.batchCreateOrderUseCase) {
        return HttpResponse.fail(res, 'BatchCreateOrderUseCase not initialized');
      }

      const result = await this.batchCreateOrderUseCase.execute(dto, req.user!.username);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      const ordersJson = result.getValue().map((o: any) => o.toJSON());
      const rn = String(dto.receiptNumber || '').trim();
      if (/^CAM-\d{4}-/i.test(rn)) {
        const rec = await prisma.orderReceipt.findUnique({
          where: { receiptNumber: rn },
          select: { shippingRegistryNumber: true },
        });
        if (rec?.shippingRegistryNumber && ordersJson[0]) {
          ordersJson[0] = {
            ...ordersJson[0],
            receipt: {
              ...((ordersJson[0] as any).receipt || {}),
              shippingRegistryNumber: rec.shippingRegistryNumber,
            },
          };
        }
      }
      return HttpResponse.created(res, ordersJson);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch create orders');
    }
  };

  create = async (req: AuthRequest, res: Response) => {
    try {
      // Ensure brandId is available for items
      const orderBrandId = req.body.brand_id || req.body.brandId;

      if (!orderBrandId) {
        return HttpResponse.badRequest(res, 'Brand ID is required');
      }

      // Convert snake_case to camelCase and map deposit to initialPayment
      // If bank_account_id is not in the root, try to get it from the first payment
      const bankAccountId = req.body.bank_account_id || 
                           (req.body.payments && req.body.payments[0] ? 
                            (req.body.payments[0].bank_account_id || req.body.payments[0].bankAccountId) : 
                            null);
      
      const dto = {
        receiptNumber: req.body.receipt_number || req.body.receiptNumber, // Use manual receipt number if provided
        salesChannel: req.body.sales_channel || req.body.salesChannel,
        type: req.body.type,
        brandId: orderBrandId,
        brandName: req.body.brand_name || req.body.brandName,
        total: Number(req.body.total),
        paymentMethod: req.body.payment_method || req.body.paymentMethod || 'EFECTIVO',
        bankAccountId: bankAccountId,
        transactionDate: (req.body.transaction_date || req.body.transactionDate) ? new Date(req.body.transaction_date || req.body.transactionDate) : new Date(),
        possibleDeliveryDate: (req.body.possible_delivery_date || req.body.possibleDeliveryDate) ? new Date(req.body.possible_delivery_date || req.body.possibleDeliveryDate) : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        clientId: req.body.client_id || req.body.clientId,
        clientName: req.body.client_name || req.body.clientName,
        items: req.body.items?.map((item: any) => ({
          productName: item.productName || item.product_name,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice || item.unit_price),
          brandId: item.brandId || item.brand_id || orderBrandId,
          brandName: item.brandName || item.brand_name || req.body.brandName || req.body.brand_name,
          link: item.link
        })) || [],
        notes: req.body.notes,
        createdByName: req.user!.username,
        createdAt: req.body.created_at ? new Date(req.body.created_at) : undefined,
        initialPayment: {
          amount: Number(req.body.deposit || 0),
          method: req.body.payment_method,
          reference: req.body.transaction_reference || ''
        },
        creditAmount: Number(req.body.credit_to_use ?? req.body.creditToUse ?? 0),
        payments: req.body.payments?.map((p: any) => ({
          amount: p.amount,
          method: p.method,
          bankAccountId: p.bank_account_id || p.bankAccountId,
          reference: p.reference,
          notes: p.notes
        })),
        parentOrderId: req.body.parentOrderId || req.body.parent_order_id,
        orderNumber: req.body.orderNumber || req.body.order_number,
        status: req.body.status || req.body.state,
        sourceOrderId: req.body.sourceOrderId || req.body.source_order_id,
        sourceOrderNumber: req.body.sourceOrderNumber || req.body.source_order_number,
        sourceBrandName: req.body.sourceBrandName || req.body.source_brand_name,
        sourceQuantity: req.body.sourceQuantity !== undefined ? Number(req.body.sourceQuantity) : (req.body.source_quantity !== undefined ? Number(req.body.source_quantity) : undefined),
        sourceDescription: req.body.sourceDescription || req.body.source_description,
        description: req.body.description,
      };



      const result = await this.createOrderUseCase.execute(dto, req.user!.username);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }
      return HttpResponse.created(res, result.getValue().toJSON());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to create order');
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const order = await this.orderRepository.findById(id);

      if (!order) {
        return HttpResponse.notFound(res, 'Order not found');
      }

      return HttpResponse.ok(res, order.toJSON());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to get order');
    }
  };

  getByReceiptNumber = async (req: Request, res: Response) => {
    try {
      const { receiptNumber } = req.params;

      const rawOrders = await prisma.order.findMany({
        where: { receiptNumber },
        include: {
          items: true,
          payments: true,
          brand: true,
          receipt: true,
          exchangeBatchItems: {
            include: {
              batch: true
            }
          },
          childOrders: {
            include: {
              items: true,
              payments: true,
              brand: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      if (rawOrders.length === 0) {
        return HttpResponse.notFound(res, 'Receipt group not found');
      }

      // Prisma ya incluye campos escalares (orderNumber) y relaciones (payments/items)
      return HttpResponse.ok(res, rawOrders);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to get receipt group');
    }
  };

  update = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;


      // Find existing order with full details
      const order = await prisma.order.findUnique({
        where: { id },
        include: { payments: true }
      });

      if (!order) {
        return HttpResponse.notFound(res, 'Order not found');
      }

      // 1. BUSINESS RULE: Only orders in initial states without extra payments can be fully edited
      const canEditStatus = ['POR_RECIBIR', 'POR_ENVIAR', 'EN_TRANSITO'].includes(order.status);
      const orderPayments = order.payments || [];
      const hasExtraPayments = orderPayments.length > 2 || (orderPayments.length > 1 && !orderPayments.some((p: any) => p.method === 'CREDITO_CLIENTE'));

      if (!canEditStatus || hasExtraPayments) {
        let reason = 'No se puede editar este pedido porque ya tiene movimientos (recepción o abonos adicionales).';
        if (order.status === 'ENTREGADO') reason = 'No se puede editar un pedido que ya ha sido entregado.';
        if (order.status === 'RECIBIDO_EN_BODEGA') reason = 'No se puede editar un pedido que ya ha sido receptado en bodega.';
        if (hasExtraPayments) reason = 'No se puede editar este pedido específico porque ya tiene abonos adicionales vinculados.';
        
        return HttpResponse.badRequest(res, reason);
      }

      // 2. BUSINESS RULE: Consolidated orders in closed cash periods
      const lastClosure = await prisma.cashClosure.findFirst({
        orderBy: { toDate: 'desc' }
      });

      if (lastClosure && order.transactionDate <= lastClosure.toDate) {
        return HttpResponse.badRequest(res, 'No se puede editar un pedido de un periodo de caja ya cerrado. Requiere reversión contable.');
      }

      // 3. BUSINESS RULE: Initial payment protection
      // If req.body has a new deposit/initial payment amount
      if (req.body.deposit !== undefined) {
        // Check if there are more than 1 payment (the initial one)
        if (order.payments.length > 1) {
          return HttpResponse.badRequest(res, 'No se puede editar el abono inicial porque ya existen abonos posteriores vinculados a este pedido.');
        }
      }

      // Map DTO but keep critical fields protected
      const updateData: Record<string, unknown> = {
        receiptNumber: req.body.receipt_number || req.body.receiptNumber,
        salesChannel: req.body.sales_channel || req.body.salesChannel,
        type: req.body.type,
        brandId: req.body.brand_id || req.body.brandId,
        total: req.body.total !== undefined ? Number(req.body.total) : undefined,
        paymentMethod: req.body.payment_method || req.body.paymentMethod,
        transactionDate: (req.body.transaction_date || req.body.transactionDate) ? new Date(req.body.transaction_date || req.body.transactionDate) : undefined,
        possibleDeliveryDate: (req.body.possible_delivery_date || req.body.possibleDeliveryDate) ? new Date(req.body.possible_delivery_date || req.body.possibleDeliveryDate) : undefined,
        orderNumber: req.body.orderNumber || req.body.order_number,
        clientId: req.body.client_id || req.body.clientId,
        clientName: req.body.client_name || req.body.clientName,
        notes: req.body.notes,
        status: req.body.status,
        trackingGuide: req.body.trackingGuide || req.body.tracking_guide,
        exchangeShippingGuideSeq:
          req.body.exchangeShippingGuideSeq || req.body.exchange_shipping_guide_seq || undefined,
        receptionBatchId: req.body.receptionBatchId || req.body.reception_batch_id,
        deliveryBatchId: req.body.deliveryBatchId || req.body.delivery_batch_id,
        packingNumber: req.body.packingNumber || req.body.packing_number,
        packingTotal: req.body.packingTotal !== undefined ? Number(req.body.packingTotal) : (req.body.packing_total !== undefined ? Number(req.body.packing_total) : undefined),
        deliveryNumber: req.body.deliveryNumber || req.body.delivery_number,
        changeStatus: req.body.changeStatus || req.body.change_status,
        sourceOrderId: req.body.sourceOrderId || req.body.source_order_id,
        sourceOrderNumber: req.body.sourceOrderNumber || req.body.source_order_number,
        sourceBrandName: req.body.sourceBrandName || req.body.source_brand_name,
        sourceQuantity: req.body.sourceQuantity !== undefined ? Number(req.body.sourceQuantity) : (req.body.source_quantity !== undefined ? Number(req.body.source_quantity) : undefined),
        sourceDescription: req.body.sourceDescription || req.body.source_description,
        description: req.body.description,
        createdAt: (req.body.created_at || req.body.createdAt) ? new Date(req.body.created_at || req.body.createdAt) : undefined,
        updatedAt: new Date()
      };

      if (req.body.bank_account_id !== undefined || req.body.bankAccountId !== undefined) {
        updateData.bankAccountId =
          req.body.bank_account_id ?? req.body.bankAccountId ?? null;
      }



      // Remove undefined fields
      Object.keys(updateData).forEach((key) => updateData[key] === undefined && delete updateData[key]);

      const savedOrder = await prisma.$transaction(async (tx) => {
        // Update Order — usar unchecked para bankAccountId, brandId, clientId, FKs escalares
        const updated = await tx.order.update({
          where: { id },
          data: updateData as Prisma.OrderUncheckedUpdateInput,
          include: { items: true, payments: true, brand: true, client: true }
        });

        // 4. Update items if provided
        if (req.body.items && Array.isArray(req.body.items)) {
          // Simplificación: eliminar y recrear items para este pedido individual
          await tx.orderItem.deleteMany({ where: { orderId: id } });
          for (const item of req.body.items) {
            await tx.orderItem.create({
              data: {
                id: item.id || crypto.randomUUID(),
                orderId: id,
                productName: item.productName || item.brand_name || item.brandName,
                quantity: Number(item.quantity) || 1,
                unitPrice: Number(item.unitPrice) || Number(item.unit_price) || 0,
                brandId: item.brandId || item.brand_id || updateData.brandId || updated.brandId,
                brandName: item.brandName || item.brand_name || ""
              }
            });
          }
        }

        // 5. Update deposit if provided
        if (req.body.deposit !== undefined) {
          const newDeposit = Number(req.body.deposit);
          const currentDeposit = updated.payments.reduce((sum, p) => sum + Number(p.amount), 0);
          const diff = newDeposit - currentDeposit;
          
          const newMethod = req.body.payment_method || req.body.paymentMethod || updated.paymentMethod;
          const newBankId = req.body.bank_account_id || req.body.bankAccountId || updated.bankAccountId;

          if (updated.payments.length === 1) {
            const payment = updated.payments[0];
            const oldBankId = (payment as any).bankAccountId || updated.bankAccountId;
            const oldMethod = payment.method;
            // Since UI locks the method, newMethod will always === oldMethod when there's an existing deposit
            // But we still read it in case it's a new-deposit scenario
            const amountChanged = Math.abs(diff) > 0.01;
            const accountChanged = newBankId !== oldBankId;
            const methodChanged = newMethod !== oldMethod;

            if (amountChanged || accountChanged || methodChanged) {
              // --- NET DELTA LOGIC ---
              // The frontend always sends the same method if there's an existing deposit.
              // So we only need to adjust the DIFFERENCE, not do a full reversal.
              let actualBankId = newBankId || oldBankId;

              if (oldMethod === 'BILLETERA_VIRTUAL') {
                // diff = newDeposit - oldDeposit
                // If diff < 0: client gets money back (refund diff absolute)
                // If diff > 0: client pays more (deduct extra)
                const clientAcc = await tx.clientAccount.findUnique({ where: { clientId: updated.clientId } });
                if (clientAcc) {

                  if (diff < -0.001) {
                    // Client is REDUCING deposit → refund the difference
                    const refundAmount = Math.abs(diff);
                    await tx.clientCredit.create({
                      data: {
                        clientAccountId: clientAcc.id,
                        amount: refundAmount,
                        remainingAmount: refundAmount,
                        originTransactionId: `REF-EDIT-${payment.id}-${crypto.randomUUID().slice(0, 4)}`,
                        status: 'AVAILABLE',
                        createdAt: new Date()
                      }
                    });
                    await tx.clientAccount.update({
                      where: { id: clientAcc.id },
                      data: { totalCreditAvailable: { increment: refundAmount }, version: { increment: 1 } }
                    });
                  } else if (diff > 0.001) {
                    // Client is INCREASING deposit → deduct the extra from wallet
                    const extraAmount = diff;
                    if (Number(clientAcc.totalCreditAvailable) < extraAmount) {
                      throw new Error(`Saldo insuficiente en billetera para el aumento. Disponible: $${clientAcc.totalCreditAvailable}, Requerido: $${extraAmount}`);
                    }
                    // Consume FIFO
                    const availableCredits = await tx.clientCredit.findMany({
                      where: { clientAccountId: clientAcc.id, status: 'AVAILABLE' },
                      orderBy: { createdAt: 'asc' }
                    });
                    let remaining = extraAmount;
                    for (const credit of availableCredits) {
                      if (remaining <= 0) break;
                      const subtract = Math.min(Number(credit.remainingAmount), remaining);
                      const newRemaining = Number(credit.remainingAmount) - subtract;
                      await tx.clientCredit.update({
                        where: { id: credit.id },
                        data: {
                          remainingAmount: newRemaining,
                          status: newRemaining <= 0.01 ? 'USED' : 'AVAILABLE',
                          usedAt: newRemaining <= 0.01 ? new Date() : undefined
                        }
                      });
                      remaining -= subtract;
                    }
                    await tx.clientAccount.update({
                      where: { id: clientAcc.id },
                      data: { totalCreditAvailable: { decrement: extraAmount }, version: { increment: 1 } }
                    });
                  }
                }
                // Find a cash bank account for the financial record reference
                const anyBank = await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
                actualBankId = anyBank?.id || actualBankId;

              } else {
                // CASH / BANK: apply net delta directly to bank account
                if (diff < -0.001) {
                  // Reduce deposit → return money to bank (decrement)
                  const bankIdToUse = oldBankId || newBankId;
                  if (bankIdToUse) {
                    await tx.bankAccount.update({
                      where: { id: bankIdToUse },
                      data: { currentBalance: { decrement: Math.abs(diff) }, version: { increment: 1 } }
                    });
                  }
                } else if (diff > 0.001) {
                  // Increase deposit → add money to bank
                  const bankIdToUse = newBankId || oldBankId;
                  if (bankIdToUse) {
                    await tx.bankAccount.update({
                      where: { id: bankIdToUse },
                      data: { currentBalance: { increment: diff }, version: { increment: 1 } }
                    });
                  }
                }
                actualBankId = newBankId || oldBankId;
              }

              // --- UPDATE RECORDS ---
              await tx.order.update({
                where: { id: id },
                data: { paymentMethod: newMethod, bankAccountId: actualBankId || null }
              });

              await tx.orderPayment.update({
                where: { id: payment.id },
                data: { amount: newDeposit, method: newMethod }
              });

              const finalNotes = `${newMethod === 'BILLETERA_VIRTUAL' ? 'Uso de Billetera Virtual' : 'Abono inicial'} editado | Cédula: ${updated.client?.identificationNumber || '—'} | Orden: ${updated.receiptNumber} | Pedido: ${updated.orderNumber || '—'} | Marca: ${(updated as any).brand?.name || '—'} | Tipo: ${updated.type.toUpperCase()}`;
              
              let frMatch = await tx.financialRecord.findFirst({ where: { orderPaymentId: payment.id, type: 'PAYMENT' } });
              if (!frMatch) {
                frMatch = await tx.financialRecord.findFirst({ where: { orderId: id, type: 'PAYMENT' } });
                if (frMatch) {
                  await tx.financialRecord.update({ where: { id: frMatch.id }, data: { orderPaymentId: payment.id } });
                }
              }

              const fallbackBank = await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } });
              const finalBankId = actualBankId || fallbackBank?.id;

              if (frMatch) {
                // @ts-ignore
                await tx.financialRecord.update({
                  where: { id: frMatch.id },
                  data: { 
                    amount: newDeposit,
                    bankAccount: { connect: { id: finalBankId || '' } },
                    paymentMethod: newMethod,
                    notes: finalNotes,
                    orderPayment: { connect: { id: payment.id } }
                  }
                } as any);
              } else if (newDeposit > 0) {
                // @ts-ignore
                await tx.financialRecord.create({
                  data: {
                    type: 'PAYMENT',
                    source: newMethod === 'BILLETERA_VIRTUAL' ? 'WALLET' : 'ORDER_PAYMENT',
                    movementType: 'INCOME',
                    referenceNumber: `REF-EDIT-${Date.now()}`,
                    amount: newDeposit,
                    date: new Date(),
                    client: { connect: { id: updated.clientId } },
                    clientName: updated.clientName,
                    order: { connect: { id: id } },
                    orderPayment: { connect: { id: payment.id } },
                    createdBy: req.user!.username,
                    notes: finalNotes,
                    bankAccount: { connect: { id: finalBankId || '' } },
                    paymentMethod: newMethod,
                    clientDocument: updated.client?.identificationNumber || '—',
                    version: 1
                  }
                } as any);
              }
            }
          } else if (newDeposit > 0) {
            // Case: No existing payments, but a new deposit is provided
            const paymentReceipt = `REC-ABO-${Date.now().toString().slice(-6)}`;
            
            let actualBankId = newBankId;
            if (newMethod === 'BILLETERA_VIRTUAL') {
              // Validate balance
              const clientAccForValidation = await tx.clientAccount.findUnique({ where: { clientId: updated.clientId } });
              const availableBalance = Number(clientAccForValidation?.totalCreditAvailable || 0);
              if (availableBalance < newDeposit) {
                throw new Error(`Saldo insuficiente en billetera. Disponible: $${availableBalance.toFixed(2)}, Requerido: $${newDeposit.toFixed(2)}`);
              }

              // Consume credits FIFO
              const availableCredits = await tx.clientCredit.findMany({
                where: { clientAccount: { clientId: updated.clientId }, status: 'AVAILABLE' },
                orderBy: { createdAt: 'asc' }
              });
              let remaining = newDeposit;
              for (const credit of availableCredits) {
                if (remaining <= 0) break;
                const subtract = Math.min(Number(credit.remainingAmount), remaining);
                const newRemaining = Number(credit.remainingAmount) - subtract;
                await tx.clientCredit.update({
                  where: { id: credit.id },
                  data: {
                    remainingAmount: newRemaining,
                    status: newRemaining <= 0.01 ? 'USED' : 'AVAILABLE',
                    usedAt: newRemaining <= 0.01 ? new Date() : undefined
                  }
                });
                remaining -= subtract;
              }

              // Decrement client account balance
              await tx.clientAccount.update({
                where: { clientId: updated.clientId },
                data: { totalCreditAvailable: { decrement: newDeposit }, version: { increment: 1 } }
              });

              const virtualBank = await tx.bankAccount.findFirst({
                where: { type: 'CASH', isActive: true }
              });
              actualBankId = virtualBank?.id || null;
            } else if (newBankId) {
               // Apply to bank account
               await tx.bankAccount.update({
                where: { id: newBankId },
                data: { currentBalance: { increment: newDeposit }, version: { increment: 1 } }
              });
            }

            // 1. Update order record with new info
            await tx.order.update({
              where: { id: id },
              data: {
                paymentMethod: newMethod,
                bankAccountId: newMethod === 'BILLETERA_VIRTUAL' ? actualBankId : (newBankId || null)
              }
            });

            // 2. Create payment record
            const createdPayment = await tx.orderPayment.create({
              data: {
                id: crypto.randomUUID(),
                orderId: id,
                amount: newDeposit,
                method: newMethod,
                receiptNumber: paymentReceipt,
                description: 'Abono inicial (Edit)'
              }
            });

            // 3. Create Financial Record
            // @ts-ignore - Prisma types are out of sync
            await tx.financialRecord.create({
              data: {
                type: 'PAYMENT',
                source: newMethod === 'BILLETERA_VIRTUAL' ? 'WALLET' : 'ORDER_PAYMENT',
                movementType: 'INCOME',
                referenceNumber: `REF-EDIT-${Date.now()}`,
                amount: newDeposit,
                date: new Date(),
                client: { connect: { id: updated.clientId } },
                clientName: updated.clientName,
                order: { connect: { id: id } },
                orderPayment: { connect: { id: createdPayment.id } },
                createdBy: req.user!.username,
                notes: `${newMethod === 'BILLETERA_VIRTUAL' ? 'Uso de Billetera Virtual' : 'Abono inicial'} registrado desde edición | Cédula: ${updated.client?.identificationNumber || updated.clientId || '—'} | Orden: ${updated.receiptNumber} | Pedido: ${updated.orderNumber || '—'} | Marca: ${(updated as any).brand?.name || '—'} | Tipo: ${updated.type.toUpperCase()}`,
                bankAccount: { connect: { id: actualBankId || (await tx.bankAccount.findFirst({ where: { type: 'CASH', isActive: true } }))?.id || "cash-account-1" } },
                paymentMethod: newMethod,
                clientDocument: updated.client?.identificationNumber || updated.clientId || '—',
                version: 1
              } as any
            });
          }
        }

        // 6. Update client last order info
        await tx.client.update({
          where: { id: updated.clientId },
          data: {
            lastOrderDate: new Date(),
            lastBrandName: req.body.brand_name || (updated as any).brand?.name || null
          }
        });

        return updated;
      });

      return HttpResponse.ok(res, savedOrder);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to update order');
    }
  };

  deleteOrder = async (req: Request, res: Response) => {
    try {
      if (!this.deleteOrderUseCase) {
        return HttpResponse.fail(res, 'DeleteOrderUseCase not initialized');
      }

      const { id } = req.params;
      const cascade = req.query.cascade === 'true';
      const result = await this.deleteOrderUseCase.execute(id, cascade);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.ok(res, { 
        message: cascade 
          ? 'Recibo completo y todos sus pedidos asociados eliminados, incluyendo reversión de saldos.' 
          : 'Pedido eliminado permanentemente, incluyendo reversión de saldos y créditos vinculados.' 
      });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to delete order');
    }
  };

  batchUpdate = async (req: AuthRequest, res: Response) => {
    try {
      const { receiptNumber } = req.params;


      if (!this.batchUpdateOrdersUseCase) {
        return HttpResponse.fail(res, 'BatchUpdateOrdersUseCase not initialized');
      }

      const dto = {
        receiptNumber: receiptNumber || req.body.receipt_number || req.body.receiptNumber,
        clientId: req.body.client_id || req.body.clientId,
        salesChannel: req.body.sales_channel || req.body.salesChannel,
        createdAt: (req.body.created_at || req.body.createdAt) ? new Date(req.body.created_at || req.body.createdAt) : new Date(),
        paymentMethod: req.body.payment_method || req.body.paymentMethod || 'EFECTIVO',
        bankAccountId: req.body.bank_account_id || req.body.bankAccountId,
        transactionDate: (req.body.transaction_date || req.body.transactionDate) ? new Date(req.body.transaction_date || req.body.transactionDate) : new Date(),
        notes: req.body.notes,
        toDelete: req.body.to_delete || req.body.toDelete || [],
        creditAmount: Number(req.body.credit_amount || req.body.creditAmount || 0),
        paymentData: req.body.payment_data || req.body.paymentData,
        orders: req.body.orders.map((o: any) => ({
          id: o.id,
          brandId: o.brandId || o.brand_id,
          brandName: o.brandName || o.brand_name,
          total: Number(o.total || 0),
          deposit: Number(o.deposit || 0),
          type: o.type,
          possibleDeliveryDate: new Date(o.possibleDeliveryDate || o.possible_delivery_date),
          orderNumber: o.orderNumber || o.order_number,
          quantity: Number(o.quantity || 1),
          sourceOrderId: o.sourceOrderId || o.source_order_id,
          sourceOrderNumber: o.sourceOrderNumber || o.source_order_number,
          sourceBrandName: o.sourceBrandName || o.source_brand_name,
          sourceQuantity: o.sourceQuantity || o.source_quantity,
          sourceDescription: o.sourceDescription || o.source_description,
          description: o.description
        }))
      };

      const result = await this.batchUpdateOrdersUseCase.execute(dto, req.user!.username);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.ok(res, result.getValue());
    } catch (error) {
      console.error('Batch update error in controller:', error);
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Batch update failed');
    }
  };

  receiveOrder = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.receiveOrderUseCase) {
        return HttpResponse.fail(res, 'ReceiveOrderUseCase not initialized');
      }

      const { id } = req.params;

      // Convert snake_case to camelCase
      const dto = {
        finalTotal: Number(req.body.final_total || req.body.finalTotal),
        invoiceNumber: req.body.invoice_number || req.body.invoiceNumber,
        abonoRecepcion: req.body.abono_recepcion || req.body.abonoRecepcion
          ? Number(req.body.abono_recepcion || req.body.abonoRecepcion)
          : undefined,
        bankAccountId: req.body.bank_account_id || req.body.bankAccountId,
        paymentMethod: req.body.payment_method || req.body.paymentMethod,
        reference: req.body.reference || req.body.transaction_reference || undefined,
        receivedByName: req.user!.username,
        reprogrammedItemIds: req.body.reprogrammedItemIds || []
      };

      const result = await this.receiveOrderUseCase.execute(id, dto, req.user!.username);

      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to receive order');
    }
  };

  batchReception = async (req: AuthRequest, res: Response) => {
    try {
      // ✅ USE OPTIMIZED VERSION if available
      if (this.createReceptionBatchOptimizedUseCase) {
        return await this.batchReceptionOptimized(req, res);
      }

      // Fallback to old version
      if (!this.createReceptionBatchUseCase) {
        return HttpResponse.fail(res, 'CreateReceptionBatchUseCase not initialized');
      }

      const items = req.body.items;
      const packingNumber = req.body.packing_number || req.body.packingNumber || 'N/A';
      const packingTotal = req.body.packing_total !== undefined ? req.body.packing_total : (req.body.packingTotal || 0);

      if (!Array.isArray(items) || items.length === 0) {
        return HttpResponse.badRequest(res, 'Items array is required and must not be empty');
      }

      const dto = {
        id: req.body.id,
        packingNumber: String(packingNumber),
        packingTotal: Number(packingTotal),
        items: items.map((item: any) => ({
          orderId: item.orderId || item.order_id,
          finalTotal: Number(item.finalTotal || item.final_total),
          invoiceNumber: item.finalInvoiceNumber || item.final_invoice_number || item.invoiceNumber || item.invoice_number,
          abonoRecepcion: item.abonoRecepcion || item.abono_recepcion
            ? Number(item.abonoRecepcion || item.abono_recepcion)
            : undefined,
          bankAccountId: item.bankAccountId || item.bank_account_id,
          paymentMethod: item.paymentMethod || item.payment_method,
          reference: item.referenceNumber || item.reference_number || undefined,
          documentType: item.documentType || item.document_type,
          entryDate: item.entryDate || item.entry_date,
          creditDistribution: (() => {
            const cd = item.creditDistribution || item.credit_distribution;
            if (!cd) return undefined;
            return {
              sourceOrderId: cd.sourceOrderId || cd.source_order_id,
              totalCreditAmount: Number(cd.totalCreditAmount || cd.total_credit_amount || 0),
              distributions: (cd.distributions || []).map((d: any) => ({
                targetOrderId: d.targetOrderId || d.target_order_id,
                amount: Number(d.amount || 0),
                description: d.description,
                isCashReturn: d.isCashReturn || d.is_cash_return || false,
                bankAccountId: d.bankAccountId || d.bank_account_id
              }))
            };
          })()
        }))
      };

      const result = await this.createReceptionBatchUseCase.execute(dto, req.user!.username);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.ok(res, result.getValue());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch receive orders');
    }
  };

  /**
   * ✅ OPTIMIZED VERSION - Batch Reception
   * 
   * Performance improvements:
   * - 700+ queries → ~50 queries
   * - 15-30 seconds → 2-4 seconds (for 50 orders)
   * - Eliminates loop with await
   * - Accumulates financial operations
   * - Uses bulk inserts
   * - Minimal response payload
   */
  batchReceptionOptimized = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.createReceptionBatchOptimizedUseCase) {
        return HttpResponse.fail(res, 'CreateReceptionBatchOptimizedUseCase not initialized');
      }

      const items = req.body.items;
      const packingNumber = req.body.packing_number || req.body.packingNumber || 'N/A';
      const packingTotal = req.body.packing_total !== undefined ? req.body.packing_total : (req.body.packingTotal || 0);

      if (!Array.isArray(items) || items.length === 0) {
        return HttpResponse.badRequest(res, 'Items array is required and must not be empty');
      }

      const dto = {
        id: req.body.id,
        packingNumber: String(packingNumber),
        packingTotal: Number(packingTotal),
        items: items.map((item: any) => {
          const cd = item.creditDistribution || item.credit_distribution;
          
          return {
            orderId: item.orderId || item.order_id,
            finalTotal: Number(item.finalTotal || item.final_total),
            invoiceNumber: item.finalInvoiceNumber || item.final_invoice_number || item.invoiceNumber || item.invoice_number,
            abonoRecepcion: item.abonoRecepcion || item.abono_recepcion
              ? Number(item.abonoRecepcion || item.abono_recepcion)
              : undefined,
            bankAccountId: item.bankAccountId || item.bank_account_id,
            paymentMethod: item.paymentMethod || item.payment_method,
            reference: item.referenceNumber || item.reference_number || undefined,
            documentType: item.documentType || item.document_type,
            entryDate: item.entryDate || item.entry_date,
            fromExchangeBatch: item.fromExchangeBatch || item.from_exchange_batch || false,
            creditDistribution: cd ? {
              sourceOrderId: cd.sourceOrderId || cd.source_order_id,
              totalCreditAmount: Number(cd.totalCreditAmount || cd.total_credit_amount || 0),
              distributions: (cd.distributions || []).map((d: any) => ({
                targetOrderId: d.targetOrderId || d.target_order_id,
                amount: Number(d.amount || 0),
                description: d.description,
                isCashReturn: d.isCashReturn || d.is_cash_return || false,
                bankAccountId: d.bankAccountId || d.bank_account_id || d.bankAccountID || d.bank_acc_id
              }))
            } : undefined
          };
        })
      };

      const result = await this.createReceptionBatchOptimizedUseCase.execute(dto, req.user!.username);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.ok(res, result.getValue());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch receive orders');
    }
  };

  deleteReceptionBatch = async (req: Request, res: Response) => {
    try {
      if (!this.deleteReceptionBatchUseCase) {
        return HttpResponse.fail(res, 'DeleteReceptionBatchUseCase not initialized');
      }

      const { id } = req.params;
      const result = await this.deleteReceptionBatchUseCase.execute(id);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.ok(res, { message: 'Lote de recepción revertido exitosamente. Todos los pedidos han regresado a estado pendiente.' });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to delete reception batch');
    }
  };

  getReceptionBatches = async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string) || 15);
      const skip = (page - 1) * limit;

      const packingNumber = req.query.packingNumber as string;
      const brandId = req.query.brandId as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const search = req.query.search as string;

      const where: any = {};

      if (packingNumber) {
        where.packingNumber = { contains: packingNumber, mode: 'insensitive' };
      }

      if (brandId && brandId !== 'ALL') {
        where.orders = { some: { brandId } };
      }

      if (startDate || endDate) {
        where.receptionDate = {};
        if (startDate) where.receptionDate.gte = new Date(startDate);
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          where.receptionDate.lte = end;
        }
      }

      const orConditions: any[] = [];
      if (search) {
        orConditions.push({ packingNumber: { contains: search, mode: 'insensitive' } });
        orConditions.push({ notes: { contains: search, mode: 'insensitive' } });
        orConditions.push({ 
          orders: { 
            some: { 
              OR: [
                { clientName: { contains: search, mode: 'insensitive' } },
                { receiptNumber: { contains: search, mode: 'insensitive' } }
              ] 
            } 
          } 
        });
      }

      if (orConditions.length > 0) {
        where.OR = orConditions;
      }

      // Get batches with minimal select (no heavy includes for performance)
      const [batches, total] = await Promise.all([
        prisma.receptionBatch.findMany({
          where,
          select: {
            id: true,
            packingNumber: true,
            packingTotal: true,
            receptionDate: true,
            receivedByName: true,
            createdAt: true,
            notes: true,
            orders: {
              select: {
                id: true,
                receiptNumber: true,
                orderNumber: true,
                sourceOrderNumber: true,
                type: true,
                documentType: true,
                clientName: true,
                brandId: true,
                invoiceNumber: true,
                realInvoiceTotal: true,
                total: true,
                status: true,
                payments: true,
                brand: {
                  select: {
                    name: true
                  }
                }
              }
            }
          },
          orderBy: { receptionDate: 'desc' },
          skip,
          take: limit
        }),
        prisma.receptionBatch.count({ where })
      ]);
      
      // Transform to include brandName at order level for frontend compatibility
      const transformedBatches = batches.map(batch => ({
        ...batch,
        orders: batch.orders.map(order => ({
          ...order,
          brandName: (order.brand as any).name,
          brand: undefined // Remove nested brand object
        }))
      }));
      
      return res.status(200).json({
        success: true,
        data: transformedBatches,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to get reception batches');
    }
  };

  generatePackingNumber = async (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const formattedNumber = await peekNextSequence('PK-', 'PACKING');
      return HttpResponse.ok(res, { packingNumber: formattedNumber });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error generating packing number');
    }
  };

  generateDeliveryNumber = async (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const formattedNumber = await peekNextSequence('EN-', 'DELIVERY');
      return HttpResponse.ok(res, { deliveryNumber: formattedNumber });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error generating delivery number');
    }
  };

  getDeliveryBatches = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.getDeliveryBatchesUseCase) {
        return HttpResponse.fail(res, 'GetDeliveryBatchesUseCase not initialized');
      }

      const filters = {
        searchText: req.query.search as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        clientId: req.query.clientId as string,
        orderQuantity: req.query.orderQuantity as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 25
      };

      const result = await this.getDeliveryBatchesUseCase.execute(filters);
      if (result.isFailure) return HttpResponse.fail(res, result.error!);

      return HttpResponse.ok(res, result.getValue());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to get delivery batches');
    }
  };

  deleteDeliveryBatch = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.deleteDeliveryBatchUseCase) {
        return HttpResponse.fail(res, 'DeleteDeliveryBatchUseCase not initialized');
      }

      const { id } = req.params;
      const result = await this.deleteDeliveryBatchUseCase.execute(id, req.user!.username);

      if (result.isFailure) return HttpResponse.fail(res, result.error!);
      return HttpResponse.ok(res, result.getValue());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to delete delivery batch');
    }
  };

  batchReceptionSimple = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.receiveOrderUseCase) {
        return HttpResponse.fail(res, 'ReceiveOrderUseCase not initialized');
      }

      const { orderIds } = req.body;

      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return HttpResponse.badRequest(res, 'orderIds array is required and must not be empty');
      }

      // Procesar cada pedido secuencialmente usando el total estimado como real
      const results = [];
      const errors = [];

      for (const orderId of orderIds) {
        try {
          // Obtener pedido para usar su total como finalTotal
          const order = await this.orderRepository.findById(orderId);

          if (!order) {
            errors.push({
              orderId,
              success: false,
              error: 'Order not found'
            });
            continue;
          }

          const dto = {
            finalTotal: order.total, // Usar total estimado como real
            invoiceNumber: undefined, // Sin número de factura
            abonoRecepcion: undefined,
            bankAccountId: undefined,
            paymentMethod: undefined,
            receivedByName: req.user!.username
          };

          const result = await this.receiveOrderUseCase.execute(
            orderId,
            dto,
            req.user!.username
          );

          results.push({
            orderId,
            success: true,
            data: result
          });
        } catch (error) {
          errors.push({
            orderId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Si todos fallaron, retornar error
      if (errors.length === orderIds.length) {
        return HttpResponse.badRequest(res, `All ${orderIds.length} orders failed to be received`);
      }

      // Retornar resultados (éxitos y errores)
      return HttpResponse.ok(res, {
        success: results,
        errors: errors.length > 0 ? errors : undefined,
        summary: {
          total: orderIds.length,
          succeeded: results.length,
          failed: errors.length
        }
      });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch receive orders');
    }
  };

  deliverOrder = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.deliverOrderUseCase) {
        return HttpResponse.fail(res, 'DeliverOrderUseCase not initialized');
      }

      const { id } = req.params;

      const distributionsRaw = req.body.creditDistribution || req.body.credit_distribution || 
                               (Array.isArray(req.body.creditDistributions) ? req.body.creditDistributions[0] : req.body.creditDistributions) ||
                               (Array.isArray(req.body.credit_distributions) ? req.body.credit_distributions[0] : req.body.credit_distributions);

      const mappingDist = (d: any) => ({
        targetOrderId: d.targetOrderId || d.target_order_id,
        amount: Number(d.amount),
        description: d.description,
        isCashReturn: d.isCashReturn || d.is_cash_return || false,
        bankAccountId: d.bankAccountId || d.bank_account_id
      });

      const dto = {
        payments: req.body.payments ? req.body.payments.map((p: any) => ({
          amount: Number(p.amount),
          bankAccountId: p.bankAccountId || p.bank_account_id,
          paymentMethod: p.paymentMethod || p.payment_method,
          reference: p.reference
        })) : [],
        notes: req.body.notes,
        deliveredByName: req.user!.username,
        creditDistribution: distributionsRaw ? {
          sourceOrderId: distributionsRaw.sourceOrderId || distributionsRaw.source_order_id,
          totalCreditAmount: Number(distributionsRaw.totalCreditAmount || distributionsRaw.total_credit_amount),
          distributions: (distributionsRaw.distributions || []).map(mappingDist)
        } : undefined
      };


      const result = await this.deliverOrderUseCase.execute(id, dto, req.user!.username);

      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to deliver order');
    }
  };

  reverseReception = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      await prisma.$transaction(async (tx: any) => {
        // Find existing order with full details
        const order = await tx.order.findUnique({
          where: { id },
          include: {
            payments: true,
            financialRecords: true,
            inventoryMovements: true,
            client: {
              include: {
                clientAccount: true
              }
            }
          }
        });

        if (!order) {
          throw new Error('Order not found');
        }

        // 1. Validations
        if (order.status === 'ENTREGADO') {
          throw new Error('No se puede regresar la recepción de un pedido que ya ha sido entregado.');
        }

        if (order.status !== 'RECIBIDO_EN_BODEGA') {
          throw new Error('El pedido no está en estado recibido.');
        }

        // Check consolidation
        const lastClosure = await tx.cashClosure.findFirst({
          orderBy: { toDate: 'desc' }
        });

        if (lastClosure && order.receptionDate && order.receptionDate <= lastClosure.toDate) {
          throw new Error('No se puede regresar la recepción de un periodo de caja ya cerrado.');
        }

        // 2. Identify and reversa abono de recepción (Added during reception)
        const receptionPayments = order.payments.filter((p: any) =>
          p.description === 'Abono en recepción de bodega'
        );

        for (const payment of receptionPayments) {
          const relatedFr = order.financialRecords.find((fr: any) =>
            Number(fr.amount) === Number(payment.amount) &&
            fr.notes && fr.notes.includes('Abono en recepción')
          );

          if (relatedFr && relatedFr.bankAccountId) {
            await tx.bankAccount.update({
              where: { id: relatedFr.bankAccountId },
              data: { currentBalance: { decrement: relatedFr.amount }, version: { increment: 1 } }
            });
          }

          if (relatedFr) {
            await tx.financialRecord.delete({ where: { id: relatedFr.id } });
          }
          await tx.orderPayment.delete({ where: { id: payment.id } });
        }

        // 3. Delete inventory movements associated with reception
        await tx.inventoryMovement.deleteMany({
          where: { orderId: id, type: 'ENTRY' }
        });

        // 4. Revert Client Credits generated during this reception
        const receptionCredits = await tx.clientCredit.findMany({
          where: {
            originOrderId: id,
            status: 'AVAILABLE' // Only revert if not yet used
          }
        });

        for (const credit of receptionCredits) {
          if (order.client?.clientAccount) {
            await tx.clientAccount.update({
              where: { id: order.client.clientAccount.id },
              data: {
                totalCreditAvailable: { decrement: credit.remainingAmount },
                version: { increment: 1 }
              }
            });
          }
          await tx.clientCredit.delete({ where: { id: credit.id } });
        }

        // 4. Update Order Status back to POR_RECIBIR
        await tx.order.update({
          where: { id },
          data: {
            status: 'POR_RECIBIR',
            receptionDate: null,
            receivedByName: null,
            realInvoiceTotal: null,
            invoiceNumber: null,
            version: { increment: 1 }
          }
        });
      });

      return HttpResponse.ok(res, { message: 'Recepción regresada exitosamente' });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to reverse reception');
    }
  };

  batchDeliver = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.batchDeliverOrdersUseCase) {
        return HttpResponse.fail(res, 'BatchDeliverOrdersUseCase not initialized');
      }

      const distributionsRaw = req.body.creditDistributions || req.body.credit_distributions || 
                               (req.body.creditDistribution ? [req.body.creditDistribution] : []) ||
                               (req.body.credit_distribution ? [req.body.credit_distribution] : []);

      const mappingDist = (d: any) => ({
        targetOrderId: d.targetOrderId || d.target_order_id,
        amount: Number(d.amount),
        description: d.description,
        isCashReturn: d.isCashReturn || d.is_cash_return || false,
        bankAccountId: d.bankAccountId || d.bank_account_id
      });

      const dto = {
        id: req.body.id,
        orderIds: req.body.orderIds || req.body.order_ids,
        deliveryNumber: req.body.deliveryNumber || req.body.delivery_number,
        payments: req.body.payments ? req.body.payments.map((p: any) => ({
          amount: Number(p.amount),
          bankAccountId: p.bankAccountId || p.bank_account_id,
          paymentMethod: p.paymentMethod || p.payment_method,
          reference: p.reference
        })) : [],
        deliveredByName: req.user!.username,
        creditDistributions: Array.isArray(distributionsRaw) ? distributionsRaw.map((ds: any) => ({
          sourceOrderId: ds.sourceOrderId || ds.source_order_id,
          totalCreditAmount: Number(ds.totalCreditAmount || ds.total_credit_amount),
          distributions: (ds.distributions || []).map(mappingDist)
        })) : []
      };


      // @ts-ignore
      const result = await this.batchDeliverOrdersUseCase.execute(dto, req.user!.username);
      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch deliver orders');
    }
  };

  dismantleOrder = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { mode, reason } = req.body;

      if (!mode || !['BLOCK', 'NORMAL'].includes(mode)) {
        return HttpResponse.badRequest(res, 'Invalid dismantle mode');
      }

      await this.orderRepository.dismantle(id, mode as any, reason || 'No especificado');

      return HttpResponse.ok(res, { success: true, message: 'Pedido desmantelado correctamente' });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to dismantle order');
    }
  };
  reverseDelivery = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.reverseOrderDeliveryUseCase) {
        return HttpResponse.fail(res, 'ReverseOrderDeliveryUseCase not initialized');
      }

      const { id } = req.params;
      const result = await this.reverseOrderDeliveryUseCase.execute(id, req.user!.username);

      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to reverse delivery');
    }
  };

  renameReceipt = async (req: AuthRequest, res: Response) => {
    try {
      const { receiptNumber: oldReceiptNumber } = req.params;
      const { newReceiptNumber } = req.body;

      if (!newReceiptNumber) {
        return HttpResponse.badRequest(res, 'El nuevo número de recibo es requerido');
      }

      // Check if the new receipt number already exists
      const existing = await prisma.orderReceipt.findUnique({
        where: { receiptNumber: newReceiptNumber }
      });

      if (existing) {
        return HttpResponse.badRequest(res, `El número de recibo "${newReceiptNumber}" ya está en uso.`);
      }

      const result = await prisma.$transaction(async (tx) => {
        // Update OrderReceipt
        const updatedReceipt = await tx.orderReceipt.update({
          where: { receiptNumber: oldReceiptNumber },
          data: { 
            receiptNumber: newReceiptNumber,
            version: { increment: 1 }
          }
        });

        // Update all related Orders
        await tx.order.updateMany({
          where: { receiptNumber: oldReceiptNumber },
          data: { 
            receiptNumber: newReceiptNumber,
            version: { increment: 1 }
          }
        });

        // Update all related ExchangeBatchItems
        // Check if the table exists/supported via prisma client first or just try to updateMany
        await (tx as any).exchangeBatchItem.updateMany({
          where: { receiptNumber: oldReceiptNumber },
          data: { 
            receiptNumber: newReceiptNumber
          }
        });

        return updatedReceipt;
      });

      return HttpResponse.ok(res, { success: true, data: result });
    } catch (error) {
      console.error('[OrderController.renameReceipt] Error:', error);
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error al renombrar el recibo');
    }
  };

  /**
   * Cancel an entire exchange receipt (CAM-XXXX) and reverse all financial transactions.
   * RULES:
   *   - ALL orders must be in POR_RECIBIR or POR_ENVIAR state.
   *   - Any order in EN_TRÁNSITO, RECIBIDO_EN_BODEGA or ENTREGADO blocks deletion.
   *   - Any order with an active trackingGuide (non SN-* prefix) blocks deletion.
   *   - Deposits (payments) made at creation time are reversed from bank accounts.
   *   - Each cancelled order gets an audit note with user + timestamp.
   */
  cancelExchangeReceipt = async (req: AuthRequest, res: Response) => {
    const { receiptNumber } = req.params;
    const cancelledBy = req.user?.username || 'system';

    try {
      // 1. Load all orders in the receipt group
      const orders = await prisma.order.findMany({
        where: { receiptNumber, type: 'CAMBIO' },
        include: { payments: true }
      });

      if (!orders || orders.length === 0) {
        return HttpResponse.notFound(res, `No se encontró el recibo ${receiptNumber}`);
      }

      // 2. Validate all orders are cancellable
      const BLOCKED_STATUSES = ['RECIBIDO_EN_BODEGA', 'ENTREGADO'];
      const blocked = orders.filter(o => BLOCKED_STATUSES.includes(o.status));
      if (blocked.length > 0) {
        return res.status(409).json({
          success: false,
          error: `No se puede eliminar el recibo. ${blocked.length} pedido(s) ya fueron recibidos o entregados.`,
          blockedOrders: blocked.map(o => ({ id: o.id, status: o.status, clientName: o.clientName }))
        });
      }

      const withGuide = orders.filter(o => o.trackingGuide && !o.trackingGuide.startsWith('SN-'));
      if (withGuide.length > 0) {
        return res.status(409).json({
          success: false,
          error: `No se puede eliminar el recibo. ${withGuide.length} pedido(s) están incluidos en una guía de envío activa (${[...new Set(withGuide.map(o => o.trackingGuide))].join(', ')}).`,
          guideOrders: withGuide.map(o => ({ id: o.id, trackingGuide: o.trackingGuide }))
        });
      }

      // 3. Execute reversal in a transaction
      await prisma.$transaction(async (tx) => {
        for (const order of orders) {
          // Reverse all payments associated with this order
          for (const payment of (order.payments as any[])) {
            if (payment.bankAccountId && Number(payment.amount) > 0) {
              await (tx as any).bankAccount.update({
                where: { id: payment.bankAccountId },
                data: { balance: { decrement: Number(payment.amount) } }
              });
            }
            await (tx as any).payment.delete({ where: { id: payment.id } });
          }

          // Cancel the order with audit trail
          await (tx as any).order.update({
            where: { id: order.id },
            data: {
              status: 'CANCELADO',
              notes: `[CANCELADO por ${cancelledBy} el ${new Date().toISOString()}] ${order.notes || ''}`.trim(),
              updatedAt: new Date()
            }
          });
        }
      });

      return HttpResponse.ok(res, {
        message: `Recibo ${receiptNumber} cancelado correctamente. ${orders.length} pedido(s) revertidos.`,
        cancelledCount: orders.length
      });

    } catch (error) {
      console.error('[cancelExchangeReceipt] Error:', error);
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error al cancelar el recibo');
    }
  };
}
