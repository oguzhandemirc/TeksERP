-- K4P-RAPOR (2026-10-25): muayene raporu belge türü. Kaynak Shipment; sevk toplarının
-- aktif 4 puan muayeneleri ilk basımda `PrintedDocument.snapshot`a donar.
-- ⚠️ ADD VALUE tek ifade (PG 55P04): değeri kullanan ifade bu dosyaya girmez.
ALTER TYPE "PrintedDocType" ADD VALUE IF NOT EXISTS 'INSPECTION_REPORT';
