---
paths:
  - "**/package.json"
---

**Bağımlılık değişikliği bir karardır** — yalnız ilgili bölümü oku:
- `docs/standart/KUTUPHANELER.md § 3` karar kaydı
- `docs/standart/KUTUPHANELER.md § 6` ölü paket teşhisi
- `docs/RECETELER.md § "Yeni bağımlılık"`

- Yeni paket eklemeden önce kullanıcı onayı al.
- `importFiles: 0` ölü paket kanıtı değildir (dinamik import · `createRequire` · config).
- Ana sürüm yükseltmesi sözleşme değişikliğidir.
- Mobilde native paket OTA ile gitmez, APK turu ister.
