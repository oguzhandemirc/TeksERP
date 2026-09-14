-- =============================================================================
-- machine_stop_events — İNSAN KARARLI DURUŞ SİLİNEMEZ (BEFORE DELETE sed) · Faz 1b
-- =============================================================================
-- Tasarım §2.7/§4: duruş tablosu İKİ yaşam süresini taşır — makineden türeyen
-- sınıflandırma TELEMETRİDİR (kovayla budanır), insan kararı DEFTERDİR (budanmaz,
-- geri alma `revokedAt`, değişim `MachineStopReclass`). Budayıcının DB seddi:
-- `classifiedById` dolu YA DA `reasonSource IN ('OPERATOR','SUPERVISOR')` satırı
-- HİÇBİR yol silemez (RAISE). Yüklem İNSAN KARARINA daraltıldı — makine sınıflı
-- (`reasonSource IN ('MACHINE','INFERRED') AND classifiedById IS NULL`) budanır;
-- aksi hâlde Faz 2'nin otomatik sınıflaması duruşların çoğunu kalıcılaştırırdı.
-- Şema-dışı: envanteri `test_db_invariants` (TRIGGERS + EXPECTED_FUNCTIONS).
-- ⚠️ DEFERRABLE composite FK'lar (rolls/swatches sackId_shipmentId_consistency) BU DOSYADA DÜŞÜRÜLMEZ.
-- Bekçi fikstür temizliği: insan kararlı fikstür satırı ÖNCE `classifiedById=NULL,
-- reasonSource=NULL` yapılır, sonra silinir (üretim yolu değil; bekçi kendi izini bilir).

CREATE OR REPLACE FUNCTION "machine_stop_block_classified_delete"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."classifiedById" IS NOT NULL
     OR OLD."reasonSource" IN ('OPERATOR', 'SUPERVISOR') THEN
    RAISE EXCEPTION 'machine_stop_events: insan kararlı duruş silinemez (id=%, reasonSource=%, classifiedById=%) — geri alma revokedAt damgasıdır',
      OLD.id, OLD."reasonSource", OLD."classifiedById"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "machine_stop_events_block_classified_delete"
  BEFORE DELETE ON "machine_stop_events"
  FOR EACH ROW
  EXECUTE FUNCTION "machine_stop_block_classified_delete"();
