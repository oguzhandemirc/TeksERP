# İstemci kurulumu — BU TURDA ZORUNLU, elden

⚠️ Sahadaki paneller ve tabletler **kendini güncelleme yeteneği taşımıyor** —
o özellik tam da bu sürümlerle geliyor. Bu yüzden **bir kereye mahsus** her
cihaza elden kurulum gerekiyor.

**Bundan sonraki turlarda elden dağıtım YOK**: ikisi de güncellemeyi internetten
kendi indirecek.

| Dosya | Nereye |
|---|---|
| `TeksERP-1.2.7-Setup.exe` | Sevkiyattaki / ofisteki her Windows bilgisayara |
| `TeksERP-1.0.0-vc57.apk` | İstasyonlardaki her Android tablete |

⚠️ **Sıra: önce backend.** Yeni istemciler yeni uçları çağırıyor; eski backend'de
o uçlar yok ve istemci 404 alır.

## Adres ayarı GEREKMİYOR

Sunucu yine **`:4000`**'de ve ağa ilan açık. Panelin gömülü/keşif adresi de,
APK'ya gömülü `http://192.168.1.250:4000` de doğru. Hiçbir cihazda adres
girmeniz gerekmiyor.

## Doğrulandı (2026-09-04)

**Panel — `TeksERP-1.2.7-Setup.exe`**
- Yayındaki `adnansahin/electron/latest.yml` ile **sha512 birebir aynı** →
  doğru müşteri derlemesi. ⚠️ Yanlış müşteri kodu taşıyan bir paket **başka bir
  fabrikanın güncellemesini** indirir ve hata SESSİZDİR — elinizdeki başka bir
  setup'ı değil, yalnız bu dosyayı kullanın.
- İçindeki `app-update.yml` doğrulandı: `provider: generic`,
  `url: https://guncelleme.etkiliyazilim.com/adnansahin/electron/` →
  **güncelleyici kurulu ve doğru kanala bağlı.**

**Tablet — `TeksERP-1.0.0-vc57.apk`**
- Yayın sunucusundan indirildi, `apk/surum.json`'daki **sha256 doğrulandı**.
- Gömülü ERP adresi: `http://192.168.1.250:4000` = fabrika sunucusu.
- OTA yapılandırması APK içinde doğrulandı (`expo.modules.updates.ENABLED`,
  `EXPO_UPDATE_URL`, kod imzalama sertifikası `expo-root.pem`).
- OTA ucu **canlı** ve şu an **1.0.6** sunuyor (runtime 54.2, HTTP 200).

## Tablette sürüm numarası kafa karıştırabilir — normaldir

Dosya adı **1.0.0 (vc57)**, ama tablet kurulumdan sonra internetten OTA alıp
**1.0.6**'ya çıkar. İkisi de doğru: `vc57` native paketin sürümü, `1.0.6`
içindeki JS'in sürümü. Tablette **1.0.6** görüyorsanız her şey yolunda.

```
adb install -r TeksERP-1.0.0-vc57.apk
```
⚠️ "İmza uyuşmazlığı" derse: tabletten kaldırıp yeniden kurun (operatör yeniden
giriş yapar).

⚠️ OTA'nın inebilmesi için tabletin **internete** çıkabilmesi gerekir. ERP
bağlantısı fabrika ağında, güncelleme internetten — iki ayrı kanal.

⚠️ **Elinizdeki test cihazındaki APK'yı dağıtmayın.** O yerel bir derleme, yayın
zincirinin dışında; kurulduğu tablet sonraki gerçek APK güncellemesini
alamayabilir. Yalnız buradaki dosyayı kullanın.
