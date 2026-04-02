import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, requirePermission('clients.view'), async (req, res, next) => {
  try {
    const search = req.query.search as string;
    const active = req.query.active; // true/false (DB field)
    const status = req.query.status as string; // ACTIVE/INACTIVE/NEW (Business logic: last 30 days order)
    const city = req.query.city as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const excludeCalledToday = req.query.excludeCalledToday === 'true';
    const callReason = req.query.callReason as string;
    const withPendingPayments = req.query.withPendingPayments === 'true';
    
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit as string) || 200));
    const skip = (page - 1) * limit;

    const where: any = {};
    
    // DB Native Active status
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

    // Business Activity Status
    if (status === 'ACTIVE') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.lastOrderDate = { gte: thirtyDaysAgo };
    } else if (status === 'INACTIVE') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.lastOrderDate = { lt: thirtyDaysAgo };
    } else if (status === 'NEW') {
      where.lastOrderDate = { equals: null };
    }

    // Exclude clients called today with specific reason
    if (excludeCalledToday && callReason) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Get clients that have been called today with this reason
      const calledToday = await prisma.call.findMany({
        where: {
          reason: callReason,
          createdAt: {
            gte: today,
            lt: tomorrow
          }
        },
        select: { clientId: true },
        distinct: ['clientId']
      });

      const calledClientIds = calledToday.map(c => c.clientId);
      
      if (calledClientIds.length > 0) {
        where.id = { notIn: calledClientIds };
      }
    }

    // Filter clients with pending payments
    if (withPendingPayments) {
      // Get all orders with pending balance
      const ordersWithDebt = await prisma.order.findMany({
        where: {
          status: { in: ['POR_RECIBIR', 'RECIBIDO_EN_BODEGA', 'ENTREGADO'] }
        },
        select: {
          id: true,
          clientId: true,
          total: true,
          payments: {
            select: { amount: true }
          }
        }
      });

      // Calculate which clients have pending payments
      const clientsWithDebt = new Set<string>();
      ordersWithDebt.forEach(order => {
        const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const pending = Number(order.total) - totalPaid;
        if (pending > 0.01) { // Consider debt if more than 1 cent pending
          clientsWithDebt.add(order.clientId);
        }
      });

      if (clientsWithDebt.size > 0) {
        where.id = where.id 
          ? { ...where.id, in: Array.from(clientsWithDebt) }
          : { in: Array.from(clientsWithDebt) };
      } else {
        // No clients with debt, return empty
        return res.json({ success: true, data: [], pagination: { page, limit, total: 0, pages: 0 } });
      }
    }

    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }

    // Registration Date range
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (search) {
      const searchCondition = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { identificationNumber: { contains: search, mode: 'insensitive' } }
        ]
      };
      
      // Merge search with existing where clauses
      if (Object.keys(where).length > 0) {
        where.AND = [searchCondition];
      } else {
        Object.assign(where, searchCondition);
      }
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.client.count({ where })
    ]);

    // If withPendingPayments, enrich with debt details
    if (withPendingPayments) {
      const enrichedClients = await Promise.all(clients.map(async (client) => {
        const orders = await prisma.order.findMany({
          where: {
            clientId: client.id,
            status: { in: ['POR_RECIBIR', 'RECIBIDO_EN_BODEGA', 'ENTREGADO'] }
          },
          select: {
            id: true,
            receiptNumber: true,
            total: true,
            transactionDate: true,
            brand: { select: { name: true } },
            payments: { select: { amount: true } }
          },
          orderBy: { transactionDate: 'desc' }
        });

        const debts = orders.map(order => {
          const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.amount), 0);
          const pending = Number(order.total) - totalPaid;
          return {
            orderId: order.id,
            receiptNumber: order.receiptNumber,
            brandName: order.brand.name,
            total: Number(order.total),
            paid: totalPaid,
            pending: pending,
            transactionDate: order.transactionDate
          };
        }).filter(d => d.pending > 0.01);

        const totalDebt = debts.reduce((sum, d) => sum + d.pending, 0);

        return {
          ...client,
          totalDebt,
          debts
        };
      }));

      return res.json({ success: true, data: enrichedClients, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    }

    return res.json({ success: true, data: clients, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
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
    if (req.body.identificationType) clientData.identificationType = req.body.identificationType;
    if (req.body.identificationNumber) clientData.identificationNumber = req.body.identificationNumber;
    if (req.body.firstName) clientData.firstName = req.body.firstName;
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
    if (req.body.isActive !== undefined) clientData.isActive = req.body.isActive;

    // Nuevos campos FASE 1 & 2
    if (req.body.birthDate) clientData.birthDate = new Date(req.body.birthDate);
    if (req.body.identificationIssuanceDate) clientData.identificationIssuanceDate = new Date(req.body.identificationIssuanceDate);
    if (req.body.isWhatsApp !== undefined) clientData.isWhatsApp = req.body.isWhatsApp;
    if (req.body.referredById) clientData.referredById = req.body.referredById;
    if (req.body.isBlocked !== undefined) clientData.isBlocked = req.body.isBlocked;
    clientData.createdByName = (req as any).user?.username || 'Administrador';
    clientData.lastDataUpdate = new Date();

    // 🔴 REGLA: Todos los campos de texto a MAYÚSCULAS (excepto email)
    Object.keys(clientData).forEach(key => {
        if (typeof clientData[key] === 'string' && key !== 'email') {
            clientData[key] = clientData[key].toUpperCase();
        }
    });

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
    if (req.body.identificationType !== undefined) data.identificationType = req.body.identificationType;
    if (req.body.identificationNumber !== undefined) data.identificationNumber = req.body.identificationNumber;
    if (req.body.firstName !== undefined) data.firstName = req.body.firstName;
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
    if (req.body.isActive !== undefined) data.isActive = req.body.isActive;

    // Nuevos campos FASE 1 & 2
    if (req.body.birthDate !== undefined) data.birthDate = req.body.birthDate ? new Date(req.body.birthDate) : null;
    if (req.body.identificationIssuanceDate !== undefined) data.identificationIssuanceDate = req.body.identificationIssuanceDate ? new Date(req.body.identificationIssuanceDate) : null;
    if (req.body.isWhatsApp !== undefined) data.isWhatsApp = req.body.isWhatsApp;
    if (req.body.referredById !== undefined) data.referredById = req.body.referredById;
    if (req.body.isBlocked !== undefined) data.isBlocked = req.body.isBlocked;

    // 🔴 REGLA: Todos los campos de texto editados a MAYÚSCULAS (excepto email)
    Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string' && key !== 'email') {
            data[key] = data[key].toUpperCase();
        }
    });


    // Siempre que se edite, actualizamos la fecha de última actualización de datos
    data.lastDataUpdate = new Date();
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

    return res.json({ success: true, data: client });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', authenticate, requirePermission('clients.delete'), async (req: any, res) => {
  try {
    const { id } = req.params;

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id } });
    if (!client) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Empresaria no encontrada' }
      });
    }

    // Block deletion if client has orders (business rule)
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

    // Block deletion if client has financial records (business rule)
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

    // Block deletion if client has inventory movements (business rule)
    const inventoryCount = await prisma.inventoryMovement.count({ where: { clientId: id } });
    if (inventoryCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFERENTIAL_INTEGRITY',
          message: 'No se puede eliminar la empresaria porque tiene movimientos de inventario. Desactívela en su lugar.'
        }
      });
    }

    // Block deletion if client has order receipts (documentos contables)
    const receiptCount = await prisma.orderReceipt.count({ where: { clientId: id } });
    if (receiptCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFERENTIAL_INTEGRITY',
          message: `No se puede eliminar la empresaria porque tiene ${receiptCount} recibo(s) de pago registrado(s). Desactívela en su lugar.`
        }
      });
    }

    // Block deletion if client has wallet recharges
    const rechargeCount = await prisma.walletRecharge.count({ where: { clientId: id } });
    if (rechargeCount > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REFERENTIAL_INTEGRITY',
          message: 'No se puede eliminar la empresaria porque tiene recargas de billetera registradas. Desactívela en su lugar.'
        }
      });
    }

    // Solo se puede eliminar si no tiene ningún dato transaccional.
    // En este punto solo quedan: calls, rewardApplications, clientCredits, clientAccount
    await prisma.$transaction(async (tx) => {
      // 1. Eliminar llamadas del cliente (no son documentos contables)
      await tx.call.deleteMany({ where: { clientId: id } });
      // 2. Eliminar aplicaciones de recompensas
      await tx.rewardApplication.deleteMany({
        where: { clientAccount: { clientId: id } }
      });
      // 3. Eliminar créditos del cliente
      await tx.clientCredit.deleteMany({ where: { clientAccount: { clientId: id } } });
      // 4. Eliminar cuenta del cliente
      await tx.clientAccount.deleteMany({ where: { clientId: id } });
      // 5. Finalmente eliminar el cliente
      await tx.client.delete({ where: { id } });
    });

    return res.json({ success: true, message: 'Empresaria eliminada permanentemente' });
  } catch (error: any) {
    console.error('[DELETE CLIENT]', error);

    // Detectar errores de FK de Prisma (P2003) o mensajes con "Foreign key"
    const isFKError = error?.code === 'P2003' ||
                      error?.message?.includes('Foreign key') ||
                      error?.message?.includes('foreign key') ||
                      error?.message?.includes('constraint');

    // Mapear la FK específica a un mensaje legible
    let message = 'No se pudo eliminar la empresaria. Intente de nuevo.';
    if (isFKError) {
      const meta = error?.meta?.field_name || error?.message || '';
      if (meta.includes('order_receipts')) {
        message = 'La empresaria tiene recibos de pago registrados. Desactívela en lugar de eliminarla.';
      } else if (meta.includes('orders') || meta.includes('order')) {
        message = 'La empresaria tiene pedidos asociados. Desactívela en lugar de eliminarla.';
      } else if (meta.includes('financial')) {
        message = 'La empresaria tiene historial financiero. Desactívela en lugar de eliminarla.';
      } else if (meta.includes('inventory')) {
        message = 'La empresaria tiene movimientos de inventario. Desactívela en lugar de eliminarla.';
      } else {
        message = 'La empresaria tiene datos relacionados y no puede eliminarse. Desactívela en su lugar.';
      }
    }

    return res.status(400).json({ success: false, error: { code: 'REFERENTIAL_INTEGRITY', message } });
  }
});

export default router;
