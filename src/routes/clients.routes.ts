import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// Temporary implementation until Clients feature is migrated to hexagonal architecture
router.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const search = req.query.search as string;
    const active = req.query.active;
    
    const where: any = {};
    // Only filter by isActive if explicitly provided
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    // If active is undefined, don't filter by isActive (show all)
    
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { identificationNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`GET /api/clients - Found ${clients.length} clients`);
    res.json({ success: true, data: clients });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        clientAccount: {
          include: {
            credits: { where: { status: 'AVAILABLE' } }
          }
        }
      }
    });
    
    if (!client) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'NOT_FOUND', message: 'Client not found' }
      });
    }
    
    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const client = await prisma.$transaction(async (tx) => {
      const newClient = await tx.client.create({ data: req.body });
      await tx.clientAccount.create({ data: { clientId: newClient.id } });
      return newClient;
    });
    
    res.status(201).json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: { ...req.body, updatedAt: new Date() }
    });
    
    // Sync client name if changed
    if (req.body.firstName) {
      await prisma.order.updateMany({
        where: { clientId: req.params.id },
        data: { clientName: req.body.firstName }
      });
      await prisma.financialRecord.updateMany({
        where: { clientId: req.params.id },
        data: { clientName: req.body.firstName }
      });
    }
    
    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

export default router;
