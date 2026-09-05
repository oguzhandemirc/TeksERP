---
name: surum-cikar
description: TeksERP'te panel/tablet sürümü çıkarma akışı — sürüm notu taslağı (Claude yazar, kullanıcı ONAYLAR), not kapısı, paketleme ve yayın komutları, kanal seçimi (OTA mı APK mı). "sürüm çıkar", "sahaya güncelleme gönder", "yayınla" dendiğinde kullan.
---

# surum-cikar

Kural kaynağı: `docs/kurallar/surum-yayin.md` (tuzaklar, kapılar) · `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md` · `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md` · `docs/ops/SURUM-NOTLARI.md`.

## Sıra — atlama yok

1. **Ne değişti?** `git log <son etiket>..HEAD --stat` (etiketler `panel-v*` / `tablet-v*` / `backend-v*`). Değişikliğin cinsini yaz: panel · tablet JS · tablet native · backend.
2. **Sürüm notu TASLAĞI** — operatör diliyle, kapsam etiketli (`panel` | `tablet` | `her-ikisi`), `surum-notlari.json` biçiminde. **Kullanıcıya SUN ve ONAY BEKLE.** Onay gelmeden paketleme adımına GEÇME (notu okuyacak olan fabrika çalışanıdır; doğruluğunu ancak kullanıcı teyit eder).
3. Onaydan sonra: `node scripts/surum-notlari-kopyala.mjs` → `node scripts/check-surum-notlari.mjs` (şema + dil + kopya denetimi; kırmızıysa dur).
4. **Panel:** `./deploy/electron-paketle.sh <müşteri>` (yama hanesi etiketten otomatik; küçük/büyük hane ELLE = karar) → `./deploy/electron-yayinla.sh` → `./deploy/electron-yayinla.sh --dogrula`. Ham `npm run build:win` YASAK.
5. **Tablet:** önce `cd mobil && npm run yayinla:check -- --musteri=<kod>` (native parmak izi). "parmak izi tutarlı" → `EXPO_PUBLIC_API_URL=<erp-adresi> npm run yayinla -- --musteri=<kod>`; "NATIVE DEĞİŞTİ" → `runtimeVersion` artır + `build:apk` + `node deploy/mobil-yayinla.mjs --apk=… --surum=X --vc=N --musteri=<kod>`. OTA turunda `android.versionCode`a DOKUNMA.
6. **Backend** değiştiyse: backend ÖNCE deploy; sözleşme kırıldıysa `client-version-policy.ts` `minVersion` (sahadakinden büyük olamaz; önce istemci yayınlanır).
7. Yayın sonrası dışarıdan doğrulama (temiz URL ↔ `?cb=`); Cloudflare proxy AÇIK kalır.

## Kapılar (script durdurur, sen de dur)
- Not yoksa paketleme durur. `--musteri` her komutta zorunlu ve ARGÜMANDAN. ERP adresi açıkça verilir, varsayılan yok. Manifest EN SON yüklenir. `versionCode` yalnız yayınlanacak APK için artar.
