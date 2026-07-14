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
