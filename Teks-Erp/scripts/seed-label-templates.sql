-- =============================================================================
-- Default LabelTemplate'leri seed et — ROLL, SWATCH, SHIPMENT_DOCKET
-- =============================================================================
-- Her LabelKind için 1 default template ("Standart"). Tüm catalog alanları
-- isVisible=true, sıralı. Operatör sonradan toggle/sırala/bold ile düzenler.
--
-- Idempotent: ON CONFLICT (kind, name) DO NOTHING.
--
-- Çalıştırma:
--   psql "$DATABASE_URL" -f scripts/seed-label-templates.sql
-- =============================================================================

-- ROLL — Tambur output / Packaging label / standalone reprint
INSERT INTO label_templates (id, name, kind, "isDefault", "isActive", fields, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Standart Top Etiketi',
  'ROLL',
  true,
  true,
  '[
    {"key":"barcode",        "label":"Barkod",          "order":1,  "isVisible":true,  "isBold":true,  "fontSize":"lg"},
    {"key":"qrCode",         "label":"QR Kod",          "order":2,  "isVisible":true},
    {"key":"itemName",       "label":"Ürün",            "order":3,  "isVisible":true,  "isBold":true,  "fontSize":"md"},
    {"key":"itemNameDefault","label":"Ürün (bizdeki ad)","order":4, "isVisible":false},
    {"key":"itemCode",       "label":"Ürün Kodu",       "order":5,  "isVisible":false},
    {"key":"colorName",      "label":"Renk",            "order":6,  "isVisible":true},
    {"key":"colorCode",      "label":"Renk Kodu",       "order":7,  "isVisible":false},
    {"key":"qualityGrade",   "label":"Kalite",          "order":8,  "isVisible":true},
    {"key":"widthCm",        "label":"En (cm)",         "order":9,  "isVisible":true},
    {"key":"lengthMeters",   "label":"Metraj (m)",      "order":10, "isVisible":true,  "isBold":true},
    {"key":"weightKg",       "label":"Ağırlık (kg)",    "order":11, "isVisible":true,  "isBold":true},
    {"key":"customerName",   "label":"Müşteri",         "order":12, "isVisible":true},
    {"key":"orderNumber",    "label":"Sipariş No",      "order":13, "isVisible":true},
    {"key":"batchNumber",    "label":"Parti No",        "order":14, "isVisible":true},
    {"key":"packagingDate",  "label":"Paketleme Tarihi","order":15, "isVisible":true},
    {"key":"printedAt",      "label":"Baskı Tarihi",    "order":16, "isVisible":false}
  ]'::jsonb,
  now(),
  now()
)
ON CONFLICT (kind, name) DO NOTHING;

-- SWATCH — Kartela
INSERT INTO label_templates (id, name, kind, "isDefault", "isActive", fields, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Standart Kartela Etiketi',
  'SWATCH',
  true,
  true,
  '[
    {"key":"barcode",          "label":"Barkod",          "order":1,  "isVisible":true,  "isBold":true,  "fontSize":"lg"},
    {"key":"qrCode",           "label":"QR Kod",          "order":2,  "isVisible":true},
    {"key":"cardNumber",       "label":"Kart No",         "order":3,  "isVisible":true},
    {"key":"itemName",         "label":"Ürün",            "order":4,  "isVisible":true,  "isBold":true},
    {"key":"itemCode",         "label":"Ürün Kodu",       "order":5,  "isVisible":false},
    {"key":"colorName",        "label":"Renk",            "order":6,  "isVisible":true},
    {"key":"colorCode",        "label":"Renk Kodu",       "order":7,  "isVisible":false},
    {"key":"widthCm",          "label":"En (cm)",         "order":8,  "isVisible":true},
    {"key":"lengthCm",         "label":"Boy (cm)",        "order":9,  "isVisible":true},
    {"key":"weightKg",         "label":"Ağırlık (kg)",    "order":10, "isVisible":true},
    {"key":"customerName",     "label":"Müşteri",         "order":11, "isVisible":true},
    {"key":"batchNumber",      "label":"Parti No",        "order":12, "isVisible":true},
    {"key":"parentRollBarcode","label":"Ana Top Barkodu", "order":13, "isVisible":false},
    {"key":"printedAt",        "label":"Baskı Tarihi",    "order":14, "isVisible":false}
  ]'::jsonb,
  now(),
  now()
)
ON CONFLICT (kind, name) DO NOTHING;

-- SHIPMENT_DOCKET — Sevkiyat irsaliyesi
INSERT INTO label_templates (id, name, kind, "isDefault", "isActive", fields, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Standart Sevkiyat İrsaliyesi',
  'SHIPMENT_DOCKET',
  true,
  true,
  '[
    {"key":"shipmentNumber","label":"İrsaliye No",     "order":1, "isVisible":true,  "isBold":true,  "fontSize":"xl"},
    {"key":"shippedAt",     "label":"Sevk Tarihi",     "order":2, "isVisible":true},
    {"key":"customerName",  "label":"Müşteri",         "order":3, "isVisible":true,  "isBold":true},
    {"key":"customerCode",  "label":"Müşteri Kodu",    "order":4, "isVisible":true},
    {"key":"branchName",    "label":"Şube",            "order":5, "isVisible":true},
    {"key":"driverName",    "label":"Şoför",           "order":6, "isVisible":true},
    {"key":"plateNumber",   "label":"Plaka",           "order":7, "isVisible":true},
    {"key":"carrier",       "label":"Nakliye Firması", "order":8, "isVisible":false},
    {"key":"items",         "label":"Ürün Tablosu",    "order":9, "isVisible":true,  "isBold":true},
    {"key":"totals",        "label":"Toplamlar",       "order":10,"isVisible":true,  "isBold":true}
  ]'::jsonb,
  now(),
  now()
)
ON CONFLICT (kind, name) DO NOTHING;
