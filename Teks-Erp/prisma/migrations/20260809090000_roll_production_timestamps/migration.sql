-- =============================================================================
-- Roll üretim zaman çıpaları: finalizedAt + statusChangedAt
-- =============================================================================
-- NEDEN: Her dönem-bazlı rapor ("bu ay 1. kalite oranımız ne") topun NE ZAMAN
-- bittiğini sorar. Bu bilgi şemada HİÇ YOKTU:
--   • `Roll` yalnız createdAt / updatedAt / cancelledAt / labelPrintedAt taşıyor.
--   • `roll-finalize.helper.finalizeRollsAtLastStep` topu WAREHOUSE'a çekerken
--     hiçbir zaman damgası yazmıyor.
--   • Hareketten türetmek de ÇALIŞMIYOR: ölçüldü (2026-08-09, fabrika kopyası) —
--     bitmiş topların HİÇBİRİNDE kapanmış `RollMovement` yok, çünkü Tambur kesim
--     çocuğu ve elle eklenen top hiç hareket görmez (ebeveyni görür).
-- Geriye tek seçenek `updatedAt` kalıyordu ve kök CLAUDE.md onu açıkça yasaklıyor
-- ("etiket yeniden basımı / not düzenlemesi de günceller"). Fire raporu bugüne
-- kadar tam o kumun üstündeydi.
--
-- NEDEN TRIGGER (uygulama kodu değil): `Roll.status`'e yazan 40+ çağrı noktası var.
-- Birini atlamak raporda SESSİZ eksik demek — hata yok, log yok, o toplar hiçbir
-- dönemde görünmez. Trigger atlanamaz; ham SQL bile geçemez. Ayrıca bu değişiklik
-- TEK SATIR uygulama kodu gerektirmez → mevcut yolların hepsi bayt-bayt aynı kalır.
--
-- MALİYET: iki nullable kolon PG11+'ta metadata-only (tablo yeniden yazılmaz).
-- Trigger satır başına birkaç mikrosaniye; yalnız `status` GERÇEKTEN değiştiğinde
-- iş yapar (`IS DISTINCT FROM`).
-- =============================================================================

ALTER TABLE "rolls"
  ADD COLUMN "finalizedAt"     TIMESTAMPTZ,
  ADD COLUMN "statusChangedAt" TIMESTAMPTZ;

-- Dönem taraması için PARTIAL index (perf kuralı 4). Yalnız üretimi bitmiş toplar
-- damgalıdır → index tablonun alt kümesini tutar. `schema.prisma` tarafında
-- `@@index([finalizedAt])` olarak durur; Prisma 7 predicate farkını drift SAYMAZ.
CREATE INDEX "rolls_finalizedAt_idx"
  ON "rolls" ("finalizedAt")
  WHERE "finalizedAt" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Damgalama trigger'ı — TEK YAZMA NOKTASI
-- -----------------------------------------------------------------------------
-- `now()` ÇIPLAK kullanılır ve doğrudur: kolonlar timestamptz, yani mutlak an
-- saklanır (kök CLAUDE.md 2026-08-01 timestamptz dönüşümü — "çıplak now() GÜVENLİ
-- ve TERCİH EDİLEN yazım budur"). `AT TIME ZONE 'UTC'` sarmalı BURADA YANLIŞ olur:
-- timestamptz→timestamp→timestamptz turunun ikinci çevrimi oturum saat diliminde
-- yorumlanır.
CREATE OR REPLACE FUNCTION "roll_stamp_production_timestamps"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Açıkça verilmediyse doğuş anı = statü değişim anı.
    IF NEW."statusChangedAt" IS NULL THEN
      NEW."statusChangedAt" := now();
    END IF;
    -- Doğrudan FİNAL statüde doğan top (fason kabul çocuğu, Tambur kesim çocuğu)
    -- o anda üretimini bitirmiştir — ayrı bir geçiş yaşamaz, INSERT dalı olmasaydı
    -- bu toplar hiçbir zaman damgalanmazdı.
    IF NEW."finalizedAt" IS NULL
       AND NEW."status" IN ('WAREHOUSE', 'A1_STOCK', 'SCRAP') THEN
      NEW."finalizedAt" := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: yalnız statü GERÇEKTEN değiştiyse çalış. `updatedAt` dokunuşları
  -- (etiket basımı, not düzenlemesi) buradan hiç geçmez — kolonun tüm varlık
  -- sebebi bu ayrımdır.
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."statusChangedAt" := now();

    -- ÜRETİM ÇIKIŞI: üretim tarafı bir statüden final statüye geçiş.
    --
    -- ⚠️ KAYNAK LİSTESİ LOAD-BEARING. `SHIPPED` ve `CANCELLED` BİLİNÇLİ OLARAK
    -- DIŞARIDA:
    --   • SHIPPED → WAREHOUSE = sevk storno / müşteri iadesi. Mal üretimi yeniden
    --     bitirmedi; içeride olsaydı bir storno, aylar önce üretilmiş topu BUGÜNÜN
    --     kalite karnesine sokar ve iki dönemi birden yanlışlardı.
    --   • CANCELLED → * = iptal geri alma (`restoreCancelledRoll`), üretim değil.
    -- Yeni bir statü eklerken bu iki kümeyi ve yukarıdaki gerekçeyi tekrar oku;
    -- bekçi: scripts/test_quality_scorecard.ts.
    IF NEW."status" IN ('WAREHOUSE', 'A1_STOCK', 'SCRAP')
       AND OLD."status" IN ('IN_PRODUCTION', 'STOCK', 'AT_SUBCONTRACTOR', 'RETURNED_FROM_SUBCONTRACTOR') THEN
      -- ⚠️ ÜZERİNE YAZILIR (write-once DEĞİL). Depo topu yeni bir iş emrine girip
      -- tekrar finalize olursa damga tazelenir — çünkü `qualityGradeId` de tazelenir.
      -- Sabitlenseydi top ESKİ tarihle YENİ kaliteyi taşırdı; invariant şudur:
      -- `finalizedAt` her zaman mevcut `qualityGradeId` ile AYNI olaydan gelir.
      NEW."finalizedAt" := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rolls_stamp_production_timestamps"
  BEFORE INSERT OR UPDATE ON "rolls"
  FOR EACH ROW
  EXECUTE FUNCTION "roll_stamp_production_timestamps"();
