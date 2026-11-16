import { User } from '../entities/user.entity';

export class ProfileSummaryDto {
  nis: string | null;
  nik: string | null;
  className: string | null;
  subject: string | null;
}

/** Bentuk response user. SENGAJA tidak memuat password_hash maupun face_template. */
export class UserResponseDto {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  profile: ProfileSummaryDto | null;
  createdAt: Date;
  updatedAt: Date;

  static from(user: User): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role?.name,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      profile: user.profile
        ? {
            nis: user.profile.nis,
            nik: user.profile.nik,
            className: user.profile.className,
            subject: user.profile.subject,
          }
        : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
