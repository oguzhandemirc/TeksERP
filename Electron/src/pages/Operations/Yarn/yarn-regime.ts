// =============================================================================
// İPLİK KG-STOK — GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// NEDEN SAF FONKSİYON: iplik defteri kendi modülüdür (`iplik.enabled`, TİCARET'e
// bağımlı). Üretici fabrikada anahtar KAPALIDIR ve bu ekran hiçbir yerde
// görünmemelidir ("sıfır görünür fark" kuralı). Kural bir bileşenin içindeki `&&` zinciri olarak
// bırakılsaydı tersine çevrilmesi HİÇBİR TESTİ KIRMAZDI — projenin yazılı
// deseni bu yüzden saf yüklem: `canQuickShip`, `resolveRollTabs`,
// `orders-regime.ts`. Bekçi: `yarn-regime.test.ts`.
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR. Erişimin kapısı İZİNDİR (`warehouse:read` /
// `yarn:write`) ve asıl sed BACKEND'dedir: `yarn.routes.ts` her uçta ÖNCE
// `requireIplikEnabled` (o da içinde ÖNCE ticareti ölçer), sonra
// `requirePermission` uygular. Buradaki kural
// yalnız "menüde çizilsin mi" sorusunu cevaplar; adres çubuğundan girilen route
// çalışmaya devam eder ve veri yine backend kapısına takılır.
//
// ⚠️ BELİRSİZKEN (bayrak henüz yüklenmedi) FALSE'a düşülür. Yön bilinçli:
// fabrikada bir an için karo belirip kaybolması "sıfır fark" garantisini
// gözle görülür biçimde bozardı; ticaret kurulumunda ise kaybedilen şey yalnız
// kısa bir gecikmedir. `useOperationsVisibilityContext` zaten `?? false` yapar.
// =============================================================================

/**
 * Karo yükleminin ihtiyaç duyduğu ALAN — `OperationsVisibilityContext`in
 * tamamı DEĞİL.
 *
 * Dar tutulması bilinçli: yapısal tipleme sayesinde tile-config'in geniş
 * bağlamı bu şekli sağlar (`visibleWhen: (ctx) => isYarnStockVisible(ctx)`),
 * ama bu dosya karo bağlamına bağımlı olmaz ve bekçisi tek satırla kurulur.
 */
export interface YarnVisibilityContext {
  /**
   * İplik modülü — ETKİN değer (`ticaret && iplik`). Bağımlılık zinciri BURADA
   * KURULMAZ: tek çözüm noktası `useOperationsVisibilityContext`tir. Burada
   * `ctx.ticaretEnabled && ctx.iplikEnabled` yazmak zinciri ikinci bir yere
   * kopyalamak olurdu — iki kopya bir gün ayrışır.
   */
  iplikEnabled: boolean;
}

/** İplik kg-stok karosu/menü satırı çizilsin mi? */
export function isYarnStockVisible(ctx: YarnVisibilityContext): boolean {
  return ctx.iplikEnabled;
}
