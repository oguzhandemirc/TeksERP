# Tablet test sürücüsü — `adb` ile ekran koşumu

Kullanıcı testi güzergâhının **tablet adımlarını** gerçek cihazda (ya da emülatörde)
`adb` ile koşturup adım başına **yeşil/kırmızı + ekran görüntüsü + backend doğrulaması**
üreten Node aracı. **Yeni paket YOK** — yalnız `child_process` + `adb` + Node `fetch`.

> Bu araç geliştirme/QA yardımcısıdır, uygulama koduna dahil değildir. Bir bekçi değildir;
> commit kapısı koşmaz. Gerçek cihaz koşumları kullanıcı testinin devamıdır (`TEST-` önekli veri).

## Dosyalar

| Dosya | Ne yapar |
|---|---|
| `adb.mjs` | Cihaz katmanı: `dump()` (uiautomator XML, 3 denemeli — emülatör jank'ı için), `tik/uzunBas/kaydir`, `yaz` (ASCII; ASCII dışı `input text` REDDEDİLİR), `tus/geri`, `ekran` (PNG), `onPlan/baslat/durdur`, `ekranBoyutu`; `cihazlar()` bağlı cihazları listeler. |
| `ekran-agaci.mjs` | uiautomator XML'ini **paketsiz** ayrıştırır (`ayristir`), `bul/hepsiniBul/esle` seçicilerle düğüm arar, `dokunulabilir` metin düğümünün clickable atasını bulur, `ozet` log çıktısı. |
| `surucu.mjs` | Ekran eylemleri (`bekle/bekleYok/tik/tikXY/yaz/numpadYaz/kaydir/ekran`) + adım koşucusu `kos()` → `sonuc.json` + görüntü klasörü. |
| `api.mjs` | Backend doğrulama istemcisi (`fetch`, `X-Client-Type: web`) — "ekranda ne var" değil "**deftere ne yazıldı**". |
| `guzergah.mjs` | Tablet koşucusu (d9'un panel sürücüsünün — `Electron/e2e/guzergah` — ikizi): d9 ortamını (`e2e-ortam.ts`) okur, cihazı bağlar, `adimlar.mjs`'i `kos()` ile koşar, backend `pg` (yeni paket YOK) ile `sql` doğrular. |
| `adimlar.mjs` | Tablet adımları (A3·D1·D2 …) — `id` + `dogrula` d9'unkiyle AYNI, `yap` gövdesi adb fiilleriyle. |
| `kos-sozlesme.mjs` | Sözleşme öz-testi: `kos()` çıktısı d9 `sonuc.json` biçimiyle birebir mi (`node` ile, cihazsız). |

## Ortak E2E DSL (d9 ile) — `kos()` sözleşmesi

Panel (d9) ve tablet sürücüsü AYNI adım nesnesini ve AYNI `sonuc.json`ı üretir; 1e iki raporu yan yana okur.

- **Adım:** `{ id, rol('P'|'M'|'S'|'T'), yol, gerektirir?:string[], yap(ctx), bekle?(ctx), dogrula?:[{ad, uc|sql, params?, oku?, beklenen}] }`. `id` güzergâh harf+sayı, İKİ SÜRÜCÜDE AYNI; `dogrula` (backend) AYNI; `yap` gövdesi cihaza özgü.
- **Üç değer:** `yesil · kirmizi · atlandi`. `gerektirir`deki bir id kırmızı/atlandıysa adım **atlandı** (kırmızı değil — "ölçemedim" ile "bozuk" ayrı).
- **`beklenen`** sabit (=== / String eşitliği) ya da yüklem fonksiyonu; **`oku`** opsiyonel.
- **Çıktı:** `out/<zaman>/sonuc.json` = `{ zaman, api, db, ozet:{yesil,kirmizi,atlandi}, adimlar:[{id,rol,yol,durum,sure_ms,dogrulama:[{ad,ok,beklenen,gorulen}],hata,ekran}] }` + adım başına PNG.
- **Fiiller (ctx):** `git(key)` karo · `tikla(ad)` düğme/desc · `yaz`/`numpad` · `sec(alan,satır)` picker · `gor(metin)` görünür bekle · `bekle(ms)` · `ekran(ad)` · `api` · `sql`.

## RN → uiautomator eşlemesi (ÖLÇÜLDÜ 2026-09-18, Expo 54 / RN 0.81, emülatör API 15)

| React Native | Android uiautomator alanı | Not |
|---|---|---|
| `testID` | `resource-id` | **Paket öneki YOK** — olduğu gibi (`paged-ileri` → `resource-id="paged-ileri"`). |
| `accessibilityLabel` | `content-desc` | En güvenilir seçici; `Button`/`IconButton` etiketini de taşır (`desc="SAR"`, `desc="İleri"`). |
| `<Text>` içeriği / Button etiketi | `text` | Görünür metin; menü karoları YALNIZ bunu taşır (testID/desc yok → karonun KENDİ merkezine dokun, ata-clickable çözme karoyu ıskalar). |

Öncelik: **`desc` (accessibilityLabel) > `id` (testID) > `text`**. Metin düğümü çoğu zaman
`clickable=false` — `dokunulabilir()` clickable atayı bulur; ata çözümü ıskalarsa düğümün
KENDİ `bounds` merkezine `tikXY` ile dokun.

### Tuzaklar (ölçüldü)

- **Emülatör jank'ı** `uiautomator dump`'ı zaman aşımına uğratır → `dump()` 3 denemeli; bir tur `wait-for-device` + kısa bekleme çözer.
- **`input text` yalnız ASCII taşır** (ş/ğ/ı/İ düşer) → TR metin için numpad/tık dizisi ya da `TEST-` ASCII veri; `yaz()` ASCII dışını REDDEDER (sessiz düşme yok).
- **Uygulama numpad'i** (`NumpadInput`) modal içinde her zaman büyük pad açmıyor; sistem klavyesi moduna düşen alanlarda odak sonrası `input text "30"` çalışır (ölçüldü: Sar kg alanı).
- **PickerModal seçimi**: satırın `content-desc`'i tam etiketi taşır (`"TEST-L1, 58 kg"`); satırın `bounds` merkezine dokun (metin düğümü değil).

## Koşum

```
# 1) d9 ortamı (Teks-Erp/ içinden), bir kez + ayrı terminalde sunucu:
cd Teks-Erp && npx tsx scripts/e2e-ortam.ts kur
cd Teks-Erp && npx tsx scripts/e2e-ortam.ts sunucu      # backend :4110

# 2) emülatör + TEST APK:
~/Library/Android/sdk/emulator/emulator -avd Medium_Tablet -no-snapshot-load &
adb install -r <TEST-APK>

# 3) tablet güzergâhı (mobil/ içinden):
node scripts/surucu/guzergah.mjs               # bütün T adımları
node scripts/surucu/guzergah.mjs A3 D1 D2      # seçili
#   --seri=<adb seri> · --host=<Mac LAN IP> (gerçek cihaz; emülatörde 10.0.2.2)

# sözleşme öz-testi (cihazsız):
node scripts/surucu/kos-sozlesme.mjs
```

`guzergah.mjs` cihazı bağlar, `adimlar.mjs`'i `kos()` ile koşar; her adımın görüntüsü alınır,
kırmızıda `-agac.txt` düşer, `out/<zaman>/sonuc.json` d9 biçiminde yazılır (üst düzey ↑).

## Prova (2026-09-18, Medium_Tablet emülatör, Devere sayfalı Sar)

Bölüm Seçimi → Levent Sarım → SAR → sayfalı sihirbaz (Ölçü · Makine·iplik · Dip iadesi·özet)
uçtan uca sürücüyle koşuldu; makine/lot seçildi, kg girildi, ÖZET sayfasına ulaşıldı ve
**gövde çakışması erken uyarısı** ("T1 gövdesinde LV… tezgahta — sarım reddedilir") özette
doğrulandı. Kayıt YAZILMADI (Vazgeç). Görüntüler `scratchpad/surucu-devere/`.

## Bilinen sınır — Sortable grid fold-altı kaydırma GÜVENİLMEZ (2026-09-18, gerçek tablet)

Bölüm Seçimi karo ızgarası `react-native-sortables`tır; `input swipe` ile kaydırma KARARSIZ —
fold-altı karolar (18 izinli operatörde `Levent Sarım`/`modul-karo-Devere` son satırda) bazen
bulunur bazen bulunmaz, aynı çözgü kartı picker'ı da uzun listede güvenilir kaydırılamaz. Bu
YÜZDEN A3→D2 tam otomatik yeşile ÇIKARILAMADI (karo ve ekranlar ÇALIŞIYOR — el ile kanıtlandı).
Kanıtlanan yol: A3 giriş YEŞİL, D1 Levent Sarım → Yeni levent → Çözgü kartı picker'ına kadar
(kısmi `out/*/sonuc.json`). ⇒ Sürücü fold-altı için `input swipe` yerine UiScrollable/
scrollIntoView tabanlı GÜVENİLİR kaydırma ister (hardening ayrı iş). D9 PANEL sürücüsü (Electron
DOM scroll) bu sınırı yaşamaz; A3→D2 yeşilini oradan almak daha güvenilir.

Bu turda düzeltilen iki gerçek adimlar hatası: `git('devere')` → `git('Devere')` (karo testID
`modul-karo-Devere`, registry key'i BÜYÜK) ve A3 dogrula `/api/auth/me` `data.userId` okur
(uç `data.id` değil `userId` döndürür).
