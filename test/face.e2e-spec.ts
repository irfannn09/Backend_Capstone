import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/common/enums';
import { FaceProfile } from '../src/face/entities/face-profile.entity';
import {
  createTestApp,
  loginAs,
  resetDatabase,
  seedUser,
} from './utils/test-app';

describe('Face registration (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ids: {
    siswaA: string;
    siswaB: string;
    siswaC: string;
    siswaD: string;
    guru: string;
    sapras: string;
    admin: string;
  };
  let tok: Record<keyof typeof ids, string>;

  const http = () => request(app.getHttpServer());
  const as = (token: string, r: request.Test) =>
    r.set('Authorization', `Bearer ${token}`);
  const register = (token: string, body: Record<string, unknown>) =>
    as(token, http().post('/face/profile')).send(body);
  const profileRows = (userId: string) =>
    ds.getRepository(FaceProfile).find({ where: { userId } });

  beforeAll(async () => {
    app = await createTestApp();
    ds = app.get(DataSource);
    await resetDatabase(app);

    const [admin, sapras, a, b, c, d, g] = await Promise.all([
      seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' }),
      seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' }),
      seedUser(app, { role: UserRole.SISWA, name: 'Siswa A', nis: '1101', className: 'X-A' }),
      seedUser(app, { role: UserRole.SISWA, name: 'Siswa B', nis: '1102', className: 'X-B' }),
      seedUser(app, { role: UserRole.SISWA, name: 'Siswa C', nis: '1103', className: 'X-C' }),
      seedUser(app, { role: UserRole.SISWA, name: 'Siswa D', nis: '1104', className: 'X-D' }),
      seedUser(app, { role: UserRole.GURU, name: 'Guru', nik: '3601', subject: 'Fisika' }),
    ]);
    ids = {
      admin: admin.id,
      sapras: sapras.id,
      siswaA: a.id,
      siswaB: b.id,
      siswaC: c.id,
      siswaD: d.id,
      guru: g.id,
    };
    tok = {
      admin: await loginAs(app, 'admin@sekolah.id'),
      sapras: await loginAs(app, 'sapras@sekolah.id'),
      siswaA: await loginAs(app, '1101'),
      siswaB: await loginAs(app, '1102'),
      siswaC: await loginAs(app, '1103'),
      siswaD: await loginAs(app, '1104'),
      guru: await loginAs(app, '3601'),
    };
  });
  afterAll(async () => app.close());

  it('SISWA berhasil registrasi; status, login, dan me berubah; template tidak bocor', async () => {
    const before = await as(tok.siswaA, http().get('/face/profile/status')).expect(200);
    expect(before.body).toEqual({ hasFaceProfile: false });

    const loginBefore = await http()
      .post('/auth/login')
      .send({ identifier: '1101', password: 'Password123' })
      .expect(200);
    expect(loginBefore.body.faceRegistrationRequired).toBe(true);

    const res = await register(tok.siswaA, {
      faceTemplate: 'TEMPLATE-RAHASIA-SISWA-A',
    }).expect(201);
    expect(res.body).toEqual({
      message: 'Registrasi wajah berhasil',
      id: expect.any(String),
      registeredAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /TEMPLATE-RAHASIA|faceTemplate|face_template/,
    );

    const rows = await profileRows(ids.siswaA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: ids.siswaA,
      faceTemplate: 'TEMPLATE-RAHASIA-SISWA-A',
    });

    const status = await as(tok.siswaA, http().get('/face/profile/status')).expect(200);
    expect(status.body).toEqual({ hasFaceProfile: true });

    const login = await http()
      .post('/auth/login')
      .send({ identifier: '1101', password: 'Password123' })
      .expect(200);
    expect(login.body.hasFaceProfile).toBe(true);
    expect(login.body.faceRegistrationRequired).toBe(false);
    expect(JSON.stringify(login.body)).not.toContain('TEMPLATE-RAHASIA');

    const me = await as(tok.siswaA, http().get('/auth/me')).expect(200);
    expect(me.body.hasFaceProfile).toBe(true);
    expect(me.body.faceRegistrationRequired).toBe(false);
    expect(JSON.stringify(me.body)).not.toContain('TEMPLATE-RAHASIA');
  });

  it('GURU berhasil registrasi', async () => {
    await register(tok.guru, { faceTemplate: 'TEMPLATE-GURU' }).expect(201);
    const rows = await profileRows(ids.guru);
    expect(rows).toHaveLength(1);
    expect(rows[0].faceTemplate).toBe('TEMPLATE-GURU');
  });

  it('registrasi kedua -> 409 FACE_PROFILE_EXISTS, profile lama tidak ditimpa', async () => {
    await register(tok.siswaB, { faceTemplate: 'TEMPLATE-B' }).expect(201);

    const res = await register(tok.siswaB, {
      faceTemplate: 'TEMPLATE-B-BARU',
    }).expect(409);
    expect(res.body.code).toBe('FACE_PROFILE_EXISTS');
    expect(res.body.message).toBe('Face profile untuk user ini sudah terdaftar');

    const rows = await profileRows(ids.siswaB);
    expect(rows).toHaveLength(1);
    expect(rows[0].faceTemplate).toBe('TEMPLATE-B');
  });

  it('userId dari body ditolak; profil dibuat untuk user dari JWT saja', async () => {
    await register(tok.siswaC, {
      faceTemplate: 'TEMPLATE-C',
      userId: ids.guru,
    }).expect(400);
    expect(await profileRows(ids.siswaC)).toHaveLength(0);

    await register(tok.siswaC, { faceTemplate: 'TEMPLATE-C' }).expect(201);
    const rows = await profileRows(ids.siswaC);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ids.siswaC);
    expect(await profileRows(ids.guru)).toHaveLength(1); // tetap milik guru sendiri
  });

  it('template wajib diisi dan harus berupa teks', async () => {
    await register(tok.siswaD, {}).expect(400);
    await register(tok.siswaD, { faceTemplate: '' }).expect(400);
    await register(tok.siswaD, { faceTemplate: 123 }).expect(400);
    expect(await profileRows(ids.siswaD)).toHaveLength(0);
  });

  it('role selain SISWA/GURU ditolak 403; tanpa token 401', async () => {
    for (const token of [tok.sapras, tok.admin]) {
      await register(token, { faceTemplate: 'TEMPLATE-TERLARANG' }).expect(403);
    }
    await http()
      .post('/face/profile')
      .send({ faceTemplate: 'TEMPLATE-TERLARANG' })
      .expect(401);

    expect(await profileRows(ids.sapras)).toHaveLength(0);
    expect(await profileRows(ids.admin)).toHaveLength(0);
  });
});
