import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  getPgErrorCode,
  PG_UNIQUE_VIOLATION,
} from '../common/utils/pg-error.util';
import { FaceProfileRegistrationResponseDto } from './dto/face-profile-response.dto';
import { FaceProfile } from './entities/face-profile.entity';

/**
 * Registrasi & cek keberadaan face profile. Verifikasi untuk borrowing ada di
 * FaceVerificationService (provider mock/http).
 *
 * `face_template` adalah payload OPAQUE dari sistem face recognition (tim AI);
 * backend tidak menentukan formatnya dan tidak pernah mengirimkannya ke client.
 */
@Injectable()
export class FaceService {
  constructor(
    @InjectRepository(FaceProfile) private readonly profiles: Repository<FaceProfile>,
  ) {}

  hasFaceProfile(userId: string): Promise<boolean> {
    return this.profiles.exists({ where: { userId } });
  }

  async register(
    userId: string,
    faceTemplate: string,
  ): Promise<FaceProfileRegistrationResponseDto> {
    if (await this.hasFaceProfile(userId)) {
      throw this.alreadyRegistered();
    }

    try {
      const profile = await this.profiles.save(
        this.profiles.create({ userId, faceTemplate }),
      );
      return FaceProfileRegistrationResponseDto.from(profile);
    } catch (error) {
      // Dua request registrasi bersamaan: unique(user_id) menangkap duplikat.
      if (getPgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw this.alreadyRegistered();
      }
      throw error;
    }
  }

  private alreadyRegistered(): ConflictException {
    return new ConflictException({
      message: 'Face profile untuk user ini sudah terdaftar',
      code: 'FACE_PROFILE_EXISTS',
    });
  }
}
