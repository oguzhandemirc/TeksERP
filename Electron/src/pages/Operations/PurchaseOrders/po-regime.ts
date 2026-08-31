// =============================================================================
// ALIŞ SİPARİŞİ — GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// NEDEN AYRI BİR MODÜL ve neden SATIR İÇİ OK FONKSİYONU DEĞİL:
//
// ① SAF KATMAN KURALI — alış siparişi TİCARET paketine aittir. Üretici
//    fabrikada `finance.enabled` KAPALIDIR ve bu ekran hiçbir yerde
//    görünmemelidir ("sıfır görünür fark"). Kural bir bileşenin içindeki `&&`
//    zinciri olarak bırakılsaydı tersine çevrilmesi HİÇBİR TESTİ KIRMAZDI;
//    projenin yazılı deseni bu yüzden saf yüklem (`canQuickShip`,
//    `resolveRollTabs`, `orders-regime.ts`, `yarn-regime.ts`).
//
// ② KİMLİK KURALI — `tile-visibility.test.ts` karo ile komut paleti girişinin
//    AYNI FONKSİYON NESNESİNİ taşıdığını `toBe` ile doğrular. İki yerde ayrı
//    ayrı yazılmış `(ctx) => ctx.financeEnabled` ok fonksiyonları DAVRANIŞÇA
//    aynı ama KİMLİKÇE farklıdır → test kırmızı verir. Daha önemlisi: kimlik
//    testinin var olma sebebi, iki kopyanın bir gün AYRIŞMASIDIR (karo gizlenir,
//    palet girişi kalır → paletten seçen kullanıcı hub'a atılır; "Kurşun
//    Sırası"nda somut olarak yaşandı).
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR. Erişimin kapısı İZİNDİR
// (`purchase-order:read` / `:write`) ve asıl sed BACKEND'dedir:
// `purchase-order.routes.ts` her uçta ÖNCE `requireFinanceEnabled`, sonra
// `requirePermission` uygular. Buradaki kural yalnız "menüde çizilsin mi"
// sorusunu cevaplar.
//
// ⚠️ BELİRSİZKEN (bayrak henüz yüklenmedi) FALSE'a düşülür — `yarn-regime` ile
// aynı yön: fabrikada bir an için karo belirip kaybolması "sıfır fark"
// garantisini gözle görülür biçimde bozar; ticaret kurulumunda kaybedilen şey
// yalnız kısa bir gecikmedir.
// =============================================================================

/**
 * Yüklemin ihtiyaç duyduğu ALAN — `OperationsVisibilityContext`in tamamı DEĞİL.
 * Dar tutulması bilinçli: yapısal tipleme sayesinde karo bağlamı bu şekli
 * sağlar, ama bu dosya karo bağlamına bağımlı olmaz ve bekçisi tek satırla
 * kurulur.
 */
export interface PurchaseOrderVisibilityContext {
  /** `finance.enabled` — fiilen "bu bir TİCARET kurulumu" anahtarı. */
  financeEnabled: boolean;
}

/** Alış siparişleri karosu / komut paleti girişi çizilsin mi? */
export function isPurchaseOrdersVisible(ctx: PurchaseOrderVisibilityContext): boolean {
  return ctx.financeEnabled;
}
