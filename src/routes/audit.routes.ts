
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

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit as string) || 100));
        const skip = (page - 1) * limit;

        const where: any = {};
        if (req.query.userName) where.userName = req.query.userName;
        if (req.query.module) where.module = req.query.module;
        if (req.query.severity) where.severity = req.query.severity;

        if (req.query.startDate || req.query.endDate) {
            where.timestamp = {};
            if (req.query.startDate) where.timestamp.gte = new Date(req.query.startDate as string);
            if (req.query.endDate) {
                const to = new Date(req.query.endDate as string);
                to.setHours(23, 59, 59, 999);
                where.timestamp.lte = to;
            }
        }

        if (req.query.search) {
            const search = req.query.search as string;
            where.OR = [
                { detail: { contains: search, mode: 'insensitive' } },
                { action: { contains: search, mode: 'insensitive' } },
                { userName: { contains: search, mode: 'insensitive' } }
            ];
        }

        const [logs, total] = await Promise.all([
            (prisma as any).auditLog.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip,
                take: limit
            }),
            (prisma as any).auditLog.count({ where })
        ]);

        res.json({
            success: true,
            data: logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
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
