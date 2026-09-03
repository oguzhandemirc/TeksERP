# Adnan Şahin ERP — Admin (`Electron/`)

Electron 42 + React 19 + TypeScript + Vite. Yönetim paneli; saha akışı yok. Backend `Teks-Erp/` (Express 5 + Prisma 7) ile HTTP üzerinden konuşur.

> Root `CLAUDE.md` ve `Teks-Erp/ARCHITECTURE.md` domain referansıdır.

> ⚠️ Profil gerçeği — "Adnan Şahin ERP" bugünkü **paket kimliğidir**, ürünün adı değil: `package.json` `productName` ve `appId: com.etkiliyazilim.adnan-sahin-erp` sabittir ve müşteriyle BİRLİKTE TÜREMEZ — `deploy/electron-paketle.sh` yalnız `shared/musteri.json`u (kod/ad/ERP adresi) yazar. İkinci müşteride panel yine bu adla kurulur; çözüm `if (musteri === 'X')` değil, paket kimliğini `musteri.json`dan türetmektir (ayrı karar). bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §11 son madde.

## Komutlar

```bash
npm run dev            # electron-vite dev (renderer port 5174 + main + preload)
npm run build          # production bundle
npm run build:mac      # .dmg
npm run build:win      # NSIS installer
npm run typecheck      # main + renderer type check
npm run lint
npm test               # vitest run (birim testleri)
npm run test:mutation  # stryker (mutation testing — MUTATION-TESTING.md)
npm run e2e            # playwright (build + e2e)
npm run electron:rebuild  # native modülleri yeniden derle (serialport, node-hid — tartı/tarayıcı)
```

## Environment

```
VITE_API_BASE_URL=http://localhost:4000
APP_ENV=development
```

## Mimari

```
Electron/
├── electron/                # Main process — Node, OS API erişimi
│   ├── main.ts              # BrowserWindow, lifecycle, secure defaults
│   ├── preload.ts           # contextBridge → window.api
│   ├── menu.ts              # OS native menu
│   └── ipc/                 # Domain-bazlı IPC handler (her dosya 1 domain)
├── shared/                  # Main ↔ renderer paylaşılan tipler
│   └── ipc-contract.ts
├── src/                     # Renderer (React)
│   ├── App.tsx              # Provider'lar (theme, query, router, toaster)
│   ├── router.tsx           # HashRouter, ProtectedRoute, route map
│   ├── components/
│   │   ├── ui/              # shadcn/ui primitives (button, dialog, table...)
│   │   ├── layout/          # AppShell, Sidebar, Topbar, CommandPalette, PageHeader
│   │   ├── data-table/      # DataTable, DataTablePagination, DataTableToolbar
│   │   ├── forms/           # EntityFormDialog, ConfirmDialog, FormField
│   │   ├── PermissionGate.tsx
│   │   └── ProtectedRoute.tsx
│   ├── hooks/               # useDataTable, useCrudMutations, useRoleAccess
│   ├── pages/<Modul>/       # Her modül kendi klasörü — küçük dosyalara böl
│   ├── services/            # apiClient, crudService factory, authService
│   ├── store/               # auth (zustand)
│   ├── types/               # api, auth (backend kontrat eşleşmesi)
│   └── lib/                 # utils, query-builder, secure-token, jwt
```

## Process Boundary — pazarlık dışı

| Renderer (src/) | Main (electron/) |
|---|---|
| `electron`, `fs`, `path`, `child_process`, `os`, `net` import etmez | tüm Node API'larına erişim var |
| Native API'lere yalnız `window.api` üzerinden ulaşır | `window.api`'yı `contextBridge` ile expose eder |
| HTTP `axios` üzerinden — `apiClient.ts` tek geçit | HTTP başlatmaz; backend ile renderer konuşur |
| `localStorage`'a TOKEN YAZMAZ | `safeStorage` + `electron-store` ile şifreli saklar |

`webPreferences` zorunlu: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. Bunlardan birini gevşetme.

## IPC Pattern (yeni kanal eklerken 4 adım)

1. **`shared/ipc-contract.ts`'ye tip ekle.** Hem main hem renderer aynı kontrata bakar.
2. **`electron/ipc/<domain>.ipc.ts`'ye `ipcMain.handle/on` yaz.** Her dosya tek domain.
3. **`electron/preload.ts`'ye köprü ekle** — sadece serializable veri geçer.
4. **Renderer'da `window.api.<domain>.<action>(...)` ile çağır.**

## Otomatik Güncelleme (2026-08-26)

Panel kendi kendini günceller — setup artık elden ele taşınmaz. Reçete:
[`docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`](../docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md).

**Sürüm çıkarırken tek kritik adım: `package.json > version` ARTIRILMALI.**
Artırılmazsa kurulu paneller "en güncelim" der ve yeni setup'ı hiç indirmez.

| Kural | Neden |
|---|---|
| Yayın adresi TEK KAYNAK: `shared/update-feed.ts` ↔ `package.json > build.publish` | Ayrışma SESSİZ arıza üretir (uygulama A'ya bakar, ekran B yazar). Bekçi: `src/test/update-feed-url.test.ts` |
| `build.<mac\|win>.artifactName` ASCII kalmalı — `${productName}` KULLANMA | Ad `latest.yml` içinde URL'dir; "Adnan Şahin ERP-…exe" adındaki `Ş`+boşluk aktarımda bozulup 404 üretir. Bekçi aynı dosyada |
| `autoUpdater`a modül gövdesinde DOKUNMA | O bir getter — ilk erişimde Electron `app`ine dokunur; import anında sökülürse `app` henüz yoktur. `updater()` ile ilk kullanıma ertelenir |
| `autoInstallOnAppQuit` KAPALI kalmalı | Kurulum "Program Files"a yazdığı için yönetici izni ister; kapanışta tetiklenirse operatör gittikten sonra ekranda cevapsız izin penceresi asılı kalır |
| Şerit yalnız `ready` durumunda | `error` şeridi, internetsiz makinede her açılışta çıkıp körleştirir — hata Bu Bilgisayar → Güncelleme'de yazılı |

⚠️ **`nsis.perMachine: true`** (uygulama Program Files'ta) → her güncellemede bir kez
Windows izin penceresi. **O makinedeki hesap yönetici değilse güncelleme O MAKİNEDE
kurulmaz** ve panel sessizce eski sürümde kalır. Değiştirmek tek satır, ama bir elle
tur daha ister.

## API Kontratı

Backend `Teks-Erp/` döndüğü şekiller — `src/types/api.ts`:

```ts
ApiResponse<T> { success, data, message? }
PaginatedResponse<T> { success, data: T[], pagination: {...} }
QueryParams { page, pageSize, sortBy, sortOrder, filters, search? }
```

**Hata davranışı (`apiClient.ts` interceptor):**
- 401 → token sil + `#/login`
- 403 → "yetkin yok" toast
- 4xx → backend `message` toast
- 5xx → "sunucu hatası" toast

Sonuç: mutation'larda `onError` ile generic toast atma — duplicate olur.

## RBAC

JWT yalnız `permissions[]` taşır (rol modeli **yok** — backend `UserPermission` ile doğrudan kullanıcıya bağlar). `useRoleAccess` ile UI kontrol:

```tsx
const { isAdmin, hasPermission, hasAnyPermission, hasAllPermissions } = useRoleAccess();
{isAdmin && <Button>Sil</Button>}
<PermissionGate permission="admin:users"><Button>Yeni</Button></PermissionGate>
```

`isAdmin = hasAdminAccess(permissions)` → `admin:users | admin:settings | admin:*` permission'larından herhangi biri varsa true. **`hasRole` yok** — tüm yetki kontrolü permission bazlı.

> ⚠️ **Eksik/bayat (2026-09-03):** `hasAdminAccess` artık düz `includes` değil **`matchesPermission`** ile ölçer (`src/types/auth.ts` — `hasAdminAccess` → `ADMIN_PERMISSION_LIST.some(p => matchesPermission(...))`) → **global `"*"` de true döner**. Bu, süperadmin (satıcı) hesabı içindir: backend `getEffectivePermissions` ona `["*"]` verir, DB'de grant satırı doğmaz. Düz `includes` yazımına geri dönme — `adminOnly` karolar (`SystemHubPage`) izin dalına HİÇ düşmediği için belirti KISMİ ve sessiz olur.

**Uygulamaya kabul (`canEnterApp`):** Kullanıcının en az bir **mobil-olmayan (masaüstü) izni** olmalı — yalnız `mobile:*` izinli hesaplar panele giremez (backend `login`'de `clientType='electron'` iken 403 döner, token bile üretmez). Admin-only sayfalar `<ProtectedRoute requirePermission="admin:*">` ile kilitli.

**Belge tasarım ekranları = `document-template:read/write` (2026-08-05):** Tanımlar → Çıktılar altındaki dört kart (Belge Şablonları · Refakat Kartı · Refakat Kartı Şablonları · Serbest Belgeler) artık düz `admin:settings` değil; liste `src/lib/permissions.ts` (`DOCUMENT_DESIGN_READ` / `DOCUMENT_DESIGN_WRITE`) — **backend `Teks-Erp/src/constants/document-design.ts`'in aynası**, ikisi birlikte değişir. Route (`content-routes.requireAnyPermission`) ile kart (`tile-config.permissionAny`) **aynı listeyi** taşımalı; ayrışırsa kart görünür, tıklayınca `/forbidden`. `admin:settings` her ikisinde de var (kilitlenme sigortası) ve READ, WRITE'ı kapsar. Salt-okuma gerçek: `PermissionGate anyOf={DOCUMENT_DESIGN_READ}` ile ekran açılır, Kaydet `canWrite` ile kapatılır, stüdyodaki yazma aksiyonları `readOnly` ile **çizilmez**. `DefinitionsHubPage`'teki `isAdmin` kısa devresi korunuyor — dar izinli kullanıcı admin DEĞİLDİR, kartı `permissionAny` dalından görür. Bekçi: `Teks-Erp/scripts/test_document_template_permission.ts`.

**Genel Ayarlar = geniş kapı, dar içerik (2026-08-05):** `/system/settings` route'u `admin:settings` **veya** `settings:workstation` ile açılır; sayfa kategorileri `visibleSettingsCategories` ile SÜZER — dar izinli kullanıcı yalnız **"Bu Bilgisayar"** (yazıcı/kantar/tabanca/sunucu adresi) kategorisini görür, sistem geneli kategoriler salt-okunur bile olsa listeye GİRMEZ. Gerekçe: bu sekmedeki ayarların hiçbiri sunucuya yazılmaz (yerel `machine-config`), etkisi tek makineyle sınırlıdır. Yeni kategori eklerken varsayılan DARdır (`permissionAny` verilmezse `admin:settings`) — izin yazmayı unutmak kategoriyi gizler, sızdırmaz. ⚠️ Sistem hub'ı (`/system`) hâlâ `admin:settings` ister; dar izinli kullanıcının ekrana ULAŞTIĞI yol kişisel **Ayarlar** sayfasındaki "Bu Bilgisayar" kartıdır — yeni bir dar-izin ekranı eklerken "izni verdim ama yolu vermedim" tuzağını hatırla. Bekçi: `Teks-Erp/scripts/test_workstation_permission.ts` (Electron sabiti ile backend kodunun birebirliğini de kilitler).

## CRUD Pattern (yeni Master Data sayfası 5 dosya)

```
pages/<Module>/
├── types.ts             # Backend modeli interface'i
├── service.ts           # createCrudService<T>("/api/...")
├── schema.ts            # zod form schema + defaults
├── columns.tsx          # ColumnDef<T>[]
├── <Module>FormDialog.tsx   # EntityFormDialog wrapper
└── <Module>Page.tsx     # useDataTable + useCrudMutations + DataTable
```


## Sayfa İskeleti (Ortak Layout — KRİTİK)

Sekme paneli (`TabHost`) HER sayfayı `absolute inset-0 overflow-auto` ile sarar.
Bu yüzden bir sayfa kendi yüksekliğini kısıtlamazsa **tüm panel kayar** ve sabit
başlık/footer görünümden çıkar. Her liste/içerik sayfası **tek içsel kaydırma
bölgesi** + **sabit başlık/araç çubuğu/footer** kalıbını kullanır. Ortak
primitifler: `src/components/layout/PageShell.tsx`.

```tsx
<PageShell>                              {/* flex h-full min-h-0 flex-col — paneli doldurur */}
  <PageHeader ... />                     {/* sabit chrome (shrink-0) */}
  <SomeToolbar />                        {/* sabit — arama/filtre satırı */}
  <PageBody className="p-6">…liste…</PageBody>   {/* min-h-0 flex-1 overflow-auto — TEK kaydırıcı */}
  <PageFooter>…butonlar…</PageFooter>    {/* shrink-0 border-t — alta SABİTLENİR (opsiyonel) */}
</PageShell>
```

- **Alttaki butonlar SABİT.** Aksiyon çubuğu `PageBody`'den SONRA, `PageShell`'in
  son çocuğu olarak `<PageFooter>` içine konur → liste kayarken yerinde kalır.
  "Kaydet/İptal" gibi eylemleri asla kaydırılan gövdenin içine koyma.
- **Sadece liste kayar.** Başlık/toolbar/footer `shrink-0`; yalnız `PageBody`
  scroll eder. `PageBody` `min-h-0` içerir — bu olmadan flex çocuğu içeriğe göre
  büyür ve panel kayar (en sık hata).
- **DataTable sayfaları:** `<DataTable>` kendi kaydırma bölgesini + pinlenen
  pagination footer'ını yönetir → ayrı `PageBody` GEREKMEZ; kök `<PageShell>`
  yeter, `DataTable` doğrudan `flex-1` çocuk olur. `CrudPage` bunu zaten yapar.
- **Sonsuz kaydırma = otomatik.** "Daha Fazla Yükle" butonu YOK. Liste dibine
  gelince sonraki cursor sayfası otomatik yüklenir:
  - `useDataTable` + `DataTable` kullanan tablolar bunu **hazır** alır
    (`DataTable` içindeki `useInfiniteScroll` sentinel'i; footer yalnız durum:
    "Yükleniyor… / Tüm kayıtlar yüklendi").
  - Özel `useInfiniteQuery` listelerinde (kart grid, feed): `useInfiniteScroll`
    hook'unu kullan — `rootRef`'i `<PageBody>`'ye, `sentinelRef`'i listenin
    sonundaki `<AutoLoadMore>` göstergesine bağla (`src/components/data-table/AutoLoadMore.tsx`).

```tsx
const { rootRef, sentinelRef } = useInfiniteScroll({
  hasMore: query.hasNextPage,
  isLoading: query.isFetchingNextPage,
  onLoadMore: () => void query.fetchNextPage(),
});
// …
<PageBody ref={rootRef} className="p-6">
  {items.map(...)}
  <AutoLoadMore ref={sentinelRef} hasMore={query.hasNextPage}
    isFetchingMore={query.isFetchingNextPage} count={items.length} />
</PageBody>
```

Tam-ekran editörler (İş Emri formu, Genel Ayarlar) kökte `PageShell`, altta
`PageFooter` kullanır; çok-panelli iç flex düzenini bozmadan orta panel kendi
`overflow-auto`'suyla kayar.

## Gezinme: her sekme AYRI bir tarayıcıdır (2026-08-22)

`TabHost` her sekmeyi kendi **memory router**'ında yaşatır (`tabs/tab-routers.tsx`)
ve uygulama kabuğu bilerek bir data-router DIŞINDA render edilir (`App.tsx`).
Bunun iki sonucu var ve ikisi de saha hatası üretti:

- **`navigate(-1)` GARANTİ DEĞİLDİR.** Menüden/hub'dan/yeni sekmeden/oturum geri
  yüklemesinden açılan sekme DOĞRUDAN o sayfada başlar → geçmiş tek girişliktir,
  geri çağrısı **sessizce hiçbir şey yapmaz** ("geri tuşu çalışmıyor" şikâyeti).
  Kural: geri hareketi **her zaman bir yedeğe düşmeli**. `PageHeader` bunu tek
  yerde çözer — `onBack` > sekme geçmişi > breadcrumb üstü — ve ok yalnız
  üçünden biri varsa çizilir. Yeni bir "geri" yüzeyi yazarken bu sırayı
  kopyalama, `PageHeader`'ı kullan.
- **⚠️ "Geri gidilebilir mi?" `location.key` ile ÇÖZÜLMEZ.** Memory router geçmiş
  indeksini vermez ve `key !== "default"` sezgisi YANILTIR: liste sayfaları
  açılışta `setSearchParams(…, { replace: true })` ile varsayılan sekmeyi/filtreyi
  URL'e yazar → anahtar değişir ama geçmiş BÜYÜMEZ. Saha tarifi buydu: geri tuşu
  Raporlar/Yetkilendirme/Sistem'de çalışıyor, Tanımlar/Operasyon'da (URL yazan
  listeler) çalışmıyor. Tek doğru kaynak sekme başına derinlik defteri:
  `tabs/history-depth.ts` (PUSH +1 · POP −1 · **REPLACE değişmez**), sekme kimliği
  `useTabId()` ile gelir. Bekçiler: `tabs/history-depth.test.ts`,
  `components/layout/PageHeader.test.tsx`.
- **Router'dan geçen gezinme sekme defterini GÜNCELLEMEZ.** `useNavigate()` ile
  yapılan her hareket (geri oku, breadcrumb, sayfa içi `navigate()`) store'u
  atlar; şerit başlığı ve sidebar eşleşmesi bayat kalırdı. `TabRouter` artık
  router'a abone olup `syncTabLocation` ile defteri eşitler (yol DEĞİŞTİYSE —
  sayfaların `updateTabTitle` ile yazdığı özel başlık korunsun diye). Bekçi:
  `store/tabs.back.test.ts`.
- **Tık hedefi İKİ sözleşme, karıştırma** (`tabs/use-tab-target.ts`): kenar menüsü
  `useTabTarget` (sol tık → sekme aç/odakla; menü BAŞKA bir işe geçiştir, açık
  işi düşürmez — 2026-08-17), hub kartı `useDrillTarget` (sol tık → AYNI sekmede
  yerinde in; kart aynı işin bir adımıdır). Kart da sekme açtığı sürece şerit
  doluyordu ve yeni sekmenin geçmişi tek girişlik olduğu için geri oku gerçek
  geçmişe basamıyordu. İkisinde de sağ/orta tık → arka planda yeni sekme.
  Bekçi: `components/hub/HubCard.test.tsx`.
- **Klavye/fare geri hareketlerinde `preventDefault()` ŞART.** Tarayıcının kendi
  geçmişi memory router'ları tanımaz; varsayılan davranış webContents geçmişini
  sarar ve kullanıcıyı oturum-dışı router'a (login) düşürebilir. `Alt+←` ve fare
  yan tuşları `useGlobalShortcuts` içinde tek kapıdan `backActive()`e bağlanır.

## Sidebar Kuralı (KRİTİK)

Sidebar'da **her tanım ayrı satır YOK.** Tek "Tanımlar" girişi var; tıklayınca `/definitions` hub sayfası açılır, kart grid'i her tanım modülüne gönderir. Yeni master data eklerken `pages/Definitions/tile-config.ts` → kart ekle, `router.tsx` → route ekle. Sidebar'a ekleme.

## Belge Kolonu Ekleme — iç veri taşıyorsa OPT-IN (2026-07-30)

`DocumentConfig.columns[tablo].hidden` bir **BLOCKLIST**'tir: yeni bir kolon mevcut
config'lerde `hidden` içinde olmadığı için **varsayılan GÖRÜNÜR** doğar. Bu, iç veri
(çuval notu gibi) için yanlış varsayılandır — müşteriye giden belgeye sızar.

- **İç/hassas veri kolonu** → `DocTableDef.columns[].defaultHidden: true` (Electron kaydı)
  **ve** renderer'da `DocCol.defaultHidden: true`. Bu kolonlar **ALLOWLIST** ile açılır:
  `columns[tablo].shown` içinde adı geçmiyorsa basılmaz ve o kolonda **`hidden` YOK SAYILIR**
  (tri-state — `document-render/doc-table.ts` `applyColumnCfg`).
- Backend aynası zorunlu: `system-setting.service.ts` `DocumentConfig.columns` tipi **ve**
  `sanitizeDocumentsConfig` kayıt kapısı (`entry.hidden?.length || entry.order?.length ||
  entry.shown?.length`). Kapıya `shown` eklenmezse yalnız opt-in kolon açılmış satır
  **sessizce atılır**: kullanıcı kolonu açar, ayar kaydolmaz, sebebi hiçbir yerde görünmez.
- **Tek seferlik baskı bayrağı** (`?rowNotes=1`) kalıcı ayarı **EZER** (pure OR) ve hiçbir
  yere yazılmaz — ne ayara, ne donmuş snapshot'a; yeni belge versiyonu doğurmaz. OR yalnız
  renderer'da TEK yerde uygulanır (efektif kolon ayarı kurulurken). Diyalogdaki checkbox
  `DocDef.supportsRowNotes` ile gösterilir. Referans testler: `Teks-Erp/scripts/test_sack_note_document.ts`.

## Toplu Belge (çok belgeyi TEK baskı işine birleştirme) — 2026-08-06

İş emri listesinde satır seçimi → **"Belgeleri Çıkar"** → tür seç → **Yazdır** (tek
baskı işi) veya **PDF Kaydet** (klasöre, her belge ayrı dosya). Liste TEK KAYNAKTAN
gelir (`GET /work-orders/:id/documents`) — ekran hangi belgelerin olduğunu VARSAYMAZ,
tür kutuları gerçekten bulunanlardan doğar. `src/lib/print-merge.ts` +
`pages/Operations/WorkOrders/bulkDocs.ts`. Saf Electron: backend/migration/izin YOK.

- ⚠️ **`getBulkRollLabelsHtml` PATERNİ (ilk belgenin `<head>`i + gövdeler) BURADA
  YANLIŞTIR.** O patern etiketlerde doğru çünkü tüm etiketlerin CSS'i birebir aynı;
  belgelerde ise sınıf adları GENERİK (`.sheet`, `.company`, `.cell`, `table`) ve
  aynı ad farklı değerler taşır → biri diğerini ezer, resmi belge sessizce yanlış
  görünümde basılır. Bu yüzden her belge kendi **gölge köküne** konur (declarative
  shadow DOM, `<template shadowrootmode="open">` — script GEREKMEZ; baskı iframe'i
  `allow-scripts` taşımıyor). **iframe DEĞİL:** iframe içeriği sayfalara BÖLÜNMEZ.
- ⚠️ **`@page` gövde CSS'inde KALAMAZ** (belge geneline uygulanır, son yazan kazanır
  → A5 kart A4'e basılır). Adlandırılmış sayfaya taşınır: `@page wdoc3 {…}` +
  sarmalayıcıda `page: wdoc3`. İkisi de Electron 42 motorunda ölçüldü.
- ⚠️ **CSS YORUMLARI ÖNCE SİLİNİR.** Tarayıcılar düz metne bakıyor; refakat kartının
  CSS'inde "…@page (yalnız baskı)…" diye bir AÇIKLAMA yorumu var ve yorum
  silinmeden tarandığında blok sayacı komşu `@media screen` kuralını yutuyordu →
  kart A5'te 1 yerine 2 sayfa basıyordu (hata yok, log yok). Bekçi:
  `print-merge.test.ts` "YORUM içindeki @page tuzağına düşmez".
- ⚠️ **`position: fixed` → `absolute`**: sabit filigran (İPTAL) gölge kökten taşar ve
  işteki YABANCI belgelerin sayfalarına da basardı. Bedeli bilinçli: filigran her
  sayfada değil, belgenin içinde bir kez.
- **TEK belge verilirse HTML AYNEN döner** — bugünkü tekil baskı çıktısı bayt-bayt
  korunur. **PDF yolu birleştirmeyi HİÇ kullanmaz** (`pdf:saveBatch` her belgeyi
  kendi gizli penceresinde render eder) → arşiv çıktısı tekil baskıyla birebir.
- **`print-event` YALNIZ kâğıt baskısında** bildirilir (refakat kartı sürümü orada
  ilerler); PDF'e yazmak "bastım" değildir — her arşiv indirmesinde sürüm
  ilerletmek numarayı anlamsızlaştırır.
- **Atlanan hiçbir şey sessiz değil:** belgesi olmayan iş emri, listesi alınamayan
  iş emri, HTML'i alınamayan belge ve birleştirilemeyen belge ayrı ayrı raporlanır.

## Dosya Boyutu Kuralı

- **Tek dosya 300 satırı geçmesin.** Geçiyorsa parçala.
- **Page bileşeni 200 satırı geçmesin.** Form/tablo/dialog ayrı dosyaya çıkar.
- **`columns.tsx`, `schema.ts`, `service.ts`, `types.ts` ayrı tut** — yeniden kullanılabilir.

## Picker / Dropdown Veri Çekme Kuralı

Master data picker'ları ("tümünü tek seferde göster" davranışı: renk seçici,
özellik seçici, izinli ürün listesi, vb.) için **`loadAllForPicker(service)`**
helper'ı kullan (`src/lib/picker-loader.ts`).

```tsx
// ✓ DOĞRU
const { data } = useQuery({
  queryKey: ["colors", "picker"],
  queryFn: () => loadAllForPicker(colorService),
});

// ✗ YANLIŞ — backend MAX_PAGE_SIZE değiştiğinde 400 alır
const { data } = useQuery({
  queryFn: () => colorService.getAll({ page: 1, pageSize: 500, ... }),
});
```

**Neden:** Backend `MAX_PAGE_SIZE` zamanla değişti (100 → 200 → 500); inline
`pageSize: N` kullanan picker'lar her değişiklikte 400 üretti. Helper backend
sınırıyla senkron tek kaynak (`PICKER_MAX_PAGE_SIZE`). Aşılırsa explicit
hata fırlatır — sessiz kesilmiş veri yerine cursor mode'a yönlendirir.

**Picker dataset > 500:** Master data normalde bu sınırı aşmaz. Aşıyorsa
dropdown UX zaten bozulur; arama tabanlı combobox (filter-as-you-type +
`listCursor`) gerek. `loadAllForPicker` Error fırlatıyor — UI'da yakalanmalı.

## Allowed Packages

Yenisi için onay al. Mevcutlar:

| Kategori | Paket |
|---|---|
| Electron core | `electron`, `electron-vite`, `electron-builder` |
| Native | `electron-log`, `electron-store`, `electron-window-state`, `electron-updater` |
| Donanım (native) | `serialport`, `node-hid` (tartı/tarayıcı — `electron/ipc/scale.ipc.ts`, `scanner.ipc.ts`; `electron-rebuild` ile derlenir) |
| Sunucu keşfi | `bonjour-service` (**1.4.4'e SABİT** — bkz. aşağıdaki not) |
| UI | `react`, `react-dom`, `react-router-dom`, `react-hook-form`, `@hookform/resolvers`, `zod` |
| Components | shadcn/ui (Radix + Tailwind), `cmdk`, `sonner`, `lucide-react`, `next-themes` |
| Animasyon | `framer-motion` (`src/components/motion/`, `lib/motion.ts`) |
| Style | `tailwindcss`, `@tailwindcss/vite`, `class-variance-authority`, `tailwind-merge`, `clsx` |
| State | `zustand`, `@tanstack/react-query` |
| Tablo | `@tanstack/react-table`, `@tanstack/react-virtual` |
| HTTP | `axios` |
| Date | `date-fns` |
| Charts | `recharts` |
| Drag & Drop | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| QR / Renk | `qrcode.react`, `react-colorful` |
| Export | `exceljs` (.xlsx — `src/lib/xlsx-export.ts`, `table-export.ts`), `@react-pdf/renderer` (PDF çıktı) |
| Test | `vitest` + `@testing-library/react` (birim), `@stryker-mutator/core` (mutation), `@playwright/test` (e2e) |

> **`bonjour-service` — sunucu keşfi (2026-08-26).** Saf JS, yerel derleme YOK →
> `electron:rebuild` gerekmez, `asarUnpack` gerekmez. ⚠️ **`dependencies`'te durmak
> ZORUNDA**: `externalizeDepsPlugin()` yalnız orayı okur; devDependencies'e düşerse
> Vite paketi main bundle'ına gömmeye çalışır **ve** electron-builder onu production
> `node_modules`'üne koymaz → kurulu uygulamada `MODULE_NOT_FOUND` ("dev'de çalışır,
> kurulumda ölü"). Sürüm **sabit** (`^` yok) — sonraki ana sürümler ESM-only olabilir
> ve `createRequire` yolunu sessizce kırar. Yükleme `electron/discovery/mdns-browser.ts`
> içinde TEMBEL + try/catch: paket kaybolsa bile uygulama açılır, keşif alt ağ
> taramasına düşer. Bekçi: `src/test/discovery-ipc-contract.test.ts`.

## Test Kullanıcıları

Seed **yalnız `admin / 123123`** üretir (tüm permission'lar atanmış — ~55 kod, kanonik `Teks-Erp/prisma/seed.ts`). Eski isimli test kullanıcıları (mehmet.planlama vb.) **kaldırıldı** — her reseed'de tek tek silmek zorunda kalınıyordu. Yeni kullanıcılar admin UI'sından açılır ve **yetkisiz başlar**; admin `/admin/users/:id/permissions`'tan en az bir masaüstü izni atamadıkça uygulamaya giremezler (`canEnterApp` false — yalnız `mobile:*` izinli hesap Electron login'de 403 alır).

> ⚠️ **Sayı bayat (2026-09-03):** seed admine **katalogdaki tüm izinleri** atar ve bugün bu **86** koddur (`Teks-Erp/prisma/seed.ts`, `PERMISSION_CATALOG.length`); "~55 kod" ifadesi 2026-08 öncesine aittir. Sayıyı sabitleme — "katalogdaki tüm izinler" yeterli.

## Yeni Sayfa Kontrol Listesi

- [ ] `pages/<Module>/` klasörü açıldı, dosyalar parçalı
- [ ] Kök `<PageShell>`, kaydırılan gövde `<PageBody>`, alt butonlar `<PageFooter>` (bkz. **Sayfa İskeleti**); özel `useInfiniteQuery` listesi ise `useInfiniteScroll` + `<AutoLoadMore>` (manuel "Daha Fazla" YOK)
- [ ] `service.ts` `createCrudService` ile yazıldı
- [ ] `schema.ts` zod ile yazıldı, `Partial<T>` payload backend'le uyuyor
- [ ] `columns.tsx` `ColumnDef<T>[]` döner, hücreler `format`/`Badge` ile temiz
- [ ] Page `useDataTable` + `useCrudMutations` + `DataTable` + `EntityFormDialog` kullanıyor
- [ ] `<PermissionGate>` ile yazma butonları gating'li
- [ ] Route `router.tsx`'e `<ProtectedRoute requirePermission="...">` ile eklendi
- [ ] Tanımlar sayfasıysa `tile-config.ts`'e kart eklendi
- [ ] Hiç `any` yok, mutation'da `onError` toast yok
- [ ] Dosya 300 satırı geçmiyor

## Version Gotchas

- **Tailwind 4:** `@import "tailwindcss"` + `@theme` — `tailwind.config.js` yok
- **React Router 7:** `createHashRouter` (Electron file:// için zorunlu)
- **Zod v4:** `z.record(z.string(), z.unknown())` iki arg
- **Electron 33+ ESM main:** `import.meta.url`, `path.dirname(fileURLToPath(...))` paterni
- **TanStack Query 5:** object-based API (`useQuery({ queryKey, queryFn })`)
- **electron-store 11:** named import `Store`, ESM-only
