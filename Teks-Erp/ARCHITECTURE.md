# TeksERP — Backend Mimari ve Performans Referansı

> Bu dosya `CLAUDE.md`'nin uzun-form referansıdır. CLAUDE.md sözleşmedir, bu dosya kütüphane.
> Schema değiştiğinde / yeni endpoint eklendiğinde / pattern güncellendiğinde bu dosya da güncellenmelidir.

---

## 1. Tech Stack

| Katman | Teknoloji | Not |
|---|---|---|
| Runtime | Node.js | — |
| Dil | TypeScript (strict) | `any` yasak |
| Framework | Express 5 | `req.params.id` bazen `as string` ister |
| ORM | Prisma 7 + `@prisma/adapter-pg` | Şema değişince `prisma:generate` zorunlu |
| Veritabanı | PostgreSQL | — |
| Auth | JWT (`jsonwebtoken` + `bcryptjs`) | — |
| Validasyon | Zod 4 | `z.record(z.string(), z.unknown())` — iki arg |
| Docs | `swagger-jsdoc` + `swagger-ui-express` | `/api-docs` |
| Güvenlik | `helmet`, `cors` | — |
| Loglama | `morgan` | — |

---

## 2. Dizin Yapısı

```
Teks-Erp/
├── prisma/
│   ├── schema.prisma          # 65 model, 23 enum
│   ├── seed.ts                # Tek dosya: 55 permission + 14 template + 7 kullanıcı + 3 kalite + master demo
│   └── migrations/            # 2026-05-25 baseline reset + 44 migration (son: 20260612103000)
│
├── src/
│   ├── server.ts              # Entry point
│   ├── app.ts                 # Express app + route kayıtları
│   │
│   ├── config/
│   │   └── swagger.ts         # OpenAPI 3.0
│   │
│   ├── lib/
│   │   └── prisma.ts          # PrismaClient singleton (pg adapter, pool=20)
│   │
│   ├── middlewares/
│   │   ├── auth.middleware.ts        # verifyToken → req.user
│   │   ├── rbac.middleware.ts        # requirePermission, requireAnyPermission
│   │   ├── error.middleware.ts       # AppError + Prisma + Zod mapping
│   │   ├── device.middleware.ts      # Pairing / device-token auth (mobil)
│   │   └── uuid-param.middleware.ts  # UUID path param validate
│   │
│   ├── controllers/           # 15 dosya — HTTP layer
│   ├── services/              # 22 dosya + helpers/ + reports/ — iş mantığı
│   ├── routes/                # 31 dosya + reports/ — Swagger JSDoc + middleware
│   │
│   ├── types/
│   │   ├── api.types.ts       # ApiResponse, PaginatedResponse, JwtPayload
│   │   └── express-augment.ts # Request.user
│   │
│   └── utils/
│       ├── app-error.ts       # 400/401/403/404/409/500
│       └── query-parser.ts    # URL → Prisma where/orderBy/skip/take
│
├── eslint.config.mjs           # tx içinde Promise.all yasağı dahil
├── prisma.config.ts
└── package.json
```

---

## 3. Layered Architecture

```
Routes  →  verifyToken → requirePermission → controller method
            (JWT)         (yetki kontrolü)
                                  ↓
Controllers → Zod validate → service.method() → res.json()

Services  → İş kuralları + Prisma queries + transaction + AuditService.log()

Prisma    → src/lib/prisma.ts (singleton, pg adapter)
```

**Katman kuralı:** Hiçbir katman alt katmanı atlamamalı. Route, Service'i doğrudan çağırmaz. Controller, prisma'yı doğrudan çağırmaz.

---

## 4. Schema — 66 Model + 23 Enum

> **Güncellik notu (2026-06-12):** Aşağıdaki model/enum tabloları sevkiyat yeniden-yazımı ÖNCESİNDEN kalma — gerçek envanter 65 model / 23 enum. Tabloda eksik olanlar: `Sack`, `Shipment`, `ShipmentOrder`, `SackAllocation`, `PrintedDocument`, `RollReturn`, `ReturnReason`, `KartelaDispatch(+Item)`, `KartelaReceipt(+Item)`, `ProductRecipe(+Property)`, `UserPreference`; enum'larda `ShipmentStatus`, `PrintedDocType/Status`, `RollErrorAction`, `DefectSeverity` vb. Kesin liste için `prisma/schema.prisma`'ya bak.

### Modeller (gruplandırılmış)

| Grup | Modeller | Adet |
|---|---|---|
| RBAC | User, Permission, UserPermission, PermissionTemplate, PermissionTemplateItem | 5 |
| Station & Device | Station, Machine, Device (allowlist: status PENDING/APPROVED) | 3 |
| Routing | Route, RouteStep | 2 |
| Item & Properties | Item, FabricProperty, Color, ItemAllowedProperty, ItemAllowedColor | 5 |
| Sales | Customer, CustomerBranch | 2 |
| Customer Mapping | CustomerItemAlias, CustomerColorAlias | 2 |
| Orders | Order, OrderLine, OrderLineRequiredProperty | 3 |
| Production | WorkOrder, WorkOrderStep, WorkOrderToOrderLine | 3 |
| Production Config | WorkOrderTargetProperty, StationColor, StationProperty | 3 |
| Inventory | Roll, RollMovement, RollOperation, RollProperty | 4 |
| Quality | QualityGrade, DefectType, RollError | 3 |
| Subcontractor | Subcontractor, SubcontractorCategory, SubcontractorToCategory, SubcontractorDispatch, SubcontractorDispatchItem, SubcontractorReceipt, SubcontractorReceiptItem, SubcontractorReceiptProperty | 8 |
| Documents | TravelerCard, TravelerCardScan, Swatch, Manifest, LabelTemplate, PrintedDocument | 6 |
| System | SystemSetting | 1 |
| Audit | SystemLog, SystemLogArchive | 2 |
| **TOPLAM** | | **53** |

> `Manifest` modeli şemada hâlâ tanımlı ama sevkiyat modülü yeniden yazılırken kullanımı askıda; yeni sevkiyat tasarımıyla birlikte revize edilebilir. `CurrentAccount` ve `MachineLog` modelleri 2026-05-25 cleanup'ında silindi (finans modülü ve loom monitoring için kullanılmıyordu).

### Çalışma Oturumu — `WorkSession` (kim hangi makinede; ayak izi) — 2026-07-02

> Tablet/telefonların makine bağı statik admin atamasından **oturum** seviyesine indi.
> Model: `userId + deviceId(FK devices.id) + machineId? + stationId(NOT NULL) + startedAt/endedAt/endReason/lastActivityAt`.
> `endReason`: `LOGOUT | NEW_LOGIN | TAKEOVER | IDLE | ADMIN`.

- **İnvariantlar (DB seddi):** bir makinede tek aktif oturum + bir cihazda tek aktif oturum — iki ŞEMA-DIŞI partial unique (`work_sessions_active_machine_uq`, `work_sessions_active_device_uq`, migration `20260702121000`); eşzamanlı open yarışının kaybedeni P2002 → 409.
- **stationId denormalize ve DONUK:** makineli açılışta server makineden türetir (makine sonradan istasyon değiştirse geçmiş bozulmaz). Makinesiz istasyon oturumu (SHIPPING) `machineId=null`.
- **Devralma warn-then-confirm:** makine doluysa `409 MACHINE_OCCUPIED` (+ occupiedBy detayı); `confirmTakeover:true` ile tekrar → eski oturum `TAKEOVER` ile kapanır.
- **Idle TEMBEL enforce (timer/cron YOK):** `workSession.idleTimeoutMinutes` ayarı (default 600 dk, 0=kapalı); `resolveActiveSession`/`sweepIdleSessions` (helpers/work-session.helper.ts) okuma anında süresi dolan oturumu `IDLE` ile kapatır. `lastActivityAt` device.middleware'in lastSeenAt throttle'ına piggyback (60sn, fire-and-forget).
- **Donanım bağlama tek eksen (hedef):** `PeripheralDevice` ya makineye (`machineId`) ya **makinesiz** istasyona (`stationId`, yeni) bağlanır — makineli istasyona doğrudan bağlama serviste reddedilir. `StationKind.SHIPPING` (yeni) = sevkiyat/tartı: üretim dışı, makinesiz; seed'de `SEVK_1` bu türde ve `SEVK-KANTAR` istasyona bağlı. Cihaza-bağlı (`deviceId`/`DevicePeripheral`) eksen Faz 6'da emekli olacak.
- **Oturum açmak ONAYLI cihaz ister** (`req.device` zorunlu — allowlist fiilen anlamlanır). Oturum açılabilir türler: `RAW_QC / PROCESS_QC / TAMBUR / SHIPPING` (`SESSIONABLE_STATION_KINDS`, work-session.service.ts).
- **Üretim atfı oturumdan damgalanır (Faz 2):** controller'ların tek geçidi `getStampContext(req)` (helpers/work-session.helper.ts; tx DIŞINDA çağrılır) — `stamp?.machineId ?? req.device?.machineId ?? null` GEÇİŞ fallback'iyle (Faz 6'da sökülür). Damga noktaları: KK1 girişi → `Roll.createdMachineId` (op üretmez); kurşun/QC2 (per-roll + batch) → `RollOperation.machineId`; tambur finalize/finalizeOpenFabric → `TAMBUR_PROCESSED.machineId`. **Movement machineId'si işin YAPILDIĞI kapanışta damgalanır** (açılışta makine belirsiz — movement bir SONRAKİ istasyon için açılır). Tambur kalıtım kopyaları (4 site) parent op'un machineId'sini KORUR — yeni damga uygulanmaz (çift-sayım filtresi bozulmaz).
- **for-session (Faz 2):** `GET /api/peripherals/for-session?kind=` — donanım aktif oturumun YERİNDEN çözülür (makine-oturumu → makine donanımı; istasyon-oturumu → istasyon donanımı; **oturum yok → BOŞ liste, fail-closed**). `getForDevice`/`/for-device` geçiş boyunca yaşar, Faz 6'da emekli. `enforceForMobile` (409 `WORK_SESSION_REQUIRED`) Faz 3'te açılır.
- Etiket format/yazıcı çözümü de oturum-öncelikli: `label.controller.resolveFormatOpts` → `session.machineId ?? req.device.machineId ?? ?machineId=`.

| Method | Endpoint | İzin | İş |
|---|---|---|---|
| POST | `/api/work-sessions` | MOBILE_SESSION_PERMS | Aç (machineId XOR stationId; `confirmTakeover`) |
| POST | `/api/work-sessions/close` | MOBILE_SESSION_PERMS | LOGOUT (idempotent) |
| GET | `/api/work-sessions/current` | MOBILE_SESSION_PERMS | `{ active, lastPlace }` (server-side yer hafızası) |
| GET | `/api/work-sessions/places` | MOBILE_SESSION_PERMS | İstasyon-gruplu aktif makine listesi |
| GET | `/api/machines/resolve?code=` | station:read + MOBILE_SESSION_PERMS | QR → makine (ham machine.code, exact match) |
| GET | `/api/work-sessions/active` | admin:settings | Canlı panel (okumada tembel idle süpürmesi) |
| GET | `/api/work-sessions` | admin:settings | Geçmiş (kullanıcı/makine/istasyon/tarih filtreli) |
| POST | `/api/work-sessions/:id/force-close` | admin:settings | ADMIN ile zorla kapat |

`MOBILE_SESSION_PERMS = mobile:kk1 | mobile:kk2-kursun | mobile:tambur | mobile:tarti-paket` (work-session.service.ts — tek kaynak).

**QR personel kartıyla giriş (opsiyonel, Faz 5):** `auth.loginMode` ayarı `"pin"` (default) | `"card"`. Kart içeriği `TEKSU:<userId>:<32-hex cardToken>` (`users.cardToken`, düz saklanır — fiziksel kart taşıyıcı sır; iptal = rotasyon). Uçlar: `POST /api/auth/login-card` (public; mod "pin" ise 403 — kapalıyken saldırı yüzeyi yok), `GET /api/auth/login-mode` (public — login ekranı auth'suz okur), `POST /api/admin/users/:id/card-token` (admin:users; üret/rotasyon — eski kart ANINDA ölür, açık JWT oturumları etkilenmez). PIN girişi her modda çalışır (fallback). Kart basımı: Electron → Yetkilendirme → Kullanıcılar → Personel Kartı sekmesi.

### Resmi belge defteri — `PrintedDocument` (versiyonlu irsaliye snapshot'ları)

> 2026-06-09. Üç sevk/irsaliye belgesi — **Sevk İrsaliyesi** (`Shipment`), **Fason Sevk İrsaliyesi** (`SubcontractorDispatch`), **Kartela Çeki Listesi** (`KartelaDispatch`) — artık donmuş, versiyonlu resmi belge. Eski `SubcontractorDispatch.printSnapshot` / `KartelaDispatch.printSnapshot` kolonları kaldırıldı (migration `20260609225307`).

Yaşam döngüsü (endüstri standardı): **TASLAK** (kaynak henüz resmileşmedi → tabloda satır YOK, client canlı render) → **freeze** (sevk olayı anında v1 ACTIVE; içerik + şablon override + firma künyesi `snapshot` JSON'una donar) → **reissue** (gerekçeli düzeltme: vN `SUPERSEDED`, vN+1 `ACTIVE` güncel veriden) → **void** (kaynak iptal: ACTIVE belge `VOIDED`, baskıda İPTAL filigranı). Satır içerikleri immutable; yalnız status/supersede/void meta güncellenir.

- **Yeni sevk olayı = yeni `sourceId` = yepyeni belge zinciri.** Önceki belgeye dokunulmaz (örn. fasona 2. parti → yeni `SubcontractorDispatch` → kendi v1'i). Versiyon yalnız *aynı* olayın belgesini düzeltmek içindir.
- **Polimorfik kaynak** (`docType` + `sourceId`, hard FK yok — 3 tabloya birden bağlanamaz); bütünlük `printed-document.service.ts`'de. `@@unique([docType, sourceId, version])` çift-versiyon yarışını keser.
- **Freeze, domain servisin sevk transaction'ı İÇİNDEN** çağrılır (`freezeForSource`) → sevk başarılıysa belge de garanti. Her belge tipi kendi snapshot builder'ını `registerPrintedDocBuilder` ile kaydeder (domain servis → printed-document.service tek yönlü bağımlılık).
- **Fason istisnası:** istenen renk + boyahane notu belgeye DONDURULMAZ — kasten canlı talimat overlay'i (`GET /subcontractor/dispatches/:id/dye-overlay`); kabul/iptalde kilitlenir.
- **Lazy-init / `reconstructed`:** belgesi olmayan eski DISPATCHED kayıt ilk görüntülemede geriye dönük dondurulur (baskıda "geriye dönük oluşturuldu" dipnotu).
- **Endpoint:** `GET /api/printed-documents/:docType/:sourceId/current | /versions | /versions/:v`, `POST .../reissue`. İzin docType→kaynak modülün okuma/yazma iznine eşlenir.
- **Test:** `scripts/test_printed_documents.ts` (24/24) — freeze, değişmezlik, reissue zinciri, yeni-sevk-yeni-belge, void, TASLAK→freeze + alloc geri-indirgeme.

Enum sayısı 14 → **16** (`PrintedDocType`, `PrintedDocStatus`).

### Enum'lar

| Enum | Değerler |
|---|---|
| `StationType` | INTERNAL, EXTERNAL |
| `StationKind` | RAW_QC, PROCESS_QC, TAMBUR, SUBCONTRACTOR, OTHER |
| `RollOperationType` | KURSUN_APPLIED, QC2_COMPLETED, TAMBUR_PROCESSED, SUBCONTRACTOR_SENT, SUBCONTRACTOR_RETURNED |
| `ItemType` | YARN, WARP, FABRIC, CONSUMABLE |
| `RollEntrySource` | SUPPLIER_RECEIPT, TAMBUR_SPLIT, SUBCONTRACTOR_RETURN |
| `RollStatus` | STOCK, IN_PRODUCTION, SCRAP, CANCELLED, AT_SUBCONTRACTOR, A1_STOCK, RETURNED_FROM_SUBCONTRACTOR, WAREHOUSE, SHIPPED, TAMBUR_CONSUMED, SUBCONTRACTOR_CONSUMED, AT_KARTELA, KARTELA_CONSUMED (PRODUCED 2026-07-13 KALDIRILDI) |
| `CompanyType` | CUSTOMER, SUPPLIER, SUBCONTRACTOR, DYEHOUSE |
| `OrderStatus` | PENDING, APPROVED, IN_PRODUCTION, PARTIAL_SHIPPED, COMPLETED, CANCELLED |
| `WorkOrderType` | ORDER_PRODUCTION, STOCK_PRODUCTION |
| `WorkOrderStatus` | PLANNED, IN_PROGRESS, PAUSED, COMPLETED, CANCELLED |
| `StepStatus` | PENDING, ACTIVE, COMPLETED, SKIPPED |
| `TravelerCardStatus` | ACTIVE, REPRINTED, VOIDED, COMPLETED |
| `ScanType` | ARRIVAL, DEPARTURE, INFO |
| `LabelKind` | (bkz. `schema.prisma` — etiket türleri) |

### Schema Kuralları

- **PK:** Tüm modellerde `String @id @default(uuid())`
- **Timestamps:** `createdAt` + `updatedAt` her modelde zorunlu (join tabloları hariç)
- **Soft delete:** Fiziksel DELETE yok — `isActive: false` veya status değişikliği
- **Audit:** Her CUD `SystemLog`'a yazılır → `AuditService.log()` üzerinden
- **`StationKind`** — istasyon **domain rolü**; API davranışını dispatch eder (PROCESS_QC için Kurşun+QC2 akışı vb.)
- **`Station.allowAsWorkOrderStep`** — WO step picker'da gösterilsin mi? **KK1 gibi giriş noktaları için false**: KK1 sadece Roll oluşturma noktası, WorkOrderStep olarak rotaya eklenmez.

### Roll Yaşam Döngüsü

```
STOCK ─┬─→ IN_PRODUCTION ─→ AT_SUBCONTRACTOR ─→ RETURNED_FROM_SUBCONTRACTOR ─┐
       │                                                                       │
       └─────────────────────────────────────────────→ IN_PRODUCTION (TAMBUR)─┤
                                                                              ↓
                                                ┌──── SCRAP / A1_STOCK (Tambur kesim)
                                                ↓
                                            WAREHOUSE  (depo)
```

Rotanın SON adımı — Tambur olsun olmasın — topu final ürüne çeker (kaliteden çözülen
`RollStatus`, varsayılan `WAREHOUSE`; non-Tambur çıktıda `form=ACIK`; barkodsuza barkod
üretilir). `PRODUCED` limbo statüsü **kaldırıldı** (2026-07-13, enum'dan da düştü).
Tambur'lu akışta top child `Roll`'lar olarak `WAREHOUSE`'a düşer; Tambursuz rota (Kurşun/QC2
veya fason son adım) aynı topu `WAREHOUSE` **açık kumaş** olarak finalize eder
(`finalizeRollsAtLastStep` — Tambur `resolveCutStatus`'un jenerik hali).

> **NOT (2026-07 — ÇUVAL DEPO MODELİ):** Sevkiyat modülü çuval depo modeline geçti (mühür/rezerv YOK). Çuval (`Sack`) bir **depo nesnesidir**; `Sack.customerId` **opsiyonel** (açılışta atanabilir, yoksa sevkte). Akış: WAREHOUSE serbest top → `openSack(customerId?)` → `scanIntoSack` → (opsiyonel `weighSack`) → çuval DEPODA (`shipmentId=null`, her an düzenlenebilir). **Rezerv yok** — `OrderLine.packedQty`/`Order.packedQty` ve `rebalanceCustomerPool` kaldırıldı; sipariş görünümü **İstenen | Sevk | Açık** (`Açık = quantity − shippedQty`). Sevkiyat depodan **çuval seçilerek** kurulur: `createShipment({ sackIds, customerId, orderIds? })`; sevk onayı (`shipping.confirmationEnabled`) **kapalı** (varsayılan) → `Shipment` **doğrudan** DISPATCHED (yanıtta `dispatched=true`), **açık** → PLANNED kurulur ve çıkış ayrıca `dispatchShipment` ile onaylanır (kapı önü ara adımı YOK: `PLANNED → DISPATCHED`). `SackAllocation` **sevk anında** seçilen siparişlere spec+şube FIFO ile yazılır (`distributeSacksToLines`); PLANNED tahsis `shippedQty`'ye SAYILMAZ. Stok yalnız DISPATCH'te `SHIPPED`'e düşer ve tahsis dispatch'te `shippedQty`'ye terfi eder (defter-otoritatif, `recomputeOrderStatusForOrders`); iptalde tahsis silinir, çuval depoya döner. `ShipmentStatus` = `PLANNED|DISPATCHED|CANCELLED` (PREPARING/READY/AT_DOOR kaldırıldı); `ShipmentAllocation`/`markReady`/`retarget`/`sealSack`/`moveToDoor` kaldırıldı; `ShipmentOrder` kullanıcı-seçili sipariş kümesidir. Tam tasarım: `CUVAL-HAVUZU-TASARIM.md`, kanonik test: `scripts/test_sack_pool_lifecycle.ts`. Kartela `AT_KARTELA`/`KARTELA_CONSUMED`, fason dönüş `SUBCONTRACTOR_CONSUMED` + born-roll kullanır (§7.2).

---

## 5. API Endpoint Haritası

`app.ts` üzerinden mount edilen route prefix'leri.

> **Güncellik notu (2026-06-12):** Gerçek mount sayısı 39 — aşağıdaki haritada eksik olanlar: `/api/shipping`, `/api/printed-documents`, `/api/returns`, `/api/return-reasons`, `/api/kartela`, `/api/product-recipes`, `/api/production-balance`, `/api/customer-branches`. Kesin liste için `src/app.ts`'e bak.

### Public (auth gerekmez)

| Method | Endpoint | Not |
|---|---|---|
| POST | `/api/auth/login` | JWT döndürür |
| GET | `/health` | Health check |
| ANY | `/api/devices/*` | Mobil cihaz pairing public uçları (`devicePublicRouter`) |

### Auth & Admin

| Endpoint | Permission |
|---|---|
| `/api/auth/*` | (login public, diğerleri token) |
| `/api/admin/*` | `admin:users` / `admin:settings` / `admin:*` |
| `/api/admin/devices/*` | `admin:users` |

### Master Data (çoğu BaseController CRUD)

| Endpoint | Permission |
|---|---|
| `/api/items` | `item:read` / `item:write` |
| `/api/customers` | `customer:read` / `customer:write` |
| `/api/customers/:customerId/branches` | `customer:read` / `customer:write` |
| `/api/customers/:customerId/aliases` (item + color) | `customer-alias:read` / `customer-alias:write` |
| `/api/stations` (+ `/api/machines`) | `station:read` / `station:write` |
| `/api/station-capabilities` | `station:read` / `station:write` |
| `/api/routes` | `station:read` / `station:write` |
| `/api/colors`, `/api/fabric-properties` | `property:read` / `property:write` |
| `/api/quality-grades`, `/api/defect-types` | `quality:read` / `quality:write` |
| `/api/currencies`, `/api/feature-flags` | (read public veya admin — bkz. route) |

### Envanter

| Endpoint | Permission |
|---|---|
| `GET /api/rolls`, `/api/rolls/:id`, `/api/rolls/barcode/:barcode`, `/api/rolls/:id/history` | `roll:read` |
| `POST /api/rolls/initial-entry`, `DELETE /api/rolls/:id` | `roll:write` |

### Planlama / Üretim

| Endpoint | Permission |
|---|---|
| `/api/orders` (CRUD) | `order:read` / `order:write` |
| `/api/work-orders` (+ `/lock`, `/manifest`, `/travel-card`, `/rolls`; `attach-rolls`/`detach-rolls`/`available-for-attach` 2026-06-12'de kaldırıldı — servis metodları yaşıyor) | `workorder:read` / `workorder:write` |
| ~~`/api/production/*`~~ — **2026-06-12'de KALDIRILDI** (jenerik istasyon akışı; yerini kursun-qc/tambur/subcontractor modülleri aldı, frontend çağıranı yoktu) | — |
| `/api/kursun-qc/*` (`undo-qc2` 2026-06-12'de kaldırıldı — kurtarma yolu reopen) | `quality:read` / `quality:write` |
| `/api/tambur/*` | `quality:read` / `quality:write` |

### Fason (Subcontractor)

| Endpoint | Permission |
|---|---|
| `/api/subcontractor/dispatch`, `/receive` (workflow) | `workorder:write` |
| `/api/subcontractors` (master data CRUD) | `subcontractor:read` / `subcontractor:write` |
| `/api/subcontractor-categories` | `subcontractor:read` / `subcontractor:write` |

### Dokümanlar / Etiket

| Endpoint | Permission |
|---|---|
| `/api/traveler-cards/*` | `workorder:read` / `workorder:write` |
| `/api/swatches` | `quality:read` |
| `/api/labels` (önizleme + basma) | `label:read` / `label:print` / `label:edit` |
| `/api/label-templates` | `label-template:read` / `label-template:write` |

### Dashboard & Rapor

| Endpoint | Permission |
|---|---|
| `/api/dashboard` | (rol bazlı — bkz. route dosyası) |
| `/api/reports/*` (production, sales, quality, inventory, subcontract, customer, audit) | `report:<scope>` |

Swagger UI: **http://localhost:4000/api-docs** — her endpoint için `summary`, `parameters`, `requestBody`, `responses` (200/201 + 400/401/500) zorunlu.

---

## 6. RBAC Permission Kodları

`requirePermission(code)` middleware'i `req.user.permissions[]` array'ini kontrol eder. Toplam **55 permission**, 10 modül. Permissions doğrudan kullanıcıya bağlanır (`UserPermission` modeli); ayrıca tekrar kullanılabilir setler için `PermissionTemplate` / `PermissionTemplateItem` var (rol modeli **yok**).

| Modül | Permissions |
|---|---|
| SALES | `order:read`, `order:write`, `customer:read`, `customer:write`, `customer-alias:read`, `customer-alias:write` |
| PRODUCTION | `workorder:read`, `workorder:write`, `roll:read`, `roll:write`, `station:read`, `station:write` |
| MASTER_DATA | `item:read`, `item:write` |
| QUALITY | `quality:read`, `quality:write`, `property:read`, `property:write` |
| SUBCONTRACTOR | `subcontractor:read`, `subcontractor:write` |
| KARTELA | `kartela:read`, `kartela:write` |
| LOGISTICS | `label:read`, `label:print`, `label:edit`, `label-template:read`, `label-template:write`, `shipping:read`, `shipping:write`, `return:read`, `return:write` |
| REPORTS | `report:production`, `report:sales`, `report:quality`, `report:inventory`, `report:subcontract`, `report:customer`, `report:audit` |
| ADMIN | `admin:users`, `admin:settings`, `admin:*` (wildcard) |
| MOBILE | `mobile:kk1`, `mobile:kk2-kursun`, `mobile:tambur`, `mobile:depo`, `mobile:fason-sevk`, `mobile:fason-kabul`, `mobile:kartela-sevk`, `mobile:kartela-kabul`, `mobile:tarti-paket`, `mobile:sevkiyat`, `mobile:iade`, `mobile:hizli-is-emri`, `mobile:*` (wildcard) |

> Eski `LOGISTICS | shipment:*, allocation:*` permission'ları 2026-05-25'te sevkiyat modülüyle birlikte silindi; yeni sevkiyat yazımıyla LOGISTICS'e `shipping:*` + `return:*`, MOBILE'a 6 yeni ekran izni eklendi.

### Seed Sonrası Yetki Dağılımı

`seed.ts` **yalnız `admin`'i (tüm 55 permission) seed'ler** (`prisma/seed.ts` §3-4). Ek test kullanıcıları 2026-07-03'te KALDIRILDI (her reseed'de tek tek silmek gerekiyordu). Yeni kullanıcılar admin panelinden (`POST /api/admin/users`) açılır; 0-izinli RBAC senaryosu gereken HTTP testleri (`test_http_api`, `test_direct_ship_api`) kendi geçici kullanıcısını üretip temizler.

### Yeni Endpoint Yazarken

Yeni `requirePermission(code)` çağrısında:
1. `code` `seed.ts`'in `permissionData` listesinde **olmalı** — yoksa Admin dışı kullanıcılar 403 alır
2. Hem `seed.ts`'i güncelle hem de canlı DB'ye yeni permission INSERT + ihtiyacı olan kullanıcı/template'lere bağla

---

## 7. Kritik İş Kuralları

### 7.1 Roll Splitting — Cumulative Length Model (Tambur — `tambur.service.ts`)

Tambur operatörü makinede kumaşı sarar, sayaç **sıfırdan başlar**. Her "kes" tuşunda sayaca kadar sarılmış uzunluk yeni bir child Roll olur, sayaç sıfırlanır.

API: `POST /api/tambur/finalize` `{ rollId, cuts: [{ length, qualityGrade, relatedErrorIds }], decisions, foldType }`

```
Parent (currentQty=500m, hatalar @60m + @150m)
  ↓
cuts = [
  { length: 59,  quality: 1.KALITE },   // 0–59m
  { length: 10,  quality: FIRE, relatedErrorIds: [ERR_60M] },
  { length: 149, quality: 1.KALITE },   // 70–219m
  { length: 10,  quality: FIRE, relatedErrorIds: [ERR_150M] },
]
sum(cuts) = 228m
Kalan = 500 - 228 = 272m  → otomatik son child (parent.qualityGrade=1.KALITE)
  ↓
Toplam 5 child Roll yaratılır, hepsinde parentRollId set, yeni barcode
Quality → Status mapping QualityGrade kataloğundan:
  seed'de ÜÇ kalite de (1.KALITE/A1/FIRE) → WAREHOUSE; fallback de WAREHOUSE
  (tambur.service resolveCutStatus — proses-only fabrika, kalite farkı qualityGrade alanında;
   QualityGrade.targetStatus katalogdan override edilebilir)
Parent retire: status = TAMBUR_CONSUMED, currentQty = 0, currentStepId = null
İlişkili RollError'lar: actionTaken = CUT | NO_CUT, isProcessed = true
```

**Validasyon:** `sum(cuts[].length) ≤ parent.currentQty`. cuts boş gönderilirse tüm metraj tek child top olur (parent.qualityGrade ile).

### 7.2 Fason Dönüş — Consumed + Born-Roll Modeli

```
Kabul (receive): orijinal Roll'lar AT_SUBCONTRACTOR → SUBCONTRACTOR_CONSUMED (retire).
Receipt üzerinden YENİ açık-kumaş Roll'lar doğar:
  entrySource = SUBCONTRACTOR_RETURN, parentReceiptId dolu, barcode null,
  qty kabulde ZORUNLU (weightKg opsiyonel), batchSplitId sevkten kalıtılır.
Kesin ölçüm bir sonraki istasyonun FINISH akışında damgalanır
(RollMovement.qtyOut/weightOut). RETURNED_FROM_SUBCONTRACTOR = eski model (legacy).
```

### 7.3 İş Emri Esnekliği (`workorder.service.ts`)

```
- WorkOrder siparişsiz olabilir (STOCK_PRODUCTION)
- WorkOrder birden fazla OrderLine'a bağlanabilir (WorkOrderToOrderLine N:N)
```

### 7.4 Refakat Kartı (`TravelerCard`)

```
WorkOrder finalize edildiğinde TravelerCard üretilir (cardNumber, barcode).
Mal ile birlikte fiziksel olarak gezer.
İstasyonda barkod taranınca → TravelerCardScan kaydı + step ilerletme.
Reprint → eski kart REPRINTED'e döner, yeni kart ACTIVE.
WO COMPLETED → tüm kartlar COMPLETED'a düşer.
```

### 7.5 RollOperation Idempotent

```
@@unique([rollId, workOrderStepId, operationType])
→ Aynı operasyon iki kez çağrılırsa Prisma P2002 atar.
→ İdempotent retry için: önce findUnique, varsa skip; yoksa create.
```

---

## 8. Geliştirme Pattern'leri

### 8.1 Yeni Master Data Modülü (BaseController kullanımı)

`Warehouse` gibi basit bir tablo için:

```typescript
// src/services/warehouse.service.ts
import { BaseService } from "./base.service";
export const warehouseService = new BaseService({
  modelName: "warehouse",       // Prisma model adı (camelCase)
  tableName: "WAREHOUSE",       // SystemLog için tablo adı
  searchFields: ["code", "name"],
});

// src/controllers/warehouse.controller.ts
import { BaseController } from "./base.controller";
import { warehouseService } from "../services/warehouse.service";
export const warehouseController = new BaseController(warehouseService);

// src/routes/warehouse.routes.ts
import { Router } from "express";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { warehouseController } from "../controllers/warehouse.controller";

const router = Router();
router.get("/", verifyToken, requirePermission("station:read"), warehouseController.findAll);
router.post("/", verifyToken, requirePermission("station:write"), warehouseController.create);
// ...
export default router;

// src/app.ts
app.use("/api/warehouses", warehouseRoutes);
```

`BaseController` 6 endpoint sağlar: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` (soft), `DELETE /:id/permanent` (hard — bağımlılıklı modeller için `services/helpers/guarded-hard-remove.ts` factory'siyle guard'lı override kullan).

**BaseService genişletme hook'ları** (base.service.ts — yeni servis yazarken bil):

| Hook / config | Davranış |
|---|---|
| `searchFields` | `?search=` OR-contains araması |
| `extraWhere(req)` | İlişki bazlı scope filtresi eklemenin TEK yolu — safeFilters skaler süzgecine takılmadan AND'lenir (örn. Color exclusive-scope) |
| `sanitizeWriteData` (otomatik) | create/update gövdesi dmmf scalar/enum whitelist'inden geçer; ilişki adlı nested write operatörleri + id/createdAt/updatedAt **SESSİZCE atılır** — hata fırlatılmaz! Bilinçli nested create alanı `nestedCreateFields`'a yazılmalı, yoksa düşer |
| `safeSortBy` / `safeFilters` (otomatik) | Bilinmeyen kolon createdAt'a/sessiz düşmeye iner (500 önleme) |
| `uniqueField` | create() pasif eş bulursa YENİ kayıt yerine REACTIVATE eder (eski ID döner — farklı ID bekleme) |
| `relationSortMap` | İlişki kolonu sıralaması; cursor istekleri offset-cursor'a düşer |

### 8.2 Karmaşık İş Mantığı Modülü

```
1. Service yaz (src/services/) — iş kuralları + transaction + AuditService.log()
2. Controller yaz (src/controllers/) — Zod validate + service çağrısı
3. Route yaz (src/routes/) — verifyToken + requirePermission + Swagger JSDoc
4. app.ts'e import + app.use() ekle
```

### 8.3 Zod Validasyon

```typescript
import { z } from "zod";
const schema = z.object({
  name: z.string().min(1, "Ad gerekli"),
  quantity: z.number().positive("Miktar pozitif olmalı"),
  type: z.enum(["TYPE_A", "TYPE_B"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(), // Zod v4 — iki arg
});
const data = schema.parse(req.body); // Hata varsa errorHandler ZodError'ı yakalar → 400
```

### 8.4 Transaction

```typescript
const result = await prisma.$transaction(async (tx) => {
  const a = await tx.model1.create({ data: { ... } });
  const b = await tx.model2.update({ where: { id }, data: { ... } });
  return { a, b };
});
```

**ZORUNLU:** `tx` içinde `Promise.all([tx.x, tx.y])` **yasak** — pg adapter'ında tek connection seri çalıştırır, parallelism illüzyon. ESLint kuralı bunu yakalar (`eslint.config.mjs`).

Top-level `prisma.$transaction([prisma.x, prisma.y])` (pool kullanımı) sorun değil.

### 8.5 AuditService

Her CUD işleminde **zorunlu**:

```typescript
await AuditService.log({
  userId: req.user?.userId,
  action: "CREATE",          // | "UPDATE" | "DELETE"
  tableName: "ROLL",         // BÜYÜK HARF
  recordId: record.id,
  oldData: { ... },          // UPDATE/DELETE için
  newData: { ... },          // CREATE/UPDATE için
});
```

`BaseService` bunu otomatik yapar; özel servislerde manuel çağırmak gerekir.

**Best-effort sözleşmesi:** `AuditService.log/logEvent` içte try/catch'lidir — audit yazımı başarısız olsa istek PATLAMAZ (sayaç `/health`'e düşer). Çağrı genelde iş transaction'ının DIŞINDA, commit SONRASI yapılır (tx süresini uzatmamak için). Yani audit garantili değil, gözlemlenebilir-kayıplıdır; audit'i tx içine taşıyıp "audit başarısızsa rollback" garantisi VARSAYMA.

### 8.6 Hata Yönetimi

`AppError` factory'leri (`utils/app-error.ts`):
- `AppError.badRequest(msg)` → 400
- `AppError.unauthorized(msg)` → 401
- `AppError.forbidden(msg)` → 403
- `AppError.notFound(msg)` → 404
- `AppError.conflict(msg)` → 409

`errorHandler` Prisma kodlarını da yakalar:
- `P2002` (unique violation) → 409 + alan adı
- `P2025` (record not found) → 404
- `ZodError` → 400 + `errors[]` array
- `PrismaClientValidationError` → 400 (yanlış veri yapısı)

### 8.7 API Yanıt Formatları

```typescript
// Tekil başarı
{ "success": true, "data": { ... }, "message": "Kayıt oluşturuldu" }

// Sayfalanmış liste (BaseService.findAll)
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "pageSize": 20, "total": 150, "totalPages": 8 }
}

// Hata
{ "success": false, "message": "..." }

// Validasyon hatası (Zod)
{
  "success": false,
  "message": "Validasyon hatası",
  "errors": [{ "field": "initialQty", "message": "Miktar pozitif olmalı" }]
}
```

**Decimal alanlar number olarak serileşir:** `app.ts` açılışta `installDecimalNumberSerializer()` çağırır (`utils/json-replacer.ts` — `Prisma.Decimal.prototype.toJSON` patch'i). TÜM `res.json` çıktılarında Decimal string (`"5.50"`) değil number (`5.5`) gider; frontend'ler `Number()` sarmaz. Bu patch'i kaldırma/değiştirme — tüm frontend aritmetiği buna güvenir. (Express `json replacer` ayarı BİLEREK kullanılmıyor: toJSON replacer'dan önce koşar — gerekçe dosyada.)

### 8.8 Eşzamanlılık: Atomik Claim Deseni

Durum geçişi veya tüketim yapan her kritik yazma `findUnique → if(guard) → update` (check-then-act) ile DEĞİL, **atomik claim** ile yazılır:

```typescript
const claim = await tx.shipment.updateMany({
  where: { id, status: ShipmentStatus.PLANNED },   // gözlenen TAM durum (PLANNED → DISPATCHED = dispatch)
  data: { status: ShipmentStatus.DISPATCHED },
});
if (claim.count === 0) {
  throw AppError.conflict("Sevkiyat bu sırada değişti — sayfayı yenileyin");
}
```

İki incelik:
1. **Claim sonrası taze yükleme:** içerik (toplar/satırlar) tx İÇİNDE yeniden okunur — tx-öncesi okuma yalnız erken/ucuz 4xx içindir, yazma asla bayat snapshot'tan yapılmaz.
2. **Idempotent akışlarda kaybeden ayrımı:** claim kaybedilince fresh-read ile "paralel AYNI işlem mi (idempotent yanıt dön) / BAŞKA işlem mi (409)" ayrılır (örn. `tambur.service` raceLost deseni).

Kodda 24+ nokta / 10 servis (shipping 9, tambur 3, ...). Test örnekleri: `test_sack_pool_lifecycle.ts` (iptal/dispatch geçişleri), `test_dispatch_claim_step_match.ts`.

### 8.9 Numara/Barkod Üretimi: withBarcodeRetry

`@unique` numara/barkod üreten her create `withBarcodeRetry(() => prisma.$transaction(...))` ile sarılır (`utils/barcode-retry.ts`): P2002'de closure baştan koşar (max 5), düşmezse 409. ÜÇ kural:

1. **Sequence okuma closure/tx İÇİNDE olmalı** (`nextPrefixedSequence` vb.) — dışarıda hesaplanıp kapatılırsa retry hep aynı çakışan numarayı dener → kesin 409.
2. **Sequence DIŞI unique çakışabilecek girdi ÖNCE dedupe/valide edilmeli** — yoksa koca tx 5 kez boşuna döner ve gerçek validasyon hatası "Barkod üretimi başarısız" kılığında çıkar.
3. **tx-dışı guard'lar retry'da TEKRAR KOŞMAZ** — idempotency/varlık kontrollerini buna göre yerleştir (H-2/H-9 bulgu sınıfı: retry yarışı sessizce tamamlıyordu).

Numara sorgusu `startsWith` DEĞİL `gte/lt` range ile yazılır (ICU collation'da index seek) ve gün-içi son kayıt `createdAt desc` ile bulunur (999→1000 geçişinde lexicographic tuzak yok).

### 8.10 Çuval / Sevkiyat İçerik-Mutasyon Şablonu

Çuval veya sevkiyat İÇERİĞİNİ değiştiren her yeni endpoint bağlama göre kilitlemek ZORUNDA (`shipping.service.ts` + `helpers/shipment-locks.helper.ts`). Mühür/rezerv YOK → depodaki çuval her an düzenlenebilir; serileştirmenin iki noktası vardır:

1. **`touchWarehouseSackTx(tx, sackId)`** — DEPODAKİ çuvalın içeriğini (top/kartela ekle-çıkar-taşı) değiştiren tx'in İLK işi: çuval satırına koşullu dokunuş (`WHERE shipmentId IS NULL`, count 0 → 409). Tek kilit **sevkiyata atama** (`createShipment`) claim'iyle serileşir: sevk edilmekte olan çuvala top eklenemez / eklenmekte olan çuval sevk edilemez. Atlanırsa: dispatch ile yarışan içerik değişikliği "depoda ama listede yok" top bırakır (yaşanmış bug sınıfı).
2. **`touchShipmentPlannedTx(tx, shipmentId)`** — PLANNED sevkiyatın ÇUVAL KÜMESİNİ (çuval ekle/çıkar) değiştiren tx'in İLK işi: shipment satırına koşullu dokunuş (`WHERE status=PLANNED`, count 0 → 409) → dispatch/cancel finalize claim'leriyle TAM serileşir.
3. **`resetSackWeightsTx(tx, sackIds)`** — çuval içeriği değişiyorsa (ekle/çıkar/taşı — taşımada KAYNAK + HEDEF iki çuval birden) etkilenen çuvalların brüt tartısı sıfırlanır; yoksa bayat kg resmi irsaliyeye gider.

---

## 9. Database Performance Playbook

> **Kritik:** Üretim yüzbinlerce satır barındıracak. İndeks/sorgu hataları erken yakalanmalı.

### 9.1 FK Indeksleri Otomatik Değildir

Prisma her `@relation`'da arka planda FK index oluşturmaz. Yeni FK eklediğinde **`@@index([fkColumn])` zorunlu**.

```prisma
model Order {
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  @@index([customerId]) // ← unutma
}
```

Etkisi: 10-100x daha hızlı JOIN ve CASCADE delete.

### 9.2 Composite Index Sırası

**Eşitlik kolonları önce, range/order kolonları sonra:**

```prisma
@@index([status, createdAt])  // ✓ status = ?, ORDER BY createdAt
@@index([createdAt, status])  // ✗ Yanlış sıra — leftmost rule başarısız
```

Çift eşitlikte daha selektif olan kolon önce gelir (örn: `[workOrderId, status]` — workOrderId çok daha selektif).

### 9.3 Sık Birlikte Filtrelenen Kolonlar = Tek Composite

```prisma
@@index([customerId])          // ✗ Bitmap scan'e zorlar
@@index([status])              //
                                
@@index([customerId, status])  // ✓ Tek index scan
```

İki ayrı index, `WHERE customerId = ? AND status = ?` için zorunlu olarak bitmap scan yapar.

### 9.4 Soft-Delete Tabloları için Partial Index

`isActive: false` olan kayıtlar tabloda kalıyor. Aktif kayıt sorguları büyüdükçe yavaşlıyor. Çözüm: raw SQL migration'da partial index.

```sql
-- prisma/migrations/YYYYMMDD_partial_active_idx/migration.sql
CREATE INDEX customers_active_code_idx
  ON customers (code)
  WHERE "isActive" = true;
```

Prisma şema syntax'ında native değil (yet). Hacme ulaşan tablolar için (Item, Customer, Station) eklenmeli.

### 9.5 Yüksek Hacimli Tablolar için Cursor Pagination

`BaseService.findAll` `skip/take` (offset) kullanıyor. 100. sayfa = 2000 satır tarama, 1000. sayfa = 20000 satır tarama.

Yüksek hacim tablolarda (`Roll`, `RollMovement`, `RollOperation`, `SystemLog`, `TravelerCardScan`) cursor pagination şablonu:

```typescript
// İlk sayfa
const items = await prisma.roll.findMany({
  orderBy: { createdAt: "desc" },
  take: 20,
});
// Sonraki sayfa — son item'ın createdAt + id'sini cursor olarak kullan
const next = await prisma.roll.findMany({
  cursor: { id: lastId },
  skip: 1, // cursor item'ını atla
  take: 20,
  orderBy: { createdAt: "desc" },
});
```

Tek-kolon `orderBy` için yeterli; çok-kolon sırada `(createdAt, id) > (?, ?)` raw query gerekebilir.

> **GERÇEK İMPLEMENTASYON (2026-06-12):** Üstteki basit Prisma-cursor şablonu tarihsel — canlı kod `utils/cursor.ts` + `BaseService.findAllCursor` kullanır ve sözleşmesi daha zengindir:
> - **Token opak base64url, ÜÇ format bir arada:** (1) legacy `ISO__uuid`; (2) dinamik v2 `JSON {v, id, t}` — `t` tip etiketi (s/n/d/b) decode'da tahmin yerine kullanılır (tamamen rakamsal ürün kodu number'a çevrilip 2. sayfada 400 vermesin); etiketsiz eski token'lar coerce fallback'iyle çalışmaya devam eder; (3) ilişki/aggregate sıralamada keyset imkânsız → offset-encoded `o__N`.
> - **Null-aware keyset:** nullable kolonda `sortNullable=true` + `orderBy nulls:'last'` BİRLİKTE; non-null faza `OR {field: null}` dalı eklenir — yoksa null kuyruğu sessizce düşer.
> - **Sayfa deseni:** `take = limit + 1` → hasMore → `buildNextCursor`. Token formatını DEĞİŞTİRME — eski istemci token'ları kırılır.

### 9.6 JSON Alan Sorguları → GIN Index

Schema'da Json alanları: `WorkOrder.parameters`, `WorkOrderStep.stepData`, `RollOperation.metadata`, `MachineLog.details`, `SystemLog.oldData/newData`, `Manifest.snapshot`, `TravelerCard.snapshot`, `PrintedDocument.snapshot`.

Eğer içinde sorgulanmıyorsa (yalnızca okunuyor) — index gerekmez.  
Eğer sorgulanacaksa raw migration ile GIN index:

```sql
CREATE INDEX work_orders_parameters_gin
  ON work_orders USING GIN (parameters);
-- Containment query:
SELECT * FROM work_orders WHERE parameters @> '{"dyeRecipe": "R-123"}';
```

### 9.7 N+1 Önleme — `include` ve `select`

```typescript
// ✗ N+1 — her order için ayrı query
const orders = await prisma.order.findMany();
for (const o of orders) {
  const lines = await prisma.orderLine.findMany({ where: { orderId: o.id } });
}

// ✓ Tek query, ilişkiyi include et
const orders = await prisma.order.findMany({
  include: { lines: true },
});

// ✓✓ Daha iyi — sadece ihtiyaç duyulan alanları select et (overshoot azalır)
const orders = await prisma.order.findMany({
  select: {
    id: true,
    orderNumber: true,
    lines: { select: { id: true, quantity: true } },
  },
});
```

### 9.8 Karmaşık Aggregation → Raw SQL

Prisma'nın `aggregate`, `groupBy` API'si bazı durumlarda yetersiz veya çoklu round-trip yaratıyor. Karmaşık raporlar için:

```typescript
const result = await prisma.$queryRaw`
  SELECT customer_id, COUNT(*) as count, SUM(quantity) as total
  FROM order_lines
  GROUP BY customer_id
  ORDER BY total DESC
`;
```

### 9.9 EXPLAIN ile Doğrulama

Yeni endpoint'in büyük tabloya değdiği yerde:

```sql
EXPLAIN ANALYZE SELECT * FROM rolls WHERE status = 'STOCK' ORDER BY "createdAt" DESC LIMIT 20;
```

`Seq Scan` görürsen index eksik. `Index Scan` veya `Index Only Scan` → tamam.

### 9.10 Toplu Insert için `createMany`

100+ satır eklerken tek tek `create` yapma — `createMany` 10-50x hızlıdır:

```typescript
await prisma.rollOperation.createMany({
  data: rolls.map(r => ({ rollId: r.id, ... })),
  skipDuplicates: true, // @@unique varsa
});
```

`createMany` Postgres'te `INSERT ... VALUES (...), (...), ...` formuna çevrilir.

### 9.11 Transaction Süresi Kısa Tut

Uzun transaction = uzun lock süresi = deadlock riski.

```typescript
// ✗ Yavaş — HTTP çağrısı transaction içinde
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ ... });
  await fetch("https://external-api/...", { ... }); // ← LOCK uzar
});

// ✓ External work önce, sonra transaction
const externalData = await fetch("...");
await prisma.$transaction(async (tx) => {
  await tx.order.create({ data: { ..., externalData } });
});
```

---

## 10. Mevcut Şema İndeksleri (Audit)

Tüm hot-path tablolarında indeks durumu:

| Tablo | Doğrulanmış İndeksler |
|---|---|
| `rolls` | `itemId`, `colorId`, `status`, `parentRollId`, `parentReceiptId`, `currentStepId`, `producedInStepId`, `createdById`, **composite `[status, createdAt]`** |
| `roll_movements` | `rollId`, `workOrderStepId`, `enteredAt` |
| `roll_operations` | `@@unique([rollId, workOrderStepId, operationType])`, `rollId`, `workOrderStepId`, `operationType` |
| `roll_errors` | `rollId`, `detectedAtStepId`, `processedAtStepId`, `isProcessed`, `defectTypeId`, **composite `[rollId, isProcessed]`** |
| `work_order_steps` | `[workOrderId, stepSequence]`, `stationId`, **composite `[workOrderId, status]`** |
| `system_logs` | `userId`, `[tableName, recordId]`, **`[createdAt]`** |
| `traveler_card_scans` | `cardId`, `[stationId, scannedAt]`, `workOrderStepId` |
| `orders` | `customerId`, `branchId`, `status` |
| `work_orders` | `status`, `routeTemplateId`, `dyehouseCompanyId` |

### Aktif Partial / Conditional İndeksler (raw SQL migration)

| İndeks | Tablo | Koşul | Migration |
|---|---|---|---|
| `items_active_type_name_idx` | `items` | `WHERE "isActive" = true` üstüne `(itemType, name)` | `20260427150000_add_partial_active_indexes` |
| `customers_active_type_name_idx` | `customers` | `WHERE "isActive" = true` üstüne `(type, name)` | `20260427150000_add_partial_active_indexes` |
| `traveler_cards_workOrderId_active_key` | `traveler_cards` | `WHERE status = 'ACTIVE'` üstüne `workOrderId` (unique) | (mevcut) |
| `rolls` null-yoğun FK partial'ları (9 adet: `sackId`, `shipmentId`, `parentReceiptId`, `batchSplitId`...) | `rolls` | `WHERE col IS NOT NULL` | `20260606001717` → UUID geçişi sonrası `20260612100000_repartialize_after_native_uuid` |
| `work_order_steps` açık-kart kuyruğu | `work_order_steps` | `(stationId, status, isUrgent, priority, startedAt)` `WHERE status <> 'COMPLETED'` | `20260607010000` |
| `roll_movements_one_open_per_roll_step_uq` | `roll_movements` | partial **UNIQUE** `(rollId, workOrderStepId)` `WHERE "exitedAt" IS NULL` — **şema-DIŞI bilinçli** (Prisma partial unique desteklemez) | `20260612101000` |
| swatch/sack partial'ları | `swatches` / `sacks` | `WHERE "cancelledAt" IS NULL` vb. | `20260609120000` |

### Gelecekte Düşünülmesi Gerekenler

- `Order @@index([customerId, status])` — eğer "müşterinin açık siparişleri" sorgusu eklenirse
- `WorkOrder @@index([status, plannedEndDate])` — eğer "termin yaklaşan WO" raporu eklenirse
- `RollOperation` BRIN index (`createdAt` üzerinde) — milyon satıra ulaşınca
- `MachineLog`, `WorkOrder.parameters`, `RollOperation.metadata` için **GIN index** — JSON sütununa filtre uygulanmaya başlandığı anda (önce ekle, sonra endpoint yaz)

---

## 10.1 DB Runtime Safety (DB-level, manuel uygulanır)

Yıllarca yerel sunucuda çalışacak ERP'de tek bir kötü sorgu DB'yi kilitlememeli. **Bu ayarlar migration ile değil, doğrudan DB'ye `ALTER DATABASE` ile uygulanır** — `src/lib/prisma.ts` connection pool'unun comment'inde referans alınır (`statement_timeout: DB-level (30s)`).

| Ayar | Önerilen Değer | Amaç |
|---|---|---|
| `statement_timeout` | `30s` | Tek sorgu 30 saniyeyi aşarsa otomatik iptal — runaway query koruması |
| `idle_in_transaction_session_timeout` | `5min` | Açık kalmış transaction'lar tablo lock'ı tutmasın |
| `log_min_duration_statement` | `500ms` | 500ms+ süren her sorgu PostgreSQL log'una düşer |
| `log_lock_waits` | `on` | Lock beklemeleri loglansın (deadlock teşhisi) |
| `log_temp_files` | `10MB` | Disk'e dökülen büyük sıralama/JOIN'leri kaydet |
| `MAX_OFFSET` (kod) | `10000` | `skip > 10K` → 400 hatası, kullanıcıyı filtre kullanmaya zorlar (`query-parser.ts`) |

**Mevcut değeri görmek için:**
```sql
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('statement_timeout','idle_in_transaction_session_timeout',
               'log_min_duration_statement','log_lock_waits','log_temp_files');
```

**Yeni kurulum / DB taşıma sonrası uygulamak için:**
```sql
-- DB adı ortama göre: dev = adnansahin_db (.env), Windows production = TeksErpDb (installer).
-- Canlı dev değeri 50s (pg_db_role_setting, 2026-06-12 doğrulandı).
ALTER DATABASE "TeksErpDb" SET statement_timeout = '50s';
ALTER DATABASE "TeksErpDb" SET idle_in_transaction_session_timeout = '5min';
ALTER DATABASE "TeksErpDb" SET log_min_duration_statement = '500ms';
ALTER DATABASE "TeksErpDb" SET log_lock_waits = 'on';
ALTER DATABASE "TeksErpDb" SET log_temp_files = '10MB';
-- Session düzeyi için tekrar bağlan veya pg_reload_conf() çağır.
```

---

## 10.2 Çeyreklik DB Sağlık Kontrolü

Her **3 ayda bir** admin tarafından çalıştırılır. Çıktıları operasyon defterine kaydedilir.

### A. Tablo boyutu ve büyüme hızı
```sql
SELECT
  schemaname || '.' || relname AS table,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS data_size,
  n_live_tup AS rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;
```

### B. SystemLog büyüme + arşivleme tetikleyicisi
```sql
SELECT
  COUNT(*) AS active_rows,
  MIN("createdAt") AS oldest,
  MAX("createdAt") AS newest
FROM system_logs;
```
> Eğer `oldest > 6 ay öncesi` → `POST /api/admin/system-logs/archive { "monthsToKeep": 6 }` çağır.

### C. Kullanılmayan index'leri tespit et (yer kaplıyor, INSERT yavaşlatıyor)
```sql
SELECT schemaname, relname, indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan AS scans
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### D. Seq scan oranı yüksek tablolar (eksik index sinyali)
```sql
SELECT relname, seq_scan, idx_scan,
       seq_tup_read, idx_tup_fetch,
       CASE WHEN seq_scan + idx_scan = 0 THEN 0
            ELSE seq_scan::float / (seq_scan + idx_scan) END AS seq_ratio
FROM pg_stat_user_tables
WHERE seq_scan > 1000
ORDER BY seq_ratio DESC
LIMIT 10;
```

### E. Index bloat — yıllar içinde şişer, REINDEX gerekir
```sql
-- Yılda bir kez (düşük yoğunluk saatinde):
REINDEX TABLE CONCURRENTLY rolls;
REINDEX TABLE CONCURRENTLY system_logs;
REINDEX TABLE CONCURRENTLY roll_movements;
REINDEX TABLE CONCURRENTLY roll_operations;
REINDEX TABLE CONCURRENTLY traveler_card_scans;
```

### F. PostgreSQL log dosyasında 500ms+ sorgular
```bash
# Linux yerel sunucu (örn. /var/log/postgresql/):
grep "duration:" /var/log/postgresql/postgresql-*.log \
  | sort -t: -k2 -n -r | head -20
```

---

## 10.3 Single-process Invariant (load-bearing)

Backend **tek Express process** olarak çalışır (`server.ts` tek `app.listen`;
cluster / PM2-cluster / worker_threads **yok**). Bu, LAN-only tek-sunucu kurulumda
**kasıtlı** bir varsayımdır ve şu bellek-içi mekanizmalar buna bağlıdır:

| Mekanizma | Dosya | 2. worker/replica'da ne bozulur |
|---|---|---|
| Presence ("şu an online") | `lib/presence.ts` | Her process kendi `Map`'i → toplam sayım parçalanır |
| Feature-flag agregat cache (30sn TTL) | `system-setting.service.ts` | `invalidate` process-local → diğer process bayat flag servis eder |
| Audit arşiv scheduler (lastRun check-then-act) | `jobs/archive-scheduler.ts` | İki scheduler yarışır → çift-arşiv (kod yorumunda not var) |
| JWT iptal (`tokenVersion`) | `auth.middleware.ts` | Etkilenmez — DB-backed (process'ler arası tutarlı) |

**Yatay ölçeklenirse** taşıma katmanı gerekir: presence + feature-flag cache →
Redis (pub/sub invalidation); archive-scheduler → DB advisory lock veya tek ayrı
worker. Bu kuyruk dökümante edilmiştir; kod-içi zorlama YOKTUR (YAGNI) — ikinci
worker ekleyen kişi bu tabloyu görmeli.

---

## 11. Ortam Değişkenleri

| Var | Açıklama | Örnek |
|---|---|---|
| `PORT` | Sunucu portu | `4000` |
| `DATABASE_URL` | PostgreSQL bağlantı | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | JWT imzalama anahtarı | `supersecret_key` |

---

## 12. Çalıştırma Komutları

```bash
npm run dev                  # nodemon + ts-node (server.ts)
npm run build                # tsc compile
npm run seed                 # Test verisi yükle
npm run prisma:generate      # Şema değişikliği sonrası ZORUNLU
npm run prisma:migrate       # migrate deploy (production)
npx prisma migrate dev       # Yeni migration oluştur (development)
npm run prisma:studio        # DB GUI
npm run lint                 # ESLint
npx tsc --noEmit             # Type-check (build'siz)
```

---

## 13. Test Kullanıcıları (Seed)

| Username | Şifre | Yetkiler |
|---|---|---|
| `admin` | `123123` | ✅ TÜM 55 permission (seed §4) |

> **2026-07-03:** Seed'de YALNIZ `admin` var. Eski ek test kullanıcıları (mehmet.planlama, ali.operator, ...) KALDIRILDI — her reseed'de tek tek silinmeleri gerekiyordu. Yeni kullanıcılar admin panelinden (`POST /api/admin/users`) açılır; yeni kullanıcı varsayılan olarak üretim istasyon izinlerini (KK1/KK2/Tambur) + mobil kimlik (hızlı PIN + QR kart) alır (opt-out'lu). 0-izinli RBAC testleri kendi geçici kullanıcısını üretip temizler.

### Seed Sonrası Yüklü Master Data

`npm run seed` test ortamı için aşağıdaki demo veriyi de yükler (production'a girmemeli):

| Kategori | Adet | İçerik |
|---|---|---|
| Müşteri | 4 | Arda Tekstil, Moda Konfeksiyon, Beyaz Giyim, Yeşil Tekstil |
| Müşteri Şubesi | 3 | ARDA (İstanbul Merkez + Ankara), Moda Konfeksiyon (İzmir Merkez) |
| Customer-Item alias | 4 | Patos → Soft Patos / Premium Pamuk / Klasik Patos / Eco Patos |
| Customer-Color alias | 3 | MAVI=Royal Blue, LACIVERT=Navy, BEYAZ=Saf Beyaz |
| Renk | 6 | Beyaz, Siyah, Lacivert, Kırmızı, Mavi, Bej |
| Kumaş Özelliği | 7 | Antibakteriyel, Su Geçirmez, Yanmaz, Elastik, Zımparalı, Parlak, **Kurşunlu** |
| Fason Kategori | 2 | **BOYA** (Boyahane — `appliesColor=true, appliesProperty=true`), **ZIMPARA** (Zımpara — yalnız `appliesProperty=true`) |
| Fason Firma | 2 | **BOYER** (Boyer Boyacılık → BOYA), **KESTEL** (Kestel Zımpara → ZIMPARA) |
| İstasyon | 5 | **KK1_1** (RAW_QC, entry-only `allowAsWorkOrderStep=false`), Kurşun+KK2 (PROCESS_QC), Tambur (TAMBUR), Boya Fason, Zımpara Fason |
| Makine | 3 | KK1-M1 (tablet pair için), KK2-M1, TAMBUR-M1 |
| İstasyon yeteneği | 6 renk + 7 özellik | Boya = 6 renk + 5 özellik · Kurşun = KURSUN · Zımpara = ZIMPARALI · Tambur = yok |
| Hata tipi | 2 | YIRTIK (MAJOR), LEKE (MINOR) |
| Rota şablonu | 3 (9 step) | "Standart Boyama" (generic), "Boya + Zımpara" (generic), "ARDA — Hızlı" (ARDA-özel) |
| Ürün | 1 | **Patos** (FABRIC, tüm renk + özellik izinli) |
| Label template | 2 | ROLL default, SWATCH default |
| Kalite Sınıfı | 3 | 1.KALITE, A1, FIRE |

---

## 14. Sık Yapılan Hatalar Kontrol Listesi

- [ ] `prisma generate` çalıştırıldı mı? (şema değiştiyse zorunlu)
- [ ] Yeni FK için `@@index([fkColumn])` eklendi mi?
- [ ] `app.ts`'e route eklendi mi?
- [ ] Swagger JSDoc yazıldı mı?
- [ ] Her CUD'de `AuditService.log()` çağrıldı mı?
- [ ] Fiziksel DELETE yerine `isActive: false` mı kullanıldı?
- [ ] Transaction içinde `Promise.all([tx.*])` yok mu?
- [ ] `any` type kullanılmadı mı?
- [ ] Zod `z.record()` iki arg ile mi çağrıldı?
- [ ] Yeni endpoint için RBAC permission kodu seçildi mi (seed'de tanımlı olduğu doğrulandı mı)?
