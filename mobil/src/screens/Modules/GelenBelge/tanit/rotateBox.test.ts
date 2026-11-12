import { normTurns, rotateBox, rotatedSize } from './rotateBox';

// 100×50 görüntü; kutu sol üstte (10,5) 20×8.
const W = 100, H = 50;
const B = { x: 10, y: 5, width: 20, height: 8 };

describe('rotateBox', () => {
  it('0 çeyrek: aynı kutu', () => expect(rotateBox(B, W, H, 0)).toEqual(B));
  it('1 çeyrek (90° saat yönü): sol üst → sağ üst, en/boy yer değiştirir', () => {
    expect(rotateBox(B, W, H, 1)).toEqual({ x: 50 - 5 - 8, y: 10, width: 8, height: 20 });
  });
  it('2 çeyrek: sağ alt', () => expect(rotateBox(B, W, H, 2)).toEqual({ x: 70, y: 37, width: 20, height: 8 }));
  it('3 çeyrek: sol alt', () => expect(rotateBox(B, W, H, 3)).toEqual({ x: 5, y: 70, width: 8, height: 20 }));
  it('dönmüş kutu dönmüş çerçevenin içinde kalır', () => {
    for (const q of [0, 1, 2, 3]) {
      const r = rotateBox(B, W, H, q), s = rotatedSize(W, H, q);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(s.width);
      expect(r.y + r.height).toBeLessThanOrEqual(s.height);
    }
  });
  it('gidiş-dönüş: q sonra (4−q) aynı kutuyu verir; dört kez 1 çeyrek = özdeş', () => {
    for (const q of [0, 1, 2, 3]) {
      const s = rotatedSize(W, H, q);
      expect(rotateBox(rotateBox(B, W, H, q), s.width, s.height, 4 - q)).toEqual(B);
    }
    let b = B, w = W, h = H;
    for (let i = 0; i < 4; i++) {
      b = rotateBox(b, w, h, 1);
      [w, h] = [h, w];
    }
    expect(b).toEqual(B);
  });
  it('normTurns negatif/4+ katlar', () => {
    expect(normTurns(-1)).toBe(3);
    expect(normTurns(5)).toBe(1);
    expect(rotateBox(B, W, H, 5)).toEqual(rotateBox(B, W, H, 1));
  });
});
