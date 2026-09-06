# TeksERP — Kod Yazım Standardı Projesi (uygulama prompt'u)

> Fable ile plan (2026-09-05), Opus ile uygulama. **ultracode yetkin var** — fazları workflow ile koş, ajanlar sonuçlarını DİSKE yazsın. Karar verme yetkin var: §3'teki varsayılanlar KARARDIR, soru değil; gerekçeyle değiştirebilirsin, değiştirdiğini rapora yaz. Tek turda bitir: yeşile çek → ölç → belge → ESLint → kod düzeltme → reçete/CI/hook → doğrula → rapor. Bloklayan tek şey PRODUCTION verisi ve sırlardır.

## 0. Önce oku (sırayla)

1. `CLAUDE.md` (kök) · `Teks-Erp/CLAUDE.md` · `Electron/CLAUDE.md` · `mobil/CLAUDE.md`
2. `docs/KOD-KURALLARI.md` (113 desen + yasaklar — standart bunları TEKRAR ETMEZ, bağlar) · `docs/RECETELER.md` · `docs/GELISTIRME-DONGUSU.md` · `docs/README.md` § harness · `docs/history/anlama-turu-2026-09-05/UYGULAMA-OZETI.md` (önceki tur: ne yapıldı, ne ertelendi)
3. `Teks-Erp/eslint.config.mjs` (başlıktaki "ölçmeden kural yazma" ölçütü) · `Electron/eslint.config.mjs` · `mobil/eslint.config.js` · `.github/workflows/ci.yml` · `scripts/claude-hooks/bash-guard.mjs` · `scripts/check-docs.mjs`
4. **Keşif çıktıları (bu prompt'un zemini):** `docs/history/standart-2026-09-05/kesif/` — `OZET.md` (10 ajanın sıkıştırılmış bulguları, ÖNCE bunu oku) · `KESIF-TAM.json` (tam metin; her kuralın `observedIn/deviations/enforceHow/referenceExample` alanları burada) · `boyut-dagilimi.json` · `bagimlilik-envanteri.json` · ajan başına `*.json`

## 1. Neden (bağlam)

Repo belgeleri OLAY-TÜREVLİ: her kural bir arızadan doğmuş. RUTİN konvansiyonlar (servis metodu nasıl yazılır, model nasıl tanımlanır, katman neyi içerir, ne kadar uzun olabilir, kütüphane nasıl seçilir, test ne zaman koşar) hiç yazılmamış — her ajan/insan koddan yeniden çıkarsıyor. Keşif 10 ajanla ölçtü: **fiilî kalıp güçlü ve tutarlı, yazılı karşılığı yok, mekanik kapısı yok.** Bu tur o üçünü kapatır: kalıbı yazar, ölçülü kapı koyar, belgeyle kodun ayrıştığı yerleri düzeltir.

Ölçülen zemin: backend 269 servis (p50 236 / p90 1.001 / max 7.143 satır; fonksiyon p50 14 / p90 59 / p99 160), route p90 749; Electron 1.359 dosya (p90 298; 134 dosya >300); mobil 386 dosya (p90 427; max 9.386 `TamburScreen`). Tanımlayıcılar ASCII/İngilizce (Türkçe karakterli tanımlayıcı 0). Yorum: backend servislerin %25'i yorum, en yeni helper'lar %71-86 (karar kaydı kod yanında yaşıyor — bu bir DEĞER, boyut sayarken yorumu sayma).

## 2. Keşif bulguları (kısa; tam metin `kesif/`)

Her madde bir kimlik taşır. Rapor tablosunda her kimliğin akıbeti yazılır: **yapıldı / listeye alındı (gerekçe) / reddedildi (gerekçe)**. Sessiz atlama yok.

### 2.1 Backend servis — fiilî kalıp (kural olur)
- Yeni servis = **düz fonksiyon modülü** (`export async function`) ya da `export const XService = {}`; son 30 dosyanın 27'si böyle. Class+singleton devralınan (77 dosya). Static-only class yalnız altyapı (audit/auth/device/session/permission).
- **Zarfı SERVİS kurar** (`{success:true, data, message?}`); route/controller yalnız `res.status(N).json(result)`. Bugün üç üretici var: servis 429, inline route 106, `reportEnvelope` 21.
- Zod route/controller'da (37+21 dosya); serviste değil (2/269, ikisi paylaşılan helper). `$transaction` yalnız serviste (196/0/0), closure DAİMA `tx` (ESLint guard'ı isme bağlı). Audit tx DIŞINDA (0/323 ihlal), `await` edilir (`void` yalnız finans paketinde bilinçli, 65). Tx içinde dış I/O 0.
- Hata `AppError.<factory>` (1.922); `throw new Error` yalnız iç sentinel (17, meşru). **`details.code` talep güdümlü**: yalnız istemcinin dallandığı hata taşır (409'ların %10'u, 400'lerin %4'ü; istemcide 41 okuma).
- Okumada açık projeksiyon %93; `select` 2.601 : `include` 269 (subcontractor 60, workorder 50 — devralınan). `const X_SELECT = {…} satisfies Prisma.XSelect` (34 sabit) + adlandırılmış DTO.
- `*Tx` soneki + ilk parametre `tx: Prisma.TransactionClient` (33/48; 15 soneksiz: `finance.helper.ts:38 nextInvoiceNo`, `:210 resolveExchangeRate`, `order-status.helper.ts:96`…). Aktör `userId?` SON parametre. Fiil sözlüğü: `assertX` (void+throw) · `resolveX` · `buildX` · `loadX` · `collectX` · `normalizeX` · `computeX`. Dosya `// ====` banner'ı: ne + neden. Decimal: `Prisma.Decimal`/increment (0 ihlal). Referans dosya: `src/services/sack-tag.service.ts`.
- Boşluklar: **[İ-01]** 211/429 `Promise<ApiResponse<unknown|any>>` → yeni kodda adlandırılmış DTO zorunlu; devralınan baseline. **[İ-02]** 15 soneksiz tx-alan fonksiyon → `*Tx` adına çevir (çağıranlarla birlikte, tsc yeşil). **[İ-03]** zarf üreticisi tekleştirme: yeni kodda inline route `success:true` KURMAZ; 106 devralınan baseline'a. **[B-01]** 12 adımlık "yeni servis metodu" reçetesi `kesif/backend-servis.json` → RECETELER'e.

### 2.2 Backend katman — belge bayat, kod sağlam
- **Controller'sız inline route ÇOĞUNLUK** (45/80 dosya, 323/672 handler; %79'u ≤25 satır, yalnız 1'i >60 — `admin.routes.ts:179`, gerekçeli). Controller yalnız `new BaseController(service)` (15 dosya) ve çok-uçlu aileler (20 özel controller); `extends BaseController` 0. **[B-02]** Teks-Erp/CLAUDE.md "bilinçli istisna" cümlesi ve "Controller: Zod + servis + ApiResponse zarfı" satırı YANLIŞ → yeniden yaz: inline handler NORM (Zod parse + servis + json, ≤40 satır), controller ÖLÇÜTÜ: BaseController CRUD ya da ≥4 uçlu aile.
- Kapı sırası `router.use(verifyToken, requireXEnabled)` → handler'da `requirePermission`; sıra ihlali 0. Ama 53/80 dosya `router.use` kapısı kullanmıyor (handler başına `verifyToken`, 244 argüman — `test_route_auth_coverage.ts:5-11` bunu FAIL-OPEN diye tanımlıyor). → Yeni dosyada `router.use` zorunlu.
- **[İ-04]** `requireFinanceEnabled` (30 mount, `finance.middleware.ts:21`) belgede yok ve kardeşlerinin `details.code:'MODULE_DISABLED'` sözleşmesini taşımıyor → düzelt + listeye ekle (bekçi `test_module_flags` yeşil kalmalı).
- **[İ-05]** Zod'suz yazma gövdesi 4 nokta (`kesif/katman-sozlesmesi.json` → gaps) → şema ekle. **[İ-06]** `.strict()` 50/208 (%24) → yeni şemada zorunlu; `shipping.controller.ts:71-77` LOAD-BEARING gerekçesi standarda girer; devralınan şemalara dokunma (allowlist davranışı değişir).
- **[İ-07]** Route'ta audit 10 çağrı/3 dosya (admin ×8, db-copy, feature-flag) → yeni kodda yasak, devralınan listede. **[İ-08]** Serviste `req: Request` 20 imza/11 dosya + `helpers/guarded-hard-remove.ts` route-handler fabrikası → sınır: yeni kodda servis Express tipi almaz; devralınanlar listede.
- **[İ-09]** Swagger: ~60 belgesiz uç (612/672), 6 dosyada hiç yok; `test_swagger_spec.ts:27 PATH_COUNT_FLOOR=120` (gerçek 502) ısırmıyor → bekçiyi uç↔`@openapi` bloğu eşlemesine çevir (Express router'dan uç listesi + JSDoc taraması), eksikleri listele; belgeleme toplu değil, listede.
- error.middleware Prisma (9 dal) ve ZodError dalları `details.code` üretmez; ZodError gövdesi `errors[]` ile ayrı şekil → BACKEND.md'de "hata gövdesi üç şekil" olarak yazılır.

### 2.3 Veritabanı — şablon ölçülü, reçete yok
- Kalıp birebir: id `String @id @default(uuid()) @db.Uuid` 116/117 · `@@map` 124/124 · Timestamptz 311/315 (4 `@db.Date` muaf, bekçi iki yönlü) · clientToken 15/15 aynı yazım · migration adı 232/232 · composite sıra 106/106.
- **Künye FK'sı (`createdById/updatedById/userId`) INDEX ALMAZ** — 91 emsal, kural olarak yazılmazsa yeni gelen "eksik" sanıp ekler. Katalog modeli: `code` (değişmez) + `name` + `sortOrder` + `isActive`; defter: yalnız `createdAt`; künye master-data'da. Metin `@db.VarChar(n)`. Büyüyen değer kümesi → pg enum DEĞİL `String @db.VarChar` (`ALTER TYPE` geri alınamaz; `schema.prisma:3264`). İlişki adı `<Model><Rol>`; `onDelete` gerekçeli; sıra dışı her karar `///` ile satırın üstünde.
- Partial index ham SQL, şemada düz `@@index`; partial unique → `@@unique`. `test_db_invariants` **DOKUZ** liste, iki yönlü (belge 5 diyor). Migration: elle SQL; `--create-only` + DropForeignKey sil; `SET statement_timeout = 0` (42/232); yumuşak kapı `DO $$` deseni (`20260821150000_name_fold_unique_live`); **`CREATE INDEX CONCURRENTLY` YAZILMAZ** (Prisma tx'i içinde çalışmaz — `20260830090000`); ifade index fonksiyonu IMMUTABLE+STRICT, `\s` yasak; `apply-migration.ts` sırası.
- **[B-03]** "Yeni model" reçetesi HİÇ YOK (en büyük boşluk); "yeni migration" reçetesi 23 adım → çekirdek 13 adıma indir. **[B-04]** Teks-Erp/CLAUDE.md DB kuralı 4: envanter 9 liste. **[B-05]** "Elle migration SQL'i idempotent yazılır" hiçbir .md'de yok → VERITABANI.md. **[B-06]** İstisna kaydı: `PermissionCategory` küçük-harf enum, `endpoint_latency_daily` tekil ad (tekrarlanmaz).
- **[M-01]** 5 domain FK index'siz: `schema.prisma:3702 SubcontractorDirectShipAllocation.dispatchId` · `:3747 DirectShipment.branchId` · `:4529 Sack.branchId` · `:5983/:5984 WarehouseMovement`. **[M-02]** 10 model `updatedAt`'siz ama kodda update ediliyor (rollOperation 5, subcontractorDispatchItem 5, rollVariance 4, sackTagAssignment 3, userRecoveryCode, itemAllowedProperty, itemAllowedColor, rollProperty, importRun, yarnMovement). **[M-03]** `system_logs.newData ->> 'event'` sorgusu (`inventory.service.ts:2509`) GIN'siz — SystemLog yüksek hacim + CONCURRENTLY yok → UYGULAMA, listeye (vardiya dışı iş). **[M-04]** Soft-delete istisna listesi kod gerçeğinden dar: 7 hard delete listede yok (`customer-alias.service.ts:94,198` · `duplicate-review.service.ts:151` · `sack-tag.service.ts:218` · `permission-management.service.ts:1041` · `batch.service.ts:337` · `label-template.service.ts:886`) + `invoice.service.ts:883` DRAFT `deleteMany` → her biri için karar: meşru istisna (gerekçeyle kök CLAUDE.md listesine) ya da soft'a çevir.
- 14 DB kuralının yalnız 4'ünde mekanik kapı var → VERITABANI.md'de her kuralın kapısı/kapısızlığı etiketle yazılır.

### 2.4 Eşzamanlılık — kalıp güçlü, boşluklar dar
- 80 claim sitesi (74 count kontrollü, 130 → 409; kontrolsüz 6 bilinçli idempotent no-op) · 26 advisory (2-arg `pg_advisory_xact_lock(NS, hashtext(anahtar))`, tx'in İLK ifadesi, adlandırılmış `X_LOCK_NS`) · 99 `withBarcodeRetry` (5 deneme + 5-30 ms jitter, iş-anahtarı P2002 predicate ile dışarıda) · clientToken P2002 RETRY EDİLMEZ → tx-dışı catch → cached (18 site, 7 servis; cached şekil birebir) · token-replay dört durum · çift yüklem + CHECK (`payment-allocation.service.ts:284`) · READ COMMITTED (195/196; tek RepeatableRead salt-okuma `shipping.service.ts:3643`) · `FOR UPDATE` derinlik savunması, asıl serileştirici kilit/koşullu WHERE · `touchWorkOrderTx` · period guard 5+1 çağıranın hepsi tam · PG 40P01/40001 → 409 · çapraz uzay 8021→8027 artan (uyumlu; belge "yok" diyor).
- Standardın cümlesi: **"count kontrolü yoksa bu bir claim değil dürtmedir."**
- **[İ-10 · YÜKSEK]** 8026 uzayı İKİ sahipli: `helpers/period-guard.helper.ts:73 PERIOD_CLOSE_LOCK_NS` ↔ `helpers/code-unique.helper.ts:57 CODE_UNIQUE_LOCK_NS` → birine yeni uzay (8029), envanter başlığını 10 uzaya tamamla (8023 shipment, 8026, 8027 merge paylaşımı), yeni bekçi `test_advisory_lock_namespaces.ts` (src'de `*_LOCK_NS` / `pg_advisory_xact_lock(<sayı>` tarar, eşsizlik + envanter eşitliği, iki yönlü). Kök CLAUDE.md ve `docs/kurallar/` uzay satırları güncellenir.
- **[İ-11]** `traveler-card.service.ts:269-285` sürüm artırımı check-then-act → claim (`updateMany where {id, status:ACTIVE, version: existing.version}` + count===0 → 409); `recordPrintEvent` (:350) tx dışı okuma → tx içine. Bekçi `test_traveler_card_stale` yeşil + yarış sondası.
- **[İ-12]** `jobs/role-template-catalog.job.ts:57` çok-model yazım tx'siz → tx. **[İ-13]** `subcontractor.service.ts:4753→4784` talimat güncellemesi tx dışı check-then-act → tx + claim.
- **[ES-01]** token-replay "ölü replay" yüklemi 15 token'lı modelin 3'ünde → helper'ı model-bağımsız genelle (`assertReplayAlive(kind, row)`) ya da ES-BOŞLUK tablosuna (dosya:satır, risk, öneri). **[ES-02]** 4 tablet ucu clientToken'sız (SubcontractorDispatch, KartelaDispatch, KartelaReceipt, StockCount) — kolon + replay + istemci token gönderimi (APK) ister → ES-BOŞLUK (tasarım kaydı, bu turda uygulanmaz). **[ES-03]** 36 tx-dışı `findUnique→if→update` (yönetim/master-data; `device.service.ts:322…`, `auth.service.ts:191…`) → devralınan, listele. **[M-05]** SackTag `name` check-then-act (`sack-tag.service.ts:132,164`), DB seddi yok → yumuşak kapılı partial unique (nameFold deseni) migration.
- **[B-07]** clientToken 15 model (16 değil); "çapraz uzay çifti yok" → var; "isolationLevel kullanılmıyor" → 1 salt-okuma istisnası.

### 2.5 Kütüphane — disiplin var, kayıt yok
- Fiilî: her ihtiyaç TEK kütüphane (Electron ikon lucide-react 490 dosya · toast sonner 219 · xlsx exceljs (dinamik import) · http axios 14 / fetch 0; mobil toast react-native-toast-message 64 · Paper 132 · liste FlashList · ikon @expo/vector-icons) · ESM-only/native riskli paket SABİT sürüm + gerekçe + bekçi (bonjour-service 1.4.4, Electron'da bekçi var, **backend'de yok**) · backend CommonJS, her dependency `require` ile çözülür (18/19 ölçüldü, mekanizma yok) · çalışma zamanı paketi `dependencies`'te (prisma CLI dahil — kur.ps1 `migrate deploy` koşar) · native/config-plugin mobilde APK ister; Electron'da `createRequire` + try/catch tembel yükleme (4 IPC dosyası) · >200 KB paket dinamik import · elle yazmak meşru alternatif (mobil tarih seçici emsali) · lisans permissive (üç projede copyleft 0) · axios = oturumlu istek, fetch = kimliksiz sonda/manifest · backend `uuid` (2 dosya) ↔ `crypto.randomUUID` (20) ikiliği.
- **[K-01]** 13 doğrulanmış ölü paket: Electron `@react-pdf/renderer`, `electron-window-state`, `@radix-ui/react-avatar`, `@radix-ui/react-scroll-area` (+1 Radix), `@fontsource/roboto`; backend `@faker-js/faker` (dev — seed kullanıyor mu ÖLÇ); mobil `react-native-ble-plx` (**app.json plugins[1]'de — APK'ya native kod + izin taşıyor**), `react-native-vector-icons` (Paper peer'ı DEĞİL, ölçüldü), `react-native-qrcode-svg` + `react-native-svg`, `expo-sharing`, `@react-navigation/bottom-tabs`. Her biri için üç yanlış-pozitif kanalı doğrula (dinamik import · `createRequire` · app.json/jest/babel config referansı), sonra kaldır; kaldırma sonrası ilgili projede tsc + test + (mobil) `expo-doctor`. `react-native-web`+`react-dom`: `npm run web` script'iyle birlikte KALDIR (app.json'da web platformu yok, src'de 0 kullanım) — jest-expo'nun react-dom istemediğini ölç. Mobil native değişikliği → rapora "sonraki APK'da gider" notu.
- **[K-02]** "importFiles: 0 ≠ ölü" — 13 canlı paket sıfır görünüyor (exceljs, serialport, node-hid, bonjour-service, @fontsource/plus-jakarta-sans, Expo plugin'leri…) → KUTUPHANELER.md'ye "ölü paket teşhisi" reçetesi. **[K-03]** Backend bonjour pin bekçisi + CJS invariant bekçisi (`require.resolve` her dependency) → tek bekçi `test_dependency_contract.ts`. **[K-04]** Araç zinciri drift (TS 6.0/5.6/5.9, ESLint 10/9/9) → karar: bu turda HİZALAMA YOK, kayıt + "büyük sürüm yükseltmesi sözleşme değişikliğidir" kuralı. **[K-05]** `docs/KOD-KURALLARI.md` "mekanik zorlananlar" listesi kütüphane sınıfından kural içermiyor → K-03 ile kapanır.

### 2.6 Electron — en disiplinli katman, üç kural bekçisiz
- Fiilî: `pages/<Modul>/` altında types + service (`createCrudService<T>`) + schema (zod; `max(n)` = Prisma `@db.VarChar(n)`) + columns + FormDialog + Page; sayfa `PageShell+PageHeader+PageBody` ya da `CrudPage`/`ReportPageLayout` (115/131); tüm HTTP `services/apiClient.ts` (ham fetch 0), yol TAM `/api/...` (bekçili); query-key ilk eleman kebab literal (532/569); named export (130/131); her route `ProtectedRoute` (100/106); mutation `onError`'da ikinci toast YOK — interceptor basar, istisna `suppressErrorToast:true`; renderer `electron/fs/path/child_process/os` import etmez (ESLint); `AutoLoadMore` (buton yok); sidebar'a satır eklenmez (hub kartı/palet); basit form `EntityFormDialog`; paylaşılan hook `hooks/`, sayfaya özel hook sayfa dizininde; `any` yasak (ESLint error, 8 gerekçeli disable). Referans: `pages/System/Clients/`, `pages/DefectTypes/`.
- **[İ-14 · GÜVENLİK]** `StationCapabilitiesPage.tsx:280-287` "Yetkinlikleri Düzenle" butonu `PermissionGate`'siz, route `station:read` ile açılıyor → yazma butonu `station:write` (ya da ilgili yazma izni) kapısına; bekçi (`tile-visibility`/route-permission test aynası) + negatif sonda.
- **[İ-15]** 17 koşulsuz `onError → toast.error` (10 dosya; en yenisi SackTags 2026-09-04) → `suppressErrorToast` ya da toast'u kaldır; ESLint kuralı (2.10'daki E-listesi). **[İ-16]** `Customers/schema.ts:21 max(50)` ↔ Prisma `Customer.code VarChar(32)` → 32. **[İ-17]** 8 rapor hub'ı iskeletsiz (`ReportHubGrid.tsx:21-22`) → `PageShell/PageBody`. **[İ-18]** 3 `service.ts` React hook export ediyor (Clients/DbRestore/Backups) → hook'u `hooks.ts`e taşı. **[İ-19]** `OrderFormDialog.tsx:297` gerekçesiz `as any` → gerekçe ya da tip.
- **[B-08]** Electron/CLAUDE.md "schema.ts zod backend'le uyumlu" → gerçek: backend master-data CRUD'da Zod YOK (`base.controller.ts:95-102` gövdeyi doğrudan geçirir); uyum = Prisma VarChar aynası, TEK kapı panelde → yaz. **[B-09]** Boyut kuralı "≤300 / Page ≤200 ZORUNLU" yazılı ama bekçisiz; 2026-09-03/04 sayfaları 442/304/257 → baseline'a girer (2.10).
- Boyut önerisi: dosya ≤300 · `*Page.tsx` ≤200 · `*FormDialog.tsx` ≤200 · fonksiyon/bileşen ≤80 (p90 98). Muafiyet sınıfı "katalog/registry" (0 hook, yorum >%15): `settings-config` 1445, `WorkOrders/service` 1266, `content-routes` 1218, `documentConfig` 1216. Gerçek borç: >300 olan 124 dosyanın ≥10 hook taşıyan 28'i; `FilterBar.tsx` 1049/19 hook.

### 2.7 Mobil — tek iyi kalıp var ve yeni; sorun 5 dev ekranda
- Fiilî: **ekran = ince kabuk + View bileşenleri + ekran-hook + saf mantık modülü (+ yanında `.test.ts`)** — emsal `screens/Modules/HizliIsEmri/` (15 dosya, kabuk 140 satır), `SiparisScreen` (134). Katman ekran → `<domain>.service.ts` → `apiClient` (ekran HTTP kurmaz). Çevrimdışı kuyruğa giren yazma `mutationKey: STATION_MUT.*` + `offline/mutations.ts` `setMutationDefaults`. Okutma geri bildirimi `scanFeedback.signalScan`/`useScanFeedback` (accept|duplicate|reject + ses ayarı). Paper: `TouchableRipple/Button/IconButton/List.Item` (`<Card` 0, `TouchableRipple` 233); modallar `components/AppModal.tsx` (54 dosya); liste `FlashList + useInfiniteQuery` (`FlatList` 0); oturum kapısı `constants/stationScreens.ts` + `withWorkSession`; çevre birimi `useMachinePeripherals`; renk/spacing `theme/tokens.ts`; adlandırma `use*`/`<ad>Store.ts`/`<domain>.service.ts`/PascalCase.tsx; **göreli import** (tsconfig alias'ları fiilen ölü: 9 tanım/2 kullanım vs 587 `../../../`); sebep seçimi `ReasonPresetPicker`; testler kaynağın YANINDA (80/84; belge `test/` diyor).
- 5 dev ekran (2026-05-11 doğumlu): Tambur 9.386 / FasonKabul 4.679 / KK1 4.204 / KursunQc 3.192 / FasonSevk 2.401 = 23.862 satır → **sınır dışı**, baseline'da donar; Tambur bölme planı `kesif/mobil-ekran.json → sizeProposal.tambur_bolme_plani` (6 adım) → "bilinen borç" olarak TEST-VE-DERLEME/MOBIL'e, uygulama AYRI iş.
- **[İ-20]** signalScan yalnız 3 tüketicide; 11 dosya okutma yolunda doğrudan `Haptics` (kanıt: `DepoScreen:296-319`, `KursunQcScreen:446/477`, `PaketlemeScreen:361-384`) → o ekranlarda "mükerrer" sinyali ve ses ayarı çalışmıyor → üçünü `signalScan`'e çevir; kalan 8 listede; bekçi: okutma handler'ında `Haptics.` çağrısı AST taraması (`segmented-buttons-row.guard.test.ts` kalıbı). **[İ-21]** 13 kuyruksuz istasyon mutasyonunun 11'inde "online-only" gerekçesi yok (`finalizeMutation:1198`, `cutOpenFabricMutation:1245`…) → her birine tek satır gerekçe (`TamburScreen:1706` emsali); gerekçesi olmayan → karar: kuyruğa mı, gerekçe mi. **[İ-22]** 3 ham RN `<Modal` (LabelNamePreview, AppMenu, LabelPreviewSheet) → AppModal ya da gerekçeli muaf. **[İ-23]** ReasonPresetPicker: 2 ekran kendi seçicisini çiziyor → bileşene geç. **[İ-24]** 26 bastırılmış `exhaustive-deps` → listele, baseline; yeni kodda disable yasak.
- **[B-10]** mobil/CLAUDE.md: "font ≥16sp" (1.163 bildirimin %83'ü 16 altı, en yoğun 12/13) → kural GERÇEĞİ söylemiyor: ya kuralı "okuma metni ≥14, ikincil ≥12, kritik rakam ≥20" diye ölçüme çek ya da sil; "test/ dizini" → yan yana test; paket listesi 3 ölü paket içeriyor; "ReasonPresetPicker tek bileşen" → 1 kullanım.
- Boşluk: queryKey merkezi kayıt yok (238 satır içi) → yeni kodda `queryKeys.ts` fabrikası (küçük başlangıç: yeni ekranlar), devralınan listede; ham hex 1.931/88 dosya (%50 dev ekranlarda, yeni ekranlarda 0) → yeni kodda 0, ESLint `no-restricted-syntax` Literal regex `#[0-9a-f]{3,8}` warn + baseline; ekran bileşeni testi ~0 (2/84) → MOBIL.md "saf mantık modülü + test zorunlu, ekran testi istenmez" (bilinçli).
- Boyut: kabuk ≤250 · görünüm/sheet ≤500 · ekran-hook ≤400 · tek React fonksiyonu ≤300 ve ≤12 `useState` · saf mantık ≤200 + test · servis ≤400 · yeni ekranda ham hex 0.

### 2.8 Test ve derleme — kültür güçlü, KAPILAR KIRIK (bugün main'de zarar veriyor)
- Fiilî: framework'süz tek-dosya bekçi (453 backend + 208 Electron vitest + 84 mobil jest), business-key fixture, fail-closed üretim-DB kapısı, tip geçidi (~28 sn), negatif sonda, kod+bekçi aynı commit (%78), 6 job CI.
- **[Y-01 · YEŞİLE ÇEK]** CI Electron "Type-check" NO-OP: `npx tsc --noEmit` kök `tsconfig.json` (`files:[]` + references, `-b` yok) → 0 dosya derliyor; `npm run typecheck` 9 hata veriyor (1 gündür main'de): `Electron/src/pages/Operations/SackContentEdit/service.ts:69,80` (`SackCustomerPage` import yok, tip `types.ts:71`'de var) · `SackTags/SackTagsPage.tsx:253` · `SackEditorView.ship.test…` → hataları düzelt, CI adımını `npm run typecheck` yap. **[Y-02]** Electron vitest main'de kırmızı: `src/store/tabs.back.test.ts` (4) + `src/components/layout/PageHeader.test.tsx` (3) — 22bbe617 zustand persist ekledi, jsdom'da localStorage kapalı → test setup'ında localStorage polyfill ya da persist'i test ortamında kapat. **[Y-03]** `run-all-tests.ts`'e MIGRATION DURUMU KAPISI: `prisma migrate status` bekleyen migration varsa DUR ve adlarını bas (bugün 2 bekleyen → 134/453 kırmızı, teşhis stack'te). Dev DB'ye bekleyenleri `npm run prisma:migrate` ile uygula. **[Y-04]** 5 HTTP bekçisi sunucu yoksa SESSİZCE atlıyor → atlanan bölümü ÇIKTIDA "⚠️ ATLANDI (sunucu yok: port N)" diye bas; koşucu özetine "atlanan bölüm sayısı" ekle (yeşil ≠ kapsandı görünür olsun).
- **[B-11]** "`npm test` SAATLER sürer" YANLIŞ — ölçüldü **6 dk 28 sn** (453 dosya, tip geçidi dahil) → Teks-Erp/CLAUDE.md, GELISTIRME-DONGUSU, kök CLAUDE.md düzelt; kadans buna göre (§3 K8). Electron vitest 33 sn, mobil jest 29 sn.
- Yerelde git hook YOK (husky/lefthook yok; bash-guard yalnız Claude'un Bash'inde ve 1 günlük) → §3 K8 kararı. `check-migrations.mjs` değeri yereldedir, CI'da yapısal yeşil → hook'a girer. Lint uyarıları kapı değil (Electron 37, mobil 136 uyarıyla yeşil) → baseline. e2e/load-test `continue-on-error` → kayıt, değiştirme. Stryker hiç koşmuyor (2026-06-14) → Electron/CLAUDE.md'den "kapı" imasını kaldır. 13 kural "bekçi: yok" → KOD-KURALLARI'nda etiketli kalır.
- **Paralelleştirme notu (önceki turun ertelenmiş fikri ÇÜRÜDÜ):** `pg_advisory_xact_lock` VERİTABANI kapsamlıdır, şema kapsamlı değil → "schema-per-worker" yetmez; ayrıca 5 bekçi `table_schema='public'` sabitliyor. TEST-VE-DERLEME.md'ye "bilinen sınır: paralelleştirme DB-per-worker ister" olarak yaz.
- Bekçi boyutu: p50 217 / p90 524 / max 1.914; yeni bekçi ≤400, >600 → dosyalara böl.

### 2.9 Belge-kod uyumu (40 çekirdek değişmez)
32 uyumlu · 5 kod ihlali · 3 belge yanlış · 1 belirsiz. Mekanik zorlananlar gerçekten sıfır ihlalli (ESLint 6 desen, timestamptz 13/13, sürüm notu 13/13, tx+Promise.all 0/124, tx içinde audit 0). Ek: **[İ-25]** `Electron/src/components/layout/NotificationBell.tsx:28-31` düz OR zinciri → `matchesPermission`. **[İ-26]** boğaz-ikiz `stepCanApplyQuality ↔ QUALITY_STATION_WHERE` AST bekçisiz (yalnız davranış testi) → `test_station_quality_capability`'ye AST bölümü (ikisinin aynı dosyada ve `satisfies` ile tanımlı olduğu; `kind === "PROCESS_QC"` literalinin helper dışında 0 olduğu — ESLint E-listesiyle örtüşür). **[BELİRSİZ-01]** Electron `pages/` altında 296 `.filter(` — cursor'lu liste üstünde istemci süzmesi var mı ölçülmedi → Faz 0'da ölç (liste sorgusu sonucu üstünde `.filter(` → aday), sonucu rapora; ihlal varsa İ listesine.

### 2.10 ESLint ölçümü — üç kova (kesif/eslint-aday.json)
| Kova | Kural | Backend / Electron / mobil ihlal | Karar |
|---|---|---|---|
| 1 · bedava, `error` | `@typescript-eslint/no-floating-promises` (tip bilgili) | 0 / 35 / 291 | backend error; Electron 35 → düzelt ya da baseline; mobil baseline |
| 1 | `naming-convention` (ASCII, camel/Pascal/UPPER; `__xForTests` allow) | 7 / 3 / 4 (hepsi `__…ForTests`) | allow-pattern ile error |
| 1 | Türkçe karakterli tanımlayıcı (`Identifier[name=/[çğıöşüÇĞİÖŞÜ]/]`) | 0 / 0 / 0 | error |
| 1 | `no-explicit-any` | 0 / 0 (error zaten) / 12 | mobil 12 düzelt → error |
| 1 | `import/no-cycle` (ya da `eslint-plugin-import-x`) | 1 / 2 / 0 | 3'ü düzelt → error (plugin ekleme = kütüphane karar kaydı) |
| 1 | 5 yeni syntax yasağı: `kind === "PROCESS_QC"` (helper dışı) · `!== "mobile"` · `.body.code` · `applied_steps_count` · çıplak `DATE_TRUNC` (time.ts dışı) | 0 (yalnız yorum) | error (her biri kuralı anlatan mesajla) |
| 1 | `no-console` (Electron + mobil; backend HARİÇ — logger yok, 137 çağrı) | – / 3 / 8 | düzelt → error; backend için "logger kararı" ES-BOŞLUK |
| 1 | mobil `Card` + `onPress` (JSX AST) | – / – / 0 | error |
| 1 | Electron `localStorage` içinde token/jwt anahtarı | – / 0 / – | error (dar selector) |
| 2 · `warn` + baseline | `max-lines` 300 (yorum/boş satır SAYILMAZ: `skipComments`, `skipBlankLines`) | 145 / 134 / 70 | warn + baseline |
| 2 | `max-lines-per-function` 80 (aynı skip) | 391 / 505 / 188 | warn + baseline |
| 2 | Prisma enum'unun `z.enum([...])` literal aynası (47) | 47 / – / – | warn + baseline; yeni kodda `z.enum(PrismaEnum)` |
| 2 | `now() AT TIME ZONE 'UTC'` (11, hepsi `exitedAt`) | 11 / – / – | warn + baseline |
| 2 | Electron mutation `onError` içinde `toast.error` (17) | – / 17 / – | İ-15 ile düzelt → error |
| 2 | mobil ham hex Literal (1.931) | – / – / 1931 | warn + baseline |
| 3 · YAZMA (yasak dar okunmuş / AST güvenilmez) | `toLocaleUpperCase("tr")` · Haptics doğrudan (230; kural yalnız okutma yolu → bekçi İ-20) · inline `pageSize` (22, çoğu sayaç) · backend `no-console` · `findUnique→update` (AST adayı 5, 2'si yanlış pozitif) · `new Date()` rapor kapsamı | — | config başlığına gerekçe |
- Kapsam boşlukları: **[E-01]** backend lint yalnız `src` — `scripts/` (554 dosya) ve `prisma/` lint dışı → ölç, kural seti dar bir `scripts/**` bloğuyla genişlet (yasaklar + floating-promises), ihlal varsa baseline. **[E-02]** hiçbir projede tip bilgili kural yok → `parserOptions.projectService: true` (yalnız gereken bloklarda; süre ölç). **[E-03]** `reportUnusedDisableDirectives: "error"` üç projede (bastırılmış: Electron 65, mobil 42, backend 0 → ölü disable varsa temizle). **[E-04]** mobil `expo lint` ↔ çıplak `eslint .` kapsam farkı (`scripts/lib/feed.cjs:36 no-undef __dirname`) → CI ve hook aynı komutu koşar; feed.cjs düzelt. **[E-05]** baseline mekanizması: `scripts/check-lint-baseline.mjs` (check-docs deseni; `eslint -f json` → kural bazında sayı → `<proje>/lint-baseline.json`; `--yaz` / `--kontrol`; tavan yalnız düşer, düşünce dosya güncellenir; CI + hook'ta `--kontrol`).

## 3. Kararlar (varsayılan = KARAR; gerekçeyle değiştirilebilir, rapora yazılır)

### K1 İsimlendirme
Tanımlayıcı İngilizce/ASCII (ESLint); UI metni, hata mesajı, yorum, belge, commit mesajı Türkçe. Dosya: backend `x.service.ts / x.helper.ts / x.routes.ts / x.controller.ts / x.middleware.ts / x.job.ts`, bekçi `test_x.ts`; Electron `XPage.tsx` + 5-dosya; mobil `XScreen.tsx` + kalıp. Sabit UPPER_SNAKE, tip/sınıf PascalCase, kalan camelCase; boolean `is/has/can/should`; async ad fiille; helper fiil sözlüğü (2.1); tx-alan fonksiyon `*Tx`; kilit uzayı `X_LOCK_NS`; projeksiyon `X_SELECT`; `$transaction` closure `tx`; aktör `userId?` son.

### K2 Boyut — "yeni ve dokunulan kodda zorunlu, devralınan baseline'da donar"
| Birim | Hedef | ESLint warn | Sert (yeni dosyada asla) |
|---|---|---|---|
| Fonksiyon (her proje) | ≤60 | 80 | 150 |
| Backend servis/route/controller dosyası | ≤400 | 400 | 600 |
| Backend helper | ≤300 | 300 | — |
| Electron dosya / Page / FormDialog | ≤300 / 200 / 200 | 300 | 600 |
| Mobil dosya (kabuk 250 · görünüm 500 · hook 400 · saf 200 · servis 400) | proje 400 | 400 | 600 |
| Parametre | ≤4 | `max-params` 4 | — |
| Yeni Prisma modeli / migration | ≤120 / ≤200 satır | — (bekçi `test_schema_size` küçük) | — |
| Yeni bekçi dosyası | ≤400 | — | 600 → böl |
- Satır = KOD satırı; yorum ve boş satır sayılmaz (karar kaydı kod yanında yaşar, cezalandırılmaz).
- Baseline: bugün aşan dosyalar `lint-baseline.json`'da donar; listede olmayan dosya sınırı aşamaz, listedeki dosya BÜYÜYEMEZ (sayı yalnız düşer). Muafiyet sınıfı gerekçeli: katalog/registry dosyaları (0 hook, yorum >%15), `schema.prisma`, `models.ts`.
- Bölme fırsatçı: dokunulan bölüm helper'a çıkar; 5 mega servis ve 5 dev ekran bölünmez (ayrı iş).

### K3 Katmanlar (backend) — ölçülen gerçeğe göre
- **Route:** `router.use(verifyToken, requireXEnabled)` dosya başında; her uç `requirePermission/requireAnyPermission` + `@openapi` bloğu; **inline handler NORM**: Zod `parse(req.body ?? {})` → servis → `res.status(N).json(result)`, ≤40 satır, iş mantığı/tx/prisma/audit/zarf YOK. Controller ÖLÇÜTÜ: master-data CRUD `new BaseController(service)` ya da ≥4 uçlu aile (özel controller).
- **Controller:** Zod + servis + `res.status().json()`. Zarf kurmaz.
- **Service:** iş kuralı, `$transaction`, claim, `AppError`, `X_SELECT` + DTO, zarfı KURAR; audit tx DIŞINDA `await`; Express tipi ALMAZ; prisma'ya inen tek katman. Metot anatomisi: imza (`input|id, …, userId?`) → ucuz ön doğrulama (tx dışı) → `$transaction(async (tx) => { claim → taze oku → yaz → sayaç })` → tx sonrası (audit, cache) → `ApiResponse<XDto>`.
- **Helper:** saf yüklem + Prisma parçası (boğaz-ikiz `satisfies`), `tx` alır, HTTP/Express bilmez, tek konu, ≤300.
- **Reports:** salt okuma; tek-tanım dosyaları; `reportEnvelope` yalnız burada.
- **Jobs:** süreç-içi, tek process; boot'ta yazan job tx kullanır.
- **Middlewares:** kapı + zenginleştirme; `details.code` sözleşmesi (`MODULE_DISABLED` tüm modül kapılarında).
- Hata gövdesi üç şekil (AppError · Prisma çevirisi · ZodError `errors[]`) BACKEND.md'de yazılır; `details.code` yalnız istemci dallanacaksa.

### K4 Model / şema
2.3'teki şablon aynen kural; künye FK index ALMAZ; enum vs VarChar kararı; `///` gerekçe; envanter 9 liste iki yönlü; migration standardı (elle SQL, idempotent, `SET statement_timeout = 0`, yumuşak kapı, CONCURRENTLY YOK, `apply-migration.ts`, prova en eski canlı dump'ta); şema-dışı nesne → envanter; Decimal/Timestamptz bekçili.
- **Bu turda migration:** yalnız M-01 (5 FK index — her tablo dev'de satır sayısı ölçülür, `SET statement_timeout = 0`), M-02 (10 model `updatedAt` — `DEFAULT now()` + backfill `= "createdAt"`, Prisma `@updatedAt`), M-05 (SackTag name yumuşak kapılı partial unique). M-03 (SystemLog GIN) ve ES-02 (4 clientToken) UYGULANMAZ, listeye. Her migration ayrı dosya, `apply-migration.ts` ile dev'e, ardından `test_db_invariants` + `test_schema_drift` + `check-migrations` yeşil; rapora "canlıya çıkmadan en eski dump'ta prova" notu.

### K5 Eşzamanlılık / idempotency — karar tablosu (ESZAMANLILIK.md omurgası)
| Durum | Mekanizma | Emsal |
|---|---|---|
| Durum geçişi | `updateMany WHERE {id, beklenen}` + `count===0 → 409`; claim SONRASI tx içinde taze oku; "count yoksa claim değil dürtme" | `printed-document.service.ts:748`, `workorder-link.service.ts:385` |
| Kayıt yaratan uç | `clientToken @unique` + P2002 retry YOK → tx-dışı catch → cached (şekil birebir); dört durum (`token-replay.helper`) | `cash-transaction.service.ts:320` |
| İstemci token | mantıksal deneme başına; yalnız belirsiz hatada (ağ/timeout/5xx) yapışır | `mobil/src/offline/entryAttempt.ts` |
| Henüz olmayan satır (sayaç, kod, dönem, tuzak) | `pg_advisory_xact_lock(NS, hashtext(anahtar))` tx'in İLK ifadesi; NS adlandırılmış sabit, envanterde, bekçili | `batch.service.ts:126` |
| Benzersiz numara | `withBarcodeRetry` (5 + jitter; iş-anahtarı P2002 dışarıda) + sequence tx içinde | `subcontractor.service.ts:2751` |
| Durum ↔ sayaç | çift yüklem + DB CHECK + `explain*BumpZeroTx` tanısı | `payment-allocation.service.ts:284` |
| Çok kilit | deterministik sıra; uzaylar arası artan; 40P01/40001 → 409 | `period-guard.helper.ts` |
| Sayısal tavan | `FOR UPDATE` derinlik savunması, asıl serileştirici kilit/koşullu WHERE | `cash-balance-guard.helper.ts:30` |
| Çok satır yazım | tek tx, interaktif biçim; dış I/O ve audit dışarıda; `Promise.all` yok | |
| İzolasyon | READ COMMITTED; RepeatableRead yalnız salt-okuma tutarlı fotoğraf | `shipping.service.ts:3643` |
| WO kapsamlı sayım | `touchWorkOrderTx` ile satır kilidi | `subcontractor.service.ts:1057` |
| Yarış bekçisi | elle açık tutulan tx; gate promise `.catch` | `test_goods_receipt_invoice §10` |
| İstemci | `onMutate` yeşil basmaz; 409 modal; kuyruksuz mutasyon gerekçeli | mobil |
- ES-BOŞLUK tablosu (dosya:satır · risk · öneri · neden ertelendi): ES-01/02/03 + backend logger kararı + Faz 0'da bulunanlar.

### K6 Hata / yanıt
`AppError` + `details.code` (talep güdümlü), Türkçe mesaj; 400 doğrulama · 403 yetki/modül · 404 yok (uzakta gizli) · 409 durum/yarış/idempotency; 422 kullanılmaz. `ApiResponse<T>`/`PaginatedResponse<T>`/`warnings[]`. Liste: yüksek hacim cursor, master-data offset (`MAX_OFFSET`); süzme sunucuda; id filtreleri `readIdCondition/readFilterList`.

### K7 Kütüphane — "yeniliklere açık, kayıtlı karar"
- Yeni kütüphane YASAK DEĞİL; 6 satırlık karar kaydı KUTUPHANELER.md'ye: problem · alternatifler (≥2, "elle yazmak" dahil) · boyut/native/ESM-only · bakım (son yayın, sürüm politikası) · lisans (permissive) · mobilde OTA mı APK mı. Kayıt yoksa bekçi `test_dependency_contract.ts` (K-03) kırmızı: `package.json` dependencies ∖ KUTUPHANELER.md tablosu = ∅ (üç proje; devDependencies araç sınıfı muaf listesiyle).
- Sürüm: `^` varsayılan; ESM-only/native riskli SABİT + gerekçe (bugün 8 paket, listele). Büyük sürüm yükseltmesi = sözleşme değişikliği (ayrı iş, bekçi paketi koşar).
- Teks-Erp/CLAUDE.md "sadece izinli liste; alternatif tanıtma" → "kayıtlı kararla açık" olarak güncellenir; liste KUTUPHANELER.md'ye taşınır, CLAUDE.md işaret eder.
- Ölü paketler K-01 ile kaldırılır; tekleştirme adayları (ikon/BT/PDF) karar olarak yazılır, uygulanmaz.
- `.claude/rules/kutuphane.md` (`paths: ["**/package.json"]`) → KUTUPHANELER.md işaretçisi.

### K8 Test ve derleme kadansı (ölçülü süreler)
| An | Ne koşar | Süre | Kapı |
|---|---|---|---|
| Düzenleme sırasında | hiçbir şey | — | — |
| Değişiklik bitince | dokunulan alanın bekçileri (`/bekci-kos`, BEKCI-HARITASI) + o projede `npm run typecheck` | 1-3 dk | model disiplini |
| Commit (git pre-commit) | `migrate status` (backend dokunulduysa) · değişen projede `typecheck` + `lint` + `check-lint-baseline --kontrol` · Electron/mobil `src` değiştiyse o projenin tam test paketi (33/29 sn) · `check-migrations` · `check-docs` (docs değiştiyse) | 15-60 sn | **`.githooks/pre-commit`** (bağımlılıksız; `npm run hooks:kur` → `git config core.hooksPath .githooks`; kaçış `TEKSERP_HOOK_SKIP=1`); bash-guard aynı adımları Claude tarafında koşar |
| PR/push öncesi (yerel) | backend tam paket `npm test` (**6,5 dk**, saatler değil) | 7 dk | GELISTIRME-DONGUSU |
| CI | docs · backend lint+baseline+typecheck:scripts+`npm test` · Electron lint+baseline+`typecheck`+vitest · mobil lint+baseline+tsc+jest · e2e/load bilgi | uzun | `ci.yml` (adnansahin kaldır) |
| Sürüm | not kapısı + paketleme kapıları | — | script'ler (var) |
- Yeni bekçi = negatif sonda zorunlu; bekçi ≤400 satır. Tam paket seri; paralelleştirme DB-per-worker ister → bilinen sınır.

### K9 Belge yerleşimi
`docs/standart/` = "nasıl yazılır" (10 dosya) · `docs/KOD-KURALLARI.md` = "hangi tuzak neden var" · `docs/kurallar/<alan>.md` = alan kararları. Üçü bağlanır, içerik kopyalanmaz. Standart dosyası ≤24 KB (`check-docs` `CLAUDE_MD_SIZE_CAPS`'e `docs/standart/*.md: 24 KB` eklenir). Kural biçimi tek şablon:
`- **[BE-07]** <emir kipi tek cümle> · zorlama: eslint:<kural> | bekçi:<dosya> | tsc | hook | insan:<neden mekanik değil> · kanıt: <dosya:satır | ölçüm> · devralınan: N (baseline) → yeni kodda ZORUNLU`
Ön ekler IL · BE · DB · EL · MO · KU · ES · TD. Kanıtsız/etiketsiz kural yazılmaz.

### K10 Kapsam DIŞI (dosyalarda "bilinen borç" olarak yazılır)
5 mega servisi bölmek · 5 dev mobil ekranı bölmek (Tambur planı kayda girer) · 6 serviste yorum temizliği · bekçi paketi paralelleştirme · 106 bayat bekçi · kütüphane tekleştirme uygulaması · araç zinciri hizalama · backend logger · mobil Zod katmanı (ES-BOŞLUK: tasarım kaydı) · i18n · Swagger'ın 60 ucunu belgelemek (liste çıkar, yazma).

## 4. Teslimatlar

### 4.1 `docs/standart/` (10 dosya)
| Dosya | İçerik (kaynak bölüm) |
|---|---|
| `README.md` | dizin · kural biçimi · etiketler · "yeni kodda zorunlu / devralınan baseline" ilkesi · standart↔KOD-KURALLARI↔kurallar/ ayrımı · baseline mekanizması nasıl çalışır |
| `ILKELER.md` | tek kaynak · fail-closed · ölç-önce (ESLint ölçütü) · sessiz düşme yasağı · sözleşme tetikleri · yorum politikası (bağ) · isimlendirme (K1) · boyut felsefesi (K2, tablo) · "kural = mekanik ya da karar noktası, ikisi de değilse yazılmaz" |
| `BACKEND.md` | K3 katmanlar · servis metodu anatomisi · zarf/hata üç şekil · projeksiyon/DTO · fiil sözlüğü · `*Tx`/`userId?`/banner · Zod yerleşimi + `.strict()` · Swagger · liste uçları (2.1, 2.2) |
| `VERITABANI.md` | model şablonu · katalog/defter/pivot üçlüsü · künye FK kuralı · enum vs VarChar · `///` gerekçe · index kuralları · partial/unique · envanter 9 liste · migration standardı · Decimal/Timestamptz · seed vs canlı veri (2.3, K4) |
| `ELECTRON.md` | 5-dosya kalıbı · iskelet · apiClient/yol · query-key · ProtectedRoute + kart↔route izin aynası · onError/suppressErrorToast · zod↔VarChar · renderer import sınırı · boyut + muafiyet sınıfı · vitest (2.6) |
| `MOBIL.md` | kabuk+görünüm+hook+saf mantık kalıbı (HizliIsEmri emsali) · katman · STATION_MUT/offline · signalScan · Paper/AppModal/FlashList · stationScreens/withWorkSession · tokens · göreli import (alias ölü) · queryKeys · OTA vs APK sınırı · boyut · yan yana test (2.7) |
| `KUTUPHANELER.md` | katman×ihtiyaç tablosu (üç proje, "Z kullanılmaz çünkü") · karar kaydı şablonu · sabit sürüm listesi · ölü paket teşhisi (üç kanal) · kaldırılanlar + gerekçe · açık kararlar (tekleştirme, araç zinciri) (2.5, K7) |
| `ESZAMANLILIK.md` | tutum · K5 karar tablosu · mekanizma envanteri (10 uzay + sahipleri, 15 token modeli, CHECK/partial listesi işareti) · yarış bekçisi yazımı · ES-BOŞLUK tablosu (2.4) |
| `TEST-VE-DERLEME.md` | K8 kadans tablosu · kapılar nerede (hook/CI/script) · bekçi yazma özeti (bağ) · negatif sonda · atlanan bölüm görünürlüğü · bilinen sınırlar (seri paket, paralel = DB-per-worker, e2e bilgi, stryker kapalı) (2.8) |
| (`docs/README.md` dizinine `standart/` satırı; kök `CLAUDE.md` § Çalışma düzeni'ne tek satır; üç alt CLAUDE.md'ye bağ) | |

### 4.2 ESLint (2.10 tablosu + E-01…E-05)
Her kural: ölç → karar → yaz → **negatif sonda** (kasıtlı ihlal → kırmızı → geri al; sonuç `kesif/../olcum/sonda-<proje>.json`) → config'e yorum (neden, ölçüm, tarih). `lint-baseline.json` üç projede; `scripts/check-lint-baseline.mjs`; CI + hook `--kontrol`.

### 4.3 Kod düzeltmeleri
İ-01…İ-26 (küçük/orta: yap), M-01/M-02/M-05 (migration: yap), Y-01…Y-04 (yeşile çek: İLK yap), K-01/K-03 (paket kaldır + bekçi), E-01…E-05. Her düzeltme sonrası ilgili bekçi + typecheck; güvenlik (İ-14) ve 8026 (İ-10) önce.

### 4.4 Reçeteler (`docs/RECETELER.md`)
Yeni servis metodu (B-01, 12 adım) · yeni Prisma modeli (B-03) · yeni migration (13 çekirdek adım) · yeni bağımlılık (karar kaydı + üç kanal) · yeni Electron sayfası (5-dosya; mevcut reçeteyi K2 boyutlarıyla güncelle) · yeni mobil ekran (kabuk kalıbı) · yeni ESLint kuralı (ölç→sonda→baseline) · ölü paket kaldırma.

### 4.5 CI + hook + harness
`ci.yml`: `adnansahin` kaldır; Electron typecheck `npm run typecheck`; her projede `check-lint-baseline --kontrol`; mobil job'u doğrula (varsa lint komutunu hook'la aynı yap). `.githooks/pre-commit` + `scripts/hooks/pre-commit.mjs` (adımlar K8; staged dosyalardan proje çözümü bash-guard'daki mantıkla ortak modül) + `npm run hooks:kur` (kök package.json) + GELISTIRME-DONGUSU'na kurulum satırı. `bash-guard.mjs` commit dalına lint + baseline ekle; `hook-cases.json` genişlet. `.claude/rules/backend-standart.md` (`Teks-Erp/src/**`), `electron-standart.md` (`Electron/src/**`), `mobil-standart.md` (`mobil/src/**`), `kutuphane.md` (`**/package.json`) — ince işaretçi. `check-docs.mjs` boyut kapsamı.

### 4.6 Belge düzeltmeleri
B-01…B-11 + 2.x'te "belge yanlış" işaretli her cümle (kök CLAUDE.md: clientToken 15, uzay envanteri 10, soft-delete istisnaları, "saatler"; Teks-Erp/CLAUDE.md: katman cümleleri, DB kuralı 4, paket listesi, requireFinanceEnabled, "saatler"; Electron/CLAUDE.md: zod uyumu, stryker/e2e; mobil/CLAUDE.md: font, test dizini, paketler, ReasonPresetPicker). `docs/kurallar/` ilgili alan dosyalarına (eszamanlilik/idempotency, deploy-kurulum, yetki-izin) kısa ek; `docs/history/CLAUDE-NOT-ARSIVI.md`'ye dokunma.

### 4.7 Rapor
`docs/history/standart-2026-09-05/UYGULAMA-OZETI.md`: karar tablosu (varsayılan → alınan → gerekçe) · kimlik akıbet tablosu (İ/M/B/K/E/Y/ES/BELİRSİZ, hepsi) · ESLint tablosu (kural × proje × ihlal × karar × sonda sonucu) · baseline sayıları · kaldırılan paketler · migration listesi + prova notu · koşulan bekçi/lint/tsc/test çıktıları (özet + çıkış kodu) · bilinen borç · sonraki adımlar.

## 5. Uygulama planı (workflow; ajanlar sonuçlarını `docs/history/standart-2026-09-05/olcum/` altına da yazar)

**Faz 0 — Yeşile çek + ölçüm (Opus high):** Y-01…Y-04 (tek ajan, sıralı; sonra Electron `npm run typecheck` + `npx vitest run` çıkış kodu 0, backend `npm test` 453/453). Paralel ölçüm ajanları (salt-okunur): ESLint adayları üç projede `--format json` (kural × sayı × ilk 5 örnek); BELİRSİZ-01 (Electron `.filter(`); K-01 üç kanal doğrulaması; M-01 tablo satır sayıları; E-01 scripts/ lint ihlalleri; `projectService` süresi. Çıktı `olcum/*.json`.

**Faz 1 — Belge (dosya başına 1 ajan, paralel; README+ILKELER tek ajan):** 10 dosya, §2 kanıtlarıyla, K-kararlarıyla. Ardından **tutarlılık hakemi** (Opus xhigh): dosyalar arası çelişki · KOD-KURALLARI/kurallar/ ile çakışma · kanıtsız/etiketsiz kural · boyut >24 KB → düzeltme listesi → uygulanır.

**Faz 2 — ESLint + baseline (proje başına 1 ajan, paralel; farklı dosyalar, worktree gerekmez) + `check-lint-baseline.mjs` (1 ajan):** sonda sonuçları `olcum/sonda-<proje>.json`.

**Faz 3 — Kod düzeltme (madde başına ajan; aynı dosyaya dokunanlar sıralı):** önce İ-14, İ-10; sonra kalan İ; M-01/02/05 tek ajan (migration + apply + üç bekçi); K-01/K-03 tek ajan (paket başına doğrula-kaldır-test). Her ajan: dokunduğu alanın bekçileri + typecheck çıkış kodu.

**Faz 4 — Reçete + CI + hook + harness + belge düzeltmeleri (2-3 ajan):** 4.4, 4.5, 4.6.

**Faz 5 — Doğrulama (paralel):** `node scripts/check-docs.mjs` · üç projede lint + baseline `--kontrol` + typecheck · backend `npm test` tam · Electron vitest · mobil jest · hook testi (`hook-cases.json` + `.githooks` kuru koşum) · `git diff --stat`. Kırmızı → düzelt.

**Faz 6 — Tamlık eleştirmeni (Opus xhigh):** "§4'teki teslimatlardan eksik/yarım olan? §2'deki kimliklerden akıbeti yazılmayan? Sondasız ESLint kuralı? Kanıtsız kural? Belgede hâlâ yanlış cümle?" → kapat → rapor.

**Model/bütçe:** uygulama Opus `high`; hakem/eleştirmen Opus `xhigh`; Fable YOK; Sonnet YOK. Limit kesintisine karşı her faz sonunda commit + disk çıktıları.

## 6. Kısıtlar (pazarlık dışı)
- **PRODUCTION CANLI:** `migrate reset` / `db push` / reseed / toplu DELETE YOK; dev DB `tekserp_demo`; migration'lar K4'teki üçüyle sınırlı ve additive; bekçiler `hedefDbEngeli` disiplinine uyar.
- Sırlar (süperadmin parola/PIN/TOTP, ayar şifresi) hiçbir dosyaya/log'a girmez.
- `pkill -f tsx` YASAK; sunucu gerekirse `PORT=<port> npx tsx src/server.ts`, kendi PID'ini durdur (HTTP ayaklı bekçiler için 4100/4101/4104/4112/4122).
- PreToolUse hook Bash komut METNİNİ tarar → yasaklı dizeleri içeren belge metnini Write/Edit ile yaz; `TEKSERP_HOOK_SKIP=1` yalnız kullanıcı kararıyla.
- Dal: `feature/belge-katmani-yeniden-yapilandirma` üstünden `feature/kod-standardi` aç (harness/kurallar orada; `main`'e merge edilmedi). **Her faz sonunda commit** (Türkçe mesaj, gövdede ölçüm sayıları; `Co-Authored-By` satırı); push ETME.
- `docs/kurallar/*`, `KOD-KURALLARI.md`, alan `.claude/rules/*` yeniden YAZILMAZ; yalnız düzeltme/bağ.
- ESLint'e ölçülmemiş kural girmez; CI kırmızı bırakılmaz; "koştum" cümlesi çıkış koduyla gelir.
- Devralınan kodda toplu kampanya YOK (yorum temizliği, class→fonksiyon, include→select, hex→token): baseline'a girer.

## 7. Kabul ölçütleri (rapora ✅/❌ tablo; hepsi ✅ olmadan bitmiş sayılmaz)
1. main-kaynaklı kırmızılar yeşil: Electron typecheck 0 hata, vitest 0 fail, backend `npm test` 453/453 (atlanan bölümler ÇIKTIDA görünür), CI Electron typecheck gerçek.
2. `docs/standart/` 10 dosya; her kural etiketli + kanıtlı; `check-docs` yeşil; ≤24 KB.
3. Üç projede lint yeşil; `lint-baseline.json` üçünde; `--kontrol` CI + hook'ta; 2.10 tablosundaki her kural için karar + sonda kaydı.
4. İ-01…İ-26, M-01/02/05, K-01/03, E-01…05, B-01…11, Y-01…04, ES-01…03, BELİRSİZ-01: her kimliğin akıbeti raporda.
5. 8 reçete RECETELER'de; 4 `.claude/rules/*` işaretçisi; CLAUDE.md bağları; `Teks-Erp/CLAUDE.md` paket cümlesi "kayıtlı karar" oldu.
6. `ci.yml` YAML geçerli, adnansahin yok; `.githooks/pre-commit` + `hooks:kur` çalışıyor (kuru koşum çıktısı raporda); bash-guard `hook-cases.json` yeşil.
7. Migration'lar dev'de uygulandı; `test_db_invariants` + `test_schema_drift` + `check-migrations` yeşil; prova notu raporda.
8. Kaldırılan paketler sonrası üç projede typecheck + test yeşil; mobil native değişikliği raporda "sonraki APK".
9. Dokunulan alanların bekçileri yeşil (BEKCI-HARITASI'ndan çözülmüş liste raporda).
10. Faz başına commit; `UYGULAMA-OZETI.md` yazıldı; bilinen borç ve ES-BOŞLUK tabloları dolu.
