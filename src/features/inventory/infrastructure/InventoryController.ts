import { Request, Response } from 'express';
import { GetInventoryMovementsUseCase } from '../application/GetInventoryMovements.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

export class InventoryController {
    constructor(private getInventoryMovementsUseCase: GetInventoryMovementsUseCase) { }

    getMovements = async (req: Request, res: Response) => {
        const page = req.query.page ? parseInt(req.query.page as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

        const filters = {
            type: req.query.type as string | undefined,
            brandId: req.query.brandId as string | undefined,
            orderId: req.query.orderId as string | undefined,
            startDate: req.query.startDate as string | undefined,
            endDate: req.query.endDate as string | undefined,
            receiptNumber: req.query.receiptNumber as string | undefined,
            orderNumber: req.query.orderNumber as string | undefined,
            orderType: req.query.orderType as string | undefined,
            search: req.query.search as string | undefined,
            page,
            limit
        };

        const result = await this.getInventoryMovementsUseCase.execute(filters);

        if (result.isFailure) {
            return HttpResponse.fail(res, result.error!);
        }

        const { data, total, stats } = result.getValue();

        if (page && limit) {
            return res.json({
                success: true,
                data,
                stats,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
        }

        return HttpResponse.ok(res, data);
    };
}
