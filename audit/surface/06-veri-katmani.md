# 06 — Veri Katmanı Haritası

**Kapsam:** `Teks-Erp/prisma/schema.prisma`, `src/lib/prisma.ts`, tüm `$transaction` çağrı noktaları, advisory lock kullanımı, atomik claim deseni, ham SQL, `src/services/base.service.ts`.
**Yöntem:** grep/awk sayımları + `src/` ağacında paren-eşleştirmeli AST-benzeri tarama (scratchpad'deki `txscan.mjs`/`tx3.mjs`/`tx4.mjs`/`tx5.mjs`) + **yerel geliştirme veritabanına salt-okuma `psql` sorguları**.
**Tarih:** 2026-08-09. Bu bir **planlama** belgesidir — bulgu raporu değil; denetimin nereye bakacağını işaretler.

> ⚠️ **Ölçüm ortamı uyarısı:** DB tarafı sayımlar `postgresql://oad@localhost:5432/adnansahin_db` (yerel geliştirme DB'si) üzerinde alındı. Satır sayıları **fabrika üretim verisi DEĞİLDİR**. Şema nesneleri (index, FK, constraint) ise migration'larla geldiği için üretimle aynı olması beklenir — ama **doğrulanmadı**, `ŞÜPHELİ`.

---

## 1. Şema haritası

### 1.1 Kaba sayımlar

| Ölçü | Değer | Komut |
|---|---|---|
| `schema.prisma` satır | 3.721 | `wc -l` |
| model | **85** | `grep -c "^model "` |
| enum | **38** | `grep -c "^enum "` |
| enum üyesi (toplam) | **134** | awk sayımı |
| `@@index` (yorum hariç) | **208** | `grep -E '^\s+@@index'` |
| `@@unique` (yorum hariç) | **36** | `grep -E '^\s+@@unique'` |
| inline `@unique` (yorum hariç) | **48** | `grep -E '^\s+\w+.*\s@unique'` |
| `@@id` (composite PK) | **5** | `grep -E '^\s+@@id'` |
| `@@map` | 85 | `grep -c '@@map'` |
| `@relation(fields: …)` | **202** | grep |
| `@db.Uuid` | 294 | grep |
| `@db.Timestamptz` | 201 | grep |
| `@db.Decimal` | 44 | grep |
| `Json` alan | 20 | grep |
| migration dizini | **154** (+ `migration_lock.toml`) | `ls prisma/migrations` |
| DB `_prisma_migrations` satırı | **154** | psql |

> Görev metninde "155 migration" yazıyordu; dizindeki 155 girdinin biri `migration_lock.toml` dosyasıdır. Gerçek migration sayısı **154** ve DB defteriyle **birebir uyuşuyor**.

### 1.2 Alan sayısına göre en büyük 15 model

Sayım = model bloğu içindeki alan satırları (scalar + enum + relation; `@@` satırları ve yorumlar hariç).

| # | Model | Alan | `@@index` | Not |
|---|---|---|---|---|
| 1 | **Roll** | 66 | **21** (DB'de 22 index, PK dahil) | Sistemin merkez tablosu; en çok indexli |
| 2 | **User** | 50 | — | Kimlik + oturum + PIN/kart alanları |
| 3 | **PeripheralDevice** | 38 | 5 | Yazıcı/kantar/tarayıcı donanımı |
| 4 | **RollReturn** | 34 | **13** | İade defteri; brüt kuralının kaynağı |
| 5 | **WorkOrder** | 33 | 7 | |
| 5 | **SubcontractorDispatch** | 33 | 8 | |
| 7 | **WorkOrderStep** | 31 | 5 | Denormalize `status` taşır (sed yok) |
| 8 | **Customer** | 30 | — | |
| 9 | **Shipment** | 28 | — | |
| 10 | **Swatch** | 25 | 8 | |
| 10 | **SubcontractorReceipt** | 25 | 6 | |
| 12 | **Sack** | 22 | — | |
| 12 | **Order** | 22 | — | Denormalize `shippedQty` (sed yok, D-9) |
| 12 | **DirectShipment** | 22 | — | |
| 15 | **Station / RollError / OrderLine / KursunBypassAssignment** | 21 | 10 (RollError) | dört model eşit |

**`@@index` taşımayan model sayısı: 10** (awk sayımı). Bunlar çoğunlukla küçük master-data/pivot tabloları olmalı ama **listelenmedi** — denetimde "FK index zorunlu" (perf kuralı 1) ihlali var mı diye tek tek bakılmalı.

### 1.3 Referans bütünlüğü — şema ↔ DB **tam mutabakat**

DB'deki 204 foreign key'in `ON DELETE` dağılımı (`pg_constraint.confdeltype`) ile şema beyanı **birebir uyuşuyor**:

| Davranış | DB (ölçüm) | Şemadan beklenen | Uyum |
|---|---|---|---|
| CASCADE (`c`) | **40** | 40 açık `onDelete: Cascade` | ✅ |
| SET NULL (`n`) | **95** | 3 açık + **92 örtük** (opsiyonel ilişki, `onDelete` yazılmamış) | ✅ |
| RESTRICT (`r`) | **67** | 11 açık + **56 örtük** (zorunlu ilişki) | ✅ |
| NO ACTION (`a`) | **2** | Şemada yok — ham SQL migration'la kurulan 2 **DEFERRABLE composite FK** (`rolls_sackId_shipmentId_consistency_fkey`, `swatches_…`) | ✅ |
| **Toplam** | **204** | 202 `@relation` + 2 raw | ✅ |

**Denetim işareti:** 202 ilişkinin **148'i (%73) `onDelete` YAZMIYOR**; bunların 92'si opsiyonel olduğu için Prisma sessizce **SET NULL** üretiyor. Yani `Roll.colorId`, `Roll.parentRollId`, `Roll.currentStepId`, `Roll.qualityGradeId` gibi izlenebilirlik alanları, referans edilen satır fiziksel silinirse **sessizce NULL'lanır**. Bugün risk pratikte düşük çünkü fiziksel silme `guarded-hard-remove.ts` bağımlılık guard'larıyla kapılı — ama **korumanın tamamı uygulama katmanında**, DB seddinde değil. (Emsal: bellek notundaki `sacks_customerId_fkey` vakası — şema `SET NULL` derken DB aylarca `RESTRICT` kalmıştı.)

### 1.4 Index / kısıt envanteri (DB ölçümü)

| Nesne | Adet |
|---|---|
| toplam index (public şema) | **386** |
| bunlardan PRIMARY KEY | 86 (= 85 model + `_prisma_migrations`) |
| non-PK UNIQUE index | **92** |
| düz (unique olmayan) index | **208** — şemadaki `@@index` sayısıyla **birebir** |
| **partial** index (`indpred IS NOT NULL`) | **28** |
| bunlardan partial **UNIQUE** | **12** |
| CHECK constraint | **25** |
| DEFERRABLE FK | **2** |

92 non-PK unique'in **9'u Prisma adlandırma kalıbı dışında** (ham SQL migration kökenli, çoğu partial guard):
`kursun_bypass_one_pending_per_step_uq`, `label_template_variants_one_primary`, `label_templates_one_default_per_kind`, `permission_templates_name_lower_uq`, `roll_errors_roll_meter_defect_uq`, `roll_movements_one_open_per_roll_step_uq`, `users_username_lower_uq`, `work_sessions_active_device_uq`, `work_sessions_active_machine_uq`.

> Şema tarafı 36 `@@unique` + 48 inline `@unique` = 84; DB'de 92. Fark (8-9) yukarıdaki ham SQL kökenli nesnelerle açıklanıyor ama **birebir eşleme yapılmadı** → `ŞÜPHELİ`, denetimde `test_db_invariants.ts` envanteriyle karşılaştırılmalı.

### 1.5 Yerel DB satır sayıları (sadece ölçek fikri; üretim DEĞİL)

`rolls` 99 · `roll_movements` 53 · `roll_operations` 58 · `work_orders` 260 · `shipments` 1 · `system_logs` **51.281**.
`pg_stat_user_tables.n_live_tup` **sıfır** döndü (ANALYZE koşmamış) — planlayıcı istatistikleri bayat. Bu, dev ortamında `EXPLAIN` sonuçlarının üretimle örtüşmeyeceği anlamına gelir (perf kuralı 12'yi dev'de doğrulamanın sınırı).

---

## 2. Prisma client kurulumu — `src/lib/prisma.ts` (101 satır)

**Tek dosya, tek singleton.** `src/` içinde `new PrismaClient(` sadece burada; `new Pool(` kuran diğer 4 yer `prisma/seed*.ts` script'leri (hepsi `PG_SESSION_OPTIONS` geçiyor — bekçi `test_timestamptz_contract.ts` §3b bunu mekanik doğruluyor).

```
pg.Pool → PrismaPg adapter → PrismaClient (module-level const, default export)
```

### 2.1 Havuz ayarları (ölçülen değerler)

| Ayar | Değer | Kaynak |
|---|---|---|
| `max` | **30** | `prisma.ts:69` |
| `min` | **kullanılmıyor** (bilinçli — pg-pool 3.x `min`'i önden doldurmaz, sadece idle-reap tabanı) | `prisma.ts:50-55` |
| `idleTimeoutMillis` | **600.000 ms (10 dk)** | `prisma.ts:70` |
| `connectionTimeoutMillis` | **5.000 ms** | `prisma.ts:71` |
| `options` | `-c timezone=UTC` (`PG_SESSION_OPTIONS`) — **load-bearing**, adapter timestamptz varsayımı | `prisma.ts:72`, `pg-session.ts` |
| DB-level `statement_timeout` | 50 s (uygulama değil, `ALTER DATABASE`) | CLAUDE.md |

### 2.2 Global transaction seçenekleri — **tek konfigürasyon noktası**

```ts
new PrismaClient({ adapter, transactionOptions: { maxWait: 5_000, timeout: 20_000 } })
```

- **Prisma varsayılanları (maxWait 2 s / timeout 5 s) EZİLMİŞ**: `maxWait = 5 s`, `timeout = 20 s`.
- **Per-call override HİÇ YOK.** Ölçüm: `grep -rn 'timeout:' src` → yalnız `prisma.ts:91`; `maxWait` → yalnız `prisma.ts:90`. Yani **115 transaction çağrısının 115'i aynı 20 s bütçesini paylaşıyor**, işin büyüklüğüne göre farklılaşma yok.
- `isolationLevel` **hiçbir yerde verilmemiş** → tümü PostgreSQL varsayılanı **READ COMMITTED**. Bu bilinçli ve yazılı (`shipping.service.ts:142` "İZOLASYON NOTU: tüm tx'ler READ COMMITTED (repoda `isolationLevel` kullanılmıyor)").

### 2.3 Dayanıklılık

- `pool.on("error")` dinleyicisi var (idle client düşerse süreç çökmesin) — `prisma.ts:79`.
- Graceful shutdown tek noktada (`server.ts`); `prisma.ts` içinde SIGTERM handler bilinçli olarak **yok**.
- Havuz telemetrisi `src/lib/pool-health.ts`: `poolWaitingMax`, `poolConnectsTotal`, `poolAcquireTimeouts` + `classifyPoolTimeout` → `error.middleware` bunu **503**'e çeviriyor (driver adapter'da `P2024` üretilmediği için).
- `error.middleware` Prisma kod eşlemesi: P2002/P2003/P2007/P2014/P2020/P2022/P2023/P2025/P2028/P2034 + havuz timeout dalı.

---

## 3. TRANSACTION KULLANIM NOKTALARI (en kritik bölüm)

### 3.1 Kaba dağılım

| Ölçü | Değer |
|---|---|
| `$transaction` metin eşleşmesi | 119 |
| — bunlardan **yorum/docstring** içinde | 4 (`batch.service.ts:16,102,212`, `shipping.service.ts:132`) |
| **gerçek çağrı noktası** | **115** |
| — interactive, `async (tx) => {…}` | **111** |
| — interactive, arrow `(tx) => this.xxxTx(…)` | **2** (`traveler-card.service.ts:210`, `shipping.service.ts:1784`) |
| — **batch array** `$transaction([…])` | **2** (`device.service.ts:219`, `permission-management.service.ts:983`) |
| transaction taşıyan dosya | **32** (hepsi `services/`) |
| tx gövdelerindeki toplam `tx.*` çağrısı | **511** |
| tx gövdesinde **döngü içinde yazma** yapan tx | **27** |

**Yani mimari neredeyse tamamen interactive transaction üzerine kurulu (%98).** Batch array yalnız iki yerde.

### 3.2 Dosya bazında `$transaction` yoğunluğu

| Dosya | Adet |
|---|---|
| `services/shipping.service.ts` | 24 |
| `services/workorder.service.ts` | 9 |
| `services/label-template.service.ts` | 8 |
| `services/permission-management.service.ts` | 7 |
| `services/inventory.service.ts` | 7 |
| `services/tambur.service.ts` | 6 |
| `services/subcontractor.service.ts` | 6 |
| `services/order.service.ts` | 6 |
| `services/batch.service.ts` | 6 |
| `services/kursun-bypass.service.ts` | 5 |
| `services/kartela.service.ts` | 5 |
| diğer 21 dosya | 1-3 |

### 3.3 Transaction envanteri — dosya | fonksiyon | tip | timeout | içinde yavaş iş

`len` = tx gövdesinin satır sayısı. `tx.*` = gövdedeki doğrudan tx sorgu çağrısı (helper'a delege edilenler **sayılmıyor**). "Yavaş iş" sütunu **DB-dışı I/O yok** demek değil, "tx süresini uzatabilecek iş var mı" demek.

| # | Dosya | Fonksiyon | Satır | len | Tip | timeout | tx.* | Döngüde yazma | Freeze (belge dondurma) | Advisory | Ham SQL |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | tambur.service.ts | `finalize` | 790-1166 | **377** | interactive | global 20s | 16 | **Y (2)** | | | |
| 2 | subcontractor.service.ts | `dispatch` | 971-1324 | **354** | interactive | global 20s | 18 | | **Y** | | |
| 3 | subcontractor.service.ts | `executeDirectShip` | 5283-5597 | **315** | interactive | global 20s | 17 | | **Y** | | Y |
| 4 | subcontractor.service.ts | `receive` | 2546-2857 | **312** | interactive | global 20s | 16 | **Y** | | | Y |
| 5 | workorder.service.ts | `replace` | 4724-5028 | **305** | interactive | global 20s | 11 | **Y (3)** | | | |
| 6 | workorder-manual-move.service.ts | `manualMove` | 599-853 | 255 | interactive | global 20s | 14 | **Y** | | | |
| 7 | batch.service.ts | `mergeBatches` | 584-836 | 253 | interactive | global 20s | 15 | **Y (2)** | | | |
| 8 | workorder-batch-drop.service.ts | `dropBatch` | 262-499 | 238 | interactive | global 20s | 11 | **Y (3)** | | | Y |
| 9 | subcontractor.service.ts | `undoTransfer` | 4539-4755 | 217 | interactive | global 20s | 13 | **Y (2)** | | | |
| 10 | kursun-bypass.service.ts | `assign` | 766-979 | 214 | interactive | global 20s | 9 | | | | |
| 11 | workorder.service.ts | `completeWorkOrder` | 3422-3634 | 213 | interactive | global 20s | 7 | **Y** | | | Y |
| 12 | workorder.service.ts | `softDelete` | 2964-3138 | 175 | interactive | global 20s | 7 | | | | Y |
| 13 | tambur.service.ts | `finalizeOpenFabric` | 2783-2956 | 174 | interactive | global 20s | 9 | | | | |
| 14 | subcontractor.service.ts | `cancelReceipt` | 4118-4274 | 157 | interactive | global 20s | 9 | **Y (2)** | | | |
| 15 | subcontractor.service.ts | `cancel` | 1939-2085 | 147 | interactive | global 20s | 10 | | | | Y |
| 16 | batch.service.ts | `moveRolls` | 378-520 | 143 | interactive | global 20s | 8 | **Y (2)** | | | |
| 17 | order.service.ts | `update` | 1969-2108 | 140 | interactive | global 20s | 9 | **Y** | | | Y |
| 18 | tambur.service.ts | `cutOpenFabric` | 2478-2615 | 138 | interactive | global 20s | 7 | | | | |
| 19 | inventory.service.ts | `createInitialEntry` (KK1) | 770-905 | 136 | interactive | global 20s | 7 | **Y** | | **Y (8021)** | Y |
| 20 | tambur-undo.service.ts | `applyFull` | 572-704 | 133 | interactive | global 20s | 15 | **Y** | | | |
| 21 | tambur.service.ts | `cutWarehouseRoll` | 1933-2059 | 127 | interactive | global 20s | 7 | | | | |
| 22 | workorder.service.ts | `attachRolls` | 3973-4099 | 127 | interactive | global 20s | ~6 | **Y** | | | |
| 23 | inventory.service.ts | `kursunFinish` | 4158-4277 | 120 | interactive | global 20s | ~6 | | | | |
| 24 | tambur.service.ts | `finalizeWarehouseCut` | 2211-2326 | 116 | interactive | global 20s | 7 | | | | |
| 25 | workorder.service.ts | `detachRolls` | 5394-5505 | 112 | interactive | global 20s | ~5 | **Y** | | | Y |
| 26 | kursun-qc.service.ts | `finishStep` | 773-877 | 105 | interactive | global 20s | ~5 | **Y** | | | Y |
| 27 | **shipping.service.ts** | **`performDispatchTx`** (1685-1762, `dispatchShipment` 1784 + `createShipment` 1390 üzerinden) | 78 | 78 | interactive (arrow) | global 20s | 8 | **Y** | **Y** | | |
| 28 | inventory.service.ts | `createOpenFabric` | 3637-3731 | 95 | interactive | global 20s | ~5 | | | | |
| 29 | tambur-manual.service.ts | `createManualRoll` | 838-932 | 95 | interactive | global 20s | ~4 | | | | |
| 30 | return.service.ts | `createReturn` | 484-564 | 81 | interactive | global 20s | ~5 | **Y** | **Y** | | |
| 31 | kartela.service.ts | `dispatch` | 281-338 | 58 | interactive | global 20s | ~4 | **Y** | **Y** | | |
| 32 | return.service.ts | `cancelReturn` | 871-927 | 57 | interactive | global 20s | ~4 | | **Y (reissue)** | | |
| 33 | shipping.service.ts | `undoDispatch` (storno) | 1991-2053 | 63 | interactive | global 20s | 8 | **Y** | **Y** | | |
| 34 | session-registry.service.ts | `openLoginSession` | 62-103 | 42 | interactive | global 20s | ~4 | | | **Y (1-arg)** | Y |
| 35 | permission-management.service.ts | `applyTemplate` | 983-995 | 13 | **batch-array** | global 20s | — | | | | |
| 36 | device.service.ts | `assignHardware` | 219-224 | 6 | **batch-array** | global 20s | — | | | | |
| — | helpers/guarded-hard-remove.ts | `makeGuardedHardRemove` | 74-76 | 3 | interactive | global 20s | — | | | | Master-data `/permanent` iskeleti |

Kalan ~80 transaction 4-58 satır aralığında ve tek-amaçlı (claim + audit + tek update). Tam liste: scratchpad `tx3.txt`.

### 3.4 Transaction İÇİNDE yavaş iş var mı?

**Dış HTTP / dosya / process I/O: BULUNAMADI — bu iyi haber.**

| Aranan | Sonuç |
|---|---|
| `fetch(` / `axios` / `http.request` | `src/` genelinde **0 eşleşme** (proje dış HTTP çağrısı hiç yapmıyor) |
| `fs.write*` / `fs.readFile` | tüm `src/` içinde **1** yer: `app.ts:142` (`package.json` sürüm okuma, boot'ta, tx dışı) |
| `child_process.spawn` | `helpers/pg-tool.helper.ts` (yedekleme/restore) — **hiçbir tx gövdesinde çağrılmıyor** |
| `bcrypt.hash/compare` | `auth.service.ts`, `permission-management.service.ts:404,464` — **tx dışında** (`grantPermission`/`setUserPermissions` tx'lerinde hash yok) |
| `setTimeout` / sleep | tx gövdelerinde **0** |
| `bwipjs` (barkod/QR üretimi, CPU) | `label.service.ts`, `traveler-card.service.ts`, `printed-document.service.ts:265` — **hiçbiri tx içinde değil**; render yolunda |
| `opentype.js` raster font | `helpers/raster/*` — tx dışı |

**Ama üç tane "yavaş olabilir" DB-içi iş var, üçü de tx içinde:**

1. **`freezeForSource` (resmi belge dondurma) — 5 tx içinde, 1 tx'te `reissueForSourceTx`.**
   `printed-document.service.ts:283`. Tx içinde sırayla: `requireBuilder(docType).fresh(tx, sourceId)` (belgenin **tüm içeriğini** toplayan çok-sorgulu okuma; sevk irsaliyesinde çuval + top + iade geri-ekleme dahil) → `buildSnapshotEnvelope` (**4 ardışık ayar okuması**: `readCompanyName`, `readCompanyLetterhead`, `readDocumentsConfig`, `readDocumentsLogo` — kod `[await, await, await, await]` dizi literali içinde **seri** koşuyor) → opsiyonel `documentProfile.findUnique` → `printedDocument.findFirst(orderBy version desc)` → `create`.
   Çağıranlar: `subcontractor.dispatch`, `subcontractor.executeDirectShip`, `return.createReturn`, `return.cancelReturn`, `shipping.performDispatchTx`/`undoDispatch`, `kartela.dispatch`, `helpers/batch-dispatch-surgery.helper.ts:375`.
   **Denetim sorusu:** bu belge-üretim zinciri kaç sorgu koşuyor ve `dispatch` tx'i (354 satır) toplamda 20 s bütçesinin ne kadarını yiyor? Ölçülmedi.

2. **`generateRollBarcode` — sayaç satır kilidi tx BOYUNCA tutulur.**
   `helpers/roll-barcode.helper.ts:40`: `INSERT … ON CONFLICT (day,type) DO UPDATE n=n+1 RETURNING n` üzerinde `roll_barcode_counters`. Kodun kendi yorumu bunu yazıyor: *"tx verilirse sayaç artışı tx'e bağlıdır … kilit tx boyunca tutulur"*. Sayaç **gün + tip başına TEK satır**, yani sistemdeki tüm eşzamanlı top-yaratma işlemleri o satırda serileşir.
   **Denetim sorusu:** `tambur.finalize` (377 satır, 20 s bütçe) bu kilidi alıp tutarken paralel KK1 girişleri ne kadar bekliyor? Ölçülmedi.

3. **Döngü içinde per-satır yazma — 27 transaction.** En sivri örnek `tambur.finalize`: `for (const seg of segments)` içinde her segment için `generateRollBarcode` + `tx.roll.create` + `tx.rollProperty.createMany` + `tx.rollOperation.createMany` (+ adım/hareket güncellemeleri). **Kesim adedi tavanı Zod'da 200** (`tambur.controller.ts:41` — *"Tek seferde en fazla 200 kesim girilebilir"*), yani en kötü durumda tek transaction ~200 × 4-6 = **800-1200 round trip**, 20 s bütçe içinde, üstelik barkod sayacı kilidi elde. Pratikte tipik kesim sayısı küçüktür (ölçülmedi) — ama **sözleşme 200'e izin veriyor**.

### 3.5 Nested transaction / `Tx` sonekli helper deseni

- **Gerçek nested transaction YOK.** `tx.$transaction(` → **0 eşleşme**. Ayrıca isim-tabanlı heuristik tarama (`tx4.mjs`: "kendi `prisma.$transaction`'ını açan 96 fonksiyonun herhangi biri bir tx gövdesinden çağrılıyor mu") → **0 eşleşme**. `ŞÜPHELİ`: tarama isim eşleşmesine dayanıyor, dolaylı çağrı zincirlerini (A → B → C, C tx açar) **görmez**.
- **Desen:** transaction'ı **sadece servis girişi açar**, alt işler `tx` client'ı **parametre olarak** alır. `Prisma.TransactionClient` tipi 32 dosyada 79 yerde imzada geçiyor.
- **`Tx` sonekli helper: 34 farklı ad** (21'i `function …Tx` olarak tanımlı). Örnekler: `createBatchTx`, `generateBatchNumberTx`, `performDispatchTx`, `closeOpenMovementsTx`, `touchWarehouseSackTx`, `touchShipmentPlannedTx`, `resetSackWeightsTx`, `markTravelerCardDirtyTx`, `reissueForSourceTx`, `writeShipmentAllocationsTx`, `applyRollDispositionsTx`, `claimAssignmentTx`, `cloneWorkOrderTx`, `transferRollsToNewWorkOrderTx`.
- **Çift-mod (`prisma | tx`) helper:** `type Db = PrismaClient | Prisma.TransactionClient` üç helper'da (`workorder-locks`, `kursun-bypass-guard`, `kursun-bypass-eligibility`) + `printed-document.service.ts`. Aynı fonksiyon hem tx içinde hem dışında koşabiliyor.
  **Denetim işareti:** bu, "tx içinde sanıyorduk ama havuzdan ayrı bağlantıyla koştu" sınıfı sessiz hataların klasik zeminidir — çağrı yerlerinin hangi modda olduğu tek tek doğrulanmalı.
- **`withBarcodeRetry` sarmalı:** 73 referans. Kalıp `withBarcodeRetry(() => prisma.$transaction(async (tx) => …))` — P2002'de **tüm transaction** yeniden koşar. Yeniden koşan tx'in yan etkilerinin idempotent olup olmadığı (audit çift yazımı, sayaç boşluğu) denetim konusu.

### 3.6 `Promise.all` durumu — temiz

- ESLint kuralı var (`eslint.config.mjs:39-49`): `Promise.all/allSettled` içinde `tx` **Identifier**'ı → error.
- Tarama sonucu: **tx gövdelerinde `Promise.all` fiilen KULLANILMIYOR**; bulunan 11 eşleşmenin **11'i de yasağı açıklayan yorum satırı**.
- **Kuralın yapısal zayıflığı:** guard **isim tabanlı** (`Identifier[name='tx']`). Callback parametresi `tx` dışında adlandırılırsa kural sessizce devre dışı kalır. Ölçüldü: **111 interactive tx'in 111'i de `(tx)` kullanıyor** → bugün delik yok, ama tek bir yeniden adlandırma korumayı kapatır. (Kodda bu zaten yazılı: *"guard isim-tabanlı — `$transaction` closure parametresini DAİMA `tx` adlandırın."*)
- Tx gövdesinden **havuz** client'ına (`prisma.*`) dokunan yer bulunamadı; taramanın 3 hitinden ikisi batch-array literalleri, biri (`inventory.service.ts:768`) `typeof prisma.roll.create` **tip ifadesi** — çağrı değil.

---

## 4. Advisory lock kullanımı

**4 çağrı noktası, 2 farklı anahtar uzayı.** PostgreSQL'de 1-argümanlı `pg_advisory_xact_lock(bigint)` ile 2-argümanlı `(int,int)` **ayrı uzaylardır** — kod bunu biliyor ve yazılı olarak belirtiyor (`duplicate-guard.helper.ts:21-23`).

| # | Yer | Form | Namespace | Anahtar | Amaç |
|---|---|---|---|---|---|
| 1 | `inventory.service.ts:796` | 2-arg | **8021** (`DUPLICATE_GUARD_LOCK_NS`, `helpers/duplicate-guard.helper.ts:28`) | `hashtext(lockKey)` — entrySource+item+renk+metraj+en+user+makine | KK1 mükerrer top tuzağı (TOCTOU kapatma) |
| 2 | `batch.service.ts:125` | 2-arg | **8022** (`BATCH_NUMBER_LOCK_NS`) | sabit `1` (global sayaç) | Parti no üretimi (`P01…P99` sarma + eski günlük kalıp) |
| 3 | `session-registry.service.ts:63` | **1-arg** | — | `hashtext("<userId>|<deviceType>")` | Oturum kayıt yarışı |
| 4 | `permission-management.service.ts:584` | **1-arg** | — | `hashtext('perm-admin-guard')` | Son admin'in yetkisini düşürme yarışı |

### Çakışma analizi

- **8021 ↔ 8022 çakışmıyor** — farklı namespace, üstelik gerekçesi kodda yazılı (`batch.service.ts:87-89`: aynı uzayda olsalardı "birbirini sessizce serileştirirdi").
- **1-arg uzayındaki iki kullanıcı (session-registry ↔ permission-management) AYNI uzayı paylaşıyor.** Anahtarlar `hashtext()` ile üretiliyor, yani `int4` uzayına düşen **hash çakışması teorik olarak mümkün**: `hashtext('perm-admin-guard')` ile herhangi bir `hashtext('<uuid>|<deviceType>')` aynı değeri verirse, bir kullanıcının login'i admin-guard'ıyla serileşir.
  **Etkisi hata değil gecikme** (yanlış sonuç üretmez, sadece sıraya sokar) ve olasılık pratikte ihmal edilebilir — ama denetim bunu **bilinçli kabul mü, gözden kaçmış mı** diye sormalı. 2-arg kullanıcıları namespace'i açıkça ayırırken 1-arg kullanıcıları ayırmamış; asimetri belgelenmemiş.
- **`generateBatchNumberTx` kilidi fonksiyonun İLK ifadesi** (TOCTOU'ya karşı load-bearing, kodda yazılı). Aynı disiplin `createInitialEntry`'de de var (kilit `findFirst`'ten VE `generateRollBarcode`'dan önce — ABBA deadlock önlemi).
  **Denetim işareti:** bu "sıra load-bearing" invariant'ı yalnız **yorumla** korunuyor + bekçi testleriyle; refactor'da satır kaymasına karşı mekanik bir sed yok.

---

## 5. Atomik claim deseni (`updateMany` + `count` kontrolü)

| Ölçü | Değer |
|---|---|
| `.updateMany(` çağrısı | **225** |
| `.count === 0` kontrolü | **63** |
| `.count !== …` kontrolü | **43** |
| **toplam `count ===`/`!==` kontrolü** | **108** |

Yani `updateMany` çağrılarının **kabaca yarısı (108/225)** sonuç sayısını denetliyor. Kalan ~117 `updateMany` toplu güncelleme (durum geçişi değil) olabilir — **doğrulanmadı**, `ŞÜPHELİ`.

**İki varyant var ve anlamları farklı:**
- `count === 0` → "tek satırı iddia ettim, alamadım" → 409.
- `count !== <beklenen adet>` → **çoklu claim**: `kartela.service.ts:331` (`!== data.rollIds.length`), `subcontractor.service.ts:1264` (`!== dispatchRollIds.length`), `order.service.ts:1740` (`!== stockRollIds.length`), `workorder-manual-move.service.ts:611` (`!== selectedIds.length`), `tambur-undo.service.ts:529,544` (`!== 1`).

**En yoğun claim kullanan dosyalar:** `shipping.service.ts` (9), `workorder.service.ts` (8), `inventory.service.ts` (7), `order.service.ts` (6), `subcontractor.service.ts` (5), `tambur.service.ts` (4).

**Denetim işaretleri:**
- `order.service.ts:1722` satırında kodun kendi yorumu geçmiş bir hatayı anlatıyor: *"claim.count HİÇ kontrol edilmiyordu → topların bir kısmı arada başka akışta …"*. Aynı sınıf hata, kontrol edilmeyen ~117 `updateMany`'nin herhangi birinde olabilir → **her `updateMany`'nin "durum geçişi mi, toplu güncelleme mi" olduğu tek tek sınıflandırılmalı.**
- Karşıt desen (`findUnique → if → update`) proje kuralınca **yasak** ama mekanik bekçisi görülmedi; grep'le taranmalı.

---

## 6. Ham SQL (`$queryRaw` / `$executeRaw`)

| Ölçü | Değer |
|---|---|
| `$queryRaw` | **48** |
| `$executeRaw` | **17** |
| `$queryRawUnsafe` | **1** |
| `$executeRawUnsafe` | **0** |
| `Prisma.sql` | 38 |
| `Prisma.raw` | **3** (biri yorum satırı → gerçek 2) |

**Dosya dağılımı (top):** `reports/production` 6 · `reports/inventory` 6 · `subcontractor` 5 · `reports/quality` 5 · `workorder` 4 · `reports/audit` 4 · `inventory` 4 · `reports/sales` 3 · `reports/customer` 3 · `backup-impact` 3 · sonra 1-2'lik 16 dosya. Ayrıca `app.ts` (`/health`) ve `error.middleware.ts` birer tane.

### SQL injection değerlendirmesi — **risk bulunamadı**, üç istisna açıkça gerekçeli

1. **`$queryRawUnsafe` tek kullanım** — `db-copy-verify.service.ts:466`, `prismaCount(table)`:
   ```ts
   `SELECT count(*)::bigint AS n FROM "${table.replace(/"/g, '""')}"`
   ```
   `table` argümanı **yalnız `COUNTED_TABLES` sabit dizisinden** geliyor (`db-copy-verify.service.ts:323-326`, 12 hardcoded tablo adı). Kullanıcı girdisi ulaşmıyor. Kimlik tırnak kaçırma da yapılmış. **Güvenli** — ama `$queryRawUnsafe` kullanımının **tek yeri** olduğu için denetimde "gelecekte parametre kaynağı genişletilirse" notu düşülmeli.
2. **`Prisma.raw` #1** — `constants/time.ts:71`, `factoryDaySql()`:
   ```ts
   Prisma.raw(`DATE_TRUNC('day', ${columnExpr} AT TIME ZONE '${timeZone}')::date`)
   ```
   İki değişken de derleme-zamanı sabiti (`FACTORY_TIMEZONE`, çağıranın yazdığı kolon ifadesi). Kod bunu **açıkça** yazıyor: *"bu fonksiyona ASLA kullanıcı girdisi geçirme"*. `Prisma.sql` yerine `raw` tercih edilmesinin sebebi de yazılı: bind parametresi kullanılırsa `20260801050000_system_log_daily_stats_tz` ifade istatistiği eşleşmiyor.
   **Denetim işareti:** güvenlik burada **konvansiyona** dayanıyor, tip sistemine değil. `columnExpr: string` imzası, yarın bir raporun kullanıcı seçimli kolon adını buraya geçirmesini engellemez.
3. **`Prisma.raw` #2** — `subcontractor.service.ts:278`: `AWAITING_DISPATCH_STATUSES.map(s => Prisma.raw(`'${s}'`))` — değerler TS enum üyeleri.

Geri kalan tüm ham SQL **tagged template** (`$queryRaw\`… ${x} …\``) → Prisma bunları bind parametresine çevirir. **Serbest string interpolation bulunamadı.**

### Ham SQL'in ikinci cephesi: saat dilimi

CLAUDE.md'ye göre `scripts/test_raw_sql_hygiene.ts` çıplak `NOW()`/`CURRENT_TIMESTAMP`/`CURRENT_DATE` kullanımını tarıyor ve gerekçesiz olanı düşürüyor; **10 yazma noktası** hâlâ `now() AT TIME ZONE 'UTC'` eski kalıbında (timestamptz sonrası "bugün doğru ama kırılgan olan taraf bu"). Bu bölüm **bu denetimde yeniden ölçülmedi** — `ŞÜPHELİ`, ayrı bir başlıkta doğrulanmalı.

---

## 7. `src/services/base.service.ts` — generic CRUD katmanı (837 satır)

### Ne sağlıyor

`BaseService` bir Prisma delegate'ini **isimle** (`prisma[config.modelName]`) çözüp master-data CRUD'unu tek yerden veriyor. Kullanımı `BaseController` ile eşleşiyor; CLAUDE.md'ye göre **13 "bare BaseController" route** doğrudan bu sınıfa dayanıyor.

| Metod | İşi |
|---|---|
| `findAll(req)` | offset ↔ cursor modu otomatik seçimi (`isCursorRequested`) |
| `findAllOffset` | `parseQueryParams` → `safeSortBy` → `safeFilters` → `buildWhereClause` → `applyDateRange` → `extraWhere` → `orderBy` + **id tie-breaker** |
| `findAllCursor` | keyset cursor; ilişki bazlı sıralama istenirse **offset-cursor'a düşer** |
| `findById` | tekil okuma |
| `create` | `sanitizeWriteData` → (autoCode ise) `withBarcodeRetry` + `nextAutoCode` → veya `uniqueField` reactivate yolu → `assertNameNotDuplicate` → `performInsert` |
| `reactivate` | pasif kaydı `isActive:true` yapıp günceller; **nested alanları sessizce atar** |
| `update` | sanitize → eski kaydı oku (audit) → ad-mükerrer (yalnız ad/kapsam **gerçekten** değiştiyse) → update → audit |
| `softDelete` | `isActive:false` + audit |
| `hardDelete` | fiziksel `delete`; **P2003 → 409** ("bağlı kayıtlar var, pasife alın") |
| `assertBaseServiceGuards()` | **boot-time fail-closed**: `Prisma.dmmf` çözülemezse sunucu başlamaz |

### Allowlist'li alanlar — üçü de aynı kaynaktan

Üç guard da `sortableFieldsFor(modelName)` çıktısına dayanıyor: **Prisma DMMF'ten okunan, modelin TÜM `scalar` + `enum` alanları** (lazy + `Map` cache).

| Guard | Nerede | Ne yapıyor | Fail-open koşulu |
|---|---|---|---|
| `safeSortBy` (239) | sıralama | allowlist dışı `sortBy` → sessizce `createdAt`; `relationSortMap` anahtarları da kabul | model DMMF'te yoksa **istenen değer aynen geçer** |
| `safeFilters` (261) | `filter[…]` | allowlist dışı filtre anahtarı **sessizce düşürülür** (Prisma 500'ü yerine) | model yoksa **filtreler aynen geçer** |
| `sanitizeWriteData` (485) | create/update gövdesi | yalnız scalar/enum geçer; **ilişki adıyla gelen nested write operatörleri** (`{"rolls":{"deleteMany":…}}`) atılır; `id`/`createdAt`/`updatedAt` atılır; `config.nestedCreateFields` **bilinçli beyaz liste** | model yoksa **gövde aynen geçer** |

**Ek config allowlist'leri:** `searchFields` (`?search=`), `dateFields` (`?dateField=`), `nestedCreateFields`, `relationSortMap`, `uniqueField`, `autoCode.{prefix,field,digits}`, `duplicateNameField`/`ScopeField`/`Where`, `defaultInclude`, `entityLabel`.

### Denetimin bakması gereken noktalar (kodun kendisi ikisini yazıyor)

1. **`safeFilters` allowlist'i UI'ın filtrelenebilir kümesi DEĞİL, modelin TÜM kolonları.** Kod yorumu (F30, satır 254-259) bunu açıkça söylüyor: response `select`'inde gizlenmiş bir kolon bile `filter[kolon]=x` ile **eşitlik-probe** edilebilir → var/yok oracle'ı. Yorum ayrıca kuralı koyuyor: *"DÜZ saklanan sır kolonlu (quickPin/cardToken emsali) bir modeli BaseService'e BAĞLAMA"*. **Denetim: bugün BaseService'e bağlı modellerin hiçbirinde sır kolonu olmadığı DOĞRULANMALI** — bu belgede doğrulanmadı, `ŞÜPHELİ`.
2. **Üç guard da DMMF'e bağlı ve DMMF `Prisma as unknown as {…}` cast'iyle okunuyor** (deprecated runtime yüzey). `assertBaseServiceGuards()` bunu boot'ta yalnız **`Item` modeliyle** yokluyor — probe modeli çözülüyorsa tüm sistem sağlıklı varsayılıyor. Prisma major upgrade'inde yüzeyin kısmi kalması (bazı modeller çözülür, bazıları çözülmez) teorik olarak fail-open bırakır.
3. **`create`/`update`/`softDelete`/`hardDelete` HİÇBİRİ transaction kullanmıyor.** `hardDelete` `delete` + audit; `performInsert` `create` + audit — audit best-effort ve tx dışı (proje kuralı). Nested create (`nestedCreateFields`) Prisma'nın kendi nested write'ıyla atomik; ama `reactivate` yolunda nested alanlar **sessizce atılıyor** (satır 685-691).
4. **`assertNameNotDuplicate` tüm adayları belleğe çekiyor** (satır 539: `findMany` — `where` yalnız kapsam/exclude filtresi, **`select`'te ad + kod var ama LIMIT yok**), sonra JS'te `foldNameForCompare` ile karşılaştırıyor. Gerekçe yazılı (PG `lower()` Türkçe İ/ı'da hatalı). Master-data tabloları küçük olduğu sürece sorun değil — **ama bu bir tam tablo taramasıdır ve her create/update'te koşar.** Hangi modellerde kaç satıra karşılık geldiği ölçülmedi.
5. **`hardDelete` P2003'ü 409'a çeviriyor** — ama yukarıdaki §1.3'e göre ilişkilerin 92'si **SET NULL**. SET NULL olan bir ilişki P2003 fırlatmaz; **sessizce NULL'lar**. Yani "bağlı kayıt varsa silinmez" güvencesi yalnız RESTRICT'li ilişkiler için geçerli.

---

## 8. Denetimin bakması gereken noktalar (öncelik sırasıyla)

1. **Tek global 20 s transaction bütçesi × 377 satırlık iş.** 115 tx'in hepsi aynı `timeout: 20_000` altında. `tambur.finalize` (200 kesime kadar döngü + tx boyu tutulan global barkod sayacı kilidi) ve `subcontractor.dispatch` (354 satır + belge dondurma) bu bütçeyi zorlayabilecek adaylar. P2028 üretim log'unda hiç görüldü mü?
2. **`freezeForSource` transaction içinde belge üretiyor.** Bir sevk transaction'ı, resmi belgenin tüm içeriğini toplayan çok-sorgulu bir okuma zincirini + 4 seri ayar okumasını kapsıyor. Belge büyüdükçe (çok çuvallı sevkiyat) tx uzuyor.
3. **`roll_barcode_counters` gün+tip başına TEK satır ve kilit tx boyunca tutuluyor.** Sistem genelinde top yaratmanın serileşme noktası. Vardiya piki altında ölçülmeli.
4. **148 ilişkide `onDelete` yazılmamış; 92'si örtük SET NULL.** DB ile şema bugün birebir uyuşuyor (ölçüldü) — ama "izlenebilirlik FK'sı sessizce NULL'lanır" davranışı hiçbir yerde açıkça beyan edilmemiş.
5. **`updateMany` 225 çağrının ~117'sinde sonuç sayısı denetlenmiyor.** Hangileri durum geçişi (claim olmalı), hangileri toplu güncelleme — sınıflandırılmadı.
6. **ESLint `Promise.all(tx.*)` guard'ı isim tabanlı.** Bugün 111/111 uyumlu; tek bir parametre yeniden adlandırması korumayı sessizce kapatır.
7. **1-argümanlı advisory lock uzayı iki bağımsız alt sistem tarafından paylaşılıyor** (`session-registry` ↔ `permission-management`), 2-argümanlılar özenle ayrılmışken. Asimetri belgesiz.
8. **`safeFilters` allowlist'i = modelin tüm kolonları** → BaseService'e bağlı modellerde gizli kolon enumerasyonu teorik olarak mümkün. Bağlı model listesi çıkarılıp sır kolonu taranmalı.
9. **`assertNameNotDuplicate` LIMIT'siz `findMany`** her master-data create/update'inde koşuyor.
10. **`type Db = PrismaClient | Prisma.TransactionClient` çift-mod helper'ları** (4 yer) — çağrı yerlerinin gerçekten tx içinde olup olmadığı doğrulanmalı.
11. **Nested transaction taraması isim-tabanlı heuristikti** (`tx4.mjs`); dolaylı çağrı zincirlerini görmez. AST tabanlı çağrı grafiğiyle tekrarlanmalı.
12. **`$queryRawUnsafe` tek kullanımı bugün güvenli** (hardcoded tablo listesi) — parametre kaynağı genişletilirse ilk kırılacak yer.

---

## Ek — üretilen tarama dosyaları

`/private/tmp/claude-501/-Users-oad-Documents-projeler-AdnanSahin/aa02acef-d61f-4847-b0d1-9d16fbf1841d/scratchpad/`
`txscan.mjs` (tx gövdesi + şüpheli içerik) · `tx2.mjs` (tx içi `prisma.`/`Promise.all`) · `tx3.mjs` + `tx3.txt` (**115 tx'in tam envanteri**) · `tx4.mjs` (nested tx heuristiği) · `tx5.mjs` (tx içi sorgu sayısı + döngüde yazma).
