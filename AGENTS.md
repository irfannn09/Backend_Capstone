# AGENTS.md — Global Rules inventarisMuhamka

## 1. PROJECT IDENTITY

Project ini adalah backend aplikasi **inventarisMuhamka**, sistem inventaris dan peminjaman barang untuk satu sekolah Muhamka.

Backend menggunakan:

- NestJS
- TypeORM
- PostgreSQL 16
- Docker
- TypeScript
- class-validator / class-transformer
- Migration-based database schema

Frontend menggunakan Flutter, tetapi repository ini berfokus pada backend.

AI/ML dan chatbot adalah scope tim lain. Backend hanya menyediakan integrasi atau struktur data yang memang diperlukan jika secara eksplisit diminta.

---

# 2. CORE DEVELOPMENT PRINCIPLES

Saat mengerjakan project ini:

1. Baca dan pahami source code yang sudah ada sebelum mengubahnya.
2. Jangan membuat ulang project dari awal.
3. Jangan mengganti arsitektur yang sudah ada tanpa alasan kuat.
4. Gunakan pola dan coding style yang sudah digunakan repository.
5. Utamakan perubahan minimal dan terarah.
6. Jangan melakukan refactor besar jika tidak diperlukan oleh tugas.
7. Jangan menghapus fitur lama hanya karena terlihat tidak digunakan tanpa memeriksa dependensinya.
8. Jangan membuat asumsi business rule baru.
9. Jika business rule belum jelas, jelaskan terlebih dahulu sebelum mengubah implementasi.
10. Setelah perubahan kode, jalankan build dan test yang relevan.

---

# 3. BACKEND STACK

Gunakan:

```text
NestJS
TypeORM
PostgreSQL 16
TypeScript
Docker
```

ORM yang digunakan adalah:

```text
TypeORM
```

JANGAN mengganti TypeORM dengan Prisma.

Database menggunakan PostgreSQL.

Migration digunakan sebagai sumber perubahan schema.

`synchronize` harus tetap disabled untuk environment migration-based.

---

# 4. FINAL DATABASE — 20 TABLES

Final ERD project terdiri tepat dari 20 tabel:

1. roles
2. users
3. profiles
4. face_profiles
5. face_verifications
6. item_categories
7. item_types
8. locations
9. inventory_units
10. consumable_stocks
11. repair_records
12. borrow_requests
13. borrow_request_items
14. item_bookings
15. handover_records
16. handover_items
17. return_records
18. return_items
19. stock_movements
20. notifications

Pertahankan jumlah dan struktur 20 tabel ini kecuali perubahan schema memang secara eksplisit diminta dan memiliki alasan yang jelas.

JANGAN mengembalikan:

```text
forecast_results
```

`forecast_results` bukan bagian dari final ERD.

Migration history yang pernah membuat lalu menghapus `forecast_results` boleh tetap ada karena itu merupakan bagian dari migration history.

---

# 5. USER ROLES

Role utama:

```text
ADMIN
SAPRAS
SISWA
GURU
```

Business rule:

### ADMIN

ADMIN bertanggung jawab terhadap administrasi pengguna dan sistem.

ADMIN dapat membuat/mengelola akun SAPRAS.

ADMIN tidak boleh menjalankan fungsi operasional SAPRAS.

### SAPRAS

SAPRAS bertanggung jawab terhadap:

- inventaris
- persetujuan peminjaman
- pengelolaan barang
- pengelolaan stok
- proses operasional peminjaman

Akun SAPRAS dibuat oleh ADMIN.

### SISWA dan GURU

SISWA/GURU menggunakan sistem untuk:

- login
- melihat barang
- mengajukan peminjaman
- melakukan face verification
- melihat status peminjaman
- menggunakan barang sesuai proses peminjaman

Tidak ada public registration page.

---

# 6. USER CREATION AND LOGIN

Tidak ada halaman register publik.

User dibuat/dikelola oleh ADMIN/SAPRAS sesuai authorization yang sudah ditentukan project.

Login menggunakan:

```text
username
password
```

Profile memiliki:

```text
must_change_password
```

dengan default:

```text
false
```

Jangan mengembalikan public registration kecuali secara eksplisit diminta.

---

# 7. FACE REGISTRATION

Face registration hanya berlaku untuk:

```text
SISWA
GURU
```

Flow:

```text
Login
   ↓
Cek face profile
   ↓
Belum ada face profile
   ↓
Face Registration
   ↓
Home
```

Jika face profile sudah ada:

```text
Login
   ↓
Home
```

Face registration dilakukan menggunakan perangkat milik user.

Backend menyediakan endpoint dan provider abstraction yang diperlukan.

Backend tidak bertanggung jawab menentukan algoritma computer vision tertentu kecuali diminta secara eksplisit.

---

# 8. FACE VERIFICATION BEFORE BORROWING

Face verification wajib dilakukan sebelum user mengirim request peminjaman.

Aturan berlaku untuk:

- barang per unit
- barang habis pakai

Flow:

```text
Pilih barang
   ↓
Masukkan jumlah
   ↓
Submit request
   ↓
Face verification
   ↓
Berhasil
   ↓
Borrow request dibuat
```

Jika face verification gagal:

```text
Borrow request tidak boleh dibuat.
```

Jangan melewati face verification hanya karena endpoint borrowing dipanggil langsung.

---

# 9. BORROWING REQUEST

User dapat membuat satu request yang berisi beberapa item.

`borrow_request_items` digunakan untuk item-item dalam request tersebut.

User memilih:

- item type
- quantity

Untuk barang per unit, user tidak memilih physical inventory unit tertentu pada tahap request.

Physical unit ditangani oleh proses operasional SAPRAS sesuai implementasi project.

---

# 10. APPROVAL DEADLINE — 2 HOURS

Request yang menunggu approval memiliki batas:

```text
created_at + 2 jam
```

Status awal setelah face verification berhasil:

```text
WAITING_APPROVAL
```

Jika SAPRAS tidak melakukan approve/reject sampai deadline:

```text
EXPIRED
```

Availability harus dilepaskan sehingga request expired tidak lagi memblokir ketersediaan.

Gunakan waktu server/backend sebagai dasar perhitungan.

JANGAN mengubah approval deadline 2 jam kecuali diminta secara eksplisit.

---

# 11. TIME-BASED BOOKING

Untuk barang per unit, booking berdasarkan periode waktu:

```text
start_at
end_at
```

Booking berada di:

```text
item_bookings
```

Overlap rule:

```text
existing.start_at < requested.end_at
AND
existing.end_at > requested.start_at
```

Jangan menganggap seluruh inventory unit menjadi BOOKED secara permanen.

Booking hanya berlaku selama periode waktu yang ditentukan.

---

# 12. IMPORTANT — item_bookings.expires_at

Field:

```text
item_bookings.expires_at
```

memiliki arti:

**approval deadline 2 jam dari request dibuat.**

JANGAN menggunakan field ini sebagai no-show deadline.

No-show adalah mekanisme terpisah yang dihitung dari:

```text
start_at + 30 menit
```

Jangan mengubah arti `expires_at` tanpa instruksi eksplisit.

---

# 13. NO-SHOW RULE

No-show berlaku untuk request yang sudah:

```text
APPROVED
```

Grace period dimulai dari:

```text
start_at
```

Deadline no-show:

```text
start_at + 30 menit
```

Aturan exact boundary:

```text
now >= start_at + 30 menit
```

Jika handover belum tercatat/terkonfirmasi:

```text
APPROVED → EXPIRED
```

Contoh:

```text
08:29:59 → APPROVED
08:30:00 → EXPIRED
08:30:01 → EXPIRED
```

JANGAN menggunakan:

```text
now > start_at + 30 menit
```

Gunakan logika:

```text
now >= start_at + 30 menit
```

---

# 14. FUTURE BOOKING AND NO-SHOW

Approval dapat dilakukan sebelum jadwal peminjaman.

Contoh:

```text
Friday
request approved

Saturday 08:00
scheduled start

Saturday 08:30
no-show deadline
```

Request tidak boleh dianggap no-show pada hari Jumat hanya karena sudah APPROVED.

No-show harus dihitung berdasarkan:

```text
start_at
```

bukan:

```text
created_at
```

dan bukan:

```text
approved_at
```

---

# 15. HANDOVER CONDITION FOR NO-SHOW

Sebelum request diubah menjadi EXPIRED karena no-show:

cek apakah handover sudah tercatat/terkonfirmasi.

Jika handover sudah selesai/terkonfirmasi:

jangan expire request sebagai no-show.

Jangan mengimplementasikan seluruh business logic handover/return jika tugas yang diberikan belum mencakup bagian tersebut.

Gunakan struktur/entity/status handover yang sudah ada.

---

# 16. CONSUMABLE STOCK

Barang habis pakai menggunakan:

```text
consumable_stocks
```

Stock tidak boleh berkurang hanya karena:

```text
request dibuat
```

atau:

```text
request disetujui
```

Stock berkurang pada:

```text
handover
```

saat barang benar-benar diserahkan.

Availability dapat mempertimbangkan reservation sesuai mekanisme yang sudah ada.

---

# 17. STOCK MOVEMENTS

`stock_movements` digunakan untuk mencatat perubahan stok.

Stock masuk:

```text
STOCK_IN
```

Stock keluar:

```text
STOCK_OUT
```

`STOCK_IN` dapat digunakan untuk initial/additional consumable stock sesuai implementasi yang sudah ada.

Jangan membuat STOCK_OUT penuh jika tugas belum masuk implementasi handover/stock-out.

---

# 18. INVENTORY UNIT

Barang per unit memiliki physical unit melalui:

```text
inventory_units
```

Setiap unit dapat memiliki:

- inventory code
- barcode
- location
- status
- condition

Status dan lifecycle mengikuti implementasi yang sudah ada.

Jangan mengubah status BOOKED menjadi mekanisme booking permanen jika sistem menggunakan `item_bookings` berbasis waktu.

---

# 19. RETURN AND CONDITION

Return memiliki kondisi barang.

Secara konseptual:

```text
LAYAK_PAKAI
    ↓
AVAILABLE
```

Jika perlu diperbaiki:

```text
PERLU_DIPERBAIKI
    ↓
REPAIR
```

Jika rusak total:

```text
RUSAK_TOTAL
    ↓
tidak tersedia
```

Jangan mengimplementasikan full return workflow jika belum diminta.

---

# 20. REPAIR

Repair menggunakan entity:

```text
repair_records
```

Jangan membuat sistem repair baru atau tabel repair tambahan tanpa alasan yang jelas.

---

# 21. NOTIFICATIONS

Entity:

```text
notifications
```

sudah tersedia untuk kebutuhan notifikasi.

Jangan menganggap seluruh notification business logic sudah selesai hanya karena entity tersedia.

Implementasikan notification hanya jika task secara eksplisit memintanya.

---

# 22. AI / MACHINE LEARNING

AI/ML bukan scope utama backend saat ini.

Konsep AI tim adalah:

```text
prediksi kebutuhan bulan depan
```

Target terminology yang digunakan antara lain:

```text
perlu_perbaikan_bln_depan
perlu_restock_bln_depan
```

Backend tidak perlu membuat model AI/ML kecuali diminta secara eksplisit.

Jangan mengembalikan konsep lama forecasting table:

```text
forecast_results
```

---

# 23. CHATBOT

Chatbot merupakan scope tim lain.

Jangan mengimplementasikan chatbot dalam backend kecuali diminta secara eksplisit.

Jika backend membutuhkan placeholder/integration point untuk chatbot, buat hanya sesuai kebutuhan nyata dan jangan membuat sistem chatbot lengkap.

---

# 24. DTO VALIDATION

DTO menggunakan:

```text
class-validator
class-transformer
```

Validation message sebaiknya menggunakan Bahasa Indonesia yang jelas dan spesifik.

Contoh:

```ts
@IsNotEmpty({
  message: 'Nama lengkap tidak boleh kosong',
})
@IsString({
  message: 'Nama lengkap harus berupa teks',
})
@MaxLength(100, {
  message: 'Nama lengkap maksimal 100 karakter',
})
readonly fullName: string;
```

Hindari default message seperti:

```text
fullName must be a string
fullName should not be empty
email must be an email
quantity must not be less than 1
```

Saat melakukan audit DTO:

- periksa semua DTO yang relevan
- jangan hanya memperbaiki DTO yang sedang digunakan
- jangan mengubah DTO yang sudah benar tanpa alasan
- jangan melakukan refactor kosmetik

---

# 25. AUTHORIZATION

Authorization harus mengikuti role.

Jangan memberikan akses SAPRAS kepada ADMIN hanya karena ADMIN adalah role dengan privilege lebih tinggi.

Business rule:

```text
ADMIN ≠ SAPRAS
```

ADMIN tidak otomatis boleh melakukan fungsi operasional SAPRAS.

Pastikan endpoint menggunakan guard/decorator authorization yang sesuai dengan role.

---

# 26. OWNERSHIP AND IDOR

Endpoint yang menangani data user harus memastikan user tidak dapat mengakses data milik user lain secara sembarangan.

Untuk borrowing ownership:

- pemilik request dapat mengakses request miliknya
- SAPRAS dapat mengakses sesuai kebutuhan operasional
- user lain tidak boleh mengambil data request milik user lain

Jangan menghilangkan ownership check hanya untuk mempermudah testing.

---

# 27. MIGRATION RULES

Database menggunakan migration.

Sebelum membuat migration:

1. Periksa entity.
2. Periksa migration terakhir.
3. Pastikan perubahan memang membutuhkan perubahan schema.
4. Jangan membuat migration untuk perubahan DTO saja.
5. Jangan membuat migration hanya untuk business logic yang dapat dihitung di service.

Jika schema change diperlukan:

jelaskan terlebih dahulu:

```text
Database change needed:
Reason:
Affected tables:
Impact:
```

Jangan mengubah ERD secara diam-diam.

---

# 28. TESTING REQUIREMENT

Setiap perubahan penting harus divalidasi dengan test yang relevan.

Minimal gunakan:

```bash
npm run build
npm test
```

Jika tersedia:

```bash
npm run test:e2e
```

Jangan menyatakan test PASS tanpa benar-benar menjalankan test.

Untuk business rule berbasis waktu, gunakan test boundary yang eksplisit.

Contoh:

```text
08:29:59
08:30:00
08:30:01
```

Exact boundary harus diuji.

---

# 29. EXISTING LEGACY CODE

Beberapa enum/status lama mungkin masih ada walaupun flow aktif sudah tidak menggunakannya.

Contoh:

```text
PENDING_FACE
BOOKED
```

Jangan menghapus enum/status tersebut secara otomatis.

Pertama periksa:

- database constraint
- migration
- entity
- service
- controller
- test
- frontend contract

Jika memang ingin dihapus, jelaskan dampaknya terlebih dahulu.

---

# 30. CHANGE DISCIPLINE

Saat menerima task baru:

### Step 1 — Understand

Baca:

- entity terkait
- DTO terkait
- service
- controller
- guard
- migration
- test

### Step 2 — Plan

Tentukan file yang perlu diubah.

Jangan mengubah file yang tidak berhubungan.

### Step 3 — Implement

Implementasikan perubahan minimal.

Pertahankan:

- naming convention
- architecture
- coding style
- existing patterns

### Step 4 — Test

Jalankan test relevan.

### Step 5 — Report

Laporkan:

```text
Files changed
What changed
Why changed
Tests
Build
Migration
Potential risks
```

---

# 31. DO NOT OVER-IMPLEMENT

Jika user meminta:

```text
No-show 30 menit
```

jangan otomatis mengimplementasikan:

- full handover
- full return
- stock-out
- notification system
- AI
- chatbot
- frontend
- unrelated refactor

Kerjakan hanya scope yang diminta.

Jika sebuah fitur memang menjadi dependency langsung, implementasikan hanya bagian minimum yang diperlukan.

---

# 32. DO NOT INVENT BUSINESS RULES

Jika suatu behavior tidak ditemukan di:

- source code
- migration
- test
- aturan project
- instruksi user

jangan mengarang business rule baru.

Jika terdapat konflik antara source code lama dan aturan project terbaru:

**aturan project terbaru yang eksplisit menjadi prioritas.**

Namun jangan langsung menghapus behavior lama tanpa memeriksa dampaknya.

---

# 33. RESPONSE STYLE FOR CODING TASKS

Saat selesai mengerjakan task, berikan laporan ringkas tetapi jelas.

Gunakan struktur:

```text
## Summary

## Files Changed

## Business Rule Changes

## Tests

## Build

## Migration

## Remaining Issues

## Scope Check
```

Jika ada error, jangan menyembunyikannya.

Bedakan:

```text
source code error
```

dengan:

```text
environment / permission / dependency issue
```

Jelaskan error sebenarnya.

---

# 34. CRITICAL BUSINESS RULE SUMMARY

Aturan berikut adalah aturan penting yang tidak boleh berubah tanpa instruksi eksplisit:

```text
Final ERD = 20 tables

Approval deadline = 2 hours from created_at

item_bookings.expires_at = approval deadline

No-show deadline = start_at + 30 minutes

Exact no-show condition = now >= start_at + 30 minutes

08:29:59 = APPROVED
08:30:00 = EXPIRED if no handover
08:30:01 = EXPIRED if no handover

Future booking is not no-show before start_at

Face verification required before borrowing request

Face registration required for SISWA/GURU without face profile

Consumable stock decreases at handover, not request/approval

ADMIN cannot perform SAPRAS operational functions

SAPRAS accounts are created by ADMIN

No public registration

TypeORM + PostgreSQL

Do not restore forecast_results

Do not implement AI/chatbot unless explicitly requested
```

These rules are the baseline context for future coding tasks in this repository.
