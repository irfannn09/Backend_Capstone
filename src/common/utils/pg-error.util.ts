import { QueryFailedError } from 'typeorm';

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function getPgErrorCode(error: unknown): string | undefined {
  if (error instanceof QueryFailedError) {
    return (error.driverError as { code?: string } | undefined)?.code;
  }
  return undefined;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return getPgErrorCode(error) === PG_FOREIGN_KEY_VIOLATION;
}
