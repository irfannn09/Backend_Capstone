import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/common/enums';
import { FaceProfile } from '../src/face/entities/face-profile.entity';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

describe('Profiles & face status (e2e)', () => {
  let app: INestApplication;
  let siswaToken: string;
  let guruToken: string;
  const http = () => request(app.getHttpServer());
  const as = (token: string, r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedUser(app, { role: UserRole.SISWA, name: 'Siswa A', nis: '1001', className: 'X-A' });
    await seedUser(app, { role: UserRole.SISWA, name: 'Siswa B', nis: '1002', className: 'X-B' });
    await seedUser(app, { role: UserRole.GURU, name: 'Guru A', nik: '3501', subject: 'Matematika' });
    await seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' });
    siswaToken = await loginAs(app, '1001');
    guruToken = await loginAs(app, '3501');
  });
  afterAll(async () => app.close());

  it('SISWA memiliki NIS + kelas; GURU memiliki NIK + subject', async () => {
    const s = await as(siswaToken, http().get('/profiles/me')).expect(200);
    expect(s.body).toMatchObject({ name: 'Siswa A', nis: '1001', className: 'X-A', nik: null, subject: null });
    const g = await as(guruToken, http().get('/profiles/me')).expect(200);
    expect(g.body).toMatchObject({ name: 'Guru A', nik: '3501', subject: 'Matematika', nis: null, className: null });
  });

  it('ownership: /profiles/me selalu milik pemanggil, tidak bisa menunjuk user lain', async () => {
    const res = await as(siswaToken, http().get('/profiles/me')).expect(200);
    expect(res.body.nis).toBe('1001'); // bukan 1002
    await as(siswaToken, http().patch('/profiles/me')).send({ className: 'XI-A', userId: 'x' }).expect(400); // userId ditolak
    await as(siswaToken, http().patch('/profiles/me')).send({ className: 'XI-A' }).expect(200);
    const other = await as(await loginAs(app, '1002'), http().get('/profiles/me')).expect(200);
    expect(other.body.className).toBe('X-B'); // profile siswa lain tidak berubah
  });

  it('update profile sendiri sesuai role; mismatch & field terlarang ditolak', async () => {
    const g = await as(guruToken, http().patch('/profiles/me')).send({ subject: 'Fisika' }).expect(200);
    expect(g.body.subject).toBe('Fisika');
    await as(siswaToken, http().patch('/profiles/me')).send({ subject: 'Fisika' }).expect(400); // role/profile mismatch
    await as(guruToken, http().patch('/profiles/me')).send({ className: 'X-A' }).expect(400);
    for (const forbidden of [{ nis: '9999' }, { nik: '9999' }, { role: 'ADMIN' }, { isActive: false }, { passwordHash: 'x' }]) {
      await as(siswaToken, http().patch('/profiles/me')).send(forbidden).expect(400);
    }
    await as(siswaToken, http().patch('/profiles/me')).send({}).expect(400);
    await as(siswaToken, http().patch('/profiles/me')).send({ className: '   ' }).expect(400);
  });

  it('SAPRAS tidak punya profile (403) dan tanpa token 401', async () => {
    await as(await loginAs(app, 'sapras@sekolah.id'), http().get('/profiles/me')).expect(403);
    await http().get('/profiles/me').expect(401);
  });

  it('face profile status: false -> true setelah ada face_profile; template tidak bocor', async () => {
    let res = await as(siswaToken, http().get('/face/profile/status')).expect(200);
    expect(res.body).toEqual({ hasFaceProfile: false });

    const me = (await as(siswaToken, http().get('/auth/me')).expect(200)).body.user;
    const ds = app.get(DataSource);
    await ds.getRepository(FaceProfile).save(
      ds.getRepository(FaceProfile).create({ userId: me.id, faceTemplate: 'RAHASIA-TEMPLATE-WAJAH' }),
    );
    res = await as(siswaToken, http().get('/face/profile/status')).expect(200);
    expect(res.body).toEqual({ hasFaceProfile: true });

    const login = await http().post('/auth/login').send({ identifier: '1001', password: 'Password123' }).expect(200);
    expect(login.body.faceRegistrationRequired).toBe(false);
    expect(JSON.stringify(login.body)).not.toContain('RAHASIA-TEMPLATE-WAJAH');
    const meRes = await as(siswaToken, http().get('/auth/me')).expect(200);
    expect(JSON.stringify(meRes.body)).not.toContain('RAHASIA-TEMPLATE-WAJAH');
  });
});
