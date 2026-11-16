import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FaceModule } from '../face/face.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    UsersModule,
    FaceModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) {
          throw new Error('JWT_SECRET minimal 32 karakter (gunakan string acak yang panjang)');
        }
        return {
          secret,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          signOptions: { algorithm: 'HS256' as const, expiresIn: (config.get('JWT_EXPIRES_IN') ?? '8h') as any },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Urutan penting: autentikasi dulu, baru otorisasi role. Berlaku GLOBAL (deny by default).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
