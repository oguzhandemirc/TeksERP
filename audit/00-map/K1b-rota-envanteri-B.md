# K1b — Rota & Yüzey Envanteri (B: master-data … workorder + reports) — 2026-08-28

Aşama ① KEŞİF haritası (yargı yok, bulgu yok; yalnız HOTSPOT işareti). Dal `adnansahin`, HEAD ce8681d1.
Önceki envanter (2026-08-09, `audit/surface/02,03,04-route-envanteri-*.md`) yalnız karşılaştırma için kullanıldı; her satır güncel koddan yeniden türetildi.

## 0. Yöntem, kapsam, kısaltmalar

**Kapsam (33 dosya, 305 rota):** `Teks-Erp/src/routes/` altında master-data-merge · mobile-update · order · peripheral · printed-document · product-recipe · production-balance · quality-grade · reason-preset · record-info · reports.routes.ts + `reports/` 7 dosya · return-reason · return · route · search · shipping · station-capability · station · subcontractor-management · subcontractor · swatch · tambur · traveler-card · traveler-template · work-session · workorder.

**Sayım yöntemi:** `grep -cE '^\s*(router|peripheralRouter|machineRouter|subcontractorRouter|categoryRouter|workOrderTravelerRouter|travelerCardRouter)\.(get|post|patch|put|delete)\('` — router değişkeni `router` OLMAYAN beş dosya (station → `machineRouter`, peripheral → `peripheralRouter`, subcontractor-management → `subcontractorRouter`/`categoryRouter`, traveler-card → `workOrderTravelerRouter`/`travelerCardRouter`) desene bilerek eklendi (beceri §7.8 adlandırma tuzağı). Toplam **305** (dosya başına sayılar §1'de).

**Kapı zinciri ALTI kaynaktan çözüldü (beceri §7.8):**

| # | Kaynak | Bu kapsamda ne var (kanıt) |
|---|---|---|
| 1 | Route satırı | 303 rotada `verifyToken` doğrudan satırda (dosya başına `grep -c verifyToken` − import satırı = rota sayısı; §1 tablosu) |
| 2 | Dizi sabiti + spread | `reports/*.routes.ts` yedi dosyada `const guard = [verifyToken, requirePermission("report:X")]` → `...guard` (audit:19, customer:20, inventory:16, production:23, quality:20, sales:24, subcontract:18). Ayrıca izin dizileri spread ile: `MOBILE_LABEL_PRINTERS` (peripheral:20), `MOBILE_SESSION_PERMS` (work-session.service.ts:46-51 = mobile:kk1, kk2-kursun, tambur, tarti-paket), `MOBILE_QUALITY_READ` (quality-grade:15), `MOBILE_FASON_READ` (subcontractor:10, subcontractor-management:14), `DOCUMENT_DESIGN_READ/WRITE` (constants/document-design.ts:37-44) |
| 3 | Dosya içi tekil sabit | shipping.routes.ts:10-23 `READ`/`WRITE`/`ACCOUNTING_READ`/`INVOICE_WRITE`/`UNDO_DISPATCH`; reason-preset.routes.ts:33 `canEdit` (küçük harf!) |
| 4 | `router.use` | Yalnız iki mount: reports.routes.ts:21-27 (yedi alt router, guard YOK) ve workorder.routes.ts:15 (`/:id/traveler-cards` → `workOrderTravelerRouter`, guard YOK). Hiçbir dosyada `router.use(verifyToken)` yok |
| 5 | Mount / global | app.ts:128 `latencyMiddleware`, :141 `express.json({limit:"1mb"})`, :169 `resolveDevice` (cihaz çözümü — engel yalnız `device.pairingRequired` açıkken, device.middleware.ts:76-90), :504-583 mount satırları **guard'sız** (`app.use("/api/x", router)`). **Global `verifyToken` YOK** → her rota kendi satırında taşımak zorunda |
| 6 | Handler içi dinamik | `DOC_PERMISSIONS[docType]` (printed-document.routes.ts:20-107), `TABLE_PERMISSIONS[table]` (record-info.routes.ts:31-88), `requireEntityWrite` → `getImportAdapter(entity).writePermission` (master-data-merge.routes.ts:36-56), arama kovası izni SERVİSTE (search.service.ts:74), payload'a bağlı `roll:manual-adjust` (workorder.controller.ts:949-956, 989-996, 1034-1039), `allowEmptyStep` izin dalı (tambur.controller.ts:369-372), çift `requirePermission` AND zinciri (workorder.routes.ts:600-601). Ayrıntı §6 |

**Sütun kısaltmaları:** `vT` = verifyToken · `P(x)` = requirePermission(x) · `any(…)` = requireAnyPermission(…) · **R** okuma · **Y** yazma · **D** yıkıcı (iptal/geri alma/silme/fire) · **R+Y** GET üzerinde yazma olası · `uuid✓` path param `assertValidUuid`/Zod uuid ile doğrulanıyor · `uuid✗` ham `req.params.x as string`.
Handler dosya kısaltmaları: **BC** base.controller.ts · **SC** shipping.controller.ts · **SUB** subcontractor.controller.ts · **SMC** subcontractor-management.controller.ts · **TC** tambur.controller.ts · **TMC** tambur-manual.controller.ts · **WC** workorder.controller.ts · **TCC** traveler-card.controller.ts · **PDC** printed-document.controller.ts · **RC** return.controller.ts · **WSC** work-session.controller.ts · **GHR** services/helpers/guarded-hard-remove.ts · **inline** = handler route dosyasının kendisinde.
BaseController metodları (BC): similarNames:49 · findAll:67 · findById:79 (`getParamId` → uuid✓, BC:14-18) · create:95 (Zod YOK — `BaseService.create` DMMF `sanitizeWriteData` base.service.ts:1021 + `normalizeNameFields`) · update:107 (uuid✓, DMMF :1133) · remove:118 (softDelete :1233) · hardRemove:130 (hardDelete :1259).

**Cihaz/oturum sütunu:** `resolveDevice` global olduğu için her rotada `req.device` opsiyonel çözülür. Rota bazında ZORUNLU olduğu yerler: work-sessions open/close/current (`requireDevice` → 400 `DEVICE_REQUIRED`, WSC:38-46); `getStampContext(req,{enforceForMobile:true})` → tablet/telefon oturumsuzsa 409 `WORK_SESSION_REQUIRED`, web/DESKTOP geçer (work-session.helper.ts:86-116): tambur finalize (TC:521), finalize-open-fabric (TC:347), bypass-complete (TC:386), `/manual/*` altı uç (TMC:167-256), peripherals field-address (peripheral.routes.ts:185). Oturum OPSİYONEL (damga "varsa yazılır"): tambur cut (TC:287), cut-warehouse (TC:283-287 yorum), finalize-warehouse-cut (TC:308), peripherals for-session, station-capabilities for-session.

---

## 1. Özet sayılar

| Dosya | Mount (app.ts satırı) | Rota | vT | Route'ta RBAC yok | Public | Y/D | R | 2026-08-09 |
|---|---|---|---|---|---|---|---|---|
| master-data-merge.routes.ts | `/api/master-data` (:551) | 9 | 9 | 0 | 0 | 3 | 6 | **yeni dosya** |
| mobile-update.routes.ts | `/api/mobile` (:583) | 3 | 1 | 2 | **2** | 0 | 3 | **yeni dosya** |
| order.routes.ts | `/api/orders` (:510) | 20 | 20 | 0 | 0 | 10 | 10 | 16 (+4) |
| peripheral.routes.ts | `/api/peripherals` (:506) | 12 | 12 | 0 | 0 | 7 | 5 | 11 (+1) |
| printed-document.routes.ts | `/api/printed-documents` (:535) | 6 | 6 | 0 | 0 | 1 (+2 R+Y) | 5 | 6 |
| product-recipe.routes.ts | `/api/product-recipes` (:508) | 7 | 7 | 0 | 0 | 4 | 3 | 5 (+2) |
| production-balance.routes.ts | `/api/production-balance` (:514) | 1 | 1 | 0 | 0 | 0 | 1 | 1 |
| quality-grade.routes.ts | `/api/quality-grades` (:527) | 6 | 6 | 0 | 0 | 3 | 3 | 5 (+1) |
| reason-preset.routes.ts | `/api/reason-presets` (:531) | 5 | 5 | 1 (GET /) | 0 | 4 | 1 | **yeni dosya** |
| record-info.routes.ts | `/api/record-info` (:512) | 1 | 1 | 1 (dinamik) | 0 | 0 | 1 | **yeni dosya** |
| reports.routes.ts + reports/* (7) | `/api/reports/*` (:572) | 21 | 21 | 0 | 0 | 0 | 21 | 20 (−15 / +16) |
| return-reason.routes.ts | `/api/return-reasons` (:539) | 6 | 6 | 0 | 0 | 3 | 3 | 5 (+1) |
| return.routes.ts | `/api/returns` (:538) | 7 | 7 | 0 | 0 | 3 | 4 | 7 |
| route.routes.ts | `/api/routes` (:507) | 7 | 7 | 0 | 0 | 4 | 3 | 5 (+2) |
| search.routes.ts | `/api/search` (:577) | 1 | 1 | 1 (serviste) | 0 | 0 | 1 | **yeni dosya** |
| shipping.routes.ts | `/api/shipping` (:534) | 46 | 46 | 0 | 0 | 24 | 22 | 45 (+1) |
| station-capability.routes.ts | `/api/station-capabilities` (:530) | 4 | 4 | 0 | 0 | 1 | 3 | 3 (+1) |
| station.routes.ts | `/api/stations` (:504) + `/api/machines` (:505) | 17 | 17 | 0 | 0 | 8 | 9 | 15 (+2) |
| subcontractor-management.routes.ts | `/api/subcontractors` (:522) + `/api/subcontractor-categories` (:523) | 10 | 10 | 0 | 0 | 6 | 4 | 10 |
| subcontractor.routes.ts | `/api/subcontractor` (:520) | 23 | 23 | 0 | 0 | 11 | 12 | 22 (+1) |
| swatch.routes.ts | `/api/swatches` (:525) | 3 | 3 | 0 | 0 | 0 | 3 | 3 |
| tambur.routes.ts | `/api/tambur` (:515) | 22 | 22 | 0 | 0 | 12 | 10 | 20 (+2) |
| traveler-card.routes.ts | `/api/traveler-cards` (:518) + `/api/work-orders/:id/traveler-cards` (workorder.routes.ts:15) | 10 | 10 | 0 | 0 | 5 | 5 | 10 |
| traveler-template.routes.ts | `/api/traveler-templates` (:519) | 8 | 8 | 0 | 0 | 5 | 3 | 8 |
| work-session.routes.ts | `/api/work-sessions` (:575) | 8 | 8 | 0 | 0 | 3 (+1 R+Y) | 5 | 8 |
| workorder.routes.ts | `/api/work-orders` (:513) | 42 | 42 | 0 | 0 | 22 | 20 | 32 (+10) |
| **TOPLAM** | | **305** | **303** | 3 | **2** | **139** | **166** | 232 (+73) |

`vT` sütunu: `grep -c verifyToken` − 1 (import). reports.routes.ts kendisi rota tanımlamaz (yalnız mount); alt dosyalarda spread ile her rota kapsanıyor (sayı 1 görünür ama 21 rotayı kapsar — regex ile bakan denetim burada yanılır).

---

## 2. Dosya başına rota tabloları

### 2.1 `master-data-merge.routes.ts` → `/api/master-data` (9) — router `router`; servis MasterDataMergeService / DuplicateDetectionService / DuplicateReviewService

| # | Metod | Tam yol | Zincir (sırayla) | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/master-data/:entity/merge/preview` | vT → P(`master-data:merge`) → `requireEntityWrite` (dinamik: entity ∉ MERGE_ENTITIES → 400; `adapter.writePermission` yoksa 403) | inline :87-105 → `MasterDataMergeService.preview` | Zod `previewSchema` :58-61 (survivorId uuid, sourceIds 1..MAX_MERGE_SOURCES) | R (yan etkisiz) | `{success,data}` |
| 2 | POST | `/api/master-data/:entity/merge` | aynı üçlü | inline :118-147 → `MasterDataMergeService.merge` (advisory lock service:546; 17 ham SQL :441-1052) | `mergeSchema` :63-75 (+reason ≥10, acknowledgedConflicts int, fieldPicks record uuid) | **D** (GERİ ALINAMAZ; tombstone `mergedIntoId`) | `{success,data:{mergedCount,fieldsApplied…},message}` · 409 çakışma |
| 3 | GET | `/api/master-data/duplicates` | vT → P(`master-data:merge`) | inline :159-172 → `findDuplicates` | `z.enum(MERGE_ENTITIES)` query.entity | R | `{success,data}` |
| 4 | GET | `/api/master-data/duplicates/candidates` | aynı | inline :192-207 → `DuplicateDetectionService.scan` | `candidatesQuerySchema` :177-180 | R | `{success,data}` |
| 5 | GET | `/api/master-data/duplicates/records` | aynı | inline :229-249 → `listRecords` | `recordsQuerySchema` :209-217 (page ≤10.000, limit ≤200) | R | `{success,data}` |
| 6 | GET | `/api/master-data/duplicates/candidates.csv` | aynı | inline :261-283 → `scan` + `toCsv` | `candidatesQuerySchema` | R | `text/csv` attachment |
| 7 | GET | `/api/master-data/duplicates/reviews` | aynı | inline :306-319 → `DuplicateReviewService.list` | `reviewsQuerySchema` :285-288 | R | `{success,data}` |
| 8 | POST | `/api/master-data/duplicates/reviews` | aynı | inline :331-356 → `decide` (upsert duplicate-review.service:112) | `decideSchema` :321-329 (aId/bId uuid, decision NOT_DUPLICATE∕DEFERRED, evidence ≤20) | Y | `{success,data,message}` |
| 9 | DELETE | `/api/master-data/duplicates/reviews/:id` | aynı | inline :369-382 → `reopen` (fiziksel `delete` duplicate-review.service:151; MERGED → 409) | `z.uuid().parse(params.id)` uuid✓ | Y (satır silme) | `{success,message}` |

Not: `MERGE_ENTITIES = ["customer","item","color","subcontractor"]` (constants/merge-map.ts:21). `/duplicates/*` sabit yolları `/:entity/merge*` ile çakışmaz (ikinci segment `merge` şart).

### 2.2 `mobile-update.routes.ts` → `/api/mobile` (3)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/mobile/updates/ota/:runtimeVersion/manifest` | **KAPISIZ (public, bilinçli — dosya başlığı :19-21, app.ts:578-582)** | inline :44-57 → `dosyaBilgi(manifestGorelYolu(rv))` | `manifestGorelYolu` regex `^[A-Za-z0-9._-]+$`, `.`/`..` reddi (mobile-update.service.ts:102-108); `dosyaYolu` resolve-sonrası kök-altı kontrolü :66-76 | R (senkron `fs.readFileSync` :56) | `multipart/mixed` ham bayt + `expo-protocol-version` başlıkları · 404 |
| 2 | GET | `/api/mobile/updates/{*yol}` (Express 5 wildcard) | **KAPISIZ (public)** | inline :69-83 → `dosyaBilgi(gorel)` → `res.sendFile` | path traversal guard :66-76 (`..` → 400 "Geçersiz yol"); dizin → 404 (:93) | R | dosya; cache-control immutable ∕ no-cache (:74-80) |
| 3 | GET | `/api/mobile/updates-state` | vT → P(`admin:settings`) | inline :93-100 → `depoDurumu()` | — | R | `{success,data:{kok,varMi,surumler,apk}}` |

Not: ilk iki handler'da try/catch yok — Express 5 async hata yakalama (`next(err)`) varsayılıyor (KUNYE: Express ^5.2.1). Depo kökü `MOBILE_UPDATE_DIR` ∕ `cwd/../mobil-guncelleme` (config/mobile-update.ts:32-34).

### 2.3 `order.routes.ts` → `/api/orders` (20) — OrderService (BaseService alt sınıfı) + BaseController (5 uç) + 15 inline

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/orders/:id/manual-close` | vT → P(`order:write`) | inline :119-136 → `orderService.manualComplete` (order.service.ts:3287) | `reasonSchema` :86-88 (1..500) + uuid✓ | Y (status→COMPLETED) | ApiResponse |
| 2 | POST | `/api/orders/:id/reopen` | vT → P(`order:write`) | inline :149-166 → `reopen` (:3367) | `reasonSchema` + uuid✓ | Y | ApiResponse |
| 3 | GET | `/api/orders/:id/cancel-preview` | vT → P(`order:write`) (önizleme WRITE izniyle) | inline :180-192 → `getCancelPreview` | uuid✓ | R | ApiResponse |
| 4 | GET | `/api/orders/:id/shipments` | vT → any(`order:read`,`shipping:read`,`shipping:write`) | inline :212-226 → `getOrderShipments` | uuid✓ | R | `{dispatchedTotal,plannedTotal,shipments[]}` |
| 5 | POST | `/api/orders/:id/cancel` | vT → P(`order:write`) | inline :285-303 → `cancelWithActions` (:3075) | `cancelBodySchema` :261-284 (workOrderActions[], reasonCode ≤64, reasonText ≤1000) + uuid✓ | **D** (sipariş CANCELLED + WO başına UNLINK_ONLY∕CONVERT_TO_STOCK∕CANCEL_WO) | ApiResponse |
| 6 | GET | `/api/orders` | vT → any(`order:read`,`mobile:siparis`) | BC.findAll:67 → `buildListWhere` | — (BaseService süzgeçleri) | R | sayfalı ∕ cursor |
| 7 | GET | `/api/orders/stats` | aynı küme (liste ile hizalı, :373-374) | inline :375-387 → `getOrderStats(req)` | — (req geçer) | R | özet sayaçlar |
| 8 | GET | `/api/orders/wo-picker` | vT → any(`order:read`,`workorder:read`,`workorder:write`) | inline :416-431 → `findAvailableForWorkOrder(req)` | — | R | liste |
| 9 | GET | `/api/orders/order-lines/available` | vT → any(`order:read`,`quality:write`,`workorder:write`,`mobile:tambur`,`mobile:tarti-paket`,`mobile:hizli-is-emri`) | inline :455-490 → `findAvailableOrderLines` | `availableQuerySchema` :16-27 (limit ≤50) | R | liste ∕ cursor |
| 10 | POST | `/api/orders/order-lines/coverage` | vT → any(`order:read`,`workorder:read`,`workorder:write`) | inline :516-533 → `getCoverageForLines` | inline Zod :522-525 (lineIds uuid[] ≤100) | R (POST ama okuma) | kalem başına kapsama |
| 11 | GET | `/api/orders/spec-availability` | vT → any(`order:read`,`order:write`,`workorder:read`,`mobile:siparis`) | inline :560-581 → `getSpecAvailability` | inline Zod :569-573 (itemId uuid zorunlu) | R | `{freeWarehouse,inProduction,freeStock}` |
| 12 | GET | `/api/orders/:id` | vT → P(`order:read`) | BC.findById:79 | uuid✓ | R | ApiResponse ∕ 404 |
| 13 | POST | `/api/orders` | vT → any(`order:write`,`mobile:siparis`) | BC.create:95 → `OrderService.create` (order.service.ts:1799: lines ≥1, validateLineItems/Customer/Branch/LineColors, currency; clientToken :1905-1912, P2002 replay :1978-1983 → `resolveCreateTokenReplay` :2026) | **Zod YOK**; DMMF sanitize + servis doğrulaması; `Order.clientToken @unique` opsiyonel | Y | 201 ApiResponse |
| 14 | POST | `/api/orders/quick-from-rolls` | vT → any(`order:write`,`mobile:hizli-is-emri`,`mobile:tarti-paket`) | inline :682-707 → `quickOrderFromRolls` (:2080) | inline Zod :688-699 (rollIds 1..500, **clientToken ZORUNLU** uuid) | Y (sipariş + STOCK→WAREHOUSE) | 201 |
| 15 | PATCH | `/api/orders/:id` | vT → P(`order:write`) | BC.update:107 → `OrderService.update` (:2212 — kalem diff, WO-bağ kilidi, currency/deadline kuralları) | **Zod YOK**; DMMF sanitize; uuid✓ | Y | ApiResponse · 409 kilit |
| 16 | GET | `/api/orders/:id/lines/:lineId/cancel-preview` | vT → P(`order:read`) | inline :789-804 → `getLineCancelPreview` | uuid✓ ×2 | R | önizleme (`canCancel`,`blockers[]`) |
| 17 | POST | `/api/orders/:id/lines/:lineId/cancel` | vT → P(`order:write`) | inline :839-861 → `cancelOrderLine` (:452) | inline Zod :845-848 + uuid✓ ×2 | **D** (kalem SOFT iptal; WO bağları kopar, son bağ → STOK) | ApiResponse · 409 |
| 18 | PATCH | `/api/orders/:id/lines/:lineId/color` | vT → P(`order:write`) | inline :863-886 → `changeLineColor` (:2641) | inline Zod :869-872 (colorId uuid∕null, reason 3..500); **uuid✗** (`req.params.id as string` :875-876) | Y | `{lineId,previousColorId,colorId}` |
| 19 | DELETE | `/api/orders/:id` | vT → P(`order:write`) | BC.remove:118 → `OrderService.softDelete` (:2722; `assertNoActiveShipments`, atomik claim `tx.order.updateMany` :2760) | uuid✓ | **D** (soft → CANCELLED) | ApiResponse |
| 20 | DELETE | `/api/orders/:id/permanent` | vT → P(`order:write`) | BC.hardRemove:130 → `OrderService.hardDelete` (:2718-2720 = **`this.softDelete`**) | uuid✓ | **D** (Swagger "kalıcı silinir" der :913-915 — kod SOFT) | ApiResponse |

Rota sırası: `/:id/manual-close` vb. iki segmentli sabit son ekler `/:id` GET'ten önce; `/stats`, `/wo-picker`, `/order-lines/*`, `/spec-availability` (:375-581) tek segmentli `/:id` (:602)'den ÖNCE tanımlı → doğru.

### 2.4 `peripheral.routes.ts` → `/api/peripherals` (12) — router **`peripheralRouter`**; PeripheralDeviceService (BaseService türevi) + BaseController

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/peripherals` | vT → any(`station:read`,`settings:workstation`,`mobile:kk1`,`mobile:tambur`,`mobile:tarti-paket`) | BC.findAll:67 (tombstone süzgeci peripheral.service.ts:40-42) | — | R | sayfalı |
| 2 | GET | `/api/peripherals/for-device` | vT → any(`station:read`,`shipping:read`,`shipping:write`,`mobile:kk1`,`mobile:tambur`,`mobile:tarti-paket`,`mobile:sevkiyat`) | inline :66-81 → `service.getForDevice({deviceId,machineId} ← req.device, kind)` (peripheral.service.ts:284) | `kind` ham string (doğrulama serviste — okunmadı) | R | liste |
| 3 | GET | `/api/peripherals/for-session` | vT → any(`station:read`,`shipping:read`,`shipping:write`, MOBILE_SESSION_PERMS×4) | inline :95-107 → `getStampContext(req)` (oturum opsiyonel) → `getForSession` (:327) | — | R | liste (oturum yoksa boş) |
| 4 | GET | `/api/peripherals/similar-names` | vT → P(`station:write`) | BC.similarNames:49 | — | R | `{success,data}` |
| 5 | GET | `/api/peripherals/:id` | vT → P(`station:read`) | BC.findById:79 (tombstone 404, :45-49) | uuid✓ | R | ApiResponse |
| 6 | POST | `/api/peripherals` | vT → P(`station:write`) | BC.create:95 → service.create (:158 `delete data.deletedAt`) | **Zod YOK** (DMMF) | Y | 201 |
| 7 | PATCH | `/api/peripherals/:id` | vT → P(`station:write`) | BC.update:107 → service.update (:174) | Zod YOK; uuid✓ | Y | ApiResponse |
| 8 | DELETE | `/api/peripherals/:id` | vT → P(`station:write`) | BC.remove:118 (soft) | uuid✓ | D-soft | ApiResponse |
| 9 | DELETE | `/api/peripherals/:id/permanent` | vT → P(`station:write`) | BC.hardRemove:130 → service.hardDelete (:204-206: **fiziksel DEĞİL, `deletedAt` tombstone**) | uuid✓ | D (tombstone) | ApiResponse ∕ 404 |
| 10 | POST | `/api/peripherals/:id/template-routes` | vT → P(`station:write`) | inline :131-142 → `service.setTemplateRoute` (:242; `kind` LabelKind kontrolü :250; şablon var/aktif :257-261; `assertTemplateAssignable` :265; upsert/deleteMany :253,266) | **Zod YOK** — `req.body as {kind?,templateId?}` :133, `body.kind as never` :136; **uuid✗** | Y | ApiResponse |
| 11 | POST | `/api/peripherals/:id/test` | vT → P(`station:write`) | inline :153-158 → `service.test` (:414 — NETWORK_TCP gerçek∕simüle gönderim, **dış donanım**) | gövde yok; **uuid✗** | Y? (dış I/O; DB yazımı okunmadı) | test sonucu |
| 12 | PATCH | `/api/peripherals/:id/field-address` | vT → any(`station:write`, MOBILE_SESSION_PERMS×4) → `getStampContext(req,{enforceForMobile:true})` (:185, mobilde oturum yoksa 409) | inline :174-195 → `service.setFieldAddress` (:362-411: boş/128 sınırı, yalnız BLUETOOTH_SPP :383-385, oturum-kapsam guard :390-397, audit best-effort) | **Zod YOK** (`body.address ?? ""` :184); **uuid✗** (`findFirst` → yok = 404) | Y | ApiResponse |

Sıra notu: `/similar-names` (:113) `/:id` (:115)'ten önce (yorum :109-110). `/for-device`, `/for-session` de önce.

### 2.5 `printed-document.routes.ts` → `/api/printed-documents` (6) — PrintedDocumentController; izinler **dinamik** (`DOC_PERMISSIONS`, §6)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/printed-documents/:docType/sample-html` | vT → **any(`admin:settings`) SABİT** (:138; dinamik değil) | PDC.getSampleHtml:232 | `docTypeSchema` nativeEnum(PrintedDocType) :14,234; `sampleHtmlSchema{config: docConfigSchema}` :124,235 | R (render; TRAVELER_CARD → 400, SELF_MANAGED) | `text/html` (TASLAK filigranlı) |
| 2 | GET | `/api/printed-documents/:docType/:sourceId/current` | vT → `requireDocPermission("read")` (:98-107; bilinmeyen docType → 400) | PDC.getCurrent:144 → `printedDocumentService.getCurrent` | `parseParams` :126-131 (docType enum, sourceId uuid✓) | **R+Y**: belge yoksa lazy-init `printedDocument.create` + audit (service:382-413), yarışta P2002 → kazananı oku (:414-433) | belge ∕ `data:null` (taslak) |
| 3 | GET | `/api/printed-documents/:docType/:sourceId/html` | vT → `requireDocPermission("read")` | PDC.getHtml:161 → `service.getHtml` (:437; içeride `getCurrent` → lazy-init olası) | `parseParams`; `version` coerce int (:164-167); query: draft, currentTemplate, printNote ≤300, rowNotes, sections ≤10, merge, pageSize A4∕A5 (geçersiz sessiz yok sayılır :199-204) | **R+Y** (lazy-init) | `text/html` · 409 taslak |
| 4 | GET | `/api/printed-documents/:docType/:sourceId/versions` | vT → read | PDC.listVersions:244 | `parseParams` | R | liste |
| 5 | GET | `/api/printed-documents/:docType/:sourceId/versions/:version` | vT → read | PDC.getVersion:255 | `parseParams` + `versionSchema` :258 | R | belge ∕ 404 |
| 6 | POST | `/api/printed-documents/:docType/:sourceId/reissue` | vT → `requireDocPermission("write")` | PDC.reissue:267 → `service.reissue` (:641) | `parseParams` + `reissueSchema` :18-20 (reason 3..500) | Y (yeni versiyon v+1, aktif SUPERSEDED; TRAVELER_CARD → 400) | 201 · 409 VOIDED |

### 2.6 `product-recipe.routes.ts` → `/api/product-recipes` (7) — ProductRecipeService (autoCode `REC`, nested `properties`)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/product-recipes` | vT → any(`station:read`,`mobile:hizli-is-emri`) | BC.findAll:67 | — | R | sayfalı |
| 2 | GET | `/api/product-recipes/similar-names` | vT → P(`station:write`) | BC.similarNames:49 | — | R | liste |
| 3 | GET | `/api/product-recipes/:id` | vT → any(`station:read`,`mobile:hizli-is-emri`) | BC.findById:79 | uuid✓ | R | ApiResponse |
| 4 | POST | `/api/product-recipes` | vT → P(`station:write`) | BC.create:95 (DMMF; `nestedCreateFields: ["properties"]` :20) | Zod YOK | Y | 201 |
| 5 | PATCH | `/api/product-recipes/:id` | vT → P(`station:write`) | BC.update:107 (properties verilirse M:N yeniden yazılır, Swagger :130) | Zod YOK; uuid✓ | Y | ApiResponse |
| 6 | DELETE | `/api/product-recipes/:id` | vT → P(`station:write`) | BC.remove:118 | uuid✓ | D-soft | ApiResponse |
| 7 | DELETE | `/api/product-recipes/:id/permanent` | vT → P(`station:write`) | GHR `recipeHardRemove` :320 (`makeGuardedHardRemove` :47-98: uuid✓, guard sayaçları → 409, tx delete, audit tx DIŞINDA) | uuid✓ | **D fiziksel** | 200 ∕ 404 ∕ 409 |

### 2.7 `production-balance.routes.ts` → `/api/production-balance` (1)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/production-balance` | vT → any(`workorder:read`,`order:read`) | inline :37-56 → `ProductionBalanceService.getBalance({itemId})` | `itemId` ham string (CSV serviste `readIdCondition`) | R | `result` doğrudan |

### 2.8 `quality-grade.routes.ts` → `/api/quality-grades` (6) — bare BaseService + Zod ön-doğrulayıcı

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/quality-grades` | vT → any(`quality:read`,`label-template:read`,`mobile:kk1`,`mobile:kk2-kursun`,`mobile:tambur`,`mobile:iade`) | BC.findAll:67 | — | R | sayfalı |
| 2 | GET | `/api/quality-grades/similar-names` | vT → P(`quality:write`) | BC.similarNames:49 | — | R | liste |
| 3 | GET | `/api/quality-grades/:id` | vT → any(`quality:read`, MOBILE_QUALITY_READ×4) | BC.findById:79 | uuid✓ | R | ApiResponse |
| 4 | POST | `/api/quality-grades` | vT → P(`quality:write`) → `validateQgCreate` (:47-51: `qgCreateSchema` passthrough, targetStatus ZORUNLU ∈ WAREHOUSE∕A1_STOCK∕STOCK∕SCRAP) | BC.create:95 | Zod (2 alan) + DMMF | Y | 201 |
| 5 | PATCH | `/api/quality-grades/:id` | vT → P(`quality:write`) → `validateQgUpdate` (:52-56) | BC.update:107 | Zod (2 alan) + DMMF; uuid✓ | Y | ApiResponse |
| 6 | DELETE | `/api/quality-grades/:id` | vT → P(`quality:write`) | BC.remove:118 | uuid✓ | D-soft | ApiResponse |

### 2.9 `reason-preset.routes.ts` → `/api/reason-presets` (5) — inline; sabit `canEdit = any(roll:manual-adjust, mobile:tambur-duzelt)` (:33)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/reason-presets` | **vT yalnız (RBAC yok — bilinçli, :8-10)** | inline :73-85 → `ReasonPresetService.list` | `kindSchema` nativeEnum(ReasonPresetKind) opsiyonel | R | liste (`includeInactive=true` ile gizliler) |
| 2 | POST | `/api/reason-presets` | vT → canEdit | inline :97-104 → `create` (reason-preset.service.ts:361) | `createSchema` :37-42 | Y | 201 |
| 3 | PATCH | `/api/reason-presets/reorder` | vT → canEdit | inline :116-123 → `reorder` (:497; tx :505; "TÜM id'ler" sözleşmesi) | `reorderSchema` :55-58 (ids uuid[] ≥1) | Y | yeni sıra |
| 4 | POST | `/api/reason-presets/:id/duplicate` | vT → canEdit | inline :135-144 → `duplicate` (:456; tx :464) | `duplicateSchema` (label opsiyonel); **uuid✗** | Y | 201 |
| 5 | PATCH | `/api/reason-presets/:id` | vT → canEdit | inline :157-166 → `update` (:402; `legacyTexts` sözlüğü) | `updateSchema` :44-49; **uuid✗** | Y (kod/tür değişmez; son aktif satır gizlenemez → 400) | ApiResponse |

Sıra: `/reorder` (:116) `/:id` (:157)'den önce → doğru. `ReasonPresetKind` = ROLL_SCRAP · ROLL_RECORD_CORRECTION · ROLL_MANUAL_ENTRY · ROLL_CANCEL · ORDER_CANCEL · WORK_ORDER_REWORK (schema.prisma:127-144).

### 2.10 `record-info.routes.ts` → `/api/record-info` (1) — dinamik izin

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/record-info/:table/:id` | vT → **dinamik**: `paramsSchema` (:43-47 table regex `^[A-Z_]{3,40}$`, id uuid✓) → `TABLE_PERMISSIONS[table]` (:31-41, 9 anahtar; yoksa 400 **fail-closed** :83-85) → `matchesPermission` (403 :86-88) | inline :74-94 → `recordInfoService.get` | Zod | R | `{created,lastChange,auditEmpty}` |

`TABLE_PERMISSIONS` anahtarları: WORK_ORDER, ORDER, ROLL, SHIPMENT, SACK, CUSTOMER, ITEM, SUBCONTRACTOR_DISPATCH, SUBCONTRACTOR_RECEIPT. Servisteki kolon yolu `PROVENANCE_TABLES` (record-info.service.ts:73-101) ROLL∕SACK∕SUBCONTRACTOR_DISPATCH∕SUBCONTRACTOR_RECEIPT'i İÇERMEZ → `fromColumns` null döner (:145-146) → audit yoluna düşer (6 ayda arşiv → `auditEmpty:true`). Bkz. HOTSPOT H16.

### 2.11 Raporlar — `reports.routes.ts` mount kökü (`/api/reports`, app.ts:572) + 7 alt dosya (21) — hepsi `...guard` = `[vT, P("report:<alan>")]`; hepsi R; hepsi inline

| # | Metod | Tam yol | İzin (spread `guard`) | Handler | Doğrulama | Yanıt |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/reports/audit/system-log-summary` | `report:audit` (audit.routes.ts:19) | :21-29 → `getSystemLogSummary` | `dateRangeSchema` (strict; _shared.ts:22-27) → `resolveDateRange` (boş → son 30 gün; >366 gün → 400) | `reportEnvelope(data, range)` |
| 2 | GET | `/api/reports/audit/user-activity` | `report:audit` | :31-39 → `getUserActivity` | `dateRangeSchema` | envelope |
| 3 | GET | `/api/reports/customer/order-profile` | `report:customer` (customer.routes.ts:20) | :22-29 → `getCustomerOrderProfiles` | — | `{success,data}` |
| 4 | GET | `/api/reports/customer/scorecard` | `report:customer` | :64-74 → `getCustomerScorecard` | `compareRangeSchema` (strict; _shared.ts:86-94) + `resolveCompareRange` | envelope (+compare) |
| 5 | GET | `/api/reports/inventory/scorecard` | `report:inventory` (inventory.routes.ts:16) | :24-31 → `getStockScorecard` (anlık, aralık yok) | — | envelope |
| 6 | GET | `/api/reports/production/batch-search` | `report:production` (production.routes.ts:23) | :50-57 → `searchBatches(q)` | `q` ham string | `{success,data}` (daima ADAY listesi) |
| 7 | GET | `/api/reports/production/batch-trace/:batchId` | `report:production` | :60-71 → `getBatchTrace` | **uuid✗** (ham param) | `{success,data}` ∕ 404 |
| 8 | GET | `/api/reports/production/wip` | `report:production` | :73-81 → `getWipScorecard` | `dateRangeSchema` | envelope |
| 9 | GET | `/api/reports/production/operator-performance` | `report:production` | :91-101 → `getOperatorPerformance(range, limit)` | `dateRangeSchema` + `limit` coerce 1..200 `.catch(50)` | envelope |
| 10 | GET | `/api/reports/production/traveler-trace` | `report:production` | :128-137 → `getTravelerTrace(rollId)` | `traceSchema` (rollId uuid✓) | `{success,data}` ∕ 404 |
| 11 | GET | `/api/reports/quality/scorecard` | `report:quality` (quality.routes.ts:20) | :30-40 → `getQualityScorecard` | `compareRangeSchema` | envelope |
| 12 | GET | `/api/reports/quality/scrap-scorecard` | `report:quality` | :46-56 → `getScrapScorecard` | `compareRangeSchema` | envelope |
| 13 | GET | `/api/reports/quality/plan-deviation-scorecard` | `report:quality` | :66-80 → `getPlanDeviationScorecard` (kaynak `roll_plan_deviations`) | `compareRangeSchema` | envelope |
| 14 | GET | `/api/reports/sales/shipment-scorecard` | `report:sales` (sales.routes.ts:24) | :32-42 → `getShipmentScorecard` | `compareRangeSchema` | envelope |
| 15 | GET | `/api/reports/sales/return-scorecard` | `report:sales` | :44-54 → `getReturnScorecard` | `compareRangeSchema` | envelope |
| 16 | GET | `/api/reports/sales/open-order-coverage` | `report:sales` | :78-85 → `getOpenOrderCoverage` (anlık) | — | envelope |
| 17 | GET | `/api/reports/sales/order-intake` | `report:sales` | :117-127 → `getOrderIntake` | `compareRangeSchema` | envelope |
| 18 | GET | `/api/reports/sales/demand-analysis` | `report:sales` | :161-171 → `getDemandAnalysis` | `compareRangeSchema` | envelope |
| 19 | GET | `/api/reports/sales/order-leadtime` | `report:sales` | :205-214 → `getOrderLeadTime` | `dateRangeSchema` | envelope |
| 20 | GET | `/api/reports/sales/order-cancellation` | `report:sales` | :244-253 → `getOrderCancellationScorecard` | `dateRangeSchema` | envelope |
| 21 | GET | `/api/reports/subcontract/scorecard` | `report:subcontract` (subcontract.routes.ts:18) | :21-31 → `getSubcontractScorecard` | `compareRangeSchema` | envelope |

Not: `production.routes.ts:25-39, 103-110, 139-146` üç `@openapi` bloğu (`/station-efficiency`, `/machine-usage`, `/scrap`) **router satırı olmadan** duruyor; swagger.ts:46-48 `routes/**/*.ts` glob'unu taradığı için `/api-docs` bu üç hayalet ucu yayınlar [VARSAYIM — /api-docs çıktısı üretilmedi]. Bkz. H18.

### 2.12 `return-reason.routes.ts` → `/api/return-reasons` (6) — bare BaseService (autoCode `IADE`)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/return-reasons` | vT → any(`return:read`,`return:write`,`mobile:iade`) | BC.findAll:67 | — | R | sayfalı |
| 2 | GET | `/api/return-reasons/similar-names` | vT → P(`return:write`) | BC.similarNames:49 | — | R | liste |
| 3 | GET | `/api/return-reasons/:id` | vT → any(`return:read`,`return:write`,`mobile:iade`) | BC.findById:79 | uuid✓ | R | ApiResponse |
| 4 | POST | `/api/return-reasons` | vT → P(`return:write`) | BC.create:95 | Zod YOK (DMMF) | Y | 201 |
| 5 | PATCH | `/api/return-reasons/:id` | vT → P(`return:write`) | BC.update:107 | Zod YOK; uuid✓ | Y | ApiResponse |
| 6 | DELETE | `/api/return-reasons/:id` | vT → P(`return:write`) | BC.remove:118 | uuid✓ | D-soft | ApiResponse |

### 2.13 `return.routes.ts` → `/api/returns` (7) — ReturnController → ReturnService

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/returns/lookup` | vT → any(`return:write`,`mobile:iade`) | RC.lookup:41 → `lookupForReturn(barcode)` | `barcode` ham query | R | top + sevkiyat + aday siparişler |
| 2 | GET | `/api/returns/lookup-sack` | aynı | RC.lookupSack:52 → `lookupSackForReturn(code)` | ham query | R | çuval + toplar |
| 3 | POST | `/api/returns` | vT → any(`return:write`,`mobile:iade`) | RC.create:63 → `createReturn` (return.service.ts:481 tx; claim `tx.roll.updateMany` :501; `freezeForSource` :564 **tx içinde**) | `createReturnSchema` :8-24 (rollId ∕ rollIds ≤200 refine; **clientToken YOK**) | Y (SHIPPED→WAREHOUSE + RollReturn + RETURN_DISPATCH belgesi) | 201 |
| 4 | GET | `/api/returns` | vT → any(`return:read`,`return:write`,`mobile:iade`) | RC.list:74 → `listReturns(req)` | — | R | liste + toplam ∕ cursor |
| 5 | GET | `/api/returns/:id` | aynı | RC.getById:84 | uuid✓ (:86) | R | ApiResponse |
| 6 | PATCH | `/api/returns/:id` | vT → any(`return:write`,`mobile:iade`) | RC.edit:95 → `editReturn` | uuid✓ + `editReturnSchema` :31-35 | Y (defter alanları + belge revizyonu) | ApiResponse · 409 iptal |
| 7 | POST | `/api/returns/:id/cancel` | aynı | RC.cancel:111 → `cancelReturn` (tx :879, claim :882) | uuid✓ + `cancelReturnSchema` :26-28 (reason 3..500) | **D** (iade geri alma → top SHIPPED'e döner) | ApiResponse · 409 |

### 2.14 `route.routes.ts` → `/api/routes` (7) — RouteService (ROUTE_SERVICE_CONFIG, nested steps guard)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/routes` | vT → any(`station:read`,`mobile:hizli-is-emri`) | BC.findAll:67 | — | R | sayfalı (adımlar dahil) |
| 2 | GET | `/api/routes/similar-names` | vT → P(`station:write`) | BC.similarNames:49 | — | R | liste |
| 3 | GET | `/api/routes/:id` | vT → any(`station:read`,`mobile:hizli-is-emri`) | BC.findById:79 | uuid✓ | R | ApiResponse |
| 4 | POST | `/api/routes` | vT → P(`station:write`) | BC.create:95 → RouteService (Route + RouteStep + RouteStepProperty) | Zod YOK (DMMF + `assertRouteRefsActive`) | Y | 201 |
| 5 | PATCH | `/api/routes/:id` | vT → P(`station:write`) | BC.update:107 (adım deleteMany+create — önceki envanter §2.8) | Zod YOK; uuid✓ | Y | ApiResponse |
| 6 | DELETE | `/api/routes/:id` | vT → P(`station:write`) | BC.remove:118 | uuid✓ | D-soft | ApiResponse |
| 7 | DELETE | `/api/routes/:id/permanent` | vT → P(`station:write`) | GHR `routeHardRemove` :196 | uuid✓ | **D fiziksel** | 200 ∕ 404 ∕ 409 |

### 2.15 `search.routes.ts` → `/api/search` (1)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/search` | **vT yalnız — RBAC SERVİSTE** (kova başına `matchesPermission`, search.service.ts:74; gerekçe :4-8) | inline :46-63 → `searchService.search(q, {permissions})` | `querySchema` safeParse (:17-20; q 2..100, limit ≤10) — geçersiz → **200 boş sonuç** (:51-54), 400 değil | R | `{term,exact,groups[]}` |

### 2.16 `shipping.routes.ts` → `/api/shipping` (46) — ShippingController; guard sabitleri :10-23

| Sabit | Küme |
|---|---|
| `READ` (:10) | any(`shipping:read`,`shipping:write`,`mobile:tarti-paket`,`mobile:sevkiyat`) |
| `WRITE` (:12) | any(`shipping:write`,`mobile:tarti-paket`,`mobile:sevkiyat`) |
| `ACCOUNTING_READ` (:14) | any(`shipping:read`,`shipping:write`,`report:sales`) |
| `INVOICE_WRITE` (:18) | any(`shipping:invoice`,`shipping:write`) |
| `UNDO_DISPATCH` (:23) | any(`shipping:undo-dispatch`) — tek eleman, `shipping:write` KAPSAMAZ |

`ShippingController` hiçbir handler'da `assertValidUuid` kullanmaz (grep 0) — `:id`/`:rollId`/`:swatchId` ham geçer (uuid✗ tümü); geçersiz uuid Prisma'ya ulaşırsa error.middleware P2023/P2007 → 400 (error.middleware.ts:444-460).

| # | Metod | Tam yol | Zincir | Handler (SC) | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/shipping/open-orders` | vT → READ | openOrders:555 | — | R | açık siparişler + karşılama |
| 2 | GET | `/api/shipping/pool` | vT → READ | listPool:249 | — | R | havuz board |
| 3 | GET | `/api/shipping/pool/sacks` | vT → READ | listCustomerPoolSacks:256 | `customerId` uuid✓ (:258) | R | liste |
| 4 | POST | `/api/shipping/sacks` | vT → WRITE | openSack:117 | `openSackSchema` :12-20 (customerId∕branchId nullable, sackNo ≤64, **clientToken opsiyonel** uuid — `Sack.clientToken @unique`, replay serviste) | Y (Sack) | 201 |
| 5 | POST | `/api/shipping/sacks/:id/scan` | vT → WRITE | scanIntoSack:125 | `scanSchema` :21 (barcode ≤64) | Y (top → çuval; başka çuvaldan TAŞIR) | ApiResponse |
| 6 | POST | `/api/shipping/sacks/:id/add-kartela` | vT → WRITE | addKartelaToSack:133 | `addKartelaSchema` :22-26 | Y | ApiResponse |
| 7 | POST | `/api/shipping/sacks/:id/weigh` | vT → WRITE | weighSack:141 | `weighSackSchema` :27-37 | Y (kg) | ApiResponse |
| 8 | POST | `/api/shipping/sacks/:id/customer` | vT → WRITE | reassignSackCustomer:157 | `reassignSackCustomerSchema` :38-41 | Y | ApiResponse |
| 9 | POST | `/api/shipping/sacks/:id/remove` | vT → WRITE | removeSack:195 → `service.removeSack(id, userId, withContents)` | `removeSackSchema` :42 | **D** (boş çuval FİZİKSEL silme — kök CLAUDE.md bilinçli istisna; `withContents` → içerik depoya) | ApiResponse |
| 10 | GET | `/api/shipping/sacks/:id/notes` | vT → READ | getSackNotes:188 | — | R | not |
| 11 | POST | `/api/shipping/sacks/:id/notes` | vT → WRITE | setSackNotes:180 | `sackNotesSchema` :44 (≤500 nullable) | Y (annotation; durum guard'sız — bilinçli, Swagger :85-89) | ApiResponse |
| 12 | POST | `/api/shipping/rolls/:rollId/remove-from-sack` | vT → WRITE | removeRollFromSack:203 | **gövde/param doğrulaması YOK** | Y | ApiResponse |
| 13 | POST | `/api/shipping/rolls/:rollId/move-sack` | vT → WRITE | moveRollToSack:217 | `moveSackSchema` :57 (sackId uuid) | Y | ApiResponse |
| 14 | POST | `/api/shipping/swatches/:swatchId/remove-from-sack` | vT → WRITE | removeSwatchFromSack:210 | **doğrulama YOK** | Y | ApiResponse |
| 15 | POST | `/api/shipping/sacks/:id/distribute` | vT → WRITE | distributeSack:226 | `distributeSackSchema` :45-48 | Y (çuvalı boşalt → depo) | ApiResponse |
| 16 | POST | `/api/shipping/sacks/:id/move-rolls` | vT → WRITE | moveRollsToSack:238 | `moveRollsSchema` :49-53 | Y | ApiResponse |
| 17 | POST | `/api/shipping/sacks/:id/split` | vT → WRITE | splitSack:169 | `splitSackSchema` :54-56 (rollIds) | Y (yeni çuval; tek tx, atomik claim; 400 kaynak boş kalır; 409 sevkiyatta) | 201 |
| 18 | GET | `/api/shipping/sack-search` | vT → READ | searchSacks:460 | ham query (:472 boş → undefined) | R | liste |
| 19 | POST | `/api/shipping/sack-search/pick-list` | vT → READ | getPickList:529 | inline Zod sackIds 1..200 (:531) | R | çeki özeti |
| 20 | POST | `/api/shipping/sack-search/content-dump` | vT → READ | getContentDump:538 | sackIds 1..200 (:540) | R | top bazlı döküm |
| 21 | GET | `/api/shipping/sacks/:id/contents` | vT → READ | getSackContents:502 | — | R | içerik |
| 22 | POST | `/api/shipping/sacks/mismatch-check` (**YENİ**) | vT → READ | checkSackMismatches:516 | sackIds 1..200 (:520) | R (salt-okunur sinyal) | `sackId → sinyaller` |
| 23 | GET | `/api/shipping/locate-roll` | vT → READ | locateRoll:546 | `barcode` ≤64 (:548) | R | konum |
| 24 | GET | `/api/shipping/sack-store/board` | vT → READ | listSackStoreBoard:416 | — | R | board |
| 25 | GET | `/api/shipping/shipments/:id/sack-contents` | vT → READ | getShipmentSackContents:430 | — | R | BRÜT içerik |
| 26 | GET | `/api/shipping/shipments/:id/dispatch-report` | vT → ACCOUNTING_READ | getDispatchReport:437 | — | R (donmuş snapshot) | fiş |
| 27 | GET | `/api/shipping/direct-shipments/:id/dispatch-report` | vT → ACCOUNTING_READ | getDirectShipmentDispatchReport:444 | — | R | fiş |
| 28 | GET | `/api/shipping/accounting-export` | vT → ACCOUNTING_READ | getAccountingExport:451 | — | R | CSV (BRÜT) |
| 29 | POST | `/api/shipping/shipments/:id/invoice` | vT → INVOICE_WRITE | setShipmentInvoice:328 | `invoiceSchema` :95-98 (invoiceNo ≤64 nullable → null işareti kaldırır) | Y (yalnız DISPATCHED → 400) | ApiResponse |
| 30 | POST | `/api/shipping/direct-shipments/:id/invoice` | vT → INVOICE_WRITE | setDirectShipmentInvoice:341 | `invoiceSchema` | Y | ApiResponse |
| 31 | POST | `/api/shipping/shipments` | vT → WRITE | createShipment:265 → `service.createShipment` (çuval başına updateMany + tahsis + `freezeForSource` tek tx; yorum :61-67 "uygulamanın en uzun tx'i") | `createShipmentSchema` :60-80 (sackIds 1..**500**, customerId uuid, destination, **clientToken opsiyonel**) | Y (PLANNED ya da doğrudan DISPATCHED) | 201 |
| 32 | GET | `/api/shipping/shipments` | vT → READ | listShipments:395 (Shipment + DirectShipment union; groupBy batch tx RepeatableRead shipping.service.ts:2592-2610 salt-okuma) | ham query | R | liste ∕ cursor |
| 33 | POST | `/api/shipping/shipments/preview` | vT → READ | previewCreateShipment:273 | `previewShipmentSchema` :82-87 | R | önizleme |
| 34 | GET | `/api/shipping/direct-shipments/:id` | vT → READ | getDirectShipment:409 | — | R | detay |
| 35 | GET | `/api/shipping/shipments/:id` | vT → READ | getShipment:402 | — | R | detay (BRÜT) |
| 36 | POST | `/api/shipping/shipments/:id/add-sacks` | vT → WRITE | addSacksToShipment:281 | `sackIdsSchema` :88 (1..500) | Y | ApiResponse |
| 37 | POST | `/api/shipping/shipments/:id/remove-sack` | vT → WRITE | removeSackFromShipment:289 | `removeShipmentSackSchema` :89 | Y | ApiResponse |
| 38 | POST | `/api/shipping/shipments/:id/destination` | vT → WRITE | setDestination:297 | `destinationSchema` :90 | Y | ApiResponse |
| 39 | POST | `/api/shipping/shipments/:id/procedure-code` | vT → WRITE | setProcedureCode:305 | `procedureCodeSchema` :91 | Y | ApiResponse |
| 40 | GET | `/api/shipping/shipments/:id/dispatch-note` | vT → READ | getDispatchNote:321 | — | R | not |
| 41 | POST | `/api/shipping/shipments/:id/dispatch-note` | vT → WRITE | setDispatchNote:313 | `dispatchNoteSchema` :92 | Y | ApiResponse |
| 42 | POST | `/api/shipping/shipments/:id/dispatch` | vT → WRITE | dispatchShipment:354 → `service.dispatchShipment` | `dispatchSchema` :99-103 (plaka/şoför/nakliyeci opsiyonel) | **Y kritik** (PLANNED→DISPATCHED, toplar SHIPPED, SackAllocation, belge donar) | ApiResponse |
| 43 | GET | `/api/shipping/shipments/:id/cancel-preview` | vT → READ | cancelPreview:362 | — | R | önizleme |
| 44 | POST | `/api/shipping/shipments/:id/cancel` | vT → WRITE | cancelShipment:369 → `service.cancelShipment(id, userId)` | **gövde YOK — sebep alınmıyor; uuid✗** | **D** (PLANNED sevkiyat iptali; çuvallar havuza, tahsis silinir — `cancelPlannedShipmentTx` tek kaynak, CLAUDE.md 2026-08-22) | ApiResponse |
| 45 | GET | `/api/shipping/shipments/:id/undo-dispatch-preview` | vT → UNDO_DISPATCH | undoDispatchPreview:377 | — | R (canUndo + blockReason) | önizleme |
| 46 | POST | `/api/shipping/shipments/:id/undo-dispatch` | vT → UNDO_DISPATCH | undoDispatch:384 → `service.undoDispatch(id, reason, userId, {releaseSacks})` | `undoDispatchSchema` :106-111 (reason 3..500 ZORUNLU, releaseSacks) | **D STORNO** (DISPATCHED→PLANNED; `releaseSacks` → aynı tx'te CANCELLED; irsaliye sürümleri VOIDED; iade defterine GİRMEZ) | ApiResponse · 409 faturalı∕iadeli∕gün dışı |

### 2.17 `station-capability.routes.ts` → `/api/station-capabilities` (4) — inline; StationCapabilityService

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/station-capabilities` | vT → P(`station:read`) | inline :48-64 → `listAll` ∕ `listAllDetailed` (`?detailed=true`) | — | R | özet ∕ detay |
| 2 | GET | `/api/station-capabilities/for-session` (**YENİ**; "henüz istemcisi yok" :77) | vT → any(`station:read`, MOBILE_SESSION_PERMS×4) | inline :89-103 → `getStampContext(req)` → `getForSession(stamp?.stationId)` | — | R | `{colors,properties[]}` · 400 oturum yok |
| 3 | GET | `/api/station-capabilities/:stationId` | vT → P(`station:read`) | inline :121-133 → `findByStation` | **uuid✗** | R | `{colors,properties}` ∕ 404 |
| 4 | PUT | `/api/station-capabilities/:stationId` | vT → P(`station:write`) | inline :181-199 → `setCapabilities` (tx; replace semantiği; `colorIds` yoksa renk satırlarına DOKUNMAZ — yorum :19-22) | `setCapabilitiesSchema` :18-36 (colorIds?, propertyIds?, properties[]{propertyId, mode AUTO∕OPTIONAL∕REQUIRED}); **uuid✗** | Y (StationColor/StationProperty replace) | güncel yetkinlikler |

### 2.18 `station.routes.ts` → `/api/stations` (8, router `router`) + `/api/machines` (9, router **`machineRouter`**) — StationService (autoCode `IST`) · BaseService machine (autoCode `MAK`, ad tekilliği `stationId` kapsamlı)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/stations` | vT → P(`station:read`) | stationController=BC.findAll:67 | — | R | sayfalı (makineler dahil) |
| 2 | GET | `/api/stations/machines` | vT → P(`station:read`) | machineController=BC.findAll (:113) | — | R | liste |
| 3 | GET | `/api/stations/similar-names` | vT → P(`station:write`) | BC.similarNames (:137) | — | R | liste |
| 4 | GET | `/api/stations/:id` | vT → P(`station:read`) | BC.findById (:139) | uuid✓ | R | ApiResponse |
| 5 | POST | `/api/stations` | vT → P(`station:write`) | BC.create (:170) | Zod YOK | Y | 201 |
| 6 | PATCH | `/api/stations/:id` | vT → P(`station:write`) | BC.update (:203) | Zod YOK; uuid✓ | Y | ApiResponse |
| 7 | DELETE | `/api/stations/:id` | vT → P(`station:write`) | BC.remove (:222) | uuid✓ | D-soft | ApiResponse |
| 8 | DELETE | `/api/stations/:id/permanent` | vT → P(`station:write`) | GHR `stationHardRemove` :106 (:226) | uuid✓ | **D fiziksel** | 200∕404∕409 |
| 9 | GET | `/api/machines/similar-names` | vT → P(`station:write`) | BC.similarNames (:236; `?scope=<stationId>`) | — | R | liste |
| 10 | GET | `/api/machines` | vT → P(`station:read`) | BC.findAll (:254) | — | R | offset ∕ cursor |
| 11 | GET | `/api/machines/resolve` | vT → any(`station:read`, MOBILE_SESSION_PERMS×4) | inline :274-287 → `WorkSessionService.resolveMachineByCode(code)` | `code` ham | R | makine + istasyon ∕ 404 |
| 12 | GET | `/api/machines/:id` | vT → P(`station:read`) | BC.findById (:306) | uuid✓ | R | ApiResponse |
| 13 | GET | `/api/machines/:id/delete-preview` | vT → P(`station:write`) | GHR `machineDeletePreview` :277-315 | uuid✓ (:283) | R | `{deletable,workSessionCount,peripheralDetachCount,blockers}` |
| 14 | POST | `/api/machines` | vT → P(`station:write`) | BC.create (:348) | Zod YOK | Y | 201 |
| 15 | PATCH | `/api/machines/:id` | vT → P(`station:write`) | BC.update (:367) | Zod YOK; uuid✓ | Y | ApiResponse |
| 16 | DELETE | `/api/machines/:id` | vT → P(`station:write`) | BC.remove (:386) | uuid✓ | D-soft | ApiResponse |
| 17 | DELETE | `/api/machines/:id/permanent` | vT → P(`station:write`) | GHR `machineHardRemove` :256 (:411; tx içinde oturum satırları da silinir) | uuid✓ | **D fiziksel** | 200∕404∕409 |

### 2.19 `subcontractor-management.routes.ts` → `/api/subcontractors` (5, **`subcontractorRouter`**) + `/api/subcontractor-categories` (5, **`categoryRouter`** → export adı `subcontractorCategoryRouter`)

| # | Metod | Tam yol | Zincir | Handler (SMC) | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/subcontractors` | vT → any(`subcontractor:read`,`mobile:fason-sevk`,`mobile:fason-kabul`,`mobile:hizli-is-emri`) | findAll:61 → `service.findAll(req)` | — | R | liste |
| 2 | GET | `/api/subcontractors/:id` | aynı | findById:68 | uuid✓ | R | ApiResponse |
| 3 | POST | `/api/subcontractors` | vT → P(`subcontractor:write`) | create:75 | `createSubcontractorSchema` :16-24 | Y (pasif kod → yeniden aktive) | 201 · 409 |
| 4 | PATCH | `/api/subcontractors/:id` | vT → P(`subcontractor:write`) | update:83 | `updateSubcontractorSchema` :26-35 + uuid✓ | Y | ApiResponse |
| 5 | DELETE | `/api/subcontractors/:id` | vT → P(`subcontractor:write`) | remove:91 | uuid✓ | D-soft | ApiResponse |
| 6 | GET | `/api/subcontractor-categories` | vT → any(`subcontractor:read`, MOBILE_FASON_READ×2) | findAll:103 | — | R | liste |
| 7 | GET | `/api/subcontractor-categories/:id` | aynı | findById:110 | uuid✓ | R | ApiResponse |
| 8 | POST | `/api/subcontractor-categories` | vT → P(`subcontractor:write`) | create:117 | `createCategorySchema` :39-45 | Y | 201 |
| 9 | PATCH | `/api/subcontractor-categories/:id` | vT → P(`subcontractor:write`) | update:125 | `updateCategorySchema` :47-54 + uuid✓ | Y | ApiResponse |
| 10 | DELETE | `/api/subcontractor-categories/:id` | vT → P(`subcontractor:write`) | remove:133 | uuid✓ | D-soft | ApiResponse |

`/similar-names` ucu bu iki router'da YOK (diğer yedi master-data dosyasında var).

### 2.20 `subcontractor.routes.ts` → `/api/subcontractor` (23) — SubcontractorController (uuid✗ tümünde: grep 0 `assertValidUuid`)

| # | Metod | Tam yol | Zincir | Handler (SUB) | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/subcontractor/dispatch` | vT → any(`workorder:write`,`mobile:fason-sevk`) | dispatch:200 | `dispatchSchema` :10-24 (rollIds 1..**500**) | Y (FS belge no, AT_SUBCONTRACTOR) | 201 |
| 2 | POST | `/api/subcontractor/dispatch/bulk` | vT → any(`workorder:write`,`subcontractor:write`) | bulkDispatch:211 | `bulkDispatchSchema` :27-38 | Y | 201 |
| 3 | POST | `/api/subcontractor/transfer-next` | vT → any(`workorder:write`,`subcontractor:write`) | transferToNextFason:222 | `transferNextSchema` :41-49 | Y (kabul + sonraki fasona sevk zinciri) | 201 |
| 4 | GET | `/api/subcontractor/fason-ceki-draft` | vT → any(`workorder:read`,`subcontractor:read`) | fasonCekiDraft:233 | `cekiDraftSchema` :52-55 (query'den) | R | `{html}` TASLAK |
| 5 | PATCH | `/api/subcontractor/dispatches/:id/instruction` | vT → any(`workorder:write`,`mobile:fason-sevk`) | updateInstruction:247 | `updateInstructionSchema` :57-60 | Y (canlı kolon) | ApiResponse · 409 iptal |
| 6 | POST | `/api/subcontractor/receive` | vT → any(`workorder:write`,`mobile:fason-kabul`) | receive:286 → `service.receive` | `receiveSchema` :106-170 (returns 1..**300**, newRolls 1..**300**, `clientToken` nullish uuid, `expectedTargetColorId`, `planColorAction`) | Y (kısmi kabul; makbuz; SUBCONTRACTOR_CONSUMED; yeni toplar; RollVariance çekme) | 201 · 409 `TARGET_COLOR_CHANGED` |
| 7 | POST | `/api/subcontractor/close-remainder` (**YENİ**) | vT → any(`workorder:write`,`mobile:fason-kabul`) | closeRemainder:322 | `closeRemainderSchema` :92-97 (reasonCode ZORUNLU ≤64) | **D** (fire: top SUBCONTRACTOR_CONSUMED + RollVariance SCRAP `SUBCONTRACTOR_REMAINDER`) | 200 · 409 yarış |
| 8 | GET | `/api/subcontractor/pending-returns` | vT → any(`workorder:read`, MOBILE_FASON_READ×2) | pendingReturns:341 | ham query | R | gruplar |
| 9 | GET | `/api/subcontractor/pending-returns/step/:stepId` | aynı | pendingReturnDetail:354 | uuid✗ | R | detay |
| 10 | GET | `/api/subcontractor/dispatches` | aynı | listDispatches:364 (elle query parse :367-395) | ham | R | liste ∕ cursor |
| 11 | GET | `/api/subcontractor/dispatches/:id` | aynı | getDispatch:406 | uuid✗ | R | detay |
| 12 | GET | `/api/subcontractor/dispatches/:id/dye-overlay` | aynı | getDispatchDyeOverlay:416 | uuid✗ | R | canlı talimat alanları |
| 13 | POST | `/api/subcontractor/dispatches/:id/cancel` | vT → any(`workorder:write`,`mobile:fason-sevk`) | cancelDispatch:263 | `cancelDispatchSchema` :62-64 (reason 3..500) | **D** (soft cancel; toplar STOCK; kabul yapılmışsa 409) | ApiResponse |
| 14 | POST | `/api/subcontractor/dispatches/cancel-bulk` | aynı | cancelDispatchBulk:275 | `cancelDispatchBulkSchema` :66-69 (dispatchIds 1..50) | **D parçalı** (sevk başına ayrı tx, `failed[]` — bilinçli) | `{cancelled,cancelledNos,failed[]}` |
| 15 | GET | `/api/subcontractor/dispatches/:id/direct-ship-preview` | vT → any(`workorder:write`,`mobile:fason-sevk`) (önizleme WRITE izniyle) | getDirectShipPreview:482 | uuid✗ | R | önizleme |
| 16 | POST | `/api/subcontractor/dispatches/:id/direct-ship` | aynı | directShip:493 → `executeDirectShip` | `directShipSchema` :71-90 (rollIds ≤500, rollShipQtys, orderLineAllocations ≤200, completeWorkOrder) | **Y/D** (DirectShipment + irsaliye; toplar SHIPPED; WO kapanabilir) | 200 · 409 |
| 17 | GET | `/api/subcontractor/dispatches/:id/undo-transfer-preview` | vT → any(`workorder:write`,`subcontractor:write`) | getUndoTransferPreview:517 | uuid✗ | R | önizleme |
| 18 | POST | `/api/subcontractor/dispatches/:id/undo-transfer` | aynı | undoTransfer:528 | `cancelDispatchSchema` (reason) | **D** (aktarım geri alma: sevk + kaynak kabul iptali) | 200 · 409 |
| 19 | GET | `/api/subcontractor/receipts` | vT → any(`workorder:read`, MOBILE_FASON_READ×2) | listReceipts:426 | ham (cancellable yes∕no) | R | liste |
| 20 | GET | `/api/subcontractor/receipts/:id/print` | aynı | getReceiptPrint:451 | uuid✗ | R | baskı snapshot |
| 21 | GET | `/api/subcontractor/receipts/:id` | aynı | getReceipt:461 | uuid✗ | R | detay |
| 22 | POST | `/api/subcontractor/receipts/:id/cancel` | vT → any(`workorder:write`,`mobile:fason-kabul`) | cancelReceipt:540 | `cancelReceiptSchema` :99-104 (reason, cascadeRollIds — önizlemeyle birebir, eksik/fazla → 409) | **D** (kabul iptali; orijinal toplar AT_SUBCONTRACTOR'a döner, doğan toplar CANCELLED) | 200 · 409 |
| 23 | GET | `/api/subcontractor/receipts/:id/cancel-preview` | aynı (WRITE izniyle önizleme) | getCancelPreview:471 | uuid✗ | R | önizleme (`allSafe`, `batchMismatch`) |

Sıra notu: `POST /dispatches/cancel-bulk` (:444) `POST /dispatches/:id/cancel` (:408)'den sonra ama segment sayıları farklı; `GET /dispatches/:id` (:346) yalnız GET olduğu için POST `cancel-bulk` ile çakışmaz.

### 2.21 `swatch.routes.ts` → `/api/swatches` (3) — handler **TamburController** (tambur.controller.ts)

| # | Metod | Tam yol | Zincir | Handler (TC) | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/swatches` | vT → any(`quality:read`,`kartela:read`,`mobile:tambur`,`mobile:tarti-paket`,`mobile:depo`) | listSwatches:534 | ham query (limit `Number()`) | R | legacy ∕ cursor |
| 2 | GET | `/api/swatches/stats` | aynı | getSwatchStats:551 | ham | R | `{count,totalLength}` |
| 3 | GET | `/api/swatches/by-barcode/:barcode` | vT → any(`quality:read`,`kartela:read`,`mobile:tarti-paket`,`mobile:depo`) (mobile:tambur YOK) | getSwatchByBarcode:431 | `.trim()` | R | kartela ∕ not-found |

### 2.22 `tambur.routes.ts` → `/api/tambur` (22) — TamburController (TamburService · TamburUndoService · KursunBypassService) + TamburManualController (`/manual/*`)

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Oturum | Y? | Yanıt |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/tambur/pending-rolls` | vT → any(`quality:read`,`mobile:tambur`) | TC.getPendingRolls:476 | — | — | R | liste |
| 2 | GET | `/api/tambur/recent-output-rolls` | aynı | TC.listRecentOutputRolls:399 | `recentOutputFilterSchema` :169-186 (itemId/createdMachineId/createdById uuid) | — | R | liste ∕ cursor |
| 3 | GET | `/api/tambur/by-card/:barcode` | aynı | TC.getByCardBarcode:488 | ham | — | R | adım özeti |
| 4 | GET | `/api/tambur/step/:stepId` | aynı | TC.getStep:443 | uuid✗ | — | R | adım |
| 5 | GET | `/api/tambur/open-cards` | aynı | TC.listOpenCards:464 | — | — | R | kartlar |
| 6 | POST | `/api/tambur/report-error` | vT → any(`quality:write`,`mobile:tambur`) | TC.reportError:453 | `reportErrorSchema` :73-78 | — | Y (RollError) | 201 |
| 7 | GET | `/api/tambur/rolls/:rollId` | vT → any(`quality:read`,`mobile:tambur`) | TC.getRollForDecision:501 | uuid✗ | — | R | top + hatalar ∕ 404 |
| 8 | GET | `/api/tambur/rolls/:rollId/undo-preview` | vT → any(`quality:read`,`mobile:tambur`,`mobile:tambur-duzelt`) | TC.getUndoPreview:241 → TamburUndoService | rollId uuid✓ (:243) + `undoQuerySchema` :194-197 | — | R | önizleme (blockReason) |
| 9 | POST | `/api/tambur/rolls/:rollId/undo` | vT → any(`quality:write`,`mobile:tambur`,`mobile:tambur-duzelt`) | TC.applyUndo:258 | rollId uuid✓ + `undoApplySchema` :188-191 (mode SINGLE∕SINGLE_RESTORE∕FULL∕MANUAL; verilmezse EN DAR) | — | **D** (parça iptali ∕ tam geri alma; WO dirilir) | 200 · 409 |
| 10 | POST | `/api/tambur/finalize` | vT → any(`quality:write`,`mobile:tambur`) | TC.finalize:517 | `finalizeSchema` :29-71 (cuts ≤**200**, length ≤100.000, decisions, confirmMismatch) | **zorunlu (mobil)** :521 | Y (roll split; global barkod sayacı) | 200 · 409 `PLAN_MISMATCH` |
| 11 | GET | `/api/tambur/context/:cardBarcode` | vT → any(`quality:read`,`mobile:tambur`) + **dinamik** `allowEmptyStep` (`mobile:tambur-duzelt` ∨ `roll:manual-adjust`, :369-372) | TC.getTamburContext:361 | ham | — | R | context (`bypassPending`, `emptyStep`) |
| 12 | POST | `/api/tambur/bypass-complete` | vT → any(`quality:write`,`mobile:tambur`) | TC.completeKursunBypass:380 → KursunBypassService.completeFromTambur | `bypassCompleteSchema` :154-160 (rollIds ≥1 kapsam sözleşmesi) | **zorunlu (mobil)** :386 | Y (kurşun adımı COMPLETED; idempotent `alreadyDone`) | 200 · 409 kapsam |
| 13 | POST | `/api/tambur/manual/bring-preview` | vT → any(`roll:manual-adjust`,`mobile:tambur-duzelt`) | TMC.getBringPreview:164 | `bringPreviewSchema` :29-34 | **zorunlu (mobil)** :167 | R (POST) | önizleme |
| 14 | POST | `/api/tambur/manual/bring` | aynı | TMC.bringRoll:181 → WorkOrderManualMoveService | `bringSchema` :36-46 (reason 3..500) | zorunlu :184 | Y (manuel taşıma; VOID kararlar) | 200 · 409 `MOVE_REJECTED` |
| 15 | POST | `/api/tambur/manual/send-to-dye-preview` (**YENİ**) | aynı | TMC.getSendToDyePreview:198 | `sendToDyePreviewSchema` :51-53 | zorunlu :201 | R (POST) | önizleme |
| 16 | POST | `/api/tambur/manual/send-to-dye` (**YENİ**) | aynı | TMC.sendToDye:215 | `sendToDyeSchema` :55-64 | zorunlu :218 | Y (önceki boya adımına taşıma; AT_SUBCONTRACTOR YAPMAZ) | 200 · 409 |
| 17 | POST | `/api/tambur/manual/roll` | aynı | TMC.createManualRoll:232 | `manualRollSchema` :69-108 (**clientToken ZORUNLU**, initialQty ≤999.999, reason, reasonCode, batchId) | zorunlu :235 | Y (yeni Roll `MANUAL_ENTRY` — "envanter zincirindeki tek delik") | 201 · 409 token çakışması |
| 18 | POST | `/api/tambur/manual/produce` | aynı | TMC.produceFinishedRoll:253 | `produceSchema` :110-148 (**clientToken ZORUNLU**, itemId zorunlu) | zorunlu :256 | Y (kartsız WAREHOUSE topu; `idempotentReplay`) | 201 · 409 |
| 19 | POST | `/api/tambur/:id/cut` | vT → any(`quality:write`,`mobile:tambur`) | TC.cutOpenFabric:323 | `cutOpenFabricSchema` :80-110 (status enum, clientToken opsiyonel, confirmMismatch); uuid✗ | opsiyonel :328 | Y (child Roll barkodlu) | 201 |
| 20 | POST | `/api/tambur/:id/finalize-open-fabric` | aynı | TC.finalizeOpenFabric:342 | `finalizeOpenFabricSchema` :112-130 (export; scrapRemaining, foldType, varianceReason*) ; uuid✗ | **zorunlu (mobil)** :347 | **D/Y** (parent TAMBUR_CONSUMED; kalan fire) | 200 |
| 21 | POST | `/api/tambur/:id/cut-warehouse` | aynı | TC.cutWarehouseRoll:279 | `cutWarehouseRollSchema` :132-149 (cutLength ≤100.000, rawDestination, clientToken opsiyonel); uuid✗ | opsiyonel (:283-287 yorum: bilinçli) | Y (depo topundan child) | 201 |
| 22 | POST | `/api/tambur/:id/finalize-warehouse-cut` | aynı | TC.finalizeWarehouseCut:302 | `finalizeWarehouseCutSchema` :199-207 (remainingAction, varianceReason*); uuid✗ | opsiyonel :308 | **D/Y** (parent arşiv + kalan kararı) | 200 |

### 2.23 `traveler-card.routes.ts` — iki router: **`workOrderTravelerRouter`** (`Router({mergeParams:true})`, mount workorder.routes.ts:15 → `/api/work-orders/:id/traveler-cards`) + **`travelerCardRouter`** (default export → `/api/traveler-cards`, app.ts:518) (10)

| # | Metod | Tam yol | Zincir | Handler (TCC) | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/work-orders/:id/traveler-cards` | vT → P(`workorder:write`) | print:99 → `service.print` (traveler-card.service.ts:208) | gövde yok; uuid✗ (`:id` mergeParams) | Y (ACTIVE kart; varsa 409) | 201 |
| 2 | POST | `/api/work-orders/:id/traveler-cards/reprint` | vT → P(`workorder:write`) | reprint:109 → `service.reprint` (:258) | `reprintSchema` :47-49 (reason 3..500); uuid✗ | Y (eski REPRINTED, yeni ACTIVE; snapshot tazelenir) | 201 |
| 3 | GET | `/api/work-orders/:id/traveler-cards/history` | vT → P(`workorder:read`) | getHistory:164 (:773) | uuid✗ | R | kart + scan geçmişi |
| 4 | POST | `/api/traveler-cards/sample-html` | vT → any(DOCUMENT_DESIGN_READ = `admin:settings`,`document-template:read`,`document-template:write`) | getSampleHtml:217 | `sampleHtmlSchema` :36-45 (export; config record, template{mode,html ≤200k}) | R (render; html sanitize render yolunda) | `text/html` |
| 5 | GET | `/api/traveler-cards` | vT → any(`workorder:read`,`mobile:kk1`,`mobile:fason-sevk`,`mobile:hizli-is-emri`) | list:89 → `service.list(req)` (:647) | — | R | sayfalı |
| 6 | POST | `/api/traveler-cards/scan` | vT → P(`workorder:write`) | scan:139 (:529) | `scanSchema` :55-61 (barcode, stationId uuid, scanType enum) | Y (TravelerCardScan) | 201 · 404 |
| 7 | GET | `/api/traveler-cards/by-barcode/:barcode` | vT → any(`workorder:read`,`mobile:fason-kabul`,`mobile:fason-sevk`) | findByBarcode:150 (:729) | ham | R | detay ∕ 404 |
| 8 | GET | `/api/traveler-cards/:id/html` | vT → any(`workorder:read`,`workorder:write`,`mobile:kk1`,`mobile:fason-sevk`,`mobile:hizli-is-emri`) | getCardHtml:185 → `service.getCardHtml` (:999; yalnız okuma + `resolvePrintPlan`) | `pageSize` A4∕A5 (geçersiz sessiz), `version` int (geçersiz → 404); uuid✗ | R (yan etkisiz — CLAUDE.md sözleşmesi) | `text/html` |
| 9 | POST | `/api/traveler-cards/:id/print-event` | aynı küme (html ile BİREBİR, yorum :296-297) | recordPrintEvent:204 → `service.recordPrintEvent` (:349: tx kart update + `archivePrintedVersionTx`; plan değiştiyse `version++`) | gövde yok; uuid✗ | Y (contentDirty=false, printedAt, snapshot, versiyon defteri) | 200 · 404 |
| 10 | POST | `/api/traveler-cards/:id/void` | vT → P(`workorder:write`) | voidCard:124 (:482) | `voidSchema` :51-53; uuid✗ | **D** (VOIDED) | 200 |

### 2.24 `traveler-template.routes.ts` → `/api/traveler-templates` (8) — inline; `travelerTemplateService`

| # | Metod | Tam yol | Zincir | Handler | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/traveler-templates` | vT → any(DOCUMENT_DESIGN_READ×3) | inline :49-55 → `list` | — | R | liste |
| 2 | POST | `/api/traveler-templates/inspect` | vT → any(DOCUMENT_DESIGN_READ) | inline :65-72 → `inspect(html)` (senkron) | `z.object({html ≤200.000})` | R | `{success,data}` |
| 3 | GET | `/api/traveler-templates/:id` | vT → any(DOCUMENT_DESIGN_READ) | inline :82-89 → `findById` | uuid✓ (:84) | R | şablon |
| 4 | POST | `/api/traveler-templates` | vT → any(DOCUMENT_DESIGN_WRITE = `admin:settings`,`document-template:write`) | inline :99-106 → `create` (service:103; `sanitizeTemplateHtml`) | `upsertSchema` :32-39 | Y | 201 |
| 5 | PATCH | `/api/traveler-templates/:id` | vT → any(DOCUMENT_DESIGN_WRITE) | inline :116-124 → `update` (:141) | uuid✓ + `upsertSchema` | Y | ApiResponse |
| 6 | POST | `/api/traveler-templates/:id/default` | vT → any(DOCUMENT_DESIGN_WRITE) | inline :134-141 → `setDefault` (:192; tx :193; partial unique `isDefault=true`) | uuid✓ | Y | ApiResponse |
| 7 | DELETE | `/api/traveler-templates/default` | vT → any(DOCUMENT_DESIGN_WRITE) | inline :151-157 → `clearDefault` (:221) | — | Y | ApiResponse |
| 8 | DELETE | `/api/traveler-templates/:id` | vT → any(DOCUMENT_DESIGN_WRITE) | inline :167-174 → `remove` (:245; soft) | uuid✓ | D-soft | ApiResponse |

Sıra: `DELETE /default` (:151) `DELETE /:id` (:167)'den önce → doğru.

### 2.25 `work-session.routes.ts` → `/api/work-sessions` (8) — WorkSessionController (static) → WorkSessionService / WorkSessionActivityService

| # | Metod | Tam yol | Zincir | Handler (WSC) | Doğrulama | Cihaz | Y? | Yanıt |
|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/work-sessions` | vT → any(MOBILE_SESSION_PERMS×4) | open:49 → `WorkSessionService.open` (tx :273; claim `updateMany` :275-294; P2002 → 409 `SESSION_RACE` :314-317; 409 `MACHINE_OCCUPIED` :226 → `confirmTakeover`) | `openSchema` :16-24 (machineId XOR stationId refine) | **zorunlu** (`requireDevice` :38-46 → 400 `DEVICE_REQUIRED`) | Y | 201 · 409 |
| 2 | POST | `/api/work-sessions/close` | aynı | close:67 → `closeForDevice(…,"LOGOUT")` | — | zorunlu | Y (idempotent) | `{closed}` |
| 3 | GET | `/api/work-sessions/current` | aynı | current:77 → `WorkSessionService.current(device.id, userId)` | — | zorunlu | **R+Y** (öz-onarım: başka kullanıcının kalıntı oturumu `NEW_LOGIN` ile kapatılır — yorum :80; helper örneği work-session.helper.ts:98-104) | `{active,lastPlace}` |
| 4 | GET | `/api/work-sessions/places` | aynı | places:88 | — | — | R | istasyon + makine listesi |
| 5 | GET | `/api/work-sessions/active` | vT → P(`admin:settings`) | listActive:100 | — | — | R | aktif oturumlar |
| 6 | GET | `/api/work-sessions` | vT → any(`admin:settings`,`admin:users`) | history:109 | `historySchema` :26-35 (pageSize ≤100) | — | R | sayfalı |
| 7 | GET | `/api/work-sessions/:id/activity` | aynı | activity:119 → `WorkSessionActivityService.list` | uuid✓ (:121) | — | R | `{session,summary,events[],truncated}` |
| 8 | POST | `/api/work-sessions/:id/force-close` | vT → P(`admin:settings`) | forceClose:129 | uuid✓ (:131) | — | Y (başkasının oturumunu kapatır) | 200 · 409 |

### 2.26 `workorder.routes.ts` → `/api/work-orders` (42 + `router.use("/:id/traveler-cards")` :15) — WorkOrderController (uuid✗ tüm `:id` param'larında: grep 0 `assertValidUuid`)

| # | Metod | Tam yol | Zincir | Handler (WC) | Doğrulama | Y? | Yanıt |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/work-orders` | vT → any(`workorder:read`,`mobile:fason-sevk`,`mobile:hizli-is-emri`) | findAll:438 | — | R | sayfalı |
| 2 | GET | `/api/work-orders/check-batch-number` | vT → any(`workorder:read`,`workorder:write`,`mobile:hizli-is-emri`) | checkBatchNumber:454 (`batchNumber`∕`workOrderNumber` köprü) | ham query | R | `{workOrderNumber,batchNumber,available}` |
| 3 | GET | `/api/work-orders/:id` | vT → any(`workorder:read`,`mobile:fason-sevk`,`mobile:hizli-is-emri`) | findById:474 | uuid✗ | R | ApiResponse ∕ 404 |
| 4 | GET | `/api/work-orders/:id/branches` | vT → any(`workorder:read`,`mobile:hizli-is-emri`) | getBranches:490 | uuid✗ | R | dal listesi |
| 5 | GET | `/api/work-orders/:id/batches/:batchId/timeline` | aynı | getBatchTimeline:507 | uuid✗ ×2 | R | zaman çizelgesi |
| 6 | GET | `/api/work-orders/:id/split-preview` | vT → P(`workorder:read`) | getSplitPreview:526 | `batchId` query zorunlu (400) | R | önizleme |
| 7 | POST | `/api/work-orders/:id/split` | vT → P(`workorder:write`) | splitBranch:544 | `splitBranchSchema` :111-121 (mode, rollIds ≤500) | Y (yeni WO; toplar + açık sevk taşınır) | 201 |
| 8 | POST | `/api/work-orders/:id/manual-move-preview` | vT → P(`workorder:read`) | getManualMovePreview:558 | `manualMovePreviewSchema` :124-132 | R (POST) | önizleme |
| 9 | POST | `/api/work-orders/:id/manual-move` | vT → P(`workorder:write`) | manualMove:571 → WorkOrderManualMoveService | `manualMoveSchema` :134-148 (reason 3..500, partyMode) | Y (süpervizör override; kalite/kurşun VOID; SKIPPED→PENDING; CANCELLED/SUPERSEDED WO → 409) | 200 |
| 10 | GET | `/api/work-orders/:id/travel-card` | vT → any(`workorder:read`,`mobile:hizli-is-emri`) | getTravelCard:829 | uuid✗ | R | kart verisi |
| 11 | GET | `/api/work-orders/:id/manifest` | aynı | getManifest:845 | uuid✗ | R | çeki verisi |
| 12 | POST | `/api/work-orders/:id/manifest` | vT → any(`workorder:write`,`mobile:hizli-is-emri`) | createManifest:862 | **Zod YOK** (`notes` typeof :864); uuid✗ | Y (kalıcı Manifest snapshot; her çağrı yeni kayıt) | 201 |
| 13 | GET | `/api/work-orders/:id/manifests` | vT → any(`workorder:read`,`mobile:hizli-is-emri`) | listManifests:880 | uuid✗ | R | liste |
| 14 | GET | `/api/work-orders/manifest-by-id/:manifestId` | aynı | getManifestById:893 | uuid✗ | R | snapshot |
| 15 | POST | `/api/work-orders` | vT → P(`workorder:write`) | create:407 → `WorkOrderService.create` (clientToken P2002 replay workorder.service.ts:1085-1096, `resolveCreateTokenReplay` :1141-1154) | `createSchema` :81 (`workOrderCoreShape` :18-75 + `hasRoute` refine; **clientToken opsiyonel** uuid :22; steps[].dispatchWithoutColor) | Y (WO + adımlar + kart) | 201 (+ `warnings` rota kapsaması) |
| 16 | POST | `/api/work-orders/quick-start` | vT → any(`workorder:write`,`mobile:hizli-is-emri`) | quickStart:422 → `service.quickStart` | `quickStartSchema` :89-105 (rollBarcodes 1..**300**, dispatchFirstStep, clientToken opsiyonel) | Y (WO + attach + opsiyonel fason sevk; hiç top bağlanamazsa geri alınır) | 201 · 409 |
| 17 | PATCH | `/api/work-orders/:id` | vT → any(`workorder:write`,`mobile:hizli-is-emri`) | update:589 | `updateWorkOrderSchema` :277-292 (+`confirmPartial`) | Y (COMPLETED/CANCELLED → 409; renk bekçisi) | 200 · 409 |
| 18 | PUT | `/api/work-orders/:id` | aynı | replace:609 | `replaceWorkOrderSchema` :295-348 | Y (drop-and-recreate: Step/OrderLine/TargetProperty) | 200 · 409 |
| 19 | PATCH | `/api/work-orders/:id/steps/:stepId/planning` | vT → P(`workorder:write`) | updateStepPlanning:627 | `updateStepPlanningSchema` :218-223 | Y | 200 |
| 20 | PATCH | `/api/work-orders/:id/lock` | vT → P(`workorder:write`) | lockWorkOrder:789 → `service.lockWorkOrder` | gövde yok; uuid✗ | Y (durum geçişi) | 200 |
| 21 | GET | `/api/work-orders/:id/linkable-order-lines` (**YENİ**) | vT → any(`workorder:read`,`workorder:write`,`mobile:hizli-is-emri`) | getLinkableOrderLines:645 → workOrderLinkService | uuid✗ | R | aday satırlar |
| 22 | POST | `/api/work-orders/:id/order-links` (**YENİ**) | vT → any(`workorder:write`,`mobile:hizli-is-emri`) | linkOrderLines:655 | `linkOrderLinesSchema` :226-230 (≥1) | Y (bağ; STOK→ORDER_PRODUCTION aynı tx, `typeChanged`) | 200 · 400 |
| 23 | POST | `/api/work-orders/:id/order-links/override` (**YENİ**) | vT → **P(`workorder:write`) → P(`roll:manual-adjust`)** (AND, :600-601) | linkOrderLineWithOverride:670 (permissions servise geçer) | `linkOrderLineOverrideSchema` :232-235 | Y (plan + toplar + bağ zinciri; **tek tx DEĞİL** — bilinçli) | `{changedColor,changedWidth,rollsUpdated,rollsFailed[],linked,warnings}` |
| 24 | DELETE | `/api/work-orders/:id/order-links/:orderLineId` (**YENİ**) | vT → P(`workorder:write`) | unlinkOrderLine:687 | gövde yok; uuid✗ ×2 | Y (son bağ → STOK; hedef kumaşsız → 400) | 200 |
| 25 | PATCH | `/api/work-orders/:id/target-color` (**YENİ**) | vT → P(`workorder:write`) | changeTargetColor:753 → workOrderLinkService | `changeTargetColorSchema` :238-250 (reason 3..500, confirmPartial, recolorRollIds ≤5000) | Y (tek bekçi `workorder-target-color.helper`; 409 `COLOR_PARTIAL_CONFIRM`∕`COLOR_DYED_BLOCKED`) | 200 (+warnings) |
| 26 | GET | `/api/work-orders/:id/roll-attribute-targets` (**YENİ**) | vT → P(`workorder:read`) | getRollAttributeTargets:726 | uuid✗ | R | parti → top listesi |
| 27 | POST | `/api/work-orders/:id/apply-attribute-to-rolls` (**YENİ**) | vT → any(`roll:manual-adjust`,`workorder:write`) | applyAttributeToRolls:736 (izinler motora geçer) | `applyAttributeSchema` :265-270 (rollIds ≥1 — **üst tavan YOK**, width ≤1000, reason) | Y (top başına tekil düzeltme motoru; kısmi başarı) | `{updated,failed[]}` |
| 28 | PATCH | `/api/work-orders/:id/width` (**YENİ**) | vT → any(`workorder:write`,`mobile:fason-kabul`) | changeWidth:770 | `changeWidthSchema` :271-275 (source MANUAL∕FASON_RECEIPT) | Y | 200 |
| 29 | GET | `/api/work-orders/:id/rolls` | vT → any(`workorder:read`,`mobile:hizli-is-emri`) | getAttachedRolls:804 | uuid✗ | R | toplar |
| 30 | GET | `/api/work-orders/:id/documents` | vT → any(`workorder:read`,`workorder:write`,`mobile:hizli-is-emri`,`mobile:fason-sevk`,`mobile:fason-kabul`) | getDocuments:816 (dört kaynak birleşik; iptal belgeler `cancelled:true`) | uuid✗ | R (liste izni; baskı kapısı DOC_PERMISSIONS'ta) | belge listesi |
| 31 | GET | `/api/work-orders/:id/cancel-impact` | vT → any(`workorder:write`,`mobile:hizli-is-emri`) (önizleme WRITE izniyle) | cancelImpact:906 | uuid✗ | R | etki |
| 32 | GET | `/api/work-orders/:id/complete-preview` | vT → P(`workorder:write`) | completePreview:1013 | uuid✗ | R | `dispositionRolls`,`blockedRolls`,`canComplete` |
| 33 | GET | `/api/work-orders/:id/fason-quick-receive` (**YENİ**) | vT → any(`workorder:write`,`subcontractor:read`) | fasonQuickPreview:701 → workOrderFasonQuickService | uuid✗ | R | `{groups[],orphanRolls[]}` |
| 34 | POST | `/api/work-orders/:id/fason-quick-receive` (**YENİ**) | vT → P(`subcontractor:write`) (mal kabulü — yorum :923-924) | fasonQuickApply:711 | `fasonQuickSchema` :253-263 (mode ONE_TO_ONE∕MERGE, overrides pieces ≤200) | Y (fason kabul motoru → stok yaratır) | `{receipts,newRolls}` |
| 35 | POST | `/api/work-orders/:id/complete` | vT → P(`workorder:write`) + **dinamik**: `dispositions` doluysa `roll:manual-adjust` (WC:1034-1039) | completeWorkOrder:1031 → `service.completeWorkOrder` | `completeSchema` :200-216 (dispositions ≤200, action 6'lı enum, qualityGradeId, transferOrderMode) | **D** (COMPLETED + kapanış dispozisyonu; fason hard-block; kapsam birebir → 400) | 200 · 403 · 409 |
| 36 | POST | `/api/work-orders/:id/cancel` | vT → any(`workorder:write`,`mobile:hizli-is-emri`) + **dinamik**: STOCK dışı dispozisyon ∨ `fasonAction=SCRAP` → `roll:manual-adjust` (:949-956) | cancelWorkOrder:941 → `service.softDelete(id, userId, body)` (workorder.service.ts:3295) | `cancelSchema` :151-178 (reason 3..500 ZORUNLU, reasonCode, fasonAction, dispositions ≤200) | **D** (WO CANCELLED; toplar STOCK∕SCRAP∕CANCELLED) | 200 · 403 · 409 |
| 37 | GET | `/api/work-orders/:id/batches/:batchId/drop-preview` | vT → P(`workorder:write`) | batchDropPreview:969 | uuid✗ ×2 | R | önizleme |
| 38 | POST | `/api/work-orders/:id/batches/:batchId/drop` | vT → P(`workorder:write`) + **dinamik** `roll:manual-adjust` (:989-996) | dropBatch:985 → `service.dropBatch` | `batchDropSchema` :180-198 (≤200) | **D** (parti üyeliği kopar; `noLiveRollsRemain`) | 200 · 409 |
| 39 | DELETE | `/api/work-orders/:id` | vT → any(`workorder:write`,`mobile:hizli-is-emri`) | softDelete:919 → `service.softDelete(id, userId)` (input varsayılan `{}` :3298 → toplar STOCK) | gövde yok; uuid✗ | **D** (eski APK yolu — "AYNEN KALIR" :1031-1033) | 200 |
| 40 | DELETE | `/api/work-orders/:id/permanent` | vT → P(`workorder:write`) | hardDelete:1056 → `service.hardDelete` (workorder.service.ts:4266: **ARŞİV** — `isActive=false`, atomik claim `updateMany WHERE isActive AND status≠IN_PROGRESS` + `count===0 → 409`; fiziksel DEĞİL; Swagger :1041-1044 "fiziksel siler" der) | uuid✗ | D (arşiv + toplar STOCK'a) | 200 · 409 |
| 41 | GET | `/api/work-orders/:id/target-properties/impact` | vT → P(`workorder:read`) | getTargetPropertiesImpact:1072 | uuid✗ | R | sayılar |
| 42 | PATCH | `/api/work-orders/:id/target-properties` | vT → P(`workorder:write`) | updateTargetProperties:1085 | `targetPropertiesSchema` :107-109 (propertyIds uuid[]) | Y (replace + bağlı Roll.properties senkronu) | 200 |

Sıra notları: `/check-batch-number` (:75) ve `/quick-start` (POST :387) sabit segmentli; `/manifest-by-id/:manifestId` (:296) `/:id/<sabit>` kalıplarıyla çakışmaz (ikinci segment eşleşmez). `/:id/traveler-cards` mount'u (:15) ilk satırda.

---

## 3. KAPISIZ ROTALAR

| Tam yol | Kaynak zinciri (6 kaynak çözüldü) | Meşruiyet (koddaki gerekçe) |
|---|---|---|
| `GET /api/mobile/updates/ota/:runtimeVersion/manifest` | route satırında guard YOK (mobile-update.routes.ts:44) · dizi/tekil sabit yok · `router.use` yok · app.ts:583 mount guard'sız · global yalnız `resolveDevice` (:169, engel değil) · handler içi izin yok | Tablet güncellemeyi giriş ekranından ÖNCE sorar (dosya :19-21; app.ts:578-582). Girdi guard'ı: runtimeVersion regex (service:104), yol kök-altı kontrolü (service:70-74). |
| `GET /api/mobile/updates/{*yol}` | aynı (:69) | aynı gerekçe; APK dahil depo dosyaları kimliksiz servis edilir (bilinçli). Dizin listeleme yok (:93). |

**Yalnız `verifyToken` (route'ta RBAC yok — hepsi gerekçeli):** `GET /api/reason-presets` (reason-preset.routes.ts:73; gerekçe :8-10) · `GET /api/search` (search.routes.ts:46; izin serviste :74) · `GET /api/record-info/:table/:id` (record-info.routes.ts:74; izin handler içinde tablo bazlı, fail-closed).

**Ters yön — SALT-OKUMA ucu WRITE izniyle kapılı (bilinçli, ama liste):** `/api/orders/:id/cancel-preview` (order:write) · yedi `similar-names` ucu (write izni, gerekçe "yalnız kayıt açana lazım") · `/api/work-orders/:id/cancel-impact`, `/complete-preview`, `/batches/:batchId/drop-preview` (workorder:write) · `/api/work-orders/:id/fason-quick-receive` GET (workorder:write ∨ subcontractor:read) · `/api/subcontractor/dispatches/:id/direct-ship-preview`, `/undo-transfer-preview`, `/receipts/:id/cancel-preview` · `/api/shipping/shipments/:id/undo-dispatch-preview` (UNDO_DISPATCH) · `/api/machines/:id/delete-preview` (station:write) · `/api/tambur/manual/bring-preview`, `/send-to-dye-preview` (roll:manual-adjust ∨ mobile:tambur-duzelt).

---

## 4. DOĞRULAMASIZ YAZMA UÇLARI (gövde Zod'suz ∕ path param uuid'siz)

### 4.1 Gövde Zod'suz — BaseController generic yazımı (DMMF `sanitizeWriteData`, bilinen alan allowlist'i; iş kuralı serviste)
`POST/PATCH /api/orders` (OrderService.create :1799 / update :2212 elle doğrular) · `POST/PATCH /api/peripherals` · `POST/PATCH /api/product-recipes` · `POST/PATCH /api/routes` · `POST/PATCH /api/stations` · `POST/PATCH /api/machines` · `POST/PATCH /api/return-reasons` · `POST/PATCH /api/quality-grades` (yalnız `targetStatus`/`returnTargetStatus` Zod'lu, gerisi passthrough).

### 4.2 Gövde ham cast (Zod yok, servis doğrular)
| Uç | Kanıt | Serviste ne var |
|---|---|---|
| `POST /api/peripherals/:id/template-routes` | peripheral.routes.ts:133-137 `req.body as {...}`, `body.kind as never` | `LabelKind` üyelik kontrolü (peripheral.service.ts:250), şablon var/aktif (:257-261) |
| `PATCH /api/peripherals/:id/field-address` | :184 `body.address ?? ""` | boş/128 sınırı (:368-370), BT-only (:383), oturum kapsamı (:390-397) |
| `POST /api/work-orders/:id/manifest` | WC:864 `typeof req.body?.notes === "string"` | — (not serbest metin) |

### 4.3 Gövdesiz yazma (yalnız path param, uuid doğrulamasız)
`POST /api/shipping/rolls/:rollId/remove-from-sack` (SC:203) · `POST /api/shipping/swatches/:swatchId/remove-from-sack` (SC:210) · **`POST /api/shipping/shipments/:id/cancel` (SC:369 — sebep yok)** · `POST /api/peripherals/:id/test` · `POST /api/work-orders/:id/traveler-cards` (TCC:99) · `POST /api/traveler-cards/:id/print-event` (TCC:204) · `PATCH /api/work-orders/:id/lock` (WC:789) · `DELETE /api/work-orders/:id/order-links/:orderLineId` (WC:687) · `DELETE /api/work-orders/:id` (WC:919) · `DELETE /api/work-orders/:id/permanent` (WC:1056) · `POST /api/reason-presets/:id/duplicate` (gövde opsiyonel, id ham) · `POST /api/work-sessions/close` (cihazdan çözülür, gövde yok — meşru).

### 4.4 Path param uuid doğrulaması — controller bazında
| Controller | `assertValidUuid`∕Zod uuid | Sonuç |
|---|---|---|
| BaseController (`getParamId` BC:14-18) | ✓ tüm `:id` | 400 net |
| subcontractor-management, return, work-session, traveler-template (inline), order inline (hariç `lines/:lineId/color` :875-876), GHR (`/permanent`, delete-preview) | ✓ | 400 net |
| printed-document (`sourceIdSchema` PDC:15) · tambur undo çifti (`z.string().uuid` TC:243,260) · reports traveler-trace | ✓ | 400 net |
| **ShippingController (46 uç), SubcontractorController (23), WorkOrderController (42), TravelerCardController, TamburController (undo hariç), station-capability inline, reason-preset inline, peripheral inline, reports `batch-trace/:batchId`** | ✗ | Geçersiz uuid Prisma'ya ulaşırsa error.middleware P2023/P2007 → 400 (error.middleware.ts:444-460); Prisma'ya ulaşmadan başka mantık varsa davranış handler'a bağlı [②: örnekle ölç] |

---

## 5. DİNAMİK İZİN ÇÖZÜMÜ (kaynak #6)

| Yer | Mekanizma | Bilinmeyen anahtar davranışı | Harita ↔ üye kümesi hizası |
|---|---|---|---|
| `printed-document.routes.ts:98-107` `requireDocPermission(kind)` → `DOC_PERMISSIONS[docType]` (:20-95) | route satırında middleware; `entry[kind]` → `requireAnyPermission(...)` | **fail-closed** (400 "Bilinmeyen belge tipi") | 8 anahtar = `PrintedDocType` 8 üye (schema.prisma:3985-4003) — birebir. `TRAVELER_CARD.write=["workorder:write"]` ama uç 400 (SELF_MANAGED, printed-document.service.ts:169-172). Bekçi `scripts/test_workorder_documents.ts` liste↔baskı izni hizasını okur (yorum :17-19) |
| `record-info.routes.ts:82-88` `TABLE_PERMISSIONS[table]` (:31-41) | handler içinde `matchesPermission` | **fail-closed** (400) | 9 anahtar; servis `PROVENANCE_TABLES` (record-info.service.ts:73-101) 4'ünü içermez (ROLL, SACK, SUBCONTRACTOR_DISPATCH, SUBCONTRACTOR_RECEIPT) → kolon yolu null → audit yolu (`auditEmpty` olası). Bekçi `test_permission_catalog` sabiti dinamik kaynak olarak tanır (yorum :27-29) |
| `master-data-merge.routes.ts:36-56` `requireEntityWrite` → `getImportAdapter(entity).writePermission` | route satırında ikinci middleware; kaynak `import-registry` (ikinci liste tutulmuyor, :8-13) | entity ∉ MERGE_ENTITIES → 400; adapter yoksa `next(e)` | 4 varlık; renk write izni `property:write` (yorum :12) |
| `search.service.ts:74` kova başına `matchesPermission(permissions, code)` | servis içinde süzme | izinsiz kova → boş sonuç (403 yok) | kova listesi ↔ katalog hizası bekçisi bu envanterde doğrulanmadı |
| `workorder.controller.ts:949-956` (cancel), `:989-996` (drop), `:1034-1039` (complete) | payload'a bağlı ek izin `roll:manual-adjust` (RBAC middleware koşullu çalışmadığından handler'da) | izin yoksa 403 (`AppError.forbidden`) | `STOCK` dispozisyonu ek izin istemez (yorum :944-948) |
| `workorder.routes.ts:600-601` override | iki ayrı `requirePermission` = AND | — | tek örnek |
| `tambur.controller.ts:369-372` `allowEmptyStep` | izne göre davranış dalı (boş adımda kart açılır) | yetkisiz → mevcut davranış (hata) | — |
| `reason-preset.routes.ts:33` `canEdit` küçük harf sabit | tekil sabit (#3) | — | büyük-harf desenli tarama bunu kaçırır |
| `shipping.routes.ts:10-23` beş sabit | tekil sabit (#3) | — | `UNDO_DISPATCH` tek eleman, `shipping:write` kapsamaz (SoD) |

---

## 6. YIKICI UÇLAR (storno · iptal · geri alma · silme · fire) — ② için öncelik listesi

| Modül | Uç | İzin | Sebep zorunlu? | Önizleme ucu | Mekanizma (bilinen) |
|---|---|---|---|---|---|
| Sevkiyat | `POST /shipping/shipments/:id/undo-dispatch` (STORNO) | `shipping:undo-dispatch` | ✓ (3..500) | ✓ `undo-dispatch-preview` | `releaseSacks` → storno + `cancelPlannedShipmentTx` AYNI tx; belge sürümleri VOIDED; iade defterine girmez |
| Sevkiyat | `POST /shipping/shipments/:id/cancel` | WRITE (mobil dahil) | **✗ (gövde yok)** | ✓ `cancel-preview` | PLANNED iptali; çuvallar havuza; `cancelShipment` → aynı tx gövdesini çağırır (CLAUDE.md 2026-08-22) |
| Sevkiyat | `POST /shipping/sacks/:id/remove` | WRITE | ✗ | — | boş çuval FİZİKSEL silme (bilinçli istisna); `withContents` |
| Sevkiyat | `POST /shipping/sacks/:id/distribute`, `/split`, `remove-from-sack`×2 | WRITE | ✗ | — | içerik depoya; split atomik claim |
| Fason | `POST /subcontractor/dispatches/:id/cancel` | workorder:write ∨ mobile:fason-sevk | ✓ | — | soft cancel; toplar STOCK; kabul varsa 409 |
| Fason | `POST /subcontractor/dispatches/cancel-bulk` | aynı | ✓ | — | sevk başına ayrı tx, `failed[]` (parçalı, yazılı) |
| Fason | `POST /subcontractor/receipts/:id/cancel` | workorder:write ∨ mobile:fason-kabul | ✓ + `cascadeRollIds` birebir | ✓ `cancel-preview` | orijinal toplar geri; doğan toplar CANCELLED; downstream iz varsa 409 |
| Fason | `POST /subcontractor/dispatches/:id/undo-transfer` | workorder:write ∨ subcontractor:write | ✓ | ✓ | sevk + kaynak kabul iptali |
| Fason | `POST /subcontractor/close-remainder` (**yeni**) | workorder:write ∨ mobile:fason-kabul | ✓ reasonCode | — | FİRE: SUBCONTRACTOR_CONSUMED + RollVariance SCRAP |
| Fason | `POST /subcontractor/dispatches/:id/direct-ship` | workorder:write ∨ mobile:fason-sevk | ✓ | ✓ | toplar SHIPPED; WO kapanabilir |
| Tambur | `POST /tambur/rolls/:rollId/undo` | quality:write ∨ mobile:tambur ∨ tambur-duzelt | opsiyonel (≤500) | ✓ `undo-preview` | mod tx içinde taze çözülür; 409 tam rollback; eski APK EN DAR mod |
| Tambur | `POST /tambur/:id/finalize-open-fabric`, `/finalize-warehouse-cut` | quality:write ∨ mobile:tambur | — (varianceReason opsiyonel) | — | parent TAMBUR_CONSUMED; kalan fire/discard |
| Tambur | `POST /tambur/:id/cut` status=SCRAP | aynı | — | — | child SCRAP doğar |
| İş emri | `POST /work-orders/:id/cancel` | workorder:write ∨ mobile:hizli-is-emri (+ koşullu roll:manual-adjust) | ✓ (3..500) | ✓ `cancel-impact` | WO CANCELLED; dispozisyon STOCK∕SCRAP∕CANCELLED; fason hard-block∕`fasonAction` |
| İş emri | `DELETE /work-orders/:id` | aynı | **✗** (gövdesiz eski APK yolu) | — | `softDelete` varsayılan (STOCK) |
| İş emri | `POST /work-orders/:id/complete` | workorder:write (+ koşullu roll:manual-adjust) | dispozisyon varsa ✓ | ✓ `complete-preview` | kapanış dispozisyonu 6 aksiyon; kapsam birebir |
| İş emri | `POST /work-orders/:id/batches/:batchId/drop` | workorder:write (+ koşullu) | ✓ | ✓ `drop-preview` | parti üyeliği kopar |
| İş emri | `DELETE /work-orders/:id/permanent` | workorder:write | ✗ | — | **ARŞİV** (isActive=false, atomik claim) — Swagger "fiziksel" der |
| İş emri | `DELETE /work-orders/:id/order-links/:orderLineId` | workorder:write | ✗ | — | son bağ → STOK; hedef kumaşsız → 400 |
| İş emri | `POST /work-orders/:id/split`, `/manual-move` | workorder:write | split opsiyonel ∕ move ✓ | ✓ | toplar taşınır; kararlar VOID |
| Sipariş | `POST /orders/:id/cancel` | order:write | opsiyonel (reasonCode∕Text) | ✓ `cancel-preview` | WO başına aksiyon; `cancelWithActions` |
| Sipariş | `DELETE /orders/:id` | order:write | ✗ | — | soft CANCELLED; aktif WO → 409; atomik claim |
| Sipariş | `DELETE /orders/:id/permanent` | order:write | ✗ | — | **= softDelete** (order.service.ts:2718) |
| Sipariş | `POST /orders/:id/lines/:lineId/cancel` | order:write | opsiyonel | ✓ | kalem SOFT; WO bağları kopar |
| İade | `POST /returns/:id/cancel` | return:write ∨ mobile:iade | ✓ | — | top SHIPPED'e döner; claim |
| Refakat | `POST /traveler-cards/:id/void` | workorder:write | ✓ | — | VOIDED |
| Master-data | `POST /master-data/:entity/merge` | master-data:merge + varlık write | ✓ (≥10) + `acknowledgedConflicts` | ✓ `merge/preview` | GERİ ALINAMAZ; advisory lock; 17 ham SQL |
| Master-data | `DELETE /master-data/duplicates/reviews/:id` | master-data:merge | ✗ | — | fiziksel satır silme (MERGED → 409) |
| Tanım | `DELETE …/permanent` — stations, machines, routes, product-recipes | station:write | ✗ | machines: ✓ `delete-preview` | GHR: guard sayaçları → 409, tx delete, audit tx dışında |
| Tanım | `DELETE /peripherals/:id/permanent` | station:write | ✗ | — | tombstone (`deletedAt`) |
| Oturum | `POST /work-sessions/:id/force-close` | admin:settings | ✗ | — | başkasının oturumu kapanır |

---

## 7. Önceki envanterle karşılaştırma (2026-08-09 → 2026-08-28)

**Yeni dosyalar (5, toplam 19 rota):** master-data-merge (9), mobile-update (3), reason-preset (5), record-info (1), search (1) — hiçbiri 2026-08-09 envanterinde geçmiyor (grep 0).

**Mevcut dosyalarda eklenen rotalar (+54):**

| Dosya | Yeni rotalar |
|---|---|
| order (+4) | `GET /stats` · `GET /:id/lines/:lineId/cancel-preview` · `POST /:id/lines/:lineId/cancel` · `PATCH /:id/lines/:lineId/color` |
| workorder (+10) | `GET /:id/linkable-order-lines` · `POST /:id/order-links` · `POST /:id/order-links/override` · `DELETE /:id/order-links/:orderLineId` · `PATCH /:id/target-color` · `GET /:id/roll-attribute-targets` · `POST /:id/apply-attribute-to-rolls` · `PATCH /:id/width` · `GET+POST /:id/fason-quick-receive` |
| tambur (+2) | `POST /manual/send-to-dye-preview` · `POST /manual/send-to-dye` |
| subcontractor (+1) | `POST /close-remainder` |
| shipping (+1) | `POST /sacks/mismatch-check` |
| station-capability (+1) | `GET /for-session` |
| station (+2) | `GET /stations/similar-names` · `GET /machines/similar-names` |
| peripheral, quality-grade, return-reason (+1 her biri) | `GET /similar-names` |
| product-recipe, route (+2 her biri) | `GET /similar-names` · `DELETE /:id/permanent` |
| reports (+16 / −15) | **Eklenen:** production `batch-search`, `batch-trace/:batchId`, `wip`; quality `scorecard`, `scrap-scorecard`, `plan-deviation-scorecard`; inventory `scorecard`; subcontract `scorecard`; sales `shipment-scorecard`, `return-scorecard`, `open-order-coverage`, `order-intake`, `demand-analysis`, `order-leadtime`, `order-cancellation`; customer `scorecard`. **Kalkan:** production `station-efficiency`, `machine-usage`, `scrap`; quality `defect-distribution`, `station-defect-rate`, `qc2-decisions`, `kursun-application`; inventory `roll-aging`, `stock-distribution`, `movements`; subcontract `performance`, `open-dispatches`; sales `order-fulfillment`, `late-delivery`; customer `alias-stats`. Kalan ortak: production `operator-performance`, `traveler-trace`; customer `order-profile`; audit ×2 |

**Kalkan rota (reports dışında): YOK.** Değişmeyen dosyalar: printed-document (6), return (7), swatch (3), traveler-card (10), traveler-template (8), work-session (8), subcontractor-management (10), production-balance (1).

**Önceki envanterin işaretleyip bu turda hâlâ geçerli olanlar:** `DELETE /orders/:id/permanent` = soft (03 §1 #16 işareti) · `DELETE /work-orders/:id/permanent` = arşiv (02 §3 #30) · önizleme uçları WRITE izniyle (02 §6-R4) · reports `guard` dizisi spread tuzağı (04 §2.13).

**Önceki bulgu defteri (FINDINGS.jsonl, kapsamdaki dosyalar):** F-CORE-VER-004 (tambur.controller:39 tavan gerekçesi) düzeltildi · F-IST-ESZ-001 (finalize barkod kilidi) düzeltildi · F-FAS-ESZ-001 (fason COMPLETED terminal guard) düzeltildi · F-SEV-ESZ-002 (dedup) düzeltildi · açık: F-CORE-VER-008 (bilinçli takas), F-FAS-ESZ-002 (bilgi), F-SEV-DOG-001 (bilgi), F-SEV-ESZ-003 (bilgi: 42 updateMany sınıflandı).

---

## 8. İzin kodu ↔ katalog ↔ prod sahipliği

- Kapsamdaki 33 route dosyası + `constants/document-design.ts`'ten çıkan **50 farklı izin kodu**; `constants/permission-catalog.ts` **68 kod** içerir; **kapsamda kullanılıp katalogda OLMAYAN kod: 0** (`comm -23` boş). Kapsamda kullanılmayan katalog kodları (bilgi): customer-alias:read/write, customer:write, data:import, item:write, label-template:write, label:edit/print/read, mobile:kk1-desen, mobile:kk1-yari-mamul, mobile:kumas, mobile:kursun-dagitim, property:read/write, roll:history, roll:write, workorder:distribute (bunlar K1a kapsamındaki dosyalarda).
- Wildcard semantiği (rbac.middleware.ts:35-47): `*` her şey; `<domain>:*` ilk iki noktaya kadar. Prod kopyasında wildcard satırları: `admin:*` (3 aktif sahip), `mobile:*` (1).
- **Prod kopyası (`tekserp_saha_0825`, 2026-08-25; 8 aktif kullanıcı, 70 izin satırı) — kapsamdaki kodların aktif sahip sayısı:** master-data:merge **1** · mobile:tarti-paket **1** · mobile:sevkiyat **1** · mobile:kk2-kursun **1** · shipping:invoice 2 · mobile:kk1 2 · mobile:tambur 2 · mobile:tambur-duzelt 2 · document-template:read/write 3 · admin:settings 4 · admin:users 4 · mobile:hizli-is-emri 5 · mobile:kartela-sevk 5 · diğer tüm kapsam kodları 6 (report:* dahil, shipping:undo-dispatch 6, roll:manual-adjust 6). Kapsam DIŞI ama sıfır sahipli tek kod: `mobile:kk1-yari-mamul` (0) → K1a/yetki alanına not.
- Sorgu: `permissions ⟕ user_permissions ⟕ users` (aktif, silinmemiş, `validUntil` geçmemiş) — `audit/tools/sql-saha.sh` ile salt-okunur.

---

## HOTSPOTLAR

② denetçilerinin öncelikle bakması gereken yerler (dosya:satır — neden). Yargı değil, adres.

- **H1 — `Teks-Erp/src/controllers/shipping.controller.ts:369-374` `cancelShipment`:** gövde/sebep YOK, `:id` uuid✗, WRITE kümesi mobil izinleri de içerir; PLANNED sevkiyatı iptal edip çuvalları havuza döndürür (`cancelPlannedShipmentTx` tek kaynak). Atomik claim + tahsis silme yolunu ölç; sebepsiz iptalin audit izi ne taşıyor.
- **H2 — `Teks-Erp/src/routes/shipping.routes.ts:362` + `shipping.service.ts` `undoDispatch(releaseSacks)`:** storno + kapanış aynı tx; 409 engelleri (faturalı∕iadeli∕gün); belge sürümleri VOIDED. Kilit sırası ve claim'i doğrula (§3.2); `shipping:undo-dispatch` prod'da 6 kullanıcıda (SoD niyetiyle çelişir mi — iş kararı, ② not etsin).
- **H3 — `Teks-Erp/src/services/printed-document.service.ts:357-433` `getCurrent` lazy-init:** `GET …/current` ve `GET …/html` (PDC:144,161) belge yoksa **yazar** (`printedDocument.create` + audit `userId: undefined`); yarış P2002 ile çözülüyor (:414-433). GET üzerinde yazma + audit'te kimliksiz kayıt.
- **H4 — `Teks-Erp/src/controllers/work-session.controller.ts:77-85` `GET /current`:** öz-onarım yazımı (`NEW_LOGIN` kapanış, work-session.helper.ts:98-104 benzeri). GET yan etkili; iki tabletin aynı cihaz kimliğiyle yarışı.
- **H5 — `Teks-Erp/src/routes/workorder.routes.ts:595-603` + `workorder-link.service.ts` `linkOrderLineWithOverride`:** plan+toplar+bağ zinciri **tek tx DEĞİL** (bilinçli, Swagger :575-579). Kısmi durum (renk değişti, toplar yarım, bağ yok) senaryosu ve `rollsFailed[]` sessizliği.
- **H6 — `Teks-Erp/src/controllers/workorder.controller.ts:265-270` `applyAttributeSchema.rollIds` üst tavan YOK** (`POST /:id/apply-attribute-to-rolls`); top başına tekil düzeltme motoru → tx bütçesi/istek süresi; `recolorRollIds` ≤5000 (:250) ile asimetrik.
- **H7 — `/permanent` sözleşmesi dört farklı anlam:** `order.service.ts:2718-2720` (= softDelete) · `workorder.service.ts:4266-4300` (arşiv, claim) · `peripheral.service.ts:204-206` (tombstone) · GHR:47-98 (gerçek fiziksel DELETE; audit tx dışında best-effort). Swagger metinleri (`order.routes.ts:913-915`, `workorder.routes.ts:1041-1044`) "fiziksel" der. İstemci/sözleşme ayrışması (mimari hücre).
- **H8 — `Teks-Erp/src/controllers/tambur.controller.ts:283-287, 308, 328`:** `cut`, `cut-warehouse`, `finalize-warehouse-cut` oturumu ZORLAMAZ (yorum "bilinçli"), `finalize`/`finalize-open-fabric`/`bypass-complete` zorlar (:347,386,521). Makine damgası (`createdMachineId`) tablet oturumsuzken null doğar → "Bu makine" süzgeci sessizce eksik.
- **H9 — `Teks-Erp/src/controllers/tambur.controller.ts:29-46` `finalizeSchema.cuts ≤200`** + `tambur.service.ts` finalize barkod sayacı (F-IST-ESZ-001 düzeltildi): kilidin tx'in neresinde alındığını yeniden ölç (§2 sayaç kilidi kuralı).
- **H10 — `Teks-Erp/src/controllers/subcontractor.controller.ts:106-170` `receiveSchema`:** `returns ≤300` + `newRolls ≤300` → tek tx'te ~600 satır (+RollVariance, parti, makbuz, belge) — 20 sn bütçeye karşı en uzun tx adayı; `clientToken` nullish (kısmi kabulde replay kimliği).
- **H11 — `Teks-Erp/src/routes/subcontractor.routes.ts:302-307` `close-remainder`** (yeni): RollVariance `SUBCONTRACTOR_REMAINDER` + `remainderClosedAt`; 409 yarış sözleşmesi → claim var mı.
- **H12 — `Teks-Erp/src/services/master-data-merge.service.ts:441-1052`:** 17 `$queryRawUnsafe`/`$executeRawUnsafe` (KUNYE'deki 19 ham SQL kullanımının çoğu burada) + advisory lock :546 (tx içinde İLK ifade mi, korunan okumadan önce mi — §4.2). Parametre bağlama (`sourceIds, survivorId` :1052) SQL enjeksiyon açısından.
- **H13 — `Teks-Erp/src/routes/mobile-update.routes.ts:44-83` PUBLIC dosya ucu:** guard `dosyaYolu` (service:66-76) resolve-SONRASI prefix kontrolü (doğru sıra); `readFileSync` senkron (:56); `{*yol}` ile APK dahil her depo dosyası kimliksiz — bilinçli ama saldırı yüzeyi (depo kökü `MOBILE_UPDATE_DIR`).
- **H14 — `Teks-Erp/src/routes/printed-document.routes.ts:135-140` `sample-html` SABİT `admin:settings`** vs `traveler-card.routes.ts:124-129` DOCUMENT_DESIGN_READ. Electron `pages/Definitions/DocumentTemplates/DocumentPreview.tsx:61` bu ucu çağırıyor; Belge Şablonları ekranı `document-template:read` ile açılıyorsa (CLAUDE.md 2026-08-05) önizleme sessiz 403 [VARSAYIM — Electron kart/route izni okunmadı]. 2026-08-05 düzeltmesi yalnız refakat kartı ucuna uygulanmış görünüyor.
- **H15 — `Teks-Erp/src/routes/reports/production.routes.ts:25-39, 103-110, 139-146`:** router satırı olmayan üç `@openapi` bloğu; `config/swagger.ts:46-48` `routes/**/*.ts` tarar → hayalet uçlar `/api-docs`'ta [VARSAYIM]. `test_swagger_spec` yalnız `failOnErrors` ölçer.
- **H16 — `Teks-Erp/src/routes/record-info.routes.ts:31-41` ↔ `services/record-info.service.ts:73-101`:** route allowlist'indeki ROLL/SACK/SUBCONTRACTOR_DISPATCH/SUBCONTRACTOR_RECEIPT servis kolon haritasında yok → audit yolu (6 ay arşiv) → sessiz `auditEmpty`. İki liste ayrışması sınıfı.
- **H17 — `Teks-Erp/src/routes/peripheral.routes.ts:131-142, 153-158, 174-195`:** üç inline yazma ucu Zod'suz + uuid✗; `/:id/test` dış TCP gönderimi (tx içinde mi, timeout var mı — §2 dış dünya kuralı).
- **H18 — `Teks-Erp/src/services/return.service.ts:481-570` `createReturn`:** `freezeForSource` tx İÇİNDE (:564) + `clientToken` YOK (çoklu iade ≤200); tekrar denemede claim (`tx.roll.updateMany` :501) ikinci yazımı keser mi, kısmi başarı politikası yazılı mı.
- **H19 — `Teks-Erp/src/routes/order.routes.ts:863-886` `lines/:lineId/color`:** aynı dosyadaki diğer inline uçlar `assertValidUuid` kullanırken bu uç ham param; `changeLineColor` (order.service.ts:2641) claim'i.
- **H20 — `Teks-Erp/src/routes/workorder.routes.ts:1034` `DELETE /:id` gövdesiz + `mobile:hizli-is-emri`:** saha kullanıcısı sebepsiz iş emri iptal edebilir (eski APK sözleşmesi "AYNEN KALIR"); `softDelete({})` varsayılan dispozisyon STOCK.
- **H21 — `Teks-Erp/src/services/traveler-card.service.ts:349-403` `recordPrintEvent`:** tx içinde kart update + arşiv defteri; `resolvePrintPlan` tek karar noktası (GET html ile aynı plan) — iki tablet aynı kartı aynı anda "bastı" derse `version` yarışı (unique?).
- **H22 — `Teks-Erp/src/routes/station-capability.routes.ts:181-199` PUT replace:** `colorIds` yoksa dokunmama kuralı (:19-22) — tx içinde deleteMany(notIn)+createMany (önceki envanter); `properties` modu koruma sözleşmesi.
- **H23 — `Teks-Erp/src/services/work-session.service.ts:273-317` `open`:** tx + üç `updateMany` + P2002 → 409 `SESSION_RACE`; partial unique'e dayanan claim örneği — bekçisi var mı (§3.2 doğru desen adayı, bulgu değil).
- **H24 — `Teks-Erp/src/routes/reason-preset.routes.ts:116-123` `reorder` "TÜM id'ler"** (service:497-505 tx): `kind` ile `ids` uyuşmazlığı (başka kind'ın id'si) nasıl reddediliyor.
- **H25 — Rota katmanı sıra kuralları hepsi doğrulandı** (similar-names/`for-*`/`default`/`reorder` → `/:id` önce); Express 5 sabit segment ↔ param çakışması yok. Yeni uç eklerken bu satırlar kırılgan (dokümante).

## SINIR ÖTESİ NOTLAR

- **→ K1a (rota envanteri A: admin, auth, inventory/rolls, kursun-qc, kursun-bypass, label, label-template, kartela, batch, feature-flag, import, config-bundle, db-copy, device, dashboard, discovery, client-policy, customers/items/colors/fabric-properties/defect-types/currencies):** bu dosyalar kapsam dışı bırakıldı; `inventory.routes.ts` ile `/api/rolls/:id/scrap` (fire ucu) ve `tambur`/`kursun` arasındaki damga sözleşmesi orada okunmalı. `mobile:kk1-yari-mamul` prod kopyasında 0 sahip (kapsam dışı kod).
- **→ Eşzamanlılık denetçisi (SEV/FAS/IST/WO hücreleri):** H1-H2, H5, H8-H11, H18, H21, H23; ayrıca kapsamdaki servislerin tx/updateMany sayıları: shipping tx=24/um=44 · subcontractor 7/28 (+6 ham SQL) · tambur 6/7 · tambur-undo 3/12 · workorder 9/16 (+4 ham SQL) · order 7/12 · return 2/4 · traveler-card 3/2 · work-session 1/6 · master-data-merge 1/2 (+18 ham SQL, 1 advisory) · workorder-manual-move 1/9.
- **→ Veri katmanı / K2 (DB):** prod kopyası 190/195 migration — `duplicate_reviews` ve `roll_plan_deviations` gibi 2026-08-19+ tabloları orada olmayabilir; master-data `duplicates/reviews` uçları prod kopyasında test edilemez. Ham SQL 19 kullanımın dağılımı: master-data-merge 18 (17 Unsafe + 1 lock), subcontractor 6, workorder 4, order 1, workorder-batch-drop 1 (KUNYE sayısıyla uzlaştırılmalı).
- **→ Electron istemci alanı:** H14 (Belge Şablonları önizleme ucu izni) — `Electron/src/pages/Definitions/DocumentTemplates/DocumentPreview.tsx:61` `/printed-documents/:docType/sample-html` çağırır; ekranın kart/route izin listesi (`tile-config`, `content-routes`) bu turda okunmadı. Ayrıca `/permanent` semantiği (H7) istemci metinleriyle ("kalıcı sil") hizalı mı.
- **→ Mobil alanı:** `mobil/scripts/lib/adres.mjs:83` `UPDATE_PATH = '/api/mobile/updates/manifest'` — backend LAN ikizi rotası `/api/mobile/updates/ota/:runtimeVersion/manifest`; ikisinin nasıl birleştiği (VPS nginx düzeni ile) doğrulanmadı [VARSAYIM: yol farkı bilinçli olabilir].
- **→ CORE (middleware/hata katmanı):** geçersiz uuid'nin P2023/P2007 → 400 eşlemesi (error.middleware.ts:444-460) uuid✗ handler'ların tek koruması; global `express.json 1mb` (app.ts:141) ile import router'ının 10mb istisnası; `resolveDevice` fail-open (pairing kapalıyken DB hatasında geçirir, device.middleware.ts:59-73) bilinçli.
- **→ Yetki/rol alanı:** `master-data:merge`, `mobile:tarti-paket`, `mobile:sevkiyat`, `mobile:kk2-kursun` prod kopyasında tek kişide; `shipping:undo-dispatch` (storno) 6/8 kullanıcıda — SoD niyeti (CLAUDE.md "yalnız Muhasebe/Süpervizör") ile prod ataması karşılaştırılmalı.
- **→ Dokümantasyon/Swagger:** H15 hayalet uçlar; Swagger `PrintedDocType` enum'ları `printed-document.routes.ts:124,153,179` yalnız 4 üye listeler (gerçek 8).

## KAPSANMAYAN / ERİŞİLEMEYEN

- **Servis gövdeleri tam okunmadı.** Yalnız handler→servis metodu adı/satırı, tx/updateMany/advisory/raw sayaçları ve seçili metodlar (order create/update/softDelete, workorder hardDelete/softDelete imzası, printed-document getCurrent, traveler-card getCardHtml/recordPrintEvent, peripheral setTemplateRoute/setFieldAddress, mobile-update tamamı, guarded-hard-remove iskeleti) okundu. Atomik claim sınıflandırması, kilit sırası ve tx bütçesi ölçümü ②'nin işi.
- `PeripheralDeviceService.getForDevice/getForSession` `kind` doğrulaması, `StationCapabilityService.setCapabilities` tx içeriği, `ReasonPresetService.reorder` kind/id uyuşmazlığı, `SearchService` kova↔katalog hizası okunmadı.
- Swagger hayalet uçları (H15) statik çıkarım — `/api-docs` JSON'u üretilip sayılmadı.
- Electron tarafında Belge Şablonları ekranının izin kapısı (H14) ve `/permanent` buton metinleri okunmadı; mobil `adres.mjs` yol uyuşmazlığı doğrulanmadı.
- Canlı prod'a erişim yok; sahiplik sayıları 2026-08-25 kopyasından (190/195 migration; son 5 migration'ın tabloları/kolonları kopyada yok). `permission_templates` (rol şablonu) üzerinden dolaylı atama sayılmadı — yalnız `user_permissions` doğrudan satırları.
- Rate-limit / gövde boyutu: yalnız global 1mb tespit edildi; rota bazlı ek sınır aranmadı (import router hariç bilgi).
- `req.device` zorunluluğu `device.pairingRequired` bayrağının prod değerine bağlı — bayrak değeri kopyadan okunmadı.
- Bekçi (scripts/test_*.ts) kapsaması rota bazında eşleştirilmedi (366 bekçi); yalnız yorumlarda adı geçenler not edildi.
- Kapsam dışı 27 route dosyası (K1a) bu belgede yok; `router.use` ve mount analizi yalnız kapsam dosyaları + app.ts için yapıldı.
