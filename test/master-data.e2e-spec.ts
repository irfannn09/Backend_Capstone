import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { UserRole } from '../src/common/enums';
import { createTestApp, loginAs, resetDatabase, seedUser } from './utils/test-app';

describe('Master data (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let sapras: string;
  let siswa: string;
  const http = () => request(app.getHttpServer());
  const as = (t: string, r: request.Test) => r.set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(app);
    await seedUser(app, { role: UserRole.ADMIN, email: 'admin@sekolah.id' });
    await seedUser(app, { role: UserRole.SAPRAS, email: 'sapras@sekolah.id' });
    await seedUser(app, { role: UserRole.SISWA, nis: '1001', className: 'X-A' });
    admin = await loginAs(app, 'admin@sekolah.id');
    sapras = await loginAs(app, 'sapras@sekolah.id');
    siswa = await loginAs(app, '1001');
  });
  afterAll(async () => app.close());

  let categoryId: string;
  let locationId: string;
  let itemTypeId: string;

  describe('item categories', () => {
    it('Admin create (nama di-trim), read oleh semua role terautentikasi', async () => {
      const res = await as(admin, http().post('/item-categories')).send({ name: '  Elektronik ', description: 'Perangkat' }).expect(201);
      expect(res.body.name).toBe('Elektronik');
      categoryId = res.body.id;
      await as(siswa, http().get('/item-categories')).expect(200);
      const one = await as(siswa, http().get(`/item-categories/${categoryId}`)).expect(200);
      expect(one.body.id).toBe(categoryId);
      await http().get('/item-categories').expect(401);
    });
    it('hak tulis: siswa & sapras ditolak (403)', async () => {
      await as(siswa, http().post('/item-categories')).send({ name: 'X' }).expect(403);
      await as(sapras, http().post('/item-categories')).send({ name: 'X' }).expect(403);
    });
    it('validasi: nama wajib/tidak kosong, field asing, UUID invalid, tidak ditemukan', async () => {
      await as(admin, http().post('/item-categories')).send({}).expect(400);
      await as(admin, http().post('/item-categories')).send({ name: '   ' }).expect(400);
      await as(admin, http().post('/item-categories')).send({ name: 'A', id: 'x' }).expect(400);
      await as(admin, http().get('/item-categories/bukan-uuid')).expect(400);
      await as(admin, http().get('/item-categories/3b241101-e2bb-4255-8caf-4136c566a962')).expect(404);
    });
    it('duplikat nama (case-insensitive) -> 409, juga saat update', async () => {
      await as(admin, http().post('/item-categories')).send({ name: 'ELEKTRONIK' }).expect(409);
      const other = await as(admin, http().post('/item-categories')).send({ name: 'ATK' }).expect(201);
      await as(admin, http().patch(`/item-categories/${other.body.id}`)).send({ name: 'elektronik' }).expect(409);
      await as(admin, http().patch(`/item-categories/${other.body.id}`)).send({ name: 'Alat Tulis' }).expect(200);
      await as(admin, http().delete(`/item-categories/${other.body.id}`)).expect(204);
    });
  });

  describe('locations', () => {
    it('CRUD + duplikat', async () => {
      const res = await as(admin, http().post('/locations')).send({ name: 'Gudang Sapras' }).expect(201);
      locationId = res.body.id;
      await as(admin, http().post('/locations')).send({ name: 'gudang sapras' }).expect(409);
      await as(admin, http().patch(`/locations/${locationId}`)).send({ description: 'Lantai 1' }).expect(200);
      await as(sapras, http().get('/locations')).expect(200);
      await as(siswa, http().post('/locations')).send({ name: 'X' }).expect(403);
      const tmp = await as(admin, http().post('/locations')).send({ name: 'Sementara' }).expect(201);
      await as(admin, http().delete(`/locations/${tmp.body.id}`)).expect(204);
      await as(admin, http().get(`/locations/${tmp.body.id}`)).expect(404);
    });
  });

  describe('item types', () => {
    it('create PER_UNIT & CONSUMABLE, relasi kategori dimuat', async () => {
      const res = await as(admin, http().post('/item-types'))
        .send({ categoryId, name: 'Laptop', itemClass: 'PER_UNIT', unitName: 'unit' }).expect(201);
      expect(res.body).toMatchObject({ name: 'Laptop', itemClass: 'PER_UNIT', category: { id: categoryId } });
      itemTypeId = res.body.id;
      await as(admin, http().post('/item-types')).send({ categoryId, name: 'Spidol', itemClass: 'CONSUMABLE', unitName: 'pcs' }).expect(201);
    });
    it('validasi: UUID invalid, enum invalid, field wajib, kategori tidak ada', async () => {
      const post = (b: object) => as(admin, http().post('/item-types')).send(b);
      await post({ categoryId: 'abc', name: 'X', itemClass: 'PER_UNIT', unitName: 'u' }).expect(400);
      await post({ categoryId, name: 'X', itemClass: 'LAINNYA', unitName: 'u' }).expect(400);
      await post({ categoryId, name: 'X', itemClass: 'PER_UNIT' }).expect(400); // unitName wajib
      await post({ categoryId: '3b241101-e2bb-4255-8caf-4136c566a962', name: 'X', itemClass: 'PER_UNIT', unitName: 'u' }).expect(404);
      await as(admin, http().get('/item-types?itemClass=SALAH')).expect(400);
      await as(admin, http().get('/item-types?categoryId=bukan-uuid')).expect(400);
    });
    it('duplikat nama dalam kategori yang sama -> 409', async () => {
      await as(admin, http().post('/item-types')).send({ categoryId, name: 'laptop', itemClass: 'PER_UNIT', unitName: 'unit' }).expect(409);
    });
    it('filter list', async () => {
      const res = await as(siswa, http().get(`/item-types?itemClass=CONSUMABLE&categoryId=${categoryId}`)).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Spidol');
    });
    it('hak tulis: hanya Admin', async () => {
      const body = { categoryId, name: 'Proyektor', itemClass: 'PER_UNIT', unitName: 'unit' };
      await as(sapras, http().post('/item-types')).send(body).expect(403);
      await as(siswa, http().post('/item-types')).send(body).expect(403);
    });
    it('hapus kategori/lokasi/tipe yang masih dipakai -> 409 (data tidak rusak)', async () => {
      await as(admin, http().delete(`/item-categories/${categoryId}`)).expect(409);
      // lokasi dipakai unit
      await as(sapras, http().post('/inventory-units')).send({ itemTypeId, locationId, inventoryCode: 'LPT-001', barcode: 'B-001' }).expect(201);
      await as(admin, http().delete(`/locations/${locationId}`)).expect(409);
      await as(admin, http().delete(`/item-types/${itemTypeId}`)).expect(409);
      await as(admin, http().get(`/locations/${locationId}`)).expect(200);
    });
    it('itemClass tidak dapat diubah setelah punya unit', async () => {
      await as(admin, http().patch(`/item-types/${itemTypeId}`)).send({ itemClass: 'CONSUMABLE' }).expect(409);
      await as(admin, http().patch(`/item-types/${itemTypeId}`)).send({ unitName: 'buah' }).expect(200);
    });
  });
});
