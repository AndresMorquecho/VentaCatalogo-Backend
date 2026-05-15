import { Request, Response } from 'express';
import { GetDashboardSummaryUseCase } from '../application/GetDashboardSummary.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

export class DashboardController {
    constructor(private getDashboardSummaryUseCase: GetDashboardSummaryUseCase) { }

    getSummary = async (req: Request, res: Response) => {
        const { brandId, brandIds, dateFrom, dateTo } = req.query as Record<string, string>;

        // Support both single brandId (legacy) and multiple brandIds (comma-separated)
        let brandIdArray: string[] | undefined;
        if (brandIds) {
            brandIdArray = brandIds.split(',').filter(id => id.trim().length > 0);
        } else if (brandId) {
            brandIdArray = [brandId];
        }

        const result = await this.getDashboardSummaryUseCase.execute({
            brandIds: brandIdArray && brandIdArray.length > 0 ? brandIdArray : undefined,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo + 'T23:59:59') : undefined,
        });

        if (result.isFailure) {
            return HttpResponse.fail(res, result.error!);
        }

        return HttpResponse.ok(res, result.getValue());
    };
}
