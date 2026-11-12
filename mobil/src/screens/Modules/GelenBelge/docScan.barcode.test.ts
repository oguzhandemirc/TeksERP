// Belge fotoğrafındaki barkod (2026-11-09): barkodlar yükleme gövdesine `barcodes` olarak eklenir; okuma başarısızsa ya da
// sunucu alanı tanımıyorsa (400) yükleme yine gider.
import { createHash } from 'crypto';
import { createAttemptToken } from '../../../offline/attemptToken';
import type { InboundDocApi, UploadScanBody } from '../../../services/inboundDoc.service';
import type { ClientOcr } from '../../../services/deviceOcr';
import { readPageBarcodes, resetDeviceBarcodeCache, toPageBarcodes, type PageBarcode } from '../../../services/deviceBarcode';
import { photoSha256, submitDocScan, type ScanPage } from './docScan';

const mockNative = { scanFromURLAsync: jest.fn() };
let mockNativeAvailable = true;
jest.mock('expo', () => ({ requireOptionalNativeModule: (name: string) => (name === 'ExpoCamera' && mockNativeAvailable ? mockNative : null) }));

const page = (seed: string): ScanPage => {
  const base64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(seed.repeat(40))]).toString('base64');
  return { base64, sha256: photoSha256(base64), uri: `file:///${seed}.jpg`, width: 2600, height: 1950 };
};
const OCR: ClientOcr = { engine: 'mlkit', width: 10, height: 10, rotation: 0, words: [], lines: [] };
const BC: PageBarcode[] = [{ format: 'code128', value: 'ISM1439770' }];

function fakeApi(reject?: (b: UploadScanBody) => { status: number } | null) {
  const calls: UploadScanBody[] = [];
  const api: InboundDocApi = {
    createDraftNote: async () => ({ id: 'n1', noteNo: 'GB-1', status: 'DRAFT' }),
    uploadScan: async (body) => {
      calls.push(body);
      const err = reject?.(body);
      if (err) throw Object.assign(new Error('red'), err);
      const sha = createHash('sha256').update(Buffer.from(body.contentBase64, 'base64')).digest('hex');
      return { scan: { id: `s${calls.length}`, sha256: sha, noteId: body.noteId }, duplicate: false, boundTo: body.noteId };
    },
  };
  return { api, calls };
}
const input = (pages: ScanPage[], readBarcodes: (p: ScanPage) => Promise<PageBarcode[]>, readOnDevice: (p: ScanPage) => Promise<ClientOcr | null> = async () => null) =>
  ({ pages, ownerCustomerId: null, senderDocNo: null, barcodeText: null, readOnDevice, readBarcodes });

beforeEach(() => {
  resetDeviceBarcodeCache();
  mockNative.scanFromURLAsync.mockReset();
  mockNativeAvailable = true;
});

describe('Belge barkodu — yükleme gövdesi', () => {
  it('⭐ fotoğraftaki barkod gövdeye `barcodes` olarak eklenir (cihaz okumasıyla birlikte)', async () => {
    const f = fakeApi();
    await submitDocScan(f.api, input([page('a')], async () => BC, async () => OCR), createAttemptToken());
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.barcodes).toEqual(BC);
    expect(f.calls[0]!.clientOcr).toEqual(OCR);
  });

  it('⭐ barkod okuması fırlatırsa / boşsa yükleme yine gider, gövdede alan YOK (bugünkü gövde)', async () => {
    const f = fakeApi();
    await submitDocScan(f.api, input([page('b'), page('c')], async (p) => { if (p.uri.includes('b')) throw new Error('x'); return []; }), createAttemptToken());
    expect(f.calls).toHaveLength(2);
    expect(f.calls.every((c) => !('barcodes' in c))).toBe(true);
  });

  it('⭐ eski sunucu (katı gövde 400) → barkodsuz yeniden; cihaz okuması korunur', async () => {
    const f = fakeApi((b) => (b.barcodes ? { status: 400 } : null));
    const r = await submitDocScan(f.api, input([page('d')], async () => BC, async () => OCR), createAttemptToken());
    expect(r.uploaded).toBe(1);
    expect(f.calls.map((c) => ['barcodes' in c, 'clientOcr' in c])).toEqual([[true, true], [false, true]]);
  });

  it('400 dışı hata barkodsuz tekrar edilmez', async () => {
    const f = fakeApi(() => ({ status: 503 }));
    await expect(submitDocScan(f.api, input([page('e')], async () => BC), createAttemptToken())).rejects.toThrow();
    expect(f.calls).toHaveLength(1);
  });
});

describe('Belge barkodu — cihaz okuyucusu', () => {
  it('native sonucu süzülür: denetim baytı/boş/yinelenen atılır, ≤ 10', () => {
    const raw = [{ type: 'code128', data: ' ISM1\u001d439770 ' }, { type: 'qr', data: '' }, { type: 'code128', data: 'ISM1439770' }, ...Array.from({ length: 20 }, (_, i) => ({ type: 'qr', data: `Q${i}` }))];
    const r = toPageBarcodes(raw);
    expect(r[0]).toEqual({ format: 'code128', value: 'ISM1439770' });
    expect(r).toHaveLength(10);
    expect(toPageBarcodes(null)).toEqual([]);
  });

  it('⭐ expo-camera scanFromURLAsync tüm 1B türlerle çağrılır; modül yok / hata → []', async () => {
    mockNative.scanFromURLAsync.mockResolvedValue([{ type: 'code128', data: 'ISM1439770' }]);
    expect(await readPageBarcodes({ sha256: 'x1', uri: 'file:///x.jpg' })).toEqual(BC);
    expect(mockNative.scanFromURLAsync.mock.calls[0][1]).toEqual(expect.arrayContaining(['code128', 'code39', 'qr']));
    mockNative.scanFromURLAsync.mockRejectedValue(new Error('MLKit'));
    expect(await readPageBarcodes({ sha256: 'x2', uri: 'file:///y.jpg' })).toEqual([]);
    mockNativeAvailable = false;
    expect(await readPageBarcodes({ sha256: 'x3', uri: 'file:///z.jpg' })).toEqual([]);
  });

  it('zaman aşımında [] döner (yükleme beklemez)', async () => {
    mockNative.scanFromURLAsync.mockReturnValue(new Promise(() => undefined));
    expect(await readPageBarcodes({ sha256: 'x4', uri: 'file:///t.jpg' }, 20)).toEqual([]);
  });
});
