// BEKÇİ — D4-F4 bağla idempotency: token mantıksal deneme (top + kod) başına; yalnız belirsiz hatada yapışır.
import { createBindAttempt } from './bindAttempt';

function setup(bindImpl: jest.Mock, revokeImpl: jest.Mock = jest.fn().mockResolvedValue({})) {
  let n = 0;
  const attempt = createBindAttempt({ bind: bindImpl, revoke: revokeImpl, gen: () => `t${++n}` });
  return { attempt, bind: bindImpl, revoke: revokeImpl };
}

it('ağ hatasından sonra tekrar AYNI token (replay)', async () => {
  const bind = jest.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});
  const { attempt } = setup(bind);
  await expect(attempt.submit('r1', 'MK1')).rejects.toThrow();
  await attempt.submit('r1', 'MK1');
  expect(bind.mock.calls.map((c) => c[1].clientToken)).toEqual(['t1', 't1']);
});

it('kesin 409 sonrası yeni token; başka kod yeni deneme', async () => {
  const bind = jest.fn().mockRejectedValueOnce({ status: 409, details: { code: 'CUSTOMER_CODE_TAKEN' } }).mockResolvedValue({});
  const { attempt } = setup(bind);
  await expect(attempt.submit('r1', 'MK1')).rejects.toBeTruthy();
  await attempt.submit('r1', 'MK1');
  await attempt.submit('r1', 'MK2');
  expect(bind.mock.calls.map((c) => c[1].clientToken)).toEqual(['t1', 't2', 't3']);
});

it('değiştir = sebepli kaldır + bağla; kaldırılmış kod (NOT_ACTIVE) bağlamayı durdurmaz', async () => {
  const bind = jest.fn().mockResolvedValue({});
  const revoke = jest.fn().mockRejectedValueOnce({ status: 409, details: { code: 'CUSTOMER_CODE_NOT_ACTIVE' } });
  const { attempt } = setup(bind, revoke);
  await attempt.submit('r1', 'MK9', 'etiket yırtıldı');
  expect(revoke).toHaveBeenCalledWith('r1', 'etiket yırtıldı');
  expect(bind).toHaveBeenCalledWith('r1', { code: 'MK9', clientToken: 't1' });
});

it('değiştir: kaldırma yazıldı, bağlama kesin 4xx ile düştü → hata eski kodun kaldırıldığını taşır', async () => {
  const bind = jest.fn().mockRejectedValueOnce({ status: 409, details: { code: 'CUSTOMER_CODE_TAKEN' } });
  const { attempt } = setup(bind);
  await expect(attempt.submit('r1', 'MK9', 'etiket yırtıldı')).rejects.toMatchObject({ previousCodeRevoked: true });
});

it('düz bağlama hatası eski kod kaldırıldı demez', async () => {
  const bind = jest.fn().mockRejectedValueOnce({ status: 409, details: { code: 'CUSTOMER_CODE_TAKEN' } });
  const { attempt } = setup(bind);
  await expect(attempt.submit('r1', 'MK9')).rejects.not.toHaveProperty('previousCodeRevoked');
});
