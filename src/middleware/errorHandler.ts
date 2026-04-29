import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err);

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.errors
      }
    });
  }

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta as any)?.target || [];
      let message = 'Ya existe un registro con este valor.';
      
      if (target.includes('email')) message = 'El correo electrónico ya está registrado.';
      if (target.includes('username')) message = 'El nombre de usuario ya está en uso.';
      if (target.includes('name')) message = 'Ya existe un registro con este nombre (marca, rol o categoría).';
      if (target.includes('identification_number')) message = 'El número de identificación ya está registrado.';
      if (target.includes('phone1') || target.includes('phone2')) message = 'El número de teléfono ya está registrado.';
      if (target.includes('receipt_number')) message = 'El número de recibo ya existe.';
      if (target.includes('packing_number')) message = 'El número de packing ya existe.';
      if (target.includes('delivery_number')) message = 'El número de entrega ya existe.';
      if (target.includes('batch_number')) message = 'El número de lote ya existe.';

      return res.status(409).json({
        success: false,
        error: {
          code: 'UNIQUE_CONSTRAINT',
          message,
          ...(process.env.NODE_ENV !== 'production' && { details: err.meta })
        }
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Registro no encontrado.',
          ...(process.env.NODE_ENV !== 'production' && { details: err.meta })
        }
      });
    }
  }

  // Prisma Validation Errors
  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Los datos proporcionados son inválidos. Por favor verifique los campos.'
      }
    });
  }

  // Prisma Unknown Errors
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Error inesperado en la base de datos.'
      }
    });
  }

  // Custom app errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code || 'APP_ERROR',
        message: err.message
      }
    });
  }

  // Default error
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message
    }
  });
};
