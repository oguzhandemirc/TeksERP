---
paths:
  - "**/package.json"
---

`package.json`a dokunuyorsun — bağımlılık eklemek/kaldırmak/yükseltmek bir KARARDIR. Önce `docs/standart/KUTUPHANELER.md` dosyasını oku: yeni paket kullanıcı onayı + altı satırlık karar kaydı ister (`docs/RECETELER.md` § Yeni bağımlılık), `importFiles: 0` ölü paket kanıtı DEĞİLDİR (üç kanal: dinamik import · `createRequire` · config referansı), ana sürüm yükseltmesi sözleşme değişikliğidir. Mobilde native/config-plugin paket OTA ile gitmez, APK turu ister.
