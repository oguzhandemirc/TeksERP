# Dokuma raporları BACKEND'i — uygulanabilir tasarım özeti (2026-09-14, 47 → taze 01)

> **Bu belge bir ÖZETTİR, yeni tasarım değil.** Kaynakları birleştirir ve bugünkü şemaya karşı ÖLÇÜLMÜŞ hâle indirger: d9 sözleşmesi (`docs/kurallar/dokuma.md` § Raporların sözleşmesi + iki değişmez, `c696cefb`) · ön koşul bekçisi `test_dokuma_rapor_onkosullari` (20 sonda; §4 mandalı taşıyıcı inince UYANIR) · `DOKUMA-TEZGAH-IZLEME-TASARIMI.md` §2.5 / §2.10 / §2.11 / §4 / §5 / §6.4 / §9 Faz 1a · 6e ile bağlayıcı mühür sözleşmesi (`helpers/machine-stop-context.helper.ts` `assertStopShiftWritableTx` docstring'i: `MachineShiftStat.sealState/sealGeneration/sealedAt/sealedById`, `findUnique({ machineId_shiftInstanceId })`, satır yoksa OPEN, SEALED → 409 `SHIFT_SEALED`).
> **Kod YOK.** Taban `origin/main` 29fac167. Kapsam: şema + migration · terim hesabı · materyalizasyon anı/tetik · mühür çevrimi · okuyucular · kapanış ölçütleri (MEKANİZMA adıyla) · sondalar · dilim sırası. Panel/tablet yüzeyi AYRI dilim.

## 0 · Bugün ne var, ne yok (ölçüldü 29fac167)

| var | yok |
|---|---|
| `ShiftDefinition` · `ShiftInstance` (`factoryDayKey` timestamptz, `isCancelled`, `stops` ilişkisi) | **`ShiftInstance` materyalize eden job YOK** (`shiftInstance.create` yalnız bekçilerde) |
| `MachineStopEvent` (Faz 1b: `shiftInstanceId` · `factoryDay @db.Date` · `reasonCode/lossClass/reasonSource` · `durationSec` · `source` · `beamSlot` · `revokedAt`) + `MachineStopReclass` | `MachineShiftStat` · `MachineShiftStopBreakdown` · `MachineShiftStatSeal` · `MachineSealState` · `MachineSealAction` |
| `MachineRun` kapanış terimleri (`picksAtClose` · `producedM` · `observedSecAtClose` · `stopSecAtClose` · `stopCountAtClose` · `closedTermsAt`, tek yazar `closeMachineRunTx`) · `targetPicksPerMin` · `unitsPerCm` | `loom-efficiency.helper` (`computeMachineKpis`) · duruş kırpma helper'ı · `DOKUMA_UFKU` sabiti |
| `MachineSpec` (`nominalPicksPerMin` · `monitoringState OFF/SHADOW/LIVE` · `baselineRunHours/At`) | `loom:shift-unseal` izni · `MACHINE_DELETE_GUARDS.machineShiftStatCount` · `@db.Date` muafı `MachineShiftStat.factoryDay` |
| `MachineDataSource` (MACHINE · INFERRED · OPERATOR · SUPERVISOR · SIMULATED) — her kolon `@default`suz (§3c mandalı) · `MachineStopLossClass` | `test_machine_shift_seal` · `test_machine_shift_terms` · `test_machine_efficiency_formula` · **rapor ÇIKTI bekçisi** (`test_dokuma_rapor_onkosullari §4` bunu adıyla ister) |
| `requireDokumaEnabled` (üç router) · `report:production` · `loom:manual-entry` · `loom:classify` · `factoryDayKeyUtcMidnight`/`factoryDaySql` · `setInterval` + `SystemSetting` damgalı zamanlayıcı kalıbı (`jobs/archive-scheduler.ts`; `node-cron` yasak) · `constants/ledger-horizon.ts` ufuk emsali | `tezgah.breakOutOfPot` · `tezgah.stopEventMinSeconds` · `tezgah.shiftDayAttribution` · `tezgah.maxOpenRunDays` bayrakları (hiçbiri yok) |

## 1 · Dört karar — 1e HÜKMÜ (2026-09-14, tren #59 sonrası; dördü de aşağıdaki öneriler gibi)

> **Hüküm (1e):** ① tanecik `(machineId, shiftInstanceId)` — 6e sözleşmesi kazanır; §2.10 `productionLineNo` unique'ten düşer; hat kırılımı gerekirse EKLEMELİ çocuk tablo `MachineShiftLineStat`, bugün doğmaz; tasarım §4 ③b / N9 / P-yapı **"GEÇERSİZ → 2026-09-14"** damgası + arşiv notu (01'in dilim 1'i). ② kapı `requireDokumaEnabled`; `tezgah.enabled` telemetriye (Faz 2); `requireTezgahEnabled` bu dilimde DOĞMAZ. ③ okuma `report:production` (`loom:read` AÇILMAZ), mühür `loom:manual-entry`, TEK yeni kod `loom:shift-unseal` (`WEB_PRODUCTION_SUPERVISOR` şablonu + `SCREENLESS`; reçete route+izin, migration yok, katalog uzlaştırması); SoD üçlüsüne girmez. ④ Faz 1b `picksActual` = Σ `picksAtClose` koşumun KAPANDIĞI vardiyaya; kırpma/süre orantılama YOK (uydurma değer yasağı), açık koşum `warnings`.
> Aşağıdaki dört madde hükmün gerekçesidir; öneri ile hüküm birebir.


1. **Karne taneciği ve unique.** §2.10 `@@unique([machineId, shiftInstanceId, productionLineNo])` der; 6e sözleşmesi ve `assertStopShiftWritableTx` **`@@unique([machineId, shiftInstanceId])`** okur. **Öneri: 6e sözleşmesi kazanır** — mühür VARDİYA×MAKİNE düzeyinde ATOMİKTİR (§4 ③b'nin kendi kuralı; "kısmi mühür yok"), duruş seddi zaten makine bazlı (`one_open_per_machine`), tüm makineler tek hatlı (`productionLineCount` varsayılan 1). Hat kırılımı gerekirse **eklemeli** çocuk tablo `MachineShiftLineStat(statId, productionLineNo)`; §4 ③b / N9 / P-yapı bu özetle "GEÇERSİZ → 2026-09-14" damgası alır (tasarım belgesinde tek satır).
2. **Kapı bayrağı.** Karne ve raporlar dokuma defterlerinden (`MachineRun` · `MachineStopEvent` · `DoffEvent`) doğar ⇒ `requireDokumaEnabled`. `tezgah.enabled` telemetriye (Faz 2 ingest/pano) ayrılır; Faz 1a'nın `requireTezgahEnabled` + `REGIME_GATES` satırı bu dilimde DOĞMAZ (§9'un kapı↔ekran sırası tuzağı da böyle atlanır). `dokuma.md` §7.1 tablosuna tek satır.
3. **İzinler — bir yeni kod.** Okuma: `report:production` (mevcut; üç rapor üretim raporudur, `routes/reports/production.routes.ts` emsali) — ayrı `loom:read` AÇILMAZ. Mühür: `loom:manual-entry` (mevcut). Mühür açma: **yeni `loom:shift-unseal`** (geçmiş rakamı değiştirir; `WEB_PRODUCTION_SUPERVISOR` + `SCREENLESS` gerekçeli; `roll:manual-adjust` ailesi, SoD üçlüsüne GİRMEZ). Terim düzeltme (elle vardiya girişi): `loom:manual-entry`.
4. **Faz 1b'de üretim atkısının kaynağı.** Kova yok ⇒ `picksActual` = Σ `MachineRun.picksAtClose` (**koşumun KAPANDIĞI vardiyaya**, kırpma yok — BEYAN; açık koşum katılmaz ve `warnings` yazar) · `producedM` = Σ `MachineRun.producedM` aynı kural · `targetPickCapacityApt/Pot` koşumların vardiya penceresiyle KESİŞEN dakikalarından (§5.2). Alternatif (tek koşum > 1 vardiya ise atkıyı süreyle orantılamak) Faz 2'ye (kova) bırakılır — orantılama UYDURMADIR.

## 2 · Şema — migration `20260914130000_machine_shift_stats` (İNDİ 2026-09-14, Dilim 1; 100000 bandı devere `125000`in altında kaldığı için 130000)

```prisma
enum MachineSealState  { OPEN  SEALED }
enum MachineSealAction { SEAL  UNSEAL  RESEAL }

/// ÖZET / MATERYALİZE KARNE (DURUM) — vardiya × makine. İŞ VERİSİ: budanmaz. Mühürlü satır
/// yeniden HESAPLANMAZ (`period-guard.helper` gerekçesi). `updatedAt` VAR: güncel gerçek bu satır,
/// geçmiş `MachineShiftStatSeal`. Terimler SANİYE ve ATKI; oranlar yalnız mühürde denormalize.
model MachineShiftStat {
  id              String   @id @default(uuid()) @db.Uuid
  machineId       String   @db.Uuid
  shiftInstanceId String   @db.Uuid
  /// `ShiftInstance.factoryDayKey`ten KOPYA, DONAR (tek yazar: materyalizasyon). `@db.Date` muafı.
  factoryDay      DateTime @db.Date

  calendarSec      Int @default(0)
  unobservedSec    Int @default(0)   // Faz 1a/1b: 0 = BEYAN (gözlemci insan); Faz 2 artık yöntemi
  nonScheduledSec  Int @default(0)
  plannedBreakSec  Int @default(0)
  potSec           Int @default(0)
  aptSec           Int @default(0)
  setupSec         Int @default(0)
  plannedDownSec   Int @default(0)
  unplannedDownSec Int @default(0)
  minorStopSec     Int @default(0)
  minorStopCount   Int @default(0)
  stopCount        Int @default(0)
  warpStopCount    Int?              // Faz 1b: NULL = ÖLÇÜLMEDİ (0 yazılmaz)
  weftStopCount    Int?
  unclassifiedSec  Int @default(0)   // >0 → rapor `warnings`
  picksActual      Int @default(0)
  gapPicks         Int @default(0)   // Faz 2
  watchdogSec      Int @default(0)   // Faz 2
  targetPickCapacityApt Int @default(0)
  targetPickCapacityPot Int @default(0)
  targetPicksPerMin Int?             // yalnız TEK koşumlu vardiyada etiket
  stopThresholdSec  Int              // karneye DONAR (bugün sabit: `MINOR_STOP_THRESHOLD_SEC`)
  unitsPerCmAtClose Decimal? @db.Decimal(8, 3)
  producedM         Decimal? @db.Decimal(12, 3)
  availabilityPct  Decimal? @db.Decimal(5, 2)   // MÜHÜRDE `loom-efficiency.helper` yazar
  performancePct   Decimal? @db.Decimal(5, 2)
  effectivenessPct Decimal? @db.Decimal(5, 2)
  formulaVersion   Int?
  source          MachineDataSource            // @default YOK (§3c mandalı) — §3 öncelik kuralı
  monitoringState MachineMonitoringState       // `MachineSpec`ten KOPYA, DONAR
  anomalyAck      Boolean @default(false)      // Faz 2 kapısı; Faz 1b false kalır
  sealState      MachineSealState @default(OPEN)
  sealGeneration Int              @default(0)
  sealedAt       DateTime?        @db.Timestamptz   // ASLA null'lanmaz
  sealedById     String?          @db.Uuid
  machine       Machine       @relation(fields: [machineId], references: [id], onDelete: Restrict)
  shiftInstance ShiftInstance @relation(fields: [shiftInstanceId], references: [id], onDelete: Restrict)
  sealedBy      User?         @relation("MachineShiftStatSealedBy", fields: [sealedById], references: [id])
  breakdown     MachineShiftStopBreakdown[]
  seals         MachineShiftStatSeal[]
  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt      @db.Timestamptz
  @@unique([machineId, shiftInstanceId])       // 6e sözleşmesi (karar 1)
  @@index([factoryDay, machineId])
  @@index([sealedAt])
  @@map("machine_shift_stats")
}

/// DEFTER (append-only) — SEBEP × KAYIP SINIFI kırılımı, mühür KUŞAĞI başına; Pareto burada.
model MachineShiftStopBreakdown {
  id             String  @id @default(uuid()) @db.Uuid
  statId         String  @db.Uuid
  sealGeneration Int
  reasonCode     String? @db.VarChar(64)          // NULL = sınıflandırılmamış kova
  reasonLabel    String? @db.VarChar(100)         // katalog etiketi KOPYA (katalog değişse rapor değişmez)
  lossClass      MachineStopLossClass?
  beamSlotNull   Boolean @default(false)          // "atanmamış" kovası — beamSlot NULL duruşlar AYRI (§4 çıktı)
  stopCount      Int
  stopSec        Int
  stat      MachineShiftStat @relation(fields: [statId], references: [id], onDelete: Restrict)
  createdAt DateTime @default(now()) @db.Timestamptz
  @@index([reasonCode])
  @@map("machine_shift_stop_breakdowns")
}
// ŞEMA-DIŞI UNIQUE (ham SQL, `test_db_invariants` EXPRESSION_UNIQUES):
//   machine_shift_stop_breakdowns_uq UNIQUE ("statId","sealGeneration", COALESCE("reasonCode",''), "beamSlotNull")
//   (PG NULLS DISTINCT varsayılanı sınıflandırılmamış kovayı korumasız bırakırdı.)
//   ⚠️ İNDİ 2026-09-14 (Dilim 1): NULLS NOT DISTINCT DEĞİL — Prisma onu düz unique okuyup `test_schema_drift`te
//   "DROP INDEX" önerdi; COALESCE ifade indeksi Prisma'ya görünmez ve mevcut envanter sınıfına girer.

/// DEFTER (append-only) — mühür / açma / yeniden mühür izi + terim fotoğrafı.
model MachineShiftStatSeal {
  id             String   @id @default(uuid()) @db.Uuid
  statId         String   @db.Uuid
  action         MachineSealAction
  sealGeneration Int
  terms          Json                              // ARŞİV, sorgulanmaz
  potSec Int   aptSec Int   picksActual Int   targetPickCapacityPot Int
  effectivenessPct Decimal? @db.Decimal(5, 2)
  formulaVersion Int
  reason         String?  @db.VarChar(300)
  actedById      String?  @db.Uuid
  stat    MachineShiftStat @relation(fields: [statId], references: [id], onDelete: Restrict)
  actedBy User?            @relation("MachineShiftSealBy", fields: [actedById], references: [id])
  createdAt DateTime @default(now()) @db.Timestamptz
  @@unique([statId, sealGeneration, action])     // §2.11 doğal anahtar
  @@index([statId, createdAt])
  @@map("machine_shift_stat_seals")
}
```

**Karşı-ilişkiler (aynı commit, `npx prisma validate` temiz):** `ShiftInstance.machineStats MachineShiftStat[]` · `Machine.shiftStats MachineShiftStat[]` · `User.machineShiftStatsSealed` (`"MachineShiftStatSealedBy"`) · `User.machineShiftSealsActed` (`"MachineShiftSealBy"`). **Migration hijyeni:** iki `CREATE TYPE` + üç `CREATE TABLE` aynı dosyada meşru (55P04 yalnız `ADD VALUE`de) · `DropForeignKey` satırı yok · ham SQL unique + `SET lock_timeout='3s'` · `MACHINE_DELETE_GUARDS`a `machineShiftStatCount` (Restrict FK ile AYNI commit; `test_hard_delete_guard_coverage` `EXPECTED` + panel açıklaması) · `test_timestamptz_contract` muaf listesine `MachineShiftStat.factoryDay` · `test_db_invariants` PARTIAL/EXPRESSION envanteri · `defter-beyan.ts` üç satır (`MachineShiftStat` DURUM/mühür çevrimi; `MachineShiftStopBreakdown` DEFTER kuşak, ters yol YENİ KUŞAK; `MachineShiftStatSeal` DEFTER, ters yol yok) · `snapshot-kolonlari.ts` beyanı (donmuş ileri değer sınıfı: `factoryDay` · `stopThresholdSec` · `unitsPerCmAtClose` · `monitoringState` · `targetPicksPerMin`).
**Bayat §2.10 farkları (özet kazanır):** `productionLineNo` unique'te YOK (karar 1) · `reasonLabel` + `beamSlotNull` breakdown'a eklendi (d9 ②: etiket DONAR; §4 çıktısı "atanmamış" kovası AYRI) · `stopThresholdSec` bugün sabitten (bayrak Faz 2).

## 3 · Terim hesabı — TEK helper `helpers/loom-shift-terms.helper.ts` (`computeShiftTerms(tx, machineId, shiftInstanceId)`)

Girdi: `ShiftInstance` penceresi `[startsAt, endsAt)` (iptal → `calendarSec = 0`, terimler 0, `A=P=E=null`) · aktif duruşlar (`revokedAt IS NULL`, **pencereye KIRPILMIŞ** saniye — `clipToWindow(startedAt, endedAt ?? now, window)`; açık duruş `now`a kadar sayılır ve `warnings`) · kapanmış koşumlar (`endedAt` ∈ pencere, `revokedAt IS NULL`) · `MachineSpec`.

```
calendarSec     = endsAt − startsAt
plannedBreakSec = ShiftDefinition.plannedBreakMinutes × 60         (POT'tan düşülür — Faz 1b sabit; bayrak Faz 2)
nonScheduledSec = Σ NON_SCHEDULED kırpılmış  +  BOŞ TEZGAH kuralı (aşağıda)
POT  = calendarSec − unobservedSec(=0) − nonScheduledSec − plannedBreakSec
setup/plannedDown/unplannedDown = Σ kırpılmış duruş sn, KOVA = lossClass; reasonCode NULL → UNPLANNED + unclassifiedSec (kötümser)
minorStop = durationSec < stopThresholdSec olan duruşlar (APT içinde kalır)
APT  = POT − SETUP − PLANNED − UNPLANNED
picksActual = Σ picksAtClose (kapanan koşumlar)     producedM = Σ producedM
targetPickCapacityApt = Σ_i target_i × APT_dk(koşum_i ∩ pencere)   ·   …Pot = Σ_i target_i × POT_dk(…)
   target_i = run.targetPicksPerMin ?? MachineSpec.nominalPicksPerMin ?? ÖLÇÜLEMEDİ (koşum kapasiteye girmez, `warnings`)
targetPicksPerMin = tek koşum ise target_i, değilse NULL
```
`computeMachineKpis(terms)` (`helpers/loom-efficiency.helper.ts`, TEK yazar/okuyucu, AST tripwire: `/ potSec`, `/ aptSec`, `/ targetPickCapacity` aritmetiği başka dosyada geçemez): `A = apt/pot`, `P = (picks − gapPicks)/capApt`, `E = (picks − gapPicks)/capPot`; **payda 0 → `null`** (ölçülemedi; toplamda pay ve paydadan DIŞLANIR, dışlanan sayısı döner); `P > 1` → `warnings` (veri hatası sinyali, düzeltme YOK); oranlar ASLA ortalanmaz (`Σpicks / Σcap`); `formulaVersion = 1`.
**BOŞ TEZGAH kuralı (§5.3/6):** pencerede koşum yok ∧ duruş yok ∧ doff yok ⇒ `nonScheduledSec = calendarSec`, `source = INFERRED`, rapor AYRI satırda beyan eder; amir mühür öncesi `UNPLANNED`a çevirebilir.
**`source` öncelik kuralı (karne satırı):** girdilerden herhangi biri `SIMULATED` (`DoffEvent.counterSource` · `MachineStopEvent.source`) → `SIMULATED` · amir terime elle dokunduysa → `SUPERVISOR` · aksi hâlde tablet yazımı → `OPERATOR` · boş tezgah → `INFERRED` · `MACHINE` yalnız Faz 2. Kural tek helper'da (`resolveShiftSource`), bekçili.

## 4 · Materyalizasyon anı ve tetik

| adım | ne | mekanizma |
|---|---|---|
| **M0 vardiya takvimi** | `jobs/shift-calendar.job.ts` — boot + günlük, 30 gün ileri; `ShiftDefinition` değişince mühürsüz gelecek pencereler yeniden yazılır (satır silinmez) | ilk ifade `if (!(await readDokumaEnabled())) return "disabled"` · `@@unique([shiftDefinitionId, factoryDayKey])` ⇒ idempotent, kilit YOK · `setInterval` + `SystemSetting` damgası (`archive-scheduler` kalıbı) |
| **M1 canlı karne (OPEN)** | `GET …/shift-stats?open=1` pencere açıkken `computeShiftTerms` **anlık** hesaplar, YAZMAZ | tek helper; cevap `warnings` (açık koşum · açık duruş · sınıflandırılmamış · P ölçülemedi) |
| **M2 kapanış materyalizasyonu** | `jobs/machine-shift-close.job.ts`: `endsAt + kapanış payı (60 dk)` geçmiş her (aktif makine × vardiya) için satır yoksa **OPEN satır yazar** (terimler + `source` + `monitoringState` kopyası), varsa ve OPEN ise **yeniden hesaplar** | `upsert` unique üstünde (`ON CONFLICT` hedefli tam unique ⇒ 42P10 yok) · job MÜHÜRLEMEZ (§2.10 Faz 2 kararı) |
| **M3 elle düzeltme** | `PUT …/shift-stats/:id/terms` (`loom:manual-entry`) OPEN satırda terim/kova düzeltir, `source → SUPERVISOR`, audit `MACHINE_SHIFT_STAT` | claim `updateMany WHERE {id, sealState: OPEN}` count 0 → 409 `SHIFT_SEALED` |
| **M4 mühür** | `POST …/shift-stats/:id/seal` (`loom:manual-entry`) tek tx: claim OPEN→SEALED (`sealGeneration+1`, `sealedAt/ById`) · `computeMachineKpis` → oranlar + `formulaVersion` denormalize · `MachineShiftStopBreakdown` YENİ kuşak (eski durur) · `MachineShiftStatSeal(SEAL)` terim fotoğrafı | atomik claim; `anomalyAck` kapısı Faz 2 (kaynağı yok, `false` bloke etmez) |
| **M5 mühür açma / yeniden** | `POST …/:id/unseal` (`loom:shift-unseal`, sebep ≥ 3) claim SEALED→OPEN + `Seal(UNSEAL)`; sonra M2/M3/M4 → `RESEAL` | `sealedAt` null'lanmaz; her adım defter satırı |
| **M6 mühür sınırı** | `assertStopShiftWritableTx` **AYNI yerde** `findUnique({ machineId_shiftInstanceId })` → `sealState === SEALED` → 409 `SHIFT_SEALED`; satır yoksa OPEN | 6e sözleşmesi; kapa · sınıfla · yeniden sınıfla · geri al + **açılış** (F1 hükmü) |

## 5 · Okuyucular — `routes/machine-shift-stat.routes.ts` (`/api/machine-shift-stats`) + `routes/reports/dokuma.report.routes.ts` (`/api/reports/dokuma`)

Kapı sırası: `verifyToken → requireDokumaEnabled → izin`. Hepsi `report:production` (M3–M5 hariç). Tarih parametreleri `resolveRangeStart/End` (fabrika günü), süzme SUNUCUDA, cursor yok (vardiya×makine ≤ ~22k satır/yıl; `take ≤ 500`).

| uç | döner | sözleşme maddesi |
|---|---|---|
| `GET /machine-shift-stats?from&to&machineId&sealState` | karne satırları (terimler + oranlar + `source` + `sealState`) | ③ karne; her satır `source` |
| `GET /reports/dokuma/randiman?from&to&machineId?` | makine×vardiya A · P · E **AYRI** (çarpılmaz) + toplam `Σpicks/Σcap` + `olculemedi: N` + **`kaynakKirilimi: {MACHINE, OPERATOR, SUPERVISOR, SIMULATED, INFERRED}`** (satır sayısı ve POT saniyesi) | ① üç oran, "P: ölçülemedi" beyanı; değişmez ① kırılım |
| `GET /reports/dokuma/durus-pareto?from&to&machineId?` | `reasonCode × lossClass` satırları (`stopCount`, `stopSec`, `reasonLabel` DONMUŞ), `MINOR` AYRI blok (sebep değil), `atanmamis` (beamSlot NULL) AYRI kova, `siniflandirilmamis` AYRI; MÜHÜRLÜ vardiyalarda `MachineShiftStopBreakdown` SON kuşak, OPEN vardiyalarda canlı kırpma | ② iki eksen |
| `GET /reports/dokuma/vardiya-karnesi?factoryDay&shiftDefinitionId?` | vardiya satırları: üretim (`producedM`, `picksActual`), duruş toplamı, `source` kırılımı sayıları (`olculen · elle · simule · cikarim · olculemedi`) | ③; değişmez ① "tek yüzdeye çökertme yasak" |
| `GET /machine-shift-stats/:id/seals` | mühür defteri (kuşaklar) | §2.11 mutabakat |

Her cevap `meta: { ufuk: DOKUMA_UFKU, ufukOncesiSatir: N }` taşır — **`constants/dokuma-ufku.ts`** (`ledger-horizon.ts` emsali, AYRI sabit; `DEFTER_UFKU` OKUNMAZ). Gölge süzgeci: varsayılan `monitoringState = LIVE` (DONMUŞ kolon; Faz 1b'de OFF makineye karne YAZILMAZ — `MachineSpec` yoksa/OFF ise M2 atlar ve sayaç `/api/admin/health`e düşer).

## 6 · Kapanış ölçütleri — MEKANİZMA adıyla

1. **Mühür = ATOMİK CLAIM** — `updateMany WHERE { id, sealState: OPEN }`, `count === 0 → 409 SHIFT_SEAL_RACE` (taze okumayla tanı); unseal/reseal aynı kalıp; `sealedAt` hiçbir yolda null'lanmaz (grep + bekçi).
2. **Mühür sınırı = TEK KAPI** — `assertStopShiftWritableTx` beş yolda (aç · kapa · sınıfla · yeniden sınıfla · geri al) `sealState` okur; mühürlü vardiyada duruş yazımı 409 `SHIFT_SEALED` (negatif sonda: helper'dan `sealState` okuması düşürülünce kırmızı).
3. **Kırılım = DEFTER KUŞAĞI** — `MachineShiftStopBreakdown` satırı GÜNCELLENMEZ/SİLİNMEZ; reseal yeni `sealGeneration` yazar; okuma helper'ı son kuşağı alır; `defter_ters_yol` beyanı `YENİ KUŞAK`.
4. **Oran = TEK HELPER + AST TRIPWIRE** — `computeMachineKpis` dışında `/ potSec|aptSec|targetPickCapacity` aritmetiği yok; yüzde dizisi kabul etmez; `null`ı 0 sayan çağrı yok.
5. **Kaynak kırılımı = `@default`suz `source` KOLONU + ÇIKTI BEKÇİSİ** — `test_dokuma_rapor_onkosullari §3c/§3d` envanterine `machine_shift_stats.source` **(a) sınıfı** ile yazılır ve §4 mandalı bu commit'te kapanır: rapor çıktı bekçisi (`test_dokuma_rapor_cikti.ts`) aynı commit'te iner (toplam = Σkırılım · kırılım basılıyor · `SIMULATED ≠ OPERATOR` · P ölçülemedi beyanı · MINOR sebep değil · atanmamış kova ayrı).
6. **Gün sınırı = TEK KAYNAK** — `factoryDayKeyUtcMidnight` / `factoryDaySql`; `MachineShiftStat.factoryDay` `ShiftInstance.factoryDayKey`ten kopya; çıplak `DATE_TRUNC` yok (`test_timestamptz_contract` + grep).
7. **Duruş kırpma = TEK HELPER** — `clipToWindow`; değişmez `Σ breakdown.stopSec + minorStopSec ≤ potSec` (`test_machine_shift_terms`).
8. **Ufuk = AYRI SABİT** — `DOKUMA_UFKU` (`constants/dokuma-ufku.ts`); rapor `meta.ufuk` basar; `DEFTER_UFKU` import'u dokuma raporunda YASAK (AST).
9. **Vardiya takvimi = İDEMPOTENT JOB** — `@@unique` ile kilitsiz; bayrak kapalıyken `"disabled"` (`test_module_flag_off` sondası: kapalıyken `shift_instances` satırı DOĞMAZ).
10. **Kapalıyken sıfır fark** — üç router `requireDokumaEnabled`; `dokuma_regime_gate` KAPILI listesine iki dosya; referans profilde (`dokuma.enabled=false`) job'lar `"disabled"`, tablo boş, panelde ekran yok.
11. **Silme yüzeyi = GUARD** — `machineShiftStatCount` `MACHINE_DELETE_GUARDS`ta; `hard_delete_guard_coverage` EXPECTED.

## 7 · Sondalar / bekçiler

| bekçi | ölçer | negatif sonda (kırmızı görülerek) |
|---|---|---|
| `test_machine_shift_seal` (DB) | seal/unseal/reseal claim'leri, iki paralel seal → 1×200 + 1×409, `sealGeneration` artar, `sealedAt` null'lanmaz, Seal defteri doğal anahtarı, mühürlü vardiyada duruş kapama/sınıflama/geri alma/açılış 409 `SHIFT_SEALED` (6e sözleşmesi) | claim'den `sealState: OPEN` düşürülünce · helper'dan `sealState` okuması düşürülünce · `sealedAt: null` yazılınca |
| `test_machine_shift_terms` (DB) | vardiya sınırında kırpma (23:50 başlayan 12 sa duruş → ilk vardiyaya yalnız 10 dk) · `Σ breakdown + minor ≤ POT` · boş tezgah → INFERRED · iptal vardiya → terimler 0, oranlar null · iki koşum → `targetPicksPerMin` NULL, kapasite toplanır · açık koşum atkısı katılmaz + warning | kırpma kaldırılınca · INFERRED kuralı kaldırılınca |
| `test_machine_efficiency_formula` (DB'siz) | `E = A×P` tek hedefte birebir · payda 0 → null · `P>1` warning · AST: bölme aritmetiği yalnız helper'da, `avg(…Pct)` yok, `?? 0` null-çökertmesi yok | helper dışına bölme konunca |
| `test_dokuma_rapor_cikti` (HTTP/DB) | ① üç oran ayrı + "P: ölçülemedi" · ② `MINOR` sebep satırı değil, `atanmamis` kova ayrı, `reasonLabel` donmuş (katalog etiketi değişince eski kuşak değişmez) · ③ toplam = Σkırılım, kırılım basılır, `SIMULATED` `OPERATOR`a katılmaz · `meta.ufuk` basılır | kırılım cevaptan düşürülünce · SIMULATED OPERATOR'a katılınca · `MINOR` sebep listesine girince |
| `test_dokuma_rapor_onkosullari` (mevcut) | §3d envanterine `machine_shift_stats.source` (a); §4 mandalı KAPANIR (`tasiyiciKarari(true)` → çıktı bekçisi VAR beyanı) | envanter satırı silinince §3d kırmızı |
| `test_shift_calendar_job` (DB) | 30 gün ileri, idempotent (ikinci koşum 0 yeni), tanım değişince mühürsüz gelecek pencere yeniden yazılır, mühürlü pencere DEĞİŞMEZ, bayrak kapalı → `"disabled"` + 0 satır, iptal satır korunur | `@@unique` yüklemi kaldırılınca çift satır |
| mevcutlar (aynı commit koşulur) | `db_invariants` (EXPRESSION_UNIQUES + partial) · `timestamptz_contract` (muaf) · `hard_delete_guard_coverage` · `defter_ters_yol` (üç beyan) · `snapshot_kolonlari` · `dokuma_regime_gate` (KAPILI +2) · `route_auth_coverage` · `swagger_spec` · `permission_catalog`/`role_template`/`screen_catalog` (`loom:shift-unseal` üçlüsü) · `module_flag_off` (kapalıyken iki uç 403 + job disabled) · `audit_labels` (`MACHINE_SHIFT_STAT`, `MACHINE_SHIFT_SEAL`) · `advisory_lock_namespaces` (uzay açılmadı — claim + unique yeter) · `identity_ledger` · `mobil_enum_aynasi` (`MachineSealState` tablet aynasına GİRMEZ — tablet yüzeyi yok, muaf gerekçeli) | — |

## 8 · Dilim sırası (her dilim ayrı commit, ayrı bekçi)

1. **Şema + takvim job'u + guard + envanterler** (migration `20260914100000_machine_shift_stats`; `shift-calendar.job`; `MACHINE_DELETE_GUARDS`; `@db.Date` muafı; beyanlar) — davranış: tablo boş, job bayraklı.
2. **Terim helper'ları + canlı karne (M1) + `test_machine_shift_terms` + `test_machine_efficiency_formula`** — kod yazmaya başlamadan ÖNCE `computeShiftTerms` sözleşmesi bekçiyle kırmızı görülür.
3. **Kapanış job'u (M2) + elle düzeltme (M3) + mühür/unseal (M4/M5) + `assertStopShiftWritableTx`e `sealState` (M6) + `test_machine_shift_seal` + `loom:shift-unseal` üçlüsü.**
4. **Üç rapor ucu + `DOKUMA_UFKU` + `test_dokuma_rapor_cikti` + `test_dokuma_rapor_onkosullari` envanter/§4 kapanışı + dokuma.md kural satırları (üç rapor cümlesi "İNDİ" damgası) + arşiv notu.** Sürüm notu (backend): "dokuma vardiya karnesi ve üç rapor — yalnız `dokuma.enabled` açık kurulumda; referans fabrikada etki 0".

**Açık bırakılanlar (bilinçli):** kova/telemetri (`MachineInterval`, `unobservedSec`, `gapPicks`, `watchdogSec`, `anomalyAck` kapısı, budayıcı) Faz 2 · `tezgah.*` davranış bayrakları (mola POT içi/dışı, mikro duruş eşiği, gece yarısı atfı) Faz 2'de doğar, bugün sabit ve karneye DONAR · hat kırılımı (karar 1) · `Machine.warpBeamSlots` (F4 penceresi) · panel/tablet yüzeyi.
