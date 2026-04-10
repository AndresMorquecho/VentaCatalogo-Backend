import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/:id', authenticate, requirePermission(['bank_accounts.view', 'orders.view', 'orders.create', 'orders.edit', 'payments.create', 'wallet.manage']), async (req, res, next) => {
  try {
    const { id } = req.params;
    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) return res.status(404).json({ success: false, error: { message: 'Cuenta no encontrada' } });
    return res.json({ success: true, data: { ...account, currentBalance: Number(account.currentBalance) } });
  } catch (error) {
    return next(error);
  }
});

router.get('/', authenticate, requirePermission(['bank_accounts.view', 'orders.create', 'orders.edit', 'payments.create', 'wallet.manage']), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 500));
    const skip = (page - 1) * limit;
    const { startDate, endDate } = req.query;

    const where = { isActive: true };

    const [accounts, total] = await Promise.all([
      prisma.bankAccount.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limit
      }),
      prisma.bankAccount.count({ where })
    ]);

    let formattedAccounts: any[] = accounts.map(acc => ({
      ...acc,
      currentBalance: Number(acc.currentBalance)
    }));

    if (startDate && endDate) {
      const parsedStart = new Date(startDate as string);
      const parsedEnd = new Date(endDate as string);
      parsedEnd.setHours(23, 59, 59, 999);

      const summaries = await prisma.financialRecord.groupBy({
        by: ['bankAccountId', 'movementType'],
        where: {
          date: {
            gte: parsedStart,
            lte: parsedEnd
          }
        },
        _sum: {
          amount: true
        }
      });

      formattedAccounts = formattedAccounts.map(acc => {
        const accSummaries = summaries.filter(s => s.bankAccountId === acc.id);
        const income = accSummaries.find(s => s.movementType === 'INCOME')?._sum.amount || 0;
        const expense = accSummaries.find(s => s.movementType === 'EXPENSE')?._sum.amount || 0;

        return {
          ...acc,
          periodIncome: Number(income),
          periodExpense: Number(expense),
          periodNet: Number(income) - Number(expense)
        };
      });
    }

    res.json({
      success: true,
      data: formattedAccounts,
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

router.post('/', authenticate, requirePermission('bank_accounts.create'), async (req, res, next) => {
  try {
    const { name, type, current_balance, is_active } = req.body;

    const account = await prisma.bankAccount.create({
      data: {
        name,
        type: type || 'BANK',
        currentBalance: current_balance !== undefined ? current_balance : 0,
        isActive: is_active !== undefined ? is_active : true,
        holderName: 'VentasCatalogo',
        bankName: name || 'Banco',
        accountNumber: 'N/A'
      }
    });

    res.status(201).json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requirePermission('bank_accounts.edit'), async (req: any, res, next) => {
  try {
    const { name, type, current_balance, is_active } = req.body;
    const { id } = req.params;

    // FIND existing account
    const existing = await prisma.bankAccount.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, error: { message: 'Cuenta no encontrada' } });

    // BUSSINESS RULES: If deactivating
    if (is_active === false && existing.isActive === true) {
      if (existing.type === 'VIRTUAL') {
        return res.status(400).json({
          success: false,
          error: { message: 'No se puede desactivar la cuenta virtual del sistema.' }
        });
      }
      // 1. Check current balance
      if (Number(existing.currentBalance) !== 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'No se puede desactivar una cuenta con saldo activo. El saldo debe ser 0.00.' }
        });
      }
      
      // ... (rest of deactivation logic)

      // 2. Check for movements after last closure
      const lastClosure = await prisma.cashClosure.findFirst({
        orderBy: { toDate: 'desc' }
      });

      const movementsCount = await prisma.financialRecord.count({
        where: {
          bankAccountId: id,
          date: {
            gt: lastClosure ? lastClosure.toDate : new Date(0)
          }
        }
      });

      if (movementsCount > 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'No se puede desactivar la cuenta porque tiene movimientos en el periodo de caja actual (abierto).' }
        });
      }

      // 3. Check for pending orders linked to this account
      const pendingOrders = await prisma.order.count({
        where: {
          bankAccountId: id,
          status: { in: ['POR_RECIBIR', 'RECIBIDO_EN_BODEGA'] }
        }
      });

      if (pendingOrders > 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'No se puede desactivar porque tiene pedidos pendientes vinculados a esta cuenta.' }
        });
      }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (type !== undefined) updateData.type = type;
    if (current_balance !== undefined) updateData.currentBalance = current_balance;
    if (is_active !== undefined) updateData.isActive = is_active;
    updateData.version = { increment: 1 };

    const account = await prisma.bankAccount.update({
      where: { id },
      data: updateData
    });

    return res.json({ success: true, data: account });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', authenticate, requirePermission('bank_accounts.delete'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // 1. Buscar la cuenta
    const account = await prisma.bankAccount.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            financialRecords: true,
            orders: true
          }
        }
      }
    });

    if (!account) {
      return res.status(404).json({ success: false, error: { message: 'Cuenta no encontrada' } });
    }

    if (account.type === 'VIRTUAL') {
      return res.status(400).json({
        success: false,
        error: { message: 'Por seguridad, la "Cuenta Virtual" no puede ser eliminada bajo ninguna circunstancia, ya que es vital para la contabilidad del sistema.' }
      });
    }

    // 2. REGLA DE SEGURIDAD: No borrar si tiene saldo
    if (Number(account.currentBalance) !== 0) {
      return res.status(400).json({
        success: false,
        error: { message: `No se puede eliminar la cuenta '${account.name}' porque tiene un saldo de $${Number(account.currentBalance).toFixed(2)}. Primero debe transferir el dinero o realizar un ajuste a cero.` }
      });
    }

    // 3. REGLA DE INTEGRIDAD: No borrar si tiene historial
    if (account._count.financialRecords > 0 || account._count.orders > 0) {
      return res.status(400).json({
        success: false,
        error: { message: `La cuenta '${account.name}' tiene historial de transacciones o pedidos vinculados. Para mantener la integridad de los reportes, no puede ser eliminada. Por favor, desáctivala en su lugar.` }
      });
    }

    // 4. Proceder con el borrado (si está limpia)
    await prisma.bankAccount.delete({
      where: { id }
    });

    return res.json({ success: true, message: 'Cuenta eliminada exitosamente' });
  } catch (error: any) {
    return next(error);
  }
});

export default router;
