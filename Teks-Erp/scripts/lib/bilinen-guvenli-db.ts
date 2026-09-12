// =============================================================================
// BİLİNEN GÜVENLİ VERİTABANI ADLARI — İKİ KAPININ TEK ORTAK KAYNAĞI
// =============================================================================
// İki ayrı kapı var ve AYRI SORULAR soruyorlar (bu ayrım bilinçli, birleştirilmez):
//   • `scripts/db-guard.ts`        → "burası yıkıcı betiğin koşabileceği bir
//                                     GELİŞTİRME hedefi mi?"  (geniş: _dev/_test/_local/_demo)
//   • `scripts/lib/hedef-db-kapisi.ts` → "burası bekçi paketinin yazabileceği bir
//                                     FİXTURE hedefi mi?"      (dar: yalnız _test)
// Son ek listelerini BİRLEŞTİRMEK REGRESYON OLURDU: fixture kapısının tüm varlık
// sebebi `_dev`/`_demo` adlı fabrika kopyalarını REDDETMEK (paket 1.500'den fazla
// `deleteMany` gönderir). Ölçüldü 2026-09-12: iki kümenin dört farkından ÜÇÜ
// (`tekserp_fabrika_dev` · `tekserp_demo` · `*_local`) BİLİNÇLİ ve yük taşıyor.
//
// Ortak olan tek şey bu dosyadır: "son ek taşımadığı hâlde güvenli olduğu BİLİNEN
// ad". Dördüncü fark (`teks_ci`) tam da bu kümeye bir kapıda eklenip diğerinde
// eklenmediği için doğdu — CI'da `test_manual_move_fason_receive` her koşumda
// "TANINMAYAN AD" ile düşüyordu. Artık iki kapı da buradan okur; ikinci kopya
// yazılırsa `test_script_guards` kırmızı verir.
// =============================================================================

/**
 * Son ek kalıbına uymayan ama güvenli olduğu BİLİNEN veritabanı adları.
 *
 * ⚠️ Buraya ad eklemek İKİ kapıyı birden gevşetir — yalnız hiçbir fabrika verisi
 * taşımayan, yaratılıp atılan hedefler girer. Fabrika kopyası ADIYLA bile girmez.
 */
export const BILINEN_GUVENLI_DB_ADLARI: ReadonlySet<string> = new Set([
  // CI'nın veritabanı (`.github/workflows/ci.yml`, `POSTGRES_DB`). Her job'da
  // sıfırdan doğar, `migrate deploy` + seed görür ve job bitince yok olur.
  "teks_ci",
]);
