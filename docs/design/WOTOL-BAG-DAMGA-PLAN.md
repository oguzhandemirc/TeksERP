# İş emri ↔ sipariş kalemi bağı (`WorkOrderToOrderLine`) — DAMGA planı

> **Durum: UYGULANDI (2026-09-14, 82, tek commit; migration `20260914031000`).** Envanter aşağıda ölçüldüğü gibi kaldı; sapmalar §7'de. Şema penceresi sırası (1e): 01 WEAVING → 6e K2 `SackAllocation` → K3(b) Faz 1 → **bu plan**. Faz 1 ile aynı pencere sırasında AYRI commit. Beyan: `scripts/lib/defter-beyan.ts` `WorkOrderToOrderLine` (PIVOT_TICARI, yarı, 5 silme sitesi borç). Kardeş plan: `OZELLIK-PIVOT-SURUMLEME-PLAN.md` (aynı mekanizma, aynı fazlama disiplini — burada tekrar edilmez).

## 1. Karar (1e hükmü) ve şema

- **Mekanizma:** DAMGA `unlinkedAt` + `unlinkedById` (+ `unlinkReason` VarChar(64): `MANUAL_UNLINK` · `WO_REPLACE` · `ORDER_LINE_CANCEL` · `ORDER_DELETE` · `ORDER_CANCEL`). Satır silinmez; yeniden bağlama YENİ satır yazar (un-unlink yok — `defter.md` "damga silinmez").
- **Bileşik `@@id([workOrderId, orderLineId])` DAMGAYLA YAŞAYAMAZ** — aynı çift ikinci kez bağlanınca PK çakışır. Migration: vekil `id UUID PK` + **partial unique** `(workOrderId, orderLineId) WHERE "unlinkedAt" IS NULL` (raw SQL; Prisma partial unique tanımaz → `test_db_invariants` envanterine girer, `RollProperty` ile aynı satır). `@@id` → `@@unique` DEĞİL (tam unique yeniden bağlamayı yasaklar).
- **Add-only:** kolonlar nullable, mevcut 394+ satır `unlinkedAt = NULL` = açık. Prova en eski canlı dump'ta (`docs/kurallar/deploy-kurulum.md`).
- **`updatedAt` kalır** (yarı beyanı) — damga yazımı onu da günceller, zararsız.

## 2. Tek kaynak

`src/services/helpers/order-link.helper.ts` (yeni): `ACTIVE_ORDER_LINK = { unlinkedAt: null } satisfies Prisma.WorkOrderToOrderLineWhereInput` + `unlinkOrderLinesTx(tx, { workOrderId?, orderLineId?, orderId?, reason, userId })` (atomik: `updateMany WHERE {…ACTIVE_ORDER_LINK}`, dönüş `count`). Beş silme sitesi bu helper'a döner; `WorkOrder.type` aynası **açık bağ sayısından** türer (`count({ where: { workOrderId, ...ACTIVE_ORDER_LINK } })`).

## 3. Yazar siteleri (tarayıcı, 2026-09-14)

| # | Site | Bugün | Yeni |
|---|---|---|---|
| S1 | `workorder-link.service.ts:467` `unlinkOrderLine` | `delete` | `unlinkOrderLinesTx(reason: MANUAL_UNLINK)`; `:474` `remaining` count aktif süzer |
| S2 | `workorder.service.ts:5816` `replace` | `deleteMany` + `:5841` nested create | **FARK bazlı**: çıkanlar damga (`WO_REPLACE`), girenler create, kalanlar dokunulmaz (sürüm enflasyonu değil, `createdAt` = "ne zaman bağlandı" korunsun) |
| S3 | `order.service.ts:529` `cancelOrderLine` | `deleteMany` | damga `ORDER_LINE_CANCEL`; `:534` remaining aktif |
| S4 | `order.service.ts:2944` `softDelete` | `deleteMany` (livePairs) | damga `ORDER_DELETE`; `:2958` remaining aktif |
| S5 | `order.service.ts:3361` `cancelWithActions` | `deleteMany` | damga `ORDER_CANCEL`; `:3382` remaining aktif |
| Y1–Y4 | `workorder-link:389` createMany · `workorder:1072` · `:5841` · `workorder-clone.helper:159` | create | `skipDuplicates` yerine **partial unique çakışması 409** ("bu kalem zaten bağlı"); clone yalnız AKTİF bağları kopyalar (`:106` select süzülür) |

## 4. Okuyucu envanteri — kim `unlinkedAt: null` süzecek

**Delegate okumaları (17):** hepsi süzülür — `workorder.service.ts:1803` · `:5650` · `workorder-link.service.ts:200` · `:369` · `:450` · `:474` · `:597` · `tambur.service.ts:4013` · `order.service.ts:534` · `:1298` · `:2499` · `:2552` · `:2911` · `:2958` · `:3320` · `:3339` · `:3382`. İstisna YOK: bugün hiçbir okur "eski bağ" istemiyor (ölçüldü: hepsi canlı bağ/karşılama sorusu).

**`WorkOrder.orderLinks` ilişkisi (yazım dışı 24 atıf, 8 dosya):**

| Dosya | Atıf | Süzgeç |
|---|---|---|
| `workorder.service.ts` | `:1187` · `:1270` (detay) · `:1617` · `:1632` (liste preload) · `:1993` · `:3511` (kapanış) · `:6697/:6733` (linkedOrders) | ✅ `where: ACTIVE_ORDER_LINK` |
| `workorder.service.ts` | `:1534` · `:1539` `codeSearchFields` "orderLinks.some.orderLine.order…" | ✅ `some: { ...ACTIVE_ORDER_LINK, orderLine… }` — arama koparılmış bağdan eşleşmesin |
| `order.service.ts` | `:386` `_count.orderLinks` · `:429` `willBecomeStock` | ✅ `_count: { select: { orderLinks: { where: ACTIVE_ORDER_LINK } } }` |
| `subcontractor.service.ts` | `:4688` · `:6228` (`:6343/:6388` sipariş kalemi kümesi) | ✅ |
| `inventory.service.ts` | `:2813/:2846` (topun sipariş bağı) | ✅ |
| `traveler-card.service.ts` | `:1181/:1231` snapshot ÜRETİMİ | ✅ süz — snapshot canlı bağdan doğar |
| `document-render/traveler-card.html.ts` · `traveler-card-raw.ts` | `:312 …` `:82 …` | ⛔ **SÜZÜLMEZ** — `PrintedDocument.snapshot` okur, DB'ye dokunmaz (donmuş belge, plan §1 "tarihsel okur yazılmaz") |
| `helpers/workorder-clone.helper.ts` | `:106` select · `:157` | ✅ (yazar tablosunda) |
| `helpers/shipment-auto-draft.helper.ts` | `:174-181` | ⛔ ADAŞ — `shipmentOrder` okur, bu tablo değil |
| `label.service.ts` | `:173` yorum | ⛔ yorum |

**`OrderLine.workOrderLinks` ilişkisi (15 atıf):** `order.routes.ts:46` codeSearch · `:64` liste select ("kalem kilitli mi", CANCELLED WO'yu istemci süzüyor — damga sonrası **sunucu** süzer, istemci koşulu kalır) · `order.service.ts:203` (üretim sürüyor mu) · `:377/:423` · `:2340/:2418/:2470` · `:2862/:2874` · `:3035/:3076` · `:3105-3119` — **hepsi süzülür**. Yorumlar (`workorder.service.ts:433/:1106`, `order.service.ts:1050`) dokunulmaz.

**İstemci (Electron/mobil 18 dosya):** API şekli DEĞİŞMEZ — dizi aynı, yalnız açık bağlar döner. `test_api_contract` türü bekçi varsa dokunulmaz.

## 5. Bekçi ve sondalar

Yeni `scripts/test_order_link_unlink.ts` (emsal `test_sack_tags` §10): §1 unlink satırı SİLMEZ (damga üçlüsü) · §2 yeniden bağlama YENİ satır, açık 1 / toplam 2 · §3 aynı çifti ikinci kez bağlama 409 (partial unique) · §4 `WorkOrder.type` aynası açık sayıdan (koparınca STOCK, bağlayınca ORDER) · §5 sipariş listesi/`_count` koparılmış bağı saymaz · §6 refakat kartı snapshot'ı canlı bağdan doğar, eski PrintedDocument değişmez · §7 replace fark bazlı: değişmeyen bağın `createdAt`i korunur. **Negatif sondalar (ürün kodunda, sha doğrulamalı):** (a) S1 `delete`e geri → §1 ❌ · (b) `_count` süzgeci düşür → §5 ❌ · (c) partial unique'i tam unique yap → §2 ❌ · (d) beyan: `silen` boşalınca `test_defter_ters_yol` §10 "ÖLÜ SİLME BEYANI" ❌ → beyan `{DAMGA unlinkedAt}` + tersYazan (yeniden bağlayan `linkOrderLines`) aynı commit'te.

Mevcut bekçiler yeniden ölçülür: `test_workorder_order_link.ts` · `test_shipment_order_ledger` · `test_wo_cancel_*` · `test_master_data_merge_fk_coverage` (yeni PK kolonu birleştirme haritasına girer mi — şemadan türeyen kapı kendisi sorar).

## 6. Riskler

1. **Birleştirme (master-data merge):** `orderLineId` birleştirme haritasında; damgalı satır da taşınır (partial unique yalnız açık satırda ⇒ çakışma yok). `merge_fk_coverage` kendisi ölçer.
2. **`replace`in fark hesabı `replaceClaim` sonrası tx içinde** (Y7 dersi) — tx dışı okuma TOCTOU.
3. **Sürüm notu:** rakam değişmez; "Bağlı iş emirleri" listesi koparılmış bağı zaten göstermiyordu (silinmişti). Not gerekmez, ea'ya bilgi.

## 7. Uygulama notları (2026-09-14)

- Migration: vekil `id` `gen_random_uuid()` varsayılanıyla backfill, sonra `DROP DEFAULT` (Prisma `@default(uuid())` uygulama tarafı — diğer PK'larla aynı, `migrate diff` gürültüsüz). Bileşik PK koşullu `DO $$` bloğuyla düşer (yeniden koşulabilir).
- S2 `replace()`: kalan bağın `allocatedQty`si YERİNDE güncellenir (bağın kimliği/`createdAt`i korunur; `updatedAt` bu yüzden kalır — "yarı"); çıkan `WO_REPLACE`, giren yeni satır. §7 bekçisi ölçer.
- Y1–Y4 `createMany skipDuplicates` KORUNDU (plan "partial unique çakışması 409" demişti): servis açık çifti `existing` ile zaten eler, koparılmış çift yeni satır alır; doğrudan ikinci açık INSERT DB'de P2002 (§3). 409'a çevirmek yeni bir yarış kapısı açmazdı, no-op idempotency'yi bozardı.
- Serbest metin arama yolları (`orderLinks.some.…` · `lines.some.workOrderLinks.some.…`) AST'nin göremediği string yollar: `withActiveOrderLinks` yürüyücüsü `buildWhereClause` çıktısına aktif yüklemi ekler (iş emri listesi + `OrderService.buildListWhere` override).
- Bekçi `test_order_link_unlink` §1–§7 + §13 (21 kontrol); üç negatif sonda: S1 delete'e geri → 7 ❌ · partial→tam unique (DB) → §2/§3 ❌ · `order.routes` `where` düşürüldü → §13c ❌. `test_workorder_order_link` sözleşmeye (63/0). Beyan DEFTER {DAMGA unlinkedAt}, ters yazan `linkOrderLines`.
