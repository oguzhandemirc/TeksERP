# Plan sapması defteri — geri alma damgası

> **Durum:** TASARIM (2026-09-13). Koda geçilmedi. Hüküm yönetici oturumda.
> **Kusur sınıfı:** `RollVariance` için 2026-08-09'da kapatılan *"hayalet fire"* sınıfının plan-sapma ikizi.
> **İlgili:** `docs/kurallar/tambur.md` · `docs/kurallar/defter.md` · `prisma/schema.prisma:3395-3470`

---

## §1 · Ölçülen durum

| ölçüm | değer |
|---|---|
| `RollPlanDeviation` tersleme kolonu | **YOK** (`revokedAt`/`reversedAt`/`cancelledAt` hiçbiri) |
| Yazan yol | **4** — `finalize` · `cut` · `finalize-open-fabric` (Tambur) + `fason-receipt` (fason kabul) |
| `update`/`delete` yolu (`src/` içinde) | **0** |
| Geri alma yollarından dokunan | **0** — `tambur-undo.service.ts` tabloyu import bile etmiyor |
| Karnenin `where`i | **yalnız `createdAt` aralığı** — statü yok, tersleme yok |
| Canlı satır (fabrika yedeği) | **2**, ikisi de `finalize`, ikisi de **doğru** (geri alınmamış) |
| Davranışı koruyan bekçi | **0** — `test_tambur_undo.ts`te plan sapmasına tek assert yok |

Aynı geri alma akışında **üç tersleme mekanizması zaten var** ve plan sapması hiçbirine dahil değil:
`RollVariance.reversedAt` · `RollOperation.revokedAt` · ters `WarehouseMovement` satırı.

## §2 · ⚠️ İki kusur bildirildi; ÖLÇÜM BİRİNİ DOĞRULAMADI

### ① Karne fazla sayıyor — **DOĞRULANDI**

Karne (`plan-deviation-scorecard.report.service.ts`) `where`ine yalnız tarih aralığı koyuyor (`:107`, `:187`, `:212`); `roll.status` hiçbir sorguda geçmiyor, `select`te bile çekilmiyor. ⇒ **tümden geri alınmış bir kapanışın sapması karnede tam ağırlıkla görünmeye devam eder.**

En ağır hâli: `finalize` kaynağında `qtyM` topun TAMAMIDIR. Geri alınıp yeniden finalize edilen bir top **iki tam imza + iki tam metraj** üretir.

### ② Kapı soruyu bastırıyor — **DOĞRULANMADI**

İlk bildirimde bastırmanın sahibi `tambur-undo` sanıldı. Ölçüm başka söylüyor:

- Kapının `findFirst`i (`tambur-plan-gate.helper.ts:87`) **yalnız `source = "fason-receipt"`** satırlarına bakar ve `rollValue`/`planValue` eşitliği arar.
- Tambur geri alması bir **fason kabul onayını** geçersiz kılmaz — kumaş gerçekten farklı renk döndü ve bu kabulde onaylandı. O satırın yaşaması **doğrudur**.
- Fason kabul iptali (`subcontractor.service.ts:5148 cancelReceipt`) doğan topları **zorunlu cascade ile iptal eder** (`:5257`; tüm `bornRolls` onaylanmadan 409). İptal edilmiş top Tambur'a hiç ulaşmaz; yeniden kabul **yeni id'lerle** yeni toplar doğurur ve onların sapma satırı yoktur ⇒ **soru tekrar sorulur.**

⇒ Bildirilen biçimiyle bu kusur **yok.** Kalan tek açık uç, doğrulanmamış bir kenar durum:

> **AÇIK SORU:** kabul iptaliyle `CANCELLED` olmuş bir top *"İptali Geri Al"* ile diriltilebiliyor mu? Diriltilebiliyorsa, artık geçersiz bir kabulün sapma satırı canlı topa geri yapışır. (`roll-cancel-restore.helper.ts:137-144` yalnız `TAMBUR_GERI_ALMA` sebebini reddediyor.) Ölçülmedi.

📌 Bu kenar durum kapıya `revokedAt IS NULL` süzgeci eklemeyi **ucuz sigorta** yapar — ama bu, kanıtlanmış bir kusurun onarımı değildir ve öyle yazılmaz.

## §3 · Karar: DAMGA, karşı kayıt DEĞİL

`revokedAt` + `revokedById` + `revokeReason` eklenir. Karşı (negatif) satır **reddedildi**, ve gerekçe ölçüldü:

Karne onayı `COUNT(DISTINCT confirmationId)` ile, metrajı **confirmationId başına tek `qtyM`** ile sayıyor (`collapseByConfirmation`, `:91-99`). Bir karşı satır ya yeni bir `confirmationId` doğurur (onay sayısını **artırır**) ya mevcut olanı tekrarlar (`qtyM` belirsizleşir). İkisi de sayacı bozar.

Ad seçimi **`revokedAt`**: geri alınan şey bir *miktar* değil bir **operatör imzasıdır** — `RollOperation.revokedAt` emsali (`RollVariance.reversedAt` miktar terslemesidir, bu değil).

### ⚠️ Tanecik: `confirmationId`, satır DEĞİL

Şemanın kendi başlığı `confirmationId`i **LOAD-BEARING** ilan ediyor: renk *ve* en birlikte saparsa **2 satır ama BİR imza** doğar. ⇒ Damga da imza düzeyinde atılır:

```
updateMany WHERE { confirmationId, revokedAt: null }
```

Tek satırı damgalayıp diğerini bırakmak **bir imzayı yarım geri almaktır**. (Aynı sınıf tezgah tasarımında mühür atomikliğiyle bir kez öğrenildi: *bir tasarım bir taneciği böldüğünde ona dayanan her yüklem yeniden sorulur.*)

## §4 · Hangi dal damgalar — FULL ve kısmi AYRI sorulardır

⚠️ `tambur-undo.service.ts`te *"bazı çocuklar kalsın"* anlamında kısmi FULL **yoktur** (bilinçli kapsam sınırı, `:51-54, :66`). Yerine üç dar mod var; her biri ayrı cevap alır.

| mod | damgalar mı | hangi satırları | gerekçe |
|---|---|---|---|
| **FULL** (`applyFull:1542`) | ✅ **evet** | `rollId = parent AND workOrderStepId = stepId AND revokedAt IS NULL` | kapı geçişinin tamamı geri alınıyor: ana top diriliyor, çocuklar iptal, adım ve WO açılıyor — plan-dışı kimliğin depoya inmesine izin veren onay artık geçersiz |
| **SINGLE** (`applySingle:1105`) | ✅ **yalnız çocuğa bağlı olanı** | `childRollId = <iptal edilen çocuk> AND revokedAt IS NULL` | o kesimin metrajı depoda kalmadı ⇒ karne o kadar fazla sayar. ⛔ `finalize` satırı (`childRollId` NULL, `qtyM` = topun tamamı) **DAMGALANMAZ** — topun geri kalanı hâlâ sapan kimlikle depoda |
| **SINGLE_RESTORE** (`:1298`) | ✅ **aynı SINGLE gibi** | aynı yüklem | kardeşler iptal edilmiyor, kapanış kararı ayakta; bu mod zaten `RollVariance`ı da terslemiyor (`:1290-1292`) — aynı mantık |
| **MANUAL** (`:1073`) | — | — | bu yolda sapma satırı hiç doğmaz |
| **FULL / depo kesimi dalı** (`stepId = null`) | — | — | WO yok ⇒ kapı hiç koşmaz ⇒ satır üretilmez |

**FULL yükleminin zarafeti — `revokedAt IS NULL` süzgeci döngüyü kendiliğinden çözer:** geri al → yeniden finalize → tekrar geri al senaryosunda ilk kapanışın satırları zaten damgalıdır ve yüklemin dışında kalır; ikinci geri alma yalnız ikinci imzayı damgalar. Ek bir zaman/sıra koşuluna gerek yok.

## §5 · İKİ okuyucu da süzer — biri unutulursa kusur yarım kapanır

**(a) Karne** — üç sorgunun **üçüne birden** `revokedAt: null` eklenir:
`findMany` ana sorgu (`:109`) · ham SQL gün serisi (`:186`, `DISTINCT ON` iç sorgusuna) · karşılaştırma dönemi `findMany` (`:211`).
⚠️ `summary.byField` bilinçli olarak **satır bazlıdır** (`:133-142`); damga aynı `where`den geldiği için o kırılım da kendiliğinden temizlenir — ayrı bir iş değildir.

**(b) Kapı** — `findFirst` (`:87`) `revokedAt: null` alır. §2②'de yazıldığı gibi bu **kanıtlanmış bir kusurun onarımı değil**, kenar duruma karşı ucuz sigortadır ve öyle etiketlenir.

## §6 · Geçmiş veri: DAMGALANACAK BİR ŞEY YOK

Ölçüldü (fabrika yedeği, 2026-09-13): **2 satır, ikisi de `finalize`, iki ayrı `confirmationId`, iki ayrı top, ana toplar `TAMBUR_CONSUMED`, iş emri `IN_PROGRESS`.** Hiçbiri geri alınmamış; ikisi de **doğru satır**.

⇒ **Backfill YOK, geriye dönük damga YOK, geçiş dönemi YOK.** Migration tamamen additive.

📌 Bu, kusurun önemsiz olduğu anlamına gelmez: *satırlar küçük olduğu için doğru değil, defter henüz büyümediği için yanlış satır doğmadı.* İlk geri almada doğar.

## §7 · Şema başlığı AYNI COMMIT'TE yeniden yazılır

`prisma/schema.prisma:3419` bugün şöyle diyor:

> *"Append-only: satır SİLİNMEZ, GÜNCELLENMEZ (bu yüzden `updatedAt` yok)."*

`revokedAt` bir **durum bayrağıdır** ve doktrinin bilinçli istisnasıdır (`VERITABANI.md` [DB-38]: *"DURUM BAYRAĞI bu kuralın DIŞINDADIR"*; emsaller `RollOperation.revokedAt`, `RollVariance.reversedAt`). Ama cümle olduğu gibi kalırsa **iki cümle yan yana durur** — kural kitabının kendi yasağı.

⇒ Aynı commit'te: *"Append-only: satır SİLİNMEZ ve içeriği GÜNCELLENMEZ; tek istisna geri alma DURUM BAYRAĞIDIR (`revokedAt`/`revokedById`/`revokeReason`) — imza silinmez, geçersiz işaretlenir."*

## §8 · Bekçi

**Yeni:** `test_plan_deviation_undo.ts` (bugün **YOK**; `test_tambur_undo.ts`te plan sapmasına tek assert yok, `test_plan_deviation_scorecard.ts` yalnız çift-sayım kilidini ölçüyor).

Ölçeceği dört şey:
1. FULL geri alma sonrası o kapanışın **tüm** satırları `revokedAt` dolu (imza bütünlüğü: aynı `confirmationId`in 2 satırlı hâlinde ikisi de).
2. SINGLE sonrası **yalnız** çocuğa bağlı satır damgalı, `finalize` satırı **damgasız**.
3. Karne damgalı satırı saymıyor — üç sorgunun üçünde de (gün serisi dahil).
4. **Negatif sonda (zorunlu):** karnenin `where`inden `revokedAt` süzgeci düşürülünce **kırmızı**; ve FULL dalından damga çağrısı düşürülünce **kırmızı**. Yeşil koşum kanıt değildir.

## §9 · Açık sorular

- **Kenar durum ölçülmedi:** kabul iptaliyle `CANCELLED` olan top *"İptali Geri Al"* ile diriltilebiliyor mu (§2②).
- **Kapsam dışı bırakıldı:** iptal edilmiş TOPUN (Tambur dışı, Envanter'den `softDelete`) sapma satırı da karnede kalıyor. Bu ayrı bir sorudur — *"top iptal edildi"* ile *"onay geri alındı"* aynı şey değil; biri malı, öteki imzayı iptal eder. Damga mekanizması kurulduktan sonra ayrıca sorulmalı.
- **`RollOperation` mirası:** kesimde çocuklara yazılan `KURSUN_APPLIED`/`QC2_COMPLETED` satırları geri almada **hiç damgalanmıyor** (`tambur.service.ts:3266-3277`) — bu tasarımın kapsamı dışında ama aynı ailede duran ikinci bir açık.
