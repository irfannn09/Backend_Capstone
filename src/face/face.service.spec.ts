import { ConflictException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { FaceProfile } from './entities/face-profile.entity';
import { FaceService } from './face.service';

function setup(options: { existing?: boolean } = {}) {
  const repository = {
    exists: jest.fn().mockResolvedValue(options.existing ?? false),
    create: jest.fn((value: Partial<FaceProfile>) => value),
    save: jest.fn(async (value: Partial<FaceProfile>) => ({
      id: 'profile-1',
      registeredAt: new Date('2026-11-14T00:00:00.000Z'),
      ...value,
    })),
  };
  const service = new FaceService(
    repository as unknown as Repository<FaceProfile>,
  );
  return { service, repository };
}

describe('FaceService.register', () => {
  it('menyimpan template apa adanya; response tidak memuat template', async () => {
    const { service, repository } = setup();

    const result = await service.register('user-1', 'TEMPLATE-OPAQUE-X');

    expect(repository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      faceTemplate: 'TEMPLATE-OPAQUE-X',
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      message: 'Registrasi wajah berhasil',
      id: 'profile-1',
      registeredAt: new Date('2026-11-14T00:00:00.000Z'),
    });
    expect(JSON.stringify(result)).not.toContain('TEMPLATE-OPAQUE-X');
  });

  it('user sudah punya profile -> 409 FACE_PROFILE_EXISTS tanpa menyimpan', async () => {
    const { service, repository } = setup({ existing: true });

    await expect(service.register('user-1', 'TEMPLATE')).rejects.toMatchObject({
      status: 409,
      response: { code: 'FACE_PROFILE_EXISTS' },
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('race condition unique(user_id) -> 409, bukan 500', async () => {
    const { service, repository } = setup();
    const driverError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    repository.save.mockRejectedValueOnce(
      new QueryFailedError('INSERT INTO face_profiles', [], driverError),
    );

    await expect(service.register('user-1', 'TEMPLATE')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
