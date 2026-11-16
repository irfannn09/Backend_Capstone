import { FaceProfile } from '../entities/face-profile.entity';

/** Response registrasi wajah. SENGAJA tidak memuat face_template. */
export class FaceProfileRegistrationResponseDto {
  message: string;
  id: string;
  registeredAt: Date;

  static from(profile: FaceProfile): FaceProfileRegistrationResponseDto {
    return {
      message: 'Registrasi wajah berhasil',
      id: profile.id,
      registeredAt: profile.registeredAt,
    };
  }
}
