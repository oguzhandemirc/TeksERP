-- Seyitoğlu dilim b: desen kartında döner (leno/doup) çerçeve işareti — yalnız EKLEME.
-- Eski kayıt boş dizi alır (işaret yok = bugünkü görünüm); `lenoSetup` metni olduğu gibi kalır.
ALTER TABLE "weave_designs" ADD COLUMN "lenoFrames" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- 1-tabanlı çerçeve no 1..32 (servis `parseLenoFrames` ikizi; ızgara tavanı LIFT_PLAN_MAX_FRAMES).
ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_leno_frames_range_chk"
  CHECK (cardinality("lenoFrames") <= 32 AND 1 <= ALL ("lenoFrames") AND 32 >= ALL ("lenoFrames"));
