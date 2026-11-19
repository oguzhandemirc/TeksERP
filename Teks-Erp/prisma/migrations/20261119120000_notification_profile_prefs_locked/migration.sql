-- BİLDİRİM PROFİLİ TERCİH KİLİDİ (2026-11-19) — YALNIZ EKLEME.
-- Varsayılan false = bugünkü davranış (üyeler kişisel tercih yazabilir); mevcut satırlar etkilenmez.

-- AlterTable
ALTER TABLE "notification_profiles" ADD COLUMN "prefsLocked" BOOLEAN NOT NULL DEFAULT false;
