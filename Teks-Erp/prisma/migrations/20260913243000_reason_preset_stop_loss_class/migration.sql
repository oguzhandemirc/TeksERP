-- =============================================================================
-- `reason_presets.stopLossClass` + CHECK (2026-09-13, dokuma P2b-2 · adım 2/2)
-- =============================================================================
-- NE YAPIYOR: CANLI `reason_presets` tablosuna nullable bir enum kolonu + bir CHECK.
--
-- ⚠️ İLK KEZ CANLI TABLOYA CHECK. Hacim ölçüldü (fabrikanın canlı yedeği):
--   reason_presets → 37 satır · altı kind · HİÇBİRİ MACHINE_STOP
--   ⇒ CHECK `kind <> 'MACHINE_STOP' OR (…)` mevcut satırların HEPSİNİ geçirir;
--   backfill YOK, `NOT VALID` GEREKMİYOR, `statement_timeout = 0` GEREKMİYOR.
--
-- ⚠️ ÖNCEKİ DOSYADA doğan 'MACHINE_STOP' literali BURADA kullanılıyor — ayrı
--   dosya olmasının sebebi tam bu (55P04). İkisi AYNI commit'te, bu SONRA.
--
-- CHECK'İN İKİ AYAĞI:
--   ① MACHINE_STOP ise `stopLossClass` NOT NULL — sınıfsız duruş sebebi, randıman
--     raporunda hangi kovaya düşeceği belirsiz bir sebeptir.
--   ② `<> 'MINOR'` — MINOR bir SÜRE sınıfıdır (mikro-duruş eşiğinin altı), SEBEP
--     sınıfı değil; tek helper'da türer. 45 dakikalık bir çözgü kopuşunu MINOR
--     saymak kullanılabilirliği hiç düşürmezdi (tasarım denetimi B2 — KRİTİK).
--   Diğer kind'larda kolon NULL kalır (`kind <> 'MACHINE_STOP'` ayağı).
--
-- ⚠️ AYNI COMMIT KURALI: `constants/reason-presets.ts`in 23 satırı `stopLossClass`
--   taşır ve `reason-preset-catalog.job.ts` onu satıra yazar. Yazmasaydı boot'ta
--   INSERT 23514 ile düşer ve job 5 denemeden sonra kalıcı kırmızı verirdi
--   (`PERMISSION_CATALOG_RECONCILE_FAILED`). Patlama yarıçapı DAR (presetler
--   zincirin SONUNDA koşar, izinler ve rol şablonları zaten yazılmış olur) ama
--   kural yine geçerli.
-- =============================================================================

ALTER TABLE "reason_presets" ADD COLUMN "stopLossClass" "MachineStopLossClass";

ALTER TABLE "reason_presets" ADD CONSTRAINT "reason_presets_machine_class_chk"
  CHECK ("kind" <> 'MACHINE_STOP' OR ("stopLossClass" IS NOT NULL AND "stopLossClass" <> 'MINOR'));
