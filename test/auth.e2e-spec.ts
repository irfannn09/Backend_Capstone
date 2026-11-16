import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { UserRole } from '../src/common/enums';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

describe('Authentication & authorization (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' });
    await seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' });
    await seedUser(app, { role: UserRole.SISWA, nis: '1001', className: 'X-A' });
    await seedUser(app, { role: UserRole.GURU, nik: '3501', subject: 'Matematika' });
    await seedUser(app, { role: UserRole.SISWA, nis: '1002', className: 'X-B', isActive: false });
    await seedUser(app, { role: UserRole.SISWA, nis: '1003', className: 'X-C', mustChangePassword: true });
  });
  afterAll(async () => app.close());

  describe('login', () => {
    it.each([
      ['ADMIN via email', 'admin@sekolah.id'],
      ['SAPRAS via email', 'sapras@sekolah.id'],
      ['SISWA via NIS', '1001'],
      ['GURU via NIK', '3501'],
    ])('berhasil: %s', async (_label, identifier) => {
      const res = await http().post('/auth/login').send({ identifier, password: 'Password123' }).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.mustChangePassword).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|face_template|faceTemplate/);
    });

    it('email case-insensitive', async () => {
      await http().post('/auth/login').send({ identifier: 'ADMIN@Sekolah.ID', password: 'Password123' }).expect(200);
    });

    it('siswa belum punya face profile -> faceRegistrationRequired', async () => {
      const res = await http().post('/auth/login').send({ identifier: '1001', password: 'Password123' }).expect(200);
      expect(res.body.hasFaceProfile).toBe(false);
      expect(res.body.faceRegistrationRequired).toBe(true);
      const admin = await http().post('/auth/login').send({ identifier: 'admin@sekolah.id', password: 'Password123' });
      expect(admin.body.faceRegistrationRequired).toBe(false);
    });

    it('JWT payload hanya userId + role (tanpa data sensitif)', async () => {
      const token = await loginAs(app, '1001');
      const payload = app.get(JwtService).decode(token) as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'userId']);
      expect(payload.role).toBe('SISWA');
    });

    it('password salah dan user tidak ada -> 401 dengan pesan identik (anti enumerasi)', async () => {
      const wrongPw = await http().post('/auth/login').send({ identifier: '1001', password: 'salah-salah' }).expect(401);
      const unknown = await http().post('/auth/login').send({ identifier: '99999', password: 'Password123' }).expect(401);
      expect(wrongPw.body.message).toBe(unknown.body.message);
    });

    it('identifier harus sesuai role: siswa tidak bisa login dengan email, admin tidak dengan NIS', async () => {
      await http().post('/auth/login').send({ identifier: '3501', password: 'Password123' }).expect(200); // NIK guru
      await http().post('/auth/login').send({ identifier: 'sapras@sekolah.id', password: 'salah' }).expect(401);
    });

    it('user nonaktif tidak boleh login (403, hanya setelah password benar)', async () => {
      const ok = await http().post('/auth/login').send({ identifier: '1002', password: 'Password123' }).expect(403);
      expect(ok.body.code).toBe('ACCOUNT_INACTIVE');
      await http().post('/auth/login').send({ identifier: '1002', password: 'salah-salah' }).expect(401);
    });

    it('validasi input: field kosong / field asing ditolak 400', async () => {
      await http().post('/auth/login').send({ identifier: '', password: '' }).expect(400);
      await http().post('/auth/login').send({ identifier: '1001', password: 'x', role: 'ADMIN' }).expect(400);
    });

    it('tidak ada public registration', async () => {
      await http().post('/auth/register').send({ identifier: 'x', password: 'Password123' }).expect(404);
    });
  });

  describe('JWT', () => {
    it('tanpa token -> 401', async () => {
      await http().get('/auth/me').expect(401);
    });
    it('token sampah / salah secret / alg none -> 401', async () => {
      await http().get('/auth/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
      const forged = new JwtService({ secret: 'secret-lain-yang-panjang-sekali-0123456789' }).sign({
        userId: '3b241101-e2bb-4255-8caf-4136c566a962', role: 'ADMIN',
      });
      await http().get('/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
      const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' +
        Buffer.from('{"userId":"3b241101-e2bb-4255-8caf-4136c566a962","role":"ADMIN"}').toString('base64url') + '.';
      await http().get('/auth/me').set('Authorization', `Bearer ${none}`).expect(401);
    });
    it('token kedaluwarsa -> 401', async () => {
      const jwt = app.get(JwtService);
      const user = await http().post('/auth/login').send({ identifier: '1001', password: 'Password123' });
      const id = user.body.user.id;
      const expired = jwt.sign({ userId: id, role: 'SISWA' }, { expiresIn: '-10s' });
      await http().get('/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);
    });
    it('token valid -> /auth/me', async () => {
      const token = await loginAs(app, '1001');
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.user.role).toBe('SISWA');
      expect(res.body.user.profile.nis).toBe('1001');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/);
    });
    it('token user yang kemudian dinonaktifkan langsung ditolak', async () => {
      const victim = await seedUser(app, { role: UserRole.SISWA, nis: '2001', className: 'X-A' });
      const token = await loginAs(app, '2001');
      await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      const adminToken = await loginAs(app, 'admin@sekolah.id');
      await http().patch(`/users/${victim.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ isActive: false }).expect(200);
      await http().get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });
  });

  describe('role guard', () => {
    it('SISWA tidak boleh mengakses User Management', async () => {
      const token = await loginAs(app, '1001');
      await http().get('/users').set('Authorization', `Bearer ${token}`).expect(403);
    });
    it('SAPRAS tidak boleh mengakses User Management', async () => {
      const token = await loginAs(app, 'sapras@sekolah.id');
      await http().get('/users').set('Authorization', `Bearer ${token}`).expect(403);
    });
    it('ADMIN boleh', async () => {
      const token = await loginAs(app, 'admin@sekolah.id');
      await http().get('/users').set('Authorization', `Bearer ${token}`).expect(200);
    });
    it('ADMIN tidak punya profile/face (endpoint khusus SISWA/GURU)', async () => {
      const token = await loginAs(app, 'admin@sekolah.id');
      await http().get('/profiles/me').set('Authorization', `Bearer ${token}`).expect(403);
      await http().get('/face/profile/status').set('Authorization', `Bearer ${token}`).expect(403);
    });
  });

  describe('change password & must_change_password', () => {
    it('login menandai mustChangePassword, dan endpoint lain diblokir (403 MUST_CHANGE_PASSWORD)', async () => {
      const res = await http().post('/auth/login').send({ identifier: '1003', password: 'Password123' }).expect(200);
      expect(res.body.mustChangePassword).toBe(true);
      const blocked = await http().get('/profiles/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(403);
      expect(blocked.body.code).toBe('MUST_CHANGE_PASSWORD');
      await http().get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200); // diizinkan
    });

    it('alur lengkap: ganti password -> flag false -> akses normal -> password lama tidak berlaku', async () => {
      const token = await loginAs(app, '1003');
      await http().post('/auth/change-password').set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'SALAH-SALAH', newPassword: 'PasswordBaru456' }).expect(400);
      await http().post('/auth/change-password').set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'Password123', newPassword: 'Password123' }).expect(400);
      await http().post('/auth/change-password').set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'Password123', newPassword: 'pendek' }).expect(400);
      await http().post('/auth/change-password').set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'Password123', newPassword: 'PasswordBaru456' }).expect(200);

      await http().get('/profiles/me').set('Authorization', `Bearer ${token}`).expect(200);
      await http().post('/auth/login').send({ identifier: '1003', password: 'Password123' }).expect(401);
      const again = await http().post('/auth/login').send({ identifier: '1003', password: 'PasswordBaru456' }).expect(200);
      expect(again.body.mustChangePassword).toBe(false);
    });

    it('change-password butuh autentikasi', async () => {
      await http().post('/auth/change-password').send({ currentPassword: 'a', newPassword: 'PasswordBaru456' }).expect(401);
    });
  });
});
