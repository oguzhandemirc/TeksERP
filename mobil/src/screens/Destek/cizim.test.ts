import {
  BOS_CIZIM,
  cizimReducer,
  dikdortgen,
  kalemYolu,
  okYolu,
  sigdir,
  uzunKenaraSigdir,
  type DrawingState,
  type CizimEylemi,
} from './cizim';

const uygula = (d: DrawingState, ...e: CizimEylemi[]) => e.reduce(cizimReducer, d);
const kutu = (x0: number, y0: number, x1: number, y1: number): CizimEylemi[] => [
  { tip: 'basla', arac: 'kutu', renk: 'kirmizi', nokta: { x: x0, y: y0 } },
  { tip: 'ilerle', nokta: { x: x1, y: y1 } },
  { tip: 'bitir' },
];

describe('çizim durumu', () => {
  it('bitmiş şekil listeye girer, aktif boşalır', () => {
    const d = uygula(BOS_CIZIM, ...kutu(10, 10, 100, 80));
    expect(d.sekiller).toHaveLength(1);
    expect(d.aktif).toBeNull();
    expect(d.sekiller[0].noktalar).toEqual([{ x: 10, y: 10 }, { x: 100, y: 80 }]);
  });

  it('geri al YALNIZ son şekli siler', () => {
    const d = uygula(BOS_CIZIM, ...kutu(0, 0, 50, 50), ...kutu(60, 60, 120, 120), { tip: 'geriAl' });
    expect(d.sekiller).toHaveLength(1);
    expect(d.sekiller[0].noktalar[0]).toEqual({ x: 0, y: 0 });
  });

  it('boşken geri al çökmez, durum boş kalır', () => {
    expect(uygula(BOS_CIZIM, { tip: 'geriAl' }).sekiller).toEqual([]);
  });

  it('temizle hepsini ve yarım şekli siler', () => {
    const d = uygula(
      BOS_CIZIM,
      ...kutu(0, 0, 50, 50),
      ...kutu(60, 60, 120, 120),
      { tip: 'basla', arac: 'kalem', renk: 'mavi', nokta: { x: 1, y: 1 } },
      { tip: 'temizle' },
    );
    expect(d.sekiller).toEqual([]);
    expect(d.aktif).toBeNull();
  });

  it('tek dokunuş / çok küçük kutu eklenmez (yanlışlıkla dokunma)', () => {
    expect(uygula(BOS_CIZIM, ...kutu(10, 10, 12, 40)).sekiller).toHaveLength(0);
    const tek = uygula(
      BOS_CIZIM,
      { tip: 'basla', arac: 'kalem', renk: 'sari', nokta: { x: 5, y: 5 } },
      { tip: 'bitir' },
    );
    expect(tek.sekiller).toHaveLength(0);
  });

  it('kalem izi noktaları biriktirir, ok/kutu yalnız iki uç tutar', () => {
    const kalem = uygula(
      BOS_CIZIM,
      { tip: 'basla', arac: 'kalem', renk: 'yesil', nokta: { x: 0, y: 0 } },
      { tip: 'ilerle', nokta: { x: 10, y: 0 } },
      { tip: 'ilerle', nokta: { x: 10.5, y: 0 } },
      { tip: 'ilerle', nokta: { x: 20, y: 5 } },
      { tip: 'bitir' },
    );
    expect(kalem.sekiller[0].noktalar).toHaveLength(3);
    const ok = uygula(
      BOS_CIZIM,
      { tip: 'basla', arac: 'ok', renk: 'kirmizi', nokta: { x: 0, y: 0 } },
      { tip: 'ilerle', nokta: { x: 30, y: 0 } },
      { tip: 'ilerle', nokta: { x: 60, y: 40 } },
      { tip: 'bitir' },
    );
    expect(ok.sekiller[0].noktalar).toEqual([{ x: 0, y: 0 }, { x: 60, y: 40 }]);
  });

  it('şekil kimlikleri geri almadan sonra da çakışmaz', () => {
    const d = uygula(BOS_CIZIM, ...kutu(0, 0, 50, 50), { tip: 'geriAl' }, ...kutu(0, 0, 50, 50));
    expect(d.sekiller[0].id).toBe(2);
  });
});

describe('geometri', () => {
  it('dikdörtgen sürükleme yönünden bağımsızdır', () => {
    expect(dikdortgen({ x: 100, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 90, h: 60 });
  });

  it('kalem yolu M ile başlar, L ile sürer', () => {
    expect(kalemYolu([{ x: 1, y: 2 }, { x: 3.333, y: 4 }])).toBe('M1 2 L3.3 4');
  });

  it('ok yolu gövde + iki kanat içerir', () => {
    expect(okYolu({ x: 0, y: 0 }, { x: 100, y: 0 }).match(/M/g)).toHaveLength(2);
  });

  it('uzun kenar 1920 px sınırına iner, oran korunur; küçük görüntü büyütülmez', () => {
    expect(uzunKenaraSigdir(2560, 1600)).toEqual({ width: 1920, height: 1200 });
    expect(uzunKenaraSigdir(1600, 2560)).toEqual({ width: 1200, height: 1920 });
    expect(uzunKenaraSigdir(480, 800)).toEqual({ width: 480, height: 800 });
    expect(uzunKenaraSigdir(0, 800)).toEqual({ width: 0, height: 0 });
  });

  it('tuval kaba oran bozulmadan sığar', () => {
    expect(sigdir(1920, 1200, 960, 960)).toEqual({ width: 960, height: 600 });
    expect(sigdir(480, 800, 480, 400)).toEqual({ width: 240, height: 400 });
  });
});
