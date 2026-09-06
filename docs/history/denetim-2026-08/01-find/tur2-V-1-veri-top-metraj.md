# TUR 2 · V-1 — Veri merkezli denetim: top / metraj / kesim / tambur geri alma

**Aşama:** ② BULMA — TUR 2 (mercek: **veri merkezli**). **Tarih:** 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` · Denetçi: V-1.
**Yöntem:** önce prod kopyasında (`audit/tools/sql-saha.sh` → `tekserp_saha_0825`, 2026-08-25 yedeği, 190/195 migration) ve dev'de (`sql-dev.sh` → `adnansahin_db`) **ihlal arandı**; ihlal bulunan her satır `rolls`/`roll_movements`/`roll_operations`/`roll_variances`/`system_logs` izleri üzerinden **kodda geriye doğru** izlendi (K4 yazma yolları matrisi + K10 değişmez envanteri).
**Kapsam (alanım):** `rolls`, `roll_movements`, `roll_operations`, `roll_variances`, `roll_plan_deviations`, `roll_errors`, `batches`.
**Salt-okunur:** `Teks-Erp/`, `prisma/`, `Electron/`, `mobil/` altında hiçbir dosya değiştirilmedi; DB oturumları `default_transaction_read_only=on`. Yazılan tek dosya bu rapordur (ara SQL'ler oturum scratchpad'inde).
**Veri hacmi:** saha 2.431 top · 1.107 hareket · 1.586 operasyon · 75 sapma · 3 hata kaydı · 198 parti. Dev 296 / 87 / 67 / 36 / 3 / 599 (test kalıntılı).

> **Tur 1 ile ilişki:** `tours/tur1-seen.json` (168 kayıt, 145 ayakta) okundu; aynı bulgu **tekrar yazılmadı**. Veride fiili ihlal getirdiğim yerlerde ilgili Tur 1 id'si `Önceki defter` satırındadır. Tur 1 çürütücülerinin 17 önerisinden alanıma düşen ikisi (T1-032 → damgasız toplar · T1-072 → dönem kararlılığı) kanıtlanıp bulguya çevrildi; kalanlar başka alanlara aittir (Sınır ötesi notlar).

---

## 0. Bulgu özeti

| id | Şiddet | Başlık | Kanıt |
|---|---|---|---|
| V-1-01 | S3 | Depo kesimi `initialQty`'yi yeniden yazıyor → kesim aritmetiği geriye dönük **denetlenemez**; 8 soyağacında 185,7 m izini kaybediyor, mutabakat sorgusu 2 sahte "defterlenmemiş aşım" alarmı üretiyor | K2 |
| V-1-02 | S2 | Aynı yeniden-yazım "Tümden Geri Al"da **olmayan bir AŞIM** yazdırıyor: sapma defterine kesilen metraj kadar sahte `OVERAGE` düşer | K1 |
| V-1-03 | S2 | Sevk edilen **7.200,6 m** hiçbir sipariş satırına yazılmadı; 5 sevkiyat (81 top / 3.040,2 m) tamamen defter dışı, 7 kalem hâlâ "0 sevk / 3.700 m açık" — mutabakat sorgusu bunu **göremiyor** (dairesel) | K2 |
| V-1-04 | S3 | Parti no sarması: **61 numarada aynı anda İKİ AÇIK parti**, 10 numara iki açık fason sevkinde — kararın dayandığı "eski parti kapanmış olur" varsayımı sahada geçersiz | K2 |
| V-1-05 | S3 | `finalizedAt`/`statusChangedAt` topun `createdAt`'inden **ÖNCE** (saha 955/409, dev 61/100): damga tx başlangıcından, `createdAt` istemci saatinden — gün sınırında dönem kaymasına açık | K2 |
| V-1-06 | S3 | Damgasız 4 final top (359 m) **hiçbir dönemin** Kalite/Fire Karnesi'nde yok; onarım scripti sahada hiç koşmamış | K2 |
| V-1-07 | S3 | Kapanmış dönem geriye dönük değişiyor: Temmuz'da finalize edilen 4 top (698 m) Ağustos'ta iptal edildi → Temmuz karnesi sessizce 698 m düştü | K2 |

---

## 1. Veri sağlık taraması — koşulan HER sorgu (ihlal 0 olanlar dahil)

Sonuçlar 2026-08-28 koşumundan. "Saha" = `tekserp_saha_0825`, "Dev" = `adnansahin_db` (test kalıntısı taşır, karşılaştırma amaçlı).

| # | Değişmez / kontrol | Saha | Dev | Yorum |
|---|---|---|---|---|
| V1-01 | `currentQty < 0 ∨ initialQty < 0` | **0** | 0 | DB CHECK (`rolls_currentQty_nonneg`) tutuyor |
| V1-02 | `currentQty > initialQty` (§13) | **2** | 0 | Bilinçli bırakılmış 2 eski satır (CLAUDE.md 2026-08-22) — Tur 1 `BULGU-T1-044`. **Kök neden izlendi:** ikisinin de `TAMBUR_UNDO_REOPEN` hareketi var → tambur-undo yolu doğrulandı, yeni bulgu yok |
| V1-03 | `initialQty = 0` olan top | 8 | 2 | 6'sı `TAMBUR_SPLIT`, 1 `TAMBUR_MANUAL`, 1 `MANUAL_ENTRY` → **V-1-01** |
| V1-04 | `initialQty=0` parent'ın tüketilmiş çocuğu var | **8** | 2 | K10 H-3'ün genişletilmiş hâli (K10 yalnız 2 gördü, süzgeç dardı) → **V-1-01** |
| V1-05 | Kesim çocuk toplamı > parent `initialQty` ∧ `OVERAGE` defteri yok | **2** | — | İkisi de **sahte alarm**: parent `initialQty`'si depo kesiminde sıfırlanmış (V-1-01). Gerçek aşımlı 34 parent'ın 32'si defterli, kalan 2'si bu iki satır |
| V1-06 | `TAMBUR_CONSUMED ⇒ currentQty=0 ∧ adım yok ∧ ≥1 çocuk` | **0** | — | 116 parent temiz |
| V1-07 | Kesim aritmetiği: `initialQty + aşım = Σ canlı çocuk + düşülen` | **8/116 tutmuyor** | 8/21 | Net 968,8 m; ayrıştırıldığında 185,7 m'si `initialQty` yeniden yazımından, gerisi iptal edilmiş çocuklardan → **V-1-01** |
| V1-08 | `WAREHOUSE/A1_STOCK ⇒ barcode NOT NULL` | **0** | — | — |
| V1-09 | `SHIPPED ⇒ sackId ∧ shipmentId` | **0** | — | 689 sevk edilmiş topun hepsi bağlı |
| V1-10 | `SHIPPED` top ama çuvalında **hiç `SackAllocation` yok** | **81 top** | 1 | → **V-1-03** |
| V1-11 | `CANCELLED` ama açık hareket | **0** | 0 | — |
| V1-12 | `IN_PRODUCTION` ama `currentStepId NULL` | **0** | 0 | — |
| V1-13 | `AT_SUBCONTRACTOR` ama açık fason sevki yok | **0** | — | 188 fasondaki topun hepsi sevke bağlı |
| V1-14 | `createdAt > updatedAt` | **0** | 0 | — |
| V1-15 | `finalizedAt < createdAt` | **955** | 61 | → **V-1-05** |
| V1-16 | `statusChangedAt < createdAt` | **409** | 100 | Aynı mekanizma → **V-1-05** |
| V1-17 | Final statüde `finalizedAt NULL` | **4** (WAREHOUSE 3 / SCRAP 1) | 4 | → **V-1-06** |
| V1-18 | `statusChangedAt NULL` | 39 | — | Trigger öncesi (2026-08-09) kayıtlar; bilgi |
| V1-19 | `entrySource ⇔ parentRollId` / `⇔ parentReceiptId` | **0** | 0 | 1.040 `TAMBUR_SPLIT` topun 1.040'ında parent, 149 `SUBCONTRACTOR_RETURN` topun 149'unda makbuz var — tam tutarlı |
| V1-20 | `qualityGrade.targetStatus ≠ status` | **4** (FIRE→WAREHOUSE) | — | 2026-08-20 "fire çöpe gider" kararından ÖNCEKİ kayıtlar; bilinçli (K10 Q-MD-04b) |
| V1-21 | Kapanmış harekette `qtyOut ≠ qtyIn` (§12), muaf desenler hariç | **0** | — | 7 sapan satırın hepsi muaf desende (`WO_CLOSE_*`, `MANUAL_MOVE_OUT`, `CANCEL:<sevkNo>`) — §12 gerçekten temiz |
| V1-22 | Aynı top+adımda >1 açık hareket · aynı top >1 adımda açık | **0 / 0** | — | Partial unique + `openMovementForNextStep` tutuyor |
| V1-23 | `exitedAt < enteredAt` · `qtyOut > qtyIn` · hareket yetimi | **0 / 0 / 0** | — | — |
| V1-24 | `roll_variances`: `qty ≤ 0` · `sourceRefId` yetimi · terslenmiş satır | **0 / 0 / 0** | — | 75 satır: OVERAGE 37 (382,1 m) · RECORD_CORRECTION 36 (309,9 m) · SCRAP 2 (8,9 m). Hepsi `TAMBUR_CONSUMED` topa ait |
| V1-25 | Aynı (top, adım, tip) için >1 `roll_operation` | **0** | — | 1.586 operasyon; 12'si kalıtım (`inheritedFromParentRollId`) |
| V1-26 | Açık `RollError` ama topu ölü (§17) | **0** | 0 | 3 hata kaydının 3'ü de işlenmiş (`NO_CUT`) |
| V1-27 | `roll_plan_deviations` | **0 satır** | 0 | Kapı 2026-08-19'da geldi, prod deploy 08-24/25 → henüz kayıt yok (K10 ile aynı ölçüm) |
| V1-28 | Parti: aynı `batchNumber` ile **aynı anda açık** parti | **61 numara** | 0 | → **V-1-04** (toplam 85 numara iki canlı partiye sahip) |
| V1-29 | Parti WO ≠ topun adım WO'su / üretim adımı WO'su | **0 / 0** | — | Parti cerrahisi (devir/tebdil) tutarlı |
| V1-30 | Tombstone partide top · biçim dışı parti no | **0 / 0** | — | — |
| V1-31 | `WorkOrderStep.status` türetim driftı (§20) | **1** | — | `IE0608260004` adım 2: hareketi hiç olmayan `COMPLETED` adım. K10/CLAUDE.md'nin belgelediği **sorgunun kör noktası** (adımın tek topu sonradan iptal edilince tarihsel olgu `PENDING` gibi görünür) — bulgu değil |
| V1-32 | Mükerrer ham giriş adayı (`clientEnteredAt` 90 sn + aynı operatör/makine/kumaş/metraj/en = tuzağın kendi predikatı) | **26 çift** | — | `kk1.duplicateGuardEnabled` KAPALI. Örnekler 1,4–4,3 sn aralıklı, aynı partiden eşit metrajlı toplar → tekstilde **meşru seri giriş**; tuzağın "engelleme değil onaylatma" tasarımını doğruluyor. Bulgu değil, ölçüm |
| V1-33 | Canlı statüde 0 m top (hayalet stok) | **2** | — | `T190826F0119`, `T190826F0120` — Tur 1 `BULGU-T1-039` (depo kesiminde kaynak emekli edilmiyor). Yeni bulgu yazılmadı |
| V1-34 | Dönem kapandıktan sonra statüsü değişen finalize top | **4 top / 698 m** | — | → **V-1-07** |
| V1-35 | `CANCELLED` topta iptal izi (`cancelledAt`/`cancelReason`) | 230 iptalin 96'sında damga, 24'ünde sebep | 56/1 | Tur 1 `BULGU-T1-033` (ayakta) — tekrar yazılmadı. **Yeni ayrıntı:** iptal edilmiş 92 kesim çocuğunun (4.327,2 m) **hiçbirinde** damga yok → damgasızların ana kaynağı Tambur geri alma yolu |
| V1-36 | `preTamburCloseQty` dolu · `preTamburCloseStatus` dolu | 106/116 · **0/116** | — | `preTamburCloseStatus` yalnız `finalizeWarehouseCut` (`tambur.service.ts:2586`) yazar; sahada o yol hiç kullanılmamış → kolon canlıda tamamen boş (bilgi; V-1-02'nin ön koşulu) |

---

## 2. Bulgular

### [V-1-01] Depo kesimi topun `initialQty`'sini yeniden yazıyor — kesim aritmetiği geriye dönük denetlenemez hâle geliyor (saha: 8 soyağacı, 185,7 m izsiz, 2 sahte alarm)

| Şiddet | S3 | Kategori | E — iş kuralı değişmezi (INV-STK-03) / C — kolon semantiği | Öncelik | P3 | Modül | Üretim/Tambur · Envanter | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** "Top Kesme" (depo kesimi) bir topu kısaltırken yalnız kalan metrajı (`currentQty`) değil **giriş metrajını da** (`initialQty`) düşürüyor. `initialQty` sistemin başka her yerinde "topun doğuş metrajı" olarak okunuyor: kesim toplamı doğrulaması, aşım defteri, iş emrinin ÇIKAN rakamı ve mutabakat sorguları hep ondan türetiliyor. Kolon yeniden yazıldığı anda o soyağacının aritmetiği bir daha kurulamıyor. Sahada 8 soyağacı bu durumda; toplam **185,7 m** üretilmiş mal, ait olduğu kaynağa geri bağlanamıyor ve iki satır mutabakat kapısında **olmayan bir aşım** olarak kırmızı yanıyor.

**Kanıt.**
- `Teks-Erp/src/services/tambur.service.ts:2218-2247` — kesim parent'ı kısaltırken iki kolonu birden düşürür:
  ```ts
  // Parent kısalıyor — initialQty'i de güncelle (her kesim sonrası reset).
  data: { currentQty: 0, initialQty: 0 }                       // aşım dalı (:2240)
  data: { currentQty: { decrement: data.cutLength },
          initialQty: { decrement: data.cutLength } }          // normal dal (:2245-2246)
  ```
- Aynı dosyadaki üretim ikizi `cutOpenFabric` **yalnız `currentQty`'yi** düşürür (`tambur.service.ts:2929-2937`) — yani iki kesim yolu aynı kolon için iki farklı sözleşme uyguluyor.
- `Teks-Erp/prisma/schema.prisma:1628-1629` şema yorumu bugünkü davranışın **tersini** söylüyor: *"Kapanış anındaki `currentQty`. Türetilemez: `initialQty` kapanışta değişmiyor ama `currentQty` sıfırlanıyor."*
- Kodun kendisi de çelişkiyi biliyor: `tambur.service.ts:3298-3300` *"qtyOut = movement'ın KENDİ qtyIn'i … `initialQty` artık güvenilir değil (cutWarehouseRoll parent initialQty'yi resetler)"*.
- Koruma yok teyidi: `currentQty ≤ initialQty` için DB CHECK **yok** (K2b kısıt envanteri; `rolls` üzerindeki 26 CHECK arasında bu ifade geçmiyor), `initialQty`'ye yazan yol için audit `changes` gövdesi boş (aşağıdaki ölçüm), `consistency-check.sql` §13 yalnız `currentQty > initialQty` yönünü kapsıyor — **aşağı** yönlü yeniden yazımı hiçbir kapı görmüyor.

**failure_mode.** Depoda 100 m'lik `T…F0119` topu var. Operatör Top Kesme'den 40 m kesiyor → parent `60/60` (giriş metrajı da 100→60 oldu), çocuk 40 m. Ertesi gün kalan 60 m de kesiliyor → parent `0/0`, ikinci çocuk 60 m. Artık veritabanında "0 m'lik bir toptan 100 m çocuk doğmuş" bir soyağacı var. `Q-STK-03` / `§13` sınıfı mutabakat sorgusu bu satırı **"aşım var ama sapma defterinde satır yok"** diye raporluyor (sahada iki kez oluyor: `T080826F0017`, `T080826F0020`); gerçekte aşım hiç yaşanmadı. Ters yönde de kör: gerçekten aşımlı bir depo kesimi olsaydı parent'ın `initialQty`'si zaten sıfırlanacağı için aynı sorgu farkı ölçemezdi.

**Veride fiili ihlal (K2).**
```sql
-- (a) initialQty'si sıfırlanmış ama tüketilmiş çocuğu olan parent
SELECT p.barcode, p.status, p."initialQty", sum(c."initialQty") AS cocuk_toplam
FROM rolls p JOIN rolls c ON c."parentRollId" = p.id
WHERE p."initialQty" = 0 GROUP BY 1,2,3;
-- (b) kesim aritmetiği (iptal edilmiş çocuklar hariç)
--     beklenen: initialQty + Σ OVERAGE = Σ canlı çocuk + Σ (SCRAP|RECORD_CORRECTION)
```
| Ölçüm | Saha | Dev |
|---|---|---|
| `initialQty=0` + çocuklu parent | **8** (`T080826F0017/0019/0020`, `T160726F0001/0003`, `T030826F0003`, `T190826F0119/0120`) | 2 |
| Aritmetiği tutmayan `TAMBUR_CONSUMED` parent | **8 / 116** | 8 / 21 |
| Yeniden yazımdan doğan izsiz metraj | **185,7 m** (39,0 + 20,0 + 76,7 + 50,0) | — |
| Sahte "defterlenmemiş aşım" alarmı | **2** (`T080826F0017` 20 m, `T080826F0020` 39 m) | — |

Ayrıştırma örneği (sahada birebir): 512 m'lik fason dönüşü topunun çocukları 396,4 m sevk + 40 m iptal + `initialQty=0` iki çocuk; o iki çocuğun kendi çocukları 36,7 m ve 40 m ile **sevk edilmiş**. Yani müşteriye giden 76,7 m, kaynağının kesim aritmetiğinde görünmüyor.

**İş etkisi.** (1) "Bu top nereden geldi / bu iş emri kaç metre üretti" sorusu, depo kesiminden geçmiş her soyağacında cevapsız kalıyor; iş emrinin ÇIKAN metrajı `initialQty` topladığı için geriye dönük düşüyor (Tur 1 `BULGU-T1-012`'nin veri tarafı). (2) Mutabakat kapısı iki sahte kırmızı taşıyor — kapıya güven aşınır ("nasılsa hep kırmızı"), gerçek bir aşım kaybolur. (3) Aşım/fire raporlaması bu soyağaçlarında ölçülemez.

**Öneri (2. tur için).** ① `cutWarehouseRoll` yalnız `currentQty`'yi düşürsün (üretim ikizi `cutOpenFabric` ile aynı sözleşme); "operatöre 70/100 göstermeyelim" ihtiyacı **sunum** katmanında çözülür (liste zaten tek sayı basıyor — CLAUDE.md 2026-07-30 kuralı bunu zaten söylüyor). ② Geçiş: `initialQty` ≠ doğuş metrajı olan mevcut 8 satır **düzeltilmez** (kök nedeni gizlememek için, §13'ün 2 satırıyla aynı gerekçe); bunun yerine mutabakat sorgusuna "parent `initialQty=0` ∧ çocuk metrajı > 0" için ayrı bir bilgi bölümü eklenir. ③ Şema yorumu (`schema.prisma:1628-1629`) bugünkü davranışla hizalanır. ④ İleride `CHECK (currentQty <= initialQty)` yazılacaksa **önce** bu yol düzeltilmelidir — aksi hâlde geri alma bump'ı ile çakışır. `[PROD'DA ÇALIŞTIRMA]` gerektiren veri dokunuşu YOK (yalnız kod).

**Kabul kriteri.** `cutWarehouseRoll` sonrası `initialQty` değişmez (bekçi: 100 m topa 40 m kesim → `initialQty=100 ∧ currentQty=60`); `Σ çocuk initialQty ≤ parent initialQty` invariantı depo kesimi zincirinde de sağlanır; negatif sonda: eski davranış geri konduğunda bekçi kırmızı.
**Efor.** 1,5 gün (kod + bekçi + mutabakat bölümü).
**Önceki defter.** Tur 1 `BULGU-T1-012` (aynı kök neden, farklı ayak: orada iş emri ÇIKAN metrajı, burada kesim aritmetiğinin denetlenebilirliği + sahte alarm). `audit/FINDINGS.jsonl`'de eşleşen id yok. K10 **H-3**'ün sorusu ("`initialQty=0` yazan yol hangisi?") bu bulguyla cevaplanmıştır: `tambur.service.ts:2240/2246`.

---

### [V-1-02] Depo kesimini "Tümden Geri Al", sapma defterine **olmayan bir aşım** yazıyor — fire/aşım karnesi kesilen metraj kadar şişer

| Şiddet | S2 | Kategori | E — iş kuralı değişmezi (INV-AUD-05) | Öncelik | P2 | Modül | Tambur geri alma | Kanıt seviyesi | **K1** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Geri alma, kaynağa konacak metrajı **çocukların toplamından** hesaplıyor (`computeRestoredQty`) ve bunu topun `initialQty`'siyle karşılaştırıp farkı "aşım" sayıp deftere yazıyor. Depo kesiminde `initialQty` her kesimde düşürüldüğü için (V-1-01) bu fark **her zaman** doğar: kesilen metraj kadar sahte `OVERAGE` satırı yazılır ve `initialQty` yapay olarak yukarı çekilir. Aşım = "operatör kayıtlıdan fazla mal ölçtü" demektir; burada öyle bir şey yaşanmamıştır.

**Kanıt.**
- `Teks-Erp/src/services/tambur-undo.service.ts:1516-1534` (`applyFull`):
  ```ts
  const parentInitial = parentRow?.initialQty ?? new Prisma.Decimal(0);
  const initialBump = restored.greaterThan(parentInitial) ? restored.minus(parentInitial) : 0;
  if (initialBump.greaterThan(0)) {
    await recordVarianceTx(tx, { rollId: parentId, kind: RollVarianceKind.OVERAGE,
                                 qty: initialBump, source: VARIANCE_SOURCES.TAMBUR_UNDO_FULL, ... });
  }
  ```
  ve `:1572` `initialQty: { increment: initialBump }`.
- `restored` tanımı `tambur-undo.service.ts:339-380` (`computeRestoredQty`) = `Σ çocuk.initialQty + Σ RECORD_CORRECTION + Σ TAMBUR_UNDO_SINGLE`; fonksiyonun kendi başlığı (`:333-337`) `preTamburCloseQty`'nin bu hesapta **kullanılmadığını** açıkça yazıyor.
- Depo kesimi dalı geri almada destekleniyor: `:1535-1537` *"Depo kesiminde adım YOK → hareket de yok; bu blok atlanır"*, `:1560-1562` `revivedStatus = stepId ? IN_PRODUCTION : (preTamburCloseStatus ?? WAREHOUSE)`.
- Ön koşul canlıda mevcut: `initialQty` yeniden yazımı sahada 8 soyağacında gerçekleşmiş (V-1-01); `preTamburCloseStatus` **0/116** dolu (V1-36), yani geri alma bu satırlarda zaten varsayılan dala düşecek.
- Koruma yok teyidi: `recordVarianceTx` (`helpers/roll-variance.helper.ts:50-78`) tek yazıcı ve gelen `qty`'yi sorgulamaz; `OVERAGE` için "gerçekten aşım mı" kontrolü hiçbir yerde yok; bekçi `scripts/test_tambur_undo.ts` §11 aşımı **üretim** dalında ölçüyor (depo kesimi + full undo kombinasyonu ölçülmüyor).

**failure_mode.** Depoda 100 m'lik top. Operatör 40 m kesiyor (parent `60/60`), sonra "Bitir" ile kapatıyor: kalan 60 m için kalan-topu çocuğu doğuyor, parent emekli (`currentQty=0`, `initialQty=60`). Hatalı kesim fark edilip **Tümden Geri Al** yapılıyor: `restored = 40 + 60 = 100`, `parentInitial = 60` → `initialBump = 40` → sapma defterine **40 m `OVERAGE`** düşer ve parent `100/100` olur. Metraj doğru geri gelmiştir ama fabrikanın aşım/fire karnesinde hiç yaşanmamış 40 m'lik bir "fazla çıktı" görünür; aynı topu iki kez kesip geri alan bir vardiya, karneyi kesilen metraj kadar sürekli şişirir.

**Veride fiili ihlal (K2).** **Arandı, 0** — bugüne kadar `source='TAMBUR_UNDO_FULL'` bir `OVERAGE` satırı yok:
```sql
SELECT kind, source, count(*), sum(qty) FROM roll_variances GROUP BY 1,2;
-- OVERAGE|TAMBUR_OVERCUT|37|382.100 · RECORD_CORRECTION|TAMBUR_FINALIZE|36|309.900 · SCRAP|TAMBUR_FINALIZE|2|8.900
```
Yani yol **henüz koşmadı** (depo kesimi + tümden geri alma kombinasyonu sahada hiç yaşanmamış: `preTamburCloseStatus` 0/116). Bulgu bu yüzden K1'de kalıyor; ön koşulun (yeniden yazılmış `initialQty`) canlıda var olduğu ölçüldü.

**İş etkisi.** Fire/aşım karnesi ve plan-sapma raporları "üretimde ne kadar kayıp/fazla var" sorusunu cevaplar; sahte `OVERAGE` satırı bu soruyu yanlış cevaplar ve **terslenemez** (defter satırının `reversedAt`'i yalnız kaynağı iptal edilince yazılır). Fabrika bir düzeltme işlemini kayıp/fazla olarak okur.

**Öneri.** V-1-01 düzeltilirse bu bulgu kendiliğinden kapanır (`initialQty` düşmezse `initialBump` doğmaz). Bağımsız korunma: `initialBump` yalnız **üretim** dalında (`stepId != null`) hesaplansın; depo kesiminde geri konacak metraj `preTamburCloseQty + Σ çocuk` üzerinden kurulup `initialQty`'ye dokunulmasın. Bekçiye depo kesimi + tümden geri alma senaryosu eklenmeli (bugün kör).
**Kabul kriteri.** 100 m topa 40 m depo kesimi + Bitir + Tümden Geri Al → parent `100/100`, `roll_variances`'ta **hiç** satır yok; negatif sonda: `initialBump` koşulsuz hâle getirilince bekçi kırmızı.
**Efor.** 0,5 gün (V-1-01 ile birlikte yapılırsa 0).
**Önceki defter.** Tur 1 `BULGU-T1-012` / `BULGU-T1-044` komşuluğu; bu tetikleyici (sahte defter satırı) hiçbirinde yazılmamış.

---

### [V-1-03] Sevk edilen 7.200,6 m hiçbir sipariş satırına yazılmadı — 5 sevkiyat tamamen defter dışı, 7 kalem hâlâ "0 sevk / 3.700 m açık"

| Şiddet | S2 | Kategori | E — iş kuralı değişmezi (INV-SEV-01/02) | Öncelik | P2 | Modül | Sevkiyat ↔ Sipariş (top metrajı) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Sevkiyat kurulurken çuval içeriği, seçilen siparişlerin satırlarına **spec eşleşmesiyle** dağıtılıyor (`specMatch`: kumaş + renk + en). Eşleşme tutmazsa mal yine sevk ediliyor ama hiçbir `SackAllocation` yazılmıyor; sonuç olarak `OrderLine.shippedQty` artmıyor. Sahada bu, 39 sevkiyatın 23'ünde toplam **7.200,6 m**, 5 sevkiyatta ise **tamamen** (81 top / 3.040,2 m) gerçekleşmiş: mal müşteriye gitti, sipariş ekranı hâlâ "İstenen 500 · Sevk 0 · Açık 500" gösteriyor. Kurulum ekranı bir uyarı basıyor; **sevkten sonra bu farkı gösteren hiçbir yüzey ve hiçbir mutabakat sorgusu yok** — `consistency-check.sql` §1/§2 `shippedQty = Σ tahsis` eşitliğini ölçtüğü için dairesel, tahsisi hiç yazılmamış malı göremez.

**Kanıt.**
- `Teks-Erp/src/services/helpers/allocation.helper.ts:36-49` — `specMatch` renk/en dolu ise **eşitlik** ister:
  ```ts
  if (a.itemId !== b.itemId) return false;
  if (a.colorId != null && b.colorId != null && a.colorId !== b.colorId) return false;
  ```
- `allocation.helper.ts:102-114` — `need = quantity − shippedQty`, eşleşmeyen havuz artığı hiçbir yere yazılmaz (`if (alloc.greaterThan(0)) result.set(...)`).
- `Teks-Erp/src/services/shipping.service.ts:1339-1356` — `writeShipmentAllocationsTx` yalnız hesaplanan tahsisleri yazar; **kapsanmayan içerik için ne hata ne kayıt** üretir.
- `shipping.service.ts:1359` sözleşme cümlesi: *"Fazla/eşleşmeyen/siparişsiz sevk edilebilir."* — davranış bilinçli; eksik olan **sevk sonrası görünürlük**.
- Tek uyarı kurulum önizlemesinde: `shipping.service.ts:1507` `"Seçili siparişlere yazılamayan ~N m mal var (fazla/eşleşmeyen) — yine de sevk edilecek."` (istemciler bunu çiziyor: `Electron/src/pages/Operations/SackContentEdit/ShipmentPreviewPanel.tsx`, `mobil/src/services/packing.service.ts:543`).
- Koruma yok teyidi: `consistency-check.sql` §1/§2 türetilmiş eşitliği ölçer (dairesel); `Q-SEV-08a` (sevk > istenen) **0** — çünkü fazlalık deftere hiç girmiyor; DB kısıtı yok; sevk sonrası rapor yok (`grep -rn "yazılamayan" src` yalnız önizleme satırını verir).

**failure_mode.** Depo sorumlusu `SIP1008260003` (ALP · **55-BEYAZ** · 500 m) için çuvala ALP **EKRU** toplarını okutuyor (aynı kumaş, farklı renk). Sevkiyat kuruluyor, `SVK1708260002` DISPATCHED oluyor, 8 top / 348,3 m fiziksel olarak müşteriye gidiyor, irsaliye basılıyor. `specMatch` renkte takıldığı için tahsis yazılmıyor: sipariş "APPROVED · Açık 500 m" kalıyor. Planlamacı aynı 500 m'yi yeniden üretime veriyor; muhasebe "sevk edilen metraj" raporunda (o rapor `rolls`'tan brüt okur, `_shipped.ts:70-76`) 348,3 m'yi görüyor ama sipariş defterinde karşılığı yok — iki rakam kalıcı olarak ayrışıyor.

**Veride fiili ihlal (K2).**
```sql
-- Sevkiyat başına: çuval içeriği (m) vs deftere yazılan tahsis (m)
SELECT sh."shipmentNo", sh.status,
  (SELECT coalesce(sum(r."currentQty"),0) FROM rolls r JOIN sacks s2 ON s2.id=r."sackId" WHERE s2."shipmentId"=sh.id) AS icerik,
  (SELECT coalesce(sum(sa.qty),0) FROM sack_allocations sa JOIN sacks s3 ON s3.id=sa."sackId" WHERE s3."shipmentId"=sh.id) AS tahsis
FROM shipments sh WHERE sh.status='DISPATCHED';
```
| Ölçüm | Saha | Dev |
|---|---|---|
| DISPATCHED sevkiyat içeriği toplamı | 27.611,8 m | — |
| Yazılan tahsis toplamı | 20.459,2 m | — |
| **Defter dışı** | **7.152,6 m** (23 sevkiyatta 7.200,6 m fark; iade geri-eklemesi 261 m ayrı) | — |
| Hiç tahsis almayan DISPATCHED sevkiyat | **5** (`SVK1708260002`, `SVK1808260001`, `SVK1908260002`, `SVK2008260001`, `SVK2008260005`) | 1 |
| O sevkiyatlardaki top / metraj / müşteri | **81 top · 3.040,2 m · 3 müşteri** | — |
| Etkilenen sipariş kalemi (hâlâ `shippedQty=0`) | **7 kalem · 3.700 m istenen** (`SIP1008260002/3/12/27/28/48`, `SIP1408260015`) | — |
| Kök neden örneği | Kalem `ALP · 55-BEYAZ · 330` ↔ sevk edilen top `ALP · **EKRU** · 330` (renk uyuşmazlığı); diğer dördü de renk/en uyuşmazlığı | — |

**İş etkisi.** Sipariş karşılama defteri fiili sevkten **7,2 km kumaş** geride; "Açık" rakamına bakan planlamacı aynı malı yeniden üretir/sevk eder, sipariş kapanmaz (`recomputeOrderStatus` hep `APPROVED`/`PARTIAL_SHIPPED` der), müşteriye yanlış renkte mal gitmiş olabileceği hiçbir yerde iz bırakmaz. Fatura ERP'de kesilmediği için doğrudan mali kayıp yok; ama sevk raporu (brüt, `rolls`) ile sipariş defteri (tahsis) arasındaki fark hiçbir ekranda uzlaştırılmıyor.

**Öneri.** ① **Sevk sonrası görünürlük**: sevkiyat detayına ve Sevkiyatlar listesine "siparişe yazılmayan metraj" sütunu/rozeti (`içerik − Σ tahsis`); ② mutabakat kapısına yeni bölüm — `DISPATCHED sevkiyatta tahsis edilmemiş içerik > 0` (dairesel §1/§2'nin dışında, **gerçek** kapsama ölçümü); ③ kurulum uyarısı "yazılamayan" olduğunda **onay** istesin (bugün yalnız bilgi satırı); ④ eşleşmeme sebebi uyarıda somut yazılsın ("kalem 55-BEYAZ, çuvalda EKRU"). Veri düzeltmesi **iş kararıdır** — geçmiş 7 kalem için tahsis elle yazılacaksa `[PROD'DA ÇALIŞTIRMA]` dry-run script'i gerekir, geri alma yolu: `sack_allocations` satırlarını silip `recomputeOrderStatus`.
**Kabul kriteri.** Renk uyuşmazlıklı bir çuval sevk edildiğinde sevkiyat detayı "0 m siparişe yazıldı / 348 m yazılamadı" gösterir; mutabakat bölümü bugünkü 5 sevkiyatı listeler; negatif sonda: tahsis yazımı bilerek boş bırakıldığında bölüm kırmızı.
**Efor.** 2 gün (sunucu bölümü + iki istemci yüzeyi + bekçi).
**Önceki defter.** `audit/FINDINGS.jsonl`'de eşleşen id yok; K10 INV-SEV-08/**H-2** aynı ailenin *fazla sevk* ayağını işaret ediyordu (Q-SEV-08a/b = 0), bu bulgu neden 0 olduğunu açıklıyor: fazlalık deftere **hiç girmiyor**.

---

### [V-1-04] Parti numarası sarması: sahada 61 numara aynı anda İKİ AÇIK partiyi gösteriyor — "fiziksel plaka" varsayımı ölçümle çürüdü

| Şiddet | S3 | Kategori | E — iş kuralı (INV-PAR-01) · izlenebilirlik | Öncelik | P4 | Modül | Parti | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `P01…P99` körlemesine sarma bilinçli bir karardır (CLAUDE.md 2026-08-05) ve gerekçesi *fabrikadaki numaralı fiziksel plaka düzeni*; kabul edilen bedel "aynı numara ~5-10 gün arayla tekrar doğar" idi — yani eski partinin kapanmış olacağı varsayımı. Saha ölçümü bu varsayımı çürütüyor: **61 numarada aynı anda iki AÇIK parti var** (ölü olmayan topu bulunan), 10 numara aynı anda **iki açık fason sevkinde**. Numara tekrarı sorun değil; sorun aynı numaranın **aynı anda** iki canlı işi göstermesi ve o numaranın kâğıda (refakat kartı parti bloğu, fason çeki/kabul makbuzu) basılıyor olması.

**Kanıt.**
- `Teks-Erp/src/services/batch.service.ts:122-165` — sarma körlemesine (`(seq % 99) + 1`), kaynak "son doğan kısa parti"; numara benzersiz **değil** (`@unique` migration `20260805120000` ile kaldırıldı, `schema.prisma:2263-2270`).
- Numara kâğıda basılıyor: refakat kartı canlı parti bloğu (`resolveLiveBatches`), fason çeki tekil `batchNumber`, kabul makbuzu çoğul `batchNumbers` (CLAUDE.md 2026-08-05 notu).
- Koruma yok teyidi: DB'de unique yok (bilinçli), kodda "bu numara şu an açık mı" kontrolü yok (`batch.service.ts:162-165` yalnız sonuncuyu okur), bekçi `test_batch_number_format.ts` sarmayı ölçer ama **çakışma canlılığını** ölçmez.

**failure_mode.** Boyahaneye iki ayrı iş emrinden mal gidiyor: `IE0508260003` partisi `P02` (5 Ağustos) ve `IE1408260009` partisi `P02` (14 Ağustos). İkisinin de fason çekisi kâğıda `P02` basıyor ve ikisi de aynı anda açık. Boyahane dönüşünde makbuz "P02" ile eşleştirilirse yanlış iş emrinin malı kabul edilir; fabrika içinde de aynı numaralı iki plaka aynı anda sahada durur. Sistemde kimlik `Batch.id` olduğu için veri bozulmaz — **kâğıt** ve **konuşma dili** bozulur.

**Veride fiili ihlal (K2).**
```sql
WITH canli AS (
  SELECT b.id, b."batchNumber",
         EXISTS (SELECT 1 FROM rolls r WHERE r."batchId"=b.id
                 AND r.status NOT IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED','SHIPPED')) AS acik
  FROM batches b WHERE b."mergedIntoId" IS NULL)
SELECT count(*) FROM (SELECT "batchNumber" FROM canli WHERE acik GROUP BY 1 HAVING count(*)>1) x;
```
| Ölçüm | Saha | Dev |
|---|---|---|
| Aynı numarada **aynı anda açık** parti çifti | **61 numara** | 0 |
| Aynı numarada iki canlı (sevk edilmiş dahil) parti | **85 numara** | 0 |
| Aynı numara iki **açık fason sevkinde** | **10 numara** (`P01`…`P10`) | — |
| Aynı numaranın iki doğumu arası süre | en kısa **7 gün 19 sa**, ortalama 9 gün 17 sa, en uzun 12 gün | — |
| Örnek | `P02`: `IE0508260003` (05.08) + `IE1408260009` (14.08) — ikisi de açık | — |

**İş etkisi.** Parti no ile arama zaten aday listesi döndürüyor (kabul edilmiş bedel); ölçülen yeni şey, **aynı anda** iki canlı adayın olması: fason kabulünde/tambur okutmasında operatörün kâğıttaki numarayla eşleştirme yapması gereken her yerde %50 yanlış eşleştirme riski var. Bugün veri bozulmamış (parti WO uyumsuzluğu 0), yani insan eliyle doğru eşleşmiş.

**Öneri.** Karar bilinçli olduğu için **davranışı değiştirme önerisi değil, görünürlük**: ① parti seçici/arama yüzeylerinde aynı numaralı canlı partiler **iş emri no + doğum tarihi** ile ayrıştırılsın (bugün bazı yerlerde yalnız numara basılıyor); ② `GET /api/batches/number-state` "sıradaki" göstergesine "bu numara şu an N açık partide" bilgisi eklensin (körlemesine sarmayı bozmadan operatörü uyarır); ③ mutabakat kapısına bilgi bölümü (kırmızı değil, sayı). Alternatif (daha büyük karar): sarma penceresini uzatmak için numara aralığını `P01…P99` yerine üç haneye çıkarmak — kullanıcı kararı, fiziksel plaka setine bağlı.
**Kabul kriteri.** Aynı numaralı iki açık parti varken parti seçicide iki satır ayırt edilebilir; sayaç göstergesi çakışma sayısını basar.
**Efor.** 1 gün.
**Önceki defter.** Tur 1 `BULGU-T1-150` ("`batchNumber` ile lookup yapma kuralının mekanik bekçisi yok") — bu bulgu o kuralın **neden** kritik olduğunu veriyle ölçüyor; kural ihlali değil, varsayım ihlali.

---

### [V-1-05] `finalizedAt` topun `createdAt`'inden ÖNCE — üretim damgası ile doğum anı iki farklı saatten geliyor (saha 955 satır)

| Şiddet | S3 | Kategori | C — kolon semantiği / zaman | Öncelik | P4 | Modül | Rapor tabanı (Roll damgaları) | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `finalizedAt`/`statusChangedAt` damgalarını DB trigger'ı `now()` ile yazıyor; PostgreSQL'de `now()` = **transaction başlangıç anı**. `createdAt` ise Prisma istemcisinin ürettiği değerle INSERT'e giriyor (DB varsayılanı `CURRENT_TIMESTAMP` yalnız yedek). Sonuç: aynı satırda "üretimi bitti" anı, "kaydı doğdu" anından **önce** görünüyor — sahada 955 top, dev'de 61 top. Fark bugün saniyenin altında (en fazla 0,70 sn), yani hasar 0; ama iki damganın farklı saat kaynaklarından gelmesi gün/dönem sınırında sessiz kayma üretmeye açık.

**Kanıt.**
- Trigger: `Teks-Erp/prisma/migrations/20260809090000_roll_production_timestamps/migration.sql:45-96` — INSERT dalında `NEW."statusChangedAt" := now();` ve final statüde doğan topta `NEW."finalizedAt" := now();`.
- `createdAt`: `prisma/schema.prisma` `Roll.createdAt DateTime @default(now())`; DB kolon varsayılanı ölçüldü — `information_schema.columns.column_default = CURRENT_TIMESTAMP` (yani DB tarafı da tx başlangıcı olurdu), ama gözlenen sıra `finalizedAt < createdAt` olduğu için değerin **istemciden** geldiği doğrulanıyor (aksi hâlde ikisi birebir eşit olurdu).
- Koruma yok teyidi: `rolls` üzerinde `finalizedAt >= createdAt` CHECK'i yok (K2b'deki 26 CHECK arasında yok); `consistency-check.sql`'de zaman sırası bölümü yok (`work_order_steps_time_order` CHECK'inin Roll ikizi yazılmamış); `test_timestamptz_contract.ts` tip sözleşmesini ölçüyor, sırayı değil.

**failure_mode.** Ayın son günü 23:59:59,9'da Tambur kesimi yapılıyor. Çocuk topun `createdAt`'i (istemci saati, INSERT anı) **1 Eylül 00:00:00,1**, `finalizedAt`'i (tx başlangıcı) **31 Ağustos 23:59:59,7**. Kalite Karnesi `finalizedAt`'e göre Ağustos'a yazar, Envanter listesi ve "Giriş" kolonu `createdAt`'e göre Eylül'e. Aynı top iki ekranda iki farklı aya düşer; hiçbir bekçi bunu ölçmez. Aynı asimetri, uygulama sunucusu ile DB farklı makinelere alınırsa saat sapması kadar büyür (bugün ikisi de SAHINSRV'de — [VARSAYIM], canlı prod'a erişim yok).

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) FILTER (WHERE "finalizedAt" < "createdAt") AS fin_erken,
       count(*) FILTER (WHERE "statusChangedAt" < "createdAt") AS sc_erken,
       min("finalizedAt" - "createdAt") AS en_buyuk_negatif FROM rolls;
```
| Ölçüm | Saha | Dev |
|---|---|---|
| `finalizedAt < createdAt` | **955** / 1.035 damgalı | 61 / 296 |
| `statusChangedAt < createdAt` | **409** | 100 |
| En büyük negatif fark | **−0,697 sn** | — |
| Gün sınırını fiilen aşan satır | **0** (en geç damga 23:45:25) | 0 |
| Kırılım | `TAMBUR_SPLIT` 953, `MANUAL_ENTRY`/`TAMBUR_MANUAL` 2 | — |

**İş etkisi.** Bugün rakamsal hasar yok; risk dönem sınırında ve "üretim süresi = finalizedAt − createdAt" gibi türetilmiş her hesapta negatif değer üretmesi. Ayrıca kolonun sözleşmesi ("üretim anı") artık "işlemin başladığı an" anlamına geliyor — toplu bir işlemde (WO kapanış dispozisyonu) tüm topların damgası tx başına eşitlenir.

**Öneri.** ① Trigger'da `now()` yerine `clock_timestamp()` kullanılsın (satırın gerçek yazım anı; `now()` yalnız "aynı tx'teki tüm satırlar aynı damga" istendiğinde doğrudur — burada istenmiyor). ② Ya da simetrik çözüm: `createdAt` da DB'ye bırakılsın (Prisma'nın gönderdiği değer yerine DB varsayılanı). ③ Küçük ve ucuz kapı: `consistency-check.sql`'e "`finalizedAt < createdAt` ∨ `statusChangedAt < createdAt`" bölümü. Migration gerekiyorsa trigger `CREATE OR REPLACE FUNCTION` ile değişir — veri dokunuşu YOK, geri alma = eski fonksiyon gövdesi.
**Kabul kriteri.** Yeni doğan final topta `finalizedAt >= createdAt`; mutabakat bölümü yeni kayıtlarda 0 döner (eski 955 satır bilinçli bırakılırsa bölüm tarih eşiği alır).
**Efor.** 0,5 gün.
**Önceki defter.** Yok (yeni). K10 INV-STK-08 damganın **kaynağını** haritalamıştı, sırayı ölçmemişti.

---

### [V-1-06] Damgasız 4 final top (359 m) hiçbir dönemin Kalite/Fire Karnesi'nde görünmüyor — onarım scripti sahada hiç koşmamış

| Şiddet | S3 | Kategori | J — migration/kurtarma · I — gözlemlenebilirlik | Öncelik | P4 | Modül | Rapor tabanı | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** `finalizedAt` trigger'ı 2026-08-09'da geldi; ondan önce final statüye geçmiş topları doldurmak için `scripts/backfill_roll_production_timestamps.ts` yazıldı. Sahada bu script hiç koşmamış: 3 WAREHOUSE + 1 SCRAP top `finalizedAt=NULL` ve `statusChangedAt=NULL` taşıyor. Kalite/Fire Karnesi `WHERE finalizedAt BETWEEN …` ile süzdüğü için bu 359 m **hiçbir dönemde** raporlanmıyor — ne Ağustos'ta ne başka ayda.

**Kanıt.**
- Rapor süzgeci: `Teks-Erp/src/services/reports/quality-scorecard.report.service.ts:192-194` (`WHERE r."finalizedAt" >= … AND r."finalizedAt" <= … AND r.status NOT IN (K18_DEAD)`); Fire Karnesi ikizi `scrap-scorecard.report.service.ts:316-318`.
- Backfill scripti mevcut: `Teks-Erp/scripts/backfill_roll_production_timestamps.ts` (Tur 1 `BULGU-T1-136` parçalılık ayağını yazmış).
- Koruma yok teyidi: damgasız topu gösteren tek yüzey Kalite Karnesi'nin "çıpasız top" bandı; Fire Karnesi'nde o band **yok** (grep: `scrap-scorecard.report.service.ts` içinde `finalizedAt IS NULL` sorgusu yok) → fire edilen 300 m'lik top hiçbir yerde sayılmıyor.

**failure_mode.** 2026-08-08'de 300 m'lik `bc74b77d…` topu fire ediliyor (SCRAP). Trigger ertesi gün geliyor, backfill koşmuyor. Fabrika "Ağustos'ta ne kadar fire verdik" diye sorduğunda rapor 300 m'yi **hiç** göstermiyor; toplam fire oranı olduğundan düşük çıkıyor ve hata hiçbir ekranda iz bırakmıyor.

**Veride fiili ihlal (K2).**
```sql
SELECT id, barcode, status, "currentQty", "createdAt" FROM rolls
WHERE status IN ('WAREHOUSE','A1_STOCK','SCRAP') AND "finalizedAt" IS NULL;
```
| Top | Statü | Metraj | Tarih |
|---|---|---|---|
| `bc74b77d…` (barkodsuz) | SCRAP | **300,0 m** | 2026-08-08 |
| `T080826F0018` | WAREHOUSE | 20,0 m | 2026-08-08 |
| `T080826F0021` | WAREHOUSE | 33,0 m | 2026-08-08 |
| `T080826F0022` | WAREHOUSE | 6,0 m | 2026-08-08 |

Saha **4 / 359 m**, dev 4. `statusChangedAt IS NULL` olan 39 top da aynı dönemden (bilgi).

**İş etkisi.** Fire raporu 300 m eksik; Kalite Karnesi 59 m eksik. Küçük rakamlar ama **sessiz** ve kalıcı: bu satırlar hiçbir dönemde toplanmadığı için toplam üretim ile karne toplamı kalıcı olarak ayrışıyor.
**Öneri.** ① `backfill_roll_production_timestamps.ts` sahada dry-run + `--apply` ile koşulsun `[PROD'DA ÇALIŞTIRMA — önce dry-run çıktısı 4 satırı birebir listelemeli]`; geri alma: etkilenen 4 id için damga tekrar `NULL`'lanır (ham SQL, `updatedAt`'e dokunmadan). ② Fire Karnesi'ne Kalite Karnesi'ndeki gibi "çıpasız top" bandı eklensin — kalıcı çözüm rakamı kurtarmak değil, **kaybı görünür kılmaktır**. ③ `/api/admin/health` sayacına "damgasız final top" eklenebilir.
**Kabul kriteri.** `SELECT count(*) FROM rolls WHERE status IN ('WAREHOUSE','A1_STOCK','SCRAP') AND "finalizedAt" IS NULL` = 0; Fire Karnesi çıpasız topu bir bantla gösterir.
**Efor.** 0,5 gün (band) + ops koşumu.
**Önceki defter.** Tur 1 `BULGU-T1-032` trigger'ın **kaynak listesini** (fire ucu kapsanmıyor) yazmıştı; bu bulgu çürütücünün işaret ettiği ayrı ayak: **backfill hiç koşmadı**, 4 top hiçbir dönemde yok.

---

### [V-1-07] Kapanmış dönem geriye dönük değişiyor: Temmuz'da finalize edilen 4 top (698 m) Ağustos'ta iptal edilince Temmuz karnesi sessizce düştü

| Şiddet | S3 | Kategori | E — iş kuralı (dönem kararlılığı) | Öncelik | P3 | Modül | Rapor tabanı ↔ Roll statü/metraj | Kanıt seviyesi | **K2** |
|---|---|---|---|---|---|---|---|---|---|

**Özet.** Kalite/Fire Karnesi dönemi `finalizedAt` ile seçiyor ama satırı **bugünkü** statü (`K18_DEAD` süzgeci) ve **bugünkü** metraj (`SUM(currentQty)`) ile topluyor. Bir top finalize edildikten sonra iptal edilir, fasona gider ya da metrajı düzeltilirse **kapanmış bir ayın rakamı geriye dönük değişir** ve bu değişimi hiçbir yer loglamaz. Sahada ölçüldü: Temmuz'da finalize edilmiş 4 top (698 m) Ağustos'ta iptal edilmiş → Temmuz'un üretim rakamı bugün üç hafta öncekinden 698 m düşük.

**Kanıt.**
- `Teks-Erp/src/services/reports/quality-scorecard.report.service.ts:177` `SUM(r."currentQty")::float AS "qty"` + `:192-194` `WHERE finalizedAt BETWEEN … AND status NOT IN (K18_DEAD_STATUSES)`; Fire Karnesi ikizi `scrap-scorecard.report.service.ts:312-318`.
- `K18_DEAD_STATUSES` `CANCELLED`/`TAMBUR_CONSUMED`/`SUBCONTRACTOR_CONSUMED`/`KARTELA_CONSUMED` içerir (`batch.service.ts:55-60`) — yani sonradan bu statülere geçen her top geçmiş dönemden **düşer**.
- Metraj tarafı: `inventory.service.ts:3865-3869` "Düzelt" ekranı `currentQty` **ve** `initialQty`'yi mutlak yazar → kapanmış ayın metrajı da değişir (Tur 1 `BULGU-T1-001`'in rapor ayağı).
- Koruma yok teyidi: dönem dondurma/kilit yok (`grep -rn "periodClose\|donem_kilit" src` → 0); rapor snapshot'ı yok (donmuş belge yalnız sevk/irsaliye tarafında); değişimi loglayan bir iz yok (audit `changes` gövdesi bu yollarda boş — aşağıda).

**failure_mode.** 20 Temmuz'da 1.150 m'lik top Tambur'da kesiliyor; 5 çocuk doğuyor, Temmuz karnesi bu üretimi yazıyor. 24 Ağustos'ta kesim geri alınıp 4 çocuk iptal ediliyor. Bugün Temmuz karnesi aynı aralıkla açıldığında 698 m daha az basıyor; ay sonunda alınan çıktı ile bugünkü çıktı çelişiyor, farkın nereden geldiğini söyleyen tek bir kayıt bile yok (iptal edilen 92 kesim çocuğunun **hiçbirinde** `cancelledAt`/`cancelReason` yok — V1-35).

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) AS adet, sum("initialQty") AS metraj FROM rolls
WHERE "finalizedAt" IS NOT NULL AND "statusChangedAt" IS NOT NULL
  AND date_trunc('month',"statusChangedAt" AT TIME ZONE 'Europe/Istanbul')
    > date_trunc('month',"finalizedAt"     AT TIME ZONE 'Europe/Istanbul')
  AND status IN ('SUBCONTRACTOR_CONSUMED','TAMBUR_CONSUMED','KARTELA_CONSUMED','CANCELLED');
```
| Ölçüm | Saha | Dev |
|---|---|---|
| Finalize ayından SONRAKİ ayda ölü kümeye geçen top | **4 top / 698,0 m** (`T200726F0002/0003/0005/0006`, Temmuz → Ağustos) | — |
| Aynı ay içinde ölü kümeye geçen (dönem içi düzeltme) | 87 top / 6.084,2 m (Ağustos) | — |
| Bu topların iptal izi | **0/4** `cancelledAt` | — |

**İş etkisi.** Karne rakamları geçmişe dönük oynak; "Temmuz'da ne ürettik" sorusunun cevabı ne zaman sorulduğuna bağlı. Fabrika, primi/kapasiteyi bu rakamlarla konuşuyorsa fark tartışma yaratır ve kaynağı gösterilemez.
**Öneri.** ① Karne sorgusuna "dönemde finalize edildi ama artık ölü kümede" satırını **ayrı bir bant** olarak ekle (rakamı sessizce düşürmek yerine "Temmuz: 55.275 m üretildi, sonradan 698 m geri alındı" de). ② Uzun vade: dönem raporu için `finalizedAt` anındaki metrajın snapshot'ı (`RollProductionSnapshot`) ya da mevcut `roll_variances` defterinin dönem bazlı okunması. ③ Geri alma/iptal yollarının iz kolonlarını doldurması (Tur 1 `BULGU-T1-033` ile aynı düzeltme) — sapmanın **sebebi** olmadan bant da yorumlanamaz. Veri dokunuşu YOK.
**Kabul kriteri.** Kapanmış bir ayın karnesi, o ay finalize edilip sonradan geri alınan metrajı ayrı satırda gösterir; bekçi: finalize → iptal senaryosunda dönem toplamı + geri alınan bandı toplamı sabit kalır.
**Efor.** 1,5 gün.
**Önceki defter.** Tur 1 `BULGU-T1-072` çürütücüsünün önerdiği sınıf (orada `SUBCONTRACTOR_CONSUMED` yolu anlatılmıştı); burada **iptal** yolu canlı veriyle ölçüldü. `BULGU-T1-001` (metraj mutlak yazımı) ve `BULGU-T1-032` (damga) komşu ama ayrı kök nedenler.

---

## 3. Uygulanan kontrol listesi

Görev metnindeki her madde:

| Madde | Durum |
|---|---|
| `currentQty < 0` | **uygulandı** — V1-01, saha 0 / dev 0 |
| `currentQty > initialQty` | **uygulandı** — V1-02, saha 2 (bilinçli, T1-044; kök neden `TAMBUR_UNDO_REOPEN` ile doğrulandı) |
| Kesim çocukları toplamı ≠ parent (`parentRollId` zinciri, §13/tambur-undo emsali) | **uygulandı** — V1-05/V1-07 → **V-1-01** (8/116 tutmuyor, 185,7 m izsiz) |
| `WAREHOUSE` ama `finalizedAt NULL` | **uygulandı** — V1-17 → **V-1-06** (4 top) |
| `SHIPPED` ama `SackAllocation` yok | **uygulandı** — V1-10 → **V-1-03** (81 top / 3.040,2 m) |
| `CANCELLED` ama movement var | **uygulandı** — V1-11, açık hareket 0 (kapanmış hareketler meşru) |
| `IN_PRODUCTION` ama `currentStepId NULL` | **uygulandı** — V1-12, 0 |
| `AT_SUBCONTRACTOR` ama açık fason sevki yok | **uygulandı** — V1-13, 0 |
| form/barcode tutarsızlığı (WAREHOUSE barkodsuz) | **uygulandı** — V1-08, 0 |
| `statusChangedAt`/`finalizedAt` trigger tutarlılığı (`createdAt > updatedAt`, `finalizedAt < createdAt`) | **uygulandı** — V1-14/15/16/18 → **V-1-05** |
| `entrySource ↔ parentReceiptId ↔ parentRollId` | **uygulandı** — V1-19, 0 |
| `qualityGrade ↔ status` (FİRE→SCRAP, 1.Kalite→WAREHOUSE) | **uygulandı** — V1-20, 4 satır (2026-08-20 kararından önceki kayıtlar, bilinçli) |
| Sapma defteri: `RollVariance` toplamları ↔ top metrajı; `sourceRefId` yetimleri | **uygulandı** — V1-24 (yetim 0) + V1-07 aritmetiği → **V-1-01/V-1-02** |
| Aynı barkod / aynı top çift kayıt (2026-08-04 vaka sorgusu, 90 sn) | **uygulandı** — V1-32: tuzağın kendi predikatıyla 26 çift; incelendi, **meşru seri giriş** (aynı partiden eşit metrajlı toplar); bulgu yazılmadı. Aynı `clientToken` iki top: 0 (partial unique) |
| Movement zinciri: `qtyOut ≠ qtyIn` olmaması gereken yerler | **uygulandı** — V1-21, §12 muaf desenleri çıkarıldığında **0** |
| `exitedAt NULL` çoklu açık hareket (bir top iki istasyonda) | **uygulandı** — V1-22, 0 / 0 |
| Batch: canlı top sayısı, kapanış, aynı `batchNumber` canlı çakışması (ölç ve raporla) | **uygulandı** — V1-28/29/30 → **V-1-04** (61 numara) |
| `roll_plan_deviations` | **uygulandı** — V1-27, tablo boş (kapı deploy sonrası); ihlal aranamaz |
| `roll_errors` | **uygulandı** — V1-26, 3 kayıt, açık-ölü eşleşmesi 0 |
| `roll_operations` | **uygulandı** — V1-25, mükerrer 0 |
| K10 sorgularını koş ve genişlet | **uygulandı** — Q-STK-01…15, Q-PAR-01…07, Q-MD-04 koşuldu; genişletmeler: kesim aritmetiği (yeni), sevkiyat tahsis kapsaması (yeni), parti canlı çakışma (yeni), damga sırası (yeni), dönem kararlılığı (yeni) |
| §12 (movement kapanış semantiği) saha koşumu | **uygulandı** — muaf desenlerle birlikte, 0 (K10'un "Tur 2" bıraktığı bölüm) |
| §20 (adım statüsü türetimi) saha koşumu | **uygulandı** — 1 satır; belgeli kör nokta, bulgu değil (K10'un "Tur 2" bıraktığı bölüm) |
| Kod tarafında geriye izleme (audit satırı → uç → kod satırı) | **uygulandı** — ancak `system_logs.changes` bu yollarda **boş** geliyor (aşağıda sınır ötesi not); izleme `roll_movements.notes` (`TAMBUR_UNDO_REOPEN`, `KURSUN_BYPASS_FINISHED:…`, `WO_CLOSE_*`) ve soyağacı üzerinden kuruldu |
| §7b/§7c/§24a/§25 saha koşumu | **kapsam dışı — alanım değil** (kartela/çuval çift-sayım, fason kalem açıklığı, etiket bayatlığı); K10 bunları Tur 2'ye bırakmıştı, ilgili denetçiye Sınır ötesi notlarda bırakıldı |
| Repro (K3) | **kapsam dışı — sözleşme gereği yalnız D-A/D-B denetçileri**; ayrıca salt-okunur oturumda dev DB'ye yazan repro script'i çalıştırılamaz |

---

## 4. Doğru yapılanlar (korunması gereken kalıplar)

1. **Movement kapanış semantiği gerçekten temiz ve muafiyet listesi TÜRETİLMİŞ.** `test_consistency.ts` §12'nin muaf desenleri `DISPOSITION_NOTE_PREFIXES`'ten türetiliyor (elle kopyalanmıyor) ve yorumu "dördüncü bir origin eklenirse muaf sessizce eksik kalır" diye açıkça uyarıyor. Sahada §12 gerçekten 0 — 7 sapan satırın hepsi meşru desende. Bu, "bekçiyi veriye uydurmak" değil, "semantiği ayırmak"ın örneği.
2. **`entrySource ↔ parentRollId ↔ parentReceiptId` üçlüsü 2.431 satırda kusursuz** (1.040 kesim çocuğunun 1.040'ında parent, 149 fason dönüşü topunun 149'unda makbuz). Köken alanlarının tek yazma noktasından geçmesi işe yaramış.
3. **`preTamburCloseQty`/`preTamburCloseStatus` kararı ("türetme yerine KAYIT")** ve şemadaki gerekçe metni, bir hatanın kök nedenini kolona yazmanın iyi örneği; `computeRestoredQty`'nin başlığında "bu kolon bu hesapta KULLANILMAZ" uyarısı ileride birinin yanlış kolonu okumasını engelliyor.
4. **Sapma defteri disiplini:** 75 satırın hepsi `qty > 0`, `sourceRefId` yetimi yok, tek yazıcı (`recordVarianceTx`) ve tx içinde. `sourceRefId`'nin "terslemenin adresi" olarak konumlandırılması (fason çekme kararı) doğru soyutlama.
5. **Partial unique `roll_movements_one_open_per_roll_step_uq`** yarışın veri tarafını gerçekten kapatmış: 1.107 harekette çift açık kayıt 0, bir topun iki adımda açık olması 0.

---

## 5. Sınır ötesi notlar

| Gözlem | Yönlendirme |
|---|---|
| **`system_logs.changes` bu alanın yazma yollarında BOŞ.** İhlalli iki topun (`95c15daf…`, `92d0ef12…`) 5 `UPDATE ROLL` audit satırının hiçbirinde alan diff'i yok; kök neden izini `roll_movements.notes` üzerinden kurmak zorunda kaldım. "Kim ne zaman hangi metrajı yazdı" audit'ten cevaplanamıyor | ② AUD / I — gözlemlenebilirlik hücresi (K6/K10 H-7 ile aynı aile) |
| **`preTamburCloseStatus` canlıda 0/116 dolu** — yalnız `finalizeWarehouseCut` yazıyor, o yol sahada hiç kullanılmamış. Kolonun tek tüketicisi geri almanın depo dalı; ölü olup olmadığı ürün kararı | ② C — veri modeli (ölü/az kullanılan kolon envanteri) |
| **`roll_operations`: `KURSUN_APPLIED` 7 · `QC2_COMPLETED` 7** — 825 fason sevkine ve 110 Tambur işlemine karşılık kurşun/KK2 izi yok denecek kadar az. Kurşun bypass rejimi (`KURSUN_BYPASS_FINISHED` movement notu) izi movement'a yazıyor, operasyona değil; "kurşun yapıldı mı" sorusunun iki kaynağı var | ② ÜRE (üretim) hücresi |
| **`AT_SUBCONTRACTOR` 188 topun hepsinde `currentStepId` dolu ve 188 açık movement var; en eskisi 2026-08-05** (20 gün). "İstasyonda bekleyen" sayaçları bu topları içeriyorsa fason WIP fabrika içi kuyruk gibi görünür | ② ÜRE + RAPOR hücresi |
| **37 `IN_PRODUCTION` topun 29'u 7 günden, 8'i 14 günden eski** (16.867 m WIP); biri 0,1 m kalanla 11 gündür açık (`70263637…`). Takılı WIP için yaşlandırma/uyarı yüzeyi yok | ② ÜRE / H — operasyonel görünürlük |
| **Sevkiyat tarafı:** V-1-03'ün kod kökü `allocation.helper.specMatch` + `writeShipmentAllocationsTx`; sevkiyat/sipariş denetçisi INV-SEV-01/02/08 ile birlikte değerlendirmeli (K10 H-2 ile aynı komşuluk) | ② SEV / SIP hücresi |
| **Tur 1 çürütücü önerilerinden alanıma düşmeyenler** (offsite yedek, `admin:users` self-target, MULTI_BATCH ölü strateji, `nameFold` sed ayrışması, `recordPrintEvent` sürüm kaybı) ilgili alanlara bırakıldı; bu turda ölçülmedi | ② G / J / SEV / DOC hücreleri |
| **§7b, §7c, §24a, §25 saha koşumu** hâlâ açık (K10 "Tur 2"ye bırakmıştı); §12 ve §20'yi ben koştum, kalan dördü kartela/fason/etiket alanlarına ait | ② ilgili alan denetçileri |

---

## 6. Kapsanmayan / erişilemeyen

| Madde | Sebep |
|---|---|
| Canlı prod (2026-08-25 sonrası 3 gün) | Yalnız 2026-08-25 kopyası var; `SURUM-2.9.0` deploy'undan sonraki veri görülmedi. V-1-03 ve V-1-06 canlıda **yeniden ölçülmeli** |
| `roll_plan_deviations` ihlalleri | Tablo saha kopyasında **boş** (kapı deploy'dan sonra); ölçülecek satır yok |
| K3 (eşzamanlı repro) | Sözleşme gereği D-A/D-B denetçilerinin işi; ayrıca oturum salt-okunur — dev DB'ye yazan repro script'i koşulamaz. V-1-02 bu yüzden K1'de kaldı |
| `SubcontractorReceiptItem.receivedQty` NULL 635/638 | Fason alanı; kısmi kabul defterinin okunması V-2/fason denetçisine ait. Kesim aritmetiğinde fason dönüşü topları yalnız `initialQty` ile sayıldı |
| Metraj birimi/ondalık hassasiyeti (Decimal(12,3)) kaynaklı yuvarlama | Tüm karşılaştırmalar 0,01 m toleransla yapıldı; ondalık taşma aranmadı |
| `system_log_archives` | 0 satır (arşiv hiç koşmamış) → 6 aydan eski iz zaten yok; iptal/düzeltme gerekçelerinin kolonlarda yaşaması kuralı bu yüzden load-bearing |
| İstemci tarafı (Electron/mobil) davranışı | Backend denetimi kapsamı; yalnız V-1-03'te uyarının çizilip çizilmediğini doğrulamak için iki dosya grep'lendi |
| Bekçi koşumu | Hiçbir `scripts/test_*.ts` çalıştırılmadı (salt-okunur oturum); "bekçi var/yok" iddiaları dosya içeriği okunarak kuruldu |
