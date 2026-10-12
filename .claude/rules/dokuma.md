---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{machine-run,MachineRun,machineRun,doff,Doff,loom,Loom,weaving,Weaving,warp,Warp,beam,Beam}*"
---

**Dokuma · dokuma işi · doff · tezgah karnesi** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/dokuma.md § "Ortak"`
- `docs/kurallar/dokuma.md § "Raporların İKİ DEĞİŞMEZİ"`

- Dokumayı topun rotasında adım yapma: tezgah kendi kimliği ve defteri (`MachineRun`) olan ayrı VARLIKTIR.
- `StationKind.WEAVING` yalnız oturum istasyonudur; devereyi `Station.producesWarpBeam`den tanı.
- Tablet ön-dolgusu yalnız ÖNERİDİR; kararı sunucu verir.
- Tezgah listelerini backend'de doğur (`GET /api/machine-runs…`), yerel durumdan kurma.
- Top KK1'de doğar (`entrySource=WEAVING`); elle giriş birinci sınıftır, rapor "ölçüldü mü elle mi" taşır.
- Bitince alan bekçilerini koş (`/bekci-kos dokuma`; liste `docs/kurallar/dokuma.md § "Bekçiler"`); yeni karar → `/karar-notu`.
