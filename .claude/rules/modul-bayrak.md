---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{feature-flag,featureFlag,module-flag,module-profile,module.middleware,system-setting,SystemSetting,flag-modules,screen-catalog,settings-surface}*"
  - "{Teks-Erp,Electron,mobil}/src/**/GeneralSettings/**"
---

**Modül anahtarları · bayraklar · profiller** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/modul-bayrak.md § "Ortak"`
- `docs/kurallar/modul-bayrak.md § "Backend"`

- Önce sor: ÇEKİRDEK mi PROFİL mi? Varyasyonu sırayla dene: çekirdek → veri → bayrak → profil.
- Yeni davranış bayrağının varsayılanı = bugünkü davranış ve bu ÖLÇÜLEREK yazılır.
- `MODULE_FLAG_KEYS` dokuz anahtardır, genişletilmez; kapalı modül 403 `MODULE_DISABLED`.
- Jenerik `requireModule("x")` yazma; davranış bayrağını profile koyma; müşteri adıyla dal açma.
- Bayrak eklemek reçeteli iştir (`docs/RECETELER.md`); fazın çıktısını akışla ölç.
- Bitince alan bekçilerini koş (`/bekci-kos modul-bayrak`; liste `docs/kurallar/modul-bayrak.md § "Bekçiler"`); yeni karar → `/karar-notu`.
