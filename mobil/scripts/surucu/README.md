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
# emülatör (sürücü geliştirme; kendi izole backend'i):
~/Library/Android/sdk/emulator/emulator -avd Medium_Tablet -no-snapshot-load &
adb install -r <TEST-APK>
node scripts/surucu/<güzergah>.mjs        # adım DSL'i + kos()

# gerçek cihaz (kullanıcı testi devamı, backend :4000):
adb -s <seri> ...   # Cihaz('<seri>')
```

Adım DSL'i: `{ id:'D1', ad, yap: async (s)=>{...}, bekle?:[seçici…], dogrula?: async (api,s)=>{...} }`
— `kos(s, adimlar, { api, durdurKirmizida })` her adımın önce/sonra görüntüsünü alır,
kırmızıda `-hata.png` + `-agac.txt` düşer, `sonuc.json` yazar.

## Prova (2026-09-18, Medium_Tablet emülatör, Devere sayfalı Sar)

Bölüm Seçimi → Levent Sarım → SAR → sayfalı sihirbaz (Ölçü · Makine·iplik · Dip iadesi·özet)
uçtan uca sürücüyle koşuldu; makine/lot seçildi, kg girildi, ÖZET sayfasına ulaşıldı ve
**gövde çakışması erken uyarısı** ("T1 gövdesinde LV… tezgahta — sarım reddedilir") özette
doğrulandı. Kayıt YAZILMADI (Vazgeç). Görüntüler `scratchpad/surucu-devere/`.
