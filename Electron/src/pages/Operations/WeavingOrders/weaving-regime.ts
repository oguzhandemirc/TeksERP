// =============================================================================
// DOKUMA İŞLERİ — GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// Dokuma işi kendi modülüdür (`dokuma.enabled`, ÜRETİME bağımlı; tezgah izlemenin
// KARDEŞİ). Referans fabrikada anahtar KAPALIDIR ve bu ekran hiçbir yerde
// görünmemelidir ("sıfır görünür fark"). Kural bileşen içi `&&` zinciri olsaydı
// tersine çevrilmesi hiçbir testi kırmazdı — projenin yazılı deseni saf yüklem
// (`yarn-regime.ts` · `production-regime.ts`). Bekçi: `weaving-regime.test.ts`
// + backend `test_dokuma_regime_gate §7d` (yüklemin `dokumaEnabled` okuduğunu
// metinden ölçer).
//
// ⚠️ YETKİ DUVARI DEĞİL: erişimin kapısı İZİNDİR (`weavingorder:read/write`),
// asıl sed BACKEND'dedir (`requireDokumaEnabled`, üç router). Burası yalnız
// "karo çizilsin mi" sorusunu cevaplar.
//
// ⚠️ BELİRSİZKEN FALSE — bağlamı kuran `useOperationsVisibilityContext` zinciri
// (`production && dokuma`) çözer ve `?? false` yapar; burada zincir KURULMAZ.
// =============================================================================

/** Karo yükleminin ihtiyaç duyduğu ALAN — bağlamın tamamı değil (yapısal tip). */
export interface WeavingVisibilityContext {
  /** Dokuma işi modülü — ETKİN değer (`production && dokuma`). */
  dokumaEnabled: boolean;
}

/** Dokuma İşleri karosu / palet girişi çizilsin mi? */
export function isWeavingOrdersVisible(ctx: WeavingVisibilityContext): boolean {
  return ctx.dokumaEnabled;
}
