-- =============================================================================
-- KUMAŞ AD + KOD SEDDİ (K2 · K3) — denetim 2026-08-29, uygulama 2026-08-30
-- =============================================================================
-- Bu iki kısıt denetimde önerildi ama fabrika verisinde KURULAMIYORDU: aynı adı
-- ya da harf farkıyla aynı kodu taşıyan kayıtlar vardı. Ölçüldü (saha kopyası):
-- çakışan 6 kaydın HEPSİ sıfır kullanımlıydı — hiç top, sipariş kalemi, iş emri
-- ya da müşteri kodu bağlı değil. `scripts/fix_kumas_kod_cakismasi.ts` onları
-- (bağımlılık kapısından + audit'ten geçirerek) siliyor ve ardından bu migration
-- temiz koşuyor. Simülasyon: silme sonrası kalan çakışma 0 / 0.
--
-- ⚠️ ÖN KOŞUL — SIRA PAZARLIK DIŞI: önce temizlik script'i, SONRA bu migration.
--    Ters sırada `CREATE UNIQUE INDEX` düşer ve deploy yarıda kalır.
--
-- ⚠️ `CONCURRENTLY` KULLANILMIYOR: Prisma migration'ı tek transaction içinde
--    koşar ve CONCURRENTLY orada çalışmaz. `items` küçük bir ana veri tablosu
--    (fabrikada birkaç yüz satır) — düz CREATE INDEX milisaniye mertebesinde.
--
-- ⚠️ PARTIAL: `WHERE "mergedIntoId" IS NULL` — mezar taşı (birleştirilmiş kayıt)
--    aynı adı/kodu MEŞRUEN taşımaya devam eder; tarihçedir, canlı kayıt değil.
--
-- Geri alma:
--   DROP INDEX "items_nameFold_key";
--   DROP INDEX "items_code_fold_key";
-- =============================================================================

-- K2 — kumaş ADI tekil (mezar taşı hariç).
-- Not: dev'de bu index daha önce oluşmuştu; `IF NOT EXISTS` idempotent kılar.
CREATE UNIQUE INDEX IF NOT EXISTS "items_nameFold_key"
  ON items ("nameFold") WHERE "mergedIntoId" IS NULL;

-- K3 — kumaş KODU harf-duyarsız tekil. Barkod okuyucu küçük harfi büyüte
-- çevirdiği için `santuk` ile `SANTUK` sahada AYNI koddur; iki ayrı kayıt
-- olarak yaşamaları yanlış kumaşın seçilmesine yol açar.
CREATE UNIQUE INDEX IF NOT EXISTS "items_code_fold_key"
  ON items (upper(code)) WHERE "mergedIntoId" IS NULL;
