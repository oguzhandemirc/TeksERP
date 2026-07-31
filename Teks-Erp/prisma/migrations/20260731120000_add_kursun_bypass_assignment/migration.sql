-- =============================================================================
-- Kurşun Bypass Ataması — kurşun istasyonlarına tablet KOYULMUYOR
-- =============================================================================
-- Fabrika kurşun istasyonlarına tablet koymak istemiyor: kurşun işlemi fiziksel
-- olarak YAPILIR ama dijital izlenmez (hatalar kâğıtta kalır). Yetkili personel,
-- kurşun adımında bekleyen iş emrini "Kurşun Dağıtım" ekranından bir fiziksel
-- kurşun istasyonuna ATAR; adım daha sonra Tambur'da refakat kartı okutmasıyla
-- (TAMBUR_SCAN) ya da kurşun rotanın SON adımıysa dağıtım ekranındaki "İşi Bitir"
-- ile (DISTRIBUTION_LAST_STEP) tamamlanır.
--
-- ⚠️ Bu SKIPPED DEĞİLDİR: adım atlanmaz, RollMovement'lar normal şekilde kapanır
-- ve adım COMPLETED olur. Fark, RollOperation (KURSUN_APPLIED / QC2_COMPLETED)
-- yazılmaması ve RollError açılmamasıdır. Bu tablo o rejimin kalıcı izidir.
--
-- ⚠️ ELLE YAZILDI, `prisma migrate dev` ÜRETMEDİ. İki sebep:
--   (1) `sacks` üstündeki 2 DEFERRABLE raw-SQL composite FK'yı Prisma'nın diff
--       motoru her seferinde DROP etmek ister (schema.prisma uyarısı) — canlı DB'de
--       `migrate dev` koşmak o seddi sessizce düşürür.
--   (2) Aşağıdaki PARTIAL UNIQUE `@@unique` ile ifade edilemez.
-- Uygulama sırası: `git add` → `prisma db execute` → `migrate resolve --applied`
-- → DOĞRULA (`\d+` / `pg_enum` / `pg_indexes`). `resolve` SQL'in KOŞTUĞUNU
-- kanıtlamaz, yalnız `_prisma_migrations`'a satır yazar (D-23).
--
-- CANLI VERİYE DOKUNMAZ: yalnız yeni bir enum + yeni bir BOŞ tablo yaratır.
-- Mevcut tablolarda ALTER yok → rewrite yok, uzun kilit yok. Geri alma:
-- DROP TABLE "kursun_bypass_assignments"; DROP TYPE "KursunBypassCompletionSource";
-- =============================================================================

-- Büyük tabloya index ekleyen migration'larda 50s statement_timeout tuzağına karşı
-- (D-14). Burada tablo BOŞ doğduğu için pratikte no-op; house style gereği duruyor.
SET statement_timeout = 0;

-- CreateEnum — atamanın hangi YOLDAN tamamlandığı (izlenebilirlik: "bu iş nasıl kapandı?")
--   TAMBUR_SCAN            : Tambur tabletinde kart okutuldu + önizleme onaylandı
--   DISTRIBUTION_LAST_STEP : kurşun rotanın son adımıydı, dağıtım ekranından bitirildi
CREATE TYPE "KursunBypassCompletionSource" AS ENUM ('TAMBUR_SCAN', 'DISTRIBUTION_LAST_STEP');

-- CreateTable — APPEND-ONLY + SOFT-CANCEL. Satır asla silinmez:
--   tamamlanma → completedAt/completedById/completedVia damgalanır
--   iptal      → cancelledAt/cancelledById/cancelReason yazılır ve adımın
--                istasyonu originalStationId'den GERİ YÜKLENİR
CREATE TABLE "kursun_bypass_assignments" (
    "id" UUID NOT NULL,
    -- DENORMALİZE: workOrderStepId'den türetilebilir ama "bu WO'nun açık bypass
    -- ataması var mı" sorgusu hem dağıtım ekranının hem Tambur önizlemesinin sıcak
    -- yolu → join'siz tek index taraması için tutulur.
    "workOrderId" UUID NOT NULL,
    "workOrderStepId" UUID NOT NULL,
    -- ATANAN fiziksel kurşun istasyonu (stations.kind = 'PROCESS_QC')
    "stationId" UUID NOT NULL,
    -- Atama anındaki work_order_steps."stationId" — iptalde adıma geri yazılır
    "originalStationId" UUID NOT NULL,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(500),
    "completedAt" TIMESTAMPTZ,
    "completedById" UUID,
    "completedVia" "KursunBypassCompletionSource",
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(200),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kursun_bypass_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — FK index'leri (Prisma otomatik yaratmaz; house rule #1)
-- WO bazlı açık-atama lookup'ı (denormalize kolon sayesinde join'siz)
CREATE INDEX "kursun_bypass_assignments_workOrderId_idx" ON "kursun_bypass_assignments"("workOrderId");
CREATE INDEX "kursun_bypass_assignments_workOrderStepId_idx" ON "kursun_bypass_assignments"("workOrderStepId");
-- Dağıtım ekranı: "bu kurşun istasyonuna atanmış işler" listesi
CREATE INDEX "kursun_bypass_assignments_stationId_idx" ON "kursun_bypass_assignments"("stationId");

-- ŞEMA-DIŞI PARTIAL UNIQUE — "bir adımda EN FAZLA BİR AÇIK atama" seddi.
--
-- NEDEN düz @unique DEĞİL: fason çok-parti gerçeği. Bir iş emrinin 1. partisi
-- bypass ile biter, 2. parti haftalar sonra fason kabulüyle gelir ve AYNI
-- work_order_step için YENİ bir atama satırı gerekir. workOrderStepId'ye tam
-- UNIQUE koymak ikinci partiyi kalıcı olarak bloklardı. Teklik yalnız AÇIK
-- (tamamlanmamış + iptal edilmemiş) atamada anlamlıdır.
--
-- NEDEN app-level kontrol yetmez: iki dağıtımcı aynı işi aynı anda atarsa
-- "önce SELECT sonra INSERT" yarışı ikisini de geçirir → adım iki istasyona
-- atanmış görünür ve originalStationId geri-yükleme zinciri bozulur. Bu index
-- yarışın kaybedenine P2002 verdirir; servis onu 409'a çevirir.
--
-- Prisma `@@unique` predicate taşıyamadığı için schema.prisma'da karşılığı
-- bilinçli olarak YOK (roll_movements_one_open_per_roll_step_uq emsali).
-- Envanteri scripts/test_db_invariants.ts tutar — düşerse test FAIL verir.
CREATE UNIQUE INDEX "kursun_bypass_one_pending_per_step_uq"
  ON "kursun_bypass_assignments"("workOrderStepId")
  WHERE "completedAt" IS NULL AND "cancelledAt" IS NULL;

-- AddForeignKey — hepsi RESTRICT: bypass izi, işaret ettiği WO/adım/istasyon/kullanıcı
-- silinerek koparılamaz (zaten sistemde fiziksel DELETE yok, soft-delete var).
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_originalStationId_fkey" FOREIGN KEY ("originalStationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
