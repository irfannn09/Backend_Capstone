import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // CORS untuk Flutter Web. Isi CORS_ORIGIN (pisahkan dengan koma) di production.
  const origins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins?.length ? origins : true });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`inventarisMuhamka-backend berjalan di http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
