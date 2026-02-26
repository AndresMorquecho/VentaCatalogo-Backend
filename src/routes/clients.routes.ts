import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, requirePermission('clients.view'), async (req, res, next) => {
  try {
    const search = req.query.search as string;
    const active = req.query.active;

    const where: any = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

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

router.get('/:id', authenticate, requirePermission('clients.view'), async (req: any, res, next) => {
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

    return res.json({ success: true, data: client });
  } catch (error) {
    next(error);
    return;
  }
});

router.post('/', authenticate, requirePermission('clients.create'), async (req: any, res, next) => {
  try {
    const clientData: any = {};
    if (req.body.identification_type) clientData.identificationType = req.body.identification_type;
    if (req.body.identification_number) clientData.identificationNumber = req.body.identification_number;
    if (req.body.first_name) clientData.firstName = req.body.first_name;
    if (req.body.country) clientData.country = req.body.country;
    if (req.body.province) clientData.province = req.body.province;
    if (req.body.city) clientData.city = req.body.city;
    if (req.body.address) clientData.address = req.body.address;
    if (req.body.neighborhood) clientData.neighborhood = req.body.neighborhood;
    if (req.body.sector) clientData.sector = req.body.sector;
    if (req.body.email) clientData.email = req.body.email;
    if (req.body.phone1) clientData.phone1 = req.body.phone1;
    if (req.body.operator1) clientData.operator1 = req.body.operator1;
    if (req.body.phone2) clientData.phone2 = req.body.phone2;
    if (req.body.operator2) clientData.operator2 = req.body.operator2;
    if (req.body.reference) clientData.reference = req.body.reference;
    if (req.body.is_active !== undefined) clientData.isActive = req.body.is_active;

    const client = await prisma.$transaction(async (tx) => {
      const newClient = await tx.client.create({ data: clientData });
      await tx.clientAccount.create({ data: { clientId: newClient.id } });
      return newClient;
    });

    res.status(201).json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requirePermission('clients.edit'), async (req: any, res, next) => {
  try {
    const data: any = {};
    if (req.body.identification_type !== undefined) data.identificationType = req.body.identification_type;
    if (req.body.identification_number !== undefined) data.identificationNumber = req.body.identification_number;
    if (req.body.first_name !== undefined) data.firstName = req.body.first_name;
    if (req.body.country !== undefined) data.country = req.body.country;
    if (req.body.province !== undefined) data.province = req.body.province;
    if (req.body.city !== undefined) data.city = req.body.city;
    if (req.body.address !== undefined) data.address = req.body.address;
    if (req.body.neighborhood !== undefined) data.neighborhood = req.body.neighborhood;
    if (req.body.sector !== undefined) data.sector = req.body.sector;
    if (req.body.email !== undefined) data.email = req.body.email;
    if (req.body.phone1 !== undefined) data.phone1 = req.body.phone1;
    if (req.body.operator1 !== undefined) data.operator1 = req.body.operator1;
    if (req.body.phone2 !== undefined) data.phone2 = req.body.phone2;
    if (req.body.operator2 !== undefined) data.operator2 = req.body.operator2;
    if (req.body.reference !== undefined) data.reference = req.body.reference;
    if (req.body.is_active !== undefined) data.isActive = req.body.is_active;
    data.updatedAt = new Date();

    const client = await prisma.client.update({
      where: { id: req.params.id },
      data
    });

    if (data.firstName) {
      await prisma.order.updateMany({
        where: { clientId: req.params.id },
        data: { clientName: data.firstName }
      });
      await prisma.financialRecord.updateMany({
        where: { clientId: req.params.id },
        data: { clientName: data.firstName }
      });
    }

    res.json({ success: true, data: client });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, requirePermission('clients.delete'), async (req: any, res, next) => {
  try {
    const { id } = req.params;

    // Check if client has orders
    const orderCount = await prisma.order.count({ where: { clientId: id } });
    if (orderCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFERENTIAL_INTEGRITY',
          message: 'No se puede eliminar la empresaria porque tiene pedidos asociados. Desactívela en su lugar.'
        }
      });
    }

    // Check if client has financial records
    const financialCount = await prisma.financialRecord.count({ where: { clientId: id } });
    if (financialCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFERENTIAL_INTEGRITY',
          message: 'No se puede eliminar la empresaria porque tiene historial financiero. Desactívela en su lugar.'
        }
      });
    }

    // Perform real deletion (ClientAccount will be orphan if not deleted, but schema has no cascade)
    // Actually ClientAccount has clientId unique and Client has clientAccount relation.
    await prisma.$transaction([
      prisma.clientAccount.deleteMany({ where: { clientId: id } }),
      prisma.client.delete({ where: { id } })
    ]);

    return res.json({ success: true, message: 'Empresaria eliminada permanentemente' });
  } catch (error) {
    next(error);
  }
});

export default router;
