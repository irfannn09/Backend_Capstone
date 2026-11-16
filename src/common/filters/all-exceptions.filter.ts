import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface NormalizedError {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  details?: unknown;
}

/**
 * Format error konsisten untuk seluruh API:
 * { statusCode, error, message, code?, path, timestamp }
 * Stack trace tidak pernah dikirim ke client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const normalized = this.normalize(exception);
    if (normalized.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(normalized.statusCode).json({
      statusCode: normalized.statusCode,
      error: normalized.error,
      message: normalized.message,
      ...(normalized.code ? { code: normalized.code } : {}),
      ...(normalized.details !== undefined ? { details: normalized.details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        return { statusCode: status, message: body, error: STATUS_CODES[status] ?? 'Error' };
      }
      const obj = body as Record<string, unknown>;
      return {
        statusCode: status,
        message: (obj.message as string | string[]) ?? exception.message,
        error: (obj.error as string) ?? STATUS_CODES[status] ?? 'Error',
        code: obj.code as string | undefined,
        details: obj.details,
      };
    }

    if (exception instanceof QueryFailedError) {
      const driver = exception.driverError as { code?: string } | undefined;
      switch (driver?.code) {
        case '23505': // unique_violation
          return this.make(HttpStatus.CONFLICT, 'Data duplikat: nilai tersebut sudah digunakan');
        case '23503': // foreign_key_violation
          return this.make(
            HttpStatus.CONFLICT,
            'Operasi ditolak karena data masih berelasi dengan data lain',
          );
        case '22P02': // invalid_text_representation (mis. UUID tidak valid)
        case '22007': // invalid_datetime_format
        case '22003': // numeric_value_out_of_range
        case '23502': // not_null_violation
        case '23514': // check_violation
          return this.make(HttpStatus.BAD_REQUEST, 'Data yang dikirim tidak valid');
      }
    }

    return this.make(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
  }

  private make(statusCode: number, message: string): NormalizedError {
    return { statusCode, message, error: STATUS_CODES[statusCode] ?? 'Error' };
  }
}
