-- Faz 1: Roll.form (TOP | ACIK) — fiziksel form. Davranış değişikliği yok; tüm
-- mevcut/yeni satırlar varsayılan TOP. ACIK'i ilerideki fazlar (Tambur-dışı finalize,
-- fason dönüşü doğumları, açık kumaş) yazacak.

-- CreateEnum
CREATE TYPE "RollForm" AS ENUM ('TOP', 'ACIK');

-- AlterTable
ALTER TABLE "rolls" ADD COLUMN "form" "RollForm" NOT NULL DEFAULT 'TOP';
