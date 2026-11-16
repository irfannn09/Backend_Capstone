import { UserRole } from '../common/enums';

/**
 * Hak tulis master data (kategori, tipe barang, lokasi). Dibaca semua user terautentikasi
 * (katalog). Satu-satunya tempat yang perlu diubah bila SAPRAS juga diberi hak tulis.
 * Lihat DECISION REQUIRED #1 di README/laporan.
 */
export const MASTER_DATA_WRITE_ROLES: UserRole[] = [UserRole.ADMIN];
