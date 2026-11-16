import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserRole } from '../common/enums';
import { Paginated, toPaginated } from '../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { comparePassword, hashPassword } from '../common/utils/password.util';
import { escapeLike } from '../common/utils/sql.util';
import { Profile } from '../profiles/entities/profile.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Role } from './entities/role.entity';
import { User } from './entities/user.entity';

interface ProfileFields {
  nis?: string;
  className?: string;
  nik?: string;
  subject?: string;
}

const PROFILE_FIELD_LABEL: Record<keyof ProfileFields, string> = {
  nis: 'nis',
  className: 'className',
  nik: 'nik',
  subject: 'subject',
};

/** Field profile yang BOLEH & WAJIB per role. */
const ROLE_PROFILE_RULES: Record<UserRole, (keyof ProfileFields)[]> = {
  [UserRole.SISWA]: ['nis', 'className'],
  [UserRole.GURU]: ['nik', 'subject'],
  [UserRole.SAPRAS]: [],
  [UserRole.ADMIN]: [],
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- create
  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const profileFields = this.pickProfileFields(dto);
    const problems = this.validateProfileFields(dto.role, profileFields, 'create');
    if (dto.role === UserRole.SAPRAS && !dto.email) {
      problems.push('email wajib diisi untuk role SAPRAS');
    }
    if (problems.length) throw new BadRequestException(problems);

    await this.assertUnique({
      email: dto.email,
      nis: profileFields.nis,
      nik: profileFields.nik,
    });

    const role = await this.roles.findOne({ where: { name: dto.role } });
    if (!role) {
      throw new InternalServerErrorException(
        `Role ${dto.role} belum tersedia di database. Jalankan: npm run migration:run`,
      );
    }

    const passwordHash = await hashPassword(dto.password);

    const userId = await this.dataSource.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(User, {
          roleId: role.id,
          name: dto.name,
          email: dto.email ?? null,
          passwordHash,
          mustChangePassword: true, // password awal dari Admin
          isActive: true,
        }),
      );
      if (ROLE_PROFILE_RULES[dto.role].length) {
        await manager.save(
          manager.create(Profile, {
            userId: user.id,
            nis: profileFields.nis ?? null,
            nik: profileFields.nik ?? null,
            className: profileFields.className ?? null,
            subject: profileFields.subject ?? null,
          }),
        );
      }
      return user.id;
    });

    return UserResponseDto.from(await this.getEntity(userId));
  }

  // ------------------------------------------------------------------ read
  async findAll(query: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    const qb = this.users
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.role', 'r')
      .leftJoinAndSelect('u.profile', 'p');

    if (query.role) qb.andWhere('r.name = :role', { role: query.role });
    if (query.isActive !== undefined) {
      qb.andWhere('u.isActive = :isActive', { isActive: query.isActive });
    }
    if (query.search) {
      qb.andWhere(
        `(u.name ILIKE :s OR u.email ILIKE :s OR p.nis ILIKE :s OR p.nik ILIKE :s)`,
        { s: `%${escapeLike(query.search)}%` },
      );
    }
    qb.orderBy('u.createdAt', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();
    return toPaginated(rows.map(UserResponseDto.from), total, query.page, query.limit);
  }

  async findOne(id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.getEntity(id));
  }

  // ---------------------------------------------------------------- update
  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.getEntity(id);
    const role = user.role.name as UserRole;
    const profileFields = this.pickProfileFields(dto);

    const problems = this.validateProfileFields(role, profileFields, 'update');
    if (dto.email === null && !ROLE_PROFILE_RULES[role].length) {
      problems.push(`email tidak boleh dikosongkan untuk role ${role}`);
    }
    if (problems.length) throw new BadRequestException(problems);

    await this.assertUnique({
      email: dto.email ?? undefined,
      nis: profileFields.nis,
      nik: profileFields.nik,
      excludeUserId: user.id,
    });

    if (dto.name !== undefined) user.name = dto.name;
    if (dto.email !== undefined) user.email = dto.email;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(user);
      if (Object.keys(profileFields).length) {
        const profile =
          user.profile ?? manager.create(Profile, { userId: user.id });
        Object.assign(profile, profileFields);
        await manager.save(profile);
      }
    });

    return UserResponseDto.from(await this.getEntity(id));
  }

  async setStatus(id: string, isActive: boolean, actingUserId: string): Promise<UserResponseDto> {
    if (id === actingUserId && !isActive) {
      throw new BadRequestException('Anda tidak dapat menonaktifkan akun Anda sendiri');
    }
    const user = await this.getEntity(id);
    user.isActive = isActive;
    await this.users.save(user);
    return UserResponseDto.from(user);
  }

  async resetPassword(id: string, newPassword: string): Promise<UserResponseDto> {
    const user = await this.getEntity(id);
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = true; // password hasil reset wajib diganti
    await this.users.save(user);
    return UserResponseDto.from(user);
  }

  // ------------------------------------------------------- dipakai modul auth
  /** Untuk guard: null bila user tidak ada atau tidak aktif. */
  async findAuthUser(id: string): Promise<AuthenticatedUser | null> {
    const user = await this.users.findOne({ where: { id }, relations: { role: true } });
    if (!user || !user.isActive) return null;
    return {
      userId: user.id,
      role: user.role.name as UserRole,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /**
   * Cari user untuk login berdasarkan identifier:
   *  - mengandung '@'  -> email (ADMIN / SAPRAS)
   *  - selain itu      -> NIS (SISWA) atau NIK (GURU)
   * Mengembalikan password_hash (select:false di-override secara eksplisit).
   */
  async findForLogin(identifier: string): Promise<User | null> {
    const id = identifier.trim();
    const qb = this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.role', 'r')
      .leftJoinAndSelect('u.profile', 'p');

    if (id.includes('@')) {
      qb.where('u.email = :email AND r.name IN (:...roles)', {
        email: id.toLowerCase(),
        roles: [UserRole.ADMIN, UserRole.SAPRAS],
      });
    } else {
      qb.where('(p.nis = :id AND r.name = :siswa) OR (p.nik = :id AND r.name = :guru)', {
        id,
        siswa: UserRole.SISWA,
        guru: UserRole.GURU,
      });
    }
    return qb.getOne();
  }

  /** Ganti password milik sendiri. Mengembalikan false bila password saat ini salah. */
  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :userId', { userId })
      .getOne();
    if (!user || !(await comparePassword(currentPassword, user.passwordHash))) return false;

    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = false;
    await this.users.save(user);
    return true;
  }

  // ------------------------------------------------------------- helpers
  /** Entity lengkap (role + profile). password_hash TIDAK ikut ter-select. */
  async getEntity(id: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id },
      relations: { role: true, profile: true },
    });
    if (!user) throw new NotFoundException('User tidak ditemukan');
    return user;
  }

  private pickProfileFields(src: ProfileFields): ProfileFields {
    const out: ProfileFields = {};
    for (const key of Object.keys(PROFILE_FIELD_LABEL) as (keyof ProfileFields)[]) {
      if (src[key] !== undefined) out[key] = src[key];
    }
    return out;
  }

  /**
   * SISWA -> nis + className, GURU -> nik + subject, SAPRAS/ADMIN -> tanpa profile.
   * Field milik role lain ditolak (role/profile mismatch).
   */
  private validateProfileFields(
    role: UserRole,
    fields: ProfileFields,
    mode: 'create' | 'update',
  ): string[] {
    const allowed = ROLE_PROFILE_RULES[role];
    const problems: string[] = [];
    for (const key of Object.keys(fields) as (keyof ProfileFields)[]) {
      if (!allowed.includes(key)) {
        problems.push(`field ${key} tidak sesuai untuk role ${role}`);
      }
    }
    if (mode === 'create') {
      for (const key of allowed) {
        if (!fields[key]) problems.push(`${key} wajib diisi untuk role ${role}`);
      }
    }
    return problems;
  }

  private async assertUnique(opts: {
    email?: string | null;
    nis?: string;
    nik?: string;
    excludeUserId?: string;
  }): Promise<void> {
    const conflicts: string[] = [];

    if (opts.email) {
      const qb = this.users.createQueryBuilder('u').where('u.email = :email', { email: opts.email });
      if (opts.excludeUserId) qb.andWhere('u.id <> :id', { id: opts.excludeUserId });
      if (await qb.getExists()) conflicts.push('Email sudah digunakan');
    }
    for (const [field, label] of [['nis', 'NIS'], ['nik', 'NIK']] as const) {
      const value = opts[field];
      if (!value) continue;
      const qb = this.profiles.createQueryBuilder('p').where(`p.${field} = :v`, { v: value });
      if (opts.excludeUserId) qb.andWhere('p.userId <> :id', { id: opts.excludeUserId });
      if (await qb.getExists()) conflicts.push(`${label} sudah digunakan`);
    }
    if (conflicts.length) throw new ConflictException(conflicts);
  }
}
