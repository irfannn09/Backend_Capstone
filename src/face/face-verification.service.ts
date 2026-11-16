import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FaceProfile } from './entities/face-profile.entity';
import {
  FaceVerificationOutcome,
  FaceVerificationProvider,
} from './providers/face-verification.provider';

/**
 * Menjalankan verifikasi wajah lewat provider. Pencatatan hasil ke `face_verifications`
 * dilakukan oleh modul borrowings (butuh request_id) dalam transaksi pembuatan request.
 */
@Injectable()
export class FaceVerificationService {
  constructor(
    @InjectRepository(FaceProfile) private readonly profiles: Repository<FaceProfile>,
    private readonly provider: FaceVerificationProvider,
  ) {}

  async verify(userId: string, faceImage: string): Promise<FaceVerificationOutcome> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) {
      throw new ConflictException({
        message: 'Anda belum melakukan registrasi wajah',
        code: 'FACE_PROFILE_REQUIRED',
      });
    }
    return this.provider.verify({ faceTemplate: profile.faceTemplate, faceImage });
  }
}
