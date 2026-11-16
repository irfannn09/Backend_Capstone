import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Konfigurasi global yang dipakai main.ts dan test e2e agar perilakunya identik. */
export function configureApp(app: INestApplication): void {
  // Foto wajah (base64) untuk verifikasi dikirim lewat JSON; default Express hanya 100kb.
  (app as NestExpressApplication).useBodyParser('json', { limit: '6mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // buang field yang tidak dideklarasikan di DTO
      forbidNonWhitelisted: true, // dan tolak request yang mengirimnya
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
