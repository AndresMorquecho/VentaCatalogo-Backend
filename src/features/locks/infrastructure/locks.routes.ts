import { Router } from 'express';
import { authenticate } from '../../../middleware/auth';
import { LockController } from './LockController';
import { AcquireLockUseCase } from '../application/AcquireLock.usecase';
import { ReleaseLockUseCase } from '../application/ReleaseLock.usecase';
import { HeartbeatLockUseCase } from '../application/HeartbeatLock.usecase';

const router = Router();

const acquireUseCase = new AcquireLockUseCase();
const releaseUseCase = new ReleaseLockUseCase();
const heartbeatUseCase = new HeartbeatLockUseCase();

const controller = new LockController(
    acquireUseCase,
    releaseUseCase,
    heartbeatUseCase
);

// Todas estas rutas son protegidas
router.post('/acquire', authenticate, (req, res, next) => controller.acquire(req, res, next));
router.post('/release', authenticate, (req, res, next) => controller.release(req, res, next));
router.post('/heartbeat', authenticate, (req, res, next) => controller.heartbeat(req, res, next));

export default router;
