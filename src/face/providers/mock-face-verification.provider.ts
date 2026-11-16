import {
  FaceVerificationInput,
  FaceVerificationOutcome,
  FaceVerificationProvider,
} from './face-verification.provider';

/**
 * HANYA untuk development/test (FACE_PROVIDER=mock). Berhasil bila faceImage diawali
 * "MOCK_FACE_OK". Dilarang di production (ditolak saat start).
 */
export class MockFaceVerificationProvider extends FaceVerificationProvider {
  async verify(input: FaceVerificationInput): Promise<FaceVerificationOutcome> {
    const ok = input.faceImage.startsWith('MOCK_FACE_OK');
    return { success: ok, score: ok ? 1 : 0 };
  }
}
