// =============================================================================
// PostgreSQL OTURUM SEÇENEKLERİ — TEK KAYNAK
//
// ⚠️ LOAD-BEARING. Bu dosyadaki tek satır silinirse/atlanırsa uygulamadaki TÜM
// tarihler sessizce 3 saat kayar (Europe/Istanbul'da) — hata yok, log yok.
//
// NEDEN
// -----
// `@prisma/adapter-pg`, `timestamptz` kolonlarla çalışırken oturumun saat
// diliminin **UTC olduğunu VARSAYAR**. İki yönü de kırılgandır:
//
//   OKUMA:  adapter, PG'nin döndürdüğü metnin OFFSET'İNİ ATAR ve yerine
//           körlemesine "+00:00" yazar:
//             normalize_timestamptz = t => t.replace(" ","T")
//                                          .replace(/[+-]\d{2}(:\d{2})?$/, "+00:00")
//           Istanbul oturumunda PG "2026-07-30 15:20:08.255+03" döner, adapter
//           bunu "2026-07-30T15:20:08.255+00:00" yapar → okunan tarih +3 saat.
//           (Ölçüldü 2026-08-01: düz `pg` 12:20:08Z, Prisma ORM 15:20:08Z.)
//
//   YAZMA:  Prisma JS `Date`'i UTC duvar-saati metni olarak gönderir; oturum
//           Istanbul ise PG onu yerel kabul edip UTC'ye çevirir → yazılan tarih
//           −3 saat. (Ölçüldü: hedef epoch 1785542400, DB'ye 1785531600 düştü.)
//
// `20260801040000_timestamptz_conversion` ile 183 kolon timestamptz olduğundan
// bu artık her tarih alanını etkiler. (Öncesinde de timestamptz olan 9 kolonu
// —users/label_templates/peripheral_devices.deletedAt, kursun_bypass_assignments,
// swatch_stock_reductions— aynı hata SESSİZCE bozuyordu.)
//
// NEDEN HAVUZDA, DB'DE DEĞİL
// --------------------------
// `ALTER DATABASE ... SET timezone='UTC'` de çözerdi, ama doğruluğu ortam
// kurulumuna bağlardı (dev `adnansahin_db` ↔ saha `tekserp`; bir kopyaya
// restore/rename sonrası per-DB ayarların OID'ye bağlı olduğu ve TAŞINMADIĞI
// zaten biliniyor — bkz. CLAUDE.md "Kopyaya geri yükleme"). Havuzda tutmak
// uygulamayı kendi kendine yeter kılar.
//
// KULLANIM: `pg` `Pool` kuran HER yer bunu geçirmeli (app havuzu + seed'ler).
// Bekçi: `scripts/test_timestamptz_contract.ts`
// =============================================================================

/** `pg` Pool/Client `options` alanı — oturumu UTC'ye sabitler. */
export const PG_SESSION_OPTIONS = "-c timezone=UTC";
