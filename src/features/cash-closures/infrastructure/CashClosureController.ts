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
            const page = Math.max(1, parseInt(req.query.page as string) || 1);
            const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
            const skip = (page - 1) * limit;

            const filters = {
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
            };
            const { data, total } = await this.getCashClosuresUseCase.execute(filters, { skip, take: limit });

            return res.json({
                success: true,
                data,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            });
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
            const userId = req.query.userId as string | undefined;
            const fromDate = req.query.fromDate ? new Date(req.query.fromDate as string) : undefined;

            // Security check: Only users with 'cash_closure.view_all' can see other users or 'all'
            const userRole = req.user?.role?.toUpperCase() || '';
            const isAdmin = userRole === 'ADMIN' || userRole === 'ADMINISTRADOR';
            const canViewAll = isAdmin || req.user?.permissions?.includes('cash_closure.view_all');
            
            if (!canViewAll) {
                // If not admin/authorized, they can only see their own data
                if (userId && userId !== req.user?.id) {
                    return res.status(403).json({ success: false, error: { message: 'No tienes permiso para ver el cierre de otros usuarios.' } });
                }
            }

            const targetUserId = canViewAll ? userId : (userId || req.user?.id);
            const result = await this.getCashClosurePreviewUseCase.execute(toDate, targetUserId, fromDate);

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
