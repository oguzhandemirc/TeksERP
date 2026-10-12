---
paths:
  - "patron/**"
  - "deploy/patron/**"
  - "Teks-Erp/src/cloud-sync/**"
  - "Electron/src/pages/Access/PatronCloud/**"
  - "{Teks-Erp,Electron,mobil}/src/**/*{patron,Patron,cloud-sync}*"
---

**Patron bulutu · eşitleme · gelen kutusu** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/patron-bulutu.md § "Ortak"`
- `docs/kurallar/patron-bulutu.md § "Eşitleme"`
- `docs/kurallar/patron-bulutu.md § "Bulut sunucusu"`

- Bulut hesap yapmaz: türetilmiş alanı fabrika tek kaynak yardımcısıyla hesaplar, bulut saklar.
- Buluttaki tek yazma kanalı gelen kutusu; fabrika çeker, normal servis yolundan idempotent işler.
- Eşitleme hakkı fail-closed ve tek: `cloudEligibility`.
- Fabrikadan dışarı giden her istek kurulum anahtarıyla imzalı; yoklama iş verisi taşımaz.
- Projeler birbirinin kaynağını import etmez; tel tipi bayt-eşit aynayla taşınır.
- Bitince alan bekçilerini koş (`/bekci-kos patron-bulutu`; liste `docs/kurallar/patron-bulutu.md § "Bekçiler"`); yeni karar → `/karar-notu`.
