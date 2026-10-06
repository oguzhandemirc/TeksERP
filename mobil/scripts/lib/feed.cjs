// =============================================================================
// TeksERP Mobil — OTA manifest gövdesinin multipart sınırlayıcısı (TEK KAYNAK)
// =============================================================================
// Tablet güncelleme adresi `scripts/lib/ortak-kimlik.cjs`ten (dağıtım kaydı) türer; bu
// dosya yalnız backend + nginx ile paylaşılan sabit sınırlayıcıyı taşır. Eski kanal adres
// türetimi (musteri.json · feedUrl) emekli: `eski-kanal-son` etiketi.
// =============================================================================

/**
 * Multipart gövdenin SABİT sınırlayıcısı.
 *
 * ⚠️ SABİT olmak ZORUNDA: manifest statik dosya olarak servis ediliyor ve
 * `Content-Type: multipart/mixed; boundary=…` başlığını nginx yapılandırması
 * basıyor. Sınırlayıcı yayın başına değişseydi her yayında nginx'e dokunmak
 * gerekirdi. Yayın script'i sınırlayıcının gövdede geçmediğini doğrular.
 * Backend ikizi `Teks-Erp/src/config/mobile-update.ts`; eşitliği `test_mobile_update` §9 ölçer.
 */
const MULTIPART_BOUNDARY = 'tekserpota';

module.exports = { MULTIPART_BOUNDARY };
