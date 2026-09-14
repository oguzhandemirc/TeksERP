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
| Y1–Y4 | `workorder-link:389` createMany · `workorder:1072` · `:5841` · `workorder-clone.helper:159` | create | ~~`skipDuplicates` yerine **partial unique çakışması 409**~~ **GEÇERSİZ → 2026-09-14 (1e hükmü): `skipDuplicates` KORUNDU** — servis açık çifti `existing` ile eler (no-op idempotency), doğrudan ikinci açık INSERT DB'de P2002 (bekçi §3); clone yalnız AKTİF bağları kopyalar |

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

## 8. Çelişmeli doğrulama — 2026-09-14 (47, `b7365874` → origin `4af71a54` ↔ bu plan)

**Sonuç: damga mekanizması ayakta — damga üçlüsü, vekil id + partial unique, beş yazar, `WorkOrder.type` aynası ve migration canlı dump'ta ÖLÇÜLDÜ. Bir YÜKSEK kalem (K0: `withActiveOrderLinks` yürüyücüsü `Date`/`Decimal`i eziyor — tarih süzgeçli sipariş listesi ve istatistik şeridi düşüyor, `test_order_stats` ❌ deterministik), K1 orta (`scripts/` okurları süzgeçsiz — envanter `src/`le sınırlıydı), K2/K3 küçük, altı not. Dördü de 82'de aynı gün KAPANDI ve ikinci turda yeniden ölçüldü — durum satırı bölüm sonunda.**
Yöntem: klon DB'de 21 bekçi (`order_link_unlink` 21/0 · `workorder_order_link` · `order_cancel_card_dirty` · `order_line_cancel` · `db_invariants` · `defter_ters_yol` · `consistency_derived` · `master_data_merge_fk_coverage` · `shipment_order_ledger` · `wo_cancel_disposition` · `wo_cancel_fason` · `timestamptz_contract` · `kanban_card_projection` · `open_order_coverage` · `order_filter_wostate` · `workorder_search` · `hide_cancelled_lists` · `order_stats` · `roll_property_revoke` · `workorder_documents` · `order_cancellation` — 20 yeşil, `order_stats` ❌ K0; yük altında değil, tek başına ve birim sondayla doğrulandı) · `tsc` 0 · dokuz sonda (S1–S9, scratchpad; `scripts/` dışından koşuldu) · en eski canlı dump'ta migration provası (`dump/…20260911…`, 307 satır) · statik okuma. Taban `8bc31816` (G1+G2) — bu commit onun üstündedir, tren sırası öyle olmalı.

| plan maddesi | sonuç | nasıl |
|---|---|---|
| §1 damga üçlüsü, satır silinmez, yeniden bağlama YENİ satır, `@@id` → vekil `id` + partial unique (`@@unique` Prisma'da, `WHERE unlinkedAt IS NULL` DB'de) | ✅ | `order_link_unlink` §1–§3 · `db_invariants` envanter satırı · S6 (replace, kapalı çift → yeni açık satır, kapalı durur) |
| §1 migration add-only, canlı dump provası | ✅ | 2026-09-11 dump'ı → `tekserp_47_prova` (taban `20260905172000`) → `migrate deploy` bütün tren (…`031000`) yeşil; 307/307 `id`li · 307 açık · PK(`id`) · `active_pair_uq` partial · `id` DEFAULT düştü (`column_default` boş) · SQL ikinci kez koşuldu: hepsi "skipping", PK yine `id`, indeks 4 · `migrate diff` yalnız bilinen iki DEFERRABLE bileşik FK (dosya başlığı zaten söylüyor) — WOTOL farkı 0 · `gen_random_uuid()` PG13+ yerleşik, 5 emsal migration |
| §2 tek kaynak: `ACTIVE_ORDER_LINK` · `unlinkOrderLinesTx` · `activeOrderLinkCount` · tip aynası açık sayıdan | ✅ (K2 hariç) | statik · §4 bekçi · S3 (seçicisiz çağrı — K2) |
| §3 S1–S5 damga sebebiyle; S2 FARK bazlı (kalan satır `id`/`createdAt` korunur, `allocatedQty` yerinde) | ✅ | `order_link_unlink` §1/§7 · `order_line_cancel` · `order_cancel_card_dirty` · `workorder_order_link` (ORDER_CANCEL damgası) · S9: replace'te ayna DOĞRULAMAYLA (allocations>0 → ORDER'a çevirir; ORDER + 0 → 400) — sayaçla değil ama aynı sonuç |
| §3 Y1–Y4 `skipDuplicates` korundu (fcb7ab85 hükmü) | ✅ | S1: partial unique `ON CONFLICT DO NOTHING`un ARBİTERİ — ikinci açık INSERT sessiz `count=0`, `create` ise P2002 (§3) |
| §4 okuyucu envanteri: `src/` delegate 15 + ilişki 24, ham SQL 0, istisna 0 | ✅ `src/` · ❌ `scripts/` (K1) | `order_link_unlink` §13 (AST yalnız `src/` yürür: `revoke-ast-tarama.ts:162`) · grep: `orderLinks: true`/`_count` süzgeçsiz 0 · bileşik anahtar girdisi `workOrderId_orderLineId` src+scripts+istemci 0 |
| §4 serbest metin yolları (`orderLinks.some…` · `lines.some.workOrderLinks.some…`) | ✅ süzgeç · ❌ K0 (yürüyücü Date/Decimal'i bozuyor) | src'de tam 3 string yol (`order.routes:47` · `workorder.service:1548/:1553`), iki tüketici de `withActiveOrderLinks` sarılı · S5: iç içe AND/OR'da ekler, açık `unlinkedAt` yüklemini EZMEZ, `every`ye dokunmaz (kullanım 0), `none`a ekler |
| §4 istemci: API şekli değişmez | ✅ | Electron/mobil `unlinkedAt`/`unlinkReason` atfı 0 |
| §5 bekçi + negatif sondalar | ✅ | 21/0; negatifler 82'nin (sha doğrulamalı) — yeniden koşulmadı |
| §6.1 birleştirme | ✅ n/a | tablo master-data FK taşımaz; `merge_fk_coverage` yeşil |
| §6.2 fark hesabı claim SONRASI tx içinde | ✅ | `freshLinks` :5850, `replaceClaim` :5581 — aynı tx, kilit altında |

**Kalemler (82)**

- **K0 · `withActiveOrderLinks` yürüyücüsü `Date`/`Prisma.Decimal` değerlerini `{}`ye çeviriyor (YÜKSEK).** `walk` her `typeof === "object"` değeri `Object.entries` ile yeniden kurar; `Date`in numaralandırılabilir alanı yok → `{}`, `Decimal` iç alanlarına (`s/e/d`) açılır. `OrderService.buildListWhere` override'ı (:331) BaseService'in `applyDateRange` (:473) ÇIKTISINI sardığı için `?dateFrom/dateTo` taşıyan sipariş listesi (`findAll` :481 · cursor :538) ve istatistik şeridi (`getOrderStats` :613) Prisma doğrulama hatasıyla düşer — `test_order_stats` ❌: `order.service.ts:630 groupBy … createdAt: { gte: {} } — Argument _ref is missing`. Birim: `withActiveOrderLinks({ createdAt: { gte: new Date() } })` → `{"gte":{}}`. İş emri listesi (:1546) yürüyücüyü `applyDateRange`ten ÖNCE uyguladığı için bugün kurtuluyor — tesadüf. Kalem: yalnız DÜZ nesne yürünsün (`v instanceof Date || Prisma.Decimal.isDecimal(v) || Buffer.isBuffer(v) || Object.getPrototypeOf(v) !== Object.prototype` → aynen dön) + `test_order_link_unlink`e "Date/Decimal yürüyücüden aynen çıkar" sondası. Sınıf: `test_order_stats` "modele dokunan 39" listesinde değildi ama `is-emri.md` bekçi listesindedir — alan listesi koşulmalıydı.
- **K1 · `scripts/` okurları süzgeçsiz — envanter `src/`le sınırlıydı (orta).** `test_consistency_derived` §21 ve `scripts/consistency-check-derived.sql` §21 (`COUNT(*)`/`EXISTS … work_order_to_order_lines` — `"unlinkedAt" IS NULL` YOK): son bağı koparılıp STOK'a dönmüş iş emri **"STOK ama sipariş bağı VAR"** sapması sayılır (S7 ölçtü: `type=STOCK_PRODUCTION`, `bag_sayisi=1`). Bölüm `mode: "info"` olduğu için bekçi kırmızıya düşmez ama mutabakat raporu fabrikadaki İLK koparmadan itibaren yalan söyler; §21 yorumu da bayat (`onDelete: Cascade` — K5'ten beri Restrict). Aynı sınıf: `scripts/fix_workorder_type_from_links.ts` aday sorgusu `orderLinks: { some: {} }` (S8: koparılmış bağlı STOK iş emri ADAY) — `--apply` ile DOĞRU olan STOK tipi SİPARİŞE ÖZEL'e çevrilir, yani onarım script'i yanlış yöne yazar (dry-run varsayılanı yumuşatır, düzeltmez). Kalem: SQL'e `AND l."unlinkedAt" IS NULL` ×2 (+ `.sql` ikizi), fix script'ine `some: ACTIVE_ORDER_LINK` + `orderLinks: { where: ACTIVE_ORDER_LINK, … }`. Sınıf notu: AST kapısı `src/` dışını yürümez; `scripts/` ham SQL'i (`work_order_to_order_lines` 4 dosya) kapı görmez — plan §4 "istisna YOK" yalnız `src/` için ölçülmüştü.
- **K2 · `unlinkOrderLinesTx` seçicisiz çağrıda TÜM açık bağları damgalar (küçük, savunma).** Dört seçici de isteğe bağlı; `{ pairs: [] }` 0 döner ama `{ reason }` tek başına `WHERE unlinkedAt IS NULL` = bütün tablo (S3: tx içinde ölçüldü, damga = DB'deki açık bağ sayısı; geri alındı). Çalışma zamanında `undefined` kalan bir `orderId` (`wo?.id`) sessizce bütün bağları koparır. Emsal helper'lar kapsamı zorunlu tutar (`revokeTargetProperties.workOrderId` zorunlu, `clearShipmentAllocationsTx(shipmentId)` konumsal). Kalem: seçici yoksa `throw`/0 (ya da ayrık birlik tipi).
- **K3 · beyan `tersYazan` = `linkOrderLines`; emsal DAMGAYI YAZAN helper (küçük).** `RollProperty` beyanında ters yazan `revokeRollProperties` (damgayı yazan); burada ileri yazıcı `linkOrderLines` yazılmış — DAMGA mekanizmasının ters yolu `unlinkOrderLinesTx`tir (`order-link.helper.ts`), yeniden bağlama ileri satırdır (un-unlink yok, plan §1). `defter_ters_yol` §4a yalnız "sembol o dosyada tanımlı mı" ölçtüğü için iki hâlde de yeşil — sessiz. Kalem: `tersYazan → { dosya: "src/services/helpers/order-link.helper.ts", sembol: "unlinkOrderLinesTx" }`.

**Notlar**

- Bileşik anahtar girdisi `workOrderId_orderLineId` Prisma'da hâlâ üretilir (`@@unique`): bir kapalı + bir açık satırla `findUnique` **KAPALI satırı** döndürdü (S4, fiziksel sıra), `upsert` P2039/42P10 sınıfı. Bugün kullanım 0; AST §13b `ACTIVE_ORDER_LINK`sız çağrıyı kırmızı yapar. `RollProperty` notuyla aynı sınıf (OZELLIK-PIVOT §12).
- Eşzamanlı iki `linkOrderLines` aynı çift: tek satır, ikisi de `linked=1` ve ikisi de `ORDER_LINK_ADDED` audit'i yazar (S2) — `createMany().count` okunmuyor; damga öncesi de böyleydi, 1e hükmüyle (no-op idempotency) uyumlu, yalnız raporlama/audit doğruluğu.
- `unlinkedAt: new Date()` uygulama saati — `revokedAt`/`clearedAt` emsalleriyle aynı; doğum-anı kuralı yok (G2 sınıfı buraya uygulanmaz).
- `WorkOrder.orderLinks` süzgeci sipariş softDelete'te yalnız CANLI iş emri çiftlerini koparır (`livePairs`); iptal/devredilmiş iş emrine bağ AÇIK kalır — damga öncesiyle aynı (deleteMany de yalnız livePairs'i siliyordu), okurlar iş emri durumuyla süzer.
- Prova DB `tekserp_47_prova` DROP listesine (1e).
- Ölçülemedi: 82'nin üç negatif sondası yeniden koşulmadı (sha doğrulamalı, commit mesajında); HTTP uçtan uca istek (servis düzeyi sondalar yeter).

**Kalemlerin son durumu (1e, tren #59/#60)**

- **K0 + K2 KAPANDI** — 82 `6ecb405a` → origin `99f8fec8` (#59): `walk` yalnız düz nesneye iner (`Object.getPrototypeOf` = `Object.prototype`/`null`), seçicisiz `unlinkOrderLinesTx` fırlatır; bekçi `test_order_link_unlink` §8 (Date/Decimal/Buffer birebir) + §1b (fırlatır, açık bağ sayısı değişmez), negatif sondalar 82'de. İkinci tur (47, `a8017b49` üstünde): `order_stats` ✅ · `order_link_unlink` ✅ · `consistency_derived` ✅ · `defter_ters_yol` ✅ · `order_filter_wostate` ✅; sonda B1 (Date/Decimal/Buffer referansı korunur, `some`/`none` yüklem alır) · B2 (seçicisiz → fırlatır, `pairs: []` → 0) · B3 (§21 süzgeçli SQL sapma 0, fix script aday 0, ham satır 1 koparılmış) — üçü ✅.
- **K1 + K3 KAPANDI, #60'ta iniyor** — 82 `a8017b49` (origin `763d5691`): §21 ts + `.sql` ikizi `AND l."unlinkedAt" IS NULL`, bayat Cascade yorumu düzeltildi; `fix_workorder_type_from_links` `some: ACTIVE_ORDER_LINK` + `orderLinks.where`; beyan `tersYazan → unlinkOrderLinesTx`.
- **Açık (1e → d5/d9):** AST kapısı (`aktifYuklemTara`) `src/` dışını yürümez — `scripts/`teki ham SQL/delegate okurları sınıf olarak korumasız; K1 bu sınıfın ilk örneğiydi.
