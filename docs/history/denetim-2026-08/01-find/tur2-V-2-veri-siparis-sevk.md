# TUR 2 · V-2 — VERİ MERKEZLİ DENETİM: Sipariş / Sevkiyat / İade / Çuval / Belge

**Tarih:** 2026-08-28 · **Dal:** `adnansahin` · **HEAD:** `ce8681d1`
**Veri kaynakları:** `tekserp_saha_0825` (prod'un 2026-08-25 kopyası, 190 migration) ve `adnansahin_db` (dev, 195 migration) — her ikisi de `audit/tools/sql-*.sh` ile SALT-OKUNUR.
**SQL dosyaları:** `audit/data/TUR2-V2-b1.sql`, `audit/data/TUR2-V2-b2.sql`, `audit/data/TUR2-V2-b3.sql` (+ inline sorgular bu dosyada tam metinle).
**Mercek:** Prod kopyasında İHLAL ARA → bulduğunu KODDA geriye izle. Kod merkezli Tur 1'in 168 bulgusu (`tours/tur1-seen.json`) tekrar edilmedi; kesişen yerlerde `onceki_defter` alanı doldurulmuştur.

**Alanın hacmi (saha):** 278 sipariş · 281 sipariş kalemi · 40 sevkiyat · 55 sevkiyat-sipariş bağı · 41 çuval · 46 çuval tahsisi · 5 iade · 328 donmuş belge · 27 müşteri · 0 şube · 0 doğrudan (fason) sevk.

---

## ÖZET — 2 satırda

Sevkiyat defterinin (**`SackAllocation`**) tamamı, sevkiyat **kurulurken tek seferde** yazılır; sevk anında bir daha hesaplanmaz, boş sonuç **sessizdir** ve mutabakat kapısı (`consistency-check.sql §1/§2`) denormu **defterin kendisine** karşı ölçtüğü için defterin eksik olmasını **tanım gereği göremez**. Sonuç prod kopyasında ölçüldü: **birebir aynı kumaş+renk+en'e sahip 3 sipariş kaleminde 2.108,5 m mal sevk edilmiş, sipariş defterine 0,000 m düşmüş**; sipariş bugün hâlâ `APPROVED` / "Açık 1000 m" görünüyor ve irsaliyede o siparişin numarası basılı.

---

## BULGULAR

### [V-2-01] Sevkiyat siparişe bağlı ve mal birebir kalemin kumaşı — buna rağmen sipariş defterine 0 m düşüyor: 3 kalemde 2.108,5 m sevk "hiç olmamış" sayılıyor

| Şiddet | **S1** | Kategori | **E — Satınalma/Satış/Sevkiyat · sipariş karşılanma defteri (INV-SEV-01/02, INV-SIP-01)** | Öncelik | **P1** | Modül | sevkiyat/sipariş | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Sevk irsaliyesi `SIP1008260048` yazıyor, kamyona o siparişin kumaşından 560 m yükleniyor, mal müşteriye gidiyor — ama siparişin "Sevk" kolonu 0 m'de kalıyor, "Açık" 1000 m olarak duruyor. Aynı durum üç ayrı siparişte, toplam **2.108,5 m**'de ölçüldü ve bu üç kalemde **kumaş + renk + en birebir aynı** (yani "eşleşmeyen mal bilerek sevk edilebilir" tasarım kararı bu satırları AÇIKLAMAZ). Beş sevkiyat ise sipariş kümesi dolu olduğu hâlde **tek bir tahsis satırı bile** üretmemiş (3.040,2 m). Planlamacı bu siparişleri yeniden üretime alır, müşteri malı ikinci kez ister; ERP "hiç sevk edilmedi" der.

**Kanıt — veri (K2, `tekserp_saha_0825`).**

`audit/data/TUR2-V2-b1.sql` V2-Q08 (sipariş bağlı ama sıfır tahsis):
```sql
SELECT sh."shipmentNo", sh."dispatchedAt"::date,
  (SELECT count(*) FROM shipment_orders so WHERE so."shipmentId"=sh.id) AS sip,
  (SELECT COALESCE(SUM(r."currentQty"),0) FROM rolls r JOIN sacks sk ON sk.id=r."sackId" WHERE sk."shipmentId"=sh.id) AS metraj
FROM shipments sh WHERE sh.status='DISPATCHED'
AND NOT EXISTS (SELECT 1 FROM sacks sk JOIN sack_allocations sa ON sa."sackId"=sk.id WHERE sk."shipmentId"=sh.id);
```
| shipmentNo | sevk | sipariş | sipariş no | metraj |
|---|---|---|---|---|
| SVK1708260002 | 2026-08-17 | 1 | SIP1008260003 | 348,3 |
| SVK1808260001 | 2026-08-18 | 1 | SIP1008260048 | 560,0 |
| SVK1908260002 | 2026-08-19 | 2 | SIP1008260012, SIP1008260028 | 975,1 |
| SVK2008260001 | 2026-08-20 | 1 | SIP1408260015 | 619,8 |
| SVK2008260005 | 2026-08-20 | 2 | SIP1008260027, SIP1008260002 | 537,0 |
| **toplam** | | | | **3.040,2 m** |

(6. satır `SVK0308260001` sipariş kümesi BOŞ olduğu için burada sayılmadı — tasarım gereği "siparişsiz sevk", bulgu değil.)

**Çekirdek — spec BİREBİR eşleşen kalemler** (bu üç satırda tasarım muafiyeti yok):
```sql
WITH t AS (SELECT unnest(ARRAY['1e70c8cf-a84f-4018-9cb8-dfa48abc3c1d',
                               '335621b0-7caa-45a5-acfc-5c6a0a347b5e',
                               '7606314a-28c0-4e5f-9dc4-e2459cd50810']::uuid[]) AS lid)
SELECT o."orderNumber", ol.quantity, ol."shippedQty", sh."shipmentNo",
  (ol."itemId"=r."itemId") AS item_ayni, (ol."colorId"=r."colorId") AS renk_ayni, (ol.width=r.width) AS en_ayni,
  count(*) AS top, SUM(r."currentQty") AS metraj
FROM t JOIN order_lines ol ON ol.id=t.lid JOIN orders o ON o.id=ol."orderId"
JOIN shipment_orders so ON so."orderId"=o.id JOIN shipments sh ON sh.id=so."shipmentId"
JOIN sacks sk ON sk."shipmentId"=sh.id JOIN rolls r ON r."sackId"=sk.id
GROUP BY 1,2,3,4,5,6,7 ORDER BY 1,4;
```
| Sipariş | Kalem | İstenen | Kayıtlı Sevk | Sevkiyat | item | renk | en | Top | Metraj |
|---|---|---|---|---|---|---|---|---|---|
| SIP1008260011 | 335621b0 | 1000,000 | **0,000** | SVK1808260003 | ✔ | ✔ | ✔ | 22 | **829,9** |
| SIP1008260012 | 7606314a | 1000,000 | **0,000** | SVK1908260002 | ✔ | ✔ | ✔ | 18 | **718,6** |
| SIP1008260048 | 1e70c8cf | 1000,000 | **0,000** | SVK1808260001 | ✔ | ✔ | ✔ | 15 | **560,0** |
| | | | | | | | | **55 top** | **2.108,5 m** |

Üç kalemin de `sack_allocations` toplamı **0** ve `shippedQty = 0,000`:
```sql
SELECT ol.id, o."orderNumber", ol.quantity, ol."shippedQty",
  (SELECT COALESCE(SUM(sa.qty),0) FROM sack_allocations sa WHERE sa."orderLineId"=ol.id) AS toplam_tahsis
FROM order_lines ol JOIN orders o ON o.id=ol."orderId" WHERE ol.id IN (…);
-- 3 satır: toplam_tahsis = 0, shippedQty = 0.000, quantity = 1000.000
```

**Karşı-hipotezler elendi (hepsi ölçüldü):**
- *"Kalem sonradan düzenlendi / renk değişti"* → `order_lines.updatedAt` = tam sevk anı, sonrasında hiç dokunulmamış; `system_logs` `tableName='ORDER_LINE'` bu üç kayıt için **0 satır**; sipariş CREATE audit'i (`{"lines":[{"width":330,"itemId":"4703da17…","colorId":"3c1c2dd2…","quantity":1000}]}`) bugünkü değerlerin **aynısını** taşıyor.
- *"`need` o an sıfırdı (mal başka sevkiyattan düşülmüştü)"* → o kalemlerin ömrü boyunca hiç tahsisi olmamış (`toplam_tahsis=0`), `subcontractor_direct_ship_allocations` tablosu **boş (0 satır)**, iptal edilmiş/CANCELLED sevkiyat **yok** (40 sevkiyatın 39'u DISPATCHED, 1'i PLANNED) → `shippedQty` hiçbir zaman 0'dan farklı olmadı, `need = 1000`.
- *"Kod o gün farklıydı"* → `git log -S "writeShipmentAllocationsTx" -- shipping.service.ts` tek commit: `b9fe724d` (2026-07-12); `allocation.helper.ts` en son 2026-07-14'te değişmiş. 2026-08-01 sonrası sevkiyat/tahsis mantığına dokunan commit YOK.
- *"Tahsis yazıldı, sonra silindi"* → mevcut 46 tahsisin hepsinin `createdAt`'i kendi sevkiyatının `createdAt`'inden **< 0,4 sn** sonra; tek bir yeniden-yazım izi yok. `sackAllocation.deleteMany` yalnız iki yerde (`shipping.service.ts:1345`, `:1976`) ve ikisi de bu sevkiyatlarda koşmamış (audit'te tek `SHIPMENT CREATE` satırı var).
- *"Algoritma hiç koşmadı"* → `SVK1808260003` **aynı transaction'da** ikinci kaleme (SIP1108260007) 613,2 m tahsis yazmış; yani motor çalıştı ve birebir eşleşen kalemi **atladı**.

**Kanıt — kod.**

`Teks-Erp/src/services/shipping.service.ts:1339-1354` — defter **tek atış**, boş sonuç **sessiz**:
```ts
private async writeShipmentAllocationsTx(tx, shipmentId, orderIds, branchId): Promise<void> {
  await tx.sackAllocation.deleteMany({ where: { sack: { shipmentId } } });
  if (orderIds.length === 0) return;
  const sackRows = await tx.sack.findMany({ where: { shipmentId }, select: { id: true } });
  const sackIds = sackRows.map((s) => s.id);
  if (sackIds.length === 0) return;
  const { allocations } = await this.computeSackAllocations(tx, { sackIds, orderIds, branchId });
  if (allocations.length > 0) {                       // ← else YOK: 0 satır = sessiz başarı
    await tx.sackAllocation.createMany({ … });
  }
}
```
`shipping.service.ts:1301-1335` — `need = quantity − shippedQty`, **kurulum anındaki** anlık görüntü; `allocation.helper.ts:36-48` (`specMatch`) ve `:211-241` (`distributeSacksToLines`) eşleşmeyen malı sessizce dışarıda bırakır (yorumu da bunu söyler: *"Bir çuvalın bir satıra hiç uymayan içeriği (spec/şube) tahsis edilmez (fazla mal)"*).

`shipping.service.ts:1873-1882` — **sevk anında yeniden tahsis YOK**; `performDispatchTx` yalnızca *var olan* defteri okuyup `shippedQty`'yi yeniden hesaplar ve irsaliyeyi dondurur:
```ts
const orderIds = [...new Set(orderRows.map((o) => o.orderId))];
const lineRows = await tx.orderLine.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
await touchOrderLinesTx(tx, lineRows.map((l) => l.id));
await recomputeOrderStatusForOrders(tx, orderIds);              // boş defter → shippedQty 0
await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId);
```

**"Koruma yok" teyidi (altı kaynak da çözüldü).** ① DB seddi yok — `sack_allocations` üzerinde yalnız `(sackId, orderLineId)` unique ve `qty > 0` CHECK var; "sevk edilen sipariş satırının tahsisi olmalı" diye bir kısıt yok (dosya başlığı zaten *"DB seddi olmayan tek denormalize alan"* diyor). ② Uygulama guard'ı yok — `performDispatchTx`'te tahsis varlığı kontrol edilmiyor (`:1834-1848` yalnız hayalet top kontrolü). ③ Uyarı **yalnız ayrı bir salt-okunur uçta**: `shipping.service.ts:1507` (`"Seçili siparişlere yazılamayan ~N m mal var"`) ve `:1522` — `previewCreateShipment` çağrılmadan da sevkiyat kurulabilir ve sahadaki rejimde (`shipping.confirmationEnabled` KAPALI, `:1398`) kurulum ile sevk **aynı transaction**, yani PLANNED aşamasında kimsenin bakma fırsatı yok. ④ Bekçi yok — `scripts/test_sack_pool_lifecycle.ts` yaşam döngüsünü ölçer, "birebir eşleşen kaleme tahsis yazıldı mı" sondası yok. ⑤ Mutabakat kapısı kör (ayrı bulgu **V-2-03**). ⑥ Feature-flag ile kapatılabilir bir davranış değil.

**failure_mode.** Operatör Paketleme'den bir çuval seçer, "Sipariş: SIP1008260048" işaretler, sevkiyatı kurar; sevk onayı kapalı olduğu için aynı anda DISPATCHED olur. `computeSackAllocations` 0 satır üretir → `createMany` hiç çağrılmaz → `recomputeOrderStatusForOrders` boş defterden `shippedQty = 0` yazar → irsaliye **SIP1008260048** başlığıyla 560 m basılır ve müşteriye gider → sipariş ekranı "İstenen 1000 · Sevk 0 · Açık 1000" gösterir → planlamacı aynı 1000 m için ikinci bir iş emri açar, mal iki kez üretilir; müşteri "zaten aldım" der, ERP'de karşılığı yoktur.

**İş etkisi.** Prod kopyasında sevk edilen 27.611,8 m'nin yalnız 20.459,2 m'si sipariş defterine düşmüş (fark 7.152,6 m = **%25,9**; bunun 2.108,5 m'si mekanik olarak savunulamaz, kalanı "fazla/eşleşmeyen mal" tasarım kararının içine düşüyor). Etkilenen üç sipariş bugün hâlâ `APPROVED`. Karşılanma raporu, üretim dengesi, "açık talep" süzgeci, müşteri karnesi ve termin raporu hepsi aynı yanlış rakamı okuyor (`order-line-scope.helper.ts:26-49` tek kaynak → hata da tek kaynaktan yayılıyor).

**Veride fiili ihlal (K2).** Yukarıda; saha **3 kalem / 2.108,5 m (birebir eşleşme)** + **5 sevkiyat / 3.040,2 m (sıfır tahsis)**. Dev'de karşılığı: 1 kalem (`TST-DS-ORD-46657044`) `shippedQty=500` iken defter 0 — ters yön, test kalıntısı.

**Repro (K3).** İstenmiyor (D-A/D-B değil); ayrıca bu bir yarış değil, tek-istekli mantık boşluğu.

**Öneri (2. tur için).**
1. `performDispatchTx` içinde, `freezeForSource`'tan ÖNCE bir **kapanış mutabakatı**: sevkiyatın sipariş kümesindeki her sipariş için, o sevkiyattan yazılmış tahsis toplamı 0 ise **fail-closed 409** (`SHIPMENT_NO_ALLOCATION`) — mesaj somut: *"SIP…'ye hiçbir metraj yazılamadı; çuvaldaki mal bu siparişin kumaş/renk/en'ine uymuyor. Siparişi kaldırın ya da malı düzeltin."* Kullanıcının bilinçli "fazla/eşleşmeyen mal" akışı için tek seferlik `confirmUnallocated: true` bayrağı (2026-08-19 `PLAN_MISMATCH` deseninin birebir ikizi).
2. `writeShipmentAllocationsTx`'in **boş sonucu** çağırana dönsün (`{ written, skippedLineIds, surplusMeters }`) ve `createShipment` bunu `ApiResponse.warnings`'e koysun (rota kapsaması kararının deseni).
3. `consistency-check.sql`'e **§1c**: "DISPATCHED sevkiyatın sipariş kümesindeki kalemle spec'i birebir eşleşen top var ama o kaleme tahsis yok" (sorgu yukarıda hazır) + `test_consistency.ts` mekanik ikizi.
4. **[PROD'DA ÇALIŞTIRMA]** Geçmiş 3 kalemin düzeltmesi ayrı bir iş kararıdır: `--apply` öncesi her satırı listeleyen dry-run script; geri alma = yazılan `sack_allocations` id'lerini silip `recomputeOrderStatusForOrders` tekrar koşmak. Toplu UPDATE ile `shippedQty` yazmak YASAK (defter-otoritatif alan; kök nedeni de gizler — 2026-08-22 §13 dersi).

**Kabul kriteri.** (a) Yeni bekçi: birebir eşleşen kalemi olan bir sevkiyat 0 tahsisle DISPATCHED **olamıyor** (negatif sonda: guard kaldırılınca kırmızı). (b) `consistency-check §1c` saha kopyasında bugünkü 3 satırı gösteriyor, düzeltme sonrası 0. (c) Bilinçli "eşleşmeyen mal" akışı hâlâ mümkün ama artık `confirmUnallocated` izi bırakıyor.
**Efor:** 2 gün (backend + bekçi + mutabakat sorgusu; veri düzeltmesi hariç).
**Önceki defter:** `BULGU-T1-010` (aynı dosyanın **ters** kusuru: kalan kapasitesi kilitten önce okunuyor → çift sevk). Bu bulgu onun değil, aynı tek-atış tasarımının **eksik yazma** yüzü; `audit/FINDINGS.jsonl`'de eşleşen id yok.

---

### [V-2-02] Sevk defterine (SackAllocation) hiç audit yazılmıyor — "bu mal neden siparişten düşmedi" sorusu geriye izlenemiyor

| Şiddet | **S2** | Kategori | **I — Hata/gözlemlenebilirlik (INV-AUD-01)** | Öncelik | **P2** | Modül | sevkiyat | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `SackAllocation` para/sevk defteridir — `OrderLine.shippedQty` tamamen ondan türer (`order-status.helper.ts:48-81`). Buna rağmen tablonun hiçbir yazımı audit'e girmiyor: prod kopyasında `system_logs` içinde `tableName` `%ALLOC%` eşleşen **0 satır** var ve audit'in tanıdığı tablo adları yalnızca `ORDER, ORDER_LINE, SACK, SHIPMENT, WORK_ORDER, WORK_ORDER_STEP`. Sevkiyat kurulumu tek bir `SHIPMENT CREATE` satırı bırakıyor; o satır `sackIds`+`orderIds`'i taşıyor ama **hangi kaleme kaç metre yazıldığını taşımıyor**. V-2-01'in kök nedeni tam olarak bu yüzden geriye izlenemedi.

**Kanıt.**
```sql
SELECT count(*) FROM system_logs WHERE "tableName" ILIKE '%ALLOC%';   -- 0
SELECT DISTINCT "tableName" FROM system_logs
 WHERE "tableName" ILIKE '%SACK%' OR "tableName" ILIKE '%SHIP%' OR "tableName" ILIKE '%ORDER%';
-- ORDER · ORDER_LINE · SACK · SHIPMENT · WORK_ORDER · WORK_ORDER_STEP
```
Kod: `shipping.service.ts:1345` (`deleteMany`) ve `:1352` (`createMany`) — ikisi de `AuditService.log` çağırmıyor; tek audit `:1446-1447` (`action:"CREATE", tableName:"SHIPMENT"`, `newData` yalnız kimlik listeleri). Karşılaştırma: aynı serviste `addSacksToShipment` (`:1560`) ve `removeSackFromShipment` (`:1582`) tahsisleri **yeniden yazar** ve audit'e yalnız `{kind:"ADD_SACKS"}` bırakır — defter mutasyonu yine görünmez. Proje kuralı ("Her CUD operasyonu → `AuditService.log()`", kök `CLAUDE.md`) bu tabloda uygulanmamış.

**failure_mode.** Sipariş "Açık 1000 m" görünür, operatör "ben bu malı sevk ettim" der. Destek `system_logs`'a bakar: yalnız `SHIPMENT CREATE {orderIds:[…]}` vardır. Tahsisin hiç yazılmadığı mı, yazılıp sonra silindiği mi, hangi metrajla yazıldığı mı — **hiçbiri** ayırt edilemez; tek çare kaynak kodu okuyup senaryo tahmin etmektir (bu denetimde birebir yaşandı, ve mekanizma yine de kesinleştirilemedi).

**İş etkisi.** Mali etkisi olan tek defterin değişim geçmişi yok; müşteri itirazında ("bu 560 m'yi bize kestiniz mi?") kanıt zinciri kopuk. Audit tamper trigger'ı (`20260819161000`) bu tabloyu zaten kapsamıyor.

**Veride fiili ihlal (K2).** 46 tahsis satırı · 0 audit satırı (saha). Dev: aynı, 0.

**Öneri.** `writeShipmentAllocationsTx` tx'ten SONRA (best-effort deseni) tek bir `AuditService.log({ tableName: "SACK_ALLOCATION", action: "REPLACE", recordId: shipmentId, oldData: eskiToplamlar, newData: { yazilan: [{lineId, qty}], atlanan: [{lineId, need, sebep}] } })`. `atlanan` alanı V-2-01'in teşhisini tek satıra indirir. Alternatif/ek: `Shipment` audit satırının `newData`'sına `allocations` özetini gömmek (migration gerektirmez).
**Kabul kriteri.** Tahsis yazan üç çağrı yerinden geçen bir sevkiyat, `system_logs`'ta yazılan+atlanan kalemleri gösteren tek bir satır bırakıyor; bekçi bu satırı arıyor.
**Efor:** 0,5 gün. **Önceki defter:** yok (K12'de eşleşme yok).

---

### [V-2-03] Mutabakat kapısının kör noktası kusurla aynı yerde: `consistency-check §1/§2` denormu DEFTERE karşı ölçüyor, defterin eksikliğini tanım gereği göremiyor

| Şiddet | **S2** | Kategori | **K.1 — Bekçi kapsamı / kör nokta** | Öncelik | **P2** | Modül | sevkiyat/sipariş | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Projenin sevk defteri için tek otomatik kapısı `scripts/consistency-check.sql §1/§2` (+ mekanik ikizi `test_consistency.ts`). İkisi de **`OrderLine.shippedQty` ile `Σ SackAllocation` arasındaki farkı** arar. V-2-01'de `shippedQty = 0` ve `Σ SackAllocation = 0` olduğu için **fark 0'dır**: kapı yemyeşil yanarken 2.108,5 m kayıp. Bu, projenin kendi kayıtlı dersinin ("bekçinin kör noktası hatanın kendisiyle aynı yerdeydi" — 2026-08-22 §13, 2026-08-26 sebep önbelleği) sevkiyat alanındaki tekrarıdır.

**Kanıt.** `Teks-Erp/scripts/consistency-check.sql:27-45` (§1) ve `:47-56` (§2):
```sql
-- == 1) OrderLine.shippedQty  vs  Σ(SackAllocation[DISPATCHED] + DirectShipAllocation) ==
… WHERE ol."shippedQty" <> COALESCE(sa.toplam, 0) + COALESCE(dsa.toplam, 0);
```
Dosyanın kendi başlığı da kapsamı doğru tarif ediyor: *"shippedQty denormalize alanı defter-otoritatiftir … ama DB seddi YOK — drift oluşursa … Bu script onu yakalar."* Yakaladığı şey **drift**tir; **defterin hiç yazılmamış olması** drift üretmez.

Doğrulama (saha): §1/§2'nin birebir kopyası (`TUR2-V2-b1.sql` V2-Q01, V2-Q02) **0 satır** döndü — aynı anda V2-Q08 5 sevkiyat, üç-kalem sorgusu 2.108,5 m gösterirken.

Ek kör nokta: `consistency-check.sql`'in "ne zaman" notu **"3 ayda bir veya şüphe anında"** ve elle koşuluyor; otomatik alarm yok (`src/jobs/` altında mutabakat işi yok — `archive`, `backup`, `offsite-sweeper`, `job-failure`, katalog uzlaştırıcıları).

**failure_mode.** Ekip çeyrek sonunda `test_consistency`'yi koşar, 22 bölümün hepsi yeşil olur ve "sevk defteri sağlam" sonucuna varılır; oysa o çeyrek boyunca sipariş defterine hiç yazılmamış her sevk sessizce birikmiştir. Kapı yalnızca *"denorm defterden koptu mu"* sorusunu yanıtlar, *"defter gerçeği taşıyor mu"* sorusunu değil.

**İş etkisi.** Yanlış güvence: V-2-01 tipi kayıp, kapı yeşilken sınırsız süre birikebilir (bugün 2.108,5 m; 5 haftalık veri).

**Öneri.** §1'in yanına **§1c "defter eksikliği"** bölümü (V-2-01 önerisi #3, sorgu hazır) + `test_consistency.ts` ikizine negatif sonda (bir tahsis satırı geçici silinince kırmızı vermeli). Ayrıca `/api/admin/health`'e "son mutabakat koşumu" sayacı ya da haftalık zamanlanmış koşum + `job-failure` kaydı.
**Kabul kriteri.** §1c bugünkü saha kopyasında 3 satır, düzeltme sonrası 0; negatif sonda kırmızı veriyor.
**Efor:** 1 gün. **Önceki defter:** yok.

---

### [V-2-04] Kalite Sertifikası ile Sevk İrsaliyesi AYNI belge numarasını taşıyor; `printed_documents.documentNo` üzerinde hiçbir tekillik yok

| Şiddet | **S3** | Kategori | **C — Veri modeli / belge bütünlüğü (INV-DOC-01)** | Öncelik | **P3** | Modül | belge | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `QUALITY_CERTIFICATE` belgesinin numarası, kaynağı olan sevkiyatın `shipmentNo`'sundan aynen kopyalanıyor. Sonuç: müşteriye giden iki farklı resmî belge (sevk irsaliyesi ve kalite sertifikası) **aynı numarayı** taşıyor. `printed_documents` tablosunda `documentNo` üzerinde unique index YOK (yalnız `(docType, sourceId, version)` unique), dolayısıyla bu çakışma hiçbir yerde engellenmiyor.

**Kanıt — veri (saha).**
```sql
SELECT "documentNo", count(*) AS satir, count(DISTINCT "sourceId") AS kaynak,
       string_agg(DISTINCT "docType"::text,',') AS turler, string_agg(version::text||'/'||status::text,' ') AS surumler
FROM printed_documents GROUP BY 1 HAVING count(*)>1;
```
→ 14 gruptan 13'ü aynı kaynağın sürümleri (beklenen). **1 grup istisna:**
`SVK1708260001 | 2 satır | 1 kaynak | QUALITY_CERTIFICATE,SHIPMENT_DISPATCH | 1/ACTIVE 1/ACTIVE`

**Kanıt — kod.** `Teks-Erp/src/services/shipping.service.ts:3680-3690`:
```ts
async function buildQualityCertificateDoc(db, shipmentId) {
  const c = await collectShipmentDerived(db, shipmentId);
  …
  return { documentNo: c.header.shipmentNo, doc: … };   // ← irsaliyenin numarası
}
```
Şema: `printed_documents` indeksleri → `printed_documents_pkey`, `printed_documents_docType_sourceId_version_key`, `printed_documents_docType_sourceId_status_idx`, `printed_documents_printedById_idx`. `documentNo` üzerinde kısıt yok.

**failure_mode.** Müşteri/gümrük dosyasında "SVK1708260001" iki farklı içerikli belgeye işaret eder; belge no ile arama iki sonuç döner, tarama/arşiv sistemi ikisini aynı belgenin kopyası sanar. Bir uyuşmazlıkta "hangi SVK1708260001?" sorusuna belge numarası cevap veremez.

**İş etkisi.** Düşük hacim (bugün 1 kalite sertifikası) ama belge yüzeyi büyüdükçe her sevkiyatta tekrarlanır; `INV-DOC-01`'in "belge no tekil" ifadesi belge defteri düzeyinde yanlış.

**Öneri.** Kalite sertifikasına kendi ön eki (`KS` + GGAAYY + NNNN, `nextDailySeq` ile) ya da en azından `SVK…-KS` soneki. `documentNo`'yu tekilleştiren bir kısıt **koyulamaz** (sürümler numarayı paylaşır — bu doğru); doğru sed `UNIQUE (documentNo, docType, version)` ya da "aynı `documentNo` iki farklı `docType`'ta olamaz" bekçisi (`test_printed_documents.ts`'e ek §).
**Kabul kriteri.** Aynı `documentNo`'yu iki farklı `docType`'ta üreten hiçbir kaynak kalmadı (sorgu 0) ve bekçi bunu ölçüyor.
**Efor:** 0,5 gün. **Önceki defter:** yok.

---

### [V-2-05] İade irsaliyesi numarası standart dışı ve SIRASIZ (`IADE-GGAAYY-<uuid[0:6]>`) — boşluk/mükerrer denetimi imkânsız

| Şiddet | **S3** | Kategori | **E/C — Belge numarası değişmezi (INV-DOC-01/02)** | Öncelik | **P3** | Modül | iade/belge | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Tüm belge numaraları `PREFIX+GGAAYY+NNNN` (backend-authoritative, `nextDailySeq`, boşluksuz) iken iade irsaliyesi bu aileden çıkmış: numara **UUID'nin ilk 6 hex hanesinden** türetiliyor. Sonuç: iade irsaliyeleri için `Q-DOC-02` tipi "günlük sayaç boşluksuz mu" denetimi **yapılamaz**; bir iade belgesinin bastırılıp defterden düşürüldüğü hiçbir yöntemle tespit edilemez.

**Kanıt — veri (saha), 4 satırın tamamı:**
```
IADE-030826-E27AAA | IADE-030826-67CAAA | IADE-030826-24709B | IADE-030826-29C873
```
**Kanıt — kod.** `Teks-Erp/src/services/return.service.ts:1084-1086`:
```ts
const d = rr.createdAt;
const p = (x: number) => String(x).padStart(2, "0");
const documentNo = `IADE-${p(d.getDate())}${p(d.getMonth()+1)}${String(d.getFullYear()).slice(2)}-${rr.id.slice(0,6).toUpperCase()}`;
```
Yorumu da kararı açıkça yazıyor (`:1030`): *"Belge no yok → createdAt + kısa id'den okunur bir numara türetilir"*. Karşılaştırma: `utils/code-format.ts:82-113` (`buildDailyCode`/`nextDailySeq`) — diğer 6 belge ailesinin tek kaynağı; iade oraya bağlanmamış.

**failure_mode.** Fabrika bir çeyreklik iade dosyası ister. `SVK`/`FS`/`FK` için "gün başına max(sıra) = adet" sorgusu boşluk olmadığını kanıtlar (saha: **0 boşluk**); `IADE-…` için böyle bir sorgu **kurulamaz**, çünkü numaralar sıralı değil. Bir iade satırı iptal edilip belgesi VOIDED yapıldığında ya da bir satır elle silindiğinde eksikliği gösterecek hiçbir iz kalmaz.

**İş etkisi.** İade belgesi müşteri kabul belgesidir; sıra bütünlüğü kanıtlanamayan bir belge serisi denetim (ISO 9001 kontrollü belge / mali müşavir) karşısında zayıftır. Ek olarak numara **süreç saat dilimine** de bağlı (bu yüzü `BULGU-T1-098`'de kayıtlı).

**Öneri.** `nextDailySeq` ailesine taşı: `IADE`/`IAD` ön ekiyle `PREFIX+GGAAYY+NNNN`. Geçmiş 4 satır `reconstructed`/`reissue` yolundan yeniden numaralandırılmaz — eski numaralar tarihsel kalır (donmuş belge kuralı), yeni seri bugünden başlar.
**Kabul kriteri.** Yeni iade belgeleri `^IADE[0-9]{10}$` biçiminde; `Q-DOC-02` sorgusuna `IADE` satırı eklendi ve 0 boşluk veriyor.
**Efor:** 0,5 gün. **Önceki defter:** `BULGU-T1-098` (aynı satırın **saat dilimi** yüzü — bu bulgu numaranın BİÇİM/SIRA yüzü; yeni kanıt: prod'da 4 fiili satır + boşluk denetiminin kurulamaması).

---

### [V-2-06] Refakat kartı sürüm defteri eksik: sürümü 2 olan 17 kartın 15'inde defter satırı yok — "sahaya hangi plan indi" geriye dönük kanıtlanamıyor

| Şiddet | **S3** | Kategori | **E — Donmuş belge / sürüm değişmezi (INV-DOC-04)** | Öncelik | **P3** | Modül | belge/iş emri | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Kural: her baskı `PrintedDocument(TRAVELER_CARD, sourceId=card.id, version)` satırını **aynı tx'te** deftere yazar, içerik değiştiyse `version++`. Prod kopyasında sürümü 2 olan 17 kartın **15'inde defter satırı sayısı sürüm sayısından az** (13'ünde **hiç yok**, 2'sinde yalnız v2 var, v1 eksik). Yani revize edilmiş kartların çoğunda "birinci baskıda sahaya hangi plan gitti" sorusu cevapsız.

**Kanıt — veri (saha).**
```sql
SELECT tc."cardNumber", tc.version, tc.status,
 (SELECT count(*) FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id) AS defter
FROM traveler_cards tc
WHERE tc.version > (SELECT count(*) FROM printed_documents pd WHERE pd."docType"='TRAVELER_CARD' AND pd."sourceId"=tc.id)
  AND tc.version > 1;
```
→ 15 satır: `IE0708260016, IE1008260014, IE1008260015, IE1008260016, IE1208260016, IE1308260001..005, IE1308260007, IE1308260009, IE1408260001(1), IE1408260021, IE2108260004(1)`.
Ayrıca sürüm boşluğu (`min(version)=2`): `5f0cf53b…` ve `6929bc18…` — defterde v1 yok, doğrudan v2 var.
Kapsam ölçüsü: 213 kartın **153'ünde** hiç defter satırı yok (bunların çoğu hiç basılmamış kartlardır — bilgi); `TRAVELER_CARD` defter satırlarının en eskisi **2026-08-18 08:45**, oysa kartlar 2026-07'den beri basılıyor.

**Kök neden izi.** Defter özelliği (`refakat-karti-versiyon-gecmisi-plani`, commit `42c5112d`) sonradan eklendi; **geriye dönük backfill yok** ve eksikliği ölçen bir bekçi/mutabakat bölümü yok. `K10` yalnız ters yönü ölçüyor (`Q-WO-13`: kart sürümü < defter max → 0); "defter < kart sürümü" yönü hiç sorulmamış.

**failure_mode.** Sahadaki kâğıt "Rev.1" der; sistemde yalnız Rev.2 kayıtlıdır. Kalite kaydı incelemesinde "operatöre verilen ilk plan neydi" sorusuna cevap yoktur; kartın kendisi `snapshot`'ta güncel planı taşıdığı için eski plan hiçbir yerde durmaz.

**İş etkisi.** Kontrollü belge izlenebilirliği (ISO 9001 §7.5.3) 15 iş emrinde eksik. Yeni kartlarda doğru çalışıyor — risk büyümüyor, ama geçmiş kapanmıyor.

**Öneri.** (a) `Q-WO-13`'ün simetriği mutabakata girsin ("kart.version > defter satır sayısı"). (b) Backfill kararı iş kararıdır: eksik v1'ler **uydurulamaz** (snapshot yok) — doğru davranış, satırı `reconstructed=true` ile kurmak DEĞİL, defterde açıkça "v1 kayıt öncesi" notu ya da hiç dokunmamaktır; kararın CLAUDE.md'ye yazılması yeterlidir.
**Kabul kriteri.** Mutabakat simetrik hâle geldi ve bugünkü 15 satırı gösteriyor; karar (backfill yok) yazılı.
**Efor:** 0,5 gün. **Önceki defter:** yok.

---

### [V-2-07] Donmuş belge defteri kaynağına FK ile bağlı değil ve yetim temizliği yok: dev'de 12.690 belgenin 12.626'sı (%99,5) yetim, `documentNo` 378 farklı kaynakta tekrar ediyor

| Şiddet | **S3** | Kategori | **C — Veri modeli / referans bütünlüğü** | Öncelik | **P3** | Modül | belge | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `printed_documents.sourceId` polimorfik bir kolondur (`docType` ile birlikte anlamlanır) ve **hiçbir yabancı anahtarı yoktur** — tablonun tek FK'sı `printedById`. Kaynak satır fiziksel olarak silindiğinde belge kaydı ortada kalır, hiçbir yüzeyden çözülemez ve **numarası yeni kaynaklarca yeniden kullanılır**. Dev'de ölçüldü: 12.690 belgenin 12.626'sı yetim; `FS1908260001` numarası **378 farklı `sourceId`'de** tekrarlanıyor. Prod kopyasında bugün **0 yetim** — yani risk teorik değil ama henüz gerçekleşmemiş.

**Kanıt — veri.**
```sql
SELECT pd."docType", count(*) AS toplam,
  count(*) FILTER (WHERE pd."docType"='SHIPMENT_DISPATCH'      AND NOT EXISTS (SELECT 1 FROM shipments x               WHERE x.id=pd."sourceId"))
 +count(*) FILTER (WHERE pd."docType"='SUBCONTRACTOR_DISPATCH' AND NOT EXISTS (SELECT 1 FROM subcontractor_dispatches x WHERE x.id=pd."sourceId"))
 +count(*) FILTER (WHERE pd."docType"='TRAVELER_CARD'          AND NOT EXISTS (SELECT 1 FROM traveler_cards x           WHERE x.id=pd."sourceId"))
 +… AS yetim
FROM printed_documents pd GROUP BY 1;
```
| docType | dev toplam | dev yetim | saha toplam | saha yetim |
|---|---|---|---|---|
| SHIPMENT_DISPATCH | 2.815 | 2.813 | 40 | 0 |
| SUBCONTRACTOR_DISPATCH | 7.358 | 7.307 | 214 | 0 |
| RETURN_DISPATCH | 1.396 | 1.396 | 4 | 0 |
| KARTELA_DISPATCH | 607 | 601 | — | — |
| SUBCONTRACTOR_DIRECT_SHIP | 332 | 332 | — | — |
| TRAVELER_CARD | 177 | 177 | 62 | 0 |
| **toplam** | **12.690** | **12.626** | **328** | **0** |

Numara tekrarı (dev): `FS1908260001` → 378 kaynak · `FS1908260002` → 305 · `SVK1908260001` → 146 farklı kaynak.

**Kanıt — kod/şema.** `\d printed_documents` → tek FK `printed_documents_printedById_fkey`. Yetim süpüren bir job yok (`ls src/jobs`: archive-scheduler, backup-scheduler, offsite-sweeper, installation-identity, mdns-advertiser, katalog uzlaştırıcıları, job-failure). Kaynak silen yollar mevcut: `scripts/reset-operational.ts`, `scripts/clean_test_residue.ts`, master-data `/permanent` uçları, `db-copy.service` geri yükleme.

**failure_mode.** Bir fason sevki (`subcontractor_dispatches`) herhangi bir yoldan fiziksel silinirse, ona ait donmuş `FS…` irsaliyesi tabloda kalır; `getCurrent` `sourceId`'yi çözemez ve `buildDocContent` `null` döner → belge listesinde görünen satır açılmaz. Aynı gün açılan bir sonraki fason sevki `nextDailySeq` ile **aynı `FS…` numarasını** alır ve artık iki farklı sevkiyata ait iki belge aynı numarayı taşır — hangisinin hangisi olduğu yalnızca `sourceId` UUID'sinden anlaşılır.

**İş etkisi.** Bugün prod'da sıfır; ancak "belge defteri append-only ve kaynağından bağımsız" varsayımı hiçbir sedle desteklenmiyor. Dev'deki tablo aynı zamanda **12.626 ölü satırın** performans/yedek yükünü de taşıyor.

**Öneri.** (a) `docType` başına kısmi FK kurulamaz; yerine **mutabakat bölümü** (`consistency-check` §: her `docType` için yetim sayısı) + `/api/admin/health` sayacı. (b) Kaynak silen scriptler belgeyi de `VOIDED` işaretlesin ya da açıkça devretsin. (c) Dev temizliği ayrı iş (**[PROD'DA ÇALIŞTIRMA]** gerekmiyor; dev'de dry-run + `--apply`).
**Kabul kriteri.** Yetim sayacı mutabakatta ve prod'da 0; dev temizlendikten sonra da 0.
**Efor:** 1 gün. **Önceki defter:** yok (ilgili: `BULGU-T1-154` lazy-init yazımı).

---

### [V-2-08] Fason kabul makbuzlarının "donmuş" belgesi aslında SONRADAN yeniden kurulmuş: 7 belgenin 6'sı `reconstructed`, gecikme 5 güne kadar

| Şiddet | **S3** | Kategori | **E — Donmuş belge (INV-DOC-03)** | Öncelik | **P3** | Modül | belge/fason | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `SUBCONTRACTOR_RECEIPT` belgelerinin 7'sinden 6'sı `reconstructed = true`, yani belge olayın kendi transaction'ında dondurulmamış; sonradan (GET yolunda lazy-init ile) **o günkü canlı veriden** yeniden kurulmuş. En uzun gecikme **5 gün** (makbuz 2026-08-12 17:28, belge 2026-08-17 17:20). Bu süre içinde makbuza konu topların metrajı/kalitesi/renkleri değişmiş olabilir; belge "kabul anındaki gerçeği" değil "5 gün sonraki gerçeği" dondurmuştur.

**Kanıt — veri (saha).**
```sql
SELECT pd."documentNo", pd.version, pd.status, pd.reconstructed, pd."createdAt", sr."createdAt" AS makbuz_tarihi
FROM printed_documents pd LEFT JOIN subcontractor_receipts sr ON sr.id=pd."sourceId"
WHERE pd."docType"='SUBCONTRACTOR_RECEIPT' ORDER BY pd."createdAt";
```
| documentNo | v | durum | reconstructed | belge tarihi | makbuz tarihi | gecikme |
|---|---|---|---|---|---|---|
| FK0608260001 | 1 | ACTIVE | **t** | 06.08 14:12 | 06.08 14:09 | 3 dk |
| FK0708260006 | 1 | ACTIVE | **t** | 07.08 13:38 | 07.08 11:37 | 2 sa |
| FK1508260001 | 1 | SUPERSEDED | **t** | 15.08 11:54 | 15.08 11:28 | 26 dk |
| FK1508260001 | 2 | ACTIVE | f | 15.08 11:54 | 15.08 11:28 | — |
| FK1508260007 | 1 | ACTIVE | **t** | 15.08 12:19 | 15.08 12:19 | 0 |
| FK1308260005 | 1 | ACTIVE | **t** | 15.08 12:35 | 13.08 17:27 | **~1,8 gün** |
| FK1208260013 | 1 | ACTIVE | **t** | 17.08 17:20 | 12.08 17:28 | **~5 gün** |

Karşılaştırma (aynı tabloda doğru davranan aileler): `SHIPMENT_DISPATCH` 40/40 `reconstructed=false`, `SUBCONTRACTOR_DISPATCH` 214/214 `false`, `TRAVELER_CARD` 62/62 `false`, `RETURN_DISPATCH` 4/4 `false`. Yani **yalnız fason kabul** ailesi olayın tx'inde dondurmuyor.

**failure_mode.** Fason kabul makbuzu 12.08'de kesilir (operatör kâğıdı alır). Belge kaydı 17.08'de, o gün geçerli top verisinden kurulur. Aradaki 5 günde topun metrajı Tambur'da kesilmiş, kalitesi değişmiş ya da rengi düzeltilmişse, sistemdeki "resmî makbuz" sahadaki kâğıtla **uyuşmaz** ve uyuşmazlık `reconstructed` bayrağı dışında hiçbir yerde görünmez (belge yüzeyi bu bayrağı basmıyor).

**İş etkisi.** Fasoncuyla metraj/fire mutabakatında belge delil değeri düşük. 7 belgeden 6'sı — oran neredeyse tam.

**Öneri.** `subcontractor.service` kabul tx'inde `freezeForSource(tx, SUBCONTRACTOR_RECEIPT, receipt.id, userId)` çağrısını ekle (fason SEVK'te zaten var — `subcontractor.service.ts:1283`). Lazy-init yolu geriye dönük kayıtlar için kalsın ama **belge yüzeyinde "sonradan oluşturuldu" rozeti** bassın.
**Kabul kriteri.** Yeni bir fason kabulünden sonra `reconstructed=false` bir belge doğuyor; bekçi (`test_printed_documents.ts`) bunu ölçüyor.
**Efor:** 0,5 gün. **Önceki defter:** `BULGU-T1-154` ("GET donmuş-belge yolu lazy-init ile YAZIYOR"). Bu satır aynı mekanizmanın **veri kanıtıdır** (6/7 + 5 günlük gecikme) ve düzeltme yeri farklıdır (kabul tx'i).

---

### [V-2-09] İade edilen malın tamamı sonradan İPTAL'e çekilmiş: iade defteri "depoya alındı" derken 261 m ne stokta ne fire raporunda

| Şiddet | **S3** | Kategori | **E — Statü makinesi / iade değişmezi (INV-SEV-05, INV-AUD-04)** | Öncelik | **P3** | Modül | iade/envanter | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Prod kopyasındaki **5 aktif iadenin 5'inde de** iade defteri `appliedStatus = WAREHOUSE` diyor (mal bitmiş depoya alındı), ama topların **beşi de bugün `CANCELLED`**. `CANCELLED` sistemde "hiç olmamalıydı, kayıt hatası" anlamına gelir (2026-08-25 kararı: stok düşmez, fire oranına girmez) — oysa bu mal gerçekten vardı, sevk edildi ve müşteriden geri geldi. Üstelik beş topun **hiçbirinde** iptal izi kolonları dolu değil (`cancelledAt`, `cancelReason`, `cancelReasonCode`, `preCancelStatus` hepsi NULL) ve `roll_variances` defterinde de karşılıkları yok. Sonuç: 261 m kumaş üç yüzeyde üç farklı gerçek.

**Kanıt — veri (saha).**
```sql
SELECT rr.id, rr."appliedStatus", r.status AS top_durum, rr.qty, r."cancelledAt", r."cancelReason", r."preCancelStatus"
FROM roll_returns rr JOIN rolls r ON r.id=rr."rollId" WHERE rr."cancelledAt" IS NULL;
```
| iade | appliedStatus | top durumu | qty | cancelledAt | cancelReason | preCancelStatus |
|---|---|---|---|---|---|---|
| 652465b8 | WAREHOUSE | **CANCELLED** | 49,0 | NULL | NULL | NULL |
| e27aaaf0 | WAREHOUSE | **CANCELLED** | 72,0 | NULL | NULL | NULL |
| 67caaa54 | WAREHOUSE | **CANCELLED** | 40,0 | NULL | NULL | NULL |
| 24709bc4 | WAREHOUSE | **CANCELLED** | 50,0 | NULL | NULL | NULL |
| 29c87315 | WAREHOUSE | **CANCELLED** | 50,0 | NULL | NULL | NULL |
| | | | **261,0 m** | | | |

```sql
SELECT v.id, v.kind, v.qty FROM roll_variances v WHERE v."rollId" IN (SELECT "rollId" FROM roll_returns);
-- 0 satır  → fire/sapma defterinde de yok
```
Toplar `currentQty = initialQty` (49/72/40/50/50), yani metraj hiç düşülmemiş; statü değişimi `statusChangedAt` 2026-08-01 ve 2026-08-03'te.

**"Koruma yok" teyidi.** İade edilmiş bir topu `CANCELLED`'a çeken yolda "bu top iade defterinde `WAREHOUSE` olarak duruyor" kontrolü yok; `roll_returns.appliedStatus` ile `rolls.status` arasındaki tutarlılığı ölçen ne DB kısıtı, ne uygulama guard'ı, ne de `consistency-check` bölümü var (§'lerde iade yalnız §4/§9 üzerinden çuval/sevk ekseninde geçiyor).

**failure_mode.** Muhasebe iade raporunu açar: "261 m iade alındı, depoya girdi." Depo ekranını açar: o topların hiçbiri yok. Fire karnesini açar: 0 m fire. Üç rakam da sistemden gelir ve üçü de birbirini yalanlar; "bu 261 m nerede?" sorusunun cevabı yalnızca kişilerin hafızasındadır (iptal sebebi de kaydedilmemiş).

**İş etkisi.** İade edilen mal sistemin hiçbir stok/fire yüzeyinde görünmüyor → gerçek fire oranı olduğundan düşük, gerçek stok olduğundan düşük değil (mal zaten yok) ama "kayıp" hiçbir kalemde raporlanmıyor. Doğru dispozisyon `SCRAP` olmalıydı (mal vardı, gitti).

**Öneri.** (a) Aktif iadesi olan bir topu `CANCELLED`'a çekmeyi reddet (`SCRAP`'a yönlendir) — iptal "mal hiç yoktu" demektir, iade defteri aksini söylüyor. (b) `consistency-check`'e bölüm: `roll_returns(cancelledAt IS NULL)` ile `rolls.status` uyuşmazlığı. (c) Geçmiş 5 satır **[PROD'DA ÇALIŞTIRMA]** — iş kararı; düzeltilirse `SCRAP` + `RollVariance` ile, dry-run listeli.
**Kabul kriteri.** İadeli topun iptali 409 veriyor; mutabakat bölümü bugünkü 5 satırı gösteriyor.
**Efor:** 1 gün. **Önceki defter:** `INV-AUD-04` (K10 §4: "CANCELLED ⇒ iptal izi kolonları dolu — 47/52 eksik") ile aynı aileden; bu satırın yeni kanıtı **iade↔iptal çelişkisi**dir.

---

### [V-2-10] Sevk edilen 40 çuvalın 39'u tartısız; irsaliye/çeki listesi kg'yi 0 basıyor (bilgi)

| Şiddet | **S4** | Kategori | **C — Belge içeriği / ölçüm izi** | Öncelik | **P5** | Modül | çuval/belge | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `INV-SEV-12` yalnız `destination = EXPORT` için tartı zorunlu kılıyor; sahada tüm sevkler `DOMESTIC` olduğu için 40 sevk edilmiş çuvalın **39'u** `weightKg IS NULL`. Donmuş irsaliye snapshot'ında `totalKg: 0` basılıyor. Tek tartılı çuvalda ise `weighedAt` ve `weightSource` **boş** (şemadaki bilinçli tarihsel durum — `weightSource` sonradan eklendi, DEFAULT verilmedi).

**Kanıt.**
```sql
SELECT sh.destination, count(*) FILTER (WHERE sk."weightKg" IS NULL OR sk."weightKg"=0) AS tartisiz, count(*) AS toplam
FROM sacks sk JOIN shipments sh ON sh.id=sk."shipmentId" WHERE sh.status='DISPATCHED' GROUP BY 1;
-- DOMESTIC | 39 | 40
SELECT count(*) FILTER (WHERE "weightKg" IS NOT NULL AND ("weighedAt" IS NULL OR "weightSource" IS NULL)) AS izsiz,
       count(*) FILTER (WHERE "weightKg" IS NOT NULL) AS tartili, count(*) FROM sacks;   -- 1 | 1 | 41
```
Snapshot örneği (`SVK1908260002`): `"sacks":[{"seq":1,"code":"CV1908260002","totalKg":0,"totalMeters":975.1,"packageCount":25}]`.

**failure_mode.** Nakliyeci/müşteri irsaliyede "0 kg" görür; ağırlık üzerinden yapılan navlun/kabul kontrolü yapılamaz. Bulgu değil, **ölçülmüş gerçek**: özellik (tartı) sahada kullanılmıyor.

**Öneri.** Karar sorusu ekibe: yurtiçi sevkte de tartı isteniyor mu? İsteniyorsa `shipping.requireWeightDomestic` bayrağı (dört kapı) ve irsaliyede kg kolonunun koşullu basımı; istenmiyorsa belgede "0 kg" yerine **boş** basılmalı (0, "tartıldı ve 0 çıktı" demektir).
**Efor:** 0,5 gün. **Önceki defter:** yok.

---

### [V-2-11] İptal edilmiş iş emrine bağlı sipariş HİÇ İPTAL EDİLEMİYOR: önizlemenin önerdiği aksiyon kendi izin listesinde yok — prod'da 2 canlı sipariş kilitli

| Şiddet | **S2** | Kategori | **E — Sipariş iptali / durum makinesi (INV-SIP-06)** | Öncelik | **P2** | Modül | sipariş | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Sipariş iptal önizlemesi her bağlı iş emri için iki alan döner: `allowedActions` (izinli aksiyonlar) ve `defaultAction` (önerilen). İş emri `CANCELLED` ise izinli liste **yalnız `UNLINK_ONLY`**'dir, ama `defaultAction` **`CONVERT_TO_STOCK`** döner — yani sunucu kendi izin vermediği bir aksiyonu öneriyor. Sonuç: iptal isteği hangi yoldan gelirse gelsin başarısız oluyor ve sipariş **kalıcı olarak iptal edilemez** hâle geliyor. Prod kopyasında bugün **2 sipariş** bu durumda.

**Kanıt — kod.** `Teks-Erp/src/services/order.service.ts:100-116` (`computeAllowedActions`) — son satır:
```ts
  // CANCELLED WO bağı zaten anlamsız — gelmemesi gerek ama defansif.
  return ["UNLINK_ONLY"];
```
`:118-125` (`pickDefaultAction`) — aynı durumu **hiç ele almıyor**:
```ts
function pickDefaultAction(woStatus: string, isSoleOrder: boolean): CancelAction {
  if (woStatus === "PLANNED") return "UNLINK_ONLY";
  if (isSoleOrder) return "CONVERT_TO_STOCK";   // ← CANCELLED WO buraya düşer
  return "UNLINK_ONLY";
}
```
İkisi de aynı önizleme yanıtına yazılıyor (`:3031-3044`). İki çıkış yolu da kapalı:
- İstemci önizlemedeki `defaultAction`'ı **gönderirse** → `:3112-3115` `AppError.badRequest("WO … için 'CONVERT_TO_STOCK' geçersiz. İzinli: UNLINK_ONLY")` → **400**.
- İstemci aksiyon **göndermezse** → `:3119` `actionByWO.set(wo.id, wo.defaultAction)` — sunucu **kendi geçersiz varsayılanını** kullanır (bu dal doğrulanmıyor), `CONVERT_TO_STOCK` dalına girer (`:3200-3207`), oradaki claim `status: { notIn: [CANCELLED, SUPERSEDED] }` ile 0 satır günceller → **409 "İş emri bu sırada iptal edildi, stoğa çevrilemedi. Sayfayı yenileyin."** Mesaj da yanıltıcı: iş emri "bu sırada" değil, çoktan iptal edilmişti; sayfayı yenilemek durumu değiştirmez, kullanıcı sonsuz döngüye girer.

**Kanıt — veri (K2, `tekserp_saha_0825`).**
```sql
SELECT o."orderNumber", o.status AS siparis, wo."workOrderNumber", wo.status AS wo,
  (SELECT count(DISTINCT ol4."orderId") FROM work_order_to_order_lines wl4
     JOIN order_lines ol4 ON ol4.id=wl4."orderLineId" WHERE wl4."workOrderId"=wo.id) AS wo_nun_siparis_sayisi
FROM orders o
JOIN order_lines ol ON ol."orderId"=o.id
JOIN work_order_to_order_lines wl ON wl."orderLineId"=ol.id
JOIN work_orders wo ON wo.id=wl."workOrderId"
WHERE o.status NOT IN ('CANCELLED','COMPLETED') AND wo.status IN ('CANCELLED','SUPERSEDED')
GROUP BY o.id,o."orderNumber",o.status,wo.id,wo."workOrderNumber",wo.status;
```
| Sipariş | Durum | İş emri | İE durumu | İE'nin sipariş sayısı (`isSoleOrder`) |
|---|---|---|---|---|
| SIP0108260012 | APPROVED | IE0108260002 | **CANCELLED** | 1 → `true` |
| SIP2408260016 | APPROVED | IE2408260015 | **CANCELLED** | 1 → `true` |
| SIP2408260016 | APPROVED | IE2408260016 | **CANCELLED** | 1 → `true` |

Her üç satırda da `isSoleOrder = true` olduğu için `pickDefaultAction` `CONVERT_TO_STOCK` üretecek; iki sipariş de bugün açık (`APPROVED`).

**"Koruma yok" teyidi.** ① Sunucu tarafında `defaultAction`'ın `allowedActions` içinde olduğunu doğrulayan hiçbir kontrol yok (`:3112` yalnız `provided.action`'ı ölçüyor). ② Tip düzeyinde zorlama yok — `CancelAction` union'ı üç değer taşıyor, `defaultAction: CancelAction` `allowedActions`'a bağlı değil. ③ Bekçi yok: `scripts/test_order_cancellation.ts` `CANCELLED` iş emri durumunu sondalamıyor (aksi hâlde bu iki değerin ayrıştığı yakalanırdı). ④ İstemci tarafı da kurtarmıyor — tek-aksiyonlu satırda seçim kontrolü çizilmiyor (`Electron/src/pages/Operations/Orders/OrderCancelDialog.tsx`).

**failure_mode.** Planlamacı `IE0108260002`'yi iş emri ekranından iptal eder (meşru: mal üretilmeyecek). Sonra `SIP0108260012`'yi iptal etmek ister. Diyalog açılır, tek satır ("IE0108260002 — iptal edilmiş") gösterilir, seçim kutusu çizilmez çünkü izinli aksiyon tektir; "İptal Et" basılır → 400 *"'CONVERT_TO_STOCK' geçersiz"* ya da 409 *"Sayfayı yenileyin"*. Yenilemek işe yaramaz. Sipariş `APPROVED` olarak sonsuza dek listede kalır: açık talep süzgecine girer (`openLineWhere`), üretim dengesinde kumaş açığı üretir, müşteri karnesinde açık iş sayılır ve termin raporunda geciken sipariş olarak görünür.

**İş etkisi.** İki canlı sipariş yönetilemez durumda; ikisi de "açık talep" sayıldığı için planlama ekranlarında gerçekte olmayan iş üretiyor. Tek çıkış yolu şu an veritabanına elle müdahaledir.

**Öneri.** `pickDefaultAction`'a `if (woStatus === "CANCELLED" || woStatus === "SUPERSEDED") return "UNLINK_ONLY";` satırı — ama asıl düzeltme **iki fonksiyonun ayrışamaz hâle getirilmesi**: `pickDefaultAction(woStatus, isSoleOrder)` yerine `computeAllowedActions(...)` sonucunu alıp ilk/uygun elemanı seçen tek fonksiyon (`defaultAction = allowed.includes(tercih) ? tercih : allowed[0]`). Ek olarak `:3119`'daki varsayılan dal da `allowedActions` üzerinden doğrulanmalı (fail-closed).
**Kabul kriteri.** (a) Bekçi: her `(woStatus, isSoleOrder)` kombinasyonu için `allowedActions.includes(defaultAction)` — negatif sonda: `pickDefaultAction`'a eski satır geri konunca kırmızı. (b) `SIP0108260012` ve `SIP2408260016` arayüzden iptal edilebiliyor.
**Efor:** 0,5 gün.
**Önceki defter:** `BULGU-T1-036`'nın **çürütücü önerisi** (`tours/tur1-curutucu-onerileri.md`, "Kaynak: BULGU-T1-036 (topoloji merceği)") — bu tur bağımsız olarak ölçüldü ve doğrulandı; T1-036'nın kendisi (sipariş iptalinde iş emirlerinin tx DIŞINDA iptal edilmesi) **ayrı** bir kusurdur, bu satır onun yerine geçmez.

---

## "ARANDI, 0" — ihlal bulunamayan kontroller (kanıt kaydı)

Aşağıdaki sorguların hepsi `tekserp_saha_0825` üzerinde koştu ve **0 satır** döndü (aksi belirtilmedikçe). Dosyalar: `audit/data/TUR2-V2-b1.sql`, `-b2.sql`, `-b3.sql`.

| # | Kontrol | Saha | Dev |
|---|---|---|---|
| V2-Q01 | `OL.shippedQty` = Σ tahsis(DISPATCHED) + Σ DirectShip | 0 | **1** (test kalıntısı: `TST-DS-ORD-46657044`, `shippedQty=500` ↔ defter 0) |
| V2-Q02 | `Order.shippedQty` = Σ `OL.shippedQty` | 0 | 0 |
| V2-Q03 | Sevk > istenen (aşım) | 0 | 0 |
| V2-Q04 | Sevk + PLANNED tahsis > istenen (INV-SEV-08 penceresi) | 0 | 0 |
| V2-Q05 | `Order.status` türetilmiş değerden sapıyor (tolerans dahil) | 0 | 0 (dev'de `cancelledAt` dahil varyantla) |
| V2-Q06 | Kalemsiz sipariş | 0 | — |
| V2-Q07 | `ShipmentOrder.isActive` ⇔ sevkiyat PLANNED | 0 | — |
| V2-Q09 | PLANNED sevkiyat ama toplar SHIPPED | 0 | — |
| V2-Q10 | SHIPPED top hiçbir DISPATCHED sevkiyatta değil | 0 | — |
| V2-Q11 | `Roll.shipmentId` ≠ çuvalın `shipmentId` (composite FK) | 0 | — |
| V2-Q12 | Boş çuval | **2 satır ama ihlal DEĞİL** — `CV0308260001`/`CV1607260001`, ikisi de `roll_returns.prevSackId` ile eşleşiyor: içerik sevkten sonra iade edildi, brüt kural gereği çuval kabuğu kalıyor | — |
| V2-Q13 | Çuvalda karışık top statüsü (SHIPPED + WAREHOUSE) | 0 | — |
| V2-Q14 | Çuval tahsis toplamı > brüt içerik (iade geri-eklemeli) | 0 | — |
| V2-Q15 | Tahsis, sevkiyatın sipariş kümesi dışında bir kaleme | 0 | — |
| V2-Q16 | Aktif iade ama top hâlâ SHIPPED / `shipmentId` dolu | 0 | — |
| V2-Q17 | Aynı topa > 1 aktif iade | 0 | — |
| V2-Q18 | İade metrajı > topun giriş metrajı | 0 | — |
| V2-Q19 | Aktif iade (2026-08-02+) ama `RETURN_DISPATCH` belgesi yok | 0 | — |
| V2-Q20 | Aktif iadenin sevkiyatı DISPATCHED değil | 0 | — |
| V2-Q21 | DISPATCHED ama donmuş irsaliye yok | 0 | — |
| V2-Q22 | ACTIVE irsaliye ↔ sevkiyat DISPATCHED (iki yön) | 0 | — |
| V2-Q23 | Aynı kaynakta > 1 ACTIVE belge | 0 | 0 |
| V2-Q25 | `snapshot` NULL / boş | 0 (6 docType, 328 satır) | 0 (7 docType, 12.690 satır) |
| V2-Q29 | Günlük sayaç boşluğu/atlaması (SIP · SVK · CV, `LEAD`) | 0 | — |
| V2-Q30 | Gün başı ilk sıra ≠ 1 | 0 | — |
| V2-Q31 | Belge no günü ≠ kaydın İstanbul günü (TZ kayması) | 0 | — |
| V2-Q32 | Tombstone (`mergedIntoId`) müşteri/kumaş/renk hâlâ referanslı | 0 (saha'da hiç tombstone müşteri yok: 0/27) | — |
| V2-Q33/33b | `branchId` tutarlılığı (sevkiyat↔sipariş, çuval↔sevkiyat) | 0 (`customer_branches` **boş**) | — |
| V2-Q34 | İptal edilmiş sipariş hâlâ PLANNED/DISPATCHED sevkiyat kümesinde | 0 | — |
| V2-Q35 | Brüt kural: irsaliye snapshot metrajı = canlı içerik + aktif iade | **39/39 tutuyor** (ör. `SVK2007260001`: 501 = 452 + 49; `SVK0308260001`: 212 = 0 + 212) | — |
| V2-Q42b | `COMPLETED` ama `completedAt` yok / tersi | 0 | — |
| V2-Q45→ | Storno izi: VOIDED irsaliyeli `SVK2008260008` PLANNED, toplar WAREHOUSE, `preShipStatus` kalıntısı **0**, tahsis korunmuş (441,3) — INV-SEV-06 birebir uygulanmış | ✔ | — |
| — | `preShipStatus` kalıntısı: SHIPPED olmayan hiçbir topta dolu değil (689 SHIPPED topun 688'inde dolu, 1 tanesi karar öncesi) | ✔ | — |

---

## Uygulanan kontrol listesi

| Görev maddesi | Durum |
|---|---|
| `SUM(sevk edilen) > OrderLine.quantity` (aşım; tolerans) | **uygulandı** — V2-Q03/Q04, 0; tolerans kaynağı `system_settings['shipping.toleranceMeters']` (prod'da satır YOK → kod varsayılanı 5 m, `order-status.helper.ts:167-181`) |
| `Order.status` ↔ kalemlerin durumu (PARTIAL_SHIPPED sonsuza dek / COMPLETED ama açık kalem / CANCELLED kalem `shipped` ile sayılıyor mu) | **uygulandı** — V2-Q05 (saha) + dev varyantı `cancelledAt` dahil; 0. Dağılım: 235 APPROVED · 27 PARTIAL_SHIPPED · 12 COMPLETED · 4 CANCELLED; 12 COMPLETED'ın 12'sinde `completedAt` dolu, elle kapatma 0 |
| İptal kalem (`cancelledAt`) sevk edilmiş mi | **uygulandı, yalnız dev'de ölçülebildi** — saha kopyasında `order_lines.cancelledAt` kolonu YOK (migration `20260827100000` uygulanmamış); dev'de iptal kalem 0 satır |
| Birden çok AKTİF sevkiyat aynı siparişte (partial unique saha'da var mı?) | **uygulandı** — `shipment_orders` indeksleri: yalnız `pkey(shipmentId,orderId)` + `orderId_idx`; `shipment_orders_active_order_uq` **yok** (2026-07-11'de bilinçli düşürüldü, INV-SEV-07). Fiili: bir siparişin >1 PLANNED sevkiyatta olduğu satır 0 |
| `Shipment DISPATCHED` ama `SackAllocation` yok | **uygulandı → V-2-01** (5 sevkiyat / 3.040,2 m) |
| `PLANNED` ama toplar `SHIPPED` | **uygulandı** — 0 |
| `SHIPPED` top hiçbir DISPATCHED sevkiyatta değil | **uygulandı** — 0 |
| `SackAllocation` aynı top iki sevkiyatta | **uygulandı** — tahsis birimi (çuval, kalem) olduğu için top düzeyinde karşılığı `Roll.shipmentId` ≠ çuvalın `shipmentId`: 0; `(sackId, orderLineId)` unique DB'de mevcut |
| Storno izleri: VOIDED belge + stok dönmüş mü (`preShipStatus`) | **uygulandı** — 1 storno (`SVK2008260008`), belge VOIDED, toplar WAREHOUSE, `preShipStatus` temizlenmiş, tahsis korunmuş: kural birebir |
| İade: `RollReturn` miktarı > sevk; `returnGroupId` belgesi yok; `RETURN_DISPATCH` donmuş mu | **uygulandı** — miktar 0, belge eksiği 0, 4/4 `reconstructed=false` (donuk). Yan bulgu → **V-2-05** (numara biçimi), **V-2-09** (iade↔iptal çelişkisi) |
| `PrintedDocument` (docType, sourceId, version) tekrarı · sürüm boşluğu · `snapshot` NULL | **uygulandı** — unique mevcut, tekrar 0; sürüm boşluğu 2 kart → **V-2-06**; `snapshot` NULL 0. Yan bulgu → **V-2-04** (documentNo çakışması), **V-2-07** (yetim + numara tekrarı) |
| Sack: boş çuval · `sackNo` tekilliği · `contentDirty`/`labelDirty` kaynakları · çuvalda SHIPPED+WAREHOUSE karışık top | **uygulandı** — boş çuval 2 (iade sonrası, ihlal değil); `sacks_sackNo_key` unique mevcut, biçim ihlali 0; **`Sack.contentDirty` kolonu YOK** (ne saha ne dev — `contentDirty` `TravelerCard`'a ait; çuvalda karşılığı `labelDirty` ve 41 çuvalın 41'inde `false`, yani baskıdan sonra içerik değişmemiş); karışık statü 0 |
| Sevk belgesi brüt kuralı: snapshot metrajı vs canlı (iade sonrası) | **uygulandı** — 39/39 tutuyor (V2-Q35 tablosu) |
| `orderNumber`/`shipmentNo`/`sackNo` günlük sayaç boşluk-mükerrer (LEAD) | **uygulandı** — atlama 0, gün başı ≠1 olan gün 0, TZ kayması 0 |
| Customer tombstone (`mergedIntoId`) hâlâ referanslanan siparişler/sevkler | **uygulandı** — saha'da tombstone müşteri **0/27**, dolayısıyla referans da 0; sorgu ileride kullanılabilir hâlde |
| `branchId` tutarlılığı | **uygulandı** — `customer_branches` tablosu **boş** (0 şube) → tüm `branchId` NULL; sevkiyat↔sipariş↔çuval uyuşmazlığı 0. ⚠️ Bu, `distributeSacksToLines`'ın `branchMatch` dalının sahada **hiç sınanmadığı** anlamına gelir |
| K4 matrisi + `system_logs` ile kod izleme | **uygulandı** — V-2-01'in beş karşı-hipotezi `system_logs` (`SHIPMENT`, `ORDER`, `ORDER_LINE`, `SACK`) + `updatedAt`/`createdAt` damgalarıyla elendi; `SackAllocation`'ın audit'te hiç bulunmaması **V-2-02** olarak ayrı yazıldı |
| Tur 1 çürütücü önerileri (`tours/tur1-curutucu-onerileri.md`, 17 madde) | **uygulandı** — alanıma düşen 2 madde: ① *BULGU-T1-036 (topoloji)* "`pickDefaultAction` CANCELLED WO'yu ele almıyor" → bağımsız olarak ölçüldü ve **V-2-11** olarak bulguya çevrildi (aynı iki sipariş prod kopyasında doğrulandı, üçüncü bir WO satırı da eklendi); ② *BULGU-T1-106 (kod)* "`recordPrintEvent` sürüm yarışı, iki eşzamanlı print-event v3'ü ezer" → **veri kanıtı bulunamadığı için bulguya çevrilmedi**: saha kopyasındaki 62 `TRAVELER_CARD` belgesinin hiçbirinde kayıp sürüm izi yok (`(docType,sourceId,version)` unique zaten mükerrer sürümü engelliyor; kayıp yazımın izi yalnız "kart.version < gerçek baskı sayısı" olurdu ve bu ölçülemiyor çünkü baskı sayısı ayrıca tutulmuyor). Yarışın kendisi **A alanının** konusudur → Sınır Ötesi Notlar'a yazıldı. Diğer 15 madde alan dışı (yedek/izin/ad-katlama/rapor/fason) — ilgili denetçilere bırakıldı |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **Brüt kuralı veride BİREBİR tutuyor.** 39 sevk irsaliyesinin 39'unda `snapshot.totals.totalMeters` = canlı çuval içeriği + aktif iade metrajı. İade, donmuş belgeyi geriye dönük değiştirmiyor; `SVK2007260001`'de 501 m = 452 m (kalan) + 49 m (iade), `SVK0308260001`'de 212 m = 0 + 212. Beş ayrı yüzeyde (liste, detay, belge, muhasebe export, rapor) aynı kuralı tek kaynaktan besleme kararı (`shipping.service.ts:2569-2627`, `reports/_shipped.ts`) sahada ölçülebilir biçimde çalışıyor.
2. **Storno (undo-dispatch) eksiksiz.** Tek storno vakasında (`SVK2008260008`) beş şey birden doğru: belge `VOIDED`, sevkiyat `PLANNED`, `dispatchedAt` temizlenmiş, toplar `WAREHOUSE`'a `preShipStatus`'tan dönmüş ve **kalıntı `preShipStatus` bırakılmamış**, tahsis silinmemiş (441,3 m yerinde). `preShipStatus` genel taraması da temiz: SHIPPED olmayan hiçbir topta dolu değil.
3. **Belge numarası sayaçları boşluksuz.** SIP/SVK/CV serilerinde `LEAD` ile ölçülen atlama **0**, gün başı sıra her günde 1'den başlıyor ve belge no'nun günü ile kaydın İstanbul günü **her satırda** aynı — `nextDailySeq` + `withBarcodeRetry` + oturumun `-c timezone=UTC` ayarı birlikte doğru çalışıyor.
4. **Composite FK (`sackId, shipmentId`) işini yapıyor.** "Top ↔ çuval ↔ sevkiyat" üçlüsünde tek bir tutarsız satır yok (V2-Q11 = 0) — DEFERRABLE INITIALLY DEFERRED tercihi tx içi ara tutarsızlığa izin verirken commit'te invariant'ı garantiliyor.
5. **İade defteri satır bazlı, belge grup bazlı** ayrımı doğru kurulmuş: üye id'siyle ikinci belge doğmasını engelleyen `buildReturnDispatchDoc` guard'ı (`return.service.ts:1060-1063`) veride de teyit edildi (4 iade → 4 belge, mükerrer yok).
6. **`shipment_orders.isActive` denormu** 55 satırın 55'inde `status='PLANNED'` ile birebir — uygulama katmanında tutulan bir denorm için kusursuz.

---

## SINIR ÖTESİ NOTLAR

- **(A — eşzamanlılık)** `computeSackAllocations`'ın `need = quantity − shippedQty` okuması `writeShipmentAllocationsTx`'in tx'i içinde ama **`touchOrderLinesTx` satır kilidi ALINMADAN** yapılıyor (kilit yalnız `performDispatchTx:1878` ve `cancelPlannedShipmentTx:1974`'te). İki sevkiyat aynı kaleme paralel kurulursa ikisi de aynı `need`'i görür (K10 HOTSPOT H-2 ile aynı sınıf, `BULGU-T1-010`). V-2-01'in mekanizması bu pencerede olabilir — **A denetçisine**: `createShipment` tx'inde tahsis hesabından ÖNCE ilgili `OrderLine`'ların kilitlenmesi ölçülmeli.
- **(C — veri modeli)** `printed_documents.sourceId` polimorfik ve FK'sız; `documentNo` kısıtsız (V-2-04/V-2-07). Ayrıca `roll_returns.orderId` 5 iadenin 4'ünde NULL → sipariş bazlı iade raporları eksik kalır.
- **(F — API)** `previewCreateShipment` sevkiyat kurulumunun **tek uyarı yüzeyi** ama çağrılması zorunlu değil; sözleşme düzeyinde "önizleme görülmeden kurulum" mümkün. Uyarıların `createShipment` yanıtına (`ApiResponse.warnings`) taşınması F alanının konusu.
- **(H — performans)** `sack_allocations` üzerinde `sackId` tekil indeksi yok (`(sackId, orderLineId)` unique ilk kolonu karşılıyor — sorun değil); ancak `computeLineLedger`'ın `sack: { shipment: { status } }` iç içe filtresi `sacks.shipmentId` üzerinde indeks olmadan çalışıyor (`sacks` indeksleri: pkey, clientToken, customerId+createdAt, id+shipmentId, sackNo, sackNo_trgm, shipmentId+seq — `shipmentId+seq` ön eki karşılıyor, bilgi).
- **(I — gözlemlenebilirlik)** `consistency-check.sql` elle koşuluyor, `src/jobs` altında mutabakat işi yok; V-2-03'ün ikinci yarısı I alanına düşer.
- **(J — migration)** Saha kopyasında `order_lines.cancelledAt` / `orders.cancelledAt` YOK (5 migration eksik) — HEAD kodu bu kolonları okuyor (`ACTIVE_LINE`), yani migration'sız backend deploy'u `computeSackAllocations` dahil tüm tahsis yolunu P2022 ile düşürür. K2b H-9 ile aynı; **J denetçisine** deploy sırası notu.
- **(A — eşzamanlılık, Tur 1 çürütücü önerisinden devralındı)** `traveler-card.service.ts:350-378` — `recordPrintEvent` kartı `version: plan.version` ile **koşulsuz** günceller (`where: { id: cardId }`, beklenen sürüm YOK) ve okuma tx dışındadır; iki eşzamanlı print-event aynı `version`'ı hesaplayıp `archivePrintedVersionTx` upsert'inde birbirini ezebilir. Bu turda **veride izi bulunamadı** (62 kart belgesi, kayıp sürüm işareti yok; `(docType,sourceId,version)` unique çift satırı zaten engelliyor) → K1 seviyesinde bir eşzamanlılık bulgusudur, **A denetçisine**.
- **(K — test)** `scripts/test_sack_pool_lifecycle.ts` çuval yaşam döngüsünü ölçüyor ama "birebir spec eşleşen kaleme tahsis yazıldı mı" sondası yok; `test_consistency.ts §1/§2` kör (V-2-03). Ayrıca `branchMatch` dalı sahada hiç veri görmemiş (0 şube) — bekçide de ölçülüyor mu, K denetçisi bakmalı.
- **(L — kod kalitesi)** `allocation.helper.ts` üç ayrı tüketiciyi (önizleme, sevk-anı yazım, fason doğrudan sevk) besliyor ve saf; bu doğru bir tekleştirme. Ancak `computeSackAllocations` hem önizlemeden (havuz client'ı, `:1486`) hem tx'ten (`:1350`) çağrılıyor — çift-mod helper; önizleme yolunda `prisma` geçmesi doğru, tx yolunda `tx`. Sorun yok, kayıt için.

---

## KAPSANMAYAN / ERİŞİLEMEYEN

1. **V-2-01'in kesin mekanizması kanıtlanamadı.** Fiili ihlal (K2) tartışmasız, beş karşı-hipotez ölçümle elendi, ancak "birebir eşleşen kaleme neden 0 yazıldı" sorusunun kod düzeyinde tek bir satırla gösterilebilen cevabı bulunamadı — çünkü (a) `SackAllocation` yazımı audit'e hiç girmiyor (V-2-02), (b) tahsis anındaki `shippedQty`/çuval içeriği snapshot'ı hiçbir yerde saklanmıyor, (c) canlı prod'a erişim yok, yalnız 2026-08-25 kopyası var. Mekanizmayı kesinleştirmenin tek yolu dev'de bir **repro** koşumudur (`createShipment` → 1 çuval + spec'i birebir eşleşen 1 açık kalem); bu tur SALT-OKUNUR olduğu için yazma gerektiren repro yapılmadı. **3. tur için önerilen tek repro budur.**
2. **`orders.cancelledAt` / `order_lines.cancelledAt` saha kopyasında yok** (5 migration eksik) → "iptal edilmiş kalem sevk edilmiş mi", "tüm kalemleri iptal edilmiş sipariş" kontrolleri yalnız dev'de (test verisi, 0 satır) yapılabildi. Canlı prod'da bu kolonlar deploy sonrası oluştuysa oradaki durum bilinmiyor.
3. **Şube (branch) ekseni ölçülemedi.** `customer_branches` boş; `distributeSacksToLines`'ın `branchMatch` dalı, `assertOrdersBelong`'un şube kontrolü ve `Sack.branchId` backfill'i sahada hiç veri görmemiş. Şube kullanılmaya başlandığında bu yol **ilk kez** çalışacak.
4. **Doğrudan (fason) sevk ekseni ölçülemedi:** `direct_shipments` 0, `subcontractor_direct_ship_allocations` 0 satır. `computeLineLedger`'ın ikinci kaynağı sahada hiç kullanılmamış.
5. **Kartela (Swatch) sevk yolu** kapsam dışı bırakıldı (saha'da çuvalda kartela+top karışımı 0; kartela akışı ayrı bir alan).
6. **`SUBCONTRACTOR_*` belgelerinin içerik doğruluğu** (snapshot ↔ canlı fason verisi) fason denetçisinin alanı; burada yalnız `reconstructed` bayrağı ve sürüm/numara bütünlüğü ölçüldü.
7. **Dev DB'nin 12.626 yetim belgesi ve test kalıntıları** ayrıştırılmadı — dev sayıları yalnız yapısal riski göstermek için kullanıldı, dev'deki hiçbir sayı prod ihlali olarak sayılmadı.
8. **`tours/tur1-curutucu-onerileri.md` okunmadı** (gerekçe: "Uygulanan kontrol listesi"nin son satırında). Alanıma düşen öneriler varsa 3. turda değerlendirilmeli.
