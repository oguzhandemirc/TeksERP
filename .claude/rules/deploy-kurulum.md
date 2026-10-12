---
paths:
  - "deploy/**"
  - "Teks-Erp/prisma/**"
  - "Teks-Erp/prisma.config.ts"
  - "Teks-Erp/src/lib/prisma*"
  - "Teks-Erp/scripts/{apply-migration,test_db_invariants,test_schema_drift,test_migration}*"
  - "Teks-Erp/package.json"
---

**Deploy · kurulum · migration** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/deploy-kurulum.md § "Ortak"`
- `docs/kurallar/deploy-kurulum.md § "Backend"`

- Migration'ı commit et; commit edilmemiş migration prod'da sessiz eksiktir. `migrate dev` yalnız `--create-only` + `DropForeignKey` satırları silinerek.
- Migration kendisinden SONRA doğan tabloya ALTER/INDEX/FK yazamaz (sıra = dizin adı).
- `ALTER TYPE … ADD VALUE` kendi tek ifadeli migration dosyasında yaşar.
- Kısıtı veri temizlenmeden aynı sürümde getirme: expand → backfill → contract.
- Şema motoru NATIVE: Windows paketi `PRISMA_CLI_BINARY_TARGETS=windows` + MZ kapısı.
- Şema provası en eski canlı dump'ta: restore → `migrate deploy` → bekçiler → profil boot.
- Bitince alan bekçilerini koş (`/bekci-kos deploy-kurulum`; liste `docs/kurallar/deploy-kurulum.md § "Bekçiler"`); yeni karar → `/karar-notu`.
