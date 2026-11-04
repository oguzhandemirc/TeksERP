// Çok çekimli kamera (saf): kalan yer, ekle/sil, "Tamam"da iyileştirilmiş → yoksa ham → bozuksa düşer; sıra korunur.
import { MAX_PAGES, photoSha256 } from './docScan';
import { addShot, finishShots, removeShot, shotCapacity, type Shot } from './captureSession';

const jpeg = (tag: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag.repeat(30))]).toString('base64');
const shot = (id: string): Shot => ({ id, uri: `file:///${id}.jpg`, base64: jpeg(id), width: 3000, height: 4000 });
const better = (id: string) => ({ uri: `file:///${id}-iyi.jpg`, base64: jpeg(`${id}-iyi`), width: 1950, height: 2600, bytes: 1 });

describe('shotCapacity', () => {
  it('belgedeki sayfalar + çekimler sınırı aşmaz', () => {
    expect(shotCapacity(0, 0)).toBe(MAX_PAGES);
    expect(shotCapacity(MAX_PAGES - 2, 1)).toBe(1);
    expect(shotCapacity(MAX_PAGES, 3)).toBe(0);
  });
});

describe('addShot / removeShot', () => {
  it('yer varken ekler; son yerde `full`', () => {
    const a = addShot([], shot('a'), 2);
    expect(a).toMatchObject({ added: true, full: false });
    const b = addShot(a.shots, shot('b'), 2);
    expect(b).toMatchObject({ added: true, full: true });
    expect(b.shots.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('yer yoksa liste değişmez', () => {
    const r = addShot([shot('a')], shot('b'), 1);
    expect(r).toMatchObject({ added: false, full: true });
    expect(r.shots.map((s) => s.id)).toEqual(['a']);
  });
  it('sil yalnız o çekimi çıkarır', () => {
    expect(removeShot([shot('a'), shot('b'), shot('c')], 'b').map((s) => s.id)).toEqual(['a', 'c']);
  });
});

describe('finishShots', () => {
  it('⭐ iyileştirilmiş hâl gider (özet gönderilecek bayttan); sıra çekim sırası', async () => {
    const r = await finishShots([shot('a'), shot('b')], async (s) => better(s.id));
    expect(r.pages.map((p) => p.uri)).toEqual(['file:///a-iyi.jpg', 'file:///b-iyi.jpg']);
    expect(r.pages[0]!.sha256).toBe(photoSha256(jpeg('a-iyi')));
    expect([r.plain, r.dropped]).toEqual([0, 0]);
  });
  it('⭐ iyileştirme yok/hata → ham fotoğraf gider (tarama durmaz)', async () => {
    const r = await finishShots([shot('a'), shot('b')], async (s) => {
      if (s.id === 'a') return null;
      throw new Error('native');
    });
    expect(r.pages.map((p) => p.uri)).toEqual(['file:///a.jpg', 'file:///b.jpg']);
    expect(r.plain).toBe(2);
  });
  it('bozuk çekim düşer, diğerleri gider', async () => {
    const bad = { ...shot('x'), base64: '###' };
    const r = await finishShots([bad, shot('a')], async () => null);
    expect(r.pages.map((p) => p.uri)).toEqual(['file:///a.jpg']);
    expect(r.dropped).toBe(1);
  });
  it('ilerleme 0..n bildirilir', async () => {
    const seen: string[] = [];
    await finishShots([shot('a'), shot('b')], async () => null, (d, t) => seen.push(`${d}/${t}`));
    expect(seen).toEqual(['0/2', '1/2', '2/2']);
  });
});
