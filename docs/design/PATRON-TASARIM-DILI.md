# Patron uygulaması — tasarım dili ("TeksERP Yönetim")

> Kaynak: patron uygulaması v2 planı (§4, kararlar K2/K3/K4) ve R3 tasarım dili raporu §C (2026-10-22). Kodun tek kaynağı `patron/uygulama/src/ui/tokens.ts`; bu belge onun okunur hâlidir. Bekçi: `patron/uygulama/__tests__/tokens.test.ts` — §1 ham hex yalnız `tokens.ts`te · §2 ışık/koyu setleri aynı şekil · §3 okunurluk eşikleri · §4 bu belgedeki her hex `tokens.ts`te.

## 0 · Ana fikir ve kural

- **Apple kabuğu + bizim içimiz:** büyük başlık → küçülen başlık, eş merkezli köşe, opak içerik; indigo marka, alan renk kimliği, büyük sayı, kartta 4 px sol şerit.
- **Cam yalnız gezinme/kontrol katmanında**; kart, rozet ve sayı OPAKTIR (okunurluk cama emanet edilmez). Bugün sekme zemini opak `surface` + 1 px `separator`; `expo-glass-effect` EKLENMEDİ.
- **Ham hex YAZMA; token'dan oku.** Ekran/bileşen `useTokens()` ile renk alır; yeni renk `tokens.ts`e ve bu belgeye aynı commit'te eklenir.
- **Renk ayırt etmek içindir:** alan rengi yalnız "hangi iş" der; iyi/kötü yalnız durum setiyle ve her zaman ikon + metinle birlikte söylenir.

## 1 · Renk token'ları

### 1.1 Nötrler ve marka

| Token | Açık | Koyu | Kullanım |
|---|---|---|---|
| `bg` | `#F2F4F7` | `#0B0D12` | gruplu zemin |
| `surface` | `#FFFFFF` | `#1C1F26` | kart, sekme çubuğu, ray |
| `surfaceAlt` | `#F8FAFC` | `#252933` | iç blok, seçili satır, iskelet |
| `separator` | `#E2E8F0` | `#2E3440` | 1 px çizgi |
| `text` | `#0F172A` | `#F1F5F9` | birincil metin |
| `textSecondary` | `#475569` | `#CBD5E1` | ikincil metin, etiket |
| `textMuted` | `#5B6576` | `#94A3B8` | soluk metin (slate-500 `bg` üstünde 4.5 altı → kullanılmaz) |
| `navy` | `#161C2B` | `#161C2B` | marka koyu: ikon zemini, giriş, yönetici kartı |
| `tint` | `#4F46E5` | `#818CF8` | düğme, bağlantı, seçili öğe, odak |
| `tintContainer` | `#E0E7FF` | `#2A2A5C` | seçili çip, ikincil düğme |
| `onTint` | `#FFFFFF` | `#0B0D12` | tint/dolgu üstündeki metin |
| `gold` | `#FDE68A` | `#FDE68A` | yönetici rozeti metni |
| `paper` | `#FFFFFF` | `#FFFFFF` | karekod zemini (her temada beyaz) |

#### Lacivert yüzey üstü (`onNavy.*`; zemin her temada `navy` → değerler iki temada aynı)

Giriş/davet kabuğu (`AuthShell`) ve Profil kahraman kartı. Koyu temanın `dark.*` setini doğrudan okumak YASAK; bu set kullanılır.

| Token | Değer | Kullanım |
|---|---|---|
| `onNavy.text` | `#F1F5F9` | başlık, ad |
| `onNavy.textSecondary` | `#CBD5E1` | e-posta, slogan |
| `onNavy.textMuted` | `#94A3B8` | dipnot, güvenlik satırı |
| `onNavy.surface` | `#252933` | lacivert üstü iç kutu (marka işareti) |
| `onNavy.separator` | `#2E3440` | ince çizgi, kart kenarı (koyu tema) |
| `onNavy.chip` | `#2A2A5C` | ikincil çip/düğme zemini (çalışan rozeti, "Değiştir") |
| `onNavy.tint` | `#818CF8` | çip üstü vurgu metni/ikonu |

### 1.2 Alan renkleri (`domain.<alan>.fg` · `.chip`)

| Alan | Açık metin/ikon | Açık çip | Koyu metin/ikon | Koyu çip |
|---|---|---|---|---|
| Üretim `uretim` | `#7C3AED` | `#EDE9FE` | `#A78BFA` | `#2E1065` |
| Siparişler `siparisler` | `#0F766E` | `#CCFBF1` | `#2DD4BF` | `#042F2E` |
| Sevkiyat `sevkiyat` | `#C2410C` | `#FFEDD5` | `#FB923C` | `#431407` |
| Finans `finans` | `#0369A1` | `#E0F2FE` | `#38BDF8` | `#082F49` |
| Cariler `cariler` | `#BE185D` | `#FCE7F3` | `#F472B6` | `#500724` |
| Stok `stok` | `#57534E` | `#E7E5E4` | `#A8A29E` | `#292524` |
| Fason `fason` | `#A21CAF` | `#FAE8FF` | `#E879F9` | `#4A044E` |
| Raporlar `raporlar` | `#475569` | `#E2E8F0` | `#94A3B8` | `#1E293B` |
| Gelen kutusu `gelenKutusu` | `#4F46E5` | `#E0E7FF` | `#818CF8` | `#2A2A5C` |
| Genel `genel` (Pano, Hesap, Profil) | `#475569` | `#E2E8F0` | `#94A3B8` | `#1E293B` |

### 1.2b İstasyon paleti (`station.<tür>.fg` · `.chip`)

Üretim akışı şeridi ve istasyon dağılımı çubukları alan rengini DOĞRUDAN okumaz; istasyon türü paletten gelir (bugün iç = üretim, dış = fason tonu; ayrı ayarlanabilir).

| Tür | Açık metin/çubuk | Açık çip | Koyu metin/çubuk | Koyu çip |
|---|---|---|---|---|
| İç istasyon `ic` | `#7C3AED` | `#EDE9FE` | `#A78BFA` | `#2E1065` |
| Dış istasyon (fason) `dis` | `#A21CAF` | `#FAE8FF` | `#E879F9` | `#4A044E` |

### 1.3 Durum seti (`status.<ton>`: dolgu · metin · zemin · ikon)

| Ton | Açık dolgu | Açık metin | Açık zemin | Koyu dolgu | Koyu metin | Koyu zemin | Ionicons |
|---|---|---|---|---|---|---|---|
| `iyi` | `#15803D` | `#14532D` | `#DCFCE7` | `#4ADE80` | `#BBF7D0` | `#052E16` | `checkmark-circle` |
| `uyari` | `#B45309` | `#78350F` | `#FEF3C7` | `#FBBF24` | `#FDE68A` | `#451A03` | `warning` |
| `kritik` | `#B91C1C` | `#7F1D1D` | `#FEE2E2` | `#F87171` | `#FECACA` | `#450A0A` | `alert-circle` |
| `bilgi` | `#475569` | `#1E293B` | `#F1F5F9` | `#94A3B8` | `#E2E8F0` | `#1E293B` | `information-circle` |

Eğilim: yön ok şekliyle (`arrow-up/down/remove`) + işaretli metin ("+%12"); renk ANLAMDAN gelir (gecikme artışı kritik, tahsilat artışı iyi).

### 1.4 Rol rozeti

| Rol | Ölçüt | Açık | Koyu |
|---|---|---|---|
| Yönetici | `bulut:hesap:yonet` | zemin `#161C2B` · metin `#FDE68A` | aynı |
| Çalışan | diğer | zemin `#E0E7FF` · metin `#4F46E5` | zemin `#2A2A5C` · metin `#818CF8` |

Rozet yalnız gösterir; karar sunucudadır. Görünen ad TEK kaynak `ROLE_LABEL` (`src/ui/RoleBadge.tsx`; "Yönetici" · "Çalışan" — patron ve çalışan aynı sözü okur); profil kartı ve hesap satırı oradan okur. Token anahtarı `role.ekip` iç addır, ekranda görünmez.

## 2 · Tipografi (`typography`)

Sistem fontu (iOS SF Pro, Android Roboto, web system-ui); `allowFontScaling` açık; başlıkta `maxFontSizeMultiplier` 1.4, gövdede 2 (`FONT_SCALE`). Sayılarda `fontVariant: ["tabular-nums"]` (`tabularNums`).

| Token | Boyut/satır | Ağırlık | Kullanım |
|---|---|---|---|
| `display` | 40/44 | 700 + tabular | Pano kahraman sayısı |
| `kpi` | 30/34 | 700 + tabular | KPI değeri (kartta 34/38; uzun değerde `valueSize()` 28 → 24 → 20 küçültür — web'de `adjustsFontSizeToFit` yok) |
| `largeTitle` | 34/41 | 700 | ekran büyük başlığı |
| `title2` | 22/28 | 700 | sheet/ayrıntı başlığı, `Stat` değeri |
| `title3` | 20/25 | 600 | bölüm başlığı, `Title` |
| `headline` | 17/22 | 600 | satır başlığı, küçük başlık |
| `body` | 17/22 | 400 | gövde |
| `callout` | 16/21 | 400 | düğme (600), form |
| `subhead` | 15/20 | 400 | satır alt metni, `Muted` |
| `footnote` | 13/18 | 400 | rozet, eşitleme damgası; KPI etiketi (600) ve yan değerleri |
| `caption` | 12/16 | 500 | küçük etiket (BÜYÜK HARF değil) |

## 3 · Boşluk · yarıçap · gölge · ölçüler

- **Boşluk `space`:** `xs 4 · s 8 · m 12 · l 16 · ml 20 · xl 24 · xxl 32`; ekran kenarı 16 (telefon) / 24 (geniş); kartlar arası 12.
- **Yarıçap `radius` (eş merkezli, iç = dış − iç boşluk):** `sheet 28 · card 20 · cardInner 12 · control 12 · button 14 · chip 999`.
- **Gölge:** açık modda `cardShadow` = `0 1px 2px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.05)`, `floatShadow` = `0 8px 24px rgba(15,23,42,0.12)` (`boxShadow`); koyu modda gölge yok, yüzey tonu farkı.
- **Ölçüler:** `TOUCH 48` (en küçük dokunma hedefi) · `STRIPE 4` (kart şeridi) · `WIDE_MIN 768` (ray + iki sütun eşiği) · `READABLE_MAX 960` (tek sütun) · `CONTENT_MAX 1120` (iki sütun) · `BAR_HEIGHT 44` · `RAIL_WIDTH 248`.

## 4 · Hareket

`src/ui/motion.ts` = `mobil/src/theme/motion.ts` KOPYASI (ayna bekçisi yok; değişirse elle eşitlenir): süre `instant 120 · fast 180 · base 260 · slow 360 · slower 480`; yaylar `press` (basış), `gentle` (kart girişi), `bouncy` (yalnız başarı); stagger 45 ms. `useReducedMotion()` açıkken yay yerine 120 ms geçiş, nabız/iskelet animasyonu yok. Büyük başlık kaydırmaya bağlı küçülür (UI iş parçacığı, reanimated).

## 5 · Tema

`ThemeProvider` (`src/ui/theme-context.tsx`) sistemi (`useColorScheme`) izler; tercih düz depoda `patron.tema` = `sistem | acik | koyu` (`useThemePref()`; Profil'de "Sistem · Açık · Koyu" — E4). Sağlayıcısız (testler) açık tema. `app.json` `userInterfaceStyle: "automatic"`. Bütün ekranlar `useTokens()` okur; eski `src/ui/theme.ts` uyum katmanı kaldırıldı (W2, 1.1.0).

## 6 · Gezinme

- **Telefon:** expo-router `Tabs` (kararlı; `unstable-native-tabs` YASAK): **Pano · Üretim · Siparişler · Finans · Diğer**. Zemin opak `surface` + 1 px `separator`; seçili sekme alan rengini taşır (Pano/Diğer `tint`). İzinsiz sekme `href: null` (çizilmez); Pano ve Diğer her hesapta. Yollar SABİT: `/pano /uretim /siparisler /finans` (+ `/diger`) — bildirim rotaları, `safeRoute`, `public/bildirim-sw.js` bunlara bağlı.
- **Diğer:** gruplu liste — İş (Cariler · Sevkiyat · Stok · Raporlar) · Eylem (Gelen kutusu) · Hesap (Bildirimler · Hesaplar · Profil); izinsiz satır/grup çizilmez; testID `menu-<modül>`.
- **Geniş (≥ 768):** sekme çubuğu gizli; solda ray (`SideNav`, alan ikon çipli, `menu-<modül>`), sağda içerik yığını.
- **Yapı:** `app/(app)/_layout.tsx` oturum kapısı + `Stack`; `app/(app)/(tabs)/` sekmeler (Siparişler kendi yığınıyla); diğer bölümler yığında sekmelerin üstüne açılır.

## 7 · Bileşen API'leri

Temel kit (`src/ui/kit.tsx`; adlar ve testID'ler sözleşme):

| Bileşen | Props | Not |
|---|---|---|
| `Card` | `children, onPress?, testID?, domain?, style?, accessibilityLabel?` | opak, r20, 4 px sol alan şeridi (verilmezse `genel`) |
| `Title` / `Body` / `Muted` | `children` (`Muted`: `testID?`) | title3 / body / subhead |
| `Button` | `label, onPress, tone? (primary·secondary·plain·danger), disabled?, busy?, testID?, icon?, accessibilityLabel?` | min 48, r14 |
| `ConfirmButton` | `label, question, onConfirm, disabled?, busy?, testID?` | iki adım; onay `${testID}-evet` |
| `Field` | `TextInputProps & { label, hint?, error? }` | 52 yükseklik, r12 |
| `Banner` | `tone (warn·off·error), text, testID?, icon?` | durum zemini + ikon, `role=alert` |
| `Badge` | `status` | `StatusBadge value` sarmalayıcısı |
| `Stat` | `label, value` | tabular |
| `Loading` | — | tint dönen gösterge |
| `Tabs` | `items, value, onChange` | `SegmentedControl` + `sekme-<key>` |
| `Row` | `children` | yatay, sarmalı, 8 aralık |

Yeni bileşenler:

| Bileşen | Dosya | Props |
|---|---|---|
| `KpiCard` · `KpiGrid` | `KpiCard.tsx` | `label, value, unit?, caption?, domain, icon?, trend? {text, direction up·down·flat, tone}, status? {kind, label} (rozet), lines? [{label, value, tone?}], lineLayout? row·stack, spark?, onPress? (chevron), testID?` — yan değerler fabrikanın verdiği değerlerdir, karşılaştırma HESAPLANMAZ; tek erişilebilirlik etiketi `kpiAccessibilityLabel()` (etiket: değer birim, eğilim, durum, açıklama, yan değerler); `KpiGrid {children, testID?}` telefonda 2'li, genişte 4'lü |
| `HeroSummary` | `HeroSummary.tsx` | `title, value, unit?, caption?, domain?, icon?, minis? [{label, value}] (≤3), testID?` |
| `SectionHeader` | `SectionHeader.tsx` | `title, count? (sayı ya da "3/8"), icon? (alan ikon çipi, renk `domain`), actionLabel? ("Tümü"), onAction?, domain?, testID?` (`${testID}-tumu`) |
| `ListRow` / `ListGroup` | `ListRow.tsx` | `title, subtitle?, lines?, value?, valueTone?, icon?, domain?, accessory?, onPress?, locked?, testID?, accessibilityLabel?` — `lines` verilirse ya da değer + rozet birlikteyse Posta düzeni (rozet/değer başlık satırında, alt satırlar tam genişlik, kırpılmaz) · `ListGroup {children, testID?, iconSize? (36 = LIST_ICON; ikonsuz satır 0)}` — ayraç metin hizasından başlar: `16 + iconSize + 12` |
| `StatusBadge` | `StatusBadge.tsx` | `{value}` (sözlükten) ya da `{kind, label}`; `size? sm·md`, `testID?` |
| `SegmentedControl` | `SegmentedControl.tsx` | `items, value, onChange, testIDPrefix? ("segment-"), accessibilityLabel?` — ≤4 kayan gösterge, 5+ kaydırılan çip |
| `FilterChip` | `FilterChip.tsx` | `label, value, onPress, selected?, testID?` — "Durum: Tümü"; dokununca çağıran doğrudan sheet açar |
| `Empty` · `LoadingSkeleton` · `ErrorState` | `StateViews.tsx` | `{text, domain?, icon?, actionLabel?, onAction?}` · `{variant kpi·list, rows?}` · `{text, onRetry?}` |
| `OfflineBand` · `ReadOnlyBand` · `SyncLateBand` | `StateViews.tsx` | `{text, testID?}` — varsayılan `bant-cevrimdisi` · `bant-salt-okunur` · `bant-gecikme` |
| `SyncIndicator` | `SyncIndicator.tsx` | `last, offline?, onPress?, testID? ("esitleme-gostergesi")`; saf `syncState()`, `syncText()` |
| `IconChip` | `IconChip.tsx` | `domain, icon?, size? (28)` |
| `LargeHeader` · `LargeTitle` · `useHeaderScroll` | `LargeHeader.tsx` | `Screen` içinde; 34 → 17 pt |
| `Screen` | `Frame.tsx` | `title, module?, children, back?, onRefresh?, refreshing?, headerRight?, subtitle?` |
| `SideNav` · `FacilityName` · `useWide` | `Frame.tsx` | ray, tesis adı (`tesis-secici`), ≥768 |
| `Sparkline` · `BarRow` · `AgingBar` · `Donut` | `charts/*.tsx` | yalnız `react-native-svg`; saf yardımcılar `sparkPoints`, `barRatio`, `agingWidths`, `donutArcs` |
| `haptic(kind)` | `haptics.ts` | `selection·light·success·warning·error`; Android yalnız `performAndroidHapticsAsync`, web no-op |
| `useTokens` · `useThemePref` · `useReducedMotion` · `makeStyles` | `theme-context.tsx` | — |

Etiket sözlüğü: `src/lib/labels/` — `STATUS_DICT` (gelen kutusu, rapor, hesap, bildirim durumları → Türkçe + ton), `statusEntry()`, `lookup()`; bilinmeyen değer ham döner. Alan sözlükleri (`uretim.ts`, `siparis.ts`, …) E dilimlerinde eklenir.

## 8 · Ekran düzenleri ("10 saniye")

- **Pano:** tesis adı + rol rozeti + `SyncIndicator`; 4 KPI (bugün sevk, açık sipariş, vadesi yaklaşan, üretim kuyruğu) büyük sayı + eğilim; "Dikkat" şeridi (yedek alınamadı, gecikmiş sipariş, çek vadesi 7 gün); alan kartları.
- **Üretim:** dönem segmenti; 3 KPI; istasyon dağılımı `BarRow`; iş emri `ListRow`.
- **Siparişler:** özet şeridi (açık · gecikmiş · bu hafta · tamam) = süzgeç çipleri; satır cari + no / açık metre + termin rozeti.
- **Finans:** alacak/borç/net hero; `AgingBar`; Kasa · Çek · Fatura · Tahsilat segmenti (izinliler).
- **Cariler:** arama + "Rol: Tümü"; satır ad + rol / bakiye.
- **Raporlar:** kart ızgarası + durum rozeti. Rapor formunda kesit (`asOf`) serbest metin değil: "Bugün · Dün · Ay sonu (geçen ayın son günü) · Özel" segmenti, seçilen gün altında yazılı (+ Özel'de GG.AA.YYYY); istemci yalnız fabrika GÜNÜNÜ seçer, giden an o günün son anıdır, hesap fabrikada. **Gelen kutusu:** segment Bekleyen · İşlenen · Reddedilen, yaş, 24 sa uyarı.
- **Hesaplar:** özet sayaçları + rol/durum rozeti. **Profil:** navy kahraman kart + tema seçimi.

## 9 · Erişilebilirlik

Metin ≥ 4.5:1, büyük sayı/ikon ≥ 3:1 (bekçi §3 ölçer); durum asla yalnız renk (ikon + metin); AX boyutlarında KPI tek sütun; dokunma ≥ 44 pt (`TOUCH = 48`, çiplerde `hitSlop`); her ikon düğmede `accessibilityLabel`; KPI tek etiket; hareket azaltmaya uyulur.

## 10 · Paketler (K4)

| Paket | Sürüm | Neden |
|---|---|---|
| `react-native-reanimated` | ~4.1.1 (kurulu 4.1.7) | büyük başlık, segment göstergesi, iskelet/nabız; jest'te resmî mock |
| `react-native-worklets` | 0.5.1 | reanimated 4 eşi |
| `expo-haptics` | ~15.0.8 | hafif dokunsal geri bildirim; VIBRATE `blockedPermissions`ta kalır |
| `@expo/vector-icons` | ^15.0.3 (kurulu 15.1.1) | Ionicons; önceden `expo` ile geçişli geliyordu, artık beyanlı (jest'te mock) |

EKLENMEDİ: `expo-glass-effect` (opsiyonel; sekme zemini opak kararıyla gereksiz), victory-native, @gorhom/bottom-sheet, expo-symbols, expo-blur, sqlite.
