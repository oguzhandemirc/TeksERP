# DOĞRULAMA — BULGU-T1-011 (TUR 1, ③ sonrası)

> **Tambur geri almasıyla iptal edilen kesim çocuğu "İptali Geri Al" ile diriltilebiliyor — metrajı ebeveyne zaten iade edilmişti, ikinci kez canlanıyor**

| Alan | Değer |
|---|---|
| Şiddet (giriş → çıkış) | S1 → **S1** (yükseltme YOK — aşağıda gerekçe) |
| Kanıt seviyesi (giriş → çıkış) | K2 → **K3** |
| Karar | **doğrulandı** |
| Modül | ENV/ÜRE — top yaşam döngüsü |
| Ana dosya | `Teks-Erp/src/services/helpers/roll-cancel-restore.helper.ts:67-110` |
| K2 sorgu / sonuç | `audit/data/BULGU-T1-011.sql` · `audit/data/BULGU-T1-011.txt` |
| K3 script / log | `Teks-Erp/scripts/audit_repro_BULGU-T1-011.ts` · `audit/repro/BULGU-T1-011.log` |

---

## 1. Doğrulanan mekanizma (kod, salt-okunur)

Üç ayrı yerde `tambur-undo.service.ts` kesim çocuğunu **ham `updateMany`** ile iptal eder ve
yalnız `status` yazar — `preCancelStatus`/`cancelledAt`/`cancelledById` YAZILMAZ:

- `tambur-undo.service.ts:1073-1080` (`applySingle`) · `:1260-1267` (`applySingleRestore`) · `:1488-1495` (`applyFull`)
- Aynı tx içinde metraj kaynağa iade edilir: `:1130-1141` (`currentQty` + aşımda `initialQty` increment) / `:1160-1163` (depo kesimi dalı: ikisi birden).
- Çocuğun `currentQty`'si **sıfırlanmaz** — 40 m'lik parça `CANCELLED` satırında 40 m olarak durur.

`restoreCancelledRoll` (`inventory.service.ts:3397-3464`) engel yüklemini
`resolveRollRestoreBlockReason` (`helpers/roll-cancel-restore.helper.ts:67-110`) ile çözer.
Yüklemin **tam** sinyal listesi: `status · movementCount · operationCount · childCount ·
currentStepId · sackId/shipmentId · dispatchItemCount · kartelaItemCount`.
**`parentRollId` listede YOK** ve `batchId` engeli 2026-08-25'te bilerek kaldırılmıştır
(helper `:83-100` gerekçesi). Kesim çocuğunun hareketi, istasyon işlemi, çocuğu ve adım bağı
yoktur → yüklem `null` (= engel yok) döner.

`preCancelStatus` NULL olduğu için `resolveRestoreTargetStatus` (`:129-140`) **`STOCK`**'a düşer:
Bitmiş Depo'da doğmuş bir parça Ham Stok'a dirilir.

Ekran da bu kararı **ilan ediyor**: `inventory.service.buildCancelDiagnostics:2289-2317` aynı
yüklemi çağırıp barkod okutma yanıtına `canRestore: true` yazar → operatör "Geri Al" düğmesini
etkin görür. Uç yetkisi dar değil: `inventory.routes.ts:614-619`
`requireAnyPermission("roll:write", ...MOBILE_ROLL_CANCEL)` — süpervizör şartı yok.

---

## 2. K2 — veride fiili ihlale HAZIR küme (`sql-saha.sh` + `sql-dev.sh`)

Sorgu: `audit/data/BULGU-T1-011.sql` (6 bölüm) · Çıktı: `audit/data/BULGU-T1-011.txt`

| Ölçüm | SAHA (`tekserp_saha_0825`, prod 2026-08-25) | DEV (`adnansahin_db`) |
|---|---|---|
| `TAMBUR_UNDO*` audit olayı / çocuk iptal eden | 53 / 50 | 1.088 / 573 |
| **Undo ile iptal edilmiş + restore yüklemini GEÇEN çocuk** | **50 top · 1.834,800 m** | 20 top · 1.666,000 m |
| …bunlardan metrajı ebeveyne GERÇEKTEN iade edilmiş (`restoredTo=IN_PRODUCTION`) | **49 top · 1.819,800 m** (iade toplamı 1.819,8 m) | 14 top · 624,000 m |
| …`restoredTo=VARIANCE` (kaynak arşivde, metraj sapmaya yazıldı) | 0 | 4 top · 362,000 m |
| `preCancelStatus` NULL / `cancelledAt` NULL | 50 / 50 (%100) | 20 / 20 (%100) |
| **Audit-bağımsız üst sınır** (`parentRollId` dolu + yüklemi geçen) | **88 top · 3.629,200 m** | 38 top · 2.460,000 m |
| …hepsinde "iz yok" undo imzası (`cancelledAt`+`preCancelStatus` NULL) | **88 / 88** | 38 / 38 |
| Karşılaştırma: TÜM diriltilebilir iptaller | 215 top · 19.947,090 m (88'i kesim çocuğu) | 49 top · 4.329,000 m |

**Finder'ın rakamı düzeltildi:** finder dev'i `0` raporlamıştı; dev'de 1.088 undo olayı ve
20 hazır kayıt var. Ayrıca finder'ın 50/1.834,8 m'lik audit-tabanlı sayısı **alt sınırdır** —
`system_logs` 6 ayda arşivlendiği için (CLAUDE.md, `archive-scheduler`) audit'e bel bağlamayan
imza taraması (bölüm 6) saha'da **88 top / 3.629,2 m** veriyor. İmzanın geçerliliği:
`inventory.softDelete` iptali HER ZAMAN `cancelledAt`+`preCancelStatus` yazar; izsiz CANCELLED
satır ancak ham `updateMany` yollarından (tambur-undo ailesi) doğabilir — saha'daki 88 kesim
çocuğunun 88'i de izsiz.

**Örnek kayıtlar (saha, kişisel veri yok):**

| çocuk id (ilk 8) | barkod | qty | restoredTo | iade | ebeveyn (ilk 8) | ebeveyn statü | ebeveyn qty/initial |
|---|---|---|---|---|---|---|---|
| `1a62ffaa` | T210826F0025 | 40,000 | IN_PRODUCTION | 40 | `a8fc61d7` | TAMBUR_CONSUMED | 0,000 / 1304,000 |
| `9000c3f7` | T120826F0001 | 40,000 | IN_PRODUCTION | 40 | `e7eaa2a9` | TAMBUR_CONSUMED | 0,000 / 360,000 |
| `e3e3766b` | T200826F0117 | 40,000 | IN_PRODUCTION | 40 | `faa89e26` | TAMBUR_CONSUMED | 0,000 / 100,000 |
| `911b656e` | T200826F0087 | 9,700 | IN_PRODUCTION | 9,7 | `6d598b64` | TAMBUR_CONSUMED | 0,000 / 2570,000 |

⚠️ Bu satırlar ihlalin **ağırlaştırıcı** hâlini gösteriyor: ebeveynler bugün `TAMBUR_CONSUMED`
(0 m, arşivde) — yani iade edilen metraj çoktan başka parçalara/finalize'a akmış. Bugün bir
çocuk diriltilirse metraj hiçbir yerden düşülmez; saf hayalet stok doğar.

---

## 3. K3 — davranışsal repro (dev DB, 10 tekrar)

Sınıf yarış DEĞİL (eksik guard yüklemi) → sözleşme gereği **"tek istekle davranışsal kanıt"**;
determinizmi göstermek için 10 tur koşuldu.

Script: `Teks-Erp/scripts/audit_repro_BULGU-T1-011.ts` (devDbGuard + `AUDITREPRO-T1-011-<6>` damgası
+ `finally` temizliği; yazıcı/pg_dump/rclone çağrısı yok, feature-flag'e dokunulmadı).
Log: `audit/repro/BULGU-T1-011.log`

**Senaryo (her tur):** 100 m `WAREHOUSE` top → `tamburSvc.cutWarehouseRoll(40)` →
`tamburUndo.applyUndo(child)` (mod SINGLE) → `inventory.restoreCancelledRoll(child)`.

```
── TUR 1 ──
   kesim öncesi canlı metraj      : 100 m
   kesimden sonra (parent+çocuk)  : 100 m
   geri almadan sonra             : 100 m   (mod=SINGLE, iade=40 m)
   çocuk: status=CANCELLED qty=40 parentRollId=DOLU preCancelStatus=NULL cancelledAt=NULL
   okutma yüzeyi (barkod sorgusu) : canRestore=true blockReason=null
   restoreCancelledRoll           : KABUL ETTİ → çocuk statüsü STOCK
   "iptali geri al" sonrası       : 140 m   (FAZLA: 40 m)

=== ÖZET ===
Tekrar: 10 · Değişmez BOZULAN tur: 10 · Toplam hayalet metraj: 400 m
✅ 12 · ❌ 4
```

**Kırmızı veren dört kontrol (= bulgunun kendisi):**
1. `restoreCancelledRoll` 409 `RESTORE_BLOCKED` vermedi — **kabul etti**.
2. Çocuk iptalde kalmadı — statü **`STOCK`**.
3. Σ canlı metraj korunmadı — **+40 m** (100 → 140).
4. Çocuk `WAREHOUSE`'da doğmuştu, `STOCK`'a dirildi (yanlış raf; `preCancelStatus` NULL).

**Negatif sonda / kontrol grubu (§4, hepsi yeşil):** ebeveyni OLMAYAN, `softDelete` ile iptal
edilmiş bir top geri alınınca metraj **korunuyor** (100 → 100) ve doğru rafa (`WAREHOUSE`)
dönüyor. Yani repro "restore genel olarak bozuk" demiyor; ölçtüğü şey **kesim çocuğu ile
normal iptal arasındaki ayrımın yapılmaması**. Bu grup kırmızıya dönerse repro yanlış şeyi
ölçüyordur.

**Çıpa düzeltmesi (kendi kör noktam):** ilk koşumda §2 sondası `findRollByBarcode`'u restore'dan
SONRA çağırıyordu; statü artık `CANCELLED` olmadığı için `buildCancelDiagnostics` `null` dönüyor
ve sonda sessizce `undefined` ölçüyordu ("bekçi kör" yanılsaması). Sonda restore'dan ÖNCEYE
alındı → `canRestore=true, blockReason=null` ölçüldü.

**Temizlik doğrulandı:** koşum sonrası dev'de `AUDITREPRO-T1-011%` damgalı 0 top, 0 system_log.

---

## 4. Şiddet değerlendirmesi — S1'de KALIYOR (enflasyon yok)

S0'a çıkarılmadı, çünkü:
- **İhlal henüz OLUŞMAMIŞ.** Saha'da diriltilmiş bir kesim çocuğu YOK; ölçülen şey ihlale hazır
  88 kayıt / 3.629,2 m'lik pencere. K3 tetiklemesi dev'de, sentetik fixture üzerinde yapıldı.
- Tetikleyici **operatörün kasıtlı bir aksiyonu** (Arşiv'de topu bulup "İptali Geri Al").
  Arşiv sekmesi hâlâ `admin:settings` arkasında (CLAUDE.md 2026-08-25 ②b), yani günlük depo
  akışında karşılaşılan bir düğme değil.
- Mali/mevzuat etkisi yok; etki **tutarsız stok** (S1 tanımı).

Ama iki nedenle S2'ye de düşürülmedi: düzeltici **sessiz ve alarmsız** (hata yok, log yok,
`consistency-check`'te bölüm yok) ve ekran operatöre `canRestore:true` diyerek işlemi **davet
ediyor**.

---

## 5. İş etkisi

Diriltilen her parça için: Ham Stok'ta metraj **fazla** (aynı kumaş hem kaynak topun
soyağacında hem kendi satırında canlı); Ürün Dengesi'nde `malzemeAcigi` o kadar **eksik**
(CLAUDE.md 2026-08-27 3. tur); Stok Karnesi ↔ Envanter ↔ Kanban üçlüsü aynı yanlış sayıyı
basar (üçü de statüden türüyor, çelişki görünmez). Fiziksel karşılığı olmayan top üretime
bağlanıp iş emri açılırsa eksiklik ancak sahada, operatör "bu topu bulamıyorum" dediğinde
ortaya çıkar. Ayrıca parça yanlış rafa (Bitmiş Depo → Ham Stok) diriliyor.

---

## 6. Düzeltme şekli (2. tur için — bu denetimde UYGULANMADI)

1. `RollRestoreSignals`'a `parentRollId: string | null` ekle; `resolveRollRestoreBlockReason`'da
   `movementCount` kontrolünden sonra: parent varsa engel mesajı ("Bu top bir kesimin
   parçasıydı; metrajı kaynak topa iade edildi — geri alınamaz."). Yüklem saf kaldığı için
   birim testlenebilir; `buildCancelDiagnostics` + `restoreCancelledRoll` **aynı** yüklemi
   çağırdığından ekran ve uç kendiliğinden hizalı kalır.
2. Alternatif/tamamlayıcı: `tambur-undo` ailesinin üç `updateMany`'sine `cancelledAt` +
   `cancelReasonCode` (+ bilinçli olarak `preCancelStatus` **yazma**) ekleyip iptal izini
   doğru bırakmak — o zaman "izsiz CANCELLED" anomalisi de kapanır ve arşiv listesinde bu
   toplar sebepsiz görünmez.
3. `consistency-check-derived.sql`'e bölüm: "CANCELLED + `parentRollId` dolu + `currentQty>0`
   olan top DİRİLTİLMİŞ mi" (statü CANCELLED değil ama undo audit'i var) — sessiz kalmasın.
4. **[PROD'DA ÇALIŞTIRMA]** Geçmiş veri düzeltmesi GEREKMEZ: saha'da diriltilmiş kayıt yok;
   88 satır `CANCELLED` olarak doğru duruyor. Toplu UPDATE önerilmez.

**Kabul kriteri:** repro script'i (`audit_repro_BULGU-T1-011.ts`) düzeltmeden sonra
10/10 turda YEŞİL — `restoreCancelledRoll` 409 verir, Σ metraj 100 m'de kalır — ve §4
kontrol grubu YEŞİL kalır (meşru geri alma bozulmamış). **Efor:** ~0,5 gün.

---

## 7. KAPSANMAYAN / ERİŞİLEMEYEN

- **Canlı prod**'a erişim yok; ölçümler 2026-08-25 kopyası üzerinde. Kopyadan bugüne yeni
  undo yapılmışsa pencere büyümüş olabilir.
- `applyFull` dalının çok-toplu iptali repro'da tetiklenmedi (SINGLE dalı ölçüldü); kod
  aynı ham `updateMany` desenini kullanıyor (`:1488-1495`) ve saha'da bu daldan gelen 1 satır
  (`restoredTo` yok, 15 m) yüklemi geçiyor — dal farkı sonucu değiştirmiyor.
- `parentArchived` (VARIANCE) dalı: metraj kaynağa dönmediği için hayalet doğmaz, ama
  `RECORD_CORRECTION` sapma satırı "bu kumaş yoktu" derken topun dirilmesi defteri yalanlar.
  Dev'de 4 böyle kayıt var; ayrı bir alt-vaka olarak 2. tura bırakıldı.
- Electron/mobil arayüzünde düğmenin fiilen çizildiği doğrulanmadı (SALT-OKUNUR denetim,
  uygulama çalıştırılmadı); backend `canRestore:true` döndürdüğü ölçüldü —
  `Electron/src/pages/Operations/Rolls/service.ts:247` ve `mobil/src/services/roll.service.ts:212`
  ucu çağırıyor.

## SINIR ÖTESİ NOTLAR

- **(→ Veri modeli / tutarlılık ajanı)** `tambur-undo` ailesinin ham `updateMany data:{status: CANCELLED}`
  yazımı, `inventory.softDelete`'in yazdığı iptal izini (`cancelledAt`, `cancelledById`,
  `cancelReason`, `preCancelStatus`) atlıyor. Saha'da bunun imzası 88 satır. Bu yalnız bu bulgunun
  değil, "Arşiv sekmesinde iptal sebebi boş" sınıfının da kaynağı olabilir.
- **(→ Gözlemlenebilirlik ajanı)** `consistency-check.sql` / `consistency-check-derived.sql`
  ailesinde "iptali geri alınmış top" için bölüm yok; §13'ün ölçtüğü `currentQty > initialQty`
  invariantı bu ihlali GÖRMEZ (çocuk kendi initialQty'siyle tutarlı dirilir).
