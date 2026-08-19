-- KAYIT KÜNYESİ — FAZ A2 (2026-08-19) · docs/design/KAYIT-KUNYESI-TASARIM.md
-- 11 model: 9 eksik master-data + WorkOrder ("kim açtı" HİÇ yoktu) + Shipment
-- (planlayan ≠ sevk eden → dispatchedById'den FARKLI bilgi).
-- Kalan 14 işlem tablosuna EKLENMEZ: mevcut aktör (dispatchedBy/receivedBy/
-- weighedBy) aynı soruyu cevaplıyor, ikincisi çoğaltma olurdu.
--
-- ⚠️ `users` KENDİ KENDİNE referans verir ("bu hesabı kim açtı") — adlandırılmış
-- self-relation, Prisma'da geçerli.
-- ⚠️ `migrate dev`in ürettiği iki sahte DropForeignKey ELLE SİLİNDİ (perf #4).
-- ⚠️ RollError KAPSAM DIŞI BIRAKILDI: zaten `detectedByUserId` (kim kaydetti)
-- ve `processedByUserId` (kim çözdü) taşıyor — künye eklemek "iki alan aynı
-- soruyu cevaplıyor" belirsizliği olurdu. İlk taramada kaçmıştı çünkü regex
-- yalnız `*ById` arıyordu, `*UserId` kalıbını görmüyordu.
--
-- Hepsi NULLABLE → tablo yeniden yazımı yok, anlık. FK index bilinçli YOK
-- (kullanıcı hard-delete edilmiyor — bekçi bunu kilitliyor).

-- AlterTable
ALTER TABLE "customer_color_aliases" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "customer_item_aliases" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "customer_standalone_labels" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "document_profiles" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "permission_templates" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "subcontractor_categories" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "traveler_card_templates" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "updatedById" UUID;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_templates" ADD CONSTRAINT "permission_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_templates" ADD CONSTRAINT "permission_templates_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_categories" ADD CONSTRAINT "subcontractor_categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_categories" ADD CONSTRAINT "subcontractor_categories_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_profiles" ADD CONSTRAINT "document_profiles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_profiles" ADD CONSTRAINT "document_profiles_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_item_aliases" ADD CONSTRAINT "customer_item_aliases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_item_aliases" ADD CONSTRAINT "customer_item_aliases_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_color_aliases" ADD CONSTRAINT "customer_color_aliases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_color_aliases" ADD CONSTRAINT "customer_color_aliases_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_standalone_labels" ADD CONSTRAINT "customer_standalone_labels_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_standalone_labels" ADD CONSTRAINT "customer_standalone_labels_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_card_templates" ADD CONSTRAINT "traveler_card_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_card_templates" ADD CONSTRAINT "traveler_card_templates_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
