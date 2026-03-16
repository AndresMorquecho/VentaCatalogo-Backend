import { Request, Response } from 'express';
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
    private batchDeliverOrdersUseCase?: BatchDeliverOrdersUseCase
  ) { }

  getAll = async (req: Request, res: Response) => {
    const page = req.query.page ? parseInt(req.query.page as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const filters = {
      status: req.query.status as string,
      clientId: req.query.clientId as string,
      brandId: req.query.brandId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      search: req.query.search as string,
      onlyParents: req.query.onlyParents === 'true',
      page,
      limit
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
      const dto = {
        receiptNumber: req.body.receipt_number,
        clientId: req.body.client_id,
        salesChannel: req.body.sales_channel,
        createdAt: req.body.created_at ? new Date(req.body.created_at) : new Date(),
        paymentMethod: req.body.payment_method,
        bankAccountId: req.body.bank_account_id,
        transactionDate: new Date(req.body.transaction_date),
        createdByName: req.user!.username,
        initialPayment: {
          amount: Number(req.body.deposit || 0),
          method: req.body.payment_method,
          reference: req.body.transaction_reference || ''
        },
        creditAmount: Number(req.body.credit_to_use ?? 0),
        orders: req.body.orders.map((o: any) => ({
          brandId: o.brand_id,
          brandName: o.brand_name,
          total: Number(o.total),
          type: o.type,
          possibleDeliveryDate: new Date(o.possible_delivery_date),
          items: o.items.map((i: any) => ({
            productName: i.product_name,
            quantity: Number(i.quantity),
            unitPrice: Number(i.unit_price)
          })),
          deposit: Number(o.deposit || 0),
          orderNumber: o.orderNumber || o.order_number
        }))
      };

      if (!this.batchCreateOrderUseCase) {
        return HttpResponse.fail(res, 'BatchCreateOrderUseCase not initialized');
      }

      const result = await this.batchCreateOrderUseCase.execute(dto, req.user!.username);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.created(res, result.getValue().map((o: any) => o.toJSON()));
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch create orders');
    }
  };

  create = async (req: AuthRequest, res: Response) => {
    try {
      // Ensure brandId is available for items
      const orderBrandId = req.body.brand_id;

      if (!orderBrandId) {
        return HttpResponse.badRequest(res, 'Brand ID is required');
      }

      // Convert snake_case to camelCase and map deposit to initialPayment
      const dto = {
        receiptNumber: req.body.receipt_number, // Use manual receipt number if provided
        salesChannel: req.body.sales_channel,
        type: req.body.type,
        brandId: orderBrandId,
        brandName: req.body.brand_name,
        total: Number(req.body.total),
        paymentMethod: req.body.payment_method,
        bankAccountId: req.body.bank_account_id || null,
        transactionDate: new Date(req.body.transaction_date),
        possibleDeliveryDate: new Date(req.body.possible_delivery_date),
        clientId: req.body.client_id,
        clientName: req.body.client_name,
        items: req.body.items?.map((item: any) => ({
          productName: item.product_name,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          brandId: item.brand_id || orderBrandId, // CRITICAL: Use item's brandId or order's brandId as fallback
          brandName: item.brand_name || req.body.brand_name,
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
        parentOrderId: req.body.parentOrderId || req.body.parent_order_id,
        orderNumber: req.body.orderNumber || req.body.order_number
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
      console.log(`[OrderController] getByReceiptNumber called for: ${receiptNumber}`);
      const rawOrders = await prisma.order.findMany({
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
      console.log(`[OrderController] update called for ID: ${id}`);

      // Find existing order with full details
      const order = await prisma.order.findUnique({
        where: { id },
        include: { payments: true }
      });

      if (!order) {
        return HttpResponse.notFound(res, 'Order not found');
      }

      // 1. BUSINESS RULE: Only 'POR_RECIBIR' orders without additional movements can be edited
      const orderPayments = order.payments || [];
      const hasExtraPayments = orderPayments.length > 2 || (orderPayments.length > 1 && !orderPayments.some((p: any) => p.method === 'CREDITO_CLIENTE'));

      if (order.status !== 'POR_RECIBIR' || hasExtraPayments) {
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
      const updateData: any = {
        receiptNumber: req.body.receipt_number,
        salesChannel: req.body.sales_channel,
        type: req.body.type,
        brandId: req.body.brand_id,
        total: req.body.total !== undefined ? Number(req.body.total) : undefined,
        paymentMethod: req.body.payment_method,
        bankAccountId: req.body.bank_account_id,
        transactionDate: req.body.transaction_date ? new Date(req.body.transaction_date) : undefined,
        possibleDeliveryDate: req.body.possible_delivery_date ? new Date(req.body.possible_delivery_date) : undefined,
        orderNumber: req.body.orderNumber || req.body.order_number,
        clientId: req.body.client_id,
        clientName: req.body.client_name,
        notes: req.body.notes,
        createdAt: req.body.created_at ? new Date(req.body.created_at) : undefined,
        updatedAt: new Date()
      };

      // Remove undefined fields
      Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

      const savedOrder = await prisma.$transaction(async (tx) => {
        // Update Order
        const updated = await tx.order.update({
          where: { id },
          data: updateData,
          include: { items: true, payments: true, brand: true }
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

          if (Math.abs(diff) > 0.01) {
            // Must have only one payment or no payments
            if (updated.payments.length > 1) {
              throw new Error('No se puede editar el abono porque ya existen múltiples abonos vinculados.');
            }

            if (updated.payments.length === 1) {
              const payment = updated.payments[0];
              await tx.orderPayment.update({
                where: { id: payment.id },
                data: { amount: newDeposit }
              });

              if (updated.bankAccountId) {
                await tx.bankAccount.update({
                  where: { id: updated.bankAccountId },
                  data: { currentBalance: { increment: diff } }
                });
              }

          // Update Financial Record (linked by orderPaymentId for O(1) consistency)
          await tx.financialRecord.updateMany({
            where: { orderPaymentId: payment.id, type: 'PAYMENT' },
            data: { amount: newDeposit }
          });
            } else if (newDeposit > 0) {
              // Create new payment if it had none
              const paymentReceipt = `REC-ABO-${Date.now().toString().slice(-6)}`;
          const createdPayment = await tx.orderPayment.create({
                data: {
                  id: crypto.randomUUID(),
                  orderId: id,
                  amount: newDeposit,
                  method: updated.paymentMethod,
                  receiptNumber: paymentReceipt,
                  description: 'Abono inicial (Edit)'
                }
              });

              if (updated.bankAccountId) {
                await tx.bankAccount.update({
                  where: { id: updated.bankAccountId },
                  data: { currentBalance: { increment: newDeposit } }
                });
                await tx.financialRecord.create({
                  data: {
                    type: 'PAYMENT',
                    source: 'ORDER_PAYMENT',
                    movementType: 'INCOME',
                    referenceNumber: `REF-EDIT-${Date.now()}`,
                    amount: newDeposit,
                    date: new Date(),
                    clientId: updated.clientId,
                    clientName: updated.clientName,
                    orderId: id,
                orderPaymentId: createdPayment.id,
                    createdBy: req.user!.username,
                    notes: `Abono inicial editado ${updated.receiptNumber}`,
                    bankAccountId: updated.bankAccountId,
                    paymentMethod: updated.paymentMethod,
                    version: 1
                  }
                });
              }
            }
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
      const result = await this.deleteOrderUseCase.execute(id);

      if (result.isFailure) {
        return HttpResponse.badRequest(res, result.error!);
      }

      return HttpResponse.ok(res, { message: 'Pedido y registros asociados eliminados permanentemente, incluyendo saldos y créditos generados.' });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to delete order');
    }
  };

  batchUpdate = async (req: AuthRequest, res: Response) => {
    try {
      const { receiptNumber } = req.params;
      console.log(`[OrderController] batchUpdate called for receipt: ${receiptNumber}`);

      if (!this.batchUpdateOrdersUseCase) {
        return HttpResponse.fail(res, 'BatchUpdateOrdersUseCase not initialized');
      }

      const dto = {
        receiptNumber: receiptNumber || req.body.receipt_number,
        clientId: req.body.client_id,
        salesChannel: req.body.sales_channel,
        createdAt: req.body.created_at ? new Date(req.body.created_at) : new Date(),
        paymentMethod: req.body.payment_method,
        bankAccountId: req.body.bank_account_id,
        transactionDate: req.body.transaction_date ? new Date(req.body.transaction_date) : new Date(),
        notes: req.body.notes,
        toDelete: req.body.to_delete || [],
        creditAmount: Number(req.body.credit_amount || 0),
        orders: req.body.orders.map((o: any) => ({
          id: o.id,
          brandId: o.brandId || o.brand_id,
          brandName: o.brandName || o.brand_name,
          total: Number(o.total || 0),
          deposit: Number(o.deposit || 0),
          type: o.type,
          possibleDeliveryDate: new Date(o.possibleDeliveryDate || o.possible_delivery_date),
          orderNumber: o.orderNumber || o.order_number,
          quantity: Number(o.quantity || 1)
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
          entryDate: item.entryDate || item.entry_date
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
          entryDate: item.entryDate || item.entry_date
        }))
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
      // Get batches with minimal select (no heavy includes for performance)
      const batches = await prisma.receptionBatch.findMany({
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
              clientName: true,
              brandId: true,
              invoiceNumber: true,
              realInvoiceTotal: true,
              total: true,
              status: true,
              brand: {
                select: {
                  name: true
                }
              }
            }
          }
        },
        orderBy: { receptionDate: 'desc' }
      });
      
      // Transform to include brandName at order level for frontend compatibility
      const transformedBatches = batches.map(batch => ({
        ...batch,
        orders: batch.orders.map(order => ({
          ...order,
          brandName: order.brand.name,
          brand: undefined // Remove nested brand object
        }))
      }));
      
      return HttpResponse.ok(res, transformedBatches);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to get reception batches');
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

      const dto = {
        payments: req.body.payments ? req.body.payments.map((p: any) => ({
          amount: Number(p.amount),
          bankAccountId: p.bankAccountId || p.bank_account_id,
          paymentMethod: p.paymentMethod || p.payment_method,
          reference: p.reference
        })) : [],
        notes: req.body.notes,
        deliveredByName: req.user!.username
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

      const dto = {
        orderIds: req.body.orderIds || req.body.order_ids,
        payments: req.body.payments ? req.body.payments.map((p: any) => ({
          amount: Number(p.amount),
          bankAccountId: p.bankAccountId || p.bank_account_id,
          paymentMethod: p.paymentMethod || p.payment_method,
          reference: p.reference
        })) : [],
        deliveredByName: req.user!.username
      };

      const result = await this.batchDeliverOrdersUseCase.execute(dto, req.user!.username);
      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch deliver orders');
    }
  };
}
