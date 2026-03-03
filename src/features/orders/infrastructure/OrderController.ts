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

export class OrderController {
  constructor(
    private createOrderUseCase: CreateOrderUseCase,
    private getOrdersUseCase: GetOrdersUseCase,
    private orderRepository: IOrderRepository,
    private receiveOrderUseCase?: ReceiveOrderUseCase,
    private deliverOrderUseCase?: DeliverOrderUseCase,
    private deleteOrderUseCase?: DeleteOrderUseCase
  ) { }

  getAll = async (req: Request, res: Response) => {
    const filters = {
      status: req.query.status as string,
      clientId: req.query.clientId as string,
      brandId: req.query.brandId as string,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      search: req.query.search as string
    };

    const result = await this.getOrdersUseCase.execute(filters);

    if (result.isFailure) {
      return HttpResponse.fail(res, result.error!);
    }

    const orders = result.getValue().map(order => order.toJSON());
    return HttpResponse.ok(res, orders);
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
        initialPayment: {
          amount: Number(req.body.deposit || 0),
          method: req.body.payment_method,
          reference: req.body.transaction_reference || ''
        },
        creditAmount: Number(req.body.credit_to_use ?? req.body.creditToUse ?? 0)
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

      // 1. BUSINESS RULE: Delivered orders cannot be edited
      if (order.status === 'ENTREGADO') {
        return HttpResponse.badRequest(res, 'No se puede editar un pedido que ya ha sido entregado.');
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
        clientId: req.body.client_id,
        clientName: req.body.client_name,
        notes: req.body.notes,
        updatedAt: new Date(),
        version: { increment: 1 }
      };

      // Remove undefined fields
      Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

      const savedOrder = await prisma.order.update({
        where: { id },
        data: updateData,
        include: { items: true, payments: true }
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
        receivedByName: req.user!.username
      };

      const result = await this.receiveOrderUseCase.execute(id, dto, req.user!.username);

      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to receive order');
    }
  };

  batchReception = async (req: AuthRequest, res: Response) => {
    try {
      if (!this.receiveOrderUseCase) {
        return HttpResponse.fail(res, 'ReceiveOrderUseCase not initialized');
      }

      const { items } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return HttpResponse.badRequest(res, 'Items array is required and must not be empty');
      }

      // Procesar cada pedido secuencialmente
      const results = [];
      const errors = [];

      for (const item of items) {
        try {
          const dto = {
            finalTotal: Number(item.finalTotal || item.final_total),
            invoiceNumber: item.finalInvoiceNumber || item.final_invoice_number || item.invoiceNumber || item.invoice_number,
            abonoRecepcion: item.abonoRecepcion || item.abono_recepcion
              ? Number(item.abonoRecepcion || item.abono_recepcion)
              : undefined,
            bankAccountId: item.bankAccountId || item.bank_account_id,
            paymentMethod: item.paymentMethod || item.payment_method,
            reference: item.referenceNumber || item.reference_number || undefined,
            receivedByName: req.user!.username
          };

          const result = await this.receiveOrderUseCase.execute(
            item.orderId || item.order_id,
            dto,
            req.user!.username
          );

          results.push({
            orderId: item.orderId || item.order_id,
            success: true,
            data: result
          });
        } catch (error) {
          errors.push({
            orderId: item.orderId || item.order_id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Si todos fallaron, retornar error
      if (errors.length === items.length) {
        return HttpResponse.badRequest(res, `All ${items.length} orders failed to be received`);
      }

      // Retornar resultados (éxitos y errores)
      return HttpResponse.ok(res, {
        success: results,
        errors: errors.length > 0 ? errors : undefined,
        summary: {
          total: items.length,
          succeeded: results.length,
          failed: errors.length
        }
      });
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to batch receive orders');
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

      // Convert snake_case to camelCase
      const dto = {
        finalPayment: req.body.final_payment || req.body.finalPayment
          ? Number(req.body.final_payment || req.body.finalPayment)
          : undefined,
        bankAccountId: req.body.bank_account_id || req.body.bankAccountId,
        paymentMethod: req.body.payment_method || req.body.paymentMethod,
        reference: req.body.reference,
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
}
