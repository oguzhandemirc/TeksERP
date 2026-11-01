import { createHash } from 'crypto';
import { createAttemptToken } from '../../../offline/attemptToken';
import type { InboundDocApi, CreateDraftNoteBody, UploadScanBody } from '../../../services/inboundDoc.service';
import {
  CAPTURE_QUALITY,
  MAX_SCAN_BYTES,
  SubmitError,
  TARGET_LONG_EDGE_PX,
  addPage,
  barcodeToDocNo,
  base64ToBytes,
  photoSha256,
  pickPictureSize,
  submitDocScan,
  type ScanPage,
} from './docScan';

// Sahte JPEG gövdeleri (sihirli bayt + rastgele içerik) — gerçek boyda değil, özet/sıra sınanır.
const jpeg = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(seed.repeat(50))]).toString('base64');
const page = (seed: string): ScanPage => {
  const base64 = jpeg(seed);
  return { base64, sha256: photoSha256(base64), uri: `file:///${seed}.jpg`, width: 2600, height: 1950 };
};

function fakeApi(opts: { failUploadAt?: number; failCreate?: { status?: number } } = {}) {
  const notes = new Map<string, { id: string; noteNo: string }>();
  const scans = new Map<string, { id: string; noteId: string; pageNo: number }>();
  const createCalls: CreateDraftNoteBody[] = [];
  const uploadCalls: UploadScanBody[] = [];
  let failCreate = opts.failCreate;
  let failUploadAt = opts.failUploadAt;
  const api: InboundDocApi = {
    createDraftNote: async (body) => {
      createCalls.push(body);
      if (failCreate) {
        const e = Object.assign(new Error('düştü'), failCreate);
        failCreate = undefined;
        throw e;
      }
      // Sunucu idempotency: aynı clientToken → aynı taslak.
      const n = notes.get(body.clientToken) ?? { id: `note-${notes.size + 1}`, noteNo: `GB-${notes.size + 1}` };
      notes.set(body.clientToken, n);
      return { ...n, status: 'DRAFT' };
    },
    uploadScan: async (body) => {
      uploadCalls.push(body);
      if (failUploadAt !== undefined && uploadCalls.length === failUploadAt) {
        failUploadAt = undefined;
        throw Object.assign(new Error('zaman aşımı'), {});
      }
      // Sunucu sha256 dedup (DocumentScan.sha256 @unique).
      const sha = createHash('sha256').update(Buffer.from(body.contentBase64, 'base64')).digest('hex');
      expect(body.sha256).toBe(sha);
      const prev = scans.get(sha);
      if (prev) return { scan: { id: prev.id, sha256: sha, noteId: prev.noteId }, duplicate: true, boundTo: prev.noteId };
      const s = { id: `scan-${scans.size + 1}`, noteId: body.noteId, pageNo: body.pageNo };
      scans.set(sha, s);
      return { scan: { id: s.id, sha256: sha, noteId: s.noteId }, duplicate: false, boundTo: s.noteId };
    },
  };
  return { api, notes, scans, createCalls, uploadCalls };
}

describe('Belge Tara — çekim ayarı', () => {
  it('2600 px / kalite 0,8 (ölçüm boyu)', () => {
    expect(TARGET_LONG_EDGE_PX).toBe(2600);
    expect(CAPTURE_QUALITY).toBe(0.8);
  });
  it('uzun kenarı ≥2600 olan EN KÜÇÜK boy seçilir; yoksa en büyüğü; tanınmayan elenir', () => {
    expect(pickPictureSize(['4032x3024', '2592x1944', '3264x2448', '1920x1080', 'High'])).toBe('3264x2448');
    expect(pickPictureSize(['1920x1080', '2048x1536'])).toBe('2048x1536');
    expect(pickPictureSize(['2600x1950', '4000x3000'])).toBe('2600x1950');
    expect(pickPictureSize(['Photo'])).toBeUndefined();
  });
  it('⭐ 16:9 boy seçilmez — Galaxy Tab A9+ (SM-X210) arka kamera JPEG listesinde 4:3 seçilir', () => {
    // dumpsys media.camera JPEG listesi (kısaltılmış): eski kural 2688x1512 seçiyordu, CameraX 4:3'te 1600x1200'e düşürdü.
    const tabA9 = ['3264x2448', '3264x2032', '3264x1824', '3200x2400', '2688x1512', '2592x1944', '2592x1940', '2560x1920', '2048x1536', '1920x1080', '1600x1200'];
    expect(pickPictureSize(tabA9)).toBe('3200x2400');
    expect(pickPictureSize(['2688x1512', '1920x1080', '1600x1200', '1440x1080'])).toBe('1600x1200');
    expect(pickPictureSize(['2688x1512', '1920x1080'])).toBe('2688x1512'); // 4:3 yoksa eski kural
  });
});

describe('Belge Tara — sha256 istemcide', () => {
  it('base64 çözümü ve özet Node crypto ile bayt-eşit', () => {
    const b64 = jpeg('abc');
    expect(Buffer.from(base64ToBytes(b64))).toEqual(Buffer.from(b64, 'base64'));
    expect(photoSha256(b64)).toBe(createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex'));
    expect(photoSha256(`data:image/jpeg;base64,${b64}`)).toBe(photoSha256(b64));
  });
  it('bozuk base64 → hata (sessiz yanlış özet yok)', () => {
    expect(() => base64ToBytes('ab$c')).toThrow();
  });
  it('⭐ aynı fotoğraf iki kez → listeye bir kez girer (duplicate, sayfa no bildirilir)', () => {
    const p = page('x');
    const r1 = addPage([], p);
    expect(r1.kind).toBe('added');
    const r2 = addPage(r1.pages, { ...p, uri: 'file:///baska.jpg' });
    expect(r2).toMatchObject({ kind: 'duplicate', pageNo: 1 });
    expect(r2.pages).toHaveLength(1);
  });
  it('5 MB üstü fotoğraf eklenmez (sunucu 413 vermeden)', () => {
    const big = { ...page('y'), base64: 'A'.repeat(Math.ceil(((MAX_SCAN_BYTES + 10) * 4) / 3)) };
    expect(addPage([], big).kind).toBe('too-large');
  });
});

describe('Belge Tara — barkod', () => {
  it('⭐ barkod → senderDocNo: kırpılır, denetim baytı atılır, 64 sınırı; boş → null', () => {
    expect(barcodeToDocNo('  IRS-2026-0042 \n')).toBe('IRS-2026-0042');
    expect(barcodeToDocNo('A\u001dB')).toBe('AB');
    expect(barcodeToDocNo('9'.repeat(80))).toHaveLength(64);
    expect(barcodeToDocNo('   ')).toBeNull();
    expect(barcodeToDocNo(null)).toBeNull();
  });
});

describe('Belge Tara — gönderim (sahte API)', () => {
  it('⭐ çekim → yükleme → DRAFT: önce başlık (MANUAL, sahip, belge no, sayfa sayısı), sonra sayfalar noteId+pageNo ile', async () => {
    const f = fakeApi();
    const attempt = createAttemptToken();
    const pages = [page('a'), page('b')];
    const r = await submitDocScan(f.api, { pages, ownerCustomerId: 'c1', senderDocNo: 'IRS-1', barcodeText: 'IRS-1' }, attempt);
    expect(r).toEqual({ note: { id: 'note-1', noteNo: 'GB-1' }, uploaded: 2, duplicates: 0 });
    expect(f.createCalls).toHaveLength(1);
    expect(f.createCalls[0]).toMatchObject({ sourceKind: 'MANUAL', ownerCustomerId: 'c1', senderDocNo: 'IRS-1' });
    // pageCount kâğıttaki sayfa damgasıdır; foto sayısı (2) beyan yerine geçmez.
    expect(f.createCalls[0]).not.toHaveProperty('pageCount');
    expect(f.uploadCalls.map((u) => [u.noteId, u.pageNo, u.barcodeText])).toEqual([
      ['note-1', 1, 'IRS-1'],
      ['note-1', 2, 'IRS-1'],
    ]);
    expect(f.uploadCalls.every((u) => /^[0-9a-f]{64}$/.test(u.sha256))).toBe(true);
    expect(f.scans.size).toBe(2);
  });

  it('⭐ aynı fotoğraf iki kez gönderilse de sunucuda TEK tarama (istemci + sunucu özeti)', async () => {
    const f = fakeApi();
    const p = page('same');
    let pages: ScanPage[] = addPage([], p).pages;
    pages = addPage(pages, { ...p }).pages;
    await submitDocScan(f.api, { pages, ownerCustomerId: null, senderDocNo: null, barcodeText: null }, createAttemptToken());
    // Ayrı belge olarak ikinci kez gönderilse bile sunucu aynı kaydı döner.
    const r2 = await submitDocScan(f.api, { pages: [p], ownerCustomerId: null, senderDocNo: null, barcodeText: null }, createAttemptToken());
    expect(f.scans.size).toBe(1);
    expect(r2.duplicates).toBe(1);
  });

  it('yarıda düşen yükleme: yeniden denemede taslak İKİNCİ KEZ açılmaz, yüklenen sayfa atlanır', async () => {
    const f = fakeApi({ failUploadAt: 2 });
    const attempt = createAttemptToken();
    const input = { pages: [page('p1'), page('p2'), page('p3')], ownerCustomerId: null, senderDocNo: null, barcodeText: null };
    let progress;
    try {
      await submitDocScan(f.api, input, attempt);
      throw new Error('düşmeliydi');
    } catch (e) {
      expect(e).toBeInstanceOf(SubmitError);
      progress = (e as SubmitError).progress;
    }
    expect(progress.note).toEqual({ id: 'note-1', noteNo: 'GB-1' });
    expect([...progress.uploaded]).toHaveLength(1);
    const r = await submitDocScan(f.api, input, attempt, progress);
    expect(f.createCalls).toHaveLength(1);
    expect(f.uploadCalls.map((u) => u.pageNo)).toEqual([1, 2, 2, 3]);
    expect(r.uploaded).toBe(3);
    expect(f.notes.size).toBe(1);
  });

  it('başlık belirsiz hatada (5xx/ağ) token yapışır → sunucu replay aynı taslağı döner; kesin 4xx token düşürür', async () => {
    const f = fakeApi({ failCreate: { status: 503 } });
    const attempt = createAttemptToken();
    const input = { pages: [page('t')], ownerCustomerId: null, senderDocNo: null, barcodeText: null };
    await expect(submitDocScan(f.api, input, attempt)).rejects.toBeInstanceOf(SubmitError);
    await submitDocScan(f.api, input, attempt);
    expect(f.createCalls[0]!.clientToken).toBe(f.createCalls[1]!.clientToken);

    const g = fakeApi({ failCreate: { status: 400 } });
    const a2 = createAttemptToken();
    await expect(submitDocScan(g.api, input, a2)).rejects.toBeInstanceOf(SubmitError);
    await submitDocScan(g.api, input, a2);
    expect(g.createCalls[0]!.clientToken).not.toBe(g.createCalls[1]!.clientToken);
  });

  it('sayfa yokken gönderilmez', async () => {
    const f = fakeApi();
    await expect(submitDocScan(f.api, { pages: [], ownerCustomerId: null, senderDocNo: null, barcodeText: null }, createAttemptToken())).rejects.toThrow('En az bir sayfa');
    expect(f.createCalls).toHaveLength(0);
  });
});
