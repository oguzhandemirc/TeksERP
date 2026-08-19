-- Fason KISMİ KABUL (2026-08-19) — SAP kısmi mal girişi karşılığı.
-- Dört additive değişiklik; hepsi nullable/default'lu → tablo rewrite YOK,
-- canlı veri etkilenmez, backfill GEREKMEZ (eski satırlar "tam kabul" okunur).

-- 1) Makbuz idempotency anahtarı — kısmi teslimatta küme-eşitliği guard'ı
--    ikinci gelişi yutacağı için replay kimliği artık token'dır.
ALTER TABLE "subcontractor_receipts" ADD COLUMN "clientToken" UUID;
CREATE UNIQUE INDEX "subcontractor_receipts_clientToken_key"
  ON "subcontractor_receipts"("clientToken");

-- 2) Kabul defteri: bu makbuz bu toptan kaç metre kabul etti + kısmi mi.
ALTER TABLE "subcontractor_receipt_items" ADD COLUMN "receivedQty" DECIMAL(12,3);
ALTER TABLE "subcontractor_receipt_items" ADD COLUMN "isPartial" BOOLEAN NOT NULL DEFAULT false;

-- 3) "Kalan gelmeyecek" kapaması — sevk kalemi kabul beklemeden kapanır
--    (fire kaydı RollVariance'ta, source=SUBCONTRACTOR_REMAINDER).
ALTER TABLE "subcontractor_dispatch_items" ADD COLUMN "remainderClosedAt" TIMESTAMPTZ;
