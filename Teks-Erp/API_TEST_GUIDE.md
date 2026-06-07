# TeksERP — API Test Rehberi (Swagger / Postman)

> **Son güncelleme:** 15 Nisan 2026
> Bu rehber, TeksERP API'sini uçtan uca test etmenizi sağlar.
> Her adımda hangi endpoint'i çağıracağınız, hangi tablo etkilenecek ve dönen yanıttan neyi sonraki adıma taşıyacağınız açıklanmıştır.

---

## İçindekiler

1. [Başlamadan Önce](#1-başlamadan-önce)
2. [Veritabanı Tablo Haritası](#2-veritabanı-tablo-haritası)
3. [Adım 0 — Giriş ve Token Alma](#3-adım-0--giriş-ve-token-alma)
4. [Senaryo A — Ürün ve Müşteri (Master Data)](#4-senaryo-a--ürün-ve-müşteri-master-data)
5. [Senaryo B — Envanter / Top Girişi (QC1)](#5-senaryo-b--envanter--top-girişi-qc1)
6. [Senaryo C — Sipariş ve İş Emri (Planlama)](#6-senaryo-c--sipariş-ve-iş-emri-planlama)
7. [Senaryo D — Üretim Akışı (Boyahane → Kurşun)](#7-senaryo-d--üretim-akışı-boyahane--kurşun)
8. [Senaryo E — Tambur (Roll Splitting + Tahsis)](#8-senaryo-e--tambur-roll-splitting--tahsis)
9. [Senaryo F — Sevkiyat](#9-senaryo-f--sevkiyat)
10. [Hata Senaryoları](#10-hata-senaryoları)
11. [Uçtan Uca Kontrol Listesi](#11-uçtan-uca-kontrol-listesi)
12. [Temiz Başlangıç (Veri Sıfırlama)](#12-temiz-başlangıç-veri-sıfırlama)
13. [Postman İpuçları](#13-postman-ipuçları)

---

## 1. Başlamadan Önce

### Sunucuyu Başlat

```bash
npm run dev
# → http://localhost:4000
# → Swagger UI: http://localhost:4000/api-docs
```

### Swagger UI Kullanım Adımları

1. Tarayıcıda `http://localhost:4000/api-docs` adresine gidin
2. Önce `/api/auth/login` endpoint'ini çalıştırın
3. Dönen `token` değerini kopyalayın
4. Sağ üstteki **Authorize** 🔒 butonuna tıklayın
5. `Bearer <token>` yazıp **Authorize** deyin
6. Artık tüm endpoint'leri kullanabilirsiniz

### Test Kullanıcıları

| Kullanıcı | Şifre | Hedef Rol | Seed Sonrası Yetki Durumu |
|-----------|-------|-----|--------|
| `admin` | `123123` | Admin | ✅ **Tam yetki** — tüm 42 permission seed'de atanıyor |
| `mehmet.planlama` | `test123` | Planlama Şefi (hedef) | ⚠️ **Yetkisiz başlar** — login olur ama her endpoint'te `403` alır |
| `ali.operator` | `test123` | Üretim Operatörü (hedef) | ⚠️ **Yetkisiz başlar** |
| `ayse.kalite` | `test123` | Kalite Kontrol (hedef) | ⚠️ **Yetkisiz başlar** |
| `fatma.satis` | `test123` | Satış Temsilcisi (hedef) | ⚠️ **Yetkisiz başlar** |
| `ali.kursun` | `test123` | Mobil — Kurşun/KK2 (hedef) | ⚠️ **Yetkisiz başlar** |
| `ahmet.depo` | `test123` | Mobil — Depo/Tambur (hedef) | ⚠️ **Yetkisiz başlar** |

> ⚠️ **ÖNEMLİ:** Yalnız `admin` seed'de yetkilendiriliyor. Diğer kullanıcılar yetkisiz başlar — admin UI'sından (`/admin/users/:id/permissions`) tek tek atanmalı. Bu bilinçli tasarım: production'da rol atamaları runtime yapılır. `prisma/seed.ts:163-173` ve `seed.ts:185` notlarına bakın.
>
> **Test ipucu:** Çoğu testi `admin` ile koşturun. Permission/RBAC testleri için belirli bir test kullanıcısına ihtiyacınız varsa, önce `admin` ile login olup `POST /api/admin/users/:id/permissions` ile atama yapın.

---

## 2. Veritabanı Tablo Haritası

Her endpoint'in hangi tabloyu etkilediğini bilmek, hata ayıklama ve veri doğrulamayı kolaylaştırır.

### Sistem Tabloları (Seed'den Korunur)

| Prisma Model | PostgreSQL Tablo | Açıklama |
|---|---|---|
| `User` | `users` | Kullanıcı hesapları |
| `Permission` | `permissions` | İzin kodları (`order:read`, `roll:write`, vb. — 42 adet) |
| `UserPermission` | `user_permissions` | Kullanıcıya doğrudan atanan izinler (rol modeli yok) |
| `PermissionTemplate` | `permission_templates` | Tekrar kullanılabilir izin setleri (admin UI'dan atanır) |
| `PermissionTemplateItem` | `permission_template_items` | Template ↔ Permission (N:N) |
| `Station` | `stations` | İstasyonlar (KK1, PROCESS_QC, Tambur, Fason vb.) |
| `Machine` | `machines` | Makineler (Tezgah, Kantar vb.) |
| `Route` | `routes` | Rota şablonları |
| `RouteStep` | `route_steps` | Rota adımları |

### İş Verileri Tabloları (Test Sırasında Oluşturulur)

| Prisma Model | PostgreSQL Tablo | Açıklama | Oluşturan Endpoint |
|---|---|---|---|
| `Item` | `items` | Stok kartları (kumaş türleri, iplik, sarf) | `POST /api/items` |
| `Customer` | `customers` | Müşteriler, tedarikçiler, fasonlar | `POST /api/customers` |
| `Order` | `orders` | Siparişler (müşteri siparişi) | `POST /api/orders` |
| `OrderLine` | `order_lines` | Sipariş kalemleri (hangi ürün, ne kadar) | `POST /api/orders` (nested) |
| `Roll` | `rolls` | Toplar — kumaş birimleri, barkodlu | `POST /api/rolls/initial-entry` |
| `WorkOrder` | `work_orders` | İş emirleri (parti) | `POST /api/work-orders` |
| `WorkOrderStep` | `work_order_steps` | İş emri rota adımları | `POST /api/work-orders` (nested) |
| `WorkOrderToOrderLine` | `work_order_to_order_lines` | İş emri ↔ Sipariş bağlantısı (N:N) | `POST /api/work-orders` |
| `RollError` | `roll_errors` | Top üzerindeki hatalar (leke, yırtık) | `POST /api/production/report-error` |
| `CurrentAccount` | `current_accounts` | Cari hesaplar (gelecek modül) | — |
| `MachineLog` | `machine_logs` | Makine durum kayıtları | — |
| `SystemLog` | `system_logs` | Denetim izi (audit trail) — otomatik | Her CUD işleminde otomatik |

### Roll (Top) Yaşam Döngüsü

```
STOCK → IN_PRODUCTION → AT_SUBCONTRACTOR → RETURNED_FROM_SUBCONTRACTOR ┐
                                                                       ↓
                                              ← IN_PRODUCTION (TAMBUR adımı) ←
                                              ↓
                                          TAMBUR_CONSUMED (parent retire)
                                              ↓
                                  child rolls → WAREHOUSE | A1_STOCK | SCRAP
                                              ↓
                                  (yeni sevkiyat modülü) → READY_FOR_SHIP → SHIPPED
```

| Status | Anlam | Nasıl Geçilir? |
|--------|-------|----------------|
| `STOCK` | Depoda, henüz üretime girmemiş | `POST /api/rolls/initial-entry` ile oluşur |
| `IN_PRODUCTION` | Üretim hattında, bir iş emrine bağlı | `PATCH /api/work-orders/:id/attach-rolls` ile |
| `AT_SUBCONTRACTOR` | Fasonda işlem görüyor | `POST /api/subcontractor/dispatch` ile |
| `RETURNED_FROM_SUBCONTRACTOR` | Fasondan döndü, bir sonraki istasyona hazır | `POST /api/subcontractor/receive` ile |
| `TAMBUR_CONSUMED` | Tambur'da bölündü, tüm metraj child top'larda | `POST /api/tambur/finalize` (parent) |
| `WAREHOUSE` | Tambur child top — depoya kaldırıldı, satışa/sevke hazır | `POST /api/tambur/finalize` (1.KALITE child) |
| `A1_STOCK` | 2. kalite satılabilir stok | `POST /api/tambur/finalize` (A2 child) |
| `SCRAP` | Fire / ıskarta | `POST /api/tambur/finalize` (FIRE child) |
| `PRODUCED` | Roll, son üretim adımını bitirdi ama Tambur'dan geçmedi (tek-adımlı WO veya rota Tambur içermiyor) | `POST /api/production/step-action` (FINISH, son step) |
| `READY_FOR_SHIP` | Yeni sevkiyat modülünde tetiklenecek (TBD) | — |
| `SHIPPED` | Yeni sevkiyat modülünde tetiklenecek (TBD) | — |

### Sipariş Yaşam Döngüsü

```
PENDING → APPROVED → IN_PRODUCTION → PARTIAL_SHIPPED → COMPLETED
                                                        ↗
                                              CANCELLED
```

---

## 3. Adım 0 — Giriş ve Token Alma

**Endpoint:** `POST /api/auth/login`
**Tablo:** `users`, `roles`, `permissions` (sadece okuma)

```json
// İstek
{
  "username": "admin",
  "password": "123123"
}
```

```json
// Yanıt (başarılı)
{
  "success": true,
  "data": {
    "token": "eyJhbGciOi...",   // ← BU DEĞERİ KOPYAYIN
    "user": {
      "userId": "uuid...",
      "username": "admin",
      "permissions": ["order:read", "order:write", "roll:read", "roll:write", ...]
    }
  }
}
```

> 📝 **ÖNEMLİ:** Token'ı her istekte `Authorization: Bearer <token>` header'ında gönderin.
> Token süresi: **8 saat**. Süre bittiğinde tekrar login yapın.

**Doğrulamak için:** `GET /api/auth/me` → mevcut kullanıcı bilgilerini döner.

---

## 4. Senaryo A — Ürün ve Müşteri (Master Data)

Bu tablolar sıfırdan oluşturulur. Ürün ve müşteri olmadan hiçbir iş yapılamaz.

### A1: Ürün (Stok Kartı) Oluştur

**Endpoint:** `POST /api/items`
**Tablo:** `items`
**İzin:** `item:write`

```json
{
  "code": "KUM-001",
  "name": "Poplin Kumaş - Lacivert",
  "itemType": "FABRIC",
  "unit": "MT"
}
```

**`itemType` değerleri** (`prisma/schema.prisma → enum ItemType`):

| Değer | Açıklama |
|-------|----------|
| `YARN` | İplik |
| `WARP` | Çözgü |
| `FABRIC` | Kumaş (ham/boyalı ayrımı `colorId == null` → ham, dolu → boyalı) |
| `CONSUMABLE` | Sarf malzeme |

> 📌 Ham/boyalı kumaş için ayrı `itemType` yok — tek `FABRIC` enum'u kullanılıyor.
> Roll seviyesinde `colorId` doluluğuna bakılarak "ham" / "işlenmiş" ayrımı yapılıyor.

> 📌 Yanıttan dönen `id` değerini not edin → Roll oluştururken `itemId` olarak kullanacaksınız.

### A2: Müşteri Oluştur

**Endpoint:** `POST /api/customers`
**Tablo:** `customers`

```json
{
  "code": "MUS-001",
  "name": "Moda Tekstil A.Ş.",
  "taxNumber": "1234567890",
  "type": "CUSTOMER"
}
```

**`type` değerleri** (`prisma/schema.prisma → enum CompanyType`): `CUSTOMER` | `SUPPLIER` | `SUBCONTRACTOR` | `DYEHOUSE`

> 📌 **Fason firmalar `Customer` değil ayrı tabloda** — `POST /api/subcontractors` endpoint'i kullanılır (bkz. fason akışı bölümü). `CompanyType.SUBCONTRACTOR` enum değeri hâlâ şemada duruyor (legacy) ama yeni kayıt için `Subcontractor` modeli kullanılır.
>
> 📌 Yanıttan dönen `id` değerini not edin → Sipariş oluştururken `customerId` olarak kullanacaksınız.

**Vergi numarası kuralı (v3):** `taxNumber` opsiyonel; verilirse `/^\d{10,15}$/` regex'ine uymalı (VKN: 10 hane, TCKN: 11 hane, yabancı VAT/EIN: 12-15 hane). Boş string null'a çevrilir; whitespace trim'lenir.

### A3: Listeleme ve Filtreleme

```
GET /api/items?page=1&pageSize=10&sortBy=code&sortOrder=asc
GET /api/items?search=Poplin
GET /api/customers?filter[type]=CUSTOMER
```

---

## 5. Senaryo B — Envanter / Top Girişi (QC1)

Mal kabul noktasında hammadde topları sisteme girilir.

### B1: Top (Roll) Oluştur

**Endpoint:** `POST /api/rolls/initial-entry`
**Tablo:** `rolls` (yeni kayıt, status = `STOCK`)
**İzin:** `roll:write`

```json
{
  "itemId": "A1'den aldığınız item ID",
  "initialQty": 500,
  "weightKg": 62.5,
  "qualityGrade": "1.KALITE"
}
```

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "id": "uuid...",           // ← ROLL_ID — sonraki adımlarda kullanılacak
    "barcode": "TEKS-20260415-A1B2C3D4",  // ← Otomatik üretilir
    "itemId": "...",
    "initialQty": 500,
    "currentQty": 500,         // Başlangıçta initialQty ile aynı
    "status": "STOCK",
    "qualityGrade": "1.KALITE"
  }
}
```

> 📌 **Not:** Barkod otomatik üretilir, formatı: `TEKS-YYYYMMDD-XXXXXXXX`
> 📌 **İki top oluşturun** — uçtan uca test için en az 2 top gerekli.

### B2: Barkod ile Sorgulama (El Terminali)

**Endpoint:** `GET /api/rolls/barcode/{barcode}`
**Tablo:** `rolls` (okuma)

```
GET /api/rolls/barcode/TEKS-20260415-A1B2C3D4
```

### B3: Top Detayı (ID ile)

**Endpoint:** `GET /api/rolls/{id}`
**Tablo:** `rolls` + `roll_errors` (join)

### B4: Envanter Listesi

```
GET /api/rolls                                    → SADECE STOCK (default — depodaki toplar)
GET /api/rolls?filter[status]=STOCK               → Aynı sonuç, explicit
GET /api/rolls?filter[status]=IN_PRODUCTION       → Üretimdeki toplar
GET /api/rolls?filter[status]=WAREHOUSE           → Tambur sonrası depoda
GET /api/rolls?filter[status]=ALL                 → Tüm statüler (filter atla)
GET /api/rolls?filter[statusIn]=STOCK,WAREHOUSE   → Çoklu status (virgüllü liste)
GET /api/rolls?search=TEKS-20260415               → Barkod ile arama
```

> ⚠️ **Önemli (v3):** `GET /api/rolls` filtre yokken **sadece STOCK** döner — bu **iş kuralı** (`inventory.service.ts:findAllRolls` default).
> Üretim/depo aşamasındaki roll'ları görmek için **mutlaka** `filter[status]=X` veya `filter[status]=ALL` ekleyin.
> Yoksa "kayıt yok" sanırsınız — gerçekte filtrelenmiş veri vardır.

---

## 6. Senaryo C — Sipariş ve İş Emri (Planlama)

### C1: Sipariş Oluştur

**Endpoint:** `POST /api/orders`
**Tablolar:** `orders` + `order_lines` (nested create)
**İzin:** `order:write`

```json
{
  "customerId": "A2'den aldığınız customer ID",
  "currency": "TRY",
  "deadline": "2026-06-15T00:00:00Z",
  "lines": [
    {
      "itemId": "A1'den aldığınız item ID",
      "quantity": 900,
      "unitPrice": 25.50
    }
  ]
}
```

> 📌 **`orderNumber` server tarafında otomatik üretilir** (`YYYYMMDD-N` formatında). İstemci gönderse bile yok sayılır. Yanıttan dönen değeri kullanın.
> ⚠️ **`customerId` ve `itemId` veritabanında var olmalıdır.** Swagger'ın otomatik doldurduğu placeholder UUID'leri kullanmayın!
> ⚠️ **Müşteri aktif olmalı** (`isActive: true`); pasif müşteriye sipariş açılamaz (v3, BUG-07).
> ⚠️ **`deadline` `orderDate`'ten önce olamaz** (v3, BUG-08). `orderDate` verilmediyse şu anki zaman referans alınır.
> ⚠️ **Line `quantity > 0` ve `unitPrice >= 0` ya da null** (v3, BUG-04..06).

**Yanıttan not edin:**
- `data.id` → `ORDER_ID`
- `data.orderNumber` → autogen (örn. `20260524-1`)
- `data.lines[0].id` → `ORDER_LINE_ID` (iş emrine bağlamak ve tahsis için)

### C2: İstasyon ID'lerini Öğrenin

**Endpoint:** `GET /api/stations`
**Tablo:** `stations` (okuma)

İş emri rotasını kurmak için istasyon ID'leri gerekli. Örnek istasyon yapısı:

| Kod | İsim | Tür | StationKind |
|-----|------|-----|-----------|
| `KK1_1` | Ham Mal Kabul (KK1) | INTERNAL | `RAW_QC` |
| `BOYAHANE_DIS` | Fason Boyahane (Dış) | **EXTERNAL** | `SUBCONTRACTOR` |
| `BASKI_DIS` | Fason Baskı (Dış) | **EXTERNAL** | `SUBCONTRACTOR` |
| `KURSUN_1` | Kurşun + KK2 (tek istasyon) | INTERNAL | `PROCESS_QC` |
| `TAMBUR_1` | Tambur (Final Karar) | INTERNAL | `TAMBUR` |

> 📌 Standart boyama rotası: `KK1_1 → BOYAHANE_DIS → KURSUN_1 → TAMBUR_1`
> 📌 Paketleme / Sevkiyat istasyonları **kaldırıldı** (`20260517214013_station_kind_drop_packaging_shipping` migration). Yeni sevkiyat modülü tasarlanırken bu istasyonlar yeniden değerlendirilecek.

### C3: İş Emri (Parti) Oluştur

**Endpoint:** `POST /api/work-orders`
**Tablolar:** `work_orders` + `work_order_steps` + `work_order_to_order_lines`
**İzin:** `workorder:write`

```json
{
  "batchNumber": "PARTI-001",
  "type": "ORDER_PRODUCTION",
  "parameters": {
    "color": "Lacivert",
    "targetWidth": 150
  },
  "steps": [
    { "stationId": "KK1_1'in ID'si" },
    { "stationId": "BOYAHANE_DIS'ın ID'si" },
    { "stationId": "KURSUN_1'in ID'si" },
    { "stationId": "TAMBUR_1'in ID'si" }
  ],
  "orderLineIds": ["C1'den aldığınız ORDER_LINE_ID"]
}
```

**`type` değerleri** (`prisma/schema.prisma → enum WorkOrderType`):

| Değer | Anlam | Zorunlu alanlar |
|-------|-------|-----------------|
| `ORDER_PRODUCTION` | Siparişe Özel Üretim | `orderLineIds` (en az 1 sipariş kalemi) |
| `STOCK_PRODUCTION` | Stoka Üretim (sipariş yok) | `targetItemId` (hedef ürün) |

> 📌 `parameters` alanı JSON'dır, istediğiniz veriyi koyabilirsiniz (reçete no, renk kodu vb.)
> 📌 `orderLineIds` ORDER_PRODUCTION'da **zorunlu**, diğer type'larda yok.
> 📌 Yanıttan `data.id` → `WORK_ORDER_ID`
> 📌 ⚠️ EXTERNAL/SUBCONTRACTOR istasyonlar `POST /api/production/step-action` ile çalışmaz — `POST /api/subcontractor/dispatch` + `/receive` kullanılır (bkz. fason akışı).

### C4: Topları İş Emrine Bağla

**Endpoint:** `PATCH /api/work-orders/{workOrderId}/attach-rolls`
**Tablolar:** `rolls` (status → `IN_PRODUCTION`), `work_order_steps` (adım 1 ilişki)
**İzin:** `workorder:write`

```json
{
  "barcodes": ["TEKS-20260415-A1B2C3D4", "TEKS-20260415-E5F6G7H8"]
}
```

> ⚠️ Topların `STOCK` durumunda olması gerekir, yoksa hata döner.
> ✅ Başarılı olursa topların status'u `IN_PRODUCTION` olur.

### C5: Refakat Kartı Görüntüle

**Endpoint:** `GET /api/work-orders/{workOrderId}/travel-card`
**Tablo:** `work_orders` + `work_order_steps` + `stations` + `order_lines` + `orders` (join)

Fiziksel olarak toplarla birlikte gönderilen refakat kartı verisini döner (rota, müşteri, ürün bilgisi).

### C6: Çeki Listesi

**Endpoint:** `GET /api/work-orders/{workOrderId}/manifest`
**Tablo:** `rolls` (iş emrine bağlı toplar)

İş emrindeki topların metraj/kilo özet tablosunu döner.

---

## 7. Senaryo D — Üretim Akışı

İki ayrı endpoint pattern'i var: **INTERNAL** istasyonlar `step-action` ile, **EXTERNAL** (fason) istasyonlar `subcontractor/dispatch`+`receive` ile yürür.

### D1: INTERNAL istasyon (KK1/KK2/TAMBUR) — `step-action`

**Endpoint:** `POST /api/production/step-action`
**Tablolar:** `work_order_steps` (status → `ACTIVE` veya `COMPLETED`)
**İzin:** `roll:write`

```json
{
  "barcode": "TEKS-20260524-A1B2C3D4",
  "stationId": "KK1'in ID'si",
  "action": "FINISH"
}
```

> 📌 v3: Step FINISH sonrası sonraki step otomatik START olur (`nextStep.autoStarted=true`). Manuel START çağırmaya gerek yok.
> 📌 INTERNAL istasyonlarda `newQty` opsiyoneldir (KK1/KK2 metraj değiştirmez; tambur sarım esnasında child Roll'larda yeniden ölçer).

### D2: EXTERNAL istasyon (BOYAHANE/BASKI vb.) — `subcontractor/dispatch` + `receive`

EXTERNAL istasyonlarda `step-action` çağırmak **400 hata** verir:
> `"Boyahane (Fason)" fason/dış istasyonudur. step-action bu adıma uygulanmaz. Sevk için POST /api/subcontractor/dispatch, mal kabul için POST /api/subcontractor/receive kullanın.`

**Sevk (taşerona gönder):**

```json
POST /api/subcontractor/dispatch
{
  "workOrderId": "WORK_ORDER_ID",
  "stepId": "BOYAHANE step'in ID'si",
  "subcontractorId": "Fason firma ID'si",
  "rollIds": ["ROLL1_ID", "ROLL2_ID"]
}
```

- Roll'ların status'u `AT_SUBCONTRACTOR` olur
- `SubcontractorDispatch` kaydı oluşur (irsaliye)

**Mal kabul (taşerondan dönüş):**

```json
POST /api/subcontractor/receive
{
  "dispatchId": "DISPATCH_ID",
  "items": [
    { "rollId": "ROLL1_ID", "receivedQty": 485, "weightKg": 60 },
    { "rollId": "ROLL2_ID", "receivedQty": 480, "weightKg": 58 }
  ]
}
```

- `receivedQty` < dispatched qty olabilir (fire)
- Roll'ların status'u `IN_PRODUCTION` olur, currentStepId sonraki step'e geçer
- `weightKg` opsiyonel (kilo paket aşamasında girilebilir, BUG-34 sonrası)

### D3: Kurşun (KK2) adımı

> 📌 **Manuel START gerekli değil (v3).** Önceki step FINISH çağrıldığında sonraki step otomatik aktif olur (`nextStep.autoStarted: true`). Kurşun step'i otomatik aktiftir; manuel START 400 "zaten başlatılmış" verir.

Operatör Kurşun istasyonunda doğrudan hata raporlamaya veya FINISH'e geçer:

### D4: Hata Raporla (Kurşun QC2)

**Endpoint:** `POST /api/production/report-error`
**Tablo:** `roll_errors` (yeni kayıt)
**İzin:** `quality:write`

```json
{
  "rollId": "B1'den aldığınız ROLL_ID",
  "startMeter": 60,
  "errorType": "LEKE"
}
```

> 📌 **Yeni model (v3):** Hata sadece **NOKTA** olarak girilir — `startMeter` zorunlu, `endMeter` artık tutulmuyor. Operatör "60. metrede hata" der; aralık bilgisi yok.
> 📌 Tambur operatörü ekranda bu noktayı görür, fiziksel sarım esnasında kesim kararını kendi verir.
> 📌 Birden fazla hata raporlayabilirsiniz. Her biri ayrı bir `roll_errors` kaydı oluşturur.
> 📌 `isProcessed: false` olarak oluşur → Tambur'da işlenecek.
> 📌 Hata türleri: `LEKE`, `YIRTIK`, `IPLIK_HATASI`, `BOYA_LEKESI`, `DELIK` vb. (serbest metin) veya `defectTypeId` ile katalogtan seçim.
> 📌 Yanıttan `data.id` → `ERROR_ID` (Tambur'da kullanılacak)

### D5: Kurşun FINISH

```json
{
  "barcode": "TEKS-20260415-A1B2C3D4",
  "stationId": "KURSUN_1'in ID'si",
  "action": "FINISH"
}
```

> ✅ Kurşun INTERNAL istasyon olduğu için `newQty` zorunlu **değildir**.
> ✅ Top artık Tambur adımına geçer (`currentStepId` güncellenir).

### Aktif Adımları İzleme (Dashboard)

**Endpoint:** `GET /api/production/active-steps`
**Tablo:** `work_order_steps` (status = ACTIVE, join: station + workOrder)

---

## 8. Senaryo E — Tambur (Roll Splitting + Tahsis)

Tambur, üretimin **karar noktası**dır. Kurşun'dan gelen hata kayıtları burada değerlendirilir.

### E1: Bekleyen Topları Listele

**Endpoint:** `GET /api/tambur/pending-rolls`
**Tablo:** `rolls` + `roll_errors` (isProcessed = false)

### E2: Top Karar Ekranı

**Endpoint:** `GET /api/tambur/rolls/{rollId}`
**Tablo:** `rolls` + `roll_errors`

Topu tüm hataları ile birlikte gösterir.

### E3: Finalize (Kesim Kararı — Cumulative Length Model)

**Endpoint:** `POST /api/tambur/finalize`
**Tablolar:** `rolls`, `roll_errors`
**İzin:** `quality:write`

**Yeni model (v3):** Tambur operatörü makinede kumaşı sarar, **sayaç sıfırdan başlar**. Her "kes" tuşu basışında o ana kadar sarılan uzunluk yeni bir top olur (parent'tan ayrılır), sayaç sıfırlanır, devam edilir.

**API'de:** `cuts` sıralı listesi gönderilir. Her cut:
- `length`: o kesimin uzunluğu (sayaç sıfırdan başladığı için **bağımsız uzunluk**, cumulative değil)
- `qualityGrade`: o parçanın kalitesi (`1.KALITE`, `A2`, `FIRE`, vb.)
- `relatedErrorIds`: hangi defect'ler için kesildi (audit zinciri, opsiyonel)

**Senaryo örneği** (parent 500m, hatalar @60m ve @150m):
```json
{
  "rollId": "ROLL_ID",
  "cuts": [
    { "length": 59,  "qualityGrade": "1.KALITE", "relatedErrorIds": [] },
    { "length": 10,  "qualityGrade": "FIRE",     "relatedErrorIds": ["ERR_60M_ID"] },
    { "length": 149, "qualityGrade": "1.KALITE", "relatedErrorIds": [] },
    { "length": 10,  "qualityGrade": "FIRE",     "relatedErrorIds": ["ERR_150M_ID"] }
  ],
  "decisions": [
    { "errorId": "ERR_60M_ID",  "decision": "CUT" },
    { "errorId": "ERR_150M_ID", "decision": "CUT" }
  ],
  "foldType": "2-KAT"
}
```

**Algoritma:**
1. cuts toplamı = 59+10+149+10 = **228m** (operatörün yaptığı tüm kesimlerin toplamı)
2. Kalan = 500 - 228 = **272m** otomatik son child top (`parent.qualityGrade` = `1.KALITE`)
3. Toplam 5 child Roll oluşur, toplam metraj = 500 ✓
4. Parent retire: `status=TAMBUR_CONSUMED`, `currentQty=0`

**`decision` değerleri:**
- `CUT` → Defect, bir kesim aksiyonu ile çözüldü (`relatedErrorIds` listesinde geçer). `actionTaken: "CUT"`
- `NO_CUT` → Defect tambur'da görüldü ama kesilmedi; top içinde defect kayıtlı kalır. `actionTaken: "NO_CUT"`

> 📌 **İş kuralı:** cuts boş gönderilirse, tüm metraj tek child top olur (parent.qualityGrade). Operatör hiç kesim yapmadı demektir.
> 📌 **Validasyon:** `sum(cuts[].length) ≤ parent.currentQty` zorunlu; aşarsa 400.
> 📌 **Kalite → Status mapping:** `QualityGrade` kataloğundan çekilir (1.KALITE → WAREHOUSE, FIRE → SCRAP, vb.). Katalogda yoksa SCRAP fallback.

**Yanıt yapısı:**
```json
{
  "data": {
    "originalRoll": { "id":"...", "currentQty":0, "status":"TAMBUR_CONSUMED" },
    "splitRolls": [
      { "barcode":"...KS-022B47", "currentQty":59,  "status":"WAREHOUSE", "qualityGrade":"1.KALITE" },
      { "barcode":"...KS-4DE05F", "currentQty":10,  "status":"SCRAP",     "qualityGrade":"FIRE" },
      { "barcode":"...KS-32FE2E", "currentQty":149, "status":"WAREHOUSE", "qualityGrade":"1.KALITE" },
      { "barcode":"...KS-96750F", "currentQty":10,  "status":"SCRAP",     "qualityGrade":"FIRE" },
      { "barcode":"...KS-264E58", "currentQty":272, "status":"WAREHOUSE", "qualityGrade":"1.KALITE" }
    ],
    "processedErrors": 2
  },
  "message": "Tambur tamamlandı. Parent bölündü, 5 yeni top oluşturuldu (4 kesim + kalan kuyruk top, 2 hata işlendi)."
}
```

### E4: Sipariş Tahsisi

Allocation modülü kaldırıldı. Yeni sevkiyat akışı tasarlanırken sipariş ↔ rulo
bağlantısı yeniden modellenecek.

---

## 9. Senaryo F — Sevkiyat

> **Sevkiyat modülü sıfırdan yeniden yazılıyor.** Eski `/api/shipping/*`, `/api/sacks/*`, `/api/packaging/*` endpoint'leri kaldırıldı. Bu bölüm yeni modül hazır olduğunda güncellenecek.

---

## 10. Hata Senaryoları

Bu senaryoları test ederek hata mesajlarının doğruluğunu kontrol edin:

| # | Test | Beklenen Sonuç |
|---|------|---------------|
| 1 | Login yanlış şifre ile | `401` — Kullanıcı adı veya şifre hatalı |
| 2 | Token olmadan herhangi bir endpoint çağır | `401` — Token gerekli |
| 3 | `ali.operator` ile `POST /api/orders` çağır | `403` — `order:write` yetkisi yok (seed'de hiç yetki verilmiyor; bkz. §1) |
| 4 | `POST /api/items` aynı `code` ile iki kez | `409` — unique constraint |
| 5 | `POST /api/orders` `customerId` pasif müşteri ile | `400` — "Müşteri pasif durumda..." (v3, BUG-07) |
| 6 | `POST /api/rolls/initial-entry` olmayan `itemId` ile | `404` — Ürün bulunamadı |
| 7 | `POST /api/orders` olmayan `customerId` ile | `400` — Geçersiz veri yapısı |
| 8 | EXTERNAL (fason) step'e `POST /api/production/step-action` çağır | `400` — "fason/dış istasyonudur. step-action bu adıma uygulanmaz" → `subcontractor/dispatch` + `/receive` kullan |
| 9 | `STOCK` olmayan topu iş emrine bağla | `400` — Barkod hata listesinde döner |
| 10 | Bozuk JSON body gönder | `400` — Geçersiz JSON formatı |

---

## 11. Uçtan Uca Kontrol Listesi

Tüm adımları sırayla takip edin. Her satırdaki ✅ kutusunu zihinsel olarak işaretleyin:

```
□  A1. Ürün oluştur          → ITEM_ID not et
□  A2. Müşteri oluştur       → CUSTOMER_ID not et
□  B1. Top 1 oluştur         → ROLL1_ID, BARCODE1 not et
□  B2. Top 2 oluştur         → ROLL2_ID, BARCODE2 not et
□  B3. Barkod sorgusu test et
□  C1. Sipariş oluştur       → ORDER_ID, ORDER_LINE_ID not et
□  C2. İstasyon ID'leri al   → BOYAHANE_ID, KURSUN_ID, TAMBUR_ID, PAKET_ID
□  C3. İş emri oluştur       → WORK_ORDER_ID not et
□  C4. Topları bağla          → Status: STOCK → IN_PRODUCTION ✓
□  C5. Refakat kartı kontrol et
□  D1. Boyahane START
□  D2. Boyahane FINISH        → currentQty azaldı ✓ (fire)
□  D3. Kurşun START
□  D4. Hata 1 raporla         → ERROR1_ID not et
□  D5. Hata 2 raporla         → ERROR2_ID not et
□  D6. Kurşun FINISH
□  E1. Tamburda bekleyenler
□  E2. Tambur finalize         → SCRAP roll oluştu ✓
```

> Sevkiyat akışı yeniden yazılıyor — yeni modül hazır olduğunda buraya eklenecek.

---

## 12. Temiz Başlangıç (Veri Sıfırlama)

Test verilerini sıfırdan başlatmak için:

```bash
# Tam sıfırlama: DB drop + tek migration uygula + seed
npx prisma migrate reset --force
```

`migrate reset` mevcut DB'yi düşürür, tüm migration'ları (şu an tek `init`) yeniden uygular ve `npm run seed`'i otomatik çalıştırır. Sonuç: 42 permission + 7 kullanıcı + 3 kalite sınıfı + 4 müşteri + 6 renk + 6 kumaş özelliği + 2 fason kategori + 2 fason firma.

---

## 13. Postman İpuçları

### Ortam Değişkenleri Kurun

```
baseUrl  = http://localhost:4000
token    = (login sonrası otomatik set)
```

### Otomatik Token Yakalama

Login isteğinin **Tests** sekmesine:

```javascript
if (pm.response.code === 200) {
    const token = pm.response.json().data.token;
    pm.environment.set("token", token);
}
```

Diğer isteklerin **Authorization** → **Bearer Token** → `{{token}}`

### Otomatik ID Yakalama

Item oluşturma isteğinin **Tests** sekmesine:
```javascript
if (pm.response.code === 201) {
    pm.environment.set("itemId", pm.response.json().data.id);
}
```

Customer oluşturma:
```javascript
if (pm.response.code === 201) {
    pm.environment.set("customerId", pm.response.json().data.id);
}
```

Roll oluşturma:
```javascript
if (pm.response.code === 201) {
    const data = pm.response.json().data;
    pm.environment.set("rollId", data.id);
    pm.environment.set("barcode", data.barcode);
}
```

Order oluşturma:
```javascript
if (pm.response.code === 201) {
    const data = pm.response.json().data;
    pm.environment.set("orderId", data.id);
    pm.environment.set("orderLineId", data.lines[0].id);
}
```

### Sık Yapılan Hatalar

| Hata | Sebep | Çözüm |
|------|-------|-------|
| `401 Unauthorized` | Token yok veya süresi dolmuş | Tekrar login yapın |
| `403 Forbidden` | Kullanıcının yetkisi yok | `admin` ile test edin |
| `409 Conflict` | Unique alan zaten var | `orderNumber`, `code` vb. değiştirin |
| `400 Geçersiz veri yapısı` | Olmayan ID kullanılmış | Gerçek UUID kullanın, placeholder değil |
| `404 Not Found` | ID bulunamadı | Önceki adımın yanıtından ID'yi alın |
