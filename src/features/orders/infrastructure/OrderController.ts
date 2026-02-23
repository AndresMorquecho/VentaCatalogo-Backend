import { Request, Response } from 'express';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { ReceiveOrderUseCase } from '../application/ReceiveOrder.usecase';
import { DeliverOrderUseCase } from '../application/DeliverOrder.usecase';
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
    private deliverOrderUseCase?: DeliverOrderUseCase
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
        initialPayment: {
          amount: Number(req.body.deposit || 0),
          method: req.body.payment_method,
          reference: req.body.transaction_reference || ''
        }
      };

      const result = await this.createOrderUseCase.execute(dto, req.user!.email);

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

      // Find existing order
      const existingOrder = await this.orderRepository.findById(id);
      if (!existingOrder) {
        return HttpResponse.notFound(res, 'Order not found');
      }

      // Ensure brandId is available for items
      const orderBrandId = req.body.brand_id;

      if (!orderBrandId) {
        return HttpResponse.badRequest(res, 'Brand ID is required');
      }

      // Get existing order data
      const existingData = existingOrder.toJSON();

      // Convert snake_case to camelCase and merge with existing data
      const updatedProps = {
        receiptNumber: req.body.receipt_number || existingData.receiptNumber,
        salesChannel: req.body.sales_channel || existingData.salesChannel,
        type: req.body.type || existingData.type,
        brandId: orderBrandId,
        brandName: req.body.brand_name || existingData.brandName,
        total: req.body.total !== undefined ? Number(req.body.total) : existingData.total,
        realInvoiceTotal: existingData.realInvoiceTotal,
        paymentMethod: req.body.payment_method || existingData.paymentMethod,
        bankAccountId: req.body.bank_account_id || existingData.bankAccountId,
        transactionDate: req.body.transaction_date ? new Date(req.body.transaction_date) : existingData.transactionDate,
        possibleDeliveryDate: req.body.possible_delivery_date ? new Date(req.body.possible_delivery_date) : existingData.possibleDeliveryDate,
        receptionDate: existingData.receptionDate,
        deliveryDate: existingData.deliveryDate,
        invoiceNumber: existingData.invoiceNumber,
        status: req.body.status || existingData.status,
        clientId: req.body.client_id || existingData.clientId,
        clientName: req.body.client_name || existingData.clientName,
        notes: req.body.notes !== undefined ? req.body.notes : existingData.notes,
        items: existingData.items, // Keep existing items for now
        payments: existingData.payments, // Keep existing payments
        createdAt: existingData.createdAt,
        updatedAt: new Date(),
        version: existingData.version + 1
      };

      // Create updated order entity
      const updatedOrder = Order.create(updatedProps, id);

      // Save to repository
      const savedOrder = await this.orderRepository.update(updatedOrder);

      return HttpResponse.ok(res, savedOrder.toJSON());
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to update order');
    }
  };

  deleteOrder = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Find existing order
      const existingOrder = await this.orderRepository.findById(id);
      if (!existingOrder) {
        return HttpResponse.notFound(res, 'Order not found');
      }

      // Soft delete (mark as CANCELADO)
      await this.orderRepository.delete(id);

      return HttpResponse.ok(res, { message: 'Order deleted successfully' });
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
        reference: req.body.reference || req.body.transaction_reference || undefined
      };

      const result = await this.receiveOrderUseCase.execute(id, dto, req.user!.email);

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
            reference: item.referenceNumber || item.reference_number || undefined
          };

          const result = await this.receiveOrderUseCase.execute(
            item.orderId || item.order_id,
            dto,
            req.user!.email
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
            paymentMethod: undefined
          };

          const result = await this.receiveOrderUseCase.execute(
            orderId,
            dto,
            req.user!.email
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
        notes: req.body.notes
      };

      const result = await this.deliverOrderUseCase.execute(id, dto, req.user!.email);

      return HttpResponse.ok(res, result);
    } catch (error) {
      return HttpResponse.fail(res, error instanceof Error ? error.message : 'Failed to deliver order');
    }
  };
}
