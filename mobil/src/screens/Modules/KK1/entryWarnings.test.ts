import { buildEntryWarningToast } from './entryWarnings';

describe('entryWarnings — KK1 kayıt uyarıları (Faz 4)', () => {
  it('uyarı yoksa null (bugünkü davranış: ek toast yok)', () => {
    expect(buildEntryWarningToast(undefined, 'T1', true)).toBeNull();
    expect(buildEntryWarningToast([], 'T1', true)).toBeNull();
    expect(buildEntryWarningToast(['  '], 'T1', true)).toBeNull();
  });
  it('⭐ metin sunucudan OLDUĞU GİBİ (yeniden yazılmaz), birden çok uyarı " · " ile birleşir', () => {
    const t = buildEntryWarningToast(['LV1: çözgü kartında take-up yok — çözgü = kumaş sayıldı (100 m, tahmin).', 'LV2: kalan 0 m — 50 m tüketim yazılamadı (levent bitmiş olabilir; elle düzeltin).'], 'T050926H0001', true);
    expect(t?.text1).toBe('Kaydedildi ✓ — T050926H0001 — uyarı');
    expect(t?.text2).toBe('LV1: çözgü kartında take-up yok — çözgü = kumaş sayıldı (100 m, tahmin). · LV2: kalan 0 m — 50 m tüketim yazılamadı (levent bitmiş olabilir; elle düzeltin).');
  });
  it('geciken (kuyruktan flush) kayıtta başlık "Kaydedildi" DEMEZ, barkodla uyarır', () => {
    expect(buildEntryWarningToast(['x'], 'T1', false)?.text1).toBe('T1 — levent uyarısı');
    expect(buildEntryWarningToast(['x'], null, false)?.text1).toBe('levent uyarısı');
  });
});
