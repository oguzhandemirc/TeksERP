# Stok defterinin açılışı — onarım RUNBOOK'u (kullanıcı kararı bekliyor)

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

**Taban:** ağaç `638850b0` · DB `tekserp_fabrika_dev` (fabrikanın canlı yedeği,
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
| ⑥ | sevk bağı: K = 0 ∧ V (SIKI modda ENGELLER) | K: `test_stok_defteri_bag_olcumu` yeşil · V: yedekte en yeni **statülü** satır (09-12T18:00) en yeni **statüsüz**ten (09-11T12:20) YENİ ⇒ sağlanıyor. ⚠️ **V canlıda yeniden ölçülür** — ağaç ≠ saha |

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
Bugünkü ölçümde ⑥ sağlanıyor ⇒ **GEVŞEK moda gerek yok**, SIKI koşulmalı.

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

1. **SIKI modda şimdi çek** — ⑥ sağlanıyor, ① ve ③ yeşil. Σ ve depo × durum
   kırılımı fotoğraf sonrası güvenilir olur. *(Önerilen; tek ön koşul sessiz pencere.)*
2. **Bekle** — boşluğun canlıda gerçekten durduğu 3a ile doğrulanana kadar.
   Maliyeti: Σ okumaları o güne kadar tanımsız kalmaya devam eder.
3. **GEVŞEK modda çek** — yalnız ⑥ canlıda sağlanmıyorsa anlamlı; kırılım BEYAN kalır.

Hiçbir şık **368 CANCELLED** satırını kapatmaz (§2.1) — o ayrı bir karardır.

---
İlgili: `docs/design/DEPO-STOK-DEFTERI-TASARIM.md` §D6 · `docs/kurallar/defter.md`
(mevcut defter envanteri şerhi) · `scripts/acilis_fotografi_stok_defteri.ts`
(mekanizma ve altı ön koşulun kodu) · `scripts/backfill_roll_warehouse.ts` (①) ·
`scripts/onarim_fason_donus_entry.ts` (②) · `scripts/lib/stok-defteri-bag-olcumu.ts` (⑥).
