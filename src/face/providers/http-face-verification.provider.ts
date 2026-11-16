import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  FaceVerificationInput,
  FaceVerificationOutcome,
  FaceVerificationProvider,
} from './face-verification.provider';

/**
 * Adapter ke service face tim AI.
 * KONTRAK USULAN (perlu disepakati dengan tim AI):
 *   POST {FACE_SERVICE_URL}/verify   Authorization: Bearer {FACE_SERVICE_TOKEN} (opsional)
 *   body     : { "template": string, "image": string }
 *   response : { "verified": boolean, "score"?: number }
 */
export class HttpFaceVerificationProvider extends FaceVerificationProvider {
  private readonly logger = new Logger('FaceVerification');

  constructor(
    private readonly baseUrl: string | undefined,
    private readonly token: string | undefined,
    private readonly timeoutMs: number,
  ) {
    super();
  }

  async verify(input: FaceVerificationInput): Promise<FaceVerificationOutcome> {
    if (!this.baseUrl) {
      throw new ServiceUnavailableException({
        message: 'Layanan verifikasi wajah belum dikonfigurasi',
        code: 'FACE_SERVICE_UNAVAILABLE',
      });
    }
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ template: input.faceTemplate, image: input.faceImage }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { verified?: unknown; score?: unknown };
      return {
        success: body.verified === true,
        score: typeof body.score === 'number' ? body.score : undefined,
      };
    } catch (error) {
      this.logger.error(`Face service error: ${(error as Error).message}`);
      throw new ServiceUnavailableException({
        message: 'Layanan verifikasi wajah tidak dapat dihubungi',
        code: 'FACE_SERVICE_UNAVAILABLE',
      });
    }
  }
}
