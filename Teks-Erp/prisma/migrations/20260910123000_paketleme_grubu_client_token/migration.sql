-- =============================================================================
-- `packing_groups.clientToken` — "Parti Ata" idempotency anahtarı
-- =============================================================================
-- NE YAPIYOR: gruba `clientToken` kolonu + UNIQUE index ekler. Tablet mantıksal
-- deneme başına BİR token üretir; ağ zaman aşımında aynı token gider ve ikinci
-- bir grup doğmaz (numara da boşa yanmaz).
--
-- NEDEN AYRI MİGRATION: `20260910120000_paketleme_grubu` bu makinede ZATEN
-- UYGULANMIŞTI. Uygulanmış migration dosyası bir daha düzenlenmez ([DB-31]) —
-- düzeltme yeni dosyayla yapılır, yoksa saha deploy'u checksum hatasıyla kilitlenir.
--
-- ADDITIVE Mİ: EVET — NULLABLE kolon + UNIQUE index. Tablo bugün BOŞ (özellik
-- henüz hiçbir yüzeyden yazmıyor), yani unique hiçbir satıra takılamaz;
-- yine de kolon nullable olduğu için mükerrer NULL'lar çakışmaz.
--
-- İDEMPOTENT: IF NOT EXISTS.
-- =============================================================================

ALTER TABLE "packing_groups" ADD COLUMN IF NOT EXISTS "clientToken" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "packing_groups_clientToken_key"
    ON "packing_groups" ("clientToken");
