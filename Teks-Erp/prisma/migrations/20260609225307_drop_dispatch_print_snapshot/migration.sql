/*
  Warnings:

  - You are about to drop the column `printSnapshot` on the `kartela_dispatches` table. All the data in the column will be lost.
  - You are about to drop the column `printSnapshot` on the `subcontractor_dispatches` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "kartela_dispatches" DROP COLUMN "printSnapshot";

-- AlterTable
ALTER TABLE "subcontractor_dispatches" DROP COLUMN "printSnapshot";
