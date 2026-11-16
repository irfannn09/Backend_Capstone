export interface FaceVerificationInput {
  /** Template wajah yang tersimpan (face_profiles). Hanya dipakai server-ke-server. */
  faceTemplate: string;
  /** Foto wajah dari client (base64). */
  faceImage: string;
}

export interface FaceVerificationOutcome {
  success: boolean;
  score?: number;
}

/**
 * Titik integrasi dengan service face (dikerjakan tim AI). Backend TIDAK membandingkan wajah.
 * Abstract class dipakai sebagai DI token.
 */
export abstract class FaceVerificationProvider {
  abstract verify(input: FaceVerificationInput): Promise<FaceVerificationOutcome>;
}
