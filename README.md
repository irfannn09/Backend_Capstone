# inventarisMuhamka-backend

Backend sistem inventaris & peminjaman barang sekolah (NestJS 11 · TypeScript · PostgreSQL · TypeORM · JWT).

## Status proyek (setelah Sprint 12)

| Tahap | Status |
|---|---|
| Sprint 1–7 (fondasi, database, auth, user, profile, master data, inventory) | **COMPLETED** |
| Pre-Sprint 8 (ERD final 20 tabel, forecasting dihapus, `return_items`) | **COMPLETED** |
| Sprint 8 (Borrowing + Booking) | **COMPLETED** |
| Pre-Sprint 9 (audit, cleanup, lock baseline) | **COMPLETED** |
| Sprint 9 (Handover, Stock Out, Return, Repair record) | **COMPLETED** |
| Sprint 10 (Face Registration API, no-show 30 menit terverifikasi) | **COMPLETED** |
| Sprint 11 (STOCK_IN untuk initial consumable stock) | **COMPLETED** |
| Sprint 12 (Repair Workflow & state transition) | **COMPLETED** |

**Sudah ada:** autentikasi, user/profile, master data, inventory, consumable stock, `STOCK_IN` stok awal, borrow request multi-item, registrasi wajah, face verification (adapter), approval/reject, expiry 2 jam, no-show 30 menit, availability, assignment unit + booking, anti double booking, handover (unit + consumable), `STOCK_OUT`, return per unit, pencatatan repair, workflow repair (mulai/selesai/tidak dapat diperbaiki).

**Belum ada (jangan dianggap tersedia):** notifikasi, business flow `ADJUSTMENT`, provider face/recognition asli, AI, chatbot.

## 1. Install
Prasyarat: Node.js 20+, PostgreSQL 14+ (Windows: installer dari postgresql.org, sertakan pgAdmin).

```powershell
npm install
```

## 2. Konfigurasi `.env`
Salin `.env.example` menjadi `.env`, lalu isi:

| Variabel | Keterangan |
|---|---|
| `DB_*` | Koneksi PostgreSQL (`DB_PASSWORD` = password user postgres Anda) |
| `JWT_SECRET` | **Wajib**, min. 32 karakter acak. Buat: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Masa berlaku token (default `8h`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Akun admin awal (lihat langkah 4) |
| `FACE_PROVIDER` / `FACE_SERVICE_URL` / `FACE_SERVICE_TOKEN` | Integrasi verifikasi wajah. `http` (default) memanggil service tim AI; `mock` HANYA untuk development (ditolak di production): berhasil bila `faceImage` diawali `MOCK_FACE_OK` |
| `CORS_ORIGIN` | Origin Flutter Web (pisahkan koma). Kosong = semua origin (hanya development) |

> `.env` berisi rahasia dan tidak boleh di-commit. Aplikasi menolak start jika `JWT_SECRET` kosong/kurang dari 32 karakter.

## 3. Database & migration
Buat database (nama case-sensitive, wajib tanda kutip) via pgAdmin atau psql:
```sql
CREATE DATABASE "inventarisMuhamka";
```
Jalankan migration (membuat 20 tabel, constraint, dan 4 role: ADMIN, SAPRAS, GURU, SISWA):
```powershell
npm run migration:run
```
Perintah lain: `npm run migration:show`, `npm run migration:revert`,
`npm run migration:generate -- src/database/migrations/NamaMigration`.
`synchronize` selalu `false`.

## 4. Admin awal (tidak ada register publik)
Isi `SEED_ADMIN_EMAIL` dan `SEED_ADMIN_PASSWORD` di `.env`, lalu:
```powershell
npm run seed:admin
```
Idempotent. Admin wajib mengganti password saat login pertama. Setelah itu Admin membuat akun SISWA/GURU/SAPRAS lewat `POST /users`. Hapus `SEED_ADMIN_PASSWORD` dari `.env` setelah selesai.

## 5. Menjalankan
```powershell
npm run start:dev      # development, http://localhost:3000
npm run build ; npm run start:prod
```

## 6. Test
```powershell
npm run test           # unit test (tanpa database)
npm run test:e2e       # butuh PostgreSQL aktif
npm run typecheck      # pemeriksaan tipe (src + test). ESLint belum dikonfigurasi, jadi tidak ada script lint
```
E2E memakai database **terpisah** `<DB_DATABASE>_test` (dibuat otomatis + di-migrate; ubah via `DB_DATABASE_TEST`). Database development tidak disentuh. Role user postgres harus boleh `CREATE DATABASE`.

## 7. Aturan umum API
- Seluruh endpoint **butuh `Authorization: Bearer <token>`**, kecuali `GET /` dan `POST /auth/login`.
- User dengan `must_change_password = true` hanya boleh `POST /auth/change-password` dan `GET /auth/me` (selain itu 403 dengan `code: "MUST_CHANGE_PASSWORD"`).
- Akun nonaktif: tidak bisa login, dan token lama langsung ditolak.
- Format error: `{ statusCode, error, message, code?, path, timestamp }`. 400 validasi · 401 auth · 403 role · 404 tidak ada · 409 konflik/duplikat.
- List memakai `?page=1&limit=20` (maks 100) dan mengembalikan `{ data, meta }`.
- `password_hash` dan `face_template` tidak pernah dikirim ke client.

## 8. Daftar endpoint

**Auth**
| Method | Path | Akses |
|---|---|---|
| POST | `/auth/login` | publik. Body `{ identifier, password }` — SISWA: NIS, GURU: NIK, SAPRAS/ADMIN: email |
| POST | `/auth/change-password` | user login (termasuk yang wajib ganti password) |
| GET | `/auth/me` | user login |

**Users (ADMIN)** — `POST /users`, `GET /users` (`?role&isActive&search`), `GET /users/:id`, `PATCH /users/:id`, `PATCH /users/:id/status`, `PATCH /users/:id/reset-password`

**Profiles (SISWA, GURU)** — `GET /profiles/me`, `PATCH /profiles/me` (SISWA: className, GURU: subject)

**Face (SISWA, GURU)** — `GET /face/profile/status`, `POST /face/profile` (body `{ faceTemplate }`; `userId` selalu dari JWT)

**Master data** — baca: semua user login; tulis: ADMIN
`/item-categories`, `/item-types` (`?categoryId&itemClass&search`), `/locations` — masing-masing `POST`, `GET`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (409 bila masih dipakai)

**Inventory** — baca: SAPRAS + ADMIN; tulis: SAPRAS
- `/inventory-units`: `POST`, `GET` (`?itemTypeId&locationId&availabilityStatus&currentCondition&search`), `GET /:id`, `PATCH /:id`
- `/consumable-stocks`: `POST`, `GET` (`?itemTypeId&lowStock&search`), `GET /:id`, `PATCH /:id` (hanya `minimumStock`)

**Operasional peminjaman (SAPRAS)**
- `/handovers`: `POST` (`{ requestId, notes? }`), `GET /:id`
- `/returns`: `POST` (`{ requestId, items: [{ handoverItemId, returnCondition, notes? }], notes? }`), `GET /:id`
- `/repairs`: `POST /:id/start`, `POST /:id/complete`, `POST /:id/unrepairable` (body opsional `{ repairNotes? }`), `GET /:id`

## 9. Matriks akses
| | ADMIN | SAPRAS | GURU | SISWA |
|---|:-:|:-:|:-:|:-:|
| User management | ✅ | ❌ | ❌ | ❌ |
| Master data (tulis) | ✅ | ❌ | ❌ | ❌ |
| Master data (baca) | ✅ | ✅ | ✅ | ✅ |
| Inventory/stok (tulis) | ❌ | ✅ | ❌ | ❌ |
| Inventory/stok (baca) | ✅ | ✅ | ❌ | ❌ |
| Profile & face status sendiri | ❌ | ❌ | ✅ | ✅ |
| Buat / batalkan request peminjaman | ❌ | ❌ | ✅ | ✅ |
| Lihat request peminjaman | ❌ | semua | milik sendiri | milik sendiri |
| Approve / reject, antrean pending | ❌ | ✅ | ❌ | ❌ |
| Handover / return / inspeksi kondisi | ❌ | ✅ | ❌ | ❌ |
| Workflow repair (tulis) | ❌ | ✅ | ❌ | ❌ |
| Workflow repair (baca) | ✅ | ✅ | ❌ | ❌ |

ADMIN tidak mewarisi hak SAPRAS (dan sebaliknya).

## 10. Perubahan Sprint 5–7
- **Sprint 5**: `ValidationPipe` global (whitelist + forbidNonWhitelisted), filter error konsisten, pagination, util password (bcrypt), util ownership, DTO + service untuk users, profiles, kategori, tipe barang, lokasi, unit inventaris, stok consumable.
- **Sprint 6**: JWT + guard global (`JwtAuthGuard`, `RolesGuard`), decorator `@Public/@Roles/@CurrentUser/@AllowMustChangePassword`, auth, user management, profile, status face profile, `npm run seed:admin`.
- **Sprint 7**: controller + aturan bisnis master data & inventory (PER_UNIT vs CONSUMABLE).
- **Migration baru**: `AddUniqueConstraints` (email, nama kategori, nama lokasi, nama tipe per kategori) dan `SeedRoles` (4 role). Migration `InitialSchema` tidak diubah.

## 11. Pre-Sprint 8 — sinkronisasi ERD final
- Konsep **forecasting dihapus**: entity/tabel `forecast_results` dan folder `src/forecasting` dihapus. AI kini berupa **klasifikasi** (dikerjakan tim lain): unit inventaris `LAYAK_PAKAI`/`PERLU_DIPERBAIKI`, consumable `PERLU_RESTOCK`. Fitur dihitung dari data transaksi, tidak disimpan sebagai kolom.
- Tabel baru **`return_items`** (`return_id`, `handover_item_id`, `return_condition`, `notes`, `created_at`); unit fisik diperoleh lewat `return_items → handover_items → inventory_units`.
- Migration baru `ReturnItemsAndRemoveForecast` (migration lama tidak diubah). Hasil akhir: **20 tabel**.

Daftar 20 tabel: roles, users, profiles, face_profiles, face_verifications, item_categories, item_types, locations, inventory_units, consumable_stocks, repair_records, borrow_requests, borrow_request_items, item_bookings, handover_records, handover_items, return_records, return_items, stock_movements, notifications.

> Jika database development Anda sudah di-migrate sebelumnya, cukup jalankan `npm run migration:run`. **Data `forecast_results` akan ikut terhapus.**

## 12. Sprint 8 — Borrowing & Booking

### Alur
```
Cart (frontend) -> Review -> POST /borrow-requests (items + waktu + purpose + faceImage)
  server: validasi -> verifikasi wajah (gagal = TIDAK ada data dibuat) ->
          transaksi atomik { cek ketersediaan, request, items, face_verifications } -> WAITING_APPROVAL
Sapras: GET /borrow-requests/pending -> approve (unit fisik dipilih/auto) | reject
approve: transaksi + row lock -> booking per unit (status APPROVED) -> request APPROVED
> 2 jam tanpa keputusan -> EXPIRED.   Pemilik dapat cancel (WAITING_APPROVAL / APPROVED -> booking dilepas)
```
> Status "PENDING_APPROVAL" pada spesifikasi = nilai enum yang sudah ada: **`WAITING_APPROVAL`**.

### Endpoint
| Method | Path | Akses |
|---|---|---|
| GET | `/item-types`, `/item-types/:id` | semua user login (katalog, dari Sprint 7) |
| GET | `/item-types/:id/availability?startAt&endAt` | semua user login (waktu wajib untuk PER_UNIT) |
| POST | `/borrow-requests` | SISWA, GURU |
| GET | `/borrow-requests` (`?status&page&limit`) | SISWA/GURU: milik sendiri; SAPRAS: semua |
| GET | `/borrow-requests/pending` | SAPRAS |
| GET | `/borrow-requests/:id` | pemilik atau SAPRAS (selain itu 404) |
| POST | `/borrow-requests/:id/cancel` | pemilik (SISWA/GURU) |
| POST | `/borrow-requests/:id/approve` | SAPRAS. Body opsional `{ assignments: [{ requestItemId, inventoryUnitIds[] }] }` |
| POST | `/borrow-requests/:id/reject` | SAPRAS |

ADMIN tidak punya akses ke borrowing. Waktu memakai ISO-8601 dengan zona, mis. `2026-11-10T08:00:00+07:00`.

### Aturan penting
- **Deadline approval** = `created_at + 2 jam` (dihitung server, tidak disimpan; tampil sebagai `approvalDeadline`). Lewat deadline -> `EXPIRED` (dicek setiap akses + sapuan tiap 60 dtk, `EXPIRY_SWEEP_INTERVAL_MS`).
- **No-show** (terpisah dari deadline approval) = `start_at + 30 menit` untuk request `APPROVED` yang belum punya handover tercatat. Tepat di batas (`now >= start_at + 30 menit`) -> `EXPIRED` dan booking dilepas. Future booking tidak dihitung no-show sebelum `start_at`.
- **Ketersediaan PER_UNIT** = unit layak (`LAYAK_PAKAI`, bukan REPAIR/UNAVAILABLE) dikurangi puncak booking dan request pending lain yang overlap. Rentang setengah-terbuka: 10-12 dan 12-14 tidak overlap.
- **CONSUMABLE** = `current_stock` dikurangi request APPROVED lain (belum dipotong) dan request pending. **Stok tidak dikurangi** di Sprint 8.
- **Anti double booking**: saat approve, baris request + unit kandidat dikunci (`FOR UPDATE`) dalam satu transaksi, lalu overlap dicek ulang.
- Satu tipe barang hanya boleh sekali dalam satu keranjang.

### Database
Tidak ada migration baru; 20 tabel tidak berubah.

## 13. Baseline terkunci (Pre-Sprint 9)
Kondisi di bawah dijaga oleh `test/baseline.e2e-spec.ts` dan tidak boleh berubah tanpa keputusan eksplisit.

**Database:** tepat 20 tabel; 28 foreign key semuanya `ON DELETE RESTRICT`; `return_items` tanpa `inventory_unit_id`; tidak ada tabel forecasting/AI/history tambahan; `handover_records.request_id` dan `return_records.request_id` UNIQUE; stok tidak boleh negatif (CHECK di database).

**Peran:** ADMIN = user + master data (inventaris/stok hanya baca). SAPRAS = inventory, stok, approval, handover, return, repair. SISWA/GURU = profile, face, peminjaman. Role tidak dapat diubah lewat API.

**Status yang benar-benar dipakai kode saat ini**

| Objek | Dipakai | Dicadangkan (belum ditulis kode mana pun) |
|---|---|---|
| `borrow_requests.status` | `WAITING_APPROVAL`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`, `HANDED_OVER` (handover), `RETURNED` (return) | `PENDING_FACE` (alur verifikasi wajah dan pembuatan request berlangsung dalam satu panggilan), `COMPLETED` |
| `inventory_units.availability_status` | `AVAILABLE`, `REPAIR`, `UNAVAILABLE` (manual/hasil return), `BORROWED` (diset saat handover) | `BOOKED` (booking berbasis rentang waktu di `item_bookings`, bukan status unit) |

**Aturan stok:** request dan approval TIDAK mengurangi stok dan TIDAK menulis `stock_movements`. Pengurangan stok hanya boleh terjadi pada handover (Sprint 9).

**Rantai handover/return yang sudah siap (level skema):**
`borrow_requests → borrow_request_items`, `item_bookings` (terhubung ke `borrow_requests` + `inventory_units`, BUKAN ke `borrow_request_items`; baris request ditemukan lewat `request_id` + `item_type_id`, tunggal karena keranjang melarang tipe barang dobel), `handover_records → handover_items (→ borrow_request_items, → inventory_units nullable)`, `return_records → return_items → handover_items`.

### Catatan serah-terima untuk Sprint 9
- Handover wajib memakai unit yang sudah di-assign/di-booking saat approval (Sprint 8). Jangan meminta user memilih unit.
- Unit yang sudah di-booking masih bisa diubah Sapras menjadi `REPAIR`/`UNAVAILABLE` (guard Sprint 7 hanya melindungi `BOOKED`/`BORROWED`, yang belum pernah diset). Handover harus memvalidasi ulang bahwa unit masih layak dan, bila tidak, menentukan aturan substitusi.
- Pengurangan stok consumable harus dalam satu transaksi bersama pembuatan handover, dengan row lock pada `consumable_stocks` dan tanpa stok negatif.
- `handover_records` dan `return_records` UNIQUE per request: handover dan return hanya sekali per request (semua item sekaligus), kecuali ERD diubah.
- Request `APPROVED` yang tidak pernah diambil menjadi `EXPIRED` setelah `start_at + 30 menit` (no-show; dicek saat akses + sapuan). Ini tidak mengurangi stok consumable; pengurangan tetap terjadi saat handover.
- Stok awal consumable (`POST /consumable-stocks`) sekarang mencatat movement `STOCK_IN` sebesar `currentStock` (Sprint 11). Perubahan stok berikutnya tetap hanya lewat handover (`STOCK_OUT`); `ADJUSTMENT` belum memiliki business flow.
- Pencatatan siapa yang approve/reject dan alasan penolakan belum ada (hanya log server).

### Gap yang diketahui (bukan blocker Pre-Sprint 9)
- Endpoint registrasi wajah `POST /face/profile` sudah tersedia, tetapi **format `faceTemplate` masih menunggu kontrak final tim AI**. Backend memperlakukan nilai tersebut sebagai opaque `text` dan tidak menjalankan face recognition. Provider face asli belum ada; `FACE_PROVIDER=mock` hanya untuk development dan ditolak di production.
- `npm audit` (produksi): 3 kerentanan moderat tersisa (`typeorm → glob/minimatch`) yang hanya selesai dengan TypeORM 1.x (perubahan major, belum diambil).
- Util `common/utils/ownership.util.ts` belum dipakai modul mana pun.

## 14. Sprint 9 — Handover, Stock Out, Return

### Alur
```
APPROVED --POST /handovers--> HANDED_OVER
   barang PER_UNIT : unit fisik dari booking approval -> availability_status = BORROWED
   barang CONSUMABLE: current_stock -= qty, stock_movements STOCK_OUT (reference_id = handover)
HANDED_OVER --POST /returns--> RETURNED
   LAYAK_PAKAI      -> unit AVAILABLE
   PERLU_DIPERBAIKI -> unit REPAIR + repair_records (MENUNGGU_PERBAIKAN)
   RUSAK_TOTAL      -> unit UNAVAILABLE
   booking request  -> COMPLETED
```

### Aturan penting
- Handover hanya untuk request `APPROVED`; `WAITING_APPROVAL`, `EXPIRED`, `REJECTED`, `CANCELLED` ditolak (409 `INVALID_STATUS`). Satu request hanya sekali handover (`HANDOVER_EXISTS`).
- Handover memakai unit yang sudah di-booking saat approval. Jumlah unit harus sama dengan `quantity_requested`, tipenya harus cocok, kondisi `LAYAK_PAKAI`, tidak `REPAIR`/`UNAVAILABLE`/`BORROWED`, dan tidak overlap dengan booking request lain.
- Semua item diserahkan sekaligus dalam satu transaksi. Bila satu item gagal, seluruh handover rollback.
- Stok consumable dikunci (`FOR UPDATE`) sebelum divalidasi; stok tidak boleh negatif. `STOCK_OUT` dicatat dalam transaksi yang sama.
- Return hanya sekali per request dan harus mencakup semua barang per unit dari handover tersebut. `handover_item_id` wajib milik request yang sama (400 `HANDOVER_ITEM_MISMATCH`).
- Barang consumable tidak dikembalikan (400 `NOTHING_TO_RETURN`).
- No-show tetap `start_at + 30 menit` (`now >= deadline`) dan dicek sebelum handover; handover yang sudah tercatat membatalkan no-show.
- Booking tetap `APPROVED` selama barang dipinjam (memblokir periode) dan menjadi `COMPLETED` saat return.
- `item_bookings.expires_at` tetap deadline approval 2 jam; tidak berubah.

### Database
Tidak ada migration baru; tetap 20 tabel. Seluruh field/constraint Sprint 9 sudah tersedia sejak Pre-Sprint 8/9.

### Docker (opsional)
`docker-compose.example.yml` menjalankan PostgreSQL dengan password/port dari `.env` (tanpa rahasia di dalam file). Salin menjadi `docker-compose.yml` bila belum punya, lalu `docker compose up -d`.

## 15. Sprint 10 — Face Registration API

### Endpoint
| Method | Path | Akses | Body | Response |
|---|---|---|---|---|
| POST | `/face/profile` | SISWA, GURU | `{ faceTemplate: string }` | `{ message, id, registeredAt }` |

- `userId` diambil dari JWT; field `userId` di body ditolak `400` (anti-IDOR).
- Template disimpan apa adanya ke `face_profiles.face_template` dan **tidak pernah** dikembalikan ke client.
- Satu user hanya punya satu face profile (unique `user_id`). Registrasi kedua → `409 FACE_PROFILE_EXISTS`; profile lama tidak ditimpa.
- Setelah registrasi, `GET /face/profile/status`, `POST /auth/login`, dan `GET /auth/me` melaporkan `hasFaceProfile = true` / `faceRegistrationRequired = false`.

### Kontrak AI
Format `faceTemplate` (embedding/base64/encoding lain) **belum ditentukan** dan masih membutuhkan kesepakatan tim AI. Backend tidak melakukan face recognition, face matching, liveness, atau menentukan threshold.

### Database
Tidak ada migration baru; tetap 20 tabel.

## 16. Sprint 11 — STOCK_IN untuk Initial Consumable Stock

```
POST /consumable-stocks
  currentStock = 100
        ↓ (satu transaksi)
ConsumableStock(current_stock = 100)
        ↓
StockMovement(type = STOCK_IN, quantity = 100, created_by = user JWT)
```

- `createdBy` diambil dari JWT; field `createdBy` di body ditolak `400`.
- `referenceId = null` karena stok awal tidak memiliki dokumen referensi; kolom memang nullable.
- `currentStock = 0` tetap dicatat sebagai `STOCK_IN` quantity `0` agar status stok awal eksplisit di ledger (DTO existing mengizinkan 0).
- `ConsumableStock` + `StockMovement` berada dalam satu transaksi. Jika movement gagal, stock ikut rollback.
- `PATCH /consumable-stocks/:id` tetap hanya mengubah `minimumStock`; tidak membuat `STOCK_IN` baru.
- Satu create menghasilkan tepat satu `STOCK_IN`.
- Tidak ada endpoint stock movement baru. `STOCK_OUT` handover tidak berubah. `ADJUSTMENT` belum diimplementasikan.
- Database: tidak ada migration baru; tetap 20 tabel.

## 17. Sprint 12 — Repair Workflow

### Endpoint
| Method | Path | Akses | Body |
|---|---|---|---|
| POST | `/repairs/:id/start` | SAPRAS | `{ repairNotes? }` |
| POST | `/repairs/:id/complete` | SAPRAS | `{ repairNotes? }` |
| POST | `/repairs/:id/unrepairable` | SAPRAS | `{ repairNotes? }` |
| GET | `/repairs/:id` | SAPRAS, ADMIN (read-only) | — |

Status akhir ditentukan oleh endpoint aksi. Body tidak menerima `repairStatus` maupun `handledBy`; field tersebut ditolak `400`.

### State transition (hanya ini yang valid)
```
MENUNGGU_PERBAIKAN --start--> SEDANG_DIPERBAIKI

SEDANG_DIPERBAIKI --complete--> SELESAI_DIPERBAIKI
SEDANG_DIPERBAIKI --unrepairable--> TIDAK_DAPAT_DIPERBAIKI
```

Transisi lain (termasuk transisi langsung dari `MENUNGGU_PERBAIKAN` ke status akhir, dan perubahan dari status terminal) ditolak `409 INVALID_REPAIR_TRANSITION`. Tidak ada reopen/rework.

### Mapping ke inventory unit
| RepairStatus | currentCondition | availabilityStatus |
|---|---|---|
| `MENUNGGU_PERBAIKAN` | `PERLU_DIPERBAIKI` | `REPAIR` |
| `SEDANG_DIPERBAIKI` | `PERLU_DIPERBAIKI` | `REPAIR` |
| `SELESAI_DIPERBAIKI` | `LAYAK_PAKAI` | `AVAILABLE` |
| `TIDAK_DAPAT_DIPERBAIKI` | `RUSAK_TOTAL` | `UNAVAILABLE` |

Unit tidak pernah menjadi `AVAILABLE` selama masih diperbaiki.

### Aturan pelaksanaan
- Write repair hanya SAPRAS. SISWA, GURU, dan ADMIN mendapat `403`.
- `handledBy` selalu diambil dari JWT user yang menjalankan aksi, bukan dari body.
- `startedAt` tidak diubah (tetap waktu repair record dibuat saat return). `completedAt` diisi saat aksi mencapai status terminal. `repairNotes` diperbarui hanya jika dikirim.
- Perubahan `repair_records` dan `inventory_units` berada dalam satu transaksi; bila salah satu gagal, keduanya rollback.

### Database
Tidak ada migration baru, tidak ada tabel/enum baru; tetap 20 tabel.
