import { Request, Response, NextFunction } from 'express';
import { AcquireLockUseCase } from '../application/AcquireLock.usecase';
import { ReleaseLockUseCase } from '../application/ReleaseLock.usecase';
import { HeartbeatLockUseCase } from '../application/HeartbeatLock.usecase';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

export class LockController {
    constructor(
        private acquireUseCase: AcquireLockUseCase,
        private releaseUseCase: ReleaseLockUseCase,
        private heartbeatUseCase: HeartbeatLockUseCase
    ) {}

    async acquire(req: Request, res: Response, next: NextFunction) {
        try {
            const { resourceId, resourceType } = req.body;
            const user = (req as any).user;
            if (!user) return HttpResponse.unauthorized(res);

            const result = await this.acquireUseCase.execute({
                resourceId,
                resourceType,
                userId: user.id,
                userName: user.username
            });

            if (result.isFailure) {
                return HttpResponse.conflict(res, result.error!);
            }

            return HttpResponse.ok(res, result.getValue());
        } catch (error) {
            next(error);
        }
    }

    async release(req: Request, res: Response, next: NextFunction) {
        try {
            const { resourceId, resourceType } = req.body;
            const user = (req as any).user;
            if (!user) return HttpResponse.unauthorized(res);

            const result = await this.releaseUseCase.execute({
                resourceId,
                resourceType,
                userId: user.id
            });

            if (result.isFailure) {
                return HttpResponse.badRequest(res, result.error!);
            }
            return HttpResponse.ok(res, { message: 'Bloqueo liberado' });
        } catch (error) {
            next(error);
        }
    }

    async heartbeat(req: Request, res: Response, next: NextFunction) {
        try {
            const { resourceId, resourceType } = req.body;
            const user = (req as any).user;
            if (!user) return HttpResponse.unauthorized(res);

            const result = await this.heartbeatUseCase.execute({
                resourceId,
                resourceType,
                userId: user.id
            });

            if (result.isFailure) {
                return HttpResponse.conflict(res, result.error!);
            }
            return HttpResponse.ok(res, { message: 'Heartbeat exitoso' });
        } catch (error) {
            next(error);
        }
    }
}
