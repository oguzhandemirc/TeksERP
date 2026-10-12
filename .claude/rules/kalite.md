---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{quality,Quality,qc,Qc,defect,Defect,station-capabilit,StationCapabilit}*"
---

**Kalite · istasyon yeteneği** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/kalite.md § "Ortak"`
- `docs/kurallar/kalite.md § "Backend"`

- "Bu adım kalite yürütür mü"nün tek kaynağı `quality-station.helper.ts`; `stepCanApplyQuality` ↔ `QUALITY_STATION_WHERE` boğaz-ikizdir, birlikte değişir.
- Yeni `kind === "PROCESS_QC"` karşılaştırması yazma; yetenek istasyonun kendi alanıdır (`appliesColor/Property/Quality`).
- Yetenek bayrağı planlama sorusudur; fason kabulünde fiilî uygulama sevkin şartından okunur.
- Tipsiz hata girişi kataloğun varsayılan tipine düşer (kurulumda en fazla bir).
- Kurşun + KK2 aynı istasyonda olması adnansahin TOPOLOJİSİDİR (PROFİL), kısıt değil.
- Bitince alan bekçilerini koş (`/bekci-kos kalite`; liste `docs/kurallar/kalite.md § "Bekçiler"`); yeni karar → `/karar-notu`.
