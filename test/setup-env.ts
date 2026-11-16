import 'dotenv/config';
import { resolveTestDatabase } from './test-config';

// Dijalankan di setiap worker sebelum test: arahkan app ke database test.
process.env.DB_DATABASE = resolveTestDatabase();
process.env.JWT_SECRET = 'test-secret-only-for-e2e-0123456789abcdef';
process.env.JWT_EXPIRES_IN = '1h';
process.env.BCRYPT_ROUNDS = '4'; // cepat untuk test
process.env.DB_LOGGING = 'false'; // sembunyikan log query gagal yang memang disengaja test
process.env.FACE_PROVIDER = 'mock'; // provider wajah palsu: berhasil bila faceImage diawali "MOCK_FACE_OK"
process.env.EXPIRY_SWEEP_INTERVAL_MS = '0'; // tanpa timer latar belakang saat test
