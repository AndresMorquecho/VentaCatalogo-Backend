import { Request, Response } from 'express';
import { GetCallsUseCase } from '../application/GetCalls.usecase';
import { CreateCallUseCase } from '../application/CreateCall.usecase';
import { UpdateCallUseCase } from '../application/UpdateCall.usecase';
import { DeleteCallUseCase } from '../application/DeleteCall.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';
import { AuthRequest } from '../../../middleware/auth';

export class CallController {
    constructor(
        private getCallsUseCase: GetCallsUseCase,
        private createCallUseCase: CreateCallUseCase,
        private updateCallUseCase: UpdateCallUseCase,
        private deleteCallUseCase: DeleteCallUseCase
    ) { }

    getAll = async (req: Request, res: Response) => {
        const filters = {
            clientId: req.query.client_id as string || req.query.clientId as string,
            orderId: req.query.order_id as string || req.query.orderId as string,
            reason: req.query.reason as string,
            result: req.query.result as string,
            startDate: req.query.start_date ? new Date(req.query.start_date as string) : (req.query.startDate ? new Date(req.query.startDate as string) : undefined),
            endDate: req.query.end_date ? new Date(req.query.end_date as string) : (req.query.endDate ? new Date(req.query.endDate as string) : undefined),
            search: req.query.search as string,
            page: parseInt(req.query.page as string) || 1,
            limit: parseInt(req.query.limit as string) || 50
        };

        const result = await this.getCallsUseCase.execute(filters);

        if (result.isFailure) {
            return HttpResponse.fail(res, result.error!);
        }

        const { data, ...pagination } = result.getValue();

        return res.json({
            success: true,
            data,
            pagination
        });
    };

    create = async (req: AuthRequest, res: Response) => {
        try {
            const dto = {
                clientId: req.body.client_id || req.body.clientId,
                orderId: req.body.order_id || req.body.orderId,
                reason: req.body.reason,
                result: req.body.result,
                notes: req.body.notes,
                followUpDate: req.body.follow_up_date ? new Date(req.body.follow_up_date) : (req.body.followUpDate ? new Date(req.body.followUpDate) : undefined),
            };

            const result = await this.createCallUseCase.execute(dto, req.user!.username);

            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error!);
            }

            return HttpResponse.created(res, result.getValue().toJSON());
        } catch (error) {
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error al crear la llamada');
        }
    };

    update = async (req: AuthRequest, res: Response) => {
        try {
            const { id } = req.params;
            const dto = {
                clientId: req.body.client_id || req.body.clientId,
                orderId: req.body.order_id || req.body.orderId,
                reason: req.body.reason,
                result: req.body.result,
                notes: req.body.notes,
                followUpDate: req.body.follow_up_date ? new Date(req.body.follow_up_date) : (req.body.followUpDate ? new Date(req.body.followUpDate) : undefined),
            };

            const result = await this.updateCallUseCase.execute(id, dto, req.user!.username);

            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error!);
            }

            return HttpResponse.ok(res, result.getValue().toJSON());
        } catch (error) {
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error al actualizar la llamada');
        }
    };

    delete = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const result = await this.deleteCallUseCase.execute(id);

            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error!);
            }

            return HttpResponse.ok(res, { message: 'Llamada eliminada correctamente' });
        } catch (error) {
            return HttpResponse.fail(res, error instanceof Error ? error.message : 'Error al eliminar la llamada');
        }
    };
}
