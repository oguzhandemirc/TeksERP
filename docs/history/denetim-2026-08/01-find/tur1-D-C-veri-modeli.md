# D-C — Veri modeli & kısıtlar [P4] · ② BULMA, TUR 1

**Denetçi:** D-C · **Tarih:** 2026-08-28 · **HEAD:** `ce8681d1` (dal `adnansahin`) · **Mercek:** kod merkezli (alan denetçileri + kritik yazma yolu 8-soru)
**Veri kaynakları:** `tekserp_saha_0825` (prod kopyası, 190/195 migration) ve `adnansahin_db` (dev, 195) — ikisi de `audit/tools/sql-*.sh` ile SALT-OKUNUR.
**Girdiler:** K2a (kısıt matrisi/Cascade/Json/Decimal/unique-NULL), K2b (CHECK/trigger/partial + dev↔saha diff), K7a §3 (Decimal→Number), K10 §3-§7 (değişmez + doğrulama sorguları), MATRIX ÇAPRAZ OKUMA §A, SINIR-ÖTESİ "C — Veri modeli" satırları, K12 (reddedilmiş bulgular).

**Bu turda KOŞTURULAN sorgular:** `scripts/consistency-check.sql` (19 bölüm × 2 DB) · `scripts/consistency-check-derived.sql` (§21-§26b × 2 DB) · `test_consistency.ts` §20 sorgusu (elle, × 2 DB) · K10 Q-STK-02/03/03b · özel yetim/tombstone/denorm/TZ taramaları (aşağıda her bulguda SQL).

---

## BULGULAR

---

### [D-C-01] Tambur geri almasıyla iptal edilen kesim çocuğu "İptali Geri Al" ile diriltilebiliyor — metrajı ebeveyne ZATEN iade edilmişti, ikinci kez canlanıyor

| Şiddet | **S1** | Kategori | C (durum alanları / denormalize) | Öncelik | **P0** | Modül | ENV/ÜRE (top yaşam döngüsü) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Tambur kesimini geri alma (`TamburUndoService.applySingle/applyFull`) kesim parçasını `CANCELLED` yapar ve parçanın metrajını **ebeveyne geri koyar** — parçanın kendi `currentQty`'si ise satırda **olduğu gibi kalır**. "İptali Geri Al" (`restoreCancelledRoll`) bu topu hiçbir engele takılmadan diriltir: yüklem (`resolveRollRestoreBlockReason`) hareket / istasyon işlemi / çocuk / çuval / sevk / adım bakar ama **`parentRollId`'ye ve "bu iptal bir geri almanın ürünü mü" sorusuna BAKMAZ**. Sonuç: aynı metre hem ebeveyn (ya da ebeveynin yeni parçaları) hem de dirilen parça üzerinden stokta iki kez sayılır.

**Kanıt.**
- `Teks-Erp/src/services/tambur-undo.service.ts:1073-1080` (aynısı `:1260-1267`, `:1488-1495`):
```ts
const cancelled = await tx.roll.updateMany({
  where: { id: childId, status: { in: CHILD_CANCELABLE_STATUSES },
           sackId: null, shipmentId: null, currentStepId: null },
  data: { status: RollStatus.CANCELLED },   // ← preCancelStatus / cancelledAt YAZILMAZ
});
```
  (`CHILD_CANCELABLE_STATUSES` = `WAREHOUSE, A1_STOCK, STOCK, SCRAP` — `tambur-undo.service.ts:114-119`; metraj iadesi `:1130-1141` `initialBump` + `recordVarianceTx`.)
- `Teks-Erp/src/services/helpers/roll-cancel-restore.helper.ts:70-110` — yüklemin TAM listesi: `status`, `movementCount`, `operationCount`, `childCount`, `currentStepId`, `sackId/shipmentId`, `dispatchItemCount/kartelaItemCount`. `parentRollId` **yok**; `batchId` engeli 2026-08-25'te BİLEREK kaldırıldı (`:83-100` gerekçe bloğu).
- `Teks-Erp/src/services/inventory.service.ts:3397-3442` — sinyaller toplanırken `parentRollId` **select'e bile alınmıyor**; `:3448` `resolveRestoreTargetStatus(existing.preCancelStatus)`; `:3452-3464` claim `{id, CANCELLED}` → `status: target`.
- `Teks-Erp/src/routes/inventory.routes.ts:614-619` — uç `POST /api/rolls/:id/restore-cancel`, izin `requireAnyPermission("roll:write", ...MOBILE_ROLL_CANCEL)` → **depo operatörünün mobil yetkisi yeter**, süpervizör şartı yok.
- Kaldırma kararının kendi ölçümü (`roll-cancel-restore.helper.ts:93-96`): *"231 iptalin 86'sı YALNIZ bu kural yüzünden kilitliydi ve **85'i Tambur çıktısıydı** — sıfır hareket, sıfır istasyon işlemi, sıfır çocuk."* Gerekçe doğruydu ama eksikti: bu 85 topun bir kısmının metrajı geri alma sırasında **zaten ebeveyne iade edilmişti**; "hareketi yok" onların canlı olmadığını değil, hiç istasyona girmediklerini söyler.

**failure_mode (somut).** `T210826F0025` (40 m, kesim çocuğu, `parentRollId` dolu). 2026-08-21 11:50'de operatör kesimi geri aldı → audit `{"event":"TAMBUR_UNDO_SINGLE","restoredLen":40,"cancelledChildId":"1a62ffaa-…"}`; 40 m ebeveyne döndü, parça `CANCELLED` oldu **ama `currentQty` 40,000 olarak satırda kaldı**. Bugün depo operatörü Envanter → Arşiv sekmesinde bu topu bulup "İptali Geri Al" derse: yüklem `null` döner (mv=0, op=0, ch=0, çuval/sevk/adım yok), `preCancelStatus` NULL olduğu için hedef `STOCK` seçilir ve **40 m yeniden canlı Ham Stok olur**. Aynı 40 m ebeveynde/ebeveynin yeni parçalarında da duruyor → Ham Stok 40 m fazla, Ürün Dengesi `malzemeAcigi` 40 m eksik, o kadar mal siparişe taahhüt edilebilir. Hata mesajı yok, log yok, `consistency-check` bölümü yok.

**Veride fiili ihlal (K2).** İhlal **henüz oluşmamış**; ölçülen şey ihlale HAZIR kayıt kümesidir.
```sql
-- saha (tekserp_saha_0825)
WITH undo AS (SELECT ("newData"->>'cancelledChildId')::uuid child FROM system_logs
              WHERE "newData"->>'event' LIKE 'TAMBUR_UNDO%' AND "newData" ? 'cancelledChildId'),
c AS (SELECT r.id, r."currentQty",
        (SELECT count(*) FROM roll_movements m WHERE m."rollId"=r.id) mv,
        (SELECT count(*) FROM roll_operations o WHERE o."rollId"=r.id) op,
        (SELECT count(*) FROM rolls k WHERE k."parentRollId"=r.id) ch,
        (SELECT count(*) FROM subcontractor_dispatch_items d WHERE d."rollId"=r.id) di,
        (SELECT count(*) FROM kartela_dispatch_items ki WHERE ki."rollId"=r.id) ki
      FROM rolls r WHERE r.status='CANCELLED'
        AND r."sackId" IS NULL AND r."shipmentId" IS NULL AND r."currentStepId" IS NULL)
SELECT count(*) FILTER (WHERE mv=0 AND op=0 AND ch=0 AND di=0 AND ki=0) geri_alinabilir,
       count(*) FILTER (WHERE mv=0 AND op=0 AND ch=0 AND di=0 AND ki=0 AND id IN (SELECT child FROM undo)) undo_kaynakli,
       sum("currentQty") FILTER (WHERE mv=0 AND op=0 AND ch=0 AND di=0 AND ki=0 AND id IN (SELECT child FROM undo)) undo_metraj
FROM c;
```
→ **SAHA: geri_alinabilir 215 / 230 · undo_kaynakli 50 · undo_metraj 1.834,800 m.** (`system_logs`'ta 53 `TAMBUR_UNDO*` olayı var; 50'sinin iptal ettiği çocuk hâlâ diriltilebilir durumda.) Örnek satırlar: `1a62ffaa-2726-4ef2-a88a-df9722952ed5` (`T210826F0025`, 40 m, `preCancelStatus`/`cancelledAt` NULL, ebeveyn `TAMBUR_CONSUMED`), `e3e3766b-aadc-4fd6-bb50-bfaa8e1ed90c` (`T200826F0117`, 40 m).
DEV: aynı sorgu 0 (dev'de undo audit'i yok).

**İş etkisi.** Ham/Bitmiş stokta olmayan mal görünür; Ürün Dengesi, sipariş karşılama (`freeSemiFinished`/`netGap`), Stok Karnesi ve Kanban aynı metreyi iki kez sayar. Sevk planlaması var olmayan mala dayanır; hata ancak fiziksel sayımda çıkar. 50 aday × ort. 36,7 m.

**Öneri (2. tur için).**
- **Kısa vade (kod):** `resolveRollRestoreBlockReason`'a **altıncı sinyal** ekle — `parentRollId != null` **ve** iptalin kaynağı bir geri alma ise reddet. Kaynağı satırdan okumak için tercih edilen yol: `Roll.cancelReasonCode`'a sistem kodu (`BUILTIN_TAMBUR_UNDO`) yazmak (D-C-03 ile aynı düzeltme) — audit'e bakmak 6 ay sonra çalışmaz. Geçici/emniyetli varyant: `parentRollId != null && preCancelStatus == null` → red ("Bu top bir kesim geri almasının ürünüdür; metrajı ana topa iade edildi").
- **Uzun vade:** `tambur-undo` iptal ederken parçanın `currentQty`'sini **0'a çeksin** (metraj ebeveyne taşındı, parçada kalmamalı) — o zaman dirilse bile 0 m dirilir. Bu bir veri anlamı düzeltmesidir; `[PROD'DA ÇALIŞTIRMA]` gerektiren geriye dönük düzeltme AYRI karar (50 satır, dry-run script + tek tek liste).
- Bekçi: N=1 davranış sondası — "kes → geri al → restore-cancel dene → 409 bekle" (`scripts/test_roll_cancel_undo.ts` içine §; negatif sonda: guard satırı silinince kırmızı).

**Kabul kriteri.** (a) Undo ile iptal edilmiş bir kesim çocuğunda `POST /rolls/:id/restore-cancel` → 409 `RESTORE_BLOCKED` + operatöre ne yapacağını söyleyen Türkçe mesaj. (b) Yeni bekçi guard satırı kaldırılınca kırmızı veriyor. (c) Sahadaki 50 satır için iş kararı yazılı (dokunulmayacaksa gerekçe kod yorumunda).
**Efor:** 1,5 gün (kod + bekçi) · veri düzeltmesi ayrı.
**Önceki defter.** `audit/FINDINGS.jsonl`'de karşılığı yok (iptal geri alma 2026-08-12'de, batch engelinin kaldırılması 2026-08-25'te — önceki denetimden sonra). K12'de reddedilmiş bir ikizi yok.

---

### [D-C-02] `finalizedAt` trigger'ının kaynak statü listesi 2026-08-25'te eklenen Fire ucunu kapsamıyor — depodan fire edilen top Fire Karnesi'nde ÜRETİM ayına yazılır

| Şiddet | **S2** | Kategori | C (durum alanları + trigger) | Öncelik | **P1** | Modül | RAP (karneler) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `Roll.finalizedAt` damgasını yalnız `rolls_stamp_production_timestamps` trigger'ı yazar ve UPDATE dalında **kaynak** statü listesi sabittir: `IN_PRODUCTION, STOCK, AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR`. 2026-08-25'te açılan Fire ucu (`POST /rolls/:id/scrap`) **`WAREHOUSE` ve `A1_STOCK`** topları da `SCRAP`'a çekiyor — bu iki kaynak listede YOK, damga tazelenmiyor. Fire Karnesi ise "bu dönemde hurdaya AYRILAN mal"ı `finalizedAt` ile çapalıyor. Yani Haziran'da depoya giren, Eylül'de fire edilen top **Haziran'ın fire karnesine** düşer; Eylül'ün karnesi onu hiç görmez ve kapanmış dönemin rakamı geriye dönük değişir.

**Kanıt.**
- Trigger gövdesi (canlı DB'den, `pg_proc.prosrc`; migration `prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:79-86`):
```sql
IF NEW."status" IN ('WAREHOUSE','A1_STOCK','SCRAP')
   AND OLD."status" IN ('IN_PRODUCTION','STOCK','AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR') THEN
  NEW."finalizedAt" := now();
END IF;
```
  Yorum `SHIPPED`/`CANCELLED`'ın bilerek dışarıda olduğunu yazıyor; **`WAREHOUSE`/`A1_STOCK`'un neden dışarıda olduğuna dair tek kelime yok** (trigger yazıldığında o geçiş mümkün değildi).
- Fire yolu: `Teks-Erp/src/services/inventory.service.ts:392-398` `CANCELABLE_ROLL_STATUSES` = `STOCK, IN_PRODUCTION, A1_STOCK, WAREHOUSE, RETURNED_FROM_SUBCONTRACTOR`; `:2994-2998` `mode:"SCRAP" → targetStatus = SCRAP`; uç `Teks-Erp/src/routes/inventory.routes.ts:668` (`roll:manual-adjust`).
- Rapor çapası: `Teks-Erp/src/services/reports/scrap-scorecard.report.service.ts:5-10` (*"HURDA metrajı → `Roll.finalizedAt` ('bu dönemde hurdaya AYRILAN mal')"*), `:177-179`, `:204-205`, `:328-333`:
```sql
WHERE r.status = 'SCRAP' AND r."finalizedAt" >= $from AND r."finalizedAt" <= $to
```
- Koruma araması: DB'de bu geçişi damgalayan ikinci bir trigger/GENERATED kolon YOK (`K2b §1.5`, 3 trigger'ın tamamı); uygulama kodu `finalizedAt` yazmıyor (K4 §4: `src/` içinde 0 yazım); `statusChangedAt` tazeleniyor ama hiçbir karne onu okumuyor.

**failure_mode (somut).** 15.06.2026'da Tambur'dan çıkıp `WAREHOUSE`'a inen 250 m'lik top (`finalizedAt = 2026-06-15`). 10.09.2026'da depoda ıslanır, süpervizör "Fire" der (`POST /rolls/:id/scrap`, sebep "Su hasarı"). Trigger tetiklenir, `statusChangedAt = 2026-09-10` yazılır, **`finalizedAt` 2026-06-15 kalır**. Eylül Fire Karnesi: 0 m. Haziran Fire Karnesi: bugün açıldığında 250 m fire gösterir — üstelik Haziran'da o top 1. Kalite olarak Kalite Karnesi'ne girmişti ve orada kalmaya devam eder. Yani kapanmış ay, üç ay sonra kendiliğinden değişir.

**Veride fiili ihlal (K2).**
```sql
SELECT status, count(*) toplam, count(*) FILTER (WHERE "finalizedAt" IS NULL) fin_null
FROM rolls WHERE status IN ('WAREHOUSE','A1_STOCK','SCRAP','SHIPPED') GROUP BY 1;
```
→ **SAHA: SCRAP 1/1 `finalizedAt IS NULL`** · WAREHOUSE 3/250 NULL · SHIPPED 0/689. **DEV: SCRAP 2/2 NULL** · WAREHOUSE 2/52 NULL.
Yani fabrikanın kayıtlı **tek fire kaydı** (`bc74b77d-93f8-4a63-995a-1e35bb99a086`, 2026-08-08) `finalizedAt` taşımadığı için `WHERE finalizedAt >= …` süzgecine hiç girmiyor → **Fire Karnesi'nde bugün de görünmüyor.** (Bu ikinci ayak A-24 backfill boşluğu; K10 Q-STK-08 ile aynı satırlar.) Fire ucu 2026-08-25'te açıldığı ve kopya 08-25 tarihli olduğu için `WAREHOUSE→SCRAP` geçişi henüz hiç koşmamış — bulgu **ileriye dönük** ve ilk kullanımda sessizce gerçekleşir.

**İş etkisi.** Fire oranı (kalite maliyeti) yanlış aya yazılır; ay kapanışından sonra rapor rakamı değişir (denetim/ISO açısından "kapanmış dönemin raporu sabit kalmalı" ihlali). Depodan fire, tekstilde en sık fire biçimidir (ıslanma, leke, numune) — akış yeni açıldığı için hacim henüz sıfır.

**Öneri.** ① Trigger'ın kaynak listesine `WAREHOUSE`, `A1_STOCK` **yalnız hedef `SCRAP` olduğunda** eklensin (`WAREHOUSE→A1_STOCK` gibi kalite düzeltmeleri damgayı tazelemesin) — migration, `prod_risk: yuksek`, geri alma = fonksiyonu eski gövdeyle `CREATE OR REPLACE`. ② Alternatif (şema dokunuşsuz): Fire Karnesi çapasını `finalizedAt` yerine **`statusChangedAt`**'e çevir — ama o zaman "üretimi biten" ile "hurdaya ayrılan" iki farklı çapa olur ve `producedTotal` ile evren ayrışır; ①'i öner. ③ `scrap-scorecard`'a `quality-scorecard`'daki `unanchoredRollCount` eşdeğerini ekle (kapsam dürüstlüğü) — bugün 1/1 fire görünmediğini rapor kendisi söylesin. ④ Backfill (4 damgasız top) ayrı `[PROD'DA ÇALIŞTIRMA]` kararı; ham SQL (Prisma update `updatedAt`'i tazeler → tüm listeler yeniden sıralanır).
**Kabul kriteri.** `WAREHOUSE` topu fire edildiğinde `finalizedAt` fire anına eşit; `test_quality_scorecard.ts`'e negatif sonda (kaynak listesinden `WAREHOUSE` silinince kırmızı).
**Efor:** 0,5 gün (migration + bekçi).
**Önceki defter.** Yok. K2b HOTSPOT-3 ve K10 INV-STK-08 aynı trigger'ı işaret ediyor ama fire ucu bağlantısını kurmuyor.

---

### [D-C-03] `status = CANCELLED` yazan ALTI yol iptal izini hiç yazmıyor — 134/230 iptalde "kim/ne zaman/neden" yok ve geri alma yanlış rafa döndürüyor

| Şiddet | **S2** | Kategori | C (audit kolonları + denormalize snapshot) | Öncelik | **P1** | Modül | ENV | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** İptal izi dört kolonda saklanır (`cancelledAt`, `cancelledById`, `cancelReason`, `cancelReasonCode`) + geri dönüş rafı `preCancelStatus`. Bu beşlisini yalnız **iki** yol yazıyor (`inventory.softDelete`, `roll-disposition.helper`). Statüyü `CANCELLED`'a çeken **altı yol daha var** ve hiçbiri iz yazmıyor. Sonuç iki katmanlı: (a) "bu top neden iptal edildi" sorusu kalıcı olarak yanıtsız (audit 6 ayda arşivleniyor), (b) `preCancelStatus` NULL kaldığı için "İptali Geri Al" topu **Ham Stok'a** düşürüyor — bitmiş depodan iptal edilmiş olsa bile.

**Kanıt.** İz yazan iki yol: `Teks-Erp/src/services/inventory.service.ts:3253-3262` (softDelete), `Teks-Erp/src/services/helpers/roll-disposition.helper.ts:223-231`. İz YAZMAYAN altı yol:

| # | Yer | Ne yapıyor |
|---|---|---|
| 1 | `Teks-Erp/src/services/inventory.service.ts:3561-3568` | Arşivleme (`hardDelete`): `STOCK → CANCELLED`, `data:{status, currentStepId:null, shipmentId:null, sackId:null}` |
| 2 | `Teks-Erp/src/services/subcontractor.service.ts:4845-4852` | Fason makbuz iptali: doğan toplar `CANCELLED` |
| 3 | `Teks-Erp/src/services/subcontractor.service.ts:5378-5384` | Aktarım geri alma: `AT_SUBCONTRACTOR → CANCELLED` |
| 4-6 | `Teks-Erp/src/services/tambur-undo.service.ts:1073-1080`, `:1260-1267`, `:1488-1495` | Kesim parçası geri alma (D-C-01) |

Geri dönüş rafı: `Teks-Erp/src/services/helpers/roll-cancel-restore.helper.ts:124-132` `resolveRestoreTargetStatus(null) → RollStatus.STOCK`; kullanıcı `Teks-Erp/src/services/inventory.service.ts:3448`.
Koruma araması: kolonlar nullable, DB'de `status='CANCELLED' → cancelledAt NOT NULL` CHECK'i **yok** (K2b §1.1'deki 26 CHECK'in hiçbiri); trigger yok; bekçi yok (`consistency-check*.sql` bölümü yok).

**failure_mode (somut).** Bitmiş Depo'daki 300 m'lik kesim parçası, Tambur geri almasıyla `CANCELLED` olur (yol #4). `preCancelStatus` yazılmaz. Ertesi gün süpervizör "İptali Geri Al" der → top `STOCK` olur: barkodlu, 1. kaliteli, bitmiş bir top **Ham Stok sekmesinde** belirir. Bitmiş Depo sayacı 300 m eksik, Ham Stok 300 m fazla; Ürün Dengesi `bitmis` kovası eksik, `ham` kovası fazla; operatör topu "Bitmiş Depo"da arar, bulamaz. Ayrıca "Neden iptal edilmişti?" sorusuna arayüzde cevap yok (kolon boş), audit 6 ay sonra arşive gider.

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) n, count(*) FILTER (WHERE "cancelledAt" IS NULL) izsiz,
       count(*) FILTER (WHERE "preCancelStatus" IS NULL) pre_null,
       count(*) FILTER (WHERE "cancelReasonCode" IS NULL) kodsuz
FROM rolls WHERE status='CANCELLED';
```
→ **SAHA: 230 iptal · 134 `cancelledAt` NULL · 134 `preCancelStatus` NULL · 230 `cancelReasonCode` NULL.**
Gün kırılımı (`statusChangedAt`, fabrika günü): 05.08 → 22/22 izsiz · 08.08 → 15/18 · 14.08 → 9/9 · 17.08 → 15/16 · 18.08 → 17/20 · 19.08 → 7/7 · 20.08 → 7/8 · 21.08 → 1/1. Yani **iz kolonları 2026-08-05'ten beri var olduğu hâlde eksiklik kesintisiz sürüyor** — "eski kayıt" açıklaması yetmiyor. `cancelReasonCode` (2026-08-21 migration'ı) sahada 230/230 boş.
Geri alınabilir kümenin 126'sı `preCancelStatus` NULL taşıyor → hepsi Ham Stok'a döner.

**İş etkisi.** İptal sebebi raporlanamaz (`cancelReasonCode` rapor anahtarıydı, hiç dolmuyor); "hatalı kayıt mı, gerçek fire mi" ayrımı yalnız `status` ile yapılabiliyor; geri alma envanteri iki sekme arasında sessizce kaydırıyor.

**Öneri.** İptal izini **tek yazma noktasına** al: `cancelRollTx(tx, {rollId, mode, reason, reasonCode, actorId})` helper'ı, altı yolun hepsi onu çağırsın (fason/tambur yolları sistem kodlarıyla: `BUILTIN_FASON_RECEIPT_CANCEL`, `BUILTIN_TAMBUR_UNDO`). AST bekçisi: `roll.updateMany(... status: CANCELLED ...)` deseni helper dışında YASAK (`fason-open-dispatch` emsali). `preCancelStatus`'u helper her zaman yazsın. DB seddi (`CHECK (status<>'CANCELLED' OR "cancelledAt" IS NOT NULL)`) **eklenemez** — 134 eski satır düşürür; NOT VALID + yalnız yeni satırlar için VALIDATE etmemek bir seçenek ama fayda/masraf düşük, kod tarafı yeterli.
**Kabul kriteri.** Altı yolun her biri için bekçi: iptal sonrası `cancelledAt`, `cancelledById`, `preCancelStatus` dolu; `restore-cancel` topu doğru rafa döndürüyor.
**Efor:** 1,5 gün.
**Önceki defter.** K10 H-5 aynı olguyu ölçmüş ("47/52 eksik, hangi yol yazmıyor?") — **bu bulgu o soruyu cevaplıyor:** altı yol, adlarıyla.

---

### [D-C-04] Audit değiştirilemezliği kâğıt üstünde: `system_logs.userId` FK'sı SET NULL (şema/migration "RESTRICT" diyor) ve `teks.audit_guard` kopyada KAPALI

| Şiddet | **S2** | Kategori | C (audit kolonları) | Öncelik | **P1** | Modül | AUD/OPS | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Denetim kaydının bütün değeri "sonradan oynanamaz" olmasında. İki mekanizma vaat ediliyor, ikisi de tutmuyor: (a) `system_logs`/`system_log_archives` tamper trigger'ı **GUC'a bağlı ve varsayılan kapalı**; prod kopyasında `teks.audit_guard` **boş** (koruma kapalı) ve prod'un gerçek değeri restore edilen kopyadan okunamıyor. (b) Migration'ın kendi metni ve K2b'nin kural tablosu (`K-23`) `system_logs.userId → users` FK'sının **RESTRICT** olduğunu, yani audit satırı olan kullanıcının fiziksel silinemeyeceğini söylüyor — **canlı katalogda o FK `ON DELETE SET NULL`**. Yani kullanıcı silinirse audit satırlarının fail'i sessizce NULL'lanır; hata da log da yok.

**Kanıt.**
```sql
SELECT c.conname, c.confdeltype, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
WHERE t.relname IN ('system_logs','system_log_archives') AND c.contype='f';
```
→ tek satır: `system_logs_userId_fkey | n | FOREIGN KEY ("userId") REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL` (**SAHA ve DEV aynı**). `system_log_archives` üzerinde FK **hiç yok**.
- Şema: `Teks-Erp/prisma/schema.prisma:5180` `user User? @relation(fields: [userId], references: [id])` → `onDelete` yazılmamış → Prisma varsayılanı **SetNull** (nullable alan). Yani şema da SET NULL üretiyor; RESTRICT iddiası hiçbir zaman doğru olmadı.
- Yanlış iddianın metni: `Teks-Erp/prisma/migrations/20260819161000_audit_tamper_guard/migration.sql:19-21` — *"79 test dosyası + 4 fixture script'i cleanup'ta audit satırı siler ZORUNDA (`system_logs.userId → users` FK'sı **RESTRICT**; kullanıcıyı silmek için önce log'unu silmek gerekiyor)"*. Bu cümle, korumanın **varsayılan kapalı** bırakılmasının gerekçesidir.
- GUC ölçümü: `SELECT current_setting('teks.audit_guard', true), current_setting('teks.audit_purge', true)` → **SAHA boş | boş · DEV boş**. Trigger fonksiyonu `coalesce(current_setting(...),'') <> 'on'` ile fail-open (migration `:46-59`).
- Prod ayarı doğrulanamaz: `pg_db_role_setting` restore ile taşınmaz (K2b §2.4); deploy kontrol listesi `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:1080` satırı **işaretsiz (☐)**. `[VARSAYIM 1] prod'da da kapalı.`

**failure_mode (somut).** (a) DB erişimi olan biri (ya da yarın yazılacak bir "log temizleme" script'i) `UPDATE system_logs SET "newData" = '{}' WHERE id = …` koşar; guard kapalıysa satır sessizce değişir, değiştiğine dair iz kalmaz — denetim kaydının tek işlevi ortadan kalkar. (b) Bir kullanıcı fiziksel silinirse (bugün üretim rotası yok; `scripts/` altında 10+ `prisma.user.delete*` var ve `guarded-hard-remove` deseni bir gün kullanıcıya da uygulanabilir) o kullanıcının TÜM audit satırlarında `userId` NULL olur: "bu iptali kim yaptı" sorusu 4.287 `tableName='ROLL'` satırının ilgili kısmında kalıcı olarak cevapsız kalır — üstelik ekip FK'nın buna izin vermediğini sanıyor.

**Veride fiili ihlal (K2).** FK aksiyonu iki DB'de de `n` (SET NULL) — yukarıdaki sorgu. GUC iki DB'de de boş. Bugün fiilen silinmiş kullanıcı yok (`system_logs` `tableName='ROLL'` 4.287 satırın 1'i yetim `recordId` taşıyor; `userId` yetimliği FK ile zaten imkânsız, SET NULL sessiz olduğu için sayılamaz).

**İş etkisi.** ISO 27001 A.8.15 / iç denetim: audit izi değiştirilebilir durumda; "kim yaptı" alanı kullanıcı silmeye karşı korumasız. Fabrika bugün tek vardiya + 9 kullanıcı ile çalıştığı için istismar olasılığı düşük, ama koruma **belgelenmiş olduğu için kimse ikinci bir kontrol koymuyor.**

**Öneri.** ① Migration metnindeki ve `K2b §3 K-23`'teki "RESTRICT" iddiasını düzelt (belge hatası, ölçümle çürütüldü). ② `system_logs.userId` FK'sını gerçekten `ON DELETE RESTRICT`'e çevir — **ama önce** 94 test dosyasının `systemLog.deleteMany` cleanup'ı gözden geçirilmeli (o dosyalar zaten log siliyor; RESTRICT onları kırmaz, sıra bağımlılığı yaratır). `prod_risk: yuksek`, geri alma = FK'yı SET NULL'a döndüren migration. ③ Prod'da `ALTER DATABASE tekserp SET teks.audit_guard='on'` ops adımı **koşulmalı ve doğrulanmalı**: `/api/admin/health` → `auditGuard` alanı canlıda okunup kontrol listesine işlenmeli. Test paketinin guard açıkken kırmızıya düşmesi ayrı bir iştir (guard yalnız prod DB'sinde açılır — dev/test DB'sinde kapalı kalabilir; bu zaten mevcut tasarım).
**Kabul kriteri.** `/api/admin/health.auditGuard === true` prod'da doğrulandı ve kontrol listesinde ☑; FK aksiyonu `pg_constraint.confdeltype='r'`; `test_db_invariants` FK aksiyonunu envantere aldı.
**Efor:** 0,5 gün (ops) + 1 gün (FK + test cleanup sırası).
**Önceki defter.** K2b HOTSPOT-2 GUC ayağını işaret ediyor; FK aksiyonu çelişkisi bu turda ölçüldü (K12'de yok).

---

### [D-C-05] "Etiket türü başına tek varsayılan" İKİ bağımsız DB seddinde tutuluyor; seed yalnız birini yazıyor — sahada SWATCH ayrışmış

| Şiddet | **S3** | Kategori | C (denormalize / çift kaynak) | Öncelik | **P2** | Modül | BLG (etiket) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Aynı kural iki yerde saklanıyor: eski `label_templates.isDefault` kolonu (partial UNIQUE `label_templates_one_default_per_kind (kind) WHERE isDefault=true`) ve yeni tek-doğru-kaynak `label_context_defaults.kind` (UNIQUE). İki sed **birbirine bağlı değil** — DB ikisinin farklı şablonu göstermesini engelleyemez. Baskı yolu YALNIZ `LabelContextDefault`'u okuyor; panel/liste `isDefault`'u da taşıyor. Prod kopyasında `SWATCH` için ikisi ayrışmış: kolon "Standart Kartela Etiketi varsayılandır" diyor, bağlam tablosunda **SWATCH satırı yok**.

**Kanıt.**
- Çift yazım: `Teks-Erp/src/services/label-template.service.ts:317-346` (create), `:429-451` (update), `:497-511` (setDefault) — üçü de önce `labelTemplate.updateMany{isDefault:false}` sonra `labelContextDefault.upsert`.
- Baskı yolu tek kaynak okuyor: `Teks-Erp/src/services/helpers/label-routing.resolver.ts:63-73` (`findContextDefaultTemplate`) ve `:134-138` (`if (!template) template = await findContextDefaultTemplate(kind)`). `isDefault` baskı yolunda **hiç okunmuyor** (`grep isDefault src/services/label.service.ts` → yalnız `:636`, `:715` yanıt alanı).
- **Kök neden — seed:** `Teks-Erp/prisma/seed.ts:616-640` dört şablonu `isDefault: true` ile yaratıyor ama `labelContextDefault.create` **yalnız SACK için** (`:682`). ROLL_RAW / ROLL_FINISHED / SWATCH bağlam varsayılanı olmadan doğuyor.
- Koruma araması: iki index de mevcut (`test_db_invariants` envanterinde), ama aralarında FK/CHECK/trigger yok; `test_db_invariants` yalnız index'lerin VARLIĞINI ölçüyor, **eşitliğini değil**.

**failure_mode (somut).** Yönetici Etiket Stüdyosu'nda "Standart Kartela Etiketi"ni açar, alanları düzenler, kaydeder; liste onu "varsayılan" rozetiyle gösterir (kolon `isDefault=true`). Kartela etiketi basıldığında `resolveLabelRouting` bağlam varsayılanı bulamaz (`template = null`) → etiket **yerleşik alan kataloğu** ile basılır. Yöneticinin düzenlemesi kâğıda hiç ulaşmaz ve hiçbir hata mesajı çıkmaz. (SACK'te aynı ayrışma olsaydı sonuç 400 olurdu — çuval baskısı FAIL-CLOSED; SWATCH/ROLL fail-open olduğu için sessiz.)

**Veride fiili ihlal (K2).**
```sql
SELECT t.kind, t."isDefault",
  (SELECT lcd."templateId" FROM label_context_defaults lcd WHERE lcd.kind=t.kind) ctx
FROM label_templates t WHERE t."isDefault" ORDER BY t.kind;
```
→ **SAHA:** ROLL_RAW ✔ eşleşiyor · ROLL_FINISHED ✔ · SACK ✔ · **SWATCH: `isDefault=true`, `ctx = (satır yok)` → AYRIŞIK.**
→ **DEV:** yalnız SWATCH `isDefault=true`; buna karşılık `label_context_defaults`'ta ROLL_FINISHED, SACK, SWATCH satırları var → **üç kind'da ayrışma** (kolon "varsayılan yok" derken tablo var diyor).
Sahada SWATCH akışı henüz kullanılmıyor (`swatches 0`, `kartela_dispatches 0`) → bugün görünür etkisi yok.

**İş etkisi.** Kartela etiketi ilk basıldığında fabrikanın tasarladığı şablon yerine yerleşik düzen çıkar; hata mesajı olmadığı için sebebi aranmaz. Aynı desen ROLL_RAW/ROLL_FINISHED için de üretilebilir (seed yolu aynı).

**Öneri.** ① Seed'i düzelt: dört şablonun dördü için de `labelContextDefault` yaz (dev paritesi; prod'da seed koşmaz ama kurulum şablonu buradan türüyor). ② `isDefault` kolonunu **salt-türetilmiş** yap: ya kolonu düşür (deprecated, K2a "deprecated çift-yazım" listesinde) ya da `label_context_defaults`'tan okunan bir view/alan olarak dön; iki bağımsız sed bırakma. ③ Geçiş dönemi için `test_db_invariants`'e §: *her kind için `isDefault=true` şablon ⇔ `label_context_defaults` satırı ve ikisi AYNI id*. ④ Sahadaki SWATCH satırı tek `INSERT` ile düzeltilebilir — `[PROD'DA ÇALIŞTIRMA]`, geri alma = satırı sil.
**Kabul kriteri.** Yeni bekçi §, saha verisiyle koşturulduğunda SWATCH ayrışmasını KIRMIZI veriyor; düzeltmeden sonra yeşil.
**Efor:** 0,5 gün.
**Önceki defter.** MATRIX §A "LabelTemplate | kind başına tek varsayılan (A-20) | **iki bağımsız sed** birbirine bağlı değil | 4 `isDefault` + 3 context" — bu bulgu ayrışmayı **kind düzeyinde tekilleştirip kök nedeni (seed) gösteriyor**.

---

### [D-C-06] `consistency-check.sql` §12, mekanik ikizindeki muafiyet listesini taşımıyor — ops sorgusu prod'da 15 yanlış-pozitif satır basıyor

| Şiddet | **S3** | Kategori | C (mutabakat sorguları) | Öncelik | **P2** | Modül | OPS/K (bekçi) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `scripts/consistency-check.sql` başlığı sözleşmeyi yazıyor: *"MEKANİK İKİZİ VAR: `scripts/test_consistency.ts` aşağıdaki sorguları AYNEN koşar … iki yüzey tek gerçek."* §12'de ikiz **ayrışmış**: TS tarafı 10 muaf desen (dispozisyon önekleri, `MANUAL_MOVE_OUT`, `WO_CANCELLED`, `CANCEL:<sevkNo>`, `CANCELLED`/`ARCHIVED` …) uygularken SQL dosyası çıplak `qtyOut IS DISTINCT FROM qtyIn` sorguyor. Sonuç: `npm test` yeşil, operatörün elle koştuğu SQL 15 satır basıyor ve satırların hepsi meşru.

**Kanıt.**
- `Teks-Erp/scripts/consistency-check.sql:182-189`:
```sql
SELECT rm.id, rm."rollId", rm."workOrderStepId", rm."qtyIn", rm."qtyOut", rm."exitedAt"
FROM roll_movements rm
WHERE rm."exitedAt" IS NOT NULL AND rm."qtyOut" IS DISTINCT FROM rm."qtyIn"
```
- `Teks-Erp/scripts/test_consistency.ts:297-313` — aynı bölümde `noise.where` bloğu 10 muaf deseni uyguluyor (`DISPOSITION_NOTE_PREFIXES`, `notes IN ('MANUAL_MOVE_OUT','REDYE_REWIND','WO_CANCELLED','DETACHED_FROM_WO')`, `notes LIKE 'CANCEL:%'`, `'%| CANCEL:%'`, `= 'CANCELLED'`, `LIKE 'CANCELLED (%'`, `= 'ARCHIVED'`, `LIKE 'ARCHIVED (%'`).
- Dosya başlığı `consistency-check.sql:11-16` bu ayrışmayı açıkça yasaklıyor.

**failure_mode (somut).** Üç ayda bir (ARCHITECTURE §10.2) ya da şüphe anında `psql -f scripts/consistency-check.sql` koşulur. §12 **15 satır** basar. Operatör ilk seferinde satırları inceler, hepsinin meşru olduğunu görür ve bundan sonra §12'yi "her zaman kırmızı" diye atlar. Gerçek bir ihlal (normal istasyon FINISH'inde `qtyOut ≠ qtyIn`) o 15 satırın arasına düşer ve **görülmez**. Bu, `test_db_invariants` §1/§5'in bilinçli kırmızısıyla birleşince "kırmızı körlüğü" kültürünü besler.

**Veride fiili ihlal (K2).** `audit/tools/sql-saha.sh -f Teks-Erp/scripts/consistency-check.sql` → **§12: 15 satır** (dev: 7). 15'inin **15'i** muaf desen taşıyor:
| Not deseni | Adet |
|---|---|
| `DISPATCH:FSxxxx \| CANCEL:FSxxxx` (fason sevk iptali, `qtyOut` NULL) | 12 |
| `MANUAL_MOVE_OUT` (`qtyOut` NULL) | 2 |
| `WO_CLOSE_CANCELLED: test (MANUAL_MOVE_IN)` (`qtyOut = 0`, storno) | 1 |
Örnek: `0e588bd0-526a-4d1f-8e7b-a7226d8a6872` (qtyIn 200, qtyOut NULL, `CANCEL:FS1508260003`).
Diğer bölümler iki dosyada da temiz — SAHA: §1-§11, §13 hariç hepsi 0; §13 = 2 (belgeli, bilinçli). DEV: §1 1 satır (`TST-DS-ORD-…` test kalıntısı), §11 12, §16 671, §19 49 — hepsi `TST-` fixture artığı.

**İş etkisi.** Elle koşulan tek mutabakat aracının bir bölümü kalıcı olarak gürültülü; gerçek `qtyOut` sapması saklanır.
**Öneri.** `consistency-check.sql §12`'ye TS'teki muaf listesini birebir taşı (dosya başlığındaki kural: *"ÖNCE burada değişir, sonra test'e kopyalanır"* — bu vakada ters olmuş). Tercihen listeyi tek bir SQL view/CTE'ye çıkar ki iki yüzey aynı metni okusun. Ek: §12 ve §13'ün başlığına "bilinçli satır sayısı" yazılsın (bugün 0 beklenen mi, 2 beklenen mi belli değil).
**Kabul kriteri.** `psql -f consistency-check.sql` saha kopyasında §12 → 0 satır; muaf listesinden bir desen silinince 12 satır geri geliyor.
**Efor:** 0,25 gün.
**Önceki defter.** Yok. K2b HOTSPOT-11 "kırmızı körlüğü" sınıfını işaret ediyor (farklı bölüm).

---

### [D-C-07] Kalıcı silme guard'ları birleştirme tombstone'larını saymıyor — survivor silinince soy bağı sessizce NULL olur ve tombstone tekillik seddine geri girer

| Şiddet | **S3** | Kategori | C (Cascade/SetNull + unique predicate) | Öncelik | **P2** | Modül | ANA VERİ | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `Item/Customer/Subcontractor/Color.mergedIntoId` self-FK'sında `onDelete` yazılmamış → Prisma varsayılanı **SET NULL**. Aynı kolon iki iş yapıyor: (a) birleştirme soy bağı, (b) `nameFold` partial UNIQUE'inin predicate'i (`WHERE "mergedIntoId" IS NULL`). `/items/:id/permanent` ve `/customers/:id/permanent` guard listeleri `mergedChildren`'ı **saymıyor**. Survivor silinirse tombstone'ların `mergedIntoId`'si sessizce NULL olur: soy bağı kaybolur ve tombstone tekillik kapsamına geri girer (aynı katlanmış adı taşıyan ikinci tombstone varsa DELETE'in kendisi 23505 ile düşer — anlaşılmaz hata; tek tombstone varsa **sessizce** "canlı" mükerrer doğar).

**Kanıt.**
- `Teks-Erp/prisma/schema.prisma:1300` (`Item.mergedIntoId`), `:1878` (Customer), `:3717` (Subcontractor), `:4557` (Color) — `onDelete` yazılmamış; canlı katalogda `confdeltype='n'`.
- Guard'lar: `Teks-Erp/src/services/item.service.ts:616-629` — yalnız `workOrder.targetItemId` sayılıyor (SetNull olduğu için açıkça); `Teks-Erp/src/services/customer.service.ts:361-395` — order/shipment/rollReturn/branch/sack/route sayılıyor. **İkisinde de `mergedIntoId` çocuğu YOK.**
- Uçlar: `Teks-Erp/src/routes/item.routes.ts:266` (`item:write`), `Teks-Erp/src/routes/customer.routes.ts:220` (`customer:write`) — sıradan ana veri yazma yetkisi, admin değil.
- Sed: `customers_nameFold_key` / `items_nameFold_key` / `subcontractors_nameFold_key` partial UNIQUE `WHERE "mergedIntoId" IS NULL` (`prisma/migrations/20260821150000_name_fold_unique_live/migration.sql:69-71`); `items_nameFold_key` **sahada YOK** (yumuşak kapı) → orada koruma tamamen uygulama katmanında.

**failure_mode (somut).** Mükerrer Paneli'nde "BOYA A" (survivor) ile "BOYA-A" (tombstone) birleştirildi; ikisi de hiç kullanılmamış kartlardı (panelin tipik vakası). Bir hafta sonra kullanıcı survivor'ı da gereksiz bulup **Kalıcı Sil** der. Guard'lar 0 döner (sipariş/top/sevk yok), `super.hardDelete` koşar → tombstone'un `mergedIntoId`'si NULL olur. Sonuç: (a) "BOYA-A nereye birleştirildi?" sorusunun cevabı kayboldu (Mükerrer Paneli'ndeki `MERGED` kararı artık var olmayan bir id'yi gösteriyor), (b) `isActive=false` ama "canlı" sayılan bir mükerrer kart yeniden tekillik kapsamına girdi — mükerrer tespit kuyruğuna geri düşer, kullanıcı aynı kararı ikinci kez verir.

**Veride fiili ihlal (K2).** Bugün gerçekleşmemiş; **guard'sız silinebilir survivor kümesi** ölçüldü:
```sql
SELECT s.id, s.code, (SELECT count(*) FROM customers c WHERE c."mergedIntoId"=s.id) tombstones,
  (SELECT count(*) FROM orders o WHERE o."customerId"=s.id) orders, … /* 6 guard sayacı */
FROM customers s WHERE EXISTS (SELECT 1 FROM customers c WHERE c."mergedIntoId"=s.id);
```
→ **DEV: 37 müşteri survivor'ının 36'sında altı guard sayacının hepsi 0** (ör. `TMFP6925038-A` 2 tombstone, 0 sipariş/sevk/iade/şube/çuval/rota) — hepsi bugün silinebilir. **2 kumaş survivor'ı** (`kristal`, `BGR150`/`v-1430`) da tamamen guard'sız.
→ **SAHA: 6 kumaş survivor'ı** (`BAYROFLAM`, `kristal`, `BGR150SEFFAF`, `OSLO`, `ACTIVO`, `sefa`); hiçbiri bugün silinemiyor ama **sebebi guard değil, Restrict FK tesadüfü** (`rolls`/`order_lines` bağı). Müşteri tarafında tombstone 0.
Ayrıca: aynı `nameFold`'u taşıyan ≥2 tombstone → SAHA 0, DEV 0 (yani bugün SET NULL sırasında 23505'e düşecek grup yok; sessiz dal aktif olan).
Bonus ölçüm — birleştirme motoru **temiz**: tombstone'a canlı referans 12 tabloda **0/0** (iki DB).

**İş etkisi.** Birleştirme kararının izlenebilirliği kaybolur (`duplicate_reviews.MERGED` kararı boşluğa işaret eder); mükerrer paneli aynı çifti tekrar önerir. Prod'da bugün tetiklenemiyor, dev'de 38 aday var.

**Öneri.** Her iki guard'a (ve ileride açılacak `subcontractor`/`color` `/permanent` uçlarına) `mergedChildren` sayacı ekle: *"Bu kayda N kart birleştirilmiş — kalıcı silinemez (birleştirme izi korunur). Pasife alın."* Alternatif/ek: self-FK'yı `onDelete: Restrict` yap (şema, `prod_risk: yuksek`; geri alma = SetNull'a dönen migration) — o zaman koruma DB'de olur ve ileride açılacak her uç otomatik korunur. `test_hard_delete_guard_coverage.ts` allowlist'ine `mergedIntoId` satırı eklenmeli.
**Kabul kriteri.** Tombstone taşıyan survivor'da `DELETE /:id/permanent` → 409 + tombstone sayısı; bekçi guard satırı silinince kırmızı.
**Efor:** 0,5 gün (kod) · 0,5 gün (şema varyantı).
**Önceki defter.** K2a HOTSPOT-1 aynı boşluğu işaret ediyor; bu bulgu **etkilenen kayıt kümesini ölçüyor** ve `subcontractors/colors` için uç olmadığını doğruluyor. K12'de reddedilmiş `F-CORE-VER-003` (`labelCustomerId`) ile **karıştırılmamalı** — o ayna kolondu, bu soy bağı + unique predicate'i.

---

### [D-C-08] Belge tarihi/saati ve iade belge numarası SÜREÇ saat diliminden üretiliyor; belge no/barkod FABRİKA gününden — bekçi bu deseni taramıyor

| Şiddet | **S3** | Kategori | C (tarih/saat, business date) | Öncelik | **P3** | Modül | BLG (belge) | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Fabrika günü kararı tek kaynakta yazılı (`constants/time.ts`, `FACTORY_TIMEZONE`) ve belge/barkod numaraları oradan besleniyor (`code-format.ts:64-67` `ddmmyy → factoryYmd`). Ama **kâğıda basılan tarih ve saat** hâlâ `d.getDate()/getMonth()/getFullYear()/getHours()` ile, yani **süreç saat diliminden** üretiliyor — 9 belge render dosyası + basım damgası + bir belge NUMARASI. `ecosystem.config.js` `TZ` env'i **set etmiyor** (yalnız `NODE_ENV`), yani karar işletim sisteminin saat dilimine bırakılmış ve bu hiçbir yerde yazılı değil. Gün sınırı bekçisi (`test_report_day_boundary §4`) yalnız `DATE_TRUNC`/`CURRENT_DATE`/`setHours` tarıyor; **`getDate()` desenini bilerek taramıyor** — yani bekçinin kör noktası, `code-format.ts`'te düzeltilen hatanın tam şekli.

**Kanıt.**
- Fabrika günü kararı: `Teks-Erp/src/constants/time.ts:15-21, 49, 70-72`; belge no: `Teks-Erp/src/utils/code-format.ts:56-67` (*"Eski hâli `date.getDate()/getMonth()/getFullYear()` ile süreç saat dilimine yaslanıyordu ve bunu hiçbir yerde YAZMIYORDU"*).
- Süreç TZ'sine yaslanan canlı yazımlar (hepsi `p(d.getDate())…` kalıbı):
  `src/services/document-render/shipment-dispatch.html.ts:265` · `fason-receipt.html.ts:84` · `fason-direct-ship.html.ts:138` · `return-dispatch.html.ts:69` · `kartela-ceki.html.ts:103` · `quality-certificate.html.ts:81` · `fason-ceki.html.ts:191` · `traveler-card.html.ts:145,152` · `traveler-card-raw.ts:58,66` · `free-document.html.ts:38` · `printed-document.service.ts:270-274` (`fmtStampNow`, basım damgası) · `free-document.service.ts:140`.
- **Belge NUMARASI:** `Teks-Erp/src/services/return.service.ts:1084-1086`
```ts
const d = rr.createdAt;
const documentNo = `IADE-${p(d.getDate())}${p(d.getMonth()+1)}${String(d.getFullYear()).slice(2)}-${rr.id.slice(0,6).toUpperCase()}`;
```
  Bu değer `printed_documents.documentNo` kolonuna donuyor (`freezeForSource`) — yani kalıcı.
- Bekçi kapsamı: `Teks-Erp/scripts/test_report_day_boundary.ts:191-214` — `DATE_TRUNC('day|week|month'`, `CURRENT_DATE`, `.setHours(` . Yorum `setDate/setMonth`'un bilerek dışarıda olduğunu açıklıyor; **`getDate()/getHours()` hiç anılmıyor.**
- Konfig: `Teks-Erp/ecosystem.config.js:76` yalnız `NODE_ENV: "production"`; `TZ` yok. `docker-compose.yml` (prod'da KULLANILMIYOR) `TZ/PGTZ=Europe/Istanbul` set ediyor — yani niyet biliniyor ama üretim süreç konfigüne yazılmamış.

**failure_mode (somut).** Sunucu bir gün konteynere alınır ya da yeniden kurulurken TZ=UTC bırakılır (Windows→Linux geçişi, bulut kopyası, `docker-compose` ile ayağa kaldırma). 10.09.2026 saat **01:30**'da (gece vardiyası) bir iade işlenir: `roll_returns.createdAt = 2026-09-09T22:30Z`. Barkod/`shipmentNo` fabrika gününü kullandığı için **10.09** taşır; aynı belgenin üstüne basılan tarih ve `documentNo` süreç TZ'siyle **09.09** olur → tek kâğıtta iki farklı gün, ve `IADE-090926-XXXXXX` numarası kalıcı olarak yanlış güne çapalanır. Hata mesajı yok; ancak muhasebe eşleştirmesinde fark eder.

**Veride fiili ihlal (K2).** Aranmış, **bugün 0**: bu pencerede üretilmiş kayıt neredeyse yok.
```sql
SELECT count(*) FILTER (WHERE ("createdAt" AT TIME ZONE 'Europe/Istanbul')::date
                          <> ("createdAt" AT TIME ZONE 'UTC')::date) FROM <tablo>;
```
→ SAHA: rolls 0/2.431 · roll_movements 0/1.107 · shipments (dispatchedAt) 0/40 · printed_documents 0/328 · **system_logs 12/10.485**. Yani gece 00:00–03:00 penceresi fabrikada çok seyrek kullanılıyor; risk düşük olasılıklı ama sessiz ve kalıcı.

**İş etkisi.** Resmi belgede (irsaliye/çeki/sertifika/iade) yanlış tarih; belge no ile belge içeriğinin günü ayrışır. Bugün host Europe/Istanbul olduğu için doğru çalışıyor — **ama bu hiçbir yerde yazılı değil ve bekçisi yok**.
**Öneri.** ① `ecosystem.config.js` env'ine `TZ: "Europe/Istanbul"` ekle (tek satır, davranış değiştirmez, kararı açık hâle getirir). ② Belge formatlayıcılarını `constants/time.ts`'e taşınacak bir `factoryDateText(d)` / `factoryDateTimeText(d)` yardımcısına bağla (12 çağrı yeri, çıktı bugün birebir aynı). ③ `return.service.ts:1086` belge no'sunu `ddmmyy(rr.createdAt)` ile üret (diğer belge no'larıyla aynı kaynak). ④ `test_report_day_boundary §4` taramasına `\.get(Date|Hours|Month|FullYear)\(` deseni eklensin, muaf: `constants/time.ts` + süre hesabı yapan `backup-naming.helper` (dosya adı, gün sınırı değil).
**Kabul kriteri.** Bekçi `getDate()` kalıbını tarıyor ve düzeltme öncesi 13 satırla kırmızı; `TZ` env'i konfigde.
**Efor:** 0,5 gün.
**Önceki defter.** `F-OPS-VER-005` (2026-08-09) bekçinin JS ayağını `setHours` için açmış; bu bulgu **aynı bekçinin kalan kör noktasını** kapatıyor.

---

### [D-C-09] `Roll.status` geçiş matrisi hiçbir yerde merkezî değil: 21 ayrı statü listesi + trigger listesi, hepsi fail-open

| Şiddet | **S3** | Kategori | C (durum alanları) | Öncelik | **P2** | Modül | CORE | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** 13 değerli `RollStatus` enum'unun izinli geçişleri hiçbir tabloda, hiçbir CHECK'te, hiçbir tipte tanımlı değil. Bunun yerine **21 ayrı `RollStatus[]` sabiti** (+ DB trigger'ının kendi iki listesi) her akışın "hangi statüler bana uygun" sorusunu bağımsız cevaplıyor. Hiçbiri exhaustive tiple zorlanmıyor (`Record<RollStatus, …>` / `never` kontrolü yok) → **yeni bir statü değeri ya da yeni bir geçiş eklendiğinde 21 listenin hangisinin eski davranışa düştüğü derleyici tarafından söylenmez.** Bu, D-C-02'nin (trigger listesi) gerçekleşmiş örneğidir.

**Kanıt (liste envanteri, `grep -rn "RollStatus\[\] *=" src`):**
`inventory.service.ts:392` `CANCELABLE_ROLL_STATUSES` · `:3723` `ALWAYS_BLOCKED` · `:3737` `FREE_STOCK` · `workorder-link.service.ts:135` `ROLL_EDIT_BLOCKED` · `workorder.service.ts:260` `CLOSE_BLOCKED_STATUSES` · `:266` `CLOSE_IN_FLIGHT_STATUSES` · `:476/:479/:485` `TARGET_PROP_*` · `:1282` `attachable` · `:4438` `acceptedRollStatuses` · `:5939` `DETACHABLE_STATUSES` · `workorder-manual-move.service.ts:40` `MOVABLE_STATUSES` · `subcontractor.service.ts:209` `safeStatuses` · `:331` `AWAITING_DISPATCH_STATUSES` · `tambur-undo.service.ts:106` `MANUAL_UNDOABLE_STATUSES` · `:114` `CHILD_CANCELABLE_STATUSES` · `duplicate-rolls.service.ts:27` `IGNORED_STATUSES` · `workorder-split.service.ts:42` `REDYE_ELIGIBLE_STATUSES` · `batch.service.ts:55` `K18_DEAD_STATUSES` · `:75` `NO_LIVE_MATERIAL_STATUSES` · `kursun-qc.service.ts:1260` `finalStatuses` · `label.service.ts:39` `DEAD_LABEL_STATUSES` · `helpers/roll-disposition.helper.ts:53` `SELLABLE_DISPOSITION_STATUSES` · `helpers/coverage.helper.ts:34` `FINISHED_OUTPUT` · `helpers/sack-invariants.helper.ts:35/:53` `SACK_ABSENT/NON_SACKABLE` + trigger'ın kaynak/hedef listeleri (migration `20260809090000:79-86`).
Merkezî tablo araması: `grep -rnE "assertRollStatusTransition|ROLL_STATUS_TRANSITIONS|canTransition|StatusTransition" src` → **0 vuruş** (K10 A-7 ile aynı ölçüm). DB tarafında geçiş CHECK'i / trigger'ı **yok** (K2b §3'teki 24 kuralın hiçbiri geçiş kısıtı değil).

**failure_mode (somut, gerçekleşmiş sınıf).** Kök `CLAUDE.md` bu sınıfın **altı** vakasını kaydediyor ("beşinci unutulmuş-enum vakası", "üç sessiz 'altıncı enum değeri unutuldu' hatası", 2026-08-26/27). Bu turda ölçülen taze örnek D-C-02'dir: 2026-08-25'te `WAREHOUSE → SCRAP` kenarı açıldı, trigger'ın kaynak listesi güncellenmedi, hiçbir test kırmızı olmadı, Fire Karnesi sessizce yanlış döneme yazacak. Genel biçim: *"`RollStatus`'a `X` eklenir ya da `A→B` kenarı açılır; 21 listeden hangilerinin güncelleneceğini yalnız insan hafızası belirler; unutulan liste hata vermez, eski davranışa düşer."*

**Veride fiili ihlal (K2).** Uygulanamaz (yapısal). Dolaylı ölçüm: saha'da `A1_STOCK / RETURNED_FROM_SUBCONTRACTOR / AT_KARTELA / KARTELA_CONSUMED` statülerinde **0 satır** var ama bu dört değer 21 listenin farklı alt kümelerinde geçiyor — yani listeler bugün ölçülemiyor, ilk kullanımda ölçülecek.

**İş etkisi.** Her yeni akış (fire ucu, yeniden üretim, yarı mamul) bu 21 noktayı elle gezmeyi gerektiriyor; gezilmeyen nokta sessiz. Doğrudan bir bugün-hatası değil, **hata üretme hızını belirleyen yapısal kusur**.
**Öneri.** Tam bir geçiş matrisi tanıtmak (`assertRollStatusTransition`) 57 yazma sitesine dokunur — bu turda önerilmez. Ölçülü adım: ① `RollStatus` kümelerini **tek dosyada** topla (`constants/roll-status-sets.ts`) ve her birini `readonly RollStatus[]` yerine `Set<RollStatus>` + `satisfies` ile tanımla; ② kümelerin **ilişkilerini** tipte/testte zorla (`NON_SACKABLE = SACK_ABSENT ∪ {SHIPPED}` zaten kodda, `K18 ⊂ SACK_ABSENT` yorumla iddia ediliyor — bekçiye çevir); ③ yeni bir enum değeri eklenince derleme hatası veren tek bir `Record<RollStatus, {final: boolean; physicalPresent: boolean; dead: boolean}>` "statü künyesi" tablosu kur; 21 liste bu künyeden **türetilsin** (mümkün olanlar). ④ Trigger'ın kaynak/hedef listesi için bekçi: künyedeki `final` statüler ile trigger'ın hedef listesi eşit olmalı.
**Kabul kriteri.** `RollStatus`'a sahte bir değer eklendiğinde `npm run typecheck` **kırmızı** (bugün yeşil).
**Efor:** 2-3 gün (kademeli).
**Önceki defter.** MATRIX §A satır 2 ve K2b HOTSPOT-8 aynı yapıyı işaret ediyor; bu bulgu envanteri sayısallaştırıp somut tetikleyiciyi (D-C-02) bağlıyor.

---

### [D-C-10] Sipariş kalemi replace'i, iptal/devredilmiş iş emrinin sipariş bağını cascade ile sessizce siliyor

| Şiddet | **S3** | Kategori | C (Cascade → defter/iz satırı) | Öncelik | **P3** | Modül | SIP | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `OrderLine.order → Order` ve `WorkOrderToOrderLine.orderLine → OrderLine` ilişkileri **CASCADE**. Sipariş düzenlemesinde form'dan düşen kalemler `tx.orderLine.deleteMany` ile fiziksel siliniyor; guard yalnız **CANCELLED/SUPERSEDED olmayan** iş emri bağlarını sayıyor. Yani iptal edilmiş bir iş emrinin "bu sipariş kalemi içindi" bağı (ve `allocatedQty` kolonu) cascade ile, hata vermeden yok oluyor.

**Kanıt.** `Teks-Erp/prisma/schema.prisma:2098` (`OrderLine.order` Cascade), `:2507` (`WorkOrderToOrderLine.orderLine` Cascade).
`Teks-Erp/src/services/order.service.ts:2428-2447`:
```ts
const linkedToDeleted = await tx.workOrderToOrderLine.findFirst({
  where: { orderLineId: { in: toDelete },
           workOrder: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } } },
  select: { workOrderId: true },
});
if (linkedToDeleted) throw AppError.conflict("İş emri açılmış siparişin kalemleri değiştirilemez…");
await tx.orderLine.deleteMany({ where: { id: { in: toDelete } } });
```
Koruma araması: `WorkOrderToOrderLine` üzerinde `onDelete: Restrict` yok (Cascade); DB'de bağın silinmesini engelleyen kısıt yok; audit yalnız sipariş güncellemesi düzeyinde (`ORDER` kaydı), kaybolan bağ satırı için ayrı iz yok.

**failure_mode (somut).** İş emri `IE1508260007` iptal edildi (planlama değişti). Ertesi hafta satış, siparişten o kalemi çıkarıp yenisini ekliyor. `deleteMany` koşar, `work_order_to_order_lines` satırı cascade ile düşer. Artık `IE1508260007`'nin detayında "hangi sipariş için açılmıştı" bilgisi **yok** — `WorkOrder.type` de `linkOrderLines`/`unlink` üzerinden türetildiği için künye ile detay ayrışabilir. "Bu iptal edilmiş iş emri neyin içindi?" sorusu yalnız audit'te (6 ay) kalır.

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) FROM work_order_to_order_lines l JOIN work_orders w ON w.id=l."workOrderId"
WHERE w.status IN ('CANCELLED','SUPERSEDED');
```
→ **SAHA: 3 satır** (bugün silinmeye açık) · DEV: ölçülmedi (fixture gürültüsü).
Bağlam: `allocatedQty` kolonu sahada 140/140 satırda **0** (ölü kolon, K2a) → kaybolan şey miktar değil, **bağ tarihçesi**.

**İş etkisi.** İptal edilmiş iş emirlerinin sipariş izi kaybolabilir; düşük hacim (3 satır), operasyonel etki sınırlı.
**Öneri.** Guard'daki `notIn [CANCELLED, SUPERSEDED]` süzgecini kaldır ve mesajı ayır: canlı WO → mevcut 409; terminal WO → *"Bu kalem iptal edilmiş `IE…` iş emrine bağlı; kalemi silmek yerine **iptal** edin (`cancelledAt`), bağ tarihçesi korunur."* (Kalem iptali zaten 2026-08-27'de SOFT hâle geldi — silme yolu artık yalnız hiç kullanılmamış kalemler için gerekli.) Alternatif: `WorkOrderToOrderLine.orderLine` ilişkisini `Restrict` yap (şema, `prod_risk: yuksek`).
**Kabul kriteri.** Terminal WO'ya bağlı kalemin silinmesi 409 veriyor; bekçi `test_workorder_order_link.ts`'e negatif sonda.
**Efor:** 0,25 gün.
**Önceki defter.** K2a HOTSPOT-3 aynı yolu işaret ediyor (`sack_allocations` P2003 mesajı sorusuyla birlikte — o kısım F/hata-yolu denetçisine ait).

---

### [D-C-11] Mutasyona uğrayan beş tabloda `updatedAt` yok — "ne zaman değişti" yalnız olay kolonundan okunabiliyor

| Şiddet | **S4** | Kategori | C (audit kolonları / konvansiyon) | Öncelik | **P5** | Modül | CORE | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Kök `CLAUDE.md` konvansiyonu: *"tüm modellerde `createdAt`/`updatedAt` (M:N pivot ve append-only log tabloları hariç)"*. Beş tablo bu ayrımın **arasında** kalıyor: append-only değiller (satır sonradan güncelleniyor) ama `updatedAt` taşımıyorlar.

**Kanıt.**
| Model (şema satırı) | Sonradan yazılan alan | `updatedAt` |
|---|---|---|
| `ShipmentOrder` `prisma/schema.prisma:4312-4327` | `isActive` (dispatch/cancel → false, `shipping.service.ts:1851/:1978/:2192`) | **yok** (yalnız `createdAt` `:4326`) |
| `SubcontractorDispatchItem` `:3349-3370` | `remainderClosedAt` (kalan kapama) | **yok** |
| `SubcontractorReceiptItem` `:3562-3597` | `receivedQty`, `isPartial` | **yok** |
| `KartelaDispatchItem` / `KartelaReceiptItem` | append | yok (kabul edilebilir) |
| `RollBarcodeCounter` `:2709-2716` | `n` (her barkodda artar) | **`createdAt` de yok** |
Ek: `SystemLogArchive.updatedAt` `:5233` var ama `@updatedAt` **değil** (arşivleyici `createdAt`'i kopyalıyor, `audit.service.ts:255-258`) — bilinçli, arşiv tarihsel kopyadır.

**failure_mode (somut).** Sevkiyat storno edildi, `shipment_orders.isActive` `false → true` döndü (`:2192`). Bir hafta sonra "bu sipariş ne zaman sevkiyattan çıkarıldı / geri alındı?" sorusu sorulur: satırda yalnız `createdAt` var, `isActive` şu anki değeri gösterir, geçmişi audit'te (6 ay). `roll_barcode_counters` için: "bu gün/tip sayacı en son ne zaman ilerledi" sorusu **hiçbir kolondan** cevaplanamaz.

**Veride fiili ihlal (K2).** SAHA: `shipment_orders` 54 satır `isActive=false` (yani 54 satır doğuşundan sonra değişmiş, zaman damgası yok) · `subcontractor_dispatch_items` `remainderClosedAt` dolu **0** (özellik henüz kullanılmamış) · `roll_barcode_counters` 38 satır, hiçbirinde zaman kolonu yok.

**İş etkisi.** Düşük — sorular audit'ten (6 ay) cevaplanabiliyor. Uzun vadede iz kaybı.
**Öneri.** `ShipmentOrder`, `SubcontractorDispatchItem`, `SubcontractorReceiptItem`, `RollBarcodeCounter`'a `updatedAt DateTime @updatedAt @db.Timestamptz` (+ `RollBarcodeCounter`'a `createdAt`) ekle — `ADD COLUMN … NULL` metadata-only, backfill gerekmez (`20260708140000` emsali: `UPDATE … SET updatedAt=createdAt` sonra `SET NOT NULL`; bu tablolar küçük). Konvansiyon bekçisi: `test_db_invariants`'e "append-only allowlist'i dışındaki her modelde `updatedAt` var" §'i.
**Kabul kriteri.** Bekçi allowlist'i açıkça listeliyor; yeni model eklenince kırmızı.
**Efor:** 0,5 gün.
**Önceki defter.** K2a §9 aynı listeyi "konvansiyonla çelişen adaylar" olarak çıkarmış; burada ölçüldü + failure_mode verildi.

---

### [D-C-12] Çeki listesi çuval metrajını float `+=` ile topluyor — kardeş uç Decimal `_sum` kullanıyor (prod verisinde 39 çuvalın 16'sı ayrışıyor)

| Şiddet | **S4** | Kategori | C (Decimal → Number) | Öncelik | **P5** | Modül | SEV (çuval) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `Roll.currentQty` `Decimal(12,3)`. `getPickList` (sahaya basılan çeki listesi) toplamları **JS `number`** ile biriktiriyor; aynı verinin listedeki ikizi (`searchSacks`) Prisma `groupBy._sum` ile **Decimal** topluyor. İki uç aynı çuval için farklı ham değer döndürüyor. Bugün her bilinen tüketici 1 ondalığa yuvarladığı için görünür fark yok — kayıp API sözleşmesinde duruyor.

**Kanıt.**
- `Teks-Erp/src/services/sack-search.service.ts:410-441` (`getPickList`):
```ts
let totalQty = 0;
for (const r of s.rolls) { g.qty += Number(r.currentQty); totalQty += Number(r.currentQty); }
```
- Kardeş uç `:233-247` (`searchSacks`): `prisma.roll.groupBy({ _sum: { currentQty: true } })` → `Prisma.Decimal`.
- Aynı dosyanın `getContentDump` (`:508-520`) ve `shipping.service.ts:1187-1194` yolları Decimal kullanıyor (K7a §4.3'teki 6 yüzeyden 2'si float).
- Sözleşme: `Teks-Erp/src/utils/json-replacer.ts:15-25` `Decimal.toJSON → Number(this)` (tek dönüşüm noktası) — buradaki fark dönüşümden **sonraki** aritmetik.

**failure_mode (somut).** `POST /api/shipping/sack-search/pick-list` `CV1708260004` çuvalı için `totalQty: 1650.6999999999998` döner (35 top, 1 ondalıklı metrajlar). `GET /api/shipping/sack-search` aynı çuval için `1650.7` döner. Bugün Electron `PickListPrintDialog.tsx:18` `maximumFractionDigits: 1` ile yuvarladığı için kâğıtta fark yok; yeni bir tüketici (mobil çeki listesi, CSV dışa aktarım, muhasebe köprüsü) ham değeri basarsa çeki listesinde `1650.6999999999998 m` görünür.

**Veride fiili ihlal (K2).** Saha verisiyle ölçüldü (39 çuvalın top metraj dizileri çekilip JS'te birebir aynı toplama koşuldu): **16/39 çuvalda float toplam ile tam toplam metinsel olarak farklı.** Örnekler: `CV1708260004` 1650.6999999999998 ↔ 1650.7 (35 top) · `CV1808260002` 2381.2000000000003 ↔ 2381.2 (59 top) · `CV1808260004` 327.3999999999999 ↔ 327.4 (8 top).

**İş etkisi.** Bugün yok (istemci yuvarlıyor). Risk: yeni tüketici + eşitlik karşılaştırması.
**Öneri.** `getPickList`'te toplamları `Prisma.Decimal`/`D0()` ile biriktir (dosyanın diğer üç yolu zaten öyle); dönüşümü yalnız yanıtı kurarken yap. İsteğe bağlı: yanıt sözleşmesine "metraj 3 ondalığa yuvarlanmış number" kuralını yaz.
**Kabul kriteri.** Aynı çuval için iki ucun `totalQty` değeri birebir eşit (bekçi: 3 toplu çuvalda 0.1+0.2 deseni).
**Efor:** 0,25 gün.
**Önceki defter.** K7a §3.1 satır 2 (`sack-search.service.ts:424/427`) — burada saha verisiyle **kaç çuvalda gerçekleştiği** ölçüldü.

---

### [D-C-13] `initialQty = 0` olan iki tüketilmiş ana top, 20 m ve 39 m'lik çocuk taşıyor — DB'de `initialQty > 0` kısıtı yok

| Şiddet | **S3** | Kategori | C (CHECK kapsamı) | Öncelik | **P3** | Modül | ÜRE (Tambur) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Kesim değişmezi `Σ çocuk.initialQty ≤ parent.initialQty` (aşımda `RollVariance(OVERAGE)` yazılır). Saha'da iki `TAMBUR_CONSUMED` ana topun `initialQty`'si **0,000** ve tüketilmiş çocukları var; sapma defteri satırı yok. DB tarafında `rolls_initialQty_nonneg` yalnız `>= 0` diyor — **sıfır metrajlı bir top yaratılabiliyor ve kesilebiliyor**, bu da toplam kontrolünü anlamsız kılıyor.

**Kanıt.** CHECK envanteri `prisma/migrations/20260708120000_faz4_db_constraint_hardening/migration.sql:13-14` (`currentQty >= 0`, `initialQty >= 0`); `currentQty <= initialQty` ve `initialQty > 0` **yok** (K2a §3, K7a §1.2). Kesim doğrulaması `Teks-Erp/src/services/tambur.service.ts:732-753`; sapma yazımı `:1269-1276`.
**Veride fiili ihlal (K2).** K10 Q-STK-03 (bu turda iki DB'de koşuldu):
| Ana top | entrySource | initialQty | çocuklar | OVERAGE defteri |
|---|---|---|---|---|
| `e4a5455b-…` `T080826F0017` | TAMBUR_MANUAL | 0,000 | `T080826F0018` 20 m (WAREHOUSE) + `T080826F0019` 0 m (TAMBUR_CONSUMED) | yok |
| `09afe50c-…` `T080826F0020` | TAMBUR_SPLIT | 0,000 | `T080826F0021` 33 m + `T080826F0022` 6 m (ikisi WAREHOUSE) | yok |
→ **SAHA 2 satır · DEV 0.** Q-STK-03b: SAHA aşımlı 34 ana topun **32'si** defterli (defterli olmayan 2 = yukarıdakiler, ikisi de 08.08.2026 — sapma defteri 09.08'de geldi). Ana topların hareket kaydı yok (`roll_movements` 0), `preTamburCloseQty` NULL.
**failure_mode.** `initialQty = 0` bir top kesildiğinde `Σ çocuk ≤ parent` kuralı hiçbir şeyi sınırlamaz ve (2026-08-09 öncesi kodda) sapma defterine satır düşmez → 59 m kumaş, kaynağı "0 m" olan bir toptan doğmuş görünür; `test_consistency §13`/Q-STK-03 dışında hiçbir yüzey bunu söylemez. Bugünkü kodda aşım defterlenir, ama **sıfır metrajlı ana topun kendisi hâlâ mümkün**.
**İş etkisi.** İzlenebilirlik: iki topun (59 m) kökeni açıklanamıyor. Yeni satır üretimi bugün defterlenir; yapısal boşluk (0 m top) sürüyor.
**Öneri.** ① Bu iki satır için iş kararı (düzeltme = `[PROD'DA ÇALIŞTIRMA]`, dry-run script + tek tek liste; düzeltmemek de meşru — `§13`'ün gerekçesiyle aynı). ② `initialQty = 0` topun **yaratılabildiği yolu** bul ve kapat (`tambur-manual` / `workorder-split`; Zod `positive()` olduğu için API dışı bir yol olmalı) — ② ÜRE denetçisine ait. ③ Yol kapandıktan sonra `CHECK ("initialQty" > 0)` NOT VALID olarak eklenip yeni satırlara uygulanabilir (eski 2 satır VALIDATE edilmez).
**Kabul kriteri.** Yeni bir 0 m top yaratılamıyor (bekçi); Q-STK-03 saha'da yalnız bilinen 2 satırı döndürüyor.
**Efor:** 0,5 gün (teşhis) + karar.
**Önceki defter.** K10 HOTSPOT H-3 — bu turda iki ortamda yeniden ölçüldü ve çocuk/defter dökümü çıkarıldı.

---

## Uygulanan kontrol listesi

**Prompt Bölüm 3-C maddeleri (satır 478-518) + görev metnindeki 10 alt madde**

| # | Madde | Durum |
|---|---|---|
| C.1 | **FK varlığı** (`relationMode` + migration `FOREIGN KEY`) | **uygulandı** — `relationMode` verilmemiş → `foreignKeys`; canlı katalogda SAHA 281 / DEV 282 FK (K2b §2.2 ile uyumlu). Gerçek FK var → genel yetim taraması gereksiz; yalnız **FK'sız yumuşak referanslar** tarandı (aşağıda C.13). |
| C.2 | **`onDelete` davranışları / Cascade defterlere ulaşıyor mu** | **uygulandı** — 41 Cascade'in 10'u defter/iz taşıyor (K2a §4). `RollMovement`/`RollOperation`/`RollVariance`/`RollPlanDeviation`/`SackAllocation`/`SystemLog`/`PrintedDocument`'e **Cascade ile ulaşan üretim yolu YOK** (hepsi `Restrict` ya da FK'sız; `grep -rnoE '(tx\|prisma)\.(travelerCard\|shipment\|subcontractorDispatch\|subcontractorReceipt\|rollReturn\|printedDocument\|kartelaDispatch\|directShipment)\.(delete\|deleteMany)\(' src` → **0**). Gerçekleşen tek defter-cascade'i: sipariş kalemi replace → `work_order_to_order_lines` (**D-C-10**). `guarded-hard-remove` üç uçta (`station/machine/route/recipe/defectType`) SetNull referanslarını **explicit sayıyor** (`guarded-hard-remove.ts:141-177`) — orada boşluk bulunamadı; boşluk `mergedIntoId`'de (**D-C-07**). Cihaz unpair/hardDelete guard'lı (`device.service.ts:320-348`). |
| C.3 | **Para/miktar tipi Float mi** | **uygulandı** — `Float` **0**; 48 Decimal alanın **48'i** `@db.Decimal(p,s)` (Prisma `(65,30)` varsayılanı hiç kullanılmamış; `information_schema` precision NULL = 0). → **Doğru yapılanlar**. |
| C.4 | **Decimal → `Number()` sonrası aritmetik (sessiz kayıp)** | **uygulandı** — K7a §3.1'in 15 vuruşu gözden geçirildi; ölçülebilir tek fark **D-C-12** (saha verisiyle 16/39 çuval). `inventory.service.ts:2066-2081` çift `round1` (satır + toplam) yalnız `.x5` sınırında ±0,1 üretebilir → S4 altı, yazılmadı. `.toNumber()` 22 vuruşun hepsi çıktı (K7a). |
| C.5 | **Precision/scale birime uygun mu** | **uygulandı** — metraj/kg/en `(12,3)` (mm hassasiyeti, tavan 999.999.999,999) uygun; adet `Int`. **Para alanları sahada HİÇ KULLANILMIYOR**: `order_lines.unitPrice` 0/281 dolu, `orders.totalAmount` 0/278 dolu, `orders.currency` 278/278 `TRY` → `(12,2)`/`(14,2)` yeterliliği bugün ölçülemez, teorik. Bulgu yazılmadı. |
| C.6 | **Yuvarlama politikası tek yerde mi** | **kısmen — K7a'ya devredildi.** Ölçüm K7a §5'te (yuvarlama kaynağa değil **yüzeye** bağlı: 3/1/2/0 ondalık; yazılı politika yok). Bu alanın kusuru "hesap tekrarı" sınıfı → K7a/L denetçisi. Buradan yalnız D-C-12 (tip kaybı) yazıldı. |
| C.7 | **Döviz: tutar yanında para birimi + kur + kur tarihi** | **kapsam dışı — sebep:** ERP fatura kesmiyor, `Order.currency` var ama **kur/kur tarihi kolonu yok ve ihtiyacı da yok** (278/278 sipariş TRY, `totalAmount` hiç dolmuyor). Çok para birimli satış başlarsa gerekli olur → "Kapsanmayan"a not. |
| C.8 | **Tarih/saat: UTC mi yerel mi, timestamptz mi, business date ayrımı** | **uygulandı** — 183/183 `DateTime` **timestamptz** (`timestamp without time zone` iki DB'de de 0); havuz oturumu `-c timezone=UTC` (`lib/prisma.ts:60-65`); fabrika günü tek kaynak `constants/time.ts` (takvim günü ↔ mutlak pencere ayrımı **yazılı**). Boşluk: belge tarih/saat/numarası (**D-C-08**). Gece vardiyası 23:50 senaryosu ölçüldü: fabrika günü ≠ UTC günü olan satır SAHA'da rolls 0, movements 0, shipments 0, printed_documents 0, system_logs 12/10.485. |
| C.9 | **Durum alanları enum mü, serbest string mi** | **uygulandı** — 45 enum, durum alanlarının tamamı enum (serbest string durum alanı **yok**). Ama **geçiş matrisi hiçbir yerde yok** (**D-C-09**) ve trigger listesi ayrışabiliyor (**D-C-02**). Serbest metin taşıyan ilgili kolonlar: `Roll.entryReasonCode/cancelReasonCode` `VARCHAR(64)` index'siz + `RollMovement.notes` marker'ları (aşağıda C.13). |
| C.10 | **Denormalize alanlar mutabakatı (bu denetimin en değerli çıktısı)** | **uygulandı — iki DB'de koşuldu.** Sonuç tablosu aşağıda. |
| C.11 | **Audit kolonları / audit güncellenebiliyor mu** | **uygulandı** — **D-C-04** (GUC kapalı + FK SET NULL, "RESTRICT" iddiası yanlış) ve **D-C-03** (iptal izi 6 yolda yazılmıyor). |
| C.12 | **Soft delete filtresi: global mı elle mi; `$queryRaw`'da atlanan yerler** | **uygulandı** — global middleware/extension **YOK**, filtre elle (bilinçli). 44 dosyada 104 raw SQL vuruşu tarandı: `order_lines` geçen 8 dosyanın hepsi `cancelledAt`'i **açık yorumla** ele alıyor (`aktif-kalem` / `aktif-kalem-muaf` ayrımı yazılı, ör. `order-leadtime.report.service.ts:150-173`); `K18_DEAD_STATUSES` rapor sorgularında `Prisma.join` ile geçiyor (`quality-scorecard:194`, `scrap-scorecard:207`). Tombstone (`mergedIntoId`) süzgeci raporlarda **gerekmiyor** çünkü birleştirme motoru referansları taşıyor — ölçüldü: 12 tabloda tombstone'a canlı referans **0/0** (iki DB). Bulunan tek soft-delete ihlali sınıfı: pasif ana veriye bağlı canlı kayıt (SAHA 2 top + 1 sipariş kalemi pasif kumaşa bağlı; DEV 6 top pasif renge bağlı) → K10 A-25 ile aynı, yeni bulgu yazılmadı. **`getPickList`/`getSackContents`/`searchSacks` ghost süzgeci** (`SACK_ABSENT_STATUSES`) üç yolda da var; `computeSackAllocations` (`shipping.service.ts:1306-1312`) ve `previewShipment` (`:1469-1478`) süzgeçsiz ama **dispatch'te fail-closed assertion** (`:1834-1846`) kapatıyor → bulgu değil, **Doğru yapılanlar**'a yazıldı. |
| C.13 | **FK'sız "yumuşak" referanslar → yetim taraması** | **uygulandı** — `PrintedDocument.sourceId` (polimorfik, FK YOK, `schema.prisma:4014-4016` bilinçli), `RollVariance.sourceRefId`, `RollPlanDeviation.confirmationId`, `RollReturn.returnGroupId`, `SystemLog.recordId/deviceId`, `Session.deviceId` (`VarChar(64)`, istemci başlığı). Yetim ölçümü: **SAHA 6 docType × 328 belgede yetim 0 · `returnGroupId` 0 · `sourceRefId` 0 · `system_logs.recordId(ROLL)` 4.287'de 1 yetim.** **DEV:** `printed_documents` 11.637 satırın **11.600'ü yetim** (SUBCONTRACTOR_DISPATCH 7.235/7.286, SHIPMENT_DISPATCH 2.813/2.815, RETURN_DISPATCH 1.375/1.375, TRAVELER_CARD 177/177) ve `system_logs(ROLL)` 32.105'te 31.843 yetim — **hepsi test cleanup artığı**; üretim kodunda kaynağı silen yol yok. Prod temiz → bulgu yazılmadı, K/ops notu bırakıldı. |
| C.14 | **Şirket/tenant filtresi (RLS)** | **N/A — sebep:** DB-per-müşteri (tek tenant/DB); `companyId`/`tenantId` kolonu yok (KUNYE). `Branch` şube filtresi iş kuralıdır, izolasyon değil. |
| Görev 1 | Cascade → defter/hareket tablosu | ✔ C.2 |
| Görev 2 | Unique anahtarda NULL kolon | **uygulandı** — K2a §11'deki 11 kısıt tek tek denetlendi; **hepsi bilinçli ve belgeli** (barcode/clientToken/cardToken/quickPin/Route.code/CustomerBranch.code/RollError.defectTypeId(partial)/Sack(shipmentId,seq)/nameFold/DirectShipAlloc). Tek şüpheli — `label_templates_one_default_per_kind (kind) WHERE isDefault=true` ile `kind` nullable → kind-null + isDefault=true çoklu satır mümkün olurdu; **kod bunu kapatıyor** (`label-template.service.ts:299-301`: `standalone && isDefault → 400`, kind yalnız standalone'da null). Sahada kind-null şablon 1 ve `isDefault=false`. → bulgu yok. |
| Görev 3 | Decimal(65,30) + Number aritmetiği | ✔ C.3/C.4/C.5 |
| Görev 4 | TZ sözleşmesi / business date | ✔ C.8 |
| Görev 5 | Durum alanları + geçiş matrisi + FK'sız string referanslar | ✔ C.9/C.13 |
| Görev 6 | Soft-delete/tombstone filtresi | ✔ C.12 |
| Görev 7 | Denormalize alan mutabakatı (K10 sorguları, iki DB) | ✔ C.10 |
| Görev 8 | Audit kolonları / SystemLog güncellenebilir mi | ✔ C.11 |
| Görev 9 | `createdAt`/`updatedAt` konvansiyon ihlalleri | ✔ **D-C-11** |
| Görev 10 | LabelTemplate kind başına tek varsayılan (iki bağımsız sed) | ✔ **D-C-05** |

### C.10 — DENORMALİZE ALAN MUTABAKATI (koşum sonuçları, 2026-08-28)

Koşum: `audit/tools/sql-saha.sh -f Teks-Erp/scripts/consistency-check.sql` ve `…-derived.sql`; §20 `test_consistency.ts:462-520` sorgusu elle; K10 Q-STK-02/03/03b.

| Denorm alan / değişmez | Sorgu | **SAHA** | **DEV** | Yorum |
|---|---|---|---|---|
| `OrderLine.shippedQty` = Σ SackAlloc(DISPATCHED)+DirectShipAlloc | §1 | **0** | **1** | DEV satırı `TST-DS-ORD-46657044` (`faa618d9-…`, kayıtlı 500 / hesaplanan 0, 0 tahsis) = doğrudan-sevk testi kalıntısı, üretim kodu değil |
| `Order.shippedQty` = Σ satır | §2 | 0 | 0 | |
| Negatif miktar (CHECK backstop) | §3 | 0 | 0 | |
| Roll↔Sack↔Shipment (DEFERRABLE FK backstop) | §4 | 0 | 0 | |
| `ShipmentOrder.isActive` ⇔ PLANNED | §5 | 0 | 0 | |
| `Sack.seq` ⇔ `shipmentId` | §6 | 0 | 0 | |
| Çuvalda hayalet içerik | §7/§7b/§7c | 0/0/0 | 0/0/0 | |
| Barkodsuz satılabilir top | §8 | 0 | 0 | |
| SHIPPED ⇔ DISPATCHED | §9 | 0 | 0 | |
| IN_PRODUCTION ⇒ adım + canlı WO | §10 | 0 | 0 | |
| Hayalet açık movement | §11 | **0** | 12 | DEV: `TST-` fixture |
| Kapanmış movement `qtyOut = qtyIn` | §12 | **15** | 7 | **hepsi muaf desen** → **D-C-06** (SQL dosyası muafiyeti taşımıyor) |
| `currentQty ≤ initialQty` | §13 | **2** | 0 | Bilinçli, belgeli (2026-08-22); `95c15daf` 492→698,9 · `92d0ef12` 500→520,5 |
| Yarım fason kabul | §14 | 0 | 0 | |
| AT_SUBCONTRACTOR ⇒ açık sevk | §15 | 0 | 1 | DEV: seed artığı |
| Kartsız WO | §16 | 0 | 671 | DEV: `TST-` fixture |
| Açık hata ↔ ölü top | §17 | 0 | 0 | |
| Ana veri ad mükerreri | §18 | 0 | 0 | (sahadaki `items` mükerreri tombstone süzgeciyle eleniyor) |
| Fason/doğrudan sevk `totalQty` = Σ kalem | §19 | 0 | 49 | DEV: fixture |
| **`WorkOrderStep.status`** = movement türetimi | §20 | **1** | 95 | SAHA: `fc7bab75` / `IE0608260004` (`COMPLETED` ama açık 0 / kapalı 0 / bekleyen 0 → beklenen `PENDING`); adımın tek topu sonradan iptal edilmiş — CLAUDE.md 2026-08-22'de "sorgunun kör noktası, veri bozuk değil" olarak kayıtlı. DEV'in 95'inin ~94'ü `TST-` |
| `WorkOrder.type` ⇔ sipariş bağı | §21 | **0** | 2 | |
| IN_PROGRESS ama tüm adımlar bitmiş | §22 | 0 | 0 | |
| Açık bypass ⇒ canlı WO | §23 | 0 | 0 | |
| Fason kalem yeniden açık / doğrudan sevk | §24a/b | 0/0 | 0/0 | |
| Kartelalık ↔ etiket bayat | §25 | 0 | 0 | |
| Depo rengi ≠ hedef renk, sapma izi yok | §26 / §26b | **4** / 0 | 0 / 0 | §26 bilgi düzeyi (kapı öncesi); §26b (kapı sonrası) temiz |
| **Kesim toplamı** `Σ çocuk ≤ parent.initialQty` ∧ OVERAGE | Q-STK-03 | **2** | 0 | **D-C-13** |
| Aşımlı ana top / defterli | Q-STK-03b | 34 / **32** | 2 / 2 | Defterlenmeyen 2 = Q-STK-03'ün 2 satırı |
| `Sack` toplamları | — | *denorm KOLON YOK* | — | Çuval toplamı hiçbir yerde saklanmıyor, her yüzeyde yeniden hesaplanıyor (6 yüzey, K7a §4.3) → mutabakat yerine **yüzey tutarlılığı** sorusu: D-C-12 + `Sack.weightSource` 0/41 dolu (ölü kolon), `labelDirty` 0/41 |
| `Batch` canlı sayımı | — | *denorm KOLON YOK* | — | "Açık parti" sorgudan türer (`K18_DEAD_STATUSES`); Q-PAR-05 13/198 parti canlı topsuz (bilgi) |
| `TravelerCard.contentDirty/labelDirty` | özel | ACTIVE 85'in 67'si dirty; 9'unda `contentDirty=false` ama `WO.updatedAt > card.updatedAt` | — | **Bulgu yazılmadı:** `touchWorkOrderTx` plan-dışı sebeplerle de `updatedAt` tazeliyor → sorgu ayırt edemiyor; ayrıca 2026-08-05'ten beri kart **canlı planı** basıyor ve rozet yüzeyleri 2026-08-06'da kaldırıldı → bayrağın yanlışlığı bugün kâğıda yansımıyor |
| `Roll.cancelledAt/preCancelStatus` izi | özel | **134/230 boş** | — | **D-C-03** |

---

## Doğru yapılanlar (korunmalı)

1. **Sayısal tip disiplini eksiksiz.** `Float` **0**; 48 Decimal alanın 48'i `@db.Decimal(p,s)` ile açık precision/scale taşıyor (Prisma'nın `(65,30)` varsayılanı hiç oluşmamış), `information_schema`'da precision'ı NULL olan **0** kolon. Metraj/kg/en `(12,3)` seçimi birimle uyumlu. Prisma projelerinde en sık görülen sessiz para/miktar hatası bu repoda **yok**.
2. **Saat dilimi kararı yazılı ve tek kaynakta.** `src/constants/time.ts` yalnız kod değil, **karar belgesi**: "takvim günü (tz'ye bağlı) ↔ mutlak pencere (tz'den bağımsız)" ayrımı açıkça yapılmış, `Intl` ile süreç TZ'sinden bağımsız hesap yapılıyor, `factoryDayKeyUtcMidnight` gibi tuzaklar (Prisma `@db.Date` yazımı) yorumda ölçümle gerekçelendirilmiş. 183/183 kolon `timestamptz`. Bu, ERP denetimlerinde en sık kırık bulunan alanlardan biri ve burada örnek düzeyde.
3. **Değişmezlerin DB'ye indirilmiş kısmı gerçekten indirilmiş.** 26 CHECK (`NOT VALID` → `VALIDATE` deseniyle, kilit süresi düşünülerek), 15 partial UNIQUE (iş kuralı seddi: "bir top bir adımda tek açık hareket", "adım başına tek açık bypass", "makine/cihaz başına tek aktif oturum"), 2 DEFERRABLE bileşik FK (çuval↔sevkiyat tutarlılığı), 3 expression UNIQUE, 33 GENERATED kolon — ve hepsinin **mekanik envanteri** `test_db_invariants.ts`'te iki yönlü karşılaştırılıyor. Şema-dışı nesneleri bu disiplinle takip eden proje azdır.
4. **Fail-closed sed yerleştirmesi.** Sevk anında hayalet-top guard'ı **filtre değil assertion** olarak konmuş ve gerekçesi yazılmış (`shipping.service.ts:1834-1846`: filtre koyulsaydı hayalet DISPATCHED çuvalda kilitlenir, `removeRollFromSack` reddeder → onarılamaz çıkmaz). Aynı disiplin çuval etiketi baskısında (şablon yoksa 400) ve `applyManualProperties`'te (`SCRAP`/`CANCELLED` topa dokunma reddi, `inventory.service.ts:3708`) tekrarlanıyor.
5. **Soft-delete filtresinin "muaf mı değil mi" kararı satır satır yazılı.** Rapor SQL'lerinde `cancelledAt` süzgeci ya uygulanıyor ya da **muafiyeti gerekçelenerek** atlanıyor (`order-leadtime.report.service.ts:150-152`: *"aktif-kalem-muaf: GEÇMİŞ sorusu — mal çıktıysa çıkmıştır"*). Global bir middleware'in gizleyeceği bir ayrım, burada okunabilir durumda.
6. **Birleştirme (merge) motoru referansları gerçekten taşıyor.** 12 farklı FK üzerinden tombstone'a canlı referans **0/0** (iki DB) — yani `mergedIntoId` tombstone modeli veri düzeyinde temiz çalışıyor; kusur yalnız silme guard'ında (D-C-07).

---

## Sınır ötesi notlar

| Gözlem | Yönlendirme |
|---|---|
| **D-C-01'in yazma ayağı:** `tambur-undo.service.ts` iptal ettiği kesim çocuğunun `currentQty`'sini sıfırlamıyor ve `preCancelStatus` yazmıyor. Geri alma aritmetiğinin sahibi ÜRE/Tambur hücresi. | ② ÜRE (Tambur geri alma) |
| **`kursun-qc.service.ts:1124-1146` `reopenStep`** claim'i `status in [WAREHOUSE, A1_STOCK, **SCRAP**] → IN_PRODUCTION` yapıyor; "fire geri alınamaz" (CLAUDE.md 2026-08-25) kuralıyla çelişiyor ve `finalizedAt` bu geçişte silinmiyor. | ② ÜRE + RAPOR (K10 H-4) |
| **`shipping.service.ts:1306-1312` `computeSackAllocations`** çuval içeriğini `SACK_ABSENT_STATUSES` süzgeci OLMADAN havuza alıyor; `previewShipment:1469-1478` de öyle. Bugün dispatch'teki fail-closed assertion kapatıyor, ama önizleme rakamı liste/etiket/irsaliyeden farklı olabilir. | ② SEV (sevkiyat) |
| **`printed_documents` DEV'de 11.637 satır / 25 MB, 11.600'ü yetim** (`sourceId` FK'sız, test cleanup kaynağı siliyor belgeyi silmiyor). `clean_test_residue` önek listesinde `printed_documents` yok. Prod temiz. | ② K (test artığı) / OPS |
| **`system_logs.recordId`** DEV'de 32.105 `ROLL` satırının 31.843'ü yetim (DB reset/reseed sonrası). Audit hacim + arşiv politikası. | ② AUD / H (performans) |
| **`consistency-check.sql` §13** başlığı "2 satır bilinçli" diyor ama sorgu 0 bekleyen bir bölüm gibi yazılmış; §12 ile birlikte "beklenen kırmızı" politikasının belgelenmesi gerekiyor. | ② K (bekçi) / OPS |
| **`Roll.entryReasonCode` / `cancelReasonCode`** `VARCHAR(64)`, index yok, saha'da 230/230 boş — "kod rapor anahtarıdır" tasarımı henüz veriyle karşılanmadı. | ② RAP + ENV |
| **`SubcontractorReceiptItem.receivedQty`** nullable + saha 635/638 NULL + CHECK yok; raporlar `COALESCE` ile "eski kayıt = tamamı geldi" varsayıyor. Yeni bir yazma yolu alanı doldurmayı unutursa sessizce "tam kabul" okunur. | ② FAS (fason) |
| **`orders.cancelledAt` / `order_lines.cancelledAt`** sahada YOK (5 migration uygulanmamış) ama HEAD kodu her sipariş sorgusunda okuyor (`order-line-scope.helper.ts:26`) → migration'sız deploy = P2022/500. | ② J (migration/deploy) |
| **`Session.deviceId`** `VarChar(64)` — `Device.deviceId` doğal anahtarına FK'sız yumuşak referans; cihaz silinirse oturum satırı yetim string taşır (bugün cihaz silme guard'lı). | ② G (kimlik) |
| **Dev DB'de `TST-` fixture kalıntısı yoğun** (§16 671, §19 49, §20 95, §11 12 satır) — mutabakat bekçileri `notFixture()` ile eliyor ama elle SQL koşan biri için gürültü. | ② K (test artığı) |

---

## KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Sebep / durum |
|---|---|
| **Canlı prod DB** | Erişim yok. Yalnız 2026-08-25 kopyası (190/195 migration). Son 5 migration'ın kolonları (`orders/order_lines.cancelledAt`, `ReasonPresetKind.ORDER_CANCEL`, `orders_active_createdAt_idx`) kopyada YOK → o alanlara dair mutabakat yalnız dev'de ölçülebildi. 08-25 sonrası 3 günün verisi görülmedi. |
| **`teks.audit_guard` prod değeri** | `pg_db_role_setting` restore ile taşınmaz; kopyada boş. D-C-04'te `[VARSAYIM 1]` olarak işaretlendi; ölçüm yolu `/api/admin/health.auditGuard` (canlıda okunmalı). |
| **Prod süreç saat dilimi (`TZ`)** | `ecosystem.config.js`'te set edilmemiş; sunucunun OS TZ'si doğrulanamadı. D-C-08'in bugünkü doğruluğu bu varsayıma dayanıyor. |
| **Repro script (K3)** | D-C alanı için istenmiyor (sözleşme: D-A/D-B). D-C-01 için eşzamanlılık değil **sıralı** bir repro yeterlidir (kes → geri al → restore) ve 2. turda dev DB'de koşulabilir; bu tur salt-okunur kaldı. |
| **Yuvarlama politikası / kopya hesap farkları** | K7a §4-§5'in alanı (hesap noktaları); buradan yalnız tip kaybı (D-C-12) alındı. `fmtTr` ×3, `round1` ×3, 13 "açık metraj" kopyası K7a/L denetçisine ait. |
| **Döviz / kur alanları** | Fiilen kullanılmayan alan (0/278 `totalAmount`); tasarım eksikliği olarak yazılmadı, gelecek ihtiyaç notu bırakıldı. |
| **İstemci (Electron/mobil) tip ikizleri** | Enum/izin/alan katalogları Electron'da aynalanıyor (backend import edemiyor); ayrışma bekçileri bu turda koşturulmadı — yalnız D-C-12'de tüketicinin yuvarladığı doğrulandı (`PickListPrintDialog.tsx:18`). |
| **`Sack`/`Batch` denorm mutabakatı** | Saklanan denorm kolon **yok** → mutabakat sorgusu yazılamaz; yerine yüzey tutarlılığı ölçüldü (C.10 tablosu). |
| **`TravelerCard.contentDirty` doğruluğu** | Ölçüldü (9 şüpheli satır) ama `touchWorkOrderTx`'in plan-dışı `updatedAt` dokunuşu sinyali kirletiyor → **kanıt seviyesi yetersiz**, bulgu yazılmadı. Kesin ölçüm `planKey` yeniden hesabı ister (servis kodu koşturmak gerekir; salt-okunur turda yapılamaz). |
| **Bekçi koşumu** | Hiçbir `scripts/test_*.ts` bu turda **koşturulmadı** (salt-okunur + dev DB'ye yazar). Bekçi iddiaları dosya/satır okumasına dayanıyor. |
| **Migration checksum bütünlüğü** | K2b'de de çözülememişti; bu turda tekrar denenmedi (J denetçisinin alanı). |
