-- =============================================================================
-- DEVERE FAZ 1a — ÇÖZGÜ KARTI (`warp_specs`) + iplik/kumaş ve istasyon alanları
-- =============================================================================
-- TAMAMEN EKLEMELİ: yeni bir tablo, İKİ nullable kolon (`items`) ve varsayılanlı
-- BİR boolean (`stations`). Mevcut hiçbir satırın davranışı değişmez; devere
-- modülü kapalı olduğu sürece hiçbir yüzey bu alanları çizmez.
--
-- ⚠️ `items`e nullable kolon eklemek PG 11+ sürümünde tablo YENİDEN YAZIMI
-- üretmez (DEFAULT yok → yalnız katalog değişikliği). `stations.producesWarpBeam`
-- DEFAULT'lu ama `false` sabiti olduğu için o da hızlı yol (PG 11+ "add column
-- with non-volatile default"). Fabrika tablolarında ACCESS EXCLUSIVE kilidi
-- yalnız katalog süresince tutulur.
--
-- ⚠️ `nameFold` GENERATED STORED: değeri DB üretir, uygulama HİÇ yazmaz
-- (`public.tr_fold`, IMMUTABLE). Diğer altı ana veri tablosunun birebir ikizi
-- (migration 20260819060000). Prisma tarafında `@default(dbgenerated())`.
--
-- ⚠️ AD SEDDİ NON-PARTIAL: `warp_specs`te birleştirme (merge) tombstone'u YOK
-- (`Item.mergedIntoId` gibi bir kolon taşımıyor), bu yüzden unique koşulsuzdur.
-- Birleştirme haritasına `WarpSpec.yarnItemId` ayrı bir iştir (aynı fazın
-- ekran adımı): iki mükerrer İPLİK kartı birleşince çözgü kartı survivor'a
-- taşınmalı, yoksa mezar taşına bakmaya devam eder.
--
-- ⚠️ FK'lar `ON DELETE RESTRICT`: çözgü kartı yaşayan bir ipliğin kalıcı
-- silinmesini engeller. Kalıcı silme uçları bağımlılığı FK'dan değil ELLE
-- yazılmış guard listesinden okur — Türkçe 409 için o liste de aynı fazda
-- genişletilir (ham P2003 kullanıcıya mesaj değildir).
--
-- Tasarım: `docs/design/DEVERE-LEVENT-TARAMASI.md` §4.2 · §4.5 · §4.6.
-- =============================================================================

-- 1) ÇÖZGÜ KARTI --------------------------------------------------------------
CREATE TABLE "warp_specs" (
  "id"           uuid         NOT NULL,
  "code"         varchar(32)  NOT NULL,
  "name"         varchar(100) NOT NULL,
  "yarnItemId"   uuid         NOT NULL,
  "endsCount"    integer      NOT NULL,
  "selvedgeEnds" integer,
  "reedNo"       numeric(6,2),
  "endsPerDent"  integer,
  "reedWidthCm"  numeric(6,2),
  "notes"        varchar(500),
  "isActive"     boolean      NOT NULL DEFAULT true,
  "createdAt"    timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz  NOT NULL,
  "createdById"  uuid,
  "updatedById"  uuid,
  CONSTRAINT "warp_specs_pkey" PRIMARY KEY ("id")
);

-- Katlanmış arama gölgesi — değeri DB üretir (uygulama yazamaz, PG reddeder).
ALTER TABLE "warp_specs"
  ADD COLUMN "nameFold" text GENERATED ALWAYS AS (public.tr_fold("name")) STORED;

CREATE UNIQUE INDEX "warp_specs_code_key" ON "warp_specs" ("code");
CREATE UNIQUE INDEX "warp_specs_nameFold_key" ON "warp_specs" ("nameFold");
CREATE INDEX "warp_specs_yarnItemId_idx" ON "warp_specs" ("yarnItemId");

-- Devere formülünün ilk çarpanı: tel adedi sıfır/negatif olamaz.
-- (`kg = tel × denye × metre / 9.000.000`)
ALTER TABLE "warp_specs"
  ADD CONSTRAINT "warp_specs_ends_positive" CHECK ("endsCount" > 0);

ALTER TABLE "warp_specs"
  ADD CONSTRAINT "warp_specs_yarnItemId_fkey" FOREIGN KEY ("yarnItemId")
  REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warp_specs"
  ADD CONSTRAINT "warp_specs_createdById_fkey" FOREIGN KEY ("createdById")
  REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "warp_specs"
  ADD CONSTRAINT "warp_specs_updatedById_fkey" FOREIGN KEY ("updatedById")
  REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) İPLİK NUMARASI + KUMAŞ → ÇÖZGÜ KARTI BAĞI --------------------------------
-- `linearDensityDen` = denye (9.000 m'nin gramı). ELLE girilir; stok kartı ADI
-- ("600 KAR İPİ 70 DN") ASLA ayrıştırılmaz ve bu alana taşınmaz.
ALTER TABLE "items" ADD COLUMN "linearDensityDen" numeric(10,4);
ALTER TABLE "items" ADD COLUMN "warpSpecId" uuid;

CREATE INDEX "items_warpSpecId_idx" ON "items" ("warpSpecId");
ALTER TABLE "items"
  ADD CONSTRAINT "items_warpSpecId_fkey" FOREIGN KEY ("warpSpecId")
  REFERENCES "warp_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) İSTASYON YETENEĞİ: bu istasyonda LEVENT DOĞAR mı -------------------------
-- VARSAYILAN FALSE = bugünkü davranış; hiçbir mevcut istasyon devere değildir.
ALTER TABLE "stations"
  ADD COLUMN "producesWarpBeam" boolean NOT NULL DEFAULT false;
