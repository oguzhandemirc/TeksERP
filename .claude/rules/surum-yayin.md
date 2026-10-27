---
paths:
  - "deploy/kanallar.json"
  - "deploy/dagitim.json"
  - "scripts/{surum,check-surum,check-dagitim,dagitim-kapisi,grup-yayin-kapisi}*"
  - "scripts/lib/surum*"
  - "surum-notlari.json"
  - "mobil/scripts/**"
  - "mobil/app.json"
  - "Electron/shared/**"
  - "Electron/electron/**/*update*"
  - "Electron/package.json"
  - "{Teks-Erp,Electron,mobil}/src/**/*{client-version-policy,client-policy,mobile-update}*"
---

**Sürüm · yayın** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/surum-yayin.md § "Ortak"`
- `docs/kurallar/surum-yayin.md § "Panel"`
- `docs/kurallar/surum-yayin.md § "Tablet"`

- Sürüm notu yazılmadan sürüm çıkmaz: taslağı Claude yazar, onay terfi etiketidir.
- Not maddesini kaynağına (`dosya:satır`) geri okut.
- Müşteri kodu argümandan; ham `npm run build:win` yasak; kanal kimliği `deploy/kanallar.json`.
- Paket önce, manifest EN SON; Cloudflare proxy açık; OTA'da `versionCode`a dokunma.
- `minVersion` yalnız gerçek kırılmada ve sahadakinden büyük olamaz.
- Bitince alan bekçilerini koş (`/bekci-kos surum-yayin`; liste `docs/kurallar/surum-yayin.md § "Bekçiler"`); yeni karar → `/karar-notu`.
