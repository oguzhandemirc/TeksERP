# Veri Bütünlüğü Denetimi — Rapor

> **Tarih:** 2026-07-31 · **Tarama:** Sonnet 5 (Bölüm B + C-liste + E) · **Doğrulama:** Fable 5 (Bölüm A/D/F/G + tarama bulgularının adversarial teyidi + Bölüm E sorgularının dev DB'de salt-okunur koşumu).
>
> Bu dosya salt-okunur analiz sonucudur; hiçbir kod veya şema değişikliği yapılmadı. Düzeltmeler onay sonrası ayrıca uygulanacak (denetim talimatı Kural 5).

---

## Doğrulama Sonuçları — Özet

Taramanın 8 aday bulgusundan **6'sı doğrulandı, 2'si çürütüldü** (kod bizzat okunarak):

| Aday | Karar | Kanıt |
|---|---|---|
| `startCopyJob` TOCTOU | ✅ **DOĞRULANDI** | `if (currentJob)` (369) → `await listDbCopies()` (385, gerçek DB sorguları) → atama (405). Pencere gerçek. |
| `deactivateUser` son-admin guard'ı | ✅ **DOĞRULANDI** | `assertNotLastActiveAdmin` (569-590) iki ayrı `findFirst`, sonra tx'siz `update` (609) — atomik hiçbir şey yok. |
| `quickOrderFromRolls` token opsiyonel | ✅ **DOĞRULANDI** (daraltılmış) | Zod `optional()` (order.routes.ts:604); kodun kendi yorumu itiraf ediyor (1692-1695). **Ama** tek bilinen istemci (mobil `HizliSiparisScreen.tsx:48`) token'ı doğru üretiyor (`useState(generateClientUuid)` — ekran başına bir kez) → aktif bug değil, sertleştirme eksiği. |
| `Sack`/`Shipment` clientToken yok | ✅ **DOĞRULANDI** | `shipping.service.ts`'de "clientToken" hiç geçmiyor (grep boş). Veri bozulmaz (atomik claim'ler tx'i geri sarar), etki mükerrer boş çuval / retry'de kör 409. |
| `RollError` create dedup'suz | ❌ **ÇÜRÜTÜLDÜ** | Migration `20260623100000`: partial unique `(rollId,startMeter,defectTypeId) WHERE defectTypeId IS NOT NULL` + P2002→409; her iki `reportError` da `defectTypeId`'yi **zorunlu** alıyor (tambur.service.ts:1524, kursun-qc.service.ts:397) → partial her zaman devrede; `test_db_invariants.ts:100` mekanik koruyor. |
| `Route.duplicateNameField` tanımsız | ❌ **ÇÜRÜTÜLDÜ** | `route.service.ts:56`: `duplicateNameField: "name"` — tanımlı. |
| hardDelete guard boşlukları ×3 | ✅ **DOĞRULANDI** | Item: `/:id/permanent` ucu canlı (item.routes.ts:249), serviste override yok. Customer: guard listesi order/shipment/return/branch/sack (366-374) — Route yok. Device: yalnız machineId+workSession (272-291) — PeripheralDevice sayımı yok. |
| `username` case yarışı | ✅ **DOĞRULANDI** (Düşük) | App kontrolü `mode:"insensitive"` (417-421), DB `@unique` case-sensitive (schema:273) — eşzamanlı "Depocu"/"depocu" ikisi de geçebilir. |

Bölüm B'deki `tambur.routes.ts:167 report-error` ve `route.routes.ts:97` satırları ile Bölüm C'deki genel liste bu kararlarla birlikte okunmalıdır — **çürütülen iki satır bulgu DEĞİLDİR**.

---

## Bölüm A — Doğrulanmış Bulgular

Format: `[Kategori] | Dosya:satır | Tetikleyen senaryo | Etki | Önem | Düzeltme`

**A1 — [race-condition] | `Teks-Erp/src/services/permission-management.service.ts:569-613` (`deactivateUser` + `assertNotLastActiveAdmin`)**
Tetikleyen: Sistemde tam 2 aktif `admin:users` sahibi varken ikisi birbirini (veya iki istek aynı anda ikisini) pasifleştirirse — her iki istek de guard'da "diğeri hâlâ aktif" görür, ikisi de geçer. Etki: **aktif kullanıcı-yöneticisi kalmaz**; kullanıcı yönetimi kilitlenir (kurtarma = DB'ye elle müdahale). Önem: **Yüksek** (yetki-kritik; tetiklenme olasılığı düşük ama sonuç ağır). Düzeltme: işlemi tek tx'e al + tx başında `SELECT pg_advisory_xact_lock(hashtext('admin-guard'))` (admin-yetki mutasyonları nadir → serileşme maliyeti sıfıra yakın); pasifleştirmeyi `updateMany WHERE {id, isActive:true}` ile claim'le, **kilit altında** kalan aktif admin sayımını yap, 0 ise throw → rollback. Not: yalnız tx-içi sayım YETMEZ (Read Committed'da iki tx birbirinin commit'ini görmeden sayar) — advisory lock şart. Aynı kilit `setUserPermissions`'ın F253 admin-coverage guard'ına da (permission-management.service.ts:364) uygulanmalı — aynı sınıf pencere.

**A2 — [race-condition] | `Teks-Erp/src/services/db-copy.service.ts:368-417` (`startCopyJob`)**
Tetikleyen: İki yakın-eşzamanlı `POST /api/admin/db-copies` — ilk istek `await listDbCopies()`'te beklerken (385; `probeCapabilities` + `pg_database`/`pg_stat_activity` sorguları) ikinci istek `currentJob===null` görür. Etki: iki paralel `runCopyJob` → aynı saniyede aynı `copyName` ile `CREATE DATABASE` çakışması, farklı saniyede iki paralel `pg_restore`'un disk I/O'yu boğması; `finishJob` state'i birbirini ezer. Önem: **Orta** (admin-only uç, tek kullanıcı senaryosunda çift-tık yeter). Düzeltme: `backup.service.ts:184-206` deseniyle birebir — `currentJob = {phase:"queued",...}` atamasını fonksiyonun İLK satırlarına (hiçbir `await`'ten önce) al; sonraki doğrulamalardan biri başarısız olursa `currentJob = null` geri sar. Node tek-thread olduğundan senkron kontrol+atama arası pencere yoktur.

**A3 — [non-idempotent-write] | `Teks-Erp/src/routes/order.routes.ts:604` + `order.service.ts:1692-1698` (`quickOrderFromRolls`)**
Tetikleyen: Tümü-WAREHOUSE toplarla token'sız çağrı + timeout-retry (toplar zaten WAREHOUSE olduğundan STOCK-claim bloğu atlanır, `create()` token'sız replay'i ayıramaz). Etki: birebir aynı satırlı **ikinci sipariş** (görünür, iptal edilebilir — ama sipariş/karşılanma rakamlarını düzeltilene dek şişirir). Önem: **Orta** (tek bilinen istemci token'ı doğru gönderiyor; risk token'sız/gelecek istemcide). Düzeltme: Zod'da `clientToken`'ı zorunlu yap (`z.string().uuid()`); önce Electron tarafında bu ucu çağıran ekran var mı grep'le (mobil hazır: `HizliSiparisScreen.tsx:48,92`).

**A4 — [non-idempotent-write] | `Teks-Erp/src/services/shipping.service.ts:157` (`openSack`), `:1263` (`createShipment`)**
Tetikleyen: Mobil paketleme ekranında çuval açarken / sevkiyat kurarken ağ timeout'u + retry. Etki: `openSack` → mükerrer **boş** çuval (gürültü; boş çuval silinebilir, veri bozulmaz); `createShipment` → retry hep 409 (çuvallar ilk — başarılı ama yanıtı kaybolmuş — denemede claim'lendi), operatör sevkiyatın kurulduğunu listeden bulmak zorunda. Önem: **Orta** (bütünlük değil, saha UX + kayıt gürültüsü). Düzeltme: iki modele de `clientToken String? @unique @db.Uuid` (ADD COLUMN — kırıcı değil) + create başında P2002 replay (WorkOrder'daki `resolveCreateTokenReplay` deseni); istemciler token'ı mantıksal deneme başına bir kez üretir.

**A5 — [cascade-misconfiguration] | üç hardDelete guard boşluğu**
(a) `item.routes.ts:249` + `base.service.ts:802-836`: `ItemService` hardDelete override etmiyor; `WorkOrder.targetItemId` FK'sı `ON DELETE SET NULL` → P2003 fırlamaz. Tetikleyen: hiç top/sipariş satırı üretmemiş ama planlı bir WO'nun hedeflediği kumaş kalıcı silinirse. Etki: WO'nun "ne üretiyorduk" izi sessizce null'lanır. (b) `customer.service.ts:359-390`: guard Route saymıyor (`Route.customerId` SET NULL) — siparişsiz/şubesiz yeni müşterinin özel rotası sessizce genel rotaya döner. (c) `device.service.ts:272-291`: PeripheralDevice saymıyor (SET NULL + `DevicePeripheral` Cascade) — tablete bağlı terazi/yazıcı bağı sessizce silinir. Önem: **Orta** (üçü de nadir ama sessiz). Düzeltme: üç guard'a eksik sayımları ekle; kalıcı çözüm için Prisma DMMF'den "bu modele point eden SetNull/Cascade ilişkiler ↔ guard listesi" karşılaştıran kardeş test (`test_db_invariants.ts` yanına).

**A6 — [missing-check] | 11 eksik CHECK constraint (Bölüm C-D tablosu)**
Tetikleyen: uygulama katmanındaki herhangi bir hesap hatası / gelecekteki yeni yazma yolu negatif-sıfır metraj yazarsa. Etki: özellikle `SackAllocation.qty` (shippedQty defterinin TEK kaynağı) ve `RollMovement.qtyIn/qtyOut` (istasyon muhasebesi) sessizce bozulur. Önem: **Orta** (bugün ihlal yok — dev DB koşumu §3/§13 temiz; bunlar gelecek seddi). Düzeltme: Bölüm C-D tablosundaki 11 constraint, mevcut desenle (`NOT VALID` + `VALIDATE`, migration başına `SET statement_timeout=0`) + her biri `test_db_invariants.ts` `CHECK_CONSTRAINTS` listesine.

**A7 — [race-condition] | `permission-management.service.ts:417-421` + kardeşleri (username / şablon adı case yarışı)**
Tetikleyen: eşzamanlı iki createUser "Depocu"/"depocu" — app kontrolü insensitive, DB unique sensitive → ikisi de INSERT olur. Etki: app'in çakışık saydığı iki hesap. Önem: **Düşük** (tekil admin paneli, gerçek eşzamanlılık çok düşük). Düzeltme: acil değil; kalıcı istenirse normalize gölge kolon (`usernameLower` generated + unique) — `citext` eklentisi Allowed Packages/kurulum ayak izini büyütür, önerilmez.

**A8 — [lost-update] | `system-setting.service.ts:731` (`setDocumentsLogo`), `db-copy.service.ts:773` (`reverifyCopy`)**
Read-modify-write, tx/kilit yok. Etki: eşzamanlı iki farklı yazımda biri kaybolur; ikisi de yeniden denemeyle düzelir. Önem: **Düşük**. Düzeltme: fırsat düştüğünde tx-içi taze okuma; öncelik değil.

**A9 — [ghost-prevention] | `jobs/backup-scheduler.ts:35-85`, `archive-scheduler.ts:27-77` (watchdog yok)**
`checking`/`running` boolean'ı senkron-güvenli AMA iş sonsuza asılırsa bayrak hiç düşmez → scheduler **sessizce kalıcı devre dışı** (yedek alınmamaya başlar, alarm yok). Önem: **Orta** (tetiklenmesi nadir; sonucu — yedeksiz kalmak — ağır ve görünmez). Düzeltme: koşum başlangıç damgası + N saat aşımında zorla bayrak düşür + `/health` sayacına "scheduler stuck" metriği.

**A10 — [race-condition] | `order.service.ts:1735` (`update`) yalnız-header PATCH yolu — CONFIRMED + DÜZELTİLDİ (2026-07-31)**
Doğrulandı: satır değişiminde tx-içi taze kontrol vardı (F144) ama yalnız-header PATCH'te `tx.order.update` koşulsuzdu — pre-tx durum okuması ile commit arasında eşzamanlı cancel/manual-close/kısmi-sevk araya girerse müşteri/şube/termin yazımı terminal duruma sızıyordu. Düzeltme: header yazımı `updateMany WHERE {id, status: pre-tx-status}` claim'i + count 0 → 409. PARTIAL_SHIPPED dalı (yalnız `deadline`) bilinçli kapsam dışı — tanımsal alan. Önem: Düşük/Orta.

---

## Bölüm B — Idempotency Haritası

*(general-purpose ajanı tarafından üretildi; ~60 yazma ucu tarandı, dosya:satır teyitli)*

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|

**TAMBUR — kesim/finalize (kritik akış)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `tambur.routes.ts:396` POST `/:id/cut-warehouse` → `tambur.service.ts:1774` `cutWarehouseRoll` | Evet | `clientToken` (satır 1795) + `Roll.clientToken @unique` → P2002 yakalanıp mevcut child+parent idempotent dönüyor (1999-2020) | `clientToken` (mevcut) | Kalıcı |
| `tambur.routes.ts:323` POST `/:id/cut` → `tambur.service.ts:2305` `cutOpenFabric` | Evet | Aynı desen: `clientToken` (2319) + P2002 catch (2527-2540) | `clientToken` (mevcut) | Kalıcı |
| `tambur.routes.ts:248` POST `/finalize` → `tambur.service.ts:499` `finalize` | Evet | clientToken yok ama gerekmiyor: `TAMBUR_CONSUMED` ön-kontrolü (608-610) + tx içi atomik claim `tx.roll.updateMany({status:IN_PRODUCTION,currentStepId})` (792-799, count===0 ayrımı 800-813) | Yok — durum kendisi anahtar | N/A |
| `tambur.routes.ts:369` POST `/:id/finalize-open-fabric` → `tambur.service.ts:2591` | Evet | Aynı desen: pre-check (2632) + atomik claim (2715-2721) | Yok | N/A |
| `tambur.routes.ts:421` POST `/:id/finalize-warehouse-cut` → `tambur.service.ts:2065` | Evet | Aynı desen: pre-check (2089) + atomik claim (2154-2156) | Yok | N/A |
| `tambur.routes.ts:167` POST `/report-error` → `tambur.service.ts:1519` `reportError` | ~~Kısmi — bulgu~~ **Evet — doğrulamada ÇÜRÜTÜLDÜ** | DB partial unique `roll_errors_roll_meter_defect_uq` (migration 20260623100000, `WHERE defectTypeId IS NOT NULL`) çift-tıkta P2002→409 üretir; `defectTypeId` her iki reportError'da da zorunlu → koruma her zaman devrede; `test_db_invariants.ts:100` mekanik izliyor | Mevcut partial unique | Kalıcı |

**KURŞUN/QC2 (kritik akış)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `kursun-qc.routes.ts:114` POST `/complete-qc2` → `kursun-qc.service.ts:277` | **Evet — en iyi örnek** | `tx.rollOperation.upsert` bileşik doğal anahtarla (`rollId_workOrderStepId_operationType`, 311-328) — gerçek dedup | Mevcut bileşik unique | Kalıcı |
| `kursun-qc.routes.ts:217` POST `/finish-step` → `kursun-qc.service.ts:597` | Evet | Açık movement yoksa idempotent success (623-632) | Yok | N/A |
| `inventory.routes.ts:790` POST `/:id/kursun-finish` → `inventory.service.ts:3260` | Evet | Roll artık PROCESS_QC'de değilse önceki `QC2_COMPLETED` aranıp idempotent dönüyor (3315-3338) | Yok | N/A |
| `kursun-qc.routes.ts:250` `/reopen-step`, `:154` `/report-error` | DOĞRULANMALI | Tam okunmadı; `report-error` Tambur'daki dedup riskini taşıyabilir | — | — |

**REFAKAT KARTI (kritik akış)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `traveler-card.routes.ts:39` POST `/` → `traveler-card.service.ts:138` `print` | Evet | `TravelerCard.workOrderId @unique` — P2002 → idempotent 409/yanıt (149-155) | `workOrderId` | Kalıcı |
| `traveler-card.routes.ts:71` `/reprint` → `:182` | Evet | Aynı desen (219-223) | `workOrderId` | Kalıcı |
| `traveler-card.routes.ts:186` `/scan` → `:292` | **Kısmi — bilinçli istisna** | Kod içinde belgeli check-then-act: aynı kart+istasyon+tip son 10 sn içindeyse cached dönüyor (340-364); pencere dışı teorik çift-yazım append-only log için kabul edilebilir | Mevcut pencere yeterli | 10 sn sabit |
| `traveler-card.routes.ts:273` `/:id/void` → `:245` | Evet | Atomik claim (262) | Yok | N/A |

**ÇUVAL / DEPO (kritik akış)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `shipping.routes.ts:57` `/sacks/:id/scan` → `shipping.service.ts:411` `scanIntoSack` | Evet | Doğal idempotent "zaten bu çuvalda" (438-440); atomik claim (469-473) | Yok | N/A |
| `shipping.routes.ts:54` `/sacks` → `:157` `openSack` | **Hayır — bulgu (düşük risk)** | `Sack`'te `clientToken` yok; `sackNo` sunucu sıralı üretir — retry'de boş mükerrer çuval açılabilir (silinebilir, veri bozulmaz) | `clientToken` eklenmeli (Roll/Order/WorkOrder paritesi) | Kalıcı |
| `shipping.routes.ts:59` `/sacks/:id/weigh` → `:818` | Evet (atama semantiği) | Overwrite + `touchWarehouseSackTx` atomik guard (896-907) | Yok | N/A |
| `shipping.routes.ts:60` `/sacks/:id/customer` → `:252` | Evet | Atomik claim (307-311) | Yok | N/A |
| `shipping.routes.ts:94` `/sacks/:id/notes` → `:1491` | Evet (bilinçli, guard'sız) | Annotation — `touchWarehouseSackTx` KASITLI uygulanmıyor | Yok | N/A |
| `shipping.routes.ts:132` `/split`, `:100` `/distribute`, `:222` `/add-sacks`, `:230` `/cancel` | DOĞRULANMALI | `touchWarehouseSackTx`/`touchShipmentPlannedTx` deseniyle tutarlı varsayıldı, satır satır teyit edilmedi | — | — |

**SEVKİYAT (kritik akış)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `shipping.routes.ts:216` `/shipments` → `:1263` `createShipment` | **Hayır — bulgu (orta önem)** | `Shipment`'ta `clientToken` yok; race/retry'de veri BOZULMAZ (çuval claim `tx.sack.updateMany`, 1288-1292, kaybeden 409 + tx geri sarılır) ama retry "aynı sonucu tekrar dön" idempotency'si yok, hep 409 | `clientToken` + P2002 replay | Kalıcı |
| `shipping.routes.ts:228` `/dispatch` → `:1578`/`1511` | Evet | Atomik claim `tx.shipment.updateMany({status:PLANNED})` (1517-1528) + kilit altı hayalet-top guard (1539-1552) | Yok | N/A |
| `:230` `/cancel`, `:222` `/add-sacks` | DOĞRULANMALI | Tam okunmadı | — | — |

**FASON sevk/kabul (kritik akış)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `subcontractor.routes.ts:41` `/dispatch` → `:406` | Kısmi — heuristik + atomik yedek | Heuristik (491-518) kendi check-then-act penceresi taşır AMA asıl güvenlik ağı `tx.roll.updateMany` (AT_SUBCONTRACTOR claim) — iki top aynı anda claim edilemez | `clientToken` eklenirse heuristik penceresi kapanır | Kalıcı |
| `subcontractor.routes.ts:257` `/receive` → `:1916` | Kısmi — aynı desen | Tam-küme eşleşen makbuz cached (1950-1990); tx-içi atomik claim asıl bütünlüğü sağlıyor | `clientToken` önerilir | Kalıcı |
| `:421` `/direct-ship`, `:478` `/undo-transfer`, `:541` `/receipts/:id/cancel` | Evet | Çok katmanlı atomik claim, hepsi count-kontrollü | Yok | N/A |
| `:78` `/dispatch/bulk`, `:113` `/transfer-next` | DOĞRULANMALI | Tam okunmadı | — | — |

**KARTELA dispatch/receive**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `kartela.routes.ts:41` `/dispatch` → `:174`, `:205` `/receive` → `:469` | Kısmi — aynı heuristik+atomik-yedek deseni (subcontractor ile birebir) | `KartelaDispatch`'te clientToken **bilinçli yok** (task notu) | Opsiyonel: `clientToken` eklenirse heuristik penceresi kapanır | Kalıcı |
| `kartela.routes.ts:158` `/stock/reduce` → `:1309` | Evet — tasarım gereği | `SwatchStockReduction.clientToken @unique` + P2002 catch (1327-1331, 1374-1376) | `clientToken` (mevcut) | Kalıcı |
| `:58` `/dispatches/:id/cancel`, `:265` `/receipts/:id/cancel`, `:284` `/rolls/:id/mark` | DOĞRULANMALI | Tam okunmadı | — | — |

**İŞ EMRİ (WorkOrder) — kritik akış**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar | Saklama süresi |
|---|---|---|---|---|
| `workorder.routes.ts:191` `/:id/manual-move` → `workorder-manual-move.service.ts:450` | Evet | Atomik claim (526-537) + "hedef zaten burada" no-op guard (508-510) | Yok | N/A |
| `workorder.routes.ts:645` `/:id/complete` → `workorder.service.ts:2868` | Evet | Atomik claim `tx.workOrder.updateMany({status:IN_PROGRESS})` (2928-2939) — TÜM dispozisyon bu claim'e bağlı | Yok | N/A |
| `workorder.routes.ts:351` POST `/` → `:447` `create` | Evet | `clientToken` (740) + P2002 replay payload-kimlik kontrollü (`resolveCreateTokenReplay`, 859-872) | `clientToken` (mevcut) | Kalıcı |
| `workorder.routes.ts:387` `/quick-start` → `:927` | Evet | `clientToken` pre-check (945-951) + `create()`'in replay'ini miras alıyor; zero-attach telafisi hardDelete + log (1073-1077) | `clientToken` (mevcut) | Kalıcı |
| `inventory.routes.ts:692` `/:id/rescue-stuck` → `:3112` | Evet | Atomik claim (3199) | Yok | N/A |
| `inventory.routes.ts:445` `/initial-entry`, `:734` `/open-fabric` | Evet | `clientToken` + P2002 catch (593-601 / 2995-3000) | `clientToken` (mevcut) | Kalıcı |

**PARTİ (Batch)**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor |
|---|---|---|
| `batch.routes.ts:37` `/move-rolls` → `:221`, `:59` `/merge` → `:428` | Evet | Kilit-önce+taze-okuma / çok katmanlı atomik claim |
| `batch.routes.ts:86` `/:batchId/split` → `:718` | Evet (doğal) | clientToken yok ama retry doğal engellenir (rulolar artık kaynak batch'te değil) |

**SİPARİŞ / İADE**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor | Önerilen anahtar |
|---|---|---|---|
| `order.routes.ts:563` POST `/` → `:1428` | Evet | `clientToken` + P2002 replay payload-kimlik kontrollü (1500-1560) | `clientToken` (mevcut) |
| `order.routes.ts:592` `/quick-from-rolls` → `:1603` | **Kısmi — bulgu** | STOCK top yolunda atomik claim (1671-1690) var, ama WAREHOUSE top yolunda TEK koruma `clientToken` — route şemasında **opsiyonel** | `clientToken`'ı zorunlu yap |
| `order.routes.ts:651` PATCH `/:id` → `:1735` `update` | **Kısmi — düşük/orta bulgu** | Satır değişimi tx-içi taze kontrollü (1910-1921) ama yalnız-header PATCH'te durum yeniden doğrulanmıyor | tx başında taze status re-check |
| `return.routes.ts:72` POST `/` → `:197` | Evet (dolaylı) | `tx.roll.updateMany({status:SHIPPED})` flip'i doğal dedup anahtarı (319-332) | Yok |

**OTURUM (Work Session)**

| Yol | Idempotent mi? | Nasıl |
|---|---|---|
| `work-session.routes.ts:35` `/` → `:171` `open` | Evet | Partial-unique index'ler (`work_sessions_active_machine_uq`, `_device_uq`, migration 20260702121000) + P2002→409 |
| `:46` `/close`, `:134` `/force-close` | Evet | Doğal idempotent updateMany / atomik claim |

**ETİKET / BELGE, MASTER-DATA CRUD, ADMIN ALTYAPI, JOB'LAR**

| Yol (dosya:satır) | Idempotent mi? | Neden değil / nasıl korunuyor |
|---|---|---|
| `label-template.routes.ts` (create/update/set-default/vb.) | Evet | `isDefault`/`isPrimary` `tx.updateMany` ile atomik demote + P2002 |
| `printed-document.routes.ts:216` `/reissue` | Evet | Atomik claim + `@@unique(docType,sourceId,version)` |
| `color.routes.ts`, `defect-type.routes.ts`, `item.routes.ts` vb. → `base.service.ts` `autoCode` | Evet | `withBarcodeRetry` + backend-authoritative kod `@unique` |
| Aynı satırlar — **`name` alanı** | **Bilinçli kabul edilmiş bulgu** | `assertNameNotDuplicate` check-then-act, DB'de `name` unique KASITLI yok |
| `route.routes.ts:97` POST `/` → `route.service.ts:185` | ~~Hayır — bulgu~~ **Doğrulamada ÇÜRÜTÜLDÜ** | `route.service.ts:56`'da `duplicateNameField: "name"` tanımlı — app-level dedup çalışıyor (diğer master-data ile aynı bilinçli desen) | Mevcut yeterli |
| `customer-branch.routes.ts:75` → `:103` | **Hayır — bulgu** | `CustomerBranch`'te `name`/`code` için `@@unique` yok | `@@unique([customerId, code])` (code doluyken) |
| `admin.routes.ts:116` `/users` → `permission-management.service.ts:398` | Kısmi | `username` case-insensitive app-check ama DB unique case-sensitive — "Depocu"/"depocu" ikisi de geçebilir | citext veya normalize gölge kolon |
| `admin.routes.ts:193` `/users/:id/deactivate` → `:598` (`assertNotLastActiveAdmin`) | **Hayır — orta/yüksek bulgu** | Tamamen check-then-act, tx/atomik claim yok — tam 2 aktif admin varken eşzamanlı iki pasifleştirme sistemi adminsiz bırakabilir | `updateMany WHERE {id,isActive:true}` sonrası tx-içi kalan-aktif-admin sayımı |
| `item.routes.ts:167` `/quick-create` → `item.service.ts:272` | Kısmi (yükseltilmiş risk) | Ad-mükerrer app-level only; bu uç mobil KK1'de (yoğun kullanım) çağrılıyor — çift-tık olasılığı daha yüksek | Bilinçli kabul, izlenmeli |
| `device.routes.ts:26` `/api/devices/announce` → `:139` | Evet (model örnek) | Gerçek `upsert` (`deviceId @unique`) | Mevcut |
| `feature-flag.routes.ts:313` `/documents-logo` → `system-setting.service.ts:731` | Kısmi (düşük etki) | Read-modify-write, tx yok — iki eşzamanlı farklı logo yüklemesi lost-update olabilir | tx içi SELECT FOR UPDATE veya DB-side JSON merge |
| `db-copy.routes.ts:77` `/api/admin/db-copies` → `db-copy.service.ts:368` `startCopyJob` | **Hayır — ÖNEMLİ BULGU** | `if(currentJob)` kontrolü (369) ile `currentJob={...}` ataması (405) arasında gerçek `await listDbCopies()` (385, DB sorguları) var — iki yakın-eşzamanlı istek ikisi de `currentJob===null` görebilir → paralel `runCopyJob`; `copyName` saniye-hassasiyetli damga kullandığından aynı saniyede çakışma riski | Atama `await`'lerden ÖNCE senkron yapılmalı (backup.service.ts deseniyle birebir) veya `pg_try_advisory_lock` |
| `admin.routes.ts:1134` `/backup` → `backup.service.ts:312` (guard `:184-206`) | Evet | Modül-seviyesi `running` boolean, kontrol-set arası `await` yok → Node event-loop'ta güvenli senkron guard | Mevcut yeterli |
| `jobs/backup-scheduler.ts`, `jobs/archive-scheduler.ts` `runIfDue` | Evet (tek-instance için) | Senkron `checking`/`running` boolean guard; **kalıntı risk:** iş sonsuza asılırsa guard hiç `false` olmaz → scheduler kalıcı devre dışı kalır, alarm yok | Watchdog/timeout önerilir (düşük öncelik) |

**Notlar / açık noktalar (DOĞRULANMALI, tam okunmadı):** `kartela.routes.ts:58,265,284`, `subcontractor.routes.ts:78,113`, `kursun-qc.service.ts:827,392`, `shipping.service.ts:730,640,1398,1645`, `permission-management.service.ts:364` `setUserPermissions`.

---

## Bölüm C — Şema Eksikleri (Tarama)

*(general-purpose ajanı tarafından üretildi; schema.prisma tamamı + ilgili servisler okundu, migration SQL bu aşamada YAZILMADI — yalnız liste)*

### A. missing-unique

```
[RouteStep.sequence] | schema.prisma:770-798 (@@index 791) | missing-unique
Aynı rotada iki adım aynı sequence'a sahip olabilir — DB seddi yok. Kardeş model
WorkOrderStep aynı durumu @@unique([workOrderId, stepSequence]) (1452) ile DB'de
kilitliyor, RouteStep'te eşdeğer yok. Bugünkü tek yazma yolu (route.service.ts:111-118,
in-memory Set ile tam-değiştir) güvenli görünüyor; risk gelecekteki ikinci bir yazma
yolunda ortaya çıkar. DOĞRULANMALI.
```

### B. missing-fk-behavior

```
[WorkOrder.targetItemId] | schema.prisma:1311 | missing-fk-behavior
items.id → work_orders.targetItemId FK'sı ON DELETE SET NULL (migration
20260525174522:1456, 20260611084953:1933). item.service.ts hardDelete'i override
etmiyor → base.service.ts:802-836 generic hardDelete, tek koruma catch(P2003)
(814-824) — SET NULL olduğu için P2003 fırlamaz. Bir WorkOrder tarafından
hedeflenmiş Item kalıcı silinirse "ne üretiyorduk" izi sessizce kaybolur. Order için
AYNI SINIF hata zaten düzeltilmiş (order.service.ts:2105-2111 yorumu bunu açıkça
anlatıyor) — Item'da yapılmamış.
```

```
[Route.customerId] | schema.prisma:753 | missing-fk-behavior
customers.id → routes.customerId ON DELETE SET NULL. customer.service.ts:359-390
hardDelete order/shipment/rollReturn/branch/sack sayıyor (366-374, yorum bizzat
"sacks_customerId_fkey artık ON DELETE SET NULL, guard EXPLICIT olmalı" diyor —
Sack için düzeltilmiş) ama listede Route yok. Siparişi/şubesi/çuvalı olmayan yeni
müşterinin özel varsayılan rotası varsa, hardDelete geçer ve Route sessizce
"genel" rotaya döner.
```

```
[PeripheralDevice.deviceId] | schema.prisma:605 | missing-fk-behavior
devices.id → peripheral_devices.deviceId ON DELETE SET NULL. device.service.ts:271-291
hardDelete yalnız machineId + workSession sayısını kontrol ediyor,
prisma.peripheralDevice.count() hiç çağrılmıyor. Tablete bağlı donanım varsa,
tablet kalıcı silindiğinde PeripheralDevice.deviceId sessizce null'lanır ve
DevicePeripheral pivot'u Cascade (656) ile silinir.
```

```
[Color / FabricProperty ilişkileri — tutarsız onDelete] | schema.prisma:3132 (StationColor),
2925 (CustomerColorAlias), 3150 (StationProperty) | missing-fk-behavior
Color'a point eden 8 ilişkiden 6'sı (Roll.color, OrderLine.color, WorkOrder.targetColor,
Swatch.color, RollReturn.color, ItemAllowedColor) onDelete belirtilmemiş → default Restrict;
yalnız StationColor + CustomerColorAlias açıkça Cascade. Şu an inert (Color için
permanent-delete ucu yok, grep "colorHardRemove" boş) ama ileride eklenirse
ItemAllowedColor Restrict ile blokluyorken StationColor/CustomerColorAlias sessizce
silinecek. Aynı asimetri FabricProperty'de: StationProperty Cascade, diğer 5 kardeş
Restrict.
```

```
[SackAllocation.sackId vs Roll.sackId/Swatch.sackId] | schema.prisma:2676 | missing-fk-behavior (DOĞRULANMALI, düşük öncelik)
SackAllocation.sack onDelete:Restrict açıkça yazılmış+gerekçeli; Roll.sackId (1018)
ve Swatch.sackId (2191) için onDelete belirtilmemiş (default Restrict de olsa niyet
açık yazılmamış) — yalnız şema-seviyesi tutarsızlık, servis tarafı kontrol edilmedi.
```

### C. nullable-should-be-not-null (koşullu — CHECK ile ifade edilmeli)

```
[WorkOrder.targetItemId / targetColorId] | schema.prisma:1311-1312 | nullable-should-be-not-null
Şemanın kendi yorumu (1309-1310): STOCK_PRODUCTION'da targetItemId zorunlu. Üç ayrı
call-site (workorder.service.ts:539, 3752-3753, 4083) aynı kuralı elle tekrarlıyor —
DB seddi yok. Öneri: CHECK (type <> 'STOCK_PRODUCTION' OR "targetItemId" IS NOT NULL).
```

```
[Roll.currentStepId vs status=IN_PRODUCTION] | schema.prisma:939,913 | nullable-should-be-not-null (DOĞRULANMALI)
"IN_PRODUCTION iken currentStepId dolu olmalı" örtük invariant'ı var gibi görünüyor
ama iki alan arasında DB seviyesinde bağ yok. Manuel taşıma/Kurtar akışlarındaki
ara-durum geçişlerinin bunu ihlal edip etmediği DOĞRULANMADI — CHECK önerisinden
önce workorder-manual-move.service.ts + inventory.service.ts rescueStuckRoll
satır satır izlenmeli (yanlış pozitif riski var).
```

### D. missing-check (negatif/sıfır olmaması gereken alanlar)

Mevcut durum: `scripts/test_db_invariants.ts:121-129` zaten 7 CHECK'i mekanik koruyor
(`rolls_currentQty_nonneg`, `rolls_initialQty_nonneg`, `rolls_weightKg_nonneg`,
`order_lines_quantity_pos`, `order_lines_shippedQty_nonneg`, `sacks_weightKg_nonneg`,
`work_order_steps_time_order`, migration `20260708120000_faz4_db_constraint_hardening`).
Aşağıdakiler bu envanterde YOK — aynı desenin (`NOT VALID`+`VALIDATE`, aynı test dosyasına
yeni satır) devamı olarak eklenmeli:

| Model.alan | schema.prisma:satır | Öneri |
|---|---|---|
| `RollMovement.qtyIn/qtyOut/weightIn/weightOut` | 1765-1768 | `qtyIn >= 0`, `qtyOut IS NULL OR qtyOut >= 0`, aynısı weight için |
| `RollError.startMeter` | 1582 | `>= 0` |
| `SackAllocation.qty` | 2673 | `> 0` (OrderLine.shippedQty'nin TEK yazma kaynağı, kendisi CHECK'siz) |
| `WorkOrderToOrderLine.allocatedQty` | 1469 | `>= 0` |
| `SubcontractorDispatchItem.dispatchedQty/dispatchedWeight` | 1879-1880 | `> 0` / `IS NULL OR >= 0` |
| `KartelaDispatchItem.dispatchedQty/dispatchedWeight` | 2284-2285 | aynısı |
| `KartelaReceiptItem.kartelaCount` | 2340 | `> 0` |
| `SwatchStockReduction.count` | 2221 | `> 0` |
| `RollReturn.qty` | 2704 | `> 0` |
| `SubcontractorDirectShipAllocation.qty` | 1907 | `> 0` |
| `DirectShipment.totalQty/rollCount` | 1945-1946 | `> 0` / `> 0` |

**Not:** Prisma native CHECK desteklemiyor — tümü raw-SQL migration gerektirir. Sistemik gözlem: `guarded-hard-remove.ts` ailesi ve model-özel `hardDelete` override'ları (Customer/Item/Device) her biri kendi "bu modele point eden FK'ler" listesini elle tutuyor; Prisma DMMF'den türetilmiş bir "referans eden tüm ilişkiler ↔ guard listesi" karşılaştırma testi (mevcut `test_db_invariants.ts`'e kardeş) sistemik kör noktayı kalıcı çözer.

**Kapsam dışı bırakılanlar (bilinçli, tekrar raporlanmadı):** ad-mükerrer koruması (Item/Color/Customer/Subcontractor.name — Bölüm B'de ayrıca not edildi), `KartelaDispatch.clientToken` yokluğu, `SystemLog` best-effort/tx-dışı yazım, soft-delete istisnaları, WO kapanış dispozisyonunun `RollOperationType`'a yeni değer eklememesi.

---

## Bölüm E — Doğrulama Sorguları

Mevcut `Teks-Erp/scripts/consistency-check.sql` (§1-§7c) zaten şunları kapsıyor: `OrderLine.shippedQty`/`Order.shippedQty` defter mutabakatı, negatif miktar backstop'u, Roll↔Sack↔Shipment tutarlılığı, `shipment_orders.isActive` drift, çuval seq/shipmentId tutarlılığı, hayalet çuval içeriği (§7), sevk+kartela/fason çift-sayım (§7b), iptal kartela hâlâ çuvalda (§7c). **Aşağıdakiler bu dosyada YOK — `consistency-check.sql`'e §8+ olarak eklenmesi önerilir.**

Tüm sorgular salt-okunur `SELECT`. Üretim kuralları gereği canlı DB'de değil, yedek/kopya üzerinde veya read-only bağlantıyla çalıştırılmalı (kök `CLAUDE.md`).

```sql
\echo ''
\echo '== 8) Barkodsuz satılabilir top (WAREHOUSE/A1_STOCK ama barcode NULL) =='
\echo '   (satır varsa: finalize/dispozisyon barkod atamayı atlamış)'
SELECT id, status, "currentQty", "updatedAt"
FROM rolls
WHERE status IN ('WAREHOUSE','A1_STOCK') AND barcode IS NULL;

\echo ''
\echo '== 9) SHIPPED top ama çuvalı yok / çuvalın sevkiyatı DISPATCHED değil =='
SELECT r.id, r.barcode, r.status, r."sackId", s."shipmentId", sh.status AS sevk_durumu
FROM rolls r
LEFT JOIN sacks s ON s.id = r."sackId"
LEFT JOIN shipments sh ON sh.id = s."shipmentId"
WHERE r.status = 'SHIPPED'
  AND (r."sackId" IS NULL OR sh.status IS DISTINCT FROM 'DISPATCHED');

\echo ''
\echo '== 10) IN_PRODUCTION top ama currentStepId NULL veya bağlı WO CANCELLED/SUPERSEDED =='
\echo '   ("canlı ama kimsenin okutamadığı" çıkmaz — CLAUDE.md manuel taşıma notu)'
SELECT r.id, r.barcode, r.status, r."currentStepId", wos."workOrderId", wo.status AS wo_durumu
FROM rolls r
LEFT JOIN work_order_steps wos ON wos.id = r."currentStepId"
LEFT JOIN work_orders wo ON wo.id = wos."workOrderId"
WHERE r.status = 'IN_PRODUCTION'
  AND (r."currentStepId" IS NULL OR wo.id IS NULL OR wo.status IN ('CANCELLED','SUPERSEDED'));

\echo ''
\echo '== 11) Açık movement + top artık orada değil / top ölü statüde (hayalet movement) =='
SELECT rm.id AS movement_id, rm."rollId", r.barcode, r.status AS top_durumu,
       rm."workOrderStepId", r."currentStepId", rm."enteredAt"
FROM roll_movements rm
JOIN rolls r ON r.id = rm."rollId"
WHERE rm."exitedAt" IS NULL
  AND (r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED')
       OR r."currentStepId" IS DISTINCT FROM rm."workOrderStepId");

\echo ''
\echo '== 12) Kapanmış movement''ta qtyOut <> qtyIn =='
\echo '   (2026-07-30 kuralı: "qtyOut = qtyIn" — commit `64263fc`. DOĞRULANMALI: kesin cutover.'
\echo '    Cutover''dan ÖNCEki satırlar beklenen/bilinen sapma olabilir, ayrı değerlendir.)'
SELECT rm.id, rm."rollId", rm."workOrderStepId", rm."qtyIn", rm."qtyOut", rm."exitedAt"
FROM roll_movements rm
WHERE rm."exitedAt" IS NOT NULL
  AND rm."qtyOut" IS DISTINCT FROM rm."qtyIn"
ORDER BY rm."exitedAt" DESC;

\echo ''
\echo '== 13) currentQty > initialQty (top yalnız kesimle azalır, artamaz) =='
SELECT id, barcode, "initialQty", "currentQty", status
FROM rolls
WHERE "currentQty" > "initialQty";

\echo ''
\echo '== 14) Yarım fason kabul (SUBCONTRACTOR_CONSUMED ama receipt''ten doğan açık-kumaş çocuk yok) =='
SELECT r.id AS tuketilen_top_id, r.barcode, r."updatedAt",
       sr.id AS receipt_id, sr."receiptNo"
FROM rolls r
JOIN subcontractor_receipt_items sri ON sri."newRollId" = r.id
JOIN subcontractor_receipts sr ON sr.id = sri."receiptId" AND sr."cancelledAt" IS NULL
WHERE r.status = 'SUBCONTRACTOR_CONSUMED'
  AND NOT EXISTS (SELECT 1 FROM rolls child WHERE child."parentReceiptId" = sr.id);

\echo ''
\echo '== 15) AT_SUBCONTRACTOR top ama açık (iptal edilmemiş) fason sevk kaydı yok =='
SELECT r.id, r.barcode, r."updatedAt"
FROM rolls r
WHERE r.status = 'AT_SUBCONTRACTOR'
  AND NOT EXISTS (
    SELECT 1 FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    WHERE sdi."rollId" = r.id AND sd."cancelledAt" IS NULL
  );

\echo ''
\echo '== 16) TravelerCard''sız iş emri (kart WO açılışında doğar — 1 WO = 1 kart) =='
SELECT wo.id, wo."workOrderNumber", wo.status, wo."createdAt"
FROM work_orders wo
LEFT JOIN traveler_cards tc ON tc."workOrderId" = wo.id
WHERE tc.id IS NULL;

\echo ''
\echo '== 17) Açık (isProcessed=false) RollError ama top ölü/emekli statüde =='
SELECT re.id AS hata_id, re."rollId", r.barcode, r.status, re."detectedAt"
FROM roll_errors re
JOIN rolls r ON r.id = re."rollId"
WHERE re."isProcessed" = false
  AND r.status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED','SCRAP');

\echo ''
\echo '== 18) Master-data ad mükerrer (aktif kayıtlar, case/boşluk-duyarsız) =='
\echo '   (DB unique bilinçli yok — bkz. Bölüm B; bu sorgu yalnız GÖZLEM, otomatik düzeltme önerilmez)'
SELECT 'items' AS tablo, lower(trim(name)) AS ad, COUNT(*), array_agg(id) AS kayitlar
FROM items WHERE "isActive" = true GROUP BY 1 HAVING COUNT(*) > 1
UNION ALL
SELECT 'colors', lower(trim(name)), COUNT(*), array_agg(id)
FROM colors WHERE "isActive" = true GROUP BY 1 HAVING COUNT(*) > 1
UNION ALL
SELECT 'customers', lower(trim(name)), COUNT(*), array_agg(id)
FROM customers GROUP BY 1 HAVING COUNT(*) > 1
UNION ALL
SELECT 'subcontractors', lower(trim(name)), COUNT(*), array_agg(id)
FROM subcontractors WHERE "isActive" = true GROUP BY 1 HAVING COUNT(*) > 1
UNION ALL
SELECT 'routes', lower(trim(name)), COUNT(*), array_agg(id)
FROM routes GROUP BY 1 HAVING COUNT(*) > 1;

\echo ''
\echo '== 19) Sevk/fason snapshot toplamları vs. gerçek kalem toplamı (denorm drift) =='
SELECT 'subcontractor_dispatches' AS tablo, sd.id, sd."totalQty" AS kayitli,
       COALESCE(SUM(sdi."dispatchedQty"), 0) AS hesaplanan
FROM subcontractor_dispatches sd
LEFT JOIN subcontractor_dispatch_items sdi ON sdi."dispatchId" = sd.id
GROUP BY sd.id, sd."totalQty"
HAVING sd."totalQty" <> COALESCE(SUM(sdi."dispatchedQty"), 0)
UNION ALL
SELECT 'direct_shipments', ds.id, ds."totalQty", COALESCE(SUM(dsa.qty), 0)
FROM direct_shipments ds
LEFT JOIN subcontractor_direct_ship_allocations dsa ON dsa."directShipmentId" = ds.id
GROUP BY ds.id, ds."totalQty"
HAVING ds."totalQty" <> COALESCE(SUM(dsa.qty), 0);
```

### Dev DB Koşum Sonuçları (2026-07-31, salt-okunur — sözdizimi kanıtı + sinyal sınıflandırması)

12 sorgunun tümü dev DB'de (`adnansahin_db`) hatasız koştu. Dört sorgu satır döndürdü, dördü de sınıflandırıldı:

| Sorgu | Dev sonucu | Sınıflandırma |
|---|---|---|
| §10 IN_PRODUCTION-stuck | 7 (hepsi `currentStepId NULL`) | **Sorgu amacına uygun** — bunlar tam olarak "Kurtar" (rescueStuckRoll) hedef popülasyonu; dev'de test artığı. Üretim koşumunda çıkanlar operatöre Kurtar ile temizletilir. |
| §12 qtyOut≠qtyIn | 1 (exitedAt 2026-07-30 02:05, 800→700) | **Cutover-öncesi kalıntı** — commit `64263fc` (qtyOut=qtyIn kuralı) tam bu bug'ın düzeltmesi; satır fix-öncesi damgalı. Üretim koşumunda fix'in deploy anı eşik alınmalı. |
| §15 AT_SUBCONTRACTOR sevksiz | 147 (hepsi "hiç-sevksiz", Temmuz) | **Dev seed artefaktı** — `seed-demo-stations.ts` / `seed-load-scale.ts` statüyü doğrudan yazıyor, dispatch kaydı üretmiyor. Üretimde (seed koşmaz) sorgu anlamlı. |
| §16 kartsız WO | 417 (386 `TS`+7 `TE` test-öneki; 24 gerçek İE, hepsi 2026-07-30) | **Kod yolu sağlam** — kart, `create()` tx'inde koşulsuz doğuyor (workorder.service.ts:803; serviste TEK `workOrder.create` çağrı noktası var). TS/TE = doğrudan-prisma test/seed WO'ları; 24 İE = 2026-07-30 test koşularının temizlik artığı (test kartı silmiş, WO silme yarıda kalmış). Üretim sorgusu `wo."createdAt" >= '2026-07-14'` (kart-redesign cutover) eşiğiyle koşulmalı; üretimde çıkan her satır gerçek anomali olur. |

Diğer 8 sorgu (barkodsuz satılabilir top, SHIPPED-çuvalsız, hayalet movement, currentQty>initialQty, yarım fason kabul, açık hata+ölü top, ad mükerrer, snapshot drift) dev'de **0 satır** — hem sözdizimi hem invariant'ın bugünkü temizliği doğrulandı.

**Notlar:**
- §12'nin cutover tarihi (2026-07-30 fix) net değil — commit tarihi ile deploy tarihi farklı olabilir. Üretim koşumunda satır çıkarsa `exitedAt` dağılımına bakıp fix'ten öncesi/sonrası ayrılmalı.
- §19'daki `subcontractor_direct_ship_allocations."directShipmentId"` kolon adı grep ile teyit edildi (schema.prisma:1911) — nullable, `DirectShipment` entity'sinden ÖNCEki eski kayıtlarda NULL kalabilir; bu satırlar sorguda hiçbir gruba join olmaz (beklenen davranış, drift değil).
- §16 tüm work_orders'ı tarar (yalnız aktif değil) çünkü tasarım gereği kart WO açılışında doğuyor — geçmiş/kapanmış WO'larda da kart beklenir.

---

## Bölüm D — Transaction Sınırları

Atomik olması gerekip olmayan bloklar (doğrulanmış) ve bilinçli-kabul edilen sınırlar:

1. **`deactivateUser` (permission-management.service.ts:598-624) — SINIR YOK, olmalı.** Bugün: `findUnique` → iki ayrı guard `findFirst` → `update` → registry revoke → audit; hepsi ayrı bağlantılarda. Doğru sınır: tx, `assertNotSelfDeactivation` SONRASI başlamalı ve **advisory lock + claim + kilit-altı sayım + update**'i kapsamalı; `revokeAllForUser` ve audit tx DIŞINDA kalmalı (mevcut best-effort davranış doğru). Aynı sınır `setUserPermissions` F253 guard'ı için de geçerli.
2. **`startCopyJob` (db-copy.service.ts:368-417) — DB tx'i değil process-state sınırı.** Kilit görevi gören `currentJob` ataması async pencerenin arkasında; sınır "ilk senkron satır" olmalı (A2).
3. **`quickOrderFromRolls` (order.service.ts:1657-1700) — BİLİNÇLİ bölünmüş sınır, DOKUNMA.** Claim tx'i commit edilir, `create()` ayrı tx'te koşar. Kod bunu F143 yorumuyla belgeliyor ve create'in fırlatabileceği tüm doğrulamaları claim'den ÖNCE koşarak pencereyi mitigate ediyor. Tek kalıntı koruma A3'teki token zorunluluğu.
4. **`setDocumentsLogo` / `reverifyCopy` — read-modify-write tx'siz** (A8, Düşük).
5. **Audit tx dışında** — bilinçli tasarım (root CLAUDE.md); bulgu değil, Bölüm D envanterinde tamlık için.

Bunların dışında incelenen kritik akışların tümünde (Tambur finalize/kesim, WO complete/dispozisyon, dispatch, fason kabul-iptal, batch merge) sınırlar doğru: tek tx + atomik claim + kilit-altı taze guard deseni tutarlı uygulanmış.

---

## Bölüm F — Regresyon Testleri (Kritik/Yüksek/Orta bulgular için)

Mevcut sözleşmeye uygun (`scripts/test_*.ts`, `npx tsx`, kendi fixture'ını kurar, ortam verisine bağımlı değil, `finally` cleanup + `process.exit`):

1. **`test_last_admin_race.ts` (A1):** İki `TEST-` kullanıcısına `admin:users` ver, diğer tüm admin fixture'larından bağımsız çalışması için guard'ı bu ikiliyle sınırlı kur (pencere parametresi). `Promise.all` ile ikisini çapraz `deactivateUser` et (service-level paralellik — tx-içi `Promise.all` yasağı kapsamına girmez). Beklenti: **en az biri 409**, sonda aktif admin sayısı ≥ 1. Fix öncesi kırmızı, sonrası yeşil.
2. **`test_db_copy_single_start.ts` (A2):** `startCopyJob`'u aynı anda iki kez çağır (küçük dummy yedek dosyasıyla; `runCopyJob`'u mock'lamak için job fonksiyonunu enjekte edilebilir yap ya da yalnız guard'ı ayrı fonksiyona çıkarıp onu test et). Beklenti: tek `started:true`.
3. **`test_quick_order_token.ts` (A3):** WAREHOUSE'da iki `TEST-` topu yarat → `quickOrderFromRolls`'u aynı `clientToken` ile iki kez çağır → tek sipariş; token'sız çağrı → fix sonrası Zod 400 (fix öncesi bu adım iki sipariş üreterek bug'ı belgeler).
4. **`test_shipping_client_token.ts` (A4, fix sonrası):** Aynı token'la iki `openSack` → tek çuval; sevkiyat kurulumunda aynı token replay → aynı `shipmentNo` döner, ikinci Shipment açılmaz.
5. **`test_hard_delete_guards.ts` (A5):** (a) hedeflendiği WO dışında hiçbir bağı olmayan `TEST-` Item → `/:id/permanent` → 409 beklentisi; (b) yalnız özel rotası olan müşteri → 409; (c) PeripheralDevice bağlı cihaz → 409. Fix öncesi üçü de "silindi + sessiz SET NULL" göstererek kırmızı.
6. **`test_db_invariants.ts` genişletmesi (A6):** 11 yeni CHECK, `CHECK_CONSTRAINTS` dizisine — migration'la aynı PR'da (aksi halde guard "envanter-dışı nesne" uyarısı verir).
7. **Konsolidasyon:** `consistency-check.sql`'e eklenen §8-§19, 3 aylık rutinde otomatik regresyon görevi görür (Bölüm E dev koşumu şablonu).

---

## Bölüm G — Öncelikli Aksiyon Planı (etki/efor sırasıyla)

1. ✅ **UYGULANDI (2026-07-31)** — **`startCopyJob` sentinel'i senkron** (A2): claim tüm `await`'lerin önüne alındı, başarısız doğrulamada geri bırakılıyor; test kancası `deps` eklendi. Regresyon: `scripts/test_db_copy_single_start.ts` (7/7).
2. ✅ **UYGULANDI (2026-07-31)** — **Advisory-lock'lu tx** (A1): `acquireAdminGuardLock` (`pg_advisory_xact_lock`, void dönüşü alt sorguda gizlendi — pg adapter void'i deserialize edemiyor) + guard'lar tx içine taşındı. Kapsam genişledi: `deactivateUser`, `setUserPermissions`, `revokePermission` **ve doğrulamada bulunan 4. çağrı noktası `deleteUser`**. Regresyon: `scripts/test_admin_guard_race.ts` (9/9); mevcut `test_permission_management` (8), `test_timed_permissions` (8), `test_user_lifecycle` (13), `test_p2_auth` (4), `test_data_integrity_gaps` (15) yeşil.
3. ✅ **UYGULANDI (2026-07-31)** — **`quick-from-rolls`'ta `clientToken` zorunlu** (A3): Electron'da çağıran yok (grep), tek istemci mobil zaten gönderiyor; Zod `optional()` kaldırıldı + Swagger `required` güncellendi.
4. 🟡 **YARISI UYGULANDI (2026-07-31)** — **`consistency-check.sql`'e §8-§19 eklendi** (tarih eşiği + dev-seed notlarıyla; dev DB'de uçtan uca hatasız koştu). Kalan: **üretim kopyasında ilk koşum** — mevcut bozukluk envanteri çıkmadan kalan düzeltmelerin aciliyeti netleşmez.
5. ✅ **UYGULANDI (2026-07-31)** — **CHECK migration'ı** (A6 + G-9 birlikte): `20260731120000_audit_check_hardening` — **18 constraint** (RollMovement×4, RollError.startMeter, SackAllocation.qty, DirectShipAllocation.qty, WOtoOL.allocatedQty, fason/kartela kalemleri×5, DirectShipment×2, RollReturn.qty, WO STOCK_PRODUCTION koşullu). Dev ön-taraması 18/18 sıfır ihlal; `git add → db execute → resolve → pg_constraint doğrulaması (18|t)` sırası izlendi (ilk `db execute` denemesi `--schema` bayrağı yüzünden sessizce koşmamıştı — D-23 tuzağı doğrulama adımıyla yakalandı). `test_db_invariants.ts` 53/53. **Üretim deploy notu:** VALIDATE ihlalde düşer — deploy öncesi üretim kopyasında ön-tarama şart (migration başlığında yazılı), vardiya dışı.
6. ✅ **UYGULANDI (2026-07-31)** — **Üç hardDelete guard'ı** (A5): Item'a `hardDelete` override (WO.targetItemId sayımı), Customer guard'ına `routeCount`, Device guard'ına `peripheralCount + pivotCount` (DevicePeripheral Cascade yolu da kapatıldı). **DMMF-eşdeğeri bekçi:** `scripts/test_hard_delete_guard_coverage.ts` — şemayı parse edip Item/Customer/Device'a gelen efektif SetNull/Cascade ilişkileri allowlist'le karşılaştırır (Prisma'nın örtük "opsiyonel→SetNull" varsayılanını da yakalar); yeni ilişki eklenince düşer. 3/3.
7. ✅ **UYGULANDI (2026-07-31, ikinci tur)** — **`Sack`/`Shipment` clientToken** (A4): migration `20260731150000` (nullable @unique ×2, elle — migrate dev'in sacks composite-FK tuzağından kaçınıldı); `openSack`/`createShipment` P2002-propagate + replay (WO emsali); istemciler: mobil PaketlemeScreen (ref token + başarıda rotate), Electron NewSackDialog/CreateShipmentDialog (ManualEntryDialog deseni). Token'sız eski istemci davranışı değişmez. Test: `test_shipping_client_token.ts` (7/7); üç projede tsc temiz.
8. ✅ **UYGULANDI (2026-07-31)** — **Scheduler watchdog** (A9): backup + archive scheduler'da bayrak 3 saatten uzun takılırsa zorla bırakılır + `console.error` (pm2 log'una düşer). `/health` metriği eklenmedi (kapsam dar tutuldu — log görünürlüğü yeterli).
9. ✅ **UYGULANDI** — G-5 migration'ına dahil (`work_orders_stockprod_targetItem`).
10. ✅ **KARARA BAĞLANDI + DÜZELTİLDİ (2026-07-31)** — A10 **CONFIRMED**: yalnız-header PATCH'te tx-içi taze durum kontrolü yoktu; header yazımı artık `updateMany WHERE {id, status: pre-tx-status}` claim'iyle (count 0 → 409 "durum değişti"). PARTIAL_SHIPPED dalı (yalnız `deadline`, `super.update`) bilinçli bırakıldı — tanımsal alan, terminal duruma sızsa da muhasebeye dokunmaz.

**Düşük öncelikliler de KAPATILDI (2026-07-31, ikinci tur — migration `20260731160000`):**
- **A7:** `users`/`permission_templates`'e `lower()` expression unique — app-level insensitive kontrolün yarış penceresinin DB seddi; şema-dışı nesne olarak `test_db_invariants.ts` yeni `EXPRESSION_UNIQUES` bölümünde izleniyor (55/55).
- **A8:** `setDocumentsLogo` + `reverifyCopy` read-modify-write'ları süreç-içi kuyrukla serileşti (tek-process invariant'ı altında yeterli).
- **RouteStep.sequence:** `(routeId, sequence)` unique'e yükseltildi (WorkOrderStep D-12 simetrisi).
- **CustomerBranch:** `(customerId, code)` unique (NULL code serbest; ad-dup bilinçli app-level kaldı).
- Ön-tarama: dört kural da dev'de 0 ihlal; ilgili testler yeşil (gaps 15, lifecycle 13, permission 8).

---

## Bölüm B/C Kaynak Notu

Bölüm B ve C, iki bağımsız `general-purpose` ajanı tarafından paralel üretildi (sırasıyla ~293K ve ~201K token, 102 ve 51 araç çağrısı). Her ikisi de dosya:satır teyitli çalıştı; DOĞRULANMALI işaretli maddeler ajanın zaman kısıtı nedeniyle tam okumadığı kod yollarıdır, "güvenli" anlamına gelmez. Doğrulama aşaması (Fable 5) 8 aday bulgunun tamamını kod okuyarak karara bağladı — 2'si çürütüldü (üstteki özet tablo); Bölüm B/C'nin çürütülen satırları yerinde işaretlendi.
