# D-E — ERP İŞ KURALI DEĞİŞMEZLERİ (Bölüm 3-E) · ② BULMA · TUR 1

**Tarih:** 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · Denetçi: D-E (kod merkezli mercek)
**Girdiler:** `audit/00-map/K10-degismezler.md` (ana), `MATRIX.md` ÇAPRAZ OKUMA §A/§B/§C, `K2b` (DB kısıtları), `K3a/K3b` (claim/kilit), `K11` (bekçi), `KRITIK-YAZMA-YOLLARI.md §7.2`, `SINIR-OTESI-YONLENDIRME.md §E`, `K12` (önceki defter uzlaştırması), beceri `express-api-audit` (§3, §7.8, §8, §9).
**Veri:** `audit/tools/sql-saha.sh` → `tekserp_saha_0825` (prod'un 2026-08-25 kopyası, 190/195 migration, salt-okunur). Tüm K2 sayıları bu koşumdan (2026-08-28). Repo altında hiçbir dosya değiştirilmedi.
**Yöntem:** Her değişmez için DÖRTLÜ — ① kural kodda var mı (dosya:satır) → ② eşzamanlılık altında korunuyor mu (claim/kilit/unique) → ③ DB kısıtı destekliyor mu → ④ mevcut veride ihlal var mı.

> **K12 disiplini:** `audit/FINDINGS.jsonl`'de bu alanla örtüşen AÇIK/REDDEDİLMİŞ satır yok. `F-SEV-DOG-001` (brüt kural yedi yüzeyde tutarlı) ve `F-SEV-ESZ-003` (`updateMany` sınıflandırması) bulguları **yeniden açılmadı** — aşağıda "Doğru yapılanlar"da teyit edildi. Reddedilmiş hiçbir bulgu yeni kanıt olmadan açılmadı.

---

## 0. Bulgu özeti

| id | Şiddet | Kanıt | Değişmez | Tek cümle |
|---|---|---|---|---|
| D-E-01 | **S1** | K1 | INV-SEV-08 / SEV-01 | Sipariş satırının kalan kapasitesi HİÇBİR yerde zorlanmıyor; kapasite `OrderLine` kilidinden ÖNCE okunuyor → iki sevkiyat aynı satırı iki kez sevk eder |
| D-E-02 | **S1** | **K2** | INV-STK-02 / WO-10 | Depo kesimi `initialQty`'yi de düşürüyor; "üretim anı snapshot'ı" sözleşmesi kırık → iş emri üretilen metrajı geriye dönük azaldı (IE1408260004: −76,7 m) |
| D-E-03 | S2 | **K2** | INV-STK-03 / STK-04 | Depo kesiminde kaynak top tamamen tükenince emekli edilmiyor → 0 metrajlı hayalet top Bitmiş Depo'da (2 satır) |
| D-E-04 | S2 | **K2** | INV-AUD-04 / SM-01 | İptal izi 8 yazma noktasının 6'sında yazılmıyor; Tambur geri alma bugün de damgasız iptal üretiyor (son hafta 47/52) ve `preCancelStatus`'suz 126 top geri alınırsa YANLIŞ rafa döner |
| D-E-05 | S2 | K1 | INV-SEV-06 / SEV-03 | `cancelReturn` sevkiyat kapsam kilidini almıyor ve sevkiyat statüsünü okumuyor → `Roll SHIPPED` ↔ `Shipment PLANNED/CANCELLED` çelişkisi |
| D-E-06 | S2 | K1 | INV-SM-03 / WO-09 | Fason 7 sitede adım statüsünü doğrudan yazıyor: "fasonda top kalmadı" ≠ "adımda iş kalmadı" → adım ve gerekirse İŞ EMRİ, içinde canlı top varken kapanır ve kapanış dispozisyonu HİÇ sorulmaz |
| D-E-07 | S2 | K1 | INV-SM-01 | `reopenStep` son-adım dalı **SCRAP (fire) topu üretime geri çekiyor** — "fire geri alınamaz" değişmezi belgesiz bir kapıdan deliniyor |
| D-E-08 | S2 | K1 | INV-STK-02 / YT-06 | `applyManualProperties` "bütün top" koşulunu tx DIŞINDA okuyor, claim metrajı pinlemiyor → eşzamanlı Tambur kesimi ile kesilen metraj iki kez sayılır |
| D-E-09 | S2 | **K2** | INV-YT-02 (SoD) | 8 aktif kullanıcının 6'sı "sevk et + sevki geri al + metraj düzelt" üçlüsünü birlikte taşıyor; katalogdaki SoD tasarımı hiçbir yerde zorlanmıyor |
| D-E-10 | S2 | **K2** | INV-STK-02 | `currentQty ≤ initialQty` DB seddi yok; 2 canlı ihlal, ikincisi kod düzeltmesinden 5 gün SONRA doğdu, tespit yalnız ELLE koşulan §13'te ve kod yorumu hâlâ "TEK böyle satır" diyor |
| D-E-11 | S3 | K1 | INV-DOC-04 | Refakat kartı arşiv kopyası değiştirilebilir: aynı sürümün yeniden basımı defterdeki snapshot'ı ÜZERİNE YAZAR (generic belge yolunda böyle bir dal yok) |
| D-E-12 | S3 | K1 | INV-SEV-01 / SM-08 | `order.reopen` ve `order.update` `recomputeOrderStatus`'u tam-küme kilidi olmadan çağırıyor (helper'ın kendi yazdığı protokolün ihlali) |

**Bilgi/bilinçli olarak ayrılan 9 madde** Bölüm 2'de; **doğru yapılanlar** Bölüm 3'te.

---

## 1. Bulgular

### [D-E-01] Sipariş satırının kalan kapasitesi hiçbir yerde zorlanmıyor: aynı satır iki sevkiyatla iki kez sevk edilebilir ve `shippedQty` sessizce `quantity`'yi aşar

| Şiddet | S1 | Kategori | E — Satınalma/Satış/Sevkiyat · "Kalan miktar aşımı" | Öncelik | P1 | Modül | SEV (sevkiyat/sipariş) | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Bir sipariş satırına ne kadar sevk edilebileceği (`quantity − shippedQty`) yalnız **tahsis hesabı yapılırken** okunuyor; ne tahsis yazımında, ne sevk (`DISPATCHED`) anında, ne de defter yeniden hesaplanırken bir üst sınır kontrolü var. `OrderLine` satır kilidi (`touchOrderLinesTx`) kapasite okumasından **SONRA** alınıyor. Sonuç: 500 m'lik bir kaleme iki ayrı sevkiyattan 1000 m sevk edilebilir; sipariş `COMPLETED` görünür, "Açık" 0 basar, hiçbir uyarı çıkmaz. Aynı boşluk fason doğrudan sevk yolunda **kapatılmış** (`subcontractor.service.ts:6217-6285`, yorumu "OVER-COVER guard") — asıl (çuval) sevk yolunda kapatılmamış.

**Kanıt.**
- Kapasite hesabı — üst sınır satır başına `need`'de kesiliyor, ama `need` **bayat** okunuyor:
  `Teks-Erp/src/services/helpers/allocation.helper.ts:93-116`
  ```ts
  export function allocate(rolls, lines) { …
    for (const line of sorted) {
      let need = Prisma.Decimal.max(0, line.quantity.minus(line.shippedQty));
  ```
- Sevkiyat kurulumunda `need` yine `shippedQty`'den türüyor ve `shippedQty` **yalnız DISPATCHED** tahsisleri sayar:
  `Teks-Erp/src/services/shipping.service.ts:1318-1334` (`const need = new Prisma.Decimal(l.quantity).minus(l.shippedQty);`)
- Tahsisler yazıldıktan **sonra** dispatch ediliyor; `performDispatchTx` tahsisleri yeniden doğrulamıyor, yalnız defteri topluyor:
  `Teks-Erp/src/services/shipping.service.ts:1873-1879`
  ```ts
  const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
  await recomputeOrderStatusForOrders(tx, orderIds);
  ```
  → kilit, kapasitenin okunduğu `writeShipmentAllocationsTx` çağrısından (`:1424`) SONRA alınıyor.
- Defter tarafında da tavan yok — ham toplam yazılıyor:
  `Teks-Erp/src/services/helpers/order-status.helper.ts:48-81` (`computeLineLedger`) ve `:96-199` (`recomputeOrderStatus`; `shippedQty` doğrudan yazılır, `quantity` ile karşılaştırılmaz).
- Helper'ın **kendi dokümanı** bu sırayı yasaklıyor: `order-status.helper.ts:22-30` — *"Kapasite (`quantity - shipped`) tx DIŞINDA okunup tx İÇİNDE yazılırsa READ COMMITTED altında iki işlem birbirinin commit'ini görmez ve `quantity`'yi aşar (over-coverage). Bu yardımcı kapasite TAZE okunmadan ÖNCE çağrılır"*.
- **Karşı örnek (doğru desen, aynı invariant):** `Teks-Erp/src/services/subcontractor.service.ts:6217-6285`
  ```ts
  await touchOrderLinesTx(tx, allOrderLines.map((l) => l.id));
  const freshLines = await tx.orderLine.findMany({ … quantity, shippedQty … });
  …
  const remaining = new Prisma.Decimal(line.quantity).minus(line.shippedQty);
  if (new Prisma.Decimal(a.qty).greaterThan(remaining)) throw AppError.conflict(…);
  ```
- **Koruma kontrolü (altı kaynak çözüldü):** DB'de CHECK yok — `order_lines` üzerindeki tek CHECK çifti `order_lines_quantity_pos` ve `order_lines_shippedQty_nonneg` (canlı kopyada `pg_constraint` ile doğrulandı). Trigger yok (K2b: `rolls` dışında trigger yok). `SackAllocation` unique'i `(sackId, orderLineId)` — çuval×satır, iki AYRI çuvalın aynı satıra tahsisini engellemez. "Bir sipariş tek aktif sevkiyatta" partial unique'i **bilerek düşürülmüş** (`prisma/migrations/20260711120000_.../migration.sql:85-87`: `DROP INDEX IF EXISTS "shipment_orders_active_order_uq";`). Feature-flag yok. UI kelepçesi ("Açık" negatifi `max(0)`) sunucuyu korumaz.

**Çakışma senaryosu (rejim A — sevk onayı KAPALI, sahadaki mevcut ayar `shipping.confirmationEnabled=false`).**
- **T1** (Paketleme 1): `createShipment` → tx açılır → `computeSackAllocations` `OL.shippedQty = 0` okur → `need = 500` → çuvallarından 300 m tahsis eder.
- **T2** (Paketleme 2, 200 ms sonra): `createShipment` → tx açılır → **hâlâ** `shippedQty = 0` okur → `need = 500` → kendi çuvallarından 300 m tahsis eder.
- **T1** `performDispatchTx` → `touchOrderLinesTx` (kilidi ŞİMDİ alır) → recompute → `shippedQty = 300` → commit.
- **T2** `touchOrderLinesTx`'te bloklanır, T1 commit edince devam eder → recompute **iki sevkiyatın tahsisini** toplar → `shippedQty = 600`.
- **SONUÇ:** `quantity = 500`, `shippedQty = 600`. Sipariş `COMPLETED`, "Açık = 0" (UI `max(0)` ile kelepçeler), müşteriye 100 m fazla mal gitmiştir ve hiçbir ekranda uyarı yoktur.

**Çakışma senaryosu (rejim B — sevk onayı AÇIK; eşzamanlılık GEREKMEZ).** Onay açıkken sevkiyat `PLANNED` doğar ve `PLANNED` tahsisler `shippedQty`'ye **sayılmaz** (tasarım). Pazartesi A sevkiyatı kurulur (500 m tahsis, PLANNED). Salı B sevkiyatı kurulur — `need` hâlâ 500 (A sayılmıyor) → 500 m daha tahsis. Çarşamba ikisi de "Sevk Et" ile DISPATCHED olur → `shippedQty = 1000`. **Bu bir yarış değil, ardışık iki meşru işlemin sonucudur.**

**failure_mode.** `SIP2508260007 / kalem: PAMUK-EKRU 500 m`. İki paketleme istasyonu aynı kalem için birer sevkiyat kurar (mevcut modelde meşru — "bir sipariş tek aktif sevkiyatta" kısıtı 2026-07-11'de bilerek kaldırıldı). Her ikisi sevk edilir → `order_lines.shippedQty = 1000`, `orders.status = COMPLETED`, sipariş detayında "İstenen 500 / Sevk 1000 / Açık 0". Muhasebe export'u ve Sevk Karnesi 1000 m'yi brüt basar. Fazladan çıkan 500 m'lik mal ancak müşteri şikâyetiyle fark edilir.

**Veride fiili ihlal (K2).** **Arandı, 0.**
```sql
-- sevk > istenen
SELECT ol.id, ol.quantity, ol."shippedQty" FROM order_lines ol WHERE ol."shippedQty" > ol.quantity;              -- 0 satır
-- sevk + PLANNED tahsis > istenen
… HAVING ol."shippedQty" + COALESCE(SUM(sa.qty) FILTER (WHERE sh.status='PLANNED'),0) > ol.quantity;             -- 0 satır
-- aynı kalem >1 PLANNED sevkiyatta tahsisli
SELECT sa."orderLineId", count(DISTINCT sk."shipmentId") FROM sack_allocations sa … WHERE sh.status='PLANNED' GROUP BY 1 HAVING count(DISTINCT sk."shipmentId")>1;  -- 0 satır
```
Bugün 0 olmasının sebebi ölçüldü: sahada **`shipping.confirmationEnabled = false`** (`system_settings`) → sevkiyat kurulur kurulmaz aynı tx'te DISPATCHED oluyor, yani B rejimi kapalı ve A rejiminin penceresi tek tx uzunluğunda. Sevkiyat sayıları: 39 DISPATCHED, 1 PLANNED. **Bayrak açıldığı gün pencere günlere çıkar** — Sevk Kapısı özelliği tam bunun için var (CLAUDE.md 2026-08-22).

**İş etkisi.** Müşteriye fazla mal çıkışı; siparişin "kapandı" görünmesi; muhasebe export'unda ve Sevk Karnesi'nde fazla metraj; envanterden fazla düşüm. Bu, kontrol listesinin *"En olası bulgu, mutlaka repro et"* diye işaretlediği maddedir.

**Öneri (2. tur için).**
1. `createShipment` / `addSacksToShipment` / `removeSackFromShipment` içinde `writeShipmentAllocationsTx`'ten **ÖNCE** etkilenen siparişlerin TAM satır kümesini `touchOrderLinesTx` ile kilitle, kapasiteyi kilit ALTINDA taze oku (fason `directShip` ile birebir aynı sıra).
2. `performDispatchTx`'te, `shipmentOrder` kümesi çözüldükten sonra kilit altında **son bir cap doğrulaması** koş: `Σ(bu sevkiyatın tahsisleri) + shippedQty > quantity + tolerans` ise 409 (`OVER_SHIP`) — ya da **bilinçli iş kararıysa** aynı yerde `ApiResponse.warnings` ile UYARI üret (rota kapsaması emsali, CLAUDE.md 2026-08-27). Kararı iş sahibi vermeli: ⚠️ **sert blok tek başına yanlış olabilir**, çünkü brüt kural gereği iade `shippedQty`'yi düşürmez (INV-SEV-05) → iade edilen malın yeniden sevki meşru olarak "aşım" görünür. Uyarı metni bu iki durumu ayırmalı.
3. Migration/veri dokunuşu **gerekmiyor** (yalnız servis katmanı). `[PROD'DA ÇALIŞTIRMA]` gereken bir şey yok; geri alma = commit revert.

**Kabul kriteri.** `scripts/test_shipment_overship.ts`: (a) aynı kaleme iki paralel `createShipment` → biri 409/uyarı, `shippedQty ≤ quantity + tolerans`; (b) onay AÇIK rejimde ardışık iki PLANNED sevkiyat → ikincisinin tahsisi 0 ya da uyarı; (c) **negatif sonda** — `touchOrderLinesTx` çağrısı `writeShipmentAllocationsTx`'in altına taşınırsa test KIRMIZI olmalı.
**Efor:** 1,5 gün.
**Önceki defter:** yok (`F-SEV-ESZ-001/002/003` farklı konular; `F-SEV-DOG-001` brüt kural).

---

### [D-E-02] Depo kesimi `initialQty`'yi de düşürüyor: "üretim anı snapshot'ı" sözleşmesi kırık, iş emrinin üretilen metrajı geriye dönük azalıyor

| Şiddet | S1 | Kategori | E — Üretim · türetilmiş alan semantiği | Öncelik | P1 | Modül | ÜRE/ENV | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `Roll.initialQty` iki farklı anlam taşıyor. Üretim kesiminde (`cutOpenFabric`) yalnız `currentQty` düşüyor, `initialQty` girişte kalıyor. **Depo kesiminde (`cutWarehouseRoll`) ikisi BİRLİKTE düşüyor** ve aşım dalında ikisi de **0**'a çekiliyor. Ancak iş emri detayı "üretilen metraj"ı `initialQty`'den okuyor ve kodun kendi yorumu bunu *"üretim anı, re-cut sonrası sıfırlanmaz, snapshot sabit"* diye tarif ediyor. Sözleşme kırık: depoda kesilen her top, üretildiği iş emrinin çıktı rakamını geriye dönük azaltıyor.

**Kanıt.**
- Depo kesimi ikisini birden düşürüyor (yorum bunu bilinçli anlatıyor ama kapsamı yalnız etiket/UI olarak görüyor):
  `Teks-Erp/src/services/tambur.service.ts:2218-2246`
  ```ts
  // Parent kısalıyor — initialQty'i de güncelle (her kesim sonrası reset).
  …
  ? await tx.roll.update({ where: {…}, data: { currentQty: 0, initialQty: 0 } })      // aşım dalı
  : await tx.roll.update({ where: {… currentQty: { gte: data.cutLength } },
      data: { currentQty: { decrement: data.cutLength }, initialQty: { decrement: data.cutLength } } });
  ```
- Üretim kesimi düşürmüyor (ayrışmanın kaynağı): `Teks-Erp/src/services/tambur-undo.service.ts:1111-1113` — *"cutOpenFabric: … yalnız currentQty geri (kesim yalnız onu düşmüştü; `initialQty` orijinal girişte durur)"*.
- Tüketici sözleşmeyi açıkça yazıyor: `Teks-Erp/src/services/workorder.service.ts:2187-2214`
  ```ts
  // Metraj initialQty (production anı), currentQty değil — re-cut sonrası sıfırlanmaz, snapshot sabit.
  const producedRollRows = await prisma.roll.findMany({ where: this.producedOutputWhere(stepIds), select: { initialQty: true, … } });
  …
  bucket.totalMeters = bucket.totalMeters.plus(r.initialQty);
  ```
  ve parça listesi `workorder.service.ts:2227-2235` (`currentQty: r.initialQty`).
- Operatör yüzeyi: `Electron/src/pages/Operations/Rolls/RollDetailSheet.tsx:236-243` — "Başlangıç: {initialQty} m" + doluluk çubuğu `(currentQty / initialQty) * 100`. Depo kesimi sonrası `currentQty === initialQty` olduğu için satır **hiç çizilmez**: topun kesildiği bilgisi detay panelinden de silinir.
- **Koruma kontrolü:** `initialQty` üzerinde DB CHECK yok (yalnız `rolls_initialQty_nonneg`), trigger yok, `initialQty`'yi write-once yapan bir sed yok, bekçi yok (`scripts/` altında `initialQty` değişmezliğini ölçen dosya bulunamadı; `test_tambur_undo.ts` §11 yalnız `currentQty ≤ initialQty` ilişkisini ölçüyor).

**failure_mode.** İş emri **IE1408260004**'ün Tambur adımı 1.KALİTE `T190826F0119` (36,7 m) ve `T190826F0120` (40,0 m) topları üretti. 19.08'de bu iki top Bitmiş Depo'da Top Kesme ile tamamen kesildi (çocuklar `T190826F0125`/`F0126`, sonra SHIPPED). Kesim `initialQty`'yi de sıfırladığı için iş emri detayındaki **"Üretilen Toplar" listesi bu iki topu 0 m gösteriyor** ve iş emrinin 1.KALİTE üretim metrajı **1537,1 m → 1460,4 m** (−76,7 m, %5) düştü. Kesim çocukları `entrySource = TAMBUR_SPLIT` ikinci nesil olduğu için `producedOutputWhere` kapsamına da girmiyor → kayıp telafi edilmiyor.

**Veride fiili ihlal (K2).**
```sql
-- Üretim çıktısı kapsamındaki toplar (producedInStepId dolu) — IE1408260004
SELECT wo."workOrderNumber", count(*) parca, sum(r."initialQty") uretilen, sum(r."currentQty") suanki
FROM rolls r JOIN work_order_steps s ON s.id=r."producedInStepId" JOIN work_orders wo ON wo.id=s."workOrderId"
WHERE wo."workOrderNumber"='IE1408260004' GROUP BY 1;
-- → 21 parça · uretilen 1460.400 · suanki 948.400    (kesimden önce 1537,1 olmalıydı)

SELECT barcode, "initialQty", "currentQty", status, "qualityGrade" FROM rolls
WHERE barcode IN ('T190826F0119','T190826F0120');
-- → T190826F0119 | 0.000 | 0.000 | WAREHOUSE | 1.KALITE
--   T190826F0120 | 0.000 | 0.000 | WAREHOUSE | 1.KALITE

-- Genel yaygınlık: çocuk toplamı parent initialQty'yi aşan parent'lar
SELECT p.status, count(*) parent, sum(CASE WHEN cs.t > p."initialQty"+0.001 THEN 1 ELSE 0 END) asan
FROM rolls p JOIN LATERAL (SELECT SUM(c."initialQty") t FROM rolls c WHERE c."parentRollId"=p.id AND c.status<>'CANCELLED') cs ON true
WHERE cs.t IS NOT NULL GROUP BY 1;
-- → WAREHOUSE 3/2 · TAMBUR_CONSUMED 114/34 · IN_PRODUCTION 4/0
```
(TAMBUR_CONSUMED'daki 32 aşan parent'ın `OVERAGE` defter satırı var — aşım bayrağı AÇIK, meşru. Defterlisiz kalan 4 satırın 2'si bu bulgunun, 2'si D-E-10'un konusu.)

**İş etkisi.** İş emri "Üretilen" rakamı ve Kalite/Üretim Karnesi geçmişe dönük değişiyor; aynı iş emri iki farklı gün açıldığında iki farklı üretim metrajı gösteriyor. Fabrikanın verim/kalite ölçümü ve fason karşılaştırmaları bu rakama dayanıyor. Ayrıca topun gerçek giriş metrajı kalıcı olarak kayboluyor (audit 6 ayda arşivleniyor — INV-AUD-03).

**Öneri (2. tur için).**
1. **Doğru yön: `initialQty` write-once olsun.** `cutWarehouseRoll` yalnız `currentQty`'yi düşürsün (üretim kesimiyle aynı); "kesilmiş top" bilgisinin etikette görünmemesi ayrı bir sunum kararıdır ve `RollDetailSheet`'in `currentQty !== initialQty` koşuluyla zaten çözülüyor.
2. Geriye dönük düzeltme **[PROD'DA ÇALIŞTIRMA]**: `initialQty`'si düşürülmüş toplar için doğru değer `currentQty + Σ(çocukların initialQty)` ile yeniden kurulabilir; **dry-run varsayılan** script + etkilenen her kaydı listeleme zorunlu (CLAUDE.md canlı veri kuralı). Geri alma yolu = yedekten restore. Bu düzeltme **iş kararıdır** (§13'ün 2 satırında olduğu gibi "kök nedeni gizlememek" için bilerek bırakılabilir) — asıl teslimat 1. maddedir.
3. Alternatif (şemaya dokunmayan): üretim çıktısı metriği `initialQty` yerine ayrı bir `producedQty` snapshot kolonundan okusun — ama bu migration ister, `prod_risk: yuksek`.

**Kabul kriteri.** `scripts/test_warehouse_cut_initial_qty.ts`: 100 m depo topu → 30 m kes → `initialQty` **100 kalır**, `currentQty` 70; iş emri detayında "üretilen" değişmez; **negatif sonda** — `initialQty: { decrement }` geri konursa test KIRMIZI.
**Efor:** 0,5 gün (kod) + 0,5 gün (opsiyonel backfill script'i).
**Önceki defter:** yok. K7b'nin *"İş emri ÇIKAN `initialQty`, karne `currentQty` — aynı topun iki yüzeyde iki metrajı"* gözleminin kök nedeni budur.

---

### [D-E-03] Depo kesiminde kaynak top tamamen tükenince emekli edilmiyor: 0 metrajlı hayalet top Bitmiş Depo'da kalıyor

| Şiddet | S2 | Kategori | E — Stok/Depo | Öncelik | P2 | Modül | ENV (envanter) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Top Kesme akışı iki adımdır: `cutWarehouseRoll` (parça üret + kaynağı düş) ve `finalizeWarehouseCut` (kaynağı `TAMBUR_CONSUMED` yap + kalanı çocuğa taşı). Operatör kaynağın tamamını kesip ekranı **"Bitir" demeden** kapatırsa kaynak top `WAREHOUSE` statüsünde, `0/0` metrajla depoda kalır. Emekliye ayıran hiçbir otomatik yol, temizlik işi ya da tutarlılık bölümü yok.

**Kanıt.**
- Kesim kaynağı düşürür ama statüye dokunmaz: `Teks-Erp/src/services/tambur.service.ts:2232-2247` (yukarıdaki alıntı; `status` yazılmaz).
- Emeklilik yalnız ayrı bir uçta: `Teks-Erp/src/services/tambur.service.ts:2467-2483`
  ```ts
  const claim = await tx.roll.updateMany({
    where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null },
    data: { status: RollStatus.TAMBUR_CONSUMED },
  });
  ```
- **Koruma kontrolü:** `INV-STK-04` (`TAMBUR_CONSUMED ⇒ currentQty=0`) tersini (yani `currentQty=0 ⇒ tüketilmiş`) söylemiyor; `consistency-check.sql` §1-§26b içinde "depo statüsünde 0 metrajlı top" bölümü **yok** (K10 §3 listesi tarandı). DB CHECK yok (`rolls_currentQty_nonneg` sıfıra izin verir — doğru, çünkü `IN_PRODUCTION` kurşun öncesi top da 0 m doğar: `inventory.service.ts:4173`). Zamanlanmış temizlik işi yok (`src/jobs` listesi).

**failure_mode.** Operatör Bitmiş Depo'daki 36,7 m'lik `T190826F0119`'u tek parça hâlinde keser ("36,7 m kes") ve ekranı kapatır. Kaynak top `WAREHOUSE / 0 m / barkodlu / finalizedAt dolu` olarak depoda kalır: Bitmiş Depo listesinde bir satır fazla görünür ("250 top" yerine gerçek 248), çuvala okutulabilir ve çuvalın "top adedi"ni şişirir, sevk irsaliyesinde 0 m'lik bir kalem olarak basılabilir. Metraj toplamları etkilenmez (0 m), ADET metrikleri etkilenir.

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) FROM rolls WHERE status IN ('WAREHOUSE','A1_STOCK','STOCK') AND "currentQty"=0;   -- 2
SELECT barcode, status, "initialQty", "currentQty", "entrySource", "createdAt", "updatedAt"
FROM rolls WHERE barcode IN ('T190826F0119','T190826F0120');
-- T190826F0119 | WAREHOUSE | 0.000 | 0.000 | TAMBUR_SPLIT | 2026-08-19 14:55 | 2026-08-19 15:18
-- T190826F0120 | WAREHOUSE | 0.000 | 0.000 | TAMBUR_SPLIT | 2026-08-19 15:02 | 2026-08-19 15:19
-- (ikisinin de tek çocuğu var ve SHIPPED: T190826F0125 36,7 m · T190826F0126 40,0 m)
```
İkisi de `roll_variances`'ta satır taşımıyor (`SELECT … FROM roll_variances WHERE "rollId" IN (…)` → 0 satır).

**İş etkisi.** Envanter adet sayımı ve çuval içerik sayacı şişer; operatör depoda barkodu duran ama metrajı olmayan bir topu okutmaya çalışır. Ayrıca `Q-STK-03` (kesim toplamı) bu iki satırı sonsuza dek anomali olarak raporlar → mutabakat kapısının sinyali körelir (K12'nin "kırmızı körlüğü" dersi).

**Öneri (2. tur için).** `cutWarehouseRoll` içinde kesimden sonra taze `currentQty === 0` ise kaynağı aynı tx'te `TAMBUR_CONSUMED`'a çek (mevcut `finalizeWarehouseCut` claim'inin aynısı, `preTamburCloseQty/Status` yazımıyla birlikte — geri alma yolunun ihtiyacı var). Mevcut 2 satır için tekil düzeltme **[PROD'DA ÇALIŞTIRMA]** dry-run script'iyle; geri alma = yedekten restore.
**Kabul kriteri.** `scripts/test_warehouse_cut_exhaust.ts`: 40 m topu 40 m kes → kaynak `TAMBUR_CONSUMED`, çocuk 40 m; **negatif sonda** — statü çekme kaldırılırsa KIRMIZI. Ayrıca `consistency-check.sql`'e "serbest statüde 0 metrajlı top" bölümü.
**Efor:** 0,5 gün.

---

### [D-E-04] İptal izi sekiz yazma noktasının altısında yazılmıyor: Tambur geri alma bugün de damgasız iptal üretiyor ve `preCancelStatus`'suz 126 top geri alınırsa yanlış rafa döner

| Şiddet | S2 | Kategori | E — Yetki/onay + izlenebilirlik (INV-AUD-04) | Öncelik | P2 | Modül | ENV/ÜRE | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `CANCELLED ⇒ cancelledAt ∧ cancelledById ∧ cancelReason ∧ preCancelStatus` değişmezi, izin **audit'te değil kolonda** yaşaması kararına dayanıyor (audit 6 ayda arşivleniyor). Kolonları yazan yalnız İKİ yol var; `RollStatus.CANCELLED` yazan ALTI yol bunları hiç doldurmuyor. Bu yalnız eski kayıt sorunu değil: son ölçülen haftada (2026-08-17+) iptal edilen 52 topun **47'si damgasız** ve hepsi Tambur geri alma yolundan geçmiş.

**Kanıt — yazan iki yol.**
- `Teks-Erp/src/services/inventory.service.ts:3253-3275` (`softDelete`): `cancelledAt/cancelledById/cancelReason/cancelReasonCode/preCancelStatus` yazılır (yorumu: *"ÇIKIŞ İZİ topun KENDİ satırında (audit'te DEĞİL — audit 6 ayda arşivlenir…)"*).
- `Teks-Erp/src/services/helpers/roll-disposition.helper.ts:231-244`: `cancelTrail` yazılır — ama `preCancelStatus` **yok**.

**Kanıt — yazmayan altı yol.**
| # | Yer | Yazım |
|---|---|---|
| 1 | `tambur-undo.service.ts:1079` (applySingle çocuk iptali) | `data: { status: RollStatus.CANCELLED }` |
| 2 | `tambur-undo.service.ts:1266` (applySingleRestore) | `data: { status: RollStatus.CANCELLED }` |
| 3 | `tambur-undo.service.ts:1494` (applyFull, N çocuk) | `data: { status: RollStatus.CANCELLED }` |
| 4 | `inventory.service.ts:3562-3568` (`hardDelete`/arşivle) | `data: { status: CANCELLED, currentStepId: null, shipmentId: null, sackId: null }` |
| 5 | `subcontractor.service.ts:4846-4852` (`cancelReceipt` bornRolls) | `data: { status: CANCELLED, currentStepId: null }` |
| 6 | `subcontractor.service.ts:5377-5385` (aktarım geri alma bornRolls) | `data: { status: CANCELLED, currentStepId: null }` |

**Koruma kontrolü.** Kolonlar nullable (migration `20260805170000`); DB CHECK yok, trigger yok (`rolls` üzerindeki tek trigger `rolls_stamp_production_timestamps` yalnız `finalizedAt/statusChangedAt` yazar). Bekçi yok: `test_roll_cancel_undo.ts` yalnız `softDelete` yolunu ölçüyor. Yani sekiz noktanın hizası **hiçbir mekanik kapıdan geçmiyor**.

**failure_mode (iki ayrı sonuç).**
1. **"Neden iptal edildi" kalıcı olarak kaybolur.** Tambur'da 15 parça kesilip finalize edildikten sonra "Geri Al (FULL)" denince 15 çocuk `CANCELLED` olur. Audit satırı yalnız **kaynak topa** yazılır (`event: TAMBUR_UNDO_FULL`), çocukların kendi satırında hiçbir iz yoktur — ölçüldü: bu 47 topun `system_logs`'ta tek satırı var, o da `CREATE` (doğuş). Altı ay sonra arşivleyici o satırı da taşır ve topun neden iptal edildiği sistemde **hiçbir yerde** kalmaz.
2. **İptali geri alma YANLIŞ RAFA yazar.** `preCancelStatus` NULL kalınca `resolveRestoreTargetStatus` beyaz listeye düşemez ve **`STOCK` (Ham Stok)** varsayar (`helpers/roll-cancel-restore.helper.ts:114-120`). Yani 1.KALİTE, barkodlu, Bitmiş Depo'dan iptal edilmiş bir Tambur çocuğu geri alındığında **Ham Stok'a** düşer: satılabilir mal ham kumaş rafına yazılır, Bitmiş Depo sayımı eksik, Ham Stok fazla çıkar.

**Veride fiili ihlal (K2).**
```sql
-- Haftalık kırılım: damgasız / toplam CANCELLED
SELECT date_trunc('week', COALESCE("statusChangedAt","updatedAt"))::date hafta,
       count(*) FILTER (WHERE "cancelledAt" IS NULL) damgasiz, count(*) toplam
FROM rolls WHERE status='CANCELLED' GROUP BY 1 ORDER BY 1;
-- 2026-07-13  5/5 · 07-20 7/7 · 07-27 6/6 · 08-03 50/62 · 08-10 18/97 · 08-17 **47/52** · 08-24 1/1

-- 08-17 sonrası damgasız iptallerin kaynağı
WITH c AS (SELECT id,"entrySource" FROM rolls WHERE status='CANCELLED' AND "cancelledAt" IS NULL AND "statusChangedAt">='2026-08-17')
SELECT "entrySource", count(*) FROM c GROUP BY 1;        -- TAMBUR_SPLIT 47   (tamamı)
SELECT sl."tableName", sl.action, count(*) FROM system_logs sl JOIN c ON c.id::text=sl."recordId" GROUP BY 1,2;
-- ROLL/CREATE 47 · LABEL_PRINT_EVENT/CREATE 53   → hiçbirinde ROLL/UPDATE yok

-- preCancelStatus dağılımı ve "geri alınabilir ama damgasız" küme
SELECT "preCancelStatus", count(*) FROM rolls WHERE status='CANCELLED' GROUP BY 1;
-- WAREHOUSE 5 · IN_PRODUCTION 1 · STOCK 90 · NULL **134**
SELECT count(*) FROM rolls r WHERE r.status='CANCELLED' AND r."preCancelStatus" IS NULL
  AND r."currentStepId" IS NULL AND r."sackId" IS NULL AND r."shipmentId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM roll_movements m WHERE m."rollId"=r.id)
  AND NOT EXISTS (SELECT 1 FROM roll_operations o WHERE o."rollId"=r.id)
  AND NOT EXISTS (SELECT 1 FROM rolls c WHERE c."parentRollId"=r.id)
  AND NOT EXISTS (SELECT 1 FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id);
-- → **126**  (guard'ların hepsini geçen, yani bugün "Geri Al" butonuyla diriltilebilecek top)
```
⚠️ 08-10 haftasında 18/97 damgasız — yani damga **çalışıyor**; 08-17 haftasında 47/52 olması bir gerileme değil, o hafta iptallerin ağırlıklı olarak Tambur geri alma yolundan gelmesi. Bu, H-5'in K10'da açık bırakılan *"hangi iptal yolu izi yazmıyor"* sorusunun cevabıdır.

**İş etkisi.** İzlenebilirlik: iptal gerekçesi 6 ay sonra hiçbir yerde yok (ISO 9001 kayıt kontrolü açısından da zayıf). Envanter: 126 topun herhangi biri geri alınırsa yanlış depoya düşer ve fark ancak elle sayımda görülür.

**Öneri (2. tur için).**
1. Altı yazma noktasını **tek helper'a** al (`cancelRollsTx(tx, ids, { reason, reasonCode, userId, origin })`) — `preCancelStatus`'u da her zaman yazsın (`roll-disposition.helper` dahil). Tambur geri almada sebep operatörden istenmez; sistem sebebi yazılır (`TAMBUR_UNDO_FULL` / `_SINGLE` / `FASON_KABUL_IPTAL` — `ReasonPreset` kataloğuna **eklenmeyen** sistem kodları; `FASON_CEKME` emsali, CLAUDE.md 2026-08-21).
2. Mekanik bekçi: `scripts/test_roll_cancel_trail_coverage.ts` — AST ile `status: RollStatus.CANCELLED` yazan her yazımın helper'dan geçtiğini doğrula (emsal: `test_fason_open_dispatch_single_source.ts`).
3. Geçmiş 134 satır için backfill **[PROD'DA ÇALIŞTIRMA]**: `preCancelStatus` audit'ten/`qualityGrade`+`barcode` tipinden türetilebilir ama **belirsizlik varsa NULL bırak** (uydurma yok). Dry-run varsayılan; geri alma = yedekten restore. Alternatif ve daha ucuz: geri alma yolunda `preCancelStatus` NULL ise operatöre **hedef rafı sor** (bugün sessizce Ham Stok seçiyor).
**Kabul kriteri.** Tambur FULL geri alma sonrası iptal edilen her çocukta `cancelledAt` + `cancelReasonCode` + `preCancelStatus` dolu; bekçi altı noktayı da tarıyor ve helper baypas edilirse KIRMIZI.
**Efor:** 1,5 gün.
**Önceki defter:** yok (K10 **H-5** hotspot'unun cevabı).

---

### [D-E-05] `cancelReturn` sevkiyat kapsam kilidini almıyor ve sevkiyat statüsünü okumuyor: top `SHIPPED` iken sevkiyatı `PLANNED/CANCELLED` olabilir

| Şiddet | S2 | Kategori | E — Sevkiyat · storno/iade | Öncelik | P2 | Modül | SEV | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `undoDispatch` (storno) ve `createReturn` (iade) aynı sevkiyat-kapsamlı advisory kilidi (`8023`) tx'lerinin **İLK ifadesi** olarak alıyor — bu, önceki denetimin `F-SEV-ESZ-001` düzeltmesi. Üçüncü kardeş `cancelReturn` (iade iptali) bu kilidi **almıyor** ve topu `SHIPPED + shipmentId = <eski sevkiyat>` yaparken sevkiyatın **güncel statüsünü hiç okumuyor**. Sonuç: `SHIPPED ⇒ sevkiyatı DISPATCHED` değişmezi (INV-SEV-03, `consistency-check.sql` §9) sessizce delinir.

**Kanıt.**
- Kilidi alan iki kardeş: `shipping.service.ts:2152-2159` (`await lockShipmentScopeTx(tx, shipmentId);` + yorumu *"Kilit BURADA, sayımdan ÖNCE olmak zorunda"*) ve `return.service.ts:481-490` (`const lockShipmentId = orderedRolls[0]?.shipmentId ?? null; if (lockShipmentId) await lockShipmentScopeTx(tx, lockShipmentId);`).
- Almayan kardeş: `Teks-Erp/src/services/return.service.ts:878-905`
  ```ts
  await prisma.$transaction(async (tx) => {
    const restore = await tx.roll.updateMany({
      where: { id: rr.rollId, status: expectedStatus, shipmentId: null, sackId: null },
      data: { status: RollStatus.SHIPPED, shipmentId: rr.fromShipmentId, sackId: restoreSackId, … },
    });
  ```
  → `lockShipmentScopeTx` çağrısı YOK; `tx.shipment.findUnique(...)` YOK; claim yalnız **topun** durumunu pinliyor, sevkiyatınkini değil.
- **Koruma kontrolü:** `rolls_sackId_shipmentId_consistency_fkey` DEFERRABLE bileşik FK yalnız `Roll.sackId ↔ Sack.shipmentId` tutarlılığını doğrular; sevkiyatın **statüsüne** bakmaz (K2b §1.6). `Shipment.status` üzerinde CHECK/trigger yok. `printedDocument` tarafı da bu yolu görmüyor.

**Çakışma senaryosu.**
- **T1** (Sevkiyat ekranı): `undoDispatch(S)` → `8023` alır → aktif iade sayımı **0** (RR henüz iptal edilmedi ama T2 onu iptal etmek üzere; sıralamaya göre 0 ya da 1) → sevkiyat `PLANNED`, `SHIPPED` topları `preShipStatus`'a döndürür → commit.
- **T2** (İade ekranı, T1'in claim'inden sonra başlar): `cancelReturn(RR)` → **kilit almaz**, `Shipment S`'in artık `PLANNED` olduğunu **okumaz** → topu `SHIPPED, shipmentId = S` yapar → commit.
- **SONUÇ:** `Roll R: status=SHIPPED, shipmentId=S` · `Shipment S: status=PLANNED` (ya da `releaseSacks` ile `CANCELLED`). `consistency-check.sql` §9 kırmızı.

**failure_mode.** Depo sorumlusu 08:30'da bir sevkiyatı geri alır (yanlış araca yüklenmiş), aynı anda muhasebe o sevkiyattan alınan iadeyi "yanlış girdim" diye iptal eder. Top `SHIPPED` kalır: Bitmiş Depo listesinde **görünmez** (sevk edilmiş sayılır), sevkiyat `PLANNED` olduğu için sevk irsaliyesinde de **yoktur** ve `shippedQty` defterinde de sayılmaz (yalnız DISPATCHED tahsisler sayılıyor). Fiziksel olarak depoda duran bir top hiçbir ekranda görünmez. Yeniden sevk de kurtarmaz: `performDispatchTx`'in statü flip'i `status: { not: SHIPPED }` süzgeçlidir → o top atlanır, `preShipStatus` NULL kalır ve sonraki storno onu `WAREHOUSE`'a yazar (A1/2. kalite ise sessizce 1. kaliteye terfi eder).

**Veride fiili ihlal (K2).** **Arandı, 0.**
```sql
SELECT r.id, r.barcode, r.status, sh.status FROM rolls r LEFT JOIN sacks s ON s.id=r."sackId"
LEFT JOIN shipments sh ON sh.id=s."shipmentId"
WHERE (r.status='SHIPPED' AND (r."sackId" IS NULL OR sh.status IS DISTINCT FROM 'DISPATCHED')) …;   -- 0
SELECT rr.id, sh.status FROM roll_returns rr JOIN shipments sh ON sh.id=rr."fromShipmentId"
WHERE rr."cancelledAt" IS NULL AND sh.status<>'DISPATCHED';                                          -- 0
```
Sahada toplam 5 iade var ve hepsi aktif; storno sayısı düşük → pencere bugüne dek açılmamış.

**İş etkisi.** Görünmez stok (envanterde yok, sevkte yok); iade defteri ile sevk defteri çelişir; §9 mutabakat kapısı kırmızıya döner ve sebebi tarihsel olarak çözülemez.

**Öneri (2. tur için).** `cancelReturn`'ün tx'inin **İLK ifadesi** `lockShipmentScopeTx(tx, rr.fromShipmentId)` olsun (iki kardeşle birebir); ardından sevkiyatı tx içinde taze oku ve `status !== DISPATCHED` ise 409 (*"Bu iadenin sevkiyatı geri alınmış/iptal edilmiş — iade iptali yapılamaz"*). Migration/izin yok.
**Kabul kriteri.** `test_shipment_undo_dispatch.ts`'e §11: `undoDispatch` ∥ `cancelReturn` paralel sondası — biri 409 almalı, sonuçta `SHIPPED` top ↔ `DISPATCHED` olmayan sevkiyat çifti oluşmamalı; **negatif sonda** — kilit satırı silinirse KIRMIZI.
**Efor:** 0,5 gün.
**Önceki defter:** `F-SEV-ESZ-001` [duzeltildi] — aynı kilidin **üçüncü** çağrı yeri o düzeltmede kapsanmamış (yeni kanıt: `return.service.ts:878-905`'te kilit yok). Reddedilmiş bir bulgunun yeniden açılması DEĞİL.

---

### [D-E-06] Fason adım/iş emri kapanışı `recomputeStepStatus`'u atlıyor: "fasonda top kalmadı" ≠ "adımda iş kalmadı" — adım ve iş emri, içinde canlı top varken kapanabilir

| Şiddet | S2 | Kategori | E — Üretim · durum makinesi (INV-SM-03, INV-WO-09) | Öncelik | P2 | Modül | FAS/ÜRE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `WorkOrderStep.status` şemada **türetilmiş** alandır ve tek yazıcısı `recomputeStepStatus`'tur: açık hareket varsa `ACTIVE`, bu adıma henüz ulaşmamış canlı top varsa `ACTIVE/PENDING`, aksi hâlde `COMPLETED`. Fason servisi bu türetimi **7 sitede** baypas edip statüyü doğrudan yazıyor ve kullandığı yüklem farklı: *"bu adımda `AT_SUBCONTRACTOR` top kaldı mı"*. Fason adımında `IN_PRODUCTION` durumda bekleyen top bulunması **meşru ve belgeli** bir durumdur (CLAUDE.md: *"Fason adımına taşıma `AT_SUBCONTRACTOR` YAPMAZ: mal içeride üretimde bekler"*), ayrıca kısmi sevkte gönderilmeyen toplar da orada `IN_PRODUCTION` kalır. İki yüklem ayrıştığı anda adım — ve son adımsa **iş emri** — içinde canlı top varken kapanır.

**Kanıt.**
- Kanonik türetim: `Teks-Erp/src/services/helpers/roll-step.helper.ts:29-150`
  ```ts
  const openCount  = await tx.rollMovement.count({ where: { workOrderStepId: stepId, exitedAt: null, roll: { status: { not: CANCELLED } } } });
  …
  if (openCount > 0) nextStatus = StepStatus.ACTIVE;
  ```
- Fason'un doğrudan yazımları (7 site, K4 §2 ile uyumlu): `subcontractor.service.ts:1108` (PENDING/COMPLETED→ACTIVE), `:2118` ve `:2128` (sevk iptali → COMPLETED / PENDING), `:2952-2962` (`receive`), `:3465-3478` (kalan kapama), `:6172-6178` ve `:6199-6205` (doğrudan sevk).
- Yüklem farkı — `receive` dalı:
  `Teks-Erp/src/services/subcontractor.service.ts:2952-2971`
  ```ts
  const stillAtSubcontractor = await tx.roll.count({
    where: { currentStepId: data.stepId, status: RollStatus.AT_SUBCONTRACTOR },
  });
  if (stillAtSubcontractor === 0) {
    await tx.workOrderStep.update({ where: { id: step.id }, data: { status: StepStatus.COMPLETED, completedAt: new Date() } });
  }
  if (!nextStep && stillAtSubcontractor === 0) {
    await completeWorkOrderIfStepsDone(tx, data.workOrderId);
  }
  ```
  → `roll_movements.exitedAt IS NULL` hiç sorulmuyor.
- Otomatik WO kapanışı dispozisyon istemez: `helpers/roll-step.helper.ts:193-214` (`completeWorkOrderIfStepsDone` yalnız "COMPLETED/SKIPPED dışı adım kaldı mı" sayar). Manuel kapatmadaki **kapanış dispozisyonu** zorunluluğu (INV-WO-09, `workorder.service.ts:3861-4060`: her in-flight top için karar + `roll:manual-adjust`) bu yolda **hiç koşmaz**.
- **Koruma kontrolü:** `work_order_steps.status` üzerinde CHECK/trigger yok (K2b); adım statüsünü türetimle karşılaştıran tek kapı `test_consistency.ts` §20 ve o **elle** koşulan bir script.

**failure_mode.** İş emri IE… rotası: [1] Boyahane (fason) → [2] Kurşun+KK2 → [3] Tambur. 10 top adım 1'e bağlanır (hepsinin adım 1'de AÇIK hareketi vardır). Planlamacı 6'sını fasona gönderir (`AT_SUBCONTRACTOR`), 4'ü `IN_PRODUCTION` olarak adım 1'de bekler. Fason 6 topu getirir, kabul yapılır → `stillAtSubcontractor = 0` → **adım 1 `COMPLETED`** olur, oysa 4 topun açık hareketi hâlâ o adımdadır. Pano/WIP raporu adım 1'i "bitti" gösterir, o 4 top hiçbir istasyonun "bekleyen" sayacında görünmez. Rota tek adımlıysa (yalnız fason) aynı koşulda `completeWorkOrderIfStepsDone` çalışır ve **iş emri `COMPLETED`** olur: 4 canlı top kapalı bir iş emrinin içinde kalır, kapanış dispozisyonu (nereye gidecekleri) hiç sorulmaz, refakat kartı `COMPLETED`'a çekilir.

**Veride fiili ihlal (K2).** **Arandı, 1 satır — ve o da bu bulgunun değil.** §20 türetimini SQL'e çevirip koştum (giriş noktası kuralı dahil):
```sql
-- (tam sorgu: audit/01-find/ ekinde; openCount/closedCount/pendingRolls + entrySeq<=stepSequence)
… WHERE c.kayitli <> c.beklenen;
-- → 1 satır: IE0608260004 / Kurşun+KK2 / kayıtlı COMPLETED, beklenen PENDING, açık 0, kapalı 0, bekleyen 0
```
Bu tek satır §20'nin **belgeli kör noktası**dır (CLAUDE.md 2026-08-22: *"adımın tek topu sonradan iptal edilince COMPLETED adım PENDING'e çöker; adım durumu tarihsel olgudur, veri bozuk değil"*) — hareket sayısı sıfır olduğu için bu bulgunun imzası (açık hareketli COMPLETED adım) DEĞİL. Ek ölçüm:
```sql
SELECT count(*) FROM roll_movements rm JOIN work_order_steps s ON s.id=rm."workOrderStepId" JOIN rolls r ON r.id=rm."rollId"
WHERE rm."exitedAt" IS NULL AND s.status IN ('COMPLETED','SKIPPED') AND r.status<>'CANCELLED';      -- 0
SELECT … FROM rolls r JOIN work_order_steps s ON s.id=r."currentStepId" JOIN work_orders wo ON wo.id=s."workOrderId"
WHERE wo.status='COMPLETED';                                                                        -- 0
```
Yol bugün tetiklenmemiş; sahada fason sevkleri tek seferde tüm topu gönderiyor.

**İş etkisi.** WIP/pano rakamları eksik; kapalı iş emrinin içinde kalan topun operatör tarafından bulunması zor (CLAUDE.md'nin "operatörün onu BULABİLMESİ gerekir" kuralı); kapanış dispozisyonunun tüm güvencesi (her top için karar + sebep + `roll:manual-adjust`) atlanır.

**Öneri (2. tur için).** Yedi noktanın hepsi `recomputeStepStatus(tx, stepId)`'e devretsin (fason'un `stillAtSubcontractor` sayımı **yalnız** WO kapatma kararını beslesin, adım statüsünü değil). `completeWorkOrderIfStepsDone`'a ikinci bir kapı: WO'nun herhangi bir adımında `IN_PRODUCTION/AT_SUBCONTRACTOR/RETURNED…` top varsa kapatma — ya 409 ya da dispozisyon iste (manuel yolla aynı kural). Migration/izin yok.
**Kabul kriteri.** `test_consistency.ts` §20 bekçisine fason senaryosu: 6/10 sevk → kabul → adım **ACTIVE kalmalı**; `scripts/test_fason_step_status.ts` **negatif sonda** ile (doğrudan yazım geri konursa KIRMIZI).
**Efor:** 1 gün.
**Önceki defter:** `F-FAS-ESZ-001` [duzeltildi] aynı sınıfın WO tarafını (terminal guard kopyası) kapatmıştı; **adım** tarafı açık kalmış.

---

### [D-E-07] `reopenStep` fire (SCRAP) topu üretime geri çekiyor: "fire geri alınamaz" değişmezi belgesiz bir kapıdan deliniyor

| Şiddet | S2 | Kategori | E — Üretim · statü geçiş matrisi (INV-SM-01) | Öncelik | P2 | Modül | ÜRE | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** CLAUDE.md 2026-08-25 kararı iki çıkışı ayırıyor: **İptal** (`CANCELLED`, "hiç olmamalıydı", geri alınabilir) ve **Fire** (`SCRAP`, "vardı, gitti", stok düşer, **geri alınamaz**). `roll-cancel-restore.helper.ts`'in ilk ifadesi de bunu zorluyor (`status !== CANCELLED → engel`). Ama `kursun-qc.reopenStep`'in son-adım dalı `SCRAP` topu doğrudan `IN_PRODUCTION`'a çekiyor — sebep sormadan, `roll:manual-adjust` istemeden, sapma defterini terslemeden.

**Kanıt.**
- `Teks-Erp/src/services/kursun-qc.service.ts:1124-1140`
  ```ts
  const pulledBack = await tx.roll.updateMany({
    where: { id: { in: rollIds },
             status: { in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.SCRAP] },
             currentStepId: null, shipmentId: null, sackId: null },
    data: { status: RollStatus.IN_PRODUCTION, currentStepId: step.id },
  });
  ```
- Kuralın karşı tarafı: `Teks-Erp/src/services/helpers/roll-cancel-restore.helper.ts:66-68` (*"Geri alma YALNIZ CANCELLED'ta çalışır … → fire geri alınamaz, doğrusu da bu"* — `inventory.service.ts:3268-3272` yorumu).
- `finalizedAt` trigger'ının kaynak listesinde `SCRAP → IN_PRODUCTION` **yok** (migration `20260809090000:45-96`), yani damga tazelenmez ve top üretime dönerken eski fire tarihini taşımaya devam eder.
- **Koruma kontrolü:** DB'de statü geçiş seddi yok (enum yalnız küme; K10 INV-SM-01: *"tüm makine KOD + claim ile tutulur"*). `reopenStep`'in izni ayrı bir SoD kapısı taşımıyor. Bekçi: `scripts/` altında `reopenStep`'in SCRAP dalını ölçen dosya bulunamadı.

**failure_mode.** Son adımı Kurşun+KK2 olan bir iş emrinde 10 top bitirilir; biri **FİRE** kalitesiyle işaretlendiği için `SCRAP` olur (`QualityGrade.targetStatus = SCRAP`, seed `1.KALITE/A1 → WAREHOUSE`, `FİRE → SCRAP`) ve fire karnesine 300 m fire yazılır. Operatör "yanlış adımı kapattım" deyip **"Adımı Yeniden Aç"** der: fire edilmiş top `IN_PRODUCTION`'a döner, fire karnesi o 300 m'yi **geriye dönük kaybeder** (karne `Roll.status`'tan okuyor), fiziksel olarak çöpe atılmış kumaş yeniden finalize edilip Bitmiş Depo'ya alınabilir ve sevk edilebilir. Hiçbir sebep sorulmaz, hiçbir sapma satırı terslenmez.

**Veride fiili ihlal (K2).** **Arandı, 0** — sahada toplam **1** `SCRAP` top var ve `currentStepId` NULL:
```sql
SELECT status, count(*) FILTER (WHERE "currentStepId" IS NOT NULL) adimli, count(*)
FROM rolls WHERE status IN ('SCRAP','WAREHOUSE','A1_STOCK') GROUP BY 1;
-- WAREHOUSE 0/250 · SCRAP 0/1
```
Fire ucu (`POST /rolls/:id/scrap`) 2026-08-25'te açıldı; hacim henüz yok, o yüzden yol bugüne dek tetiklenmedi.

**İş etkisi.** Fire oranı geriye dönük değişir (fabrikanın en çok baktığı karne); fiziksel olarak yok edilmiş malın sistemde diriltilip sevk edilebilmesi.

**Öneri (2. tur için).** İki şık, iş sahibi seçsin:
- **(a) SCRAP'ı dışarıda bırak** — claim'in `status: { in: [...] }` listesinden `SCRAP` düşer; reopen o topu atlar ve operatöre *"N top fire edilmişti, yeniden açılmadı"* der (`failed[]` deseni, sessiz kısmi olmaz).
- **(b) Bilinçli kapı** — SCRAP dahil edilecekse `roll:manual-adjust` + zorunlu sebep (`ReasonPresetKind.ROLL_SCRAP` kataloğundan) ve `RollVariance` fire satırının `reversedAt` ile terslenmesi (tambur-undo'nun 5b adımının aynası).
Her iki hâlde de karar `docs/history/CLAUDE-NOT-ARSIVI.md`'ye yazılmalı (bugün belgesiz).
**Kabul kriteri.** `scripts/test_kursun_reopen_scrap.ts`: fire edilmiş top reopen'da geri gelmez (a) ya da sebep+izin olmadan 403/400 (b); **negatif sonda** — `SCRAP` listeye geri konursa KIRMIZI.
**Efor:** 0,5 gün.
**Önceki defter:** yok (K10 **H-4**).

---

### [D-E-08] `applyManualProperties` metraj düzeltmesinin "bütün top" koşulu tx dışında: eşzamanlı Tambur kesimiyle kesilen metraj iki kez sayılır

| Şiddet | S2 | Kategori | E — Stok · `currentQty ≤ initialQty` + kesim toplamı | Öncelik | P2 | Modül | ENV | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Düzelt" ekranı metraj düzeltmesine yalnız **bütün** topta (`initialQty === currentQty`) izin veriyor — doğru kural. Ama bu koşul transaction'dan **önce** okunuyor ve asıl yazımın atomik claim'i yalnız `shipmentId`/`sackId`'yi pinliyor; `currentQty`/`initialQty` pinlenmiyor. Araya bir Tambur kesimi girerse düzeltme, kesilmiş topun metrajını "bütünmüş gibi" yeniden yazar.

**Kanıt.**
- Koşul tx dışında: `Teks-Erp/src/services/inventory.service.ts:3783-3790`
  ```ts
  const rollWhole = roll.initialQty.equals(roll.currentQty);      // `roll` tx DIŞINDA yüklendi
  if (data.currentQty !== undefined) { … if (!rollWhole) throw AppError.conflict("Bu top kısmen tüketilmiş …"); }
  ```
- Yazım ikisini birden ezer: `:3865-3868`
  ```ts
  if (data.currentQty !== undefined && !roll.currentQty.equals(new Prisma.Decimal(data.currentQty))) {
    const m = new Prisma.Decimal(data.currentQty); rollData.currentQty = m; rollData.initialQty = m;
  }
  ```
- Claim metrajı pinlemiyor: `:3929-3934`
  ```ts
  const upd = await tx.roll.updateMany({ where: { id: rollId, shipmentId: null, sackId: cur.sackId }, data: rollData });
  ```
- Karşı taraf (yarışan yazım): `tambur.service.ts:2937` (`currentQty: { decrement: data.lengthMeters }`, üretim kesimi — `initialQty`'ye dokunmaz).
- **Koruma kontrolü:** `currentQty ≤ initialQty` için DB CHECK **yok** (K2b A-listesi; `rolls` üzerindeki 26 CHECK yalnız `≥ 0`). Advisory kilit yok, `FOR UPDATE` yok. Feature-flag yok. Bekçi `test_roll_edit_unified.ts` yalnız sıralı senaryoyu ölçüyor.

**Çakışma senaryosu.**
- **T1** (süpervizör, masaüstü "Düzelt"): `applyManualProperties(R, currentQty=520)` — R okunur: `500/500`, `rollWhole = true`. (Ölçüm düzeltmesi: operatör topu 520 m ölçtü.)
- **T2** (Tambur tableti, aynı anda): `cutOpenFabric(R, 100)` → `currentQty: 500 → 400`, çocuk 100 m doğar, `initialQty` 500 kalır.
- **T1** tx açılır; claim `{id, shipmentId: null, sackId: null}` **eşleşir** (metraj pinlenmediği için) → `currentQty = 520, initialQty = 520`.
- **SONUÇ:** 500 m'lik toptan 100 m kesilmişken kaynak 520/520 gösteriyor. Fiziksel 500 m, sistemde 520 + 100 = **620 m**. Ne `RollVariance` satırı, ne uyarı, ne hata.

**failure_mode.** Yukarıdaki senaryo; ekranda görünen sonuç: `IE…` iş emrinin Tambur adımında kaynak top "520 m" ile bekler, kesilen 100 m'lik çocuk ayrı bir satır olarak Bitmiş Depo'ya iner. İş emrinin girdi metrajı 500 iken çıktı+kalan 620 olur; Ürün Dengesi ve iş emri "ÇIKAN/GİREN" rakamları 120 m şişer.

**Veride fiili ihlal (K2).** **Arandı, 0 bu yoldan.** `currentQty > initialQty` sorgusu 2 satır döndürüyor ama ikisi de bu yolun değil (audit izleri `TAMBUR_UNDO_FULL` — bkz. D-E-10). `Σ çocuk > parent.initialQty ∧ defter yok` sorgusu 2 satır (D-E-03'ün 0 metrajlı topları). Bu yolun kendi imzası (aynı topta `ROLL_MANUAL_OVERRIDE` audit'i + kesim çocuğu) sahada bulunamadı.

**İş etkisi.** Sessiz stok şişmesi; `currentQty ≤ initialQty` invariantı DB'de sedsiz olduğu için ihlal ancak elle koşulan §13 ile görülür (bkz. D-E-10 — o mekanizmanın gecikmesi ölçüldü: 13 gün).

**Öneri (2. tur için).** Claim'e beklenen metrajı pinle: `where: { id: rollId, shipmentId: null, sackId: cur.sackId, currentQty: roll.currentQty, initialQty: roll.initialQty }` + `count === 0 → 409` (*"Top bu sırada kesildi — metrajı yenileyip tekrar deneyin"*). Kapsam kararının (`FREE_STOCK` vs `roll:manual-adjust`) dayandığı **statü** de aynı claim'de pinlenmeli (K3a §6 #12 ile aynı düzeltme). Migration yok.
**Kabul kriteri.** `test_roll_edit_unified.ts`'e paralel sonda: düzeltme ile kesim aynı anda → biri 409; sonuçta `currentQty ≤ initialQty` ve `Σçocuk + currentQty = initialQty`; **negatif sonda** — pin kaldırılırsa KIRMIZI.
**Efor:** 0,5 gün.
**Önceki defter:** yok (K10 **H-12**).

---

### [D-E-09] Görevler ayrılığı kâğıtta var, atamada yok: 8 aktif kullanıcının 6'sı "sevk et + sevki geri al + metraj düzelt" üçlüsünü birlikte taşıyor

| Şiddet | S2 | Kategori | E — Yetki/onay · görevler ayrılığı (SoD) | Öncelik | P2 | Modül | KIM/SEV | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Rol şablonu kataloğu SoD üçlüsünü bilinçli olarak dar tutuyor: `shipping:invoice` yalnız Muhasebe, `shipping:undo-dispatch` ve `roll:manual-adjust` yalnız Üretim Süpervizörü rollerinde. Ama katalog **atamaz** (*"katalog koda, atama panele"*) ve atamayı kısıtlayan hiçbir kapı yok. Canlı kopyada 8 aktif kullanıcının 6'sı üçlüyü birlikte taşıyor; 2'si ayrıca fatura işaretleme yetkisini de taşıyor. Yani tek bir kişi malı sevk edip, sevki geri alıp, topun metrajını yeniden yazabiliyor — ikinci bir göz olmadan.

**Kanıt.**
- Tasarım: `Teks-Erp/src/constants/role-template-catalog.ts:149-166` ve `:235-254` (SoD üçlüsünün rol dağılımı), `ROLE_COVERAGE_EXEMPT :392-400`.
- Zorlama: **hiçbir yerde.** `permission-management.service.ts` içinde tek mantıksal kapı son-admin koruması (`:582-665`, advisory `8025`); "şu iki izin aynı kullanıcıda olamaz" türü bir kural yok (grep: `roll:manual-adjust` ile `shipping:undo-dispatch`'i birlikte denetleyen ifade 0). DB'de `user_permissions` üzerinde yalnız `(userId, permissionId)` unique.
- Bekçi: `test_role_template_catalog.ts` katalog↔DB kapsamasını ölçüyor, **atama dağılımını ölçmüyor** (ölçemez de — atama işletme kararı).

**failure_mode.** `Eda***` kullanıcısı bir sevkiyatı `DISPATCHED` yapar (irsaliye v1 donar). Aynı kullanıcı 10 dakika sonra `shipping:undo-dispatch` ile stornolar (irsaliye `VOIDED`, toplar rafa döner), sonra `roll:manual-adjust` ile toplardan birinin metrajını 500 → 450 yazar ve yeniden sevk eder (irsaliye v2, 450 m). Dört adımın hiçbirinde ikinci bir onay yoktur; tek iz `SystemLog`'dur ve o **best-effort**'tur (yazım hatası isteği düşürmez, `AuditService.log` tx dışında), üstelik kurcalanmaya karşı trigger (`audit_block_tamper`) **varsayılan KAPALI** (`teks.audit_guard` GUC; migration `20260819161000` — prod'da açık olup olmadığı kopyadan doğrulanamıyor).

**Veride fiili ihlal (K2).**
```sql
SELECT left(u.username,3)||'***', string_agg(p.code, ',' ORDER BY p.code)
FROM users u JOIN user_permissions up ON up."userId"=u.id JOIN permissions p ON p.id=up."permissionId"
WHERE u."isActive" AND u."deletedAt" IS NULL
  AND p.code IN ('shipping:write','shipping:invoice','shipping:undo-dispatch','roll:manual-adjust','admin:*','admin:users','workorder:write')
GROUP BY u.id, u.username ORDER BY 1;
-- adm*** : admin:*,admin:users,roll:manual-adjust,shipping:invoice,shipping:undo-dispatch,shipping:write,workorder:write
-- Ahm*** : admin:*,admin:users,roll:manual-adjust,shipping:undo-dispatch,shipping:write,workorder:write
-- Ber*** : admin:*,admin:users,roll:manual-adjust,shipping:undo-dispatch,shipping:write,workorder:write
-- Eda*** : roll:manual-adjust,shipping:undo-dispatch,shipping:write,workorder:write
-- Ene*** : admin:users,roll:manual-adjust,shipping:invoice,shipping:undo-dispatch,shipping:write,workorder:write
-- Sam*** : roll:manual-adjust,shipping:undo-dispatch,shipping:write,workorder:write
SELECT count(*) FROM users WHERE "isActive" AND "deletedAt" IS NULL;   -- 8
```
→ **6/8** kullanıcıda üçlü; **2/8**'de ayrıca `shipping:invoice`; **3/8**'de `admin:*`.

**İş etkisi.** Sevk-geri al-metraj düzelt zinciri tek elde olduğu için hem hata hem kötü niyet tek adımda kapatılabiliyor ve tek savunma hattı best-effort audit. Sekiz kişilik bir fabrikada tam ayrım pratik olmayabilir — bu bir **iş kararıdır**, ama bugün karar verilmemiş, sadece olmuş.

**Öneri (2. tur için).**
1. **Ölçüm yüzeyi:** Yönetim → Yetkiler ekranına "SoD çakışması" bandı (katalogdaki çift listesini okuyup taşıyan kullanıcıları sayar). Yeni izin kodu gerekmez.
2. **Kapı (opsiyonel, iş kararı):** `setUserPermissions`/`grant` içinde SoD çiftleri için **uyarı** (`ApiResponse.warnings`) — sert blok 8 kişilik fabrikada operasyonu durdurabilir (rota kapsaması emsali).
3. **Telafi edici kontrol (en ucuzu ve en etkilisi):** prod'da `teks.audit_guard = on` açılması (`SURUM-2.9.0 §7b` ops görevi) — SoD zayıfsa denetim izinin değiştirilemez olması zorunlu hâle gelir.
**Kabul kriteri.** Panelde SoD bandı canlı sayıyı gösteriyor; `test_role_template_catalog.ts`'e "SoD çifti katalogda tanımlı" kontrolü.
**Efor:** 0,5 gün (band) + ops.
**Önceki defter:** yok. ⚠️ **Sınır:** atama tarafı ② G/KIM hücresinin (K5 H7) alanı; buradaki açı iş kuralının kendisi (görevler ayrılığı değişmezi kodda beyan edilmiş, hiçbir yerde zorlanmıyor). Mükerrer sayılmamalı, kesişim olarak okunmalı.

---

### [D-E-10] `currentQty ≤ initialQty` DB seddi yok; ikinci ihlal kod düzeltmesinden 5 gün SONRA doğdu ve 13 gün fark edilmedi

| Şiddet | S2 | Kategori | E — Stok · negatif/aşan metraj | Öncelik | P2 | Modül | ÜRE/ENV | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `currentQty ≤ initialQty` invariantının DB kısıtı yok; koruma dört ayrı kod yolunda tekrarlanıyor ve tespit **elle koşulan** `consistency-check.sql §13`'e bırakılmış. Canlı kopyada iki ihlal var. CLAUDE.md 2026-08-22 bunları "2 eski satır, bilerek düzeltilmedi" diye kaydetmiş — ama kaynağı ölçtüğümde ikisinin de **`TAMBUR_UNDO_FULL`** olduğu ve ikincisinin **2026-08-14'te**, yani düzeltme commit'inden (`e1437eb3`, 2026-08-10) **5 gün sonra** doğduğu çıktı. Kodun kendi başlık yorumu hâlâ *"DB'deki TEK böyle satır"* diyor.

**Kanıt.**
- DB seddi yok: `pg_constraint` üzerinde `rolls` CHECK'leri yalnız `≥ 0` (canlı kopyada doğrulandı); K2b A-listesi de "ilişki CHECK'i konmadı" diyor.
- Bugünkü kod doğru: `Teks-Erp/src/services/tambur-undo.service.ts:1516-1534` (`applyFull`: `initialBump` + `recordVarianceTx(OVERAGE)`), `:1130-1147` (`applySingle`), `:1290-1302` (`applySingleRestore`). Üçü de aynı deseni uyguluyor.
- Bayat beyan: `Teks-Erp/src/services/tambur-undo.service.ts:22-25`
  ```
  // 26 dakika sonra bir kullanıcı BİR topa "Geri Al" dedi → 14 top birden iptal
  // oldu, 520,5 m kaynağa geri yazıldı … Kaynak top o günden beri
  // `initialQty=500` iken `currentQty=520,5` taşıyor (DB'deki TEK böyle satır).
  ```
- **Koruma kontrolü:** unique/claim yarışı değil (ihlal sıralı akışta doğdu); flag yok; tek tespit `consistency-check.sql §13` ve `test_consistency.ts` — ikisi de **elle** koşuluyor, otomatik alarm yok (`src/jobs` listesinde mutabakat işi yok).

**failure_mode.** Aşım bayrağı (`tambur.overQuantityEnabled`, varsayılan AÇIK) altında 492 m kayıtlı top 698,9 m ölçülüp kesilir; Tambur kapanışı geri alınınca kaynak top **698,9 / 492** ile üretime döner ve `RollVariance` satırı yazılmaz. O topun bulunduğu iş emrinde "GİREN 492 m" ama sahada 698,9 m gözükür; doluluk %142 çıkar (`RollDetailSheet` doluluk çubuğu `currentQty/initialQty`), Ürün Dengesi'nde 206,9 m hayalet arz doğar ve sapma defteri (fire/aşım karnesi) bu farkı **hiç görmez**.

**Veride fiili ihlal (K2).**
```sql
SELECT id, barcode, "initialQty", "currentQty", status, "entrySource", "createdAt"::date FROM rolls WHERE "currentQty" > "initialQty";
-- 95c15daf… | (barkodsuz) | 492.000 | 698.900 | IN_PRODUCTION | SUBCONTRACTOR_RETURN | 2026-08-11
-- 92d0ef12… | (barkodsuz) | 500.000 | 520.500 | IN_PRODUCTION | SUBCONTRACTOR_RETURN | 2026-08-08

-- Kaynak yol (audit)
SELECT sl."createdAt", sl."newData"->>'event', sl."newData"->>'restoredQty' FROM system_logs sl
WHERE sl."recordId" IN ('95c15daf-…','92d0ef12-…') ORDER BY 1;
-- 2026-08-08 15:37 | TAMBUR_UNDO_FULL | 520.5
-- 2026-08-14 09:04 | TAMBUR_UNDO_FULL | 698.9        ← düzeltme commit'i 2026-08-10
SELECT * FROM roll_variances WHERE "rollId" IN ('95c15daf-…','92d0ef12-…');    -- 0 satır (defter boş)
```
İkisi de **hâlâ `IN_PRODUCTION`** — yani yanlış rakam bugün canlı listelerde.
⚠️ Kod düzeltmesi 2026-08-10'da repoda, prod'a ise `SURUM-2.9.0` ile 2026-08-24/25'te gitti (CLAUDE.md); yani ikinci satırın doğduğu gün prod eski koddaydı. **Bulgu "kod hâlâ hatalı" değil**, şudur: *invariantın DB seddi ve otomatik alarmı olmadığı için, düzeltilmiş bir hata iki hafta daha canlıda ihlal üretti ve ikinci satır fark edilmedi (kod yorumu hâlâ "TEK" diyor).*

**İş etkisi.** İki topta metraj fazla; daha önemlisi tespit mekanizması: `§13` yalnız birinin elle koşmasıyla görülüyor ve o koşum ihlali 13 gün sonra buldu.

**Öneri (2. tur için).**
1. **Otomatik mutabakat:** `consistency-check.sql`'i gecelik bir işe bağla (mevcut `archive-scheduler`/`backup-scheduler` deseni) ve kırmızı bölümleri `/health` sayacına + `job-failure` defterine yaz. Bu tek adım D-E-02/03/04/05/06 için de erken uyarı verir.
2. **DB seddi (opsiyonel, `prod_risk: yuksek`):** `CHECK ("currentQty" <= "initialQty")` **NOT VALID** olarak eklenebilir — geri alma bump'ı `initialQty`'yi aynı ifadede yükselttiği için yeni yazımlar geçer; mevcut 2 satır `NOT VALID` sayesinde deploy'u düşürmez, `VALIDATE` temizlik sonrasına bırakılır (nameFold "yumuşak kapı" emsali). **[PROD'DA ÇALIŞTIRMA]** — geri alma: `ALTER TABLE rolls DROP CONSTRAINT …`.
3. `tambur-undo.service.ts:25` yorumundaki "TEK böyle satır" ifadesi düzeltilsin (bayat beyan, L sınıfı ama burada karar verisi).
**Kabul kriteri.** Gecelik mutabakat işi kırmızı bölümü rapor ediyor; `test_db_invariants.ts`'e CHECK envanteri satırı.
**Efor:** 1 gün (mutabakat işi) + 0,25 gün (CHECK).
**Önceki defter:** yok. K10 §6'daki "2 eski satır bilerek düzeltilmedi" kararı **korunuyor** — bulgu satırların kendisi değil, sedsizlik + alarmsızlıktır.

---

### [D-E-11] Refakat kartı arşiv kopyası değiştirilebilir: aynı sürümün yeniden basımı defterdeki snapshot'ı üzerine yazıyor

| Şiddet | S3 | Kategori | E — Yetki/onay · "onaylanmış belge sonradan değiştirilebiliyor mu" | Öncelik | P4 | Modül | BLG (belge) | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `PrintedDocument` "donmuş belge" defteridir; generic yolda satırlar **hiç güncellenmez** (yeni sürüm doğar). Refakat kartı yolu bunun istisnası: aynı sürüm ikinci kez basılınca arşiv satırının `snapshot`'ı **üzerine yazılıyor**. Sunum (şablon/sayfa boyutu/punto) `planKey`'e dahil edilmediği için, tasarım değiştikten sonra yapılan bir yeniden basım eski sürümün arşiv kopyasını **bugünkü tasarımla** değiştirir.

**Kanıt.**
- `Teks-Erp/src/services/traveler-card.service.ts:443-463`
  ```ts
  await tx.printedDocument.upsert({
    where: { docType_sourceId_version: { docType: TRAVELER_CARD, sourceId: p.cardId, version: p.version } },
    create: { … snapshot … },
    // Aynı sürümün yeniden basımı: içerik tanım gereği aynı (planKey eşit),
    // yalnız sunum tazelenmiş olabilir + son basan kişi güncellenir.
    update: { snapshot, printedById: p.userId ?? null },
  });
  ```
- Sunum `planKey`'in DIŞINDA (bilinçli): CLAUDE.md 2026-08-06 — *"revizyon karşılaştırması (`planKey`) `config`/`template`'i dışlar"*; ve *"şablon + sayfa/config her baskıda güncel çözülür"*.
- Generic yolda böyle bir dal yok: `printed-document.service.ts:337` (`create`), `:674-692` (claim + yeni versiyon), `:728-733` (`voidForSource` yalnız statü) — `snapshot` güncelleyen tek satır yok.
- **Koruma kontrolü:** `printed_documents` üzerinde UPDATE'i engelleyen trigger yok (tamper trigger'ı yalnız `system_logs`/`system_log_archives` için ve o da GUC'a bağlı, varsayılan KAPALI). `@@unique(docType, sourceId, version)` içerik değişimini engellemez.

**failure_mode.** IE2108260004 kartı v2 ile 21.08'de A5 basıldı ve arşive düştü. Eylülde Belge Şablonu'nda punto/sayfa boyutu değiştirilip aynı kart tekrar basılırsa (`planKey` aynı → sürüm hâlâ v2), arşivdeki v2 satırının snapshot'ı **yeni tasarımla ezilir**. "21.08'de sahaya hangi kâğıt gitti" sorusuna defter artık bugünkü tasarımla cevap verir. İçerik (plan) aynı kaldığı için hasar sunumla sınırlıdır — bu yüzden S3.

**Veride fiili ihlal (K2).** **Arandı, ihlal yok** — ama ölçüm sırasında K2b'nin *"2 TRAVELER_CARD `version=2` v1'siz"* hotspot'u **açıklandı ve temize çıkarıldı** (bkz. Bölüm 2/B-4).
```sql
SELECT "docType", count(*) FROM printed_documents GROUP BY 1;
-- SUBCONTRACTOR_DISPATCH 214 · TRAVELER_CARD 62 · SHIPMENT_DISPATCH 40 · SUBCONTRACTOR_RECEIPT 7 · RETURN_DISPATCH 4 · QUALITY_CERTIFICATE 1
SELECT "sourceId", string_agg(version::text, ',' ORDER BY version) FROM printed_documents
WHERE "docType"='TRAVELER_CARD' GROUP BY 1 HAVING min(version) > 1;      -- 2 kart, ikisi de v2
```

**İş etkisi.** Kontrollü belge izlenebilirliği (ISO 9001 §7.5.3) zayıflar: "hangi kopya basıldı" sorusunun arşiv cevabı değişebilir. Operasyonel etkisi yok.

**Öneri (2. tur için).** `update` dalı yalnız `printedById`/`printedAt` gibi künye alanlarını tazelesin; `snapshot` **yazılmasın** (sunum farkı yeni satır gerektirmez, çünkü sürüm tanım gereği içeriği tanımlar). Alternatif: sunum farkı da bir sürüm sayılacaksa `planKey`'e alınmalı — ama CLAUDE.md 2026-08-06 bunu bilerek reddetmiş, o karar geçerli.
**Kabul kriteri.** `test_traveler_card_versions.ts`: aynı sürümün ikinci basımı arşiv `snapshot`'ını DEĞİŞTİRMEZ; **negatif sonda** — `update: { snapshot }` geri konursa KIRMIZI.
**Efor:** 0,25 gün.

---

### [D-E-12] `order.reopen` ve `order.update`, `recomputeOrderStatus`'u tam-küme kilidi olmadan çağırıyor (helper'ın kendi yazdığı protokolün ihlali)

| Şiddet | S3 | Kategori | E — Sipariş · defter denormu | Öncelik | P3 | Modül | SIP | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `recomputeOrderStatusForOrders`'ın dokümanı çağıranın **önce** `touchOrderLinesTx` ile tam satır kümesini kilitlemesini şart koşuyor ve uygulayanları adıyla sayıyor ("performDispatchTx, cancelShipment, subcontractor directShip"). İki çağrı yeri bu protokolü uygulamıyor.

**Kanıt.**
- Protokol: `Teks-Erp/src/services/helpers/order-status.helper.ts:203-211` (*"KİLİT PROTOKOLÜ: recompute defteri KİLİTSİZ okur ve shippedQty'yi yazar — ÇAĞIRAN … TEK sıralı partide kilitlemeli … kilitsiz çağrı = eşzamanlı terminal olaylarda lost-update"*).
- Uygulayan: `shipping.service.ts:1878-1879`, `:1975-1982`, `:2210-2211`; `subcontractor.service.ts:6233 → :6298`; `order.service.ts:512-513` (`cancelOrderLine` — kilit VAR).
- **Uygulamayan:** `Teks-Erp/src/services/order.service.ts:2533-2537` (`update`, satırlar değiştiyse) ve `:3392-3411` (`reopen`, manuel kapatmayı geri alma) — ikisinde de `touchOrderLinesTx` çağrısı yok.
- **Koruma kontrolü:** `shippedQty` için trigger/CHECK yok (denorm; K10 INV-SEV-01 *"DB seddi olmayan tek denormalize alan"*); claim yalnız `Order` satırında (`:2520`, `:3396`), `OrderLine` satırlarında değil.

**Çakışma senaryosu.** **T1** `reopen(O)` → claim → `recomputeOrderStatus(O)` → `computeLineLedger` satırları KİLİTSİZ okur (o an 300 m). **T2** `performDispatchTx` → `touchOrderLinesTx` (T1 kilit almadığı için bloklamaz) → recompute → 500 m yazar → commit. **T1** kendi okuduğu 300 m'yi `orderLine.update` ile yazar → **500 m kaybolur**. Sipariş `APPROVED`/`PARTIAL_SHIPPED` görünür, sevk edilmiş 200 m defterden düşer.

**failure_mode.** Muhasebe manuel kapattığı bir siparişi yeniden açarken (yeni kalem gelecek) depo aynı siparişe sevk yapıyorsa, sevk edilen metraj `OrderLine.shippedQty`'den silinir; sipariş "Açık" görünür ve aynı mal ikinci kez sevk edilir (D-E-01 ile birleşince aşım oluşur). Sonraki herhangi bir dispatch/cancel recompute'u değeri **düzeltir** (defter-otoritatif) — o yüzden hasar geçici, ama o pencerede alınan karar (yeniden sevk) kalıcıdır.

**Veride fiili ihlal (K2).** **Arandı, 0** — `consistency-check.sql §1/§2` mutabakatı sahada temiz (K10 ölçümü; 0/281 satır, 0/278 sipariş sapma). Zaten kendini onaran bir denorm olduğu için kalıcı iz bırakması beklenmez.

**İş etkisi.** Geçici yanlış "Açık" rakamı → fazla sevk kararı.
**Öneri (2. tur için).** İki çağrı yerine de `recomputeOrderStatus`'tan önce tam-küme `touchOrderLinesTx` ekle (üç uygulayıcıyla birebir). Ek olarak: helper'ın protokolünü **mekanik** hâle getir — `recomputeOrderStatus` girişinde `tx` üzerinde kilit alınıp alınmadığı doğrulanamaz, ama bir AST bekçisi (`test_order_recompute_lock_protocol.ts`) çağrı yerlerini tarayıp `touchOrderLinesTx` öncüsü arayabilir (emsal: `test_fason_open_dispatch_single_source.ts`).
**Kabul kriteri.** AST bekçisi 5 çağrı yerini de yeşil görüyor; protokol ihlali eklenirse KIRMIZI.
**Efor:** 0,5 gün.
**Önceki defter:** yok (K10 **H-9**). ⚠️ Eşzamanlılık ayağı ② D-A ile kesişir; buradaki açı defter değişmezidir.

---

## 2. Bilgi — bilinçli tasarım kararları ve ölçümle temize çıkan hotspot'lar (bulgu DEĞİL)

### A. Bilinçli tasarım kararları (dörtlü uygulandı, "ihlal" sayılmadı)

| # | Değişmez / gözlem | Karar ve kaynağı | Ölçüm |
|---|---|---|---|
| A-1 | **Bir sipariş birden çok PLANNED sevkiyatta olabilir** — "tek aktif sevkiyat" partial unique DÜŞÜRÜLDÜ | `prisma/migrations/20260711120000_.../migration.sql:85-87` (`DROP INDEX … shipment_orders_active_order_uq`); havuz modeli | Q: 0 sipariş >1 PLANNED sevkiyatta (bugün 1 PLANNED sevkiyat var) — ⚠️ D-E-01'in **ön koşulu** budur, ikisi birlikte okunmalı |
| A-2 | **Parti no benzersiz DEĞİL** (`P01…P99` körlemesine sarma) | CLAUDE.md 2026-08-05; `batch.service.ts:122-165`, `@unique` migration `20260805120000` ile kaldırıldı | 92 mükerrer grup / 184 satır (beklenen). `orderBy: { batchNumber }` ve `batchNumber` ile lookup **grep'le arandı: 0 ihlal** (yalnız `code-format.ts:34/:230` yorumları ve `shipping.service.ts:3437` `select`'i) |
| A-3 | **Sevk rakamı BRÜT** — iade `shippedQty`'yi düşürmez, ayrı belgeyle kapanır | CLAUDE.md 2026-08-02/03/05 | `_shipped.ts:59-85` (iade geri-ekleme UNION), `shipping.service.ts:2894-2915` (`prevSackId` ile), `attachTotals :2604`. Yedi yüzey tutarlı (`F-SEV-DOG-001` teyidi). ⚠️ Bu karar D-E-01'in çözümünü kısıtlar: "aşım" ile "iade sonrası yeniden sevk" ayrıştırılmadan sert blok konulamaz |
| A-4 | **Yarı mamul arzdan düşülmez, ayrı gösterilir** | CLAUDE.md 2026-08-27 (3. tur) | `production-balance.service.ts:415-431` (`malzemeAcigi = max(0, uretilecek − (ham + yariMamul))`), `order.service.ts:1607-1631` (`freeSemiFinished` ayrı kova, toplam korunuyor). Sahada `entrySource='SEMI_FINISHED'` **0 satır** → yol henüz kullanılmamış |
| A-5 | **Refakat kartı okutması yumuşak dedup** (10 sn penceresi, check-then-act) | `traveler-card.service.ts:585-606` — yorumu sınırı açıkça yazıyor: *"Bilinçli sınır: bu bir check-then-act penceresi — eşzamanlı iki istek yine iki satır yazabilir; append-only log için kabul"* | Kart okutması durum makinesi **tetiklemiyor** (yalnız iz); istasyon adım kapatma yolu ayrı ve atomik (bkz. Doğru yapılanlar #3) |
| A-6 | **Rota kapsaması REDDETMEZ, uyarır** | CLAUDE.md 2026-08-27; `workorder.service.ts:213-220` (`warnings.push`) | Kabul edilen risk, belgeli |
| A-7 | **Aşım bayrağı (`tambur.overQuantityEnabled`) varsayılan AÇIK** — kesim kayıtlı metrajı aşabilir, `OVERAGE` deftere yazılır | `tambur.service.ts:744-753`, `:1269-1276` | Aşımlı 34 parent'ın **32'sinde** `OVERAGE` satırı var (defter çalışıyor); kalan 2'si D-E-03'ün 0 metrajlı topları |
| A-8 | **`SHIPPED` top iptal edilemez** (yalnız İade akışı) | `inventory.service.ts:392-404` (`CANCELABLE_ROLL_STATUSES`, `nonCancelableRollReason`) | Brüt kuralın korunmasının asıl mekanizması: geçmiş dönemin sevk metrajı iptalle değişemez |
| A-9 | **`TAM kabul` makbuz satırında `receivedQty` NULL** (635/638) | Şema kararı; okuyucu `COALESCE(sri."receivedQty", nr."currentQty")` — `newRollId` **orijinal** topu gösterir (adı yanıltıcı, K2a notu) ve tam kabulde onun `currentQty`'si = kabul edilen kalandır | `subcontract-scorecard.report.service.ts:136-145`. Kontrol edildi: rapor **yanlış okumuyor**; ⚠️ ama kolon adı (`newRollId`) ve NULL semantiği yeni bir okuyucuyu yanıltmaya açık → L/K notuna alındı |

### B. Ölçümle temize çıkan hotspot'lar (haritalarda "şüpheli" işaretliydi)

| # | Şüphe | Ölçüm sonucu |
|---|---|---|
| B-1 | K2b: *"2 TRAVELER_CARD `version=2`, v1'siz"* | **Kusur değil.** `IE2108260004`: kart 08:47'de doğdu, ilk baskı 09:01'de zaten `PRINT_REVISION` (içerik 14 dk içinde değişmiş) → v1 hiç BASILMADI, arşiv satırı da doğmaz. `IE1408260001`: v1 08-14'te basıldı, defter özelliği 08-18'de geldi → cutover artefaktı. Audit `system_logs` ile doğrulandı (PRINT_EVENT v1 ×2 → PRINT_REVISION v2) |
| B-2 | K10 §20: adım statüsü türetimi | SQL'e çevrilip koşuldu: **1 sapma**, o da `IE0608260004 / Kurşun+KK2` — 0 hareket, 0 bekleyen → §20'nin belgeli kör noktası (tek topu iptal edilmiş adım). Veri bozuk değil |
| B-3 | K10 H-2: iki PLANNED sevkiyatın çift tahsisi | Bugün 0 (yalnız 1 PLANNED sevkiyat, `confirmationEnabled=false`). ⚠️ Ama **mekanizma açık** ve daha geniş bir sınıfın (D-E-01) parçası: onay KAPALI rejimde bile eşzamanlı iki `createShipment` aynı sonucu üretir |
| B-4 | K2b: *"5 iade edilen top CANCELLED"* | Doğrulandı: 5/5 iade edilmiş top sonradan `CANCELLED` ve **hiçbirinde iptal izi yok** (`cancelledAt/cancelReason/preCancelStatus` NULL). Bu, D-E-04'ün kapsamına giriyor. ⚠️ Ek olgu: `cancelReturn` bu topları artık geri alamaz (`return.service.ts:838-844` guard: *"Top iade sonrası işlem görmüş (durum: CANCELLED)"*) → iade defteri "geldi" derken top defteri "hiç olmadı" diyor ve düzeltme yolu kapalı. Mal 261 m; ne stokta, ne fire oranında, ne sevkte |
| B-5 | Belge no boşluk/mükerrer (INV-DOC-02) | IE/SIP/SVK/CV/FS/FK — **tüm günlerde `max(sıra) = adet`**, 0 boşluk, 0 biçim dışı. `nextDailySeq` + `withBarcodeRetry` çalışıyor |
| B-6 | `Σ receivedQty ≤ dispatchedQty` (INV-FAS-03) | 0 ihlal; `receive` decrement'i `where: { currentQty: { gt: p.receivedQty } }` ile DB-side atomik (`subcontractor.service.ts:2879-2890`) ve kısmi/tam kararı WO kilidi ALTINDA taze metrajla veriliyor (`:2721-2751`) |
| B-7 | İade ≤ sevk (INV-SEV-05) | 0 ihlal; kısmi iade yok, `qty = topun iade anındaki currentQty`, tek sevkiyat kuralı `return.service.ts:398-400`'de zorlanıyor |
| B-8 | `WO CANCELLED/SUPERSEDED → IN_PROGRESS` diriltmesi (7 site) | **Altı diriltme sitesinin HEPSİ** `where: { id, status: WorkOrderStatus.COMPLETED }` kullanıyor (`manual-move:816`, `tambur-undo:1378/:1669`, `split:394`, `kursun-qc:1144`, `tambur-manual:1194`) → terminal guard hiçbir yerde delinmemiş. `completeWorkOrderIfStepsDone` de `notIn [COMPLETED, CANCELLED, SUPERSEDED]` taşıyor. Bulgu YOK (bkz. Doğru yapılanlar #5) |

---

## 3. Doğru yapılanlar (korunması gereken kalıplar)

1. **Fason doğrudan sevkin OVER-COVER guard'ı — bu denetimin altın standardı.** `subcontractor.service.ts:6217-6285`: satırları kilitle → TAZE oku → cap'i tx İÇİNDE doğrula → aşarsa 409, mesajında sebebi söyle. D-E-01'in düzeltmesi bu kodun birebir kopyası olmalı; **yeni bir desen icat etmeye gerek yok**.
2. **Sevkiyat kapsam kilidinin (8023) doğru kullanımı.** `shipping.service.ts:2152-2159` ve `return.service.ts:481-490`: kilit tx'in **İLK** ifadesi, korunan sayımdan (`rollReturn.count` — phantom!) ÖNCE; yorumu neden sonraya alınamayacağını yazıyor. Kilit sırasının load-bearing olduğunu bilen az sayıda kod tabanından biri.
3. **`finishStep`'in idempotent adım kapatması.** `kursun-qc.service.ts:891-919`: `UPDATE … WHERE exitedAt IS NULL … RETURNING` ile yalnız fiilen kapatılan satırlar ilerletilir; `closed.length === 0 → { moved: 0 }` erken dönüşü mükerrer okutmayı sessizce ve doğru şekilde yutar. "Aynı okutma iki kez" sorusunun örnek cevabı.
4. **`performDispatchTx`'in hayalet guard'ı fail-closed.** `shipping.service.ts:1826-1848`: çuvalda olup binada olmayan top bulunursa **filtre değil assertion** — yorumu neden filtrenin onarılamaz bir çıkmaz üreteceğini anlatıyor. Ayrıca `preShipStatus` statü-bazlı gruplanarak yazılıyor (`:1854-1869`) → 2. kalite top storno'da 1. kaliteye terfi etmiyor.
5. **WO terminal guard'ının altı sitede de tutarlı olması** (B-8) ve `completeWorkOrderIfStepsDone`'un tek kapı olması (`roll-step.helper.ts:193-214`).
6. **`recomputeStepStatus`'un "giriş noktası" kuralı.** `roll-step.helper.ts:71-127`: aşağıdan katılan topun (fason dönüşü çocuğu / elle eklenen) yukarı adımları sonsuza dek bekletmesini engelliyor ve fail-safe yönü (çözülemezse bekleyen say) yazılı.
7. **`cancelReceipt`'in çift-iptal claim'i.** `subcontractor.service.ts:4866-4878`: `updateMany { id, cancelledAt: null }` + `count === 0 → 409`; pre-tx okumaya güvenmiyor.
8. **Defter-otoritatif denorm.** `order-status.helper.ts:44-81`: `shippedQty` hiçbir yerde increment edilmiyor, her seferinde defterden yeniden hesaplanıyor → sahada **0/281 satır ve 0/278 sipariş** sapma. Sürüklenmeyi tasarımla imkânsız kılan doğru yaklaşım.
9. **Sapma defterinin tek yazıcısı ve tersleme disiplini.** `roll-variance.helper.ts:50-78` (tx İÇİNDE) + `tambur-undo.service.ts:1610-1637` (kaynak-bazlı `reversedAt`; `OVERAGE` bilerek kapsam dışı, gerekçesi yazılı) + `subcontractor.service.ts:4986-4996` (`sourceRefId` ile — `rollId` ile silmenin neden yanlış olduğu açıklanmış).

---

## 4. Uygulanan kontrol listesi (prompt Bölüm 3-E, satır 531-571)

| Madde | Durum |
|---|---|
| **Stok/Depo** | |
| Negatif stok engelleniyor mu, kontrol atomik mi? | **Uygulandı** — DB CHECK (26 kısıt, `rolls_currentQty_nonneg` vb.); yarış yok (kısıt seviyesinde). Veride 0 ihlal (Q-STK-01). Negatife izin yok, eksiklik değil |
| `rezerve ≤ mevcut`, ölü rezervasyon | **Kapsam dışı — rezerv modeli YOK** (çuval havuzu; mühür/rezerv kaldırıldı, CLAUDE.md 2026-07). Karşılığı `PLANNED tahsis` ve o da `shippedQty`'ye sayılmıyor → D-E-01'de işlendi |
| Depo transferi çıkış+giriş tek tx | **Kapsam dışı — tek depo** (Sack = depo nesnesi, ayrı depo yok). Çuval içi taşıma incelendi: `shipping.service.ts:515-568` kaynak çuval kilitsiz → ② D-A'ya not |
| Lot/seri: aynı seri iki depoda, SKT, FEFO | **Kapsam dışı** — SKT/FEFO yok (tekstil); "seri" karşılığı `Roll.barcode` ve `@unique` + biçim taraması 0 ihlal |
| Birim çevrimi / faktör versiyonlama | **Kapsam dışı** — tek birim (metre); kg opsiyonel ve çevrim yok |
| Sayım sırasında hareket dondurma | **Kapsam dışı** — envanter sayımı modülü yok |
| **Üretim** | |
| İş emri durum makinesi zorlanıyor mu, eşzamanlı geçiş? | **Uygulandı** — 6 diriltme + 3 terminal geçiş sitesi tek tek okundu; hepsi claim'li ve terminal guard'lı (B-8). DB seddi yok ama kod tarafı tutarlı |
| BOM döngüsü / BOM versiyonu iş emrinde saklanıyor mu | **Uyarlandı** — BOM yok; karşılığı **rota şablonu**. Şablon değişikliği mevcut WO adımlarını etkilemiyor (adımlar WO açılışında kopyalanıyor, `RouteStep` → `WorkOrderStep`); refakat kartı da plan snapshot'ı taşıyor. Döngü riski yok (rota düz liste) |
| Üretim bildirimi + backflush tek tx | **Uyarlandı** — backflush yok; karşılığı finalize (`roll-finalize.helper`) ve tek tx'te koşuyor |
| **Aynı bildirim iki kez girilebilir mi (el terminali)** | **Uygulandı** — `finishStep` idempotent (Doğru yapılanlar #3), Tambur finalize `clientToken` + `TAMBUR_CONSUMED` erken dönüşü, KK1 `8021` + `clientToken`, kart okutması yumuşak dedup (A-5). ⚠️ KK1 replay'inin 4. durumu (iptal edilmiş kayıt) eksik → **② D-B'nin alanı**, burada tekrarlanmadı |
| Aynı makineye çakışan saatte iki iş emri | **Kapsam dışı** — makine takvimi/kapasite planlaması yok (`machineId` yalnız iz) |
| MRP paralel koşu / yarım veri | **Kapsam dışı** — MRP yok; Ürün Dengesi salt-okunur türetim |
| **Satınalma / Satış / Sevkiyat** | |
| **Kalan miktar aşımı (iki eşzamanlı irsaliye)** | **Uygulandı → D-E-01** (bu alanın ana bulgusu). Repro D-A/D-B sözleşmesinde; burada iki senaryo yazılı |
| Bir irsaliyeden iki kez fatura | **Uygulandı** — ERP fatura KESMEZ; `invoiceNo` yalnız iz ve atomik claim + `shipping:invoice` ile yazılıyor; veride 0 tutarsızlık (Q-SEV-14) |
| İade ≤ sevk | **Uygulandı** — B-7; 0 ihlal. ⚠️ Yan bulgu: iade sonrası topun iptal edilmesi (B-4) |
| Kredi limiti | **Kapsam dışı** — kredi limiti/cari risk modülü backend'de yok |
| Fiyat donması / fiyat listesi çakışması | **Kapsam dışı** — fiyat alanı yok (ERP fiyat/para taşımıyor) |
| **Finans / Muhasebe** | |
| `SUM(borç)=SUM(alacak)`, dönem kapanışı, KDV, ödeme eşleştirme, maliyet, e-Fatura | **Kapsam dışı — muhasebe defteri YOK.** Tek yüzey `accounting-export.service.ts` (CSV dışa aktarım) ve o da brüt kuralına uyuyor (A-3). Dönem kapanışı kavramı yok |
| Fatura numarası ardışıklığı | **Uygulandı (belge no olarak)** — B-5, 0 boşluk |
| **Yetki / onay** | |
| **Aynı kişi hem oluşturup hem onaylayabiliyor mu (SoD)** | **Uygulandı → D-E-09** (6/8 kullanıcı) |
| Onay limitleri / eşzamanlı çift onay | **Uyarlandı** — tutar bazlı onay limiti yok; "çift onay belgeyi iki kez ilerletir mi" karşılığı sevk/storno claim'leri ile kapalı (`performDispatchTx :1812`, `undoDispatch :2178`) |
| **Onaylanmış belge sonradan değiştirilebiliyor mu** | **Uygulandı → D-E-11** (generic yol temiz, refakat kartı yolu snapshot'ı eziyor) |
| **Ek olarak uygulanan (görev metnindeki zorunlu odak)** | |
| Negatif/aşan metraj, kesim çocukları toplamı | D-E-02, D-E-03, D-E-08, D-E-10 |
| Tambur geri alma aritmetiği (F0402, §13) | D-E-10 (+ `computeRestoredQty` senkron sözleşmesi ve 5b terslemesi okundu, tutarlı) |
| WO kapanış dispozisyonu | D-E-06 (otomatik kapanış dispozisyon istemiyor) |
| Adım statüsü türetilmesi (fason 7 site, §20) | D-E-06 + B-2 |
| Fason: kalem TAM satırla kapanır / kalan / kısmi parti / LIFO / çekme defteri / 635-638 NULL | B-6, B-9(A-9); LIFO guard'ının pre-tx olması ② D-A'ya not; `OPEN_OUTSTANDING` dörtlüsü `fason-open-dispatch.helper.ts:48-80` ile rapor SQL kopyası **satır satır karşılaştırıldı: bugün aynı** |
| Sevk: SEV-08, çift tahsis, tek aktif sevkiyat unique DROP, DISPATCH'te SHIPPED, storno, cancelReturn 8023 | D-E-01, D-E-05, A-1, B-3 |
| Sipariş: İstenen\|Sevk\|Açık, iptal kalem `shipped` ile sayılır, recompute kilitsiz, bağla/sök + tip aynası | D-E-12; iptal kalem kuralı `order-status.helper.ts:141-146` doğrulandı (gevşek `== null` bilinçli); tip aynası ② D-A'ya not (`workorder-link.service.ts:375-389` W kilidi yok) |
| Parti: sarma çakışması, `batchNumber` lookup/sıralama yasağı | A-2 (grep: 0 ihlal) |
| Belge no boşluk/mükerrer | B-5 |
| Refakat kartı tek kart + version | B-1, D-E-11 |
| Donmuş belge brüt kuralı (üç yüzey + belge yolu) | A-3 (7 yüzey tutarlı) |
| Yarı mamul arzdan düşülmez | A-4 |
| SoD üçlüsü rollerde | D-E-09 |
| `Roll SCRAP→IN_PRODUCTION` reopenStep kenarı | D-E-07 |

---

## 5. SINIR ÖTESİ NOTLAR

| Gözlem (dosya:satır) | Yönlendirme |
|---|---|
| **KK1 `clientToken` replay'i `existing.status`'e bakmıyor** (`inventory.service.ts:963-985`) — iptal/fire edilmiş topun token'ı `success:true` döner; saha: 227 CANCELLED/SCRAP top token taşıyor. Beceri §8'in "en pahalı hata"sı | **② D-B (mükerrer/idempotency)** — burada bilerek tekrarlanmadı |
| **`cancelReceipt` LIFO guard'ı pre-tx** (`subcontractor.service.ts:4753-4775`, `prisma` client'ı) — tx içi ikizi yok. Çift-iptal claim'i VAR (doğru), eksik olan yalnız sıra guard'ının tazeliği | ② D-A (eşzamanlılık) |
| **`workorder-link.service.ts:375-389` / `:453-471`** tip flip'i WO satır kilidi ve statü guard'ı olmadan; `order.service.ts:500` `cancelOrderLine` tip flip'i `targetItemId` kontrolsüz → `work_orders_stockprod_targetItem` CHECK'ine çarpar. **Ölçüm: sahada `type='ORDER_PRODUCTION' ∧ targetItemId IS NULL` = 0**, yani bugün erişilemez | ② D-A (+ D-C: 500/409 haritası) |
| **`shipping.service.ts:515-568` / `:772` / `:834-857`** — çuval taşımada kaynak çuval kilitsiz, `moved` count kontrolsüz | ② D-A |
| **`freezeForSource` versiyonu kilitsiz `findFirst` max+1** (`printed-document.service.ts:329-341`) — `@@unique(docType,sourceId,version)` yarışı P2002'ye çevirir; `dispatchShipment` yolu `withBarcodeRetry` ile sarılı DEĞİL (`createShipment` sarılı) | ② D-A / D-F (hata yolu) |
| **`SubcontractorReceiptItem.newRollId` adı ORİJİNAL topu gösteriyor** (born roll'u değil) ve `receivedQty` tam kabulde NULL — iki yanıltıcı sözleşme yan yana. Bugünkü okuyucular doğru, yeni okuyucu kolayca yanılır | ② D-L (kod kalitesi) + D-C (veri modeli) |
| **Fason "açık+outstanding" dörtlüsünün ham SQL kopyası** `subcontract-scorecard.report.service.ts:276-292` — AST bekçisi (`test_fason_open_dispatch_single_source.ts`) yalnız TS çağrılarını tarıyor, SQL metnini görmüyor. CLAUDE.md'nin *"elle kopya AST bekçisiyle YASAK"* iddiası SQL için geçerli değil. **Bugün ayrışma yok** (satır satır karşılaştırıldı) | ② D-K (bekçi kapsamı) |
| **Tambur uçlarında `batchNumber` alanı İŞ EMRİ NO taşıyor** (`tambur.service.ts:504`, `:1729`, `:1964`) — "İş Emri No ≠ Parti" değişmezinin API yüzeyindeki ihlali. Mobil tarafta uyarı yorumu var (`mobil/src/types/models.ts:431-437`: *"Ekranda 'Parti' diye göstermeyin"*), yani tuzak biliniyor ve yazılı | ② D-L (sözleşme adlandırması) |
| **`tambur-undo.service.ts:22-25`** yorumu "DB'deki TEK böyle satır" diyor, veride 2 satır var (D-E-10) | ② D-L (bayat beyan) |
| **`roll-disposition.helper.ts:231-238`** `cancelTrail` yazıyor ama `preCancelStatus` yazmıyor → WO kapanışında CANCELLED edilen top da geri almada Ham Stok'a düşer (D-E-04'ün ikinci ayağı) | (bu raporda D-E-04'e dahil; ② D-C denorm listesine de not) |
| **Mutabakat (`consistency-check*.sql`, `test_consistency*.ts`) hiçbir otomatik işe bağlı değil** — `src/jobs` altında mutabakat işi yok, `/health` sayacı yok. D-E-10'un tespit gecikmesinin (13 gün) kök nedeni | ② D-I (gözlemlenebilirlik) — D-E-10 önerisi 1 orada da geçerli |
| **`teks.audit_guard` prod'da açık mı bilinmiyor** (kopyada `pg_db_role_setting` taşınmıyor) — D-E-09'un telafi edici kontrolü buna bağlı | ops / ② D-J |

---

## 6. KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Sebep |
|---|---|
| **Repro (K3)** | Bu alan (D-E) repro sözleşmesine dahil değil (yalnız D-A ve D-B zorunlu). D-E-01, D-E-05, D-E-08 için repro senaryoları yazılı ve ölçülebilir; koşturulmadı |
| `consistency-check.sql` §7b, §7c, §12, §24a, §25 | Saha kopyasında koşulmadı (bu turda yalnız §13, §20 eşdeğeri, §9/§10/§11 eşdeğeri ve K10 sorguları koştu). §12 (movement `qtyOut = qtyIn`) muafiyet listesi TS'te (`test_consistency.ts:280-330`) — SQL'e çevirmek muafiyet desenlerinin birebir taşınmasını ister, bu turda yapılmadı |
| `kursun-qc.reopenStep`'in izin kapısı | `reopenStep`'in route guard'ı okunmadı (altı guard kaynağı çözülmedi) → D-E-07'de "izin istemiyor" denmedi, yalnız "sebep sormuyor, sapma terslemiyor" iddia edildi. ② D-G izin tarafına bakabilir |
| Kartela (Swatch) değişmezleri | `kartela.service.ts` satır satır okunmadı; yalnız `INV-SM-01` kenarları (AT_KARTELA/KARTELA_CONSUMED) ve `SACK_ABSENT_STATUSES` üzerinden dolaylı kapsandı |
| İçe aktarım (`ImportRun`) iş kuralı değişmezleri | K5/K9'un alanı; yalnız `clientToken` penceresi anıldı |
| Canlı prod (2026-08-25 sonrası) | Yalnız kopya var; `SURUM-2.9.0` deploy'undan (08-24/25) sonraki 3 günün verisi görülmedi. D-E-04'ün "son hafta 47/52" ölçümü bu pencereyi kapsamıyor |
| `OrderLine.cancelledAt` bazlı ölçümler | Kolon saha kopyasında YOK (5 migration eksik) → INV-SIP-02 yalnız koddan doğrulandı (`order-status.helper.ts:141-146`), veride ölçülemedi |
| Electron/mobil istemci davranışı | Backend denetimi kapsamı; yalnız `RollDetailSheet.tsx:236-243` (D-E-02'nin görünen sonucu) ve `mobil/src/types/models.ts:431-437` (bilinen tuzak notu) salt-okunur teyit için açıldı |
| Bekçi koşumu | Hiçbir `scripts/test_*.ts` koşturulmadı/kırılmadı (salt-okunur denetim). "Bekçi yok" iddiaları dosya adı taraması + K11 envanterine dayanıyor |
