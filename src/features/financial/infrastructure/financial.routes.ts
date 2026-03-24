import { Router, Request, Response, NextFunction } from 'express';
import { PrismaFinancialRecordRepository } from './PrismaFinancialRecordRepository';
import { FinancialRecord } from '../domain/FinancialRecord.entity';
import { authenticate } from '../../../middleware/auth';
import { HttpResponse } from '../../../shared/infrastructure/http/HttpResponse';

const router = Router();
const repository = new PrismaFinancialRecordRepository();

// GET /api/financial-records - Get all with optional filters
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientId, orderId, bankAccountId, startDate, endDate, type, movementType, referenceNumber, accountType, createdBy } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const skip = (page - 1) * limit;

    const filters: any = {};
    if (clientId) filters.clientId = clientId as string;
    if (orderId) filters.orderId = orderId as string;
    if (bankAccountId) filters.bankAccountId = bankAccountId as string;
    if (type) filters.type = type as string;
    if (movementType) filters.movementType = movementType as string;
    if (referenceNumber) filters.referenceNumber = referenceNumber as string;
    if (accountType) filters.accountType = accountType as string;
    if (createdBy) filters.createdBy = createdBy as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const { data: records, total } = await repository.findAll(filters, { skip, take: limit });
    return res.json({
      success: true,
      data: records,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
    return;
  }
});

// GET /api/financial-records/:id - Get by ID
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const record = await repository.findById(id);

    if (!record) {
      return res.status(404).json({ error: 'Financial record not found' });
    }

    return res.json(record.toJSON());
  } catch (error) {
    next(error);
    return;
  }
});

// POST /api/financial-records - Create new record
router.post('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      type,
      source,
      movementType,
      referenceNumber,
      amount,
      date,
      clientId,
      clientName,
      orderId,
      createdBy,
      notes,
      bankAccountId,
      paymentMethod
    } = req.body;

    // Validate required fields
    if (!type || !source || !movementType || !amount || !date || !clientId || !clientName || !createdBy || !bankAccountId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate reference number if not provided
    const finalReferenceNumber = referenceNumber || await repository.generateReferenceNumber();

    const record = FinancialRecord.create({
      type,
      source,
      movementType,
      referenceNumber: finalReferenceNumber,
      amount: Number(amount),
      date: new Date(date),
      clientId,
      clientName,
      orderId,
      createdBy,
      notes,
      bankAccountId,
      paymentMethod,
      createdAt: new Date(),
      version: 1
    });

    const saved = await repository.save(record);
    return res.status(201).json(saved.toJSON());
  } catch (error) {
    next(error);
    return;
  }
});

// PUT /api/financial-records/:id - Update record
router.put('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { amount, notes, date } = req.body;

    const record = await repository.findById(id);
    if (!record) {
      return res.status(404).json({ error: 'Financial record not found' });
    }

    if (amount !== undefined) record.updateAmount(Number(amount));
    if (notes !== undefined) record.updateNotes(notes);
    if (date !== undefined) record.updateDate(new Date(date));

    const updated = await repository.update(record);
    return res.json(updated.toJSON());
  } catch (error) {
    next(error);
    return;
  }
});

// DELETE /api/financial-records/:id - Delete record
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const record = await repository.findById(id);
    if (!record) {
      return res.status(404).json({ error: 'Financial record not found' });
    }

    await repository.delete(id);
    return res.status(204).send();
  } catch (error) {
    next(error);
    return;
  }
});

export default router;
