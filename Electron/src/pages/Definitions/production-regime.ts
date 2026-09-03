// =============================================================================
// TANIMLAR — ÜRETİM KAROLARININ GÖRÜNÜRLÜK REJİMİ (saf katman)
// =============================================================================
// ÜÇ KARO, TEK BAYRAK (`production.enabled`): Üretim Rotaları · İş Emri
// Şablonları · Refakat Kartı. Üçü de ekran manifestosunda `productionEnabled`
// modülüne beyanlı (`Teks-Erp/src/constants/screen-catalog.ts`) ve backend
// ikizleri `requireProductionEnabled` taşıyan router'lardır (`route.routes` ·
// `product-recipe.routes` · refakat kartı yolu).
//
// ⚠️ HANGİLERİ BİLEREK DIŞARIDA — bu liste bir DARALTMADIR ve gerekçesi var:
//   · `stations` · `machines` · `reason-presets` · `defect-types` ·
//     `quality-grades` · `colors` → manifestoda ÇEKİRDEK ANA VERİ. İstasyon ve
//     makine kartı üretim modülü kapalı bir kurulumda da anlamlıdır (depo/mal
//     kabul ekranları istasyon kavramını kullanır) ve hepsi ana veri kapısıyla
//     korunur, üretim kapısıyla değil.
//   · `traveler-card-studio` → BELGE tasarımı (çekirdek: sistem/kimlik/belge).
//     Kart ŞABLONU bir belge nesnesidir; kartın KENDİ ayarı (`traveler-card`)
//     üretim nesnesidir. İkisinin manifestodaki modülü de farklıdır.
// Bu ayrımı burada genişletmek isteyen önce `screen-catalog.ts`teki `modul`
// beyanını değiştirmek zorundadır — `test_screen_catalog §9c/§9e` iki yönü de
// mekanik olarak birebirler (karo bayrağı ≠ manifesto modülü → kırmızı).
//
// NEDEN ÜÇ AYRI FONKSİYON ve NEDEN SAF KATMAN: gerekçenin tamamı
// `Operations/production-regime.ts` başlığında (kimlik testi + "tersine
// çevrilse hiçbir testi kırmazdı" kuralı). Burada tekrarlanmaz, ikizlenir.
//
// ⚠️ BELİRSİZKEN TRUE — bağlamı kuran `useOperationsVisibilityContext`
// `?? true` yapar (backend varsayılanı AÇIK). Fabrikada bu karoların bir an
// kaybolup geri gelmesi "sıfır görünür fark" vaadini gözle görülür şekilde
// bozardı.
//
// ⚠️ GERİ DÖNÜŞ KAPALI DEĞİL: rota/şablon karoları gizlense de üretim modülü
// Genel Ayarlar → Modüller (ve Sistem Profili) ekranından her zaman yeniden
// açılabilir; o kategori hiçbir modül kapısının arkasında değildir. Keşif
// raporunun "modülü yeniden açan kullanıcı rota kuramaz" riski tam olarak
// buradan kapanıyor — kapatma kararı geri alınabilir olduğu sürece gizleme
// güvenlidir.
// =============================================================================

/**
 * Yüklemlerin ihtiyaç duyduğu ALAN — `OperationsVisibilityContext`in tamamı
 * DEĞİL (Tanımlar karoları da o bağlamı kullanır; dar arayüz yapısal tiplemeyle
 * eşleşir ve bu dosyayı bağlama bağımlı yapmaz).
 */
export interface DefinitionsProductionContext {
  /** `production.enabled` — üretim modülü (varsayılan AÇIK). */
  productionEnabled: boolean;
}

/** Üretim Rotaları karosu / palet girişi çizilsin mi? */
export function isRoutesVisible(ctx: DefinitionsProductionContext): boolean {
  return ctx.productionEnabled;
}

/** İş Emri Şablonları karosu / palet girişi çizilsin mi? */
export function isProductRecipesVisible(ctx: DefinitionsProductionContext): boolean {
  return ctx.productionEnabled;
}

/** Refakat Kartı (kart ayarları) karosu / palet girişi çizilsin mi? */
export function isTravelerCardVisible(ctx: DefinitionsProductionContext): boolean {
  return ctx.productionEnabled;
}

/**
 * İstasyon Yetenekleri (ayrı liste) palet girişi çizilsin mi?
 *
 * ⚠️ BU EKRANIN KAROSU YOK — palet, ona giden TEK keşif yoludur
 * (`test_screen_catalog` `KARO_YOK` muafı). Karo hizası bekçisi karo↔manifesto
 * ekseninde çalıştığı için bu yolu ÖLÇEMEZ; kapıyı elle taşımak zorundayız.
 * Manifestoda `definitions/station-capabilities` → `productionEnabled`,
 * backend ikizi `station-capability.routes` `requireProductionEnabled`.
 * Kapısız bırakılırsa üretim kapalı kurulumda arama sonucundan tıklayan
 * kullanıcı 403 ekranına düşer (P5 doğrulaması bunu ölçtü).
 */
export function isStationCapabilitiesVisible(ctx: DefinitionsProductionContext): boolean {
  return ctx.productionEnabled;
}
