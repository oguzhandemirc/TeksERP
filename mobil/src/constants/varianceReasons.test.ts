// =============================================================================
// Test: sapma sebebi kataloğu (mobil ayna) — 2026-08-09
// =============================================================================
// Bu dosya backend `Teks-Erp/src/constants/variance-reasons.ts`'in AYNASIDIR ve
// ayrışması DERLEME HATASI VERMEZ. Backend bekçisi
// (`scripts/test_roll_variance.ts` §5) iki listenin birebirliğini dosyayı
// okuyarak doğrular; burada ise EKRAN sözleşmesi test edilir:
//
//   • "Kaydet" ne zaman açılır (sebep seçilmeden AÇILMAMALI)
//   • "Diğer" seçilince serbest metin ZORUNLU olur
//   • `keep_*` kararlarında sebep HİÇ sorulmaz (tek dokunuş korunur)
//
// Neden ayrı test: geçerlilik kuralı ekranda bir `disabled` ifadesine gömülü
// olsaydı, tersine çevrilmesi hiçbir testi kırmazdı.
// =============================================================================
import {
  SCRAP_REASONS,
  RECORD_CORRECTION_REASONS,
  reasonsForAction,
  isVarianceReasonValid,
  VARIANCE_MIN_REASON_TEXT,
} from './varianceReasons';

describe('sapma sebebi kataloğu', () => {
  it('keep_* kararları sebep İSTEMEZ (tek dokunuş korunur)', () => {
    expect(reasonsForAction('keep_1kalite')).toHaveLength(0);
    expect(reasonsForAction('keep_a1')).toHaveLength(0);
    // Sebepsiz de geçerli sayılmalı — yoksa "1. Kalite Top Yap" butonu
    // sonsuza dek kapalı kalırdı.
    expect(isVarianceReasonValid('keep_1kalite', null, null)).toBe(true);
  });

  it('fire ve kayıt düzeltmesi AYRI kataloglar kullanır', () => {
    const scrap = reasonsForAction('scrap').map((r) => r.code);
    const corr = reasonsForAction('discard').map((r) => r.code);
    expect(scrap).toEqual(SCRAP_REASONS.map((r) => r.code));
    expect(corr).toEqual(RECORD_CORRECTION_REASONS.map((r) => r.code));
    // "Diğer" dışında ortak kod OLMAMALI: kovaların karışması fire oranını
    // sistematik olarak şişirir (bkz. backend RollVarianceKind notu).
    const shared = scrap.filter((c) => corr.includes(c) && c !== 'DIGER');
    expect(shared).toEqual([]);
  });

  it('sebep seçilmeden geçerli DEĞİL', () => {
    expect(isVarianceReasonValid('scrap', null, null)).toBe(false);
    expect(isVarianceReasonValid('discard', null, null)).toBe(false);
  });

  it('katalog dışı kod reddedilir', () => {
    expect(isVarianceReasonValid('scrap', 'UYDURMA', null)).toBe(false);
    // Fire kodu kayıt düzeltmesinde geçerli DEĞİL.
    expect(isVarianceReasonValid('discard', 'LEKE', null)).toBe(false);
  });

  it('geçerli kod tek başına yeter', () => {
    expect(isVarianceReasonValid('scrap', 'LEKE', null)).toBe(true);
    expect(isVarianceReasonValid('discard', 'OLCUM_HATASI', null)).toBe(true);
  });

  it('"Diğer" seçilince açıklama zorunlu ve alt sınırı var', () => {
    expect(isVarianceReasonValid('scrap', 'DIGER', null)).toBe(false);
    expect(isVarianceReasonValid('scrap', 'DIGER', '  ')).toBe(false);
    expect(isVarianceReasonValid('scrap', 'DIGER', 'ab')).toBe(false);
    expect(isVarianceReasonValid('scrap', 'DIGER', 'abc')).toBe(true);
    expect(VARIANCE_MIN_REASON_TEXT).toBe(3);
  });

  it('körlük zemini: kataloglar gerçekten dolu', () => {
    // Liste boşalırsa yukarıdaki "reddedilir" kontrolleri VAKUMEN yeşil kalırdı.
    expect(SCRAP_REASONS.length).toBeGreaterThanOrEqual(5);
    expect(RECORD_CORRECTION_REASONS.length).toBeGreaterThanOrEqual(4);
    // Her katalogda tam BİR serbest-metin seçeneği olmalı.
    expect(SCRAP_REASONS.filter((r) => r.requiresText)).toHaveLength(1);
    expect(RECORD_CORRECTION_REASONS.filter((r) => r.requiresText)).toHaveLength(1);
  });
});
