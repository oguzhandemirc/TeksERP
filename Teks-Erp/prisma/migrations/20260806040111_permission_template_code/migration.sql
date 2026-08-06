-- Yetki şablonuna (rol) KALICI KİMLİK.
--
-- Neden: rol şablonları 2026-08-06'ya kadar yalnız `prisma/seed.ts`'te yaşıyordu
-- ve seed yalnız ilk kurulumda koşuyordu → canlı fabrikada "Admin (Tam Yetki)"
-- şablonu 55 izin taşırken katalog 67'ye çıkmıştı (o şablonla açılan yeni
-- yönetici 12 yetkiyi almıyordu) ve masaüstü rolleri hiç yoktu. Artık roller
-- kodda tek kaynakta yaşar ve backend her açılışta eksikleri yazar
-- (`src/jobs/role-template-catalog.job.ts`).
--
-- Uzlaştırmanın şablonu ADIYLA bulması yeterli DEĞİL: fabrika paneli şablonu
-- yeniden adlandırabilir ve ada bakan bir uzlaştırma o rolü "yok" sayıp ikizini
-- doğururdu. Kimlik bu yüzden koddur. NULL = fabrikanın kendi yarattığı şablon;
-- uzlaştırma ona hiç dokunmaz.
--
-- Maliyet: kolon NULLABLE ve DEFAULT'suz → PG11+'ta metadata-only (tablo
-- yeniden yazılmaz). `permission_templates` zaten onlarca satırlık bir tablo.

ALTER TABLE "permission_templates" ADD COLUMN "code" VARCHAR(64);

CREATE UNIQUE INDEX "permission_templates_code_key" ON "permission_templates"("code");
