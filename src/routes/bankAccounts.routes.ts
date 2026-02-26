import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, requirePermission('bank_accounts.view'), async (req, res, next) => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });

    const formattedAccounts = accounts.map(acc => ({
      ...acc,
      currentBalance: Number(acc.currentBalance)
    }));

    res.json({ success: true, data: formattedAccounts });
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
      // 1. Check current balance
      if (Number(existing.currentBalance) !== 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'No se puede desactivar una cuenta con saldo activo. El saldo debe ser 0.00.' }
        });
      }

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

    res.json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, requirePermission('bank_accounts.delete'), async (req, res, next) => {
  try {
    await prisma.bankAccount.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true, message: 'Cuenta bancaria eliminada' });
  } catch (error: any) {
    if (error.code === 'P2003') {
      res.status(400).json({ success: false, error: { message: 'No se puede eliminar la cuenta porque posee registros financieros. Intenta desactivarla.' } });
      return;
    }
    next(error);
  }
});

export default router;
