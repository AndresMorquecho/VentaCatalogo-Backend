import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, requirePermission } from '../middleware/auth';

const router = Router();

// Protect all user routes - Authentication required
router.use(authenticate);

// GET all users
router.get('/', requirePermission('users.view'), async (req, res, next) => {
  try {
    const { search } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: search as string, mode: 'insensitive' } },
        { role: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastAccessAt: true
        },
        orderBy: { username: 'asc' },
        skip,
        take: limit
      }),
      prisma.user.count({ where })
    ]);


    res.json({
      success: true,
      data: users,
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


// CREATE user
router.post('/', requirePermission('users.create'), async (req, res, next) => {
  try {
    const { username, password, role, email } = req.body;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email: email ? email : undefined }
        ]
      }
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new AppError(400, 'El nombre de usuario ya está en uso', 'USERNAME_EXISTS');
      }
      if (email && existingUser.email === email) {
        throw new AppError(400, 'El correo electrónico ya está registrado por otro usuario', 'EMAIL_EXISTS');
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role: role || 'USER'
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// UPDATE user (username, role)
router.put('/:id', requirePermission('users.edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, role, isActive, email } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'User not found', 'NOT_FOUND');

    // Check for duplicate username or email
    if (username || email) {
      const duplicate = await prisma.user.findFirst({
        where: {
          id: { not: id },
          OR: [
            username ? { username } : undefined,
            email ? { email } : undefined
          ].filter(Boolean) as any
        }
      });

      if (duplicate) {
        if (username && duplicate.username === username) {
          throw new AppError(400, 'El nombre de usuario ya está en uso por otra cuenta', 'USERNAME_EXISTS');
        }
        if (email && duplicate.email === email) {
          throw new AppError(400, 'El correo electrónico ya está registrado por otro usuario', 'EMAIL_EXISTS');
        }
      }
    }

    let finalActive = isActive !== undefined ? isActive : existing.isActive;
    let finalRole = role || existing.role;

    // Protection logic for ADMIN users
    const isCurrentAdmin = existing.role.toUpperCase() === 'ADMIN' || existing.role.toUpperCase() === 'ADMINISTRADOR';
    const isChangingFromAdmin = isCurrentAdmin && (finalRole.toUpperCase() !== 'ADMIN' && finalRole.toUpperCase() !== 'ADMINISTRADOR');
    const isDeactivatingAdmin = isCurrentAdmin && finalActive === false;

    if (isChangingFromAdmin || isDeactivatingAdmin) {
      const activeAdminCount = await prisma.user.count({
        where: {
          role: { in: ['ADMIN', 'admin', 'ADMINISTRADOR', 'administrador'] },
          isActive: true
        }
      });

      if (activeAdminCount <= 1) {
        throw new AppError(400, 'No se puede cambiar el rol o desactivar al único administrador activo del sistema.', 'LAST_ADMIN');
      }
    }

    const newUsername = username || existing.username;
    const usernameChanged = username && username !== existing.username;

    // Use a transaction to propagate username changes to all denormalized fields
    const user = await prisma.$transaction(async (tx) => {
      // 1. Update the user record
      const updatedUser = await tx.user.update({
        where: { id },
        data: {
          username: newUsername,
          email: email !== undefined ? email : existing.email,
          role: finalRole,
          isActive: finalActive
        }
      });

      // 2. If username changed, propagate to ALL tables that store it as denormalized text
      if (usernameChanged) {
        const oldName = existing.username;
        const newName = username;

        await Promise.all([
          tx.financialRecord.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } }),
          tx.order.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } }),
          tx.order.updateMany({ where: { receivedByName: oldName }, data: { receivedByName: newName } }),
          tx.order.updateMany({ where: { deliveredByName: oldName }, data: { deliveredByName: newName } }),
          tx.cashClosure.updateMany({ where: { closedBy: oldName }, data: { closedBy: newName } }),
          tx.receptionBatch.updateMany({ where: { receivedByName: oldName }, data: { receivedByName: newName } }),
          tx.deliveryBatch.updateMany({ where: { deliveredByName: oldName }, data: { deliveredByName: newName } }),
          tx.walletRecharge.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } }),
          tx.walletRecharge.updateMany({ where: { validatedByName: oldName }, data: { validatedByName: newName } }),
          tx.auditLog.updateMany({ where: { userName: oldName }, data: { userName: newName } }),
          tx.catalogDelivery.updateMany({ where: { deliveredBy: oldName }, data: { deliveredBy: newName } }),
          tx.catalogInventory.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } }),
          tx.call.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } }),
          tx.call.updateMany({ where: { updatedBy: oldName }, data: { updatedBy: newName } }),
          tx.inventoryMovement.updateMany({ where: { createdBy: oldName }, data: { createdBy: newName } }),
          tx.client.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } }),
          tx.orderReceipt.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } }),
          tx.exchangeBatch.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } }),
          tx.noteTemplate.updateMany({ where: { createdByName: oldName }, data: { createdByName: newName } }),
          tx.systemSettings.updateMany({ where: { updatedByName: oldName }, data: { updatedByName: newName } }),
          tx.systemLock.updateMany({ where: { userName: oldName }, data: { userName: newName } }),
        ]);

        console.log(`[USER] Username propagated: "${oldName}" → "${newName}" across all tables`);
      }

      return updatedUser;
    }, { timeout: 30000 }); // 30s timeout for large propagations

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        isActive: user.isActive
      }
    });
  } catch (error) {
    next(error);
  }
});

// CHANGE password
router.patch('/:id/password', requirePermission('users.change_password'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (password.length < 4) {
      throw new AppError(400, 'La contraseña debe tener al menos 4 caracteres.', 'INVALID_PASSWORD');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword }
    });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

// DELETE (soft)
router.delete('/:id', requirePermission('users.delete'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Prevent deleting last admin
    const userToDelete = await prisma.user.findUnique({ where: { id } });
    if (userToDelete?.role.toUpperCase() === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: {
          role: { in: ['ADMIN', 'admin'] },
          isActive: true
        }
      });
      if (adminCount <= 1) {
        throw new AppError(400, 'Cannot delete the last administrator', 'LAST_ADMIN');
      }
    }

    try {
      await prisma.user.delete({ where: { id } });
      res.json({ success: true, message: 'Usuario eliminado exitosamente' });
    } catch (dbError: any) {
      if (dbError.code === 'P2003') {
        throw new AppError(400, 'El usuario no puede ser eliminado porque tiene registros asociados (ej. fidelización). Desactívalo en su lugar.', 'USER_HAS_RELATIONS');
      }
      throw dbError;
    }
  } catch (error) {
    next(error);
  }
});

// TOGGLE status
router.patch('/:id/toggle-status', requirePermission('users.edit'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');

    // Prevent deactivating last admin
    if (user.role.toUpperCase() === 'ADMIN' && user.isActive) {
      const adminCount = await prisma.user.count({
        where: {
          role: { in: ['ADMIN', 'admin'] },
          isActive: true
        }
      });
      if (adminCount <= 1) {
        throw new AppError(400, 'No se puede desactivar al único administrador activo.', 'LAST_ADMIN');
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
