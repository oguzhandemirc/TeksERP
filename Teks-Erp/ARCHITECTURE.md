# TeksERP — Mimari ve Teknik Dökümantasyon

> **Son güncelleme:** 15 Nisan 2026  
> **Bu dosya hem AI ajanlar hem de geliştiriciler için hazırlanmıştır.**  
> Projeye katkıda bulunmadan önce bu dökümanı okuyun.

---

## 1. Proje Özeti

TeksERP, bir **tekstil fabrikası** için tasarlanmış uçtan uca ERP backend sistemidir. Ham kumaşın fabrikaya girişinden boyama, kalite kontrol, paketleme ve sevkiyata kadar tüm üretim sürecini yönetir.

### Temel Akış (End-to-End)

```
Ham Mal Girişi → İş Emri → Boyahane → Kurşun (QC) → Tambur (Karar) → Paketleme → Sevkiyat
     ↑               ↑            ↑           ↑             ↑              ↑          ↑
  Inventory      Planning    Production   Production     Tambur        Shipping    Shipping
   (Faz 2)       (Faz 3)     (Faz 4)      (Faz 4)       (Faz 5)       (Faz 6)     (Faz 6)
```

### Müşteri / Domain Bilgisi

- **Sektör:** Tekstil (dokuma, boyama, baskı)
- **Birimler:** Metraj (MT), Kilogram (KG), Adet
- **Dil:** Tüm API mesajları ve Swagger açıklamaları Türkçe
- **Top (Roll):** Üretimin temel birimi. Her top benzersiz barkoda sahiptir.
- **Parti (Work Order):** Bir veya birden fazla topun birlikte işlendiği iş emri.

---

## 2. Tech Stack

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| Runtime | Node.js | — |
| Dil | TypeScript (strict) | 6.x |
| Framework | Express | 5.x |
| ORM | Prisma + pg adapter | 7.x |
| Veritabanı | PostgreSQL | — |
| Auth | JWT (jsonwebtoken + bcryptjs) | — |
| Validasyon | Zod | 4.x |
| API Docs | Swagger (swagger-jsdoc + swagger-ui-express) | — |
| Güvenlik | Helmet, CORS | — |
| Loglama | Morgan | — |

### Kritik Versiyon Notları

- **Zod v4:** `z.record()` iki parametre alır → `z.record(z.string(), z.unknown())`
- **Prisma 7:** `@prisma/adapter-pg` ile doğrudan `pg` Pool kullanılır
- **Express 5:** `req.params` typed farklılıkları var, `as string` gerekebilir

---

## 3. Dizin Yapısı

```
Teks-Erp/
├── prisma/
│   ├── schema.prisma          # 22 model, 8 enum — TÜM veritabanı şeması
│   ├── seed.ts                # Gerçekçi test verisi (858 satır)
│   ├── migrations/            # Prisma migration dosyaları
│   └── tsconfig.json          # Seed için ayrı TS config
│
├── src/
│   ├── server.ts              # Entry point — PORT dinleme
│   ├── app.ts                 # Express app — middleware + route kayıtları
│   │
│   ├── config/
│   │   └── swagger.ts         # OpenAPI 3.0 yapılandırması
│   │
│   ├── lib/
│   │   └── prisma.ts          # PrismaClient singleton (pg adapter)
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.ts  # JWT doğrulama → req.user
│   │   ├── rbac.middleware.ts  # Yetki kontrolü (requirePermission)
│   │   └── error.middleware.ts # Global hata yakalama (Prisma, Zod, AppError)
│   │
│   ├── controllers/
│   │   ├── base.controller.ts      # Genel CRUD (Master Data için)
│   │   ├── auth.controller.ts      # Login, register, me
│   │   ├── inventory.controller.ts # Roll girişi, envanter
│   │   ├── workorder.controller.ts # İş emri, top bağlama
│   │   ├── production.controller.ts# İstasyon aksiyonları, hata raporlama
│   │   ├── tambur.controller.ts    # Tambur kararları, tahsis
│   │   └── shipping.controller.ts  # Paketleme, sevkiyat
│   │
│   ├── services/
│   │   ├── base.service.ts         # Dynamic Query Engine (filter/sort/page)
│   │   ├── audit.service.ts        # SystemLog otomasyonu
│   │   ├── auth.service.ts         # JWT sign/verify, password hash
│   │   ├── inventory.service.ts    # Roll oluşturma, barkod üretimi
│   │   ├── workorder.service.ts    # İş emri, rota, top bağlama
│   │   ├── production.service.ts   # İstasyon start/finish, QC2
│   │   ├── tambur.service.ts       # Roll splitting, tahsis
│   │   └── shipping.service.ts     # Paketleme, sevkiyat, auto-complete
│   │
│   ├── routes/
│   │   ├── auth.routes.ts          # /api/auth/*
│   │   ├── item.routes.ts          # /api/items/*
│   │   ├── customer.routes.ts      # /api/customers/*
│   │   ├── station.routes.ts       # /api/stations/* + /api/machines/*
│   │   ├── route.routes.ts         # /api/routes/*
│   │   ├── inventory.routes.ts     # /api/rolls/*
│   │   ├── order.routes.ts         # /api/orders/*
│   │   ├── workorder.routes.ts     # /api/work-orders/*
│   │   ├── production.routes.ts    # /api/production/*
│   │   ├── tambur.routes.ts        # /api/tambur/*
│   │   └── shipping.routes.ts      # /api/shipping/*
│   │
│   ├── types/
│   │   ├── api.types.ts            # ApiResponse, PaginatedResponse, JwtPayload
│   │   └── express-augment.ts      # Express Request'e user ekleme
│   │
│   └── utils/
│       ├── app-error.ts            # Custom error sınıfı (400,401,403,404,409,500)
│       └── query-parser.ts         # URL query → Prisma where/orderBy/skip/take
│
├── .agents/                        # AI ajan yapılandırması
│   ├── rules/                      # business-rules.md, core-architecture.md
│   ├── workflows/                  # Faz bazlı workflow tanımları
│   ├── skills/                     # prisma-expert, nodejs-backend-patterns vb.
│   └── knowledge/                  # teksERP-specs.md
│
├── .env                            # DATABASE_URL, JWT_SECRET, PORT
├── package.json
└── tsconfig.json
```

---

## 4. Mimari Katmanlar (Layered Architecture)

```
┌─────────────────────────────────────────────┐
│                   ROUTES                     │  Swagger JSDoc + RBAC + Auth middleware
│  Express Router → verifyToken → requirePerm  │
├─────────────────────────────────────────────┤
│                CONTROLLERS                   │  Zod validasyon + HTTP status kodları
│  Zod parse → Service call → res.json()       │
├─────────────────────────────────────────────┤
│                 SERVICES                     │  İş kuralları + Prisma queries
│  Transaction + AuditService.log()            │
├─────────────────────────────────────────────┤
│              PRISMA CLIENT                   │  Singleton in src/lib/prisma.ts
│  pg adapter → PostgreSQL                     │
└─────────────────────────────────────────────┘
```

### Katman Kuralları

1. **Route** dosyası: Sadece middleware zinciri tanımlar + Swagger JSDoc
2. **Controller**: Zod ile validasyon, Service'i çağır, HTTP yanıt dön
3. **Service**: İş mantığı, Prisma query, transaction, AuditService
4. **Hiçbir katman** alt katmanı atlamamalı (Route → Controller → Service → Prisma)

---

## 5. Veritabanı Şeması (ER Özet)

### Model Sayıları

| Grup | Modeller | Adet |
|------|----------|------|
| RBAC | User, Role, Permission, UserRole, RolePermission | 5 |
| Master Data | Station, Machine, Route, RouteStep | 4 |
| Inventory | Item, Roll | 2 |
| Sales | Customer, Order, OrderLine | 3 |
| Production | WorkOrder, WorkOrderStep, WorkOrderToOrderLine, RollError | 4 |
| Logistics | OrderAllocation, Shipment, ShipmentItem | 3 |
| Finance | CurrentAccount, MachineLog | 2 |
| Audit | SystemLog | 1 |
| **TOPLAM** | | **22** |

### Enumlar

```
StationType:    INTERNAL | EXTERNAL
ItemType:       YARN | WARP | RAW_FABRIC | DYED_FABRIC | CONSUMABLE
RollStatus:     STOCK | IN_PRODUCTION | PRODUCED | READY_FOR_SHIP | SHIPPED | SCRAP
CompanyType:    CUSTOMER | SUPPLIER | SUBCONTRACTOR
OrderStatus:    PENDING | APPROVED | IN_PRODUCTION | PARTIAL_SHIPPED | COMPLETED | CANCELLED
WorkOrderType:  WEAVING | WARPING | FABRIC_DYEING | RE_PROCESS
WorkOrderStatus:PLANNED | IN_PROGRESS | PAUSED | COMPLETED | CANCELLED
StepStatus:     PENDING | ACTIVE | COMPLETED | SKIPPED
ShipmentStatus: PREPARING | SHIPPED | CANCELLED
```

### Roll Yaşam Döngüsü (Kritik)

```
STOCK → IN_PRODUCTION → PRODUCED → READY_FOR_SHIP → SHIPPED
                                         ↓
                                       SCRAP (Roll Splitting)
```

### Veritabanı Kuralları

- **PK:** Tüm modellerde `String @id @default(uuid())`
- **Timestamps:** `createdAt` + `updatedAt` her modelde zorunlu
- **Soft Delete:** Fiziksel DELETE yok, `isActive = false` kullanılır
- **Audit:** Her CUD işlem `SystemLog` tablosuna kaydedilir

---

## 6. API Endpoint Haritası

### Kimlik Doğrulama (Public)
| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/auth/login` | JWT token al |
| POST | `/api/auth/register` | Yeni kullanıcı (admin only) |
| GET | `/api/auth/me` | Mevcut kullanıcı bilgisi |

### Master Data (BaseController CRUD)
| Method | Endpoint | Yetki |
|--------|----------|-------|
| CRUD | `/api/items` | `station:write` |
| CRUD | `/api/customers` | `station:write` |
| CRUD | `/api/stations` | `station:read/write` |
| CRUD | `/api/machines` | `station:read/write` |
| CRUD | `/api/routes` | `station:read/write` |

### Envanter (Faz 2)
| Method | Endpoint | Yetki | Açıklama |
|--------|----------|-------|----------|
| GET | `/api/rolls` | `inventory:read` | Stok listesi (varsayılan: STOCK) |
| GET | `/api/rolls/:id` | `inventory:read` | Top detayı |
| GET | `/api/rolls/barcode/:barcode` | `inventory:read` | Barkod sorgusu |
| POST | `/api/rolls/initial-entry` | `inventory:write` | Ham mal girişi |

### Planlama (Faz 3)
| Method | Endpoint | Yetki | Açıklama |
|--------|----------|-------|----------|
| CRUD | `/api/orders` | `planning:read/write` | Sipariş yönetimi |
| GET | `/api/work-orders` | `planning:read` | İş emri listesi |
| GET | `/api/work-orders/:id` | `planning:read` | İş emri detayı |
| POST | `/api/work-orders` | `planning:write` | İş emri oluştur |
| PATCH | `/api/work-orders/:id/attach-rolls` | `planning:write` | Top bağla |
| GET | `/api/work-orders/:id/travel-card` | `planning:read` | Refakat kartı |
| GET | `/api/work-orders/:id/manifest` | `planning:read` | Çeki listesi |

### Üretim (Faz 4)
| Method | Endpoint | Yetki | Açıklama |
|--------|----------|-------|----------|
| POST | `/api/production/step-action` | `production:write` | İstasyon başlat/tamamla |
| GET | `/api/production/active-steps` | `production:read` | Aktif üretim dashboard |
| POST | `/api/production/report-error` | `qc:write` | Kurşun hata raporlama |

### Tambur (Faz 5)
| Method | Endpoint | Yetki | Açıklama |
|--------|----------|-------|----------|
| GET | `/api/tambur/pending-rolls` | `tambur:read` | Bekleyen toplar |
| GET | `/api/tambur/rolls/:rollId` | `tambur:read` | Karar ekranı |
| POST | `/api/tambur/finalize` | `tambur:write` | **Roll Splitting** |
| POST | `/api/tambur/allocate` | `tambur:write` | Sipariş tahsisi |

### Sevkiyat (Faz 6)
| Method | Endpoint | Yetki | Açıklama |
|--------|----------|-------|----------|
| GET | `/api/shipping/ready-orders` | `shipping:read` | Hazır siparişler |
| POST | `/api/shipping/prepare-package` | `shipping:write` | Paketleme |
| POST | `/api/shipping/shipments` | `shipping:write` | İrsaliye oluştur |
| PATCH | `/api/shipping/shipments/:id/add-items` | `shipping:write` | Ürün ekle |
| POST | `/api/shipping/shipments/:id/finalize` | `shipping:write` | **Sevkiyat onayla** |

---

## 7. Kritik İş Kuralları

> ⚠️ Bu kurallar kod yazarken mutlaka uyulması gereken domain gereksinimleridir.

### 7.1 Roll Splitting (Tambur — tambur.service.ts)

```
Kurşun'da hata tespit edildi → Tambur'da karar verildi: "KES"
  ↓
Orijinal topun metrajı AZALTILMAZ!
Kesilen parça için YENİ bir Roll kaydı oluşturulur (yeni barkod).
Yeni Roll → status: SCRAP, qualityGrade: FIRE veya A1
Orijinal Roll → currentQty güncellenir, status: PRODUCED
```

### 7.2 Taşeron Fire Hesabı (Production — production.service.ts)

```
İstasyon tipi EXTERNAL (boyahane, baskı vb.) ve action = FINISH ise:
  → newQty ve/veya newWeight ZORUNLU
  → Roll.currentQty güncellenir (çekme/fire sonrası)
```

### 7.3 Esnek Müşteri Ataması (Shipping — shipping.service.ts)

```
Müşteri A'ya tahsisli top → Müşteri B'nin sevkiyatına ekleniyor:
  → Eski OrderAllocation silinir
  → Top yeni sevkiyata eklenir
```

### 7.4 Otomatik Sipariş Tamamlama (Shipping — shipping.service.ts)

```
Sevkiyat onaylandığında (SHIPPED):
  → Etkilenen her sipariş için toplam shippedQty hesaplanır
  → shippedQty >= requestedQty → Order.status = COMPLETED
  → Aksi halde → Order.status = PARTIAL_SHIPPED
```

### 7.5 İş Emri Esnekliği (WorkOrder — workorder.service.ts)

```
- İş emri siparişsiz olabilir (stok için üretim)
- İş emri birden fazla siparişe bağlanabilir
- Sevkiyat iş emrini görmez, sadece sipariş görür
```

---

## 8. Geliştirme Kalıpları (Patterns)

### 8.1 Yeni Master Data Modülü Ekleme (BaseController Kullanımı)

Yeni bir tablo için (örn. `Warehouse`) sadece route dosyası yeterlidir:

```typescript
// src/routes/warehouse.routes.ts
import { BaseService } from "../services/base.service";
import { BaseController } from "../controllers/base.controller";

const service = new BaseService({
  modelName: "warehouse",      // Prisma model adı (küçük harf)
  tableName: "WAREHOUSE",      // SystemLog için tablo adı
  searchFields: ["code", "name"], // ?search= parametresi ile aranacak alanlar
  defaultInclude: undefined,   // İlişkili verileri otomatik getir
});

const controller = new BaseController(service);
// ... router.get("/", verifyToken, ..., controller.findAll);
```

### 8.2 Yeni İş Mantığı Modülü Ekleme

```
1. src/services/yenimodul.service.ts    — İş kuralları + Prisma
2. src/controllers/yenimodul.controller.ts — Zod validasyon + HTTP
3. src/routes/yenimodul.routes.ts       — Swagger JSDoc + RBAC
4. src/app.ts'e import ve app.use() ekle
```

### 8.3 Zod Validasyon Şablonu

```typescript
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1, "Ad gerekli"),
  quantity: z.number().positive("Miktar pozitif olmalı"),
  type: z.enum(["TYPE_A", "TYPE_B"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), // Zod v4!
});
```

### 8.4 Transaction Kullanımı

```typescript
const result = await prisma.$transaction(async (tx) => {
  const a = await tx.model1.create({ data: { ... } });
  const b = await tx.model2.update({ where: { id }, data: { ... } });
  return { a, b };
});
```

### 8.5 AuditService Kullanımı

**Her CUD işlemde zorunlu:**

```typescript
await AuditService.log({
  userId,                    // req.user?.userId
  action: "CREATE",          // "CREATE" | "UPDATE" | "DELETE"
  tableName: "ROLL",         // Büyük harf tablo adı
  recordId: record.id,       // Etkilenen kaydın ID'si
  oldData: { ... },          // UPDATE/DELETE'de eski veri
  newData: { ... },          // CREATE/UPDATE'de yeni veri
});
```

---

## 9. Ortak API Yanıt Formatları

### Başarılı Tekil Yanıt

```json
{
  "success": true,
  "data": { "id": "uuid", ... },
  "message": "Kayıt oluşturuldu"
}
```

### Başarılı Sayfalanmış Liste

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

### Hata Yanıtı

```json
{
  "success": false,
  "message": "Kayıt bulunamadı"
}
```

### Validasyon Hatası (Zod)

```json
{
  "success": false,
  "message": "Validasyon hatası",
  "errors": [
    { "field": "initialQty", "message": "Miktar pozitif olmalı" }
  ]
}
```

---

## 10. Ortam Değişkenleri

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `PORT` | Sunucu portu | `4000` |
| `DATABASE_URL` | PostgreSQL bağlantı | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | JWT imzalama anahtarı | `supersecret_key` |

---

## 11. Çalıştırma Komutları

```bash
# Geliştirme sunucusu
npm run dev

# Prisma şemasından client üret (şema değiştiğinde zorunlu)
npm run prisma:generate

# Veritabanı migration
npm run prisma:migrate

# Test verisi yükle
npm run seed

# Prisma Studio (DB GUI)
npm run prisma:studio

# TypeScript derleme kontrolü
npx tsc --noEmit
```

---

## 12. Test Kullanıcıları (Seed Data)

| Kullanıcı | Şifre | Rol | Yetkiler |
|-----------|-------|-----|----------|
| `admin` | `admin123` | Admin | TÜM yetkiler |
| `mehmet.planlama` | `test123` | Planlama Şefi | workorder, roll, order, allocation |
| `ali.operator` | `test123` | Üretim Operatörü | workorder:read, roll, station:read |
| `ayse.kalite` | `test123` | Kalite Kontrol | quality, roll, workorder:read |
| `fatma.satis` | `test123` | Satış Temsilcisi | order, customer, allocation:read |
| `veli.sevkiyat` | `test123` | Sevkiyatçı | shipment, order:read, roll:read |

---

## 13. RBAC Yetki Kodları

| Modül | Read | Write |
|-------|------|-------|
| station | `station:read` | `station:write` |
| inventory | `inventory:read` | `inventory:write` |
| planning | `planning:read` | `planning:write` |
| production | `production:read` | `production:write` |
| qc | — | `qc:write` |
| tambur | `tambur:read` | `tambur:write` |
| shipping | `shipping:read` | `shipping:write` |
| admin | — | `admin:users`, `admin:roles` |

> **Not:** Seed verisindeki permission kodları (`order:read`, `roll:write` vb.) ile route'lardaki
> permission kodları (`planning:read`, `inventory:write` vb.) arasında fark vardır.
> Production'a geçmeden önce seed'deki permission'lar güncellenmeli veya route'lar
> seed ile uyumlu hale getirilmelidir.

---

## 14. Swagger / API Dökümantasyonu

Sunucu çalışırken: **http://localhost:4000/api-docs**

Tüm endpoint'ler `@openapi` JSDoc blokları ile dökümante edilmiştir.

---

## 15. AI Ajanlar İçin Hızlı Referans

### Dosya Bulma Rehberi

| Yapmak İstediğin | Bakılacak Dosya |
|-------------------|----------------|
| Yeni endpoint eklemek | `src/routes/` → `src/controllers/` → `src/services/` |
| Veritabanı şemasını değiştirmek | `prisma/schema.prisma` → `prisma:migrate` → `prisma:generate` |
| İş kurallarını anlamak | Bu dosyanın §7 bölümü + `.agents/rules/business-rules.md` |
| Mimari kuralları anlamak | Bu dosyanın §4 bölümü + `.agents/rules/core-architecture.md` |
| Yeni modül workflow'u | `.agents/workflows/` altındaki ilgili `.md` dosyası |
| Test verisi | `prisma/seed.ts` |
| Hata ayıklama | `src/middlewares/error.middleware.ts` |

### Sık Yapılan Hatalar

1. **`prisma generate` unutmak** → `Module has no exported member 'PrismaClient'`
2. **Zod v4'te `z.record()` tek parametre vermek** → İki parametre gerekli
3. **Express 5'te `req.params.id`** → `as string` cast gerekebilir
4. **Route kaydetmeyi unutmak** → `app.ts`'e `app.use()` eklenmeli
5. **Audit log çağırmamak** → Her CUD işlemde `AuditService.log()` zorunlu
6. **Fiziksel DELETE yapmak** → YASAK! `isActive = false` veya status değişikliği kullan

### Yeni Modül Ekleme Kontrol Listesi

```
□ Service dosyası oluştur (src/services/)
□ Controller dosyası oluştur (src/controllers/)
□ Route dosyası oluştur + Swagger JSDoc ekle (src/routes/)
□ app.ts'e import ve app.use() ekle
□ RBAC permission kodu belirle
□ AuditService.log() çağrılarını ekle
□ Zod validasyon şemalarını yaz
□ tsc --noEmit ile kontrol et
□ Bu dökümana endpoint tablosunu ekle
```
