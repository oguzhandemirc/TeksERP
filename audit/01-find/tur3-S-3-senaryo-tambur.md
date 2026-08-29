# TUR 3 · S-3 — Senaryo denetimi: Tambur (kesim / finalize / geri alma çakışmaları + planlamacı düzenlemesi)

> **Mercek:** senaryo merkezli. Bulgular tek bir fonksiyonun kod kusurundan değil, **bir akışın ADIMLARI ARASINDAKİ boşluktan** doğar. Tur 1 (kod) ve Tur 2 (veri) 208 kaydı zaten taradı; aynı kod noktasına dönen her bulguda `onceki_defter` alanı doldurulmuş ve **yeni koşul/senaryo** getirilmiştir.
>
> **Dal/HEAD:** `adnansahin` · Künye: `audit/00-map/KUNYE.md` (Node 22, Express 5, Prisma 7 + adapter-pg, PG read-committed, PM2 fork `instances:1`).

---

## 0. ORTAM UYARISI — bu turda K2/K3 ALINAMADI (dürüst kayıt)

| Araç | Sonuç |
|---|---|
| `audit/tools/sql-dev.sh` | ❌ `FATAL: Postgres.app failed to verify "trust" authentication` (GUI oturumu yok) |
| `audit/tools/sql-saha.sh` | ❌ aynı hata (aynı sunucu) |
| `npx tsx scripts/audit_repro_S-3-01.ts` | ❌ aynı hata → `audit/repro/S-3-01.log` |
| `npx tsx scripts/audit_repro_S-3-02.ts` | ❌ aynı hata → `audit/repro/S-3-02.log` |

Sonuç: **iki repro scripti YAZILDI, tip kontrolünden GEÇTİ** (`tsconfig.scripts.json`, 0 hata) ama **koşturulamadı**. Bu bir negatif sonuç değil, **ölçüm yapılamadı** halidir — bulgular bu yüzden K1'de tutuldu ve hiçbirine S0 verilmedi (S0 için K2/K3 zorunlu). PostgreSQL erişilir hale gelince iki script olduğu gibi koşturulmalıdır:

```bash
cd Teks-Erp && npx tsx scripts/audit_repro_S-3-01.ts 2>&1 | tee ../audit/repro/S-3-01.log
cd Teks-Erp && npx tsx scripts/audit_repro_S-3-02.ts 2>&1 | tee ../audit/repro/S-3-02.log
```

Veri tarafındaki boşluk **Tur 2'nin ölçümleriyle** kapatıldı (aşağıda "prod ölçümü" diye geçen her rakamın kaynağı `audit/01-find/tur2-V-*.md`'dir, yeniden ölçülmedi).

### Senaryoların ön koşulları — sahadaki GERÇEK bayrak değerleri (Tur 2 · V-4 §0)

| Bayrak | Saha | Senaryoya etkisi |
|---|---|---|
| `tambur.overQuantityEnabled` | **true** (satır YOK → varsayılan) | S3b'nin aşım dalı **canlı** — S-3-03 tetiklenebilir |
| `tambur.undoFullSameDayOnly` | **false** | "Tümden geri al" gün sınırsız — S-3-01 penceresi geniş |
| `kk1.duplicateGuardEnabled` | **true** | (S-3 alanının dışı) |
| `production.kursunBypassEnabled` | **true** | Tambur okutması dağıtılmamış kurşunu da kapatıyor |
| `device.pairingRequired` | **false** | Eşleşmemiş tablet de yazabiliyor → "iki tablet aynı topta" olasılığı artar |
| `tambur.shortCutA1Enabled` | **false** | Kısa-kesim→A1 yolu sahada koşmuyor — senaryo dışı bırakıldı |

Ayrıca Tur 2 ölçümleri (prod kopyası 2026-08-25):
- **92 iptal edilmiş kesim çocuğu / 4.327,2 m** — yani **Tambur geri alma yolu sahada aktif olarak kullanılıyor** (V1-35).
- **`currentQty > initialQty` olan 2 satır**, ikisinde de `TAMBUR_UNDO_REOPEN` hareketi (V1-02) → geri alma yolu bu invariantı geçmişte fiilen kırmış.
- `MANUAL_MOVE_OUT` notlu hareketler mevcut (V1-21) → "Konumu Düzelt" de sahada koşmuş.

---

## 1. AKIŞ HARİTASI — hangi yazma yolu iş emri satırını KİLİTLİYOR?

Tüm S-3 bulgularının kökü tek bir tabloya iniyor. `helpers/roll-step.helper.ts:188-191` sözleşmeyi açıkça yazıyor:

> *"Çağıran tx başında `touchWorkOrderTx` ile WO'yu write-kilitlemeli (`remainingSteps` sayımı eşzamanlı finish/fason/finalize ile serileşsin)."*

`touchWorkOrderTx` (`helpers/workorder-locks.helper.ts:56-63`) = `tx.workOrder.updateMany({where:{id}, data:{updatedAt}})` → WO satırına yazma kilidi, tx sonuna kadar.

| Yazma yolu | `touchWorkOrderTx` | Adım/WO durumunu DEĞİŞTİRİYOR mu | Kanıt |
|---|---|---|---|
| `tambur.finalize` | ✅ | evet (`recomputeStepStatus` + `completeWorkOrderIfStepsDone`) | `tambur.service.ts:931`, `:1244`, `:1282` |
| `tambur.cutOpenFabric` | ✅ | hayır (yalnız metraj) | `tambur.service.ts:2793` |
| `tambur.finalizeOpenFabric` | ✅ | evet | `tambur.service.ts:3184`, `:3391` |
| `inventory.kursunFinish` | ✅ | evet | `inventory.service.ts:4670`, `:4803` |
| `kursun-qc.finishStep` | ✅ | evet | `kursun-qc.service.ts:850`, `:943` |
| `subcontractor.dispatch` / `receive` / `cancel` | ✅ | evet | `subcontractor.service.ts:1041, 2016, 2681, 4807` |
| `workorder.update` / `replace` | ✅ (claim) | — | `workorder.service.ts:4778`, `:5263` |
| `workorder.completeWorkOrder` | ✅ (claim tx'in İLK ifadesi) | evet | `workorder.service.ts:3866` |
| `kursun-bypass.*` | ✅ | evet | `kursun-bypass.service.ts:771, 1369, 1816, 1968` |
| `workorder-split` | ✅ | evet | `workorder-split.service.ts:621` |
| **`tambur-undo.applySingleRestore`** | ❌ **YOK** | **evet** (topu adıma geri koyar, hareket açar, `recomputeStepStatus`, WO dirilt) | `tambur-undo.service.ts:1221-1386` |
| **`tambur-undo.applyFull`** | ❌ **YOK** | **evet** (aynı) | `tambur-undo.service.ts:1434-1677` |
| **`workorder-manual-move.manualMove`** | ❌ **YOK** | **evet** (topu adıma taşır, hareket açar/siler, adım SKIP/PENDING yazar, WO dirilt) | `workorder-manual-move.service.ts:595-850` |

Mekanik teyit:
```bash
$ grep -n "touchWorkOrderTx" Teks-Erp/src/services/tambur-undo.service.ts
(0 vuruş)
$ grep -n "touchWorkOrderTx" Teks-Erp/src/services/workorder-manual-move.service.ts
(0 vuruş)
```

**İş emri kapanışı `completeWorkOrderIfStepsDone` (`roll-step.helper.ts:193-213`) tam olarak beceri §3.1'in üçlü koşuluna uyan bir KÜME kararıdır:**
1. tx birden çok satırı (`workOrderStep`) okuyup onlardan **türetilen** bir invariant yazıyor ("bu iş emrinde bitmemiş adım kalmadıysa kapat"),
2. okunan kümeye başka bir tx satır **ekleyebilir / satırın durumunu değiştirebilir** (phantom — satır kilidi kapatmaz),
3. izolasyon yükseltilmemiş (`isolationLevel` kodda yalnız `shipping.service.ts:2610`'da) ve advisory lock da yok.

Tasarım bu boşluğu **advisory lock ile değil, "herkes WO satırını kilitler" DİSİPLİNİYLE** kapatıyor. Disiplin **üç yazma yolunda tutulmamış** ve tam da o üçü Tambur senaryolarının merkezinde.

---

## 2. SENARYO ÇİZELGELERİ (8 soru uygulanmış)

### S3a — İki tablet aynı topu Tambur'da işliyor (kesim ‖ finalize)

| # | Soru | Cevap |
|---|---|---|
| 1 | Değişmez | Bir parent yalnız BİR kez tüketilir; çocuk barkodları çakışmaz; `producedInStepId` = kesimin yapıldığı adım |
| 2 | Tek tx mi | Evet (`tambur.service.ts:925-1291`); barkod rezervasyonu **bilinçli olarak tx DIŞINDA** (`:906`) |
| 3 | Check-then-act | Evet ama **kapatılmış**: `roll.status===TAMBUR_CONSUMED` ön-kontrolü (`:658`) + tx içinde atomik claim (`:953-960`) |
| 4 | Claim/kilit | ✅ `updateMany {id, status:IN_PRODUCTION, currentStepId}` + `count===0` ayrımı (`:961-974`) + **bayat metraj guard'ı** (`:981-989`) |
| 5 | Küme kararı | `completeWorkOrderIfStepsDone` — WO satırı kilitli (`:931`) |
| 6 | DB kısıtı | ✅ `rolls.barcode` unique + atomik barkod sayacı (`roll_barcode_counters`, `ON CONFLICT … n=n+count`) + `roll_movements_one_open_per_roll_step_uq` (partial unique) |
| 7 | Bozuluyor mu | **Kesim/finalize çekirdeği için HAYIR** — bu yol denetimin en iyi korunan yeri. **AMA** idempotency yanıtı kimlik taşımıyor → **S-3-05** |
| 8 | Etki | Bkz. S-3-05 (operatörün kalite kararı sessizce kayboluyor + mükerrer etiket) |

### S3b — Kesim biter bitmez geri alma ‖ başka tablet kardeş parçayı geri alıyor / çocuğu okutuyor

| # | Cevap |
|---|---|
| 1 | `currentQty ≤ initialQty`; geri konan metraj tam bir kez sayılır (F0402); iptal edilen çocuk envanterden düşer |
| 2 | `applySingle` tek tx (`:1058-1171`), `applyFull` tek tx (`:1434-1692`) |
| 3 | **EVET, açık:** `parentRow = findUnique(parentId)` (`:1124`) → `initialBump` hesabı (`:1128-1132`) → `updateMany … increment` (`:1143`). Kilit ancak son adımda. |
| 4 | Çocuk claim'i ✅ (`:1073-1083`); parent claim'i ✅ ama **`initialBump` claim'in DIŞINDA hesaplanmış** |
| 5 | `computeRestoredQty` (`:339-378`) çocuk kümesi + sapma defteri üzerinden türetiliyor — çocuk claim'i sayesinde korunuyor (aşağıda "doğru yapılanlar") |
| 6 | ❌ `CHECK (currentQty <= initialQty)` DB seddi YOK (Tur 1 `BULGU-T1-044`) |
| 7 | **EVET** → **S-3-03** |
| 8 | Aşım/fire karnesi ve §13 mutabakatı sessizce bozulur; canlıda aynı sınıftan 2 satır zaten var |

**Çizelge (S-3-03).** Parent 100 m, 40+40+40 aşımlı kesim → `cur=0 init=100`, kesim anı `OVERAGE 20` yazılmış.
```
T1  A: findUnique(parent) → cur=0,  init=100
T2  B: findUnique(parent) → cur=0,  init=100          (A henüz commit etmedi)
T3  A: newCurrent=0+40=40 ≤ 100  → initialBump = 0    (defter satırı YAZILMAZ)
T4  B: newCurrent=0+40=40 ≤ 100  → initialBump = 0    (defter satırı YAZILMAZ)
T5  A: updateMany{increment:40}  → cur=40 ; COMMIT
T6  B: updateMany{increment:40}  → cur=80 ; COMMIT     (satır kilidi burada işe yaramaz:
                                                        karar zaten T4'te verilmişti)
T7  C: (üçüncü parça, aynı bayat okumayla) → cur=120 > init=100, defterde HİÇ satır YOK
SONUÇ: currentQty(120) > initialQty(100) · TAMBUR_UNDO_RESTORE satırı 0
```
Sıralı koşumda (bugünkü bekçi) üçüncüsü `cur=80 → newCurrent=120 > 100 → bump=20` hesaplar, `initialQty` 120'ye çekilir ve deftere satır düşer. **Fark yalnız eşzamanlılıktan doğuyor.**

### S3c — Plan-sapma kapısı ‖ planlamacı "Rengi Değiştir" yapıyor

| # | Cevap |
|---|---|
| 1 | "Renk/en hedeften sapan top depoya ONAYLA iner" (2026-08-19) + her onaylı geçiş deftere yazılır |
| 2 | Kapı **tx DIŞINDA** koşuyor (`tambur.service.ts:710`, `:2733`, `:3130`); defter yazımı tx içinde |
| 3 | **EVET:** `wo.targetColorId` pre-tx okunuyor, tx içinde yalnız `status` taze okunuyor (`:935-938`, `:2794-2797`, `:3187-3190`) |
| 4 | WO satırı tx'te kilitli ama **kapı kilitten ÖNCE karar verdi** |
| 5 | — |
| 6 | ❌ yok |
| 7 | **EVET** → **S-3-04** |
| 8 | Plan-Sapma Karnesi eksik/yanlış; operatör hiç sorulmadan plan-dışı mal depoya iniyor |

**Çift onay / `confirmationId`:** İncelendi, **çift sayım YOK** — `finalize` idempotent erken dönüşü (`:658`) ve yarış-kaybı dalı (`:1289`) defter satırı yazmadan çıkıyor; `cutOpenFabric`'te replay `clientToken` P2002 ile tx'i geri sarıyor (`:2900-2901`). **Ama** per-cut modelde bir imza N `confirmationId` üretiyor → **S-3-08** (metrik şişmesi).

### S3d — İki planlamacı aynı iş emrini "Düzenle" ile açtı

| # | Cevap |
|---|---|
| 1 | İş emrinin planı ve sipariş bağları kaybolmadan güncellenir; `type` = bağın aynası |
| 2 | `update` PATCH-alan kapsamlı + kilitli (`:4773-4841`); `replace` PUT tam yeniden yazım + kilitli (`:5246-5563`) |
| 3 | Terminal statü için hayır (claim var). **Ama iyimser kilit hiç yok** |
| 4 | Claim yalnız `status` üzerinde; `updatedAt`/`version`/`If-Match` **hiçbir uçta yok** — `grep -rn "If-Match\|ETag\|expectedUpdatedAt\|expectedVersion" src/controllers src/routes src/middlewares` → **0 vuruş** |
| 5 | `replace` `orderLinks` + `targetProperties`'i **drop-and-recreate** ediyor (`:5502-5503`) |
| 6 | ❌ |
| 7 | **EVET** → **S-3-07** |
| 8 | B'nin az önce bağladığı sipariş sessizce silinir, iş emri "Stoğa Üretim"e düşer |

### S3e — Manuel taşıma ("Konumu Düzelt") ‖ tablet okutması

Top seviyesinde **korunuyor** (claim `{id in, status in MOVABLE_STATUSES, sackId:null, shipmentId:null}` `:599-610`, + tx içi taze `cutBlockedRollIds` `:632`). **Adım/WO seviyesinde korunmuyor** → **S-3-02**.

### S3f — Kapanış dispozisyonu sırasında sahada top okutuluyor

`completeWorkOrder`'ın "kapsam birebir" guard'ı (GUARD 2, `:3931-3943`) tx İÇİNDE ve **claim'den SONRA** taze okuyor — doğru desen. Ama claim yalnız `touchWorkOrderTx` alan yollarla serileşir; `tambur-undo` ve `manualMove` o kilidi almadığı için **GUARD 2'nin taze okuması onları göremez** → **S-3-02'nin üçüncü kurbanı**.

### S3g — "Boyahaneye geri gönder" ‖ fason sevk

`sendToDye` (`tambur-manual.service.ts:786-851`) **doğrudan `manualMove`'a delege ediyor** → S-3-02'yi miras alıyor. Ayrıca ileri-atlama backflush'ının `stillNeeded` yüklemi fasondaki malı hesaba katmıyor → **S-3-06**.

---

## 3. BULGULAR

### [S-3-01] `tambur-undo` iş emri satırını kilitlemiyor: eşzamanlı son-top finalize'ında iş emri KAPANIYOR ama adımda canlı top ve açık hareket kalıyor

| Şiddet | S1 | Kategori | A.1 | Öncelik | P1 | Modül | Üretim · Tambur geri alma | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Tambur "geri al" (tümden ya da tek-parça-iş-emrine) topu iş emrinin Tambur adımına **geri koyar**: statü `IN_PRODUCTION`, hareket yeniden açılır, adım `ACTIVE` olur. Bu iki fonksiyon, projedeki diğer **on bir** iş-emri yazma yolunun aksine `touchWorkOrderTx` ile iş emri satırını kilitlemez. Aynı iş emrinin *başka bir topunu* bitiren bir Tambur tableti tam o sırada son-top kapanışını çalıştırırsa, kapanış sayımı (`completeWorkOrderIfStepsDone`) geri konan topu **göremez** (READ COMMITTED, henüz commit edilmemiş) ve iş emrini `COMPLETED` yapar; refakat kartı da `COMPLETED`'a döner. Geri alma sonra commit eder ve WO'yu diriltmeye çalışan `updateMany WHERE status=COMPLETED` **kendi snapshot'ında WO'yu hâlâ IN_PROGRESS gördüğü için** hiçbir şey yapmaz. Sonuç: kapalı iş emrinde canlı top; kart kapalı olduğu için operatör okutamaz.

**Kanıt.**
- `Teks-Erp/src/services/helpers/roll-step.helper.ts:188-191` — sözleşme:
  ```ts
  /** … Çağıran tx başında touchWorkOrderTx ile WO'yu write-kilitlemeli (remainingSteps
   *  sayımı eşzamanlı finish/fason/finalize ile serileşsin). */
  export async function completeWorkOrderIfStepsDone(tx, workOrderId) {
    const remaining = await tx.workOrderStep.count({ where: { workOrderId, status: { notIn: [COMPLETED, SKIPPED] } } });
    if (remaining !== 0) return;
    await tx.workOrder.updateMany({ where: { id: workOrderId, status: { notIn: [...] } }, data: { status: COMPLETED } });
    await setWorkOrderCardStatuses(tx, workOrderId, "ACTIVE", "COMPLETED");
  }
  ```
- `Teks-Erp/src/services/tambur.service.ts:931` — finalize kilidi ALIYOR: `await touchWorkOrderTx(tx, wo.id);` (yorumu: *"O-2 write-skew guard"*), `:1282` `await completeWorkOrderIfStepsDone(tx, wo.id);`
- `Teks-Erp/src/services/tambur-undo.service.ts:1221` (`applySingleRestore` tx açılışı) ve `:1434` (`applyFull` tx açılışı) — **ilk ifade `findUnique`, kilit YOK**.
- `Teks-Erp/src/services/tambur-undo.service.ts:1330-1346` / `:1563-1578` — parent `TAMBUR_CONSUMED → IN_PRODUCTION`, `currentStepId = stepId`.
- `Teks-Erp/src/services/tambur-undo.service.ts:1306-1322` / `:1536-1551` — kapalı hareket yeniden açılıyor (`exitedAt: null`) ya da yenisi yaratılıyor.
- `Teks-Erp/src/services/tambur-undo.service.ts:1376-1386` / `:1667-1677` — `recomputeStepStatus` + geç dirilme denemesi:
  ```ts
  const woRevived = await tx.workOrder.updateMany({
    where: { id: step.workOrder.id, status: WorkOrderStatus.COMPLETED },
    data: { status: WorkOrderStatus.IN_PROGRESS },
  });
  ```
- **Koruma yok teyidi (altı kaynak da arandı):** advisory lock yok (`grep -n "pg_advisory" tambur-undo.service.ts` → 0); `isolationLevel` verilmemiş (kodda tek kullanım `shipping.service.ts:2610`); WO satırına dolaylı kilit de yok — `ensureWorkOrderInProgress` (`roll-step.helper.ts:180-183`) `WHERE status=PLANNED`, geç dirilme `WHERE status=COMPLETED`; ikisi de o an eşleşmediği için PG **hiçbir satırı kilitlemez**; DB kısıtı olarak yalnız `roll_movements_one_open_per_roll_step_uq` var ve o **hareket** tekilliğini korur, WO kapanışını değil.
- Kardeşler bu kilidi ALIYOR: `subcontractor.service.ts:1041` yorumu tam bu arızayı anlatıyor — *"mal hâlâ fasondayken WO/refakat kartı yanlışlıkla COMPLETED'a kaçar"*.

**Çakışma senaryosu.**
```
Ön koşul: İE-x, tek Tambur adımı, iki canlı top A ve B. A az önce finalize edildi
          (TAMBUR_CONSUMED + çocuklar), B hâlâ adımda (açık hareket). WO IN_PROGRESS.

T1  Süpervizör (masaüstü) : applyFull(A)  → tx başlar. KİLİT ALMAZ.
T2  T1                    : A → IN_PRODUCTION @ adım, hareket exitedAt=null, adım ACTIVE
                            (hepsi COMMIT EDİLMEMİŞ)
T3  T1                    : updateMany{ id: wo, status: COMPLETED } → count 0 (WO IN_PROGRESS)
                            ⇒ WO satırına kilit ALINMADI
T4  Operatör (tablet)     : finalize(B) → tx başlar, touchWorkOrderTx(wo) SORUNSUZ geçer
T5  T4                    : B tüketilir, hareketi kapanır
T6  T4                    : recomputeStepStatus → openCount 0 (T2 görünmez) → adım COMPLETED
T7  T4                    : completeWorkOrderIfStepsDone → remaining 0 → WO COMPLETED
                            + refakat kartı ACTIVE→COMPLETED ; COMMIT
T8  T1                    : COMMIT

SONUÇ: WorkOrder.status = COMPLETED · TravelerCard.status = COMPLETED
       Roll A = IN_PRODUCTION, currentStepId = Tambur adımı, exitedAt=null hareket
       WorkOrderStep = COMPLETED (T6'nın yazımı) ⇒ test_consistency §20 ihlali
```
> Ters sıra (T1 önce commit) **sağlıklıdır**: geri almanın `WHERE status=COMPLETED` dirilticisi tutar. Bozulan tek şey aradaki sıradır — bu, kilidin var olma sebebinin birebir tanımıdır.

**failure_mode.** İE2508260012 iki toplu. Operatör A'yı yanlış kalitede bitirdi, süpervizör masaüstünden "Tümden Geri Al" diyor; aynı saniyede tablet B'yi bitiriyor. İş emri "Tamamlandı"ya düşüyor, refakat kartı kapanıyor. A topu 100 m'sini geri alıyor ama artık **hiçbir tabletten okutulamıyor** (`tambur.service.ts:473` — kart `ACTIVE` değilse 400) ve iş emri panelinde "tamamlandı" göründüğü için kimse aramıyor. Kurtarma yalnız elle "Konumu Düzelt" ya da DB müdahalesi ile mümkün.

**Veride fiili ihlal (K2).** **Aranmadı — dev/saha DB'sine bu oturumda erişilemedi** (bkz. §0). Aranacak sorgu hazır:
```sql
SELECT w.id, w."workOrderNumber", w.status, s.status AS step_status,
       COUNT(r.id) FILTER (WHERE r.status='IN_PRODUCTION') AS canli_top,
       COUNT(m.id) FILTER (WHERE m."exitedAt" IS NULL)     AS acik_hareket
FROM work_orders w
JOIN work_order_steps s   ON s."workOrderId" = w.id
LEFT JOIN rolls r         ON r."currentStepId" = s.id AND r.status='IN_PRODUCTION'
LEFT JOIN roll_movements m ON m."workOrderStepId" = s.id AND m."exitedAt" IS NULL
WHERE w.status = 'COMPLETED'
GROUP BY w.id, w."workOrderNumber", w.status, s.status
HAVING COUNT(r.id) FILTER (WHERE r.status='IN_PRODUCTION') > 0
    OR COUNT(m.id) FILTER (WHERE m."exitedAt" IS NULL) > 0;
```
Ön koşulun sahada var olduğu Tur 2'de ölçüldü: **92 iptal edilmiş kesim çocuğu (4.327,2 m)** → geri alma yolu aktif kullanımda (V1-35).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-3-02.ts` (yazıldı, tip kontrolünden geçti). 10 paralel tur + 1 sıralı referans turu; ölçüm commit sonrası DB'den; fixture damgalı, `finally` temizlikli. **Koşturulamadı** — `audit/repro/S-3-02.log` bağlantı hatasını taşıyor.

**İş etkisi.** Üretimde: mal "kayıp" olur (kapalı iş emrinde, okutulamaz kartla). Raporda: iş emri tamamlanmış görünürken üretim çıktısı eksik; `test_consistency §20` kalıcı kırmızıya bir satır daha eklenir (Tur 2 · BULGU-T2-025 zaten bunun bayat bir örneğini kaydediyor, teşhis "sorgunun kör noktası" idi — bu yol o kırmızıyı **gerçek** bir bozulmayla doldurur ve iki sebep birbirine karışır). Depoda: geri konan metraj ne stokta ne üretimde sayılır.

**Öneri (2. tur için).**
1. `applySingleRestore` ve `applyFull` tx'lerinin **İLK ifadesi** `await touchWorkOrderTx(tx, step.workOrder.id)` olsun (adım çözüldükten hemen sonra; depo-kesimi dalında `stepId === null` olduğu için atlanır). Sıra load-bearing: `findUnique`'lerden sonra alınan kilit TOCTOU'yu kapatmaz.
2. Aynı dokunuşta `applySingle`'ın canlı-parent dalı da (`:1124`) kilit altına alınmalı — bkz. S-3-03.
3. Kilit alındıktan sonra WO statüsü **kilit altında taze** okunup CANCELLED/SUPERSEDED kontrolü tekrarlanmalı (`tambur.service.ts:935-944` deseni) — bu aynı zamanda `BULGU-T1-003`'ün senaryosunu da kapatır.
4. Migration/izin/APK **gerekmez**; yalnız backend. Geri alma yolu: iki satırlık ekleme, geri alınması `git revert`.

**Kabul kriteri.** `audit_repro_S-3-02.ts` 10/10 turda `broken=0` verir **ve** negatif sonda: `touchWorkOrderTx` satırı kaldırılınca script kırmızı döner. Ayrıca `test_consistency`'ye "COMPLETED WO'da açık hareket / canlı top" bölümü eklenir.

**Efor.** 0,5 gün (kod) + 0,5 gün (bekçi + negatif sonda).

**Önceki defter.** `BULGU-T1-003` (ayakta) — **aynı kilit eksiği, FARKLI senaryo**: o kayıt iş emri **iptaliyle** yarışı ve SKIPPED adıma düşmeyi anlatıyor; bu bulgu **kapanış phantom'unu** (COMPLETED WO + canlı top + kapalı kart) belgeliyor ve düzeltme aynı iki satır olduğu için ikisi tek düzeltmeyle kapanır (`related`).

---

### [S-3-02] "Konumu Düzelt" / "Boyahaneye Geri Gönder" iş emri satırını kilitlemiyor: kapanış sayımını ve kapanış dispozisyonunun "kapsam birebir" guard'ını deliyor

| Şiddet | S1 | Kategori | A.1 | Öncelik | P1 | Modül | Üretim · manuel taşıma | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `manualMove` topu hedef adıma taşır, **açık hareket yaratır**, ara adımları `SKIPPED` damgalar, hedef-sonrası `SKIPPED`'leri `PENDING`'e açar, `recomputeStepStatus` koşturur ve gerekirse `COMPLETED` iş emrini diriltir — yani iş emrinin durum makinesine **kapsamlı** yazar. Buna rağmen iş emri satırını hiç kilitlemez. Aynı kilit boşluğu `sendToDye`'a ("Boyahaneye Geri Gönder") aynen miras kalır, çünkü o uç doğrudan `manualMove`'a delege eder. Üç eşzamanlı karşı-taraf etkilenir: (a) `tambur.finalize`/`kursunFinish` son-top kapanışı → S-3-01'in aynısı, (b) `completeWorkOrder`'ın "kapsam birebir" guard'ı, (c) fason `dispatch`/`receive`.

**Kanıt.**
- `Teks-Erp/src/services/workorder-manual-move.service.ts:595-597` — tx açılışı, kilit yok:
  ```ts
  const result = await withBarcodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const claim = await tx.roll.updateMany({ where: { id: { in: selectedIds }, status: { in: MOVABLE_STATUSES }, … } });
  ```
- `:651-660` `rollMovement.createMany` (açık hareket) · `:785-795` adım → `SKIPPED` · `:801-804` `SKIPPED` → `PENDING` · `:813` `recomputeStepStatus` · `:814-823` `ensureWorkOrderInProgress` + `COMPLETED → IN_PROGRESS`.
- `grep -n "touchWorkOrderTx" workorder-manual-move.service.ts` → **0 vuruş**.
- `Teks-Erp/src/services/tambur-manual.service.ts:800-806` — `sendToDye` → `this.moveService.manualMove(...)`; uç `routes/tambur.routes.ts:565-570` (`roll:manual-adjust` ∨ `mobile:tambur-duzelt`).
- `Teks-Erp/src/services/workorder.service.ts:3866-3877` — `completeWorkOrder`'ın claim'i (WO kilidi) ve `:3888-3903` GUARD 2'nin beslendiği `inFlight` okuması; `:3931-3943` *"tx içinde TAZE okunan in-flight küme ile gönderilen dispozisyonlar birebir örtüşmeli"*. Bu tazelik yalnız **aynı kilidi alan** yollara karşı gerçektir.
- `Teks-Erp/src/services/subcontractor.service.ts:1041` — fason sevk kilidi alır; taze adım okumasını (`:1064-1071`) o kilide dayandırır.
- Koruma yok teyidi: advisory lock yok, izolasyon yükseltmesi yok, `Roll` claim'i (`:599-610`) yalnız TOP satırlarını kilitler; adım/WO satırlarına kilit yalnız durum gerçekten değiştiğinde ve o da **tx'in sonunda** alınır.

**Çakışma senaryosu (kapanış dispozisyonu varyantı — S3f).**
```
Ön koşul: İE-y, Kurşun adımı ACTIVE (top R1), Tambur adımı ACTIVE (top R2). WO IN_PROGRESS.

T1  Tablet  : sendToDye(R2)  → manualMove tx başlar. WO KİLİDİ ALINMAZ.
T2  T1      : R2 → boya adımına, açık hareket, adım ACTIVE   (COMMIT EDİLMEMİŞ)
T3  Büro    : completeWorkOrder(İE-y, dispositions:[R1]) → claim WO satırını kilitler (geçer)
T4  T3      : inFlight = rolls WHERE currentStepId IN stepIds AND status IN (...)  → yalnız R1
              (R2'nin yeni konumu görünmez; ama R2 ESKİ konumuyla da görünmez —
               T2'nin `currentStepId` yazımı commit edilmediği için ESKİ satır okunur ⇒ R2 GÖRÜNÜR)
T5  T3      : GUARD 2: inFlight.length(2) !== dispositions.length(1) → 400 "liste değişti"
              — ya da R2'nin eski adımı kapsam dışıysa (fason adımı) inFlight=1 ⇒ GUARD 2 GEÇER
T6  T3      : WO COMPLETED, kalan adımlar SKIPPED, kart COMPLETED ; COMMIT
T7  T1      : COMMIT → R2 IN_PRODUCTION, boya adımında AÇIK hareket

SONUÇ: COMPLETED iş emrinde, SKIPPED bir adımda, açık hareketli canlı top.
       `recomputeStepStatus` SKIPPED'e dokunmaz ⇒ adım sonsuza dek SKIPPED kalır.
```

**failure_mode.** Vardiya sonunda büro İE-y'yi kapatıyor (bir top için "Bitmiş Depo" dispozisyonu). Aynı anda Tambur operatörü ikinci topu "Boyahaneye Geri Gönder" ile boya adımına alıyor. İş emri kapanıyor; boyahaneye gitmesi gereken 240 m'lik top, kapalı bir iş emrinin atlanmış adımında, açık hareketle kalıyor. Fason Sevk ekranı o topu iş emri kapalı olduğu için listelemiyor; "Bitmiş Depo"da da yok. Mal fiziksel olarak rafta duruyor ve sistemde hiçbir çalışma listesinde görünmüyor.

**Veride fiili ihlal (K2).** Aranmadı — DB erişilemedi (§0). Tur 2, `MANUAL_MOVE_OUT` notlu kapanmış hareketlerin sahada var olduğunu ölçtü (V1-21), yani yol koşuyor.

**Repro (K3).** S-3-01 ile aynı sınıf; `audit_repro_S-3-02.ts` bugün `applyFull` kolunu ölçüyor. `manualMove` kolu için aynı iskelet `undo.applyUndo(...)` yerine `moveService.manualMove(...)` çağrısıyla genişletilebilir (script içindeki `runRound` tek satır değişikliğiyle parametrik hale gelir). Bu oturumda koşturulamadı.

**İş etkisi.** Üretimde kayıp mal + kapanmış iş emrinde açık WIP; fason planlamasında görünmez metraj; `test_consistency §20` kirlenmesi; kapanış dispozisyonunun "yıkıcı işlemde somut liste" ilkesi fiilen delinir (operatör onaylamadığı bir topu kapalı iş emrinde bırakmış olur).

**Öneri (2. tur için).** `manualMove`'un `$transaction` gövdesinin **ilk ifadesi** `await touchWorkOrderTx(tx, workOrderId)` olsun (roll claim'inden ÖNCE — kilit sırası WO→roll, kardeşlerle tutarlı; `tambur.service.ts:931` yorumu bu sırayı zaten kural olarak yazıyor, ters sıra ABBA riski üretir). `sendToDye` ayrıca düzeltme gerektirmez (delege). Migration/izin/APK yok.

**Kabul kriteri.** Genişletilmiş repro 10/10 temiz; negatif sonda kilit satırı silinince kırmızı. `test_workorder_manual_move`'a "eşzamanlı kapanış" bölümü.

**Efor.** 0,5 gün.

**Önceki defter.** `BULGU-T1-004` (ayakta) — o kayıt `manualMove`'un **WO statüsünü tx dışında okumasını** (iptal edilmiş iş emrine canlı top bağlanması) anlatıyor. Bu bulgu **kapanış/dispozisyon yarışını** anlatıyor; ikisi de aynı iki satırlık düzeltmeyle (kilit + kilit altında taze statü) kapanır.

---

### [S-3-03] Tek parça geri almanın aşım koruması okuma ile yazma arasında duruyor: iki kardeş parça aynı anda geri alınırsa `currentQty > initialQty` SESSİZCE doğuyor, sapma defterine satır düşmüyor

| Şiddet | S2 | Kategori | A.1 | Öncelik | P1 | Modül | Üretim · Tambur geri alma · sapma defteri | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** 2026-08-22'de canlı dala eklenen aşım koruması (`initialBump`), kaynağın `currentQty`/`initialQty`'sini **kilitsiz** okuyup kararı orada veriyor; satır kilidi ise ancak sonraki `updateMany`'de alınıyor. `increment` DB tarafında biriktiği için, aynı kaynağın iki (ya da daha fazla) kardeş çocuğu **paralel** geri alınırsa hepsi aynı bayat `currentQty`'yi okur, hepsi `bump = 0` hesaplar ve toplam yine `initialQty`'yi aşar — üstelik bu kez **deftere hiç satır düşmeden**. Yani düzeltmenin kapattığı sessiz sapma, eşzamanlılık altında aynen geri gelir.

**Kanıt.**
- `Teks-Erp/src/services/tambur-undo.service.ts:1124-1149`:
  ```ts
  const parentRow = await tx.roll.findUnique({ where: { id: parentId }, select: { initialQty: true, currentQty: true } });
  const parentInitial = parentRow?.initialQty ?? new Prisma.Decimal(0);
  const newCurrent   = (parentRow?.currentQty ?? new Prisma.Decimal(0)).plus(len);
  const initialBump  = newCurrent.greaterThan(parentInitial) ? newCurrent.minus(parentInitial) : new Prisma.Decimal(0);
  if (initialBump.greaterThan(0)) { await recordVarianceTx(tx, { … kind: OVERAGE, source: TAMBUR_UNDO_RESTORE … }); }
  const claimed = await tx.roll.updateMany({
    where: { id: parentId, status: RollStatus.IN_PRODUCTION, currentStepId: child.producedInStepId },
    data: { currentQty: { increment: len }, ...(initialBump.greaterThan(0) ? { initialQty: { increment: initialBump } } : {}) },
  });
  ```
  → `initialBump` **claim'in argümanı**; claim'in `WHERE`'i onu doğrulamıyor (`currentQty` koşulu YOK).
- Aynı desen ikizi: `:1288-1303` (`applySingleRestore`) — orada kaynak `TAMBUR_CONSUMED` olduğu için tek kazanan vardır (`:1330-1349` claim) ⇒ **o dal korunuyor**; kırık olan yalnız canlı-parent dalı.
- Ön koşul canlı: `tambur.overQuantityEnabled` sahada **true** (satır yok → varsayılan `system-setting.service.ts:2615`), Tur 2 · V-4 §0.1.
- DB seddi yok: `CHECK (currentQty <= initialQty)` hiçbir migration'da yok (Tur 1 `BULGU-T1-044`).
- **Bekçinin kör noktası:** `Teks-Erp/scripts/test_tambur_undo.ts` §11 tam bu fixture'ı kurar (100 m, 40+40+40) ama undo'ları `for (const kid of s11Kids) await undo.applyUndo(...)` ile **SIRALI** koşar. Sıralı koşumda üçüncü çağrı taze `cur=80` okur, `bump=20` hesaplar, defter satırı düşer ve bekçi yeşil kalır.

**Çakışma senaryosu.** §2 · S3b'deki çizelge (T1…T7).

**failure_mode.** 100 m kayıtlı açık kumaş, operatör 40+40+40 kesiyor (aşım bayrağı açık, kesim anında 20 m `OVERAGE` yazılıyor). Yanlış kesim fark ediliyor; operatör üç parçayı arka arkaya "geri al" ile iptal ediyor — tabletin çevrimdışı kuyruğu bunları **paralel** boşaltıyor (belgelenmiş desen: 2026-08-04'te 46 ms içinde 5 yazma). Kaynak top `currentQty = 120`, `initialQty = 100` olarak kalıyor; `roll_variances`'ta `TAMBUR_UNDO_RESTORE` satırı **yok**. `test_consistency §13` kırmızıya döner ve — Tur 2 · `BULGU-T2-025`'in tarif ettiği "kırmızı körlüğü" yüzünden — bilinçli bırakılmış 2 eski satırın yanına karışıp fark edilmez.

**Veride fiili ihlal (K2).** Aranmadı (DB erişilemedi). **Ama sınıfın canlıda tezahür ettiği Tur 2'de ölçüldü:** §13 ihlali olan 2 satırın ikisinde de `TAMBUR_UNDO_REOPEN` hareketi var (V1-02). Bugünkü kod sıralı yolda o hatayı kapattığına göre, aynı satırların bir daha doğması için kalan tek yol **eşzamanlılıktır**.

**Repro (K3).** `Teks-Erp/scripts/audit_repro_S-3-01.ts` — sıralı referans turu + 10 paralel tur, ölçüm commit sonrası DB'den, bayrağa DOKUNULMAZ (yalnız okunur; kapalıysa script kendini durdurur). **Koşturulamadı**, `audit/repro/S-3-01.log`.

**İş etkisi.** Fabrikanın aşım/fire karnesi eksik kalır (gerçekten fazla ölçülen metraj hiçbir yere yazılmaz), stok "imkânsız" bir satır taşır (giren 100, elde 120) ve mutabakat kapısı sürekli kırmızı kalıp güvenilirliğini yitirir.

**Öneri (2. tur için).**
1. Kararı yazımın **içine** al: `updateMany`'yi iki adıma böl — önce koşulsuz `increment` + `RETURNING`, sonra taze `currentQty > initialQty` ise `initialQty`'yi çek ve defter satırını yaz; ya da tek ham SQL ile `UPDATE rolls SET "currentQty"="currentQty"+$1, "initialQty"=GREATEST("initialQty","currentQty"+$1) … RETURNING` + farkı deftere yaz.
2. Alternatif (daha küçük dokunuş): `applySingle` tx'inin başında kaynağı `SELECT … FOR UPDATE` ile kilitle (`$queryRaw`), sonra bugünkü hesap aynen kalsın.
3. `test_tambur_undo §11`'e **paralel** ikiz ekle (`Promise.allSettled`) — bekçinin bugünkü kör noktası tam burası.
4. Uzun vade: `CHECK (currentQty <= initialQty)` DB seddi — **ama** Tur 2 · V-1-01'in uyardığı gibi ÖNCE depo kesiminin `initialQty` düşürmesi düzeltilmelidir, aksi hâlde sed meşru yolları kırar. `[PROD'DA ÇALIŞTIRMA]` — migration; geri alma: `DROP CONSTRAINT`.

**Kabul kriteri.** `audit_repro_S-3-01.ts` 10/10 turda ihlal 0; negatif sonda: hesap eski (kilitsiz) hâline döndürülünce script kırmızı.

**Efor.** 0,5 gün (kod) + 0,5 gün (bekçi).

**Önceki defter.** `BULGU-T1-044` (ayakta — DB seddi eksikliği) ve Tur 2 `V1-02` (veri ölçümü). Bu bulgu ikisinin **eşzamanlılık kolunu** açıyor: kod düzeltmesi 2026-08-22'de yapıldı ama yalnız sıralı yolda geçerli.

---

### [S-3-04] Plan-sapma kapısı hedefi transaction DIŞINDA okuyor: planlamacı araya girerse ya soru hiç sorulmadan plan-dışı mal depoya iner ya da geçersiz bir sapma deftere yazılır

| Şiddet | S2 | Kategori | A.1 | Öncelik | P2 | Modül | Üretim · plan-sapma defteri | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** 2026-08-19 kararının tamamı şudur: *"Renk/en hedeften sapan top depoya ONAYLA iner"* ve her onaylı geçiş `RollPlanDeviation` defterine yazılır. Kapı (`assertRollMatchesPlan`) **bilinçli olarak tx dışında** koşuyor (kilit süresini uzatmamak için) ve karşılaştırdığı `targetColorId`/`width` değerleri de tx'ten önce okunmuş. Transaction açıldığında iş emri satırı kilitleniyor ama **yalnız `status` taze okunuyor**. Aynı sorunun kardeş yolu olan fason kabul, tam tersini yapıyor: hedef rengi **kilit altında taze** okuyor ve istemcinin gördüğü değerle karşılaştırıp `409 TARGET_COLOR_CHANGED` veriyor. Tambur'un üç kapısında bu koruma yok.

**Kanıt.**
- `Teks-Erp/src/services/tambur.service.ts:710-716` (finalize), `:2733-2743` (cutOpenFabric), `:3130-3140` (finalizeOpenFabric) — kapı, **pre-tx okunmuş** `wo.targetColorId` / `wo.width` ile çağrılıyor.
- Tx içi taze okuma yalnız statü: `:935-938`, `:2794-2797`, `:3187-3190` → hepsi `select: { status: true }`.
- Kardeş yol doğru yapıyor — `Teks-Erp/src/services/subcontractor.service.ts:2693-2713`:
  ```ts
  const freshWo = await tx.workOrder.findUnique({ where: { id: data.workOrderId }, select: { targetColorId: true, … } });
  if (data.expectedTargetColorId !== undefined && (data.expectedTargetColorId ?? null) !== freshTargetColorId) {
    throw AppError.conflict(`İş emrinin hedef rengi bu arada değişti …`, { code: "TARGET_COLOR_CHANGED", … });
  }
  ```
- Yazan taraf: `Teks-Erp/src/services/workorder-link.service.ts:563-576` — "Rengi Değiştir" hiçbir transaction açmaz, tek ifadelik CAS ile yazar:
  ```ts
  const claim = await prisma.workOrder.updateMany({
    where: { id: workOrderId, status: { notIn: PLAN_CHANGE_FROZEN_STATUSES }, targetColorId: wo.targetColorId },
    data: { targetColorId: colorId },
  });
  ```
  Bu ifade WO satırını yalnız **kendi süresince** kilitler; Tambur'un pre-tx penceresine rahatlıkla girer. `workorder.service.ts:4794-4797` ("Düzenle" yolu) da aynı rengi kilit altında yazar — ama kilidi Tambur'un kapı okumasından SONRA alır.
- Koruma yok teyidi: `assertRollMatchesPlan` (`helpers/tambur-plan-gate.helper.ts:65-151`) `tx` parametresi **almıyor**, global `prisma` ile okuyor (`:77-79`, `:87-96`); `recordPlanDeviationTx` yalnız çağıranın verdiği `mismatches`'i yazıyor (`:183`), yeniden ölçmüyor.

**Çakışma senaryosu.**
```
Ön koşul: İE-z hedef renk = KIRMIZI. Tambur'daki R topu KIRMIZI (uyumlu).

T1  Tablet    : finalize(R) → roll.findUnique + wo.targetColorId = KIRMIZI okunur
T2  Tablet    : assertRollMatchesPlan → sapma YOK ⇒ soru sorulmaz, defter satırı yok
T3  Planlamacı: "Rengi Değiştir" → KIRMIZI → MAVİ ; tek ifade, COMMIT
T4  Tablet    : tx açılır, touchWorkOrderTx, freshWo.status = IN_PROGRESS (renk OKUNMAZ)
T5  Tablet    : çocuklar KIRMIZI olarak WAREHOUSE'a iner ; COMMIT

SONUÇ: plan MAVİ diyor, depoya KIRMIZI indi; operatöre hiç sorulmadı,
       RollPlanDeviation'a satır yazılmadı ⇒ Plan-Sapma Karnesi bu geçişi HİÇ görmüyor.
(Simetrik ters vaka: sapma varken planlamacı rengi topunkine çevirirse, artık
 geçerli olmayan bir sapma deftere yazılır ve karne olmayan bir ihlali raporlar.)
```

**failure_mode.** Planlamacı müşteri talebi üzerine İE-z'nin rengini EKRU'ya çeviriyor. Tam o saniyede Tambur operatörü elindeki KIRMIZI topu bitiriyor. 480 m KIRMIZI kumaş "plana uygun" damgasıyla Bitmiş Depo'ya iniyor; onay modalı hiç çıkmıyor, Plan-Sapma Karnesi'nde satır yok. Sevkiyat aşamasında müşteri EKRU beklerken KIRMIZI çuval çıkıyor ve sistemde bunun ne zaman/kim tarafından kararlaştırıldığını gösteren tek bir kayıt bulunmuyor.

**Veride fiili ihlal (K2).** Aranmadı (DB erişilemedi). Aranacak sorgu: `system_logs` içinde `event='TARGET_COLOR_CHANGED'` satırının zaman damgası ile aynı iş emrinin `roll_plan_deviations`/`rolls.finalizedAt` damgaları arasındaki ±5 sn'lik çakışmalar.

**Repro (K3).** Bu bulgu için repro yazılmadı (repro bütçesi en güçlü iki adaya ayrıldı — sözleşme 2-4 aday der). Deterministik sonda mümkündür: `assertRollMatchesPlan` çağrısından sonra `changeTargetColor` çağrılıp ardından `finalize` tx'i tamamlanır.

**İş etkisi.** Plan-Sapma Karnesi'nin (2026-08-19'da tam da audit'in arşivlenmesi yüzünden kurulan kalıcı defter) eksik/yanlış olması; "operatör bir kez imzalar" güvencesinin sessizce atlanması; müşteri şikâyetinde izlenebilirlik kaybı.

**Öneri (2. tur için).**
1. `assertRollMatchesPlan`'a **opsiyonel `tx` parametresi** ekle ve üç Tambur yolunda kapıyı **kilitten SONRA, tx İÇİNDE** ikinci kez koştur (pre-tx çağrı UX fast-fail olarak kalır — `computeWorkOrderLocks`'un `workorder.service.ts:4675 ↔ 4779` deseninin birebir aynısı).
2. Ya da minimum dokunuş: tx içindeki `freshWo` select'ine `targetColorId, width` ekle ve pre-tx değerden farklıysa `409 PLAN_TARGET_CHANGED` ver (fason kabulün `TARGET_COLOR_CHANGED` sözleşmesiyle **aynı kodu** kullan — istemci onu zaten tanıyor).
3. Migration/izin/APK gerekmez; (2) seçilirse eski APK'lar da 409'u genel hata olarak gösterir (kabul edilebilir), (1) tamamen sunucu içidir.

**Kabul kriteri.** Bekçi: kapı geçtikten sonra hedef renk değiştirilir → finalize ya 409 verir ya da defterde doğru sapma satırı oluşur; negatif sonda: tx içi kontrol kaldırılınca kırmızı.

**Efor.** 1 gün.

**Önceki defter.** Yok (yeni). İlgili: `BULGU-T1-081` (rota kapsaması sorusunun üç farklı cevabı) — aynı "kardeş yollar ayrışmış" ailesinden.

---

### [S-3-05] `finalize`'ın idempotency'si KİMLİK TAŞIMIYOR: başka bir yolun kapattığı topta "zaten tamamlandı" + `success:true` döner, operatörün kesim/kalite kararları sessizce kaybolur ve tablet YABANCI çocuklara etiket basar

| Şiddet | S2 | Kategori | B.3 | Öncelik | P2 | Modül | Üretim · Tambur finalize · etiket | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `finalize` idempotency'sini yalnız **durum** üzerine kuruyor: parent `TAMBUR_CONSUMED` ise "zaten tamamlanmış (idempotent retry)" diyerek `success: true` dönüyor. İstek gövdesinde hiçbir kimlik yok — `finalizeSchema`'da `clientToken` **bulunmuyor** (kardeşleri `cutOpenFabric` ve `cutWarehouseRoll` `clientToken` taşıyor ve P2002 tabanlı, kimlik-doğrulamalı idempotency kullanıyor). Sonuç iki yönlü: (a) topu **başka bir yol/başka bir tablet** kapattıysa, bu operatörün girdiği `cuts[]` (uzunluklar + kalite kodları + `relatedErrorIds`), `foldType` ve `markedForKartela` **hiç yazılmadan** başarı cevabı döner; (b) yanıt, o topun **başka bir operasyona ait** çocuklarını `splitRolls` olarak döndürür ve mobil ekran onları doğrudan yazıcı kuyruğuna verir.

**Kanıt.**
- `Teks-Erp/src/controllers/tambur.controller.ts:29-70` — `finalizeSchema`: `rollId`, `cuts`, `decisions`, `foldType`, `markedForKartela`, `confirmMismatch`. **`clientToken` YOK.**
- `Teks-Erp/src/services/tambur.service.ts:658-660`:
  ```ts
  if (roll.status === RollStatus.TAMBUR_CONSUMED) { return buildIdempotentResponse(); }
  ```
- `:612-656` — `buildIdempotentResponse` çocukları `TAMBUR_PROCESSED` metadata'sındaki `childRollIds`'ten çözüyor; **yoksa** `{ parentRollId, entrySource: TAMBUR_SPLIT }` fallback'ine düşüyor (`:635-640`). Yorumun kendisi tehlikeyi yazıyor: *"parent'ın önceki cutOpenFabric çocukları dahil edilirse istemci retry'de onlara mükerrer etiket basar"*.
- **Fallback gerçekten tetiklenebilir:** `finalizeOpenFabric`'in yazdığı `TAMBUR_PROCESSED` metadata'sında `childRollIds` **yok** (`tambur.service.ts:3354-3364` — `finalizedAt`, `remainingAction`, `remainingChildId`, `remainingQty`, `notes`, fold alanları). Aynı topu `finalizeOpenFabric` kapattıysa, `finalize`'ın idempotent cevabı **tüm** `TAMBUR_SPLIT` çocuklara düşer.
- İstemci gerçekten basıyor: `mobil/src/screens/Modules/Tambur/TamburScreen.tsx:1213-1214`
  ```ts
  const splitRolls = data?.splitRolls ?? [];
  if (splitRolls.length > 0) setPendingPrintRolls(splitRolls);
  ```
- Beceri §8 karşılığı: *"En pahalı hata: … `success: true` + o kaydın kimliğini dönmek — kullanıcı 'eklendi' görür"*. Burada varyantı: kullanıcı "kesildi" görür, kesim yoktur.

**Çakışma senaryosu.**
```
Ön koşul: R topu Tambur adımında, iki tablet aynı iş emrinin kartını okutmuş.

T1  Tablet-1: finalizeOpenFabric(R, remainingAction:"keep_1kalite") → R = TAMBUR_CONSUMED
              TAMBUR_PROCESSED.metadata = { remainingChildId, … }   (childRollIds YOK)
T2  Tablet-2: operatör 3 kesim girmiş (60 m 1.KALITE · 25 m A1 · 15 m FIRE), "Bitir"e basar
T3  Tablet-2: finalize(R, cuts:[3 kesim]) → :658 ön-kontrol → TAMBUR_CONSUMED
T4  Tablet-2: buildIdempotentResponse → childRollIds YOK → fallback:
              parent'ın TÜM TAMBUR_SPLIT çocukları (önceki cutOpenFabric kesimleri dahil)
T5  Tablet-2: HTTP 200 { success:true, message:"Tambur zaten tamamlanmış (idempotent retry)." ,
                          splitRolls:[C1,C2,C3,…] }
T6  Tablet-2: setPendingPrintRolls(C1..Cn) → zaten etiketli topların etiketi TEKRAR basılır

SONUÇ: 3 kesim ve kalite kararı hiç yazılmadı (operatör başarı gördü);
       fiziksel toplarda İKİ etiket; A1/FIRE ayrımı kaybedildi.
```

**failure_mode.** Tambur'da iki tablet aynı iş emrinde çalışıyor. Biri "Bitir" ile açık kumaşı kapatıyor, diğeri kart üzerinden 3 kesimli kalite kararını gönderiyor. İkincisi yeşil onay alıyor ve elindeki üç fiziksel parçayı depoya gönderiyor — sistemde o parçalar **yok**; onun yerine tek bir "kalan" topu var ve ekrandan çıkan etiketler başka topların ikinci kopyaları. Depoda barkodu iki topa yapışmış etiket dolaşıyor.

**Veride fiili ihlal (K2).** Aranmadı (DB erişilemedi). Aranacak: aynı `rollId` için `LABEL_PRINT_EVENT` audit satırlarında aynı çocuk barkodunun kısa aralıkla iki kez basılması; Tur 2 ölçümü `LABEL_PRINT_EVENT` 2.557 satır olduğunu söylüyor (V-4), yani kaynak var.

**Repro (K3).** Yazılmadı (repro bütçesi §0'daki iki adaya ayrıldı). Deterministik: `finalizeOpenFabric` → `finalize` **sıralı** çağrısıyla bile üretilir; eşzamanlılık gerekmez.

**İş etkisi.** Kalite kararı kaybı (A1/FIRE ayrımı yapılmamış mal satılabilir stoğa iner) + mükerrer fiziksel etiket + operatörün sisteme güveninin kaybı ("yeşil dedi ama yok").

**Öneri (2. tur için).**
1. `finalizeSchema`'ya `clientToken` (uuid, opsiyonel) ekle; `TAMBUR_PROCESSED.metadata`'ya yaz. `buildIdempotentResponse` yalnız **aynı token** için `success` dönsün; token farklı ya da yoksa `409` + net mesaj ("bu top başka bir işlemle kapatıldı, listeyi yenileyin"). Eski APK'lar token göndermez → o durumda 409 (fail-closed) doğru cevaptır; `minVersion` değerlendirmesi gerekir (bkz. `Teks-Erp/CLAUDE.md` tetik tablosu).
2. Minimum dokunuş (APK'sız): fallback dalını **kaldır** — `childRollIds` yoksa `splitRolls: []` dön ve mesajı "bu top başka bir işlemle kapatılmış" yap. Yabancı çocuklara etiket basılması böylece imkânsızlaşır; kesim kaybı hâlâ sessiz kalır ama en pahalı yarısı kapanır.
3. `finalizeOpenFabric`'in metadata'sına da `childRollIds` yazılsın (tek kaynak).

**Kabul kriteri.** `finalizeOpenFabric` → `finalize` sırasında ikinci çağrı 409 döner ve `splitRolls` boş gelir; bekçi: `test_tambur_cut_idempotency.ts`'e "farklı yol kapattı" bölümü.

**Efor.** 1 gün (madde 2 için 0,5 gün).

**Önceki defter.** Yok. İlgili: `BULGU-T1-146` (`finalizeWarehouseCut` yorumunun idempotency mekanizmasının tersini anlatması) — aynı ailenin dokümantasyon kolu.

---

### [S-3-06] Manuel ileri-atlamanın "atlanan adımı SKIPPED yap" mantığı, fasondaki malı görmez: mal dışarıdayken adım atlanır ve iş emri OTOMATİK kapanır

| Şiddet | S2 | Kategori | E — Üretim · durum makinesi | Öncelik | P2 | Modül | Üretim · manuel taşıma ↔ fason | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `manualMove` ileri-atlamada, atlanan ara adımların "artık kimseye gerek yok mu" sorusunu `stillNeeded` sayımıyla çözüyor: *bu adıma henüz girmemiş, hâlâ üretimde bir top kaldı mı?* Sorgu, adıma **hareketi olan** topları dışlıyor (`NOT: { movements: { some: { workOrderStepId: s.id } } }`). Fasona sevk edilmiş top o adımda **hareket açtığı için** dışlanıyor — yani mal fiziksel olarak boyahanedeyken `stillNeeded = 0` çıkıyor ve adım `SKIPPED` damgalanıyor. `recomputeStepStatus` `SKIPPED`'e dokunmadığı için (`roll-step.helper.ts:47`), adım o hâlde kalır ve `completeWorkOrderIfStepsDone` — **sadece adım statülerine bakıp topun statüsüne HİÇ bakmaz** — iş emrini `COMPLETED` yapar.

**Kanıt.**
- `Teks-Erp/src/services/workorder-manual-move.service.ts:766-795`:
  ```ts
  const stillNeeded = await tx.roll.count({
    where: {
      id: { notIn: selectedIds },
      status: { in: [IN_PRODUCTION, AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR] },
      movements: { some: { step: { workOrderId } } },
      NOT: { movements: { some: { workOrderStepId: s.id } } },   // ⇐ fasondaki top BURADA elenir
      currentStep: { stepSequence: { lte: s.stepSequence } },
    },
  });
  if (stillNeeded === 0) skippedStepIds.push(s.id);
  …
  await tx.workOrderStep.updateMany({
    where: { id: { in: skippedStepIds }, status: { in: [PENDING, ACTIVE] } },   // ⇐ ACTIVE adım da SKIP edilir
    data: { status: SKIPPED, skipReason: `MANUAL_MOVE_BACKFLUSH: …` },
  });
  ```
- Fason sevk adıma hareket açıyor: `Teks-Erp/src/services/subcontractor.service.ts:580` (`tx.rollMovement.create`).
- `completeWorkOrderIfStepsDone` topun statüsüne bakmaz: `roll-step.helper.ts:197-202` yalnız `workOrderStep.status` sayar.
- Manuel kapatma yolu bunu **bilerek** engelliyor (`workorder.service.ts:3905-3912` GUARD 1: *"top fasonda (fiziksel olarak dışarıda) — iş emri kapatılamaz"*), yani kural sistemde YAZILI; otomatik kapanış yolunda karşılığı yok.
- Kilit eksikliği (S-3-02) bunu ayrıca **yarışa** açıyor: `dispatch` WO satırını kilitleyip `stepFresh.status`'u taze okuyor (`subcontractor.service.ts:1064-1071`) ama `manualMove` o kilidi almadığı için, sevk taze okumayı yaptıktan sonra `manualMove` adımı `SKIPPED` yapabilir.

**Çakışma senaryosu.**
```
Ön koşul: İE-w rotası: [1 Kurşun] → [2 Boyahane(fason)] → [3 Tambur].
          Parti-A (3 top) fasonda (AT_SUBCONTRACTOR, adım-2'de açık hareket).
          Parti-B (2 top) Kurşun'da (adım-1).

T1  Planlamacı: manualMove(Parti-B, target = adım-3 Tambur, "boyalı geldi")
T2            : intermediate = [adım-2]
T3            : stillNeeded(adım-2) → Parti-A elenir (adım-2'de hareketi VAR) ⇒ 0
T4            : adım-2 (ACTIVE) → SKIPPED  "MANUAL_MOVE_BACKFLUSH: boyalı geldi"
T5  Tambur    : Parti-B bitirilir → adım-3 COMPLETED
T6            : completeWorkOrderIfStepsDone → adım-1 COMPLETED, adım-2 SKIPPED,
                adım-3 COMPLETED ⇒ remaining 0 ⇒ WO COMPLETED, kart COMPLETED

SONUÇ: 3 top hâlâ boyahanede (AT_SUBCONTRACTOR) ama iş emri KAPALI.
       Fason kabul ekranı kapalı WO'da çalışamaz; kart okutulamaz.
```

**failure_mode.** Planlamacı, dışarıdan boyalı gelen ikinci partiyi boyahane adımını atlayarak Tambur'a alıyor. Boyahanede duran birinci partinin adımı sessizce "atlandı" damgası yiyor; parti Tambur'da bitince iş emri kapanıyor. Üç hafta sonra boyahaneden 3 top dönüyor ve kabul edilecek açık iş emri yok — mal ne fasonda görünüyor (`stillAtSubcontractor` sayımları kapalı WO'yu listelemiyor) ne depoda.

**Veride fiili ihlal (K2).** Aranmadı (DB erişilemedi). Aranacak sorgu:
```sql
SELECT w."workOrderNumber", s."stepSequence", s.status, s."skipReason", COUNT(r.id)
FROM work_order_steps s
JOIN work_orders w ON w.id = s."workOrderId"
JOIN roll_movements m ON m."workOrderStepId" = s.id
JOIN rolls r ON r.id = m."rollId" AND r.status IN ('AT_SUBCONTRACTOR','RETURNED_FROM_SUBCONTRACTOR')
WHERE s.status = 'SKIPPED'
GROUP BY 1,2,3,4;
```

**İş etkisi.** Fasondaki mal muhasebe ve planlama yüzeylerinin hepsinden düşer; fason karnesi eksik; iş emri kapandığı için kabul yapılamaz ve kurtarma elle taşımayla mümkün olur. Tur 2 · V-3'te zaten "3 gündür boyahanede görünüyor ama fabrikada duruyor" sınıfından bir kayıp ölçülmüş — bu yol ters yönünü üretir.

**Öneri (2. tur için).**
1. `stillNeeded` yüklemine **veya** koşulu ekle: adımda **açık hareket** (`exitedAt IS NULL`) ya da `AT_SUBCONTRACTOR`/`RETURNED_FROM_SUBCONTRACTOR` statülü top varsa adım **asla** SKIP edilmesin. Tek satırlık ikinci sayım yeterli:
   ```ts
   const liveAtStep = await tx.rollMovement.count({ where: { workOrderStepId: s.id, exitedAt: null } });
   if (stillNeeded === 0 && liveAtStep === 0) skippedStepIds.push(s.id);
   ```
2. `updateMany`'nin `status: { in: [PENDING, ACTIVE] }` filtresini `[PENDING]`'e daraltmak da düşünülmeli — `ACTIVE` "orada iş var" demektir.
3. `completeWorkOrderIfStepsDone`'a ikinci hat: kapatmadan önce iş emrinin `AT_SUBCONTRACTOR` topu var mı diye bak (manuel kapatmanın GUARD 1'i ile aynı kural, tek kaynak).
4. S-3-02'nin kilidi ayrıca gereklidir (yarış kolunu kapatır). Migration/izin/APK yok.

**Kabul kriteri.** Fasonda topu olan adım, ileri-atlamada SKIP edilmez; bekçi `test_workorder_manual_move` + negatif sonda (koşul kaldırılınca kırmızı).

**Efor.** 1 gün.

**Önceki defter.** İlgili: `BULGU-T1-041` (fason adım/WO kapanışı `recomputeStepStatus`'u atlıyor) — aynı "adım statüsü ile fiziksel gerçek ayrışıyor" ailesi, farklı kapı.

---

### [S-3-07] İş emri "Düzenle"de iyimser kilit yok: ikinci kaydeden planlamacı, birincinin az önce bağladığı siparişi SESSİZCE siler ve iş emri "Stoğa Üretim"e düşer

| Şiddet | S2 | Kategori | A.2 | Öncelik | P2 | Modül | Planlama · iş emri | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `PUT /api/work-orders/:id` (`replace`) iş emrinin `orderLinks` ve `targetProperties` satırlarını **silip istemcinin gövdesinden yeniden yaratıyor**. Sistemde hiçbir iyimser kilit yok (`If-Match` / `ETag` / `expectedUpdatedAt` / `version` grep'i controller+route+middleware'de **0 vuruş**); tek koruma terminal statü claim'i. İki planlamacı formu farklı anlarda açtığında ikinci kaydeden, birincinin arada yaptığı **sipariş bağlama** işlemini geri alır — ve `type` alanı bağdan türetildiği için iş emri "Siparişe Özel"den "Stoğa Üretim"e düşer. Hiçbir hata, hiçbir uyarı üretilmez.

**Kanıt.**
- `Teks-Erp/src/services/workorder.service.ts:5502-5503`:
  ```ts
  await tx.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } });
  await tx.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } });
  ```
  ardından `:5525-5541` yalnız gövdedeki `allocations`/`targetPropertyIds` yeniden yaratılır.
- `:5062-5066` — `type` bağdan türer: `if (type === "ORDER_PRODUCTION" && allocations.length === 0) throw 400`; ters yön (`STOCK_PRODUCTION` + bağ yok) **sessizce geçer**.
- `:5263-5270` — tx claim'i yalnız `status: { notIn: [COMPLETED, CANCELLED, SUPERSEDED] }`; `updatedAt`/`version` karşılaştırması yok.
- `grep -rn "If-Match\|if-match\|ETag\|etag\|expectedUpdatedAt\|expectedVersion" Teks-Erp/src/controllers Teks-Erp/src/routes Teks-Erp/src/middlewares` → **0 vuruş**.
- Uç açık: `routes/workorder.routes.ts:450` `router.put("/:id", verifyToken, requireAnyPermission("workorder:write","mobile:hizli-is-emri"), controller.replace)`.
- Bağ kurma yolu ayrı ve atomik: `workorder-link.service.linkOrderLines` (tip aynasını aynı tx'te yazar) — yani B'nin işi doğru yapılmış, A'nın PUT'u onu ezer.
- `[VARSAYIM]` Electron "Düzenle" formunun PUT'a mı PATCH'e mi bastığı bu denetimde doğrulanmadı; PATCH kullanılıyorsa kayıp yalnız gönderilen alanlarla sınırlıdır, `orderLinks` silinmez. Bulgunun sunucu tarafındaki açığı her iki durumda da geçerlidir (uç herkese açık).

**Çakışma senaryosu.**
```
T1  Planlamacı-A: İE-k "Düzenle" formunu açar (o an: bağ YOK, type = STOCK_PRODUCTION)
T2  Planlamacı-B: Siparişler ekranından İE-k'yı SIP0812260007 kalemine bağlar
                  → orderLinks 1 satır, type = ORDER_PRODUCTION  (atomik, doğru)
T3  Planlamacı-A: formda yalnız hedef metrajı 800 → 950 yapıp KAYDET (PUT, bayat gövde)
T4  replace      : deleteMany(orderLinks) ⇒ B'nin bağı SİLİNİR
                   allocations = []  ⇒ type = STOCK_PRODUCTION, hata YOK
T5              : 200 OK, "İş emri güncellendi"

SONUÇ: sipariş bağı yok oldu, iş emri Stoğa Üretim'e döndü, hedef metraj 950.
       B hiçbir bildirim almadı; audit'te yalnız A'nın UPDATE satırı var.
```

**failure_mode.** Sipariş karşılama raporu (`getCoverageForLines`) o siparişi "hiç üretim planlanmamış" sayar; müşteri siparişi açık kalır, üretilen mal stoğa yazılır ve sevkiyat aşamasında hangi siparişe yazılacağı elle çözülmek zorunda kalır. `TravelerCard` `contentDirty` işaretlenir ama kartın sipariş tablosu artık boştur — sahaya inen kâğıt da siparişsiz basılır.

**Veride fiili ihlal (K2).** Aranmadı (DB erişilemedi). Aranacak: `system_logs` içinde aynı `recordId` (WORK_ORDER) için 60 sn içinde iki farklı `userId`'den `UPDATE`; ve `WORK_ORDER` audit'inde `type: ORDER_PRODUCTION → STOCK_PRODUCTION` geçişleri.

**İş etkisi.** Sipariş görünürlüğü paketinin (2026-08-27) tüm rapor yüzeyleri yanlışlanır; "iş emri tipi = bağın aynası" invariantı (2026-08-21) sessizce bozulur.

**Öneri (2. tur için).**
1. `replace` gövdesine **`expectedUpdatedAt`** (ya da `version`) ekle; claim'in `WHERE`'ine koy → uyuşmazsa `409 STALE_FORM` + "iş emri bu sırada değişti, yenileyin". `update` (PATCH) için de aynı alan **opsiyonel** olarak kabul edilsin (gönderilirse zorlanır).
2. Ara çözüm (istemci değişikliği gerektirmez): `replace`, `orderLinks`'i **drop-and-recreate yerine diff** ile uygulasın; gövdede hiç `orderLineIds` alanı **gelmediyse** mevcut bağlara DOKUNMASIN (PATCH semantiği). Bugün "alan yok" ile "boş liste" ayrışmıyor.
3. `type` düşüşü (`ORDER_PRODUCTION → STOCK_PRODUCTION`) audit'te ayrı bir olay olarak yazılsın.
4. Migration yok; (1) istemci sürümü ister → `minVersion` değerlendirmesi.

**Kabul kriteri.** Bayat gövdeli PUT 409 döner; bekçi: bağ kur → bayat PUT → bağ hâlâ duruyor.

**Efor.** 1,5 gün (backend + Electron formu).

**Önceki defter.** Yok (yeni). İlgili: `BULGU-T1-100` (sipariş kalemi replace'inin WO bağını cascade ile silmesi) — aynı "drop-and-recreate sessiz kayıp" ailesi, ters yön.

---

### [S-3-08] Plan-sapma karnesinde "imza sayısı" kesim adedi kadar şişiyor — `confirmationId` bir imzayı değil bir yazma çağrısını sayıyor

| Şiddet | S3 | Kategori | E — rapor doğruluğu | Öncelik | P3 | Modül | Raporlar · Plan-Sapma Karnesi | Kanıt seviyesi | K1 |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `recordPlanDeviationTx` her çağrıda **yeni bir `confirmationId`** üretiyor ve rapor bu alanı "imza" olarak yorumluyor (`COUNT(DISTINCT confirmationId)` = *"kaç kez plan dışına çıkıldı"*). Per-cut modelde (`cutOpenFabric`) operatör bir topta sapmayı **bir kez** onaylar — istemci `confirmMismatch` bayrağını sonraki kesimlere kendisi taşır (helper başlığı, `tambur-plan-gate.helper.ts:19-24`) — ama her kesim ayrı bir `recordPlanDeviationTx` çağrısıdır, dolayısıyla **N kesim = N imza**. Metraj doğru kalır (her satırın `qtyM`'i kendi kesimidir), şişen şey "kaç kez" metriğidir.

**Kanıt.**
- `Teks-Erp/src/services/helpers/tambur-plan-gate.helper.ts:184` — `const confirmationId = randomUUID();` (çağrı başına).
- Aynı dosya `:161-164` — beyan: *"Satır granülerliği = onaylı kapı-geçişi × sapan alan; `confirmationId` tek geçişin satırlarını gruplar. Renk+en birlikte sapan top İKİ satır üretir ama BİR imzadır."*
- Aynı dosya `:19-22` — *"operatör bir topta sapmayı BİR KEZ onaylar; aynı topun sonraki kesim/bitirme istekleri `confirmMismatch: true` taşır"*.
- `Teks-Erp/src/services/tambur.service.ts:2902-2911` — `cutOpenFabric` HER kesimde `recordPlanDeviationTx` çağırıyor (`source: "cut"`, `childRollId: child.id`).
- `Teks-Erp/src/services/reports/plan-deviation-scorecard.report.service.ts:13-17, 181-188` — rapor semantiği:
  ```
  onay sayısı  = COUNT(DISTINCT "confirmationId")
  sapan metraj = confirmationId başına TEK qtyM'in toplamı
  ```
- Yani sayaç "operatörün kaç kez plan dışına çıkma kararı verdiği" değil, "kaç yazma çağrısı yapıldığı"dır. 6 parçaya kesilen bir top, tek bir onayla karneye **6 ihlal** yazar.

**failure_mode.** Renk sapan 300 m'lik top 6 kesime bölünüyor; operatör modalı bir kez onaylıyor. Plan-Sapma Karnesi ayı "6 kez plan dışına çıkıldı" diye kapatıyor; oysa bir karar verilmiş. Aynı ay içinde tek parça bırakılan başka bir sapan top "1" sayılıyor — yani metrik, sapmanın sıklığını değil **kesim alışkanlığını** ölçüyor ve iki vardiya karşılaştırılamaz hale geliyor.

**Veride fiili ihlal (K2).** Aranmadı (DB erişilemedi). Aranacak:
```sql
SELECT "rollId", COUNT(DISTINCT "confirmationId") AS imza, COUNT(*) AS satir
FROM roll_plan_deviations WHERE source = 'cut'
GROUP BY "rollId" HAVING COUNT(DISTINCT "confirmationId") > 1;
```

**İş etkisi.** Yalnız rapor; mal/stok etkisi yok. Ama karnenin kurulma amacı ("audit arşivleniyor, rapor kalıcı defterden okusun") tam da güvenilir bir sayım olduğu için, metriğin yanlış tanımlı olması kararı bozar.

**Öneri (2. tur için).** Ya (a) `confirmationId`'yi çağıranın verdiği bir **top+adım kapsamlı** deterministik anahtara çevir (aynı roll+step+field için mevcut satır varsa aynı id kullanılsın; `upsert` semantiği), ya (b) raporun "onay sayısı" metriğini `COUNT(DISTINCT rollId)` olarak yeniden tanımla ve `confirmationId`'yi yalnız metraj tekilleştirmesi için bırak. (b) migration istemez ve beyanla uyumludur. Karar ürün sahibinindir.

**Kabul kriteri.** 6 kesimli sapan top karnede "1 onay / 300 m" basar; bekçi `test_tambur_plan_gate`'e bölüm.

**Efor.** 0,5 gün.

**Önceki defter.** Yok (yeni).

---

## 4. Uygulanan kontrol listesi

Kaynak: `Teks-Erp/teks-erp-denetim-promptu-v2.md` Bölüm 3 (A: 224-388, E: 531-571) + Bölüm 4.1 (sekiz soru) + Bölüm 4.3 (senaryo turu).

| Madde | Durum |
|---|---|
| **A.1 Check-then-act** | **uygulandı** → S-3-01, S-3-02, S-3-03, S-3-04 |
| **A.2 Lost update (uygulamada hesaplanan alan / iyimser kilit)** | **uygulandı** → S-3-07 (`replace` drop-and-recreate); `update` PATCH-alan kapsamlı olduğu için ayrı bulgu yazılmadı |
| **A.3 Atomik claim sınıflandırması** | **uygulandı** → 9 `updateMany` sınıflandırıldı (S-3 alanında): `tambur.service:953` `{id,status,step}` claim ✅ · `tambur-undo:1073` çocuk claim ✅ · `:1143`/`:1157` parent claim ✅ ama argümanı bayat (S-3-03) · `:1330`/`:1563` parent dirilt claim ✅ · `manual-move:599` çoklu claim + `count!==length → 409` ✅ · `workorder:4806`/`:5263` terminal claim ✅ · `roll-step:180` idempotent temizlik (count gereksiz) · `workorder-locks:59` **saf kilit** (count anlamsız). Yanlış pozitif üretilmedi. |
| **A.4 Tx sınırı / bütçe** | **uygulandı** → finalize barkod rezervasyonunu bilinçli tx dışına almış (ölçüm yorumda: 1345 ms → 39 ms); tavan `cuts.max(200)`; bulgu YOK |
| **A.5 Çoklu instance** | **kapsam dışı** — TEK PROCESS invariantı belgeli (`ecosystem.config.js`); S-3 alanında in-memory durum yok |
| **A.6 Belge no / barkod üretimi** | **uygulandı, ihlal yok** → `roll_barcode_counters` `ON CONFLICT … n = n + count RETURNING` atomik; `reserveRollBarcodesInOrder` sıra koruyor; boşluk bilinçli |
| **A.7 AsyncLocalStorage / request context** | **kapsam dışı** — S-3 yollarında kullanılmıyor |
| **A.8 Cache invalidation ↔ commit sırası** | **uygulandı, dar** → S-3 yollarında yalnız `readTamburOverQuantityEnabled` (feature-flag cache) okunuyor; karar tx dışında ve idempotent → bulgu yok |
| **B.3 Idempotency / clientToken** | **uygulandı** → S-3-05 (`finalize`'da token YOK, durum tabanlı idempotency kimlik taşımıyor) |
| **E · Üretim: iş emri durum makinesi zorlanıyor mu, eşzamanlı durum değişikliği** | **uygulandı** → S-3-01, S-3-02, S-3-06 |
| **E · Üretim: üretim bildirimi + backflush tek tx mi** | **uygulandı, ihlal yok** → `finalize` tek tx; hareket kapanışı `qtyOut = qtyIn` (backflush) aynı tx'te |
| **E · Üretim: aynı bildirim iki kez girilebilir mi (el terminali)** | **uygulandı** → S-3-05 |
| **E · Stok: negatif/aşan metraj (`currentQty ≤ initialQty`)** | **uygulandı** → S-3-03 (dörtlü: kodda var ✓ · eşzamanlılıkta korunmuyor ✗ · DB kısıtı yok ✗ · veride 2 satır — Tur 2 ölçümü) |
| **E · Stok: sayım sırasında hareket girişi donduruluyor mu** | **uygulandı (analog: kapanış dispozisyonu)** → S-3-02 (GUARD 2 delinebiliyor) |
| **E · Yetki/onay: onaylanmış belge sonradan değişebiliyor mu** | **uygulandı** → S-3-04 (plan onayı bayat plana veriliyor); refakat kartı revizyonu için `markTravelerCardDirtyTx` her iki düzenleme yolunda da çağrılıyor, ihlal yok |
| **E · BOM / MRP / makine çakışması / FEFO / rezervasyon** | **kapsam dışı — N/A** (fabrikada karşılığı yok; `_FINDER-BRIEF` §E) |
| **E · Finans / dönem kapanışı / e-fatura** | **kapsam dışı — N/A** (ERP fatura kesmez) |
| **4.1 Sekiz soru** | **uygulandı** → §2'de yedi senaryonun her biri için tablolandı |
| **4.2 · madde 5 (üretim bildirimi + backflush)** | **uygulandı** |
| **4.2 · madde 6 (iş emri durum değişimi)** | **uygulandı** |
| **4.2 · madde 9 (belge numarası üretimi)** | **uygulandı, ihlal yok** |
| **4.3 "Üretim bildirimi tam olarak stok biterken geliyor"** | **uygulandı** → S3a/S3b |
| **4.3 "El terminali offline çalışıp senkronize ediyor"** | **uygulandı** → S-3-03 (paralel kuyruk boşalması), S-3-05 (replay) |
| **4.3 "MRP koşusu sürerken planlamacı BOM değiştiriyor"** | **uyarlandı** → "Tambur bitirirken planlamacı rengi/planı değiştiriyor" → S-3-04, S-3-07 |
| **4.3 "Sayım açıkken depoya mal giriyor"** | **uyarlandı** → "kapanış dispozisyonu sürerken adıma top geri konuyor" → S-3-02 |
| **4.3 "Pod restart bir `$transaction` ortasında"** | **kapsam dışı** — PM2 fork + `kill_timeout 8000`; tx atomik geri sarılır, S-3 alanında yarım-durum üreten tx-dışı yan etki yok (audit best-effort bilinçli) |
| **K2 (veride fiili ihlal)** | **UYGULANAMADI** — DB erişilemedi (§0). Her bulguda aranacak sorgu yazıldı. |
| **K3 (repro)** | **KISMİ** — 2 script yazıldı + tip kontrolünden geçti, koşturulamadı (§0) |

---

## 5. Doğru yapılanlar (korunması gereken kalıplar)

1. **"Herkes WO satırını kilitler" disiplini ve gerekçesinin YAZILI olması.** `workorder-locks.helper.ts` başlığı ve `subcontractor.service.ts:1037-1041` yorumu, kilidin **neden** var olduğunu ("mal hâlâ fasondayken WO/refakat kartı COMPLETED'a kaçar") somut arıza üzerinden anlatıyor. On bir yazma yolu bu disipline uyuyor; bulgularımın hepsi disiplinin kendisini değil, **üç istisnasını** hedefliyor. Disiplini zayıflatmayın — eksik üç yolu ona ekleyin.
2. **Tambur finalize'ın çok katmanlı yarış savunması.** Ön-kontrol (`:658`) + tx içi atomik claim (`:953`) + `count===0`'ın **iki farklı sonuca** ayrılması (idempotent dönüş ↔ 409) + **bayat metraj guard'ı** (`:981-989`, yorumu "O GUARD'I KALDIRMA" diye uyarıyor) + kilit altında taze WO statüsü. Bu, repodaki en olgun eşzamanlılık kodu; yeni yollar bunu şablon almalı.
3. **Barkod rezervasyonunun tx dışına alınması — ve kararın ÖLÇÜMLE belgelenmesi.** `roll-barcode.helper.ts:52-77` hem kazanımı (1345 ms → 39 ms) hem de yanlış "düzeltmenin" bedelini (havuz tükenmesi, 30 işlemden 3'ü) yazıyor ve kabul kriterini **iki koşullu** tanımlıyor. Bu, bir denetim bulgusunun nasıl kalıcılaştırılacağının örneği.
4. **`computeRestoredQty`'nin tek kaynak olması + "senkron sözleşmesi" notu.** `tambur-undo.service.ts:363-365`: *"buraya eklenen HER kaynak, applyFull 5b'deki tersleme süzgecine de eklenmek ZORUNDA"*. F0402 çift sayımı bu notla kapatılmış ve iki tarafın ayrışması mekanik olarak zorlaştırılmış. Eşzamanlılık tarafı da çocuk claim'i (`:1488-1498`) sayesinde korunuyor: iki paralel geri alma aynı çocuğu iki kez sayamaz.
5. **Fason kabulün "hedef renk kilit altında taze + `expectedTargetColorId`" çifti** (`subcontractor.service.ts:2685-2713`). Bu, S-3-04'ün istenen çözümünün zaten yazılmış hali; Tambur kapısına aynen taşınabilir.
6. **`roll_movements_one_open_per_roll_step_uq` partial unique'i.** Geri alma hareketi yeniden açarken ikinci bir açık hareket doğmasını DB seviyesinde engelliyor ve `test_db_invariants.ts:145` envanterinde kayıtlı. Şema-dışı nesnenin bekçiyle korunması bu projenin ayırt edici iyi alışkanlığı.
7. **Yıkıcı işlemde "somut liste" ilkesi.** `completeWorkOrder` GUARD 2 (`:3931-3943`) "N kayıt etkilenecek" demiyor, **birebir küme eşitliği** arıyor ve uyuşmazlıkta reddediyor. Kural doğru; eksik olan tek şey o taze okumanın kilitle korunmayan iki yola karşı savunmasız kalması.

---

## 6. Sınır ötesi notlar (kendi alanım dışında görülenler)

| Not | İlgili alan |
|---|---|
| **`workorder-link.changeTargetColor` hiç transaction açmıyor** (`workorder-link.service.ts:563-576`): CAS claim'i + `markTravelerCardDirtyTx` + audit **üç ayrı yazım**. CAS başarılı olup kart işaretlemesi düşerse kart bayat kalır. (Tur 1 `BULGU-T1-104` bunun bir kısmını yazmış.) | D — transaction sınırları |
| **`buildIdempotentResponse` tx dışında, üç ayrı sorguyla** çalışıyor (`tambur.service.ts:612-646`); aralarında yeni bir kesim commit ederse cevap tutarsız bir kesit döndürür. | D — transaction sınırları |
| **`test_tambur_undo.ts §11` sıralı koşuyor** ve tam da düzeltmenin en kırılgan yerinde eşzamanlılığı ölçmüyor — "bekçi hatayla aynı yerde kör" sınıfının yeni bir örneği. | K — test/bekçiler |
| **`completeWorkOrderIfStepsDone` topun statüsüne HİÇ bakmıyor**, yalnız adım statülerine. Manuel kapatma yolunda fason hard-block VAR, otomatik yolda YOK — aynı kural iki yerde farklı. | E — iş kuralı değişmezleri |
| **`recomputeStepStatus`'un `pendingRolls` sorgusu her çağrıda `roll.findMany` + iç `movements` select yapıyor** (`roll-step.helper.ts:96-120`); büyük iş emirlerinde her finalize'da koşuyor ve `roll_movements` milyona çıktığında sıcak yol olur. | H — performans |
| **`manualMove`'un `qcVoided` dalı** (`workorder-manual-move.service.ts:667-681`) hedef-sonrası tüm topların `qualityGrade`'ini `null`'a çekiyor — `updateMany` `selectedIds`'in TAMAMINA uygulanıyor, oysa `del.count > 0` yalnız bazılarında op silindiğini söyler. Kalite kararı gereksiz yere düşen top olabilir. | E / L |
| **`applySingle` arşiv dalı `reasonCode: "YANLIS_TOP"` sabitini gömüyor** (`tambur-undo.service.ts:1106`) — `ReasonPreset` kataloğundan doğrulanmıyor; katalogdan kaldırılırsa rapor anahtarı yetim kalır. | C / E |
| **`finalize` `cuts.max(200)` tavanı yorumla gerekçelendirilmiş ama `decisions` dizisinde tavan YOK** (`tambur.controller.ts:52-58`). | F — API |

---

## 7. KAPSANMAYAN / ERİŞİLEMEYEN

| Konu | Sebep |
|---|---|
| **K2 — dev ve saha DB sorguları** | Postgres.app kimlik doğrulama hatası (§0); `sql-dev.sh` / `sql-saha.sh` ikisi de bağlanamadı. Her bulguya aranacak SQL yazıldı. |
| **K3 — repro koşumu** | Aynı sebep. İki script yazıldı ve tip kontrolünden geçti; `audit/repro/S-3-01.log` ve `S-3-02.log` bağlantı hatasını taşıyor. |
| **S3c'nin deterministik reprosu** | Repro bütçesi (sözleşme: 2-4 aday) en güçlü iki adaya ayrıldı. |
| **`manualMove` kolunun reprosu** | `audit_repro_S-3-02.ts` bugün yalnız `applyFull` kolunu ölçüyor; `manualMove` kolu aynı iskeletle eklenebilir (fixture ortak). |
| **Electron "Düzenle" formunun PUT/PATCH tercihi** | Doğrulanmadı — S-3-07'de `[VARSAYIM]` olarak işaretlendi. Sunucu tarafındaki açık her iki durumda da geçerli. |
| **Mobil istemcinin `confirmMismatch` oturum hafızası** | Yalnız backend beyanından okundu (`tambur-plan-gate.helper.ts:19-24`); mobil kodda doğrulanmadı — S-3-08'in "operatör bir kez onaylar" öncülü bu beyana dayanıyor. |
| **`tambur.overQuantityEnabled`'ın canlı prod (yedek değil) değeri** | Canlı prod'a erişim yok; 2026-08-25 kopyasında satır olmadığı Tur 2'de ölçüldü → kod varsayılanı `true`. |
| **Kartela (Swatch) ve depo kesimi (`cutWarehouseRoll`) kolları** | Senaryo kapsamına alınmadı: Tur 2 ölçümü `preTamburCloseStatus` 0/116 → depo kesimi kapanışı sahada hiç kullanılmamış; kartela akışı S-3'ün senaryo listesinde yok. |
| **`test_consistency` canlıya karşı koşumu** | DB erişilemedi; §13/§20'nin bugünkü durumu Tur 2 raporundan alındı, yeniden ölçülmedi. |
