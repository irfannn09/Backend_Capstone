import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { UserRole } from '../../src/common/enums';
import { hashPassword } from '../../src/common/utils/password.util';
import { Profile } from '../../src/profiles/entities/profile.entity';
import { Role } from '../../src/users/entities/role.entity';
import { User } from '../../src/users/entities/user.entity';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Kosongkan semua tabel kecuali `roles` (data referensi dari migration). */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const ds = app.get(DataSource);
  const tables = ds.entityMetadatas
    .map((m) => m.tableName)
    .filter((t) => t !== 'roles')
    .map((t) => `"${t}"`)
    .join(', ');
  await ds.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

export interface SeedUserOptions {
  role: UserRole;
  name?: string;
  email?: string;
  password?: string;
  nis?: string;
  nik?: string;
  className?: string;
  subject?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/** Buat user langsung lewat DB (melewati API) untuk menyiapkan skenario test. */
export async function seedUser(app: INestApplication, o: SeedUserOptions): Promise<User> {
  const ds = app.get(DataSource);
  const role = await ds.getRepository(Role).findOneByOrFail({ name: o.role });
  const user = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      roleId: role.id,
      name: o.name ?? `Test ${o.role}`,
      email: o.email ?? null,
      passwordHash: await hashPassword(o.password ?? 'Password123'),
      mustChangePassword: o.mustChangePassword ?? false,
      isActive: o.isActive ?? true,
    }),
  );
  if (o.nis || o.nik) {
    await ds.getRepository(Profile).save(
      ds.getRepository(Profile).create({
        userId: user.id,
        nis: o.nis ?? null,
        nik: o.nik ?? null,
        className: o.className ?? null,
        subject: o.subject ?? null,
      }),
    );
  }
  return user;
}

export async function loginAs(
  app: INestApplication,
  identifier: string,
  password = 'Password123',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ identifier, password })
    .expect(200);
  return res.body.accessToken as string;
}
