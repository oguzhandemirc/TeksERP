---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/{reports,Reports}/**"
  - "{Teks-Erp,Electron,mobil}/src/**/*{report,Report,karne,Karne}*"
  - "{Teks-Erp,Electron,mobil}/src/**/*{time,factory-time}.ts"
---

**Raporlar · karneler** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/raporlar.md § "Ortak"`
- `docs/kurallar/raporlar.md § "Backend"`

- Her rapor ucu `requireReportOpen("<key>")` taşır; sıra: `verifyToken` → modül → rapor kapısı → izin.
- Rapor kapısı üç sonuçlu: açık · kapalı · ÖLÇÜLEMEDİ (403 `REPORT_GATE_UNAVAILABLE`).
- Fabrika günü ve saat yalnız `src/constants/time.ts`ten; çıplak `DATE_TRUNC`/`AT TIME ZONE` yazma.
- `finalizedAt` trigger'la yazılır; ölü küme `K18_DEAD_STATUSES`.
- Sevk rakamı BRÜT; panel rapor kapısı kararı tek yerde (`isReportOpen`).
- Bitince alan bekçilerini koş (`/bekci-kos raporlar`; liste `docs/kurallar/raporlar.md § "Bekçiler"`); yeni karar → `/karar-notu`.
