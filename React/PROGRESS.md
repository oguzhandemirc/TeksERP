# TeksERP Frontend - Geliştirme İlerleme Dokümanı

> **Son Güncelleme:** 15 Nisan 2026
> **Proje Dizini:** `react/`
> **Backend:** `Teks-Erp/` (Express 5 + Prisma 7 + PostgreSQL, port 4000)

---

## Genel Bakış

| Faz | Başlık | Durum |
|-----|--------|-------|
| **FAZ 1** | Proje Altyapısı + Auth Modülü | ✅ Tamamlandı |
| **FAZ 2** | Layout ve Dashboard | ✅ Tamamlandı |
| **FAZ 2.5** | Reusable DataTable ve Raporlama Altyapısı | ✅ Tamamlandı |
| **FAZ 3** | Master Data Modülleri (Items, Customers, Stations, Machines, Routes) | ✅ Tamamlandı |
| **FAZ 4** | Envanter (Rolls/Toplar) | ✅ Tamamlandı |
| **FAZ 5** | Sipariş Yönetimi (Orders) | ✅ Tamamlandı |
| **FAZ 6** | İş Emri (Work Orders) | ✅ Tamamlandı |
| **FAZ 7** | Üretim Akışı (Production) | ✅ Tamamlandı |
| **FAZ 8** | Tambur (Karar Noktası) - Mobile First | ✅ Tamamlandı |
| **FAZ 9** | Sevkiyat (Shipping) | ✅ Tamamlandı |
| **FAZ 10** | Sistem, Raporlama ve İleri Özellikler | ✅ Tamamlandı |

---

## Teknoloji Yığını

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| **Framework** | React + Vite | React 19, Vite 8 |
| **Dil** | TypeScript (strict mode) | 6.0 |
| **CSS** | Tailwind CSS v4 | 4.2 |
| **UI Kit** | Shadcn UI (manuel, Radix tabanlı) | - |
| **Tablo** | TanStack Table | 8.21 |
| **Grafikler** | Recharts | 3.8 |
| **State (Global)** | Zustand | 5.0 |
| **State (Server)** | TanStack React Query | 5.99 |
| **Form** | React Hook Form + Zod | RHF 7.72, Zod 4.3 |
| **HTTP** | Axios | 1.15 |
| **Router** | React Router DOM | 7.14 |
| **Toast** | Sonner | 2.0 |
| **İkonlar** | Lucide React | 1.8 |
| **Export** | xlsx | 0.18 |
| **Tarih** | date-fns | 4.1 |

---

## ✅ FAZ 1: Proje Altyapısı + Auth Modülü (Tamamlandı)

### 1.1 Proje Kurulumu
- Vite + React + TypeScript ile proje scaffolding
- Tüm bağımlılıkların kurulumu (28 paket)
- Tailwind CSS v4 plugin entegrasyonu (`@tailwindcss/vite`)
- TypeScript strict mode + `@/` path alias yapılandırması
- `.env` dosyası: `VITE_API_BASE_URL=http://localhost:4000`

### 1.2 Klasör Yapısı
```
react/src/
├── components/
│   ├── ui/             → Shadcn tarzı base bileşenler
│   ├── charts/         → Recharts wrapper bileşenleri
│   ├── layout/         → AppLayout, Sidebar, Header, ProtectedRoute
│   └── data-table/     → DataTable, Toolbar, Filter, Pagination, Export
├── pages/              → Modül bazlı sayfalar
├── hooks/              → Custom hook'lar
├── services/           → Axios instance + API servisleri
├── store/              → Zustand store'ları
├── types/              → TypeScript interface/type dosyaları
└── lib/                → Utility fonksiyonlar
```

### 1.3 Axios Yapılandırması (`src/services/apiClient.ts`)
- Base URL: `VITE_API_BASE_URL` ortam değişkeninden
- **Request Interceptor:** localStorage'dan JWT token -> `Authorization: Bearer` header
- **Response Interceptor:**
  - `401`: Token temizle, `/login`'e yönlendir, toast göster
  - `403`: "Yetkiniz bulunmuyor" toast'u
  - `400-499`: Backend'den gelen `message` alanını toast olarak göster
  - `500+`: Genel sunucu hatası toast'u
- Timeout: 15 saniye

### 1.4 TypeScript Tipleri
| Dosya | İçerik |
|-------|--------|
| `src/types/auth.ts` | `JwtPayload`, `LoginRequest`, `LoginResponse` |
| `src/types/api.ts` | `ApiResponse<T>`, `PaginatedResponse<T>`, `QueryParams` |

Backend'in `api.types.ts` dosyasıyla birebir senkronize.

### 1.5 Auth Service (`src/services/authService.ts`)
| Fonksiyon | Endpoint | Açıklama |
|-----------|----------|----------|
| `login(credentials)` | `POST /api/auth/login` | JWT token + user payload döner |
| `getMe()` | `GET /api/auth/me` | Token'dan kullanıcı bilgisi doğrulama |

### 1.6 Auth Store (`src/store/useAuthStore.ts`)
- **State:** `token`, `user` (JwtPayload), `isAuthenticated`, `isLoading`
- **Actions:**
  - `setAuth(token, user)`: Login sonrası state + localStorage güncelle
  - `logout()`: State + localStorage temizle
  - `hydrate()`: Sayfa yenilendiğinde localStorage'dan token oku, `/api/auth/me` ile doğrula
- Token persist: `localStorage` (key: `"token"`)

### 1.7 Login Sayfası (`src/pages/Auth/LoginPage.tsx`)
- React Hook Form + Zod validasyon (`username` min 1, `password` min 1)
- Şifre göster/gizle toggle (Eye/EyeOff ikonu)
- Loading state: spinner + disabled button (çift tıklama engeli)
- Hata mesajları: apiClient interceptor üzerinden toast
- Başarılı giriş: `setAuth` -> Dashboard'a yönlendirme

### 1.8 Routing Altyapısı
- **ProtectedRoute:** JWT kontrol + role-based erişim guard
  - `isLoading`: Spinner göster
  - `!isAuthenticated`: `/login`'e redirect
  - `allowedRoles`: Opsiyonel rol kontrolü
- Login sayfasına giriş yapılmışsa otomatik `/` redirect
- 404 -> `/` redirect

### Oluşturulan UI Bileşenleri
| Bileşen | Dosya | Özellikler |
|---------|-------|------------|
| `Button` | `ui/button.tsx` | 6 variant, 4 size, `isLoading` prop |
| `Input` | `ui/input.tsx` | `error` state desteği |
| `Label` | `ui/label.tsx` | `error` state desteği |
| `Card` | `ui/card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent |

---

## ✅ FAZ 2: Layout ve Dashboard (Tamamlandı)

### 2.1 Tema Altyapısı
- **CSS Değişkenleri:** Light + Dark mod için 25+ renk değişkeni (background, foreground, muted, card, border, primary, secondary, accent, destructive, ring, sidebar, chart-1..5)
- **Theme Store** (`src/store/useThemeStore.ts`):
  - 3 mod: Light / Dark / System
  - `localStorage` persist (key: `"theme"`)
  - System modu: `prefers-color-scheme` media query dinleme
  - `initialize()`: Uygulama başlangıcında tema uygula

### 2.2 Sidebar (`src/components/layout/Sidebar.tsx`)
- **Açılır/Kapanır (Collapse):** 64px <-> 256px geçiş, animasyonlu
- **Role-Based Filtreleme:** Her nav item'da `permissions[]` tanımlı
  - Admin: Tüm menüleri görür
  - Diğer roller: Sadece yetkili oldukları sayfaları görür
- **Navigasyon Grupları:**
  - Genel: Dashboard
  - Tanımlar: Stok Kartları, Müşteriler, İstasyonlar, Makineler, Rotalar
  - Envanter: Toplar (Rolls)
  - Satış: Siparişler
  - Üretim: İş Emirleri, Üretim Akışı, Tambur
  - Lojistik: Sevkiyat
  - Yönetim: Kullanıcılar, Sistem Logları
- **NavLink** ile aktif sayfa vurgulama
- Collapsed modda tooltip ile isim gösterimi

### 2.3 Header (`src/components/layout/Header.tsx`)
- Sticky header, backdrop blur efekti
- **Tema Toggle Dropdown:** Açık / Koyu / Sistem seçenekleri (ikonlu)
- **Kullanıcı Dropdown:**
  - Avatar (username'in ilk 2 harfi)
  - Kullanıcı adı + rol bilgisi
  - Profil linki (placeholder)
  - Çıkış butonu

### 2.4 AppLayout (`src/components/layout/AppLayout.tsx`)
- Sidebar + Header + `<Outlet />` wrapper
- Sidebar collapse state yönetimi
- Content alanı sidebar genişliğine göre margin ayarı (animasyonlu)

### 2.5 Dashboard (`src/pages/Dashboard/DashboardPage.tsx`)
- **Rol Bazlı KPI Kartları:**
  - Sipariş yetkisi: "Aktif Siparişler" (trend göstergeli)
  - Roll yetkisi: "Depodaki Toplar" (trend göstergeli)
  - İş emri yetkisi: "Aktif İş Emirleri"
  - Sevkiyat yetkisi: "Bekleyen Sevkiyat"
  - Kalite yetkisi: "Fire Oranı" (negatif trend) + "Tambur Bekleyen"
- **Admin Grafikleri:**
  - Aylık Sipariş Sayısı (BarChart)
  - Top Durumu Dağılımı (PieChart / Donut)
  - Haftalık Üretim Trendi (LineChart)
- Grafikler tema uyumlu renklerde (dark/light)

### Oluşturulan Yeni Bileşenler
| Bileşen | Dosya | Özellikler |
|---------|-------|------------|
| `Avatar` | `ui/avatar.tsx` | Avatar + AvatarFallback |
| `DropdownMenu` | `ui/dropdown-menu.tsx` | Trigger, Content, Item, Label, Separator |
| `KPICard` | `charts/KPICard.tsx` | İkon, başlık, değer, açıklama, trend (yüzde + ok) |
| `BarChartCard` | `charts/BarChartCard.tsx` | Recharts BarChart wrapper, tema uyumlu tooltip |
| `PieChartCard` | `charts/PieChartCard.tsx` | Recharts PieChart (donut), legend, tema uyumlu |
| `LineChartCard` | `charts/LineChartCard.tsx` | Recharts LineChart wrapper, tema uyumlu |

### Oluşturulan Hook'lar
| Hook | Dosya | Özellikler |
|------|-------|------------|
| `useRoleAccess` | `hooks/useRoleAccess.ts` | `hasPermission`, `hasAnyPermission`, `hasRole`, `isAdmin` |

---

## ✅ FAZ 2.5: Reusable DataTable ve Raporlama Altyapısı (Tamamlandı)

Sonraki tüm modüllerin kullanacağı ortak tablo, filtreleme ve export altyapısı.

### DataTable Bileşenleri (`src/components/data-table/`)
| Bileşen | Açıklama |
|---------|----------|
| `DataTable.tsx` | Ana wrapper: TanStack Table instance, kolon sort (tıkla asc/desc), kolon resize (drag), satır tıklama |
| `DataTableToolbar.tsx` | Üst çubuk: global arama + kolon filtreleri + tarih aralığı + custom actions slot |
| `DataTableGlobalSearch.tsx` | Debounced arama (400ms), temizle butonu, backend `search` param ile uyumlu |
| `DataTableColumnFilter.tsx` | text / select / multi-select filtre tipleri, aktif filtre badge'leri, toplu temizle |
| `DataTableDateRangeFilter.tsx` | HTML date input ile tarih aralığı, date-fns ile TR format gösterimi |
| `DataTablePagination.tsx` | Server-side sayfalama (ilk/önceki/sonraki/son), sayfa boyutu seçimi (10/20/50/100), toplam kayıt |
| `DataTableRowSelection.tsx` | `getSelectionColumn()` helper: header checkbox (tümünü seç) + satır checkbox |
| `DataTableExport.tsx` | Dropdown: Excel (.xlsx) + CSV, "Tüm Veriler" veya "Seçili Satırlar" opsiyonları |
| `DataTableSkeleton.tsx` | Toolbar + tablo skeleton (kolon/satır sayısı parametrik) |
| `index.ts` | Barrel export: tüm bileşenler + tipler tek import ile |

### useDataTable Hook (`src/hooks/useDataTable.ts`)
Tek hook ile tüm DataTable state yönetimi:
- **React Query entegrasyonu:** `fetchFn` ile server-side veri çekme, `placeholderData` ile sayfa geçişlerinde mevcut veriyi göster
- **URL state sync:** Filtreler, arama, sayfa, sıralama URL'de saklanır (paylaşılabilir, bookmark'lanabilir)
- **Debounced arama:** Global search otomatik 400ms debounce
- **Server-side pagination:** Backend `PaginatedResponse<T>` ile birebir uyumlu
- **Server-side sorting:** `sortBy` + `sortOrder` URL'den okunur, kolon tıklamasıyla güncellenir
- **Server-side filtering:** `filter[field]=value` formatında backend'e gönderilir
- **Kolon resize:** `columnSizing` state ile sürükleme desteği
- **Satır seçimi:** `rowSelection` + `selectedRows` + `selectedCount`
- **Tarih aralığı:** `dateRange` state, `dateFrom`/`dateTo` olarak filters'a eklenir

### Utility Dosyaları
| Dosya | Açıklama |
|-------|----------|
| `src/lib/query-builder.ts` | `buildQueryString()`: QueryParams -> URL query string, `parseUrlToQueryParams()`: URL -> QueryParams |
| `src/lib/export-utils.ts` | `exportToExcel()`: xlsx kütüphanesi ile Excel export, `exportToCsv()`: BOM + UTF-8 CSV export |

### UI Bileşenleri (Yeni)
| Bileşen | Dosya |
|---------|-------|
| `Table` | `ui/table.tsx` - Table, TableHeader, TableBody, TableRow, TableHead, TableCell |
| `Checkbox` | `ui/checkbox.tsx` - Checked state + Check ikonu |
| `Badge` | `ui/badge.tsx` - 4 variant (default, secondary, destructive, outline) |
| `Select` | `ui/select.tsx` - Native select + options + placeholder |

### Kullanım Örneği
```tsx
// Herhangi bir modül sayfasında:
const { table, isLoading, search, setSearch, ... } = useDataTable({
  queryKey: "items",
  fetchFn: (params) => itemService.getAll(params),
  columns: itemColumns,
});

// Toolbar + DataTable + Pagination hepsi hazır bileşenler
```

---

## 🔲 FAZ 3: Master Data Modülleri (Planlandı)

### Hedef Sayfalar
| Modül | Sayfa | Endpoint'ler | DataTable Özellikleri |
|-------|-------|-------------|----------------------|
| **Items** | Stok Kartları | `GET/POST/PATCH/DELETE /api/items` | Kolon filtre: `itemType` enum, Global arama: code/name |
| **Customers** | Müşteriler | `GET/POST/PATCH/DELETE /api/customers` | Kolon filtre: `CompanyType` enum |
| **Stations** | İstasyonlar | `GET/POST/PATCH/DELETE /api/stations` | Kolon filtre: `StationType`, department |
| **Machines** | Makineler | `GET/POST/PATCH/DELETE /api/machines` | Station combobox ilişkisi |
| **Routes** | Rotalar | `GET/POST/PATCH/DELETE /api/routes` | RouteStep sıralama (stepper) |

Her modülde: DataTable + CRUD Dialog (Shadcn Dialog + React Hook Form + Zod)

---

## 🔲 FAZ 4: Envanter / Toplar (Planlandı)

| Özellik | Açıklama |
|---------|----------|
| **Roll Listesi** | DataTable: RollStatus enum filtre, qualityGrade, barcode arama, tarih aralığı, satır seçimi, Excel/CSV export |
| **Roll Detay** | Tüm bilgiler + hata listesi + tahsis bilgileri (Shadcn Tabs) |
| **Top Girişi (Initial Entry)** | Form: itemId combobox, initialQty, weightKg, qualityGrade |
| **Barcode Sorgulama** | `GET /api/rolls/barcode/:barcode` - anlık sonuç |
| **Envanter Raporu** | KPI kartları + RollStatus PieChart + giriş trendi LineChart |

---

## 🔲 FAZ 5: Sipariş Yönetimi (Planlandı)

| Özellik | Açıklama |
|---------|----------|
| **Sipariş Listesi** | DataTable: OrderStatus enum, müşteri, orderNumber arama, tarih aralığı, export |
| **Sipariş Oluştur** | Müşteri combobox + OrderLine ekleme (ürün/miktar/fiyat) |
| **Sipariş Detay** | Kalemler, iş emirleri, tahsis, sevkiyat durumu (Tabs) |
| **Durum Badge'leri** | PENDING -> APPROVED -> IN_PRODUCTION -> PARTIAL_SHIPPED -> COMPLETED |
| **Sipariş Raporu** | KPI kartları + durum PieChart + aylık BarChart |

---

## 🔲 FAZ 6: İş Emri / Work Orders (Planlandı)

| Özellik | Açıklama |
|---------|----------|
| **İş Emri Listesi** | DataTable: WorkOrderStatus, WorkOrderType, batchNumber arama, tarih, export |
| **İş Emri Oluştur** | Parti no, tür, parametreler (JSON), rota adımları (istasyon sıralama), sipariş bağlantısı |
| **İş Emri Detay** | Stepper rota görünümü, bağlı toplar DataTable, refakat kartı, çeki listesi |
| **Top Bağlama** | Barkod okutma + toplu bağlama (satır seçimi ile) |

---

## FAZ 7: Üretim Akışı (Production) ✅

### Yapılanlar

#### Backend Entegrasyonu
Üretim modülü custom controller/service ile çalışıyor. Tablet/atölye operasyonları:
- **Aktif Adımlar:** `GET /api/production/active-steps` — Şu anda işlenen tüm üretim adımları (istasyon + iş emri bilgisi dahil)
- **İstasyon İşlemi:** `POST /api/production/step-action` — Barkod + istasyon + START/FINISH aksiyonu. Fason (EXTERNAL) istasyonda FINISH'te `newQty`/`newWeight` zorunlu (fire/çekme hesabı)
- **Hata Raporlama:** `POST /api/production/report-error` — Kurşun/QC2 istasyonunda hata kaydetme (metre aralığı + hata türü)

#### Servis
- **`services/productionService.ts`** — 3 endpoint: `getActiveSteps`, `stepAction`, `reportError`

#### Sayfalar

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **ProductionPage** | `pages/Production/ProductionPage.tsx` | Ana sayfa: header + StepActionPanel + Aktif Adımlar dashboard + Hata Raporla butonu |
| **StepActionPanel** | `pages/Production/StepActionPanel.tsx` | İstasyon işlem formu: barkod okutma, istasyon dropdown, START/FINISH toggle, fason fire alanları |
| **ReportErrorDialog** | `pages/Production/ReportErrorDialog.tsx` | Hata raporlama dialog: top ID, metre aralığı (başlangıç/bitiş), hata türü dropdown |

#### Özellikler
- Barkod okutma ile istasyon işlemi (START veya FINISH)
- START/FINISH toggle butonları (renk kodlu: mavi/yeşil)
- FINISH modunda fire alanları (yeni metraj + yeni ağırlık) — dış istasyonlarda zorunlu
- Aktif adımlar dashboard'u: istasyon adı, iş emri parti no, başlangıç zamanı, durum badge'i
- Her 15 saniyede otomatik yenileme (refetchInterval)
- Hata raporlama: 6 hata türü (Leke, Yırtık, Delik, Renk Farkı, Atkısı Hatası, Diğer)
- Skeleton loading + boş state gösterimi

### Dosya Haritası (FAZ 7 Yeni Dosyalar)
```
src/
├── types/
│   └── models.ts                       ← WorkOrderStep'e workOrder? alanı eklendi
├── services/
│   └── productionService.ts            ← 3-endpoint servis (activeSteps, stepAction, reportError)
└── pages/Production/
    ├── ProductionPage.tsx              ← Ana üretim sayfası
    ├── StepActionPanel.tsx             ← Barkod + istasyon işlem formu
    └── ReportErrorDialog.tsx           ← Hata raporlama dialog
```

---

## FAZ 8: Tambur (Karar Noktası) - Mobile First ✅

### Yapılanlar

#### Backend Entegrasyonu
Tambur modülü kalite karar noktası olarak çalışıyor. 4 özel endpoint:
- **Bekleyen Toplar:** `GET /api/tambur/pending-rolls` — IN_PRODUCTION + işlenmemiş hataları olan toplar (item + errors dahil)
- **Top Detayı:** `GET /api/tambur/rolls/:rollId` — Karar ekranı için top + hatalar
- **Finalizasyon:** `POST /api/tambur/finalize` — KES/KESME kararları. KES: yeni Roll kaydı (yeni barkod, SCRAP/A1). Orijinal top PRODUCED durumuna geçer
- **Tahsis:** `POST /api/tambur/allocate` — PRODUCED durumundaki topu sipariş kalemine tahsis etme

#### Servis
- **`services/tamburService.ts`** — 4 endpoint: `getPendingRolls`, `getRollForDecision`, `finalize`, `allocate`

#### Sayfalar (Mobile-First Tasarım)

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **TamburPage** | `pages/Tambur/TamburPage.tsx` | Bekleyen toplar listesi: büyük dokunmatik kartlar, hata sayısı + hatalı metraj, hata türü badge'leri. 20s otomatik yenileme |
| **TamburDecisionPanel** | `pages/Tambur/TamburDecisionPanel.tsx` | Karar ekranı: her hata için KES/KESME toggle (h-14 büyük butonlar), kalite seçimi (FIRE/A1/A2), otomatik net metraj hesaplama, finalizasyon onayı |
| **AllocateDialog** | `pages/Tambur/AllocateDialog.tsx` | Sipariş tahsisi: aktif sipariş kalemleri dropdown (kalan miktar gösterimi), tahsis miktarı girişi |

#### Mobile-First Özellikler
- Büyük dokunmatik hedefler (h-14 butonlar, h-12 input'lar)
- KES/KESME toggle butonları: renk kodlu (kırmızı/yeşil), ring ile aktif vurgu
- KES kararında kalite sınıfı seçimi (FIRE, A1, A2) — büyük chip butonlar
- Otomatik net metraj hesaplaması (mevcut metraj - kesim toplamı)
- Hata kartları: metre aralığı, hata türü, renk kodlu border (CUT=kırmızı, NO_CUT=yeşil)
- Bekleyen toplar kartlarında: barkod, ürün kodu, metraj, hata sayısı, hatalı metraj özeti
- Max-width container (max-w-2xl) tablet odaklı tasarım
- Card hover ve active:scale efektleri

### Dosya Haritası (FAZ 8 Yeni Dosyalar)
```
src/
├── services/
│   └── tamburService.ts               ← 4-endpoint servis (pending, decision, finalize, allocate)
└── pages/Tambur/
    ├── TamburPage.tsx                 ← Bekleyen toplar listesi (mobile-first)
    ├── TamburDecisionPanel.tsx         ← KES/KESME karar ekranı
    └── AllocateDialog.tsx             ← Sipariş tahsis dialog
```

---

## FAZ 9: Sevkiyat (Shipping) ✅

### Yapılanlar

#### Backend Entegrasyonu
Sevkiyat modülü custom controller/service ile çalışıyor. 5 özel endpoint:
- **Hazır Siparişler:** `GET /api/shipping/ready-orders` — PRODUCED/READY_FOR_SHIP durumunda tahsisli topları olan siparişler (müşteri, kalemler, toplar dahil)
- **Paketleme:** `POST /api/shipping/prepare-package` — Topları bir pakete atar, durum READY_FOR_SHIP olur
- **İrsaliye Oluştur:** `POST /api/shipping/shipments` — Yeni sevkiyat kaydı (irsaliye no otomatik üretilir)
- **Ürün Ekle:** `PATCH /api/shipping/shipments/:id/add-items` — Sevkiyata top ekleme (esnek yeniden atama desteği)
- **Finalize:** `POST /api/shipping/shipments/:id/finalize` — Sevkiyat onayı, toplar SHIPPED olur, sipariş otomatik COMPLETED/PARTIAL_SHIPPED

#### Tipler
- **`types/enums.ts`** — `shipmentStatusLabels` Türkçe label map eklendi
- **`types/models.ts`** — `Shipment`, `ShipmentItem`, `ReadyOrderView`, `ReadyOrderLineView` interface'leri eklendi

#### Servis
- **`services/shippingService.ts`** — 5 endpoint: `getReadyOrders`, `preparePackage`, `createShipment`, `addItems`, `finalize`

#### Sayfalar

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **ShippingPage** | `pages/Shipping/ShippingPage.tsx` | Ana sevkiyat sayfası: hazır siparişler listesi (accordion tarzı genişleyen), sipariş kalemleri + hazır toplar, paketleme ve sevk butonları |
| **PreparePackageDialog** | `pages/Shipping/PreparePackageDialog.tsx` | Paketleme dialog: seçili toplar badge listesi, paket ID/barkod, brüt kilo girişi |
| **CreateShipmentDialog** | `pages/Shipping/CreateShipmentDialog.tsx` | İrsaliye oluşturma: müşteri dropdown, şoför adı, plaka, taşıyıcı firma |
| **ShipmentDetailPanel** | `pages/Shipping/ShipmentDetailPanel.tsx` | Sevkiyat detay paneli: irsaliye bilgileri, ürün ekleme (Roll ID ile), kalem listesi, finalizasyon onayı |

#### Özellikler
- Accordion tarzı sipariş genişletme (order lines + allocated rolls)
- Durum bazlı renk kodlu badge'ler (Onaylandı/Üretimde/Kısmi Sevk)
- Her sipariş kaleminde: talep miktarı vs hazır miktar karşılaştırma
- Top bazlı paket ID ve barkod gösterimi
- Paketleme: seçili topları pakete atama, badge ile listeleme
- İrsaliye: müşteri dropdown (ön seçimli), şoför/plaka/taşıyıcı bilgileri
- Sevkiyat detay panelinde roll ID ile ürün ekleme
- Finalizasyon: otomatik sipariş tamamlama bildirimi (COMPLETED/PARTIAL_SHIPPED)
- 30s otomatik yenileme

### Dosya Haritası (FAZ 9 Yeni Dosyalar)
```
src/
├── types/
│   ├── enums.ts                        ← shipmentStatusLabels eklendi
│   └── models.ts                       ← Shipment, ShipmentItem, ReadyOrderView, ReadyOrderLineView
├── services/
│   └── shippingService.ts              ← 5-endpoint servis
└── pages/Shipping/
    ├── ShippingPage.tsx                ← Ana sevkiyat sayfası (hazır siparişler)
    ├── PreparePackageDialog.tsx         ← Paketleme dialog
    ├── CreateShipmentDialog.tsx         ← İrsaliye oluşturma dialog
    └── ShipmentDetailPanel.tsx          ← Sevkiyat detay + finalizasyon paneli
```

---

## FAZ 10: Sistem, Raporlama ve İleri Özellikler ✅

### Yapılanlar

#### Tipler
- **`types/models.ts`** — `SystemLog`, `User` interface'leri eklendi
- **`types/enums.ts`** — `shipmentStatusLabels` eklendi (FAZ 9'da eksik kalmıştı)

#### Servisler
- **`services/systemLogService.ts`** — `crudService` factory ile `/api/system-logs` (backend endpoint eklendiğinde hazır)
- **`services/userService.ts`** — `crudService` + custom `register()` (`POST /api/auth/register`)

#### Sayfalar

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **SystemLogsPage** | `pages/SystemLogs/SystemLogsPage.tsx` | DataTable: tarih, işlem (Oluşturma/Güncelleme/Silme), tablo, kayıt ID, kullanıcı. İşlem ve tablo filtreleri, global arama, Excel/CSV export. JSON detay görüntüleme |
| **UsersPage** | `pages/Users/UsersPage.tsx` | DataTable: ad soyad, kullanıcı adı, roller (badge), durum (aktif/pasif). Durum filtresi, arama, Excel/CSV export |
| **RegisterDialog** | `pages/Users/RegisterDialog.tsx` | Kullanıcı kayıt formu: ad soyad, kullanıcı adı, şifre. Zod validasyon |
| **ReportsPage** | `pages/Reports/ReportsPage.tsx` | Merkezi raporlama dashboard: tarih filtreli, KPI kartları (toplam sipariş, ciro, top sayısı, fire oranı), grafikler (aylık sipariş BarChart, sipariş durum PieChart, top durum PieChart, iş emri tür PieChart), iş emri durum özeti |

#### Özellikler
- Sistem logları: işlem türüne göre renk kodlu badge (yeşil/mavi/kırmızı)
- Sistem logları: JSON detay görüntüleme (oldData/newData)
- Kullanıcı yönetimi: rol badge'leri, aktif/pasif ikon gösterimi
- Merkezi raporlama: tarih aralığı filtreleme
- Merkezi raporlama: mevcut API'lerden (orders, rolls, work-orders) otomatik istatistik hesaplama
- Fire oranı: toplam metraj içinde SCRAP yüzdesi, trend göstergeli
- Navigation: "Raporlama" grubu eklendi (Merkezi Raporlar)

#### Backend Notu
`SystemLog` ve `User` listeleme endpoint'leri backend'de henüz mevcut değil. Frontend API kontratına göre hazırlandı — backend'e `GET /api/system-logs` ve `GET /api/users` (BaseController) endpoint'leri eklendiğinde doğrudan çalışır.

### Dosya Haritası (FAZ 10 Yeni Dosyalar)
```
src/
├── types/
│   └── models.ts                       ← SystemLog, User interface'leri eklendi
├── services/
│   ├── systemLogService.ts             ← crudService factory
│   └── userService.ts                  ← crudService + register()
├── lib/
│   └── navigation.ts                   ← Raporlama grubu eklendi
└── pages/
    ├── SystemLogs/
    │   └── SystemLogsPage.tsx          ← Audit log DataTable
    ├── Users/
    │   ├── UsersPage.tsx               ← Kullanıcı DataTable
    │   └── RegisterDialog.tsx          ← Kayıt formu
    └── Reports/
        └── ReportsPage.tsx             ← Merkezi raporlama dashboard
```

### Gelecekte Eklenebilecekler (Backlog)
| Özellik | Açıklama |
|---------|----------|
| **Makine Logları** | DataTable + timeline grafik |
| **Cari Hesaplar** | Finans modülü altyapısı |
| **PWA / Offline** | Fabrika için çevrimdışı çalışma |
| **Rol Yönetimi** | Rol oluşturma + izin atama UI |
| **Code Splitting** | Lazy loading ile bundle boyutu optimizasyonu |

---

## Mevcut Dosya Haritası

```
react/
├── .env                                    # VITE_API_BASE_URL=http://localhost:4000
├── vite.config.ts                          # React + Tailwind v4 plugin + @ alias
├── tsconfig.app.json                       # Strict mode + @/* path alias
├── package.json                            # 28 dependency
│
└── src/
    ├── main.tsx                            # React root
    ├── App.tsx                             # Router + QueryClient + Toaster + Tema init
    ├── index.css                           # Tailwind v4 + Light/Dark tema CSS değişkenleri
    │
    ├── lib/
    │   ├── utils.ts                        # cn() utility (clsx + tailwind-merge)
    │   └── navigation.ts                   # Role-based navigasyon konfigürasyonu
    │
    ├── types/
    │   ├── api.ts                          # ApiResponse<T>, PaginatedResponse<T>, QueryParams
    │   └── auth.ts                         # JwtPayload, LoginRequest, LoginResponse
    │
    ├── services/
    │   ├── apiClient.ts                    # Axios instance + request/response interceptor
    │   └── authService.ts                  # login(), getMe()
    │
    ├── store/
    │   ├── useAuthStore.ts                 # Token, user, isAuthenticated, hydrate
    │   └── useThemeStore.ts                # Light/Dark/System tema yönetimi
    │
    ├── hooks/
    │   └── useRoleAccess.ts                # hasPermission, hasAnyPermission, hasRole, isAdmin
    │
    ├── components/
    │   ├── ui/
    │   │   ├── button.tsx                  # 6 variant, 4 size, isLoading
    │   │   ├── input.tsx                   # error state
    │   │   ├── label.tsx                   # error state
    │   │   ├── card.tsx                    # Card, Header, Title, Description, Content
    │   │   ├── avatar.tsx                  # Avatar + Fallback
    │   │   └── dropdown-menu.tsx           # Menu, Trigger, Content, Item, Label, Separator
    │   │
    │   ├── layout/
    │   │   ├── AppLayout.tsx               # Sidebar + Header + Outlet
    │   │   ├── Sidebar.tsx                 # Collapsible, role-based filtreleme
    │   │   ├── Header.tsx                  # Tema toggle + kullanıcı dropdown
    │   │   └── ProtectedRoute.tsx          # JWT + role guard
    │   │
    │   ├── charts/
    │   │   ├── KPICard.tsx                 # Metrik kartı (ikon, değer, trend)
    │   │   ├── BarChartCard.tsx            # Recharts BarChart wrapper
    │   │   ├── PieChartCard.tsx            # Recharts PieChart (donut) wrapper
    │   │   └── LineChartCard.tsx           # Recharts LineChart wrapper
    │   │
    │   └── data-table/
    │       ├── index.ts                    # Barrel export
    │       ├── DataTable.tsx               # Ana tablo (sort, resize, row click)
    │       ├── DataTableToolbar.tsx         # Arama + filtreler + actions
    │       ├── DataTableGlobalSearch.tsx    # Debounced arama
    │       ├── DataTableColumnFilter.tsx    # text/select/multi-select filtreler
    │       ├── DataTableDateRangeFilter.tsx # Tarih aralığı
    │       ├── DataTablePagination.tsx      # Server-side sayfalama
    │       ├── DataTableRowSelection.tsx    # Checkbox satır seçimi
    │       ├── DataTableExport.tsx          # Excel/CSV export
    │       └── DataTableSkeleton.tsx        # Yükleme skeleton
    │
    └── pages/
        ├── Auth/
        │   └── LoginPage.tsx               # Login formu (RHF + Zod + password toggle)
        └── Dashboard/
            └── DashboardPage.tsx           # Rol bazlı KPI kartları + grafikler
```

---

## Teknik Standartlar (Tüm Fazlarda Geçerli)

- **TypeScript Strict Mode:** `any` kullanımı YASAK
- **UI Kit:** Shadcn UI tarzı bileşenler (Radix tabanlı, Tailwind uyumlu)
- **Tailwind CSS v4:** Özel CSS yazmaktan kaçınılacak
- **Mobile-First:** Tailwind breakpointleri (`sm:`, `md:`, `lg:`)
- **Tablo:** TanStack Table (server-side pagination, filtering, sorting, resize, row selection)
- **Grafikler:** Recharts (KPI kartları, BarChart, LineChart, PieChart)
- **Export:** xlsx kütüphanesi (Excel) + native CSV
- **React Hook Form + Zod:** Tüm formlar
- **React Query:** Server state, caching, loading/error handling
- **Zustand:** Global state (auth, tema)
- **Sonner/Toast:** Tüm hata ve başarı mesajları
- **Skeleton UI:** Tüm veri yükleme durumları
- **RBAC:** Buton ve sayfa bazlı yetki kontrolü
- **Lucide React:** İkonlar
- **URL State Sync:** Tablo filtreleri ve sayfalama bilgileri URL'de tutulur

---

## Backend API Endpoint Özeti

| Grup | Base Path | Endpoints | Auth |
|------|-----------|-----------|------|
| **Auth** | `/api/auth` | `POST /login`, `POST /register`, `GET /me` | Login: public, diğerleri: JWT |
| **Items** | `/api/items` | CRUD + `GET /:id` | JWT + `station:read/write` |
| **Customers** | `/api/customers` | CRUD + `GET /:id` | JWT + `customer:read/write` |
| **Stations** | `/api/stations` | CRUD + `GET /:id` | JWT + `station:read/write` |
| **Machines** | `/api/machines` | CRUD + `GET /:id` | JWT + `station:read/write` |
| **Routes** | `/api/routes` | CRUD + `GET /:id` | JWT + `station:read/write` |
| **Rolls** | `/api/rolls` | `GET`, `GET /:id`, `GET /barcode/:barcode`, `POST /initial-entry` | JWT + `roll:read/write` |
| **Orders** | `/api/orders` | CRUD + `GET /:id` | JWT + `order:read/write` |
| **Work Orders** | `/api/work-orders` | CRUD + travel-card + manifest + attach-rolls | JWT + `workorder:read/write` |
| **Production** | `/api/production` | `GET /active-steps`, `POST /step-action`, `POST /report-error` | JWT + `roll:write`, `quality:write` |
| **Tambur** | `/api/tambur` | `GET /pending-rolls`, `GET /rolls/:id`, `POST /finalize`, `POST /allocate` | JWT + `quality:read/write` |
| **Shipping** | `/api/shipping` | ready-orders, prepare-package, shipments CRUD, add-items, finalize | JWT + `shipment:read/write` |

---

## FAZ 3: Master Data Modülleri ✅

### Yapılanlar

#### Altyapı
- **`src/types/enums.ts`** — Tüm enum sabitleri ve Türkçe label map'leri (`ItemType`, `CompanyType`, `StationType`, `RollStatus`, `OrderStatus`, `WorkOrderStatus`, `WorkOrderType`, `ShipmentStatus`)
- **`src/types/models.ts`** — Backend Prisma modellerine karşılık gelen TypeScript interface'leri (`Item`, `Customer`, `Station`, `Machine`, `Route`, `RouteStep`)
- **`src/services/crudService.ts`** — Generic CRUD service factory. `createCrudService<T>(basePath)` ile tüm modüller için `getAll`, `getById`, `create`, `update`, `remove` fonksiyonları otomatik oluşturuluyor
- **`src/services/itemService.ts`** — Items API servisi (`/api/items`)
- **`src/services/customerService.ts`** — Customers API servisi (`/api/customers`)
- **`src/services/stationService.ts`** — Stations API servisi (`/api/stations`)
- **`src/services/machineService.ts`** — Machines API servisi (`/api/machines`)
- **`src/services/routeService.ts`** — Routes API servisi (`/api/routes`)
- **`src/hooks/useCrudMutations.ts`** — Generic CRUD mutation hook'u (create/update/remove + toast feedback + query invalidation)
- **`src/components/ui/dialog.tsx`** — Custom Dialog/Modal bileşeni (controlled, ESC ile kapatma, overlay click, body scroll lock)

#### Sayfalar (Her biri: DataTable + Toolbar + Pagination + CRUD Dialog + Export)

| Modül | Sayfa | Dialog | Route | Özellikler |
|-------|-------|--------|-------|------------|
| **Stok Kartları** | `ItemsPage.tsx` | `ItemFormDialog.tsx` | `/items` | Tür filtresi (İplik/Çözgü/Ham/Boyalı/Sarf), Durum filtresi, renk kodlu badge'ler |
| **Müşteriler** | `CustomersPage.tsx` | `CustomerFormDialog.tsx` | `/customers` | Tür filtresi (Müşteri/Tedarikçi/Fasoncu), Vergi No, Durum filtresi |
| **İstasyonlar** | `StationsPage.tsx` | `StationFormDialog.tsx` | `/stations` | Tür filtresi (Dahili/Harici), Departman, Makine sayısı gösterimi |
| **Makineler** | `MachinesPage.tsx` | `MachineFormDialog.tsx` | `/machines` | İstasyon ilişkisi (dropdown ile seçim), Cihaz IP |
| **Rotalar** | `RoutesPage.tsx` | `RouteFormDialog.tsx` | `/routes` | Adım sayısı, istasyon önizlemesi (→ ile akış), nested step create |

#### Ortak Özellikler (Tüm Sayfalar)
- Server-side pagination, sorting, global search (URL sync)
- Column-based filtering (enum dropdown'ları)
- Row selection + toplu seçim
- Excel/CSV export (tüm veri + seçili satırlar)
- Zod form validation ile CRUD Dialog
- Skeleton loading state + isFetching opacity
- Responsive toolbar layout
- Düzenleme ve silme (pasife alma) aksiyonları

### Güncellenen Bileşenler
- **`DataTable`** — `columnCount` ve `isFetching` prop'ları eklendi
- **`DataTableToolbar`** — `table` prop'u kaldırıldı, `filters`/`onClearAll`/`children` prop'ları eklendi
- **`DataTableExport`** — `accessor` artık hem string hem fonksiyon destekliyor
- **`PieChartCard`** — Strict TypeScript uyumluluğu düzeltildi
- **`tsconfig.app.json`** — `ignoreDeprecations: "6.0"` eklendi (TS7 uyumluluk)

### Dosya Haritası (FAZ 3 Yeni Dosyalar)
```
src/
├── types/
│   ├── enums.ts                    ← Enum sabitler + label'lar
│   └── models.ts                   ← Model interface'leri
├── services/
│   ├── crudService.ts              ← Generic CRUD factory
│   ├── itemService.ts
│   ├── customerService.ts
│   ├── stationService.ts
│   ├── machineService.ts
│   └── routeService.ts
├── hooks/
│   └── useCrudMutations.ts         ← Generic mutation hook
├── components/ui/
│   └── dialog.tsx                  ← Modal bileşeni
└── pages/
    ├── Items/
    │   ├── ItemsPage.tsx
    │   └── ItemFormDialog.tsx
    ├── Customers/
    │   ├── CustomersPage.tsx
    │   └── CustomerFormDialog.tsx
    ├── Stations/
    │   ├── StationsPage.tsx
    │   └── StationFormDialog.tsx
    ├── Machines/
    │   ├── MachinesPage.tsx
    │   └── MachineFormDialog.tsx
    └── Routes/
        ├── RoutesPage.tsx
        └── RouteFormDialog.tsx
```

---

## FAZ 4: Envanter (Rolls/Toplar) ✅

### Yapılanlar

#### Backend Entegrasyonu
Roll modülü standart CRUD'dan farklı çalışıyor:
- **Listeleme:** `GET /api/rolls` — Varsayılan olarak sadece `STOCK` durumundaki topları döner
- **Detay:** `GET /api/rolls/:id` — Hatalar (`RollError`) ve tahsisler (`OrderAllocation`) ile birlikte
- **Barkod Sorgulama:** `GET /api/rolls/barcode/:barcode` — El terminali/barkod okuyucu desteği
- **Mal Kabul:** `POST /api/rolls/initial-entry` — Barkod otomatik üretilir, durum `STOCK` olarak atanır

#### Tipler
- **`types/models.ts`** — `Roll`, `RollError`, `OrderAllocation` interface'leri eklendi
- **`types/enums.ts`** — `rollStatusLabels` Türkçe label map eklendi

#### Servis
- **`services/rollService.ts`** — Custom servis (`getAll`, `getById`, `getByBarcode`, `createInitialEntry`)

#### Sayfalar

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **RollsPage** | `pages/Rolls/RollsPage.tsx` | DataTable + Toolbar + Pagination + Export. Durum filtresi (6 durum), barkod ile hızlı arama, satıra tıklayınca detay paneli |
| **InitialEntryDialog** | `pages/Rolls/InitialEntryDialog.tsx` | Mal Kabul formu: ürün seçimi (dropdown), miktar, ağırlık, kalite sınıfı. Barkod otomatik üretilir |
| **RollDetailPanel** | `pages/Rolls/RollDetailPanel.tsx` | Sağdan açılan slide panel. Barkod, ürün bilgisi, ölçümler, paketleme, hatalar listesi, sipariş tahsisleri |

#### Özellikler
- Barkod ile hızlı arama (header'da ayrı input, Enter ile sorgulama)
- Durum bazlı renk kodlu badge'ler (Stokta/Üretimde/Üretildi/Sevke Hazır/Sevk Edildi/Fire)
- Mevcut miktar / ilk miktar karşılaştırmalı gösterim
- Detay panelinde hata listesi (metre aralığı, hata türü, işlenme durumu)
- Detay panelinde sipariş tahsisleri (sipariş numarası, tahsis miktarı)
- Paketleme bilgileri (paket ID, brüt/net ağırlık, paketleme tarihi)
- Excel/CSV export (tüm veri + seçili satırlar)
- Skeleton loading + isFetching opacity

### Dosya Haritası (FAZ 4 Yeni Dosyalar)
```
src/
├── types/
│   ├── enums.ts                    ← rollStatusLabels eklendi
│   └── models.ts                   ← Roll, RollError, OrderAllocation eklendi
├── services/
│   └── rollService.ts              ← Custom roll servisi
└── pages/Rolls/
    ├── RollsPage.tsx               ← Ana liste sayfası
    ├── InitialEntryDialog.tsx       ← Mal kabul formu
    └── RollDetailPanel.tsx          ← Slide detay paneli
```

---

## FAZ 5: Sipariş Yönetimi (Orders) ✅

### Yapılanlar

#### Backend Entegrasyonu
Sipariş modülü `BaseController` + `BaseService` ile çalışıyor. `nestedCreateFields: ["lines"]` ile sipariş kalemleri nested create destekliyor.
- **Listeleme:** `GET /api/orders` — Müşteri ve kalemler (item dahil) ile birlikte
- **Detay:** `GET /api/orders/:id` — Kalemler + ürün bilgisi
- **Oluşturma:** `POST /api/orders` — Nested lines create desteği
- **Güncelleme:** `PATCH /api/orders/:id`
- **İptal:** `DELETE /api/orders/:id` — Soft cancel (status=CANCELLED)

#### Tipler
- **`types/models.ts`** — `Order`, `OrderLine` interface'leri eklendi
- **`types/enums.ts`** — `orderStatusLabels` Türkçe label map eklendi

#### Sayfalar

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **OrdersPage** | `pages/Orders/OrdersPage.tsx` | DataTable + Toolbar + Pagination + Export. Durum filtresi (6 durum), sipariş no ile arama, satıra tıklayınca detay paneli |
| **OrderFormDialog** | `pages/Orders/OrderFormDialog.tsx` | Sipariş formu: sipariş no, müşteri dropdown, para birimi, termin tarihi. Nested sipariş kalemleri: ürün seçimi, miktar, birim fiyat |
| **OrderDetailPanel** | `pages/Orders/OrderDetailPanel.tsx` | Sağdan açılan slide panel. Sipariş bilgileri, müşteri, tutar, tarihler. Kalemler listesi (ürün kodu/isim, miktar, fiyat) ve her kalemin tahsisleri |

#### Özellikler
- Nested create: Sipariş + kalemler tek istekte oluşturma
- Durum bazlı renk kodlu badge'ler (Beklemede/Onaylandı/Üretimde/Kısmi Sevk/Tamamlandı/İptal)
- Müşteri ve ürün dropdown'ları (aktif kayıtlardan çekilir)
- Kalem sayısı badge gösterimi
- Tutar formatlaması (tr-TR locale, 2 ondalık)
- Termin tarihi gösterimi
- Detay panelinde kalem bazlı tahsis bilgisi
- Excel/CSV export

### Dosya Haritası (FAZ 5 Yeni Dosyalar)
```
src/
├── types/
│   ├── enums.ts                    ← orderStatusLabels eklendi
│   └── models.ts                   ← Order, OrderLine eklendi
├── services/
│   └── orderService.ts             ← crudService factory
└── pages/Orders/
    ├── OrdersPage.tsx              ← Ana liste sayfası
    ├── OrderFormDialog.tsx          ← Nested lines ile sipariş formu
    └── OrderDetailPanel.tsx         ← Slide detay paneli
```

---

## FAZ 6: İş Emri (Work Orders) ✅

### Yapılanlar

#### Backend Entegrasyonu
İş emri modülü custom controller/service ile çalışıyor. Standart CRUD'dan çok daha zengin:
- **Listeleme:** `GET /api/work-orders` — Rota adımları (station dahil) ve sipariş bağlantıları ile birlikte
- **Detay:** `GET /api/work-orders/:id` — Adımlar + istasyonlar + sipariş kalemleri (müşteri + ürün)
- **Oluşturma:** `POST /api/work-orders` — Rota adımları + isteğe bağlı sipariş kalem bağlantıları
- **Top Bağlama:** `PATCH /api/work-orders/:id/attach-rolls` — Barkod ile topları iş emrine bağlar (STOCK→IN_PRODUCTION)
- **Refakat Kartı:** `GET /api/work-orders/:id/travel-card` — Barkod ve rota bilgileri
- **Çeki Listesi:** `GET /api/work-orders/:id/manifest` — Top metraj ve kilo özeti

#### Tipler
- **`types/models.ts`** — `WorkOrder`, `WorkOrderStep`, `WorkOrderToOrderLine` interface'leri
- **`types/enums.ts`** — `workOrderStatusLabels`, `workOrderTypeLabels`, `StepStatus` enum + `stepStatusLabels`

#### Servis
- **`services/workOrderService.ts`** — Custom servis (6 endpoint: `getAll`, `getById`, `create`, `attachRolls`, `getTravelCard`, `getManifest`)

#### Sayfalar

| Bileşen | Dosya | Açıklama |
|---------|-------|----------|
| **WorkOrdersPage** | `pages/WorkOrders/WorkOrdersPage.tsx` | DataTable + Toolbar. Durum + tür filtresi, rota önizlemesi (→ akış), sipariş sayısı, detay + top bağla aksiyonları |
| **WorkOrderFormDialog** | `pages/WorkOrders/WorkOrderFormDialog.tsx` | İş emri oluşturma: parti no, tür seçimi, dinamik rota adımları (istasyon dropdown) |
| **AttachRollsDialog** | `pages/WorkOrders/AttachRollsDialog.tsx` | Barkod tarama ile top bağlama. Birden fazla barkod ekleme, badge ile listeleme, toplu gönderim |
| **WorkOrderDetailPanel** | `pages/WorkOrders/WorkOrderDetailPanel.tsx` | Slide panel: genel bilgiler, parametreler, rota adımları (durum ikonları + renk kodlu), bağlı siparişler |

#### Özellikler
- Rota adımları durum gösterimi (PENDING/ACTIVE/COMPLETED/SKIPPED) — ikon + renk kodlu border
- İş emri türü renk kodlu badge (Dokuma/Çözgü/Kumaş Boyama/Tekrar İşlem)
- Top bağlama: barkod tarama, Enter ile ekleme, batch gönderim, hata raporlama
- Rota önizlemesi tabloda (→ ile istasyon akışı)
- Dinamik parametreler gösterimi (JSON)
- Sipariş bağlantıları (müşteri, ürün, miktar)

### Dosya Haritası (FAZ 6 Yeni Dosyalar)
```
src/
├── types/
│   ├── enums.ts                        ← workOrderStatusLabels, workOrderTypeLabels, StepStatus, stepStatusLabels
│   └── models.ts                       ← WorkOrder, WorkOrderStep, WorkOrderToOrderLine
├── services/
│   └── workOrderService.ts             ← Custom 6-endpoint servis
└── pages/WorkOrders/
    ├── WorkOrdersPage.tsx              ← Ana liste sayfası
    ├── WorkOrderFormDialog.tsx          ← İş emri + rota adımları formu
    ├── AttachRollsDialog.tsx            ← Barkod tarama ile top bağlama
    └── WorkOrderDetailPanel.tsx         ← Slide detay paneli
```

---

## Çalıştırma

```bash
# Frontend (react/ dizininde)
npm run dev          # → http://localhost:5173

# Backend (Teks-Erp/ dizininde)
npm run dev          # → http://localhost:4000
                     # → Swagger: http://localhost:4000/api-docs

# Test kullanıcıları
# admin / admin123           → Tam yetki
# mehmet.planlama / test123  → İş emri, sipariş
# ali.operator / test123     → Üretim operatörü
# ayse.kalite / test123      → Kalite kontrol
# fatma.satis / test123      → Satış temsilcisi
# veli.sevkiyat / test123    → Sevkiyatçı
```
