// "Sayfa çek" yönlendirmesi + tarayıcı sonucu → ScanPage dönüşümü (sha256 · boyut tavanı · sayfa sınırı).
import { MAX_PAGES, MAX_SCAN_BYTES, addPages, photoSha256, scannedToScanPage, scannerPageLimit, type ScanPage } from './docScan';
import { acquirePages } from './pageSource';

const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag.repeat(30))]).toString('base64');
const raw = (tag: string) => ({ uri: `file:///${tag}.jpg`, base64: jpeg(tag), width: 1950, height: 2600, bytes: 1 });

describe('acquirePages', () => {
  it('unavailable → kamera (hatasız)', async () => {
    await expect(acquirePages(0, async () => ({ kind: 'unavailable', reason: 'module_missing' }))).resolves.toEqual({ route: 'camera' });
  });
  it('error → kamera + ileti', async () => {
    await expect(acquirePages(0, async () => ({ kind: 'error', message: 'boom' }))).resolves.toEqual({ route: 'camera', error: 'boom' });
  });
  it('canceled → hiçbir şey', async () => {
    await expect(acquirePages(0, async () => ({ kind: 'canceled' }))).resolves.toEqual({ route: 'none' });
  });
  it('liste dolu → tarayıcı hiç açılmaz', async () => {
    const scan = jest.fn();
    await expect(acquirePages(MAX_PAGES, scan)).resolves.toEqual({ route: 'none' });
    expect(scan).not.toHaveBeenCalled();
  });
  it('⭐ sayfalar → ScanPage (sha256 ham bayttan), sayfa sınırından fazlası kesilir', async () => {
    const scan = jest.fn(async () => ({ kind: 'pages' as const, pages: [raw('a'), raw('b'), raw('c')] }));
    const r = await acquirePages(MAX_PAGES - 2, scan);
    expect(scan).toHaveBeenCalledWith(expect.objectContaining({ pageLimit: 2, longEdge: 2600, maxBytes: MAX_SCAN_BYTES, quality: 0.8 }));
    expect(r.route).toBe('pages');
    const pages = (r as { pages: ScanPage[] }).pages;
    expect(pages.map((p) => p.uri)).toEqual(['file:///a.jpg', 'file:///b.jpg']);
    expect(pages[0]).toEqual({ base64: jpeg('a'), sha256: photoSha256(jpeg('a')), uri: 'file:///a.jpg', width: 1950, height: 2600 });
    expect(pages[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('bozuk base64 tek sayfayı düşürür; hepsi bozuksa kameraya düşer', async () => {
    const bad = { ...raw('x'), base64: '###' };
    const r = await acquirePages(0, async () => ({ kind: 'pages', pages: [bad, raw('a')] }));
    expect(r).toMatchObject({ route: 'pages', pages: [{ uri: 'file:///a.jpg' }] });
    await expect(acquirePages(0, async () => ({ kind: 'pages', pages: [bad] }))).resolves.toMatchObject({ route: 'camera' });
  });
});

describe('addPages / scannerPageLimit', () => {
  it('kalan yer', () => {
    expect(scannerPageLimit(0)).toBe(MAX_PAGES);
    expect(scannerPageLimit(MAX_PAGES - 1)).toBe(1);
    expect(scannerPageLimit(MAX_PAGES + 3)).toBe(0);
  });
  it('⭐ aynı özet · 5 MB tavanı · sayfa sınırı ayrı ayrı sayılır', () => {
    const a = scannedToScanPage(raw('a'));
    const big = { ...scannedToScanPage(raw('big')), base64: 'A'.repeat(Math.ceil(((MAX_SCAN_BYTES + 10) * 4) / 3)) };
    const full = Array.from({ length: MAX_PAGES - 2 }, (_, i) => scannedToScanPage(raw(`f${i}`)));
    const r = addPages(full, [a, a, big, scannedToScanPage(raw('b')), scannedToScanPage(raw('c'))]);
    expect(r).toMatchObject({ added: 2, duplicates: 1, tooLarge: 1, overflow: 1 });
    expect(r.pages).toHaveLength(MAX_PAGES);
  });
});
