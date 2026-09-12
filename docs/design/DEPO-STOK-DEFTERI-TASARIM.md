# Depo stok defteri — `WarehouseMovement` konum defterinden stok defterine

> **Durum: CANLI TASARIM.** Ölçüm bitti, kararlar alınıyor. Uygulama üç commit'e bölündü (§9).
> Doktrin: `docs/kurallar/defter.md`. Karar mercii bu belgedir; uygulayan oturum burada yazanı tartışmaz, uygular.
> Ölçüm tarihi 2026-09-12, hedef `tekserp_fabrika_dev` (fabrikanın 11 Eylül 03:00 yedeği), **test artığı süzülmüş**.

## 0. Tek cümle

`WarehouseMovement` bugün **konum defteridir** ("mal hangi depoya girdi/çıktı"); **stok defterine** dönüşecek:
depodaki malın miktarını değiştiren HER olay satır yazacak, böylece `Σhareket + açılış ↔ canlı stok` mutabakatı
ve geçmiş tarihli (as-of) stok kesiti mümkün olacak.

## 1. Ölçüm — bugünkü gerçek

### 1.1 Defterin kapsamı
Defter **2026-09-04 17:26**'da, DP-MERKEZ deposunun yaratıldığı anda başlıyor.

| | Adet | Not |
|---|---|---|
| Defter ÖNCESİ doğan top | 4.553 | `warehouseId` **NULL**, defterde satırı yok |
| Defter SONRASI doğan top | 1.231 | hepsinde depo dolu, **667'sinde** satır var |
| Defter satırı | 709 | ENTRY 346 · SHIPMENT 334 · SHIPMENT_REVERSAL 15 · CANCEL 14 |

TRANSFER, RETURN ve CANCEL_REVERSAL satırı **hiç yok**. Tek depo, `depo.multiEnabled=false`.

### 1.2 Mutabakat farkının nedenleri (S4 kümesi: canlı + fasondaki mal)

| Neden | Adet | Metraj |
|---|---|---|
| Depodaki tambur çocuğunda giriş yok | 516 | −17.696,9 |
| Girişi olmadan sevk edilen çocuk | 319 | −12.586,6 |
| Tambur ebeveyninin tüketim çıkışı yok | 23 | +13.593 |
| Fason tüketim çıkışı yok | 84 | +10.043 |
| Fason sevk çıkışı yok | 82 | +9.487 (S3) / 0 (S4) |

Sevk ve iptal tarafı **kusursuz**: 319 SHIPPED topun 319'unda net tek SHIPMENT (belge ve metraj eşleşiyor),
girişi olup iptal edilen 14 topun 14'ünde CANCEL satırı var. **Bugün depoda olan topların yalnız %15,3'ünün
defter izi tutarlı.**

### 1.3 İkinci, sınıflandırmadan bağımsız kusur: qty semantiği
Giriş satırı topun **doğuş** metrajını (`initialQty`), çıkış satırı **o anki** metrajı (`currentQty`) yazıyor.
120 m giren, 40 m kesilen, 80 m sevk edilen top defterde *"40 m hâlâ depoda"* der; oysa top gitmiştir.
**Σ, diğer delikler kapansa bile aritmetik olarak kapanamaz.**

### 1.4 Bugünkü gerekçe ölçümle çürüdü
`TICARET-PAKETI-TASARIM.md` §3: *"kesim çocuğuna ENTRY yazmak malı iki kez saydırırdı"*. Ölçüm: depoya giren
malın **tamamı** (516 top) tambur finalize çocuğu ve girişi yok; **ebeveynin de çıkışı yok**. Çift sayım
korkusu, ebeveyn çıkışı yazılmadığı için doğmuş bir korkudur. Çift kayıtla toplam korunur ve yeni veride
özdeşlik kuruşu kuruşuna kapanıyor: `tüketilen 13.593 = canlı çocuklar 13.502,7 + düzeltme 141,1 − aşım 50,8`.
Sektör de aynı yeri işaret ediyor: SAP'ta kesim **1:N transfer postingidir** (MILL_CUT), net sıfırdır.

### 1.5 Statü terfisi bu fabrikada hiç yaşanmamış
`finalizedAt ≠ createdAt` olan top **0**: bugüne dek final statüye varan her top **final statüde doğmuş**.
Terfi yazarları (`roll-finalize`, `roll-disposition`, `rescueStuckRoll`, `prepareRawForSale`, `quickOrderFromRolls`)
kod yolu olarak canlı ama fabrika verisiyle **doğrulanamaz** — yalnız fikstürlü bekçiyle ölçülür. Kapı yine de
fail-closed kurulur: "bu fabrikada olmuyor" gerekçesiyle yol atlanmaz.

### 1.6 Eksik eksen konum değil, DURUM ve MİKTAR
`warehouseId` doğuştan sonra yalnız transferle değişiyor, hiç null'lanmıyor ve iki yönü de defter yazıyor —
**konum ekseni zaten kusursuz**. Yazmayan ~45 yolun hepsi ya statü (üretime alma, fason/kartela, iptal, terfi)
ya metraj (kesim, çekme, düzeltme, aşım) ekseninde.

### 1.7 Üçüncü kusur: fason kabulünde fazla sayım (ölçüldü, canlı)
Fason dönüşünde doğan toplar ara adımda **üretime** doğuyor (`bornStatus = IN_PRODUCTION`) ama defter koşulsuz
`ENTRY` yazıyor. Bu fabrikada fason-dönüşü ENTRY'lerinin **57/57'si** böyle: 34 IN_PRODUCTION + 23 TAMBUR_CONSUMED,
**32.044 m**. Yani bugünkü defter yalnız eksik değil, bir yerde de **fazla** sayıyor. Ayrıntı ve sıra: §3.1.
⚠️ `tekserp_fabrika_dev` kopyasında 2026-09-12'de 69 / 33.148 m görünür: fazladan 12 satır `TST-` iş emirli TEST
ARTIĞIDIR (bekçi koşumlarının fixture'ları, `clean_test_residue.ts` kapsamı), fabrika verisi değil — onarım script'i
(`scripts/onarim_fason_donus_entry.ts`) bunları "TEST ARTIĞI" diye ayırır ve terslemez; gerçek sayı 57 / 32.044 m.

## 2. "Depoda" kümesi — bugün 16+ kopya, ikisi çelişiyor

`COUNTABLE_ROLL_STATUSES` (sayım) · `FREE_STOCK` (iki ayrı inline kopya) · `TRANSFERABLE` · `MOVABLE_STATUSES` ·
`SELLABLE_DISPOSITION` · `FINISHED_STOCK` · `getWarehouseScope` (yalnız WAREHOUSE) · stok karnesi (string literal,
enum değil) · `consistency-check.sql` §7 (SQL literali) …

⚠️ **Açık çelişki:** `TRANSFERABLE` `RETURNED_FROM_SUBCONTRACTOR` topu taşımaya izin verir **ve TRANSFER satırı
yazar**; `COUNTABLE_ROLL_STATUSES` aynı statüyü gerekçe yazarak sayımdan dışlar. Yani defterde bugün, sayımın
"orada değil" dediği bir statünün hareket satırları duruyor.

## 3. Kararlar

### D1 — "Depoda" kümesinin TEK KAYNAĞI
Yeni `helpers/warehouse-stock.helper.ts`:
```
WAREHOUSE_STOCK_STATUSES = [STOCK, WAREHOUSE, A1_STOCK, RETURNED_FROM_SUBCONTRACTOR]
WAREHOUSE_STOCK_WHERE    = { status: { in: … }, warehouseId: { not: null } }   // Prisma parçası
isWarehouseStock(roll)                                                         // bellek-içi ikiz
```
- `RETURNED_FROM_SUBCONTRACTOR` **içeridedir** (mal fiziksel olarak geri gelmiştir; transfer zaten böyle sayıyor).
  Fabrikada bu statüde 0 top var → bugünkü hiçbir rakam değişmez. Sayım bu farkı ya kapatır ya **gerekçeli**
  bildirir; bekçi farkı iki yönlü ölçer.
- `IN_PRODUCTION` ve `AT_SUBCONTRACTOR` **stok değildir** (SAP 261/ERPNext WIP deposu semantiği): üretime alma
  ÇIKIŞ, üretimden dönüş GİRİŞ satırı yazar.
- **`shipmentId`/`sackId` ile SÜZÜLMEZ:** SHIPMENT satırı sevk anında yazılıyor; PLANNED sevkiyata bağlı ya da
  çuvaldaki top hâlâ depodadır.

### D2 — Olay taksonomisi
*(Üç bağımsız öneri + üç yargıç; kazanan "tipli olay + durum çifti", enum bütçesi ve `reasonCode` kaybedenden alındı.)*

**① Satıra İKİ DURUM KOLONU: `fromStatus` / `toStatus` (`RollStatus?`).** Bu tasarımın kilit taşı.
Satır "o gün domaindeydi" demek yerine **"WAREHOUSE'tan SHIPPED'e gitti"** der. Kazancı:
- Stok kümesi tanımı **satıra gömülmez**; kapsam kararı değişirse geçmiş okuma yeniden hesaplanır.
- §4'ün **depo × statü** kırılımlı mutabakatı ve *"1 Mart'ta 2. kalite depoda ne vardı"* sorusu mümkün olur —
  append-only defter geriye dönük zenginleştirilemeyeceği için bu kolonlar **şimdi** eklenmeli.
- Maliyeti sıfıra yakın: `RollStatus` zaten var, yeni enum tipi ve yeni istemci aynası doğurmaz.

**② Beş yeni `WarehouseEventType` değeri (8 → 13). Yön ASLA enum'a girmez.**
Yön `from`/`to`'dadır ve sunucu türetir (aynı satır iki depoda zıt yön basar) — `PRODUCTION_ISSUE`/`PRODUCTION_RECEIPT`
gibi ikizler tek değere katlanır.

| Değer | Karşı taraf | Örnek |
|---|---|---|
| `PRODUCTION` | fabrika içi üretim (WIP) | üretime alma · son adım finalize · tambur çocuğu doğumu · dispozisyon |
| `EXTERNAL` | üçüncü şahıs (fason/kartela) | doğrudan fason sevki · fason dönüşü · kartela sevki |
| `TRANSFORM` | aynı depoda 1:N bölünme | depo topu kesimi (ebeveyn çıkış + çocuk giriş, grup net **sıfır**) |
| `ADJUST` | sahiplik değişmeden miktar | fire · sayım farkı · çekme · aşım |
| `OPENING_BALANCE` | geçiş kararı | kesme anı fotoğrafı (D6) |

**③ Ayrıntı enum'a değil KOLONA** (`RollVariance.source/reasonCode` emsali) — yeni ayrıntı = katalog satırı,
migration değil:
`reasonCode VARCHAR(64)` + TS kataloğu (PRODUCTION_ISSUE · PRODUCTION_RECEIPT · TAMBUR_FINALIZE · DISPOSITION ·
CUT_SPLIT · FASON_DISPATCH · FASON_RECEIPT · KARTELA_DISPATCH · SCRAP · STOCK_COUNT · SHRINK · OVERAGE ·
MANUAL_ADJUST · OPENING · LEGACY) · `transformGroupId UUID?` (bir kesimin N+1 satırı; "grup net sıfır" ölçülebilir
olur) · `rollVarianceId UUID?` (ADJUST'ın sebep ikizi, D3) · `workOrderStepId UUID?` (PRODUCTION'ın belgesi) ·
`reversesMovementId UUID?` (D2a).

**④ Odoo'nun sanal lokasyon modeli REDDEDİLDİ — gerekçe ölçüldü ki altı ay sonra yeniden önerilmesin.**
Sanal uçları `warehouses` tablosuna satır olarak koymak yedi yerde kırılır: `ensureDefaultWarehouse` en eski depoyu
varsayılana terfi ettirir ("Üretim" varsayılan olabilir) · panel `?? warehouses[0]` alfabetik seçer ("Fason" <
"Merkez Depo") · sayım "Fason" deposunda açılıp fasondaki topları iptal ettirebilir · transfer hedefi yalnız
var/aktif bakar · `GoodsReceipt.warehouseId` NOT NULL + `YarnStock` `@@unique` + `Sack.warehouseId` · `nameFold`
unique gerçek depoya "Üretim" adını yasaklar · 11 panel çağrı sitesi yalnız `isActive` süzer (blocklist mantığı).
Karşı taraf bu yüzden **`eventType` + `reasonCode`** ile taşınır, sahte depo satırıyla değil.

**⑤ Eski satırlar:** korunur, yeniden yorumlanmaz (D6). ⚠️ 2026-09-12 ölçümü bu maddenin adını düzeltti:
statüsüz satır kümesi **tarihsel değil, canlı büyüyor** — fabrika kopyasındaki 721 satırın 721'i statüsüz ve
eski kapılar (transfer · sevk · sayım) bugün de statüsüz yazıyor. Bu yüzden kod tarafındaki sayaç
`preEpochSkipped` değil **`statusuzAtlanan`**: "eski veri" değil, "o yolu henüz stok defterine taşımadık".

### D3 — Metraj değişimi deftere GİRER
- **Dönüşüm (kesim/finalize) net sıfırdır:** ebeveyn çıkışı + çocuk girişi aynı olay kimliğiyle yazılır.
- **Düzeltme/fire/aşım net toplamı DEĞİŞTİRİR** ve ayrı sınıftır (SAP 551/701-702; tekstil pratiğinde çekme ve
  kalan ölçümü de buraya girer).
- **`RollVariance` ↔ defter sınırı:** `RollVariance` **SEBEBİ** (fire · düzeltme · aşım), depo defteri **ETKİYİ**
  (depodan ±) taşır; satır `rollVarianceId` ile sebebe bağlanır. Yalnız top **stoktayken** olan sapma hareket
  doğurur (üretim içi sapma stoğa dokunmaz). Aynı metrajın iki deftere iki kez girmesi böyle engellenir.

### D4 — as-of modeli: kümülatif Σ, ileri-yalnız kronoloji
- Kesit = `Σ(to=W) − Σ(from=W)` **`createdAt <= T`** üzerinden. Yürüyen bakiye **satırda saklanmaz** (ERPNext'in
  aynı saniyede zincir kopması hatası ölçülmüş bir emsal).
- **Geriye dönük yazım YOK:** düzeltme bugüne yazılan ters/ADJUST satırıdır (ERPNext'in repost motorunu satın
  almayız). Kronoloji `createdAt`; `eventDate` benzeri kullanıcı girdisi defterin sırasını belirlemez.
- Sorgu tek snapshot'lı transaction'da (REPEATABLE READ) koşar — SAP MB5B'nin bilinen tutarsızlığı böyle kapanır.
- Periyodik snapshot tablosu **sonraki adıma** bırakılır; şema onu dışlamaz (anahtar: depo × statü × tarih).
- Rapor kuralı: **bakiye zaman ekseninde toplanamaz** (yarı-additif) — arayüz bunu varsaymaz.

### D5 — Kuralın ZORLANMASI: üç katman, sed DB'de

`rolls` üzerinde ~129 mutasyon sitesi var ve defter yazan 10. Helper kendisinin **çağrılmadığını** bilemez;
`rolls_stamp_production_timestamps` migration'ı aynı gerekçeyle ("40+ çağrı noktası; birini atlamak SESSİZ eksik
demek") trigger'ı seçmiş. Burada bedeli daha ağır: eksik satır raporu değil **stok rakamını** bozar.

1. **Tek geçit (TS):** `postStockMove()` — `writeWarehouseMovement*`in yerine geçer, iki ucu tipli alır ve
   **sessizce atlamak yerine FIRLATIR**. Belge bağı, aktör ve sebep yalnız burada bilinir.
2. **Sed (DB): ertelenmiş constraint trigger.** `AFTER INSERT OR UPDATE ON rolls`, `DEFERRABLE INITIALLY DEFERRED`.
   COMMIT anında **top başına** tek aritmetik:
   `net(R) = Σ(qty | toStatus ∈ ON_HAND) − Σ(qty | fromStatus ∈ ON_HAND)` (epoch sonrası satırlar)
   `net(R) == (R.status ∈ ON_HAND ? R.currentQty : 0)`
   - **`txid` eşleştirmesine gerek YOK** — "satır yazıldı mı" değil "DOĞRU satır DOĞRU metrajla yazıldı mı"
     ispatlanır; subtransaction/retry altında yanılmaz ve defterde ek kolon istemez.
   - **ON_HAND kümesi trigger gövdesine GÖMÜLMEZ:** DB tarafında tek kaynak `stock_on_hand_statuses()` IMMUTABLE
     fonksiyonu; bekçi TS sabiti ile bu fonksiyonu **iki yönlü** karşılaştırır (diller arası boğaz-ikiz).
   - **Kill switch:** `teks.stock_ledger_guard` GUC (`system_logs_block_tamper` emsali) — varsayılan kapalı,
     canlıda `ALTER DATABASE` ile açılır; test temizliği ve backfill bu kapıdan geçer.
3. **Ölçü:** Σ mutabakat bekçisi (§4) + dar AST tripwire (`writeWarehouseMovement*`i doğrudan çağıran yeni kod yok).

⚠️ **Bu bir takastır:** bugün eksik satır kimseyi durdurmuyor (yalnız rakam yanlış); sed açıldıktan sonra unutulmuş
bir yol **vardiyayı durdurur**. Bu yüzden sed fabrikada ancak §3.1'deki GO/NO-GO listesi yeşilken açılır.

#### §3.1 GO/NO-GO — sed açılmadan ÖNCE kapatılacaklar (ikisi de KODDA DOĞRULANDI)

1. ⭐ **Fason kabulünde fazla sayım (canlı hata).** `subcontractor.service.ts:3168` `bornStatus = nextStep ?
   IN_PRODUCTION : WAREHOUSE` diyor, ama ~3230'daki defter yazımı **koşulsuz** `ENTRY` + `toWarehouseId` yazıyor;
   koddaki yorum da yanlış gerekçeyi savunuyor ("fason dönüşü GERÇEK bir giriştir"). **Ölçüm: bu fabrikadaki
   fason-dönüşü ENTRY'lerinin 57/57'si yanlış** — 34 top IN_PRODUCTION (18.451 m) + 23 top TAMBUR_CONSUMED
   (13.593 m), **hiçbiri depoda değil**; toplam **32.044 m** fazla sayım. Sed bu yol düzeltilmeden açılırsa
   ara adımlı her fason kabulü 500 verir.
2. **İptalde koşulsuz çıkış (latent).** `inventory.service.ts:3622` `fromWarehouseId: r.warehouseId` yazıyor ve
   `warehouseId` bilerek korunuyor; üretimdeyken iptal edilen top depodan **ikinci kez** düşer. Fabrikada henüz
   ateşlenmemiş (14 CANCEL satırının 14'ünde top gerçekten stoktaydı: 9 STOCK + 5 WAREHOUSE) — ama yeni modelde
   üretim çıkışı da yazılacağı için çift düşüm doğar. Çıkış satırı **statüye** bağlanacak.
3. `warehouseId` backfill + açılış fotoğrafı (D6).
4. Yedekli panel sahada (D8).

**Onarım ayrı bir iştir — kod düzeltmesi İLERİYE dönüktür.** Geçmişteki 57 yanlış satır **düzeltilmez**
(defter satırı UPDATE edilmez); ters kayıtla kapanır ve bu bir **veri operasyonudur**:
`scripts/onarim_fason_donus_entry.ts` — dry-run varsayılan, etkilenen HER satırı listeler, `--apply` ile
`reversesMovementId` bağlı ters satır yazar. Script A commit'inden sonra doğar (ters kayıt kolonu oradan gelir);
`--apply` **kullanıcı kararı** (ertelendi). Sürüm notunda "paket sonrası operasyon" maddesi olarak durur.

**Sed ile onarımın sırası (karar):** ertelenmiş trigger **onarımdan SONRA** açılır. O güne kadar mutabakat
bekçisi bu 57 satırı **adıyla sayar** — "bilinen hatalı fason girişi, onarım bekliyor: N satır / M m" —
sessiz muafiyet YOKTUR; sayı her koşumda görünür ve onarım bitince sıfıra düşer.

### D6 — Açılış bakiyesi ve defterin doğruluk başlangıcı
- `OPENING_BALANCE` olayı + **kesme anı fotoğrafı** (tamamlayıcı açılış değil): kesme anında stok kümesindeki
  her topa bir satır (`to = warehouseId`, `qty = currentQty`). Ölçülen büyüklük **~1.474 satır / 137.124 m**.
- **Neden fotoğraf:** bugün depodaki topların %15,3'ünün izi tutarlı; eksikleri tek tek tamamlamak 319 topa
  **geriye dönük giriş** yazmak demek ve "ters kayıt bugüne yazılır" ilkesiyle çelişir. Fotoğraf geçmişi
  uydurmaz, *beyan edilmiş bir sayım* der (SAP 561: "fiziksel hareket gerçekleşmez").
- **Açılış DELTA yazılır**, mutlak bakiye değil — ERPNext'in mutlak reco satırı Σ additifliğini kırıyor.
- **Kesme tarihi ayrıca bir KAPIDIR** (ERPNext "Stock Frozen Upto" emsali): `warehouseLedgerStartDate` ayarı;
  o tarihten öncesi için as-of **fail-closed** ("defter öncesi — bu tarih için kesit yok"), sessiz yanlış rakam yok.
- **Ön koşul:** `warehouseId` NULL 4.553 topun stok kümesindekilerine depo ataması (backfill). Script dry-run
  varsayılan kalır; fabrika verisine `--apply` **kullanıcı kararı** (ertelendi). Dağıtım yolu önerisi: tek seferlik
  operasyon adımı — paket içine alınmaz (`dist/tools`a yalnız süperadmin aracı derleniyor).
- Mevcut 709 satır **yeniden yorumlanmaz**: defterin doğruluk başlangıcı açılış anıdır, öncesi tarihsel izdir.
- **`statusuzAtlanan` bugün BİLGİ, backfill'den sonra HATA SİNYALİ.** `reverseRollStockMoves` iki ucu da
  statüsüz olan satırı tersleyemez (ucu kurulamayan satırın tersi kurulamaz) ve bu satırları **sayar**. Sayı
  bugün sıfırdan büyük olabilir ve bu normaldir: eski kapılar hâlâ statüsüz satır yazıyor. **Eski yazıcılar stok
  defterine taşındıktan ve açılış fotoğrafı indikten sonra bu dal tanım gereği boşalır** — o commit'te sayının
  sıfırdan büyük çıkması bir hatadır ve bekçiye çevrilir (bugün "bilgi", yarın "kırmızı"). Sayı ölçülmeden
  bırakılmaz: `test_stock_ledger_helper` §11 hem davranışı ölçer hem o DB'deki canlı statüsüz satır sayısını basar.
- **`preEpoch` ZAMANSAL, `statusuzAtlanan` SEMANTİK — aynı şey değil.** `preEpoch` "satır fotoğraf anından
  ÖNCE mi yazıldı" sorusunu cevaplar; tek yazarı açılış fotoğrafı script'idir, çalışma zamanı ona dokunmaz ve
  hiçbir iş kararına girdi değildir. `statusuzAtlanan` ise "satırın iki ucu da statüsüz mü, yani ucu kurulabilir
  mi" sorusunu `fromStatus IS NULL AND toStatus IS NULL` yükleminden türetir. Bugün iki küme neredeyse birebir
  örtüşüyor (721/721), **yarın ayrışacaklar**: fotoğraftan SONRA eski kapıdan yazılan satır `preEpoch=false`
  ama statüsüzdür.
- **⚠️ FOTOĞRAF ŞERHİ (bu cümle olmadan fotoğraf inmez):** epoch sonrası yalnız **TOPLAM Σ** güvenilirdir.
  **Depo × statü kırılımı ve as-of kesiti**, eski yazıcılar stok defterine taşınıp `statusuzAtlanan` sıfıra
  düşene kadar **BEYANLIDIR** — o satırlar hangi statüden hangi statüye gittiğini söylemiyor. "Epoch sonrası
  her şey doğru" sanısı, düzeltmesi en pahalı yanlış olur.

### D7 — Defterin DB seddi (bugün hiç yok)

| Sed | Bugün | Olacak |
|---|---|---|
| `qty` | CHECK yok; helper negatifi **sessizce atlıyor** | `CHECK (qty > 0)`, helper **hata verir** |
| Yön | from+to boş satır yazılabilir | `CHECK (from IS NOT NULL OR to IS NOT NULL)` |
| `rollId` FK | **CASCADE** — defter satırı topla birlikte silinir | **RESTRICT** |
| Depo FK'ları | SET NULL | **RESTRICT** |
| Append-only | UPDATE/DELETE serbest | statement-level block trigger + GUC kaçışı (`system_logs_block_tamper` emsali) |

Ölçüm temiz: 721 satırda `qty ≤ 0` → 0, boş yön → 0, `from = to` → 0, yetim FK → 0. Kısıtlar yine de
`NOT VALID` + ayrı `VALIDATE CONSTRAINT` ile eklenir (uzun ACCESS EXCLUSIVE kilidi doğmasın).
Üç nesne de `test_db_invariants` envanterine aynı commit'te yazılır.

⚠️ Sessiz atlamanın **hata**ya çevrilmesi davranış değişikliğidir: bugün deposuz topta sevk/iptal sessizce
satırsız geçiyor. Sıra bu yüzden: **backfill → sed → fail-loud**.

### D8 — Dağıtım sırası
1. **Panel ÖNCE.** Sahadaki panel bilinmeyen `eventType`'ta ErrorBoundary'ye düşüyordu; yedek `88ebf3bb`'de.
   Backend yeni olay tipi **yazmaya başlamadan** önce yedekli panel sahaya çıkar.
2. Backend defter yazımı → backfill `--apply` (ayrı operasyon, kullanıcı onayı) → açılış fotoğrafı → sed → fail-loud.
3. **`minVersion` yükseltilmez:** eski panel yedekle ham adı basıyor, veri kaybı yok (enum reçetesi adım 13 cevabı).

### D9 — Uygulama üç commit'e bölünür

| # | Commit | Kapsam | Şema kilidi |
|---|---|---|---|
| A1 | Defter ALTYAPISI | kolonlar · enum · CHECK · `postStockMove`/`reverseStockMove` kapısı · envanter | evet (kısa blok) |
| A2 | Yazım yollarının BAĞLANMASI | ~45 yol + mutabakat bekçisi + açılış/as-of | hayır |
| B | Ortak temizlik yardımcısı | `scripts/fixture-roll-cleanup.ts` + script/bekçilerin geçişi | hayır |
| C | FK sertleştirme | CASCADE→RESTRICT · [TD-18] güncellemesi · B'de kaçanlar | evet (dar) |

**A commit'inin YÜRÜTME BLOĞU** (şema kilidi bu blok boyunca alınır, sonra bırakılır — ortak ağaçta
derlenmeyen ara durum bırakılmaz, şema yazımı + `generate` + ona bağlı kod TEK turda biter):
1. `schema.prisma` — kolonlar + enum değerleri + index'ler (yalnız `WarehouseMovement` bloğu).
2. Migration'lar, ayrı dosyalar: enum değerleri **tek ifadeli** (`ADD VALUE IF NOT EXISTS`, PG 55P04) ·
   kolonlar + index'ler · CHECK'ler `NOT VALID` · ayrı `VALIDATE CONSTRAINT`. Damga bandı **`20260912150000`**
   (bant dağıtımı tek elden yöneticide; 130000/130100 ea'da, 140000 özellik pivotunda, 120100+ 01'de — dev DB'ye daha küçük damgalı migration sonradan uygulanırsa
   `migrate deploy` sırası ile defter sırası ayrışır, hijyen bekçisi bunu görür).
3. `apply-migration.ts --apply` → `tekserp_fabrika_dev` (şema; **veri backfill'i DEĞİL**, o ertelendi).
4. `prisma generate`.
5. Helper + servis yazımları (tek kaynak `warehouse-stock.helper.ts`, defter yazım yolları, ters kayıt helper'ı).
6. `typecheck` + `test_schema_drift` + `test_db_invariants` + yeni bekçiler.
7. Pathspec ile commit → "kilit boş" duyurusu → SHA ea'ya (o kendi yazımını bağlayacak).

**Neden ayrı:** FK sertleştirme 113 dosyaya dokunuyor (97'si `npm test`'te) — defter işiyle aynı commit'te
incelenemez ve geri alınamaz. B, FK hâlâ CASCADE'ken yapıldığı için hiçbir şeyi kırmaz; **yeşil kalarak** geçilir.
C'den önce kadroya duyuru yapılır (beş oturum aynı ağaçta).

### D2a — Ters kayıt biçimi (karar verildi)
- Yeni `*_REVERSAL` enum değeri **AÇILMAZ**; ters kayıt `reversesMovementId` (nullable self-FK,
  `CariTransaction.reversesTxnId` emsali) ile ifade edilir. Mevcut dört değer geçerli kalır.
- **Tespit tek yerden:** "bu satır ters kayıt mıdır" sorusunun cevabı `reversesMovementId IS NOT NULL`;
  enum değeri yalnız betimleyicidir. Bekçi bunu ölçer (cümleyle bırakılmaz).
- **`qty` ileri satırdan kopyalanır** — bugün üç farklı kaynak var (ileri satır · canlı `currentQty` · sapma satırı)
  ve ileri kayıttan sonra metraj değişirse Σ sessizce kayar.
- Ters kayıt **bugüne** yazılır, yönü ileri satırın aynasıdır (from↔to takas).
- **Aynı satır iki kez terslenemez:** `reversesMovementId` üzerinde partial unique (SAP M7067 ile aynı kural).
- ea'nın `CANCEL_REVERSAL` sözleşmesi (`88ebf3bb`) **olduğu gibi** geçerlidir; `restoreCancelledRoll` ve
  `cancelReturn` bu desene bağlanacak.

### D2b — Çift ters satır sözleşmesi (teks-erp-ea ile ortak)

`restoreCancelledRoll` (elle "iptali geri al") defter satırı yazmaya başlıyor; ea'nın sayım stornosunda da aynı
topu kapsayan bir `LEDGER_ONLY` dalı var. İkisi aynı topa iki ters satır yazabilir. Sözleşme:

- **Tek okunacak alan `reversesMovementId`.** "Bu geri alma zaten deftere yazıldı mı" sorusunun cevabı, ilgili
  ileri (CANCEL) satırının id'siyle eşleşen bir satırın VARLIĞIDIR. Rol başına sayma / tip sayma / belge bağıyla
  eşleme yaklaşıktır, kullanılmaz.
- **Sed DB'dedir:** `reversesMovementId` partial unique → aynı ileri satır iki kez terslenemez, ikinci yazan P2002
  alır (SAP M7067 kuralının karşılığı). Yarışta kaybeden sessizce çift satır yazamaz.
- **İş bölümü:** defter satırı bu tasarımın (`restoreCancelledRoll` aktif, terslenmemiş CANCEL'ı bulup bağlar);
  sapma kaydının damgası sayım tarafının. ea'nın dalı "defter satırı varsa ters satır YAZMA, damgayı yine yap"
  şeklinde ikiye ayrılır.
- **Geçiş:** A commit'inden önce ara kural (rollId + stockCountId + CANCEL_REVERSAL varlığı), sonrasında yalnız
  `reversesMovementId`.
- **Sahiplik:** A commit'i alanı + partial unique'i + tek-kaynak helper'ını getirir; sayım stornosunun kendi
  yazımını o servisin sahibi (`teks-erp-ea`) A'nın SHA'sını gördükten sonra bağlar. Başkasının servisine
  dokunulmaz.
- **Grandfathering:** A ile o bağlama arasında yazılan ters satırlarda alan NULL kalır. Σ **etkilenmez** (katkı
  yönden gelir, bağdan değil); "ters kayıt mıdır" kuralı YENİ kod yollarını bağlar ve bekçi bunu tarih eşiğiyle
  değil *"yeni yazan yol bağı doldurmak zorunda"* biçiminde ölçer (AST yeni çağrıları, davranış yeni satırları).

### D2c — `TRANSFER`in anlamı GENİŞLETİLMEZ (ölçüldü)

Statü/stok sınıfı değişimi mevcut `TRANSFER` tipine yazılmaz. Ölçüm:
- Backend'de `TRANSFER` okuyan dört yerin hepsi `transferId` ile süzüyor → terfi satırı (belgesiz) onlara sızmazdı;
  yani risk okuma yüzeylerinde değil.
- **Asıl engel yön kuralı:** `warehouseMovementDirection` yönü yalnız `from`/`to`'dan türetiyor ve `from === to`
  ise `null` dönüyor. Gerekçe kodda yazılı: *"şema TRANSFER'de ikisinin FARKLI olmasını şart koşar, yani bu satır
  bugün doğamaz; veri tuhaflığı ekranda görünmeli, gizlenmemeli."* Terfiyi aynı depoda `from = to` ile yazmak,
  bugün "tuhaflık" diye işaretlenmiş satırı normalleştirir ve paneli yönsüz satırla doldurur.
- Panel tarafı mekanik: `WAREHOUSE_EVENT_META` tam `Record`, `WAREHOUSE_EVENT_TYPES` sabit liste, tip sayısını
  sabitleyen test.
**Kural:** anlam genişlemesi SATIRDA görünür olacak — ya ayrı olay tipi ya da ayırt edici kolon (eski satırlar
NULL = klasik transfer). Eski satırların anlamı değişmez ve bu belgede ölçümüyle birlikte durur.

## 4. Bekçiler (A commit'inde)
- **Σ mutabakatı:** `consistency-check.sql`e yeni bölüm + `test_consistency` — `Σhareket + açılış ↔ canlı stok`,
  depo × statü kırılımında; `TEST-` fixture'ları dışlanır, REPEATABLE READ fotoğrafında koşar.
  (Emsal: D365 "on-hand consistency check" — defter kaynaktır, canlı stok türevdir.)
- **Ters kayıt tek kaynağı:** davranış (bağ dolu · qty ileri satırdan · çift storno reddediliyor) + AST
  (enum değerine bakarak ters kayıt tespiti yapan yeni kod yok).
- **Kesim/dönüşüm net sıfır:** `test_warehouse_ledger` B2 **silinmez, semantiği değişir** — "çocukta 0 satır"
  yerine "dönüşümün net etkisi 0".
- **Fikstürlü terfi bekçisi:** fabrika verisi bu yolları hiç sınamıyor (§1.5).
- **`test_single_warehouse_parity` §6b** (`wmCount === 1`) yeni olay sayısına göre güncellenir.

## 5. Geçersiz kılınacak kaynaklar (uygulama bitince)
Karar uygulanınca aşağıdaki beş yerdeki "konum defteri / terfi hareket değildir / kesim çocuğu yazmaz" cümleleri
**silinir** ve arşive `GEÇERSİZ → tarih` işareti konur:
`TICARET-PAKETI-TASARIM.md` §3 · `SOZLUK.md` · `schema.prisma` model yorumu · `warehouse-ledger.helper.ts` başlığı ·
`test_warehouse_ledger.ts` B2 gerekçesi. Ayrıca `defter.md` envanterindeki bayat çıpa (87 top / −5.369,3 m /
"69 topun 0'ında CANCEL") bu belgenin ölçümüyle düzeltilir; eski ölçüm **test artığı içeriyordu**.

## 6. Açık işler (bu tasarımın dışında)
- `RollMovement` Faz 2 (defter/durum ayrımı) bu olay modeliyle **ortak** düşünülmeli — `DEFTER-B-BOLUMU-PLAN.md`
  aynı şeyi istiyor.
- Stok dönem kilidi (`InventoryPeriodClose`) — as-of ile birlikte anlamlı; yeni advisory uzay (8032) gerektirir.
- Fason **emanet stok** (mal fabrika dışında ama bizim) ve konsinye sahipliği — `SEKTOR-YOL-HARITASI` maddeleri.
