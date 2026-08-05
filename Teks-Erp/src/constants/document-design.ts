// =============================================================================
// TeksERP — BELGE TASARIM YÜZEYİNİN İZİN KÜMELERİ (TEK KAYNAK)
// =============================================================================
// Tanımlar → Çıktılar altındaki DÖRT ekran, baskı çıktısının GÖRÜNÜMÜNÜ belirler:
//
//   • Belge Şablonları            (irsaliye/çeki içerik ayarı + profiller)
//   • Refakat Kartı               (kart marka/bölüm ayarı)
//   • Refakat Kartı Şablonları    (şablon stüdyosu)
//   • Serbest Belgeler            (üst yazı/tutanak/dekont)
//
// 2026-08-05'e kadar dördü de `admin:settings` ile korunuyordu. Bu, şablonu
// düzenleyen kişiye (matbaa işini bilen büro personeli) oturum politikasını,
// yedek saatini, cihaz onayını ve log arşivini de açıyordu — oysa iki iş
// birbiriyle ilgisiz. Ayrım `settings:workstation` ile aynı gerekçeye dayanır.
//
// ⚠️ `admin:settings` DÖRT EKRANI DA AÇMAYA DEVAM EDER (guard'lar OR ile kurulu).
// Sıkı ayrım yapılsaydı deploy anında HİÇ KİMSE — admin dahil — bu ekranları
// açamazdı: boot uzlaştırması yeni izin satırını DB'ye getirir ama kimseye
// ATAMAZ (katalog koda, atama panele). Yani `admin:settings` burada bir
// geriye-uyum kapısı değil, kilitlenmeye karşı tek emniyet supabıdır.
//
// ⚠️ READ kümesi `document-template:write`i DE içerir — yazabilen okuyabilir.
// `label-template:read/write` çiftinde bu yapılmamıştı ve orada gerçek bir
// tuzak var: panelden yalnız "düzenleme" kutusunu işaretleyen admin, ekranı
// hiç AÇAMAYAN bir kullanıcı üretir ve sebebi hiçbir yerde yazmaz. Burada o
// tuzağı bilerek kapatıyoruz.
// =============================================================================

/**
 * Belge tasarım ekranlarını AÇMAK (listeleme/önizleme) için yeterli izinler.
 * `requireAnyPermission(...DOCUMENT_DESIGN_READ)` ile kullanılır.
 *
 * ⚠️ Saf string literal dizisi olarak KALMALI — izin kataloğu bekçisi
 * (`scripts/test_permission_catalog.ts`) bu diziyi AST ile okur; hesaplanan
 * bir eleman (`...X`, şablon literal) girerse "çözülemedi" ile test DÜŞER.
 */
export const DOCUMENT_DESIGN_READ = [
  "admin:settings",
  "document-template:read",
  "document-template:write",
];

/** Belge tasarımını DEĞİŞTİRMEK (kaydet/sil/varsayılan yap) için yeterli izinler. */
export const DOCUMENT_DESIGN_WRITE = ["admin:settings", "document-template:write"];

/**
 * `PATCH /api/feature-flags` gövdesinde belge tasarım yüzeyine AİT anahtarlar.
 *
 * O uç sistemin TÜM ayarlarını taşır (oturum ömrü, yedek saati, kk1 tuzağı…).
 * Ucu körlemesine `document-template:write`e açmak, şablon tasarımcısına
 * sistemin tamamını vermek olurdu. Bu yüzden guard ANAHTAR-KAPSAMLIDIR:
 * gövde YALNIZ aşağıdaki anahtarları taşıyorsa dar izin yeter, tek bir yabancı
 * anahtar bile varsa `admin:settings` şarttır (fail-closed).
 *
 * ⚠️ Küme BİLEREK DAR: `companyName` / `companyLetterhead` / belge logosu
 * firmanın KİMLİĞİDİR, şablon değil — ayrıca onları yazan ekran (Genel
 * Ayarlar → Firma) zaten `admin:settings` arkasında ve dar izinli kullanıcı
 * oraya ulaşamıyor. Buraya yeni anahtar eklerken sorulacak soru "belge
 * ekranında görünüyor mu" değil, "yanlış girilirse etkisi belge çıktısıyla
 * SINIRLI mı" olmalı.
 */
export const DOCUMENT_DESIGN_FLAG_KEYS: ReadonlySet<string> = new Set([
  "documentsConfig",
  "travelerCardConfig",
]);
