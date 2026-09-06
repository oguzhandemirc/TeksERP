# TeksERP — API Test Rehberi (Swagger / Postman)

# reseed / toplu DELETE HER canlı kurulumda YASAK — DATABASE_URL'i çalıştırmadan önce doğrula.
npx prisma migrate reset --force' hiçbir üretim uyarısı taşımıyor; kök CLAUDE.md 'migrate reset / reseed / toplu DELETE yasak' diyor. · Banner'daki '/api/production/step-action' ucu kodda yok (git grep step-action -- Teks-Erp/src → 0 sonuç); banner bunu 'jenerik yerine istasyon-özel' diye anlatıyor ama uç adı hiç var olmamış gibi okunmalı. — kanonik kaynak kod/`schema.prisma`; bu belge gerekçe için okunur.

> **⚠️ Kanonik uç listesi için her zaman canlı Swagger (`/api-docs`) + `src/routes/` referans alınmalı.**
> Bu rehber 2026-07 redesign'larına göre güncellendi (çuval-havuzu / parti / kart-iş-emriyle-doğar / kod-format /
> "her rota final üretir"), fakat Senaryo D'nin üretim akışı **jenerik `/api/production/step-action` yerine**
> istasyon-özel uçlara dağılmıştır (traveler-card scan, `/api/kursun-qc/*`, `/api/subcontractor/*`) — detay için
> ilgili route dosyalarına bakın. Bu rehber, TeksERP API'sini uçtan uca test etmenizi sağlar.
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

| Kullanıcı | Şifre | Rol | Seed Sonrası Yetki Durumu |
|-----------|-------|-----|--------|
| `admin` | `123123` | Admin | ✅ **Tam yetki** — katalogdaki TÜM izinler seed'de atanıyor (bugün 86; kanonik `src/constants/permission-catalog.ts`) |

> ⚠️ **ÖNEMLİ (2026-07-03):** Seed artık **yalnızca `admin` kullanıcısını** oluşturur — ek test kullanıcıları (`mehmet.planlama`, `ali.operator` vb.) seed'den kaldırıldı. RBAC/permission testleri için önce `admin` ile login olup admin UI'sından (`/admin/users` + `POST /api/admin/users/:id/permissions`) yeni kullanıcı + izin atayın. Bu bilinçli tasarım: production'da roller runtime atanır. Kaynak: `prisma/seed.ts` başlık bloğu.
>
> **Test ipucu:** Çoğu testi `admin` ile koşturun. Permission/RBAC senaryosu gerekiyorsa `admin` ile bir test kullanıcısı yaratıp izinleri tek tek atayın.

---

## 2. Veritabanı Tablo Haritası

Her endpoint'in hangi tabloyu etkilediğini bilmek, hata ayıklama ve veri doğrulamayı kolaylaştırır.

### Sistem Tabloları (Seed'den Korunur)

| Prisma Model | PostgreSQL Tablo | Açıklama |
|---|---|---|
| `User` | `users` | Kullanıcı hesapları |
| `Permission` | `permissions` | İzin kodları (`order:read`, `roll:write`, vb. — ~55 adet; kanonik: `prisma/seed.ts`) |
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
| `WorkOrder` | `work_orders` | İş emirleri (`workOrderNumber` = İE…) | `POST /api/work-orders` |
| `WorkOrderStep` | `work_order_steps` | İş emri rota adımları | `POST /api/work-orders` (nested) |
| `WorkOrderToOrderLine` | `work_order_to_order_lines` | İş emri ↔ Sipariş kalemi bağlantısı (N:N) | `POST /api/work-orders` |
| `Batch` | `batches` | Parti (P… — WorkOrder'dan AYRI; 2026-07-13 parti modeli) | — |
| `TravelerCard` | `traveler_cards` | Refakat kartı (WO açılışında doğar, `workOrderId` @unique) | `POST /api/work-orders` (otomatik) |
| `RollError` | `roll_errors` | Top üzerindeki hatalar (leke, yırtık — nokta model) | `POST /api/kursun-qc/report-error` |
| `SystemLog` | `system_logs` | Denetim izi (audit trail) — otomatik | Her CUD işleminde otomatik |

> 📌 `CurrentAccount` ve `MachineLog` modelleri şemadan **kaldırıldı** (MachineLog 2026-05-25). Eski rehberlerde geçebilir.

### Roll (Top) Yaşam Döngüsü

```
STOCK → IN_PRODUCTION → [opsiyonel: AT_SUBCONTRACTOR → (kabulde parent SUBCONTRACTOR_CONSUMED,
                         yeni açık-kumaş Roll doğar) → IN_PRODUCTION] →
   Rotanın SON adımı finalize → final ürün:
     • Tambur son adımsa → parent TAMBUR_CONSUMED + child'lar → WAREHOUSE | A1_STOCK | SCRAP
     • Tambur-dışı son adımsa → açık kumaş doğrudan → WAREHOUSE (form=ACIK)
                                              ↓
                                  (sevkiyat: dispatch) → SHIPPED
```

> 📌 **"Her rota final üretir" (2026-07-13):** Tambur zorunlu DEĞİL — rota Kurşun/QC2 veya fason ile de bitebilir; son adımın çıktısı her zaman final ürün. `PRODUCED` statüsü enum'dan kaldırıldı. `Roll.qualityGrade` **nullable** (kaliteyi yalnız kalite istasyonları belirler).

| Status | Anlam | Nasıl Geçilir? |
|--------|-------|----------------|
| `STOCK` | Depoda, henüz üretime girmemiş | `POST /api/rolls/initial-entry` ile oluşur |
| `IN_PRODUCTION` | Üretim hattında, bir iş emrine bağlı | İş emrine top bağlanınca (attach — HTTP ucu kaldırıldı, `attachRolls` servis metodu quick-start/seed'den çağrılır) |
| `AT_SUBCONTRACTOR` | Fasonda işlem görüyor | `POST /api/subcontractor/dispatch` ile |
| `RETURNED_FROM_SUBCONTRACTOR` | Fason dönüşü depo statüsü (enum'da mevcut; güncel `receive()` orijinali `SUBCONTRACTOR_CONSUMED` yapar, bu statüyü set etmez) | — |
| `TAMBUR_CONSUMED` | Tambur'da bölündü, tüm metraj child top'larda | `POST /api/tambur/finalize` (parent) |
| `WAREHOUSE` | Final ürün — depoya kaldırıldı, satışa/sevke hazır (varsayılan final statü) | Rotanın **son adımı** finalize eder (Tambur child veya Tambur-dışı son adım açık kumaşı) |
| `A1_STOCK` | 2. kalite satılabilir stok | `QualityGrade.targetStatus` override ile |
| `SCRAP` | Fire / ıskarta (gerçek fire kararı) | `POST /api/tambur/finalize` (FIRE child) |
| `SUBCONTRACTOR_CONSUMED` | Fason kabulünde kapandı — yeni açık-kumaş Roll'ları receipt üzerinden doğdu | `POST /api/subcontractor/receive` (parent retire) |
| `SHIPPED` | Çuval sevkiyatı DISPATCH edildi — depodan çıktı | Sevkiyat DISPATCH'te (WAREHOUSE→SHIPPED) |

### Sipariş Yaşam Döngüsü

```
PENDING → APPROVED → PARTIAL_SHIPPED → COMPLETED
                  ↘
                   CANCELLED
```

> 📌 `OrderStatus` enum: `PENDING | APPROVED | PARTIAL_SHIPPED | COMPLETED | CANCELLED` — ayrı bir `IN_PRODUCTION` sipariş statüsü **yoktur** (üretim `WorkOrder` domain'inde izlenir).

---

## 3. Adım 0 — Giriş ve Token Alma

**Endpoint:** `POST /api/auth/login`
**Tablo:** `users`, `user_permissions`, `permissions` (sadece okuma — rol tablosu YOK)

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
| `FABRIC` | Kumaş (ham/boyalı ayrımı `colorId == null` → ham, dolu → boyalı) |
| `CONSUMABLE` | Sarf malzeme |

> 📌 `enum ItemType` yalnız üç değer içerir: `YARN | FABRIC | CONSUMABLE`. (Fabrika çözgü/dokuma yapmadığı için `WARP` değeri **yok**.)

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

**`type` değerleri** (`prisma/schema.prisma → enum CompanyType`): `CUSTOMER` | `SUPPLIER`

> 📌 **Fason firmalar `Customer` değil ayrı tabloda** — `POST /api/subcontractors` endpoint'i kullanılır (bkz. fason akışı bölümü). `CompanyType` enum'u yalnız `CUSTOMER | SUPPLIER` içerir; eski `SUBCONTRACTOR`/`DYEHOUSE` değerleri kaldırıldı — fason/boyahane artık ayrı `Subcontractor` modeliyle temsil edilir.
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
  "weightKg": 62.5
}
```

> 📌 **`qualityGrade` KK1 girişinde opsiyoneldir** (`Roll.qualityGrade` nullable) — kaliteyi normalde kalite istasyonları (KK2/Kurşun, Tambur) belirler. Verilirse `QualityGrade` kataloğundaki bir kod olmalı.
> 📌 **`weightKg`** admin ayarıyla KK1'de kapatılabilir (default kapalı → opsiyonel).

**Yanıt:**
```json
{
  "success": true,
  "data": {
    "id": "uuid...",        // ← ROLL_ID — sonraki adımlarda kullanılacak
    "barcode": "T150726H0001",  // ← Otomatik üretilir (ham giriş → tip H)
    "itemId": "...",
    "initialQty": 500,
    "currentQty": 500,      // Başlangıçta initialQty ile aynı
    "status": "STOCK",
    "form": "TOP",
    "qualityGrade": null
  }
}
```

> 📌 **Not:** Barkod otomatik üretilir, formatı `T{GGAAYY}{H|F}{NNNN}` (örn. `T150726H0001`) — ayraçsız, `H`=ham/işlenecek, `F`=final; gün+tip başına 0001'den artar. Kaynak: `helpers/roll-barcode.helper.ts`.
> 📌 **İki top oluşturun** — uçtan uca test için en az 2 top gerekli.

### B2: Barkod ile Sorgulama (El Terminali)

**Endpoint:** `GET /api/rolls/barcode/{barcode}`
**Tablo:** `rolls` (okuma)

```
GET /api/rolls/barcode/T150726H0001
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
GET /api/rolls?search=T150726                     → Barkod ile arama
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

> 📌 **`orderNumber` server tarafında otomatik üretilir** (`SIP`+GGAAYY+NNNN — örn. `SIP1507260001`). İstemci gönderse bile yok sayılır. Yanıttan dönen değeri kullanın.
> ⚠️ **`customerId` ve `itemId` veritabanında var olmalıdır.** Swagger'ın otomatik doldurduğu placeholder UUID'leri kullanmayın!
> ⚠️ **Müşteri aktif olmalı** (`isActive: true`); pasif müşteriye sipariş açılamaz (v3, BUG-07).
> ⚠️ **`deadline` `orderDate`'ten önce olamaz** (v3, BUG-08). `orderDate` verilmediyse şu anki zaman referans alınır.
> ⚠️ **Line `quantity > 0` ve `unitPrice >= 0` ya da null** (v3, BUG-04..06).

**Yanıttan not edin:**
- `data.id` → `ORDER_ID`
- `data.orderNumber` → autogen (örn. `SIP1507260001`)
- `data.lines[0].id` → `ORDER_LINE_ID` (iş emrine bağlamak için)

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

> 📌 Standart boyama rotası: `KK1_1 → BOYAHANE_DIS → KURSUN_1 → TAMBUR_1`. **Tambur zorunlu değil** — rota Kurşun/QC2 ile de bitebilir (son adım açık kumaşı finalize eder).
> 📌 `enum StationKind`: `RAW_QC | PROCESS_QC | TAMBUR | SUBCONTRACTOR | SHIPPING | OTHER`. Paketleme istasyonu yok; `SHIPPING` = üretim-dışı tartı/sevk istasyonu (makinesiz, çuval depo modeliyle kullanılır).

### C3: İş Emri Oluştur

**Endpoint:** `POST /api/work-orders`
**Tablolar:** `work_orders` + `work_order_steps` + `work_order_to_order_lines` + `traveler_cards` (kart WO açılışında otomatik doğar)
**İzin:** `workorder:write`

```json
{
  "batchNumber": "IE1507260099",
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

> 📌 **`batchNumber` (legacy input adı) = manuel İş Emri Numarası.** **Opsiyoneldir** — verilmezse server `IE`+GGAAYY+NNNN üretir (örn. `IE1507260001`); verilirse benzersizliği doğrulanır. Model kolonu `WorkOrder.workOrderNumber`. Parti (`Batch`, `P…`) artık AYRI bir modeldir; iş emri partiyle karıştırılmamalı.
> 📌 **Refakat kartı WO açılışında doğar** (`TravelerCard`, `workOrderId` @unique) — `cardNumber = barcode = workOrderNumber` (İE). Finalize'da değil, oluşturmada.

**`type` değerleri** (`prisma/schema.prisma → enum WorkOrderType`):

| Değer | Anlam | Zorunlu alanlar |
|-------|-------|-----------------|
| `ORDER_PRODUCTION` | Siparişe Özel Üretim | `orderLineIds` (en az 1 sipariş kalemi) |
| `STOCK_PRODUCTION` | Stoka Üretim (sipariş yok) | `targetItemId` (hedef ürün) |

> 📌 `parameters` alanı JSON'dır, istediğiniz veriyi koyabilirsiniz (reçete no, renk kodu vb.)
> 📌 `orderLineIds` ORDER_PRODUCTION'da **zorunlu**, diğer type'larda yok.
> 📌 Yanıttan `data.id` → `WORK_ORDER_ID`
> 📌 ⚠️ EXTERNAL/SUBCONTRACTOR istasyonlar `POST /api/subcontractor/dispatch` + `/receive` ile yürür; PROCESS_QC (Kurşun/KK2) `/api/kursun-qc/*` ile; KK1/genel INTERNAL kart taramasıyla (bkz. Senaryo D).

### C4: Topları İş Emrine Bağla

> ⚠️ **HTTP ucu kaldırıldı (K6, 2026-06-12):** `GET /available-for-attach`, `PATCH /:id/attach-rolls`, `PATCH /:id/detach-rolls` uçları hiçbir frontend çağırmadığı için kaldırıldı. **`attachRolls`/`detachRolls` SERVİS metotları yaşıyor** — quick-start ve seed scriptleri içeriden çağırır. Uçtan uca Swagger testinde topları bir WO'ya bağlamak için `scripts/` altındaki quick-start akışını kullanın veya seed senaryosuyla hazır veri üretin.

**Etki:** Bağlanan topların status'u `STOCK → IN_PRODUCTION` olur; `work_order_steps` ilk adımla ilişkilenir. Top `STOCK` (veya bir depo statüsü) değilse bağlama reddedilir.

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

> ⚠️ **Jenerik `/api/production/step-action` ve `/api/production/*` UÇLARI YOKTUR.** Üretim ilerletme istasyon türüne göre **ayrı uç ailelerine** dağılmıştır. İstasyon süreçlerini fiziksel olarak **refakat kartı taraması** tetikler (kart WO açılışında doğar). Kanonik uçlar: `src/routes/traveler-card.routes.ts`, `src/routes/kursun-qc.routes.ts`, `src/routes/subcontractor.routes.ts`, `src/routes/tambur.routes.ts`.

| İstasyon türü (`StationKind`) | Uç ailesi |
|---|---|
| RAW_QC (KK1) / genel INTERNAL | `POST /api/traveler-cards/scan` (kart taraması) |
| SUBCONTRACTOR (fason/boyahane) | `POST /api/subcontractor/dispatch` + `/api/subcontractor/receive` |
| PROCESS_QC (Kurşun + KK2) | `POST /api/kursun-qc/complete-qc2` (top-başına) → `/report-error` → `/finish-step` |
| TAMBUR | `POST /api/tambur/finalize` (bkz. Senaryo E) |

### D1: İstasyon taraması (KK1 / genel INTERNAL) — `traveler-cards/scan`

**Endpoint:** `POST /api/traveler-cards/scan`
**Tablo:** `traveler_card_scans` (+ WO/step ilerleme)
**İzin:** `workorder:write` (mobil ekran izinleri de kabul)

```json
{
  "barcode": "IE1507260099",
  "stationId": "KK1'in ID'si",
  "scanType": "DEPARTURE"
}
```

> 📌 `scanType`: `ARRIVAL` | `DEPARTURE` | `INFO`. Barkod = refakat kartı barkodu (= workOrderNumber, İE). 10 sn içinde aynı kart+istasyon+scanType tekrarı dedup edilir (wedge çift-burst koruması).

### D2: EXTERNAL istasyon (BOYAHANE/BASKI vb.) — `subcontractor/dispatch` + `receive`

**Sevk (fasona gönder):**

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

**Mal kabul (fasondan dönüş) — yeni açık-kumaş modeli:**

```json
POST /api/subcontractor/receive
{
  "workOrderId": "WORK_ORDER_ID",
  "stepId": "BOYAHANE step'in ID'si",
  "subcontractorId": "Fason firma ID'si",
  "returns": [
    { "rollId": "ROLL1_ID" },
    { "rollId": "ROLL2_ID" }
  ],
  "newRolls": [
    { "qty": 485, "weightKg": 60 },
    { "qty": 480, "weightKg": 58 }
  ],
  "appliedColorId": "opsiyonel — boyahane renk uygular"
}
```

> 📌 **Kabulde orijinal rulolar emekliye ayrılır** (`returns[]` → status `SUBCONTRACTOR_CONSUMED`). Fasondan gelen her parça için **yeni açık-kumaş `Roll`** doğar (`newRolls[]`, `barcode=null`, `entrySource=SUBCONTRACTOR_RETURN`, `form=ACIK`) ve rotadaki sonraki adıma (genelde Kurşun/KK2) bağlanır.
> 📌 `newRolls[].qty` (metraj) **ZORUNLU** — irsaliyedeki parça/metre bilgisi receive anında girilir. `weightKg` opsiyonel (kesin ölçüm sonraki istasyonun FINISH'inde damgalanır).
> 📌 `dispatchId` kullanılmaz — kabul `workOrderId + stepId + subcontractorId` ile çözülür.

### D3: Kurşun + KK2 (PROCESS_QC) — top-başına QC2

**Endpoint:** `POST /api/kursun-qc/complete-qc2`
**İzin:** `quality:write` (veya `mobile:kk2-kursun`)

```json
{
  "rollId": "ROLL_ID",
  "stepId": "KURSUN step'in ID'si"
}
```

> 📌 Kurşun + QC2 **tek fiziksel istasyondur** (`StationKind.PROCESS_QC`, tek `WorkOrderStep`). İstasyonun `propertyCapabilities` listesindeki özellikler Roll'a otomatik `RollProperty` olarak kopyalanır; KURSUN yeteneği atanmışsa `KURSUN_APPLIED` log'u da otomatik atılır.
> 📌 Kartın adım özetini `GET /api/kursun-qc/by-card/{barcode}` ile çekebilirsiniz.

### D4: Hata Raporla (Kurşun QC2)

**Endpoint:** `POST /api/kursun-qc/report-error`
**Tablo:** `roll_errors` (yeni kayıt)
**İzin:** `quality:write` (veya `mobile:kk2-kursun`)

```json
{
  "rollId": "ROLL_ID",
  "stepId": "KURSUN step'in ID'si",
  "startMeter": 60,
  "defectTypeId": "DefectType katalog UUID'si"
}
```

> 📌 **Nokta model:** Hata tek nokta olarak girilir — `startMeter` zorunlu, `endMeter` **tutulmuyor**. Operatör "60. metrede hata" der; aralık yok.
> 📌 **`defectTypeId` ZORUNLU** — hata tipi `DefectType` kataloğundan seçilir; serbest metin kabul edilmez (`errorType` yalnızca kayıt anında `DefectType.name`'in snapshot kopyasıdır). Katalog için `GET /api/defect-types`.
> 📌 Tambur operatörü ekranda bu noktayı görür, fiziksel sarım esnasında kesim kararını kendi verir.
> 📌 Her hata ayrı bir `roll_errors` kaydı; `isProcessed: false` doğar → Tambur'da işlenir.
> 📌 Mobil offline kuyruğu için opsiyonel `clientErrorId` (idempotency UUID) gönderilebilir.
> 📌 Yanıttan `data.id` → `ERROR_ID` (Tambur'da kullanılacak).

### D5: PROCESS_QC adımını kapat — `finish-step`

**Endpoint:** `POST /api/kursun-qc/finish-step`
**İzin:** `quality:write` (veya `mobile:kk2-kursun`)

```json
{
  "stepId": "KURSUN step'in ID'si"
}
```

> ✅ Adımdaki tüm toplar QC2'yi tamamlamışsa adım kapanır; QC2 tamamlanmamış top varsa **400** döner.
> ✅ Toplar rotadaki sonraki adıma (genelde Tambur) geçer.
> 📌 Yanlışlıkla kapatılan adımı `POST /api/kursun-qc/reopen-step` ile (toplar ileri taşınmadıysa) yeniden açabilirsiniz.

### Açık Kartları / Kuyruğu İzleme

**Endpoint:** `GET /api/kursun-qc/open-cards` (PROCESS_QC'de açık top bekleyen aktif kartlar) veya `GET /api/kursun-qc/queue` (adım kuyruğu).

---

## 8. Senaryo E — Tambur (Roll Splitting)

Tambur, üretimin **kesim/bölme + kalite kararı** istasyonudur (zorunlu değil; rota Kurşun/QC2 ile de bitebilir). Kurşun'dan gelen hata kayıtları burada değerlendirilir. **Sipariş↔rulo tahsisi Tambur'da YAPILMAZ** — tahsis (`SackAllocation`) sevkiyat DISPATCH anında yazılır (bkz. Senaryo F).

### E1: Bekleyen Topları Listele

**Endpoint:** `GET /api/tambur/pending-rolls`
**Tablo:** `rolls` + `roll_errors` (isProcessed = false)

### E2: Top Karar Ekranı

**Endpoint:** `GET /api/tambur/rolls/{rollId}`
**Tablo:** `rolls` + `roll_errors`

Topu tüm hataları ile birlikte gösterir.

### E3: Finalize (Kesim Kararı — Bağımsız Kesim Uzunluğu Modeli)

**Endpoint:** `POST /api/tambur/finalize`
**Tablolar:** `rolls`, `roll_errors`
**İzin:** `quality:write` (veya `mobile:tambur`)

**Model:** Tambur operatörü makinede kumaşı sarar, **sayaç sıfırdan başlar**. Her "kes" tuşu basışında o ana kadar sarılan uzunluk yeni bir top olur (parent'tan ayrılır), sayaç sıfırlanır, devam edilir.

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
      { "barcode":"T150726F0001", "currentQty":59,  "status":"WAREHOUSE", "qualityGrade":"1.KALITE" },
      { "barcode":"T150726F0002", "currentQty":10,  "status":"SCRAP",     "qualityGrade":"FIRE" },
      { "barcode":"T150726F0003", "currentQty":149, "status":"WAREHOUSE", "qualityGrade":"1.KALITE" },
      { "barcode":"T150726F0004", "currentQty":10,  "status":"SCRAP",     "qualityGrade":"FIRE" },
      { "barcode":"T150726F0005", "currentQty":272, "status":"WAREHOUSE", "qualityGrade":"1.KALITE" }
    ],
    "processedErrors": 2
  },
  "message": "Tambur tamamlandı. Parent bölündü, 5 yeni top oluşturuldu (4 kesim + kalan kuyruk top, 2 hata işlendi)."
}
```

### E4: Sipariş Tahsisi

Eski Tambur-anı allocation modülü kaldırıldı. **Yeni model (çuval havuzu, 2026-07):** top↔sipariş bağı yoktur; final ürünler önce **depo çuvallarına** (`Sack`) toplanır, sipariş tahsisi (`SackAllocation`) yalnız **sevkiyat DISPATCH anında** spec+şube FIFO ile yazılır (bkz. Senaryo F).

---

## 9. Senaryo F — Sevkiyat (Çuval Havuzu Modeli, 2026-07)

Sevkiyat **çuval depo** modeline geçti (`/api/shipping/*`). Çuval bir **depo nesnesidir**: `Sack.customerId` opsiyonel, **mühür/rezerv YOK**. Akış: **aç → okut → (opsiyonel tart) → çuval depoda bekler → sevkiyat depodan çuval seçilerek kurulur → DISPATCH**. Stok yalnız DISPATCH'te `SHIPPED` düşer; tahsis (`SackAllocation`) dispatch anında yazılır.

### F1: Depoya çuval aç ve final ürün okut

```
POST /api/shipping/sacks                 → yeni boş çuval (customerId opsiyonel)
POST /api/shipping/sacks/{id}/scan       → { barcode } — WAREHOUSE/A1_STOCK topu çuvala ekle
POST /api/shipping/sacks/{id}/weigh      → { weightKg } — opsiyonel tartı
GET  /api/shipping/sacks/{id}/contents   → çuval içeriği
```

> 📌 Çuval açıldıktan sonra `shipmentId=null` iken her an düzenlenebilir (top ekle/çıkar/taşı). Sevkiyata atanmış çuvalın içeriği kilitlenir (`touchWarehouseSackTx` WHERE `shipmentId IS NULL`).

### F2: Açık siparişleri gör

```
GET /api/shipping/open-orders            → İstenen | Sevk | Açık (Açık = quantity − shippedQty)
```

> 📌 Rezerv yoktur — `OrderLine.packedQty`/`Order.packedQty` kaldırıldı. Sipariş görünümü **İstenen | Sevk | Açık**.

### F3: Sevkiyat kur (depodan çuval seçerek)

```json
POST /api/shipping/shipments
{
  "sackIds": ["SACK1_ID", "SACK2_ID"],
  "customerId": "CUSTOMER_ID",
  "orderIds": ["ORDER_ID"]
}
```

> 📌 Önizleme: `POST /api/shipping/shipments/preview`. Çuval ekle/çıkar: `/shipments/:id/add-sacks`, `/shipments/:id/remove-sack`.

### F4: Çıkış (DISPATCH)

```
POST /api/shipping/shipments/{id}/dispatch     → çuvallar SHIPPED, tahsis shippedQty'ye terfi
GET  /api/shipping/shipments/{id}/cancel-preview
POST /api/shipping/shipments/{id}/cancel       → tahsis silinir, çuval depoya döner
```

> 📌 **Sevk onayı** `shipping.confirmationEnabled` feature-flag'ine bağlı (varsayılan **kapalı**): kapalıysa `createShipment` yanıtında çuvallar **doğrudan** `DISPATCHED` olur (`dispatched=true`); açıksa sevkiyat `PLANNED` kalır ve çıkış ayrıca `dispatch` ile onaylanır. `ShipmentStatus` = `PLANNED | DISPATCHED | CANCELLED` (eski `PREPARING/READY/AT_DOOR` kaldırıldı — kapı önü ara adımı YOK).
> 📌 `SackAllocation` **sevk anında** seçilen sipariş satırlarına spec+şube FIFO ile yazılır (`distributeSacksToLines`). PLANNED tahsis sayılmaz; stok ve `shippedQty` yalnız DISPATCH'te düşer/terfi eder.

---

## 10. Hata Senaryoları

Bu senaryoları test ederek hata mesajlarının doğruluğunu kontrol edin:

| # | Test | Beklenen Sonuç |
|---|------|---------------|
| 1 | Login yanlış şifre ile | `401` — Kullanıcı adı veya şifre hatalı |
| 2 | Token olmadan herhangi bir endpoint çağır | `401` — Token gerekli |
| 3 | Yetkisiz (admin dışı, `admin` ile açtığınız yeni) kullanıcıyla `POST /api/orders` çağır | `403` — `order:write` yetkisi yok (yeni kullanıcı yetkisiz başlar; bkz. §1) |
| 4 | `POST /api/items` aynı `code` ile iki kez | `409` — unique constraint |
| 5 | `POST /api/orders` `customerId` pasif müşteri ile | `400` — "Müşteri pasif durumda..." (v3, BUG-07) |
| 6 | `POST /api/rolls/initial-entry` olmayan `itemId` ile | `404` — Ürün bulunamadı |
| 7 | `POST /api/orders` olmayan `customerId` ile | `400` — Geçersiz veri yapısı |
| 8 | Fason istasyonuna QC2 kapatma (`kursun-qc/finish-step`) çağır | `400` — fason/dış istasyon; `subcontractor/dispatch` + `/receive` kullan |
| 9 | `STOCK`/depo statüsünde olmayan topu iş emrine bağlamaya çalış | `400` — Barkod hata listesinde döner |
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
□  C2. İstasyon ID'leri al   → KK1_ID, BOYAHANE_ID, KURSUN_ID, TAMBUR_ID
□  C3. İş emri oluştur       → WORK_ORDER_ID + refakat kartı (İE) otomatik doğdu ✓
□  C4. Topları bağla (quick-start/seed servisi) → Status: STOCK → IN_PRODUCTION ✓
□  C5. Refakat kartı kontrol et
□  D1. Boyahane dispatch      → Status: AT_SUBCONTRACTOR ✓
□  D2. Boyahane receive       → orijinal SUBCONTRACTOR_CONSUMED, yeni açık-kumaş Roll doğdu ✓
□  D3. Kurşun complete-qc2 (top-başına)
□  D4. Hata 1 raporla         → ERROR1_ID not et (defectTypeId zorunlu)
□  D5. Hata 2 raporla         → ERROR2_ID not et
□  D6. Kurşun finish-step     → toplar Tambur'a geçti ✓
□  E1. Tamburda bekleyenler
□  E2. Tambur finalize        → SCRAP + WAREHOUSE child roll'lar oluştu ✓
□  F1. Depoya çuval aç + final ürün okut
□  F2. Sevkiyat kur (sackIds + customerId) + DISPATCH → SHIPPED ✓
```

---

## 12. Temiz Başlangıç (Veri Sıfırlama)

Test verilerini sıfırdan başlatmak için:

```bash
# Tam sıfırlama: DB drop + tüm migration'ları uygula + seed
npx prisma migrate reset --force
```

`migrate reset` mevcut DB'yi düşürür, `prisma/migrations/` altındaki **tüm** migration'ları (bugün 232; kanonik `ls prisma/migrations`) sırayla uygular ve `npm run seed`'i otomatik çalıştırır. Sonuç (kanonik: `prisma/seed.ts` içindeki create çağrıları / seed çıktısı — sayıları buraya sabitleme): 86 permission + 18 rol şablonu + **1 kullanıcı (yalnız `admin`)** + 3 kalite sınıfı (1.KALITE / A1 / FIRE) + 4 müşteri + 6 renk + 7 kumaş özelliği (KURSUN dahil) + 3 fason kategori (BOYA/ZIMPARA/KARTELA) + 3 fason firma (Boyer/Kestel/Kartela A.Ş.).

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
