// =============================================================================
// MAL KABUL — GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// NEDEN BU DOSYA 2026-09-03'TE DOĞDU: karo ile backend kapısı CANLI OLARAK
// AYRIŞMIŞTI. `goods-receipt.routes.ts` 2026-09-02'den beri `router.use(
// verifyToken, requireTicaretEnabled)` taşıyor; karo ise hâlâ kapısızdı ve
// yorumunda "kapı İZİNDİR" yazıyordu. Adnan Şahin'de görünmüyordu (izin hiçbir
// varsayılan rolde yok) ama ticaret İZNİ verilmiş / ticaret modülü KAPALI ilk
// kurulumda somut arıza şudur: kullanıcı karoyu görür, tıklar, 403 alır ve
// sebebi hiçbir yerde yazmaz. `test_screen_catalog` bunu `KARO_BEKLEYEN`
// muafında "P5'te bağlanır" diye park etmişti — bu dosya o parkı kapatır.
//
// ⚠️ İZİN KAPISI KALKMADI, ÜSTÜNE EKLENDİ. `goods-receipt:read` karonun
// `permission` alanında durmaya devam eder: rejim "bu KURULUM ticaret paketini
// kullanıyor mu", izin "bu KİŞİ mal kabul yapabilir mi" sorusudur ve ikisi
// birbirinin yerine geçmez (`ItemPrices/regime.ts` başlığındaki iki-kapı notu).
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR — asıl sed backend'dedir. Buradaki kural
// yalnız "hub'da/palette çizilsin mi" sorusunu cevaplar; adres çubuğundan
// girilen route çalışmaya devam eder ve veri yine backend kapısına takılır.
//
// ⚠️ BELİRSİZKEN (bayrak henüz yüklenmedi) FALSE'a düşülür — `po-regime` /
// `yarn-regime` ile aynı yön: fabrikada bir an için karo belirip kaybolması
// "sıfır görünür fark" garantisini gözle görülür biçimde bozar; ticaret
// kurulumunda kaybedilen tek şey kısa bir gecikmedir.
//
// ⚠️ `depoMultiEnabled` ŞARTI KONMAZ ve bu eski karar KORUNUYOR: tek depolu bir
// alım-satım firması da mal kabul kullanır.
// =============================================================================

/**
 * Yüklemin ihtiyaç duyduğu ALAN — `OperationsVisibilityContext`in tamamı DEĞİL.
 * Dar tutulması bilinçli: yapısal tipleme sayesinde karo bağlamı bu şekli
 * sağlar, ama bu dosya karo bağlamına bağımlı olmaz ve bekçisi tek satırla
 * kurulur.
 */
export interface GoodsReceiptVisibilityContext {
  /** `ticaret.enabled` — ticaret modülü (ön muhasebeden BAĞIMSIZ). */
  ticaretEnabled: boolean;
}

/** Mal Kabul karosu / komut paleti girişi çizilsin mi? */
export function isGoodsReceiptVisible(ctx: GoodsReceiptVisibilityContext): boolean {
  return ctx.ticaretEnabled;
}
