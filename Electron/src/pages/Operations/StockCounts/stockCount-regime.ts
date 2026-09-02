// =============================================================================
// TAM STOK SAYIMI — GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// NEDEN SAF FONKSİYON: stok sayımı TİCARET modülüne aittir (`ticaret.enabled`;
// 2026-09-02'ye kadar `finance.enabled`'a asılıydı). Üretici fabrikada anahtar
// KAPALIDIR ve bu ekran orada HİÇ çizilmemelidir ("sıfır görünür fark" kuralı). Kural bir bileşenin içindeki `&&` zinciri olarak
// bırakılsaydı tersine çevrilmesi HİÇBİR TESTİ KIRMAZDI — projenin yazılı
// deseni bu yüzden saf yüklem: `canQuickShip`, `isYarnStockVisible`,
// `isPurchaseOrdersVisible`. Bekçi: `stockCount-regime.test.ts`.
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR. Erişimin kapısı İZİNDİR (`warehouse:read` /
// `warehouse:transfer` / `roll:manual-adjust` + `yarn:write`) ve asıl sed
// BACKEND'dedir: `stock-count.routes.ts` router'ın tamamına önce
// `requireTicaretEnabled`, sonra uç bazında `requirePermission` uygular.
// Buradaki kural yalnız "menüde/palette çizilsin mi" sorusunu cevaplar; adres
// çubuğundan girilen route çalışmaya devam eder ve veri yine backend kapısına
// takılır.
//
// ⚠️ BELİRSİZKEN (bayrak henüz yüklenmedi) FALSE'a düşülür — `isYarnStockVisible`
// ile aynı yön: fabrikada bir an için karo belirip kaybolması "sıfır fark"
// garantisini gözle görülür biçimde bozardı; ticaret kurulumunda kaybedilen tek
// şey kısa bir gecikmedir. `useOperationsVisibilityContext` zaten `?? false` yapar.
// =============================================================================

/**
 * Karo yükleminin ihtiyaç duyduğu ALAN — `OperationsVisibilityContext`in
 * tamamı DEĞİL.
 *
 * Dar tutulması bilinçli: yapısal tipleme sayesinde tile-config'in geniş
 * bağlamı bu şekli sağlar (`visibleWhen: isStockCountVisible`), ama bu dosya
 * karo bağlamına bağımlı olmaz ve bekçisi tek satırla kurulur.
 */
export interface StockCountVisibilityContext {
  /** `ticaret.enabled` — ticaret modülü (ön muhasebeden BAĞIMSIZ). */
  ticaretEnabled: boolean;
}

/** Stok Sayımı karosu / menü satırı / palet girişi çizilsin mi? */
export function isStockCountVisible(ctx: StockCountVisibilityContext): boolean {
  return ctx.ticaretEnabled;
}

/**
 * Route yolları TEK KAYNAKTAN.
 *
 * ⚠️ Liste ile detay AYRI route'lardır ve ikisi de `content-routes.tsx`e
 * eklenmek zorundadır (dikiş). Yolları burada tutmanın sebebi, dikişi atan
 * kişinin ekranla AYNI metni kullanması: elle yazılan ikinci bir "/operations/
 * stock-counts" satırı, bir harf farkla listeden detaya gidilemeyen (ve hata
 * vermeyen — router `*` altında hub'a atar) bir ekran üretirdi.
 */
export const STOCK_COUNTS_PATH = "/operations/stock-counts";

/** Tek sayımın tam-sayfa detayı (`operations/stock-counts/:id`). */
export function stockCountPath(id: string): string {
  return `${STOCK_COUNTS_PATH}/${id}`;
}
