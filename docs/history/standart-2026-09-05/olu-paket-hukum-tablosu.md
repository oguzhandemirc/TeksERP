# Ölü paket hükmü — 2026-09-05 turu, donmuş tablo

`docs/standart/KUTUPHANELER.md` §7'den 2026-09-13'te buraya taşındı. Sebep iki katlı: (1) `Durum` sütunu **2026-09-05 ölçüm anındadır** ve standart dosyası hikâye taşımaz; (2) o dosya belge boyut tavanına **1 bayt** kalmıştı ve tavan yükseltilmedi.

Turdan doğan iki KURAL standartta kaldı: `KUTUPHANELER.md` §7 `[KU-24]` (native paket kaldırmak APK turudur) · `[KU-25]` (kaldırma öncesi üç projede yeşil taban).

Üç kanaldan doğrulanmış 15 paket + 1 belirsiz. Kaldırma sırası ve doğrulama komutları: `olcum/k01-olu-paket-uc-kanal.json` § `kaldirmaSirasi`.

| Paket | Proje | Hüküm | Kanıt (özet) | Kaldırma etkisi | Durum |
|---|---|---|---|---|---|
| `@radix-ui/react-avatar` | Electron | ÖLÜ | yalnız `package.json:43`; `ui/avatar.tsx` yok, `<Avatar` 0 | saf JS, etkisiz | adım 1 |
| `@radix-ui/react-scroll-area` | Electron | ÖLÜ | yalnız `package.json:50`; `<ScrollArea` 0 | saf JS, etkisiz | adım 1 |
| `@radix-ui/react-switch` | Electron | ÖLÜ | yalnız `package.json:54`; `<Switch` 0 | saf JS, etkisiz | adım 1 |
| `@fontsource/roboto` | Electron | ÖLÜ | yalnız `package.json:41`; CSS'teki "Roboto" İŞLETİM SİSTEMİ font adı | yedek zincir aynen çalışır | adım 1 |
| `electron-window-state` | Electron | ÖLÜ | yalnız `package.json:71`; pencere ölçüsü sabit kodlu `electron/main.ts:39-41` | etkisiz (durum zaten kalıcı değil) | adım 1 |
| `@react-pdf/renderer` | Electron | ÖLÜ | 3 kanal 0; yerini backend `renderTravelerCardHtml` + iframe aldı | `buffer`a DOKUNMA; `main.tsx:13-15` yorumu exceljs'e çekilir | adım 2 |
| `@faker-js/faker` | Teks-Erp (dev) | ÖLÜ | `src`+`scripts`+`prisma` 0; tek iz `knip.json:24` susturması | devDep, ürüne zaten girmiyor | adım 3 |
| `@react-navigation/bottom-tabs` | mobil | ÖLÜ | `createBottomTabNavigator` 0 | saf JS, **OTA-güvenli** | adım 4 |
| `react-native-web` | mobil | ÖLÜ | `app.json`da web platformu yok; tek iz `"web"` script'i | script'le birlikte düşer; `expo-camera` peer'ı optional | adım 5 |
| `react-dom` | mobil | ÖLÜ | tek isteyen `react-native-web`; `jest-expo` istemiyor (ölçüldü) | web ayağından SONRA | adım 5 |
| `react-native-qrcode-svg` | mobil | ÖLÜ | `QRCode`/`<Svg` 0; QR'ı backend üretir | saf JS ama `svg` ile aynı adımda | adım 6 |
| `react-native-svg` | mobil | ÖLÜ | tek isteyen ölü `qrcode-svg`; jest config izi BAYAT | **NATIVE — OTA ile gitmez, APK** | adım 6 |
| `expo-sharing` | mobil | ÖLÜ | `shareAsync` 0; paylaşım `expo-print`+`intent-launcher` yolundan | **NATIVE — APK** | adım 6 |
| `react-native-vector-icons` | mobil | ÖLÜ | Paper peer'ı DEĞİL; Metro + jest-expo `@expo/vector-icons`e ALIAS'lıyor | bundle'a zaten girmiyor; autolink artığı → **APK** | adım 6 |
| `react-native-ble-plx` | mobil | **CANLI** | `bluetooth.service.ts:1` import + `app.json` `plugins[1]` → APK'ya native kod + BLUETOOTH/LOCATION izinleri | **KALDIRILMAZ** — önce "sahipsiz BLE yolu kapansın mı" kararı; sonra 3 dosya + APK + manifest izin diff'i | ayrı iş |
| `buffer` | Electron | **BELİRSİZ** | `main.tsx:1,16` canlı import; exceljs bundle'ı da `Buffer` istiyor | **KALIR** — yalnız yorum gerekçesi düzeltilir | kalır |
