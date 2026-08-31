# Ön Muhasebe Sağlamlık Tasarımı — 5 bulgu, 5 sınıf, sektör standardı kapanış

> **Durum:** TASARIM — kullanıcı onayı bekliyor (2026-08-14).
> **Kaynak:** Paket C+D çapraz denetimi (4 mercek + 20 çürütücü ajan) → AYAKTA kalan
> 5 bulgu → bu belge için 5 derin-analiz ajanı (kök neden + sınıf taraması +
> çözüm seçenekleri; her iddia dosya:satır ile ölçüldü, canlı DB sorgulandı).
> **Hedef:** Yazılım birçok tekstil firmasına satılacak — çözümler tek örneği
> yamalamaz, **sınıfı yapıda kapatır** ve her sınıf mekanik bekçiye bağlanır.
> **Zamanlama avantajı (ölçüldü):** finans modülü henüz HİÇBİR kuruluma çıkmadı
> (`adnansahin_ticaret`: 0 çek, 0 kapama, 0 dönem kapanışı). Davranış
> değişiklikleri "mevcut kurulumu sessizce değiştirme" kuralına takılmadan
> yapılabilecek **tek penceredeyiz** — ilk satıştan sonra bu pencere kapanır.

---

## Yöntem: neden "sınıf", neden "bulgu" değil

Beş bulgu beş ayrı hata gibi görünüyor; analiz beşinin de **tekrarlanabilir bir
sınıfın** ilk yakalanan örneği olduğunu gösterdi. Sınıf taraması, aynı desenin
kod tabanındaki DİĞER örneklerini aradı ve 6 yeni gerçek risk buldu — yani
"bulguyu düzelt" yaklaşımı 6 bombayı yerinde bırakırdı. Çok kurulumlu satışta
bunun maliyeti çarpandır: N kurulum × M sessiz hata.

Her sınıf için üç katman:
1. **Yapısal kapanış** — hatayı yazmayı imkânsızlaştıran mimari (tek kapı,
   deterministik sıra, çift yönlü yüklem, tek kaynak assembler).
2. **DB seddi** — uygulama katmanı bir gün atlanırsa satırın kendisinin direnmesi
   (CHECK, partial unique, FK). Emsal: `invoices_paid_total_range`.
3. **Mekanik bekçi + negatif sonda** — sınıfa yeni üye eklendiği gün kırmızı.
   Emsal: `test_permission_catalog` AST taraması.

---

## SINIF 1 — Belge tarihi ≠ İşlem tarihi (bulgu #9)

### Kök neden (mekanizma)

`cheque.service.ts:392` tek alanı (`issueDate`) **dört rolde** tüketiyor: kur
çözümü (:405), belge no üretimi (:414), cari defter `txnDate` (:443-447) ve olay
defteri (:459-464). Dönem kilidi de aynı değerden sorulur. Panel bu alanı
**"Keşide tarihi"** diye etiketler (`ChequeFormDialog.tsx:245`).

Neden böyle yazılmış: çek doğuşu Invoice/Payment kalıbından kopyalanmış. O
kalıpta tek tarih **meşrudur** — fatura/ödeme tarihi ticari olayın kendi
tarihidir. Çekte bu varsayım tanım gereği kırılır: **keşide tarihi kâğıdın
tarihidir, çekin alındığı gün değildir** (ileri keşide standart pratik; kod
:396-398'de "vadesi geçmiş çek girilebilir" diyerek bunu kendisi teyit ediyor).
Dosyanın kilitli kararı (:11-15, *"çek ALINDIĞI AN cari alacaklanır"*) doğru;
uygulaması "alındığı an = formdaki tarih" varsayımıyla yazılınca sözleşme kopmuş.

İki somut arıza: Kasım keşideli çek Aralık'ta gelirse — Kasım **açıksa** alacak
sessizce Kasım'a düşer (gönderilmiş ekstre değişir, belge no `CKA151125…` doğar,
kur Kasım kurundan damgalanır); Kasım **kapalıysa** 409, operatör mesru bir
tahsilatı girmek için keşide tarihini **yalan yazmaya zorlanır** — veri tahrifine
iten kilit. Ayrıca ileri keşideli çekin defter satırı GELECEĞE yazılır →
yaşlandırmanın `storedDiff` mutabakatı sahte drift basar, kapanış `txnCount`'u
tutmaz.

### Sektör standardı

SAP FI her mali belgede iki tarihi ayrı modeller: **Belegdatum** (belge
üzerindeki tarih) ve **Buchungsdatum** (deftere işleme tarihi) — dönem kontrolü
ve belge numarası YALNIZ ikincisinden. Logo/Mikro'da karşılığı belge tarihi /
fiş tarihi. Türk pratiğinde **çek giriş bordrosu** alındığı günle tarihlenir;
keşide ve vade, kıymetli evrakın kendi öznitelikleridir.

### Karar: Seçenek A — yalnız `Cheque`'e `postingDate` (dar kapsam)

- Şema: `Cheque.postingDate DateTime @db.Timestamptz` (additive; backfill
  `postingDate = issueDate` + `SET NOT NULL` — canlıda 0 çek, fiilen no-op ama
  migration çok-firmalı satış için yine de bunu yazar: veri taşıyan bir kurulumda
  doğru varsayılan `issueDate`'tir, çünkü o kurulumun defteri ZATEN oradan
  yazılmış — ekstre/kapanış bayt-bayt değişmez).
- `create`'te dört tüketici `postingDate`'e döner: kur, docNo, defter `txnDate`,
  RECEIVE/ISSUE `eventDate`. Dönem kilidi otomatik izler (`writeChequeLedgerTx`
  tek kapı — değişiklik ~15 satır).
- `issueDate` kâğıdın bilgisi olarak **kalır** (TTK 796 ibraz süresi keşideden
  hesaplanır — alan hukuki veri, atılamaz). `schema.prisma` ~5182'deki "keşide/
  işlem tarihi" yorumundaki eşitleme ikiye ayrılır.
- Panel: `ChequeFormDialog`'a "İşlem tarihi" alanı — dil ve desen
  `ChequeActionDialog:66,271-283`'ten kopyalanır (geçiş diyalogları bu ayrımı
  ZATEN doğru yapıyor; asimetri yalnız doğuş yolundaydı).

**Reddedilen B (modül geneli çift tarih):** Sınıf taraması ölçtü — `Payment.paymentDate`
ve `Invoice.issueDate` **meşru** (ödeme tarihi paranın el değiştirdiği gündür;
fatura tarihi tahakkuk tarihidir ve TR pratiği/karşı taraf mutabakatı aynı tarihe
bakar; dönem kilidi ikisini de zaten kapılıyor). Hedef müşteri kitlesi (Logo/Mikro
alışkanlığı) fatura/ödemeyi tek tarihle işler; her tabloya kolon + her forma alan +
rapor süzgeç semantiği geniş bir regresyon yüzeyi açar ve kazandırdığı tek şey
kavramsal paritedir. **Yanlış olan tek yazar çek doğuşuydu.**

**Reddedilen C (kolon eklemeden defter=now):** dün alınan çeki bugün giren büro
(olağan pratik) işlem tarihini SEÇEMEZ → her kayıt bir gün kayar; modülün yerleşik
"işlem tarihi kullanıcınındır, kilit kapılar" sözleşmesine aykırı.

### Sınıf üyesi — kasa defteri (🔴 yeni bulgu, ayrı karar)

`CashTransaction.txnDate` kullanıcı girdisi, docNo+kur ondan — ama cari deftere
yazmadığı için **hiçbir dönem kilidi yok**: geçmişe tarihli kasa hareketi,
yazdırılıp Excel'e alınmış kasa defteri sayfasını sessizce değiştirir. Cari dönem
kapanışı kasayı kapsamıyor ve bu **hiçbir yerde yazılı değil** (denetimin KISMEN
#10 bulgusuyla aynı kök). → **Karar noktası K-1** (aşağıda).

---

## SINIF 2 — Ters yolu olmayan defter yazarı (bulgu #3)

### Kök neden

`CariTxnSource` enum'unun kendisi sınıfı gösteriyor: `INVOICE_CANCEL`,
`PAYMENT_CANCEL`, `CHEQUE_CANCEL` var — **`ADJUSTMENT_CANCEL` yok**. Devir, ters
yolu olmayan tek ileri kayıt tipi. `setOpeningBalance` mükerrer devri 409 ile
reddediyor ve mesajı *"ters bir düzeltme kaydı girin"* diyor (:314-316) — ama o
yolu yazan uç **ürün genelinde yok**. Kasa tarafı aynı sınıfın **doğru çözülmüş
örneği**: `cash-transaction.cancel` var, 409 mesajı gerçek yolu gösteriyor,
partial unique CANCELLED'ı dışlayarak yeniden girişi mekanik açıyor.

Sonuç: yanlış devir (4.250 yerine 42.500) bakiyede, yaşlandırmanın DEVİR
satırında ve **her dönem kapanışı fotoğrafında** kalıcı; operatörün tüm kaçış
yolları (tahsilat, fatura) daha yanlış kayıt üretir.

### Sektör standardı

Defter DÜZENLENMEZ; **tipli ters belge** ile kapatılır — SAP FB08 storno belgesi
orijinaline bağlanır ve ters kayıt açık döneme düşer. Projenin kendi felsefesi
zaten bu (append-only + `*_CANCEL` ailesi + `RETURN_DISPATCH` + sevk storno).

### Karar: Seçenek A — tipli devir stornosu

1. **Migration 1** (kendi dosyasında — PG `ADD VALUE` aynı-tx yasağı, `20260814100000`
   emsali): `CariTxnSource`'a SONA `ADJUSTMENT_CANCEL`.
2. **Migration 2** (additive, metadata-only): `CariTransaction.reversesTxnId`
   nullable self-FK + **partial unique** `WHERE reversesTxnId IS NOT NULL`
   (çift storno = P2002 → 409; şemada `@@unique`, migration'da partial'a çevirme —
   drift-free yöntem; `test_db_invariants` envanterine yazılır).
3. `cari.service.cancelOpeningBalance(cariId, currency, reason ZORUNLU)`:
   tx'in İLK ifadesi `lockCariPeriodScopeTx` → aktif devri bul (ters kaydı
   olmayan) → `assertPeriodOpenTx` (ters kayıt **bugüne** yazılır — kapanmış
   dönem fotoğrafı DEĞİŞMEZ, storno yolları sözleşmesiyle aynı) → ters
   debit/credit satırı (`ADJUSTMENT_CANCEL`, `reversesTxnId` bağıyla) + bakiye
   düzeltmesi. Sonra **yeni devir serbest** — dup-kontrolü "ters kaydı olmayan
   ADJUSTMENT var mı" sorusuna döner.
4. **TOCTOU da kapanır** (sınıf taramasının 🔴 bulgusu): bugünkü dup-kontrolü
   advisory kilitten ÖNCE koşuyor (KK1 tuzağının birebir tekrarı — kilit korunan
   okumadan sonra alınmış). Kontrol kilit ALTINA taşınır.
5. 409 mesajı artık **gerçek yolu** gösterir: "Düzeltmek için mevcut devri iptal
   edin (Devri İptal Et düğmesi)".
6. Panel: Cari detayında devir satırına "İptal Et" (sebep zorunlu; yıkıcı-işlem
   onayı etkilenen kaydı somut listeler). Aging'in DEVİR toplama FILTER'ı
   `ADJUSTMENT_CANCEL`'ı da netler — **unutulursa sahte "defter uyuşmuyor" bandı
   doğar; negatif sonda bunu kilitler.**
7. İzin: **yeni izin YOK** — devri giren `finance:invoice` iptalini de yapar
   (iptal append-only ve kendisi de ters kayıtla geri alınabilir; `roll:manual-adjust`
   sınıfı "geçmişi serbest yeniden yazma" burada doğmuyor). Her kurulumda elle
   atama adımı doğmaz.

**Reddedilen B (genel cari düzeltme fişi, Logo tarzı):** serbest defter yazımı
"her satırın kaynağı bir belgedir" disiplinini deler; yeni izin ister (her mevcut
kurulumda elle atama); aging'in DEVİR semantiğini bulanıklaştırır. Kur farkı /
yuvarlama düzeltmesi ihtiyacı GERÇEKTEN doğarsa o gün ayrı tasarlanır — bugün o
ihtiyacın kanıtı yok.

**Reddedilen C (`cancelledAt` kolonu):** append-only defteri kırar (şemanın açık
yasağı) ve her aggregate okuyucuya süzgeç sokar; alınmış kapanış fotoğraflarını
geriye dönük yanlışlar.

### Sınıf üyesi — çekin terminal durumları (🔴 yeni bulgu, ayrı karar)

Yanlışlıkla COLLECT işaretlenen çek **sonsuza dek "tahsil edildi"** kalır: kasa
stornosu (EXPENSE fişi) kasayı ve §23 mutabakatını düzeltir ama çekin durumu
değişmez — sonradan GERÇEKTEN karşılıksız çıkarsa portföy yalan söyler.
→ **Karar noktası K-2**.

---

## SINIF 3 — Sırasız çok-kaynak kilidi + geçici PG hatasının 500'e sarılması (bulgu #1)

### Kök neden

`cheque.bounce` ciro edilmiş çekte iki cariye yazar (:781, :796) ve her yazım
`assertPeriodOpenTx` üzerinden bir advisory kilit alır — **sıra veriden gelir,
sıralanmaz**. Helper'ın kendi yorumu (:170-178) bu kullanımı açıkça yasaklıyor
ve doğru aracı gösteriyor: `assertPeriodsOpenTx` (ÇOĞUL, :182 — kimliğe göre
deterministik sıralama). Ayna ciro çiftinde PG deadlock (40P01) **canlı sondayla
üretildi**; kilit `$executeRaw` ile alındığı için hata P2010'a sarılıp HTTP
**500 "Sunucu yapılandırma hatası"** oluyor — geçici bir çakışma için operatör
yöneticiye yönlendiriliyor.

### Sektör standardı

Klasik deadlock önleme: kaynak kilitleri **deterministik toplam sırayla** alınır.
İkinci katman: PG'nin 40P01 (deadlock) / 40001 (serialization) sınıfı **geçici**
hatalardır — kullanıcıya "tekrar deneyin" (409) döner, 500 değil.

### Karar: Seçenek 1 — ön-kilit + güvenlik ağı (iki katman)

1. **Yapısal önleme:** `bounce`'ta `cameFromEndorsed` dalında, claim'den sonra ve
   ilk defter yazımından ÖNCE `assertPeriodsOpenTx(tx, [drawer, endorsee])`
   (~5 satır). İçteki tekil guard'lar AYNEN kalır — kilit yeniden-alımı (reentrancy)
   canlı doğrulandı, "satır yazan nokta guard taşır" kapsama garantisi bozulmaz.
2. **Sınıf üyeleri** (🔴 iki yeni bulgu): `cash-transaction.transfer` (virman)
   iki hesap bakiyesini from→to ROL sırasıyla güncelliyor — ayna çiftte
   **satır-kilidi** ABBA'sı, üstelik çıplak 40P01 generic 500'e düşüyor;
   `cancel` döngüsü de sırasız. İkisi de kanonik anahtara (`tablo|id`) sıralanır
   (~10 satır).
3. **Güvenlik ağı:** `error.middleware`'e sınıf-40 dalı — hem çıplak
   DriverAdapterError hem P2010 mesajından SQLSTATE (40P01/40001) çıkarımı →
   409 *"İşlem çakışması — lütfen tekrar deneyin"*. Bu ağ **gelecekteki tüm
   kilit çiftlerini de** kapsar (öngörülemeyen kombinasyonlar dahil).
4. **Bekçi:** AST taraması — tek tx içinde ≥2 elle `assertPeriodOpenTx` çağrısı
   kırmızı (yalnız çoğul helper meşru); virman sıralama satırının varlığı;
   middleware eşlemesinin iki şekli. ⚠️ Bilinen statik sınır: döngü-içi tek
   çağrı noktasından N kilit almayı AST göremez — bu sınır bekçinin başlığına
   yazılır (kör alan gizlenmez).
5. **Namespace envanteri:** `period-guard.helper` yorumuna kilit uzayı tablosu
   (8021 KK1 · 8022 parti · 8026 dönem · 8027 sipariş…) + kural: bir tx birden
   çok UZAYDAN kilit alacaksa uzay numarası artan sırada. Bugün çapraz-uzay
   çifti yok (ölçüldü); kural geleceğe konur.

Not: `endorse` temiz çıktı — olay iki carili ama **defter satırı tek** (yalnız
ciro edilen cariye debit, :679-682 bilinçli) → tx başına tek kilit, deadlock
yapısal olarak imkânsız.

---

## SINIF 4 — Tek yönlü atomik yüklem / check-then-act (bulgu #2)

### Kök neden

Atomik claim deseni projede yerleşik ama **claim WHERE'i yalnız kendi durum
kolonunu koruyor**; karşı yazarın değiştirdiği kolon (allocatedTotal) yüklem
dışında düz okumayla denetleniyor (`loadForTransition` kilitsiz `findUnique`
:502 → `assertNotAllocated` :560 → `claimTx WHERE {id, status}` :541).
`allocate` ile yarışta: BOUNCED çek + **canlı kapama satırı** + "kapalı ama
parası olmayan" fatura. Çürütücü beş savunma katmanını da yokladı: ortak kilit
yok, DB seddi yok, read committed kurtarmıyor.

Projenin kendi **doğru örnekleri** var ve desen kaynağı onlar:
`payment.cancel ↔ allocate` çifti iki yönlü kapalı (cancel claim'den sonra taze
release; allocate `WHERE status='ACTIVE'` taşıyor) — çek modülü yazılırken bu
desen bir tarafa taşınmamış.

### Karar: Seçenek 1 — iki yönlü CAS + DB CHECK seddi + sınıf üyeleri

1. **Geçiş tarafı:** `claimTx`'e opt-in `requireUnallocated` → WHERE
   `{id, status, allocatedTotal: 0}` — yalnız üç para-yok-eden geçiş (bounce /
   return / cancel) kullanır; diğer 4 çağrı DEĞİŞMEZ (blanket eklemek kapamalı
   çekin meşru tahsilini 409'a düşürürdü). count===0'da tanı tx İÇİNDE taze
   okumayla: durum değişti → mevcut "bu sırada güncellendi" 409; kapama doğdu →
   `assertNotAllocated`'ın **"kapamayı kaldırın"** mesajı taze tutarla (mesaj
   kalitesi kaybolmaz — hızlı-yol assert'i UX için önde de kalır).
2. **Kapama tarafı:** `bumpChequeAllocated` ham UPDATE'ine
   `AND status NOT IN ('BOUNCED','RETURNED','CANCELLED')` (tahsil edilmiş —
   COLLECTED — çeke kapama MEŞRU: müşterinin ödemesi gerçekleşmiştir; dışlanan
   yalnız paranın YOK olduğu durumlar).
3. **DB seddi (migration):** `cheques` CHECK — terminal-parasız durum ile
   `allocatedTotal > 0` birlikte olamaz. Uygulama yüklemi bir gün atlanırsa
   (ham SQL, yeni geçiş yolu, bekçisiz refactor) satırın kendisi direnir.
   Emsal: `cheques_endorsed_cari`.
4. **Sınıf üyeleri** (taramanın 🔴 bulguları — üçü de kapanır):
   - `invoice.updateDraft`: statü kontrolü tx dışında, son yazım koşulsuz →
     `confirm` ile yarışta CONFIRMED faturanın satırları **sessizce yeniden
     yazılır** (defter eski tutar, satırlar yeni tutar — hiçbir CHECK yakalamaz).
     Çözüm: tx + claim `updateMany WHERE {id, status:'DRAFT'}` → satır kilidi tx
     boyunca tutulur, confirm bloklanır ya da 409.
   - `goods-receipt.cancel ↔ invoice.confirm` çapraz çifti: **bugün (2026-08-14)
     eklenen guard'lar da check-then-act** — fiş iptalinin fatura kontrolü tx
     DIŞINDA, fatura onayının fiş kontrolü satır kilitsiz. Çözüm: iki taraf da
     karşı satırı kilitler — cancel'ın fatura kontrolü claim'den sonra tx İÇİNE;
     confirm fiş satırını `SELECT … FOR UPDATE` ile kilitleyip durumunu okur.
     (Dürüst kayıt: bu, aynı gün içinde kendi düzeltmemizin denetimde
     yakalanmasıdır — sınıf yaklaşımının değeri tam da bu.)
   - `invoice.deleteDraft`: koşulsuz fiziksel delete — FK Restrict veriyi
     koruyor ama kullanıcı ham P2003 görüyor. Claim'li deleteMany → anlamlı 409.
5. **Eşzamanlılık bekçisi:** paralel `allocate ‖ bounce` sondası (5-paralel
   `test_kk1_duplicate_guard` emsali) — tam olarak bir taraf kazanır; CHECK
   negatif sondayla (yüklem körleştirilince CHECK'in yakaladığı) kanıtlanır.

---

## SINIF 5 — Çift-çocuklu belge, tek-türlü tüketici (bulgu #17)

### Kök neden

`GoodsReceipt`'in satırları iki tabloda yaşıyor (`Roll` + `YarnMovement`) ve
**her tüketici yüzey hangisini okuyacağına kendi başına karar veriyor**: detay
`0 top · 0 m` + boş tablo, liste `_count.rolls`, **resmi fiş belgesi** yalnız
`rolls` (depocu-tedarikçi mutabakatının ana kâğıdında 500 kg iplik YOK), form ve
Excel import tek satır tipi. Backend `loadDetail` iplik verisini **zaten
dönüyor** — yani dört bağımsız kopya, dört bağımsız karar. Beşinci tüketici
yazıldığı gün sınıf yeniden açılır; `CONSUMABLE` (boya/kimyasal) türü doğduğu
gün üçüncü satır tipiyle **kesin** yeniden açılır.

Projenin çözülmüş emsalleri deseni gösteriyor: `Shipment ∪ DirectShipment` tek
union + tek `_shipped.ts`; `producedOutputWhere`; `Sack`'in Roll+Swatch okuyan
tüm yüzeyleri.

### Karar: Seçenek C — tek kaynak assembler + `YarnMovement.unitPrice` + türe duyarlı form

1. **`assembleReceiptLines`** (tek kaynak): `{kind:'FABRIC'|'YARN', …}` union'ı +
   türetilmiş toplamlar. `loadDetail`, printed-doc `fresh`, liste sayacı
   ("N top + M iplik") ve gelecekteki her tüketici (Excel, mobil, rapor) ondan
   beslenir. `kind` ayracı `CONSUMABLE` için genişleme noktası.
2. **Donmuş belge:** `GoodsReceiptDoc.yarnLines?` YALNIZ doluysa yazılır;
   renderer koşullu ikinci tablo "KABUL EDİLEN İPLİK (kg)". Eski 32 snapshot ve
   kumaş-only fişler **bayt-bayt aynı** (opsiyonel-alan konvansiyonu — sackNote/
   batchNumber emsali). `sample-data`'ya iplik satırı aynı commit'te (önizleme
   çöp olmasın kuralı).
3. **`yarn_movements.unitPrice` kolonu** (additive nullable, metadata-only,
   canlıda 0 iplik hareketi): `addYarnLine`'daki 400 guard'ı kalkar, D2 fiyat
   ön-dolumu ipliğe uzar (`movement.unitPrice ?? kart ?? 0` — kumaş deseniyle
   birebir), alış faturasındaki elle fiyat adımı otomatikleşir. Fiyat kabul
   ANINDA donar (append-only satırda) — maliyet/fatura mutabakatı için doğru yön.
   Ters kayıtlar (ADJUST_OUT) fiyat taşımaz.
4. **Türe duyarlı form:** iplik kalemi seçilince Renk/En/Kat/Özellik hücreleri
   devre dışı "—" (400'e hiç düşmeden), miktar yanında "kg" rozeti; Excel import
   aynı kurala bağlanır. Operatör kuralı deneme-yanılmayla değil ekrandan öğrenir.
5. **Küçük üye:** `warehouse.hardDelete` blocker sayımı iplik tablolarını da
   sayar (FK Restrict veriyi zaten koruyor; eksik olan "X kayıt etkilenecek"
   mesaj sözleşmesiydi).
6. **Bekçi:** assembler'ı tüketmeyen yüzey taraması + donmuş belge bayt-parite
   sondası (kumaş-only eski snapshot değişmemeli) + karma/iplik-only fiş render
   kontrolü.

---

## Uygulama planı

| Adım | İçerik | Migration | Pencere |
|---|---|---|---|
| 1 | Sınıf 3 (kilit sırası + middleware + virman) | YOK | backend-only, tek başına gidebilir |
| 2 | Sınıf 4 (CAS + CHECK + updateDraft/cross/deleteDraft) | 1 (CHECK) | backend-only |
| 3 | Sınıf 1 (çek postingDate) | 1 (kolon+backfill) | backend + Electron aynı pencere |
| 4 | Sınıf 2 (ADJUSTMENT_CANCEL + reversesTxnId + iptal ucu) | 2 (enum ayrı dosya + kolon) | backend + Electron aynı pencere |
| 5 | Sınıf 5 (assembler + unitPrice + form) | 1 (kolon) | backend + Electron aynı pencere |
| 6 | Bekçiler + negatif sondalar + CLAUDE.md kural kayıtları | — | her adımla birlikte |

Toplam: **5 migration** (hepsi additive; enum kendi dosyasında), **yeni izin YOK**
(hiçbir kurulumda elle adım doğmaz), **APK YOK** (mobil finansa dokunmuyor).
Tümü demo'ya tek deploy'la çıkabilir (`docs/ops/deploy-demo.sh`).

### CLAUDE.md'ye eklenecek kalıcı kurallar (sınıfların adı konur)

- **İki tarih kuralı:** yeni mali belge tipi eklerken sor — "kâğıdın üzerindeki
  tarih ile bizim işlem tarihimiz aynı şey mi?" Değilse iki alan.
- **Ters yol kuralı:** deftere yazan her ileri kaynak tipinin tipli ters yolu
  olmalı (`*_CANCEL` ailesi); enum'a ileri değer eklerken ters değeri de düşün.
- **Kilit sırası kuralı:** tek tx'te birden çok kilit → deterministik sıra
  (çoğul helper / kanonik anahtar); uzaylar arası → uzay numarası artan.
- **Çift yüklem kuralı:** durum ↔ sayaç çifti olan her modelde iki yazar da
  karşı tarafın koşulunu kendi atomik WHERE'ine koyar.
- **Tek kaynak satır kuralı:** çok-tipli çocukları olan belge, satırlarını tek
  assembler'dan verir; tüketici tabloya doğrudan gitmez.

---

## Karar noktaları (kullanıcıya)

**K-1 — Kasa defteri dönem kilidi (Sınıf 1'in sessiz üyesi):** geçmişe tarihli
kasa hareketi, raporlanmış kasa defterini sessizce değiştirebiliyor; cari dönem
kapanışı kasayı kapsamıyor ve bu hiçbir yerde yazılı değil. Seçenekler:
(a) bu pakete dahil et — kasa/banka için de dönem kilidi (kapsamlı, +1 model);
(b) backlog'a yaz, şimdilik yalnız "bilinçli kapsam dışı" notunu koda ve
CLAUDE.md'ye işle. **Tavsiye: (b)** — cari kilidi yeni; kasa kilidi gerçek
müşteri geri bildirimiyle şekillensin.

**K-2 — Çek terminal durumlarından çıkış (Sınıf 2'nin ikinci üyesi):** yanlış
COLLECT işaretlenen çekin durumu geri alınamıyor. Seçenekler: (a) `COLLECT`
stornosu ekle (kasa ters hareketi + durum PORTFOLIO'ya döner, olay defterine
tipli satır); (b) backlog. **Tavsiye: (a)'yı bu pakete almak** — ADJUSTMENT_CANCEL
ile aynı mekanik aile, maliyeti düşükken kapanır; modül henüz sahada değilken
davranış eklemek ucuz.

**K-3 — Ana paket:** beş sınıfın tavsiye edilen çözümleri (A · A · 1 · 1 · C)
uygulansın mı?
