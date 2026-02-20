import { Router } from 'express';
import { prisma } from '../../../lib/prisma';
import { PrismaFinancialRecordRepository } from './PrismaFinancialRecordRepository';
import { authenticate, AuthRequest } from '../../../middleware/auth';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

const router = Router();
const financialRepository = new PrismaFinancialRecordRepository();

// Get all financial movements
router.get('/', authenticate, async (req, res, next) => {
  try {
    const filters: any = {};
    
    if (req.query.type) filters.movementType = req.query.type;
    if (req.query.source) filters.source = req.query.source;
    if (req.query.bankAccountId) filters.bankAccountId = req.query.bankAccountId;
    if (req.query.clientId) filters.clientId = req.query.clientId;
    if (req.query.startDate || req.query.endDate) {
      filters.date = {};
      if (req.query.startDate) filters.date.gte = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.date.lte = new Date(req.query.endDate as string);
    }

    const records = await financialRepository.findAll(filters);
    const data = records.map(r => r.toJSON());
    
    return HttpResponse.ok(res, data);
  } catch (error) {
    next(error);
  }
});

// Create manual financial movement
router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    // This will be implemented as a use case later
    return HttpResponse.created(res, { message: 'Manual movements to be implemented' });
  } catch (error) {
    next(error);
  }
});

export default router;
