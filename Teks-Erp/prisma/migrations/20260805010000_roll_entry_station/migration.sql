-- =============================================================================
-- Roll.entryStationId — TOPUN GİRİŞ İSTASYONU (kalıcı köken izi)
-- =============================================================================
-- SAHA TALEBİ (2026-08-05): "sistemdeki tüm kumaşlarda giriş istasyonu ve yapan
-- personel diye sütun var mı?"
--
-- Personel ve makine ZATEN kolondu (`createdById` / `createdMachineId`); eksik
-- olan tek şey İSTASYONDU ve o güne kadar ancak DOLAYLI çözülebiliyordu:
--   createdMachineId -> Machine.stationId
--
-- Bu dolaylı yol İKİ YERDEN bozuk:
--   1) GERİYE DÖNÜK DEĞİŞİR. Makine başka bir istasyona taşınırsa, o makinede
--      aylar önce girilmiş toplar bugün BAŞKA bir istasyonda girilmiş görünür.
--      "Giriş istasyonu" tarihsel bir olgudur; canlı bir ilişkiden okunamaz.
--      (Donmuş belge kuralının aynısı: olay anındaki gerçek saklanır.)
--   2) EKSİK KAPSAR. Makine damgası yalnız oturumlu (tablet) girişlerde dolar.
--      Oysa istasyon bağlamı makine olmadan da bilinir — Tambur kesiminde,
--      fason kabulünde ve elle ekleme akışlarında adım/istasyon zaten elde.
--
-- Bu yüzden alan TÜRETİLMİYOR, DAMGALANIYOR: top doğarken yazılır, bir daha
-- değişmez.
--
-- ⚠️ `currentStepId -> step.station` ile KARIŞTIRMA. O alan topun ŞU AN nerede
-- olduğunu söyler ve top depoya inince NULL'a düşer. Bu alan "nereden geldi"
-- sorusunun kalıcı cevabıdır. İkisi envanterde AYRI sütunlardır ("İstasyon" ve
-- "Giriş İstasyonu") ve karıştırılırsa depodaki her top "istasyonsuz" görünür.
--
-- NULL MEŞRUDUR: istasyon bağlamı taşımayan girişler (Electron paneli) ve bu
-- karardan ÖNCE doğmuş toplar. Geriye doldurma AYRI bir iştir ve ayrı script
-- ile, dry-run varsayılan olarak yapılır (kök CLAUDE.md).
--
-- MALİYET: nullable kolon eklemek PG11+'ta metadata-only'dir — tablo yeniden
-- YAZILMAZ (2026-08-04'te dolu `rolls` üzerinde ölçüldü: 6 ms). Index ise
-- gerçek iş yapar; bugünkü satır sayısında anlıktır. Vardiya kısıtı bu
-- migration için geçerli DEĞİL.
--
-- FK davranışı `createdMachineId` ile BİREBİR aynı (opsiyonel ilişki →
-- ON DELETE SET NULL / ON UPDATE CASCADE). Kardeş alanlardan sapmak, elle
-- yazılmış SQL ile Prisma'nın beklentisi arasında kalıcı drift üretirdi.
-- =============================================================================

ALTER TABLE "rolls" ADD COLUMN "entryStationId" UUID;

CREATE INDEX "rolls_entryStationId_idx" ON "rolls"("entryStationId");

ALTER TABLE "rolls"
  ADD CONSTRAINT "rolls_entryStationId_fkey"
  FOREIGN KEY ("entryStationId") REFERENCES "stations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
