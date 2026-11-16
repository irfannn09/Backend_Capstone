import { ArgumentsHost, ConflictException, ForbiddenException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/x', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { code: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}
const pg = (code: string) => new QueryFailedError('q', [], { code } as never);

describe('AllExceptionsFilter', () => {
  it('HttpException dipertahankan + format konsisten', () => {
    const { code, body } = run(new ConflictException('dup'));
    expect(code).toBe(409);
    expect(body).toMatchObject({ statusCode: 409, error: 'Conflict', message: 'dup', path: '/x' });
    expect(body.timestamp).toBeDefined();
  });
  it('meneruskan field code (mis. MUST_CHANGE_PASSWORD)', () => {
    const { body } = run(new ForbiddenException({ message: 'x', code: 'MUST_CHANGE_PASSWORD' }));
    expect(body.code).toBe('MUST_CHANGE_PASSWORD');
  });
  it('meneruskan field details (mis. daftar kekurangan stok)', () => {
    const { body } = run(new ConflictException({ message: 'x', code: 'INSUFFICIENT_AVAILABILITY', details: [{ requested: 3 }] }));
    expect(body.details).toEqual([{ requested: 3 }]);
  });
  it('unique violation -> 409, FK violation -> 409, invalid uuid -> 400', () => {
    expect(run(pg('23505')).code).toBe(409);
    expect(run(pg('23503')).code).toBe(409);
    expect(run(pg('22P02')).code).toBe(400);
  });
  it('error tak dikenal -> 500 tanpa membocorkan detail/stack', () => {
    const { code, body } = run(new Error('rahasia internal'));
    expect(code).toBe(500);
    expect(JSON.stringify(body)).not.toContain('rahasia');
    expect(JSON.stringify(body)).not.toContain('stack');
  });
});
