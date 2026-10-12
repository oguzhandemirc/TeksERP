---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{shipping,shipment,Shipment,sack,Sack,dispatch,Dispatch,DirectShip,return,Return,accounting-export}*"
  - "{Teks-Erp,Electron,mobil}/src/**/{Sevkiyat,TartiPaket,Shipments}/**"
---

**Sevkiyat · çuval · brüt · storno/iade** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/sevkiyat.md § "Ortak"`
- `docs/kurallar/sevkiyat.md § "Backend"`

- Sevk rakamı her yüzeyde BRÜT; iade ayrı belgeyle; storno ≠ iade.
- Sevk geri alınırken `dispatchedAt` ailesini `null`'lama.
- Çuval depo nesnesidir: müşteri opsiyonel, rezerv YOK; karşılama `SackAllocation` ile sevk anında.
- Tartı ölçümdür: `SackWeighing` defterine yazılır, yeniden tartı öncekini bırakır.
- Paketleme grubu çalışma yaftasıdır, rezervasyon değil; silinmez, görünmez olur.
- SoD: `shipping:invoice`, `shipping:undo-dispatch` yalnız Muhasebe/Süpervizör.
- Bitince alan bekçilerini koş (`/bekci-kos sevkiyat`; liste `docs/kurallar/sevkiyat.md § "Bekçiler"`); yeni karar → `/karar-notu`.
