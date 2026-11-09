-- Tamburda kesim anında topa yazılan müşteri etiket kumaş adı / rengi (yalnız eklemeli, nullable; geçmiş toplar NULL = bugünkü etiket).
-- AlterTable
ALTER TABLE "rolls" ADD COLUMN     "labelColorName" VARCHAR(80),
ADD COLUMN     "labelItemName" VARCHAR(80);
