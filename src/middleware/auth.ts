import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    name?: string;
    permissions?: string[];
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    req.user = decoded;
    next();
  } catch (error) {
    next(new AppError(401, 'Invalid or expired token', 'UNAUTHORIZED'));
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
    }

    const normalizedRole = req.user.role.toUpperCase();
    if (normalizedRole === 'ADMIN') {
      return next();
    }

    if (!roles.map(r => r.toUpperCase()).includes(normalizedRole)) {
      return next(new AppError(403, 'Insufficient permissions', 'FORBIDDEN'));
    }

    next();
  };
};

/**
 * Granular RBAC middleware.
 * Checks if the authenticated user's JWT contains the required permission.
 * ADMIN role bypasses all permission checks.
 * Usage: router.post('/', authenticate, requirePermission('orders.create'), handler)
 */
export const requirePermission = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
    }

    // ADMIN bypasses all granular permission checks
    if (req.user.role.toUpperCase() === 'ADMIN') {
      return next();
    }

    const userPermissions: string[] = req.user.permissions || [];
    if (!userPermissions.includes(permission)) {
      return next(new AppError(403, `Permission denied: '${permission}' is required`, 'FORBIDDEN'));
    }

    next();
  };
};
