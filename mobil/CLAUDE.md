# TeksERP Mobil (`mobil/`)

React Native + Expo 54, Android tablet (yatay) + telefon (dikey), yön kilidi yok. Domain kuralları kök `CLAUDE.md`; alan kuralları `docs/kurallar/<alan>.md`; desenler `docs/KOD-KURALLARI.md` + `docs/standart/MOBIL.md`. Gerekçe ve ölçümler arşivde (2026-10-12 "CLAUDE.md kısaltma turu — mobil").

## Komutlar

```bash
npx expo start [--android] · npx expo run:android   # native build (BT/BLE Expo Go'da çalışmaz)
npx tsc --noEmit · npm test                          # jest, commit kapısında
npm run yayinla:ortak:check · yayinla:ortak          # OTA mı Play mi? · ortak OTA paketi
npm run build:aab                                    # ortak paket → Google Play (ERP adresi GÖMÜLMEZ)
npm run build:apk                                    # YALNIZ yerel deneme, fabrikaya gitmez
node ../deploy/mobil-grup-yayinla.mjs --grup=<test|oncu|genel> --paket=…   # OTA yükleme (manifest EN SON)
```

- **Sahaya çıkış:** hedef `--grup` (`deploy/dagitim.json`), `--musteri` yok; kimlik `dagitim.json`dan `app.config.js`e gelir; `runtimeVersion` native kimliğidir (artmazsa yeni JS eski native'i çağırır); OTA turunda `versionCode`a dokunulmaz; `keystore/` git dışı; uygulama içinde APK kurma YOK. Yeni native modül/izin/ikon/SDK → Play (AAB). Reçete `docs/kurallar/surum-yayin.md`, `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`.
- **API adresi:** `EXPO_PUBLIC_API_URL` → `store/baseUrlStore.autoUrlFrom` → axios; ortak pakette adres boş, ilk ekran "Sunucuyu bul" (`localhost`a düşülmez). JWT `expo-secure-store`; offline mutasyon kuyruğu react-query persist. Sunucu politikası `GET /api/client-policy/mobil` iki eksen (`minVersion` + `minPaketTarihi`).
- **Sunucu bağlantısı yalnız şifreli:** sabitlenmiş TLS; `http://` reddedilir; eşleşme QR ya da adres + doğrulama kodu (`components/serverPair/`); düz HTTP yalnız debug. Kural `docs/kurallar/kesif-cihaz.md`.

## Klasör yapısı

`src/screens/` (`Modules/<Ekran>/`, `Common/settings/`) · `components/` · `navigation/` (`pairingGate.ts`) · `services/` (api, hal/, scanFeedback, printHtml, btPrinter) · `store/` · `hooks/` · `offline/` · `types/` (`permissions.ts` union ELLE taşınır) · `constants/` (`stationScreens.ts`) · `test/` (guard testleri).

## Donanım (HAL) ve oturum

- **Donanım = VERİ:** cihazlar backend `PeripheralDevice`'ta; tablette device-local seçim YOK. HAL `services/hal/`, `usePeripheralIO.buildIoFromPeripheral`.
- **Çözümleme OTURUM kapsamlı:** `useMachinePeripherals` → `GET /peripherals/for-session`; oturum yoksa BOŞ (fail-closed). Oturumlu ekranlar `SessionGate` ile sarılı; yer onayı yalnız odaktaki ekranda. `409 WORK_SESSION_REQUIRED` → yerel oturum düşer, gate yeniden sorar.
- **Fail-closed:** cihaz yok / okunamadı / değer ≤ 0 → Türkçe toast, mutasyon çağrılmaz; `simulate` cihazda değer `source:'SIMULATED'` beyanıyla gider. BT tek soket (`busyRef`). Okuma TEK DOKUNUŞ; araya input modalı konmaz. Kendi açtığımız sistem diyalogları `withSystemDialog()` ile sarılır; HTML yazdırma yalnız `services/printHtml.ts`.
- **Kamera:** `expo-camera` (`CameraView`); `initialFacing` ZORLAMA. Saha yolu BT-Classic; BLE yeni işe seçilmez.
- Cihaz onayı tek yüklem `navigation/pairingGate.ts`. `docs/kurallar/kesif-cihaz.md`.

## Okutma ve giriş kalıpları

- **Okutma geri bildirimi üç ortak katman:** `services/scanFeedback.signalScan` (ekranlar `Haptics`i doğrudan çağırmaz; bekçi `src/test/scan-haptics.guard.test.ts`) · `hooks/useScanFeedback` · `components/ScannerRollStrip` (`rolls` EKLENME sırasında). Çok top okutan ekran `trigger="tap"`, tek okuyan `auto`. Ayrıntı `docs/standart/MOBIL.md` § okutma.
- **Okutma kararı saf yüklem** (`scanClassify`); statü kontrolü çuval/sevkiyattan ÖNCE.
- **İdempotency:** token mantıksal deneme başına, yalnız belirsiz hatada yapışır (`offline/entryAttempt.ts`); çuval mutasyonları online-only; çakışma 409'ları modal. `docs/kurallar/kk1.md`.
- **Numara girişi:** modalda `NumpadInput` + `useNativeKeyboard`; `NumpadHost autoActivate` yalnız tek alanda. Metraj kaynağı CİHAZ ayarı (`deviceSettingsStore`).
- **Sebep seçimi:** `ReasonPresetPicker` tek bileşen. `docs/kurallar/sebep-katalogu.md`.
- Kısa kesim tek birleştirme `resolveShortCutConfig`. `docs/kurallar/tambur.md`.

## UI/UX

- Dokunma hedefi ≥56dp; birincil metin ≥14, ikincil ≥12, kritik rakam ≥20; her ekran iki yönde çalışır.
- Tıklanabilir alan `react-native-paper` (`TouchableRipple`/`Button`/…); **`Card` + `onPress` KULLANMA**. **`SegmentedButtons` `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ** (bekçi `test/segmented-buttons-row.guard.test.ts`).
- Modallar `components/AppModal.tsx`; ön-dolu metin kutusu `ModalTextInput`. Yeni ayar bölümü alt sayfa + menü satırı olur, ana ekrana gömülmez.
- **Yeni modül modalı `ModuleSheet` (tek kart) ya da `PagedSheet` (sayfalı) — üçüncü biçim yok:** gövde ekranın %70'inden uzunsa sayfalı; düğmeler kartın içinde sabit; kesik metin yasak (ad metni `TruncatedText`, bekçi `test/ad-metni.guard.test.ts`); seçici daima `PickerModal`; stil sözlüğü `sheet`.
- Liste: cursor + sonsuz kaydırma (`useInfiniteQuery` + `FlashList`); modal listesi `RemoteListSheet`; pager YOK.
- Yerleşim hatasında ölçüm: `adb exec-out screencap` + `uiautomator dump`.
- **Tablet test sürücüsü** `scripts/surucu/` (yeni paket yok): sürücünün adlayacağı düğüme `testID`/`accessibilityLabel` konur; `input text` ASCII-only. Reçete `scripts/surucu/README.md`.

## Paketler

Yeni paket için onay; küme ve karar kaydı `docs/standart/KUTUPHANELER.md` §2.3 (bekçi `test_dependency_contract`). Yeni ikon `@expo/vector-icons`ten.
