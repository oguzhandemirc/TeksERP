// Canlı okuma istemcisi: gövde yalnız ClientOcrSchema alanları (sunucu strictObject); yanıt savunmayla ayrıştırılır.
import * as fs from 'fs';
import * as path from 'path';
import { apiClient } from './api';
import { liveReadService, parseLiveReadResult, toLiveReadBody } from './liveRead.service';
import type { ClientOcr } from './deviceOcr';

jest.mock('./api', () => ({ apiClient: { post: jest.fn() } }));
const post = apiClient.post as jest.Mock;

const Q: [number, number][] = [[1, 1], [9, 1], [9, 5], [1, 5]];
const OCR: ClientOcr = { engine: 'mlkit', width: 960, height: 1280, rotation: 0, ms: 40, words: [{ t: 'İrsaliye', c: Q, l: 0, p: 0.9 }], lines: [{ c: Q, p: 0.9 }] };

describe('liveRead.service', () => {
  it('gövde yalnız şema alanları (fazla alan atılır)', () => {
    const body = toLiveReadBody({ ...OCR, sensorRotation: 90, at: 5 } as unknown as ClientOcr);
    expect(Object.keys(body).sort()).toEqual(['engine', 'height', 'lines', 'ms', 'rotation', 'width', 'words']);
  });

  it('gövde alan listesi sunucu ClientOcrSchema ile aynı', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../Teks-Erp/src/lib/gelen-belge/istemci-ocr.ts'), 'utf8');
    const block = src.slice(src.indexOf('ClientOcrSchema = z.strictObject({'), src.indexOf('}).superRefine'));
    const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(keys).toEqual(['engine', 'height', 'lines', 'ms', 'rotation', 'width', 'words']);
  });

  it('yanıt ayrıştırma: tanındı / tanınmadı / bozuk', () => {
    const ok = parseLiveReadResult({
      template: { code: 'A', name: 'Acme', version: 2 },
      score: 0.8,
      fields: [{ key: 'partiNo', label: 'Parti No', value: 'P1', needsReview: false, box: { x: 1, y: 2, w: 3, h: 4 } }, { key: 'en', label: 'En', value: null, needsReview: true, issues: ['not-found'] }],
      engineMs: 12,
    });
    expect(ok?.template?.name).toBe('Acme');
    expect(ok?.fields[0].box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(ok?.fields[1]).toMatchObject({ value: null, issues: ['not-found'] });
    expect(parseLiveReadResult({ template: null, score: 0.1, fields: [], engineMs: 3 })?.template).toBeNull();
    expect(parseLiveReadResult({ template: null, fields: [{ key: 1 }] })).toBeNull();
    expect(parseLiveReadResult(null)).toBeNull();
  });

  it('readFrame doğru uca allowlist gövdeyle gider; ağ hatası fırlar', async () => {
    post.mockResolvedValueOnce({ data: { success: true, data: { template: null, score: 0, fields: [], engineMs: 1 } } });
    await expect(liveReadService.readFrame(OCR)).resolves.toMatchObject({ template: null });
    expect(post.mock.calls[0][0]).toBe('/gelen-belge/canli-okuma');
    post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(liveReadService.readFrame(OCR)).rejects.toThrow('Network Error');
  });
});
