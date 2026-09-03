// =============================================================================
// KALEM FİYATI — REJİM + İZİN SÜZGECİ (saf katman)
// =============================================================================
// NEDEN SAF FONKSİYON: bu yüzeyin tamamı TİCARET paketine aittir. Fabrikada
// `ticaret.enabled` KAPALIDIR ve hiçbir parçası görünmemelidir. Kural bileşen
// içindeki bir `&&` zincirinde bırakılsaydı tersine çevrilmesi hiçbir testi
// kırmazdı — projenin yazılı deseni bu yüzden ayrı saf katmandır
// (`canQuickShip`, `resolveRollTabs`, `orders-regime.ts`). Bekçi: `regime.test.ts`.
//
// ── ⚠️ İKİ AYRI SORU, İKİ AYRI KAPI ──────────────────────────────────────────
//   REJİM (`ticaretEnabled`) → "bu KURULUM ticaret paketini kullanıyor mu"
//   İZİN  (`item:read` / `price:write`) → "bu KİŞİ bunu yapabilir mi"
// Backend de tam olarak böyle: `router.use(verifyToken, requireTicaretEnabled)`
// + uç bazlı `requirePermission`. Rejim kapalıyken izin taşıyan muhasebeci bile
// modülü açamaz (403: "Ticaret modülü bu kurulumda kapalı").
//
// ── ⚠️ 2026-09-03: BAYRAK `financeEnabled` DEĞİL `ticaretEnabled` ────────────
// Backend kapısı 2026-09-02'de `requireFinanceEnabled` → `requireTicaretEnabled`
// olarak TAŞINDI (`item-price.routes.ts:46`), panel ise `financeEnabled`te
// KALDI. Bu, YÖNÜ TERS bir ayrışmaydı ve iki kurulumda birden yanlış davranırdı:
//   · ticaret AÇIK + muhasebe KAPALI  → uç 200 döner ama karo/panel GİZLİ
//     (kullanıcı fiyat listesine hiçbir yerden ulaşamaz).
//   · ticaret KAPALI + muhasebe AÇIK  → karo GÖRÜNÜR, her istek 403.
// `test_screen_catalog` bunu "GERÇEK DRIFT, gerekçeli park" diye KARO_BEKLEYEN
// listesinde tutuyordu; bu değişiklik o parkı kapatır.
//
// ⚠️ Fiyat OKUMA yüzeyi ticarete bağlıdır, ÖN MUHASEBEYE değil: bir firma
// fatura defteri tutmadan da alım-satım yapıp fiyat listesi tutabilir.
//
// ⚠️ Bu bir GÜVENLİK SEDDİ DEĞİLDİR — sed backend'dedir. Buradaki iş, kapalı
// bir modülün düğmesini kullanıcıya hiç göstermemektir: görünen ama her
// basışta 403 veren bir düğme, olmayan düğmeden daha kötüdür.
// =============================================================================

export interface ItemPriceAccess {
  /** `feature-flags.ticaretEnabled` — REJİM. Yüklenene kadar `false`. */
  ticaretEnabled: boolean;
  /** `item:read` — fiyatı OKUMAK faturayı hazırlayan herkesin işidir. */
  canRead: boolean;
  /** `price:write` — fiyatı KİM belirler (görev ayrılığı ailesi). */
  canWrite: boolean;
}

/** Fiyat yüzeyi (sayfa · ürün kartındaki "Fiyatlar" bölümü) çizilir mi? */
export function itemPricesVisible(a: ItemPriceAccess): boolean {
  return a.ticaretEnabled && a.canRead;
}

/**
 * Yazma aksiyonları (Tanımla/Düzelt/Kaldır) çizilir mi?
 *
 * ⚠️ `itemPricesVisible`i İÇERİR — göremediği bir listeye yazma düğmesi
 * koyulamaz. Ayrı yazılsalardı `ticaretEnabled=false` + `price:write` taşıyan
 * bir kullanıcıda düğme çizilir, uç 403 verirdi.
 */
export function itemPricesEditable(a: ItemPriceAccess): boolean {
  return itemPricesVisible(a) && a.canWrite;
}

/**
 * YENİ fiyat satırı teklif edilebilir mi?
 *
 * ⚠️ İZİNDEN AYRI BİR SORU: "yazabilir miyim" değil, **"elimdeki liste
 * güvenilir mi"**. Yeni fiyat yazmanın tek güvenliği, formun "bu kutuda zaten
 * bir fiyat var — ÜZERİNE YAZILIR" uyarısıdır ve o uyarı tamamen yüklenmiş
 * satır listesinden üretilir. Liste düşmüşse (`listLoaded === false`) uyarı
 * sessizce kaybolur, backend `upsert` olduğu için kayıt hata da vermez ve eski
 * fiyat EZİLİR — yani mükerrer kayıt değil **veri kaybı** doğar.
 *
 * Kural burada saf tutuluyor çünkü bileşen içindeki bir `&&`'e geri taşınırsa
 * tersine çevrilmesi hiçbir testi kırmaz (dosya başlığındaki gerekçe).
 * DÜZELT/KALDIR bu yüklemi KULLANMAZ ve kullanmamalı: onlar zaten yalnız
 * gerçekten yüklenmiş bir satırın üstünde çizilir, kimliklerini o satırdan alır.
 */
export function canOfferNewPrice(a: ItemPriceAccess, listLoaded: boolean): boolean {
  return itemPricesEditable(a) && listLoaded;
}

/**
 * Tanımlar hub'ındaki karo / komut paleti girdisi için görünürlük yüklemi.
 *
 * ⚠️ İZİN KONTROLÜ İÇERMEZ ve içermemeli: `DefinitionTile` izni ayrı alanda
 * (`permission` / `permissionAny`) taşır, `visibleWhen` yalnız REJİMİ sorar
 * (bkz. `Definitions/tile-config.ts` yorumu — admin kısa devresi bunu atlamaz).
 *
 * ANA OTURUM İÇİN: `tile-config.ts`'e eklenecek satır bu yüklemi kullanır —
 * `visibleWhen: itemPricesTileVisible`.
 */
export function itemPricesTileVisible(ctx: { ticaretEnabled: boolean }): boolean {
  return ctx.ticaretEnabled;
}
