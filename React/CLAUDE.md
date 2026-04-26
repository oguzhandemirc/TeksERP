# TeksERP — Frontend (`React/`)

React 19 + Vite + TypeScript. See root `CLAUDE.md` for domain facts, `Teks-Erp/ARCHITECTURE.md` for backend reference.

> **Önemli kapsam notu:** Bu UI **API testi için geçici** — yakında yeniden yazılacak. Mevcut UI'ı belgeleme/güzelleştirme yatırımı yapma. Test edilebilirliği bozan bug'ları düzelt, kalan zamanı kalıcı bilgilere (API kontratı, RBAC) ayır.

## Commands

```bash
npm run dev      # Vite dev server (port 5173)
npm run build    # tsc -b + Vite build
npm run lint     # ESLint
npm run preview  # Production build önizleme
```

## Environment (`.env`)

```
VITE_API_BASE_URL=http://localhost:4000
```

## Stack & Path Alias

| | |
|---|---|
| State (UI) | Zustand 5 — `useAuthStore`, `useThemeStore` |
| State (server) | TanStack React Query 5 — global config: `retry: 1`, `refetchOnWindowFocus: false`, `staleTime: 5min` |
| Router | React Router DOM 7 |
| Forms | React Hook Form 7 + Zod 4 (`@hookform/resolvers`) |
| HTTP | Axios 1 — tek instance (`src/services/apiClient.ts`) |
| UI | shadcn/ui (Radix), Lucide icons, Tailwind 4, Sonner toasts |
| Tables | TanStack Table 8 |
| Excel | `xlsx` (client-side, büyük listede freeze riski) |

**Path alias:** `@/*` → `./src/*` (`vite.config.ts` + `tsconfig.json`)

## Dizin Yapısı

```
src/
├── App.tsx              # Router + QueryClient + auth hydration
├── pages/               # 29 modül (UI yeniden yazılacak — ayrıntı belgesi yok)
├── components/
│   ├── layout/          # AppLayout, Header, Sidebar, ProtectedRoute (auth-only)
│   ├── data-table/      # DataTable + Toolbar + Pagination + Skeleton + Export
│   ├── ui/              # shadcn/ui primitives
│   └── charts/          # Recharts wrapper'ları
├── hooks/               # SADECE 3 hook — başka yok
│   ├── useDataTable.ts      # URL-synced pagination/sort/filter/search + TanStack Table
│   ├── useCrudMutations.ts  # CRUD mutations + success toast (error apiClient'da)
│   └── useRoleAccess.ts     # isAdmin, hasRole, hasPermission, hasAnyPermission
├── store/               # useAuthStore (JWT + user), useThemeStore
├── services/            # Axios çağrıları, domain başına 1 dosya
│   ├── apiClient.ts         # Tek Axios instance — TÜM çağrılar buradan geçer
│   └── crudService.ts       # createCrudService<T>(basePath) factory
├── types/
│   ├── api.ts               # ApiResponse<T>, PaginatedResponse<T>, QueryParams
│   ├── auth.ts              # JwtPayload (userId, username, roles[], permissions[])
│   ├── enums.ts             # Backend enum'larının frontend kopyaları
│   └── models.ts            # Backend Prisma modelleriyle eşleşen interface'ler
└── lib/
    ├── query-builder.ts     # URL ↔ QueryParams dönüşümü
    └── utils.ts             # cn() helper (clsx + tailwind-merge)
```

## API Kontratı (KALICI — UI rewrite'tan etkilenmez)

Backend'in döndüğü şekiller `src/types/api.ts`'de:

```ts
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface QueryParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  filters: Record<string, string | string[]>;
  search?: string;
}
```

**Hata formatı (4xx)** — `errorHandler` middleware'inden gelir:
```json
{ "success": false, "message": "Validasyon hatası", "errors": [{ "field": "name", "message": "Ad gerekli" }] }
```

## API Client Davranışı

`src/services/apiClient.ts` — TÜM HTTP çağrıları buradan. Native `fetch` yasak.

- **Request interceptor:** `localStorage.token` → `Authorization: Bearer ...` ekler
- **Response interceptor:**
  - `401` → token sil + redirect `/login` + toast "Oturum süreniz doldu"
  - `403` → toast "Bu işlem için yetkiniz bulunmuyor"
  - `4xx` (genel) → toast `error.response.data.message` (backend'in gerçek mesajı)
  - `5xx` → toast "Sunucu hatası"

**Sonuç:** Axios çağrılarında `try/catch` ile toast atmana gerek yok; apiClient zaten gösteriyor. Mutation'larda da `onError` ile generic toast atma (duplicate olur).

## CRUD Pattern

Yeni Master Data servisi yazma:

```ts
// services/yenimodulService.ts — TEK SATIR
import { createCrudService } from "./crudService";
import type { Yenimodul } from "@/types/models";
export const yenimodulService = createCrudService<Yenimodul>("/api/yenimoduls");
```

`createCrudService<T>(basePath)` factory'si `getAll`, `getById`, `create`, `update`, `remove`, `hardRemove` döner.

Sayfada kullanım:
```tsx
const { createMutation, updateMutation, removeMutation } = useCrudMutations({
  service: yenimodulService,
  queryKey: "yenimoduls",
  entityName: "Yeni Modül",
});

const dt = useDataTable({
  queryKey: "yenimoduls",
  fetchFn: yenimodulService.getAll,
  columns,
});
```

## RBAC (KALICI — UI rewrite'tan etkilenmez)

JWT payload'ında 2 array gelir: `roles[]`, `permissions[]`. `useRoleAccess` hook ile UI'da kontrol:

```tsx
const { isAdmin, hasPermission, hasAnyPermission, hasRole } = useRoleAccess();
{isAdmin && <Button>Sil</Button>}
{hasPermission("order:write") && <Button>Oluştur</Button>}
```

**Permission kodları (backend ile birebir):** `order:read/write`, `customer:read/write`, `workorder:read/write`, `roll:read/write`, `station:read/write`, `item:read/write`, `quality:read/write`, `shipment:read/write`, `allocation:write`, `admin:users/roles/settings`. Detay: `Teks-Erp/ARCHITECTURE.md §6`.

**Roller:** `Admin`, `Planlama Şefi`, `Üretim Operatörü`, `Kalite Kontrol`, `Satış Temsilcisi`, `Sevkiyatçı`. (Ayrıntı için: `Teks-Erp/ARCHITECTURE.md §13`.)

**Route-level kilit YOK.** `ProtectedRoute` sadece auth kontrolü yapıyor — rol/permission kontrolü UI içinde `useRoleAccess` ile inline yapılıyor. Yeni rewrite'ta route guard eklenmesi düşünülmeli.

**Token storage:** `localStorage.token`. XSS riski var. Rewrite'ta `httpOnly cookie` alternatifi değerlendirilmeli.

## Test Edilebilirlik Kuralları (mevcut UI için)

Mevcut UI sadece API testi için var. Bu kurallar buna hizmet eder:

1. **Hata toast'ı tek yerden.** `apiClient` zaten 4xx'te backend'in mesajını gösteriyor. Mutation `onError`'a generic mesaj **koyma** — duplicate toast olur, testçi gerçek hatayı göremez.
2. **`any` yasak.** Type ciddiye alınmaz hale gelirse API kontrat değişiklikleri sessizce kaçar.
3. **Tüm HTTP `apiClient` üzerinden.** Native `fetch` veya yeni axios instance yaratma.
4. **Backend hata mesajları Türkçe** — toast'ta olduğu gibi göster, çeviri yapma.
5. **`useDataTable`'ın URL-sync özelliği** — pagination/filter/sort URL'e yazılıyor, sayfayı paylaşılabilir/yenilenebilir kılıyor. Bunu bozma.

## Tipografi: TypeScript Kuralları

- **`any` yasak.** Backend Prisma modelleriyle senkron olan `src/types/models.ts` kullan.
- **Component prop'ları** her zaman `interface` ile.
- **Arrow function components**, class component yok.

## Frontend Performance Notları (rewrite için)

Mevcut UI'da uygulanmamış ama yeniden yazımda dikkat edilmesi gerekenler:

1. **Search input debounce** — her tuşta API'ya istek atma; 300ms bekle. Şu an mevcut UI'da yok, KK1 gibi mobil ekranlarda hissediliyor.
2. **Long lists için virtualization** — `react-window` veya TanStack Virtual. 1000+ satırda DOM patlar.
3. **`React.lazy` + `Suspense`** — sayfa-bazlı code splitting. Mevcut bundle hepsini eager yükler.
4. **TanStack Query `select`** — server'dan gelen veriyi component'e ulaşmadan dönüştür/filtrele. Re-render azaltır.
5. **`enabled`** — koşullu fetch (modal açık değilse fetch'leme).
6. **Excel export server-side** — `xlsx` client-side büyük listede UI'ı freeze ediyor; backend'de generate et.
7. **`React.memo` / `useMemo` / `useCallback`** — sadece hot loop'larda (binlerce satır render eden tablo gibi). Her yere sıkıştırma.

## Bilinen Bug Düzeltmeleri (2026-04-27)

- ✅ `useCrudMutations` `onError` toast'ları kaldırıldı — apiClient'ın toast'ı ile çakışıyordu, testçi gerçek hatayı göremiyordu
- ✅ `OrderFormDialog.tsx` 2 `any` → tip inference'a bırakıldı
- ✅ `ProtectedRoute.allowedRoles` prop'u silindi — implementasyon vardı ama hiç çağrılmıyordu

## Version Gotchas

- **Zod v4:** `z.record(z.string(), z.unknown())` — iki arg
- **React 19:** Strict Mode'da effect'ler dev'de iki kez çalışır (normal davranış)
- **TanStack Query 5:** v4'ten farklı object-based API (`useQuery({ queryKey, queryFn })` zorunlu)
