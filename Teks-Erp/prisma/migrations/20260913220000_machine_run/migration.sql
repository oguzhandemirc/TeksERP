-- =============================================================================
-- TEZGAH KOŞUMU — `machine_runs` (2026-09-13, dokuma Faz 1 · P2)
-- =============================================================================
-- NE YAPIYOR: bir tablo + iki ŞEMA-DIŞI partial unique + bir CHECK yaratır.
--   Yeni pg enum YOK (`MachineRun` hiç enum taşımıyor) ⇒ `ENUM_LABELS` borcu da yok.
--
-- ADDITIVE Mİ: EVET, tamamen. Var olan hiçbir tabloya/kolona DOKUNMAZ; yalnız
--   yeni nesne ekler. Geri alma = tabloyu düşürmek (henüz satır yok).
--
-- ⚠️ KOŞUM, TOPUN ROTASINDA BİR ADIM DEĞİLDİR. Bağ `weavingOrderId`dir,
--   `workOrderStepId` DEĞİL — dokuma topu DOĞURAN ayrı bir varlıktır.
--   Gerekçe: docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md §1.4
--   (kardeş belge DOKUMA-TEZGAH-IZLEME-TASARIMI.md §2.8 bu kararı henüz
--    uygulamamıştı; aynı commit'te düzeltildi).
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı; `migrate dev`
--   koşulmadı — iki DEFERRABLE composite FK'yı düşürmesin).
--
-- İNDEKSLER: üç domain FK'sı ([DB-12]) + bir composite (eşitlik önce: makine,
--   sonra zaman). `revokedById` BİLİNÇLİ INDEXSİZ ve FK'sız — "kim yaptı" alanı
--   üstünde süzme yapılmaz ([DB-11], 91 emsal).
--
-- ⚠️ `statement_timeout = 0` GEREKMİYOR: tablo boş doğuyor, index'ler sıfır
--   satır tarıyor. (Kural yüz binlerce satırlı tabloya index ekleyen migration
--   içindir.)
-- =============================================================================

CREATE TABLE "machine_runs" (
  "id"                 UUID          NOT NULL,
  "machineId"          UUID          NOT NULL,
  "clientToken"        UUID,
  "productionLineNo"   SMALLINT      NOT NULL DEFAULT 1,
  "startedAt"          TIMESTAMPTZ   NOT NULL,
  "endedAt"            TIMESTAMPTZ,
  "weavingOrderId"     UUID,
  "itemId"             UUID,
  "colorId"            UUID,
  "targetPicksPerMin"  INTEGER,
  "unitsPerCm"         NUMERIC(8,3),
  "picksAtClose"       INTEGER,
  "producedM"          NUMERIC(12,3),
  "observedSecAtClose" INTEGER,
  "stopSecAtClose"     INTEGER,
  "stopCountAtClose"   INTEGER,
  "closedTermsAt"      TIMESTAMPTZ,
  "revokedAt"          TIMESTAMPTZ,
  "revokedById"        UUID,
  "revokeReason"       VARCHAR(300),
  "createdAt"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ   NOT NULL,
  CONSTRAINT "machine_runs_pkey" PRIMARY KEY ("id")
);

-- Hat numarası 1'den küçük olamaz. Üst sınır (makinenin `productionLineCount`'u)
-- BURADA KURULAMAZ — satırlar arası CHECK yoktur; o doğrulama P4'ün servis
-- kapısına borçtur ve orada `MachineSpec` ile birlikte iner.
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_productionLineNo_pos"
  CHECK ("productionLineNo" >= 1);

CREATE UNIQUE INDEX "machine_runs_clientToken_key" ON "machine_runs"("clientToken");
CREATE INDEX "machine_runs_machineId_startedAt_idx" ON "machine_runs"("machineId", "startedAt");
CREATE INDEX "machine_runs_weavingOrderId_idx"      ON "machine_runs"("weavingOrderId");
CREATE INDEX "machine_runs_itemId_idx"              ON "machine_runs"("itemId");
CREATE INDEX "machine_runs_colorId_idx"             ON "machine_runs"("colorId");

-- ── İKİ ŞEMA-DIŞI PARTIAL UNIQUE ────────────────────────────────────────────
-- ⚠️ ANAHTAR `machineId` YALNIZ DEĞİL. Çift enli tezgah yan yana İKİ ayrı kumaş
--    koşar; yalnız makineye kilitlemek bunu YAPISAL OLARAK imkânsız kılardı.
--    Tek hatlı makinede `productionLineNo` sabit 1'dir ⇒ reddedilen küme
--    bugünküyle BİREBİR aynıdır: davranış korunur, gelecek açılır.
-- ⚠️ `revokedAt IS NULL` yüklemi İKİSİNDE DE ŞART: geri alınmış koşum sedde yer
--    İŞGAL ETMEZ, yoksa aynı hatta yeni koşum hiç açılamaz.
--    ⛔ Bu, `MACHINE_DELETE_GUARDS`taki ters yönle ÇELİŞMEZ — orada `revokedAt`
--    bilerek SÜZÜLMEZ, çünkü guard "bu makinede iş yapıldı mı" diye sorar,
--    sed ise "şu an açık mı" diye. İki gerekçe `guarded-hard-remove.ts` içindeki
--    `machineRunCount` guard'ında yan yana yazılıdır.
CREATE UNIQUE INDEX "machine_runs_one_open_per_prod_line_uq"
  ON "machine_runs"("machineId", "productionLineNo")
  WHERE "endedAt" IS NULL AND "revokedAt" IS NULL;

-- DOĞAL ANAHTAR. Beyan edilen doğal anahtarın sedde karşılığı olmazsa aynı
-- makinede aynı anda İKİ koşum açılır ve karnenin donmuş paydasının hangisinden
-- geldiği belirsizleşir.
CREATE UNIQUE INDEX "machine_runs_natural_uq"
  ON "machine_runs"("machineId", "productionLineNo", "startedAt")
  WHERE "revokedAt" IS NULL;

ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_weavingOrderId_fkey"
  FOREIGN KEY ("weavingOrderId") REFERENCES "weaving_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "machine_runs" ADD CONSTRAINT "machine_runs_colorId_fkey"
  FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
