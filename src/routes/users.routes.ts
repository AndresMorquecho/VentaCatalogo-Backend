import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET all users
router.get('/', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastAccessAt: true
      }
    });

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
});

// CREATE user
router.post('/', async (req, res, next) => {
  try {
    const { username, password, role } = req.body;

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new AppError(400, 'Username already in use', 'USERNAME_EXISTS');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: role || 'USER'
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// UPDATE user (username, role)
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { username, role, isActive } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        username,
        role,
        isActive
      }
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        role: user.role,
        isActive: user.isActive
      }
    });
  } catch (error) {
    next(error);
  }
});

// CHANGE password
router.patch('/:id/password', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

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
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Prevent deleting last admin
    const userToDelete = await prisma.user.findUnique({ where: { id } });
    if (userToDelete?.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true }
      });
      if (adminCount <= 1) {
        throw new AppError(400, 'Cannot delete the last administrator', 'LAST_ADMIN');
      }
    }

    await prisma.user.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
