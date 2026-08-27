import {
  MODAL_TAVAN,
  damgalanacakId,
  gosterilecekYayinlar,
  type SurumNotuYayini,
} from './surumNotlari';

/** Electron ikizindeki senaryoların aynısı — davranış iki üründe de aynı olmalı. */
function y(
  id: string,
  tablet?: string,
  kapsamlar: Array<'panel' | 'tablet' | 'her-ikisi'> = ['her-ikisi'],
): SurumNotuYayini {
  return {
    id,
    baslik: `Yayın ${id}`,
    surumler: { panel: '1.0.0', ...(tablet ? { tablet } : {}) },
    maddeler: kapsamlar.map((k) => ({ kapsam: k, tip: 'yeni' as const, metin: `${k} maddesi` })),
  };
}

const YAYINLAR: SurumNotuYayini[] = [
  y('2026-09-10', '3.0.0'),
  y('2026-09-01', undefined, ['panel']), // yalnız panel turu
  y('2026-08-28', '2.9.9'),
  y('2026-08-20', '2.9.5'),
];

describe('sürüm notları — gösterim kararı (tablet)', () => {
  it('ilk kurulumda YALNIZ en yeni kayıt gösterilir', () => {
    const { liste, gizlenen } = gosterilecekYayinlar(YAYINLAR, null, '3.0.0');
    expect(liste).toHaveLength(1);
    expect(liste[0]!.id).toBe('2026-09-10');
    expect(gizlenen).toBe(0);
  });

  it('sürüm atlayan cihaz aradaki tüm yayınları görür', () => {
    const { liste } = gosterilecekYayinlar(YAYINLAR, '2026-08-20', '3.0.0');
    expect(liste.map((v) => v.id)).toEqual(['2026-09-10', '2026-08-28']);
  });

  it('kurulu sürümü aşan kayıt gösterilmez', () => {
    const { liste } = gosterilecekYayinlar(YAYINLAR, '2026-08-20', '2.9.9');
    expect(liste.map((v) => v.id)).toEqual(['2026-08-28']);
  });

  it('geri alma (işaret ileride) → boş, çökme yok', () => {
    const { liste } = gosterilecekYayinlar(YAYINLAR, '2026-12-31', '3.0.0');
    expect(liste).toHaveLength(0);
  });

  it('tablette çıkmamış tur sayılmaz', () => {
    // 2026-09-01 yalnız panel turu → tablette hiç görünmez.
    const { liste } = gosterilecekYayinlar(YAYINLAR, '2026-08-28', '3.0.0');
    expect(liste.map((v) => v.id)).toEqual(['2026-09-10']);
  });

  it('kapsam süzülür: tablet, panel maddesini görmez', () => {
    const karisik = [y('2026-10-01', '3.0.0', ['panel', 'tablet', 'her-ikisi'])];
    const { liste } = gosterilecekYayinlar(karisik, '2026-01-01', '3.0.0');
    expect(liste[0]!.maddeler.map((m) => m.kapsam)).toEqual(['tablet', 'her-ikisi']);
  });

  it('maddesi kalmayan yayın listeye girmez', () => {
    const sadecePanel = [y('2026-10-01', '3.0.0', ['panel'])];
    const { liste } = gosterilecekYayinlar(sadecePanel, '2026-01-01', '3.0.0');
    expect(liste).toHaveLength(0);
  });

  it('tavan aşılırsa fazlası gizlenen olarak raporlanır', () => {
    const cok = Array.from({ length: 9 }, (_, i) =>
      y(`2026-09-${String(20 - i).padStart(2, '0')}`, '3.0.0'),
    );
    const { liste, gizlenen } = gosterilecekYayinlar(cok, '2026-01-01', '3.0.0');
    expect(liste).toHaveLength(MODAL_TAVAN);
    expect(gizlenen).toBe(9 - MODAL_TAVAN);
  });

  it('sürüm karşılaştırması SAYISAL — 2.10.0 > 2.9.0', () => {
    const v = [y('2026-10-01', '2.10.0'), y('2026-09-01', '2.9.0')];
    // Kurulu 2.9.0 iken 2.10.0'lık kayıt AŞAN sayılmalı (sözlüksel olsaydı tersi olurdu).
    const { liste } = gosterilecekYayinlar(v, '2026-01-01', '2.9.0');
    expect(liste.map((x) => x.id)).toEqual(['2026-09-01']);
  });
});

describe('damgalanacakId', () => {
  it('kurulu sürümü aşmayan en yeni yayını işaret eder', () => {
    expect(damgalanacakId(YAYINLAR, '2.9.9')).toBe('2026-08-28');
    expect(damgalanacakId(YAYINLAR, '3.0.0')).toBe('2026-09-10');
  });

  it('sürüm bilinmiyorsa damga atılmaz', () => {
    expect(damgalanacakId(YAYINLAR, null)).toBeNull();
  });
});
