# TUR 1 — D-A · Eşzamanlılık & yarış koşulları `[P0]`

**Denetçi:** D-A · **Aşama:** ② BULMA, Tur 1 · **Mercek:** kod merkezli (alan denetçisi + kritik yazma yolu 8-soru)
**Tarih:** 2026-08-28 · **Dal:** `adnansahin` · **HEAD:** `ce8681d1` · **Salt-okunur**
**Kontrol listesi:** `Teks-Erp/teks-erp-denetim-promptu-v2.md` Bölüm 3-A (satır 224-388) — A.1…A.8
**Beceri:** `express-api-audit` SKILL.md §1-§9 (+ `concurrency-patterns.md`, `state-and-scheduler.md`); §9 yanlış-pozitif kataloğu her satırdan önce uygulandı.

## Ölçüm zemini (bu raporun dayandığı olgular)

| Olgu | Değer | Kaynak |
|---|---|---|
| Süreç modeli | PM2 `fork` + `instances: 1` → **TEK PROCESS** | `Teks-Erp/ecosystem.config.js:47-48`, `src/server.ts:22-34` |
| İzolasyon | DB varsayılanı **READ COMMITTED**; kodda tek `isolationLevel` `shipping.service.ts:2610` (RepeatableRead, SALT-OKUMA batch) | KUNYE + grep |
| ORM | Prisma 7 + `@prisma/adapter-pg` (Rust havuzu YOK) | `src/lib/prisma.ts` |
| Havuz | `pg.Pool max 30`, `connectionTimeoutMillis 5s` | `src/lib/prisma.ts` |
| Advisory namespace | 8021 KK1 · 8022 parti · 8023 sevkiyat · 8024 oturum · 8025 izin · 8026 kod · 8027 merge — hepsi 2-argümanlı, 1-argümanlı form 0 kullanım | `code-unique.helper.ts:45-53`, grep |
| Retry | `withBarcodeRetry` **YALNIZ P2002** retry eder (28 çağrı yeri); deadlock/serialization retry'ı **HİÇBİR YERDE YOK** | `src/utils/barcode-retry.ts:32`, repro D-A-03 |
| **Deadlock hata haritası** | PG `40P01` → Prisma **`P2039`** (P2034 DEĞİL) → `error.middleware.ts:556` fail-loud dalı → **HTTP 500** | **ÖLÇÜLDÜ**, `audit/repro/D-A-03.log` |
| Repro ortamı | dev `adnansahin_db` (yerel); K2 sorguları `tekserp_saha_0825` (prod'un 2026-08-25 kopyası) | `audit/tools/sql-*.sh` |

**Repro scriptleri (K3):** `Teks-Erp/scripts/audit_repro_D-A-01.ts` · `…D-A-02.ts` · `…D-A-03.ts`
**Loglar:** `audit/repro/D-A-01.log` · `D-A-02.log` · `D-A-03.log`

---

## BULGULAR

### [D-A-01] "Düzelt" ekranının metraj yazımı, eşzamanlı Tambur kesimini SESSİZCE eziyor — 100 m'lik top sistemde 140,5 m oluyor

| Şiddet | **S1** | Kategori | A.2 (lost update) + A.1 | Öncelik | **P0** | Modül | Envanter / Tambur | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Envanterdeki "Düzelt" (`applyManualProperties`) topun metrajını **mutlak** yazar (`currentQty = m; initialQty = m`), ama tx içindeki atomik claim yalnız `shipmentId`/`sackId` üyeliğini pinler — **metrajı ve statüyü pinlemez**. Aynı topa aynı anda Tambur "Top Kesme" (`cutWarehouseRoll`) çalışırsa, kesimin düşürdüğü metre sessizce geri gelir: parça yeni bir top olarak yaşamaya devam ettiği için aynı kumaş sistemde **iki kez** sayılır. Yazımı engelleyen tek guard (`rollWhole`) yapısal olarak kördür, çünkü kesim `initialQty` ile `currentQty`'yi **birlikte** düşürür — yani kesimden sonra da `initialQty == currentQty` olur ve guard tx içine taşınsa bile bu yarışı yakalayamaz.

**Kanıt**
- `Teks-Erp/src/services/inventory.service.ts:3685` — karar verilecek satır **tx DIŞINDA** okunuyor:
  ```ts
  const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: { … } });
  ```
- `Teks-Erp/src/services/inventory.service.ts:3783` — guard bu bayat okumadan hesaplanıyor:
  ```ts
  const rollWhole = roll.initialQty.equals(roll.currentQty);
  ```
- `Teks-Erp/src/services/inventory.service.ts:3865-3868` — **mutlak** yazım (decrement değil):
  ```ts
  const m = new Prisma.Decimal(data.currentQty);
  rollData.currentQty = m;
  rollData.initialQty = m;
  ```
- `Teks-Erp/src/services/inventory.service.ts:3931-3934` — claim metrajı/statüyü PİNLEMİYOR:
  ```ts
  const upd = await tx.roll.updateMany({
    where: { id: rollId, shipmentId: null, sackId: cur.sackId },
    data: rollData,
  });
  ```
- Karşı taraf `Teks-Erp/src/services/tambur.service.ts:2243-2247` — kesim İKİSİNİ DE düşürüyor (guard'ı kör bırakan yapısal sebep):
  ```ts
  where: { id: parent.id, status: parent.status, shipmentId: null, sackId: null, currentQty: { gte: data.cutLength } },
  data: { currentQty: { decrement: data.cutLength }, initialQty: { decrement: data.cutLength } },
  ```
- **Koruma yok teyidi (altı kaynak taranmıştır):** ① claim WHERE'inde metraj yok (yukarıda) · ② advisory kilit yok (`grep pg_advisory src/services/inventory.service.ts` → yalnız :844, KK1 mükerrer guard'ı, bu yolda değil) · ③ `touchWorkOrderTx`/satır kilidi yok · ④ DB CHECK yok (`currentQty ≤ initialQty` kısıtı **bilinçli olarak yok** — MATRIX ÇAPRAZ OKUMA §A, K2b) · ⑤ trigger yok · ⑥ feature-flag arkasında değil.

**Çakışma senaryosu**
```
T0  Depo ekranı açılır: top 100/100 m (WAREHOUSE)
T1  Tambur:  cutWarehouseRoll(top, 40 m)  → COMMIT
             parent 60/60 · yeni çocuk 40/40  (TOPLAM 100 ✓)
T2  Süpervizör "Düzelt": currentQty = 100.5  (ekranı T0'daki hâli gösteriyordu)
    pre-tx okuma → 60/60 → rollWhole = TRUE (kesim ikisini de düşürdü!)
    claim WHERE {id, shipmentId:null, sackId:null} → EŞLEŞİR
T3  COMMIT → parent 100.5/100.5 · çocuk 40/40
SONUÇ: 100 m'lik fiziksel top için sistemde 140.5 m. Kesimin aritmetiği silindi,
       hiçbir hata/uyarı/defter satırı yok.
```

**failure_mode.** Depo operatörü 100 m'lik `T280826F0001` topundan 40 m keser (çocuk `…F0002` doğar). Aynı dakika içinde süpervizör, kesimden önce açtığı ekrandan aynı topun metrajını "100,5" diye düzeltir. Sonuç: envanterde `…F0001` = 100,5 m + `…F0002` = 40 m = **140,5 m**; fiziksel raf 100 m. Sipariş karşılama, Stok Karnesi, Ürün Dengesi ve sevk planı 40,5 m fazla mal olduğunu söyler; eksiklik ancak sevkiyatta ("çuvala koyacak mal yok") ortaya çıkar.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `system_logs.tableName='ROLL_MANUAL_OVERRIDE'` → **4 kayıt** (özellik yeni yayınlandı, kullanım henüz seyrek); aynı topta "kesim + düzeltme" çakışması **arandı, 0**. `roll_variances` üzerinden ölçülen 2 eski aşım satırı bu mekanizmadan DEĞİL (§13, CLAUDE.md). Yani mekanizma canlıda **henüz** tetiklenmemiş.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-A-01.ts` → `audit/repro/D-A-01.log`
- FAZ 1 (deterministik, kesim önce commit): `parent 100.5/100.5 + çocuk 40 = TOPLAM 140.5` → **ihlal**.
- FAZ 1b: kesim sonrası `initialQty == currentQty` → `rollWhole` guard'ı **hâlâ TRUE** (guard'ı tx içine taşımanın yetmeyeceğinin kanıtı).
- FAZ 2 (gerçek paralel): N=2 → 2/2, N=5 → 5/5, N=10 → 10/10 turda ihlal; her turda **iki yazım da başarılı** sayıldı.

**İş etkisi.** Stok metrajı kalıcı olarak şişer (kendi kendine düzelmez — hiçbir yeniden hesaplama yolu yok, `currentQty` defter değil kolondur). Sipariş karşılama/ürün dengesi yanlış "elde var" der; planlamacı üretmemesi gereken bir siparişi karşılanmış sayar. Ters yönde (düzeltme aşağı) ise sevk edilebilir mal sistemde kaybolur.

**Öneri (2. tur için).**
1. Claim'e metraj/statü **pin**'i ekle — kesimin kendi kullandığı desenin aynası:
   `where: { id: rollId, shipmentId: null, sackId: cur.sackId, status: roll.status, currentQty: roll.currentQty, initialQty: roll.initialQty }` → `count === 0` → 409 *"Top bu sırada kesildi/değişti — yenileyip tekrar deneyin"*. Kod değişikliği tek dosyada, migration YOK.
2. İstemciye "beklenen metraj" alanı ekleme (If-Match muadili) 1'in yerine geçmez, tamamlar.
3. Bekçi: `scripts/audit_repro_D-A-01.ts` doğrudan regresyon bekçisine dönüştürülebilir (FAZ 1 deterministik → CI'da kararlı).
4. `[PROD'DA ÇALIŞTIRMA]` düzeltmesi YOK — geçmiş veri taraması ayrı iş: `SELECT r.id FROM rolls r WHERE EXISTS (SELECT 1 FROM rolls c WHERE c."parentRollId"=r.id) AND r."initialQty" = r."currentQty" AND r."updatedAt" > (SELECT max(c."createdAt") FROM rolls c WHERE c."parentRollId"=r.id)` (aday listesi; dry-run, otomatik düzeltme YOK).

**Kabul kriteri.** Kesim commit ettikten sonra gelen bayat metraj düzeltmesi **409** döner; `audit_repro_D-A-01.ts` FAZ 1 ve FAZ 2 yeşil; `parent.currentQty + Σ çocuk.currentQty` fiziksel gerçeği aşmaz.
**Efor:** 0,5 gün (düzeltme) + 0,5 gün (bekçi).
**Önceki defter:** ilgili id YOK. (`F-CORE-VER-001` barkod sayacıydı, farklı kök neden.)

---

### [D-A-02] `recomputeOrderStatus`u kilitsiz çağıran iki yol, sevk onayının yazdığı `shippedQty`yi sıfırlıyor — sipariş "hiç sevk edilmemiş" görünüyor

| Şiddet | **S2** | Kategori | A.2 (lost update) | Öncelik | **P1** | Modül | Sipariş / Sevkiyat | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `recomputeOrderStatus` sevk defterini (`SackAllocation` + `DirectShipAllocation`) **kilitsiz** okuyup denormu (`OrderLine.shippedQty`, `Order.shippedQty`, `Order.status`) yazar. Helper'ın kendi sözleşmesi, çağıranın **önce** tam satır kümesini `touchOrderLinesTx` ile kilitlemesini ZORUNLU kılar. Sevkiyat tarafındaki üç yol ve fason doğrudan-sevk buna uyar; `order.service`'in iki yolu (`update`, `reopen`) **uymaz**. READ COMMITTED altında kilitsiz çağıran, defteri rakibin COMMIT'inden ÖNCE okur, satır kilidinde bekler ve uyandığında **bayat** değeri yazar.

**Kanıt**
- Sözleşme — `Teks-Erp/src/services/helpers/order-status.helper.ts:205-210`:
  ```
  KİLİT PROTOKOLÜ: recompute defteri KİLİTSİZ okur ve shippedQty'yi yazar —
  ÇAĞIRAN, bu çağrıdan önce etkilenen siparişlerin TAM satır kümesini
  `touchOrderLinesTx` ile TEK sıralı partide kilitlemeli … kilitsiz çağrı =
  eşzamanlı terminal olaylarda lost-update
  ```
- Uyanlar: `shipping.service.ts:1878-1879` (dispatch), `:1975-1982` (cancel), `:2210-2211` (undoDispatch), `subcontractor.service.ts:6233 → :6298` (directShip).
- **Uymayanlar:** `Teks-Erp/src/services/order.service.ts:2537` (`update`, satır düzenlemesi sonrası) ve `Teks-Erp/src/services/order.service.ts:3411` (`reopen`) — her ikisinde de `touchOrderLinesTx` çağrısı YOK (`grep -n "touchOrderLinesTx" src/services/order.service.ts` → yalnız `:512`, o da `cancelOrderLine`).
- Yazım noktası — `order-status.helper.ts:129-133`:
  ```ts
  await tx.orderLine.update({ where: { id: l.id }, data: { shippedQty: led.shipped } });
  ```
- **Koruma yok teyidi:** advisory kilit yok (`order.service.ts`'te `pg_advisory` grep → 0), `FOR UPDATE` yalnız `:2434` (silinecek satırlar için, recompute yolunda değil), `Order.shippedQty` için trigger/CHECK **yok** (K2a: denorm, trigger YOK), claim yalnız `Order.status` üzerinde (`:2519`), `shippedQty` claim'e girmiyor.

**Çakışma senaryosu**
```
T1  performDispatchTx (sevk onayı)      T2  order.update (kalem düzenlemesi)
    BEGIN                                   —
    touchOrderLinesTx([L])  → L kilitli     —
    Shipment → DISPATCHED                   —
    …                                       BEGIN
    …                                       computeLineLedger()  → shipped = 0
                                            (T1 commit etmedi, PLANNED görüyor)
    recompute → L.shippedQty = 400          orderLine.update(L) → L kilidinde BEKLER
    COMMIT  (L.shippedQty = 400)            ↓ uyanır
                                            orderLine.update(L, shippedQty = 0)
                                            COMMIT
SONUÇ: defterde 400 m sevk var, denormda 0 yazılı. Sipariş "PARTIAL_SHIPPED"
       başlığını taşırken kalemde 0 sevk görünür (kendi içinde çelişkili).
```

**failure_mode.** Depo sevkiyatı onaylarken (400 m çıkış) satış personeli aynı siparişin bir kalemine dokunur (metraj/renk düzeltmesi). İki saniye sonra sipariş ekranı **"İstenen 1000 · Sevk 0 · Açık 1000"** gösterir. Planlamacı çıkmış malı üretilmemiş sayıp yeni iş emri açar; sipariş asla otomatik COMPLETED'a düşmez.

**Veride fiili ihlal (K2).**
```sql
-- tekserp_saha_0825
WITH led AS (SELECT ol.id, ol."shippedQty" AS denorm,
  COALESCE((SELECT SUM(sa.qty) FROM sack_allocations sa JOIN sacks s ON s.id=sa."sackId"
            JOIN shipments sh ON sh.id=s."shipmentId"
            WHERE sa."orderLineId"=ol.id AND sh.status='DISPATCHED'),0)
+ COALESCE((SELECT SUM(da.qty) FROM subcontractor_direct_ship_allocations da
            WHERE da."orderLineId"=ol.id),0) AS ledger
FROM order_lines ol)
SELECT count(*) FILTER (WHERE denorm <> ledger) AS sapan, count(*) AS toplam FROM led;
```
→ **0 / 281** (arandı, bugün sapma yok). Mekanizma açık, tetiklenmemiş.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-A-02.ts` → `audit/repro/D-A-02.log`
- **A)** kilitsiz yol: `defter=400 · OrderLine.shippedQty=0 · Order.shippedQty=0 · status=PARTIAL_SHIPPED` → **lost update ÜRETİLDİ**.
- **B) (negatif sonda)** aynı yol `touchOrderLinesTx` ile: `defter=400 · shippedQty=400` → düzeltmenin yönü doğrulandı.

**İş etkisi.** Sipariş karşılanma tablosu, "Açık talep" süzgeci, sipariş karnesi ve üretim planı yanlış; sevk edilen mal ikinci kez üretilebilir. Kendi kendine ancak o siparişe ait BİR SONRAKİ sevk/iptal/storno olayında düzelir.

**Öneri (2. tur için).** `order.service.ts:2537` ve `:3411`'de recompute'tan hemen ÖNCE tam satır kümesini kilitle:
```ts
const lineIds = (await tx.orderLine.findMany({ where: { orderId: id }, select: { id: true } })).map(l => l.id);
await touchOrderLinesTx(tx, lineIds);
await recomputeOrderStatus(tx, id);
```
(Aynı desen `cancelOrderLine :510-513`'te zaten var — kopyalanacak kaynak repoda.) Ek olarak `recomputeOrderStatus`'a **çağıran-sözleşmesi bekçisi**: helper AST bekçisiyle "her `recomputeOrderStatus*` çağrısından önce aynı tx'te `touchOrderLinesTx` var mı" mekanik ölçülebilir (`test_consistency_derived` ailesindeki AST bekçisi emsali). Migration YOK.

**Kabul kriteri.** `audit_repro_D-A-02.ts` A senaryosu yeşil (denorm = defter); AST bekçisi kilitsiz recompute çağrısında kırmızı.
**Efor:** 0,5 gün (iki çağrı yeri) + 0,5 gün (AST bekçisi).
**Önceki defter:** `F-SEV-ESZ-003` (bilgi, açık — `shipping.service` `updateMany` sınıflandırması bayatladı) ile aynı aile değil; yeni.

---

### [D-A-03] Gerçek deadlock `P2034` DEĞİL `P2039` üretiyor: middleware'in 409 dalı ölü kod, kullanıcı 500 "Sunucu hatası" alıyor ve hiçbir yol retry etmiyor

| Şiddet | **S2** | Kategori | A.3 + A.4 | Öncelik | **P1** | Modül | Çekirdek / hata yolu | Kanıt seviyesi | **K3** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Kod tabanında en az dört ABBA (ters kilit sırası) ailesi var (D-A-04/05/06/10). Bunların hepsinin çıkış kapısı `error.middleware.ts:517`'deki P2034 dalıdır ve o dal **hiç çalışmaz**: Prisma 7 + `@prisma/adapter-pg` altında PostgreSQL `40P01` (deadlock detected) hatası `PrismaClientKnownRequestError` **`P2039`** koduyla geliyor. `P2039` ne `SERVER_FAULT_PRISMA_CODES`'ta ne `CLIENT_DATA_PRISMA_CODES`'ta → "sınıflandırılmamış" fail-loud dalına düşüyor → **HTTP 500 "Sunucu hatası oluştu."** Ayrıca deadlock'u retry eden hiçbir sarmalayıcı yok (`withBarcodeRetry` yalnız P2002 retry eder).

**Kanıt**
- `Teks-Erp/src/middlewares/error.middleware.ts:514-522` — hedeflenen davranış:
  ```ts
  // F21: P2034 — write conflict / deadlock … → 409 + retry sinyali
  if (prismaErr.code === "P2034") { res.status(409).json({ … "İşlem şu anda başka bir işlemle çakıştı…" }); return; }
  ```
- `Teks-Erp/src/middlewares/error.middleware.ts:149-170` — `P2039` iki kümenin **hiçbirinde** yok.
- `Teks-Erp/src/middlewares/error.middleware.ts:556-586` — tanınmayan kod → `console.error` + `SYSTEM/ERROR` audit (`unclassified: true`) + **`res.status(500) "Sunucu hatası oluştu."`**
- `Teks-Erp/src/utils/barcode-retry.ts:31-33` — retry kapsamı:
  ```ts
  const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
  if (!isP2002) throw err;
  ```
- **Koruma yok teyidi:** `grep -rn "P2034" src` → yalnız `error.middleware.ts:514/517`; `grep -rn "40P01\|deadlock" src` → 0 (yorum dışı); serialization/deadlock retry sarmalayıcısı yok.

**Çakışma senaryosu (ölçülen)**
```
T1  BEGIN; UPDATE A;  … ; UPDATE B      T2  BEGIN; UPDATE B;  … ; UPDATE A
PG deadlock detector → T2 iptal (40P01)
Prisma (adapter-pg) → PrismaClientKnownRequestError { code: "P2039",
  message: "Database error. Code: `40P01`. Message: `deadlock detected`" }
error.middleware → P2034 dalı ATLANIR → sınıflandırılmamış → 500
SONUÇ: operatör "Sunucu hatası oluştu." görür; işlem tekrar denenebilir olduğu
       hiçbir yerde söylenmez; istemci otomatik retry yapmaz.
```

**failure_mode.** İki tablet aynı iş emrinin toplarına aynı anda dokunur (D-A-04 senaryosu: Hızlı İş Emri "top bağla" ∥ mobil "fasona sevk et"). PG birini iptal eder; o operatör **"Sunucu hatası oluştu."** görür. Yaptığı iş (sevk/bağlama) hiç olmamıştır ama mesaj bunu söylemez; mobil istemci 5xx'i "belirsiz sonuç" sayıp aynı `clientToken` ile yeniden dener (`mobil/src/offline/entryAttempt.ts` sözleşmesi) → token taşımayan yollarda (fason sevk, iade, kartela) bu **ikinci bir kayıt** demektir.

**Veride fiili ihlal (K2).** `tekserp_saha_0825` ve dev: `SELECT "recordId", count(*) FROM system_logs WHERE action='ERROR' AND category='SYSTEM' GROUP BY 1` → saha `TypeError|15`, dev `Error|4, POOL_TIMEOUT|1, TypeError|1`. **`P2039`/`P2034` kaydı 0** — sahada deadlock henüz oluşmamış (`lib/prisma.ts:26` yorumundaki "624k transaction'da 0 deadlock" ile tutarlı). Yani bulgu **hata yolunun kendisidir**, gerçekleşmiş bir vaka değil.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_D-A-03.ts` → `audit/repro/D-A-03.log`
- Satır-kilidi çevrimi → `PrismaClientKnownRequestError code=P2039`, mesaj `40P01 deadlock detected`.
- **Advisory (8022) ↔ satır kilidi çevrimi de deadlock üretti** — PG detector advisory kilitleri görüyor, yani 8022/8023 ile satır kilidi arasındaki ters sıralar (D-A-04) gerçek deadlock adayıdır.
- `withBarcodeRetry` P2034'ü **1 denemede** bırakıyor (retry etmediği doğrulandı).

**İş etkisi.** Deadlock kaçınılmaz olarak "iki kişi aynı anda dokundu" demektir ve sektörde **tekrar denenebilir** bir hatadır. Bugünkü kurgu bunu kalıcı bir sunucu arızası gibi gösteriyor; operatör vazgeçer ya da başka bir yoldan (elle düzeltme) işi yapmaya çalışır.

**Öneri (2. tur için).**
1. `error.middleware.ts`'te deadlock/serialization tespitini **koda değil SQLSTATE'e** bağla — `p2002Mentions` deseninin ikizi: `driverAdapterError.cause.code === "40P01" | "40001"` ya da `originalMessage`'da `40P01`. Bulunursa 409 + `Retry-After` benzeri açık kod (`code: "TX_CONFLICT"`). P2034 dalı KALSIN (adapter'sız kurulum için).
2. `withBarcodeRetry` yanına **ayrı** bir `withTxConflictRetry` (40P01/40001, jitter'lı, 2-3 deneme) ekle ve yalnız **idempotent** tx'lere sar; retry'ın yan etki sözleşmesi (`concurrency-patterns.md §7`) yazılı olsun. **Uyarı:** `withBarcodeRetry`'ın kapsamını genişletmek YANLIŞ olur — 21/25 çağrı yeri predicate'siz, deadlock retry'ı orada tx-dışı guard'ları atlar (D-A-07'nin aynı kök nedeni).
3. Bekçi: `audit_repro_D-A-03.ts` bu haritayı kilitler (Prisma sürümü değişince kod da değişebilir — negatif sonda olarak değerlidir).
Migration/izin/APK YOK.

**Kabul kriteri.** Repro D-A-03 koşulduğunda "middleware sınıflandırması" satırı 409 diyor; `system_logs`'ta deadlock artık `unclassified: true` ile yazılmıyor.
**Efor:** 0,5 gün (haritalama) + 1 gün (retry sarmalayıcısı + kapsam kararı).
**Önceki defter:** `F-CORE-OPS-002` (fail-loud varsayılanı) bu dalın **doğru** çalıştığını gösteriyor — bulgu o düzeltmenin ihmali değil, kod haritasının eksikliği.

---

### [D-A-04] ABBA-1: "top-önce" ve "iş emri-önce" aileleri aynı üçlüyü (Roll · 8022 · WorkOrder) ters sırada kilitliyor — deadlock, ve 8022 tek anahtar olduğu için ilgisiz iş emirleri bile çarpışabiliyor

| Şiddet | **S2** | Kategori | A.1 + A.3 | Öncelik | **P1** | Modül | İş emri / Fason / Parti | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Aynı üç kaynağı (Roll satırları · `pg_advisory_xact_lock(8022,1)` parti sayacı · `work_orders` satırı) alan iki akış ailesi var ve sıraları **ters**. `8022` **sabit anahtarlıdır** (`batch.service.ts:96-99`, key = `1`), yani sistemdeki TÜM parti doğumlarını tek kapıya sokar; bu yüzden çevrim iki farklı iş emri arasında bile kurulabilir. D-A-03 ile birlikte okununca sonuç: rastgele **HTTP 500**.

**Kanıt**
- **"top-önce" ailesi** — `Teks-Erp/src/services/workorder.service.ts:4493-4517` roll claim (`updateManyAndReturn`) → `:4553` `createBatchTx` (içinde 8022) → `:4566` `ensureWorkOrderInProgress` (WO satırı, **en sonda**):
  ```ts
  const claimed = await tx.roll.updateManyAndReturn({ where: { id: { in: candidateIds }, status: { in: acceptedRollStatuses }, … } });
  …
  batchRes = await createBatchTx(tx, { workOrderId, rollIds: …, userId });
  …
  await ensureWorkOrderInProgress(tx, workOrderId);
  ```
  Aynı aile: `workorder-manual-move.service.ts:596` (`R → 8022 → W`), `workorder-split.service.ts:336`/`:454` (P1/P2).
- **"iş emri-önce" ailesi** — `Teks-Erp/src/services/subcontractor.service.ts:1041` `touchWorkOrderTx` (WO satırı, tx'in İLK ifadesi) → `:1085-1099` roll claim → `:1140` `createBatchTx` (8022):
  ```ts
  await touchWorkOrderTx(tx, data.workOrderId);   // :1041 — WO satır kilidi
  …
  const autoAttached = await tx.roll.updateMany({ … });  // :1085
  ```
  Aynı aile: `subcontractor.service.ts:2681` (`receive`), `workorder.service.ts:3866` (`completeWorkOrder`), `batch.service.ts:880` (`splitBatch`: `WO → 8022`).
- 8022 tanımı — `Teks-Erp/src/services/batch.service.ts:96-99` sabit anahtar; `:126` fonksiyonun İLK ifadesi.
- **Koruma yok teyidi:** kilit sırası sözleşmesi ne kodda ne dokümanda yazılı (`grep -rn "kilit sırası\|lock order" src` → 0 normatif kural); deadlock retry yok (D-A-03); `withBarcodeRetry` her iki yolu da sarıyor ama yalnız P2002 retry ediyor.
- Bilinç kanıtı (kısmi): `kursun-bypass.routes.ts:166` ve `subcontractor.service.ts:2220` "WO-first" ailesinde deadlock bilincini taşıyor; "roll-first" ailesi **belgesiz**.

**Çakışma senaryosu**
```
T1  Hızlı İş Emri → attachRolls(WO1, [top X])   T2  Mobil → fason dispatch(WO1, [top X])
    BEGIN                                            BEGIN
    roll claim X  → X satırı KİLİTLİ                 touchWorkOrderTx(WO1) → WO1 KİLİTLİ
    createBatchTx → advisory 8022 ALINDI             autoAttach updateMany(X) → X'i BEKLER
    ensureWorkOrderInProgress(WO1) → WO1'i BEKLER    ↑
    ────────────── ÇEVRİM ──────────────
PG deadlock detector → birini iptal → 40P01 → P2039 → HTTP 500 (D-A-03)

VARYANT (ilgisiz iş emirleri): attachRolls(WO1) 8022'yi tutup W1'i beklerken
completeWorkOrder-TRANSFER(WO1) W1'i tutup 8022'yi bekler — top kümeleri
kesişmese bile çevrim 8022'nin SABİT anahtarı üzerinden kurulur.
```

**failure_mode.** Vardiya başında planlamacı masaüstünden "Hızlı İş Emri" ile 12 top bağlarken, boyahane operatörü tablet üzerinden aynı iş emrinin partisini fasona sevk eder. İkisinden biri **"Sunucu hatası oluştu."** alır; ne top bağlanmış ne sevk oluşmuştur, ama fason çeki listesi yazıcıya gitmediği için operatör aynı işi tekrar dener ve ikinci denemede yeni bir parti numarası (`P0x`) yakar.

**Veride fiili ihlal (K2).** `system_logs`'ta `P2039`/`40P01` izi **0** (bkz. D-A-03 K2). Deadlock sahada henüz gerçekleşmemiş — bulgu yapısaldır. `tekserp_saha_0825`: 213 iş emri / 143 fason makbuzu → çakışma penceresi dar ama sıfır değil (mobil kuyruk paralel boşalır, 2026-08-04 vakasında 46 ms içinde 5 yazma ölçülmüştü).

**Repro (K3).** Aile için birebir repro YAZILMADI (fixture maliyeti: WO + rota + EXTERNAL adım + fason firma + toplar). Yerine **mekanizma** ölçüldü: `audit_repro_D-A-03.ts` ADIM 2, advisory 8022 ↔ satır kilidi çevriminin gerçekten deadlock ürettiğini ve `P2039`/500 ile sonuçlandığını gösteriyor. Yani "advisory kilitler deadlock çevrimine girmez" savunması **elenmiştir**.

**İş etkisi.** Vardiya başı yığılmasında rastgele 500'ler; işin yapılıp yapılmadığı belirsiz kaldığı için mükerrer deneme (parti no yakılması, ikinci fason sevki riski).

**Öneri (2. tur için).**
1. **Kilit sırası sözleşmesini yaz ve tek yerde zorla:** "WorkOrder satırı → Roll satırları → 8022" (bugünkü çoğunluk sırası). `attachRolls`, `manualMove`, `workorder-split` P1/P2 tx'lerinin **İLK** ifadesi `touchWorkOrderTx(tx, workOrderId)` olsun. Bu, `roll-step.helper.ts:190-191`'deki mevcut sözleşmeyle ("çağıran WO'yu kilitlemeli") de hizalanır.
2. Sözleşmeyi **AST bekçisiyle** ölç: `createBatchTx` çağıran her tx'te, çağrıdan önce `touchWorkOrderTx` bulunmalı (`test_fason_open_dispatch_single_source` emsali).
3. D-A-03'ün retry sarmalayıcısı bu aileyi **maskelemek için kullanılmamalı** — sıra düzeltilmeden retry, gecikmeyi gizler.
Migration/izin YOK.

**Kabul kriteri.** 8 `createBatchTx` çağrı yerinin 8'inde de önce WO kilidi var (AST bekçisi yeşil); aynı WO'ya paralel attach+dispatch sondasında deadlock 0.
**Efor:** 1,5 gün.
**Önceki defter:** ilgili id YOK.

---

### [D-A-05] ABBA-4: `cancelOrderLine` OrderLine kilidini İKİ PARTİDE alıyor — helper'ın kendi yazdığı deadlock yasağının ihlali

| Şiddet | **S2** | Kategori | A.1 + A.3 | Öncelik | **P2** | Modül | Sipariş / Sevkiyat | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `order-status.helper.ts` kilit protokolü, OrderLine satırlarının **tek sıralı partide** kilitlenmesini şart koşar ve "alt-küme kilidi + tam-küme yazımı = iki-parti edinim → deadlock riski" diye adıyla yasaklar. `cancelOrderLine` tam olarak bunu yapıyor: önce tek satırı claim ediyor, ardından aynı tx'te siparişin **tüm** satırlarını sıralı kilitliyor.

**Kanıt**
- Yasak — `Teks-Erp/src/services/helpers/order-status.helper.ts:205-210` (metin D-A-02'de).
- İhlal — `Teks-Erp/src/services/order.service.ts:478-486` (birinci parti, TEK satır):
  ```ts
  const claim = await tx.orderLine.updateMany({ where: { id: lineId, cancelledAt: null }, data: { … } });
  ```
  `Teks-Erp/src/services/order.service.ts:509-512` (ikinci parti, TAM küme):
  ```ts
  const lineIds = (await tx.orderLine.findMany({ where: { orderId }, select: { id: true } })).map(l => l.id);
  await touchOrderLinesTx(tx, lineIds);
  ```
- Karşı taraf tek partide alıyor: `shipping.service.ts:1878`, `:1975`, `:2210`, `subcontractor.service.ts:6233`.
- `touchOrderLinesTx` id-sıralı döngü kullanıyor (`order-status.helper.ts:36-39`) — sıra garantisi **tek parti** varsayımına dayanıyor.
- **Koruma yok teyidi:** `cancelOrderLine`'da advisory kilit yok; tek satır claim'i sıralamanın neresine düştüğü kontrol edilmiyor.

**Çakışma senaryosu**
```
Sipariş S'in satırları id sırasıyla: L1 < L2
T1  cancelOrderLine(L2)                    T2  performDispatchTx (S'i kapsayan sevk)
    BEGIN                                      BEGIN
    claim L2            → L2 KİLİTLİ           touchOrderLinesTx([L1, L2]) sıralı:
    … WO bağları …                               L1 → KİLİTLİ
    touchOrderLinesTx([L1, L2]):                 L2 → T1'i BEKLER
      L1 → T2'yi BEKLER
    ────────────── ÇEVRİM ──────────────
40P01 → P2039 → HTTP 500 (D-A-03)
```

**failure_mode.** Satış personeli 2 kalemli bir siparişin ikinci kalemini iptal ederken depo aynı siparişin sevkini onaylar. Biri **"Sunucu hatası oluştu."** alır. Sevk onayı düşerse çuvallar PLANNED'da kilitli kalır (sahadaki `SVK2008260008` vakasının aynısı); kalem iptali düşerse iptal yarım görünür (önizleme "iptal edilebilir" der, kaydetme 500 verir).

**Veride fiili ihlal (K2).** `system_logs` deadlock izi 0 (D-A-03). `tekserp_saha_0825`'te çok kalemli sipariş sayısı: `SELECT count(*) FROM (SELECT "orderId" FROM order_lines GROUP BY 1 HAVING count(*)>1) t` → ölçüm bu turda yapılmadı (**kapsam dışı — süre**); iptal edilmiş kalem kolonu (`order_lines.cancelledAt`) saha kopyasında YOK (5 eksik migration, K2b H-9) → yol prod'da henüz canlı değil.

**Repro (K3).** Yazılmadı (mekanizma D-A-03 ADIM 1 ile aynı sınıf; fixture maliyeti yüksek). **Negatif kanıt yok** — çevrim salt kod okumasıyla kuruldu.

**İş etkisi.** Sevk onayı ile kalem iptalinin çakışması ay sonu kapanışında olağandır; her çakışmada bir taraf 500 alır.

**Öneri (2. tur için).** `cancelOrderLine`'da **tek parti**: claim'i tam-küme kilidinden SONRA yap, ya da `touchOrderLinesTx(tx, allLineIds)` çağrısını tx'in **ilk** ifadesi yap, claim'i ondan sonra çalıştır (claim'in atomikliği kaybolmaz — `cancelledAt: null` guard'ı WHERE'de kalır). Aynı kontrolü `order.service.update` (`:2434` `FOR UPDATE` + `:2537` recompute) için de yap. Bekçi: helper'ın protokolünü ölçen AST kuralı (D-A-02 önerisiyle aynı bekçi).
**Kabul kriteri.** `cancelOrderLine` tx'inde OrderLine kilidi tek partide alınıyor; helper AST bekçisi yeşil.
**Efor:** 0,5 gün.
**Önceki defter:** ilgili id YOK.

---

### [D-A-06] ABBA-2/3: çuval kilitleri id-sırasız (`from → to`) ve sevkiyat kurulumunda İSTEMCİ sırasıyla alınıyor

| Şiddet | **S3** | Kategori | A.1 + A.3 | Öncelik | **P2** | Modül | Çuval / Sevkiyat | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** İki çuval satırını birlikte kilitleyen üç yol, kilitleri **çağıranın verdiği sırayla** alıyor. Ters yönlü iki eşzamanlı istek çevrim kuruyor.

**Kanıt**
- `Teks-Erp/src/services/shipping.service.ts:690-692` (`moveRollToSack`):
  ```ts
  await touchWarehouseSackTx(tx, fromSackId);
  await touchWarehouseSackTx(tx, data.sackId);
  ```
- `Teks-Erp/src/services/shipping.service.ts:769-771` (`moveRollsToSack`) — aynı desen.
- `Teks-Erp/src/services/shipping.service.ts:1412-1418` (`createShipment`) — çuval claim'leri **istemcinin `sackIds` sırasıyla**:
  ```ts
  for (let i = 0; i < sackIds.length; i++) {
    const claimed = await tx.sack.updateMany({ where: { id: sackIds[i], shipmentId: null }, data: { … } });
  ```
  `Teks-Erp/src/services/shipping.service.ts:1552-1556` (`addSacksToShipment`) — aynı.
- Karşı örnek (doğru desen, aynı repoda): `order-status.helper.ts:36` `const ids = [...new Set(orderLineIds)].sort();`
- **Koruma yok teyidi:** `touchWarehouseSackTx` (`shipment-locks.helper.ts:65`) sıra hakkında hiçbir şey söylemiyor; advisory kilit yok; deadlock retry yok.

**Çakışma senaryosu**
```
T1  moveRollToSack(top1, A→B)          T2  moveRollToSack(top2, B→A)
    touch(A) → A kilitli                   touch(B) → B kilitli
    touch(B) → BEKLER                      touch(A) → BEKLER
40P01 → P2039 → HTTP 500

Varyant: iki paketleme ekranı aynı çuval havuzundan sevkiyat kurar,
listeler farklı sırada seçilmiştir (createShipment :1412 istemci sırası).
```

**failure_mode.** İki paketleme operatörü aynı iki depo çuvalı arasında ters yönde top taşır; birinin ekranında **"Sunucu hatası oluştu."** çıkar, top hiçbir yere gitmez ve hangi çuvalda olduğu belirsiz görünür (ekran yenilenene kadar).

**Veride fiili ihlal (K2).** Deadlock izi 0 (D-A-03). Saha'da 41 çuval / 40 sevkiyat → paralel çuval taşıma olasılığı düşük.

**Repro (K3).** Yazılmadı; mekanizma D-A-03 ADIM 1'in birebir aynısı (iki satır, ters sıra) ve orada ÖLÇÜLDÜ.

**İş etkisi.** Paketleme ekranında rastgele sunucu hatası; veri bozulmaz (tx geri sarılır).

**Öneri (2. tur için).** Üç yolda da kilitleri **id'ye göre sıralı** al (`[...new Set(ids)].sort()`), `order-status.helper.ts:36`'in aynısı. `createShipment`/`addSacksToShipment`'ta `seq` ataması istemci sırasını korumalı → sıralamayı yalnız **kilit alma** adımına uygula, `seq` için ayrı döngü kullan. Migration YOK.
**Kabul kriteri.** İki çuvalı ters yönde taşıyan paralel sonda deadlock üretmiyor.
**Efor:** 0,5 gün.
**Önceki defter:** ilgili id YOK.

---

### [D-A-07] Fason kabulünde `withBarcodeRetry` predicate'siz: aynı `clientToken` ile gelen replay, "Barkod üretimi 5 denemede başarısız" 409'una düşüyor ve kısmi kabulde MÜKERRER makbuza yol açıyor

| Şiddet | **S2** | Kategori | A.4 (retry ↔ idempotency) | Öncelik | **P1** | Modül | Fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Repoda `clientToken` P2002'sinin retry edilmemesi gerektiği **yazılı bir sözleşme** (`utils/p2002.ts:30-36`) ve altı yolda uygulanmış. `subcontractor.receive` tek istisna: `withBarcodeRetry` predicate'siz çağrılıyor. Sonuç: aynı token'la gelen ikinci istek 5 kez tüm ağır kabul tx'ini yeniden koşuyor (tx-DIŞI token kontrolü retry'da koşmuyor) ve sonunda **yanlış** bir hata mesajıyla düşüyor. **TAM kabulde** roll claim'i kaybedeni yakalar (409 doğru mesaj); **KISMİ kabulde** top `AT_SUBCONTRACTOR` kaldığı için o claim yoktur → tek koruma clientToken unique'idir ve retry onu yanlış yorumlar.

**Kanıt**
- Sözleşme — `Teks-Erp/src/utils/p2002.ts:30-36`:
  ```
  withBarcodeRetry ile etkileşim kuralı: clientToken P2002'si RETRY EDİLMEZ —
  retry her denemede aynı token'ı yazacağından 5 tur boşa döner ve yanıltıcı
  "Barkod üretimi 5 denemede başarısız" hatası üretirdi.
  ```
- Uygulayanlar: `inventory.service.ts:4221`, `workorder.service.ts:1088`, `order.service.ts:1981`, `shipping.service.ts:278` (`openSack`), `:1435` (`createShipment`), `kartela.service.ts:1408`.
- **İstisna** — `Teks-Erp/src/services/subcontractor.service.ts:2677`:
  ```ts
  const result = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => { …
  ```
  (`isRetryable` argümanı YOK → tüm P2002'ler retry edilir.)
- Token kontrolü **tx DIŞINDA** — `Teks-Erp/src/services/subcontractor.service.ts:2348-2368`; retry yalnız tx callback'ini yeniden koşar, bu blok tekrar koşmaz.
- `SubcontractorReceipt.clientToken @unique` — `prisma/schema.prisma:3474`.
- TAM kabulde koruma var — `Teks-Erp/src/services/subcontractor.service.ts:2857-2870` (`AT_SUBCONTRACTOR` claim, kaybeden `AppError.conflict` → P2002 değil → retry'a girmez); yorum bunu açıkça anlatıyor (`:2852-2855`).
- **KISMİ kabulde o claim YOK** — `Teks-Erp/src/services/subcontractor.service.ts:2872+`: top fasonda kalır, yalnız `currentQty` decrement edilir (`gte` guard'lı).
- **Koruma yok teyidi:** advisory kilit yok; `touchWorkOrderTx` (`:2681`) iki isteği serileştirir ama **ikisinin de commit etmesini engellemez** (sadece sıraya sokar); mükerreri tutan tek sed `clientToken` unique'idir ve retry onu tüketiyor.

**Çakışma senaryosu**
```
Tablet zaman aşımına düşer, kuyruk aynı payload'ı İKİ KEZ gönderir (token = K).
T1  pre-tx token lookup → yok           T2  pre-tx token lookup → yok
    BEGIN; touchWorkOrderTx(WO)             BEGIN; touchWorkOrderTx(WO) → BEKLER
    kısmi: currentQty -= 51
    receipt(clientToken=K) INSERT
    COMMIT                                  ↓ uyanır
                                            kısmi: currentQty -= 51   (kalan yeterse GEÇER)
                                            receipt(K) INSERT → P2002 (clientToken)
                                            withBarcodeRetry → tx ROLLBACK, 5 kez tekrar
                                            (her turda aynı P2002)
                                            → 409 "Barkod üretimi 5 denemede başarısız oldu"
Operatör mesajı okur, ekrandan YENİDEN kabul yapar (yeni token) →
İKİNCİ makbuz + ikinci decrement + ikinci parti + ikinci "born roll" seti.
```
> Not: mobil sözleşmesi (`mobil/src/offline/entryAttempt.ts`) token'ı yalnız **belirsiz** hatada yapıştırır; 409 kesin bir 4xx olduğu için token YAPIŞMAZ → yeniden deneme mutlaka yeni token taşır.

**failure_mode.** Boyahaneden 51 m kısmi dönüş kabul edilir; tablet cevabı alamayıp kuyruğu ikinci kez boşaltır. Operatör "Barkod üretimi 5 denemede başarısız oldu, lütfen tekrar deneyin" mesajını görür ve kabulü tekrarlar. Fason defterinde **iki** kısmi makbuz oluşur: kalan metraj 51 yerine 102 düşer, `openQty` yanlış kapanır, dönen mal için iki ayrı parti ve iki barkod seti doğar.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `subcontractor_receipts` **143 satır, `clientToken` dolu 2** · `subcontractor_receipt_items WHERE isPartial=true` → **1**. Yani bugünkü saha kullanımında (token neredeyse hiç gönderilmiyor, kısmi kabul 1 kez kullanılmış) yol henüz tetiklenmemiş. **Ancak** token gönderimi mobil tarafın idempotency paketiyle yaygınlaşacak ve kısmi kabul 2026-08-19'da yeni açıldı → olasılık ARTIYOR.

**Repro (K3).** Yazılmadı — **kapsam dışı, sebep:** fixture zinciri (WO + rota + EXTERNAL adım + fason firma + sevk + toplar + parti) tek script bütçesini (2 dk) aşıyor; mekanizmanın iki bileşeni (predicate'siz retry davranışı ve `withBarcodeRetry`'ın kapsamı) `audit_repro_D-A-03.ts` ADIM 3'te ayrıca ölçüldü.

**İş etkisi.** Fason mal defteri çift sayar: fire/çekme oranı, `openQty`, karne rakamları ve dönen kumaşın metrajı bozulur; fiziksel olarak var olmayan toplar sisteme girer.

**Öneri (2. tur için).**
1. `subcontractor.service.ts:2677`'ye predicate ekle: `withBarcodeRetry(fn, 5, (err) => !isClientTokenP2002(err))`; dış `catch`'te `isClientTokenP2002` → **tx dışındaki token lookup'ını tekrar koş** ve cached makbuzu dön (`shipping.service.ts:278-295` deseninin birebir kopyası).
2. Kısmi kabulde de bir **claim** ekle: `receipt` INSERT'ini `clientToken` üzerinden `createMany({ skipDuplicates })`+lookup ya da `currentQty` pin'iyle güçlendir.
3. Bekçi: `test_fason_partial_receive.ts`'e "aynı token, paralel iki kısmi kabul → tam 1 makbuz, kaybeden cached yanıt" sondası (`Promise.allSettled`).
4. Genel: `withBarcodeRetry`'ın **predicate'siz** 21 çağrı yerini gözden geçir — her biri için "bu tx'te clientToken/iş-anahtarı unique'i var mı" sorusu sorulmalı (kontrol listesi işi).
Migration/izin YOK.

**Kabul kriteri.** Aynı token'la paralel iki kısmi kabul: 1 makbuz, kaybeden `success:true` + aynı makbuz (ya da açık `RECEIPT_*` kodu); "Barkod üretimi…" mesajı bu yolda ASLA görünmez.
**Efor:** 1 gün (düzeltme + bekçi).
**Önceki defter:** ilgili id YOK; `F-FAS-ESZ-002` (bilgi, açık) kabul şemasının değiştiğini not ediyor — bu bulgu o değişikliğin açtığı boşluk.

---

### [D-A-08] İş emri iptalinde fason kararı TX'İN DIŞINDA yazılıyor: iptal 409 alırsa toplar fasondan sistemsel olarak "içeri alınmış" kalıyor ve geri sarılmıyor

| Şiddet | **S2** | Kategori | A.1 + A.4 (tx dışına taşan yazma) | Öncelik | **P1** | Modül | İş emri / Fason | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `softDelete` (iş emri iptali), asıl iptal transaction'ından **ÖNCE** havuz client'ıyla iki kalıcı yazma yapıyor: (a) açık fason sevklerini `cancelBulk` ile iptal ediyor ve **sonucunu okumuyor** (`failed[]` yutuluyor), (b) fasondaki topları koşulsuz `IN_PRODUCTION`'a çekiyor. Sonraki tx'in claim'i (eşzamanlı tamamlama/iptal) 409 verirse ya da tx-içi fason guard'ı tripleyip tüm tx'i geri sararsa, bu iki yazım **kalıcı** olur.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:3253-3257` — `cancelBulk` sonucu atılıyor:
  ```ts
  await new SubcontractorService().cancelBulk(
    { dispatchIds: openDispatches.map((d) => d.id), reason: `İş emri iptali: ${reason}` }, userId,
  );
  ```
  (`cancelBulk` `failed[]` döndürür — `subcontractor.service.ts:2183` — ama burada okunmuyor.)
- `Teks-Erp/src/services/workorder.service.ts:3271-3285` — **havuz client'ı, tx yok, koşulsuz**:
  ```ts
  const residual = await prisma.roll.findMany({ where: { id: { in: fasonRolls.map(r => r.id) },
    status: { in: [RollStatus.AT_SUBCONTRACTOR, RollStatus.RETURNED_FROM_SUBCONTRACTOR] } }, … });
  if (residual.length > 0) {
    await prisma.roll.updateMany({ where: { id: { in: residual.map(r => r.id) } },
      data: { status: RollStatus.IN_PRODUCTION } });
  }
  ```
- Çağrı yeri — `Teks-Erp/src/services/workorder.service.ts:3367`: `prepareFasonCancelDecision` **tx'ten önce**.
- Geri sarılabilir taraf — `Teks-Erp/src/services/workorder.service.ts:3387-3413`: claim `count === 0` → `AppError.conflict` (eşzamanlı tamamlama/iptal); `:3423-3445` fason in-flight guard'ı → tüm tx geri sarılır.
- **Koruma yok teyidi:** telafi (compensating action) yok; `try/catch` yok; audit'te "kısmi karar uygulandı" izi yok; feature-flag arkasında değil.
- Belge — `Teks-Erp/src/services/workorder.service.ts:3359-3366` sırayı **bilinçli** anlatıyor ama geri alma senaryosunu ele almıyor.

**Çakışma senaryosu**
```
T1  softDelete(WO)                          T2  tambur.finalize (son top) — aynı WO
    prepareFasonCancelDecision:
      cancelBulk(açık sevkler)  → COMMIT ✓       …
      roll.updateMany(AT_SUB → IN_PRODUCTION)    …
        → COMMIT ✓  (havuz, tx DIŞI)             completeWorkOrderIfStepsDone
                                                 WO → COMPLETED · COMMIT ✓
    BEGIN
    cancelClaim WHERE status NOT IN (COMPLETED,…)
      → count = 0 → AppError.conflict → ROLLBACK
SONUÇ: iptal OLMADI ama fason sevkleri iptal edildi ve fasondaki toplar
       "IN_PRODUCTION" oldu. Mal fiziksel olarak boyahanede, sistemde fabrikada;
       Fason ekranında satır yok, envanterde "işlemde" görünüyor.
```

**İKİNCİ (yarış-DIŞI) tetikleyici — aynı kök neden.** Flip `IN_PRODUCTION`'a çektiği için, `entrySource = SUBCONTRACTOR_RETURN` olan bir top (ikinci fasona gönderilmiş dönüş malı) tx-içi guard'ın **üçüncü dalına** takılır (`workorder.service.ts:3423-3444`: `status IN_PRODUCTION AND entrySource SUBCONTRACTOR_RETURN`) → tx geri sarılır → sonraki denemeler de aynı yere düşer: **iş emri artık HİÇ iptal edilemez** ve toplar kalıcı olarak yanlış statüdedir.
> Ölçüm: `tekserp_saha_0825` → `AT_SUBCONTRACTOR` toplarının entrySource dağılımı `SUPPLIER_RECEIPT 184 · TAMBUR_SPLIT 3 · MANUAL_ENTRY 1`, `SUBCONTRACTOR_RETURN` **0**; iki EXTERNAL adımı olan iş emri **0**. Yani bu ikinci tetikleyici bugün saha rotalarında **erişilemez**; rota kurgusu değişirse (çok aşamalı fason) açılır.

**failure_mode.** Planlamacı, boyahanede 184 m malı olan bir iş emrini iptal etmeye çalışır; tam o sırada Tambur son topu kapatıp iş emrini COMPLETED yapar. İptal "İş emri bu sırada tamamlandı, iptal edilemez" der. Ama fason çeki listesi çoktan iptal edilmiştir ve boyahanedeki toplar sistemde `IN_PRODUCTION` görünür: Fason ekranında "dışarıda mal" satırı kaybolur, mal geri geldiğinde kabul edilecek açık sevk yoktur.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: sevki olmayan `IN_PRODUCTION` + `entrySource=SUBCONTRACTOR_RETURN` top araması bu turda **yapılmadı** (kapsam dışı — sorgu tasarımı 2. tura). `AT_SUBCONTRACTOR` 188 top, `RETURNED_FROM_SUBCONTRACTOR` **0** (K2b ile tutarlı).

**Repro (K3).** Yazılmadı — **kapsam dışı, sebep:** fason sevk zinciri fixture'ı (D-A-07 ile aynı gerekçe). Mekanizma salt kod okumasıyla kesin (yazımın tx dışında olması tartışmasız).

**İş etkisi.** Fabrikanın dışarıdaki malı sistemsel olarak "içeride" görünür; fason mutabakatı, açık sevk raporu ve stok karnesi ayrışır. Geri alma yolu yok (elle düzeltme gerekir).

**Öneri (2. tur için).**
1. `cancelBulk` sonucunu **oku**: `failed[]` doluysa iptal işlemini **başlatma** (400 + hangi sevkin kapanamadığı).
2. `residual` flip'ini asıl iptal tx'inin **İÇİNE** taşı (claim'den SONRA, guard'dan ÖNCE) — böylece claim 409 verirse flip de geri sarılır. Alternatif: flip'i tx'e taşıyamıyorsan **telafi** yaz (catch → eski statüleri geri koy) ve audit'e "FASON_DECISION_ROLLBACK" düş.
3. `entrySource=SUBCONTRACTOR_RETURN` dalını flip'ten muaf tut (yoksa guard kendi ürettiği durumu reddeder).
4. Bekçi: "iptal claim'i 409 verirse hiçbir Roll statüsü değişmemiş olmalı" sondası.
Migration YOK; `[PROD'DA ÇALIŞTIRMA]` gerekmez.

**Kabul kriteri.** İptal tx'i düştüğünde `rolls.status` ve `subcontractor_dispatches.cancelledAt` üzerinde hiçbir kalıcı değişiklik olmaz.
**Efor:** 1 gün.
**Önceki defter:** ilgili id YOK. (K3a HOTSPOT #1 ile aynı yer.)

---

### [D-A-09] `updateTargetProperties` kilitsiz, claim'siz ve terminal-statü guard'sız: tamamlanmış iş emrinin hedefleri ve topların özellikleri yeniden yazılabiliyor

| Şiddet | **S2** | Kategori | A.1 | Öncelik | **P2** | Modül | İş emri / Üretim karakteristiği | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Kardeş yollar (`update`, `replace`) üç korumayı birden uygular: terminal statü kilidi (`PLAN_CHANGE_FROZEN_STATUSES`), tx-içi `computeWorkOrderLocks(tx)` tekrarı ve `touchWorkOrderTx`. `updateTargetProperties` **üçünü de** uygulamıyor: kilidi havuzdan tek sefer pre-tx okuyor, WO statüsünü hiç okumuyor ve tx içinde bağlı topların FLAG özelliklerini **koşulsuz siliyor**.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:5607-5620` — WO okuması, `status` **select'te bile YOK**.
- `Teks-Erp/src/services/workorder.service.ts:5627` — kilit hesabı **havuz** client'ıyla, tx-içi ikizi yok:
  ```ts
  const locks = await computeWorkOrderLocks(prisma, id);
  ```
  (Kardeşleri: `:4675` pre + `:4779` tx-içi; `:4912` pre + `:5274` tx-içi.)
- `Teks-Erp/src/services/workorder.service.ts:5700-5713` — koşulsuz FLAG replace:
  ```ts
  await tx.rollProperty.deleteMany({ where: { rollId: { in: rollIds }, property: { valueType: "FLAG" } } });
  … await tx.rollProperty.createMany({ data, skipDuplicates: true });
  ```
- **Koruma yok teyidi:** `grep -n "touchWorkOrderTx" src/services/workorder.service.ts` → `:4778` (yalnız `update`), bu fonksiyonda YOK; `PLAN_CHANGE_FROZEN_STATUSES` bu fonksiyonda geçmiyor; advisory kilit yok; DB'de WO statüsüne bağlı CHECK yok.
- Karşı taraf: istasyon yetenek kopyalama `copyStationCapabilitiesToRoll` (`station-capability-transfer.helper.ts:183`) aynı `RollProperty` satırlarını **upsert** ile yazıyor (`kursun-qc.service.ts:489`, `kursun-bypass.service.ts:1396/:1839/:2007`, `inventory.service.ts:4736`).

**Çakışma senaryosu**
```
T1  updateTargetProperties(WO, [A])        T2  kursun-qc.finishStep (aynı WO'nun topları)
    computeWorkOrderLocks(prisma)   (pre-tx)    BEGIN; touchWorkOrderTx(WO)
    BEGIN                                       copyStationCapabilitiesToRoll →
    rollProperty.deleteMany(FLAG)                 RollProperty upsert (ZIMPARALI)
    rollProperty.createMany([A])                COMMIT ✓
    COMMIT ✓
Sıra T2 → T1 ise: istasyonun az önce yazdığı ZIMPARALI SİLİNİR.
Ayrıca T1, WO COMPLETED/CANCELLED olsa bile çalışır (statü hiç okunmuyor).
```

**failure_mode.** Planlamacı, tamamlanmış bir iş emrinin hedef özelliklerinden "ZIMPARALI"yı listeden çıkarır (uç statüye bakmadığı için işlem geçer). Aynı dakikada Kurşun/KK2 istasyonu son adımı kapatır ve istasyon yeteneği olarak ZIMPARALI'yı topa yazar. `deleteMany(FLAG)` o satırı siler: depoya inen top etikette ve raporda "zımparasız" görünür, sipariş `OrderLineRequiredProperty` eşleşmesinden düşer ve o sipariş için sevk edilemez sayılır.

**Veride fiili ihlal (K2).** Aranmadı — **sebep:** "silinmiş RollProperty" geriye dönük tespit edilemez (append-only defter yok; `RollProperty` pivot, audit'te satır düzeyi diff yok). Dolaylı sonda (`rolls` ↔ `work_order_target_properties` uyumsuzluğu) yanlış pozitife açık.

**Repro (K3).** Yazılmadı — **kapsam dışı, sebep:** kaynak kesinliği kod okumasıyla sağlandı (üç korumanın yokluğu grep'le teyitli); tetikleme fixture'ı (rota + istasyon yeteneği + KK2 adımı) bütçeyi aşıyor.

**İş etkisi.** Üretim karakteristiği (kat/zımpara/gramaj) topun etiketine basılıyor ve sipariş eşleşmesinde kullanılıyor — sessiz kayıp doğrudan yanlış sevke çıkar.

**Öneri (2. tur için).** Üç korumayı kardeşlerden kopyala: ① tx'in ilk ifadesi `touchWorkOrderTx(tx, id)`; ② tx içinde WO statüsünü TAZE oku ve `PLAN_CHANGE_FROZEN_STATUSES` uygula; ③ `computeWorkOrderLocks(tx, id)` tekrarını tx içine ekle. Bekçi: "plan değişikliği yollarının üçü de aynı guard üçlüsünü çağırıyor" AST kontrolü.
**Kabul kriteri.** COMPLETED/CANCELLED WO'da `updateTargetProperties` 409; paralel `finishStep` sondasında istasyonun yazdığı FLAG satırı korunuyor.
**Efor:** 0,5 gün.
**Önceki defter:** ilgili id YOK.

---

### [D-A-10] Tambur geri alma iş emri satırını HİÇ kilitlemiyor ve adımı iş emrinden ÖNCE yazıyor (kardeşlerinin tersi)

| Şiddet | **S3** | Kategori | A.1 + A.3 | Öncelik | **P2** | Modül | Tambur / İş emri | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `recomputeStepStatus`/`completeWorkOrderIfStepsDone` helper'ının sözleşmesi "çağıran WO'yu kilitlemeli" der. `tambur-undo`'nun iki büyük yolu (`applySingleRestore`, `applyFull`) bu kilidi HİÇ almıyor; üstelik `WorkOrderStep`'i `work_orders`'tan ÖNCE yazıyor — kardeşlerinin (`tambur-manual`, `finalize`, `finishStep`, `kursun-bypass`) tam tersi sıra.

**Kanıt**
- Sözleşme — `Teks-Erp/src/services/helpers/roll-step.helper.ts:190-191` (çağıran WO'yu kilitlemeli).
- Kilit yokluğu — `grep -n "touchWorkOrderTx" src/services/tambur-undo.service.ts` → **0 sonuç**.
- Kilitsiz okuma + sonra yazım — `Teks-Erp/src/services/tambur-undo.service.ts:1246-1256`:
  ```ts
  if (step.workOrder.status === WorkOrderStatus.CANCELLED || … SUPERSEDED)
    throw AppError.conflict("İş emri iptal/devredilmiş — iş emrine geri alınamaz");
  ```
  → `Teks-Erp/src/services/tambur-undo.service.ts:1377-1384`:
  ```ts
  await recomputeStepStatus(tx, stepId);
  const woRevived = await tx.workOrder.updateMany({ where: { id: step.workOrder.id, status: WorkOrderStatus.COMPLETED }, data: { status: WorkOrderStatus.IN_PROGRESS } });
  ```
  Aynı desen `:1668-1675` (`applyFull`).
- Ters sıra kardeşi — `Teks-Erp/src/services/tambur-manual.service.ts:1191-1192`: `touchWorkOrderTx(tx, …)` → `recomputeStepStatus(tx, …)`.
- **Kısmi koruma var:** WO diriltmesi `{ id, status: COMPLETED }` claim'i taşıyor → iptal edilmiş WO **dirilmez**. Bu, en ağır senaryoyu kapatıyor ve şiddeti S3'te tutan sebeptir.
- Açık kalan: `recomputeStepStatus` iptal edilmiş WO'nun adım statüsünü yine de yazabilir (claim yok).

**Çakışma senaryosu**
```
T1  tambur-undo.applySingleRestore          T2  tambur-manual.createManualRoll (aynı COMPLETED WO)
    (WO kilidi YOK)                             touchWorkOrderTx(WO) → WO satırı KİLİTLİ
    recomputeStepStatus → Step satırı KİLİTLİ    recomputeStepStatus(Step) → BEKLER
    workOrder.updateMany(WO) → BEKLER
    ────────────── ÇEVRİM ──────────────
40P01 → P2039 → HTTP 500 (D-A-03)

İkinci senaryo (veri): T1 WO statüsünü kilitsiz okur (IN_PROGRESS),
T2 = softDelete WO'yu CANCELLED yapar; T1 recomputeStepStatus ile iptal edilmiş
WO'nun adımını PENDING/ACTIVE'e çeker (WO diriltmesi claim'le engellenir).
```

**failure_mode.** Aynı tamamlanmış iş emrinde bir kullanıcı "İş Emrine Geri Al" yaparken diğeri "Manuel top ekle" yapar → biri **"Sunucu hatası oluştu."** alır (D-A-03). Ya da iptal edilmiş bir iş emrinde adım `ACTIVE` görünür; kart okutma ve Tambur finalize guard'ları o adımı reddettiği için top "canlı ama kimsenin okutamadığı" çıkmaza düşer (CLAUDE.md'nin `CANCELLED/SUPERSEDED WO'da taşıma REDDEDİLİR` kararıyla korunmak istenen durumun aynısı).

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: 3 CANCELLED WO'da `PENDING` adım (K2b ölçümü, Temmuz) — kaynağı ayrıştırılmadı, bu yol adaylardan biri. Deadlock izi 0.

**Repro (K3).** Yazılmadı — kapsam dışı (fixture zinciri); ters sıra deadlock mekanizması D-A-03 ADIM 1'de ölçüldü.

**İş etkisi.** Nadir ama teşhisi zor bir "takılı iş emri" sınıfı; elle düzeltme gerektirir.

**Öneri (2. tur için).** `tambur-undo`'nun iki tx'inin **İLK** ifadesi `touchWorkOrderTx(tx, workOrderId)` olsun (WO id'si `op.workOrderStepId` üzerinden zaten çözülüyor — okumayı kilitten sonraya al). Bu hem sözleşmeyi karşılar hem ters sırayı kaldırır. Bekçi: aynı COMPLETED WO'da `createManualRoll ∥ applyUndo(RESTORE)` paralel sondası.
**Kabul kriteri.** `tambur-undo` tx'lerinde WO kilidi ilk ifade; paralel sondada deadlock 0 ve iptal edilmiş WO'nun adım statüsü değişmiyor.
**Efor:** 0,5 gün.
**Önceki defter:** ilgili id YOK. (K3b HOTSPOT H-1/H-11 ile aynı yer.)

---

### [D-A-11] İş emri numarası TX AÇIKKEN havuzdan ikinci bağlantı istiyor — repoda tx-alan ikizi var ama kullanılmıyor

| Şiddet | **S3** | Kategori | A.4 (tx tuzağı) + A.6 | Öncelik | **P3** | Modül | İş emri | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `create()` tx'i açıkken, İE numarasını üreten fonksiyon **global `prisma`** (havuz) ile 2 sorgu (× en fazla 5 deneme) koşuyor. Bu, repoda **ölçülerek yasaklanmış** bir desen: `roll-barcode.helper.ts:56-64` aynı deseni "30 eşzamanlı işlemin yalnız 3'ü tamamlandı" ölçümüyle reddediyor. `shipping.service.ts:133-151` aynı gerekçeyle `nextShipmentNo(tx)`'e çevrilmiş. Tx alan ikiz (`generateWorkOrderNumberTx`) repoda **var** ve bu yolda kullanılmıyor.

**Kanıt**
- `Teks-Erp/src/services/workorder.service.ts:988-989`:
  ```ts
  const workOrder = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
    const workOrderNumber = manualWorkOrderNumber ?? (await this.generateWorkOrderNumber());
  ```
- `Teks-Erp/src/services/workorder.service.ts:571-597` — fonksiyon **havuz** client'ı kullanıyor (`prisma.workOrder.findMany` :581, `prisma.workOrder.findUnique` :592), 5 denemeli döngü.
- Kullanılmayan tx ikizi — `Teks-Erp/src/services/helpers/workorder-clone.helper.ts:31` `generateWorkOrderNumberTx(tx, …)`.
- Yasak gerekçesi (ölçümlü) — `Teks-Erp/src/services/helpers/roll-barcode.helper.ts:56-64`.
- Aynı sınıf ikinci nokta — `Teks-Erp/src/services/workorder.service.ts:1002` ve `:5505` → `resolvePlanDates` → `readWorkOrderDefaultPlanDurationDays()` argümansız → `system-setting.service` `tx ?? prisma` → havuz.
- Havuz sınırı — `Teks-Erp/src/lib/prisma.ts` `max: 30`, `connectionTimeoutMillis: 5000`.
- **Koruma yok teyidi:** ESLint kuralı yalnız `Promise.all(tx.*)`i yasaklıyor (`eslint.config.mjs:34-47`), "tx açıkken havuz" kuralı YOK; bekçi `test_barcode_reservation.ts` yalnız barkod yolunu ölçüyor.

**Çakışma senaryosu**
```
30 eşzamanlı POST /api/work-orders (Hızlı İş Emri dalgası / içe aktarım)
  her istek: havuzdan 1 bağlantı alır ($transaction)
  her istek: tx içinde generateWorkOrderNumber() → havuzdan İKİNCİ bağlantı ister
  havuz 30/30 dolu → hiçbiri ikinciyi alamaz
  → connectionTimeoutMillis 5 sn → ÇIPLAK pg Error → classifyPoolTimeout → 503
SONUÇ: yalnız WO oluşturma değil, TÜM uygulama 5 sn boyunca 503 döner.
```

**failure_mode.** İçe aktarımla ya da toplu Hızlı İş Emri ile 30 iş emri eşzamanlı açılırsa uygulama kendi kendini kilitler: istekler `Sunucu meşgul` (503) alır, tabletler ve panel aynı anda bağlantı kuramaz. Tek tek kullanımda görünmez.

**Veride fiili ihlal (K2).** dev `system_logs`: `POOL_TIMEOUT` **1 kayıt** (kaynağı ayrıştırılmadı); saha'da **0**. Saha'da 213 iş emri (aylar içinde) → 30 eşzamanlı create pratikte gerçekleşmemiş.

**Repro (K3).** Yazılmadı — **kapsam dışı, sebep:** 30 eşzamanlı gerçek `create()` dev DB'de yan etkili (30 iş emri + kart + parti) ve temizliği risklidir; ayrıca aynı ölçüm `roll-barcode.helper.ts:56-64`'te zaten yapılmış ve kod yorumunda kayıtlı.

**İş etkisi.** Nadir ama etkisi tüm sisteme yayılır (uygulama geneli 503).

**Öneri (2. tur için).** `generateWorkOrderNumber`'ı `generateWorkOrderNumberTx(tx)` ile değiştir (ikiz mevcut, `withBarcodeRetry` sarması zaten var → P2002 telafisi korunur). `resolvePlanDates`'e `tx` parametresi geçir. Bekçi: "tx callback'i içinde global `prisma.` kullanımı" için ESLint kuralı (`Promise.all(tx.*)` kuralının kardeşi) — mekanik ve ucuz.
**Kabul kriteri.** ESLint kuralı `src/services` altında tx-içi havuz kullanımında kırmızı; 30 paralel WO create sondası 30/30 tamamlanıyor.
**Efor:** 0,5 gün (değişiklik) + 0,5 gün (ESLint kuralı).
**Önceki defter:** `F-CORE-VER-001` / `F-IST-ESZ-001` (düzeltildi) — **aynı sınıfın barkod ayağı kapandı, iş emri numarası ayağı açık kaldı.**

---

### [D-A-12] Katlanmış KOD tekilliğinin advisory kilidi yalnız `Item`'da: fason/kategori/BaseService yolları `sefa2` ↔ `SEFA2` yarışına açık

| Şiddet | **S3** | Kategori | A.1 (check-then-act) | Öncelik | **P3** | Modül | Ana veri | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `code-unique.helper.ts` başlığı katlanmış kod tekilliğini altı modelde tarif ediyor ve "kilit ŞART, `findMany`'den ÖNCE" diyor. `lockCodeScopeTx` (8026) yalnız `item.service.ts:237`'de çağrılıyor; diğer üç çağıran kararı **havuzdan, kilitsiz** veriyor. DB'de tam-eşleşme unique'i var (`sefa2` = `sefa2` yakalanır) ama **katlanmış** tekillik için sed **bilinçli olarak yok**.

**Kanıt**
- Sözleşme — `Teks-Erp/src/services/helpers/code-unique.helper.ts:63-72`:
  ```
  NEDEN GEREKLİ: tam-eşleşme yarışını bugün DB'deki `@unique` kapatıyor (P2002 → 409).
  KATLANMIŞ tekillikte DB'de karşılık YOK (bilinçli) → eşzamanlı `sefa2` + `SEFA2`
  istekleri guard'ı ikisi de geçer, P2002 doğmaz ve yeni bir ikiz sessizce doğar.
  ⚠️ SIRA LOAD-BEARING: kilit, koruduğu OKUMADAN önce alınmalı.
  ```
- Tek uygulayan — `Teks-Erp/src/services/item.service.ts:237` (`lockCodeScopeTx`, tx'in ilk ifadesi).
- Kilitsiz çağıranlar — `Teks-Erp/src/services/subcontractor-management.service.ts:512-516` (fason firma), `:202` (kategori), `Teks-Erp/src/services/base.service.ts:1052`.
- Kod — `subcontractor-management.service.ts:512-516`, karar **tx'ten önce**:
  ```ts
  const decision = decideCodeUniqueness(payload.code, await loadSubCodeCandidates("subcontractor"), SUB_CODE_TEXTS);
  ```
- **Koruma yok teyidi:** `subcontractors_code_key` (tam eşleşme ✓) · katlanmış kod için partial/ifade unique **YOK** (K2b `EXPRESSION_UNIQUES` envanterinde `tr_fold_color` ve `nameFold` var, kod yok) · bekçi `test_item_code_case_uniqueness.ts` yalnız Item'ı ölçüyor.

**Çakışma senaryosu**
```
T1  POST /subcontractors { code: "sefa2" }   T2  POST /subcontractors { code: "SEFA2" }
    loadSubCodeCandidates() → yok                loadSubCodeCandidates() → yok
    decideCodeUniqueness → CREATE                decideCodeUniqueness → CREATE
    INSERT ✓ (subcontractors_code_key farklı)    INSERT ✓
SONUÇ: aynı fason firma iki kartla sistemde; sevkler ikiye bölünür, karne
       rakamları ayrışır, mükerrer paneli aday üretir.
```

**failure_mode.** İki büro personeli aynı yeni boyahaneyi farklı harf düzeniyle (`byr01` / `BYR01`) aynı anda tanımlar. İkisi de kaydedilir. Fason sevkleri iki karta bölünür; "açık sevk" ve fire raporları o firmayı iki ayrı firma sayar; birleştirme sonradan `master-data-merge` ile elle yapılmak zorunda kalır.

**Veride fiili ihlal (K2).** Aranmadı — **sebep:** katlanmış-kod ikizi taraması `foldCodeForCompare` semantiğini SQL'de yeniden üretmeyi gerektirir (Item için `find_fold_duplicates.ts` var; fason/kategori için yok). K2b, kod alanında ihlali OLMAYAN bir tablo listesi vermiyor. 2. turda `scripts/find_fold_duplicates.ts` kapsamı genişletilerek ölçülebilir.

**Repro (K3).** Yazılmadı — **kapsam dışı, sebep:** olasılık gerçekçi biçimde çok düşük (iki eşzamanlı yeni cari kart, aynı kod, farklı harf); mekanizma helper'ın kendi docstring'inde tarif edilmiş ve `test_item_code_case_uniqueness.ts:533` paralel sondası aynı yarışın Item'daki hâlini zaten ölçüyor.

**İş etkisi.** Ana veride ikiz kayıt; mükerrer paneli iş yükü, rapor bölünmesi.

**Öneri (2. tur için).** `decideCodeUniqueness` çağıran üç yolu da tx'e al ve **ilk ifade** olarak `lockCodeScopeTx(tx, scope, code)` çağır (Item'daki desenin kopyası). Bekçi: `test_item_code_case_uniqueness.ts` paralel sondasını fason/kategori için de koştur. Migration YOK (DB seddi kararı ayrı iş — CLAUDE.md 2026-08-22 "yumuşak kapı" politikası).
**Kabul kriteri.** Fason/kategori/BaseService kod yollarında `Promise.allSettled` paralel sondası tam 1 başarı.
**Efor:** 0,5 gün.
**Önceki defter:** ilgili id YOK. (K3b HOTSPOT H-6 ile aynı yer.)

---

### [D-A-13] Tek-process invariantının mekanik bekçisi yok — dev DB'de ÇİFT gece yedeği ölçüldü

| Şiddet | **S3** | Kategori | A.5 + A.7 | Öncelik | **P2** | Modül | Ops / Süreç | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Sistemin doğruluğu üç yerde belgeli bir invariant'a dayanıyor: **tek process**. Presence sayacı, feature-flag önbelleği, `reason-preset` senkron önbelleği, login lockout sayacı, yedek/DB-kopyası "koşuyor" bayrakları ve `latency-persist` kuyruğu process-local. Bu invariant'ın **hiçbir mekanik bekçisi yok** (`scripts/test_single_process.ts` yok); `instances` değeri değişirse hiçbir test kırmızı vermez ve arıza sessizdir. Dev DB'de invariant'ın kırıldığı an **ölçüldü**.

**Kanıt**
- Invariant belgeleri: `Teks-Erp/ecosystem.config.js:47-48` (`exec_mode:"fork"`, `instances:1`), `Teks-Erp/src/server.ts:22-34`, `Teks-Erp/ARCHITECTURE.md §10.3`.
- Bekçi yokluğu: `ls Teks-Erp/scripts | grep single_process` → **0**; `grep -rn "instances" Teks-Erp/scripts` → 0.
- Invariant'a dayanan durum (mutasyona uğrayan modül-seviyesi Map/Set taraması, jenerik-argüman tuzağı dahil):
  | Dosya | Tanımlayıcı | Bozulunca |
  |---|---|---|
  | `src/middlewares/login-lockout.ts:24` | `failCounts` | kilit N katına zayıflar (**güvenlik**) |
  | `src/lib/presence.ts` | `users`, `devices` | "kim online" parçalanır |
  | `src/middlewares/auth.middleware.ts:16` | `lastSeenWrites` | throttle N katı yazım |
  | `src/services/system-setting.service.ts:998,1004` | `featureFlagsCache`, `cacheGeneration` | bayrak toggle'ı diğer process'te 30 sn geç |
  | `src/services/reason-preset.service.ts:101` | `cache` | doğrulama bayat listeye düşer |
  | `src/services/backup.service.ts:162` | `running` | **çift pg_dump** |
  | `src/services/db-copy.service.ts` | `currentJob` | çift DB kopyası (DDL) |
  | `src/services/latency-persist.service.ts` | `pending` | metrik bölünür |
- Yerinde koruma (doğru): `login-lockout.ts:66-80` `await`siz senkron bölge; `latency-persist` SIGTERM flush'ı (`server.ts:161-164`).

**Çakışma senaryosu (ÖLÇÜLDÜ — dev DB)**
```sql
SELECT "createdAt", action, "newData"->>'file' FROM system_logs
WHERE action IN ('BACKUP_COMPLETED','BACKUP_FAILED') ORDER BY "createdAt" DESC;
```
```
2026-08-24 03:27:18.042  BACKUP_COMPLETED  tekserp_20260824_032716.dump
2026-08-24 03:27:18.034  BACKUP_FAILED     (dosya yok — rename ENOENT)
2026-08-23 03:14:24.752  BACKUP_COMPLETED  tekserp_20260823_031422.dump
2026-08-23 03:14:24.752  BACKUP_COMPLETED  tekserp_20260823_031423.dump   ← AYNI MİLİSANİYE
```
İki süreç aynı saniyede yedek aldı: bir turda ikisi de tamamlandı (iki dump dosyası), diğer turda biri diğerinin `.part` dosyasını yeniden adlandırdıktan sonra ikincisi ENOENT aldı. `running` bayrağı process-local olduğu için hiçbirini engellemedi.

**failure_mode.** Biri performans için `ecosystem.config.js`'te `instances: "max"` yaparsa: ① gece yedeği iki kez koşar, dosya adı **saniye çözünürlüklü** olduğu için (`backup.service.ts:222`) aynı ada yazan iki süreç `rename` yarışına girer ve o gecenin yedeği **sessizce kaybolabilir**; ② 5 denemeye ayarlı PIN kilidi fiilen 10 denemeye çıkar; ③ panelden kapatılan bir feature-flag diğer process'te 30 sn daha açık kalır; ④ DB kopyalama işi (uygulama içinden DDL!) iki kez başlayabilir. **Hiçbir test kırmızı vermez.**

**Veride fiili ihlal (K2).** Yukarıdaki dev DB ölçümü (2026-08-23 ve 2026-08-24). Saha kopyasında (`tekserp_saha_0825`) çift yedek izi **yok** (scheduler zaten `BACKUP_SCHEDULE_ENABLED=false`).

**Repro (K3).** Gerekmiyor — K2 zaten fiili ihlali gösteriyor.

**İş etkisi.** Bugün doğru çalışıyor; risk bir konfigürasyon satırının değişmesiyle **sessizce** aktifleşir ve ilk belirtisi kayıp yedek olur.

**Öneri (2. tur için).**
1. `scripts/test_single_process.ts`: `ecosystem.config.js`'i okuyup `exec_mode==="fork" && instances===1` doğrula; ayrıca `src/` genelinde `cluster`/`worker_threads` importu 0 olmalı. Ucuz, mekanik, invariant'ı **yazılı** hale getirir.
2. Boot'ta ikinci-instance tespiti: PID-lock dosyası ya da `pg_advisory_lock` (session-tipi, tek anahtar) ile "ben tekim" iddiası — ikinci süreç açılışta **fail-closed** dursun ya da en azından `/health`'e `multiInstanceDetected` bassın.
3. Yedek dosya adına PID/rastgele son ek (saniye çözünürlüğü yetersiz — `backup.service.ts:222`).
Migration YOK.

**Kabul kriteri.** `instances` 1'den farklı yapıldığında `test_single_process` kırmızı; ikinci process boot'ta duruyor ya da `/health` uyarıyor.
**Efor:** 0,5 gün (bekçi) + 0,5 gün (boot tespiti).
**Önceki defter:** ilgili id YOK. (K8 HOTSPOT 2/6 ile aynı yer.)

---

### [D-A-14] Yedek damgası işin BAŞINDA yazılıyor ama iş idempotent değil — patlayan yedek o gün bir daha denenmiyor

| Şiddet | **S3** | Kategori | A.5 | Öncelik | **P3** | Modül | Ops / Yedek | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** Beceri §6(2)'nin sınıfı: damga başta + iş idempotent DEĞİL. `setLastRun(now)` `runBackupJob`'tan **önce** yazılıyor; pg_dump patlarsa 15 dakikalık turlar "bu gece koşmuş" deyip atlıyor. Takas **bilinçli** (retry-spam önleme) ve `BACKUP_FAILED` audit'i yazıldığı için "sessiz atlama" DEĞİL — ama görünürlük yalnız audit tablosunda, hiçbir ekranda alarm yok.

**Kanıt**
- `Teks-Erp/src/jobs/backup-scheduler.ts:99-102`:
  ```ts
  const last = await getLastRun();
  if (last && last >= dueAt) return; // bu gece için zaten koşmuş
  // Damgayı ÖNCE yaz (retry spam'ini engeller — yukarıdaki gerekçe).
  await setLastRun(now);
  const result = await runBackupJob("nightly");
  ```
- Görünürlük: `backup.service.ts:191-195` `BACKUP_FAILED` audit'i; `job-failure.ts:34` `JOB_FAILED:<job>` kaydı.
- **Koruma yok teyidi:** başarısızlıkta damgayı geri alan kod yok (`grep -n "setLastRun" src/jobs/backup-scheduler.ts` → yalnız :53 tanım, :102 yazım); `/health`'te "son yedek yaşı" eşiği ölçülmedi (**kapsam dışı — OPS alanı**).
- Saha durumu: `Teks-Erp/ecosystem.config.js:107` `BACKUP_SCHEDULE_ENABLED:"false"` → scheduler sahada KAPALI, gece yedeğini Windows Görev Zamanlayıcı alıyor.

**failure_mode.** Ayar okuma başarılı → damga yazıldı → `pg_dump` diski dolu bulup patladı. `BACKUP_FAILED` audit'i düştü ama kimse bakmıyor; sonraki 15 dakikalık turların hepsi `last >= dueAt` görüp atlıyor. Ertesi geceye kadar **yedeksiz** kalınıyor ve bu ancak restore denemesinde fark ediliyor.

**Veride fiili ihlal (K2).** dev: `BACKUP_FAILED` 1 kayıt (2026-08-24 03:27:18, rename ENOENT — D-A-13'ün çift-process vakası); o gün ikinci bir başarılı yedek 8 ms sonra oluştuğu için veri kaybı olmadı. saha: `JOB_FAILED:%` **0**, `BACKUP_FAILED` **0**.

**Repro (K3).** Gerekmiyor (mantık bulgusu; zamanlayıcı sahada kapalı).

**İş etkisi.** Bugün saha etkilenmiyor (harici zamanlayıcı). Bayrak açan bir müşteride ya da dev'de bir gecelik yedek boşluğu.

**Öneri (2. tur için).** İki seçenekten birini **yazılı** seç: (a) başarısızlıkta damgayı geri al + en fazla N deneme sayacı (retry-spam yine sınırlı), ya da (b) damgayı SONA taşı + ayrı bir `backup.lastAttemptAt` ile spam'i sınırla. Ek olarak `/health`'e "son başarılı yedek yaşı > 26 saat" uyarısı (görünürlük ayağı — bulgunun asıl bedeli orada).
**Kabul kriteri.** Patlayan yedek aynı gece en az bir kez daha deneniyor **ya da** `/health` yedek yaşını uyarı olarak basıyor.
**Efor:** 0,5 gün.
**Önceki defter:** `F-OPS-VER-005` (düzeltildi — saat dilimi ayağı); damga ayağı açık. K8 HOTSPOT 1.

---

### [D-A-15] Etiket şablonu silme/pasifleştirme, bağlam varsayılanı atamasıyla çaprazlanıyor — kontrol havuzda, yazım tx'te, ikiz yok

| Şiddet | **S3** | Kategori | A.1 | Öncelik | **P3** | Modül | Etiket / Belge | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `hardDelete`/`deactivate` "bu şablon bir bağlamın varsayılanı mı" sorusunu **havuzdan pre-tx** soruyor; `setContextDefault` kendi tx'inde upsert yapıyor. İki taraf birbirini görmediği için, silinmekte olan şablon aynı anda varsayılan yapılabiliyor.

**Kanıt**
- `Teks-Erp/src/services/label-template.service.ts:533-540` (`deactivate`, tx YOK) ve `:572-580` (`hardDelete`):
  ```ts
  const asDefault = await prisma.labelContextDefault.findFirst({ where: { templateId: id } });
  if (asDefault || existing.isDefault) throw AppError.badRequest("Default template … önce başka bir template'i default yapın");
  ```
  → `Teks-Erp/src/services/label-template.service.ts:581-591` tx içinde `deletedAt` + `isActive:false` + `DEL-` yeniden adlandırma. **Tx içinde ikiz kontrol YOK.**
- `Teks-Erp/src/services/label-template.service.ts:996-1008` (`setContextDefault`) — kendi tx'i, `labelContextDefault.upsert`; `assertTemplateAssignable` **tx dışında** (`:993`).
- **Koruma yok teyidi:** iki yolda ortak kilit yok (`grep -n "pg_advisory" src/services/label-template.service.ts` → 0); `labelContextDefault` FK'sı `labelTemplate.deletedAt`'e bakmaz; claim yok.
- Sonuç fail-closed: silinmiş/pasif şablona işaret eden bağlamda baskı **404** verir (CLAUDE.md etiket kuralı: "seçili şablon silinmiş/pasifse baskı 404, yerleşiğe SAPMAZ").

**Çakışma senaryosu**
```
T1  hardDelete(X)                        T2  setContextDefault(ROLL_FINISHED, X)
    findFirst(labelContextDefault, X) → yok   findFirst(labelTemplate X, aktif) → var
                                              BEGIN; upsert(ROLL_FINISHED → X); COMMIT ✓
    BEGIN; X.deletedAt = now, isActive=false; COMMIT ✓
SONUÇ: ROLL_FINISHED bağlamının varsayılanı SİLİNMİŞ bir şablon.
       O bağlamdan yapılan her baskı 404 (fail-closed).
```

**failure_mode.** Büro personeli eski bir etiket şablonunu silerken bir diğeri onu "Bitmiş Top" bağlamının varsayılanı yapar. Tambur'da etiket basmaya çalışan operatör "şablon bulunamadı" hatası alır ve **hiçbir top etiketlenemez** — sebebi hiçbir ekranda yazmaz; düzeltme ancak Ayarlar → Etiketler'e girip başka bir şablon atamakla mümkündür.

**Veride fiili ihlal (K2).** `tekserp_saha_0825`: `labelContextDefault` satırlarının silinmiş/pasif şablona işaret edip etmediği bu turda sorgulanmadı — **kapsam dışı, sebep:** K2a "4 `isDefault=true` + 3 `LabelContextDefault` — iki kaynak" bulgusunu zaten kaydetmiş; ayrıştırma C/veri modeli alanının işi.

**Repro (K3).** Yazılmadı — olasılık çok düşük (iki admin, aynı şablon, aynı saniye), blast radius küçük ve fail-closed.

**İş etkisi.** Etiket baskısının bir bağlam için durması; üretim akışı kâğıtsız kalır.

**Öneri (2. tur için).** `hardDelete`/`deactivate` kontrolünü tx İÇİNE al ve claim'e çevir: `labelContextDefault.count({ where: { templateId: id } })` tx içinde tekrar → >0 ise 409; ayrıca `labelTemplate.updateMany({ where: { id, deletedAt: null }, … })` count kontrolü. `setContextDefault` tarafında da `labelTemplate` satırını tx içinde `updateMany({ where: { id, deletedAt: null, isActive: true } })` ile pin'le.
**Kabul kriteri.** Paralel sonda: `hardDelete(X) ∥ setContextDefault(k, X)` → biri 409; `labelContextDefault` asla silinmiş şablona işaret etmez.
**Efor:** 0,5 gün.
**Önceki defter:** ilgili id YOK. (K3b HOTSPOT H-8.)

---

### [D-A-16] `dbRestore.copies` JSON blob'unda oku-değiştir-yaz: serileştirme kuyruğu üç yazıcıdan yalnız birini kapsıyor

| Şiddet | **S3** | Kategori | A.2 (JSON lost update, beceri §3.3) | Öncelik | **P3** | Modül | Ops / DB kopyası | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `SystemSetting["dbRestore.copies"]` JSON'u oku→değiştir→**tümünü** geri yaz deseniyle güncelleniyor. Kod bu yarışı bilip bir süreç-içi kuyruk kurmuş (`copyRecordsWriteQueue`, "A8 2026-07-31 denetimi") ama kuyruk **yalnız `reverifyCopy`**'yi kapsıyor; `persistRecord` (kopya işinin ilerleme yazımı) ve `dropCopy` aynı blob'u kuyruk dışından yazıyor.

**Kanıt**
- `Teks-Erp/src/services/db-copy.service.ts:267-296` — `readCopyRecords` / `writeCopyRecords` (blob tamamen geri yazılıyor).
- Kuyruk — `Teks-Erp/src/services/db-copy.service.ts:795`:
  ```ts
  // A8 (2026-07-31 denetimi): kayıt dosyasının read-modify-write'ı süreç-içi
  // kuyrukla serileşir — aynı ada eşzamanlı iki verify birbirinin yazımını ezemez.
  let copyRecordsWriteQueue: Promise<unknown> = Promise.resolve();
  ```
- Kuyruk DIŞI yazıcılar — `Teks-Erp/src/services/db-copy.service.ts:474-478` (`persistRecord`) ve `:718-720` (`dropCopy`):
  ```ts
  const records = await readCopyRecords();
  records[name] = rec;                       // :476
  await writeCopyRecords(records, existing); // :478   ← kuyruk YOK
  ```
- Beceri §3.3'ün **üç koşulu birlikte** sağlanıyor: ① aynı satırın aynı JSON kolonu üç ayrı akıştan yazılıyor, ② yazımlar farklı anahtarlara (kopya adlarına) dokunuyor, ③ okuma ile yazma arasında `await` var (`listExistingDbNames()` — ayrıca `pg_database` sorgusu).
- **Koruma yok teyidi:** `jsonb_set` kullanılmıyor (`grep -rn "jsonb_set" src` → 0); `SystemSetting` satırında kilit/claim yok; `currentJob` claim'i yalnız **kopya işini** tekilleştirir, `reverifyCopy`/`dropCopy` ondan bağımsızdır.
- Kısmi telafi: `writeCopyRecords` `existingNames` ile budama yapıyor → **silinen** bir DB'nin kaydı geri gelmez; kayıp yalnız güncelleme/ekleme yönünde olur.

**Çakışma senaryosu**
```
T1  reverifyCopy(A)  [kuyrukta]          T2  dropCopy(B)  [kuyruk DIŞI]
    readCopyRecords() → {A:eski, B:var}      readCopyRecords() → {A:eski, B:var}
    records[A] = yeni doğrulama              delete records[B]
    …await listExistingDbNames()…            …await listExistingDbNames()…
    writeCopyRecords({A:yeni, B:var})        writeCopyRecords({A:eski})
SONUÇ (T2 sonra yazarsa): A'nın yeni doğrulama raporu KAYBOLUR (eski hâli döner).
```

**failure_mode.** Yönetici bir geri-yükleme kopyasını yeniden doğrularken (uzun iş) başka bir kopyayı siler. Doğrulama raporu blob'a yazılır, silme yazımı onu ezer: panel kopyayı hâlâ "doğrulanmadı/başarısız" gösterir, yönetici doğrulamayı tekrar koşturur. Veri kaybı **rapor düzeyindedir**, DB kopyalarının kendisi etkilenmez.

**Veride fiili ihlal (K2).** Aranmadı — **sebep:** blob'un geçmiş hâlleri saklanmıyor (audit'te `SystemSetting` yazımı `db-copy` yolunda **bilinçli olarak yok**: `:256-258` "`systemSettingService.set()` KULLANILMAZ").

**Repro (K3).** Yazılmadı — yan etkisi DDL (CREATE/DROP DATABASE); repro sözleşmesi "dış dünyaya giden yolları çağırma" diyor.

**İş etkisi.** Yalnız yönetici panelindeki kopya durum etiketleri; kurtarma yeteneğini etkilemez.

**Öneri (2. tur için).** Üç yazıcıyı da tek kapıdan geçir: `copyRecordsWriteQueue`'yu `writeCopyRecords`'un **içine** taşı (fonksiyon zaten tek nokta) — böylece yeni bir çağıran eklendiğinde koruma otomatik gelir. Alternatif/ek: `jsonb_set` ile sunucu tarafında anahtar bazlı yama. Kuyruğun **process-local** olduğu D-A-13 invariantına bağlı — yorumda yazılı olsun.
**Kabul kriteri.** `writeCopyRecords` çağrılarının tamamı serileşiyor; kuyruk dışı çağrı yolu kalmıyor.
**Efor:** 0,25 gün.
**Önceki defter:** 2026-07-31 denetiminin "A8" maddesi — **düzeltme kısmi uygulanmış**; bu satır onun tamamlayıcısıdır.

---

### [D-A-17] Barkod sayacı kilidi son-adım kapanışında tx'in kalanı boyunca tutuluyor — bilinçli takas, ama bedeli ölçülmedi

| Şiddet | **S4 (bilgi)** | Kategori | A.6 | Öncelik | **P4** | Modül | KK2 / Kurşun / KK1 | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|

**Özet.** `reserveRollBarcodes`'un kendi sözleşmesi "**BU FONKSİYON TX DIŞINDA ÇAĞRILMAK İÇİNDİR**" diyor ve tx-içi çağrının bedelini ölçmüş (1345 ms vs 39 ms). `finalizeRollsAtLastStep` bunu **bilerek** ihlal ediyor, çünkü hangi topların barkoda ihtiyacı olduğu ancak tx içinde biliniyor. Gerekçe kodda yazılı; bulgu, **takasın bedelinin bu çağrı yeri için ölçülmemiş olması**.

**Kanıt**
- Sözleşme + ölçüm — `Teks-Erp/src/services/helpers/roll-barcode.helper.ts:52-66`.
- Bilinçli ihlal — `Teks-Erp/src/services/helpers/roll-finalize.helper.ts:164-175`:
  ```
  ⚠️ REZERVASYON BİLİNÇLİ OLARAK TX'İN İÇİNDE KALDI, dışarı taşınmadı.
  Taşımak imkânsız: çağıranların ikisinde … `rollIds` listesi tx'in İÇİNDE hesaplanıyor
  ```
- Çağıranlar: `kursun-qc.service.ts:936` (`finishStep`), `kursun-bypass.service.ts:1399`.
- Kilidin cinsi — `roll-barcode.helper.ts:82-87` `INSERT … ON CONFLICT DO UPDATE` → `roll_barcode_counters` satır kilidi, COMMIT'e kadar.
- Kalan tx gövdesi: N × `roll.update` → `recomputeStepStatus` → `completeWorkOrderIfStepsDone` → refakat kartı fan-out.
- Kapsam sınırı (şiddeti düşüren): kilit anahtarı `(day, type)`; KK1 ham girişi genelde `H`, finalize çıktısı çoğunlukla `F` → çakışma **her zaman** değil, yalnız aynı tip barkod üretilen turlarda.

**failure_mode.** Kurşun/KK2'de 20 toplu bir adım kapanırken `(bugün, F)` sayaç satırı tx boyunca kilitli kalır; aynı anda Tambur'da depo topu kesen ya da kapanış dispozisyonu uygulayan bir işlem aynı tipte barkod isterse o kadar bekler. Ölçülmüş emsalde bekleme 1345 ms'ye çıkmıştı.

**Veride fiili ihlal (K2).** `tekserp_saha_0825` `roll_barcode_counters`: 38 satır, `max(n) = 262` (K12 ölçümü) — günlük hacim düşük, kapasite tavanına (9.999) uzak. Bekleme süresi ölçülmedi.

**Repro (K3).** Yazılmadı; ölçüm önerisi aşağıda.

**İş etkisi.** Gecikme (veri bozulması DEĞİL). Beceri §4.1 gereği kategori "veri-performans" tarafında.

**Öneri (2. tur için).** Düzeltme ÖNERİLMİYOR — takasın alternatifi (havuz client'ıyla tx-içi çağrı) ölçülerek **daha kötü** bulunmuş. Yapılacak iş **ölçüm**: `finishStep` son-adım dalında sayaç kilidinin tutulma süresini ölç (T1 = paralel `generateRollBarcode` bekleme süresi) ve 200 ms'yi aşarsa `finalizeRollsAtLastStep`'i iki faza böl (rollIds'i belirleyen okuma → tx dışı rezervasyon → yazma tx'i). Ölçüm bekçisi `test_barcode_reservation.ts`'in kardeşi olur.
**Kabul kriteri.** Ölçüm sayısı rapora yazılı; eşik aşılırsa faz ayrımı.
**Efor:** 0,5 gün (ölçüm).
**Önceki defter:** `F-CORE-VER-001` / `F-IST-ESZ-001` (düzeltildi) — bu, o düzeltmenin **bilinçli olarak kapsam dışı bırakılan** ayağı.

---

## Uygulanan kontrol listesi (Bölüm 3-A, satır 224-388)

| Madde | Durum | Not / bulgu |
|---|---|---|
| **A.1(a)** oku→karar→yaz, arada kilit/guard yok | **uygulandı** | K3a §6 (23 aday) + K3b §5 (13 aday) tek tek değerlendirildi; gerçek olanlar D-A-01/08/09/12/15; ayrıca MATRIX §D 30 kalemin tamamı gözden geçirildi (aşağıdaki "değerlendirildi, bulgu değil" listesi) |
| **A.1(b)** Prisma tespit grep'leri (`findUnique→update`, `{miktar: x}`, `increment/decrement`, `updateMany+count`) | **uygulandı** | `decrement` kullanımı guard'lı (`currentQty: { gte }`) — doğru; **mutlak** metraj yazımı yalnız `applyManualProperties`'te ve orada pin yok → D-A-01 |
| **A.1(b)** `FOR UPDATE` kullanımı | **uygulandı** | Tek yer `order.service.ts:2434` (silinecek satırlar, `= ANY(array)` sırası); kilit protokolü `touchOrderLinesTx` ile `updateMany` üzerinden kuruluyor → D-A-02/05 |
| **A.1(d)** çakışma zaman çizelgesi | **uygulandı** | Her yarış bulgusunda T1/T2 çizelgesi verildi |
| **A.2** lost update / optimistic locking | **uygulandı** | Şemada `version` alanı **yalnız** `PrintedDocument.version` ve `TravelerCard.version` (belge sürümü, kilit değil); `If-Match`/body-version **yok** → D-A-01 (top metrajı), D-A-02 (`shippedQty`), D-A-16 (JSON blob) |
| **A.3** izolasyon seviyesi çalıştırılarak | **uygulandı** | READ COMMITTED (KUNYE, çalıştırılarak); tek `isolationLevel` `shipping.service.ts:2610` (RepeatableRead, **salt-okuma** batch → doğru kullanım) |
| **A.3** write skew taraması | **uygulandı** | Üçlü koşul (türetilmiş invariant + phantom + izolasyon/kilit yok) arandı: `recomputeStepStatus` (3 sayım → statü) ve `completeWorkOrderIfStepsDone` **phantom'a açık** ama çağıranların 12'sinde WO satır kilidi var → koşul kırılıyor; **istisna** `tambur-undo` (D-A-10). "Tek aktif fiyat listesi / makine çakışması / rezervasyon toplamı" karşılıkları **N/A** (fiyat modülü, makine takvimi, rezervasyon yok — CLAUDE.md) |
| **A.3** `Serializable` + 40001 retry | **N/A + bulgu** | `Serializable` hiç kullanılmıyor; **40001/40P01 retry'ı da yok** → D-A-03 |
| **A.4** `$transaction` timeout/maxWait | **uygulandı** | Global `maxWait 5000 / timeout 20000` (`lib/prisma.ts`); tavansız döngü-içi yazma arandı: `roll-disposition.helper.ts:76` `DISPOSITION_MAX_ROLLS=200` ✓, `rollIds max(500)` ✓; **tavansız kalanlar** (`rollShipQtys` record, `batch.controller`, `kartela.controller`) → F/H alanına yönlendirildi |
| **A.4** tx içinde dış çağrı (HTTP/dosya/child) | **uygulandı, bulgu yok** | `grep -rnE 'fetch\(|axios\.|child_process|execFile\(|spawn\(|fs\.(promises\.)?(readFile|writeFile)|bcrypt|sharp\(' src/services` → tx callback'i içinde **0**; yazıcı/pg_dump/rclone yolları tx dışında (`AuditService` dahil hepsi tx sonrası) |
| **A.4** tx dışına taşan yazma (`prisma.` tx içinde) | **uygulandı** | Ham grep 30 aday verdi, dosya açılarak elendi: gerçek **tx-içi havuz yazımı 0**; tx-içi havuz **okuması** 2 (`workorder.service.ts:989`, `:1002/:5505`) → D-A-11. Ayrıca **tx-ÖNCESİ** kalıcı yazım 1 (`workorder.service.ts:3281`) → D-A-08 |
| **A.4** array vs interactive `$transaction` | **uygulandı, bulgu yok** | Array biçimi 2 yerde (`reason-preset.reorder`, `shipping.attachTotals`) — ikisinde de karar mantığı yok |
| **A.4** iç içe tx / `tx?` opsiyonel servisler | **uygulandı** | `tx?: …` deseni yalnız `system-setting.service` (58 okuyucu) + `customer-alias.service.ts:223`; çift-mod helper'ların **her çağrı yeri** K3a §4 / K3b §3'te (yer, client) çiftiyle listeli — atomik olması gereken yerde havuz geçen çağrı: `workorder-link.service.ts:564/:632` (`markTravelerCardDirtyTx(prisma)`, "fazla işaretlemek güvenli" yönünde → bulgu değil), `workorder.service.ts:5627` (→ D-A-09) |
| **A.4** havuz tükenmesi | **uygulandı** | `max 30` ↔ tx-içi ikinci bağlantı → D-A-11 |
| **A.4** tx içinde `Promise.all` | **uygulandı, bulgu yok** | **ESLint kuralı var** (`eslint.config.mjs:34-47`, `Promise.all/allSettled` + `tx` identifier); gövde taramasında ihlal 0 |
| **A.5** kaç process | **uygulandı** | Tek process (belgeli) → D-A-13 |
| **A.5** cron/tekil çalışma/overlap | **uygulandı** | Kütüphane yok, 3 periyodik iş; in-process `running`/`checking` bayrakları + 3sa watchdog; TTL/fencing **N/A** (dağıtık kilit yok) |
| **A.5** damga başta/sonda | **uygulandı** | archive SONDA + idempotent ✓; offsite damgasız + idempotent ✓; backup BAŞTA + idempotent DEĞİL → D-A-14 |
| **A.5** hata kalıcılığı | **uygulandı, bulgu yok** | `job-failure.ts:34` → `console.error` + `SystemLog` + `/health` sayacı; `test_observability_contract` AST bekçisi çıplak `console.error`ı yasaklıyor |
| **A.5** scheduler saat dilimi | **uygulandı, bulgu yok** | `cron.schedule` yok; backup `factoryDayStart` ile fabrika gününe bağlı (F-OPS-VER-005 düzeltmesi); archive/offsite mutlak-ms |
| **A.5** child process timeout | **uygulandı, bulgu yok** | TEK kapı `pg-tool.helper.ts:98-137` (`timeout` + `SIGKILL`); `verifyBackupFile` ayrı 30 sn `Promise.race` |
| **A.6** `MAX(no)+1` / "son kaydı bul +1" | **uygulandı** | 15 üretici `nextDailySeq` (max+1) kullanıyor, **kilitsiz** — ama **hepsinin hedef kolonu `@unique`** (şema doğrulandı: `orderNumber`, `workOrderNumber`, `shipmentNo`, `sackNo`, `dispatchNo`, `receiptNo`, `documentNo`, `cardNumber` …) + `withBarcodeRetry` P2002 telafisi. **Bilinçli istisna** `batchNumber` (unique KALDIRILDI, 8022 advisory kilidi tx'in İLK ifadesi — `batch.service.ts:126`). → **A.6 tek başına bulgu üretmedi**; ürettiği tek bulgu retry'ın kapsamı: D-A-07 |
| **A.6** sayaç tablosu + `FOR UPDATE`/guard | **uygulandı** | `roll_barcode_counters` `INSERT … ON CONFLICT DO UPDATE n = n + count RETURNING` (tek ifade, atomik) ✓ → tutulma süresi D-A-17 |
| **A.6** `autoincrement()` boşluk politikası | **uygulandı** | Kullanılmıyor (UUID PK); barkod boşluğu **bilinçli ve yazılı** (`roll-barcode.helper.ts:73-77`) |
| **A.6** sayaç anahtarı kırılımı (seri+yıl+şube) | **uygulandı** | Kırılım `PREFIX + GGAAYY` (gün) — şube/şirket kırılımı **N/A** (tek tenant, `Order.branchId` belge numarasına girmiyor); yıl dönümü sıfırlaması yok (gün bazlı, sarma sorunu yok) |
| **A.6** mevcut veride boşluk/mükerrer | **uygulandı** | K2b ölçümü: günlük belge sayaçlarında **0 boşluk**; mükerrer `@unique` ile yapısal olarak imkânsız; parti no mükerreri **bilinçli** (92 grup) |
| **A.6** e-Fatura ETTN/UUID | **N/A** | ERP fatura KESMEZ (CLAUDE.md); `invoiceNo` yalnız dış muhasebe izidir |
| **A.7** modül seviyesi mutable state | **uygulandı** | Jenerik-argüman tuzağını kapsayan tarama + mutasyon süzgeci koşuldu (12 taşıyıcı, tablo D-A-13'te) |
| **A.7** request context (ALS vs global) | **uygulandı, bulgu yok** | `src/lib/request-context.ts` `AsyncLocalStorage`; `req` **nesnesi** saklanıyor (alanlar sonradan doluyor — yorumda gerekçeli); global "current user" değişkeni **yok** |
| **A.7** `await` sonrası `res` durumu / yanıt sonrası iş | **uygulandı** | Tx bloklarında `res` kullanımı **0** (K6 ölçümü); yanıt sonrası devam eden tek iş `triggerManualBackup` (`void runBackupJob`) — 202 semantiği bilinçli |
| **A.7** fire-and-forget promise | **uygulandı** | 43 `void …` çağrısı; catch'siz olan **yok** (hepsi `.catch()` ya da içeride try/catch); `AuditService` best-effort sözleşmesi belgeli |
| **A.7** Prisma client tekil mi | **uygulandı, bulgu yok** | `src/lib/prisma.ts` singleton; `new PrismaClient` başka yerde 0 (ayrı `pg` bağlantısı yalnız DDL/dump helper'larında, bilinçli) |
| **A.8** invalidation ↔ commit sırası | **uygulandı, bulgu yok** | `invalidateFeatureFlagsCache()` upsert **sonrası** (`system-setting.service.ts:1067`) + `cacheGeneration` lost-invalidation guard; `refreshReasonPresetCache()` her yazımda tx COMMIT'inden sonra (`:386/:439/:485/:514`) |
| **A.8** cache anahtarında tenant | **N/A** | DB-per-müşteri, tenant kolonu yok |
| **A.8** in-memory cache çok instance | **uygulandı** | Tek process → §9.7 gereği "cluster'da bozulur" YAZILMADI; bulgu invariant'ın bekçisizliği → D-A-13 |

---

## Doğru yapılanlar (korunması gereken kalıplar)

1. **Atomik claim kültürü yerleşik ve yazılı.** `updateMany({ where: { id, beklenenDurum } })` + `count` kontrolü 60'tan fazla noktada; sınıflandırma K3b §5-L13'te. Özellikle `workorder.service.ts:4493` `updateManyAndReturn` seçimi — "kaybedilen id'leri yeniden sorgulama, RETURNING ile kazandığını al" — eşzamanlı ikinci bir attach'ın topunu kendi kümesine almayı yapısal olarak engelliyor ve gerekçesi kodda yazılı.
2. **Advisory kilitlerin SIRASI load-bearing kabul edilmiş ve kanıtlanmış.** Yedi namespace'in tamamında kilit, koruduğu okumadan ÖNCE ve çoğunda tx'in **İLK ifadesi** (8021 `inventory:844`, 8022 `batch:126`, 8023 `shipping:2159`, 8024 `session-registry:79`, 8025 `permission-management:609`, 8026 `item:237`, 8027 `merge:546`). 1-argümanlı form 0 kullanım ve bunu ölçen bir bekçi var (`test_shipment_scope_lock.ts:111-117`).
3. **`ESLint` ile eşzamanlılık kuralı zorlanıyor.** `eslint.config.mjs:34-47` `Promise.all/allSettled(tx.*)`i **derleme öncesi** yasaklıyor — bu, denetimin en sık bulduğu tuzağın (§9.2) mekanik olarak kapatılmış hâli. Gövde taramasında ihlal 0.
4. **Atomiklik gerekçeleri kodun yanında.** `inventory.service.ts:820-830` (KK1 kilit sırası + ABBA gerekçesi), `roll-barcode.helper.ts:52-77` (ölçümlü takas), `order-status.helper.ts:205-210` (kilit protokolü), `subcontractor.service.ts:2852-2855` (retry ↔ tx-dışı guard etkileşimi). Bu yorumlar denetimi hızlandırdı ve **iki bulgunun (D-A-02, D-A-07) tanımını doğrudan verdiler**: kural yazılı, uygulaması eksik.
5. **`utils/p2002.ts` — P2002'yi constraint'e göre ayırt eden tek kaynak.** Prisma+adapter'ın üç farklı meta kaynağını birleştirip regex'le test ediyor. Altı yolda doğru uygulanmış; D-A-07 yalnız eksik uygulama.
6. **Login lockout'un senkron bölgesi.** `login-lockout.ts:66-80`: ayar okuması bittikten sonra `await` YOK → N paralel istek seri işlenir ve eşik tam sayıda denemede kurulur. Node'un tek-thread modelini doğru kullanan az sayıda kalıptan biri; gerekçesi de yazılı.
7. **`reason-preset` önbelleği: bayat-serve + arka planda tazeleme + tek-uçuş.** Tek-uçuş **yalnız arka plana** ait, yazmalar kendi yazdıklarını görmek için doğrudan tazeliyor (`reason-preset.service.ts:132-147`). Cache invalidation'ın commit'ten sonra yapılması hem burada hem feature-flag'te doğru.
8. **`storno ∥ iade` yarışı gerçekten kapatılmış (K3a #15 hipotezi ELENDİ).** `undoDispatch` (`shipping.service.ts:2159`) 8023'ü tx'in ilk ifadesi olarak alıyor **ve** `resolveUndoBlockReason` (`:2040`) aktif iade varken stornoyu **reddediyor**. `cancelReturn` (`return.service.ts:879`) 8023'ü almasa da tutarsızlık üretemiyor: iade aktifken storno bloklanır, iade iptal edilip commit olduktan sonra top zaten `SHIPPED` döner ve stornonun `groupBy(preShipStatus)` yazımına dahil olur. **Haritadaki "iki tx de commit eder" hipotezi bu turda doğrulanamadı** — 2. tur bunu yeni kanıt olmadan yeniden açmasın.

---

## Sınır ötesi notlar

| Alan | Gözlem (dosya:satır) | Not |
|---|---|---|
| **B (idempotency)** | `inventory.service.ts:963-985` — `createInitialEntry` clientToken replay dalı `existing.status`'u **okumuyor** | İptal edilmiş/fire top için `success:true` + o topun kimliği döner (beceri §8 "en pahalı hata"). Kardeş yollar bunu yapıyor: `tambur-manual:1049/:1405` (`ENTRY_CANCELLED` 409), `subcontractor:2362` (`RECEIPT_CANCELLED` 409). Saha'da 227 CANCELLED/SCRAP top `clientToken` taşıyor = replay yüzeyi. **Yarış değil, sözleşme boşluğu → B'nin işi.** |
| **B** | `kartela.service.ts:281` (`dispatch`) ve `:609` (`receive`) `clientToken` **taşımıyor** | Mobil retry mükerrer sevk/makbuz üretebilir; ancak `dispatch`te roll claim (`:323`, `status WAREHOUSE` guard) ikinciyi 409'a düşürüyor → koruma dolaylı ama gerçek. `receive`te aynı güvence doğrulanmadı. |
| **B** | `return.service.ts` `createReturn` `clientToken` YOK (≤200 toplu iade) | Koşullu flip (`status: SHIPPED` guard) ikinci yazımı keser → mükerrer iade defteri satırı doğmaz; ama istemci "başarısız mı" bilemez. |
| **C (veri modeli)** | `Roll.currentQty ≤ initialQty` için DB CHECK **bilinçli olarak yok** | D-A-01'in kalıcı hâle gelmesinin sebebi bu; CHECK eklemek 2 mevcut ihlal satırı yüzünden migration'ı düşürür (CLAUDE.md §13). Kısıt kararı C/J alanının. |
| **C** | `SackAllocation` unique'i `(sackId, orderLineId)` — **PLANNED sevkiyatlar arasında çift tahsis engellenmiyor** | D-A-02'nin defter tarafı; "PLANNED rezerv değildir" kararının doğal sonucu (MATRIX §A). Ürün kararı → E. |
| **D (tx sınırları)** | `workorder.service.ts:3281` (D-A-08), `subcontractor.service.ts:1539-1554` (`bulkDispatchStep` SEPARATE, `failed[]` YOK), `order.service.ts:3129-3135` (`cancelWithActions`, telafi yok) | Üçü de "tx-dışı çok adımlı orkestrasyon"; D-A-08'i eşzamanlılık tetiklediği için burada yazdım, diğer ikisi saf tx-sınırı bulgusu. |
| **E (iş kuralı)** | `order.service.ts:500` ve `workorder-link.service.ts:463` — WO `type` flip'i `targetItemId not null` guard'sız | Kardeş yollar (`:2838`, `:3248`) guard'lı. "Hedef kumaşsız WO STOK olamaz" değişmezi iki kapıdan biri açık. Yarış değil, asimetri. |
| **E** | `kursun-qc.reopenStep` `SCRAP → IN_PRODUCTION` kenarı statü matrisinde belgesiz | K10 H-4; fire karnesi + `finalizedAt` trigger'ıyla çelişebilir. |
| **F (API)** | `subcontractor.controller.ts:77` `rollShipQtys: z.record(uuid, number)` **tavansız** | Tx bütçesi (20 sn) ve kilit süresi doğrudan bu tavana bağlı; eski `max(300)` kabul şeması değişince düştü (K12 F-FAS-ESZ-002). |
| **G (güvenlik)** | `login-lockout.ts` sayacı process-local | D-A-13'ün güvenlik ayağı: `instances>1` brute-force penceresini ikiye katlar. |
| **H (performans)** | `item.service.ts:240` — 8026 kilidi altında **tüm ürün tablosu** `findMany` | Kilit süresi tablo büyüdükçe uzar (218 kod bugün); D-A-12 düzeltmesi diğer üç modele de aynı deseni taşıyacaksa önce sorgu daraltılmalı. |
| **I (gözlemlenebilirlik)** | Deadlock `unclassified: true` audit'iyle 500 dönüyor (D-A-03) | `/health` sayacına düşmüyor; deadlock oranı ölçülemiyor. |
| **J (migration)** | `order_lines.cancelledAt` saha kopyasında YOK (190/195) | D-A-05'in `cancelOrderLine` yolu prod'da henüz canlı değil; deploy sırası "backend/migration ÖNCE" pazarlık dışı. |
| **K (test)** | 8024 (oturum defteri) ve 8027 (merge) advisory kilitlerinin **hiçbir eşzamanlılık bekçisi yok** | Kilit yanlış yere taşınsa/silinse test paketi yeşil kalır (`grep advisory scripts/test_session_registry.ts` → 0). "grep → koruma var" tuzağının tam karşılığı. |
| **K** | `test_kk1_duplicate_guard.ts` bayrağı **açarak** ölçüyor | Bayrak varsayılan KAPALI (`kk1.duplicateGuardEnabled`) → sahadaki fiili yol (guard kapalı, kilit hiç alınmıyor) bekçisiz. |
| **L (kod kalitesi)** | `workorder-clone.helper.ts:31` `generateWorkOrderNumberTx` yazılmış ama **hiç kullanılmıyor** (D-A-11); `traveler-card.reprint` hiçbir istemciden çağrılmıyor | İki ölü/ikiz üretici. |
| **L** | `error.middleware.ts:514-522` P2034 dalı bugünkü sürücüde **ulaşılamaz kod** | D-A-03'ün kod-kalitesi ayağı. |

---

## Kapsanmayan / erişilemeyen

1. **Canlı prod'a erişim YOK.** Tüm K2 ölçümleri `tekserp_saha_0825` (2026-08-25 kopyası, 190/195 migration) ve dev `adnansahin_db` üzerinde. Son 5 migration'ın kolonları saha kopyasında yok (`order_lines.cancelledAt` dahil) → D-A-05'in canlı erişilebilirliği doğrulanamadı.
2. **Repro yazılmayan bulgular ve sebepleri:** D-A-04/05/06/07/08/09/10/12/15/16. Ortak sebep: fixture zinciri (iş emri + rota + istasyon + fason firma + sevk + toplar + parti) tek script için sözleşmedeki 2 dakika bütçesini aşıyor; D-A-16 için ek sebep, yolun DDL (`CREATE/DROP DATABASE`) tetiklemesi ve sözleşmenin "dış dünyaya giden yolları çağırma" kuralı. Bu bulguların **mekanizması** D-A-03'ün ölçtüğü genel deadlock/hata haritasıyla ya da doğrudan kod alıntısıyla kesinleştirildi; hiçbiri "muhtemelen" cümlesine dayanmıyor.
3. **Zamanlama/gecikme ölçümü yapılmadı** (kilit tutulma süresi, tx süresi, havuz doygunluğu): D-A-11 ve D-A-17'nin bedeli **ölçülmedi**, mevcut kod yorumlarındaki ölçümlere (`roll-barcode.helper.ts:56-64`) atıf yapıldı. 2. tur için ölçüm önerileri ilgili bulgularda yazılı.
4. **Bekçi scriptlerinin gövdeleri okunmadı** (366 `test_*.ts`). "Bekçi var/yok" ifadeleri K11 envanterinden ve hedefe yönelik grep'lerden (`grep -n advisory scripts/test_session_registry.ts` gibi) türetildi; hiçbir bekçi kırılarak doğrulanmadı (kör nokta denetimi K alanının).
5. **Ölçülmeyen sorgular:** D-A-05 için çok kalemli sipariş sayısı; D-A-08 için "sevki olmayan `IN_PRODUCTION` + `SUBCONTRACTOR_RETURN`" taraması; D-A-12 için katlanmış-kod ikizi taraması (fason/kategori); D-A-15 için `labelContextDefault` → silinmiş şablon taraması. Hepsi 2. turda ucuz sorgularla kapatılabilir; sebep süre.
6. **Prisma `P2039` kodunun resmî anlamı doğrulanmadı** — ölçüm `40P01` mesajını taşıdığını gösteriyor, ama aynı kodun başka SQLSTATE'leri de kapsayıp kapsamadığı (dolayısıyla "P2039 → 409" eşlemesinin güvenli olup olmadığı) test edilmedi. Bu yüzden öneri **SQLSTATE tabanlı** tespit; kod tabanlı değil.
7. **Windows/pm2 kapanış davranışı** (IPC `shutdown`, `kill_timeout 8000` ↔ tx `timeout 20000`) yalnız koddan okundu; darwin ortamda test edilemez. Uzun bir tx sırasında `pm2 restart` gelirse ne olduğu (D-A-13'ün kardeşi) **ölçülmedi** — OPS alanına.
8. **`getCurrent` lazy-init, `traveler-card.recordPrintEvent`, `printed-document.reissue`** yolları okundu ama bulgu yazılmadı: hepsinde ya P2002+winner-read (doğru desen) ya da claim var; belgeli sınırlar (`traveler-card.service.ts:340-347`) bilinçli. Belge sürümü yarışları **BLG/belge alanına** ait.
