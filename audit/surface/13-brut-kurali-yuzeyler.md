# 13 — "Sevk rakamı brüttür" kuralının YÜZEY TABLOSU

> **B5 (`SEV.dogruluk`) oturumunun çıktısı.** 2026-08-09'da her yüzey tek tek okunarak
> üretildi. Kural beş kez, beş ayrı saha vakasından sonra genişletildi — bu tablonun amacı
> altıncı vakayı önlemek: **yeni bir sevk-metrajı yüzeyi eklerken bu tabloya satır ekle.**

## Kök neden (tek satır)

`return.service.ts:322-325` — `RollReturn` yaratıldığında topun **`sackId` VE `shipmentId`
alanları NULL'lanır**. Bu yüzden canlı her sorgu tanım gereği **NET** okur; brüt isteyen her
yüzey `RollReturn`'den **geri-ekleme** yapmak zorundadır.

## Yüzey tablosu

| # | Yüzey | Kaynak | Brüt? | Dedup | `prevSackId` yoksa |
|---|---|---|---|---|---|
| 1 | `getDispatchReport` (fiş) | **donmuş `PrintedDocument.snapshot`** (yoksa canlı + `frozen:false`) | ✔ tanım gereği | gerekmez (snapshot) | uygulanamaz |
| 2 | `listShipments.attachTotals` (liste) | canlı `groupBy` + `RollReturn` geri-ekleme | ✔ | **✘ YOK** → `F-SEV-ESZ-002` | uygulanamaz (çuval kırılımı yok) |
| 3 | `accounting-export.service` (Excel) | canlı + `RollReturn` geri-ekleme (`:255`) | ✔ | tek geçiş, çakışma yok | uygulanamaz |
| 4 | `getShipmentById` (detay) | canlı + `prevSackId` ile **çuval bazında** geri-ekleme | ✔ | **✔ `liveRollIds` Set** | satır **atlanır** (uydurma çuvala yazılmaz) |
| 5 | `collectShipmentDocContent` (belge üretici) | canlı + `prevSackId` geri-ekleme | ✔ | **✔ `liveRollIds` Set** | satır atlanır |
| 6 | `sack-search` / çuval etiketi | canlı `sack.rolls` | **NET — ve DOĞRU** (aşağı) | — | — |
| **7** | **`reports/_shipped.ts`** (yeni, bu denetimde bulundu) | tek SQL: canlı `rolls` **UNION ALL** `roll_returns` | ✔ | gerekmez (**tek ifade = tek snapshot**) | uygulanamaz |

**Sonuç: kural tutarlı uygulanmış.** Ayrışan tek şey yüzey 2'nin dedup eksikliğidir ve o
bir *eşzamanlılık* kusurudur, brüt/net kusuru değil.

### Yüzey 6 neden NET ve neden DOĞRU

Çuval **fiziksel bir nesnedir**. İade alınan top artık o çuvalın içinde değildir. Çuval
etiketi "bu çuvalın içinde ne var" sorusunu yanıtlar — geçmişte ne olduğunu değil. Etikete
iade edilmiş topu basmak, operatörü **olmayan bir malı aramaya** gönderirdi.

Karşıt yüzeyler (fiş, irsaliye, liste, Excel) **para/muhasebe** yüzeyidir ve orada soru
"bu sevkiyatla ne çıktı"dır — çıkış olayı iadeyle değişmez. İki soru farklıdır, iki cevap
da doğrudur. CLAUDE.md'nin `sack-search hâlâ canlı okuyor` notu bir **eksik iş değil**,
doğru bir tercihtir; kapatılması istenirse bu paragraf çürütülmelidir.

## `totalKg` — geri-ekleme YAPILMAZ (yapısal olarak imkânsız)

`RollReturn` modelinde **ağırlık kolonu YOK** (`qty` var, `weightKg` yok — şema okundu).
Tüm kg toplamları yalnız `Sack.weightKg`'dan gelir ve iade ona **dokunmaz**, yani kg zaten
brüttür. Geri-ekleme yapılsaydı **çift sayardı**. Altı yüzeyin hiçbirinde kg geri-eklemesi
yok — doğrulandı.

## Üç çift-sayım tuzağı (CLAUDE.md) — yüzey bazında durum

| Tuzak | Yüzey 4 | Yüzey 5 | Yüzey 2 | Yüzey 7 |
|---|---|---|---|---|
| (a) `sacks[].rolls` ile `summary` ayrı toplanırsa | ✔ tek `grossRolls` kaynağı | ✔ tek `sacksGross` | uygulanamaz | ✔ tek SQL |
| (b) ayrı tx → canlı id kümesiyle dedup | ✔ | ✔ | **✘** | ✔ (tek snapshot) |
| (c) sentetik satır `sackId = prevSackId` taşımalı | ✔ (yorumu da yazılı) | ✔ | uygulanamaz | uygulanamaz |

## Yeni yüzey eklerken

1. Bu tabloya satır ekle.
2. Kaynağı **`RollReturn`** seç — `PrintedDocument.snapshot` DEĞİL. Dört yüzey aynı kaynağı
   seçti; beşinci bir kaynak beşinci bir rakam demektir. (Snapshot ayrıca yetersizdir:
   `cekiRows` kalite taşımaz, eski snapshot'larda `width` yoktur ve `reissue`/lazy-init
   yolları belgeyi **canlıdan** kurar, yani iadeden sonra doğan snapshot zaten NET olur.)
3. Sorgu **tek ifade** değilse (`findUnique` + ayrı `findMany`) **canlı id kümesiyle dedup et**.
4. `kg`'ye **dokunma**.
5. `prevSackId` taşımayan eski iadeleri (kolon 2026-06'da eklendi) **atla**, uydurma çuvala yazma.
