-- ÇEK OLAYI ↔ TESLİM BORDROSU BAĞI (2026-09-26, K3): bordro hareket fişi olduğunda (bayrak
-- `finance.chequeNoteMovementEnabled`) bordronun yazdığı DEPOSIT/ENDORSE olayı ve iptalinin ters
-- olayı bordroyu taşır; kalemin "canlı mı" sorusu bu bağdan okunur.
--
-- ADDITIVE: nullable kolon + FK + tekil indeks. Eski satırlar NULL kalır (bordrosuz olay); UNIQUE
-- NULL'ları çakıştırmaz. Bayrak kapalıyken hiçbir yazar bu kolonu doldurmaz.
-- İDEMPOTENT (RECETELER migration 11): ikinci koşum sessiz geçer.
ALTER TABLE "cheque_events" ADD COLUMN IF NOT EXISTS "deliveryNoteId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "cheque_events_deliveryNoteId_chequeId_type_key"
  ON "cheque_events"("deliveryNoteId", "chequeId", "type");

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cheque_events_deliveryNoteId_fkey') THEN
    ALTER TABLE "cheque_events" ADD CONSTRAINT "cheque_events_deliveryNoteId_fkey"
      FOREIGN KEY ("deliveryNoteId") REFERENCES "cheque_delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$fk$;
