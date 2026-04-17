import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { sendEmail } from '../lib/email';

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

    // Fetch role permissions - Case-insensitive lookup for safety
    const roles = await prisma.role.findMany({
      where: { isActive: true }
    });

    const roleData = roles.find(r => r.name.toUpperCase() === user.role.toUpperCase());

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: roleData?.permissions || []
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
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

// FORGOT PASSWORD
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError(400, 'El correo electrónico es requerido', 'EMAIL_REQUIRED');
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // For security, don't reveal if the user exists or not
    if (!user) {
      return res.json({
        success: true,
        message: 'Si el correo electrónico está registrado, recibirás un enlace para restablecer tu contraseña.'
      });
    }

    // Generate a temporary token for recovery (expires in 1 hour)
    const resetToken = jwt.sign(
      { id: user.id, purpose: 'password_reset' },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resetLink = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    await sendEmail(
      user.email!,
      'Recuperación de contraseña - Sistema de Ventas',
      `
      <h1>Recuperación de Contraseña</h1>
      <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace para continuar:</p>
      <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Restablecer Contraseña</a>
      <p>Este enlace expirará en 1 hora.</p>
      <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
      `
    );

    res.json({
      success: true,
      message: 'Si el correo electrónico está registrado, recibirás un enlace para restablecer tu contraseña.'
    });
  } catch (error) {
    next(error);
  }
});

// RESET PASSWORD
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new AppError(400, 'Token y nueva contraseña son requeridos', 'RESET_DATA_REQUIRED');
    }

    if (newPassword.length < 4) {
      throw new AppError(400, 'La contraseña debe tener al menos 4 caracteres.', 'INVALID_PASSWORD');
    }

    // Verify token
    let payload: any;
    try {
      payload = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      throw new AppError(401, 'El enlace de recuperación es inválido o ha expirado.', 'INVALID_TOKEN');
    }

    if (payload.purpose !== 'password_reset') {
      throw new AppError(401, 'Token inválido.', 'INVALID_TOKEN');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: payload.id },
      data: { password: hashedPassword }
    });

    res.json({
      success: true,
      message: 'Tu contraseña ha sido restablecida exitosamente.'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
