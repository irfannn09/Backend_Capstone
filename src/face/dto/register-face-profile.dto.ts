import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Template wajah OPAQUE dari sistem face recognition (tim AI).
 * Backend TIDAK menetapkan format/embedding; nilai disimpan apa adanya ke
 * `face_profiles.face_template` sampai kontrak registrasi difinalkan bersama tim AI.
 */
export class RegisterFaceProfileDto {
  @IsString({ message: 'Template wajah harus berupa teks' })
  @IsNotEmpty({ message: 'Template wajah tidak boleh kosong' })
  @MaxLength(5_000_000, {
    message: 'Template wajah terlalu besar (maksimal 5.000.000 karakter)',
  })
  readonly faceTemplate: string;
}
