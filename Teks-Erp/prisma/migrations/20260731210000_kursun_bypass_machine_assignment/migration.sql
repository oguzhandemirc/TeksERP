-- =============================================================================
-- Kurşun Bypass — atama İSTASYONDAN MAKİNEYE taşınıyor
-- =============================================================================
-- NEDEN: `20260731120000_add_kursun_bypass_assignment` atamayı YANLIŞ seviyede
-- modelledi. Fabrika gerçeği şu: PROCESS_QC türünde TEK bir istasyon var
-- (KURSUN_KK2) ve altında N adet fiziksel kurşun MAKİNESİ (machines) duruyor.
-- Dağıtımcının seçtiği şey istasyon değil, o makinelerden biridir.
--
-- Eski tasarımın üç sonucu düşüyor:
--   1. "atanan istasyon" (stationId) anlamsız — istasyon zaten tek, hep aynı.
--   2. work_order_steps."stationId" REPOINT'i (ve dolayısıyla iptalde geri
--      yükleme için tutulan originalStationId) TAMAMEN KALKIYOR. Adımın
--      istasyonu artık hiç değişmiyor; atama bilgisi adımda değil BU SATIRDA
--      yaşıyor. (work_order_steps'e "machineId" kolonu EKLENMİYOR — bilinçli.)
--   3. Makine artık bilindiği için movement kapanışında roll_movements."machineId"
--      ATANAN MAKİNE ile damgalanabiliyor (eskiden "iş-takipli bir makinede
--      yapılmadı" gerekçesiyle NULL bırakılıyordu; makine bazlı atamada o gerekçe
--      çöküyor). Makine bazlı hacim raporları bu sayede çalışır.
--
-- ⚠️ `20260731120000_add_kursun_bypass_assignment` UYGULANMIŞ + PUSH EDİLMİŞTİR
-- (IMMUTABLE) — ona DOKUNULMADI, düzeltme bu YENİ migration'a yazıldı.
--
-- GÜVENLİ — VERİ KAYBI YOK: tablo BOŞ (canlıda 0 satır; özellik bayrağı kapalı,
-- sahada hiç koşmadı). Bu yüzden kolon DROP'u kayıpsız ve yeni kolon NOT NULL
-- doğabiliyor (backfill/DEFAULT gerekmiyor). Başka hiçbir tabloya dokunulmuyor.
--
-- ⚠️ ELLE YAZILDI, `prisma migrate dev` ÜRETMEDİ — `sacks` üstündeki 2 DEFERRABLE
-- raw-SQL composite FK'yı Prisma'nın diff motoru her seferinde DROP etmek ister
-- (schema.prisma uyarısı); canlı DB'de `migrate dev` o seddi sessizce düşürür.
-- Uygulama sırası: `git add` → `prisma db execute` → `migrate resolve --applied`
-- → DOĞRULA (`\d kursun_bypass_assignments`). `resolve` SQL'in KOŞTUĞUNU
-- kanıtlamaz, yalnız `_prisma_migrations`'a satır yazar (D-23).
--
-- Geri alma: ters yönde ALTER (machineId DROP + iki UUID NOT NULL kolonu ADD)
-- yalnız tablo BOŞKEN mümkündür; satır doğduktan sonra geri alma = yedekten
-- restore (repo kuralı: migration'lar geri-alınamaz kabul edilir).
--
-- KORUNAN: şema-dışı partial unique `kursun_bypass_one_pending_per_step_uq`
-- ("workOrderStepId" WHERE completedAt IS NULL AND cancelledAt IS NULL) —
-- "adım başına EN FAZLA BİR açık atama" kuralı değişmedi ve dokunulan
-- kolonların hiçbiri o index'te geçmiyor, bu yüzden yeniden yaratılmıyor.
-- Envanteri scripts/test_db_invariants.ts tutar.
-- =============================================================================

-- House style (D-14): büyük tabloya DDL uygularken 50s statement_timeout tuzağı.
-- Burada tablo BOŞ olduğu için pratikte no-op.
SET statement_timeout = 0;

-- DropForeignKey — atanan/orijinal istasyon FK'ları (constraint adları psql
-- `\d kursun_bypass_assignments` çıktısından doğrulandı)
ALTER TABLE "kursun_bypass_assignments" DROP CONSTRAINT "kursun_bypass_assignments_stationId_fkey";
ALTER TABLE "kursun_bypass_assignments" DROP CONSTRAINT "kursun_bypass_assignments_originalStationId_fkey";

-- DropIndex — "bu istasyona atanmış işler" lookup'ı yerini makine bazlısına bırakıyor
DROP INDEX "kursun_bypass_assignments_stationId_idx";

-- DropColumn — istasyon seviyesindeki atama alanları
--   stationId         : istasyon tek olduğu için bilgi taşımıyordu
--   originalStationId : yalnız step.stationId repoint'ini geri almak için vardı;
--                       repoint kalktığı için karşılığı da kalmadı
ALTER TABLE "kursun_bypass_assignments"
  DROP COLUMN "stationId",
  DROP COLUMN "originalStationId";

-- AddColumn — ATANAN fiziksel kurşun makinesi. Tablo boş olduğu için NOT NULL
-- doğrudan eklenebiliyor (geçici DEFAULT + backfill + DROP DEFAULT dansı gereksiz).
-- Nullable DEĞİL: makinesiz bir bypass ataması anlamsızdır — atamanın TEK bilgisi odur.
ALTER TABLE "kursun_bypass_assignments" ADD COLUMN "machineId" UUID NOT NULL;

-- CreateIndex — FK index'i zorunlu (house rule #1, Prisma otomatik yaratmaz).
-- Sıcak yol: dağıtım/izleme ekranında "bu makinede hangi iş var, sıra ne kadar".
CREATE INDEX "kursun_bypass_assignments_machineId_idx" ON "kursun_bypass_assignments"("machineId");

-- AddForeignKey — RESTRICT: bypass izi, işaret ettiği makine silinerek koparılamaz
-- (sistemde fiziksel DELETE zaten yok, makineler isActive=false ile emekliye ayrılır).
ALTER TABLE "kursun_bypass_assignments" ADD CONSTRAINT "kursun_bypass_assignments_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
