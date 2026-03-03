import { Request, Response } from 'express';
import { GetDashboardSummaryUseCase } from '../application/GetDashboardSummary.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

export class DashboardController {
    constructor(private getDashboardSummaryUseCase: GetDashboardSummaryUseCase) { }

    getSummary = async (req: Request, res: Response) => {
        const result = await this.getDashboardSummaryUseCase.execute();

        if (result.isFailure) {
            return HttpResponse.fail(res, result.error!);
        }

        return HttpResponse.ok(res, result.getValue());
    };
}
