---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{batch,Batch,parti,Parti}*"
---

**Parti (Batch)** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/parti.md § "Ortak"`
- `docs/kurallar/parti.md § "Backend"`

- `generateBatchNumberTx`'in İLK ifadesi `pg_advisory_xact_lock(8022, 1)`; 8021'den ayrı tut.
- Partinin kimliği yalnız `Batch.id`; `batchNumber` ile lookup ve `orderBy: { batchNumber }` yapma.
- `batchNumber` üzerine `@unique` geri koyma.
- Kısa/dönen biçim PROFİL bayrağıdır (`batch.shortNumberEnabled`).
- Müşteriye doğrudan sevk edilmiş fason kalemi parti cerrahisine girmez.
- Bitince alan bekçilerini koş (`/bekci-kos parti`; liste `docs/kurallar/parti.md § "Bekçiler"`); yeni karar → `/karar-notu`.
