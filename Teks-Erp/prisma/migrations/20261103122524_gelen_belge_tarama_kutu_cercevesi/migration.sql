-- K28 düzeltme (s13b inceleme): KÜÇÜK fotoğrafta OCR kutularının çerçevesi (saklanan fotoğraf yönünde).
-- NULL = kutular fotoğrafın kendi pikselinde (TAM). İkisi birlikte ve pozitif (IS NOT NULL: NULL karşılaştırma CHECK'i sessizce geçirirdi).
ALTER TABLE "document_scans" ADD COLUMN     "rectFrameHeight" INTEGER,
ADD COLUMN     "rectFrameWidth" INTEGER;

ALTER TABLE "document_scans" ADD CONSTRAINT "document_scans_rect_frame_ck"
  CHECK (("rectFrameWidth" IS NULL AND "rectFrameHeight" IS NULL)
      OR ("rectFrameWidth" IS NOT NULL AND "rectFrameHeight" IS NOT NULL AND "rectFrameWidth" > 0 AND "rectFrameHeight" > 0));
