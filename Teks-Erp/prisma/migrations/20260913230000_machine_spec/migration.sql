-- =============================================================================
-- TEZGAH KÜNYESİ — `machine_specs` (2026-09-13, dokuma Faz 1 · P4)
-- =============================================================================
-- NE YAPIYOR: iki pg enum + bir tablo yaratır.
--   LoomShedType            ARMUR | JAKAR | KAM
--   MachineMonitoringState  OFF | SHADOW | LIVE
--
-- ADDITIVE Mİ: EVET, tamamen. Var olan hiçbir tabloya/kolona DOKUNMAZ.
--   Referans profilde (adnansahin) tablo BOŞ kalır ve `machines` bugünkü hâliyle
--   davranır — sıfır fark. Geri alma = tabloyu ve iki tipi düşürmek (satır yok).
--
-- ⚠️ `CREATE TYPE` ONU KULLANAN `CREATE TABLE` İLE AYNI DOSYADA — ve bu DOĞRU.
--   `docs/RECETELER.md` § enum'un *"AYRI ve TEK İFADELİ migration"* kuralı
--   `ALTER TYPE … ADD VALUE`a özgüdür (PG 55P04: yeni enum DEĞERİ kendi tx'inde
--   kullanılamaz). YENİ BİR TİPİN `CREATE TYPE`ı bu kısıta tabi değildir.
--   Emsal: `20260913180000_weaving_order` (P1) ve aynı gün P2. Ayrım reçeteye
--   bu commit'te yazıldı — üçüncü kez kurulan bir emsal, sınırını da yazar.
--
-- ⚠️ SATIRIN VARLIĞI "bu makine İZLENİYOR" demektir, "bu makine bir TEZGAHTIR"
--   değil. `machines`e kolon eklenmedi: alanlar oraya girseydi referans profilin
--   kurşun makinesinde ölü kolon olurdu.
--
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya elle yazıldı; `migrate dev`
--   koşulmadı — iki DEFERRABLE composite FK'yı düşürmesin).
--
-- FK AKSİYONU: `machineId` → `Cascade` (künye makinesiz anlamsız). Envanter
--   satırı `test_hard_delete_guard_coverage` `EXPECTED` listesinde.
--   Künye FK'ları (`createdById`/`updatedById`) VAR ama BİLİNÇLİ INDEXSİZ
--   ([DB-11], 91 emsal: "kim yaptı" alanı üstünde süzme yapılmaz).
--   ⚠️ [DB-11] İNDEKSİ kaldırır, FK'yı DEĞİL — ikisi karıştırılırsa şema ile DB
--   ayrışır ve `test_schema_drift` "2 BELGESİZ fark" der (bu dosyada bir kez oldu
--   ve bekçi yakaladı). `WeavingOrder` künyeyi FK'sız tutar çünkü orada Prisma
--   İLİŞKİSİ hiç tanımlanmamıştır; burada ilişki tanımlı ⇒ FK zorunlu.
--
-- ⚠️ `statement_timeout = 0` GEREKMİYOR: tablo boş doğuyor.
-- =============================================================================

CREATE TYPE "LoomShedType" AS ENUM ('ARMUR', 'JAKAR', 'KAM');
CREATE TYPE "MachineMonitoringState" AS ENUM ('OFF', 'SHADOW', 'LIVE');

CREATE TABLE "machine_specs" (
  "id"                 UUID          NOT NULL,
  "machineId"          UUID          NOT NULL,
  "shedType"           "LoomShedType",
  "monitoringState"    "MachineMonitoringState" NOT NULL DEFAULT 'OFF',
  "acceptedAt"         TIMESTAMPTZ,
  "acceptedById"       UUID,
  "acceptedNote"       VARCHAR(300),
  "demotedAt"          TIMESTAMPTZ,
  "demotedById"        UUID,
  "demoteReason"       VARCHAR(300),
  "nominalPicksPerMin" INTEGER,
  "baselineRunHours"   NUMERIC(12,2),
  "baselineAt"         TIMESTAMPTZ,
  "notes"              VARCHAR(500),
  "createdAt"          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ   NOT NULL,
  "createdById"        UUID,
  "updatedById"        UUID,
  CONSTRAINT "machine_specs_pkey" PRIMARY KEY ("id")
);

-- Makine başına EN FAZLA BİR künye. `machineId` üzerinde index'i bu unique
-- kapsıyor ([DB-12]) — ayrı `@@index` açılmadı.
CREATE UNIQUE INDEX "machine_specs_machineId_key" ON "machine_specs"("machineId");

ALTER TABLE "machine_specs" ADD CONSTRAINT "machine_specs_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "machine_specs" ADD CONSTRAINT "machine_specs_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "machine_specs" ADD CONSTRAINT "machine_specs_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
