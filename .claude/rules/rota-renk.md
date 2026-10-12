---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/Routes/**"
  - "{Teks-Erp,Electron,mobil}/src/**/*{route.service,route.adapter,route-plan,RouteStep,RouteDesigner,RouteEditor,RouteForm,color,Color,property,Property,fold-type,coverage,station-capabilit}*"
---

**Rota · renk · özellik · kapsama** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/rota-renk.md § "Ortak"`
- `docs/kurallar/rota-renk.md § "Backend"`

- "Adım renk/özellik verebilir mi" tek yüklem: `stepCanApplyColor`/`stepCanApplyProperty`.
- Renk kısıt değil reçete; özellik gerçek kısıttır ve boş doğamaz.
- Hedef öneridir, kilit değil; Hedef/Düzelt replace'leri yalnız FLAG satırlarına dokunur.
- Kapsama kategori düzeyinde UYARIR (`warnings`); özellik başına sert (create 400 / replace 409).
- Kat değeri kolonda (`foldType`), pivotta değil.
- Bitince alan bekçilerini koş (`/bekci-kos rota-renk`; liste `docs/kurallar/rota-renk.md § "Bekçiler"`); yeni karar → `/karar-notu`.
