---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{number-series,NumberSeries,manual-number,numbering}*"
---

**Numaralandırma · numara serisi · ön ek** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/numaralandirma.md § "Ortak"`

- Numarayı DOĞUŞTA tam string olarak kendi kolonuna yaz; ekran/belge/Excel/barkod o kolonu okur.
- Kimlik koda (`number-series-catalog.ts`), biçim veriye (`number_series`); biçim değişimi yalnız yeni elemanı etkiler.
- Sıfırlama dönemi tarih segmentinin sonucudur; ayrı ayar açma.
- Sıra taşarsa kod genişler, sarmaz.
- Master veri kodunu istemci üretmez; gönderilmezse sunucu seriden üretir.
- Bitince ilgili bekçileri koş (`/bekci-kos`); yeni karar → `/karar-notu`.
