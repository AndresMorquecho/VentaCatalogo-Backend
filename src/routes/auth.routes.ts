import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({ where: { username } });

    if (!user) {
      throw new AppError(401, 'Usuario o contraseña incorrectos. Por favor, verifica tus datos.', 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError(403, 'Tu usuario ha sido desactivado temporalmente. Por favor, contacta a un administrador.', 'USER_DEACTIVATED');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new AppError(401, 'Usuario o contraseña incorrectos. Por favor, verifica tus datos.', 'INVALID_CREDENTIALS');
    }

    // Update lastAccessAt
    await prisma.user.update({
      where: { id: user.id },
      data: { lastAccessAt: new Date() }
    });

    // Fetch role permissions
    const roleData = await prisma.role.findUnique({
      where: { name: user.role }
    });

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: roleData?.permissions || []
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          permissions: roleData?.permissions || [],
          lastAccessAt: new Date()
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
