-- =============================================================================
-- TOP DURUM DEFTERİ — kronoloji top başına KESİN ARTAN (roll_status_events)
-- =============================================================================
-- Yazar trigger'ı damgayı kolon varsayılanından (CURRENT_TIMESTAMP = tx BAŞI) alıyordu:
-- aynı tx'teki iki durum geçişi TAM eşit damgalı doğuyor, "en son olay" okuyucusu
-- (Top Çıkar'ın `statusBeforeEntry`i) rastgele UUID sırasına kalıyordu.
-- Damga artık açık: GREATEST(clock_timestamp() ms'ye YUKARI, topun son olayı + 1 ms).
-- Emsal: levent ve kartela defterleri (`eventStampTx`). ms: istemci (JS Date) µs'yi
-- göremez; iki satır aynı ms'ye düşerse okuyucuda yine eşit görünürdü.
-- Eşzamanlılık: AFTER UPDATE satır kilidini tutan tx'te koşar; aynı topa yazan ikinci
-- tx kilitte bekler ve READ COMMITTED'de ifadenin taze görüntüsüyle son olayı görür.
-- FORWARD-ONLY / ADDITIVE: yalnız fonksiyon gövdesi değişir; mevcut satırlara
-- dokunulmaz (eski eşit damgalar okuyucunun eşitlik bozucusuyla belirlenimli okunur).
-- İDEMPOTENT (OR REPLACE).
-- =============================================================================

CREATE OR REPLACE FUNCTION "roll_write_status_event"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NULL;
  END IF;
  INSERT INTO "roll_status_events" ("rollId", "fromStatus", "toStatus", "actorId", "createdAt")
  VALUES (
    NEW."id",
    CASE WHEN TG_OP = 'UPDATE' THEN OLD."status" ELSE NULL END,
    NEW."status",
    CASE WHEN NEW."status" IN ('CANCELLED', 'SCRAP') THEN NEW."cancelledById" ELSE NULL END,
    GREATEST(
      to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000), -- tz-ok: timestamptz, tx başı değil ŞU AN
      (SELECT max(e."createdAt") + interval '1 millisecond' FROM "roll_status_events" e WHERE e."rollId" = NEW."id")
    )
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
