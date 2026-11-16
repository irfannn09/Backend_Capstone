import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { Profile } from './entities/profile.entity';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  async getMine(userId: string): Promise<ProfileResponseDto> {
    return ProfileResponseDto.from(await this.findByUserId(userId));
  }

  async updateMine(
    user: AuthenticatedUser,
    dto: UpdateMyProfileDto,
  ): Promise<ProfileResponseDto> {
    const changes = Object.entries(dto).filter(([, v]) => v !== undefined);
    if (!changes.length) throw new BadRequestException('Tidak ada data yang diubah');

    // role/profile mismatch: SISWA hanya className, GURU hanya subject
    if (user.role === UserRole.SISWA && dto.subject !== undefined) {
      throw new BadRequestException('field subject tidak sesuai untuk role SISWA');
    }
    if (user.role === UserRole.GURU && dto.className !== undefined) {
      throw new BadRequestException('field className tidak sesuai untuk role GURU');
    }

    const profile = await this.findByUserId(user.userId);
    Object.assign(profile, Object.fromEntries(changes));
    await this.profiles.save(profile);
    return ProfileResponseDto.from(await this.findByUserId(user.userId));
  }

  private async findByUserId(userId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({
      where: { userId },
      relations: { user: true },
    });
    if (!profile) throw new NotFoundException('Profile tidak ditemukan');
    return profile;
  }
}
