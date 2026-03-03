import { Request, Response } from 'express';
import { GetInventoryMovementsUseCase } from '../application/GetInventoryMovements.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

export class InventoryController {
    constructor(private getInventoryMovementsUseCase: GetInventoryMovementsUseCase) { }

    getMovements = async (req: Request, res: Response) => {
        const filters = {
            type: req.query.type as string | undefined,
            brandId: req.query.brandId as string | undefined,
            orderId: req.query.orderId as string | undefined
        };

        const result = await this.getInventoryMovementsUseCase.execute(filters);

        if (result.isFailure) {
            return HttpResponse.fail(res, result.error!);
        }

        return HttpResponse.ok(res, result.getValue());
    };
}
