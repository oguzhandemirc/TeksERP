-- =============================================================================
-- İstasyon duruş kapısı + duruş sebebinin istasyon türü kapsamı (2026-11-09, Gülkesim demosu)
-- =============================================================================
-- NE YAPIYOR (ADDITIVE; kolon varsayılanları = bugünkü davranış):
--   ① `stations.machineStopEnabled` BOOLEAN NOT NULL DEFAULT true — false iken insan duruş AÇAMAZ
--      (servis 400 `STOP_STATION_DISABLED`); açık duruşu kapatma/sınıflama serbest.
--   ② `reason_presets.stationKinds` "StationKind"[] DEFAULT '{}' — boş = her istasyon (bugün);
--      dolu = yalnız o türlerin tablet listesi. Prisma liste kolonu biçimi (`legacyTexts` emsali).
--   ③ CHECK `reason_presets_station_kinds_chk`: dolu kapsam yalnız `MACHINE_STOP`ta (servis ikizi
--      `resolveStationKinds`, 400 `STOP_STATION_KINDS_NOT_APPLICABLE`). Mevcut satırlar boş → hepsi geçer.
--   ④ VERİ (bir kez, kod listesiyle): sistem kataloğunun dokumaya özgü 12 duruş sebebi DOKUMA'ya
--      (`WEAVING`) bağlanır. YALNIZ `isSystem` ∧ kapsamı hâlâ boş satır — fabrikanın kendi satırı ve
--      elle kapsam verilmiş satır ezilmez. Liste `constants/reason-presets.ts` MACHINE_STOP_REASONS'taki
--      `stationKinds: ["WEAVING"]` satırlarıyla AYNI (bekçi `test_durus_istasyon_kapsami` §6 ölçer);
--      yeni kurulumda satırı boot uzlaştırması kapsamıyla doğurur, bu UPDATE orada no-op'tur.
-- İDEMPOTENT: IF NOT EXISTS / DO bloğu; ④ boş kapsam koşuluyla ikinci koşumda 0 satır.
-- DropForeignKey satırları (rolls/swatches composite FK) bilinçli SİLİNDİ — şema notu.
-- =============================================================================

ALTER TABLE "reason_presets" ADD COLUMN IF NOT EXISTS "stationKinds" "StationKind"[] DEFAULT ARRAY[]::"StationKind"[];

ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "machineStopEnabled" BOOLEAN NOT NULL DEFAULT true;

DO $station_kinds_chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reason_presets_station_kinds_chk') THEN
    ALTER TABLE "reason_presets" ADD CONSTRAINT "reason_presets_station_kinds_chk"
      CHECK ("kind" = 'MACHINE_STOP' OR cardinality(COALESCE("stationKinds", ARRAY[]::"StationKind"[])) = 0);
  END IF;
END
$station_kinds_chk$;

UPDATE "reason_presets"
   SET "stationKinds" = ARRAY['WEAVING']::"StationKind"[]
 WHERE "kind" = 'MACHINE_STOP'
   AND "isSystem" = true
   AND cardinality(COALESCE("stationKinds", ARRAY[]::"StationKind"[])) = 0
   AND "code" IN (
     'COZGU_KOPUSU', 'ATKI_KOPUSU', 'KENAR_KOPUSU', 'IPLIK_BITTI', 'JAKAR_ARIZA', 'LEVENT_BAGLAMA',
     'TAHAR', 'TARAK_DEGISIMI', 'DESEN_DEGISIMI', 'TOP_ALMA', 'TEZGAH_KAPALI', 'KUMAS_TAMIR'
   );
