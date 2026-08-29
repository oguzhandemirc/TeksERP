# DOĞRULAMA — BULGU-T1-009 (TUR 1, ③ sonrası)

**Başlık:** İş emri iptali fason sevkini kapatamazsa fasondaki mal HAM STOĞA düşer ve açık sevk ortada kalır
**Modül:** WO / Fason · **Kategori:** D (transaction sınırları) · **Dosya:** `Teks-Erp/src/services/workorder.service.ts:3253-3283, 3376-3444, 3506-3520`

| | Giriş | Çıkış |
|---|---|---|
| Kanıt seviyesi | K1 | **K3** (dev DB'de davranışsal repro, 10/10 deterministik) |
| Şiddet | S1 | **S1 (değişmedi)** — gerekçe §5 |
| Karar | — | **DOĞRULANDI** |

---

## 1. K2 — veride fiili ihlal araması (sonuç: 0, ama maruziyet ÖLÇÜLDÜ)

Sorgu: `audit/data/BULGU-T1-009.sql` · Ham çıktı: `audit/data/BULGU-T1-009.txt`
Koşum: `audit/tools/sql-saha.sh` (prod'un 2026-08-25 kopyası `tekserp_saha_0825`) + `audit/tools/sql-dev.sh` (`adnansahin_db`). İkisi de salt-okunur.

Beş bölüm: **S1** açık+outstanding sevk kaleminin toplarının statü kırılımı · **S2** ihlal örnekleri (top fasonda DEĞİL) · **S3** iptal WO'ya bağlı açık sevk · **S4** maruziyet tabanı · **S5** STOCK + iptal edilmemiş sevk kalemi.

| Bölüm | SAHA (prod kopyası) | DEV |
|---|---|---|
| S1 — açık+outstanding sevkin topları | **AT_SUBCONTRACTOR 188 top / 21.169,89 m — başka statü YOK** | 0 satır |
| S2 — İHLAL örnekleri | **0** | 0 |
| S3 — iptal WO + açık sevk | **0** | 0 |
| S5 — STOCK + iptal edilmemiş sevk | **0** | 0 |

**S4 — maruziyet tabanı (bu bulgunun neden henüz veride görünmediğini AÇIKLAYAN sayılar):**

| Ölçüm | SAHA | DEV |
|---|---|---|
| Kısmi kabul kalemi (`isPartial = true`) — **tetikleyicinin kendisi** | **1** | 0 |
| Aktif makbuz | 143 | 50 |
| Toplam CANCELLED iş emri | 22 | 2 |
| 2026-08-17'den (fason karar modalı) sonra iptal edilen WO | **2** | 0 |
| Açık sevk | 190 | 55 |

> **Yorum:** "ihlal 0" bir koruma kanıtı DEĞİL, bir **maruziyet kanıtı**dır. Yolun koşması için üç şeyin
> aynı iş emrinde buluşması gerekiyor: (a) açık fason sevki, (b) o sevke bağlı kısmi/aktif makbuz,
> (c) fason karar modalıyla yapılan bir WO iptali. Sahada (a) 190 kez var, (b) **hayatında 1 kez**
> olmuş, (c) özellik 2026-08-17'de açıldığından beri **2 kez** koşmuş. Kesişim henüz boş.
> Kısmi kabul 2026-08-19'da eklenen yeni bir özelliktir; kullanım arttıkça kesişim dolacaktır.
> Bu yüzden K2 yolu bulguyu yükseltemedi — yükseltme **K3'ten** geldi.

---

## 2. K3 — davranışsal repro (TETİKLENDİ)

Script: `Teks-Erp/scripts/audit_repro_BULGU-T1-009.ts` (tek yazma iznim) · Log: `audit/repro/BULGU-T1-009.log`
Koşum: `cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-009.ts`
Sözleşme uyumu: `devDbGuard()` (yerel host + `adnansahin_db` dışı REDDEDİLİR) · fixture damgası `AUDITREPRO-T1009-<rastgele6>` · ölçüm **commit sonrası DB'den** · temizlik `finally`'de FK sırasına göre (`rollVariance` dahil) · dış dünyaya çağrı yok · global ayar/feature-flag değiştirilmedi.

> **Yarış GEREKMİYOR.** Bu bir eşzamanlılık bulgusu değil, **tx sınırı** bulgusudur: `prepareFasonCancelDecision`
> asıl transaction'dan ÖNCE ve ONUN DIŞINDA yazıyor. Bu yüzden sözleşmenin "tek istekle davranışsal kanıt"
> dalı uygulandı (N paralel değil, 10 sıralı tekrar).

### Kurulan durum (kısmi kabulün birebir aynası)
100 m fasona gitti → 51 m kabul edildi (`isPartial = true`) → **49 m fasonda kaldı**.
Kaynak top `AT_SUBCONTRACTOR` + `currentQty = 49`; born top makbuzdan doğdu (`entrySource = SUBCONTRACTOR_RETURN`,
`producedInStepId = fason adımı`) — `subcontractor.service.ts:3028-3086`'nın ürettiği alanların aynısı.
Sonra: `workOrderService.softDelete(woId, undefined, { fasonAction: "RETURN_TO_STOCK" })`.

### ÖN KOŞUL ölçümü (zincirin ilk halkası gerçekten kopuyor mu?)
```
✅ kısmi makbuzlu sevk cancelBulk'ta DÜŞÜYOR (failed[])
   cancelled=0 failed=["Mal kabul yapılmış sevk iptal edilemez (kabul: …-SR-PRE). Önce kabul iptal edilmeli."]
✅ cancelBulk yine de success:true dönüyor  ← çağıran failed[]'i okumazsa hata TAMAMEN kaybolur
```
Yani `cancel()`'ın `acceptedReceiptItem` yükleminde `isPartial` süzgeci olmadığı için (`subcontractor.service.ts:1963-1971`)
**kısmi makbuz da sevk iptalini 409'la engelliyor**; `cancelBulk` bunu `failed[]`'e yazıyor
(`:2245-2252`) ve `workorder.service.ts:3253-3256` dönüş değerini atıyor. Zincir burada kopuyor.

### A) Fason SON adım — istek 200 döner, mal ham stoğa düşer
```
önce: roll=AT_SUBCONTRACTOR(49m) sevk_açık=true
sonra: istek=BAŞARILI(200) roll=STOCK step=null sevk_açık=true wo=CANCELLED
❌ İHLAL: sevk …-FS-A AÇIK ama top STOCK (49 m iki yerde sayılıyor)
```
Failure_mode birebir gerçekleşti: kullanıcı **yeşil onay** alır, fason ekranında 49 m hâlâ "bizde/dışarıda"
görünür, Ham Stok'ta ise aynı 49 m **üretime planlanabilir** hâldedir. Hata yok, uyarı yok, log yok.

### B) Fason ARA adım — istek 409 verir ama tx DIŞI yazım KALICIDIR
```
önce: roll=AT_SUBCONTRACTOR(49m) sevk_açık=true
sonra: istek=HATA(FASON_DECISION_REQUIRED) roll=IN_PRODUCTION sevk_açık=true wo=IN_PROGRESS
❌ İHLAL: istek 409 döndü ama top AT_SUBCONTRACTOR → IN_PRODUCTION olarak KALDI
```
Bu, bulmayı yapan raporda **öngörülmemiş ikinci tezahür**dür ve mekanizmayı tartışmasız kanıtlar:
born top (`IN_PRODUCTION` + `SUBCONTRACTOR_RETURN`) tx içi guard'ı tetikler, **tüm tx geri sarılır** —
ama `residual updateMany` tx'in DIŞINDA olduğu için geri sarılmaz. İstek başarısız, veri değişmiş.

### B2) Yazım YENİ ve KALICI bir kilit bırakıyor
Kullanıcıya söylenen şey "önce kabulü iptal edin". Bunu yaptıktan sonra bile:
```
❌ tx DIŞI yazım YENİ bir kilit bıraktı → ROLLS_MOVED_PAST_DISPATCH:
   "1 top fason sevkten sonra taşınmış veya statüsü değişmiş — sevk iptal edilemez."
```
`cancel()`'ın `movedRolls` savunması (`status ≠ AT_SUBCONTRACTOR`) artık **bizim kendi yazdığımız**
statüyü görüyor. Sevk çıkmaz sokakta: makbuzu iptal ettiniz, sevk hâlâ iptal edilemiyor, top ne
fasonda ne stokta — `IN_PRODUCTION` limbosunda.

### Tekrarlanabilirlik
```
tekrar 1..10 → ihlal=3 (hepsinde)
```
**10/10 — deterministik.** Yarış penceresi yok, zamanlamaya bağlı değil; kod yolu koşulsuz.
Fixture temizliği doğrulandı: koşum sonrası dev DB'de `AUDITREPRO-T1009%` damgalı 0 kayıt
(items/subcontractors/work_orders/dispatches/receipts).

---

## 3. Koruma kontrolü — yeniden doğrulandı (altı kaynak)

| Koruma | Durum | Kanıt |
|---|---|---|
| DB kısıtı (CHECK/trigger/FK) | **YOK** | `Roll.status` ↔ açık `SubcontractorDispatchItem` arasında hiçbir kısıt yok (`prisma/schema.prisma`) |
| Atomik claim / kilit | **YOK** | `residual updateMany` (`:3271-3283`) koşulsuz, statü guard'sız, **tx DIŞINDA** |
| Tx içi guard | **VAR ama KÖR** | `fasonInFlight` (`:3423-3444`) `AT_SUBCONTRACTOR` arar; residual yazımı statüyü zaten `IN_PRODUCTION` yapmış → `count=0`. Guard'ın kendi yorumu "buraya düşmek, kararın uygulanamadığı anlamına gelir" diyor — tam da o durumu göremiyor |
| Feature-flag | **YOK** | Yol koşulsuz; bayrak gerektirmez |
| Mutabakat sorgusu | **KÖR** | `scripts/consistency-check-derived.sql` §24a (`:151`) ve §24b (`:166`) **ikisi de `r.status = 'AT_SUBCONTRACTOR'` süzgeci taşıyor** → "açık sevkin topu artık fasonda DEĞİL" sorusu hiç sorulmuyor. (§24b'de süzgeç bilinçli ve gerekçeli — doğrudan-sevk yanlış pozitifi. Eksik olan, bu üçüncü soruyu soran ayrı bir bölüm.) |
| Bekçi scripti | **KÖR NOKTA** | `scripts/test_wo_cancel_fason.ts:113-118` yalnız *"fasondaki top HAM STOĞA döndü ✅"* mutlu yolunu ölçüyor; fixture'ında **hiç dispatch yok**, dolayısıyla `cancelBulk`'ın düştüğü dal hiç koşmuyor. Bekçinin kör noktası hatanın yeriyle aynı |

---

## 4. Bulmanın iddialarının teyidi

| Bulmanın iddiası | Doğrulama |
|---|---|
| `cancelBulk` dönüş değeri (`failed[]`) okunmuyor | ✅ `:3253-3256` — `await new SubcontractorService().cancelBulk(...)`, atama yok |
| Kısmi makbuz sevk iptalini engelliyor (`isPartial` süzgeci yok) | ✅ ÖN KOŞUL ölçümü: `cancelled=0, failed=1` |
| `residual updateMany` tx DIŞINDA, telafisiz | ✅ B dalı: tx geri sarıldı, yazım kaldı |
| Tx içi fason guard'ı bu yüzden `count=0` görüyor | ✅ A dalı: guard geçti, WO CANCELLED oldu |
| Blanket `updateMany` topu STOCK'a çekiyor | ✅ A dalı: `roll=STOCK, step=null` |
| İstek 200 dönüyor, kullanıcı uyarı almıyor | ✅ A dalı: `istek=BAŞARILI(200)` |
| Aynı metraj iki yerde sayılıyor | ✅ A dalı: sevk açık + top STOCK, 49 m |
| **[YENİ]** 409 dalında da kalıcı bozulma var | ✅ B — bulmada yoktu, doğrulamada çıktı |
| **[YENİ]** Bozulma sevki KALICI olarak iptal edilemez yapıyor | ✅ B2 — `ROLLS_MOVED_PAST_DISPATCH` |

Çürütülen iddia: **yok.**

---

## 5. Şiddet — S1'de KALIYOR (enflasyon yapılmadı)

K3 elde edildiği için S0 kapısı teknik olarak açık. Yine de S1'de bırakıyorum:

- **Etki: yüksek** (tutarsız veri — fabrikada fiziksel olarak olmayan kumaş üretime planlanabilir; ayrıca çıkmaz sokağa düşmüş sevk). Mali/mevzuat kaybı ya da geri dönüşsüz veri kaybı DEĞİL: kayıtlar duruyor, elle düzeltilebilir.
- **Olasılık: düşük — ÖLÇÜLDÜ.** Tetikleyicinin (kısmi kabul) sahada toplam **1** örneği, karar modalıyla iptalin **2** koşumu var. Kod yolu deterministik ama giriş koşulu nadir.
- **Düzeltici modifikatör: sessiz ve alarmsız → +1 kademe.** Bu zaten S1'i üreten yükseltmedir (düşük olasılık × yüksek etki → S2; sessizlik → S1).
- Kısmi kabul kullanımı arttıkça olasılık yükselir; o zaman S0 yeniden değerlendirilmelidir.

---

## 6. Düzeltme için not (2. tura)

Mekanik kök neden **iki cümle**: (a) yan servisin kısmi başarısı okunmuyor, (b) telafi yazımı asıl tx'in dışında.
Düzeltmenin şekli (uygulama 2. turun işi):
1. `cancelBulk` sonucu okunacak; `failed.length > 0` ise iptal **başlamadan** 409 + hangi sevkin neden kapanmadığı.
2. `residual updateMany` ya asıl tx'e alınacak ya da statü-koşullu atomik claim'e çevrilecek (`WHERE status IN (AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR)` + `count` kontrolü) ki tx geri sarıldığında iz kalmasın.
3. `cancel()`'ın `acceptedReceiptItem` yüklemine `isPartial: false` eklenip eklenmeyeceği **ayrı bir iş kararıdır** (kısmi kabul edilmiş sevk iptal edilebilmeli mi?) — bu bulgu onu gerektirmiyor, ama gerekçesi burada görünür oldu.
4. Mutabakat: `consistency-check-derived.sql`'e §24c — *"açık+outstanding sevk kaleminin topu artık fason statüsünde değil"* (bu doğrulamanın S2 sorgusu birebir kullanılabilir).
5. Bekçi: `test_wo_cancel_fason.ts`'e **dispatch + kısmi makbuz taşıyan** bir dal; `audit_repro_BULGU-T1-009.ts` bunun hazır iskeletidir.

**Migration gerekmez, izin gerekmez, APK gerekmez, feature-flag gerekmez.** `[PROD'DA ÇALIŞTIRMA]` uyarısı gerektiren veri düzeltmesi de yok — sahada ihlal 0.

---

## 7. Üretilen dosyalar

| Dosya | İçerik |
|---|---|
| `audit/data/BULGU-T1-009.sql` | 5 bölümlü K2 sorgusu (salt-okunur) |
| `audit/data/BULGU-T1-009.txt` | saha + dev ham çıktı |
| `Teks-Erp/scripts/audit_repro_BULGU-T1-009.ts` | K3 repro (devDbGuard + damgalı fixture + finally temizliği) |
| `audit/repro/BULGU-T1-009.log` | koşum logu + 10 tekrar özeti |

## KAPSANMAYAN / ERİŞİLEMEYEN
- **Canlı prod'a erişim yok** — K2 prod'un 2026-08-25 kopyası üzerinde koştu. 25 Ağustos'tan bugüne (28 Ağustos) sahada bu üçlü kesişim oluştuysa görülemez.
- Repro `receive()`/`dispatch()` servislerini uçtan uca çağırmak yerine **kısmi kabul sonrası durumu** doğrudan kurar (fixture zinciri aksi hâlde script bütçesini aşıyordu). Alanlar `subcontractor.service.ts:3028-3086`'daki born-roll yazımıyla birebir eşlendi; sapma riski, kabul edilen tek modelleme varsayımıdır.
- `directShippedAt` dolu (doğrudan sevk) dalı ölçülmedi — `OPEN_OUTSTANDING` onu zaten dışlıyor, bu bulgunun kapsamında değil.

## SINIR ÖTESİ NOTLAR
1. **(→ F — API/toplu uçlar, kısmi başarı)** `SubcontractorService.cancelBulk` `success: true` + `failed[]` döndüren bir **kısmi başarı** sözleşmesidir. Bu doğrulamada **iç çağıranın** onu okumadığı ölçüldü. Aynı desendeki diğer toplu uçların (kurşun dağıtım, toplu iade, merge, import) iç çağıranları da taranmalı — dış istemci `failed[]`'i gösteriyor olabilir ama servis-servis çağrıda hata sessizce buharlaşıyor.
2. **(→ I — hata/gözlemlenebilirlik)** `prepareFasonCancelDecision`'ın "sevk iptali yarıda kalsa bile mal kayden içeri girmiş olur (fiziksel gerçeğe daha yakın son durum)" yorumu (`:3196-3199`) bilinçli bir tasarım tercihini anlatıyor — ama o tercih **hiçbir yere iz bırakmıyor**: ne audit, ne uyarı, ne `ApiResponse.warnings`. Bilinçli bir yarım-işlem, sessiz olduğu anda bir arızadan ayırt edilemez hâle geliyor.
3. **(→ K — test/bekçi kör noktası)** `test_wo_cancel_fason.ts` fixture'ında hiç `SubcontractorDispatch` yok; "fasonda top" durumu yalnız `Roll.status = AT_SUBCONTRACTOR` yazılarak taklit ediliyor. Bekçi bu yüzden yolun **sevk tarafını hiç koşturmuyor**. Aynı taklit deseninin başka fason bekçilerinde de olup olmadığı taranmalı.
