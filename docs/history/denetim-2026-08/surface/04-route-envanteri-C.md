# Route Envanteri — GRUP C (kalan tüm route dosyaları)

Kod tabanı: `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp`
Tarih: 2026-08-09 · Salt-okuma keşif · Kod DEĞİŞTİRİLMEDİ.

---

## 0. Kapsam ve yöntem

**Kapsam:** `src/routes/` altındaki, GRUP A (`admin`, `workorder`, `inventory`, `tambur`, `label`) ve
GRUP B (`order`, `subcontractor`, `feature-flag`, `kursun-qc`, `station`, `item`, `shipping`,
`traveler-card`, `label-template`, `kursun-bypass`) dışında kalan **39 dosya**
(33 `src/routes/*.routes.ts` + `reports.routes.ts` + `src/routes/reports/` altındaki 7 dosya — toplam 39,
`ls | grep -v` ile sayıldı).

**Yöntem:** Route bildirimleri satır bazlı regex ile değil, **parantez dengeli** bir Node betiğiyle
çıkarıldı (`router.<method>(` bulunduğunda parantezler kapanana kadar okundu) — çok satırlı
middleware zincirlerinin kesilmemesi için. Yorum satırları temizlendi. Sayımlar bu betiğin
çıktısıdır, tahmin değildir.

**Doğrulanmış sayılar:**

| Ölçüm | Değer | Kaynak |
|---|---|---|
| Grup C dosya sayısı | 39 | `ls ... \| grep -v ... \| wc -l` |
| Grup C toplam satır | 4.984 | `xargs wc -l` |
| **Grup C toplam endpoint** | **194** | betik toplamı (`router.use` mount'ları hariç) |
| `router.use` (mount) bildirimi | 11 | customer.routes 4 + reports.routes 7 |
| Auth guard'ı (`verifyToken`) OLMAYAN endpoint | 8 | betik |
| Auth var, RBAC guard'ı OLMAYAN endpoint | 7 | betik |
| Kalıcı silme (`DELETE /:id/permanent`) ucu | 6 | grep |
| BaseService/BaseController kullanan dosya | 10 | grep |

---

## 1. Mount haritası (Grup C)

`src/app.ts:392-439` — mount sırası **anlamlıdır**: `/api/admin/db-copies` genel `/api/admin`
router'ından ÖNCE mount edilir (app.ts:433-434), yoksa `adminRoutes` içindeki bir `/:x` deseni
db-copy yollarını yutabilirdi.

| Prefix | Dosya | Endpoint |
|---|---|---|
| `/api/auth` | auth.routes.ts | 9 |
| `/api/customers` | customer.routes.ts (+4 nested router) | 6 (+ nested) |
| `/api/customers/:customerId/branches` | customer-branch.routes.ts | 4 |
| `/api/customers/:customerId` | customer-alias.routes.ts | 7 |
| `/api/customers/:customerId` | customer-template-route.routes.ts | 2 |
| `/api/customers/:customerId` | customer-standalone-label.routes.ts | 2 |
| `/api/customer-branches` | customer-branch-list.routes.ts | 1 |
| `/api/machines` | station.routes.ts → `machineRouter` (GRUP B dosyası) | — |
| `/api/peripherals` | peripheral.routes.ts → `peripheralRouter` | 11 |
| `/api/routes` | route.routes.ts | 6 |
| `/api/product-recipes` | product-recipe.routes.ts | 6 |
| `/api/production-balance` | production-balance.routes.ts | 1 |
| `/api/traveler-templates` | traveler-template.routes.ts | 8 |
| `/api/batches` | batch.routes.ts | 4 |
| `/api/subcontractors` | subcontractor-management.routes.ts → `subcontractorRouter` | 5 |
| `/api/subcontractor-categories` | subcontractor-management.routes.ts → `subcontractorCategoryRouter` | 5 |
| `/api/kartela` | kartela.routes.ts | 13 |
| `/api/swatches` | swatch.routes.ts | 3 |
| `/api/defect-types` | defect-type.routes.ts | 6 |
| `/api/quality-grades` | quality-grade.routes.ts | 5 |
| `/api/colors` | color.routes.ts | 5 |
| `/api/fabric-properties` | fabric-property.routes.ts | 5 |
| `/api/station-capabilities` | station-capability.routes.ts | 3 |
| `/api/printed-documents` | printed-document.routes.ts | 6 |
| `/api/document-profiles` | document-profile.routes.ts | 5 |
| `/api/free-documents` | free-document.routes.ts | 6 |
| `/api/returns` | return.routes.ts | 7 |
| `/api/return-reasons` | return-reason.routes.ts | 5 |
| `/api/currencies` | currency.routes.ts | 1 |
| `/api/admin/db-copies` | db-copy.routes.ts | 5 |
| `/api/dashboard` | dashboard.routes.ts | 2 |
| `/api/reports` | reports.routes.ts (yalnız mount, 0 endpoint) | 0 |
| `/api/reports/production` | reports/production.routes.ts | 5 |
| `/api/reports/sales` | reports/sales.routes.ts | 2 |
| `/api/reports/quality` | reports/quality.routes.ts | 4 |
| `/api/reports/inventory` | reports/inventory.routes.ts | 3 |
| `/api/reports/subcontract` | reports/subcontract.routes.ts | 2 |
| `/api/reports/customer` | reports/customer.routes.ts | 2 |
| `/api/reports/audit` | reports/audit.routes.ts | 2 |
| `/api/devices` | device.routes.ts → `devicePublicRouter` | 3 |
| `/api/admin/devices` | device.routes.ts → `deviceAdminRouter` | 9 |
| `/api/work-sessions` | work-session.routes.ts | 8 |

**Nested router'lar `Router({ mergeParams: true })` ile kurulu** (customer-branch:31,
customer-alias:15, customer-standalone-label:19, customer-template-route:18) — doğrulandı;
aksi halde `req.params.customerId` `undefined` olurdu.

**Global middleware zinciri** (app.ts, sırayla): `helmet` → `cors` → `compression` →
`express.json({limit:"1mb"})` → `morgan` → `latencyMiddleware` (115) → `resolveDevice` (118) →
swagger → `express.static(public)` → route'lar → `errorHandler` (460).
`resolveDevice` **her istekte** koşar ve `x-device-id` header'ından `req.device`'ı çözer —
yani auth'suz public uçlar da cihaz bağlamı taşır.

**İzin kümesi kısaltmaları (bu belgede kullanılır):**

| Sabit | Değer | Kaynak |
|---|---|---|
| `DOC_READ` | `admin:settings`, `document-template:read`, `document-template:write` | `constants/document-design.ts` |
| `DOC_WRITE` | `admin:settings`, `document-template:write` | `constants/document-design.ts` |
| `MOBILE_SESSION_PERMS` | `mobile:kk1`, `mobile:kk2-kursun`, `mobile:tambur`, `mobile:tarti-paket` | `services/work-session.service.ts:46` |
| `MOBILE_LABEL_PRINTERS` | `mobile:kk1`, `mobile:tambur`, `mobile:tarti-paket` | `peripheral.routes.ts:20` |
| `MOBILE_CUSTOMER_READ` | `mobile:tarti-paket`, `mobile:sevkiyat`, `mobile:fason-sevk`, `mobile:fason-kabul`, `mobile:tambur`, `mobile:siparis` | `customer.routes.ts:11` |
| `MOBILE_QUALITY_READ` | `mobile:kk1`, `mobile:kk2-kursun`, `mobile:tambur` | `quality-grade.routes.ts:15` |
| `MOBILE_DEFECT_READ` | `mobile:kk2-kursun`, `mobile:tambur` | `defect-type.routes.ts:14` |
| `MOBILE_FASON_READ` | `mobile:fason-sevk`, `mobile:fason-kabul` | `subcontractor-management.routes.ts:14` |

Tüm satırlarda auth zinciri, aksi belirtilmedikçe **`verifyToken` → RBAC guard**'dır.
"İdempotent" kolonu: **E** = tekrar çağrılınca ek yan etki yok · **H** = tekrarda yeni kayıt/yeni
sürüm doğar · **K** = koşullu (atomik claim / `clientToken` / upsert ile korunuyor).

---

## 2. Endpoint tabloları

### 2.1 `/api/auth` — auth.routes.ts (9)

| Metod | Path | Auth zinciri | Yan etki | İdemp. | Servis |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | **YOK** (public) | Session yaratır, audit, lockout sayacı | H | auth.service (via AuthController) |
| POST | `/api/auth/login-card` | **YOK** (public) | aynı | H | auth.service |
| POST | `/api/auth/login-quick-pin` | **YOK** (public) | aynı | H | auth.service |
| GET | `/api/auth/login-methods` | **YOK** (public) | yok (okuma) | E | system-setting.service |
| GET | `/api/auth/mobile-users` | **YOK** (public) | yok (okuma) | E | auth.service |
| GET | `/api/auth/me` | `verifyToken` (RBAC yok) | yok | E | auth.service |
| POST | `/api/auth/logout` | `verifyToken` (RBAC yok) | Session revoke | K | session-registry.service |
| GET | `/api/auth/preferences` | `verifyToken` (RBAC yok) | yok | E | user-preference.service |
| PUT | `/api/auth/preferences` | `verifyToken` (RBAC yok) | UserPreference upsert (audit'ten muaf) | E | user-preference.service |

`login-lockout.ts` middleware dosyası **route'a takılı değil**, `auth.controller.ts:18`'den
import edilip controller içinden çağrılıyor — yani zincir route tablosundan okunmuyor.

### 2.2 `/api/customers` + nested (21)

| Metod | Path | İzin | Yan etki | İdemp. | Servis |
|---|---|---|---|---|---|
| GET | `/api/customers` | any(`customer:read`, `MOBILE_CUSTOMER_READ`) | — | E | customer.service (BaseService) |
| GET | `/api/customers/:id` | any(`customer:read`, `MOBILE_CUSTOMER_READ`) | — | E | customer.service |
| POST | `/api/customers` | `customer:write` | Customer + nested `branches[]` create | H | customer.service |
| PATCH | `/api/customers/:id` | `customer:write` | update + audit | E | customer.service |
| DELETE | `/api/customers/:id` | `customer:write` | soft delete (`isActive:false`) | E | customer.service |
| **DELETE** | `/api/customers/:id/permanent` | `customer:write` | **fiziksel DELETE** (bağımlılık guard'lı) | E | BaseController.hardRemove |
| GET | `/api/customers/:customerId/branches` | any(`customer:read`, `mobile:tarti-paket`, `mobile:sevkiyat`, `mobile:fason-sevk`, `mobile:fason-kabul`, `mobile:siparis`) | — | E | customer-branch.service |
| POST | `/api/customers/:customerId/branches` | `customer:write` | Branch create | H | customer-branch.service |
| PATCH | `/api/customers/:customerId/branches/:branchId` | `customer:write` | update | E | customer-branch.service |
| DELETE | `/api/customers/:customerId/branches/:branchId` | `customer:write` | deactivate (soft) | E | customer-branch.service |
| GET | `/api/customers/:customerId/aliases/suggest` | `customer-alias:read` | — | E | customer-alias.service |
| GET | `/api/customers/:customerId/item-aliases` | `customer-alias:read` | — | E | customer-alias.service |
| PUT | `/api/customers/:customerId/item-aliases/:itemId` | `customer-alias:write` | upsert | E | customer-alias.service |
| DELETE | `/api/customers/:customerId/item-aliases/:itemId` | `customer-alias:write` | sil | E | customer-alias.service |
| GET | `/api/customers/:customerId/color-aliases` | `customer-alias:read` | — | E | customer-alias.service |
| PUT | `/api/customers/:customerId/color-aliases/:colorId` | `customer-alias:write` | upsert | E | customer-alias.service |
| DELETE | `/api/customers/:customerId/color-aliases/:colorId` | `customer-alias:write` | sil | E | customer-alias.service |
| GET | `/api/customers/:customerId/template-routes` | `label-template:read` | — | E | customer-template-route.service |
| PUT | `/api/customers/:customerId/template-routes` | `label-template:write` | etiket şablonu ataması (replace) | E | customer-template-route.service |
| GET | `/api/customers/:customerId/standalone-labels` | `label-template:read` | — | E | customer-standalone-label.service |
| PUT | `/api/customers/:customerId/standalone-labels` | `label-template:write` | M:N replace | E | customer-standalone-label.service |
| GET | `/api/customer-branches` | any(`customer:read`, `order:read`, `shipping:read`, `shipping:write`, `mobile:tarti-paket`, `mobile:sevkiyat`) | — | E | BaseService(`customerBranch`) |

### 2.3 `/api/kartela` (13)

Hepsi `verifyToken` + `requireAnyPermission`. Servis: `kartela.service` (via `KartelaController`).

| Metod | Path | İzin | Yan etki | İdemp. |
|---|---|---|---|---|
| POST | `/dispatch` | `kartela:write` \| `mobile:kartela-sevk` | KartelaDispatch + Roll → `AT_KARTELA` | H (`clientToken` YOK) |
| POST | `/dispatches/:id/cancel` | `kartela:write` \| `mobile:kartela-sevk` | sevk iptali, top geri | K |
| GET | `/dispatches` | `kartela:read` \| `mobile:kartela-sevk` \| `mobile:kartela-kabul` | — | E |
| GET | `/dispatches/:id` | aynı | — | E |
| GET | `/outstanding` | `kartela:read` \| `mobile:kartela-kabul` | — | E |
| GET | `/stock` | `kartela:read` \| `shipping:read` \| `shipping:write` \| `mobile:tarti-paket` \| `mobile:sevkiyat` \| `mobile:depo` | — | E |
| POST | `/stock/reduce` | `kartela:write` \| `mobile:depo` | `SwatchStockReduction` + stok düşümü | **K** (`clientToken @unique`, P2002 yakalanıp mevcut kayıt döner — `kartela.service.ts:1337-1390`) |
| POST | `/receive` | `kartela:write` \| `mobile:kartela-kabul` | KartelaReceipt + Swatch üretimi | H |
| GET | `/receipts` | `kartela:read` \| iki mobil | — | E |
| GET | `/receipts/:id` | aynı | — | E |
| GET | `/receipts/:id/cancel-preview` | `kartela:write` \| `mobile:kartela-kabul` | — (önizleme) | E |
| POST | `/receipts/:id/cancel` | `kartela:write` \| `mobile:kartela-kabul` | makbuz iptali | K |
| POST | `/rolls/:id/mark` | `kartela:write` \| `mobile:kartela-sevk` \| `mobile:tambur` | Roll kartelalık bayrağı | E (set) |

### 2.4 `/api/swatches` (3) — dosya `swatch.routes.ts`, controller **TamburController**

| Metod | Path | İzin | Yan etki | İdemp. |
|---|---|---|---|---|
| GET | `/api/swatches` | any(`quality:read`, `kartela:read`, `mobile:tambur`, `mobile:tarti-paket`, `mobile:depo`) | — | E |
| GET | `/api/swatches/stats` | aynı | — | E |
| GET | `/api/swatches/by-barcode/:barcode` | any(`quality:read`, `kartela:read`, `mobile:tarti-paket`, `mobile:depo`) | — | E |

`by-barcode` izin kümesi diğer ikisinden **dar** (`mobile:tambur` yok) — bilinçli mi, yoksa
kopyala-yapıştır sapması mı, kaynakta gerekçe yazılı DEĞİL. **ŞÜPHELİ.**

### 2.5 `/api/returns` (7) + `/api/return-reasons` (5)

| Metod | Path | İzin | Yan etki | İdemp. | Servis |
|---|---|---|---|---|---|
| GET | `/api/returns/lookup` | `return:write` \| `mobile:iade` | — | E | return.service |
| GET | `/api/returns/lookup-sack` | `return:write` \| `mobile:iade` | — | E | return.service |
| POST | `/api/returns` | `return:write` \| `mobile:iade` | **RollReturn (N satır) + `returnGroupId` + `RETURN_DISPATCH` belgesi tx içinde DONDURULUR** (`freezeForSource`, return.service.ts:546-557) | H (`clientToken` YOK) | return.service |
| GET | `/api/returns` | `return:read` \| `return:write` \| `mobile:iade` | — | E | return.service |
| GET | `/api/returns/:id` | aynı | — | E | return.service |
| PATCH | `/api/returns/:id` | `return:write` \| `mobile:iade` | iade düzenleme + belge revizyonu | E | return.service |
| POST | `/api/returns/:id/cancel` | `return:write` \| `mobile:iade` | grup lideri ise VOID, üye ise `reissueForSourceTx` (v+1) | K | return.service |
| GET | `/api/return-reasons` | `return:read` \| `return:write` \| `mobile:iade` | — | E | BaseService |
| GET | `/api/return-reasons/:id` | aynı | — | E | BaseService |
| POST | `/api/return-reasons` | `return:write` | create | H | BaseService |
| PATCH | `/api/return-reasons/:id` | `return:write` | update | E | BaseService |
| DELETE | `/api/return-reasons/:id` | `return:write` | soft delete | E | BaseService |

### 2.6 `/api/printed-documents` (6)

İzinler `DOC_PERMISSIONS` tablosundan **docType'a göre dinamik** çözülür
(`printed-document.routes.ts:20-75` — export edilmiş, `scripts/test_workorder_documents.ts` bunu okur).
Bilinmeyen docType → 400. Servis: `printed-document.service`.

| Metod | Path | İzin | Yan etki | İdemp. |
|---|---|---|---|---|
| POST | `/:docType/sample-html` | **`admin:settings` (SABİT — dinamik değil)** | yok (önizleme render) | E |
| GET | `/:docType/:sourceId/current` | `DOC_PERMISSIONS[docType].read` | **lazy-init: donmuş belge yoksa üretebilir** | K |
| GET | `/:docType/:sourceId/html` | read | lazy-init aynı | K |
| GET | `/:docType/:sourceId/versions` | read | — | E |
| GET | `/:docType/:sourceId/versions/:version` | read | — | E |
| POST | `/:docType/:sourceId/reissue` | `DOC_PERMISSIONS[docType].write` | **yeni versiyon (v+1)** | **H** |

### 2.7 Belge tasarım yüzeyi — `/api/document-profiles` (5) + `/api/free-documents` (6) + `/api/traveler-templates` (8)

| Metod | Path | İzin | Yan etki | İdemp. | Servis |
|---|---|---|---|---|---|
| GET | `/api/document-profiles` | **YALNIZ `verifyToken` — RBAC YOK** | — | E | document-profile.service |
| GET | `/api/document-profiles/:id` | **YALNIZ `verifyToken` — RBAC YOK** | — | E | document-profile.service |
| POST | `/api/document-profiles` | any(`DOC_WRITE`) | create | H | document-profile.service |
| PUT | `/api/document-profiles/:id` | any(`DOC_WRITE`) | update | E | document-profile.service |
| DELETE | `/api/document-profiles/:id` | any(`DOC_WRITE`) | deactivate (soft) | E | document-profile.service |
| GET | `/api/free-documents` | any(`DOC_READ`) | — | E | free-document.service |
| GET | `/api/free-documents/:id` | any(`DOC_READ`) | — | E | free-document.service |
| GET | `/api/free-documents/:id/html` | any(`DOC_READ`) | render (yazma yok; `printNote` 300 karaktere kırpılır) | E | free-document.service |
| POST | `/api/free-documents` | any(`DOC_WRITE`) | create + audit | H | free-document.service |
| PUT | `/api/free-documents/:id` | any(`DOC_WRITE`) | update + audit | E | free-document.service |
| DELETE | `/api/free-documents/:id` | any(`DOC_WRITE`) | deactivate | E | free-document.service |
| GET | `/api/traveler-templates` | any(`DOC_READ`) | — | E | traveler-template.service |
| POST | `/api/traveler-templates/inspect` | any(`DOC_READ`) | yok (HTML analiz, max 200 KB) | E | traveler-template.service |
| GET | `/api/traveler-templates/:id` | any(`DOC_READ`) | — | E | traveler-template.service |
| POST | `/api/traveler-templates` | any(`DOC_WRITE`) | create (+ `sanitizeTemplateHtml`) | H | traveler-template.service |
| PATCH | `/api/traveler-templates/:id` | any(`DOC_WRITE`) | update | E | traveler-template.service |
| POST | `/api/traveler-templates/:id/default` | any(`DOC_WRITE`) | `isDefault` devri (partial unique) | E | traveler-template.service |
| DELETE | `/api/traveler-templates/default` | any(`DOC_WRITE`) | varsayılanı temizle | E | traveler-template.service |
| DELETE | `/api/traveler-templates/:id` | any(`DOC_WRITE`) | sil | E | traveler-template.service |

Rota sırası kontrol edildi: `DELETE /default` (satır 151) `DELETE /:id`'den (satır 167) **ÖNCE**
bildirilmiş → gölgelenme yok.

### 2.8 Tanım (master data) yüzeyleri

| Metod | Path | İzin | Yan etki | İdemp. | Servis |
|---|---|---|---|---|---|
| GET | `/api/quality-grades` | any(`quality:read`, `label-template:read`, `MOBILE_QUALITY_READ`) | — | E | BaseService |
| GET | `/api/quality-grades/:id` | any(`quality:read`, `MOBILE_QUALITY_READ`) | — | E | BaseService |
| POST | `/api/quality-grades` | `quality:write` + `validateQgCreate` | create | H | BaseService |
| PATCH | `/api/quality-grades/:id` | `quality:write` + `validateQgUpdate` | update | E | BaseService |
| DELETE | `/api/quality-grades/:id` | `quality:write` | soft | E | BaseService |
| GET | `/api/defect-types` | any(`quality:read`, `MOBILE_DEFECT_READ`) | — | E | BaseService |
| GET | `/api/defect-types/:id` | any(`quality:read`, `MOBILE_DEFECT_READ`) | — | E | BaseService |
| POST | `/api/defect-types` | `quality:write` | create | H | BaseService |
| PATCH | `/api/defect-types/:id` | `quality:write` | update | E | BaseService |
| DELETE | `/api/defect-types/:id` | `quality:write` | soft | E | BaseService |
| **DELETE** | `/api/defect-types/:id/permanent` | `quality:write` | **fiziksel DELETE** (`defectTypeHardRemove`) | E | guarded-hard-remove |
| GET | `/api/colors` | any(`property:read`, `mobile:hizli-is-emri`, `mobile:siparis`, `mobile:kumas`) | — | E | color.service |
| GET | `/api/colors/:id` | any(`property:read`, `mobile:hizli-is-emri`) | — | E | color.service |
| POST | `/api/colors` | `property:write` | create | H | color.service |
| PATCH | `/api/colors/:id` | `property:write` | update | E | color.service |
| DELETE | `/api/colors/:id` | `property:write` | soft | E | color.service |
| GET | `/api/fabric-properties` | any(`property:read`, `mobile:hizli-is-emri`, `mobile:kumas`) | — | E | fabric-property.service |
| GET | `/api/fabric-properties/:id` | aynı | — | E | fabric-property.service |
| POST | `/api/fabric-properties` | `property:write` | create + **zorunlu `stationIds` bağı aynı insert'te** | H | fabric-property.service |
| PATCH | `/api/fabric-properties/:id` | `property:write` | update (+ verilirse bağ replace) | E | fabric-property.service |
| DELETE | `/api/fabric-properties/:id` | `property:write` | soft | E | fabric-property.service |
| GET | `/api/routes` | any(`station:read`, `mobile:hizli-is-emri`) | — | E | route.service |
| GET | `/api/routes/:id` | aynı | — | E | route.service |
| POST | `/api/routes` | `station:write` | Route + RouteStep + `RouteStepProperty` pivot | H | route.service |
| PATCH | `/api/routes/:id` | `station:write` | adım `deleteMany`+`create` (pivot CASCADE) | E | route.service |
| DELETE | `/api/routes/:id` | `station:write` | soft | E | route.service |
| **DELETE** | `/api/routes/:id/permanent` | `station:write` | **fiziksel DELETE** (`routeHardRemove`) | E | guarded-hard-remove |
| GET | `/api/product-recipes` | any(`station:read`, `mobile:hizli-is-emri`) | — | E | product-recipe.service |
| GET | `/api/product-recipes/:id` | aynı | — | E | product-recipe.service |
| POST | `/api/product-recipes` | `station:write` | create | H | product-recipe.service |
| PATCH | `/api/product-recipes/:id` | `station:write` | update | E | product-recipe.service |
| DELETE | `/api/product-recipes/:id` | `station:write` | soft | E | product-recipe.service |
| **DELETE** | `/api/product-recipes/:id/permanent` | `station:write` | **fiziksel DELETE** (`recipeHardRemove`) | E | guarded-hard-remove |
| GET | `/api/station-capabilities` | `station:read` | — (`?detailed=true` ikinci şekil) | E | station-capability.service |
| GET | `/api/station-capabilities/:stationId` | `station:read` | — | E | station-capability.service |
| PUT | `/api/station-capabilities/:stationId` | `station:write` | **`StationColor`/`StationProperty` REPLACE** (`deleteMany(notIn)` + `createMany(skipDuplicates)` tx içinde) | E | station-capability.service |
| GET | `/api/subcontractors` | any(`subcontractor:read`, `MOBILE_FASON_READ`, `mobile:hizli-is-emri`) | — | E | subcontractor-management.service |
| GET | `/api/subcontractors/:id` | aynı | — | E | subcontractor-management.service |
| POST | `/api/subcontractors` | `subcontractor:write` | create | H | subcontractor-management.service |
| PATCH | `/api/subcontractors/:id` | `subcontractor:write` | update | E | subcontractor-management.service |
| DELETE | `/api/subcontractors/:id` | `subcontractor:write` | soft | E | subcontractor-management.service |
| GET | `/api/subcontractor-categories` | any(`subcontractor:read`, `MOBILE_FASON_READ`) | — | E | subcontractor-management.service |
| GET | `/api/subcontractor-categories/:id` | aynı | — | E | subcontractor-management.service |
| POST | `/api/subcontractor-categories` | `subcontractor:write` | create | H | subcontractor-management.service |
| PATCH | `/api/subcontractor-categories/:id` | `subcontractor:write` | update | E | subcontractor-management.service |
| DELETE | `/api/subcontractor-categories/:id` | `subcontractor:write` | soft | E | subcontractor-management.service |
| GET | `/api/currencies` | **YALNIZ `verifyToken`** (sabit liste, kaynakta gerekçe yazılı) | — | E | (servis yok) |

### 2.9 `/api/peripherals` (11)

Servis: `peripheral.service` (`PeripheralDeviceService`, BaseController + BaseService türevi).

| Metod | Path | İzin | Yan etki | İdemp. |
|---|---|---|---|---|
| GET | `/` | any(`station:read`, `settings:workstation`, `MOBILE_LABEL_PRINTERS`) | — | E |
| GET | `/for-device` | any(`station:read`, `shipping:read`, `shipping:write`, `MOBILE_LABEL_PRINTERS`, `mobile:sevkiyat`) | — (`req.device` bağlamı) | E |
| GET | `/for-session` | any(`station:read`, `shipping:read`, `shipping:write`, `MOBILE_SESSION_PERMS`) | — (`getStampContext`) | E |
| GET | `/:id` | `station:read` | — | E |
| POST | `/` | `station:write` | create | H |
| PATCH | `/:id` | `station:write` | update | E |
| DELETE | `/:id` | `station:write` | soft | E |
| **DELETE** | `/:id/permanent` | `station:write` | **fiziksel DELETE** | E |
| POST | `/:id/template-routes` | `station:write` | etiket şablonu rotası set | E |
| POST | `/:id/test` | `station:write` | **yazıcıya test baskısı gönderir** (dış donanım) | H |
| PATCH | `/:id/field-address` | any(`station:write`, `MOBILE_SESSION_PERMS`) | **sahadan yazıcı adresi değişikliği** (`enforceForMobile:true` damga zorunlu) | E |

### 2.10 `/api/batches` (4) — `batch.service`

| Metod | Path | İzin | Yan etki | İdemp. |
|---|---|---|---|---|
| GET | `/number-state` | any(`workorder:read`, `admin:settings`) | — (sıradaki parti no ÖNİZLEME, rezervasyon değil) | E |
| POST | `/move-rolls` | `workorder:write` | `roll.updateMany` ile parti değişimi, tx | H |
| POST | `/merge` | `workorder:write` | parti birleştirme (atomik claim `batch.updateMany`, `subcontractorDispatch` devri) | K |
| POST | `/:batchId/split` | `workorder:write` | parti bölme + yeni parti no (`pg_advisory_xact_lock(8022,1)`) | H |

### 2.11 `/api/work-sessions` (8) — `work-session.service` + `work-session-activity.service`

| Metod | Path | İzin | Yan etki | İdemp. |
|---|---|---|---|---|
| POST | `/` | any(`MOBILE_SESSION_PERMS`) | WorkSession açar (P2002 ile korunuyor) | K |
| POST | `/close` | any(`MOBILE_SESSION_PERMS`) | oturum kapatır | K |
| GET | `/current` | any(`MOBILE_SESSION_PERMS`) | — | E |
| GET | `/places` | any(`MOBILE_SESSION_PERMS`) | — | E |
| GET | `/active` | `admin:settings` | — | E |
| GET | `/` | any(`admin:settings`, `admin:users`) | — (geçmiş) | E |
| GET | `/:id/activity` | any(`admin:settings`, `admin:users`) | — | E |
| POST | `/:id/force-close` | `admin:settings` | **başkasının oturumunu zorla kapatır** | K |

### 2.12 Cihaz yönetimi — `/api/devices` (3, PUBLIC) + `/api/admin/devices` (9)

Servis: `device.service`.

| Metod | Path | Auth | Yan etki | İdemp. |
|---|---|---|---|---|
| POST | `/api/devices/announce` | **YOK (public)** | bilinmeyen cihaz için **PENDING kayıt AÇAR** (`prisma.device.upsert`) | **K** (upsert; `kind` yalnız PENDING'de düzeltilir — atomik `updateMany WHERE status='PENDING'`) |
| GET | `/api/devices/status` | **YOK (public)** | — | E |
| GET | `/api/devices/pairing-required` | **YOK (public)** | — | E |
| GET | `/api/admin/devices` | `admin:settings` | — | E |
| GET | `/api/admin/devices/:id` | `admin:settings` | — | E |
| POST | `/api/admin/devices/:id/approve` | `admin:settings` | onay + makine ataması | K |
| POST | `/api/admin/devices/:id/assign-hardware` | `admin:settings` | donanım ataması | E |
| POST | `/api/admin/devices/:id/revoke` | `admin:settings` | onay iptali | E |
| PATCH | `/api/admin/devices/:id` | `admin:settings` | yeniden adlandır | E |
| DELETE | `/api/admin/devices/:id` | `admin:settings` | pasifleştir | E |
| POST | `/api/admin/devices/:id/reactivate` | `admin:settings` | yeniden aktifleştir | E |
| **DELETE** | `/api/admin/devices/:id/permanent` | `admin:settings` | **fiziksel DELETE** | E |

### 2.13 Raporlar — `/api/reports/*` (20) + `/api/dashboard` (2) + `/api/production-balance` (1)

Rapor alt-router'larının hepsinde zincir `const guard = [verifyToken, requirePermission("report:<domain>")]`
şeklinde bir **dizi** olarak tanımlanıp `...guard` ile yayılıyor — regex ile bakan bir denetim
bunları yanlışlıkla "auth yok" sayabilir (bu belgede el ile doğrulandı, hepsi `verifyToken` taşıyor).
Hepsi salt-okuma GET → **idempotent (E)**, yan etki yok.

| Prefix | Endpoint | İzin | Servis |
|---|---|---|---|
| `/api/reports/production` | `/station-efficiency`, `/operator-performance`, `/machine-usage`, `/traveler-trace`, `/scrap` | `report:production` | reports/production.report.service |
| `/api/reports/quality` | `/defect-distribution`, `/station-defect-rate`, `/qc2-decisions`, `/kursun-application` | `report:quality` | reports/quality.report.service |
| `/api/reports/inventory` | `/roll-aging`, `/stock-distribution`, `/movements` | `report:inventory` | reports/inventory.report.service |
| `/api/reports/subcontract` | `/performance`, `/open-dispatches` | `report:subcontract` | reports/subcontract.report.service |
| `/api/reports/sales` | `/order-fulfillment`, `/late-delivery` | `report:sales` | reports/sales.report.service |
| `/api/reports/customer` | `/order-profile`, `/alias-stats` | `report:customer` | reports/customer.report.service |
| `/api/reports/audit` | `/system-log-summary`, `/user-activity` | `report:audit` | reports/audit.report.service |
| `/api/dashboard` | `/defects/summary` | `quality:read` | dashboard.service |
| `/api/dashboard` | `/stations/live-state` | `station:read` | dashboard.service |
| `/api/production-balance` | `/` | any(`workorder:read`, `order:read`) | production-balance.service |

---

## 3. Auth guard'ı OLMAYAN endpoint'ler (8) ve meşruiyetleri

| Endpoint | Meşruiyet | Denetim notu |
|---|---|---|
| `POST /api/auth/login` | Login'in kendisi — token üretme kapısı. Kaynakta "HEP açık (panel + acil kapı)" notu var. | `login-lockout` middleware **route zincirinde değil**, controller'dan çağrılıyor (`auth.controller.ts:18`). Denetim, kilidin gerçekten uygulandığını **controller içinde** doğrulamalı; route tablosuna bakan bir kontrol bunu göremez. |
| `POST /api/auth/login-card` | QR personel kartı ile giriş, `card` yöntemi etkinken. | Kart token'ı DB'de düz saklanıyor (F287 notu db-copy dosyasında geçiyor) — brute-force/enumeration yüzeyi. |
| `POST /api/auth/login-quick-pin` | Salt hızlı-PIN girişi, `pin` etkinken. | Aynı — PIN uzayı küçük; lockout tek savunma. |
| `GET /api/auth/login-methods` | Login ekranı hangi yöntemlerin açık olduğunu auth'suz bilmek zorunda. | Yalnız ayar okur. |
| `GET /api/auth/mobile-users` | Mobil login ekranındaki kullanıcı listesi (liste+şifre akışı). | **Kimlik doğrulamasız kullanıcı adı listesi döndürür** — enumeration yüzeyi. Yanıtın hangi alanları taşıdığı denetlenmeli. |
| `POST /api/devices/announce` | Tablet boot'ta kendini bildirir; JWT henüz yok. | **Auth'suz YAZMA:** bilinmeyen `deviceId` için PENDING satır açar → sınırsız `deviceId` gönderen biri `devices` tablosunu şişirebilir. Rate limit görülmedi. |
| `GET /api/devices/status` | Tablet atama durumunu poll'lar (JWT öncesi). | Bilinmeyen id'ye `UNKNOWN` döner (enumeration sızıntısı sınırlı). |
| `GET /api/devices/pairing-required` | Cihaz onayı zorunlu mu — tablet açılışta öğrenmeli. | Tek boolean. |

**Ek olarak `/health` (app.ts:187) auth'suzdur ve route dosyasında değildir.** Yanıtı DB boyutu,
bağlantı sayısı, cache isabeti, `rolls` ölü satır oranı, en uzun sorgu süresi, disk doluluğu,
son yedek adı/zamanı, online kullanıcı sayısı ve audit hata sayacını taşır. Grup C dışı ama
denetimin "auth'suz yüzey" listesine girmelidir.

### Auth var, RBAC guard'ı olmayan endpoint'ler (7)

| Endpoint | Değerlendirme |
|---|---|
| `GET /api/auth/me`, `POST /api/auth/logout`, `GET/PUT /api/auth/preferences` | Self-servis — meşru (kendi kaydı). |
| `GET /api/currencies` | Sabit liste; kaynakta "özel permission yok — referans liste" gerekçesi **yazılı**. Meşru. |
| `GET /api/document-profiles`, `GET /api/document-profiles/:id` | **Gerekçe YAZILI DEĞİL.** Kardeş yüzeyler (`free-document`, `traveler-template`) aynı okuma için `DOC_READ` istiyor. Yani belge profili `config`'ini, yalnız `mobile:kk1` taşıyan bir saha operatörü de okuyabilir. Yazma tarafı (`POST`/`PUT`/`DELETE`) `DOC_WRITE` ile korunuyor → asimetri bilinçli değil gibi görünüyor. |

---

## 4. `db-copy.routes.ts` ve yedek/veri-taşıyıcı uçlar (AYRI BAŞLIK)

Mount: `app.use("/api/admin/db-copies", dbCopyRoutes)` — **`/api/admin`'den ÖNCE** (app.ts:433-434).

**Yetki zinciri beş ucun da BEŞİNDE aynı ve İKİ AYRI `requirePermission` çağrısı zincirlenmiş
(AND semantiği):** `verifyToken` → `requirePermission("admin:settings")` → `requirePermission("admin:users")`.
Bu, `requireAnyPermission`ın OR'ından **bilinçli olarak farklıdır**; dosya başındaki yorum bunu
`/api/admin/backups` ile birebir aynı tutulması gereken bir kural olarak yazıyor, gerekçe:
kopya, tüm kullanıcıların düz `quickPin`/`cardToken`'ını taşıyan verinin ta kendisidir (F287).

| Metod | Path | Yan etki | İdemp. | Servis |
|---|---|---|---|---|
| GET | `/api/admin/db-copies` | Okuma: `pg_database` taraması + `SystemSetting` kaydı + bellekteki iş uzlaştırması; disk durumu + `CREATEDB` yetkisi döner | E | db-copy.service `listDbCopies` |
| POST | `/api/admin/db-copies` | **YIKICI SINIFI / ağır:** `CREATE DATABASE` + `pg_restore` **spawn** eder (db-copy.service:543,576-584). Yanıt 202 (asenkron iş). Diskte canlı DB boyutunda ikinci bir veritabanı doğurur. | **H** — tek koruma bellek içi `isCopyJobRunning()` bayrağı (db-copy.service:138); süreç yeniden başlarsa bayrak sıfırlanır. Kaynakta 2026-07-31 tarihli "ikinci `pg_restore` başlatabiliyordu" notu var (satır 403). | `startCopyJob` |
| POST | `/api/admin/db-copies/:name/verify` | Kopyayı yeniden doğrular | E | `reverifyCopy` |
| DELETE | `/api/admin/db-copies/:name` | **YIKICI:** `DROP DATABASE ... [WITH (FORCE)]` (db-copy.service:716). `?force=1` query parametresi **aktif bağlantıları koparır**. Engellenirse 409. | E (idempotent silme) | `dropCopy` |
| GET | `/api/admin/db-copies/:name/swap-command` | Veri yazmaz **ama canlı DB'yi takas eden komut bloğunu ÜRETİR** (`pm2 stop` → iki `ALTER DATABASE RENAME` → `migrate deploy` → `pm2 start`). Kopya `ready` değilse 409. Backend geçişi yapmadığı için **tek iz** `AuditService.logEvent({action:"DB_SWAP_COMMAND_ISSUED"})`'dur. | E | `getSwapCommands` |

**Denetimin buraya özel bakması gerekenler:**
1. **`:name` parametresi shell/SQL'e nasıl giriyor?** `dropCopy`/`startCopyJob` `quoteIdent()`
   kullanıyor (db-copy.service:320,500,716) ve `pg_restore` `spawn` ile çağrılıyor — ama
   `:name` üzerinde route seviyesinde **hiçbir format doğrulaması yok** (`z.string()` bile yok;
   yalnız `req.params.name as string`). Ad, dosya adı ve/veya `pg_restore` argümanı olarak
   kullanılıyorsa doğrulama zinciri servis içinde izlenmeli. **ŞÜPHELİ — servis tarafı bu raporda
   satır satır okunmadı.**
2. **`POST /` gövdesindeki `backupName`** yalnız `z.string().min(1)` ile doğrulanıyor
   (db-copy.routes.ts:83) — path traversal (`../`) kontrolü route'ta YOK; `BACKUP_DIR` altında
   dosya çözümlemesi servis içinde yapılıyor.
3. **`AuditService.logEvent` `await` ile çağrılıyor** (swap-command ucunda) — projenin genel
   kuralı audit'in best-effort ve tx dışı olmasıdır; burada audit hatası isteği 500'e düşürebilir.
   Bu ucun izinin tek iz olduğu düşünülürse bilinçli olabilir. **ŞÜPHELİ — gerekçe yazılı değil.**
4. `POST /` yanıtında `result.started` false ise **HTTP 400** dönüyor ama gövde
   `success:false` + mesaj taşıyor; "meşgul" durumu 409 değil 400 olarak kodlanmış.
5. **`/health` bu domain'e sızıyor:** auth'suz `/health` yanıtı `restoreCopyCount` ve
   `restoreCopyBytes` alanlarını taşıyor (app.ts) — yani "sunucuda kaç geri yükleme kopyası var"
   bilgisi kimlik doğrulamasız okunabiliyor.

---

## 5. BaseService/BaseController üzerinden gelen generic CRUD

`grep -l "BaseService\|BaseController" src/routes/*.ts` → 13 dosya; bunların **10'u Grup C**
(kalan 3'ü `item`, `order`, `station` — Grup A/B).

| Route dosyası | Model | Not |
|---|---|---|
| `customer.routes.ts` | `customer` | `CustomerService` (BaseService türevi) + `nestedCreateFields: ["branches"]` — **F209 seddinde bilinçli bir delik**: create body'sindeki `branches[]` Prisma nested-create'e sarılıyor; sanitize `CustomerService.create` içinde yapılıyor, update'te düşürülüyor. Denetim tam olarak buraya bakmalı. |
| `customer-branch-list.routes.ts` | `customerBranch` | Salt-okuma tek uç; `defaultInclude` ile `customer` lean select. |
| `color.routes.ts` | `color` | `ColorService` |
| `defect-type.routes.ts` | `defectType` | Düz `new BaseService(...)` |
| `fabric-property.routes.ts` | `fabricProperty` | `FabricPropertyService`; `stationIds` zorunlu bağ |
| `peripheral.routes.ts` | `peripheralDevice` | `PeripheralDeviceService` |
| `product-recipe.routes.ts` | `productRecipe` | `ProductRecipeService` |
| `quality-grade.routes.ts` | `qualityGrade` | Düz `BaseService` + route-içi `validateQgCreate/Update` |
| `return-reason.routes.ts` | `returnReason` | Düz `BaseService` |
| `route.routes.ts` | `route` | `RouteService` + `ROUTE_SERVICE_CONFIG`; `ALLOWED_STEP_KEYS` allowlist'i `plannedProperties` nested write'ını REDDEDER (CLAUDE.md kuralı) |

`subcontractor-management.routes.ts` BaseController'ı **import etmiyor** ama controller'ı
`subcontractor-management.service`'e delege ediyor — jenerik CRUD şekli var, jenerik altyapı yok.

**Denetim için önemli:** `src/controllers/base.controller.ts` içinde `extends BaseController`
yapan **hiçbir controller yok** (grep boş döndü) — BaseController her yerde `new BaseController(service)`
ile örnekleniyor. Yani jenerik davranışın tek uzatma noktası `BaseService` alt sınıflarıdır;
route dosyaları controller metodunu doğrudan referans veriyor (`controller.findAll` vb.).

---

## 6. Denetimin bakması gereken noktalar (işaretler — bulgu değil)

1. **`POST /api/printed-documents/:docType/sample-html` izin hizası.** Guard
   `requireAnyPermission("admin:settings")` — tek elemanlı, yani fiilen `requirePermission`.
   Bu uç, CLAUDE.md'nin 2026-08-05 notunda `admin:settings`'ten ayrıldığı söylenen dört ekrandan
   biri olan **"Belge Şablonları"nın canlı önizlemesidir** (kendi OpenAPI açıklaması bunu yazıyor).
   `document-design.ts` bu dosyaya **hiç import edilmemiş**. Sonuç: yalnız
   `document-template:write` taşıyan bir tasarımcı ayarı kaydedebilir ama önizlemesi 403 alır —
   ve CLAUDE.md'nin "önizleme = gerçek baskı" sözleşmesi bu kişide bozulur. **KESİN gözlem**
   (route dosyasında `DOCUMENT_DESIGN` geçmiyor); etkisinin sahada gerçekleşip gerçekleşmediği
   Electron tarafında doğrulanmalı.
2. **`GET /api/document-profiles` + `/:id` RBAC'siz.** Kardeş yüzeylerle asimetrik, gerekçe yazılı değil.
3. **`POST /api/devices/announce` auth'suz yazma.** Upsert ile korunmuş ama `deviceId`
   uzayı sınırsız; rate limit / boyut guard'ı görülmedi.
4. **`GET /api/auth/mobile-users` auth'suz kullanıcı listesi.** Yanıt alanları denetlenmeli.
5. **`db-copy` `:name` ve `backupName` doğrulaması route'ta yok** — komut/dosya adı olarak
   kullanıldığı için servis tarafındaki `quoteIdent`/yol çözümü satır satır izlenmeli.
6. **`db-copy` eşzamanlılık koruması bellek içinde** (`isCopyJobRunning`), süreç restart'ında
   sıfırlanır; kaynakta 2026-07-31'de bu sınıfta bir vaka notu var.
7. **`POST /api/kartela/dispatch` ve `POST /api/returns` `clientToken` TAŞIMIYOR.** Aynı domain'de
   `POST /api/kartela/stock/reduce` `clientToken @unique` + P2002 telafisi ile korunmuş
   (kartela.service.ts:1337-1390) ve CLAUDE.md "kayıt-yaratan uçlar istemci token'ı taşır"
   diyor. `POST /api/returns` üstelik tx içinde **resmi belge donduruyor** — timeout-retry'de
   ikinci bir `RETURN_DISPATCH` doğma ihtimali incelenmeli.
8. **`GET /api/printed-documents/:docType/:sourceId/current|html` lazy-init yazma yapıyor.**
   GET'in yan etkisi olması, CLAUDE.md'nin `traveler-cards/:id/html` için koyduğu
   "GET yan etkisiz olmalı" kuralıyla çelişiyor gibi. Ayrıca CLAUDE.md 2026-08-05 notu
   lazy-init'in **sevkten sonra NET belge doğurduğu** vakasını anlatıyor — bu iki ucun bugünkü
   hâli o düzeltmeyle uyumlu mu, doğrulanmalı.
9. **`PATCH /api/peripherals/:id/field-address` mobil izinlerle açık.** Saha operatörü
   (`MOBILE_SESSION_PERMS`) yazıcı ağ adresini değiştirebiliyor; `enforceForMobile:true` damga
   zorunluluğu tek koruma. Yanlış adres tüm etiket baskısını sessizce durdurabilir.
10. **`PUT /api/station-capabilities/:stationId` REPLACE semantiği.** `deleteMany(notIn)` +
    `createMany(skipDuplicates)` tx içinde; kaynakta "iki eşzamanlı PUT bayat…" diye yarım kalmış
    bir yorum var (satır 238). Eşzamanlı iki PUT'un son durumu incelenmeli. Ayrıca
    `StationColor` **deprecated** ilan edilmiş (CLAUDE.md) ama bu uç hâlâ ona yazıyor.
11. **`GET /api/swatches/by-barcode/:barcode` izin kümesi kardeşlerinden dar** (`mobile:tambur` yok).
12. **6 adet `DELETE /:id/permanent` fiziksel silme ucu** (customer, defect-type, device,
    peripheral, product-recipe, route). Üçü `guarded-hard-remove` helper'ından, üçü
    (customer, peripheral, device) kendi yolundan geçiyor — guard paritesi denetlenmeli.
13. **`POST /api/work-sessions/:id/force-close`** başkasının oturumunu kapatır; `admin:settings`
    tek kapı. `admin:users` da isteyen `GET /` geçmişiyle asimetrik.
14. **Rapor route'larının `...guard` dizi yayılımı** mekanik izin denetimlerini yanıltabilir
    (bu raporda 20 uç bu yüzden ilk taramada "auth yok" göründü). İzin bekçisi
    (`scripts/test_permission_catalog.ts` benzeri) bu deseni tanıyor mu, doğrulanmalı.
15. **`customer.routes.ts` nested mount sırası:** `/:customerId/branches` önce, sonra ÜÇ ayrı
    router aynı `/:customerId` prefix'ine mount ediliyor (satır 35-41). Üçünün path'leri
    çakışmıyor (`aliases/*`, `template-routes`, `standalone-labels`) ama yeni bir path eklenirken
    sessiz gölgelenme riski var.
16. **`nestedCreateFields: ["branches"]`** — F209'un (generic CRUD üzerinden ilişki manipülasyonu
    kapalı) tek bilinen istisnası. `CustomerService.create`'teki mass-assignment guard'ı
    doğrulanmalı.

---

## 7. Kapsam sınırları (bu raporun BAKMADIĞI yerler)

- Servis katmanı satır satır okunmadı; "yan etki" kolonu route + hedef fonksiyon adı +
  seçilmiş grep'lerden çıkarıldı. Transaction sınırları ve kilit protokolleri **doğrulanmadı**.
- Zod şemalarının alan-alan içeriği incelenmedi (yalnız varlık/yokluk).
- OpenAPI yorumları ile gerçek zincirin uyuşup uyuşmadığı **karşılaştırılmadı**.
- Grup A ve B dosyaları kapsam dışıdır; `/api/machines` (station.routes → `machineRouter`) ve
  `/api/admin` (admin.routes) burada sayılmadı.
