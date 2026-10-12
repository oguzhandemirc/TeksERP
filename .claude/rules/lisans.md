---
paths:
  - "satici/**"
  - "deploy/{satici,lisans-devreye}/**"
  - "Teks-Erp/native/lisans-cekirdek/**"
  - "Teks-Erp/src/lib/license/**"
  - "Electron/src/lib/license/**"
  - "Electron/src/pages/{System/License,LicenseActivation,LicenseSuspended}/**"
  - "{Teks-Erp,Electron,mobil}/src/**/*{license,License,lisans,Lisans}*"
---

**Lisans · kod koruma · satıcı platformu** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/lisans.md § "Ortak"`
- `docs/kurallar/lisans.md § "Backend"`
- `docs/kurallar/lisans.md § "Satıcı sunucusu"`

- Lisans kapısı fabrikayı aniden durdurmaz: uyarı → imzalı tarihten ek süre (30 gün) → kısıtlı kip; okuma/rapor/dışa aktarma/yedek her kademede açık.
- Süre çapası İMZALI tarihtir; internet kesintisi kısaltmaz.
- Zamanın getirdiği KISITLI iki anahtarlıdır (ek süre geçti ∧ son 24 saatte başarılı kira yok).
- Sunucu kararları son geçerli imzalı kiradan kalıcıdır; ek süre gevşetmez.
- Kilide girmeyen kurulumda motor GÖZLEM kipindedir: sıfır davranış farkı.
- Satıcı kök parolası yalnız stdin'den; parmak izi MAC'siz.
- Bitince alan bekçilerini koş (`/bekci-kos lisans`; liste `docs/kurallar/lisans.md § "Bekçiler"`); yeni karar → `/karar-notu`.
