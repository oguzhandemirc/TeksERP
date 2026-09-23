# Kütüphane envanteri — katman × ihtiyaç

[`KUTUPHANELER.md`](KUTUPHANELER.md)'nin §2'si; 2026-09-13'te oradan **bölünerek** geldi. Ayrım çizgisi günün diğer bölmeleriyle aynı: **kural kalır, ENVANTER ayrılır.** Bu tablo her yeni bağımlılıkta bir satır alır; `KUTUPHANELER.md`deki kurallar ([KU-01]…[KU-25]) almaz.

⚠️ **Bölüm numarası KORUNDU** — `KUTUPHANELER.md §2` diye işaret eden çapalar (`mobil/CLAUDE.md`, `docs/RECETELER.md`, `test_dependency_contract.ts` §(c)) hedefini bulmalıdır.

Yeni paket eklerken: önce `KUTUPHANELER.md` §1 (tek kütüphane ilkesi) ve §3 (karar kaydı), sonra buraya bir satır. Bekçi `Teks-Erp/scripts/test_dependency_contract.ts` §(c) bu tablo ile `dependencies` farkını ölçer.

---

## 2 · Katman × ihtiyaç tablosu

Bu tablo **kayıtlı kararın kendisidir**: `package.json > dependencies` ile bu tablo arasındaki fark bekçi kırmızısıdır ([KU-08]). Backend'in izinli paket listesi bugüne kadar `Teks-Erp/CLAUDE.md` § Paketler'de yaşıyordu; **liste buraya taşındı**, CLAUDE.md yalnız buraya işaret eder (aynı cümle iki yerde yaşarsa biri bayatlar — `README.md` § Üç belge katmanı).

### 2.1 Backend (`Teks-Erp/`) — CommonJS, 19 dependency

| İhtiyaç | Paket | Not / reddedilen |
|---|---|---|
| HTTP sunucu | `express` 5 (+ `cors` `helmet` `compression` `morgan`) | — |
| ORM · sürücü | `@prisma/client` · `prisma` (CLI) · `pg` · `@prisma/adapter-pg` | CLI `dependencies`te ZORUNLU ([KU-15]) · ⚠️ `pg@9`a Prisma sürümü uyumu beyan etmeden GEÇİLMEZ: sorgu yorumlayıcısı iç içe `select`in ilişki alt sorgularını aynı istemciye paralel yolluyor (pg@8 DeprecationWarning, pg@9'da kaldırılıyor) — ürün kodunda paralel `tx.*` YOK, ölçüldü 2026-09-23 (pg `Client.query` meşgul-istemci sondası, E2E backend SY1+SY2: 13 eşzamanlı çağrı, tek kaynak `device.service` findUnique, ürün çerçevesi 0) |
| Şema doğrulama | `zod` | route/controller'da; serviste değil (`BACKEND.md`) |
| Kimlik · API belgesi | `jsonwebtoken` · `bcryptjs` · `swagger-jsdoc` + `swagger-ui-express` | — |
| Barkod sembolü | `bwip-js` (7 dosya) | — |
| Font rasteri | `opentype.js` (2 dosya, DejaVu glif) | bwip ile ÇİFT DEĞİL: native yolun `asciiFold` kısıtını kaldıran Türkçe glif rasteri |
| mDNS ilanı | `bonjour-service` **1.4.4 SABİT** | [KU-11]; tembel `require` + try/catch, tek dosya `jobs/mdns-advertiser.job.ts` |
| Ortam | `dotenv` | — |
| UUID | `uuid` (2 dosya: v4 + `validate`) | `crypto.randomUUID` 20 dosyada — ikilik, §8 |
| Yapılandırılmış log | **PAKETSİZ** — `src/lib/logger.ts` (`hata`/`uyari`/`bilgi`/`satir`) | §9 (2026-09-07); `console` YALNIZ o dosyada, `no-console` açık |
| Araç (dev) | `tsx` `nodemon` `ts-node` `typescript` `eslint` `@typescript-eslint/*` `@types/*` | `@faker-js/faker` ölü (§7) |

Paket `deploy/` ve `scripts/`yi TAŞIMAZ (`docs/KOD-KURALLARI.md` § deploy) — bu yüzden çalışma zamanı CLI'ı `dependencies`te durur.

### 2.2 Electron (`Electron/`) — ESM main, `type: module`

| İhtiyaç | Paket | Not / reddedilen |
|---|---|---|
| Çatı · yönlendirme | `electron` 42 · `electron-vite` · `electron-builder` · `react` 19 + `react-dom` · `react-router-dom` 7 | `createHashRouter` |
| Durum | `@tanstack/react-query` (371) · `zustand` | — |
| Form · tablo | `react-hook-form` + `@hookform/resolvers` + `zod` · `@tanstack/react-table` (+`-virtual`) | — |
| UI primitifi · stil | `@radix-ui/*` (shadcn sarmalayıcıyla) · `cva` `clsx` `tailwind-merge` `cmdk` · `tailwindcss` 4 | sarmalanmayan primitif tutulmaz (§7) |
| Font | `@fontsource/plus-jakarta-sans` (CSS import) | `@fontsource/roboto` ölü |
| İkon | `lucide-react` (490) | ikinci ikon paketi EKLENMEZ |
| Toast | `sonner` (219) | Radix Toast KULLANILMAZ |
| Tema · animasyon · grafik | `next-themes` · `framer-motion` · `recharts` | — |
| Tarih · renk · takvim · QR · DnD | `date-fns` (17) · `react-colorful` · `react-day-picker` · `qrcode.react` · `@dnd-kit/*` | — |
| Excel | `exceljs` — **dinamik import** | SheetJS/xlsx KULLANILMAZ; `buffer` polyfill'i bu yolun (§7) |
| PDF | **YOK** — baskı HTML + sandbox'lı iframe | `@react-pdf/renderer` ölü; PDF paketi EKLENMEZ |
| HTTP | `axios` (14 dosya) | ham `fetch` **0** ölçüldü; tüm çağrılar `services/apiClient.ts` üstünden (`ELECTRON.md`) |
| Native | `serialport` · `node-hid` (+ `@electron/rebuild`) | `createRequire` tembel yükleme ([KU-16]) |
| Keşif | `bonjour-service` **1.4.4 SABİT** | `dependencies`te kalmak ZORUNDA |
| Kabuk hizmetleri | `electron-store` · `electron-log` · `electron-updater` | `electron-window-state` ölü |
| Test | `vitest` · `@testing-library/*` · `jsdom` · `vitest-axe` · `@playwright/test` | `@stryker-mutator/*` CI'da koşmuyor (`TEST-VE-DERLEME-SINIRLAR.md` §7) |

### 2.3 mobil (`mobil/`) — Expo SDK 54

| İhtiyaç | Paket | Not / reddedilen |
|---|---|---|
| Çatı | `expo` ~54 · `react-native` 0.81.5 · `react` 19.1.0 | sürümler SDK pinli ([KU-12]) |
| Navigasyon | `@react-navigation/native` + `native-stack` | `bottom-tabs` KULLANILMAZ (ölü, §7) |
| UI | `react-native-paper` (132) | `Card` + `onPress` yasak (`mobil/CLAUDE.md` § UI/UX) |
| İkon | `@expo/vector-icons` | `react-native-vector-icons` KULLANILMAZ (peer DEĞİL — [KU-23]) |
| Liste | `@shopify/flash-list` 2.0.2 (23 dosya) | `FlatList` 0 |
| Toast | `react-native-toast-message` (64) | Paper `Snackbar` KULLANILMAZ |
| Sunucu durumu | `@tanstack/react-query` + `-persist-client` + `query-async-storage-persister` | çevrimdışı kuyruk (`MOBIL.md`) |
| İstemci durumu | `zustand` | — |
| HTTP | `axios` (oturumlu) + ham `fetch` (kimliksiz) | ÇİFT ama BİLİNÇLİ AYRIM — [KU-05] |
| Tarih | `dayjs` (27) | tarih SEÇİCİ paketi EKLENMEZ (`docs/kurallar/filtre-liste.md:84`) |
| Depolama | `expo-secure-store` (sır) · `@react-native-async-storage/async-storage` | — |
| Kamera · okutma geri bildirimi | `expo-camera` 17 · `expo-haptics` + `expo-audio` | ekranlar `Haptics`i doğrudan değil `scanFeedback.signalScan` üzerinden çağırır |
| Bluetooth | `react-native-bluetooth-classic` (3 dosya, lazy `require`) | `react-native-ble-plx` canlı ama sahipsiz — §7 |
| Yazdırma / dosya | `expo-print` + `expo-intent-launcher` + `expo-file-system` | `expo-sharing` KULLANILMAZ (ölü) |
| Animasyon · klavye · sıralama | `react-native-reanimated` 4 + `react-native-worklets` · `react-native-keyboard-controller` · `react-native-sortables` | worklets reanimated 4 peer'ı |
| Ağ · güncelleme · test | `@react-native-community/netinfo` · `expo-updates` · `jest-expo` + `@testing-library/react-native` | — |
| Şema doğrulama | **YOK** (`zod` bağımlılığı yok, 386 dosyada 0 `z.object`) | §8 açık karar |
| Web hedefi | **YOK** | `react-native-web` + `react-dom` ölü (§7) |

- **[KU-04]** Bir paketi bu tabloya yazmadan `package.json`a ekleme; tablo ile `dependencies` arasındaki fark bir arızadır · zorlama: bekçi:`test_dependency_contract.ts §(c)` (üç projede `dependencies` ∖ tablo = ∅ + iki yönlü: tabloda olup `package.json`da olmayan da kırmızı; `devDependencies` gerekçeli muaf) · kanıt: `Teks-Erp/scripts/test_dependency_contract.ts:210-243`, körlük zeminleri `EN_AZ_TABLO_TOKEN` / `EN_AZ_DEPS` · devralınan: `KAYIT_BEKLEYEN` donmuş listesi (bayatlaması da ölçülüyor)
- **[KU-05]** mobilde oturum/interceptor taşıyan her çağrı `axios`, kimliksiz sonda ve manifest okuması ham `fetch`tir · zorlama: insan:iki HTTP yolu meşru, ayrımı "istek kimlik taşıyor mu" sorusu belirler ve AST bunu göremez · kanıt: `services/api.ts` axios; `services/discovery.service.ts:125`, `services/appUpdate.service.ts:267`, `offline/serverReachability.ts:90` fetch (ölçüm: 3 site) · devralınan: yok
- **[KU-06]** Electron'da ham `fetch` yazılmaz; HTTP `axios` + `services/apiClient.ts` üzerindendir · zorlama: insan:ham `fetch` yasağının KAPISI YOK — `api-path-prefix.test.ts` yol ÖNEKİNİ ölçer, HTTP istemcisinin kimliğini değil; kimliksiz sunucu yoklaması ([EL-10]) meşru istisnadır ve selector'dan ayrılamaz · kanıt: ölçüm 2026-09-05 — `Electron/src|electron|shared`ta `fetch(` 0; kural gerçeği DONDURUR, düzeltmez · devralınan: yok
