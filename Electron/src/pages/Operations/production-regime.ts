// =============================================================================
// ÜRETİM OPERASYON KAROLARI — GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// ÜÇ KARO, TEK BAYRAK (`production.enabled`): İş Emirleri · Kumaş Dengesi ·
// Kurşun Planlama. Üçünün de backend ikizi `requireProductionEnabled`
// (`workorder.routes` · `production-balance.routes` · `kursun-bypass.routes`) —
// yani bayrak kapalıyken uçlar 403 verir ve karo çizilmeye devam etseydi
// kullanıcı "görünen ama her tıklamada 403 veren" bir kart bulurdu.
//
// NEDEN ÜÇ AYRI FONKSİYON, TEK `isProductionVisible` DEĞİL:
// karo yüklemleri kimlikleriyle kilitleniyor (`tile-visibility.test` `toBe`).
// Üç karo aynı fonksiyon nesnesini paylaşsaydı test yine geçerdi, ama bir gün
// bir karonun kuralı ayrıldığında (ör. Kurşun Planlama'ya ek bir koşul) o
// ayrım tek satırlık bir düzenlemeyle değil, önce bir bölme işlemiyle
// yapılırdı. Adlar ayrıca ekranın hangi karo olduğunu bekçide okunur kılar.
//
// NEDEN SAF FONKSİYON, satır içi ok DEĞİL: kural bir bileşenin içindeki `&&`
// zinciri olarak bırakılsaydı tersine çevrilmesi HİÇBİR TESTİ KIRMAZDI
// (`yarn-regime.ts` / `po-regime.ts` başlıklarındaki aynı gerekçe) ve palet
// girişi ile karo AYNI fonksiyon nesnesini taşıyamazdı.
//
// ⚠️ BU BİR YETKİ DUVARI DEĞİLDİR. Erişimin kapısı İZİNDİR (`workorder:read` /
// `quality:write` ∨ `workorder:distribute`); rejim yalnız "menüde çizilsin mi"
// sorusunu cevaplar. Adres çubuğundan girilen route çalışır ve veri backend
// kapısına takılır.
//
// ⚠️ BELİRSİZKEN **TRUE**'YA DÜŞÜLÜR — ticaret karolarının TERSİ ve bu bilinçli:
// `production.enabled`ın backend varsayılanı AÇIK (`readProductionEnabled`ın
// "satır yoksa TRUE" sigortası) ve üretici fabrikada anahtar açıktır. `false`'a
// düşmek, fabrikada bayrak yüklenene kadar ÜRETİM karolarının kaybolup geri
// gelmesi demekti — "sıfır görünür fark" kuralının doğrudan ihlali. Yönü kuran
// yer bu dosya DEĞİL, bağlamı kuran `useOperationsVisibilityContext`tir
// (`?? true`); burada yalnız bayrak okunur.
//
// ⚠️ MODÜL KAPANDIĞINDA KİLİTLENME YOK: bu karolar gizlense de üretim modülü
// Sistem → Modüller ekranından her zaman yeniden açılabilir
// (o kategori hiçbir modül kapısının arkasında değildir). "Kapattım, geri
// açamıyorum" tuzağı bu yüzden burada doğmaz.
// =============================================================================

/**
 * Yüklemlerin ihtiyaç duyduğu ALAN — `OperationsVisibilityContext`in tamamı
 * DEĞİL. Dar tutulması bilinçli: yapısal tipleme sayesinde karo bağlamı bu
 * şekli sağlar, ama bu dosya karo bağlamına bağımlı olmaz.
 */
export interface ProductionVisibilityContext {
  /** `production.enabled` — üretim modülü (varsayılan AÇIK). */
  productionEnabled: boolean;
}

/** İş Emirleri karosu / palet girişi çizilsin mi? */
export function isWorkOrdersVisible(ctx: ProductionVisibilityContext): boolean {
  return ctx.productionEnabled;
}

/** Kumaş Dengesi karosu / palet girişi çizilsin mi? */
export function isProductBalanceVisible(ctx: ProductionVisibilityContext): boolean {
  return ctx.productionEnabled;
}

/** Kurşun Planlama karosu / palet girişi çizilsin mi? */
export function isKursunPlanningVisible(ctx: ProductionVisibilityContext): boolean {
  return ctx.productionEnabled;
}
