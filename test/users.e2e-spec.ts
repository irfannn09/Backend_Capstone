import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { UserRole } from '../src/common/enums';
import { User } from '../src/users/entities/user.entity';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

describe('User management (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${admin}`);

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' });
    admin = await loginAs(app, 'admin@sekolah.id');
  });
  afterAll(async () => app.close());

  const siswa = { role: 'SISWA', name: 'Budi', password: 'Rahasia123', nis: '5001', className: 'X-A' };
  const guru = { role: 'GURU', name: 'Bu Sari', password: 'Rahasia123', nik: '7001', subject: 'IPA' };
  const sapras = { role: 'SAPRAS', name: 'Pak Dedi', password: 'Rahasia123', email: 'dedi@sekolah.id' };

  it('endpoint users tidak bisa diakses tanpa login', async () => {
    await http().post('/users').send(siswa).expect(401);
    await http().get('/users').expect(401);
  });

  it('Admin membuat SISWA (profile NIS + kelas, must_change_password = true, hash tersimpan)', async () => {
    const res = await asAdmin(http().post('/users')).send(siswa).expect(201);
    expect(res.body).toMatchObject({
      name: 'Budi', role: 'SISWA', isActive: true, mustChangePassword: true,
      profile: { nis: '5001', className: 'X-A', nik: null, subject: null },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|Rahasia123/);

    const stored = await app.get(DataSource).getRepository(User)
      .createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: res.body.id }).getOneOrFail();
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain('Rahasia123');
  });

  it('Admin membuat GURU dan SAPRAS', async () => {
    const g = await asAdmin(http().post('/users')).send(guru).expect(201);
    expect(g.body.profile).toMatchObject({ nik: '7001', subject: 'IPA', nis: null });
    const s = await asAdmin(http().post('/users')).send(sapras).expect(201);
    expect(s.body).toMatchObject({ role: 'SAPRAS', email: 'dedi@sekolah.id', profile: null });
  });

  it('user baru bisa login dengan password awal lalu dipaksa ganti', async () => {
    const res = await http().post('/auth/login').send({ identifier: '5001', password: 'Rahasia123' }).expect(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('role ADMIN tidak bisa dibuat lewat API; role tak dikenal ditolak', async () => {
    await asAdmin(http().post('/users')).send({ role: 'ADMIN', name: 'x', password: 'Rahasia123', email: 'a2@s.id' }).expect(400);
    await asAdmin(http().post('/users')).send({ role: 'KEPSEK', name: 'x', password: 'Rahasia123' }).expect(400);
  });

  it('validasi data sesuai role (field wajib / mismatch ditolak)', async () => {
    const post = (b: object) => asAdmin(http().post('/users')).send(b);
    await post({ ...siswa, nis: undefined, name: 'a' }).expect(400); // NIS wajib
    await post({ ...siswa, nis: '5100', className: undefined }).expect(400); // kelas wajib
    await post({ ...guru, nik: undefined }).expect(400); // NIK wajib
    await post({ ...guru, nik: '7100', subject: undefined }).expect(400);
    await post({ role: 'SAPRAS', name: 'x', password: 'Rahasia123' }).expect(400); // email wajib
    await post({ ...siswa, nis: '5101', nik: '999' }).expect(400); // siswa + NIK = mismatch
    await post({ ...guru, nik: '7101', nis: '999' }).expect(400);
    await post({ ...sapras, email: 'z@s.id', nis: '1' }).expect(400); // sapras tanpa profile
    await post({ ...siswa, nis: '5102', password: 'pendek' }).expect(400);
    await post({ ...siswa, nis: '5103', isActive: false }).expect(400); // field asing
    await post({ ...siswa, nis: '5104', email: 'bukan-email' }).expect(400);
  });

  it('duplikat NIS / NIK / email -> 409', async () => {
    await asAdmin(http().post('/users')).send({ ...siswa, name: 'Dup' }).expect(409);
    await asAdmin(http().post('/users')).send({ ...guru, name: 'Dup' }).expect(409);
    await asAdmin(http().post('/users')).send({ ...sapras, name: 'Dup' }).expect(409);
    await asAdmin(http().post('/users')).send({ ...siswa, nis: '5200', email: 'DEDI@sekolah.id' }).expect(409); // email case-insensitive
  });

  it('list (filter, pagination), detail, UUID invalid, tidak ditemukan', async () => {
    const all = await asAdmin(http().get('/users')).expect(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|password_hash/);
    const onlyGuru = await asAdmin(http().get('/users?role=GURU')).expect(200);
    expect(onlyGuru.body.data.every((u: { role: string }) => u.role === 'GURU')).toBe(true);
    const search = await asAdmin(http().get('/users?search=5001')).expect(200);
    expect(search.body.data).toHaveLength(1);
    await asAdmin(http().get('/users?limit=1000')).expect(400);
    await asAdmin(http().get('/users?role=HACKER')).expect(400);

    const id = search.body.data[0].id;
    await asAdmin(http().get(`/users/${id}`)).expect(200);
    await asAdmin(http().get('/users/bukan-uuid')).expect(400);
    await asAdmin(http().get('/users/3b241101-e2bb-4255-8caf-4136c566a962')).expect(404);
  });

  it('update: nama/profile sesuai role; ganti role & mismatch ditolak; duplikat 409', async () => {
    const list = await asAdmin(http().get('/users?search=5001')).expect(200);
    const id = list.body.data[0].id;
    const ok = await asAdmin(http().patch(`/users/${id}`)).send({ name: 'Budi Santoso', className: 'XI-B' }).expect(200);
    expect(ok.body).toMatchObject({ name: 'Budi Santoso', profile: { className: 'XI-B', nis: '5001' } });
    await asAdmin(http().patch(`/users/${id}`)).send({ role: 'ADMIN' }).expect(400);
    await asAdmin(http().patch(`/users/${id}`)).send({ subject: 'IPA' }).expect(400);
    await asAdmin(http().patch(`/users/${id}`)).send({ isActive: false }).expect(400);
    await asAdmin(http().patch(`/users/${id}`)).send({ passwordHash: 'x' }).expect(400);
    await asAdmin(http().patch(`/users/${id}`)).send({ nis: '5001' }).expect(200); // NIS milik sendiri
    await asAdmin(http().post('/users')).send({ ...siswa, nis: '5300', name: 'Lain' }).expect(201);
    await asAdmin(http().patch(`/users/${id}`)).send({ nis: '5300' }).expect(409);
  });

  it('SAPRAS: email tidak boleh dikosongkan, siswa boleh', async () => {
    const s = (await asAdmin(http().get('/users?role=SAPRAS')).expect(200)).body.data[0];
    await asAdmin(http().patch(`/users/${s.id}`)).send({ email: null }).expect(400);
    const sw = (await asAdmin(http().get('/users?search=5300')).expect(200)).body.data[0];
    await asAdmin(http().patch(`/users/${sw.id}`)).send({ email: 'lain@sekolah.id' }).expect(200);
    const cleared = await asAdmin(http().patch(`/users/${sw.id}`)).send({ email: null }).expect(200);
    expect(cleared.body.email).toBeNull();
  });

  it('nonaktifkan user: tidak bisa login, data tidak dihapus; aktifkan kembali', async () => {
    await asAdmin(http().post('/users')).send({ ...siswa, nis: '5400', name: 'Nonaktif' }).expect(201);
    const id = (await asAdmin(http().get('/users?search=5400'))).body.data[0].id;
    await asAdmin(http().patch(`/users/${id}/status`)).send({ isActive: false }).expect(200);
    await http().post('/auth/login').send({ identifier: '5400', password: 'Rahasia123' }).expect(403);
    const still = await asAdmin(http().get(`/users/${id}`)).expect(200); // masih ada di DB
    expect(still.body.isActive).toBe(false);
    await asAdmin(http().patch(`/users/${id}/status`)).send({ isActive: true }).expect(200);
    await http().post('/auth/login').send({ identifier: '5400', password: 'Rahasia123' }).expect(200);
    await asAdmin(http().patch(`/users/${id}/status`)).send({ isActive: 'ya' }).expect(400);
  });

  it('Admin tidak bisa menonaktifkan akunnya sendiri', async () => {
    const me = (await asAdmin(http().get('/auth/me')).expect(200)).body.user;
    await asAdmin(http().patch(`/users/${me.id}/status`)).send({ isActive: false }).expect(400);
  });

  it('reset password: password lama mati, must_change_password = true, validasi panjang', async () => {
    await asAdmin(http().post('/users')).send({ ...siswa, nis: '5500', name: 'Reset' }).expect(201);
    const id = (await asAdmin(http().get('/users?search=5500'))).body.data[0].id;
    // user mengganti password sendiri dulu
    const t = await loginAs(app, '5500', 'Rahasia123');
    await http().post('/auth/change-password').set('Authorization', `Bearer ${t}`)
      .send({ currentPassword: 'Rahasia123', newPassword: 'Sudahganti99' }).expect(200);
    expect((await http().post('/auth/login').send({ identifier: '5500', password: 'Sudahganti99' })).body.mustChangePassword).toBe(false);

    await asAdmin(http().patch(`/users/${id}/reset-password`)).send({ newPassword: 'pendek' }).expect(400);
    const res = await asAdmin(http().patch(`/users/${id}/reset-password`)).send({ newPassword: 'ResetAdmin123' }).expect(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/ResetAdmin123|passwordHash/);
    await http().post('/auth/login').send({ identifier: '5500', password: 'Sudahganti99' }).expect(401);
    const login = await http().post('/auth/login').send({ identifier: '5500', password: 'ResetAdmin123' }).expect(200);
    expect(login.body.mustChangePassword).toBe(true);
  });
});
