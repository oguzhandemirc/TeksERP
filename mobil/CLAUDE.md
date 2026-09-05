# TeksERP Mobil (`mobil/`)

React Native + Expo 54, Android tablet (yatay) + telefon (dikey), yön kilidi yok. Backend `Teks-Erp/` (port 4000). Domain kuralları kök `CLAUDE.md`; alan kuralları `docs/kurallar/<alan>.md`; teknik desenler `docs/KOD-KURALLARI.md`. Bu dosya yalnız tablet-geneli düzeni taşır (yeniden yazım 2026-09-05; önceki sürüm git `6695afc2`).

## Komutlar

```bash
npx expo start · npx expo start --android · npx expo run:android   # native build (BT/BLE Expo Go'da çalışmaz)
npx tsc --noEmit · npm test (jest --runInBand, 85 dosya / 854 vaka / ~17 sn — commit kapısında)
npm run yayinla:check -- --musteri=<kod>        # OTA mı APK mı? (native parmak izi)
EXPO_PUBLIC_API_URL=<erp-adresi> npm run yayinla -- --musteri=<kod>      # OTA (JS-only, ~%90)
EXPO_PUBLIC_API_URL=<erp-adresi> npm run build:apk -- --musteri=<kod>    # native değişti → APK; ./gradlew ELLE ÇAĞIRMA
node ../deploy/mobil-yayinla.mjs --musteri=<kod> --paket=ota-cikti/<kod>/<rv>/<damga>   # yükleme (manifest EN SON)
```

- **Sahaya çıkış:** kanalı değişikliğin cinsi belirler; `--musteri` HER komutta zorunlu (kapı beklenen değeri argümandan alır — `musteri.json`dan alsaydı dairesel olurdu); ERP adresi açıkça verilir, varsayılan YOK; `runtimeVersion` native kimliğidir (artmazsa yeni JS eski native'i çağırır, tüm tabletler çöker); OTA turunda `versionCode`a dokunulmaz; `keystore/` git dışı, kaybı = her tablette sil+kur; `usesCleartextTraffic` `expo-build-properties` altında. Reçete ve tuzaklar: `docs/kurallar/surum-yayin.md`, `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`.
- **API adresi:** `EXPO_PUBLIC_API_URL` → `src/constants/api.ts` (dev-host'tan türetir) → axios `baseURL`; derleme anında gömülür. JWT `expo-secure-store`; her istek `Authorization: Bearer`; cache `@tanstack/react-query` (+ persist: offline mutasyon kuyruğu). Sunucu politikası `GET /api/client-policy/mobil` fail-open, iki eksen (`minVersion` + `minPaketTarihi`).

## Klasör yapısı

`src/screens/` (modüle göre; `Modules/<Ekran>/`, `Common/settings/`) · `components/` · `navigation/` (`pairingGate.ts`) · `services/` (api, hal/, scanFeedback, printHtml, btPrinter) · `store/` (zustand: auth, lock, deviceSettings, tabs) · `hooks/` · `offline/` (mutations kuyruğu, entryAttempt) · `data/` · `lib/` · `types/` (backend ile uyumlu; `permissions.ts` union ELLE taşınır) · `utils/` · `constants/` (`api.ts`, `stationScreens.ts` StationKind→ekran registry) · `theme/` · `test/` (guard testleri).

## Donanım (HAL) ve oturum

- **Donanım = VERİ:** cihazlar backend `PeripheralDevice`'ta (kind/connectionType/address/protokol/`simulate`); tablette device-local seçim YOK. HAL `services/hal/` (`btClassic.transport` HC-06 SPP + `meter.codec`), `usePeripheralIO.buildIoFromPeripheral`.
- **Çözümleme OTURUM kapsamlı:** `useMachinePeripherals('METER'|'SCALE')` → `GET /peripherals/for-session`; oturum yoksa BOŞ (fail-closed). Oturumlu ekranlar `SessionGate` ile sarılı; yer onayı yalnız ODAKTAKİ ekranda (arka plandaki gate pasif — ping-pong yasağı). Yazıcı da oturumdan (`LabelPrinter`; manuel BT seçimi kalktı). Damgalı uçta `409 WORK_SESSION_REQUIRED` → yerel oturum düşer, gate yeniden sorar.
- **Fail-closed:** cihaz yok / bond yok / okunamadı / değer ≤ 0 → net Türkçe toast, mutasyon HİÇ çağrılmaz; `simulate` cihazda uydurulmuş değer `source:'SIMULATED'` beyanıyla gider, backend karar verir (`MANUAL` muaf). BT tek soket: ikinci dokunuş `busyRef` ile sessizce yok sayılır. Okuma TEK DOKUNUŞ (⚖ → oku → kaydet), araya input modalı koyma; taşan aksiyonlar ⋮ menüsünde. Kendi açtığımız Android sistem diyalogları `withSystemDialog()` ile sarılır (idle kilidi "ayrıldı" sanmasın); HTML yazdırma yalnız `services/printHtml.ts`.
- **Kamera:** `expo-camera` v17 (`CameraView` + `onBarcodeScanned`); yön tercihi cihazda (`cameraFacing`), `initialFacing` ZORLAMA; HID tarayıcılar sistem klavyesi. BLE (`react-native-ble-plx`) yolu bugün canlı kullanıcısız — saha yolu BT-Classic; BLE'yi yeni işe seçme.
- Cihaz onayı: doğuş durumu sunucudan (`pairingRequired`), tek yüklem `navigation/pairingGate.ts`, `??` load-bearing. `docs/kurallar/kesif-cihaz.md`.

## Okutma ve giriş kalıpları

- **Okutma geri bildirimi ÜÇ ortak katman:** `services/scanFeedback.signalScan` (ses+titreşim; ekranlar okutma yolunda `Haptics`i doğrudan çağırmaz — ⚠️ ölçüm 2026-09-05: 11 dosya hâlâ doğrudan çağırıyor ve o ekranlarda "mükerrer" sinyali ile ses ayarı ÇALIŞMIYOR; `docs/standart/MOBIL.md` § okutma) · `hooks/useScanFeedback` (`signalScan`i kendisi çağırır; `flash` + `rejects`) · `components/ScannerRollStrip` (son okutulanlar; `rolls` girişi EKLENME sırasındadır, şerit ters çevirir — ters sırada state tutan ekran çeviriyi KENDİ yapar, yoksa yeşil vurgu yanlış satıra gider). Bildirim varken yeşil tik bastırılır; flash (kadraja bakan göz) ile şerit (dönen operatör) birbirinin YERİNE geçmez, süreleri bilinçli farklı; tarayıcı açıkken ekranda, kapalıyken toast. Çok top okutan ekran `trigger="tap"`, tek okuyup kapanan `auto`.
- **Okutma kararı saf yüklem** (`scanClassify` emsali): statü kontrolü çuval/sevkiyattan ÖNCE (`SHIPPED` topa "çuvaldan çıkar" deme).
- **İdempotency:** token mantıksal deneme başına; yalnız belirsiz hatada yapışır (`offline/entryAttempt.ts` tek kaynak); retry payload'ı yeniden okumaz. Çuval mutasyonları online-only (kuyruğa girmez). Kalıcı düşüş anlık toast (`announceFailure`); çakışma 409'ları modal, toast değil. `docs/kurallar/kk1.md`.
- **Numara girişi:** büyük tuş takımı; modalda `NumpadInput` + `useNativeKeyboard` (modalda `NumpadHost` yok); `NumpadHost autoActivate` yalnız tek alanda. Metraj kaynağı (elle ↔ makine) CİHAZ ayarı (`deviceSettingsStore.kk1ManualEntry`, `tamburCutMode`; `recutMode = cutMode`).
- **Sebep seçimi:** `ReasonPresetPicker` tek bileşen (serbest metin ÜSTTE); katalog üç kademeli (sunucu → cihaz → zemin; zemin `WORK_ORDER_REWORK` için GERÇEK kod); sıra sürükleyerek `mergeVisibleOrder` ile. `docs/kurallar/sebep-katalogu.md`.
- Kısa kesim → A1: fabrika ayarı + cihazda üç durumlu override (`server|on|off`), tek birleştirme `resolveShortCutConfig`; kural `Tambur/shortCutQuality.ts`. `docs/kurallar/tambur.md`.

## UI/UX

- Dokunma hedefi ≥56dp; ⚠️ font ölçüsü ÖLÇÜMLE düzeltildi (2026-09-05): 1.163 `fontSize` bildiriminin %83'ü 16'nın altında ve en yoğun değerler 12–13. Kural: **operatörün okuduğu birincil metin ≥14, ikincil/etiket ≥12, kritik rakam (metraj, barkod, sayaç) ≥20**; koyu header/açık içerik; her ekran iki yönde çalışır (tablet split view, telefon tek sütun).
- Tıklanabilir her alan `react-native-paper`: `TouchableRipple` / `Button` / `IconButton` / `Appbar.Action` / `List.Item`; **`Card` + `onPress` KULLANMA** (`Card.Content` dokunmayı yutar); grid/picker hücrelerinde de aynı. **`SegmentedButtons` `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ** (yanındaki başlığı sıfır genişliğe iter; bekçi `test/segmented-buttons-row.guard.test.ts`).
- Modallar `components/AppModal.tsx` (Portal + Reanimated); ÖN-DOLU metin kutusu `ModalTextInput` (portal mikrotask gecikmesi imleci çökertir). Picker'dan yeni kayıt: `PickerModal.leadingAction` (ilk hücre, mor). Ayarlar = menü + alt sayfa: yeni ayar bölümünü ana ekrana GÖMME; alt sayfa yap + menüye satır ekle (`RootStackParamList` + `RootNavigator`; kabuk `screens/Common/settings/` `SettingsPage`).
- Sebep adımı üç bölge: başlık sabit · liste kayar (`flexShrink:1`) · footer sabit — Geri/Kaydet ekran dışında kalmasın.
- Liste: varsayılan cursor + sonsuz kaydırma (`useInfiniteQuery` + `FlashList` `onEndReached`, threshold 0.6); modal listesi `RemoteListSheet`; "Önceki/Sonraki" pager YOK. Hata mesajları Türkçe.
- Yerleşim hatasında tahmin değil ölçüm: `adb exec-out screencap` + `uiautomator dump`.

## Paketler

Yeni paket için onay. `expo react-native react typescript react-native-worklets` · `expo-constants expo-status-bar expo-screen-orientation expo-build-properties expo-haptics expo-audio expo-asset expo-file-system expo-intent-launcher expo-updates` · navigation `@react-navigation/{native,native-stack} react-native-safe-area-context react-native-screens` · UI `react-native-paper @expo/vector-icons react-native-gesture-handler react-native-reanimated` · `expo-camera` · `react-native-ble-plx react-native-bluetooth-classic` · `zustand axios @tanstack/react-query (+persist-client, query-async-storage-persister)` · `expo-secure-store @react-native-async-storage/async-storage` · `expo-print` · `@shopify/flash-list react-native-sortables` · `@react-native-community/netinfo` · `react-native-keyboard-controller` · `react-native-toast-message` · `dayjs`. Karar kaydı ve katman × ihtiyaç tablosu: `docs/standart/KUTUPHANELER.md` §2.3 (bekçi `test_dependency_contract`); ölü paket hükümleri §7. Yeni ikon `@expo/vector-icons`ten alınır. OTA ile gider / APK ister ayrımı: yeni native modül, izin, ikon, SDK → APK.
