# TeksERP Mobil (`mobil/`)

React Native + Expo 54, **Android tablet (yatay) + telefon (dikey)**. Yön kilidi yok; UI her iki form factor'u responsive desteklemeli. Backend: `Teks-Erp/` (port 4000).

Kök `CLAUDE.md` domain kuralları bu projede de geçerlidir.

## Commands

```bash
npx expo start                  # Metro bundler
npx expo start --android        # Direkt Android
npx expo run:android            # Native build (BLE için gerekli)
npx tsc --noEmit                # Type check
```

> **Önemli:** BLE (`react-native-ble-plx`) Expo Go'da çalışmaz.
> Development build zorunlu: `npx expo run:android`

## APK derleme (sahaya kurulacak paket) — TEK KOMUT

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk
npm run build:apk:check     # yalnız adresi çöz + doğrula (derleme YOK, saniyeler)
npm run build:apk:verify    # mevcut APK'nın gömülü adresini denetle
```

**`cd android && ./gradlew assembleRelease` ELLE ÇAĞIRMA.** Script
(`scripts/build-apk.mjs`) sırasıyla: adresi çözer → doğrular → bundle
önbelleklerini siler → `assembleRelease` koşar → **üretilen APK'nın içindeki
bundle'ı açıp gömülü adresi tekrar okur** → sürüm/SHA basar. Doğrulama düşerse
paket `app-release.DOGRULANMADI.apk` adına taşınır ve exit 1 döner.

**Adres nereden geliyor:** `EXPO_PUBLIC_API_URL` → `src/constants/api.ts` →
axios `baseURL`. Değer **derleme anında koda gömülür**, sonradan değişmez
(uygulama içi "API Adresi" ayarı yalnız o tek cihazı düzeltir). Sahadaki
yetkili sunucu değeri: `docs/ops/DEPLOY-RUNBOOK.md` → "SAHADAKİ KURULUM".
Çözüm sırası: `--api-url` argümanı → ortam değişkeni → `.env*` dosyaları
(Expo ile aynı öncelik). Script değeri Gradle'a **açıkça** geçirir; `@expo/env`
sistem ortamının üstüne yazmadığı için `.env.local` (localhost, USB geliştirme
içindir) sahaya giden paketi sessizce ele geçiremez.

**Neden bu kadar bekçi var** (2026-08-01, ikisi de sessizce ısırdı):

| Tuzak | Neden sessiz | Bekçi |
|---|---|---|
| Bayat sunucu IP'si dokümandan kopyalandı | APK açılır, sadece "bağlanamıyor" der | Derleme sonrası bundle'dan adres okunur |
| `EXPO_PUBLIC_API_URL` değişti ama Gradle bundle görevini geçersiz kılmaz | Build 29 sn'de "başarılı" biter, APK **eski** adresi taşır | Bundle görev çıktıları + ara ürünler silinir |
| Metro transform önbelleği env değerini anahtarına almaz | Görev yeniden koşsa bile eski gömülü değer önbellekten döner | `os.tmpdir()/metro-cache` silinir |
| `localhost` / `/api` soneki eksik adres | Uygulama açılır, her istek 404 | Derleme öncesi biçim kontrolü, gürültülü hata |
| Adres biçimsel olarak geçerli ama o makine yok | Ölü IP de "geçerli IP"dir | Derleme öncesi `GET <kök>/health` yoklaması — **uyarı**, derlemeyi durdurmaz (derleyen Mac fabrika ağında olmayabilir) |

> Metro satırı **ölçüldü** (2026-08-01, `expo export:embed`, aynı bayraklar, yalnız
> env değişti): sıcak önbellek + yeni adres → bundle'da **ESKİ** adres çıktı (17,9 sn);
> önbellek silinip aynı komut → **yeni** adres (69,9 sn). "Hızlı biten build" tam da
> budur — hız iyi haber değil, önbellekten gelen bayat adrestir.

> **Doğrulama tuzağı:** release bundle **Hermes bytecode**'dur. Saf ASCII dizeler
> string tablosunda düz metin durur ve aranabilir; **Türkçe özel karakterli
> dizeler UTF-16 tablosuna gider ve grep BULMAZ**. Bir şeyi bundle'da ararken
> hep ASCII bir dizeyi (URL, kod, sabit) kullan — Türkçe metin arayıp "yok"
> sonucuna varmak yanlış alarmdır. Ayrıca dizeler **uç uca paketlenir**
> (sonlandırıcı bayt yok), bu yüzden "aradığım dizeden sonra harf gelmesin"
> gibi bir sondaj gerçek eşleşmeyi de eler.

## Klasör Yapısı

```
src/
  screens/          # Ekran bileşenleri (modüle göre alt klasör)
  components/       # Paylaşımlı UI bileşenleri
  navigation/       # React Navigation tanımları
  services/         # API çağrıları (axios)
  store/            # Zustand state
  hooks/            # Custom hooks
  types/            # TypeScript tipleri (backend types ile uyumlu)
  utils/            # Yardımcı fonksiyonlar
  constants/        # API_URL, renkler, enum eşlemeleri
```

## Donanım Katmanı

### Kamera (Barkod Okuma)
- **Kütüphane:** `expo-camera` v17 (CameraView + `onBarcodeScanned`) — `expo-barcode-scanner` deprecated, kullanma
- **Kullanım:** Refakat Kartı, top barkodu, iş emri QR okuma
- **Simülasyon:** Geliştirme modunda elle barkod girişi ile aynı sonuç

### Bluetooth (BLE)
- **Kütüphane:** `react-native-ble-plx`
- **Kullanım:** Bluetooth barkod okuyucu veya etiket yazıcı bağlantısı
- **NOT:** Expo Go desteklemez, `npx expo run:android` ile native build şart
- **HID Tarayıcılar:** Android'de sistem klavyesi olarak çalışır, ek kütüphane gerekmez
- **Simülasyon:** `src/services/bluetooth.service.ts` içinde mock mod

### Saha cihazları (HAL — metre/kantar/yazıcı)
- **Donanım = VERİ.** Cihazlar backend `PeripheralDevice`'ta (admin → Cihaz Kaydı): kind/connectionType/address + protokol (pollCommand/terminator/identifyPattern/decimals/scale/role) + per-cihaz `simulate`. Tablette device-local seçim YOK.
- **HAL** (`src/services/hal/`): `btClassic.transport` (BT-Classic/HC-06 oku/yaz) + `meter.codec`; `hooks/usePeripheralIO.buildIoFromPeripheral(row)` bir cihaz satırından transport+codec kurar.
- **Çözümleme (OTURUM-KAPSAMLI):** `hooks/useMachinePeripherals('METER'|'SCALE')` → **aktif çalışma oturumunun YERİNE** sabit cihazlar (`GET /peripherals/for-session`; makine-oturumu → makine donanımı, makinesiz SHIPPING istasyon-oturumu → istasyon donanımı; oturum yoksa BOŞ — fail-closed). Oturumlu ekranlar (KK1/KursunQc/Tambur/TartiPaket) `SessionGate` ile sarılıdır: yer onayı ("Sarım-2'desiniz, doğru mu?" / makine QR'ı) olmadan ekran açılmaz; `constants/stationScreens.ts` StationKind→ekran registry'sidir. **Odak invariantı:** yer onayı (ve otomatik oturum açma) yalnız ODAKTAKİ ekranda denenir — native-stack'te arka planda mount kalan gate'ler pasiftir; aksi hâlde iki gate dönüşümlü oturum kapma savaşına girer (~1sn ekran↔yer-onayı ping-pong'u, bkz. `SessionGate.tsx` başlık yorumu). Yazıcı da oturumdan çözülür (LabelPrinter — manuel BT yazıcı seçimi/`btPrinterStore` KALDIRILDI). `meterPeripheralFor(rows, foldType)` role ile (2/4-KAT) seçer, `primaryMeterFor(rows)`/`primaryScaleFor(rows)` tek-cihaz istasyonları için (role PRIMARY ?? rolesiz ?? ilk). Örnek: Tambur 2/4-kat metre (METER), KK1 metraj (METER), Sevkiyat çuval tartısı (SCALE — PaketlemeScreen "Tart", HC-06 BT-SPP istek-cevap). Damgalı uçlarda oturum düşmüşse backend `409 WORK_SESSION_REQUIRED` döner → api.ts interceptor'ı yerel oturumu düşürür, gate yeniden onay ister.
- **Simülasyon** cihazın `simulate` bayrağıyla (admin, seed'de METER cihazları için `true`) — gerçek I/O opt-in; donanım yoksa/cihaz yoksa NET HATA (sessiz sahte yok).
- **Sistem diyaloğu → kilit bastırması:** Uygulamanın KENDİ açtığı Android sistem diyalogları (BT izin/aç/PIN, yazdırma servisi, kamera izni) activity'yi pause edip AppState `'background'` yayar; idle kilidi bunu "operatör ayrıldı" sanıp anında kilitlemesin diye diyalog açabilen her native çağrı `withSystemDialog()` (`store/lockStore.ts`) ile sarılır. HTML yazdırma HER ZAMAN `services/printHtml.ts` üzerinden — `Print.printAsync`'i doğrudan çağırma.
- Tüm istasyonlar (Tambur, KK1) okuma için HAL'i kullanır; eski `hardware.service.ts` mock'u KALDIRILDI.
- **Kural:** Faz-1 simülasyon disiplini sürer ama **simülasyon artık per-cihaz veri bayrağıdır**, kodda gömülü "ASLA" değil.

## Allowed Packages

| Kategori | Paketler |
|---|---|
| Core | `expo`, `react-native`, `react`, `react-dom`, `typescript`, `react-native-web`, `react-native-worklets` |
| Expo runtime | `expo-constants`, `expo-status-bar`, `expo-screen-orientation`, `expo-build-properties`, `expo-haptics` |
| Navigation | `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`, `react-native-safe-area-context`, `react-native-screens` |
| UI | `react-native-paper`, `@expo/vector-icons`, `react-native-gesture-handler`, `react-native-reanimated` |
| Camera | `expo-camera` (CameraView + onBarcodeScanned) |
| Bluetooth | `react-native-ble-plx` (BLE), `react-native-bluetooth-classic` (BT-Classic/HC-06 SPP — HAL `btClassic.transport.ts` + BT yazıcı `btPrinter.service.ts`) |
| State | `zustand` |
| API | `axios`, `@tanstack/react-query` (+ `@tanstack/react-query-persist-client` + `query-async-storage-persister` — offline mutation kuyruğu) |
| Storage | `expo-secure-store`, `@react-native-async-storage/async-storage` |
| Print | `expo-print`, `expo-sharing` |
| List | `@shopify/flash-list`, `react-native-sortables` |
| SVG/QR | `react-native-svg`, `react-native-qrcode-svg` |
| Network | `@react-native-community/netinfo` |
| Input | `react-native-keyboard-controller` (KeyboardAwareScrollView) |
| UX | `react-native-toast-message` (modal için `react-native-modal` KALDIRILDI → `src/components/AppModal.tsx`: Portal+Reanimated, tüm modallar bunu kullanır) |
| Util | `dayjs` |

**Yeni paket eklemeden önce onay al.**

> ⚠️ Şu an hem `@expo/vector-icons` hem `react-native-vector-icons` kurulu. İkincisi muhtemelen redundant (Paper / Navigation'ın peer dep'i olarak gelmiş olabilir). Yeni icon kullanımı için `@expo/vector-icons` tercih et; doğrulandığında `react-native-vector-icons` kaldırılabilir.

## API Bağlantısı

```typescript
// src/constants/api.ts
export const API_URL = 'http://192.168.X.X:4000/api'; // Tablet ve sunucu aynı ağda
```

- Auth: JWT token → `expo-secure-store`'da sakla
- Her istek `Authorization: Bearer <token>` header'ı taşır
- `@tanstack/react-query` cache + refetch yönetimi

## Ekran Önceliği (İmplementasyon Sırası)

1. **Auth** — Login (JWT)
2. **Station/KK1** — Barkod okut → iş başlat/bitir
3. **KursunQC** — Hata metraj girişi (sayısal klavye)
4. **Tambur** — Kesim kararı, fire/A1 işaretleme
5. **Fason** — Sevk oluştur / mal kabul
6. **Dashboard** — İş emri özet görünümü

> NOT: Tartı/Paket ve Sevkiyat mobil ekranları CANLI — `src/screens/Modules/TartiPaket/` ("Sevkiyat" etiketi) ve `Sevkiyat/` ("Sevk Çıkışı" etiketi); izinler `mobile:tarti-paket` / `mobile:sevkiyat`; backend `/api/shipping`. (Ekran key ≠ görünen etiket.)

## UI/UX Kuralları (Tablet + Telefon)

- Minimum dokunma hedefi: **56dp** (parmak kolay basabilmeli)
- Barkod okuma ekranı: kamera preview tam ekran, minimal UI overlay
- Sayısal veri girişi: büyük tuş takımı (`react-native-paper` `TextInput` + numpad)
- Hata mesajları Türkçe
- `react-native-paper` tema: koyu header, açık içerik (fabrika ortamı için yüksek kontrast)
- **Responsive layout** — tablet yatayda iki sütun / split view, telefon dikeyde tek sütun. Yön kilidi yok; her ekran her iki yönde de çalışmalı.
- Font boyutu minimum 16sp, kritik bilgiler 20sp+

### Dokunma / Tıklama bileşenleri

- **Tıklanabilir her alan** için **`react-native-paper`** bileşenleri kullan. Sıfırdan yazma.
  - Dokunma alanı + ripple: **`TouchableRipple`** (kart, hücre, özel kapsayıcılar). Pressable/TouchableOpacity yerine bunu seç.
  - Buton: **`Button`** · Icon-only: **`IconButton`** · Appbar aksiyonu: **`Appbar.Action`** / `Appbar.BackAction`
  - Liste satırı: **`List.Item`** · Pasif kart: **`Surface`** (tıklanmıyorsa)
- **`Card` + `onPress` KULLANMA** — iç `Card.Content` dokunmayı yutuyor; tüm alana tıklamak çalışmıyor. `Card`'ı yalnızca pasif görünüm olarak kullan; tıklanabilir olacaksa **`TouchableRipple` ile sar**.
- Aynısı modal, picker ve grid hücreleri için de geçerli — operatör hücrenin neresine basarsa bassın seçim olmalı.

### Picker içi "yeni ekle" — `PickerModal.leadingAction` (2026-07-30)

Bir picker'dan seçenek eklenebiliyorsa (ör. KK1 "Desen Seç" → yeni desen) tetik **listenin ilk hücresindeki mor aksiyon kartıdır** (`leadingAction`: diğer kartlarla aynı geometri, `colors.action` zemin + beyaz yazı). Sıralama/aramadan bağımsız her zaman ilk sıradadır, basılınca picker **kapanmaz** — asıl form `quickAddSlot`'ta açılır. Mor bilinçli: marka indigo'su "seçili kart" vurgusu olduğu için aksiyon indigo olamaz. Listenin üstüne ayrı outlined buton koyma.

### Ayarlar = menü + alt sayfa (2026-07-30)

`SettingsScreen` bir **menüdür**: her başlık satırı (ikon + başlık + "şu an ne ayarlı" özeti + chevron) kendi ekranını push eder — `screens/Common/settings/` (ortak koyu tema + Appbar/scroll kabuğu: `settingsUi.tsx` → `SettingsPage`, `settingsStyles`). Yeni ayar bölümü eklerken içeriği ana ekrana açık halde GÖMME; alt sayfa yap, menüye satır ekle (`RootStackParamList` + `RootNavigator`).

### Donanım okuması = TEK DOKUNUŞ + taşan aksiyonlar ⋮'de (2026-07-30)

Kanonik örnek: çuval tartısı (`hooks/useSackWeigh.ts` + `TartiPaket/PaketlemeScreen`).

- **Ölçüm aleti varsa okuma tek dokunuş olmalı:** ⚖ → kantardan oku → **doğrudan kaydet** → kartta göster. Araya input modal'ı KOYMA; operatörün eli maldadır. Yanlışsa tekrar basar (idempotent üzerine yazar).
- **Fail-closed:** cihaz yok / bond edilemedi / okunamadı / değer ≤ 0 → NET Türkçe toast + mutasyon **HİÇ ÇAĞRILMAZ**. Sessiz sahte değer yok. (Test: `hooks/useSackWeigh.test.tsx` 1/2a/2b/2c.)
- **`simulate` cihazda YAZMA (2026-07-30):** uydurulmuş değer canlı veriye GİRMEZ. İstemci sahte değeri üretip backend'e `source:'SIMULATED'` olarak **beyan eder**; backend `shipping.simulatedWeightEnabled` kapalıyken (varsayılan) **400** döner ve Türkçe mesajı gösterilir. Toast'ta açık "SİMÜLASYON" ibaresi yine şart. Demo/eğitim kurulumu bayrağı açar. Gerekçe: çuval kg'si sevk irsaliyesine ve çeki listesine BASILIR (müşteri/gümrük belgesi) — metraj gibi iç ölçümlerden farklı sınıf, bu yüzden METER cihazları hâlâ simüle doğar ama SCALE doğmaz. Elle giriş (`source:'MANUAL'`) korumadan MUAF: kantarsız/arızalı durumun kaçış yoludur. (Test: `hooks/useSackWeigh.test.tsx` 5/6/7 + backend `scripts/test_sack_weigh_source.ts`.)
- **Eşzamanlılık:** BT tek soket → `busyRef` ile ikinci dokunuş **sessizce yok sayılır** (kuyruğa alınmaz: hangi ağırlık hangi nesneye gitti karışır). Spinner yalnız işlem gören satırda (`weighingSackId`).
- **Manuel/ikincil yol ⋮ menüsünde:** kartta yalnız sık kullanılan kalır; "elle gir / etiket bas / not ekle / sil" → `SackActionsSheet` (AppModal `position="bottom"`, satır ≥56dp). Yıkıcı aksiyon menüye taşınsa da **onay diyaloğu korunur**.
- **Modal içinde sayı girişi:** `NumpadInput` + **`useNativeKeyboard`**. Büyük özel numpad bir `NumpadHost` render edilmesini ister (KK1/Tambur kendi kolonlarında yapıyor) — modalda host yoktur, tuşlar görünmez kalır. `useNativeKeyboard` sistem decimal-pad'ini açar VE virgül→nokta normalizasyonunu korur ("40,5" → 40.5).
- Çuval mutasyonları (tartı dahil) **online-only** — offline kuyruğa (`offline/mutations.ts`) girmez.

### Manuel/Otomatik metraj tercihi CİHAZDA kalıcı (2026-08-02)

Metraj kaynağı seçimi (elle gir ↔ makineden oku) artık ekran state'i değil **cihaz
ayarıdır** — `deviceSettingsStore.kk1ManualEntry` (KK1 "Manuel Giriş" anahtarı) ve
`deviceSettingsStore.tamburCutMode` (Tambur). Saha gerekçesi: metre makinesi arızalı
bir istasyonda operatör **her top girişinde** anahtarı yeniden açıyordu; seçim aslında
tek bir gerçeği ("bu istasyonda makine çalışıyor mu") yansıtıyor ve vardiya boyunca
değişmiyor. Oturum değil CİHAZ ömürlü: operatör değişse de kalır (barkod manuel giriş
bayrağıyla aynı gerekçe).

- **Tambur'un iki geçişi (ana kesim + "Top Kesme" modalı) TEK tercihi paylaşır** —
  `recutMode = cutMode`. İkisi aynı metre makinesini kullanır; ayrı hafıza tutmak
  "ana kesimde Otomatik'e geçtim ama modal Manuel açıldı" şaşkınlığı üretirdi.
  Yan etki bilinçli: modalda modu değiştirmek ana kesimi de değiştirir.
- Varsayılanlar korundu (KK1 manuel KAPALI, Tambur MANUEL) ve diskteki bozuk değer
  güvenli varsayılana düşer. Setter önce state'i, sonra diski yazar — anahtar takılmaz.
- Ayarlar ekranına satır **eklenmedi** (bilinçli): tercih ekrandaki anahtarla değişir.
- Test: `store/deviceSettingsStore.test.ts` (kalıcılığı bozan sondayla kırmızı verdiği
  doğrulandı). **Sahaya çıkması için yeni APK derlemesi gerekir.**

## Liste Sayfalama — DEFAULT: cursor + infinite scroll

> **Kural:** Bir listeyi sayfalandırman istendiğinde **varsayılan olarak cursor (keyset) + infinite scroll** kullan — offset/`page`+`pageSize` modeli DEĞİL. Offset modeli yalnızca açıkça istenirse veya tablonun hacmi kalıcı olarak küçük kalacaksa (örn. master-data, kalite dereceleri) seçilir. Yüksek hacimli tablolar (`Roll`, `RollMovement`, `RollOperation`, hareket/log geçmişleri) **her zaman** cursor.

**Neden:** Offset, üretim büyüdükçe iki şekilde bozulur — (1) backend `MAX_OFFSET=10000` guard'ı derin sayfada **HTTP 400** atar (pageSize 20 → sayfa 501 sonrası erişilemez), (2) her sayfa + her yenilemede `COUNT(*)` yeniden hesaplanır. Cursor'da ikisi de yok: sabit hız, offset taraması yok, toplam yalnız ilk sayfada `withTotal` ile yaklaşık gelir.

**Backend hazır:** `GET /rolls?mode=cursor&limit=N&cursor=...&withTotal=true` (bkz. `findAllRolls` cursor dalı, `utils/cursor.ts`). Servis tarafında `rollService.getAllCursor(...)` mevcut; benzer endpoint'ler için aynı `mode=cursor` sözleşmesini izle.

**Mobil pattern** (kanonik örnek: `Tambur` "Üretilen Toplar", `KK1` "Tüm Kayıtlar"):

```ts
const q = useInfiniteQuery({
  queryKey: ['rolls', 'kk1', 'history'],
  queryFn: ({ pageParam }) =>
    rollService.getAllCursor({ limit: 20, cursor: pageParam,
      filters: { entrySource: 'SUPPLIER_RECEIPT' }, withTotal: !pageParam }),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.pagination.hasMore ? last.pagination.nextCursor : undefined,
  enabled: visible,
  placeholderData: keepPreviousData,
});
const rolls = q.data?.pages.flatMap((p) => p.data) ?? [];
const total = q.data?.pages[0]?.pagination.totalEstimate ?? 0; // yaklaşık
```

- Liste: `FlashList` + `onEndReached` → `if (q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()`, `onEndReachedThreshold={0.6}`, footer'da `ActivityIndicator` (`q.isFetchingNextPage`).
- Modal listesi için hazır kabuk: **`RemoteListSheet`** (header + loading/error/empty + infinite scroll prop'ları). Yeni geçmiş/liste modalı önce bunu kullanmayı dener.
- "Önceki / Sonraki" pager + `Sayfa X/Y` **kullanma** — sonsuz akış var; toplam sayıyı başlıkta yaklaşık göster.

## Ortak Kurallar

- UUID primary key, `createdAt`/`updatedAt` her modelde
- Soft delete: `isActive: false` veya `RollStatus.CANCELLED` (`SCRAP` = gerçek fire kararı, arşivleme değil)
- Her CUD → backend zaten `AuditService.log()` çağırır; mobil ekstra log yazmaz
- Validation hataları Türkçe
- `types/` klasöründe backend modelleriyle uyumlu TypeScript tipleri tanımla
