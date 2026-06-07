# Adnan Şahin ERP — Admin (`Electron/`)

Electron 33 + React 19 + TypeScript + Vite. Yönetim paneli; saha akışı yok. Backend `Teks-Erp/` (Express 5 + Prisma 7) ile HTTP üzerinden konuşur.

> Root `CLAUDE.md` ve `Teks-Erp/ARCHITECTURE.md` domain referansıdır.

## Komutlar

```bash
npm run dev            # electron-vite dev (renderer port 5174 + main + preload)
npm run build          # production bundle
npm run build:mac      # .dmg
npm run build:win      # NSIS installer
npm run typecheck      # main + renderer type check
npm run lint
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

**Uygulamaya kabul (`canEnterApp`):** Kullanıcının en az bir permission'ı olmalı. Admin-only sayfalar `<ProtectedRoute requirePermission="admin:*">` ile kilitli.

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


## Sidebar Kuralı (KRİTİK)

Sidebar'da **her tanım ayrı satır YOK.** Tek "Tanımlar" girişi var; tıklayınca `/definitions` hub sayfası açılır, kart grid'i her tanım modülüne gönderir. Yeni master data eklerken `pages/Definitions/tile-config.ts` → kart ekle, `router.tsx` → route ekle. Sidebar'a ekleme.

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
| UI | `react`, `react-dom`, `react-router-dom`, `react-hook-form`, `@hookform/resolvers`, `zod` |
| Components | shadcn/ui (Radix + Tailwind), `cmdk`, `sonner`, `lucide-react`, `next-themes` |
| Style | `tailwindcss`, `@tailwindcss/vite`, `class-variance-authority`, `tailwind-merge`, `clsx` |
| State | `zustand`, `@tanstack/react-query` |
| Tablo | `@tanstack/react-table`, `@tanstack/react-virtual` |
| HTTP | `axios` |
| Date | `date-fns` |
| Charts | `recharts` |
| Drag & Drop | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| QR / Renk | `qrcode.react`, `react-colorful` |

## Test Kullanıcıları

`admin / 123123` (seed'de 42 permission). Diğer 6 test kullanıcısı (`mehmet.planlama, ali.operator, ayse.kalite, fatma.satis, ali.kursun, ahmet.depo` — şifre `test123`) **yetkisiz başlar** ve admin UI'sından (`/admin/users/:id/permissions`) tek tek izin atanmadıkça uygulamaya giremez (`canEnterApp` false).

## Yeni Sayfa Kontrol Listesi

- [ ] `pages/<Module>/` klasörü açıldı, dosyalar parçalı
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
