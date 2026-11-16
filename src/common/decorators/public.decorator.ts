import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Endpoint tanpa autentikasi. Default seluruh API TERPROTEKSI (JwtAuthGuard global). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
