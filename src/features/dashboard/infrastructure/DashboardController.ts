import { Request, Response } from 'express';
import { GetDashboardSummaryUseCase } from '../application/GetDashboardSummary.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

export class DashboardController {
    constructor(private getDashboardSummaryUseCase: GetDashboardSummaryUseCase) { }

    getSummary = async (req: Request, res: Response) => {
        const { brandId, dateFrom, dateTo } = req.query as Record<string, string>;

        const result = await this.getDashboardSummaryUseCase.execute({
            brandId: brandId || undefined,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo + 'T23:59:59') : undefined,
        });

        if (result.isFailure) {
            return HttpResponse.fail(res, result.error!);
        }

        return HttpResponse.ok(res, result.getValue());
    };
}
