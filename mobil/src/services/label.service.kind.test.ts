// 2026-11-10: etiket türü sunucuda topun aşamasından türer — tablet `kind`i yalnız ELLE seçimde gönderir.
import { apiClient } from './api';
import { labelService } from './label.service';

jest.mock('./api', () => ({ apiClient: { get: jest.fn(async () => ({ data: 'N\n', headers: { 'x-label-language': 'PPLB' } })) } }));

const get = apiClient.get as jest.Mock;
beforeEach(() => get.mockClear());

it('kind yoksa sorgu parametresine yazılmaz', async () => {
  await labelService.getRollNative('r1', undefined, { stock: true });
  expect(get.mock.calls[0]![1].params).toStrictEqual({ stock: '1' });
  expect('kind' in get.mock.calls[0]![1].params).toBe(false);
});

it('elle seçilen kind gönderilir', async () => {
  await labelService.getRollNative('r1', 'ROLL_RAW');
  expect(get.mock.calls[0]![1].params).toEqual({ kind: 'ROLL_RAW' });
});
