# Sürüm · Yayın (panel/tablet)
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/surum-yayin.md`.

Sınıf: [ÇEKİRDEK] her kurulumda aynı · [PROFİL] bu fabrikanın seçimi. Komut zinciri `docs/RECETELER.md` § Sürüm çıkarma; runbook `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`, `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`.

- [ÇEKİRDEK] Seri eksen kilidi bir SÜRÜM VAAT EDİYORSA o sürümün ağacı vaadin istemci davranışını TAŞIMALI; bugün: iki istemci de tam-biçim kapısında `retiredFormats`i tüketir.

## Ortak (backend + panel + tablet)

### Değişmezler

- [ÇEKİRDEK] Sürüm notu yazılmadan sürüm ÇIKMAZ: taslağı Claude yazar, kullanıcı TERFİDE onaylar (onay = terfi etiketi); onaysız üretime çıkılmaz. Tek kaynak `surum-notlari.json` (operatör dili; kapsam panel|tablet|her-ikisi, 'sunucu' yok).
- [ÇEKİRDEK] Not kapısı sürümü ARGÜMANDAN alır, yayına giden HER yolda koşar (panel paketleme · OTA · `build-apk.mjs` `--check` dahil · `deploy/mobil-yayinla.mjs` yüklemeden önce · CI `--kunyeden`); üç sonuçlu: yeşil · kırmızı · ÖLÇÜLEMEDİ — üçüncüsü de DURDURUR.
- [ÇEKİRDEK] Not maddesi yayından ÖNCE kaynağına geri okutulur (`dosya:satır`): yetki cümlesi ekran izniyle yetinmez (ekran-içi YETENEK ayrı cümle); "türetilir" okuyucu gösterilene dek VAAT; "kaydedilir" yazan yol ölçülmeden yazılmaz.
- [ÇEKİRDEK] Tırnaklanan ad koddan KOPYALANIR; "sonraki sürümde" cümlesi yayının kendi madde listesine karşı aranır; adı benzeyen iki ekranın sonucu farklıysa not ikisini de adıyla anar.
- [ÇEKİRDEK] Sürüm artmazsa istemci güncellenmez (panel `package.json>version`↔`latest.yml`; tablet sürüm + `versionCode`). Yama hanesi OTOMATİK (etiket `panel-v*`/`tablet-v*`; eşit/geride → DUR); küçük/büyük hane ELLE = karar.
- [ÇEKİRDEK] Yükleme sırası: paket dosyaları ÖNCE, manifest/`latest.yml`/künye EN SON; elle `scp` YOK; sonra HTTPS doğrulama (temiz URL ↔ `?cb=`, CF 404'ü yalnız Purge by URL; boyut/sha512).
- [ÇEKİRDEK] Paket dosyasını dış adresten HTTP 200 doğrulamadan manifest/`latest.yml` YÜKLEME; yüklenen her dosyayı sunucuda 0644 yap (kaynak kipi taşınmaz). · bekçi: `scripts/test_grup_yayin_kapisi.mjs` §3i, `scripts/test_grup_yayin_tablet.mjs` §7, `scripts/test_backend_yayin.mjs` §3g2/§3c3 <sub>(arşiv:2026-11-04)</sub>
- [ÇEKİRDEK] Cloudflare proxy (turuncu bulut) AÇIK kalır (Origin CA); DNS-only'de güncelleme SESSİZCE durur.
- [ÇEKİRDEK] Yayın adresi DERLEME ANINDA gömülür (`app-update.yml`, `EXPO_UPDATE_URL`); panelde `TEKSERP_KANAL` + `-c.*` argümandan (`Electron/shared/musteri.json` yalnız dinlenme işaretçisi), tablette `mobil/musteri.json`; dinlenmede ikisi `varsayilan` kanal.
- [ÇEKİRDEK] Kanalın her kimliği (VDS yolu, feed/manifest/künye adresleri, panel appId/ad/paket/dış adres/sunucu, tablet paket adı/ERP adresi/OTA sertifikası) TEK kaynak `deploy/kanallar.json`; iki kanal paylaşmaz; kayıt DAVRANIŞ taşımaz.
- [ÇEKİRDEK] Yayın komutu hedefi PAKETİN kimliğinden çözer (`--musteri` niyet); paketin adresi hedefinki değil/okunamıyorsa ssh'tan ÖNCE DUR; üretim kanalı kimliği DONMUŞ; kapısız ikinci yayın yolu açma (`electron-yayinla.ps1` saplama).
- [ÇEKİRDEK] Yükleyici hedefi (ssh adı, VDS dizini, doğrulama adresi, defter) YALNIZ kanal kaydından (`scripts/lib/yayin-hedefi.mjs`; kabukta `kanal-kapisi.mjs yayin-hedefi`); başka hedef ayrı kanal kaydı (prova dahil).
- [ÇEKİRDEK] Ezme (`SSH_HEDEF` · `UZAK_DIZIN` · `YAYIN_KOK` · `YAYIN_URL` · `BASE_URL` · `--ssh` · `--uzak-dizin` · `--feed`) görülürse kuru/denetim kipi dahil ağdan ÖNCE DUR.
- [ÇEKİRDEK] Uzak komuta DEĞER GÖMME: betik stdin'den, değerler `bash -s --` konumsal ve biçim denetimli (serbest metin base64); scp `-s` (SFTP).
- [ÇEKİRDEK] Kirli/izlenmeyen dosyalı ağaçta PAKETLEME (`electron-paketle.sh` · `yayinla-ota.mjs` · `build-apk.mjs`; istisna paketleyicinin sürüm alanları); paketle↔yayınla arası commit atma.
- [ÇEKİRDEK] Derleme künyesi (commit + boyut + özet) artefakta, HEAD'e, üretimde terfi etiketinin commit'ine bağlanır; tutmayan/künyesiz artefakt yayınlanmaz, o commit'te temiz ağaçtan YENİDEN PAKETLENİR.
- [ÇEKİRDEK] Backend `pg` bloğu (`cizgi` · `enAz`) ve PG kimliği YALNIZ `deploy/pg/pg-surumu.json` (`cizgi` · `backendEnAz` · `surum` · `derleme` · `icuSurum`); farklı `--pg-*` → DUR; kayıtsız PG ne hedef ne `--pg-yayinla`; zip tek `bin/icuuc<N>.dll`, N kaydınki.
- [ÇEKİRDEK] `pg-surumu.json` değişimi KARARDIR (`docs/design/KENDI-POSTGRESQL.md` §2).
- [ÇEKİRDEK] Her üretim kanalı AYNALI hazırlık kanalını `terfiKaynagi` taşır (`null`/aynasız kırmızı); üretime yayın YALNIZ terfi etiketli commit'ten, hazırlıkta yayınlanmış sürümle (backend: hazırlığın `son.json`u; prova yetmez).
- [ÇEKİRDEK] Üretim yayını derleme/ssh ÖNCESİ ölçer: HEAD == `<ürün>-vX` · açıklamalı `terfi/<kanal>/<ürün>-vX` HEAD'de, mesajı onay cümlesi + saat · kaynakta sürüm ≥ X; okunamazsa ÖLÇÜLEMEDİ = DUR.
- [ÇEKİRDEK] Not metni terfi commit'iyle donar, reddedilen not sonrakine birleşir; kaçış YALNIZ kullanıcı cümlesiyle `--terfi-atla="<cümle>"` (boş/kısa RED; deftere + etikete yazılır); hazırlıkta davranış değişmez.
- [ÇEKİRDEK] Yeni müşteri kanalı yalnız `deploy/kanallar.json` kaydıyla (§ Yeni müşteri kanalı); demo/test aynasız hazırlık (`ayna: null` + etiket); ilk paket kaydı taşıyan commit'ten, notlu YENİ sürümle ("BİLİNMEYEN KANAL").
- [ÇEKİRDEK] Kanal kaldırma: önce ÖLÇ (satıcı DB bağlı kurulum + son yoklama, erişim kaydı) → ağaç ve defteri `~/.tekserp/arsiv/<kanal>-<tarih>/`e indir + sha256 → sonra sil; satıcı `kanal` satırı SİLİNMEZ (pasif); `kanallar.json` donuk blok kalır.
- [ÇEKİRDEK] Her ürün (backend · panel · tablet · patron) için sürüm başına TEK ortak paket: kimlik etkinleştirme kodu + lisanstan, filigran kurulumda, yayın GRUPLARLA (test → öncü → herkes); kanal düzeni taşınana dek (borç, çapa `TEKSERP_KANAL`) kanal kuralları geçerli.
- [ÇEKİRDEK] Argümansız tablet derlemesi (`build:aab` → Play; `build:apk` yalnız yerel deneme) TEK ORTAK PAKET: kimlik YALNIZ `deploy/dagitim.json` `urun.tablet` (`mobil/scripts/lib/ortak-kimlik.cjs`); `mobil/app.json` eski kanal kimliği, DEĞİŞTİRİLMEZ (O15'e dek).
- [ÇEKİRDEK] Ortak tablet bundle'ında ERP adresi olmaz; OTA sertifikası yok/KÖK değil (CA, pathLen 0, EKU'suz) ya da paket (APK · AAB · prebuild) zincir meta-data'sı `true` değilse derleme DURUR (K-2).
- [ÇEKİRDEK] Ortak tablet grubu YALNIZ indirme belirteci `grup`undan; grup/belirteç yoksa OTA yok, native yalnız Play; ERP adresi yoksa `localhost`a düşmez, ilk ekran "Sunucuyu bul"; eski kanal adresi grubu okumaz.
- [ÇEKİRDEK] Backend ortak paketi `deploy/backend-yayinla.mjs --grup=<test|oncu|genel>` (hedef YALNIZ `deploy/dagitim.json`, `scripts/lib/grup-yayin.mjs`; `--musteri`yle birlikte verilmez); ağaç temiz · künye == HEAD · `profil-matrisi-kapisi.mjs` (kök muaf).
- [ÇEKİRDEK] Grup terfisi: `test` etiketsiz; `oncu`/`genel` `terfi/<grup>/backend-vX` + kaynakta ≥ X + aynı platform dizininde (`backend/`·`backend-oci/`) bayt-eşit (`ARTEFAKT.backend`); K-6: genel kendi VE oncu etiketini ister, cümleler farklı.
- [ÇEKİRDEK] Yeni adrese gerçek yükleme `YENI_ADRES_KAPISI` ile; kapalıyken yalnız `--kuru`/`--dogrula`, terfi kaçışı açmaz; test çapası ortamdaysa DUR.
- [PROFİL] Backend kanal paketi `deploy/paketle.ps1 -Musteri <kod>` (`pm2Ad`/`urunAdi` kayıttan, `kanal-kapisi.mjs backend-paketle`, filigran `PAKET.json`); `-Musteri` yoksa tek zip + UYARI; feed Faz 3'e dek yok → backend kanal terfisi ÖLÇÜLEMEDİ = DUR.
- [ÇEKİRDEK] Yayın betikleri sunucuyu ANONİM okumaz: yayındaki VDS diskinden SSH (`yayinOku`, `scripts/lib/yayin-okuma.mjs`), kenar yalnız belirteçle (`~/.tekserp/yayin-belirteci`, 600; `X-TKL-Indirme`); belirteç yok/bozuk/gevşekse ssh'tan ÖNCE DUR; `--kuru` istemez.
- [ÇEKİRDEK] Belirteç önce CLI'dan: `~/.tekserp/yayin-belirteci-kaynagi.json` (600) varsa `anahtar.ts indirme-belirteci --kanal=<k> --dk=60` (<10 dk kalanı yeniden kullanma); yoksa dosya; kaynak bozuk/gevşek ya da CLI başarısızsa DUR.
- [ÇEKİRDEK] ERP adresi (`EXPO_PUBLIC_API_URL`) TEK KAYNAK `scripts/lib/adres.mjs`: `--api-url` → ortam → kanal kaydı (kanalsız `.env*`); açık adres kanalınkine EŞİT; gömülü varsayılan YOK; localhost/`/api`siz RED; ERP ↔ güncelleme kanalı birbirinden TÜRETİLMEZ.
- [ÇEKİRDEK] Manifest yayında DONAR, tek üretici `mobil/scripts/lib/manifest.mjs` imzalar (HAM bayt); sunucu (nginx, LAN `/api/mobile/updates/*`) yalnız bayt servis eder, render YAZMA; uçlar PUBLIC; LAN deposu `app\` dışında.
- [ÇEKİRDEK] Kod imzalama AÇIK: OTA yaprağı (kök APK'da, kök anahtar `mobil/` dışında), `keystore/play-yukleme/`, `keystore/deneme/` git DIŞI, VPS'e GİTMEZ; mühür Play App Signing; sertifika APK'da yoksa build-apk DURUR.
- [ÇEKİRDEK] Play yükleme parolası `keystore.properties`te DURMAZ: Anahtar Zinciri `tekserp/play-yukleme` → Gradle ortamla (`TEKSERP_IMZA_PAROLASI`, `--no-daemon`), keytool `-storepass:env`; argv'ye asla. Sil+kur yalnız eski kanal tabletinde.
- [ÇEKİRDEK] Windows yapıtını yalnız `deploy/kurulum/kod-imzala.ps1` imzalar: sertifika yoksa uyar + devam, varken imza/doğrulama düşerse DUR; sertifika/parmak izi/parola repoya girmez.
- [ÇEKİRDEK] `minVersion` KODDA (`client-version-policy.ts`; `currentVersion` kiranın `kanal.guncelSurumler`inden); `GET /api/client-policy/:istemci` PUBLIC, istemci FAIL-OPEN, tanımsız 404; yalnız gerçek kırılmada, sahadakinden büyük olamaz; önce istemci.
- [ÇEKİRDEK] Ortak tablet Play'in en düşük hedef SDK'sı (bugün 36); API 36 yön kilidi `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` (`plugins/withBuyukEkranYonu`), 37'den önce kilitsiz düzen; `build:aab` AAB'den ölçer.

### Yasaklar

- [ÇEKİRDEK] Android paket adını/mührünü değiştirme; üretim tabletine başka mühürlü APK kurma (veri ve cihaz kimliği düşer).
- [ÇEKİRDEK] Yayınlanan `versionCode`u düşürme (`build-apk.mjs` ölçer).
- [ÇEKİRDEK] OTA turunda `android.versionCode`a DOKUNMA; yalnız Play'e (ya da eski kanala) gidecek native pakette artar; `app.json` ↔ künye ayrışırsa OTA durur → native değişmediyse GERİ AL, değiştiyse önce native (Play).

### Reçeteler

- [ÇEKİRDEK] Deploy: backend ÖNCE, panel + tablet SONRA; sözleşme kıran değişiklikte (uç, alan adı/tipi, zorunlu parametre, enum, izin) 'eski istemci ne yapar' AÇIKÇA cevaplanır, gerekirse minVersion.
- [ÇEKİRDEK] YAYIN GÜNÜ çuval notu: `scripts/remove_sack_note_element.ts` dry-run (çıktı SAKLANIR) → `--apply`, KULLANICI koşar; yalnız `LabelKind.SACK` `bind === "sackNote"` kalkar, `Sack.notes` kalır; basılı etiket değişmez, `labelDirty` yok.
- [ÇEKİRDEK] YAYIN GÜNÜ rol göçü: `migrate deploy` sonrası, istemciden önce `scripts/migrate_partner_roles.ts` dry-run (SAKLA) → onay → `--apply` → ikinci koşum 0; KULLANICI koşar; runbook `docs/ops/IS-ORTAGI-ROL-GOCU.md`.
- [ÇEKİRDEK] Rol göçünde ad çakışan profil otomatik bağlanmaz (yalnız `--baglan` + onay); tombstone'a kart yok; fikstür dışı `--apply` `--canli-onay` ister, üretim adı yine RED.
- [ÇEKİRDEK] Nottaki tırnak koddan: ≤5 kelime BİREBİR, uzun cümle NORMALİZE içerilme; bilerek özet `PARAFRAZ` + gerekçe; beyan ↔ madde İKİ YÖNLÜ (ölü muafiyet kırmızı).
- [ÇEKİRDEK] Not maddesi kendini TEKRAR ETMEZ: madde içi muafiyet YOK; maddeler arası bilinçli güvence cümlesi BEYANLA (kapalı liste, iki yönlü); ölçü normalize cümle eşitliği.

## Backend

### Değişmezler

- [ÇEKİRDEK] `docs/surumler/backend-<sürüm>.md` yoksa `paketle.ps1` ağır işten ÖNCE DURUR; yedi başlık (özet · ne değişti · sözleşme · migration · kurulum notu · geri alma · doğrulama); ad/SHA256/commit'i MAKİNE yazar; belge kurana, backend `surum-notlari.json`a girmez.
- [ÇEKİRDEK] Korumalı backend yalnız `deploy/korumali-thinkpad.sh` (varsayılan PROVA); gerçek `--kip gercek --surum x.y.z`: temiz ağaç, HEAD = `origin/main`, belge o commit'te, `backend-vX` başka commit'te değil; etiket Mac'te YEREL; künye kipi ↔ PAKET.json `prova` İKİ YÖNLÜ.
- [ÇEKİRDEK] Korumalı Linux imajını Mac'te derleme: `gh workflow run korumali-paket.yml --ref main`, `korumali-imaj-linux-x64` `docker load` + `imaj-imzala.mjs --ci-kosu=<koşu>`; `--ci-atla` yalnız kullanıcı cümlesiyle.
- [ÇEKİRDEK] Güncelleyici/hizmet konağı kaynağı son `backend-v*`ten beri değiştiyse Cargo sürümünü etikettekinden BÜYÜK yap.
- [ÇEKİRDEK] Yeni projeksiyon/tel şeması taşıyan backend'den ÖNCE patron bulutunu yükselt, nota "bulut önce" yaz (`PROJEKSIYON_BILINMIYOR`).
- [ÇEKİRDEK] Backend paketlenip imzalanınca `backend-v<sürüm>` etiketini origin'e it (CI `test_backend_surum`).
- [ÇEKİRDEK] Mobil sürüm İKİ EKSEN: `minVersion` (APK) + `minPaketTarihi` (`Updates.createdAt`); `paketTarihi=null` ESKİ SAYILMAZ; tablet kilidi KOŞULLU (kurulabilir düzeltme + gönderilmemiş kayıt yok); önce paket.

## Panel (Electron)

### Değişmezler

- [ÇEKİRDEK] Panel `productName`/`appId`ini değiştirme; zorunluysa `config.deviceId`yi eski `userData`dan taşı.
- [ÇEKİRDEK] Panel feed TEK KAYNAK `yayin.panelFeed`: `-c.publish.url` (→ `app-update.yml`) + `shared/channel.ts` (→ `setFeedURL`), paket ikisinden doğrulanır; `build.publish` silinmez; `artifactName` ASCII, `${productName}` YASAK.
- [ÇEKİRDEK] Panel YALNIZ imzalı künyeyle kurar: `latest.yml` `tekserp: {v: 2, bildirim, iptal?}` (`typ: tekserp-panel`, imzacı `ist-*`, kök çapada; v:1 `BELGE_SURUM` RED) indirmeden ÖNCE ve kurulumdan önce yeniden ölçülür.
- [ÇEKİRDEK] Künye ölçümü: kök → sertifika → imza (+180 gün) · iptal (`userData/lisans-iptal.jws` + belirteç + blok) · kanal · sürüm · ad/boy/sha512 · kuruludan yeni; geçmezse indirme/kurulum yok, TR uyarı, eski sürüm; kural tek kaynak `Electron/electron/guncelleme/*.mjs`.
- [ÇEKİRDEK] İmzasız/geçersiz künyeli `latest.yml` YÜKLENMEZ; imzasızsa `Teks-Erp/scripts/panel-imza.ts` (Anahtar Zinciri `tekserp/istemci`, yoksa TTY), kid `ist-*`; yeni kök yayındaki `capa`da; `kok-<yıl>-<n>` dışı/bozuk çapa PAKETLENMEZ.
- [ÇEKİRDEK] Çapaya satır yalnız `guven-capasi-ekle.ts istemci-kok --kok-kid=…` (eski `panel` 64 ile durur); künyeyi PAKET değil `ist-*` anahtar imzalar.
- [ÇEKİRDEK] Açık form (`ui/dialog`/`ui/sheet` düzenlenebilir ya da `<form>`) varken geri sayım BAŞLAMAZ; "Sonra" kapanışta kurar (`before-quit` yeniden ölçer); elle kurulum onay ister; kayıt TEK kaynak `src/lib/acik-form.ts`; politika kilidi/giriş beklemez.

### Tuzaklar

- [PROFİL] `nsis.perMachine:true` KALIR: yönetici olmayan hesapta güncelleme kurulmaz, panel eski sürümde kalır; değişim `perMachine:false` + elle tur.

### Reçeteler

- [ÇEKİRDEK] Adres ezmesi (`config.updateFeedUrl`) YALNIZ `https://<kanal güncelleme sunucusu>/<kanal>/electron/` (http/host/port/sorgu RED), ana süreçte yazarken ve okurken; yalnız `admin:settings`; belirteç yalnız izinli adrese.

### Kararlar

- [ÇEKİRDEK] `autoUpdater`a modül gövdesinde DOKUNMA (`updater()` getter); `autoInstallOnAppQuit=false`; şerit YALNIZ `ready` (istisna `UpdateSecurityStrip`); ZORUNLU (`UpdateGate` 2 dk, 20 sn bekçi, 5 dk tekrar); tetik `Root`ta TEK (girişte 15 sn); zamanlayıcı main'de 30 sn + 15 dk.

## Tablet (mobil)

### Değişmezler

- [ÇEKİRDEK] Tablet kanal kimliği DERLEMEDE: `--musteri` → `TEKSERP_KANAL`, `app.config.js` `kanallar.json`dan; `app.json` kanal için YAZILMAZ; OTA anahtarı kanal başına AYRI (çapraz doğrulanırsa DUR); APK kimliği hedefinki değilse DUR; değişimde `npx expo prebuild --clean`.
- [ÇEKİRDEK] `NUMBER_SERIES_CLIENT_TOO_OLD` kilidi için tablet ≥ 1.0.8 (1.0.7 ATLANIR); panel eşiği 1.3.1'in ÜSTÜ.
- [ÇEKİRDEK] `runtimeVersion` JS↔native uyumu, backend sözleşmesi değil; süzme SUNUCUDA, adres sürümü içerir (`/<müşteri>/mobil/ota/<rv>/manifest`).
- [ÇEKİRDEK] OTA turu da yama numarası alır; tablet sürümü PAKETTEN (`Constants.expoConfig.version`); yayındaki sürüm `multipart/mixed` `manifest` parçasından.

### Tuzaklar

- [ÇEKİRDEK] `usesCleartextTraffic` yalnız `expo-build-properties` android bloğunda geçerli (app.json `android` altı sessizce atılır); `android/` prebuild çıktısıdır; sürüm paketinde `false` (K3).
- [ÇEKİRDEK] Bundle'da hep ASCII dize ara (Hermes Türkçeyi UTF-16 tutar); sıcak Metro/Gradle önbelleği env'i görmez.

### Reçeteler

- [ÇEKİRDEK] Kanal TAHMİN EDİLMEZ: `npm run yayinla:check -- --musteri=<kod>` (ortakta `yayinla:ortak:check`): tutarlı = OTA, 'NATIVE DEĞİŞTİ' = `runtimeVersion` artır → `build:aab` → Play; iz değişip rv aynıysa DUR (`--parmak-izini-kabul-et`); şüphede ARTIR.

- [ÇEKİRDEK] `mobil/.ota-parmak-izi-ortak.json` git'te; AAB yayın commit'inde güncelle, paket turundan önce commit'le.
- [ÇEKİRDEK] AAB Play'e yalnız `node deploy/play-yayinla.mjs --kanal=internal|alpha|production` (KURU varsayılan, `--uygula`; beta RED): vc Play'dekinden büyük, künye = AAB = HEAD, `--verify-only`, tr-TR not ≤500; defter `play-YAYIN-DEFTERI.tsv`.
- [ÇEKİRDEK] `internal` etiketsiz (sonra `tablet-vX`); `alpha` `terfi/<grup>/tablet-vX` + dahili AYNI bayt (kaçış cümleyle); `production` `terfi/genel/tablet-vX` + AYNI bayt, yükleme yok, `--yuzde=1..100` yalnız artar, kaçışsız.
- [ÇEKİRDEK] Play mağaza girişi yalnız `node deploy/play-magaza.mjs --app=yonetim|tablet --uygula` (kaynak `<uygulama>/magaza/`); görseldeki gerçek veriyi opak maskele, maskesizi repoya koyma; üretim atamasını bununla yapma.

### Kararlar

- [PROFİL] Eski kanal (adnansahin) APK künye yolu `eski-kanal-son` etiketinde DONUK; ana dalda kodu yok (K-14), yeni iş eklenmez.
- [ÇEKİRDEK] Ortak tableti yalnız Google Play üretim kanalından dağıt (native Play, JS OTA); APK'yı siteye koyma, kendi APK'sını kuran yol açma.
- [ÇEKİRDEK] Sunucu yeni native isterse tablet YALNIZ uyarır ("Play Store'u aç"), kilitlemez; In-App Updates eklenmez.
- [ÇEKİRDEK] `build:apk` yalnız test anahtarıyla, fabrikaya dağıtılmaz; AAB yalnız Play yükleme anahtarıyla; mühürler karışmaz.
- [PROFİL] 'İki adres farklı' (ERP ↔ güncelleme) uyarısı EKLENMEZ; iki bağlantı etiketli bilgi basılır.

## Geçersiz kılınan kurallar — bunlara UYMA

- Elle panel sürüm artırma; 4 saatlik kontrol (artık 15 dk); argümansız eski `build:apk` ve "(elle kurulur)"; LAN render eden manifest; 2.9.x/vc5x numaraları; "son elle tur".

## Çözülmüş çelişkiler

- `build-apk.mjs` `--musteri`siz durur; ERP adresinde gömülü varsayılan yok (`.env*` üçüncü kaynak); "elle tur" = tablette 'Yükle' dokunuşu.

## Açık sorular

- Borç: sonraki tablet sürümü native turu (`expo-notifications`, ML Kit belge tarayıcı + metin tanıma S16c) — `urun.tablet.runtimeVersion` artır, AAB Play'e, parmak izi kaydını güncelle. `electron-yayinla.ps1` silinmesi önerildi; bayat yorum/reçeteler temizlik.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- [ÇEKİRDEK] APK derlemesinden önce `<kök>/health` yoklanır; sonuç UYARI, durdurmaz.
- [ÇEKİRDEK] `versionCode` ayrışınca `git log tablet-v<son>..HEAD -- mobil/android mobil/app.json mobil/package.json`; native değişmediyse `app.json` GERİ ALINIR.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad>` · Electron `npx vitest run` · mobil `npx jest`. Harita `Teks-Erp/docs/BEKCI-HARITASI.md` (⚠️ bayatlık).

Backend: `test_backend_surum`, `test_client_policy`, `test_client_registry`, `test_db_copy`, `test_migration_hygiene`, `test_mobile_update`, `test_offsite_sweep`, `test_surum_belgesi`, `test_eski_istemci_okutma`, `test_panel_imza`, `test_thinkpad_kokeni`, `test_musteri_adi_kodda_yok`, `test_sack_label`, `test_migrate_partner_roles`, `test_docker_hijyeni`

Kök (`node scripts/<ad>`): `test_kod_imzasi.mjs`, `test_tablet_ortak_paket.mjs`, `check-dagitim.mjs`, `test_eski_kanal_donuk.mjs`, `check-kanallar.mjs [emekli 2026-10-06 df70f82f8; son hâli eski-kanal-son]`, `check-yayin-okuma.mjs`, `test_grup_yayin_kapisi.mjs`, `test_guncelleyici_surum.mjs`, `test_surum.mjs`, `check-surum-notlari.mjs`, `test_korumali_thinkpad.mjs`, `test_backend_yayin.mjs`, `test_pg_ornegi.mjs`, `test_parola_kasasi.mjs`, `test_node_surumu.mjs`, `test_grup_yayin_tablet.mjs`, `test_play_yayinla.mjs`, `test_play_magaza.mjs`

Panel imzalı künye: `test_panel_imza` · `panel-kunye.test.ts` · `updater-imza-akisi.test.ts` · `update-imza-arayuz.test.tsx` · `download-token.test.ts` · `test_grup_yayin_kapisi.mjs` §8

Panel güncellemesi açık formu bekler: `src/lib/acik-form.test.tsx` · `src/test/guncelleme-form-kapisi.test.tsx` · `updater-kapanista-kur.test.ts`

İstemci: `ChannelBadge.test.tsx`, `login-totp.test.ts`, `GuncellemeDugmesi.test.tsx`⚠️, `surum-notlari.test.ts`⚠️, `version-compare.test.ts`⚠️, `clients-utils.test.ts`, `update-check-interval.test.ts`, `update-feed-url.test.ts`, `update-gate-escape.test.ts`, `update-gate-her-ekranda.test.tsx`, `UpdateActions.test.tsx`, `appUpdate.service.test.ts`, `clientPolicy.service.test.ts`, `surumNotlari.test.ts`, `play-dagitim.guard.test.ts`; satıcı `update-groups.test.tsx`, `distribution.test.tsx`, `test_bulut_kira_alanlari`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- `arsiv/2026-08.md` (Electron dağıtımı, mobil uzaktan güncelleme, sipariş görünürlüğü) · `arsiv/2026-09.md` (süperadmin P8) · 2026-10-01 D5 PG tek kaynağı, G22 yayın hijyeni.
- [ÇEKİRDEK] Panel grup yayını yalnız `deploy/electron-grup-yayinla.sh --grup=test|oncu|genel`: hedef dağıtım kaydından (ezme RED), kapılar ağdan önce, oncu/genel terfi etiketi + kaynak özet eşitliği (genel ikinci onay), künye grup adıyla imzalı, `latest.yml` EN SON.
- [ÇEKİRDEK] Tablet grup yayını yalnız `deploy/mobil-grup-yayinla.mjs --grup=<…> --paket=<ortak OTA>` (`--apk` RED); OTA paketi (`yayinla-ota-ortak.mjs`) manifest/ERP adresi taşımaz; manifest grup başına parolalı OTA YAPRAĞIYLA imzalanır (`certificate_chain`), EN SON yüklenir; `versionCode` sabit.
- [ÇEKİRDEK] OTA yaprağı `--ota-anahtar` ile (varsayılan yol yok); parola Anahtar Zinciri `tekserp/istemci` (`--kasa=yedek`), yoksa istem, argüman/ortam asla; yaprak yok/parolasız/köke bağlı değil/bitişe <30 gün → DUR; terfi/K-6 `scripts/lib/grup-yayin.mjs`ten.
- 2026-10-12 · Windows kod imzası adımı (B9): sertifika varsa imzala + doğrula, yoksa uyar; kaldırıcı imzasız [ÇEKİRDEK] — `arsiv/2026-10.md` §2026-10-12 Cihaz kanıtı
