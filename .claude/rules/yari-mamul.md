---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{semi-finished,SemiFinished,inventory,Inventory}*"
  - "{Teks-Erp,Electron,mobil}/src/**/{Rolls,Depo}/**"
---

**Yarı mamul** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/yari-mamul.md § "Ortak"`
- `docs/kurallar/yari-mamul.md § "Panel"`

- `Roll` yalnız kumaş kaleminden doğar; giriş kapısı fail-closed.
- `rollScope` fail-closed: tanınmayan kapsam 400.
- Yarı mamul arzdır: düşülmez, ayrı gösterilir.
- Stok Karnesi ↔ Envanter rozeti ↔ Kanban aynı rakamı basar; kova ayrılırsa rapor da ayrılır.
- Sekmeyi `entrySource` belirler; metni statüden türetme.
- Bitince alan bekçilerini koş (`/bekci-kos yari-mamul`; liste `docs/kurallar/yari-mamul.md § "Bekçiler"`); yeni karar → `/karar-notu`.
