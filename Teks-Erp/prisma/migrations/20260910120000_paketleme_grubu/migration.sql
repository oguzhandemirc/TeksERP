-- =============================================================================
-- PAKETLEME GRUBU — havuz çuvallarını "aynı sevke hazırlananlar" diye ayıran
-- çalışma yaftası (2026-09-10 saha isteği)
-- =============================================================================
-- NE YAPIYOR: `packing_groups` tablosunu ve `sacks."packingGroupId"` kolonunu
-- kurar. Grup bir CARİYE aittir, ekranda görünen bir adı ve opsiyonel bir notu
-- vardır; üyelik ÇUVALIN üstünde durur (ayrı pivot tablo YOK).
--
-- ADDITIVE Mİ: EVET — yalnız CREATE TABLE / ADD COLUMN / CREATE INDEX /
-- ADD CONSTRAINT. Hiçbir mevcut satır okunmaz, yazılmaz, silinmez. Yeni kolon
-- NULLABLE ve varsayılansız doğar: bugünkü her çuval "Gruplanmamış"tır ve
-- ekranların bugünkü davranışı değişmez (özellik ayrıca `packing.groupsEnabled`
-- bayrağının arkasında ve bayrak varsayılan KAPALI).
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya tamamen elle yazıldı —
-- `migrate dev` bu şemada iki DEFERRABLE composite FK'yı düşürmek istiyor).
--
-- İDEMPOTENT: her ifade IF NOT EXISTS / DO-guard taşır (yarım kalan uygulama,
-- kopya DB ve prova restore'u ikinci koşumu NORMAL yol yapar).
--
-- statement_timeout: DOKUNULMADI. Yeni tablo boş doğuyor; `sacks` üstündeki tek
-- DDL bir NULLABLE kolon eklemesidir (PG 11+ tabloyu YENİDEN YAZMAZ, katalog
-- güncellemesidir) ve index yeni kolon üzerindedir — bugün her satırda NULL
-- olduğu için ağaç boş kurulur. 50 sn'lik app timeout'unu ısıracak iş yok.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "packing_groups" (
    "id"          UUID         NOT NULL,
    "customerId"  UUID         NOT NULL,
    "name"        VARCHAR(64)  NOT NULL,
    "seq"         INTEGER,
    "note"        VARCHAR(500),
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ  NOT NULL,
    CONSTRAINT "packing_groups_pkey" PRIMARY KEY ("id")
);

-- Sayaç ("bu carinin canlı gruplarının en büyük seq'i") ve grup listesi.
-- Eşitlik (customerId) önce, sıra (seq) sonra — [DB] composite kuralı.
CREATE INDEX IF NOT EXISTS "packing_groups_customerId_seq_idx"
    ON "packing_groups" ("customerId", "seq");

-- Restrict: içinde grup duran cari silinemez. (Cari zaten soft-delete ile
-- yönetiliyor; sert silme yolu master-data bağımlılık guard'ından geçer ve bu
-- FK ona bir bağımlılık daha bildirir.)
DO $paketleme_grubu_cari_fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'packing_groups_customerId_fkey'
    ) THEN
        ALTER TABLE "packing_groups"
            ADD CONSTRAINT "packing_groups_customerId_fkey"
            FOREIGN KEY ("customerId") REFERENCES "customers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$paketleme_grubu_cari_fk$;

-- ---------------------------------------------------------------------------
-- Çuval → grup üyeliği. NULL = "Gruplanmamış" (bugünkü ve varsayılan hâl).
-- ---------------------------------------------------------------------------
ALTER TABLE "sacks" ADD COLUMN IF NOT EXISTS "packingGroupId" UUID;

CREATE INDEX IF NOT EXISTS "sacks_packingGroupId_idx"
    ON "sacks" ("packingGroupId");

-- SET NULL: grup normalde SİLİNMEZ (boşalınca yalnız görünmez olur). Bir gün boş
-- bir grup sert silinirse tanımı gereği çuvalı yoktur — SET NULL bilgi kaybetmez.
DO $paketleme_grubu_cuval_fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sacks_packingGroupId_fkey'
    ) THEN
        ALTER TABLE "sacks"
            ADD CONSTRAINT "sacks_packingGroupId_fkey"
            FOREIGN KEY ("packingGroupId") REFERENCES "packing_groups"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$paketleme_grubu_cuval_fk$;
