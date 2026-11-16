import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FaceProfile } from './entities/face-profile.entity';
import { FaceController } from './face.controller';
import { FaceVerificationService } from './face-verification.service';
import { FaceService } from './face.service';
import { FaceVerificationProvider } from './providers/face-verification.provider';
import { HttpFaceVerificationProvider } from './providers/http-face-verification.provider';
import { MockFaceVerificationProvider } from './providers/mock-face-verification.provider';

@Module({
  imports: [TypeOrmModule.forFeature([FaceProfile])],
  controllers: [FaceController],
  providers: [
    FaceService,
    FaceVerificationService,
    {
      provide: FaceVerificationProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FaceVerificationProvider => {
        if (config.get<string>('FACE_PROVIDER') === 'mock') {
          if (config.get<string>('NODE_ENV') === 'production') {
            throw new Error('FACE_PROVIDER=mock tidak diizinkan di production');
          }
          return new MockFaceVerificationProvider();
        }
        return new HttpFaceVerificationProvider(
          config.get<string>('FACE_SERVICE_URL'),
          config.get<string>('FACE_SERVICE_TOKEN'),
          parseInt(config.get<string>('FACE_SERVICE_TIMEOUT_MS') ?? '10000', 10),
        );
      },
    },
  ],
  exports: [FaceService, FaceVerificationService],
})
export class FaceModule {}
