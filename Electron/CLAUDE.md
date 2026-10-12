# TeksERP Panel — Admin (`Electron/`)

Electron 42 + React 19 + TypeScript + Vite. Yönetim paneli; saha akışı yok; backend ile HTTP. Domain kuralları kök `CLAUDE.md`; alan kuralları `docs/kurallar/<alan>.md`; desenler `docs/KOD-KURALLARI.md` + `docs/standart/ELECTRON.md`. Gerekçe ve ölçümler arşivde (2026-10-12 "CLAUDE.md kısaltma turu — Electron").

> Paket kimliği (appId · ürün/paket adı · güncelleme adresi · başlık · varsayılan sunucu) ORTAK PAKETTE dağıtım kaydından gelir: `deploy/dagitim.json` (`panelKimligi`) → `./deploy/electron-paketle.sh <sürüm>` derleme anında enjekte eder (`build-identity.ts` → `@shared/channel`). Ağaçtaki `package.json` yalnız dinlenme tabanıdır (`node scripts/panel-kimlik-kapisi.mjs taban-yaz`). Kaynağa literal kimlik ve `if (musteri === 'X')` yazılmaz; bekçi `scripts/test_panel_kimlik.mjs`.

## Komutlar ve ortam

```bash
npm run dev                    # electron-vite dev (renderer 5174)
npm run dev:web / build:web    # web paneli yalnız DEMO imajı
npm run build · build:mac      # ⚠️ ham build:win KULLANMA — deploy/electron-paketle.sh
npm run typecheck:plain · lint · test   # vitest commit kapısında
npm run electron:rebuild       # serialport, node-hid
```
- Tip denetimi `typecheck:plain`; düz `npx tsc --noEmit` hiçbir şey denetlemez (kök tsconfig `files: []`).
- `test:mutation` ve e2e KAPI DEĞİLDİR.
- Skill'ler: `.claude/skills/electron-admin-page`, `electron-ipc-handler`.

## Mimari ve süreç sınırı

- `electron/` main (`ipc/<domain>.ipc.ts`, `discovery/`) · `shared/` (ipc-contract, update-feed, channel) · `src/` renderer: `router.tsx` yalnız oturum-dışı; içerik route'ları `src/routes/content-routes.tsx`; `services/` (apiClient tek geçit); `components/layout/tabs/` (sekme router'ları, derinlik defteri).
- **Process boundary pazarlık dışı:** renderer `electron/fs/path/child_process/os/net` import etmez; native API yalnız `window.api`; `sandbox:true, contextIsolation:true, nodeIntegration:false`. Token `safeStorage` + `electron-store`; renderer `localStorage`'a token YAZMAZ (tek istisna web build).
- **Yeni IPC kanalı 4 adım:** `shared/ipc-contract.ts` tip → `electron/ipc/<domain>.ipc.ts` handler → `preload.ts` köprü (yalnız serializable) → `window.api.<domain>.<action>`.
- Yanıt şekilleri `src/types/api.ts`; servis yolları TAM (`/api/...`). `apiClient`: 401 token sil · 403 "yetkin yok" (üç dar istisna) · 4xx backend mesajı · 5xx generic → `onError`'da ikinci toast YOK.

## Yetki

JWT yalnız `permissions[]`; `useRoleAccess` + `<PermissionGate>` yazma butonlarını kapatır. `hasAdminAccess` `matchesPermission` ile ölçer (düz `includes` değil). `canEnterApp`: en az bir masaüstü izni. Kart (`tile-config.permissionAny`) ↔ route (`requireAnyPermission`) AYNI liste; izin kümeleri `src/lib/permissions.ts`. Ayrıntı `docs/kurallar/yetki-izin.md`, `superadmin.md`, `modul-bayrak.md`.

## Sayfa kalıpları

- **Yeni master data sayfası:** `pages/<Module>/` → `types.ts` · `service.ts` (`createCrudService`) · `schema.ts` (zod — backend master-data CRUD'da Zod YOK, panel şeması tek kapıdır; `max(n)` = `@db.VarChar(n)`) · `columns.tsx` · `<Module>FormDialog.tsx` + `<Module>Page.tsx`. Route `content-routes.tsx` + backend `screen-catalog.ts` girdisi (`modul` zorunlu); hub karosu (izin route ile birebir) ya da `command-entries.ts`; **Sidebar'a satır EKLENMEZ**. Reçete `docs/RECETELER.md` § Electron sayfası.
- **Sayfa iskeleti:** `<PageShell>` · sabit `PageHeader`/toolbar · TEK kaydırıcı `<PageBody min-h-0>` · `<PageFooter>`. Sonsuz kaydırma otomatik; "Daha Fazla Yükle" YOK.
- **Gezinme:** geri daima `PageHeader` üzerinden yedeğe düşer; derinlik `tabs/history-depth.ts`, `location.key` ile çözülmez. Ayrıntı `docs/kurallar/filtre-liste.md`.
- **Picker:** `loadAllForPicker(service)`; inline `pageSize:N` yazma.
- **Belge/baskı:** iframe `sandbox="allow-same-origin allow-modals"` (`allow-scripts` YOK); iç veri kolonu OPT-IN; `print-event` yalnız kâğıt baskısında. `docs/kurallar/belge-etiket.md`, `refakat-karti.md`.
- **Filtre/liste:** çoklu seçim CSV; süzme sunucuda. `docs/kurallar/filtre-liste.md`.
- **Bayrak paneli:** `FlagDef.numberField` iç adı `numberKey:` ZORUNLU; kapalı modülün bayrak satırı çizilmez. `docs/kurallar/modul-bayrak.md`.
- Dosya boyutu: dosya ≤300, Page ≤200, FormDialog ≤200 satır (yeni ve dokunulan dosyada); devralınan ihlal `lint-baseline.json`'da donar, tavan yalnız düşer.

## Otomatik güncelleme (özet)

`electron-updater`, generic provider; yayın adresi tek kaynak dağıtım kaydı; `artifactName` ASCII (`${productName}` YASAK); `autoUpdater`a modül gövdesinde dokunulmaz; `autoInstallOnAppQuit=false`; şerit yalnız `ready`'de; `package.json > version` artmazsa güncelleme gitmez; güncelleme YALNIZ imzalı künyeyle kurulur; kanal kiradaki güncelleme grubundan gelir. Reçete `docs/kurallar/surum-yayin.md`, `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`.

## Paketler

Yenisi için onay al; küme ve karar kaydı `docs/standart/KUTUPHANELER.md` §2.2 (bekçi `test_dependency_contract`). `bonjour-service` 1.4.4 sabit, `dependencies`'te, tembel yükleme. PDF paketi YOK — baskı HTML + iframe.

## Test kullanıcıları ve gotcha'lar

Seed yalnız `admin` (tüm izinler); yeni kullanıcı yalnız mobil istasyon izinleriyle doğar → masaüstü izni atanana dek panele giremez. Tailwind 4 (`@theme`, config yok) · React Router 7 `createHashRouter` · Zod v4 `z.record` iki argüman · Electron ESM main · TanStack Query 5 object API · electron-store 11 ESM-only.
