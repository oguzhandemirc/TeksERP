-- =============================================================================
-- E-POSTA TEKİLLİĞİ YALNIZ ETKİN HESAPTA: bulut genelinde tekillik yalnız AKTIF · KILITLI hesaplarda (giriş
-- tesis sormaz — e-posta tek hesaba çözülmeli); davet (DAVETLI) ve arşiv (PASIF) e-postayı TUTMAZ. Aynı tesiste
-- PASİF olmayan iki hesap aynı e-postayı taşıyamaz. Veri DEĞİŞMEZ: eski tam tekillik iki yeni kümenin üst
-- kümesiydi, mevcut satırlar iki yeni indekse de uyar. Prisma kısmi indeksi şemada tanımaz (fark üretmez).
-- =============================================================================

DROP INDEX "accounts_email_key";

CREATE UNIQUE INDEX "accounts_email_etkin_key" ON "accounts" ("email") WHERE "status" IN ('AKTIF', 'KILITLI');
CREATE UNIQUE INDEX "accounts_tesis_email_key" ON "accounts" ("tesis_id", "email") WHERE "status" <> 'PASIF';
CREATE INDEX "accounts_email_idx" ON "accounts" ("email");
