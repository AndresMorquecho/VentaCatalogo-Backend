
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── GET audit logs (Admin only) ──────────────────────────────────────────────
router.get('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (req.user?.role?.toUpperCase() !== 'ADMIN') {
            res.status(403).json({ success: false, message: 'Forbidden: Admin access required' });
            return;
        }

        const logs = await (prisma as any).auditLog.findMany({
            orderBy: { timestamp: 'desc' },
            take: 1000
        });

        res.json({ success: true, data: logs });
    } catch (error) {
        next(error);
    }
});

// ─── POST audit log (authenticated users only, userId/userName taken from JWT) ──
// The client CANNOT forge userId/userName — they are always taken from the validated JWT.
// Only action, module, detail are accepted from the client body.
router.post('/', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { action, module, detail, severity, success } = req.body;

        // Reject if required fields are missing
        if (!action || !module || !detail) {
            res.status(400).json({ success: false, message: 'action, module and detail are required' });
            return;
        }

        // userId and userName are ALWAYS taken from the validated JWT — never from the request body
        const log = await (prisma as any).auditLog.create({
            data: {
                userId: req.user!.id,            // from JWT — cannot be forged
                userName: req.user!.username,    // from JWT — cannot be forged
                action,
                module,
                detail,
                severity: severity || 'INFO',
                success: success !== undefined ? success : true,
                timestamp: new Date()
            }
        });

        res.status(201).json({ success: true, data: log });
    } catch (error) {
        next(error);
    }
});

export default router;
