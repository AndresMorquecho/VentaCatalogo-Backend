import { Response } from 'express';

export class HttpResponse {
  static ok<T>(res: Response, data?: T) {
    return res.status(200).json({
      success: true,
      data
    });
  }

  static created<T>(res: Response, data?: T) {
    return res.status(201).json({
      success: true,
      data
    });
  }

  static badRequest(res: Response, message: string) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message
      }
    });
  }

  static unauthorized(res: Response, message: string = 'Unauthorized') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message
      }
    });
  }

  static forbidden(res: Response, message: string = 'Forbidden') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message
      }
    });
  }

  static notFound(res: Response, message: string = 'Not found') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message
      }
    });
  }

  static conflict(res: Response, message: string) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message
      }
    });
  }

  static fail(res: Response, error: Error | string) {
    const message = error instanceof Error ? error.message : error;
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message
      }
    });
  }
}
