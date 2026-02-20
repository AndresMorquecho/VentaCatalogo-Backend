import { Request, Response } from 'express';
import { CreateOrderUseCase } from '../application/CreateOrder.usecase';
import { GetOrdersUseCase } from '../application/GetOrders.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';

export class OrderController {
  constructor(
    private createOrderUseCase: CreateOrderUseCase,
    private getOrdersUseCase: GetOrdersUseCase
  ) {}

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

  create = async (req: AuthRequest, res: Response) => {
    const dto = {
      ...req.body,
      transactionDate: new Date(req.body.transactionDate),
      possibleDeliveryDate: new Date(req.body.possibleDeliveryDate)
    };

    const result = await this.createOrderUseCase.execute(dto, req.user!.email);

    if (result.isFailure) {
      return HttpResponse.badRequest(res, result.error!);
    }

    return HttpResponse.created(res, result.getValue().toJSON());
  };
}
