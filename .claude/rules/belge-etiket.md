---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/document-render/**"
  - "{Teks-Erp,Electron,mobil}/src/**/*{printed-document,document-profile,document-design,label,Label,etiket,print,Print,Template}*"
---

**Belge · etiket · şablon** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/belge-etiket.md § "Ortak"`
- `docs/kurallar/belge-etiket.md § "Backend"`
- `docs/kurallar/belge-etiket.md § "Panel"`

- Belgedeki tarih/saati yalnız `document-render/fmt-date.ts` (`factoryDateTr`/`factoryDateTimeTr`) bassın; gün ve saat kaydın ANINDAKİ fabrika diliminden.
- İç veri taşıyan kolonu OPT-IN doğur (allowlist); blocklist yeni kolonu müşteri belgesine sızdırır.
- Kullanıcı yazımı HTML'i (refakat `RAW_HTML`, etiket `RASTER_HTML`) iki katmanla koru: izin listesi + sanitize; biri yetmez.
- Sevk belgesinde müşterideki AD donar (snapshot), rejim donmaz; sonraki alias düzeltmesi eski belgeyi değiştirmez.
- SACK barkodu `sackNo` kolonunu okur; numarayı render'da biçimleme (`numaralandirma.md`).
- Belge alan CSS'inde `calc()`/`var()`, şablon literalinde backtick kullanma.
- Bitince alan bekçilerini koş (`/bekci-kos belge-etiket`; liste `docs/kurallar/belge-etiket.md § "Bekçiler"`); yeni karar → `/karar-notu`.
