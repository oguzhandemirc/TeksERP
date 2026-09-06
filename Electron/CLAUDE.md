# TeksERP Panel — Admin (`Electron/`)

Electron 42 + React 19 + TypeScript + Vite. Yönetim paneli; saha akışı yok; backend `Teks-Erp/` ile HTTP üzerinden. Domain kuralları kök `CLAUDE.md`; alan kuralları `docs/kurallar/<alan>.md`; teknik desenler `docs/KOD-KURALLARI.md`. Bu dosya yalnız panel-geneli düzeni taşır (yeniden yazım 2026-09-05; önceki sürüm git `6695afc2`).

> Paket kimliği (`productName` "Adnan Şahin ERP", `appId com.etkiliyazilim.adnan-sahin-erp`) SABİTTİR ve müşteriyle türemez; müşteri farkı yalnız `shared/musteri.json` (kod/ad/ERP adresi). Kimliği müşteriden türetmek ayrı bir karardır — `if (musteri === 'X')` değil.

## Komutlar ve ortam

```bash
npm run dev          # electron-vite dev (renderer 5174 + main + preload)
npm run dev:web / build:web   # web paneli (dist-web → backend paketine girer; BossShell / patron modülü)
npm run build · build:mac · build:win   # ⚠️ ham build:win KULLANMA — deploy/electron-paketle.sh <müşteri>
npm run typecheck · lint · test (vitest, 211 dosya / 2.283 vaka / ~27 sn — commit kapısında)
# test:mutation (stryker) ve e2e (playwright) KAPI DEĞİLDİR: stryker CI'da hiç koşmaz, e2e continue-on-error.
npm run electron:rebuild   # serialport, node-hid
```
`VITE_API_BASE_URL=http://localhost:4000`, `APP_ENV=development`. Skill'ler: `.claude/skills/electron-admin-page`, `electron-ipc-handler`.

## Mimari ve süreç sınırı

- `electron/` main (main.ts, preload.ts, menu.ts, `ipc/<domain>.ipc.ts`, `discovery/`) · `shared/` (ipc-contract, update-feed, musteri.json) · `src/` renderer: `App.tsx` (provider'lar), `router.tsx` **yalnız oturum-dışı router**; içerik route'ları `src/routes/content-routes.tsx`; `components/{ui,layout,data-table,forms}`, `hooks/`, `pages/<Modul>/`, `services/` (apiClient tek geçit), `store/`, `types/`, `lib/`, `providers/`, `components/layout/tabs/` (sekme router'ları, derinlik defteri).
- **Process boundary pazarlık dışı:** renderer `electron/fs/path/child_process/os/net` import etmez; native API yalnız `window.api`; `webPreferences` `sandbox:true, contextIsolation:true, nodeIntegration:false`. Token `safeStorage` + `electron-store`; renderer `localStorage`'a token YAZMAZ (tek istisna web build).
- **Yeni IPC kanalı 4 adım:** `shared/ipc-contract.ts` tip → `electron/ipc/<domain>.ipc.ts` handler → `preload.ts` köprü (yalnız serializable) → `window.api.<domain>.<action>`.
- Backend yanıt şekilleri `src/types/api.ts` (`ApiResponse`, `PaginatedResponse`, `QueryParams`); servis yolları TAM (`/api/...`, öneksiz 404'ü FilterBar "Sonuç yok" olarak yutar). `apiClient` interceptor: 401 token sil + auth store kapısı; 403 "yetkin yok" (üç dar istisna: Access oturumu, ayar şifresi, login); 4xx backend mesajı; 5xx generic → mutation `onError`'da ikinci toast YOK.

## Yetki

JWT yalnız `permissions[]`; `useRoleAccess` → `isAdmin`/`hasPermission`/…; `<PermissionGate>` yazma butonlarını kapatır. `hasAdminAccess` `matchesPermission` ile ölçer (global `"*"` = süperadmin, düz `includes`e dönme). `canEnterApp`: en az bir masaüstü izni (yalnız `mobile:*` → 403). Kart (`tile-config.permissionAny`) ↔ route (`content-routes.requireAnyPermission`) AYNI liste; izin kümeleri backend `document-design.ts`/`workstation`ın aynası `src/lib/permissions.ts`. Genel Ayarlar geniş kapı dar içerik (`visibleSettingsCategories`). Ayrıntı: `docs/kurallar/yetki-izin.md`, `superadmin.md`, `modul-bayrak.md`.

## Sayfa kalıpları

- **Yeni master data sayfası 5 dosya:** `pages/<Module>/` → `types.ts` · `service.ts` (`createCrudService`) · `schema.ts` (zod; ⚠️ backend master-data CRUD'da Zod YOKTUR — `BaseController` gövdeyi doğrudan servise geçirir, yani panel şeması TEK KAPIDIR ve `max(n)` Prisma `@db.VarChar(n)` ile birebir olmalıdır) · `columns.tsx` · `<Module>FormDialog.tsx` + `<Module>Page.tsx` (`useDataTable` + `useCrudMutations` + `DataTable` + `EntityFormDialog`). Route `content-routes.tsx` (`ProtectedRoute requirePermission`) + backend `screen-catalog.ts` girdisi (HER route için, `modul` zorunlu); ekranın hub'ı varsa ilgili `tile-config.ts`e karo (izin listesi route ile birebir), karosuzsa `command-entries.ts`e palet girişi; **Sidebar'a satır EKLENMEZ**. Reçete: `docs/RECETELER.md` § Electron sayfası.
- **Sayfa iskeleti (KRİTİK):** `TabHost` her sayfayı `absolute inset-0` sarar → `<PageShell>` (flex h-full min-h-0) · sabit `PageHeader`/toolbar · TEK kaydırıcı `<PageBody min-h-0>` · `<PageFooter>` sabit butonlar. `DataTable`/`CrudPage` kendi kaydırıcısını yönetir. Sonsuz kaydırma otomatik (`useInfiniteScroll` + `<AutoLoadMore>`); "Daha Fazla Yükle" YOK.
- **Gezinme:** her sekme kendi memory router'ında; `navigate(-1)` garanti değil — geri daima yedeğe düşer ve tek yer `PageHeader` (`onBack` > sekme geçmişi > breadcrumb); derinlik `tabs/history-depth.ts` (PUSH+1/POP−1/REPLACE değişmez), `location.key` ile çözülmez; `TabRouter` `syncTabLocation` ile defteri eşitler; kenar menüsü `useTabTarget`, hub kartı `useDrillTarget`; `Alt+←`/fare yan tuşları `preventDefault` + `backActive()`. Bekçiler `tabs/history-depth.test.ts`, `PageHeader.test.tsx`, `store/tabs.back.test.ts`, `HubCard.test.tsx`.
- Ayrıntı alan dosyalarında: iskelet/gezinme `docs/kurallar/filtre-liste.md`, süreç sınırı `docs/kurallar/kesif-cihaz.md`, belge/baskı `docs/kurallar/belge-etiket.md`.
- **Picker:** `loadAllForPicker(service)` (`lib/picker-loader.ts`); inline `pageSize:N` yazma (backend `MAX_PAGE_SIZE` değişince 400). >500 kayıt → arama tabanlı combobox.
- **Belge/etiket/baskı:** baskı iframe'leri `sandbox="allow-same-origin allow-modals"` (`allow-scripts` YOK); iç veri kolonu OPT-IN (`defaultHidden` + `shown` allowlist, `sanitizeDocumentsConfig` aynası zorunlu); toplu belge her belgeyi kendi shadow DOM köküne koyar, `@page` adlandırılmış, CSS yorumları önce silinir; `print-event` yalnız kâğıt baskısında. Ayrıntı: `docs/kurallar/belge-etiket.md`, `refakat-karti.md`.
- **Filtre/liste:** çoklu seçim CSV; süzme sunucuda; `dateField` gönderilmezse aralık yok sayılır; NumpadHost `autoActivate` tek alanda; Ctrl+F sayfa içi arama YOK. `docs/kurallar/filtre-liste.md`.
- **Bayrak paneli:** `FlagDef.numberField` iç adı `numberKey:` ZORUNLU; kapalı modülün bayrak satırı fabrika yöneticisine çizilmez (`flag-modules.ts`, satırdan türer). `docs/kurallar/modul-bayrak.md`.
- Dosya boyutu: tek dosya ≤300, Page ≤200, FormDialog ≤200 satır ZORUNLU (yeni ve dokunduğun dosyada); devralınan ihlaller `lint-baseline.json`'da donar ve tavan yalnız düşer (ESLint `max-lines` + `node scripts/check-lint-baseline.mjs`). Katalog/registry dosyaları ADLI muafiyet listesindedir. Ayrıntı: `docs/standart/ELECTRON.md`.

## Otomatik güncelleme (özet)

`electron-updater`, generic provider; yayın adresi TEK KAYNAK `shared/update-feed.ts` ↔ `package.json > build.publish` (bekçi `update-feed-url.test.ts`); `artifactName` ASCII (`${productName}` YASAK); `autoUpdater`a modül gövdesinde dokunma; `autoInstallOnAppQuit=false`; `nsis.perMachine` (yönetici olmayan hesapta güncelleme kurulmaz); şerit yalnız `ready` durumunda (`error` şeridi internetsiz makinede her açılışta körleştirir); `package.json > version` artmazsa hiçbir panel güncellenmez (yama hanesini script artırır). Reçete: `docs/kurallar/surum-yayin.md`, `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`.

## Paketler

Yenisi için onay al. Core `electron electron-vite electron-builder` · native `electron-log electron-store electron-updater serialport node-hid` (`@electron/rebuild`) · keşif `bonjour-service` (**1.4.4 sabit, `dependencies`'te kalmak ZORUNDA**, tembel yükleme) · UI `react react-dom react-router-dom react-hook-form @hookform/resolvers zod` shadcn/ui `cmdk sonner lucide-react next-themes framer-motion react-day-picker` · style `tailwindcss @tailwindcss/vite class-variance-authority tailwind-merge clsx @fontsource/plus-jakarta-sans` · state `zustand @tanstack/react-query` · tablo `@tanstack/react-table @tanstack/react-virtual` · `axios date-fns recharts @dnd-kit/* qrcode.react react-colorful exceljs buffer` (PDF paketi YOK — baskı HTML + iframe) · test `vitest @testing-library/react @stryker-mutator/core @playwright/test`. Karar kaydı ve katman × ihtiyaç tablosu: `docs/standart/KUTUPHANELER.md` §2.2 (bekçi `test_dependency_contract`).

## Test kullanıcıları ve gotcha'lar

Seed yalnız `admin / 123123` (katalogdaki TÜM izinler); yeni kullanıcı YALNIZ mobil istasyon izinleriyle doğar (`DEFAULT_OPERATOR_PERMISSION_CODES`: KK1/KK2/Tambur; web kullanıcısı açarken kutu kapatılır) → masaüstü izni atanana dek panele giremez (`canEnterApp`, login 403). Tailwind 4 (`@import "tailwindcss"` + `@theme`, config dosyası yok) · React Router 7 `createHashRouter` · Zod v4 `z.record` iki argüman · Electron ESM main (`import.meta.url`) · TanStack Query 5 object API · electron-store 11 ESM-only.
