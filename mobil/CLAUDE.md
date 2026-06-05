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

### COM Port / Kantar
- **Faz 1'de tamamen simüle edilir.** Gerçek bağlantı ASLA implemente edilmez.
- Simülasyon: `src/services/hardware.service.ts` → rastgele ağırlık üretir

## Allowed Packages

| Kategori | Paketler |
|---|---|
| Core | `expo`, `react-native`, `react`, `react-dom`, `typescript`, `react-native-web`, `react-native-worklets` |
| Expo runtime | `expo-constants`, `expo-status-bar`, `expo-screen-orientation`, `expo-build-properties`, `expo-haptics` |
| Navigation | `@react-navigation/native`, `@react-navigation/native-stack`, `@react-navigation/bottom-tabs`, `react-native-safe-area-context`, `react-native-screens` |
| UI | `react-native-paper`, `@expo/vector-icons`, `react-native-gesture-handler`, `react-native-reanimated` |
| Camera | `expo-camera` (CameraView + onBarcodeScanned) |
| Bluetooth | `react-native-ble-plx` |
| State | `zustand` |
| API | `axios`, `@tanstack/react-query` |
| Storage | `expo-secure-store`, `@react-native-async-storage/async-storage` |
| Print | `expo-print`, `expo-sharing` |
| List | `@shopify/flash-list` |
| SVG/QR | `react-native-svg`, `react-native-qrcode-svg` |
| Network | `@react-native-community/netinfo` |
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

> NOT: Tartı / paket / sevkiyat mobil ekranları yeni sevkiyat modülü tasarlanınca eklenecek — backend tarafı şu an yok.

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

## Ortak Kurallar

- UUID primary key, `createdAt`/`updatedAt` her modelde
- Soft delete: `isActive: false` veya `RollStatus.SCRAP`
- Her CUD → backend zaten `AuditService.log()` çağırır; mobil ekstra log yazmaz
- Validation hataları Türkçe
- `types/` klasöründe backend modelleriyle uyumlu TypeScript tipleri tanımla
