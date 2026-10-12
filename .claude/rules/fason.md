---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{subcontract,Subcontract,fason,Fason,kartela,Kartela,swatch,Swatch}*"
---

**Fason · kartela** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/fason.md § "Ortak"`
- `docs/kurallar/fason.md § "Backend"`

- Fason profilini iş ortağı KARTINA (`Customer`) bağla; cari hesap yalnız kartta yaşar.
- Tam kabul topu `SUBCONTRACTOR_CONSUMED` yapar ve makbuzdan yeni toplar doğurur; kısmi kabul topu tüketmez.
- Fason rotanın son adımıysa kabulde doğan toplar final üründür (`WAREHOUSE` + tx içinde sıralı barkod).
- Sevk kalemi yalnız TAM (`isPartial=false`) kabulle kapanır; çekme ölçümdür (`RollVariance`).
- Replay kimliği `SubcontractorReceipt.clientToken`; iptal makbuzun token'ı 409 `RECEIPT_CANCELLED`.
- Bitince alan bekçilerini koş (`/bekci-kos fason`; liste `docs/kurallar/fason.md § "Bekçiler"`); yeni karar → `/karar-notu`.
