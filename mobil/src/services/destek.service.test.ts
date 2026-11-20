// Destek servisi — sözleşmedeki uçlar (DESTEK-ENTEGRASYONU.md §5), `/api` öneksiz.
import { apiClient } from './api';
import { destekService } from './destek.service';

jest.mock('./api', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const get = apiClient.get as jest.Mock;
const post = apiClient.post as jest.Mock;
const ID = '5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c';

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { success: true, data: { etkin: true, count: 1, tickets: 1, url: 'u' } } });
  post.mockReset().mockResolvedValue({ data: { success: true, data: { id: ID } } });
});

it('okuma uçları doğru yol ve sorguyla gider', async () => {
  await destekService.durum();
  await destekService.liste({ scope: 'tenant', page: 2 });
  await destekService.detay(ID);
  await destekService.okunmamis('mine');
  await destekService.ekBaglanti('a3e1', 'thumb');
  expect(get.mock.calls.map((c) => c[0])).toEqual([
    '/etkili-destek/durum',
    '/etkili-destek/talepler',
    `/etkili-destek/talepler/${ID}`,
    '/etkili-destek/okunmamis',
    '/etkili-destek/ekler/a3e1/baglanti',
  ]);
  expect(get.mock.calls[1][1].params).toEqual({ scope: 'tenant', page: 2, limit: 20 });
  expect(get.mock.calls[4][1].params).toEqual({ variant: 'thumb' });
});

it('yazma uçları doğru yol; ekli talepte uzun zaman aşımı', async () => {
  const govde = {
    type: 'BUG' as const,
    subject: 's',
    message: 'm',
    clientToken: 't',
    files: [{ name: 'ekran.jpg', contentType: 'image/jpeg' as const, dataBase64: 'QQ==' }],
  };
  await destekService.talepAc(govde);
  await destekService.yanitYaz(ID, 'merhaba');
  await destekService.kapat(ID);
  await destekService.okundu(ID);
  expect(post.mock.calls.map((c) => c[0])).toEqual([
    '/etkili-destek/talepler',
    `/etkili-destek/talepler/${ID}/mesajlar`,
    `/etkili-destek/talepler/${ID}/kapat`,
    `/etkili-destek/talepler/${ID}/okundu`,
  ]);
  expect(post.mock.calls[0][1]).toBe(govde);
  expect(post.mock.calls[0][2].timeout).toBeGreaterThanOrEqual(60_000);
  expect(post.mock.calls[1][1]).toEqual({ message: 'merhaba' });
});

it('durum: alan yoksa/bozuksa kapalı sayılır', async () => {
  get.mockResolvedValueOnce({ data: { success: true, data: {} } });
  expect(await destekService.durum()).toEqual({ etkin: false, firmaYoneticisi: false });
});

it('durum: firmaYoneticisi sunucudan okunur (tek kaynak); eski backend alanı yoksa false', async () => {
  get.mockResolvedValueOnce({ data: { success: true, data: { etkin: true, firmaYoneticisi: true } } });
  expect(await destekService.durum()).toEqual({ etkin: true, firmaYoneticisi: true });
  get.mockResolvedValueOnce({ data: { success: true, data: { etkin: true } } });
  expect(await destekService.durum()).toEqual({ etkin: true, firmaYoneticisi: false });
});
