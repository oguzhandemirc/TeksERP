# Route Envanteri — GRUP B

**Kapsam:** 10 route dosyası (`src/routes/` altında), toplam **4.292 satır** (`wc -l` çıktısı).
**Toplam endpoint: 165** (aşağıdaki dosya bazlı sayımların toplamı; sayım yöntemi: satır başındaki
`router.` / `machineRouter.` / `workOrderTravelerRouter.` / `travelerCardRouter.` HTTP metod
çağrıları — `grep -c "^router\.\|^machineRouter\.\|^workOrderTravelerRouter\.\|^travelerCardRouter\."`).

| Dosya | Mount prefix (`src/app.ts`) | Endpoint |
|---|---|---|
| `shipping.routes.ts` | `/api/shipping` (app.ts:423) | 45 |
| `label-template.routes.ts` | `/api/label-templates` (app.ts:422) | 24 |
| `subcontractor.routes.ts` | `/api/subcontractor` (app.ts:410) | 22 |
| `order.routes.ts` | `/api/orders` (app.ts:402) | 16 |
| `station.routes.ts` | `/api/stations` (app.ts:396) **+** `/api/machines` (app.ts:397, `machineRouter` ayrı export) | 15 (7 + 8) |
| `kursun-qc.routes.ts` | `/api/kursun-qc` (app.ts:406) | 12 |
| `traveler-card.routes.ts` | `/api/traveler-cards` (app.ts:408) **+** `/api/work-orders/:id/traveler-cards` (`workorder.routes.ts:15` → `router.use("/:id/traveler-cards", workOrderTravelerRouter)`) | 10 (7 + 3) |
| `item.routes.ts` | `/api/items` (app.ts:393) | 9 |
| `kursun-bypass.routes.ts` | `/api/kursun-bypass` (app.ts:407) | 8 |
| `feature-flag.routes.ts` | `/api/feature-flags` (app.ts:430) | 4 |

**Auth tabanı:** 165 endpoint'in **165'i** `verifyToken` taşıyor (doğrulama: 10 dosyada
`grep -c verifyToken` = 175, eksi 10 import satırı = 165). `verifyToken` yalnız Bearer token'ı
doğrulamakla kalmıyor; `tokenVersion` + `Session.jti` revoke kontrolü de yapıyor
(`auth.middleware.ts:55-95`) — yani her istek en az 2 ek DB sorgusu koşuyor
(**denetim notu:** hot path maliyeti; bu envanterin konusu değil ama ölçülmeye değer).

**Wildcard semantiği** (`rbac.middleware.ts:22-34`): `*` her izni, `<domain>:*` tek seviyeli
domain iznini karşılar. Yani aşağıdaki tablolardaki her `admin:settings` guard'ı fiilen
`admin:*` ile de geçilir; her `mobile:...` guard'ı `mobile:*` ile de geçilir.

---

## 1. `order.routes.ts` → `/api/orders` (16 endpoint)

Servis: `OrderService` (`BaseService` alt sınıfı), controller: `BaseController` (4 uçta) +
**10 inline handler** (Zod parse + servise delege, `prisma` import'u yok).

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/orders/:id/manual-close` | verifyToken + requirePermission(`order:write`) | yazma (status → COMPLETED) | ŞÜPHELİ — servis `manualComplete` ikinci çağrıda muhtemelen 400 döner (Swagger: "zaten tamamlanmış"), **servis gövdesi okunmadı** | yok | inline → `OrderService.manualComplete` |
| 2 | POST | `/api/orders/:id/reopen` | verifyToken + requirePermission(`order:write`) | yazma (status geri) | ŞÜPHELİ — aynı gerekçe | yok | inline → `OrderService.reopen` |
| 3 | GET | `/api/orders/:id/cancel-preview` | verifyToken + requirePermission(`order:write`) | salt-okuma | evet | yok | inline → `OrderService.getCancelPreview` |
| 4 | GET | `/api/orders/:id/shipments` | verifyToken + requireAnyPermission(`order:read`, `shipping:read`, `shipping:write`) | salt-okuma | evet | yok | inline → `OrderService.getOrderShipments` |
| 5 | POST | `/api/orders/:id/cancel` | verifyToken + requirePermission(`order:write`) | **yıkıcı** — sipariş CANCELLED + per-WO aksiyon (UNLINK_ONLY / CONVERT_TO_STOCK / CANCEL_WO) | hayır (ikinci çağrı farklı durumla karşılaşır) | yok | inline → `OrderService.cancelWithActions` |
| 6 | GET | `/api/orders/` | verifyToken + requireAnyPermission(`order:read`, `mobile:siparis`) | salt-okuma | evet | — | `BaseController.findAll` → `OrderService` |
| 7 | GET | `/api/orders/wo-picker` | verifyToken + requireAnyPermission(`order:read`, `workorder:read`, `workorder:write`) | salt-okuma | evet | — | inline → `findAvailableForWorkOrder` |
| 8 | GET | `/api/orders/order-lines/available` | verifyToken + requireAnyPermission(`order:read`, `quality:write`, `mobile:tambur`, `mobile:tarti-paket`, `mobile:hizli-is-emri`) | salt-okuma | evet | — | inline → `findAvailableOrderLines` |
| 9 | POST | `/api/orders/order-lines/coverage` | verifyToken + requireAnyPermission(`order:read`, `workorder:read`, `workorder:write`) | salt-okuma (POST ama okuma ucu) | evet | — | inline → `getCoverageForLines` |
| 10 | GET | `/api/orders/spec-availability` | verifyToken + requireAnyPermission(`order:read`, `order:write`, `workorder:read`, `mobile:siparis`) | salt-okuma | evet | — | inline → `getSpecAvailability` |
| 11 | GET | `/api/orders/:id` | verifyToken + requirePermission(`order:read`) | salt-okuma | evet | — | `BaseController.findById` |
| 12 | POST | `/api/orders/` | verifyToken + requireAnyPermission(`order:write`, `mobile:siparis`) | yazma (Order + lines) | evet — **yalnız token verilirse**; `order.service.ts:1565-1620` P2002 → `resolveCreateTokenReplay` | **evet, OPSİYONEL** (`Order.clientToken @unique`, schema:1386) | `BaseController.create` → `OrderService.create` |
| 13 | POST | `/api/orders/quick-from-rolls` | verifyToken + requireAnyPermission(`order:write`, `mobile:hizli-is-emri`, `mobile:tarti-paket`) | yazma (Order + top statüsü STOCK→WAREHOUSE) | evet | **evet, ZORUNLU** (route Zod'unda `.uuid()`, opsiyonel değil) | inline → `quickOrderFromRolls` |
| 14 | PATCH | `/api/orders/:id` | verifyToken + requirePermission(`order:write`) | yazma (header + kalem diff: update/create/delete) | ŞÜPHELİ — aynı gövdenin tekrarı aynı sonucu üretiyor görünüyor ama kalem diff'i `id` eşleşmesine dayanıyor; **servis doğrulanmadı** | yok | `BaseController.update` |
| 15 | DELETE | `/api/orders/:id` | verifyToken + requirePermission(`order:write`) | **yıkıcı** (soft — status CANCELLED) | ŞÜPHELİ | yok | `BaseController.remove` |
| 16 | DELETE | `/api/orders/:id/permanent` | verifyToken + requirePermission(`order:write`) | **YIKICI — fiziksel DELETE** (sipariş + kalemleri) | hayır (2. çağrı 404) | yok | `BaseController.hardRemove` |

**Denetim işaretleri (bulgu değil, bakılacak yer):**
- (#16) Kalıcı silme `order:write` ile açık — **aynı izin** normal kayıt/güncelleme için de
  yeterli. Root CLAUDE.md "yalnız soft delete; istisna = bağımlılık-guard'lı master-data
  `/permanent`" diyor; sipariş master-data değil bir işlem kaydıdır. `BaseController.hardRemove`
  yolunda hangi bağımlılık guard'larının koştuğu **doğrulanmadı**.
- (#3, #5) Okuma ucu `cancel-preview` `order:write` istiyor (bilinçli olabilir), buna karşılık
  (#8) yazma izniyle (`quality:write`) bir OKUMA ucu açılıyor — izin kümelerinin
  "okuma/yazma" ekseni burada tutarlı değil.
- (#12/#13) `clientToken` biri opsiyonel biri zorunlu; opsiyonel olan yolda replay koruması
  **istemcinin token göndermesine bağlı**.

---

## 2. `subcontractor.routes.ts` → `/api/subcontractor` (22 endpoint)

Controller: `SubcontractorController` → `SubcontractorService`. Route dosyasında iş mantığı YOK
(hepsi controller'a delege). Ortak sabit: `MOBILE_FASON_READ = ["mobile:fason-sevk", "mobile:fason-kabul"]`.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/subcontractor/dispatch` | verifyToken + any(`workorder:write`, `mobile:fason-sevk`) | yazma + **belge dondurma** (fason çeki `PrintedDocument`) + top → AT_SUBCONTRACTOR | hayır — her çağrı yeni irsaliye | **yok** | `.dispatch` |
| 2 | POST | `/api/subcontractor/dispatch/bulk` | verifyToken + any(`workorder:write`, `subcontractor:write`) | yazma (tekil dispatch'e delege) | hayır | yok | `.bulkDispatch` |
| 3 | POST | `/api/subcontractor/transfer-next` | verifyToken + any(`workorder:write`, `subcontractor:write`) | yazma (kabul + sonraki fasona sevk zinciri) | hayır | yok | `.transferToNextFason` |
| 4 | GET | `/api/subcontractor/fason-ceki-draft` | verifyToken + any(`workorder:read`, `subcontractor:read`) | salt-okuma (TASLAK HTML) | evet | — | `.fasonCekiDraft` |
| 5 | PATCH | `/api/subcontractor/dispatches/:id/instruction` | verifyToken + any(`workorder:write`, `mobile:fason-sevk`) | yazma (canlı kolon) | evet (set semantiği) | yok | `.updateInstruction` |
| 6 | POST | `/api/subcontractor/receive` | verifyToken + any(`workorder:write`, `mobile:fason-kabul`) | yazma — **yeni Roll doğurur** + orijinaller SUBCONTRACTOR_CONSUMED | hayır | **yok** | `.receive` |
| 7 | GET | `/api/subcontractor/pending-returns` | verifyToken + any(`workorder:read`, ...MOBILE_FASON_READ) | salt-okuma | evet | — | `.pendingReturns` |
| 8 | GET | `/api/subcontractor/pending-returns/step/:stepId` | aynı | salt-okuma | evet | — | `.pendingReturnDetail` |
| 9 | GET | `/api/subcontractor/dispatches` | aynı | salt-okuma | evet | — | `.listDispatches` |
| 10 | GET | `/api/subcontractor/dispatches/:id` | aynı | salt-okuma | evet | — | `.getDispatch` |
| 11 | GET | `/api/subcontractor/dispatches/:id/dye-overlay` | aynı | salt-okuma | evet | — | `.getDispatchDyeOverlay` |
| 12 | POST | `/api/subcontractor/dispatches/:id/cancel` | verifyToken + any(`workorder:write`, `mobile:fason-sevk`) | **yıkıcı** (soft cancel + toplar STOCK'a) | hayır (2. çağrı 409) | yok | `.cancelDispatch` |
| 13 | POST | `/api/subcontractor/dispatches/cancel-bulk` | aynı | **yıkıcı**, **sonuç PARÇALI** (tx başına ayrı, `failed[]`), max 50 | hayır | yok | `.cancelDispatchBulk` |
| 14 | GET | `/api/subcontractor/dispatches/:id/direct-ship-preview` | verifyToken + any(`workorder:write`, `mobile:fason-sevk`) | salt-okuma | evet | — | `.getDirectShipPreview` |
| 15 | POST | `/api/subcontractor/dispatches/:id/direct-ship` | aynı | yazma + **yıkıcı** (WO kapanır, sevk belgesi doğar) | hayır (409) | yok | `.directShip` |
| 16 | GET | `/api/subcontractor/dispatches/:id/undo-transfer-preview` | verifyToken + any(`workorder:write`, `subcontractor:write`) | salt-okuma | evet | — | `.getUndoTransferPreview` |
| 17 | POST | `/api/subcontractor/dispatches/:id/undo-transfer` | aynı | **yıkıcı** (sevk + kaynak kabul iptal, mal geri) | hayır (409) | yok | `.undoTransfer` |
| 18 | GET | `/api/subcontractor/receipts` | verifyToken + any(`workorder:read`, ...MOBILE_FASON_READ) | salt-okuma | evet | — | `.listReceipts` |
| 19 | GET | `/api/subcontractor/receipts/:id/print` | aynı | salt-okuma — **doğrulandı**: `getReceiptPrintSnapshot` (`subcontractor.service.ts:4781`) yalnız `findUnique` + map, freeze/lazy-init YOK | evet | — | `.getReceiptPrint` |
| 20 | GET | `/api/subcontractor/receipts/:id` | aynı | salt-okuma | evet | — | `.getReceipt` |
| 21 | POST | `/api/subcontractor/receipts/:id/cancel` | verifyToken + any(`workorder:write`, `mobile:fason-kabul`) | **yıkıcı** (kabul iptali; doğan Roll'lar CANCELLED, orijinaller geri) | hayır (409) | yok | `.cancelReceipt` |
| 22 | GET | `/api/subcontractor/receipts/:id/cancel-preview` | aynı | salt-okuma | evet | — | `.getCancelPreview` |

**Denetim işaretleri:**
- (#1, #6) İkisi de **yeni kalıcı kayıt doğuran** (irsaliye / yeni Roll) uçlar ve **hiçbirinde
  `clientToken` yok**. Root CLAUDE.md idempotency kuralı "kayıt-yaratan uçlar istemci
  `clientToken` taşır" diyor; fason sevk/kabul bu kuralın dışında. Mobil (`mobile:fason-sevk`,
  `mobile:fason-kabul`) çevrimdışı kuyruk taşıyorsa timeout-replay riski **bakılmaya değer**.
- (#14, #16, #22) Salt-okunur önizlemeler **yazma** izniyle kapılı — bilinçli olabilir
  (`shipping.routes` UNDO_DISPATCH aynı gerekçeyi yazıyor) ama burada gerekçe kodda yazılı değil.
- (#13) Parçalı sonuç sözleşmesi (`failed[]`) — istemcinin bunu gösterip göstermediği
  bu envanterin dışında.

---

## 3. `feature-flag.routes.ts` → `/api/feature-flags` (4 endpoint)

**Controller YOK** — dört uç da route içinde inline (Zod parse + `systemSettingService`).
Bu, `Teks-Erp/CLAUDE.md`'de yazılı "ince read/ayar endpoint'leri controller'sız olabilir"
istisnasının kapsamında.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/feature-flags/` | **verifyToken (permission guard YOK)** | salt-okuma | evet | — | inline → `systemSettingService.getFeatureFlags` |
| 2 | PATCH | `/api/feature-flags/` | verifyToken + **`flagWriteGuard`** (aşağıda) | yazma (sistem ayarları) | evet (set semantiği; verilmeyen alan dokunulmaz) | yok | inline → `systemSettingService.setFeatureFlags` |
| 3 | GET | `/api/feature-flags/documents-logo` | **verifyToken (permission guard YOK)** | salt-okuma | evet | — | inline → `systemSettingService.getDocumentsLogo` |
| 4 | PUT | `/api/feature-flags/documents-logo` | verifyToken + requirePermission(`admin:settings`) | yazma (logo kütüphanesi, append-only) | evet | yok | inline → `systemSettingService.setDocumentsLogo` |

### 3.1 `flagWriteGuard` — anahtar-kapsamlı yetki kapısı (`feature-flag.routes.ts:38-46`)

```
const keys = Object.keys((req.body ?? {}) as Record<string, unknown>);
const onlyDocumentKeys = keys.length > 0 && keys.every((k) => DOCUMENT_DESIGN_FLAG_KEYS.has(k));
const guard = onlyDocumentKeys
  ? requireAnyPermission(...DOCUMENT_DESIGN_WRITE)   // ["admin:settings", "document-template:write"]
  : requirePermission("admin:settings");
guard(req, res, next);
```

**Kural:** guard, PATCH gövdesinin **anahtar ADLARINA** bakar (değerlerine değil) ve iki yoldan
birini seçer.

| Gövde | Karar | Gereken izin |
|---|---|---|
| Yalnız `documentsConfig` ve/veya `travelerCardConfig` | dar yol | `admin:settings` **VEYA** `document-template:write` |
| Yukarıdakilere ek olarak **tek bir** başka anahtar (örn. `pricingEnabled`, `backupHour`, `kk1DuplicateGuardEnabled`) | geniş yol | `admin:settings` |
| **Boş gövde** (`{}`) → `keys.length > 0` false | geniş yol | `admin:settings` |
| `req.body` undefined (JSON olmayan Content-Type) → `{}` | geniş yol | `admin:settings` |
| `__proto__` gibi tuhaf anahtarlar → `DOCUMENT_DESIGN_FLAG_KEYS.has()` false | geniş yol | `admin:settings` |

**Anahtar kümesinin tek kaynağı:** `src/constants/document-design.ts` →
`DOCUMENT_DESIGN_FLAG_KEYS = new Set(["documentsConfig", "travelerCardConfig"])`.
Küme **bilinçli olarak dar**: `companyName`, `companyLetterhead` ve belge logosu (uç #4) dışarıda
bırakılmış — dosyadaki gerekçe: "firmanın KİMLİĞİDİR, şablon değil".

**Sıra sözleşmesi (load-bearing):** guard, Zod `strictObject` doğrulamasından **ÖNCE** koşar.
Yani guard yalnız anahtar adlarına bakar; tanınmayan anahtar önce geniş yola düşürür, sonra
Zod 400 verir. Fail-closed yön doğru.

**Denetimde bakılacak noktalar:**
- Guard `Object.keys` ile çalıştığı için **prototype-pollution benzeri anahtarlar geniş yola
  düşer** (fail-closed, doğru yön) — ama `documentsConfig` şeması route'ta
  `z.record(z.string(), z.any())` yani **iç doğrulama tümüyle servise
  (`sanitizeDocumentsConfig`) devredilmiş**. Dar izinli kullanıcı bu anahtarın İÇİNE ne
  yazabilir sorusunun cevabı bu dosyada yok.
- `travelerCardConfig` şeması `z.object` (strict değil) → iç anahtar sessizce atılabilir;
  dosyanın kendi yorumu bu tuzağı `fields` alanı için anlatıyor (satır 276-287).
- **Uç #1 ve #3 permission guard'sız** (aşağıdaki §11'de topluca).

---

## 4. `kursun-qc.routes.ts` → `/api/kursun-qc` (12 endpoint)

Controller: `KursunQcController` → `KursunQcService` (+ `helpers/work-session.helper.getStampContext`).
Route dosyasında iş mantığı YOK.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/kursun-qc/by-card/:barcode` | verifyToken + any(`quality:read`, `mobile:kk2-kursun`) | salt-okuma | evet | — | `.getByCardBarcode` |
| 2 | GET | `/api/kursun-qc/step/:stepId` | aynı | salt-okuma | evet | — | `.getStep` |
| 3 | GET | `/api/kursun-qc/open-cards` | aynı | salt-okuma (tablet 5 sn'de bir yokluyor) | evet | — | `.listOpenCards` |
| 4 | POST | `/api/kursun-qc/complete-qc2` | verifyToken + any(`quality:write`, `mobile:kk2-kursun`) | yazma (`RollOperation` + `RollProperty` kopyalama) | **evet** — `kursun-qc.service.ts:379` "F283: Idempotency — op zaten varsa … " dalı doğrulandı | yok | `.completeQc2` |
| 5 | POST | `/api/kursun-qc/report-error` | aynı | yazma (`RollError`) | **evet — `clientErrorId` verilirse** (`kursun-qc.service.ts:498-604`: mevcut kaydı döner, P2002 yarışını da yakalar); verilmezse "aynı metrede aynı hata" 409'una düşer | **`clientErrorId`** (ayrı isim, `clientToken` DEĞİL; `RollError.id` olarak kullanılıyor) | `.reportError` |
| 6 | DELETE | `/api/kursun-qc/error` | aynı (gövdede `errorId`) | yıkıcı (kayıt silme) | **evet** — `kursun-qc.service.ts:642/660` "kayıt zaten yok → başarı" | yok | `.deleteError` |
| 7 | POST | `/api/kursun-qc/finish-step` | aynı | yazma (adım kapat + toplar sonraki adıma) | **evet** — `kursun-qc.service.ts:725-731` "Adım zaten kapalı (idempotent retry)" + 835 eşzamanlı dal | yok | `.finishStep` |
| 8 | POST | `/api/kursun-qc/reopen-step` | aynı | yazma (kapalı adımı geri açar, toplar geri çekilir) | hayır — `:982` "Bu adım zaten kapalı değil" | yok | `.reopenStep` |
| 9 | GET | `/api/kursun-qc/reopen-preview/:stepId` | verifyToken + any(`quality:read`, `mobile:kk2-kursun`) | salt-okuma | evet | — | `.reopenPreview` |
| 10 | GET | `/api/kursun-qc/queue` | verifyToken + any(`quality:read`, `mobile:kk2-kursun`, `workorder:distribute`, `mobile:kursun-dagitim`) | salt-okuma | evet | — | `.listQueue` |
| 11 | PATCH | `/api/kursun-qc/queue/reorder` | verifyToken + any(`quality:write`, `workorder:distribute`, `mobile:kursun-dagitim`) | yazma (`WorkOrderStep.priority` batch) | evet (set) | yok | `.reorderQueue` |
| 12 | PATCH | `/api/kursun-qc/queue/:stepId/urgent` | aynı | yazma (`isUrgent` + `urgentMarkedAt`) | ŞÜPHELİ — `isUrgent` set idempotent ama `urgentMarkedAt` her çağrıda tazeleniyorsa sıralama değişir; **servis doğrulanmadı** | yok | `.setQueueUrgent` |

**Denetim işaretleri:**
- (#5) İdempotency anahtarı burada `clientErrorId` — projedeki `clientToken` sözleşmesinden
  **AYRI bir isim ve AYRI bir mekanizma** (token ayrı kolon değil, doğrudan PK olarak yazılıyor).
  İki desenin bir arada yaşaması denetimde ayrıca bakılmalı.
- (#11/#12) 2026-08-05'te izin kümesi genişletilmiş (`quality:write` → + `workorder:distribute`
  + `mobile:kursun-dagitim`). Genişleme gerekçeli yazılmış; **bu iki uç aynı alana
  (`WorkOrderStep.priority`) yazan iki farklı sıralama yüzeyi** (bekleyen kuyruk + makine içi) —
  kesişme kuralı kodda değil, kök CLAUDE.md notunda anlatılıyor.
- (#3) `open-cards` 5 sn'de bir yoklanıyor (dosya yorumu) → auth middleware'in 2 ek DB
  sorgusu bu uçta çarpan etkisi yapar.

---

## 5. `station.routes.ts` → `/api/stations` + `/api/machines` (15 endpoint)

İki `Router` tek dosyada. Servis: iki ayrı `BaseService` örneği (`station`, `machine`) +
`services/helpers/guarded-hard-remove` + `WorkSessionService`.

### 5.1 `/api/stations` (7)

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/stations/` | verifyToken + requirePermission(`station:read`) | salt-okuma | evet | — | `BaseController.findAll` (station) |
| 2 | GET | `/api/stations/machines` | verifyToken + requirePermission(`station:read`) | salt-okuma | evet | — | `BaseController.findAll` (machine) |
| 3 | GET | `/api/stations/:id` | verifyToken + requirePermission(`station:read`) | salt-okuma | evet | — | `BaseController.findById` |
| 4 | POST | `/api/stations/` | verifyToken + requirePermission(`station:write`) | yazma (kod `IST+GGAAYY+NNNN` backend-authoritative) | hayır | yok | `BaseController.create` |
| 5 | PATCH | `/api/stations/:id` | verifyToken + requirePermission(`station:write`) | yazma | evet (set) | yok | `BaseController.update` |
| 6 | DELETE | `/api/stations/:id` | verifyToken + requirePermission(`station:write`) | yıkıcı (soft — `isActive=false`) | evet | yok | `BaseController.remove` |
| 7 | DELETE | `/api/stations/:id/permanent` | verifyToken + requirePermission(`station:write`) | **YIKICI — fiziksel DELETE**, bağımlılık guard'lı | hayır (404) | yok | **`stationHardRemove`** — `services/helpers/guarded-hard-remove.ts:106`, **controller'sız: servis-katmanı fonksiyonu doğrudan Express handler olarak bağlanmış** |

### 5.2 `/api/machines` (8)

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 8 | GET | `/api/machines/` | verifyToken + requirePermission(`station:read`) | salt-okuma | evet | — | `BaseController.findAll` (machine) |
| 9 | GET | `/api/machines/resolve?code=` | verifyToken + requireAnyPermission(`station:read`, `mobile:kk1`, `mobile:kk2-kursun`, `mobile:tambur`, `mobile:tarti-paket`) — son dördü `MOBILE_SESSION_PERMS` (`work-session.service.ts:46-51`) | salt-okuma (QR → makine) | evet | — | **inline handler** → `WorkSessionService.resolveMachineByCode` |
| 10 | GET | `/api/machines/:id` | verifyToken + requirePermission(`station:read`) | salt-okuma | evet | — | `BaseController.findById` |
| 11 | GET | `/api/machines/:id/delete-preview` | verifyToken + requirePermission(`station:write`) | salt-okuma | evet | — | **`machineDeletePreview`** (guarded-hard-remove helper, controller'sız) |
| 12 | POST | `/api/machines/` | verifyToken + requirePermission(`station:write`) | yazma (kod `MAK+GGAAYY+NNNN`) | hayır | yok | `BaseController.create` |
| 13 | PATCH | `/api/machines/:id` | verifyToken + requirePermission(`station:write`) | yazma | evet (set) | yok | `BaseController.update` |
| 14 | DELETE | `/api/machines/:id` | verifyToken + requirePermission(`station:write`) | yıkıcı (soft) | evet | yok | `BaseController.remove` |
| 15 | DELETE | `/api/machines/:id/permanent` | verifyToken + requirePermission(`station:write`) | **YIKICI — fiziksel DELETE** (+ tx içinde `WorkSession` satırları temizlenir), bağımlılık guard'lı | hayır (404) | yok | **`machineHardRemove`** (guarded-hard-remove helper, controller'sız) |

**Denetim işaretleri:**
- (#7, #11, #15) Üç uçta **route → services/helpers doğrudan**; controller katmanı atlanmış.
  Helper dosyası `prisma`'yı kendisi import ediyor (`guarded-hard-remove.ts:16`) ve dosyanın
  kendi yorumu bunu "route katmanında prisma import'u yasak" kuralına uyum olarak açıklıyor
  (satır 96). Katman kuralının bu yorumu denetimde teyit edilmeli.
- (#7) İstasyon kalıcı silme guard listesi 10+ tablo sayıyor (`workOrderStep`, `routeStep`,
  `travelerCardScan`, `rollMovement`, `device`, `rollOperation`, `roll.createdMachine`,
  `roll.entryStationId`, `peripheralDevice`…). Liste **elle tutulan bir allowlist**; yeni FK
  eklendiğinde güncellenmezse guard sessizce eksik kalır. Mekanik bekçisi olup olmadığı
  **doğrulanmadı**.
- (#2 vs #8) Aynı makine listesi **iki farklı path'ten** servis ediliyor
  (`/api/stations/machines` ve `/api/machines/`) — aynı controller, aynı izin.

---

## 6. `item.routes.ts` → `/api/items` (9 endpoint)

Servis: `ItemService` (`BaseService` alt sınıfı), controller `BaseController` (6 uçta) +
**3 inline handler**.

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/items/` | verifyToken + any(`item:read`, `mobile:kk1`, `mobile:siparis`, `mobile:kumas`) | salt-okuma | evet | — | `BaseController.findAll` |
| 2 | GET | `/api/items/:id` | verifyToken + any(`item:read`, `mobile:kk1`) | salt-okuma | evet | — | `BaseController.findById` |
| 3 | POST | `/api/items/` | verifyToken + any(`item:write`, `mobile:kumas`) | yazma (kod `STK-NNNNNN` otomatik) | hayır | **yok** (`Item.clientToken` şemada YOK) | `BaseController.create` → `ItemService.create` |
| 4 | POST | `/api/items/quick-create` | verifyToken + **requirePermission(`mobile:kk1-desen`)** — tek izin, `item:write` KABUL EDİLMEZ | yazma (FABRIC + `pendingReview=true`) | hayır — ad-dup guard'ı 409 verir | yok | **inline** → `ItemService.quickCreateFabric` |
| 5 | PATCH | `/api/items/:id` | verifyToken + requirePermission(`item:write`) | yazma | evet (set) | yok | `BaseController.update` |
| 6 | DELETE | `/api/items/:id` | verifyToken + requirePermission(`item:write`) | yıkıcı (soft) | evet | yok | `BaseController.remove` |
| 7 | DELETE | `/api/items/:id/permanent` | verifyToken + requirePermission(`item:write`) | **YIKICI — fiziksel DELETE** | hayır (404) | yok | `BaseController.hardRemove` |
| 8 | POST | `/api/items/:id/allowed-colors` | verifyToken + requirePermission(`item:write`) | yazma (pivot ekle) | **evet** (Swagger: "Mevcut ise idempotent") | yok | **inline** → `ItemService.addAllowedColor` |
| 9 | POST | `/api/items/:id/allowed-properties` | verifyToken + requirePermission(`item:write`) | yazma (pivot ekle) | **evet** | yok | **inline** → `ItemService.addAllowedProperty` |

**Denetim işaretleri:**
- (#4) `quick-create` **tek izinle** kapılı: `item:write` taşıyan masaüstü admini bu ucu
  ÇAĞIRAMAZ. Bilinçli daraltma olabilir ama `requirePermission` (OR değil) kullanımı bu
  dosyadaki tek istisna — mobil-özel bir uç sadece mobil izniyle açık.
- (#3, #8, #9) `:id` path parametresi `assertValidUuid` ile doğrulanmıyor
  (`String(req.params.id)` düz cast, satır 289/336) — order.routes'ta aynı ihtiyaç için
  `assertValidUuid` kullanılıyor. Geçersiz uuid'de Prisma P2007/500 riski
  (kök CLAUDE.md "filtre çoklu seçim" notundaki arıza modu ①) **denetimde ölçülmeli**.

---

## 7. `shipping.routes.ts` → `/api/shipping` (45 endpoint)

Controller: `ShippingController` → `ShippingService` + `sackSearchService` +
`accounting-export.service.buildDispatchAccountingExport`. Route dosyasında iş mantığı YOK.

**Ortak guard sabitleri (satır 9-23):**

| Sabit | İzin kümesi |
|---|---|
| `READ` | any(`shipping:read`, `shipping:write`, `mobile:tarti-paket`, `mobile:sevkiyat`) |
| `WRITE` | any(`shipping:write`, `mobile:tarti-paket`, `mobile:sevkiyat`) |
| `ACCOUNTING_READ` | any(`shipping:read`, `shipping:write`, `report:sales`) |
| `INVOICE_WRITE` | any(`shipping:invoice`, `shipping:write`) |
| `UNDO_DISPATCH` | any(`shipping:undo-dispatch`) — **tek elemanlı**, `shipping:write` KAPSAMAZ |

| # | Metod | Path | Guard | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/open-orders` | READ | salt-okuma | evet | — | `.openOrders` |
| 2 | GET | `/pool` | READ | salt-okuma | evet | — | `.listPool` |
| 3 | GET | `/pool/sacks` | READ | salt-okuma | evet | — | `.listCustomerPoolSacks` |
| 4 | POST | `/sacks` | WRITE | yazma (yeni `Sack`) | **evet** — `shipping.service.ts:209-291` `readOpenSackReplay` + P2002 replay | **evet, OPSİYONEL** (`Sack.clientToken @unique`, schema:2900) | `.openSack` |
| 5 | POST | `/sacks/:id/scan` | WRITE | yazma (top → çuval; başka çuvaldaysa TAŞIR) | **evet** — `shipping.service.ts:~502` "Top zaten bu çuvalda" dalı doğrulandı | yok | `.scanIntoSack` |
| 6 | POST | `/sacks/:id/add-kartela` | WRITE | yazma | ŞÜPHELİ — servis doğrulanmadı | yok | `.addKartelaToSack` |
| 7 | POST | `/sacks/:id/weigh` | WRITE | yazma (`Sack.weightKg`) | evet (set semantiği) | yok | `.weighSack` |
| 8 | POST | `/sacks/:id/customer` | WRITE | yazma (müşteri ataması) | evet (set) | yok | `.reassignSackCustomer` |
| 9 | POST | `/sacks/:id/remove` | WRITE | **yıkıcı** (boş çuval silme — kök CLAUDE.md'de bilinçli fiziksel DELETE istisnası) | hayır (404) | yok | `.removeSack` |
| 10 | GET | `/sacks/:id/notes` | READ | salt-okuma | evet | — | `.getSackNotes` |
| 11 | POST | `/sacks/:id/notes` | WRITE | yazma — **`touchWarehouseSackTx` guard'ı BİLİNÇLİ OLARAK YOK** (sevk edilmiş çuvala da yazılır) | evet (set) | yok | `.setSackNotes` |
| 12 | POST | `/rolls/:rollId/remove-from-sack` | WRITE | yazma | ŞÜPHELİ | yok | `.removeRollFromSack` |
| 13 | POST | `/rolls/:rollId/move-sack` | WRITE | yazma | ŞÜPHELİ | yok | `.moveRollToSack` |
| 14 | POST | `/swatches/:swatchId/remove-from-sack` | WRITE | yazma | ŞÜPHELİ | yok | `.removeSwatchFromSack` |
| 15 | POST | `/sacks/:id/distribute` | WRITE | **yıkıcı** (çuval içeriği depoya dağılır) | ŞÜPHELİ | yok | `.distributeSack` |
| 16 | POST | `/sacks/:id/move-rolls` | WRITE | yazma (toplu taşıma) | ŞÜPHELİ | yok | `.moveRollsToSack` |
| 17 | POST | `/sacks/:id/split` | WRITE | yazma — **YENİ çuval yaratır** (atomik tx) | hayır — her çağrı yeni çuval | **yok** | `.splitSack` |
| 18 | GET | `/sack-search` | READ | salt-okuma | evet | — | `sackSearchService.searchSacks` |
| 19 | POST | `/sack-search/pick-list` | READ | salt-okuma (POST ama okuma) | evet | — | `sackSearchService.getPickList` |
| 20 | POST | `/sack-search/content-dump` | READ | salt-okuma, max 200 çuval | evet | — | `sackSearchService.getContentDump` |
| 21 | GET | `/sacks/:id/contents` | READ | salt-okuma | evet | — | `sackSearchService.getSackContents` |
| 22 | GET | `/locate-roll` | READ | salt-okuma | evet | — | `sackSearchService.locateRoll` |
| 23 | GET | `/sack-store/board` | READ | salt-okuma | evet | — | `.listSackStoreBoard` |
| 24 | GET | `/shipments/:id/sack-contents` | READ | salt-okuma | evet | — | `.getShipmentSackContents` |
| 25 | GET | `/shipments/:id/dispatch-report` | **ACCOUNTING_READ** | salt-okuma — donmuş `PrintedDocument.snapshot` okur, yoksa canlıya düşer (`frozen: Boolean(doc)`); **freeze YAZMAZ** (doğrulandı) | evet | — | `.getDispatchReport` |
| 26 | GET | `/direct-shipments/:id/dispatch-report` | ACCOUNTING_READ | salt-okuma | evet | — | `.getDirectShipmentDispatchReport` |
| 27 | GET | `/accounting-export` | ACCOUNTING_READ | salt-okuma (dönem Excel'i) | evet | — | `buildDispatchAccountingExport(req)` |
| 28 | POST | `/shipments/:id/invoice` | **INVOICE_WRITE** | yazma (`invoiceNo`/`invoicedAt`/`invoicedById`; null → işaret + tarih temizlenir) | evet (set) | yok | `.setShipmentInvoice` |
| 29 | POST | `/direct-shipments/:id/invoice` | INVOICE_WRITE | yazma | evet (set) | yok | `.setDirectShipmentInvoice` |
| 30 | POST | `/shipments` | WRITE | yazma — yeni `Shipment` (+ ayar açıksa doğrudan DISPATCH) | **evet** — `shipping.service.ts:1349-1406` `readCreateShipmentReplay` + P2002 replay | **evet, OPSİYONEL** (`Shipment.clientToken @unique`, schema:2978) | `.createShipment` |
| 31 | GET | `/shipments` | READ | salt-okuma (union: Shipment + DirectShipment) | evet | — | `.listShipments` |
| 32 | POST | `/shipments/preview` | **READ** | salt-okuma (POST ama okuma ucu) | evet | — | `.previewCreateShipment` |
| 33 | GET | `/direct-shipments/:id` | READ | salt-okuma | evet | — | `.getDirectShipment` |
| 34 | GET | `/shipments/:id` | READ | salt-okuma | evet | — | `.getShipment` |
| 35 | POST | `/shipments/:id/add-sacks` | WRITE | yazma | ŞÜPHELİ | yok | `.addSacksToShipment` |
| 36 | POST | `/shipments/:id/remove-sack` | WRITE | yazma | ŞÜPHELİ | yok | `.removeSackFromShipment` |
| 37 | POST | `/shipments/:id/destination` | WRITE | yazma (DOMESTIC/EXPORT) | evet (set) | yok | `.setDestination` |
| 38 | POST | `/shipments/:id/procedure-code` | WRITE | yazma | evet (set) | yok | `.setProcedureCode` |
| 39 | GET | `/shipments/:id/dispatch-note` | READ | salt-okuma | evet | — | `.getDispatchNote` |
| 40 | POST | `/shipments/:id/dispatch-note` | WRITE | yazma (annotation) | evet (set) | yok | `.setDispatchNote` |
| 41 | POST | `/shipments/:id/dispatch` | WRITE | **yazma + resmi belge DONDURMA** (PLANNED → DISPATCHED, stok SHIPPED, `shippedQty` terfi) | hayır (durum claim'i → 409 beklenir; **claim satırı doğrulanmadı**, ŞÜPHELİ) | yok | `.dispatchShipment` |
| 42 | GET | `/shipments/:id/cancel-preview` | READ | salt-okuma | evet | — | `.cancelPreview` |
| 43 | POST | `/shipments/:id/cancel` | WRITE | **yıkıcı** (sevkiyat iptali, tahsis silinir, çuvallar depoya) | hayır | yok | `.cancelShipment` |
| 44 | GET | `/shipments/:id/undo-dispatch-preview` | **UNDO_DISPATCH** | salt-okuma (`canUndo` + `blockReason`) | evet | — | `.undoDispatchPreview` |
| 45 | POST | `/shipments/:id/undo-dispatch` | **UNDO_DISPATCH** | **YIKICI — storno**: DISPATCHED → PLANNED, toplar `preShipStatus`'a döner, irsaliye VOIDED | hayır (409) | yok | `.undoDispatch` |

**Denetim işaretleri:**
- **Mobil izinleri WRITE kümesinde:** `mobile:tarti-paket` ve `mobile:sevkiyat` `WRITE`
  sabitinin içinde → bu iki mobil izin **41 numaralı `dispatch` ve 43 numaralı `cancel`
  uçlarını da açar**. Yani saha tableti sevkiyat onaylayabilir ve iptal edebilir.
  `UNDO_DISPATCH` ve `INVOICE_WRITE` bilinçli olarak ayrılmış ama `dispatch`/`cancel`
  ayrılmamış — görev ayrılığı (SoD) açısından **bakılacak nokta**.
- **`ACCOUNTING_READ` içinde `report:sales`:** satış raporu izni olan kişi sevk fişini ve
  dönem muhasebe Excel'ini çekebiliyor. Bilinçli yazılmış (satır 13-14) ama kapsam geniş.
- (#11) `setSackNotes` guard istisnası kodda değil **kök CLAUDE.md + servis yorumunda**
  yaşıyor; kural "guard'ı ekleme" diyor — mekanik bekçisi `scripts/test_sack_notes.ts`
  olarak anılıyor (bu denetimde koşulmadı).
- (#19, #20, #32) Okuma semantiği taşıyan üç POST — HTTP metodu ile yan etki uyuşmuyor
  (gövde ihtiyacı gerekçe olabilir; CSRF/cache açısından not).
- (#4, #30) `clientToken` **opsiyonel**; (#17) `splitSack` yeni çuval yaratıyor ve
  token TAŞIMIYOR → timeout-replay'de mükerrer çuval riski **bakılmaya değer**.

---

## 8. `traveler-card.routes.ts` → iki mount (10 endpoint)

Controller: `TravelerCardController` → `TravelerCardService`
(+ `system-setting.service.normalizeTravelerCardConfig`, önizleme normalize'ı için).

### 8.1 `/api/work-orders/:id/traveler-cards` (`workOrderTravelerRouter`, `mergeParams: true`)

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/work-orders/:id/traveler-cards` | verifyToken + requirePermission(`workorder:write`) | yazma (yeni ACTIVE kart) | hayır — 409 "zaten aktif kart var" | yok | `.print` |
| 2 | POST | `/api/work-orders/:id/traveler-cards/reprint` | verifyToken + requirePermission(`workorder:write`) | yazma (eski kart REPRINTED, yeni ACTIVE; **sunum snapshot'ı tazelenir**) | hayır — her çağrı yeni kart | yok | `.reprint` |
| 3 | GET | `/api/work-orders/:id/traveler-cards/history` | verifyToken + requirePermission(`workorder:read`) | salt-okuma | evet | — | `.getHistory` |

### 8.2 `/api/traveler-cards` (`travelerCardRouter`, default export)

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 4 | POST | `/api/traveler-cards/sample-html` | verifyToken + requireAnyPermission(...`DOCUMENT_DESIGN_READ`) = any(`admin:settings`, `document-template:read`, `document-template:write`) | salt-okuma (örnek veri + taslak config → HTML) | evet | — | `.getSampleHtml` → `renderSampleHtml` + `normalizeTravelerCardConfig` |
| 5 | GET | `/api/traveler-cards/` | verifyToken + any(`workorder:read`, `mobile:kk1`, `mobile:fason-sevk`, `mobile:hizli-is-emri`) | salt-okuma | evet | — | `.list` |
| 6 | POST | `/api/traveler-cards/scan` | verifyToken + requirePermission(`workorder:write`) | yazma (`TravelerCardScan` + istasyon süreci tetikler) | hayır | yok | `.scan` |
| 7 | GET | `/api/traveler-cards/by-barcode/:barcode` | verifyToken + any(`workorder:read`, `mobile:fason-kabul`, `mobile:fason-sevk`) | salt-okuma | evet | — | `.findByBarcode` |
| 8 | GET | `/api/traveler-cards/:id/html?pageSize=A4\|A5` | verifyToken + any(`workorder:read`, `workorder:write`, `mobile:kk1`, `mobile:fason-sevk`, `mobile:hizli-is-emri`) | salt-okuma — `pageSize` ezmesi **hiçbir yere yazılmaz**, versiyon doğurmaz | evet | — | `.getCardHtml` |
| 9 | POST | `/api/traveler-cards/:id/print-event` | verifyToken + **#8 ile BİREBİR aynı 5'li küme** (dosya yorumu bu hizayı açıkça şart koşuyor) | yazma (`contentDirty` temizle + `printedAt`; içerik değiştiyse `version++`) | evet (aynı içeriğin 2. kopyası versiyon şişirmez) | yok | `.recordPrintEvent` |
| 10 | POST | `/api/traveler-cards/:id/void` | verifyToken + requirePermission(`workorder:write`) | **yıkıcı** (kart VOIDED) | ŞÜPHELİ — servis doğrulanmadı | yok | `.voidCard` |

**Denetim işaretleri:**
- (#8/#9) İzin kümeleri elle senkron tutuluyor; **mekanik bekçi yok** (dosya yorumu
  "ayrışırsa saha kartı basar ama rozet kalıcı olur" diyor). Bu, denetimde
  "elle tutulan hiza" sınıfına giren bir risk.
- (#9) POST `print-event` üzerinde **2026-08-05'ten beri 500 veren controller bind
  eksikliği** yaşandığı kök bellekte kayıtlı (commit `ef49bbc3` ile düzeltilmiş).
  Controller'ın constructor'ında `this.recordPrintEvent = this.recordPrintEvent.bind(this)`
  satırının varlığı bu denetimde **ayrıca doğrulanmadı** — controller bind envanteri
  ayrı bir kontrol maddesi olmalı (servis-katmanı testleri bu sınıfı GÖREMİYOR).
- (#4) `sample-html` bir POST okuma ucu ve `z.record(z.string(), z.unknown())` ile
  **tümüyle gevşek** gövde alıyor; doğrulama tek kaynağa (`normalizeTravelerCardConfig`)
  devredilmiş.

---

## 9. `label-template.routes.ts` → `/api/label-templates` (24 endpoint)

Controller: `LabelTemplateController` → `LabelTemplateService` (+ `helpers/label-rawcode`).
**Tüm uçlar `requirePermission` (tek izin) — bu grubun tek "OR guard'ı hiç kullanmayan" dosyası.**

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/label-templates/` | verifyToken + `label-template:read` | salt-okuma | evet | — | `.list` |
| 2 | GET | `/api/label-templates/catalog/:kind` | + `label-template:read` | salt-okuma (statik katalog) | evet | — | `.catalog` |
| 3 | GET | `/api/label-templates/catalog` | + `label-template:read` | salt-okuma | evet | — | `.unifiedCatalog` |
| 4 | GET | `/api/label-templates/context-defaults` | + `label-template:read` | salt-okuma | evet | — | `.listContextDefaults` |
| 5 | PUT | `/api/label-templates/context-defaults` | + `label-template:write` | yazma (`LabelContextDefault`; kind başına tek default, DB seddi) | evet (PUT set semantiği) | yok | `.setContextDefault` |
| 6 | GET | `/api/label-templates/defaults/:kind` | + `label-template:read` | salt-okuma | evet | — | `.defaults` |
| 7 | POST | `/api/label-templates/preview-raw` | + **`label-template:read`** | salt-okuma (sahte veri + kod → ham çıktı) | evet | — | `.previewRaw` → `buildRawCodePreview` |
| 8 | GET | `/api/label-templates/default-code` | + `label-template:read` | salt-okuma | evet | — | `.defaultCode` |
| 9 | POST | `/api/label-templates/preview` | + **`label-template:read`** | salt-okuma (WYSIWYG render) | evet | — | `.fieldsPreview` |
| 10 | GET | `/api/label-templates/icons` | + `label-template:read` | salt-okuma (statik, DB'siz) | evet | — | `.iconCatalog` |
| 11 | GET | `/api/label-templates/:id` | + `label-template:read` | salt-okuma | evet | — | `.findById` |
| 12 | GET | `/api/label-templates/:id/export` | + `label-template:read` | salt-okuma (JSON zarf) | evet | — | `.exportTemplate` |
| 13 | POST | `/api/label-templates/import` | + `label-template:write` | yazma (yeni şablon; ad çakışması → otomatik dedup) | hayır — her çağrı yeni kayıt | yok | `.importTemplate` |
| 14 | POST | `/api/label-templates/:id/duplicate` | + `label-template:write` | yazma (yeni kopya) | hayır | yok | `.duplicate` |
| 15 | POST | `/api/label-templates/` | + `label-template:write` | yazma (+ `isDefault=true` ise diğerlerini atomik düşürür) | hayır | yok | `.create` |
| 16 | PATCH | `/api/label-templates/:id` | + `label-template:write` | yazma (`fields` gönderildiyse **complete-replace**) | evet (set) | yok | `.update` |
| 17 | POST | `/api/label-templates/:id/set-default` | + `label-template:write` | yazma (atomik default devri) | evet | yok | `.setDefault` |
| 18 | DELETE | `/api/label-templates/:id` | + `label-template:write` | yıkıcı (soft — pasifleştirme) | evet | yok | `.deactivate` |
| 19 | DELETE | `/api/label-templates/:id/permanent` | + `label-template:write` | **yıkıcı** — `deletedAt` damgası (fiziksel DELETE **değil**), ad `DEL-` önekiyle serbest kalır, cihaz yönlendirmeleri silinir | hayır (2. çağrı) | yok | `.hardDelete` |
| 20 | GET | `/api/label-templates/:id/variants` | + `label-template:read` | salt-okuma | evet | — | `.listVariants` |
| 21 | POST | `/api/label-templates/:id/variants` | + `label-template:write` | yazma (yeni varyant; ilk varyant otomatik primary) | hayır | yok | `.createVariant` |
| 22 | PATCH | `/api/label-templates/variants/:variantId` | + `label-template:write` | yazma | evet (set) | yok | `.updateVariant` |
| 23 | DELETE | `/api/label-templates/variants/:variantId` | + `label-template:write` | yıkıcı | hayır | yok | `.deleteVariant` |
| 24 | POST | `/api/label-templates/variants/:variantId/set-primary` | + `label-template:write` | yazma (primary devri) | evet | yok | `.setPrimaryVariant` |

**Denetim işaretleri:**
- **`label-template:read` ile `label-template:write` arasında kapsama İLİŞKİSİ YOK.**
  `DOCUMENT_DESIGN_READ` kümesinde bilinçli olarak `write` de `read` sayılıyor
  (`constants/document-design.ts` bunu açıkça "orada o tuzağı bilerek kapatıyoruz"
  diye yazıyor) ama **burada kapatılmamış**: yalnız `label-template:write` verilen kullanıcı
  ekranı hiç AÇAMAZ (#1, #11, #20 hepsi read ister). Bu, kök CLAUDE.md'de "bilinen hiza
  sorunu" olarak zaten kayıtlı; envanterde teyit edildi.
- (#7, #9) İki render/önizleme ucu **read** izniyle POST gövdesi kabul ediyor;
  `previewRaw` kullanıcının verdiği **ham kod**u render ediyor. Render motorunun
  (`buildRawCodePreview`) enjeksiyon/DoS yüzeyi bu envanterin dışında ama
  **bakılacak nokta**: read izinli kullanıcı sunucuda kod-şablonu çalıştırabiliyor.
- **Route sıralaması riski:** `/:id` (satır 180) kendisinden önce kayıtlı 9 literal path'e
  bağımlı (`/catalog`, `/context-defaults`, `/defaults/:kind`, `/preview-raw`,
  `/default-code`, `/preview`, `/icons`). Dosya bu bağımlılığı yorumla işaretlemiş
  (satır 164) ama **mekanik bekçisi yok**; yeni bir literal path `/:id`'den sonra
  eklenirse sessizce 404/500 üretir.

---

## 10. `kursun-bypass.routes.ts` → `/api/kursun-bypass` (8 endpoint)

Controller: `KursunBypassController` → `KursunBypassService` (+ `assertValidUuid`).
İki guard sabiti:
- `canDistribute = any("workorder:distribute", "mobile:kursun-dagitim")`
- `canSeeVisibility = any("quality:read", "quality:write", "workorder:distribute", "mobile:kk2-kursun", "mobile:kursun-dagitim")` — **bilinçli geniş**, gerekçe kodda yazılı (satır 22-34).

| # | Metod | Path | Auth zinciri | Yan etki | İdempotent | clientToken | Hedef |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/kursun-bypass/visibility` | verifyToken + `canSeeVisibility` (5 izin) | salt-okuma (3 sayı) | evet | — | `.getVisibility` |
| 2 | GET | `/api/kursun-bypass/distribution` | verifyToken + `canDistribute` | salt-okuma (ağır payload) | evet | — | `.listDistribution` |
| 3 | POST | `/api/kursun-bypass/assign` | verifyToken + `canDistribute` | yazma (`KursunBypassAssignment`; yeniden atama = makine değişimi) | ŞÜPHELİ — aynı makineye 2. atama muhtemelen no-op/update; **servis doğrulanmadı** | yok | `.assign` |
| 4 | POST | `/api/kursun-bypass/assign-bulk` | verifyToken + `canDistribute` | yazma, max 100, **SONUÇ PARÇALI** (satır başına ayrı tx, `failed[]`) | ŞÜPHELİ | yok | `.assignBulk` |
| 5 | POST | `/api/kursun-bypass/cancel-bulk` | verifyToken + `canDistribute` | **yıkıcı** (soft-cancel), max 100, parçalı | ŞÜPHELİ | yok | `.cancelBulk` |
| 6 | POST | `/api/kursun-bypass/:id/cancel` | verifyToken + `canDistribute` | **yıkıcı** (atomik claim ile soft-cancel) | hayır — 409 "zaten tamamlanmış/iptal" | yok | `.cancelAssignment` |
| 7 | GET | `/api/kursun-bypass/:id/complete-preview` | verifyToken + `canDistribute` | salt-okuma (`canComplete` + `blockReason`) | evet | — | `.getCompletePreview` |
| 8 | POST | `/api/kursun-bypass/:id/complete` | verifyToken + `canDistribute` | yazma — movement kapanışı + `RollMovement.machineId` damgası + toplar WAREHOUSE'a finalize | **evet** — Swagger açıkça "Idempotent: iş zaten bitmişse `alreadyDone=true` döner" | yok | `.complete` |

**Denetim işaretleri:**
- (#1) `visibility` ucu **kök CLAUDE.md'ye göre artık hiçbir YENİ istemci tarafından
  çağrılmıyor** (sahadaki eski APK'lar için duruyor). Ölü-ama-canlı yüzey; geniş izin
  kümesiyle birlikte denetimde "kullanılmayan ama açık uç" olarak not edilmeli.
- (#6, #7, #8) `:id` = `KursunBypassAssignment.id`; controller `assertValidUuid` import
  ediyor (satır 10) — **fiilen her uçta kullanıldığı doğrulanmadı**.
- (#4, #5) Parçalı sonuç bilinçli tasarım; ama "hepsi-ya-hiç değil" sözleşmesinin
  istemcide gösterildiği varsayımı bu envanterin dışında.

---

## 11. ÖZEL İŞARET: Auth guard'ı OLMAYAN endpoint'ler

**`verifyToken` taşımayan endpoint: 0.** (165/165 doğrulandı.)

**Permission guard'ı olmayan (yalnız authenticate) endpoint: 2** — ikisi de
`feature-flag.routes.ts`'te ve dosya başındaki yorumda bilinçli olarak açıklanmış
("Tüm kullanıcılara açık (auth gerekli, özel permission yok)"):

| Metod | Path | Ne döndürüyor | Denetim notu |
|---|---|---|---|
| GET | `/api/feature-flags/` | `getFeatureFlags()` — **tüm** feature flag değerleri | Yanıt yalnız bayrak değil, `companyName`, `travelerCardConfig` (firma adı/adres/telefon/künye), `documentsConfig`, `loginMethods`, oturum politikası parametreleri (`sessionDurationMinutes`, `pinLockout*`), `backupHour` gibi **sistem yapılandırmasını** da taşıyor. Herhangi bir kimliği doğrulanmış kullanıcı (en dar mobil izinli saha operatörü dahil) bunları okuyabiliyor. Bilgi ifşası **düşük ama sıfır değil**; ayrıca `pinLockoutAttempts`/`pinLockoutPenaltySec` gibi değerler kilit politikasını dışarıya söylüyor. **ŞÜPHELİ** — `getFeatureFlags()` yanıtının tam alan listesi bu denetimde alan alan doğrulanmadı; servis gövdesi okunmalı. |
| GET | `/api/feature-flags/documents-logo` | firma logosu (base64 data-url, ~100KB'a kadar) | Her kimliği doğrulanmış kullanıcı çekebiliyor. Yazma (#4) `admin:settings` ile kapılı. Ayrıca **her çağrıda 100KB'a kadar gövde** → hafif DoS/bant genişliği yüzeyi. |

---

## 12. ÖZEL İŞARET: Route dosyası içinde iş mantığı (inline handler)

Aşağıdaki 20 endpoint controller'a delege ETMİYOR; handler doğrudan route dosyasında
(ya da doğrudan bir servis-helper fonksiyonu handler olarak bağlanmış).
**Hiçbirinde `prisma` import'u yok** (katman kuralı bu yönüyle korunmuş) — hepsi
Zod parse + servise delege deseni. `Teks-Erp/CLAUDE.md` bunu "ince read/ayar endpoint'leri"
için bilinçli istisna olarak tanımlıyor; aşağıdaki liste bu istisnanın **fiilî genişliğini**
gösteriyor.

| Dosya | Endpoint | Handler tipi | Not |
|---|---|---|---|
| `order.routes.ts` | POST `/:id/manual-close` | inline (Zod + servis) | **yazma** ucu — "ince read/ayar" istisnasının dışında |
| | POST `/:id/reopen` | inline | **yazma** |
| | GET `/:id/cancel-preview` | inline | okuma |
| | GET `/:id/shipments` | inline | okuma |
| | POST `/:id/cancel` | inline | **yıkıcı** — istisnanın dışında |
| | GET `/wo-picker` | inline | okuma; `service.findAvailableForWorkOrder(req)` — **ham `req` nesnesi servise geçiyor** (katman sızıntısı sinyali) |
| | GET `/order-lines/available` | inline | okuma; Zod şeması route'ta (`availableQuerySchema`, satır 16-27) |
| | POST `/order-lines/coverage` | inline | okuma; Zod şeması **handler gövdesinin İÇİNDE** tanımlı (satır 444-447 — her istekte yeniden kuruluyor) |
| | GET `/spec-availability` | inline | okuma; Zod şeması handler içinde (satır 491-495) |
| | POST `/quick-from-rolls` | inline | **yazma**; Zod şeması handler içinde (satır 610-621) |
| `feature-flag.routes.ts` | GET `/`, PATCH `/`, GET `/documents-logo`, PUT `/documents-logo` | 4'ü de inline | Controller dosyası hiç yok; `updateSchema` (230 satırlık `strictObject`) route dosyasında yaşıyor ve **`export` edilmiş** çünkü `scripts/test_feature_flag_contract.ts` `.shape`'i runtime'da okuyor |
| | `flagWriteGuard` | inline **middleware** | Route dosyasında yetkilendirme MANTIĞI — §3.1'de ayrıca anlatıldı |
| `item.routes.ts` | POST `/quick-create` | inline | **yazma** |
| | POST `/:id/allowed-colors` | inline | **yazma** (pivot) |
| | POST `/:id/allowed-properties` | inline | **yazma** (pivot) |
| `station.routes.ts` | GET `/api/machines/resolve` | inline | okuma |
| | DELETE `/api/stations/:id/permanent` | **servis-helper doğrudan handler** (`stationHardRemove`) | **fiziksel DELETE**; helper `prisma`yı kendisi import ediyor |
| | DELETE `/api/machines/:id/permanent` | **servis-helper doğrudan handler** (`machineHardRemove`) | **fiziksel DELETE** |
| | GET `/api/machines/:id/delete-preview` | **servis-helper doğrudan handler** (`machineDeletePreview`) | okuma |

**Temiz olan dosyalar (route içinde iş mantığı YOK):** `subcontractor.routes.ts`,
`kursun-qc.routes.ts`, `shipping.routes.ts`, `traveler-card.routes.ts`,
`label-template.routes.ts`, `kursun-bypass.routes.ts` — altısı da yalnızca guard + controller
metodu bağlıyor.

---

## 13. Denetimin nereye bakması gerektiği — özet yönlendirme

Aşağıdakiler **bulgu değil**, denetimin sonda atması gereken noktalar.

1. **`clientToken` kapsaması eksik olan kayıt-yaratan uçlar** — `POST /api/subcontractor/dispatch`,
   `POST /api/subcontractor/receive`, `POST /api/shipping/sacks/:id/split`,
   `POST /api/label-templates/import|:id/duplicate|:id/variants`,
   `POST /api/items` ve `POST /api/items/quick-create`. Mobil izinle açık olanlar
   (dispatch/receive) çevrimdışı kuyruk taşıdığı için öncelikli.
2. **Fiziksel DELETE uçları** — `DELETE /api/orders/:id/permanent`,
   `/api/items/:id/permanent`, `/api/stations/:id/permanent`, `/api/machines/:id/permanent`.
   Hepsi ilgili modülün normal `:write` izniyle açık; guard listeleri elle tutuluyor.
3. **Görev ayrılığı (SoD)** — `shipping.routes` `WRITE` sabitindeki `mobile:tarti-paket` /
   `mobile:sevkiyat` `dispatch` ve `cancel` uçlarını da açıyor; `INVOICE_WRITE` ve
   `UNDO_DISPATCH` ayrılmışken bunlar ayrılmamış.
4. **`label-template:read`/`write` kapsama boşluğu** — write-only kullanıcı ekranı açamıyor
   (24 ucun 13'ü read istiyor). `DOCUMENT_DESIGN_READ` deseni buraya uygulanmamış.
5. **`flagWriteGuard`** — `documentsConfig` gövdesinin İÇİ route'ta `z.any()`; dar izinli
   (`document-template:write`) kullanıcının bu anahtarın altına yazabildiklerinin sınırı
   yalnız `sanitizeDocumentsConfig`'te. O fonksiyon denetlenmeli.
6. **Auth-only iki uç** (`GET /api/feature-flags`, `GET /api/feature-flags/documents-logo`) —
   ilkinin yanıt yüzeyi alan alan çıkarılmalı (oturum/kilit politikası parametreleri sızıyor mu).
7. **Route sıralaması** — `label-template.routes.ts` `/:id` öncesi 9 literal path,
   `station.routes.ts` `/machines` ve `/resolve`, `traveler-card.routes.ts` `/sample-html`.
   Üçü de yorumla korunuyor, mekanik bekçisi yok.
8. **`assertValidUuid` tutarsızlığı** — `order.routes` kullanıyor, `item.routes` düz
   `String(req.params.id)` yapıyor. Geçersiz uuid'de P2007/500 farkı ölçülmeli.
9. **Controller `bind` envanteri** — `POST /api/traveler-cards/:id/print-event` sahada
   bind eksikliği yüzünden aylarca 500 vermiş (kök bellek, commit `ef49bbc3`).
   Servis-katmanı testleri bu sınıfı göremiyor; **10 dosyanın tüm controller metodları
   için bind kontrolü ayrı bir kontrol maddesi olmalı** — bu envanterde yapılmadı.
10. **`verifyToken` maliyeti** — her istekte `user.findUnique` + `session.findUnique`.
    `GET /api/kursun-qc/open-cards` (tablet 5 sn'de bir) ve `GET /api/kursun-bypass/visibility`
    gibi yoklama uçlarında çarpan etkisi ölçülmeli.
