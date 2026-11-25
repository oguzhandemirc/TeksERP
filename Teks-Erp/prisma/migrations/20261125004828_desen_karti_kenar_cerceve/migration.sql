-- Seyitoğlu dilim C: desen kartında kenar (selvedge) çerçeve işareti — yalnız EKLEME (`lenoFrames` ikizi).
-- Eski kayıt boş dizi alır (işaret yok = bugünkü görünüm); mevcut döner işaretleri DEĞİŞMEZ.
ALTER TABLE "weave_designs" ADD COLUMN "selvedgeFrames" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- 1-tabanlı çerçeve no 1..32 (servis `parseFrameList` ikizi; ızgara tavanı LIFT_PLAN_MAX_FRAMES).
ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_selvedge_frames_range_chk"
  CHECK (cardinality("selvedgeFrames") <= 32 AND 1 <= ALL ("selvedgeFrames") AND 32 >= ALL ("selvedgeFrames"));

-- Bir çerçeve hem döner hem kenar olamaz (servis 400 WEAVE_DESIGN_FRAME_ROLE_CONFLICT ikizi). Eski satırlarda
-- kenar boş olduğundan kesişim yok; kısıt veri temizliği gerektirmez.
ALTER TABLE "weave_designs" ADD CONSTRAINT "weave_designs_selvedge_leno_disjoint_chk"
  CHECK (NOT ("selvedgeFrames" && "lenoFrames"));
