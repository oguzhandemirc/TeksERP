# Stok defterinin açılışı — onarım RUNBOOK'u · ⛔ ARŞİV (uygulanmayacak)

> # ⛔ KULLANICI KARARI 2026-09-13: FOTOĞRAF ÇEKİLMEYECEK
>
> Kullanıcının kararı (yönetici oturum `teks-erp-1e` üzerinden iletildi):
> *"Mevcut topların geçmiş verilerini onarmak veya backfill yapmak mümkün değil,
> bununla uğraşma. **Bundan sonraki kayıtlar sağlam olsun yeter.**"*
>
> ⇒ Geçmiş onarımı **kapsam dışı**. Açılış fotoğrafı da bu kararın içindedir:
> teknik olarak append-only'dir ama **işlevi backfill**'dir — var olan stok için
> sentetik açılış satırları üretir. **Bu belge UYGULANMAYACAK.**
>
> **Neden silinmedi:** reddedilen bir şıkkın gerekçesi yazılmazsa altı ay sonra
> yeniden önerilir. Aşağıdaki ölçümler (K · 187/187 · epoch tanımı · üç şık · geri
> alma yolu) kararın **gerekçesini** saklar, bir planı değil.
>
> **Bugün geçerli olan tek iş:** depoya yazan yolları defterin İÇİNDEN geçirmek —
> *"bundan sonraki kayıtlar sağlam olsun"*un mekanik karşılığı. İlerleme `K` ile
> ölçülür (`scripts/lib/stok-defteri-bag-olcumu.ts`).
>
> ⚠️ Geçmişin eksik KALACAĞI artık bir borç değil bir **sınır**:
> `docs/kurallar/defter.md` 104. satır şerhi.

> **Bu belge bir PLANDIR, koşum değil.** Hiçbir adımı `--apply` ile koşulmadı.
> **Yeni script YAZILMADI** — mekanizma zaten var (`scripts/acilis_fotografi_stok_defteri.ts`);
> bu belge onu fabrikada koşturmanın sırasını, ön koşul durumunu ve kullanıcının
> gerçekte neye karar verdiğini yazar. ⚠️ Yeni bir `--apply` script'i eklenmedi,
> yani "27 script'in 6'sı izsiz" kümesi **büyümedi**.

## 0. Kullanıcının karar verdiği şey — tek paragraf

Defterin geçmişi eksik ve **eksik geçmiş onarılamaz**: depodaki topların çoğunun
girişi hiç yazılmadı, onları tek tek tamamlamak yüzlerce topa **geriye dönük giriş
uydurmak** olurdu. Bunun yerine bir **çizgi çekilir**: kesme anında stok
kümesindeki her topa "beyan edilmiş sayım" satırı (`OPENING_BALANCE`) yazılır,
Σ o andan başlar, öncesi **tarihsel iz** olarak kalır ve bir daha yorumlanmaz.
Kullanıcı "onarım" değil **açılış anı** seçiyor; bedeli, çizgiden öncesinin
kalıcı olarak tanımsız kalmasıdır.

## 1. Ölçülen durum — taban beyanı

**Taban:** ağaç `a263fc13` · DB fabrikanın dev kopyası (fabrikanın canlı yedeği,
`default_transaction_read_only=on`) · ölçüm 2026-09-13.

⚠️ **EPOCH TANIMI LOAD-BEARING:** "defter başlangıcı" = ilk defter satırının ANI
(`2026-09-04T17:48:24.741Z`), gün başı DEĞİL. Gece yarısı sınırıyla ölçülürse
aynı sorgu 1.507 / 538 verir; beyan edilen 1.259 / 516 sayıları yalnız bu tanımla
yeniden üretilir. Bir sayıyı doğrulayan kişi önce tanımı doğrulamalı.

| ölçüm | değer |
|---|---|
| Epoch'tan sonra doğan top | **1.259** |
| ↳ `WAREHOUSE` statüsünde olup defterde satırı OLMAYAN | **516** |
| Karşı `CANCEL` satırı olmayan `CANCELLED` top | **368** |
| Fotoğrafın YAZACAĞI satır (stok kümesi ∧ depolu ∧ `currentQty > 0`) | **1.206** |
| ↳ 0 metrajlı, kapsam dışı kalacak (ATLANAN olarak listelenir) | **2** |

### ⚠️ "Boşluk durdu" bir ÇIKARIM, bu yedekte GÖZLEM DEĞİL

Deftersiz `WAREHOUSE` topunun doğum günleri: `09-03: 22 · 09-04: 68 · 09-06: 117 ·
09-07: 31 · 09-08: 127 · 09-09: 173` — ve **09-10/09-11'de sıfır**.
Yedeğin en yeni top kaydı **2026-09-11T12:20**; yazar kümesini kapatan commit'ler
ise **09-12/09-13**'te indi. ⇒ Bu DB, düzeltmenin etkisini **görebileceği ufkun
gerisinde**; "kapanma boşluğu durdurdu" cümlesi burada doğrulanamaz.
Ayrıca büyüme zaten **düzensizdi** (iki gün sıfır), yani "günde ~100" bir ortalama
değil bir aralıktır. ⇒ **Koşumdan önce CANLI DB'de yeniden ölçülecek** (adım 3a).

## 2. Kapsam — ne yapar, ne YAPMAZ

**Yapar:** stok kümesindeki (`WAREHOUSE_STOCK_STATUSES`) · deposu olan ·
`currentQty > 0` her top için **tek** satır: `OPENING_BALANCE` ·
`to = {warehouseId, status}` · `qty = currentQty` · `reasonCode OPENING` · `from` yok.
Tek yazma kapısından (`postStockMoves`).

**YAPMAZ — ve bunlar kararın parçasıdır, sessiz eksik değil:**

1. **368 `CANCELLED` topun `CANCEL` satırı YAZILMAZ.** Fotoğrafın kapsamı stok
   kümesidir; iptal edilmiş top stok kümesinde değildir. Bu 368 satır kalıcı
   olarak defterde görünmez kalır — ters kayıt da yazılamaz, çünkü terslenecek
   **ileri satır yok**. Onarımı isteniyorsa bu **ayrı ve ikinci bir karardır**.
2. **Geriye dönük giriş uydurulmaz.** 516 topun "ne zaman girdiği" bilinmiyor ve
   bilinmeyecek.
3. **Epoch'tan önceki Σ / as-of okumaları TANIMSIZ kalır** (`preEpoch` damgası
   onları dışarıda bırakır). Bu kayıp geri alınamaz.
4. **0 metrajlı 2 top kapsam dışıdır** (kapı 0 metrajı fırlatır) — ATLANAN listesinde.

## 3. Ön koşullar — ölçülen durum

| # | koşul | durum (2026-09-13, yedek) |
|---|---|---|
| ① | stok kümesinde deposuz top KALMAMALI | ✅ **0** |
| ② | fason dönüşü ENTRY onarımı bitmiş (uyarı, engel değil) | ⚠️ koşum anında `onarim_fason_donus_entry.ts` ile bakılacak |
| ③ | daha önce fotoğraf çekilmemiş | ✅ **0** `OPENING_BALANCE` satırı |
| ④ | SESSİZ PENCERE — yazma trafiği durmuş (backend durdurulmuş / vardiya dışı) | ⛔ koşum anında sağlanacak; script son 120 sn'de defter yazımı görürse `--apply`yi REDDEDER |
| ⑤ | `--onay=<N>` + `--hedef=<db>` birlikte | ⛔ koşum anında |
| ⑥ | sevk bağı: K = 0 ∧ V (SIKI modda ENGELLER) | ⛔ **K = 7 ⇒ SAĞLANMIYOR, SIKI MOD BUGÜN BLOKE** (ölçüldü, ağaç `8079987c`). V ayağı sağlanıyor (yedekte en yeni **statülü** satır 09-12T18:00 > en yeni **statüsüz** 09-11T12:20) ama K ∧ V olduğu için yetmiyor. ⚠️ V canlıda yeniden ölçülür — ağaç ≠ saha |

### ⚠️ ⑥ DÜZELTMESİ (2026-09-13) — bu satır ilk yazımda YANLIŞTI

İlk yazımda ⑥ *"sağlanıyor"* yazıyordu ve gerekçesi **"`test_stok_defteri_bag_olcumu` yeşil"**di.
**O çıkarım geçersiz:** bekçi *aracın ÇALIŞTIĞINI* ölçer (pozitif kontrolleriyle), *K'nın 0
olduğunu* ölçmez. Yeşil bekçiyi koşulun kendisi yerine koymak — belge cümlesini ölçüm
yerine koymanın aynısı. Gerçek ölçüm:

```
K = eski kapı çağıranı (5) + bağsız kapısız yol (2) = 7        (ağaç `8079987c`)
  src/services/shipping.service.ts:3341          writeWarehouseMovements
  src/services/shipping.service.ts:3821          writeWarehouseMovements
  src/services/subcontractor.service.ts:3266     writeWarehouseMovements
  src/services/warehouse-transfer.service.ts:281 writeWarehouseMovements
  src/services/warehouse-transfer.service.ts:543 writeWarehouseMovements
  src/services/kartela.service.ts::dispatch        ❌ BAĞSIZ
  src/services/kartela.service.ts::cancelDispatch  ❌ BAĞSIZ
```

⚠️ **ARAÇ ÇAĞRISININ KÖKÜ LOAD-BEARING:** `eskiKapiCagiranlari(kok)` / `kapisizYolOlcumu(kok)`
`Teks-Erp/` dizininden `"."` ile çağrılır. Yanlış kök verilince araç dosyaları bulamaz,
`aracSaglam: false` döner ve naif bir toplama **K = 0** gibi okunur — yani *fail-closed bir
arıza, yeşil bir sonuç gibi görünür*. Ölçen kişi `aracSaglam`ı **okumadan** K'yı kullanmasın.

⇒ **Bugünkü gerçek karar: SIKI mod koşulamaz.** Şıklar §6'da buna göre güncellendi.

### 3a. Koşum anı ölçümü (atlanmaz)

`--apply`den önce, canlı DB'de: ① deposuz top = 0 · ③ `OPENING_BALANCE` = 0 ·
⑥ K = 0 ∧ V · ve **boşluğun son 3 günü** (düzeltme indikten sonra yeni deftersiz
top doğmuyor mu). Son madde bu belgenin en önemli satırı: **boşluk hâlâ
akıyorsa fotoğraf çekmek erken**, çünkü çizgi çekildikten sonra akan boşluk
`preEpoch=false` satırlarla epoch'u ilk günden deler.

## 4. Koşum sırası

```bash
# 1) KURU KOŞUM (varsayılan, SIKI mod) — hiçbir şey yazmaz, sayıyı verir
npx tsx scripts/acilis_fotografi_stok_defteri.ts

# 2) Çıktıdaki satır sayısını (N) ve ATLANAN listesini OKU; 3a ölçümlerini doğrula
#    Yedekte beklenen: N = 1.206, ATLANAN = 2  (canlıda farklı olacak — N'i çıktıdan al)

# 3) YEDEK AL ve doğrula (geri dönüş yolu budur — bkz. §5)

# 4) SESSİZ PENCEREDE yaz
npx tsx scripts/acilis_fotografi_stok_defteri.ts --apply --onay=<N> --hedef=<canlı-db-adı>
```

`--onay` "kaç satır", `--hedef` "nerede" sorusunu cevaplar; ikisi birden olmadan
geri alınamaz yazma yok. Mod (SIKI/GEVŞEK) hem çıktıya hem **yazılan her satırın
`notes`una** hem audit yüküne girer — fotoğrafı sonradan okuyan hangi modda
çekildiğini deftere bakarak bilir.

### GEVŞEK mod (`--kirilim-beyan`) ne zaman?

⑥ sağlanmıyorsa ve kullanıcı yine de "şimdi çek" diyorsa. Bedeli: fotoğraf sonrası
**yalnız toplam Σ** güvenilirdir; depo × durum kırılımı ve as-of kesiti BEYAN kalır.
⛔ **Bugünkü ölçümde ⑥ SAĞLANMIYOR (K = 7)** ⇒ bugün çekilecekse **tek seçenek
GEVŞEK mod**; SIKI mod script tarafından REDDEDİLİR.

## 5. İz ve geri dönüş

- **Audit:** `AuditService.log()` yazılır (tx DIŞINDA, best-effort) — mod ve satır
  sayısı yükte. Ham SQL **kullanılmaz**, yani "ne audit ne `updatedAt`" körlüğü yok.
- **`updatedAt` yok ve olmaması doğru:** fotoğraf yeni satır EKLER (append-only
  defter, yalnız `createdAt`). Tek UPDATE `preEpoch` bayrağıdır; satırın olayı,
  miktarı, ucu değişmez. `preEpoch` bir **sınıflandırma bayrağıdır**, iş kararına
  girdi değildir.
- **Hep-ya-hiç:** `preEpoch` damgası + fotoğraf satırları AYNI `$transaction`
  içinde; `--apply` yarıda kesilirse ikisi de geri sarılır, kısmi işaretli defter
  kalmaz.
- **Geri alma:** defter append-only ⇒ yanlış çekilmiş fotoğraf **silinerek**
  geri alınmaz. İki yol: (a) yedekten restore (tercih edilen), (b) her satıra ters
  kayıt — ki bu **ayrı bir karardır** ve Σ'yı sıfırlar ama satırları bırakır.
  ⇒ Adım 3'teki yedek opsiyonel değildir.
- **İkinci fotoğraf:** ③ gereği REDDEDİLİR. "Bir kez çekilir"; ikincisi ayrı karar.

## 6. Karar için üç şık

1. **K'yı 0'a indir, SONRA SIKI modda çek** *(önerilen)* — yedi yol taşınacak:
   `shipping` ×2 · `subcontractor` ×1 · `warehouse-transfer` ×2 · `kartela` dispatch +
   cancelDispatch. Σ **ve** depo × durum kırılımı ancak böyle güvenilir olur.
   Maliyeti: bu yedi yol inene kadar fotoğraf beklemede.
2. **Bekle** — ayrıca boşluğun canlıda gerçekten durduğu §3a ile doğrulanana kadar.
   ①'in içinde zaten var; tek başına seçilirse Σ okumaları tanımsız kalmaya devam eder.
3. **GEVŞEK modda şimdi çek** — ⑥'yı beklemeden. Toplam Σ bu andan güvenilir olur, ama
   **depo × durum kırılımı ve as-of kesiti kalıcı olarak BEYAN kalır** (eski kapıdan
   yazılan satır hangi durumdan çıktığını söylemiyor). Geri dönüşü yok: fotoğraf bir
   kez çekilir.

⚠️ Şık 1 ile 3 arasındaki seçim **"ne zaman" değil "neyi kalıcı olarak kaybediyoruz"**
sorusudur: GEVŞEK fotoğraf, kırılım güvenilirliğini **bir daha geri getirmez**.

Hiçbir şık **368 CANCELLED** satırını kapatmaz (§2.1) — o ayrı bir karardır.

---
İlgili: `docs/design/DEPO-STOK-DEFTERI-TASARIM.md` §D6 · `docs/kurallar/defter.md`
(mevcut defter envanteri şerhi) · `scripts/acilis_fotografi_stok_defteri.ts`
(mekanizma ve altı ön koşulun kodu) · `scripts/backfill_roll_warehouse.ts` (①) ·
`scripts/onarim_fason_donus_entry.ts` (②) · `scripts/lib/stok-defteri-bag-olcumu.ts` (⑥).
