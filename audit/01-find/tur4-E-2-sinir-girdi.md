# TUR 4 · DENETÇİ E-2 — Sınır durum: GİRDİ ekseni
**Kapsam:** sıfır / negatif / devasa / boş / Unicode / uzun / tekrar gönderim
**Tarih:** 2026-08-29 · **Dal:** `adnansahin` · **Mercek:** sınır durum merkezli (TUR 4)
**Kanıt tavanı bu turda K1** — dev ve saha DB'leri oturum boyunca ERİŞİLEMEZ durumdaydı
(`Postgres.app failed to verify "trust" authentication`, hem TCP hem unix soket, hem `psql`
hem Prisma; log: `audit/repro/E-2-00-probe.log`, `audit/repro/E-2-02.log`). Bu yüzden **hiçbir
bulguya S0 verilmedi** ve K2/K3 gerektiren iddialar açıkça "ölçülemedi" diye işaretlendi.
DB'ye dokunmayan **saf-fonksiyon sondası koştu** (`audit/repro/E-2-01.log`) — aşağıdaki
tarih/sayı/bool/enum bulgularının çıktıları oradan birebir alınmıştır.

---

## Özet tablo

| ID | Başlık (kısalt.) | Şiddet | Kategori | Öncelik | Kanıt |
|---|---|---|---|---|---|
| E-2-01 | İçe aktarımda takvim-dışı ve 2-haneli-yıllı tarih SESSİZCE kayıyor (31.02 → 03.03; 01.02.26 → 01.01) | S2 | F | P3 | K1 + yürütülen sonda |
| E-2-02 | "Aynı `clientToken`, FARKLI gövde" kuralı yalnız 4 uçta var; Tambur kesimi / açık kumaş / çuval açma "başarılı" diyor | S2 | B.3 | P0 | K1 |
| E-2-03 | Aynı fiziksel alanın (en · metraj · ağırlık) üst sınırı uçtan uca dört farklı; iki uçta hiç yok | S3 | F | P4 | K1 |
| E-2-04 | `positive()` alt sınırı 0'ı reddeder ama 0,0004'ü kabul eder → `Decimal(12,3)` onu 0,000'a yuvarlar (sıfır metrajlı canlı top) | S3 | C | P4 | K1 (ölçülemedi) |
| E-2-05 | Barkod sayacı tavanı ARTIŞTAN SONRA kontrol ediliyor: reddedilen çok-segmentli rezervasyon günün kalan kapasitesini kalıcı yakıyor | S4 | A.6 | P4 | K1 |
| E-2-06 | pg adapter'ın haritalamadığı SQLSTATE'ler (NUL bayt · sorgu zaman aşımı · deadlock) çıplak `DriverAdapterError` → generic 500 | S3 | I | P3 | K1 |
| E-2-07 | İçe aktarım sayı okuması: `1e5` → **15**, `1,234,567` → **null**; başlık iki yereli desteklediğini söylüyor | S3 | C | P1 | K1 + yürütülen sonda |
| E-2-08 | `parseBool`: ASCII yazımlı `hayir` tanınmıyor (`aktif/pasif` için iki yazım eklenmiş, `hayır` için unutulmuş) | S4 | F | P6 | K1 + sonda |
| E-2-09 | İçe aktarım enum hücresi `toLocaleUpperCase("tr-TR")`: `internal` / `critical` küçük harfle yazılınca reddediliyor | S4 | F | P6 | K1 + sonda |
| E-2-10 | `reason-preset/reorder` mükerrer id'yi elemiyor: kontrol küme değil DİZİ uzunluğuna bakıyor → bir satır hiç sıralanmıyor | S4 | F | P4 | K1 |
| E-2-11 | `nextDailySeq` tavansız: 9999'dan sonra üretilen belge kodu kendi tarama biçim doğrulamasından (`isDailyCode`) DÜŞÜYOR | S4 | A.6 | P6 | K1 + sonda |

---

## [E-2-01] İçe aktarımda takvim-dışı ve 2 haneli yıllı tarih hücresi SESSİZCE başka bir güne kayıyor — "31.02.2026" 3 Mart olur, "01.02.26" 1 Ocak olur

| Şiddet | S2 | Kategori | F | Öncelik | P3 | Modül | içe aktarım / sipariş | Kanıt seviyesi | K1 (+ yürütülen saf-fonksiyon sondası) |

**Özet.** Sipariş içe aktarımının iki tarih sütunu var: **Sipariş Tarihi** ve **Termin**
(`order.adapter.ts:57-58`). Hücreyi çözen `parseDateCell` gün/ay için yalnız *aralık*
kontrolü yapıyor (`m 1..12`, `d 1..31`) ve sonucu `Date.UTC` ile kuruyor — JavaScript'in
`Date.UTC` davranışı taşan günü **bir sonraki aya taşır**. Yani var olmayan bir gün
reddedilmez, sessizce başka bir güne yazılır. İkinci ve daha sinsi ayak: dosya 2 haneli yıl
taşıyorsa (`01.02.26`) düzenli ifade eşleşmez, satır `new Date(s)` yedeğine düşer ve JS onu
**AY.GÜN** sırasında okur — Türkçe yazılmış "1 Şubat" sisteme **1 Ocak** olarak girer.
Hiçbir uyarı, hiçbir satır hatası yok.

**Kanıt**
`Teks-Erp/src/services/import/import-coerce.ts:71-98`
```ts
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);   // 4 HANELİ yıl şart
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  ...
  } else {
    const parsed = new Date(s);                                   // ← 2 haneli yıl BURAYA düşer
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;            // ← ayın GERÇEK gün sayısı sorulmuyor
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);                // ← 31 Şubat = 3 Mart
```
`Teks-Erp/src/services/import/adapters/order.adapter.ts:57-58` — iki `type:"date"` sütunu
(`orderDate`, `deadline`), yardım metni "GG.AA.YYYY".
`Teks-Erp/src/services/import/import.service.ts:88-91` — `parseDateCell` `null` dönerse satır
hatası üretilir; **döndüğü sürece hiçbir doğrulama yok**.

**Ölçüm (yürütüldü — `audit/repro/E-2-01.log`, script `Teks-Erp/scripts/audit_repro_E-2-01.ts`)**
```
"31.02.2026" → 2026-03-02T21:00:00.000Z   (yerel 3 Mart 2026)
"30.02.2026" → 2026-03-01T21:00:00.000Z   (yerel 2 Mart 2026)
"31.04.2026" → 2026-04-30T21:00:00.000Z   (yerel 1 Mayıs 2026)
"29.02.2027" → 2027-02-28T21:00:00.000Z   (artık yıl DEĞİL → 1 Mart 2027)
"2026-02-30" → 2026-03-01T21:00:00.000Z   (ISO yolu da aynı)
"01.02.26"   → 2026-01-01T21:00:00.000Z   (yerel ay=1, gün=2 → GÜN/AY TERS)
"01/02/26"   → 2026-01-01T21:00:00.000Z
"0001-01-01" → 1901 (JS'in 0-99 → 1900+ eşlemesi)
```
Karşılaştırma kontrolü: geçerli tarihler DOĞRU çözülüyor (`31.12.2026` → yerel 31 Aralık
00:00), yani bulgu saat dilimi değil **takvim doğrulaması** hakkında.

**failure_mode.** Fabrika, müşteriden gelen sipariş listesini Excel'den içe aktarır. Termin
sütununda bir satırda `31.02.2026` yazıyor (elle yazım hatası ya da başka bir sistemin
ürettiği geçersiz gün). Önizleme "hata yok" der, satır **YEŞİL** görünür, uygulanır ve
`Order.deadline = 3 Mart 2026` olur. Aynı dosyada yıl 2 haneli yazılmışsa (`01.02.26`) sipariş
termini **1 Ocak**'a düşer, yani geçmişe; "Geciken Siparişler" raporu o siparişi açıldığı gün
gecikmiş gösterir ve planlamacı olmayan bir aciliyetle üretim sırasını değiştirir. Ters yönde
(`05.11.26` → 5 Kasım yerine **5 Mayıs**... bu örnekte ay=5, gün=11) termin altı ay ileri kayar
ve sipariş hiç önceliklenmez. Hiçbir yüzeyde uyarı yok; tek iz, kâğıttaki tarihle ekrandaki
tarihin farklı olması.

**Veride fiili ihlal (K2).** Aranamadı — dev ve saha DB'leri bu oturumda erişilemezdi
(`audit/repro/E-2-00-probe.log`). Erişim gelince koşulacak sorgu:
`SELECT id,"orderNo","orderDate",deadline FROM orders WHERE deadline < "orderDate" OR EXTRACT(day FROM deadline) IN (1,2,3) AND ... ` — daha kesini, `import_runs` üzerinden o koşumda yazılan sipariş satırlarını çekip dosyadaki metinle karşılaştırmaktır (`ImportRun.errorReport` satır metinlerini saklıyor).

**Repro (K3).** Gerekmiyor — saf fonksiyon; sonda `scripts/audit_repro_E-2-01.ts` §1/§2/§2b
ile YÜRÜTÜLDÜ, çıktı yukarıda.

**İş etkisi.** Sipariş termini ve sipariş tarihi yanlış → geç teslimat raporu, üretim
önceliklendirmesi ve müşteriye verilen söz yanlış. İçe aktarım bu sistemde **toplu sipariş
girişinin tek yolu**dur (masaüstünde satır satır girişin ikizi), yani hata tek satırda değil
dosya boyunca tekrarlanabilir.

**Öneri (2. tur için).** `parseDateCell` gün sayısını AYIN GERÇEK uzunluğuyla doğrulasın
(kurulan `Date`'in `getUTCMonth()`'u istenen ayla eşit değilse `null` dön — üç satır, ek
bağımlılık yok). 2 haneli yıl için: ya AÇIKÇA reddet (`GG.AA.YYYY yazın` hatası — bugünkü
yardım metni zaten bunu söylüyor) ya da `dmy` regex'ini `(\d{2}|\d{4})` yapıp `< 100` yılları
`2000+` diye çözerek GÜN.AY sırasını koru. `new Date(s)` yedeği yalnız TAM ISO için kalsın
(`/^\d{4}-\d{2}-\d{2}T/`) — serbest metni JS'in yerel ayrıştırıcısına bırakmak, biçimi
belirsiz her hücreyi sessizce bir tarihe çevirir (`"Mart 2026"` bile bir tarih üretiyor:
sondada 2026-02-28). Migration/veri dokunuşu YOK.

**Kabul kriteri.** `parseDateCell("31.02.2026") === null`, `parseDateCell("29.02.2027") === null`,
`parseDateCell("2026-02-30") === null`; `parseDateCell("01.02.26")` ya `null` ya da yerel
1 Şubat 2026; `parseDateCell("31.12.2026")` DEĞİŞMEDEN yerel 31 Aralık 00:00 kalır (regresyon
çıpası). Bekçi: `scripts/test_import_*` ailesine bir bölüm.

**Efor.** 0,5 gün.

**Önceki defter.** İlgili kayıt yok. `BULGU-T1-098` (belge tarihi süreç saat diliminden) AYRI
bir sorudur — bu bulgu saat dilimi değil takvim geçerliliğidir.

---

## [E-2-02] "Aynı `clientToken`, FARKLI gövde" kuralı yalnız dört uçta var; Tambur depo kesimi, açık kumaş kesimi/oluşturma ve çuval açma ikinci FARKLI isteğe "başarılı" diyor

| Şiddet | S2 | Kategori | B.3 | Öncelik | P0 | Modül | Tambur · depo · paketleme | Kanıt seviyesi | K1 |

**Özet.** 2026-08 denetimlerinde KK1'e eklenen **F117 kuralı** ("idempotent retry SADECE gelen
payload mevcut kayıtla ÖZDEŞSE geçerli") sistemde **dört uçta** uygulanıyor: KK1 ham giriş,
iş emri oluşturma, sipariş oluşturma, kartela stok düşümü. Aynı `clientToken` sözleşmesini
kullanan **beş uç** ise özdeşliğe hiç bakmıyor: ikinci istek gövdesi ne olursa olsun ilk
kaydı `success: true` ile döndürüyor. Bu, beceri paketinin §8'de "en pahalı hata" dediği
sınıfın kardeşidir: yanlış cevap, 409'dan daha kötüdür.

**Sınır tablosu — `clientToken` taşıyan TÜM uçlar (kod okumasıyla çıkarıldı)**

| Uç / servis | Dosya:satır | Aynı token + FARKLI gövde |
|---|---|---|
| KK1 ham giriş `createInitialEntry` | `inventory.service.ts:956-1000` | **409 `CLIENT_TOKEN_COLLISION`** (item/renk/metraj karşılaştırılır) ✅ |
| İş emri `create` | `workorder.service.ts:1146-1192` | **409 `CLIENT_TOKEN_COLLISION`** (`type` + `targetItemId`) ✅ |
| Sipariş `create` | `order.service.ts:2022-2053` | **409 `CLIENT_TOKEN_COLLISION`** ✅ |
| Kartela stok düşümü | `kartela.service.ts:1428` | **409 `CLIENT_TOKEN_COLLISION`** ✅ |
| **Tambur depo topu kesimi `cutWarehouseRoll`** | `tambur.service.ts:2276-2300` | ❌ kontrol YOK → ilk çocuk + "Kesim zaten kaydedilmiş" |
| **Tambur açık kumaş kesimi `cutOpenFabric`** | `tambur.service.ts:2970-2990` | ❌ kontrol YOK |
| **Açık kumaş oluşturma `createOpenFabric`** | `inventory.service.ts:4217-4234` | ❌ kontrol YOK → "Açık kumaş zaten açılmış" |
| **Çuval açma `openSack`** | `shipping.service.ts:181-215` | ❌ kontrol YOK (üstelik tx'e hiç girmeden, ÖN kapıda) |
| Sevkiyat kurma `createShipment` | `shipping.service.ts:1362-1386, 1440-1443` | ❌ kontrol YOK (iptal edilmiş sevkiyat ayağı `BULGU-T3-010`'da) |
| Fason kabul `receive` | `subcontractor.service.ts:2345-2378` | ❌ kontrol YOK — `BULGU-T3-028` |

**Kanıt**
`Teks-Erp/src/services/inventory.service.ts:967-1000` (DOĞRU kalıp):
```ts
// F117: İdempotent retry SADECE gelen payload mevcut kayıtla ÖZDEŞSE geçerli.
const sameItem  = existing.itemId === data.itemId;
const sameColor = existing.colorId === (data.colorId ?? null);
const sameQty   = new Prisma.Decimal(data.initialQty).equals(existing.initialQty);
if (sameItem && sameColor && sameQty) { return { success: true, data: existing, ... }; }
throw AppError.conflict("Bu istemci anahtarı farklı bir topla kullanılmış. …",
  { code: "CLIENT_TOKEN_COLLISION", … });
```
`Teks-Erp/src/services/tambur.service.ts:2276-2300` (EKSİK kalıp — aynı sözleşme, kontrol yok):
```ts
if (data.clientToken && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
  const existing    = await prisma.roll.findUnique({ where: { clientToken: data.clientToken } });
  const freshParent = await prisma.roll.findUnique({ where: { id: rollId } });
  if (existing && freshParent) {
    return { success: true, data: { childRoll: existing, parentRoll: freshParent,
             parentRemainingQty: Number(freshParent.currentQty) },
             message: "Kesim zaten kaydedilmiş (idempotent retry)" };
```
⚠️ `existing` **yalnız token'la**, `freshParent` **gelen `rollId` ile** bulunuyor — ikisinin
akraba olduğu HİÇ doğrulanmıyor; yanıt farklı bir topun çocuğuyla farklı bir ebeveyni yan yana
koyabilir.
`Teks-Erp/src/services/shipping.service.ts:210-215`:
```ts
if (data.clientToken) { const cached = await this.readOpenSackReplay(data.clientToken);
                        if (cached) return cached; }   // ← customerId/branchId hiç kıyaslanmıyor
```

**İstemcinin token yapışma davranışı (tetiklenebilirlik)**
- Tambur: `mobil/src/screens/Modules/Tambur/TamburScreen.tsx:737-747` — token `rollId` başına
  tutulur ve **yalnız BAŞARIDA** düşer (`:1286`). Yani *aynı top* için yeniden denemede token
  aynıdır, ama metraj alanı değişmiş olabilir.
- Paketleme: `mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx:128,179,181` — token
  yine yalnız başarıda tazelenir; müşteri seçimi değişse bile aynı kalır.

**Çakışma senaryosu (tekrar gönderim, yarış değil)**
T1 Tambur: operatör R topundan **40 m** keser, "Kes"e basar; istek zaman aşımına uğrar ama
sunucuda COMMIT olmuştur (çocuk 40 m, parent 100 → 60).
T2 Operatör tekrar ölçer, **25 m** yazar ve tekrar "Kes"e basar. `rollId` aynı olduğu için
token da aynıdır.
SONUÇ: sunucu P2002 → `existing` (40 m çocuk) + `freshParent` (60 m) döner, mesaj **"Kesim
zaten kaydedilmiş"**, HTTP 200. Operatörün düzeltmesi sessizce yutulur; ekran ve etiket ilk
kesimi gösterir, kimse 25 m'nin hiç yazılmadığını görmez.

**failure_mode.** (a) *Tambur:* düzeltilmiş kesim metrajı sessizce yok sayılır; fiziksel
parçanın etiketi ile sistemdeki metrajı ayrışır ve fark yalnız sevkiyatta tartıda görülür.
(b) *Çuval açma:* operatör A müşterisi için çuval açar, istek belirsiz düşer; ekranda B
müşterisini seçip "Çuval Aç" der → sunucu **A'nın çuvalını** döndürür, mesaj "Çuval açıldı".
Toplar A'ya ait bir çuvala okutulur; hata ancak irsaliye basılırken görülür.
(c) *Açık kumaş:* farklı `receiptId` ile aynı token gönderilirse ilk makbuzun açık kumaşı
döner; ikinci fason makbuzunun malı hiç doğmaz ve KK2 ekranında görünmez.

**Veride fiili ihlal (K2).** Aranamadı (DB erişimi yok). Erişim gelince: `SELECT r1.id, r2.id
FROM rolls r1 JOIN rolls r2 ON r1."clientToken" = r2."clientToken" …` mükerreri göstermez
(token `@unique`); doğru sorgu, `system_logs`'ta "idempotent retry" mesajı dönen çağrıların
audit izini kesimlerin metrajıyla kıyaslamaktır — bu iz bugün yazılmıyor (bkz. öneri).

**Repro (K3).** `Teks-Erp/scripts/audit_repro_E-2-02.ts` yazıldı ve koşturuldu; **tetiklenemedi
— DB erişilemez** (`audit/repro/E-2-02.log`: `Postgres.app failed to verify "trust"
authentication`). Script fixture damgalı (`AUDITREPRO-E-2-02-…`), `finally` temizlikli ve
FK sırasına uygundur (`rollVariance` → `rollOperation` → `rollMovement` → `rollProperty` →
çocuk `roll` → `roll` → `sack` → `customer` → `item`); DB açılınca doğrudan koşar. Sağlıklı
sistemde beklenen: iki bölüm de ✅ (409 çakışma / doğru müşteri).

**İş etkisi.** Depoda ve Tambur'da metraj/kimlik sessizce yanlış kalır; en pahalı hâli
"operatör düzeltti sandı, sistem eskisini sakladı"dır — mutabakat sorgusu bunu yakalayamaz
çünkü ortada tutarsız bir kayıt yok, YANLIŞ bir kayıt var.

**Öneri (2. tur için).** F117 kontrolünü ortak bir yardımcıya çıkar
(`helpers/idempotent-replay.helper.ts`: `assertSamePayloadOr409(existing, incoming, keys)`) ve
beş uçta da uygula — kimlik-kilit alanları: kesimlerde `parentRollId` + `cutLength`
(`Decimal.equals`), açık kumaşta `parentReceiptId` + `stepId`, çuvalda `customerId` +
`branchId`, sevkiyatta `customerId` + çuval kümesi. `cutWarehouseRoll` replay dalında
**`existing.parentRollId === rollId` doğrulaması pazarlık dışıdır** (bugün yabancı ebeveyn
döndürebiliyor). Mekanik bekçi: token taşıyan her serviste "farklı gövde → 409" bölümü olan
tek bir `test_client_token_collision.ts`. Migration/izin/APK YOK; backend tek başına gider,
eski istemciler yalnız yeni bir 409 kodu görür (Tambur ekranı `CLIENT_TOKEN_COLLISION`'ı
zaten tanıyor — `routes/tambur.routes.ts:403`).

**Kabul kriteri.** Beş uçta da aynı token + farklı gövde → 409 `CLIENT_TOKEN_COLLISION`;
aynı token + AYNI gövde → 200 + `message` "zaten kaydedilmiş" (bugünkü davranış korunur);
`cutWarehouseRoll` replay'inde `existing.parentRollId !== rollId` → 409.

**Efor.** 1,5 gün (5 uç + bekçi).

**Önceki defter.** `BULGU-T3-028` (fason kabulünün aynı boşluğu, S3) ve `BULGU-T3-010`
(iptal edilmiş sevkiyatın replay'i) bu ailenin iki ayağıdır; `BULGU-T1-006` iptal edilmiş
KK1 kaydının replay'i. Bu bulgu **kalan beş ucu ve kuralın kendisinin tekleştirilmesini**
ekler — özellikle Tambur kesimi ile çuval açma hiçbir turda yazılmamıştı.

---

## [E-2-03] Aynı fiziksel alanın üst sınırı uçtan uca dört farklı: kumaş eni bir uçta 1000 cm, ötekinde 999.999.999, üçüncüsünde SINIRSIZ

| Şiddet | S3 | Kategori | F | Öncelik | P4 | Modül | iş emri · fason kabul · kartela | Kanıt seviyesi | K1 |

**Özet.** `WorkOrder.width` tek bir kolondur (`Decimal(12,3)`, birim **cm**) ama ona yazan dört
uç dört farklı tavan uygular; ikisinde tavan hiç yoktur. Aynı asimetri metraj (`qty`,
`receivedQty`, `targetQuantity`) ve ağırlık (`weightKg`) alanlarında da var. Ekip bu tavanı
KK1 ve Tambur yollarında bilinçle koymuş (`max(999_999_999)`, `max(100_000)`,
`max(999_999)`); fason kabul, kartela ve iş emri "Düzenle" yolları dışarıda kalmış.

**Kanıt — aynı kolon, dört sözleşme**

| Uç | Dosya:satır | Tavan |
|---|---|---|
| `PATCH /work-orders/:id` (Düzenle) | `controllers/workorder.controller.ts:279` | `z.number().positive()` → **YOK** |
| `PUT /work-orders/:id` (replace) | `controllers/workorder.controller.ts:297` | `.max(999_999_999)` |
| `POST /work-orders/:id/change-width` | `controllers/workorder.controller.ts:272` | `.max(1000, "En en fazla 1000 cm")` |
| `POST /work-orders/:id/apply-attribute-to-rolls` | `controllers/workorder.controller.ts:268` | `.max(1000)` |
| KK1 ham giriş `width` | `controllers/inventory.controller.ts:26` | `.max(999_999_999)` |
| Fason kabul `appliedWidth` | `controllers/subcontractor.controller.ts:150` | `.max(999_999_999)` |

**Tavansız metraj/ağırlık alanları (aynı sınıf)**
```
controllers/subcontractor.controller.ts:77   rollShipQtys     z.record(uuid, z.number().positive())   → tavan YOK
controllers/subcontractor.controller.ts:85   orderLineAllocations[].qty                                → tavan YOK
controllers/subcontractor.controller.ts:119  receivedQty                                               → tavan YOK
controllers/subcontractor.controller.ts:159  newRolls[].qty        ("Metraj pozitif olmalı")           → tavan YOK
controllers/subcontractor.controller.ts:160  newRolls[].weightKg                                       → tavan YOK
controllers/workorder.controller.ts:280-281  targetQuantity / targetWeight (PATCH yolu)                → tavan YOK
controllers/kartela.controller.ts:23-24,38-39 lengthCm / weightKg / bulk*                              → tavan YOK
```
Karşılaştırma çıpası (tavan KONULMUŞ olanlar): `inventory.controller.ts:23,24,26,138,151`;
`tambur.controller.ts:34,76,81,133`.

**"Koruma yok" teyidi.** DB tarafında bu kolonlarda yalnız **negatiflik** CHECK'i var
(`rolls_currentQty_nonneg`, `rolls_initialQty_nonneg`, `rolls_weightKg_nonneg`,
`sacks_weightKg_nonneg`, `order_lines_quantity_pos` — `middlewares/error.middleware.ts:218-226`
envanteri). Üst sınır CHECK'i YOK; `Decimal(12,3)`'ün 999.999.999,999 tavanı bir *tip* sınırıdır
ve aşıldığında PG `22003` → Prisma `P2020` → HTTP 400 verir, yani "1 milyar cm en" gibi
tip sınırının ALTINDAKİ saçma değerler hiçbir kapıya takılmaz.

**failure_mode.** Planlamacı iş emri "Düzenle" ekranında eni **1600** yazar (160 yerine,
numpad'de fazladan basış). PATCH şemasında tavan olmadığı için kabul edilir. Bundan sonra:
① Tambur plan-sapma kapısı eni ±10 cm toleransla karşılaştırıyor
(`constants/tambur-plan-gate.ts`) → o iş emrinden çıkan **HER top** 409 `PLAN_MISMATCH` verir,
operatör her top için ayrı onay tıklar ve sapma defteri gerçek olmayan 1440 cm'lik sapmalarla
dolar; ② fason çekisine ve refakat kartına "1600 cm" basılır; ③ aynı sayı `change-width`
ekranından **düzeltilemez**, çünkü orası 1000 cm tavanı uyguluyor → operatör "Düzenle"den
girdiği değeri "Eni Değiştir"den geri alamaz ve 400 hatasının sebebini ekranda göremez.
Fason kabul tarafında ikizi: `newRolls[].qty` tavansız olduğu için 250 m giden bir sevke
`250000` girilebilir; çekme uyarısı (`fason.shrinkWarnEnabled`) **yalnız mobil istemcide**
hesaplanıyor (`mobil/.../receivePayload.helper.ts:174-197`), sunucuda hiçbir makullük
kontrolü yok → sapma defterine 249.750 m'lik `OVERAGE` satırı düşer ve fason karnesi bozulur.

**Veride fiili ihlal (K2).** Aranamadı (DB erişimi yok). Erişim gelince:
`SELECT count(*) FROM work_orders WHERE width > 1000;`
`SELECT count(*) FROM rolls WHERE width > 1000 OR "initialQty" > 100000;`
`SELECT count(*) FROM roll_variances WHERE kind='OVERAGE' AND qty > 10000;`

**İş etkisi.** Plan-sapma kapısı yanlış pozitif üretir (operatör onay yorgunluğu → gerçek
sapmayı da onaylar), belgeler saçma ölçü basar, fason karnesi ve sapma defteri kirlenir.

**Öneri (2. tur için).** Ölçü sınırlarını **tek kaynağa** al (`constants/measure-limits.ts`:
`MAX_WIDTH_CM = 1000`, `MAX_QTY_M = 100_000`, `MAX_WEIGHT_KG = 100_000`) ve Zod şemalarında
yalnız o sabitleri kullan; `PATCH /work-orders/:id` ile `change-width` aynı tavanı taşısın.
Mekanik bekçi: AST ile "`width`/`qty`/`weightKg` adlı her `z.number()` alanı bir `.max()`
taşımalı ve değeri sabit kümeden gelmeli" (kurulu emsal: `test_feature_flag_contract.ts`
panel↔backend taraması). İkinci hat olarak `rolls.width`/`work_orders.width` üzerine
üst-sınır CHECK'i **eklenebilir** ama önce mevcut veri taranmalı `[PROD'DA ÇALIŞTIRMA]`;
geri alma = `DROP CONSTRAINT`.

**Kabul kriteri.** Aynı fiziksel alan için tüm yazma uçlarında AYNI tavan; `PATCH` ile
`change-width` aynı değeri kabul/ret ediyor; bekçi tavansız yeni bir ölçü alanında kırmızı
veriyor (negatif sonda ile kanıtlanmış).

**Efor.** 1 gün.

**Önceki defter.** `BULGU-T1-108` DİZİ tavanlarının eksikliğini yazmıştı; bu bulgu aynı
ihmalin **skaler** ikizidir (ayrı kod noktaları, ayrı düzeltme).

---

## [E-2-04] `positive()` alt sınırı yanıltıcı: 0 reddedilir ama 0,0004 kabul edilir ve `Decimal(12,3)` onu 0,000'a yuvarlar — sıfır metrajlı canlı top doğar

| Şiddet | S3 | Kategori | C | Öncelik | P4 | Modül | envanter · Tambur · fason | Kanıt seviyesi | K1 (DB doğrulaması yapılamadı) |

**Özet.** Metraj alanlarının tamamı `z.number().positive()` ile korunuyor. Zod'un `positive()`
kuralı "> 0" demektir; **JavaScript'in temsil edebildiği en küçük pozitif sayı da bu kuralı
geçer** (ölçüldü: `5e-324` ve `1e-7` KABUL). Kolonlar `Decimal(12,3)` olduğu için PostgreSQL
bu değeri **0,000'a yuvarlar**. Sonuç: "pozitif metraj" guard'ından geçmiş, ama depoda
**0 metre** duran bir top/parça.

**Kanıt**
Şema — `Teks-Erp/prisma/schema.prisma:1340-1342`
```prisma
  initialQty Decimal  @db.Decimal(12, 3)
  currentQty Decimal  @db.Decimal(12, 3)
  weightKg   Decimal? @db.Decimal(12, 3)
```
Doğrulama — `Teks-Erp/src/controllers/inventory.controller.ts:23`
(`initialQty: z.number().positive(...).max(999_999_999)`), `tambur.controller.ts:34,81,133`
(`length`/`lengthMeters`/`cutLength` `.positive()`), `subcontractor.controller.ts:119,159`.
Servis guard'ı da aynı testi ham JS sayısıyla yapıyor —
`Teks-Erp/src/services/tambur.service.ts:736-738`:
```ts
    for (const c of inputCuts) {
      if (!(c.length > 0)) { throw AppError.badRequest("Kesim uzunluğu pozitif olmalı"); }
```
Zod davranışı ÖLÇÜLDÜ (`/tmp` sondası, zod 4.3.6):
`z.number().positive().max(999999999)` → `0` RED · `-1` RED · `NaN` RED · `Infinity` RED ·
`1e9` RED · **`1e-7` KABUL** · **`5e-324` KABUL**.

**"Koruma yok" teyidi.** Bakılan koruma noktaları: ① Zod (`positive()` — yukarıdaki ölçüm);
② servis guard'ları (`> 0`, aynı JS sayısı — yuvarlamadan ÖNCE koşuyor); ③ DB CHECK envanteri
(`error.middleware.ts:218-226` + `scripts/test_db_invariants.ts` beklenen listesi) — yalnız
**nonneg** kısıtları var, `> 0` kısıtı YOK, yani 0,000 satır DB tarafında da meşru;
④ yazımdan sonra bir "sıfır metraj" kontrolü aranıp bulunamadı
(`grep -rn "currentQty.*=== 0\|initialQty.*<= 0" src` → yazma yollarında 0 vuruş).

**failure_mode.** Tablet numpad'inde ondalık ayracı yanlış basılırsa (`0.0004` / `,0004`)
ya da bir istemci hatası metrajı `1e-7` gönderirse: KK1 "kayıt başarılı" der, barkod basılır,
`rolls` satırı `initialQty = 0.000, currentQty = 0.000` ile doğar. Bu top:
① Envanter listelerinde **0 m** görünür ama statüsü `STOCK`'tur — operatör "metraj girilmemiş"
sanıp düzeltmeye çalışır, "Düzelt" ekranı `currentQty` için yine `positive()` ister ve düzeltme
geçer (tesadüfen doğru yol); ② `where: { currentQty: { gt: 0 } }` süzgeci taşıyan yüzeylerden
**tamamen düşer** (CLAUDE.md 2026-08-12: "aşım kesimi 0'da tıkanmaz — `gt:0` iki daldan
kalktı"), yani bazı ekranlarda hiç görünmez; ③ Tambur kesiminde `0` metrajlı bir parça
`reserveRollBarcodes`'tan bir barkod yakar ve fiziksel karşılığı olmayan bir etiket basılır.

**Veride fiili ihlal (K2).** **Aranamadı — DB erişimi yok.** Erişim gelince koşulacak
(sorgu `audit/repro/E-2-00-probe.ts` içinde hazır):
```sql
SELECT count(*) FROM rolls WHERE "initialQty" = 0;
SELECT count(*) FROM rolls WHERE "initialQty" > 0 AND "initialQty" < 1;   -- yuvarlama adayları
SELECT count(*) FROM rolls WHERE "currentQty" = 0
  AND status NOT IN ('CANCELLED','SCRAP','SHIPPED','TAMBUR_CONSUMED','SUBCONTRACTOR_CONSUMED','KARTELA_CONSUMED');
```

**İş etkisi.** Envanter adedi ile metrajı ayrışır (adet var, metraj yok); sıfır metrajlı top
sevkiyata ve çuvala girebilir, irsaliyede "0 m" satırı doğar.

**Öneri (2. tur için).** Metraj/ağırlık/en alanlarına **anlamlı alt sınır** koy — kolonun
ondalık hassasiyetiyle aynı: `.min(0.001)` (ve `.multipleOf(0.001)` düşünülebilir ama ondalık
kayan noktada kırılgandır, önerilmez). Tek kaynak E-2-03'teki `constants/measure-limits.ts`
olsun. DB tarafında ikinci hat: `CHECK ("initialQty" >= 0.001)` **yalnız yeni satırlar için
güvenli değildir** (eski 0'lar varsa migration düşer) → önce say, sonra karar
`[PROD'DA ÇALIŞTIRMA]`; geri alma `DROP CONSTRAINT`.

**Kabul kriteri.** `initialQty: 0.0004` → 400 "Metraj en az 0,001 m olmalı"; `0.001` kabul;
mevcut bekçilerin metraj fixture'ları değişmeden yeşil.

**Efor.** 0,5 gün (Zod) + ölçüm sonrası DB kısıtı ayrı.

**Önceki defter.** Kayıt yok.

---

## [E-2-05] Barkod sayacının 9999 tavanı ARTIŞTAN SONRA kontrol ediliyor: reddedilen çok-segmentli rezervasyon günün kalan kapasitesini kalıcı olarak yakıyor

| Şiddet | S4 | Kategori | A.6 | Öncelik | P4 | Modül | etiket / barkod üretimi | Kanıt seviyesi | K1 |

**Özet.** `reserveRollBarcodes` sayacı önce `n = n + count` ile **artırır**, sonra tavanı
kontrol edip hata fırlatır. Fonksiyonun kendi sözleşmesi "TX DIŞINDA, tx AÇILMADAN ÖNCE
çağrılmak içindir" diyor ve gerçek çağrı yerleri (`tambur.service.ts:~905` finalize,
KK1 girişi) taban `prisma` client'ıyla çağırıyor — yani **artış hemen COMMIT olur ve hata
onu geri almaz**. Sonuç: tavana çarpan bir istek, çarpmasına gerek olmayan sonraki istekleri
de kalıcı olarak kilitler.

**Kanıt** — `Teks-Erp/src/services/helpers/roll-barcode.helper.ts:82-94`
```ts
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "roll_barcode_counters" ("day","type","n") VALUES (${day}, ${type}, ${count})
    ON CONFLICT ("day","type") DO UPDATE SET "n" = "roll_barcode_counters"."n" + ${count}
    RETURNING "n"`;                          // ← ARTIŞ ÖNCE (ve tx dışıysa anında commit)
  const last = Number(rows[0]?.n ?? 0);
  const first = last - count + 1;
  if (first < 1 || last > MAX_ROLL_SEQ) {    // ← KONTROL SONRA
    throw AppError.conflict(`Bu gün için ${type} top barkod sırası doldu (${MAX_ROLL_SEQ}). …`);
  }
```
Çağrı yeri (taban client) — `Teks-Erp/src/services/tambur.service.ts:~905`:
`const segmentBarcodes = await reserveRollBarcodesInOrder(prisma, segments.map(...));`

**failure_mode.** Gün içinde `F` tipi sayaç 9.850'de. Operatör 200 segmentlik bir Tambur
finalize'ı gönderir → `n = 10.050` yazılır ve COMMIT edilir, sonra istek **409** ile düşer.
O andan itibaren:
① aslında boşta olan **149 barkod** kaybolmuştur;
② tek segmentlik (`count = 1`) bir kesim bile artık geçemez — `last = 10.051 > 9.999`;
③ operatör "geçici hata" sanıp tekrar dener, her deneme sayacı 200 daha ileri iter;
④ hata mesajı "Yarın 0001'den başlar" der, yani sahada **gün sonuna kadar Tambur çıktısı
alınamaz** ve sebebi kapasite değil, kapasiteyi yakan reddedilmiş isteklerdir.

**Bugünkü olasılık — dürüst değerlendirme.** Saha kopyasında toplam 2.431 top var (aylar
boyunca), yani gün+tip başına 9.999'a yaklaşan bir hacim **bugün yok**. Bu yüzden S4. Kayıt,
kalıbın kendisi (`check-after-increment`, geri alınamayan yan etki) ve tavan sözleşmesinin
belge numaralarıyla asimetrisi (bkz. E-2-11) içindir.

**Veride fiili ihlal (K2).** Aranamadı. Erişim gelince:
`SELECT day, type, n FROM roll_barcode_counters WHERE n > 9999 ORDER BY n DESC LIMIT 20;`
(sıfır satır beklenir; satır varsa o gün fiilen kilitlenmiştir).

**İş etkisi.** Yoğun bir günde Tambur çıktısı ve/veya KK1 girişi gün sonuna kadar durur;
teşhis mesajı yanlış yöne (kapasite doldu) gönderir.

**Öneri (2. tur için).** Kontrolü artışın İÇİNE al — tek ifade:
`ON CONFLICT … DO UPDATE SET n = n + ${count} WHERE "roll_barcode_counters"."n" + ${count} <= ${MAX_ROLL_SEQ} RETURNING n`
(satır dönmezse tavan aşıldı → 409, sayaç DEĞİŞMEDEN kalır). Alternatif: rezervasyonu tx
içinde yapmak — ama o, 2026-08-10'da ölçülerek reddedilmiş bir yoldur (1345 ms kilit),
DOKUNMA. Mesaj da düzeltilsin: "bu istek N barkod istedi, kalan M" demeli.

**Kabul kriteri.** `n = 9990` iken `count = 20` isteği 409 döner **ve** `n` 9990'da kalır;
ardından `count = 9` isteği BAŞARILI olur. Bekçi: `scripts/test_barcode_reservation.ts`'e
bölüm (negatif sonda: kontrolü artıştan sonraya alınca kırmızı).

**Efor.** 0,5 gün.

**Önceki defter.** `BULGU-T1-093` (sayaç kilidinin uzun tx içinde tutulması) aynı dosyanın
FARKLI sorusudur (kilit süresi); bu bulgu tavan aritmetiğidir.

---

## [E-2-06] pg adapter'ın haritalamadığı SQLSTATE'ler çıplak `DriverAdapterError` olarak generic 500'e düşüyor — NUL bayt, 50 sn'lik sorgu zaman aşımı ve DEADLOCK aynı "Sunucu hatası oluştu." mesajını veriyor

| Şiddet | S3 | Kategori | I | Öncelik | P3 | Modül | hata yolu (tüm uçlar) | Kanıt seviyesi | K1 |

**Özet.** `@prisma/adapter-pg` yalnız 14 SQLSTATE'i Prisma hata koduna çeviriyor; kalanı
`kind: "postgres"` genel şekline düşürüyor ve bunlar `error.middleware`'in
`PrismaClientKnownRequestError` dalına HİÇ girmiyor. Ekip bu şekli 2026-08-09'da **yalnız
CHECK ihlali (23514)** için özel olarak çözmüş (`extractCheckConstraint`); aynı şeklin diğer
üyeleri hâlâ en sondaki generic 500'e düşüyor. Bunların üçü girdi/yük sınırlarıyla doğrudan
ilgili: **22021** (metinde NUL bayt), **57014** (`statement_timeout` — DB'de 50 sn),
**40P01** (deadlock). Ayrıca ham-sorgu yolunda zaman aşımı `P2010` olarak geliyor ve
`SERVER_FAULT_PRISMA_CODES` listesinde olduğu için operatöre **"Sunucu yapılandırma hatası"**
deniyor — teşhisi yanlış yöne gönderen bir cümle.

**Kanıt**
Adapter eşleme tablosu — `node_modules/@prisma/adapter-pg/dist/index.js:455-548`
(haritalananlar: `22001, 22003, 22P02, 23505, 23502, 23503, 3D000, 28000, 28P01, 40001,
42P01, 42703, 42P04, 53300`; `default:` → `{ kind: "postgres", code, message, … }`).
**Listede olmayanlar:** `23514` (ekip elle çözdü), `22021`, `57014`, `40P01`, `25P02/25P03`, `54000`.

`Teks-Erp/src/middlewares/error.middleware.ts:178-185` — ekibin kendi ölçümü, bu şekli
belgeliyor:
```
 *   • ORM yolu (`prisma.sack.update` vb.) → ÇIPLAK `DriverAdapterError`:
 *     `code`/`meta` YOK … Bu yüzden `PrismaClientKnownRequestError` dalına HİÇ girmez ve
 *     eskiden generic 500'e düşerdi: operatör "Sunucu hatası oluştu." görür, audit'e
 *     `recordId='DriverAdapterError'` yazılır …
```
`error.middleware.ts:355-356` — çözüm **yalnız 23514 için**:
`const checkConstraint = extractCheckConstraint(err); if (checkConstraint !== null) { … }`
(`extractCheckConstraint` gövdesi `:204-206`: `if (c.code !== "23514" && c.originalCode !== "23514") continue;`)
`error.middleware.ts:149-157` — `P2010` (ham sorgu) `SERVER_FAULT_PRISMA_CODES` içinde
→ `:504-513` 500 + *"Sunucu yapılandırma hatası. Lütfen yöneticiyle iletişime geçin."*
`error.middleware.ts:609-633` — son çare: `console.error` + `SYSTEM/ERROR` audit
(`recordId: err.name`) + 500 *"Sunucu hatası oluştu."*
Zaman aşımı gerçekten var: `Teks-Erp/CLAUDE.md` → `statement_timeout=50s` DB seviyesinde aktif
(dev `adnansahin_db`, saha `tekserp`); `docker-compose.yml` `statement_timeout=50s`.
NUL baytın PG'ye kadar gittiği ÖLÇÜLDÜ — arama katlaması onu temizlemiyor
(`audit/repro/E-2-01.log` §6: `NUL: "A B" → "a b"`), Zod string şemalarında da
kontrol-karakteri süzgeci yok (`grep -rn "\\\\u0000\|controlChar" src` → 0 vuruş).

**failure_mode.**
(a) **Devasa girdi → zaman aşımı:** kullanıcı Kalite Karnesi'ni 366 günlük aralıkla açar
(`reports/_shared.ts` bu aralığı MEŞRU sayar, `MAX_RANGE_MS = 366 gün`). Sorgu 50 sn'yi aşar,
PG iptal eder. Ham sorgu yolundaysa operatör **"Sunucu yapılandırma hatası, yöneticinize
iletin"** görür ve audit'e `P2010` + "şema/migration arızası" anlamıyla satır düşer; yönetici
olmayan bir drift'i kovalar. ORM yolundaysa **"Sunucu hatası oluştu."** görür ve audit satırı
`recordId='DriverAdapterError'` ile ayırt edilemez hale gelir. Doğru cevap her ikisinde de
"aralığı daraltın" idi.
(b) **NUL bayt:** JSON `" "` geçerli bir JSON kaçışıdır; bir müşteri adı / not / içe
aktarım hücresi (Excel'den kopyalanan kontrol karakteri) bu baytı taşırsa PG `22021` verir →
**HTTP 500**, operatöre "Sunucu hatası", audit'e her denemede bir `SYSTEM/ERROR` satırı. Alan
kaydedilemez ve sebebi hiçbir ekranda yazmaz (doğrusu 400 "geçersiz karakter" olurdu).
(c) **Deadlock:** `40001` (serialization failure) `P2034`'e çevrilip 409 + tekrar-dene
sözleşmesiyle karşılanıyor (`error.middleware.ts:514-523`), ama gerçek bir PG **deadlock**
(`40P01`) haritada yok → 500. İki kilit sırasının çakıştığı bir an (beceri §4.3'ün ABBA
senaryosu) istemciye "tekrar dene" değil "sunucu çöktü" der; mobil kuyruk 5xx'i geçici sayıp
3 kez dener (mobil `stationRetry`), yani aynı deadlock üç kez daha üretilir.

**Veride fiili ihlal (K2).** Aranamadı. Erişim gelince:
```sql
SELECT "recordId", count(*) FROM system_logs
 WHERE category='SYSTEM' AND action='ERROR' AND "createdAt" > now() - interval '90 days'
 GROUP BY 1 ORDER BY 2 DESC;    -- 'DriverAdapterError' ve 'P2010' satırlarını ara
```

**İş etkisi.** Teşhis kaybı: üç farklı kök neden (girdi çok büyük · girdi geçersiz karakter
taşıyor · kilit çakışması) tek ve yanlış bir mesaja iniyor; operatör düzeltebileceği bir şey
olduğunu öğrenemiyor, yönetici olmayan bir şema arızasını kovalıyor.

**Öneri (2. tur için).** `extractCheckConstraint`'i **`extractDriverSqlState(err)`** olarak
genelleştir (aynı iki şekli tarar, SQLSTATE'i döner) ve bir eşleme tablosu kur:
`22021 → 400 "Metin desteklenmeyen bir karakter içeriyor"` · `57014 → 400/408 "Sorgu 50 saniye
sınırını aştı — tarih aralığını daraltın"` · `40P01 → 409 + Retry-After (P2034 ile aynı
sözleşme)` · `25P03 → 503`. `P2010`'u `SERVER_FAULT` listesinden çıkarma — sadece **önce**
SQLSTATE'e bak, `57014` ise yeni dala düşür. Yeni SQLSTATE görüldüğünde bugünkü fail-loud
davranışı (500 + audit) VARSAYILAN kalsın; bu bilinçli ve doğru.

**Kabul kriteri.** ` ` içeren bir `name` ile master-data yazımı → 400 + anlaşılır Türkçe;
`SET statement_timeout='1ms'` ile koşturulan bir rapor → 400/408 "aralığı daraltın", audit'te
`recordId='STATEMENT_TIMEOUT'`; deadlock sondası → 409. Bekçi: `error.middleware`'in şekil
testine üç yeni SQLSTATE bölümü.

**Efor.** 1 gün.

**Önceki defter.** `BULGU-T1-060` (alarmların PULL olması) komşu ama farklı; bu bulgu
SINIFLANDIRMA boşluğudur. 23514 için yapılan düzeltme (2026-08-09, F-CORE-OPS-002) bu
bulgunun **kanıtıdır**: aynı şeklin bir üyesi çözüldü, kardeşleri açık kaldı.

---

## [E-2-07] İçe aktarım sayı okuması iki yereli desteklediğini söylüyor ama `1e5` → 15, `1,234,567` → null

| Şiddet | S3 | Kategori | C | Öncelik | P1 | Modül | içe aktarım | Kanıt seviyesi | K1 (+ yürütülen sonda) |

**Özet.** `parseLocaleNumber` başlığı "biçimi dayatmak yerine TESPİT et" diyor ve TR/EN
karışık dosyaları desteklediğini iddia ediyor. Ölçüldüğünde iki sapma çıktı: ① sayıdan
harfleri ayıklayan regex `e`/`E` harfini de siliyor → **bilimsel gösterim sessizce yanlış
sayıya dönüşüyor** (`"1e5"` → `15`, hata yok); ② yalnız virgülle gruplanmış EN binlik
(`"1,234,567"`) `NaN` üretip `null` dönüyor → satır "sayı okunamadı" hatasıyla düşüyor,
yani iddia edilen EN desteği o biçimde yok.

**Kanıt** — `Teks-Erp/src/services/import/import-coerce.ts:31-52`
```ts
  const s = raw.replace(/\s/g, "").replace(/[^\d.,+-]/g, "");   // ← 'e'/'E' burada SİLİNİR
  …
  } else if (hasComma) {
    normalized = s.replace(/,/g, ".");                          // "1,234,567" → "1.234.567" → NaN
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
```
**Ölçüm (yürütüldü — `audit/repro/E-2-01.log` §3)**
```
"1.234,56"  → 1234.56     "1,234.56"  → 1234.56     "1234,5" → 1234.5
"1.234"     → 1234        "1.234.567" → 1234567
"%12" → 12                "12 m" → 12
"1,234,567" → null   ❌    "1e5" → 15   ❌            "0,0004" → 0.0004
```

**failure_mode.** Excel büyük ya da çok küçük sayıları hücrede bilimsel gösterimle tutabilir.
`1e5` yazan bir metraj hücresi sisteme **15** olarak girer — sipariş 100.000 m yerine 15 m
açılır, satır YEŞİL görünür ve hiçbir uyarı çıkmaz. (`1E+15` gibi işaretli varyant `"1+15"`e
düşüp `null` verir, yani **aynı sınıfın iki hücresi iki farklı yola gider**: biri sessizce
yanlış, öteki görünür hata — bu tutarsızlık kullanıcının biçime güvenmesini imkânsız kılar.)
İkinci ayak: müşteriden gelen EN yerelli dosyada `1,234,567` yazan satır "sayı okunamadı"
ile düşer; `onError: "abort"` varsayılanıyla **dosyanın tamamı yazılmaz** ve mesaj sebebi
söylemez ("EN binlik ayracı desteklenmiyor" demez).

⚠️ **Bilinçli karara dokunulmuyor:** tek virgüllü `"1,234"`ün 1.234 olarak okunması dosya
başlığında gerekçesiyle yazılı bir TERCİHTİR (`import-coerce.ts:42-45`); bu bulgu onu
yeniden açmıyor. Yalnız iki ölçülen sapmayı kapsıyor.

**Veride fiili ihlal (K2).** Aranamadı (DB erişimi yok). Erişim gelince `import_runs`
tablosundaki `errorReport` JSON'unda `"sayı okunamadı"` içeren satırlar sayılabilir.

**İş etkisi.** Sipariş miktarı / kumaş eni gibi P1 sınıfı sayılar sessizce yanlış girilir;
karşılanma ve MRP hesapları o siparişi baştan yanlış bilir.

**Öneri (2. tur için).** Temizleme regex'i `e`/`E`'yi ELEMEsin ve bilimsel gösterimi ya AÇIKÇA
destekle ya AÇIKÇA reddet (öneri: reddet — fabrika hücresinde `1e5` yazması bir kaza,
15 yazmak sessiz yanlış). EN binlik grubu için: ayraçların **hepsi** aynıysa ve gruplar tam
3 haneliyse binlik say (`^[+-]?\d{1,3}([.,]\d{3})+$` tek kural, iki ayraç için ortak).
Şablonun Açıklama sayfasına desteklenen biçimler yazılsın.

**Kabul kriteri.** `parseLocaleNumber("1e5") === null` (ya da 100000, seçim yazılı olsun);
`parseLocaleNumber("1,234,567") === 1234567`; mevcut yedi biçim (`1.234,56`, `1,234.56`,
`1234,5`, `1.234`, `%12`, `12 m`, `1.234.567`) DEĞİŞMEDEN geçer.

**Efor.** 0,5 gün.

**Önceki defter.** Kayıt yok.

---

## [E-2-08] `parseBool`: ASCII yazımlı "hayir" tanınmıyor — "aktif/pasif" için iki yazım eklenmiş, "hayır" için unutulmuş

| Şiddet | S4 | Kategori | F | Öncelik | P6 | Modül | içe aktarım | Kanıt seviyesi | K1 (+ yürütülen sonda) |

**Özet.** `parseBool` girdiyi `toLocaleUpperCase("tr-TR")` ile büyütüyor; Türkçe kuralda
`i → İ`. Sözlükte `AKTIF` ve `AKTİF`, `PASIF` ve `PASİF` çiftleri **ikişer** yazılmış, ama
`HAYIR` tek yazılmış — `HAYİR` yok. Sonuç: Türkçe klavyesi olmayan bir kullanıcının yazdığı
`hayir` **hiç tanınmıyor**.

**Kanıt** — `Teks-Erp/src/services/import/import-coerce.ts:54-63`
```ts
const TRUE_WORDS  = new Set(["EVET","E","TRUE","1","AKTIF","AKTİF","VAR","X","YES","Y"]);
const FALSE_WORDS = new Set(["HAYIR","H","FALSE","0","PASIF","PASİF","YOK","NO","N"]);
//                            ^^^^^ "HAYİR" YOK
export function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLocaleUpperCase("tr-TR");
```
**Ölçüm (yürütüldü — `audit/repro/E-2-01.log` §4)**
```
"evet" → true      "hayır" → false      "aktif" → true      "pasif" → false
"hayir" → null  ❌   (tr-TR('hayir') = "HAYİR")
```

**failure_mode.** Fabrikanın hazırladığı içe aktarım dosyasında "Aktif" sütununa `hayir`
yazılmış satırlar `Aktif: 'hayir' anlaşılmadı — Evet/Hayır yazın` hatası verir ve varsayılan
`onError: "abort"` ile **dosyanın tamamı reddedilir**. Hata görünürdür (fail-closed, iyi yön)
ama sebebi anlaşılmazdır: aynı hücreye `hayır` yazınca çalışır, `hayir` yazınca çalışmaz ve
fark görsel olarak tek bir noktadır.

**İş etkisi.** İçe aktarım turu boşa gider; kullanıcı farkı bulana kadar dosyayı satır satır
arar.

**Öneri (2. tur için).** `FALSE_WORDS`'e `"HAYİR"` ekle. Kalıcı çözüm: karşılaştırmayı
`utils/code-format.foldCodeForCompare` ile yap (i-ailesini `I`'ya indirger; repoda bu sorunun
tek doğru cevabı olarak zaten yazılı) — o zaman sözlükte tek yazım yeter ve gelecekteki her
kelime otomatik korunur.

**Kabul kriteri.** `parseBool("hayir") === false`, `parseBool("HAYIR") === false`,
`parseBool("hayır") === false`; `parseBool("V") === null` (bugünkü davranış korunur).

**Efor.** 0,25 gün.

**Önceki defter.** `BULGU-T1-087` (içe aktarım anahtar katlaması `toLocaleUpperCase("tr-TR")`)
aynı kök nedenin ANAHTAR ayağıdır; bu, aynı dosyanın **sözlük** ayağıdır ve ayrı satır olarak
düzeltilir.

---

## [E-2-09] İçe aktarım enum hücresi Türkçe katlamayla eşleştiriliyor: `internal` / `critical` küçük harfle yazılınca reddediliyor, Türkçe etiketleri çalışıyor

| Şiddet | S4 | Kategori | F | Öncelik | P6 | Modül | içe aktarım | Kanıt seviyesi | K1 (+ yürütülen sonda) |

**Özet.** `coerceCell`'in `enum` dalı hem hücreyi hem katalog değerini
`toLocaleUpperCase("tr-TR")` ile büyütüyor. Enum **kodları İngilizce ve ASCII**'dir
(`INTERNAL`, `CRITICAL`, `WAREHOUSE`…); Türkçe büyütme `i → İ` yaptığı için küçük harfle
yazılmış kod eşleşmiyor. Repoda bu tam olarak yasaklanmış bir kalıptır: *"kod KİMLİKTİR,
görüntü metni değil"* (`helpers/fold-type.ts:15-18`, `config/label-elements`,
`utils/code-format.foldCodeForCompare`).

**Kanıt** — `Teks-Erp/src/services/import/import.service.ts:93-104`
```ts
    case "enum": {
      const wanted = text.toLocaleUpperCase("tr-TR");
      const match = col.enumValues?.find((e) =>
          e.value.toLocaleUpperCase("tr-TR") === wanted ||
          e.label.toLocaleUpperCase("tr-TR") === wanted);
```
Etkilenen katalog değerleri (`adapters/station.adapter.ts:35`, `defect-type.adapter.ts:37-39`):
`INTERNAL`, `CRITICAL`. **Ölçüm (`audit/repro/E-2-01.log` §5):**
```
'internal'   vs 'INTERNAL'   → EŞLEŞMEZ (tr-TR: İNTERNAL)
'critical'   vs 'CRITICAL'   → EŞLEŞMEZ (tr-TR: CRİTİCAL)
'consumable' vs 'CONSUMABLE' → EŞLEŞİR       (i içermiyor)
```

**failure_mode.** Kullanıcı istasyon içe aktarım dosyasında Tip sütununa (şablonun kendi
`value` alanından kopyaladığı) `internal` yazar; satır
`Tip: 'internal' geçerli değil. Kabul edilenler: İç · Fason (Dış)` hatasıyla düşer.
`onError: "abort"` varsayılanıyla dosya yazılmaz. Fail-closed olduğu için veri bozulmaz —
bedel kullanıcının anlayamayacağı bir ret ve boşa giden içe aktarım turudur.

**İş etkisi.** İçe aktarım kurulum işidir; her ret turu saatler alabilen elle düzeltmeye
dönüşür.

**Öneri (2. tur için).** Enum karşılaştırmasını `foldCodeForCompare` ile yap (E-2-08'in
önerisiyle aynı fonksiyon). Etiket eşleşmesi Türkçe kalabilir ama o da aynı fonksiyondan
geçmelidir (`İç` ↔ `iç` bugün de çalışıyor, katlamayla da çalışır).

**Kabul kriteri.** `internal`, `INTERNAL`, `İç`, `iç` dördü de `INTERNAL`'a çözülür;
bilinmeyen değer hâlâ hata verir.

**Efor.** 0,25 gün (E-2-08 ile birlikte tek dokunuş).

**Önceki defter.** `BULGU-T1-087` — aynı dosyanın anahtar ayağı; bu ENUM ayağıdır.

---

## [E-2-10] `PATCH /reason-presets/reorder` mükerrer id'yi elemiyor: kontrol kümeye değil DİZİ uzunluğuna bakıyor, bir satır hiç sıralanmıyor

| Şiddet | S4 | Kategori | F | Öncelik | P4 | Modül | sebep katalogları | Kanıt seviyesi | K1 |

**Özet.** Sıralama ucu "istemci TÜM listenin id'lerini gönderir" sözleşmesini
`ids.length !== known.size` ile doğruluyor. Bu kontrol **mükerrer id'yi görmüyor**: `[a, a]`
gönderilirse (bilinen id sayısı 2 iken) uzunluk eşit ve her id bilinen olduğu için kapı
açılır; `a` iki kez güncellenir, `b`'nin `sortOrder`'ına hiç dokunulmaz.

**Kanıt** — `Teks-Erp/src/services/reason-preset.service.ts:497-513`
```ts
    const rows  = await prisma.reasonPreset.findMany({ where: { kind }, select: { id: true } });
    const known = new Set(rows.map((r) => r.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new AppError("Sıralama listesi eksik veya yabancı kayıt içeriyor", 400);
    }
    await prisma.$transaction(ids.map((id, i) =>
      prisma.reasonPreset.update({ where: { id }, data: { sortOrder: i, … } })));
```
Şema doğrulaması yalnız biçimi bilir — `routes/reason-preset.routes.ts:54-57`
(`ids: z.array(z.string().uuid()).min(1)`, `.refine` YOK).
"Koruma yok" teyidi: `sortOrder` üzerinde unique kısıt yok
(`grep -n "sortOrder" prisma/schema.prisma` — `@@unique` içeren satır yok), yani iki satırın
aynı sırayı taşıması DB'de de meşru.

**failure_mode.** İstemci köprüsü `mergeVisibleOrder` görünen aktif satırların sırasını gizli
(pasif) satırlarla harmanlıyor (`mobil/.../reasonPreset.order.ts`); bir kaydırma yarışında ya
da o birleştirmedeki bir hatada aynı id iki kez listeye girerse sunucu **400 vermez**, sıra
kısmen uygulanır ve iki satır aynı `sortOrder`'a düşer. O andan sonra Tambur'un sebep
listesinde o iki satırın sırası PostgreSQL'in döndürme sırasına kalır — operatör listeyi her
açtığında farklı bir sırayla görebilir ve "sürükledim, kaydolmadı" der. Kayıt kaybı yok,
görünür hata da yok.

**Veride fiili ihlal (K2).** Aranamadı. Erişim gelince:
`SELECT kind,"sortOrder",count(*) FROM reason_presets GROUP BY 1,2 HAVING count(*)>1;`

**İş etkisi.** Fabrikanın kendi belirlediği sebep sırası sessizce bozulur; 2026-08-26'da tam
bu ekran için yapılan "sıra sürüklenerek KALICI" işi kısmen boşa düşer.

**Öneri (2. tur için).** Kontrolü kümeye çevir:
`const uniq = new Set(ids); if (uniq.size !== ids.length || uniq.size !== known.size || …) throw`.
Zod tarafında da ucuz bir ikinci hat: `.refine(a => new Set(a).size === a.length, "Liste mükerrer id içeriyor")`.

**Kabul kriteri.** `ids = [a, a]` (bilinen: a, b) → 400; `ids = [b, a]` → 200 ve iki satır da
farklı `sortOrder` alır. Bekçi: `scripts/test_reason_presets.ts`'e bölüm (negatif sonda:
kontrolü diziye geri alınca kırmızı).

**Efor.** 0,25 gün.

**Önceki defter.** Kayıt yok.

---

## [E-2-11] `nextDailySeq` tavansız: 9999'dan sonra üretilen belge kodu kendi tarama biçim doğrulamasından (`isDailyCode`) düşüyor

| Şiddet | S4 | Kategori | A.6 | Öncelik | P6 | Modül | belge numaraları | Kanıt seviyesi | K1 (+ yürütülen sonda) |

**Özet.** Top barkodunda gün+tip başına 9.999 tavanı **zorlanıyor** (E-2-05, `AppError.conflict`).
Aynı `PREFIX+GGAAYY+NNNN` kalıbını kullanan **belge numaralarında** (SIP · İE · CV · RK · FS · …)
hiçbir tavan yok: `nextDailySeq` `max + 1` döner, `buildDailyCode` `padStart(4)` ile onu 5
haneli yazar ve kod bir karakter uzar. `isDailyCode` (okutma/arama biçim kapısı) `\d{4}` ile
sabitlendiği için o kodu **tanımaz**.

**Kanıt** — `Teks-Erp/src/utils/code-format.ts:96-112`
```ts
export function nextDailySeq(codes, fullPrefix): number { … return max + 1; }   // tavan YOK
export function buildDailyCode(prefix, seq, date, digits = 4): string {
  return `${dailyCodePrefix(prefix, date)}${String(seq).padStart(digits, "0")}`; }
export function isDailyCode(code, prefix, digits = 4): boolean {
  const re = new RegExp(`^${prefix}\\d{6}\\d{${digits}}$`); return re.test(code.toUpperCase()); }
```
Karşılaştırma çıpası — tavanın ZORLANDIĞI ikiz:
`Teks-Erp/src/services/helpers/roll-barcode.helper.ts:22,90-94` (`MAX_ROLL_SEQ = 9999` + 409).
Tüketiciler: `services/shipping.service.ts:494` ve `services/sack-search.service.ts:554`
(`isDailyCode(code,"CV")` → çuval okutma dalı), `services/traveler-card.service.ts:72`
(`isDailyCode(code,"IE") || isDailyCode(code,"RK")`).
**Ölçüm (`audit/repro/E-2-01.log` §8):**
```
max=9999 → sıradaki seq=10000, kod=SIP12072610000 (uzunluk 14) → isDailyCode(...) = false
```

**failure_mode.** Bir günde 9.999'dan fazla çuval açılırsa (ya da veri taşıma/içe aktarım
sırasında aynı gün için toplu kod üretilirse) 10.000. çuvalın kodu `CV12072610000` olur.
Operatör o çuvalı okuttuğunda `scanSack` biçim kapısından geçemez, kod "çuval" sayılmaz ve
top barkodu dalına düşer → **"bulunamadı"**. Kayıt DB'de vardır, bulunamayan şey onu bulma
YOLUDUR; ve hata mesajı sebebi söylemez.

**Bugünkü olasılık.** Saha kopyasında toplam 40 sevkiyat / 278 sipariş var — günlük 9.999
hiçbir prefix'te yakın değil. S4'ün sebebi budur; kayıt, **tavan sözleşmesinin iki kod ailesi
arasında ayrışmış olması** içindir (barkod 409 verir, belge numarası sessizce biçim dışına
çıkar).

**Veride fiili ihlal (K2).** Aranamadı. Erişim gelince:
`SELECT "sackNo" FROM sacks WHERE length("sackNo") <> 12 LIMIT 20;` (ve `orders."orderNo"`,
`work_orders."workOrderNumber"`, `subcontractor_dispatches."dispatchNo"` için aynısı).

**Öneri (2. tur için).** `buildDailyCode`, `seq > 10^digits - 1` ise `AppError.conflict`
fırlatsın (top barkoduyla aynı sözleşme, aynı mesaj kalıbı: "bugünkü sıra doldu"). Parti
numarası (`digits = 1`) BU KONTROLÜN DIŞINDA kalmalı — orada dolgusuzluk ve serbest hane
BİLİNÇLİ bir karardır (`code-format.ts:25-37`).

**Kabul kriteri.** `buildDailyCode("SIP", 10000)` → `AppError` 409; `buildDailyCode("P", 12345, d, 1)`
DEĞİŞMEDEN `P…12345` üretir (parti no regresyon çıpası).

**Efor.** 0,25 gün.

**Önceki defter.** Kayıt yok. `BULGU-T2-027` (parti no sarması) komşu ama farklı bir karardır.

---

# Uygulanan kontrol listesi

| Madde (görev tanımı) | Durum |
|---|---|
| **E2a** metraj 0 / negatif / 1e9 / NaN / '12,5' / '12.50 m' — KK1, kesim, fason kabul, iade, sevk allocation | **uygulandı** → E-2-03 (üst sınır), E-2-04 (alt sınır). NaN/Infinity: zod 4'te REDDEDİLİYOR (ölçüldü) — bulgu değil. Türkçe ondalık `'12,5'`: HTTP uçlarında `z.number()` string kabul etmiyor → 400 (doğru); içe aktarımda `parseLocaleNumber` çözüyor → E-2-07. `1e9`: `.max(999_999_999)` sınırında (ölçüldü: `1e9` RED, `999_999_999` KABUL, `Decimal(12,3)` tam sığıyor) — bulgu yok. Kesimde parçalar toplamı > parent: guard VAR (`tambur.service.ts:733-756`, Decimal aritmetiği + `tamburOverQuantityEnabled` bayrağı) — bulgu yok. |
| **E2b** boş liste: kesim 0 parça · toplu iade [] · kurşun dağıtım [] · apply-attribute [] · merge 0 kaynak · import boş/başlık · reorder [] | **uygulandı** → yalnız E-2-10 çıktı. Diğerlerinin hepsinde koruma DOĞRU: `cuts.default([])` bilinçli (kalan kuyruk tek çocuk olur), `return.controller.ts:21` `.refine` en az bir top, `kursun-bypass.controller.ts:43,52,60` `.min(1)`, `applyAttributeSchema.min(1)`, merge `sourceIds` filtrelenip **boş kalırsa 400** (`master-data-merge.service.ts:531-533`), `import.routes.ts:83` `rows.min(1)`. |
| **E2c** çok büyük: 10.000 satır import · 5.000 toplu kesim · 1 MB json (T1-045) · cursor `take=100000` · 10k karakterlik arama · 1 karakterlik pg_trgm | **uygulandı** → yeni bulgu YOK, ama E-2-06 bu eksenden doğdu (devasa girdi → 50 sn sınırı → yanlış hata sınıfı). Ölçümler: import `assertRowLimit(10000)` + satır-satır yazım (dev tx yok) ✅; kesim `.max(200)` ✅; cursor `limit` `Math.min(max(1,raw),200)` (`base.service.ts:529`) + derin offset 400 (`:544-551`) ✅; `pageSize` clamp DEĞİL 400 (`query-parser.ts:46-51`) ✅; `/api/search` `q` `.min(2).max(100)` ✅. **Kapsam dışı kalan tek alt madde:** liste uçlarındaki `search` parametresinin uzunluk sınırı yok (`query-parser.ts:56`) — ama katlama+`contains` yolu 10k karakterle de doğru sonuç verir ve DoS ölçümü yapılamadı (DB yok), bulgu yazılmadı. |
| **E2d** Unicode/Türkçe: İ/ı/I/i katlama · nameFold JS↔SQL · NBSP/zero-width/emoji/RTL/` ` · çok uzun ad · barkod büyük-küçük · aynı ad farklı boşluk | **uygulandı** → E-2-06 (NUL), E-2-08, E-2-09. `foldSearchText` ↔ `tr_fold` sözleşmesi ve bekçisi (`test_fold_contract.ts`, tüm BMP) YERİNDE ve doğru — sondada NBSP/emoji/RTL beklendiği gibi davrandı. `normalizeScanCode` tek kapı: barkod/kart/çuval arayan 20+ nokta taranıp hepsinin ondan geçtiği doğrulandı (bypass bulunamadı). Çok uzun ad: 125 `@db.VarChar` kolonu var → `22001` → `P2000` → 400 (doğru sınıflandırma, `error.middleware.ts:161`). |
| **E2e** tekrar gönderim: aynı token FARKLI gövde · iptal edilmiş kaydın token'ı · token'sız uçta çift POST | **uygulandı** → E-2-02 (TÜM uçların sınır tablosu çıkarıldı). "İptal edilmiş kaydın token'ı" `BULGU-T1-006`/`T3-010`'da açık — yeni kanıt olmadığı için yeniden AÇILMADI, tabloda referansla duruyor. Token'sız uçta çift POST: durum geçişleri atomik claim ile korunuyor (beceri §8 YP kuralı) — bulgu yazılmadı. |
| **E2f** UUID param: geçersiz uuid · başka tablonun uuid'si · silinmiş/tombstone id | **uygulandı — bulgu YOK.** `assertValidUuid` (`middlewares/uuid-param.middleware.ts:18-25`) + `P2007`/`P2023` dalları (`error.middleware.ts:447,457`) geçersiz uuid'yi her iki yoldan da **400**'e çeviriyor; ölçüm gerektiren "kapsanmayan ~95 rota"da bile sonuç 400 (Prisma kodu üzerinden), 500 değil. Tombstone id: birleştirme motoru tombstone'a `isActive:false` yazıyor (`master-data-merge.service.ts:715-731`) ve yazma uçları `isActive` arıyor (`shipping.service.ts:220-224` emsali) → tombstone fiilen elenir. |
| **E2g** enum dışı değer · bilinmeyen alan (strip mi reject mi) · null vs undefined üçlü sözleşme | **uygulandı — bulgu YOK (E-2-09 hariç).** Enum dışı: `z.enum` → 400. Bilinmeyen alan: istemci uçlarında bilinçli olarak STRIP (`inventory.controller.ts:49-55` gerekçesi eski APK uyumu), panel↔backend ucunda `z.strictObject` (`feature-flag.routes.ts:94`) — asimetri **yazılı ve gerekçeli**, bulgu değil. Üçlü sözleşme: `foldTypeSchema` (`helpers/fold-type.ts:65-70`) ve `resolveFoldTypeForWrite` (`:112-119`) `undefined→dokunma / null→temizle` ayrımını doğru uyguluyor; `import-coerce.ts:4-9` aynı kuralı hücre düzeyinde tekrarlıyor (boş hücre ≠ NULL). Yanlış yorumlayan bir uç bulunamadı. |
| **E2h** dosya: `.csv` uzantılı xlsx · 0 byte · 50 MB | **kapsam dışı — sebep:** backend dosya ALMIYOR. İçe aktarım gövdesi `{ rows: [{ rowNo, cells }] }` JSON'dur (`routes/import.routes.ts:65-70`); dosya ayrıştırma Electron'da yapılır. Backend'in dosyaya dokunduğu tek yer yedek indirme/geri yükleme (`admin` uçları) ve o bu denetçinin alanı değil (E-3/E-1). |
| **Repro yükümlülüğü** (2-4 güçlü aday) | **uygulandı — kısmen tetiklendi.** `audit_repro_E-2-01.ts` (saf fonksiyon, DB'siz) YÜRÜTÜLDÜ ve 7 sapma ölçtü. `audit_repro_E-2-02.ts` (clientToken sınır tablosu) yazıldı, koşturuldu, **DB erişilemediği için tetiklenemedi** — negatif sonuç `audit/repro/E-2-02.log`'ta. `audit_repro_E-2-00-probe.ts` DB erişim sondasıdır ve erişimsizliği belgeler. |
| **K2 (veride fiili ihlal) taraması** | **uygulanamadı — sebep:** dev (`adnansahin_db`) ve saha (`tekserp_saha_0825`) DB'leri oturum boyunca `Postgres.app failed to verify "trust" authentication` veriyor; hem `audit/tools/sql-dev.sh`/`sql-saha.sh` hem Prisma hem unix soket denendi. Ortamı düzeltmek (PostgreSQL yeniden başlatma) denetim kapsamı dışıdır. Her bulguya koşulacak SQL YAZILDI. |

---

# Doğru yapılanlar (korunması gereken kalıplar)

1. **Sayısal doğrulama tavanları KK1 ve Tambur yollarında bilinçle konmuş ve gerekçeleri yazılı.**
   `inventory.controller.ts:23-26` (`.max(999_999_999)` = `Decimal(12,3)`'ün tam kapasitesi),
   `tambur.controller.ts:34` (`.max(100_000, "Kesim uzunluğu gerçekçi değil")`),
   `statsBatchSchema.max(12)` (`inventory.controller.ts:84-90` — tavanın **havuz checkout'u**
   olduğunu ve gerçek genişliğin 8 olduğunu ölçerek yazmış). Bu, E-2-03'ün düzeltmesi için
   hazır bir emsaldir: tavan koymak değil, tavanı ÖLÇÜP gerekçelendirmek örnek alınmalı.
2. **Sayfa boyutunda "sessiz clamp" yerine açık 400.** `query-parser.ts:36-51`:
   *"Sessiz clamp yanıltıcıdır: istemci `pageSize=99999` istese 100 alır, eksik kayıt görür,
   'kayıp veri' sanır."* Aynı ilke `base.service.ts:544-551`'de derin offset için de
   uygulanmış (F47: sessiz boş dönüş yerine net 400). Sınır durumu denetiminin en sık bulduğu
   arıza tam olarak budur ve burada baştan kapatılmış.
3. **Arama katlamasının JS↔SQL sözleşmesi ve onun BMP genişliğinde bekçisi.**
   `utils/search-fold.ts:1-48` — `unaccent`in neden reddedildiği ölçümle yazılmış, `\s`
   yerine AÇIK boşluk sınıfı kullanılmış (`[ \t\n\r\f\v]` — JS `\s` NBSP'yi kapsar, PG C
   locale kapsamaz), ASCII-only küçültme seçilmiş. Sondada NBSP/emoji/RTL davranışı
   sözleşmeyle **birebir** çıktı. Bu, Unicode sınır denetiminde gördüğüm en sağlam kalıp.
4. **Boş/mükerrer girdiye karşı merge motorunun katmanlı kapısı.**
   `master-data-merge.service.ts:531-541`: Zod `.min(1)`'den sonra servis dedup + self-exclusion
   yapıyor **ve kalan liste boşsa 400 veriyor** — yani "Zod geçti, servis güvenir" tuzağına
   düşmemiş. E-2-10 tam olarak bu disiplinin uygulanmadığı yerdir; düzeltme buradan kopyalanabilir.
5. **Hata sınıflandırmasının açıkça yazılmış ölçüsü.** `error.middleware.ts:138-146`:
   *"Ayrımın ölçüsü 'hata mesajı ne diyor' değil: istemcinin gönderdiği veriyi değiştirerek
   bu hatadan kurtulabilir mi?"* + tanınmayan Prisma kodunda **fail-loud** varsayılan. E-2-06
   bu kuralın uygulanmadığı bir alan değil, **henüz uzatılmadığı** bir alandır.
6. **İdempotent replay'de payload özdeşliği (F117) — dört uçta doğru kurulmuş** ve
   `CLIENT_TOKEN_COLLISION` gövdesi `existing`/`incoming` ikilisini taşıyor
   (`inventory.service.ts:984-1000`), yani istemci farkı kullanıcıya gösterebiliyor.
   E-2-02 bu kalıbın kopyalanmasını istiyor, yenisini icat etmiyor.

---

# Sınır ötesi notlar

- **[D-A / eşzamanlılık]** `roll-barcode.helper.ts:82-94`'teki `INSERT … DO UPDATE … RETURNING`
  atomiktir ve yarış üretmez; sorun aritmetiktir (E-2-05). Eşzamanlılık denetçisinin buraya
  bir kez daha bakmasına gerek yok.
- **[D-I / hata-gözlemlenebilirlik]** E-2-06'daki `SYSTEM/ERROR` audit satırlarının
  `recordId` alanı üç farklı kök nedeni tek değere (`DriverAdapterError`) indiriyor;
  `/health` sayacı ve alarm eşikleri bu alandan besleniyorsa (`BULGU-T1-060` bağlamı)
  ayrıştırma oraya da yansımalı.
- **[D-H / performans]** `utils/query-parser.ts:56` — liste uçlarındaki `search` parametresinin
  uzunluk sınırı yok (`/api/search` 100 karakterle sınırlı, liste uçları değil). 10k
  karakterlik bir terim `foldSearchTokens` ile onlarca `contains` koşuluna açılır
  (`buildTextSearch`). Ölçüm yapılamadığı için bulgu yazılmadı; performans denetçisi
  EXPLAIN ile ölçebilir.
- **[D-G / güvenlik]** `utils/query-parser.ts:160-172` — `buildWhereClause` filtre ADINI
  hiçbir allowlist'ten geçirmiyor (`where[field] = value`). Sonuç bugün 400 (Prisma
  validation) ama uç, istemcinin modeldeki HERHANGİ bir kolona göre süzmesine izin veriyor;
  ayrıca `value.includes(",")` her virgüllü metni sessizce `{ in: [...] }`'e çeviriyor
  (serbest metin filtrelerinde 0 satır üretir). Yetki/izolasyon denetçisinin alanı.
- **[D-K / bekçiler]** `test_fold_contract` (JS↔SQL) ve `test_batch_number_format` gibi
  "sözleşme bekçileri" güçlü; buna karşılık **Zod katmanının kendisini** ölçen bir bekçi yok
  (`BULGU-T1-075`: bekçilerin %96'sı servisi doğrudan çağırıyor). E-2-03/E-2-04/E-2-08/E-2-09
  bulgularının tamamı Zod katmanında yaşıyor ve bugün hiçbir bekçi tarafından koşulmuyor.
- **[ops]** Denetim ortamı: yerel PostgreSQL (Postgres.app) kimlik doğrulama diyaloğu
  gösteremediği için tüm bağlantıları reddediyor. Sonraki turların K2/K3 üretebilmesi için
  bu düzeltilmeli (`audit/repro/E-2-00-probe.log`).

---

# KAPSANMAYAN / ERİŞİLEMEYEN

1. **K2 (veri) ve K3 (eşzamanlı repro) kanıtları** — dev ve saha DB'leri erişilemez
   (yukarıda ayrıntılı). Tüm bulgular bu yüzden en fazla **K1**; S0 verilmedi. Her bulgunun
   altında koşulacak SQL hazır bırakıldı.
2. **E2h (dosya sınırları)** — backend dosya almıyor, kapsam dışı (gerekçe kontrol listesinde).
3. **Electron/mobil istemci doğrulama katmanı** — yalnız token yapışma davranışı ve fason
   çekme uyarısı için okundu (E-2-02, E-2-03); istemci taraflı sınır denetimi bu görevin
   kapsamı değil.
4. **Rapor sorgularının gerçek süre ölçümü** (E-2-06'nın 57014 ayağı) — `EXPLAIN ANALYZE`
   koşulamadı; zaman aşımının **sınıflandırılmadığı** kod okumasıyla kesindir, **tetiklendiği**
   ölçülmedi.
5. **`Decimal(12,3)` yuvarlama davranışının canlı doğrulaması** (E-2-04) — PostgreSQL
   `numeric` semantiği standarttır ama bu kurulumda çalıştırılarak doğrulanmadı.
6. **Prod (canlı fabrika)** — erişim yok, hiçbir sorgu koşulmadı (kural gereği).
