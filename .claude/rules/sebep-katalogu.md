---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{reason,Reason,sebep}*"
---

**Sebep katalogları** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/sebep-katalogu.md § "Ortak"`
- `docs/kurallar/sebep-katalogu.md § "Backend"`

- Hazır sebepler DB'de (`ReasonPreset`); `code` asla değişmez.
- Sebep silinmez, gizlenir; son aktif satır gizlenemez.
- `ReasonPresetKind` eklemek reçeteli iş (enum değeri on iki yerde).
- `MACHINE_STOP`ta kayıp sınıfı zorunlu; önbellek TTL'i tazeliktir, geçerlilik değil.
- Bitince alan bekçilerini koş (`/bekci-kos sebep-katalogu`; liste `docs/kurallar/sebep-katalogu.md § "Bekçiler"`); yeni karar → `/karar-notu`.
