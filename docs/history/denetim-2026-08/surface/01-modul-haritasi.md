# TeksERP Backend — Modül / Bounded Context Haritası

> Amaç: denetimin **nereye bakacağını** belirlemek. Bu belge bulgu raporu değildir;
> yüzey haritası + risk işaretleridir.
>
> Kapsam: `/Users/oad/Documents/projeler/AdnanSahin/Teks-Erp/src` + `prisma/schema.prisma`.
> Tarih: 2026-08-09. Tüm sayılar `wc -l` / komut çıktısıyla ölçüldü (yöntem: §7).

---

## 0. Doğrulanmış temel sayımlar

| Ölçüm | Değer | Kaynak |
|---|---|---|
| `src/services/**/*.ts` dosya | 152 | `find src/services -name '*.ts' \| wc -l` |
| `src/services/**` toplam satır | 77.067 | `find ... -exec wc -l {} + \| tail -1` |
| `src/services/*.ts` (kök, alt dizin hariç) | 57 dosya / 59.578 satır | `wc -l src/services/*.ts` |
| `src/services/helpers/**` | 67 dosya / 10.217 satır | `find src/services/helpers` |
| `src/services/helpers/raster/**` (helpers içinde) | — / 1.126 satır | `find .../raster` |
| `src/services/document-render/**` | 20 dosya / 5.632 satır | `find .../document-render` |
| `src/services/reports/**` | 8 dosya / 1.640 satır | `find .../reports` |
| `src/routes/**/*.ts` | 54 dosya / 13.791 satır | `find src/routes` |
| `src/controllers/*.ts` | 22 dosya / 6.714 satır | `wc -l src/controllers/*.ts` |
| `prisma/schema.prisma` | 3.721 satır, **85 model**, 28 enum | `grep -c '^model '` |
| `prisma/migrations/` | **154 migration dizini** (+ `migration_lock.toml` = 155 girdi) | `ls -d prisma/migrations/*/ \| wc -l` |
| ≥1000 satırlık servis dosyası | **16** | `awk '$1>=1000'` |

> Not: görev tanımındaki "155 migration" sayısı dizin sayımı değil `ls` girdi sayımıdır;
> gerçek migration adedi **154**'tür (`migration_lock.toml` migration değildir).

---

## 1. Context haritası (özet tablo)

Servis dosyalarının **tamamı** (152/152) bir context'e atandı; atanmamış (`???`) dosya kalmadı.
Satır toplamları context bazında `77.067`'ye tam denk geliyor (doğrulama: §7 script çıktısı `TOPLAM 77067`).

| # | Context | Servis dosyası | Servis satırı | Route satırı | Controller satırı | Ana Prisma modelleri (erişim sayısıyla) | Bağımlı olduğu context'ler (value import) |
|---|---|---|---|---|---|---|---|
| 1 | **BELGE / ETİKET** | 61 | **16.527** | 2.202 (9 dosya) | 1.446 (4) | LabelTemplate(30) · TravelerCard(18) · LabelContextDefault(13) · PrintedDocument(13) · LabelTemplateVariant(12) · TravelerCardTemplate(12) · CustomerTemplateRoute(7) · FreeDocument(6) · DocumentProfile(5) · CustomerStandaloneLabel(4) | SISTEM(16) · DONANIM(1) · SEVKİYAT(1) · SİPARİŞ(1) · TANIM(1) · ÜRETİM(1) |
| 2 | **ÜRETİM / İŞ EMRİ** | 16 | **11.719** | 1.042 (3) | 943 (2) | Roll(87) · WorkOrder(65) · Batch(28) · SubcontractorDispatch(27) · WorkOrderStep(22) · RollMovement(16) · Manifest(5) · WorkOrderTargetProperty(3) | BELGE(11) · SİSTEM(7) · FASON(2) · İSTASYON(2) · TANIM(type-only 1) |
| 3 | **İSTASYON İŞLEMLERİ** (Tambur + Kurşun/KK2) | 8 | **9.783** | 1.515 (3) | 1.086 (4) | Roll(67) · RollMovement(32) · WorkOrderStep(30) · RollOperation(23) · RollError(21) · KursunBypassAssignment(17) · RollProperty(10) | ÜRETİM(17) · SİSTEM(9) · BELGE(7) · ENVANTER(4) · SEVKİYAT(1) |
| 4 | **FASON + KARTELA** | 4 | **8.244** | 1.226 (4) | 924 (3) | Roll(58) · SubcontractorDispatch(28) · WorkOrderStep(22) · SubcontractorReceipt(20) · Subcontractor(18) · KartelaDispatch(13) · SubcontractorCategory(12) · KartelaReceipt(11) · Swatch(6) | BELGE(8) · ÜRETİM(4) · SEVKİYAT(3) · SİSTEM(3) · ENVANTER(1) · SİPARİŞ(1) · TANIM(1) |
| 5 | **SİSTEM / OPS** | 14 | **6.889** | 1.968 (3) | 0 | SystemSetting(58) · SystemLog(12) · EndpointLatencyDaily(6) · SystemLogArchive(3) | BELGE(4) |
| 6 | **SEVKİYAT / ÇUVAL / İADE** | 7 | **6.123** | 561 (2) | 661 (2) | Sack(45) · Roll(43) · Shipment(33) · RollReturn(24) · Swatch(15) · ShipmentOrder(10) · DirectShipment(9) · SackAllocation(4) | BELGE(5) · SİSTEM(4) · SİPARİŞ(1) · ÜRETİM(1) · TANIM(type-only 2) |
| 7 | **ENVANTER / TOP** | 5 | **4.697** | 865 (1) | 595 (1) | Roll(46) · RollMovement(15) · SubcontractorDispatchItem(8) · WorkOrderStep(7) · RollProperty(4) · ItemAllowedColor(4)/Property(4) | ÜRETİM(5) · İSTASYON(3) · SİSTEM(2) · SEVKİYAT(1) |
| 8 | **SİPARİŞ / MÜŞTERİ** | 7 | **4.083** | 1.343 (6) | 101 (1) | Order(29) · OrderLine(11) · CustomerColorAlias(10) · CustomerBranch(10) · CustomerItemAlias(8) · Customer(8) · WorkOrderToOrderLine(8) | SİSTEM(5) · TANIM(4) · ÜRETİM(3) |
| 9 | **TANIM / MASTER DATA** | 9 | **3.352** | 2.093 (10) | 112 (1) | Item(12) · Color(9) · Station(9) · FabricProperty(7) · StationProperty(6) · ProductRecipe(4) · StationColor(4) · Route(3)/RouteStep(2) | SİSTEM(6) · ENVANTER(1) |
| 10 | **KİMLİK / YETKİ / OTURUM** | 8 | **3.218** | 285 (3) | 846 (4) | User(36) · WorkSession(26) · Device(19) · UserPermission(16) · PermissionTemplate(10) · Session(7) · Permission(6) | SİSTEM(7) · TANIM(1) |
| 11 | **RAPOR / DASHBOARD** | 9 | **1.780** | 504 (9) | 0 | RollError(2) · Roll(1) · RollMovement(1) · RollOperation(1) — **çoğu ham SQL/aggregate, delegate deseni dışında** | (servis-içi bağımlılık yok; yalnız `reports/_shared`) |
| 12 | **DONANIM / ÇEVRE BİRİM** | 4 | **652** | 187 (1) | 0 | PeripheralDevice(12) · Machine(2) · PeripheralTemplateRoute(2) · Device(1) | BELGE(1) · SİSTEM(2) · TANIM(1) |
| | **TOPLAM** | **152** | **77.067** | **13.791** | **6.714** | 85 model | |

---

## 2. Context içerikleri (dosya dökümü)

### 1. BELGE / ETİKET — 16.527 satır (kod tabanının en büyük context'i, servis satırının %21,4'ü)

Üç ayrı alt-sistemi barındırıyor ve bunlar birbirinden **oldukça bağımsız**:

**(a) Etiket motoru** — `label.service.ts` (1.985) + `label-template.service.ts` (1.326) +
`helpers/label-*` (16 dosya) + `helpers/native-*` (2) + `helpers/raster/*` (11 dosya, 1.126 satır).
PPLA / PPLB / ZPL / kanvas-HTML / raster olmak üzere **5 render yolu**.
Modeller: LabelTemplate, LabelTemplateVariant, LabelContextDefault, CustomerTemplateRoute,
CustomerStandaloneLabel, PeripheralTemplateRoute.

**(b) Belge (kâğıt) motoru** — `printed-document.service.ts` (740) + `document-render/` (20 dosya, 5.632)
+ `document-profile.service.ts` (133) + `free-document.service.ts` (150).
Modeller: PrintedDocument, DocumentProfile, FreeDocument.

**(c) Refakat kartı** — `traveler-card.service.ts` (1.068) + `traveler-template.service.ts` (327)
+ `document-render/traveler-card.*` (4 dosya) + `helpers/traveler-card-dirty|fanout.helper`.
Modeller: TravelerCard, TravelerCardTemplate, TravelerCardScan.

Route: `label`(721) `label-template`(331) `traveler-card`(331) `printed-document`(253)
`traveler-template`(176) `document-profile`(130) `customer-standalone-label`(92)
`customer-template-route`(87) `free-document`(81).
Controller: `label`(594) `label-template`(378) `printed-document`(253) `traveler-card`(221).

### 2. ÜRETİM / İŞ EMRİ — 11.719 satır

`workorder.service.ts` (6.074 — **kod tabanının en büyük dosyası**) ·
`workorder-manual-move.service.ts` (901) · `workorder-split.service.ts` (712) ·
`workorder-batch-drop.service.ts` (546) · `batch.service.ts` (976) ·
`production-balance.service.ts` (418) ·
helpers: `roll-step`(399) `batch-dispatch-surgery`(393) `roll-disposition`(330)
`coverage`(278) `workorder-clone`(236) `workorder-locks`(229) `roll-finalize`(113)
`roll-barcode`(59) `station-capability-transfer`(37) `hidden-status`(34).
Route: `workorder`(871) `batch`(113) `production-balance`(58). Controller: `workorder`(840) `batch`(103).

### 3. İSTASYON İŞLEMLERİ — 9.783 satır

`tambur.service.ts` (3.319) · `kursun-bypass.service.ts` (2.363) · `kursun-qc.service.ts` (1.657) ·
`tambur-manual.service.ts` (1.221) · `tambur-undo.service.ts` (734) ·
helpers: `kursun-bypass-eligibility`(279) `kursun-bypass-guard`(167) `quality-grade`(51).
Route: `tambur`(765) `kursun-qc`(423) `kursun-bypass`(327).
Controller: `tambur`(449) `kursun-qc`(230) `tambur-manual`(206) `kursun-bypass`(201).

### 4. FASON + KARTELA — 8.244 satır (yalnız 4 dosya)

`subcontractor.service.ts` (6.056 — ikinci en büyük dosya) · `kartela.service.ts` (1.523) ·
`subcontractor-management.service.ts` (617) · `helpers/subcontractor-cancel.helper`(52).
Route: `subcontractor`(621) `kartela`(291) `subcontractor-management`(247) `swatch`(67).
Controller: `subcontractor`(505) `kartela`(279) `subcontractor-management`(140).

### 5. SİSTEM / OPS — 6.889 satır

`system-setting.service.ts` (2.840) · `db-copy.service.ts` (932) · `backup-impact.service.ts` (576) ·
`db-copy-verify.service.ts` (472) · `backup.service.ts` (441) · `latency-persist`(263) ·
`system-log.service.ts` (258) · `audit.service.ts` (241) · `latency-stats`(171) ·
helpers: `backup-naming`(204) `db-swap-command`(176) `pg-admin-client`(161) `pg-conn`(111) `pg-tool`(57).
Route: `admin`(1.293) `feature-flag`(468) `db-copy`(207). **Controller yok** — route'lar servisi doğrudan çağırıyor.

### 6. SEVKİYAT / ÇUVAL / İADE — 6.123 satır

`shipping.service.ts` (3.477) · `return.service.ts` (1.135) · `accounting-export.service.ts` (619) ·
`sack-search.service.ts` (528) · helpers: `allocation`(240) `sack-invariants`(77) `shipment-locks`(54).
Route: `shipping`(335) `return`(226). Controller: `shipping`(536) `return`(125).

### 7. ENVANTER / TOP — 4.697 satır

`inventory.service.ts` (4.319) + helpers `duplicate-guard`(155) `roll-cancel-restore`(109)
`fold-type`(60) `roll-entry-station`(59). Route: `inventory`(865). Controller: `inventory`(595).

### 8. SİPARİŞ / MÜŞTERİ — 4.083 satır

`order.service.ts` (2.820) · `customer.service.ts` (396) · `customer-alias.service.ts` (270) ·
`customer-branch.service.ts` (252) · helpers `order-status`(185) `customer-name`(100) `color-assignment`(67).
Route: `order`(711) `customer`(211) `customer-alias`(176) `customer-branch`(145)
`customer-branch-list`(66) `currency`(34). Controller: yalnız `customer-alias`(101).

### 9. TANIM / MASTER DATA — 3.352 satır

`base.service.ts` (838 — jenerik CRUD çekirdeği) · `item.service.ts` (554) · `color.service.ts` (400) ·
`station-capability.service.ts` (416) · `route.service.ts` (371) · `product-recipe.service.ts` (196) ·
`fabric-property.service.ts` (168) · helpers `guarded-hard-remove`(355) `name-normalize`(63).
Route: `station`(399) `item`(346) `fabric-property`(196) `quality-grade`(196) `defect-type`(194)
`product-recipe`(180) `route`(162) `color`(151) `return-reason`(138) `station-capability`(131).
Controller: `base`(112) — jenerik.

### 10. KİMLİK / YETKİ / OTURUM — 3.218 satır

`permission-management.service.ts` (1.009) · `work-session.service.ts` (550) ·
`work-session-activity.service.ts` (464) · `auth.service.ts` (467) · `device.service.ts` (352) ·
`session-registry.service.ts` (162) · `helpers/work-session.helper`(161) · `user-preference.service.ts` (61).
Route: `work-session`(141) `device`(115) `auth`(29) **+ `admin.routes.ts`'in yarısı** (bkz. §5.1).
Controller: `auth`(444) `device`(180) `work-session`(138) `user-preference`(84).

### 11. RAPOR / DASHBOARD — 1.780 satır

`reports/production`(384) `reports/quality`(224) `reports/inventory`(221) `reports/sales`(204)
`reports/customer`(186) `reports/subcontract`(162) `reports/audit`(155) `reports/_shared`(112) ·
`dashboard.service.ts` (141).
Route: `reports.routes`(29, yalnız mount eder) + `reports/*` (403) + `dashboard`(72). Controller yok.

### 12. DONANIM / ÇEVRE BİRİM — 652 satır

`peripheral.service.ts` (440) · `helpers/printer-transport`(101) · `helpers/device-transport`(88)
· `helpers/codec/meter.codec`(27). Route: `peripheral`(187). Controller yok.

---

## 3. Alt dizin sınıflaması (görev maddesi 4)

### `src/services/helpers/` — 67 dosya / 10.217 satır — **context DEĞİL, kesişim yeri**

Bu dizin homojen değil. Ölçülen dört ayrı sınıf var:

| Sınıf | Dosya | Satır | Örnekler | Değerlendirme |
|---|---|---|---|---|
| **Etiket render zinciri** | 27 (raster dahil) | ~4.500 | `label-*`, `native-*`, `raster/*` | BELGE context'inin motoru; `helpers/` altında olması yanıltıcı, aslında `label-render/` alt modülü |
| **Domain kuralı taşıyan helper** | ~20 | ~2.700 | `roll-step`(399, WorkOrderStep+RollMovement yazar) · `roll-disposition`(330, Roll yazar) · `batch-dispatch-surgery`(393, SubcontractorDispatch yazar) · `kursun-bypass-eligibility`(279) · `coverage`(278) · `allocation`(240) · `workorder-clone`(236) · `order-status`(185) | **Bunlar "yardımcı" değil, servis.** Denetimde servis gibi incelenmeli |
| **Kilit / eşzamanlılık** | 4 | 512 | `workorder-locks`(229) · `duplicate-guard`(155) · `shipment-locks`(54) · `sack-invariants`(77) | `pg_advisory_xact_lock` sarmalayıcıları; eşzamanlılık denetiminin ilk durağı |
| **Altyapı / saf yardımcı** | ~16 | ~1.500 | `pg-*`(4) · `backup-naming` · `db-swap-command` · `name-normalize` · `fold-type` · `quality-grade` · `codec/meter.codec` · transport'lar | Gerçekten helper |

### `src/services/document-render/` — 20 dosya / 5.632 satır — BELGE context'inin **saf render katmanı**

Üç alt grup: **yoğunluk/stil profilleri** (`doc-style` 323, `doc-density` 305,
`traveler-card.density` 306, `fason-ceki.density` 284, `doc-fields` 143, `doc-table` 127,
`traveler-card.fields` 243, `fason-ceki.fields` 161, `traveler-card.sections` 80),
**belge HTML üreticileri** (`traveler-card.html` 719, `shipment-dispatch` 593, `fason-ceki` 531,
`fason-direct-ship` 346, `kartela-ceki` 250, `fason-receipt` 235, `quality-certificate` 217,
`return-dispatch` 213, `free-document` 121), ve **şablon motoru + fixture**
(`traveler-card-raw` 292, `sample-data` 163).

Katman ihlali: `document-render/*.html.ts` dosyalarının 8'i `printed-document.service`'i,
2'si `system-setting.service`'i **doğrudan import ediyor** — yani "saf renderer" değil,
kendi verisini de çekiyor.

### `src/services/reports/` — 8 dosya / 1.640 satır — **salt-okunur, izole ada**

Yedi rapor servisinin **hiçbiri** domain servislerini (workorder/inventory/shipping…) import etmiyor;
yalnız `reports/_shared`(112) paylaşıyorlar. Prisma delegate erişimi de neredeyse yok
(yalnız `production.report` içinde 3 tekil erişim ölçüldü) → **raporlar ham SQL / aggregate yazıyor**
ve domain sorgu kurallarını (ör. `K18_DEAD_STATUSES`, brüt/net iade kuralı) **kopyalamak zorunda**.
Bu, denetimin bakması gereken en somut "iki kaynak" riskidir.

---

## 4. Context'ler arası bağımlılık

### 4.1 Runtime (value import) döngüsü: **YOK** — doğrulandı

Dosya seviyesinde `import type` kenarları ayrıştırılarak Tarjan SCC koşturuldu:
> `=== RUNTIME (value) import SCCs, size>1 === (yok)`
> `=== mutual pairs where BOTH edges are value imports === (yok)`

Yani hiçbir servis dosyası çifti birbirini **çalışma zamanında** karşılıklı import etmiyor.

### 4.2 Tip seviyesinde döngü: **3 adet** (derlemede silinir, çalışma zamanında zararsız)

| Döngü | İleri kenar (value) | Geri kenar (type-only) |
|---|---|---|
| `label.service` ↔ etiket helper'ları (20 dosyalık SCC) | `label.service` → `label-html.helper`, `label-renderer.registry`, `label-rawcode`, `native-label.shared` | 8 helper'ın hepsi `import type { LabelPayload } from "../label.service"` |
| `workorder.service` ↔ `workorder-batch-drop.service` | `workorder.service` → `workorder-batch-drop.service` (satır 97) | `import type { CancelDisposition }` (satır 46) |
| `document-render/traveler-card.html` ↔ `traveler-card-raw` | `.html` → `traveler-card-raw` (satır 24) | `traveler-card-raw` → `import type { TravelerCardSnapshot… }` (satır 24) |

Denetim notu: bu üç yer **tip sözleşmesinin yanlış dosyada durduğunu** gösterir
(`LabelPayload` 20 dosyanın ortak sözleşmesi ama 1.985 satırlık servisin içinde yaşıyor).
Kırılganlık: biri `import type`'ı `import`'a çevirirse gerçek bir runtime döngü doğar ve
TypeScript uyarmaz.

### 4.3 Context seviyesinde **çift yönlü** bağımlılık: **8 çift**

Dosya seviyesinde döngü olmasa da context seviyesinde 8 karşılıklı bağ var —
bunlar sınırın gerçekten çizilmediği yerlerdir.

| Çift | Yön 1 | Yön 2 | Yorum |
|---|---|---|---|
| **ÜRETİM ↔ İSTASYON** | İSTASYON→ÜRETİM: 17 value import (tambur/kurşun → `batch.service`, `roll-step`, `workorder-locks`, `roll-finalize`, `station-capability-transfer`, `workorder-manual-move`) | ÜRETİM→İSTASYON: 2 (`workorder.service` + `workorder-manual-move` → `kursun-bypass-guard`) | En yoğun bağ. Pratikte **tek bir context** olabilirler |
| **ÜRETİM ↔ BELGE** | ÜRETİM→BELGE: 11 (`batch.service`→`printed-document.service`, `workorder.service`→`traveler-card.service`, 5 yerde `traveler-card-dirty/fanout`) | BELGE→ÜRETİM: 1 (`traveler-card.service`→`batch.service`) | Refakat kartı üretimin içine gömülü |
| **ÜRETİM ↔ FASON** | FASON→ÜRETİM: 4 (`subcontractor.service`→`batch.service`, `roll-step`, `roll-barcode`, `workorder-locks`) | ÜRETİM→FASON: 2 (`workorder.service`→`subcontractor.service` + `subcontractor-cancel`) | İki 6.000 satırlık dosya birbirini çağırıyor |
| **ENVANTER ↔ İSTASYON** | İSTASYON→ENVANTER: 4 (`tambur-manual`/`tambur-undo`→`inventory.service`) | ENVANTER→İSTASYON: 3 (`inventory.service`→`kursun-bypass-guard`, `kursun-bypass-eligibility`, `quality-grade`) | |
| **BELGE ↔ SİSTEM** | BELGE→SİSTEM: 16 (her belge servisi `audit` + `system-setting`) | SİSTEM→BELGE: 4 (`system-setting.service` satır 18-26 → `doc-style`, `traveler-card.density/fields/sections`) | `system-setting` ayar **doğrulaması** için render katmanını import ediyor |
| **BELGE ↔ SEVKİYAT** | SEVKİYAT→BELGE: 5 | BELGE→SEVKİYAT: 1 (`label.service`→`sack-invariants.helper`) | Çuval etiketi |
| **BELGE ↔ DONANIM** | BELGE→DONANIM: 1 (`label.service`→`printer-transport`) | DONANIM→BELGE: 1 (`peripheral.service`→`label-template.service`) | |
| **ENVANTER ↔ TANIM** | TANIM→ENVANTER: 1 (`product-recipe.service`→`fold-type`) | ENVANTER→TANIM: type-only 1 | Zayıf; `fold-type` yanlış context'te olabilir |

### 4.4 Merkezî (hub) servisler — fan-in ölçümü

`src/` içinde kaç dosya import ediyor (kendisi hariç):

| Servis | Fan-in | Not |
|---|---|---|
| `audit.service` | **50** | Her CUD'un çağırdığı append-only log; beklenen |
| `system-setting.service` | **33** | 2.840 satır, SystemSetting'e 58 erişim — **ayar tanrı-nesnesi**; 9 context'ten çağrılıyor |
| `base.service` | **19** | Jenerik CRUD çekirdeği |
| `printed-document.service` | 14 | Belge dondurma; FASON/SEVKİYAT/ÜRETİM'den çağrılıyor |
| `label.service` | 12 | (çoğu kendi helper zincirinden, `import type`) |
| `batch.service` | 9 | ÜRETİM'den 4 farklı context'e sızıyor |
| `traveler-card.service` | 3 | |
| `inventory.service` | 3 | |
| `workorder.service` | 3 | |

---

## 5. Context sınırı bulanık olan yerler

> Denetimin öncelik listesi. Her madde ölçümle desteklenmiştir.

### 5.1 `admin.routes.ts` (1.293 satır) iki context'i tek dosyada tutuyor — **kesin**

40 endpoint ölçüldü. Dağılım:
- **KİMLİK/YETKİ (22 endpoint):** `/permissions`, `/users` (13 adet: create/update/deactivate/reactivate/delete/permissions×4/reset-password/card-token/credentials/quick-pin/apply-template), `/permission-templates` (5), `/sessions/purge`.
- **SİSTEM/OPS (18 endpoint):** `/perf` (3), `/system-logs` (8), `/settings` (2), `/backup` + `/backups` (4), `/system-logs/archive` (2).

Dosya **controller kullanmıyor**, 10 servisi doğrudan import ediyor
(`audit`, `auth`, `permission-management`, `system-setting`, `system-log`, `backup`,
`backup-impact`, `latency-stats`, `latency-persist`, `session-registry`).
Denetimde: tek dosyada iki farklı yetki rejimi (`admin:users` vs `admin:settings`) yan yana.

### 5.2 Katmanlama tutarsız — 14 route dosyası **hem** controller **hem** servis kullanıyor — **kesin**

- Controller kullanan route dosyası: 33
- Servisi **doğrudan** import eden route dosyası: 33
- **İkisini birden yapan: 14** (`color`, `customer`, `customer-branch-list`, `defect-type`,
  `fabric-property`, `item`, `order`, `peripheral`, `product-recipe`, `quality-grade`,
  `return-reason`, `route`, `station`, `work-session`)

Yani "route → controller → service" sözleşmesi yok; aynı dosyada iki desen karışıyor.
Ayrıca **SİSTEM, RAPOR ve DONANIM context'lerinin hiç controller'ı yok** (0 satır);
`admin.routes` 1.293 satırlık iş mantığını route katmanında taşıyor.

### 5.3 Domain servisi olmayan modeller — `new BaseService({modelName})` route içinde — **kesin**

6 model yalnız route dosyasında konfigüre edilmiş jenerik CRUD ile yönetiliyor,
kendi servisi yok: `station`, `machine` (`station.routes.ts:15,33`),
`customerBranch` (`customer-branch-list.routes.ts:16`), `qualityGrade`
(`quality-grade.routes.ts:59`), `defectType` (`defect-type.routes.ts:17`),
`returnReason` (`return-reason.routes.ts:15`).
Bunların iş kuralı (varsa) route dosyasına ya da `base.service`'in generic yollarına dağılmış.
`route.routes`/`product-recipe.routes`/`defect-type.routes`/`station.routes` ayrıca
`helpers/guarded-hard-remove`(355) ile **fiziksel DELETE** yapıyor — soft-delete kuralının bilinçli istisnası,
ama guard mantığı servis değil helper'da ve route'tan çağrılıyor.

### 5.4 `Roll` modeli 11 context'in **11'inde** yazılıyor/okunuyor — **kesin**

Ölçüm: `Roll -> ÜRETİM:87, İSTASYON:67, FASON:58, ENVANTER:46, SEVKİYAT:43, BELGE:8,
SİPARİŞ:6, TANIM:3, KİMLİK:2, SİSTEM:1, RAPOR:1` (toplam 322 delegate erişimi).
`RollMovement` 8 context'te, `RollOperation` 8, `WorkOrderStep` 6, `RollError` 7.
**Top yaşam döngüsünün tek sahibi yok.** Statü geçişi kuralları (`RollStatus`,
`preShipStatus`, `form`, `qualityGrade`) her context'te ayrı ayrı uygulanıyor.
Denetimde: aynı geçişin farklı yerlerde farklı guard'larla yazılıp yazılmadığı.

### 5.5 `subcontractor.service.ts` (6.056) üretim durum makinesine yazıyor — **kesin**

Ölçülen yazma noktaları: `tx.workOrderStep.update` ×5 + `updateMany` ×1
(satır 1043, 2046, 2067, 2689, 5439, 5463) ve `tx.workOrder.update` ×3 (2059, 2704, 5479).
Yani fason kabulü/sevki iş emri adım durumunu **ÜRETİM context'inin dışından** değiştiriyor.
`WorkOrderStep` erişim sayısı FASON'da 22 — ÜRETİM'in kendisiyle (22) **eşit**.

### 5.6 `shipping.service.ts` kartela (Swatch) yönetiyor — **kesin**

`Swatch` erişimi: SEVKİYAT **15**, FASON 6, İSTASYON 5, BELGE 1.
`shipping.service` içinde `tx.swatch.updateMany` ile atomik claim yapılıyor
(satır 562, 572, 607, 658, 735). Kartela FASON context'inin modeli ama en çok
SEVKİYAT dokunuyor. `sack-search.service` de `Swatch` okuyor.
Ek olarak `swatch.routes.ts` (67 satır) **`TamburController`'ı** import ediyor
(`src/routes/swatch.routes.ts:6`) — kartela envanteri, tambur controller'ından servis ediliyor.

### 5.7 `inventory.service.ts` sevkiyat modellerini okuyor — **kesin**

`prisma.shipment.findMany/count/findUnique` (satır 1624, 1635, 2739, 2846) ve
`prisma.sack.groupBy/findUnique` (1640, 2747, 2856). Envanter listeleri
sevkiyat özetini kendi kurıyor; SEVKİYAT'ın `attachTotals`/brüt kuralı ile
aynı sorunun ikinci bir uygulaması olma riski var (CLAUDE.md'deki "dördüncü kaynak dördüncü rakam" uyarısı).

### 5.8 `system-setting.service.ts` (2.840) **hem** ayar deposu **hem** belge şeması doğrulayıcısı — **kesin**

Satır 18-26: `document-render/doc-style`, `traveler-card.density`, `traveler-card.fields`,
`traveler-card.sections` import ediliyor. Yani SİSTEM context'i BELGE'nin render sözleşmesine bağımlı.
Aynı dosya SystemSetting'e 58 delegate erişimi yapıyor ve 33 dosya tarafından import ediliyor.
CLAUDE.md'de anlatılan "dört kapı birlikte güncellenmeli" kuralının kaynağı burası.

### 5.9 `reports/` domain servislerini hiç kullanmıyor — **kesin**

7 rapor servisinin import grafiği yalnız `reports/_shared`'a gidiyor.
Bu, brüt/net iade kuralı, `K18_DEAD_STATUSES`, `producedOutputWhere` gibi
"tek kaynak" kurallarının rapor tarafında **kopya** olarak yaşadığı anlamına gelir.
Denetimde doğrudan sorgulanmalı: rapor rakamları liste ekranlarıyla aynı kuralı mı uyguluyor?

### 5.10 `accounting-export.service.ts` (619) SEVKİYAT'ta ama işlevi rapor — **şüpheli**

`Shipment`/`DirectShipment`/`RollReturn` okuyup Excel üretiyor;
`shipping.controller` tarafından çağrılıyor. RAPOR context'ine mi ait, SEVKİYAT'a mı —
sınır kararı verilmemiş. **ŞÜPHELİ** çünkü konumu haklı gösteren bir kural bulamadım;
CLAUDE.md brüt kuralını burada da uyguluyor (`accounting-export.service.ts:255` referansı),
bu da onu SEVKİYAT'ın iç kuralına bağlıyor.

### 5.11 `return-reason` / `defect-type` / `quality-grade` — master data mı, domain mi? — **şüpheli**

TANIM context'ine koydum çünkü hepsi jenerik `BaseService` ile yönetiliyor
ve kendi servisleri yok. Ama semantik olarak `ReturnReason` SEVKİYAT'a,
`DefectType` İSTASYON'a, `QualityGrade` ÜRETİM/İSTASYON'a ait.
Gruplama kararı **teknik desene** göre yapıldı, anlama göre değil — bu ayrımın kendisi bir bulanıklık işareti.

### 5.12 Device / Machine / PeripheralDevice üçlüsü üç context'e dağılmış — **kesin**

- `Device` → KİMLİK:19, TANIM:2, DONANIM:1
- `Machine` → KİMLİK:4, TANIM:4, DONANIM:2, İSTASYON:2
- `PeripheralDevice` → DONANIM:12, BELGE:6, TANIM:3, KİMLİK:2, SEVKİYAT:1

`device.service` (352) cihaz eşleşmesi/onayı yapıyor (kimlik), `peripheral.service` (440)
yazıcı/kantar yönetiyor (donanım), `machine` ise `station.routes.ts` içinde jenerik CRUD.
"Cihaz" kavramının üç ayrı anlamı üç yerde yaşıyor.

### 5.13 `helpers/` içinde 20 kadar dosya aslında servis — **kesin**

Delegate yazma yapan helper'lar: `roll-step.helper` (WorkOrderStep 5, RollMovement 5, Roll 2,
WorkOrder 2), `roll-disposition.helper` (Roll 4), `batch-dispatch-surgery.helper`
(SubcontractorDispatch 9, DispatchItem 5), `guarded-hard-remove` (17 farklı modelde delete),
`workorder-clone.helper` (WorkOrder 3, Roll 2, RollError 2), `coverage.helper` (Roll 3),
`order-status.helper` (Order 2, OrderLine 2), `work-session.helper` (WorkSession 6),
`kursun-bypass-guard.helper` (KursunBypassAssignment 2).
Denetimde bunlar "yardımcı" diye atlanmamalı — transaction sınırı ve guard mantığı burada.

### 5.14 Ölü / erişilemez kod — **kesin (ölçüldü)**

`src/` içinden **hiçbir dosya tarafından import edilmeyen** 2 servis dosyası:
- `src/services/helpers/codec/meter.codec.ts` (27 satır) — yalnız `scripts/test_device_transport.ts` kullanıyor
- `src/services/helpers/label-flow-to-canvas.ts` (149 satır) — yalnız
  `scripts/test_label_canvas_equivalence.ts` ve `scripts/migrate_label_templates_to_canvas.ts` kullanıyor

Route ve controller tarafında ölü dosya **yok** (0).
Servis katmanından hiç erişilmeyen Prisma modeli: **2** — `RouteStepProperty`, `RollBarcodeCounter`.
(İkisi de nested write / raw SQL ile kullanılıyor olabilir → **ŞÜPHELİ**, delegate deseni taramasıyla
görünmezler; `RouteStepProperty` CLAUDE.md'de `route.service.applyStepTargets` üzerinden anlatılıyor,
`RollBarcodeCounter` ise `roll-barcode.helper` içinde raw SQL ile artırılıyor olabilir — doğrulanmadı.)

### 5.15 Dev boyutu dengesizliği — denetim eforu buraya gitmeli

16 dosya ≥1000 satır ve toplamı **40.976 satır** = servis katmanının **%53,2**'si:
`workorder`(6.073) `subcontractor`(6.055) `inventory`(4.318) `shipping`(3.476) `tambur`(3.318)
`system-setting`(2.839) `order`(2.819) `kursun-bypass`(2.362) `label`(1.984) `kursun-qc`(1.656)
`kartela`(1.522) `label-template`(1.325) `tambur-manual`(1.220) `return`(1.134)
`traveler-card`(1.067) `permission-management`(1.008).

FASON context'i **yalnız 4 dosyada 8.244 satır** taşıyor (dosya başına 2.061) —
en yüksek dosya-başı yoğunluk. ENVANTER de tek dosyada 4.319 satır.

---

## 6. Denetimin bakması önerilen sıra (bu haritanın çıkardığı öncelik)

1. **Roll yaşam döngüsü** — 11 context, 322 delegate erişimi, tek sahip yok (§5.4).
2. **ÜRETİM ↔ İSTASYON ↔ FASON üçgeni** — 29.746 satır, 3 çift yönlü bağ, iki 6.000 satırlık dosya (§4.3, §5.5).
3. **`helpers/` içindeki domain servisleri** — transaction ve kilit mantığı burada (§5.13, §3).
4. **`system-setting.service` fan-in 33 + BELGE'ye ters bağımlılık** (§5.8).
5. **`admin.routes.ts` 1.293 satır, controller'sız, iki yetki rejimi** (§5.1).
6. **`reports/` izolasyonu — kural kopyası riski** (§5.9).
7. **Katman tutarsızlığı: 14 route hem controller hem servis** (§5.2).

---

## 7. Yöntem (tekrar üretilebilirlik)

Tüm ölçümler `Teks-Erp/` kökünden koşuldu.

- **Satır:** `find <dir> -name '*.ts' -exec wc -l {} +` (context toplamları için aynı semantiği
  kullanan Node script; toplamın 77.067'ye denk geldiği doğrulandı).
- **Import grafiği:** `from "…"` regex'i ile göreli import'lar çıkarıldı; `import type` /
  `export type` kenarları ayrı işaretlendi. Döngü tespiti Tarjan SCC.
- **Prisma model erişimi:** `\b(prisma|tx|client|db)\.(model)\.(findMany|findFirst|findUnique|
  create|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b` deseni,
  model adları `schema.prisma`'daki `^model (\w+)` listesinden camelCase'e çevrilerek.
  **Sınırlama:** nested write (`connect`/`createMany` içinde), `$queryRaw` ve
  `BaseService`'in dinamik delegate erişimi (`(prisma as unknown as Record<…>)[modelName]`,
  `base.service.ts:208`) bu tarama ile **görünmez**. Bu yüzden TANIM context'inin
  gerçek model dokunuşu ölçülenden fazladır.
- **Context ataması:** anlam esaslı, elle. Kural: `document-render/*` → BELGE;
  `helpers/(label|native|raster)*` → BELGE; `reports/*` → RAPOR; kalan her dosya
  açık listeyle atandı. Atanmamış dosya kalmadı (`???` = 0).
- Script'ler: `<scratchpad>/deps.js`, `deps2.js`, `cycles.js`, `ctx.js`, `ctxdeps.js`,
  `ctxmodels.js`, `orphan.js`, `rc.js`, `routes.js`.
