---
name: surum-cikar
description: TeksERP'te panel/tablet sürümü çıkarma akışı — sürüm notu taslağı (Claude yazar, kullanıcı ONAYLAR), not kapısı, paketleme ve yayın komutları, kanal seçimi (OTA mı APK mı). "sürüm çıkar", "sahaya güncelleme gönder", "yayınla" dendiğinde kullan.
---

# surum-cikar

Kural kaynağı: `docs/kurallar/surum-yayin.md` (tuzaklar, kapılar) · `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md` · `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md` · `docs/ops/SURUM-NOTLARI.md`.

## Sıra — atlama yok

1. **Ne değişti?** `git log <son etiket>..HEAD --stat` (etiketler `panel-v*` / `tablet-v*` / `backend-v*`). Değişikliğin cinsini yaz: panel · tablet JS · tablet native · backend.
2. **Sürüm notu TASLAĞI** — operatör diliyle, kapsam etiketli (`panel` | `tablet` | `her-ikisi`), `surum-notlari.json` biçiminde. **Kullanıcıya SUN.** Onay TERFİDE verilir (adım 7): taslak önce testfabrika'ya bu hâliyle çıkar, kullanıcı notu fabrikanın göreceği modalda okur. Metin değişirse yeni yama + kısa testfabrika turu; reddedilen sürümün notu sonraki sürümün kaydına birleşir.
3. `node scripts/surum-notlari-kopyala.mjs` → `node scripts/check-surum-notlari.mjs` (şema + dil + kopya denetimi; kırmızıysa dur).
4. **Kanal sırası — ÖNCE `testfabrika`:** 5. ve 6. adımlar `<müşteri>=testfabrika` ile koşulur; `panel-vX`/`tablet-vY` etiketi burada atılır (= ilk kanala çıkan kod). Fabrikaya (`adnansahin`) doğrudan paketleme/yayın terfi kapısında (K5) DURUR.
5. **Panel:** `./deploy/electron-paketle.sh <müşteri>` (yama hanesi etiketten otomatik; küçük/büyük hane ELLE = karar) → `./deploy/electron-yayinla.sh --musteri=<müşteri>` (hedef paketin kimliğinden; kanal `deploy/kanallar.json`da kayıtlı olmalı) → `./deploy/electron-yayinla.sh --musteri=<müşteri> --dogrula`. Ham `npm run build:win` YASAK.
6. **Tablet:** önce `cd mobil && npm run yayinla:ortak:check` (native parmak izi). "parmak izi tutarlı" → `npm run yayinla:ortak` → `node ../deploy/mobil-grup-yayinla.mjs --grup=test --paket=<dizin>`; "NATIVE DEĞİŞTİ" → `runtimeVersion` artır + `npm run build:apk` (argümansız; temiz ağaçta; APK'nın yanına `<apk>.derleme.json` künyesi yazılır, ikisi birlikte taşınır) + `node ../deploy/mobil-grup-yayinla.mjs --grup=test --apk=<yol.apk>` (sürüm ve versionCode APK'nın KENDİSİNDEN okunur; `--surum`/`--vc` verme, verilirse APK'dan farklıysa DURUR); terfide `--grup=oncu` sonra `--grup=genel`. Paketle ile yayınla arasında commit ATMA — yayıncı künyeyi HEAD'e bağlar, tutmazsa yeniden paketle. OTA turunda `android.versionCode`a DOKUNMA.
7. **Test + ONAY (terfi):** kullanıcı testfabrika'da test eder (panel + tablet, gerçek araçla). Onay cümlesiyle 1e: `git tag -a terfi/adnansahin/panel-vX panel-vX -m "<kullanıcının cümlesi> — <saat>"` (+ `terfi/adnansahin/tablet-vY tablet-vY`) → push. Etiket commit'e bağlı: onaylanan kod ve not metni donar.
8. **Fabrika** — kullanıcı "yayınla" dediğinde, mesai kuralına uyarak: yayın ağacında `git checkout --detach panel-vX` → `./deploy/electron-paketle.sh adnansahin` → `./deploy/electron-yayinla.sh --musteri=adnansahin`; tablet `git checkout --detach tablet-vY` → 6. adım `--musteri=adnansahin` ile. Sonra `chore(sürüm): panel X yayınlandı (testfabrika → adnansahin)` main'e.
9. **Backend** değiştiyse: backend ÖNCE deploy (önce testfabrika, sonra fabrika); sözleşme kırıldıysa `client-version-policy.ts` `minVersion` (sahadakinden büyük olamaz; önce istemci yayınlanır).
10. Yayın sonrası dışarıdan doğrulama (temiz URL ↔ `?cb=`); Cloudflare proxy AÇIK kalır.

## Kapılar (script durdurur, sen de dur)
- Not yoksa paketleme durur. `--musteri` her komutta zorunlu ve ARGÜMANDAN. ERP adresi kanal kaydından; açık verilirse kanalınkiyle eşit olmalı. Manifest EN SON yüklenir. `versionCode` yalnız yayınlanacak APK için artar.
- **K5 terfi** (`scripts/lib/terfi.mjs`): `terfiKaynagi` olan kanala (adnansahin) HEAD == `<ürün>-vX` · `terfi/adnansahin/<ürün>-vX` açıklamalı etiketi HEAD'de · testfabrika'da yayındaki sürüm ≥ X; kaynak okunamazsa ÖLÇÜLEMEDİ = DUR. Kaçış YALNIZ kullanıcının kendi cümlesiyle: `--terfi-atla="<cümle>"` (paketle + yayınla komutlarının her birine; cümle yayın defterine ve etiket mesajına yazılır). Cümleyi SEN uydurma — kullanıcıdan al.
- **Derleme bağı (G22):** paketleme kirli/izlenmeyen dosyalı ağaçta DURUR; paketle ile yayınla arasında commit atılmaz; künyesiz (G22 öncesi) ya da HEAD'e bağlanmayan artefakt yayınlanmaz — o commit'te temiz ağaçtan yeniden paketle. Yayın hedefi yalnız kanal kaydından: `SSH_HEDEF`/`--ssh` gibi ezme görülürse yükleyici durur.
- **Backend PAKET imzası** (üretim anahtarı `paket-<yıl>`) `--ci-kosu=<korumali-paket.yml koşu no>` ister (başarılı · `main` · commit = künye = PAKET.json). Koşu yoksa kaçış YALNIZ kullanıcının cümlesiyle: `--ci-atla="<cümle>"` — cümle + saat + makine + HEAD imzalı künyeye girer, `backend-yayinla.mjs` uyarır ve defterine yazar. Cümleyi SEN uydurma.
