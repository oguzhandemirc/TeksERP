---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{duplicate,Duplicate,merge,Merge,unmerge,fold,mukerrer,Mukerrer}*"
---

**Mükerrer · nameFold · ana veri arşivi** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/mukerrer.md § "Ortak"`
- `docs/kurallar/mukerrer.md § "Backend"`

- Türkçe katlamayı yalnız `utils/tr-case.ts`ten yap; `toLocaleUpperCase("tr")` yazma, SQL fold'da `\s` kullanma.
- Tekilliği tablolar arası sor; kimlik alanına `nameFold` seddi koyma.
- Birleştirme defterlidir ve geri alınabilir (`MergeOperation`); çakışma yüklemi tek kaynak `conflictPredicateSql`.
- `assertNameNotDuplicate` kalır (Türkçe 409), sed ise DB'de.
- Top birleştirilmez, iptal edilir; canlı referanslı ana veri pasife alınamaz (MV-06).
- Bitince alan bekçilerini koş (`/bekci-kos mukerrer`; liste `docs/kurallar/mukerrer.md § "Bekçiler"`); yeni karar → `/karar-notu`.
