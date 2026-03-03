import { Response, NextFunction } from 'express';
import { AuthRequest } from '../../../middleware/auth';
import { GetCashClosuresUseCase } from '../application/GetCashClosures.usecase';
import { CreateCashClosureUseCase } from '../application/CreateCashClosure.usecase';
import { GetCashClosurePreviewUseCase } from '../application/GetCashClosurePreview.usecase';
import { ICashClosureRepository } from '../domain/ICashClosureRepository';

export class CashClosureController {
    constructor(
        private getCashClosuresUseCase: GetCashClosuresUseCase,
        private createCashClosureUseCase: CreateCashClosureUseCase,
        private getCashClosurePreviewUseCase: GetCashClosurePreviewUseCase,
        private cashClosureRepository: ICashClosureRepository
    ) { }

    async getAll(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { startDate, endDate } = req.query;
            const filters = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
            };
            const closures = await this.getCashClosuresUseCase.execute(filters);
            return res.json({ success: true, data: closures });
        } catch (error) {
            return next(error);
        }
    }

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const closure = await this.cashClosureRepository.findById(req.params.id);
            if (!closure) {
                return res.status(404).json({ success: false, error: { message: 'Cierre de caja no encontrado' } });
            }
            return res.json({ success: true, data: closure });
        } catch (error) {
            return next(error);
        }
    }

    async getPreview(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const toDate = req.query.toDate ? new Date(req.query.toDate as string) : new Date();
            const result = await this.getCashClosurePreviewUseCase.execute(toDate);

            if (result.isFailure) {
                return res.status(400).json({ success: false, error: { message: result.error } });
            }

            return res.json({ success: true, data: result.getValue() });
        } catch (error) {
            return next(error);
        }
    }

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const { to_date, toDate, actual_amount, actualAmount, notes } = req.body;

            const dto = {
                toDate: toDate || to_date,
                actualAmount: actualAmount !== undefined ? actualAmount : actual_amount,
                notes
            };

            const result = await this.createCashClosureUseCase.execute(
                dto,
                req.user!.username
            );

            if (result.isFailure) {
                return res.status(400).json({ success: false, error: { message: result.error } });
            }

            return res.status(201).json({ success: true, data: result.getValue() });
        } catch (error) {
            return next(error);
        }
    }

    async delete(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const userRole = req.user?.role?.toUpperCase() || '';
            if (userRole !== 'ADMIN' && userRole !== 'ADMINISTRADOR') {
                return res.status(403).json({ success: false, error: { message: 'Solo los administradores pueden borrar cierres de caja.' } });
            }

            await this.cashClosureRepository.delete(req.params.id);
            return res.json({ success: true, message: 'Cierre de caja eliminado correctamente' });
        } catch (error) {
            return next(error);
        }
    }
}
