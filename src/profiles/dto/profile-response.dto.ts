import { Profile } from '../entities/profile.entity';

export class ProfileResponseDto {
  id: string;
  userId: string;
  name: string | null;
  nis: string | null;
  nik: string | null;
  className: string | null;
  subject: string | null;
  createdAt: Date;
  updatedAt: Date;

  static from(profile: Profile): ProfileResponseDto {
    return {
      id: profile.id,
      userId: profile.userId,
      name: profile.user?.name ?? null,
      nis: profile.nis,
      nik: profile.nik,
      className: profile.className,
      subject: profile.subject,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
