# Ölçüm disiplini — KATMAN 1a′ · YÜKLEM (ne sorduğun)

[`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md)'in **yüklem** yarısı; 2026-09-13'te
oradan **bölünerek** geldi (o dosya tavana 57 bayt kalmıştı; tavan yükseltilmedi).

**Çizgi:** aletin ÇALIŞMASINA ait kusurlar orada (komut, kabuk, ayrıştırıcı, aracın
varsayılanı, aracın sürümü); **burada kusur SORUDADIR** — desenin kapsamı, eşleşmenin
sınırı, popülasyonun üyeliği, yüklemin gevşek ya da dar oluşu. Ortak imza: *araç kusursuz
çalıştı ve YANLIŞ ŞEYİ saydı.*

⚠️ Bu ailenin en sık **ikinci** hatası, gevşek bir yüklemi DAR bir yüklemle düzeltmektir —
düzeltmeyi de iki yönden ölç (§ Yüklemi GEVŞEK bir cırcır, içindeki şerh).

Ölçümün KURGUSUNA ait sınıflar [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'de,
paylaşılan ORTAMA ait olanlar [`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md)'de,
**KATMAN 2** [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de, yöntem ve kapı
ölümleri [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de.

### Dolaylılık — desen tabanlı ölçümün varsayılan kör noktası
Bir desen *"şu metni içeriyor mu"* diye soruyorsa, metnin **bir adım dolaylı** hâli
için **ayrı bir sonda** yazılır.
*(Aynı kök bir gecede üç kez: ham SQL içine gömülü `UPDATE` · sabit üzerinden
verilen olay adı · şablon değişkenine gömülü `DROP TABLE`.)*
**Kurtarma cümlesi:** *"sondayı kurmasaydım deseni yeterince dar sanacaktım."*

⚠️ Bu sınıfın **ters yönü de var ve bu belge yazılırken yaşandı:** komut kapısı,
yukarıdaki `DROP TABLE` dizgesini **belge örneği** olarak yazmayı engelledi. Desen
metni bağlamdan bağımsız eşliyor ⇒ *yasağı anlatan cümle de yasağın kendisi
sayılıyor.* Yani dolaylılık kör noktasının bedeli iki yönlü: desen bir adım
dolaylıyı **kaçırır**, düz metni **fazladan yakalar**.

### Çelişki yüklemi ≠ farklılık yüklemi
Bir çelişki yüklemi kurarken **"hangi değerler birlikte YANLIŞ"** sorusunu,
**"hangi değerler FARKLI"** sorusundan ayır.
*(Vaka: `unit <> 'kg' AND scale IS NULL` üç "çelişki" buldu; üçü de metre cihazıydı
ve m→m çarpanı 1 doğruydu.)*

### Sezgisel eşleme, ölçümün KENDİSİNİ yakalayabilir
§4'ün (araç ölçümün içinde) sezgisel akrabası: "en yakın komut" gibi bir buluşsal,
ölçüm script'inin kendi çağrısını eşleştirir.
*(Vaka: kesin anahtara — `toolUseID` — geçilince sayı 4.123 → **4.962**, yanlış dizin
1 → **24**.)*
**Savunma:** eşlemeyi **yakınlıkla değil KİMLİKLE** kur.

### Aracı değiştirmek kapsamı genişletmez — YÜKLEMİ genişletmek genişletir
*(Vaka: bir envanter `grep` yerine AST ile kuruldu; **AST de kaçırdı** —
`ShorthandPropertyAssignment`'ta, yani `data: { status, … }` yazımında, metinde
`status:` token'ı YOKTUR. Kaçan site üretimin ana finalize boğazıydı.)*
⚠️ Asıl tehlike aracın kaçırması değil: **AST daha hassas olduğu için insanı "artık
kaçırmam" diye rahatlatır.** Kaçırdığı şey aynı sınıftandır, yalnız daha SESSİZ.
> **Daha iyi bir araç ikinci turu gereksiz kılmaz — ikinci turu TERK ETME İSTEĞİNİ
> üretir.**

### Tarama, aradığı şeyin YAZILIŞ BİÇİMİNİ değil KENDİSİNİ sormalı
`status:` aramak bir **biçim** sorusudur; *"bu nesne `status` taşıyor mu"* bir
**anlam** sorusu. Ve belirsiz kalan aday **temiz sayılmaz** — fail-closed.
*(Aynı vaka: soru anlam düzeyine çekilince 13 → **16** aday.)*

### Bir YOKLUK iddiası, arandığı DESENLE yazılır
*"Başka kırıcı çift YOK"* değil — **"`DROP COLUMN` ve `delete data\.` desenleriyle
aradım; üçüncü bir biçim varsa bu ikisi görmez."**
*(Kaynak: oturum ölçümü 2026-09-13, sha yok; paket envanteri belgesi.)*
Kardeşi § Boş çıktı bir ÖLÇÜM değildir ve `OLCUM-DISIPLINI-SINIFLAR.md` § "Bende yok".

### Sınırsız eşleşme — sınırını BEYAN ETMEYEN yüklem alakasızı içeri alır
Bir yüklem yanlış olmadan **sınırsız** olabilir: aradığını bulur, ama **aramadığını da**
bulur. Üç biçim ölçüldü: *kelime sınırı yok* · *bağlam sınırı yok* · *boş küme her şeye
uyar*. Panzehir aynı: sınırı BEYAN et (boşluk/`\b`, alanı daralt, boş kümeyi ayrı ele al).

| # | vaka (2026-09-13) | gevşeklik | sonuç |
|---|---|---|---|
| a | `grep _shipped` | alt dizgi | 6 eşleşme, gerçek **3** — fazlalık bir *constraint adı* + bir *emsal yorumu* |
| b | `lib/<ad>` metni arandı | ad ≠ bağ | 26 ↔ gerçek **25**; fark bir YORUM satırıydı (§ Bir adın geçmesi bir BAĞIMLILIK değildir) |
| c | **`!m.includes("9-KAT")`** | alt dizgi | **kurbanı KENDİ fikstürü** — aşağıda |

⭐ **(c) ailenin en pahalı biçimi, çünkü kurban bekçinin KENDİ ürettiği değer.**
*(d9, ölçüldü: sonda değeri `TEST-KAT-${Date.now()}-KAT`. Damga **9 ile bittiğinde**
dizgi `…5549-KAT` oluyor ve `"9-KAT"` alt dizgisini İÇERİYOR ⇒ yüklem alakasız bir
değerle eşleşiyor. "Aralıklılık" gizemi değil **damga aritmetiği**: `Date.now() % 10 === 9`
⇒ 1/10; CI'daki iki kırmızının ikisi de 9 ile bitiyordu — `1789324255549` · `1789323101009`.
Üç hipotez kuruldu (başka testin fikstür kalıntısı · kendi kalıntısı · bayat önbellek) ve
**üçü de yanlıştı**. Düzeltme `675211b2`: liste artık TOKEN olarak okunuyor, dört sonda,
biri (§0c) eski yüklemin yanılgısını BELGELİYOR.)*

> **Bir bekçi, kendi fikstürünü ortama koyduğu anda KENDİ YÜKLEMİNİN GİRDİSİ hâline
> gelir.** ⇒ Sınırı beyan etmek yetmez; ayrıca sor: ***sondanın ÜRETTİĞİ değer, sondanın
> YÜKLEMİNE girdi olabilir mi?***

⚠️ **Ve aralıklılık bir teşhis değil bir SORUDUR:** "bazen kırmızı" gördüğünde önce
*"hangi girdi 1/N olasılıkla değişiyor"* diye sor — zaman damgası, rastgele ad, sıra,
saat. Gizem çoğu kez aritmetiktir.
Kardeşleri § NE sorduğun kadar NEREYE sorduğun · § Bir adın geçmesi bir BAĞIMLILIK
değildir · § Bir yüklem, aradığı şeyin BOZULMUŞ hâlini aramaz (bunun TERSİ).

### Bir yüklem, aradığı şeyin BOZULMUŞ hâlini aramaz — bozulma ADAYI yok eder
Sınırsız eşleşmenin **tersi**: sınır o kadar dardır ki kusurlu örnek **aday bile
olmaz**. Cırcır 0'da kalır, çünkü sayacak bir şey doğmamıştır.

*(Vaka 2026-09-13, ölçüldü: bir kural satırının `bekçi:` alanı `…test_kursun_bypass, te`
diye kesikti — ad, `test_` önekini bile tamamlamıyordu. Kesik-ad cırcırının yüklemi
`/\btest_[a-z0-9_]+\b/` ve `te` ona UYMUYOR ⇒ aday hiç doğmadı, kapı sessiz kaldı.
Alan tam okunuyordu; kusur okumada değil **popülasyonun tanımındaydı**.)*

> **Popülasyonu, aradığın şeyin DOĞRU biçiminden türetirsen, YANLIŞ biçim popülasyonun
> dışında kalır** — ve tam da ölçmek istediğin şey odur.

**Savunma:** popülasyonu **alandan** türet (her `bekçi:` alanının virgülle ayrılmış her
öğesi bir adaydır), sonra her adayın geçerli biçime uyup uymadığını sor. O zaman
`te` bir **yokluk** değil bir **kırmızı** olur.
Kardeşleri § Boş çıktı bir ÖLÇÜM değildir · § Tarama, aradığı şeyin YAZILIŞ BİÇİMİNİ
değil KENDİSİNİ sormalı.

### Bir POPÜLASYONU saymadan önce ÜYELİĞİNİ sına

Bir kümenin üyelerini saymak, onların o kümeye ait olduğunu **varsayar**. Üyelik
sınanmazsa sayı üç ayrı şeyi tek rakama sıkıştırır ve hiçbiri görünmez.

*(Vaka 2026-09-13, `--apply` script'lerinin iz bırakması.* Dolaşan sayı: **"27
script'in 6'sı hiç iz bırakmıyor"**. İki oturum bağımsız ölçtü ve **ikisi de 6
buldu**. Pozitif kontrol — *"bu altısı gerçekten YAZIYOR mu?"* — sayıyı çökertti:*

| ölçülen | gerçek sınıf |
|---|---|
| `backfill-record-provenance` | **gerçekten izsiz yazıyor** (ham SQL — ne audit ne `updatedAt`) |
| `setup-ticaret` | **servis üzerinden yazıyor** ⇒ iz VAR; `systemSettingService` · `PermissionManagementService` · `ensureDefaultWarehouse` audit'i kendileri atıyor. Desen taraması dolaylı çağrıyı görmedi |
| `db-guard` | **hiç yazmıyor** — salt-okunur bir kapı, popülasyonun üyesi bile değil |

⇒ *"6 izsiz"* = **1 gerçek ihlal + servis üzerinden yazanlar + popülasyona ait
olmayanlar.** Bir yüklem "yazma yolu"nu **kapanışıyla** izlemiyorsa (script →
servis → audit/Prisma), meşru script'leri ihlal gösterir.

> ***İki bağımsız ölçüm aynı sayıya vardı ve ikisi de yanlıştı. Aynı KÖR NOKTAYI
> paylaşan iki ölçüm birbirini DOĞRULAMAZ.***

⚠️ Bu, *"kritik iddiada iki bağımsız ARAÇ kullan"* kuralının ince yeri:
**bağımsızlık KAYNAKTA değil YÖNTEMDE olmalı.** İki oturum, iki kaynak — ama tek
yöntem (literal desen araması) ve tek kör nokta (dolaylılık). Farklı kişilerin
aynı yöntemi koşturması, ölçümü **tekrarlar**, doğrulamaz.

📌 Panzehir iki adımlı: ① üyeliği sına (*"bu dosya gerçekten YAZIYOR mu?"*),
② yüklemi kapanışa taşı (doğrudan çağrı değil, ulaşılan tüm yazma yolları).
*(d5 ölçüm + formülasyon · 1e'nin "yazan yolları say, adı arama" şartı bunu
önceden söylüyordu ve ilk turda yine literal sayıldı.)*

**Kardeşi — MALİYET tahmini de bir popülasyon iddiasıdır ve REÇETEYE karşı ölçülür.**
Bir tasarım belgesine *"bu dilim dört dosya getirir"* diye yazmak, bir dosya kümesinin
üyeliğini ilan etmektir; hafızadan yazıldığında ölçülen şey **kişinin o an düşündüğü
alt küme**dir. *(Vaka 2026-09-13: ekran dilimi sözleşmesine "bayrak DA getirir (dört
dosya)" yazıldı — modüle ÖZGÜ dört yer sayılmıştı. Ölçüldü: `docs/RECETELER.md`
§ yeni feature flag bir MODÜL anahtarı için **16 adım** listeliyor ve emsal bir
ekransız modül anahtarı (`tezgahEnabled`) bugün **20 kod dosyasında** yaşıyor —
13 ürün + 7 test/fikstür. Atlanan küme rastgele değil: jenerik bayrak sözleşmesinin
tamamı — `SETTING_KEYS` → okuyucu → `FeatureFlags` → `getFeatureFlags` →
`setFeatureFlags` → Zod şeması → Electron aynası → panel satırı → `flag-modules` →
mobil ayna → grandfathering migration.)*

⇒ Kural: ***bir işin büyüklüğünü hafızadan değil, o işin REÇETESİNDEN say.*** Reçete
varsa tahmin bir ölçüm değildir; reçete yoksa sayı yerine *"ölçülmedi"* yazılır.
📌 Ayırt edici soru: *"bu dörtte hangi ADIMLAR var, ve reçetedeki geri kalanı KİM
yapıyor?"* — cevabı olmayan her maliyet sayısı, yapılacak işin bir kısmını
GÖRÜNMEZ kılar ve dilimi planlayan kişi onu başkasının borcu sanır.

### Yüklemi GEVŞEK bir cırcır, DOĞRU kodu da ihlal sayar — kapı düzeltmeyi CEZALANDIRIR
Bir cırcırın sayısı, kuralın cümlesiyle aynı şeyi ölçmüyorsa iki kusur birden doğar:
sayı yanlış OLUR **ve tek görünür çare (tavanı yükseltmek) ihlal olmayan bir şeyi
ONAYLANMIŞ ihlale çevirir.**

*(Vaka 2026-09-13, ölçüldü: bir kural "route kapısı dosya BAŞINDA `router.use(verifyToken, …)`
ile kurulur, handler başına yazmak fail-open'dır" diyordu; cırcırın yüklemi ise
`grep -rl "verifyToken," src/routes` idi — ve bu desen **doğru** kalıbın kendisiyle de
eşleşir. Aynı ağaçta, `src/routes` özyinelemeli, 83 dosya: kapının yüklemi **79** · dosya
başında `router.use(verifyToken` **27** · handler başına, ÇOK SATIRLI çağrılar dâhil
**53** · ikisi birden **11**. Yani 79'un içinde doğru kalıbı taşıyan dosyalar da vardı,
ve kırmızıyı getiren değişiklik yeni ve **doğru yazılmış** bir route dosyasıydı.
Doğru yüklemle sayı taban commit'inde de bugün de 53 — tavan HİÇ aşılmamıştı.)*

⚠️ **Kendi ilk düzeltmem de dar çıktı:** handler kalıbını tek satırlık bir regex'le
aradım ve **32** buldum; çok satırlı `router.post(\n  "/x",\n  verifyToken, …)` çağrıları
ADAY BİLE OLMADI. Doğru sayı 53. ⇒ *Gevşek bir yüklemi düzeltirken ikinci bir DAR yüklem
yazmak bu ailenin en sık ikinci hatasıdır* — düzeltmeyi de iki yönden ölç.

> **Bir cırcır kırmızı verdiğinde ilk soru "kim bozdu" değil, "bu sayı kuralın cümlesini
> mi ölçüyor" olmalıdır** — çünkü gevşek yüklemde sayıyı yükselten şey çoğu kez DÜZELTME
> olur ve kapı, kendisine uyan kodu cezalandırır.

⚠️ **Ve çare ASLA tavanı yeni değere çekmek değildir:** kapının kendi başlığı bunu zaten
söylüyor (*"aşılmış bir tavanı yeni değere çekmek onu ölçmek değil ONAYLAMAKTIR"*) — ama
yüklem gevşekken bu cümle yetmez, çünkü ortada onaylanacak bir ihlal bile yoktur.
**Sıra: önce YÜKLEMİ düzelt, sonra tabanı gerçek sayıya indir.**
Kardeşleri § Sınırsız eşleşme · § Tarama, aradığı şeyin
YAZILIŞ BİÇİMİNİ değil KENDİSİNİ sormalı.

### Bir "HEPSİ" iddiası, kümeyi üreten yüklem kadar doğrudur
Gevşek yüklemin bilinen zararı *alakasızı içeri almaktır*. Daha sinsi ikinci zararı şudur:
o liste bir **KAPSAMA İDDİASINA** dönüşür. "Hepsini koştum" cümlesi listeye yaslanır ve
liste yanlışsa cümle de yanlıştır — üstelik kimse listeyi değil CÜMLEYİ okur.

*(Vaka 2026-09-13: yeni bir bekçi yazıldı ve yalnız **onu yakalayan** kapılara koşturuldu;
CI'da başka bir mandal kırmızı verdi. Düzeltirken "hangi tarayıcılar var" sorusu grep'le
cevaplanmak istendi — yüklem `__dirname` + `readdirSync` idi ve **20 dosya** eşleşti,
çoğu ilgisiz. O listeyle çalışılsaydı "hepsini koştum" denecekti ve yanlış olacaktı.
Çare liste değil **tam paket** oldu.)*

> **"Hepsi" bir SAYI değil bir YÜKLEMDİR.** Yazarken kümeyi nasıl ürettiğini de yaz;
> üretemiyorsan "hepsi" deme — *"şu üçünü koştum"* de.

**Savunma:** kapsama iddiası ya **tüketici** bir koşumla (tam paket) ya da **ölçülmüş bir
envanterle** kurulur; ikisi de yoksa iddia daraltılır. Envanter iki bağımsız yoldan
çıkarılırsa fark bilgidir, gürültü değil.
Kardeşleri § Bir POPÜLASYONU saymadan önce ÜYELİĞİNİ sına · § Sınırsız eşleşme
(`OLCUM-DISIPLINI-SINIFLAR.md`) · `CLAUDE.md` § Commit kapısı (kapı bekçileri koşmaz).

### NE sorduğun kadar NEREYE sorduğun — yetenek ORTAK LIB'e çıkınca dosya bazlı envanter körleşir
Bir yüklem aynı anda **hem gevşek hem dar** olabilir: alakasızı içeri alır *ve* aradığını
kaçırır. Bu ikisi çelişmez, çünkü biri **deseni**, öteki **bakılan yeri** ilgilendirir.

*(Vaka 2026-09-13, iki oturum bağımsız ölçtü: "hangi bekçiler dizin tarıyor" sorusuna
`scripts/test_*.ts` içinde `readdirSync`/`glob`/`ls-files` aranarak cevap verilmek istendi.
Ölçüm 2026-09-13 — 534 bekçi dosyasının **69**'u listeyi kendi içinde üretiyor; ama liste üreten
**5 ortak lib** var (`keyfi-arama-taramasi` · `kural-dosyalari` · `ts-tarama` ·
`stok-defteri-bag-olcumu` · `regime-gate-scan`) ve onları **25** bekçi import ediyor.
`test_*.ts` üstünde yapılan tarama bu 25'i GÖRMEZ ve görmediğini SÖYLEMEZ. Bir oturumu
CI'da ısıran mandal tam o gizlenen kümedeydi.)*

> **Yetenek ortak bir lib'e çıkarıldığı an, dosya bazlı her envanterin kör noktası
> doğar** — ve envanter yine de "tamam" görünür, çünkü kaçırdığı şeyin adı listede yoktur.

**Savunma:** "hepsi" derken kümeyi nasıl ürettiğini yaz **ve o üretimin, aradığın şeyin
SAKLANABİLECEĞİ her yeri gezdiğini ayrıca söyle** — doğrudan kullanım + dolaylı
(import/devir) kullanım iki ayrı sorudur. İkisini de soramıyorsan tüketici koşum (tam
paket) tek dürüst yoldur.

⚠️ **İki yön, tek aile:** § Yüklemi GEVŞEK bir cırcır'da desen kuralın ÖNERDİĞİ kalıpla
eşleşiyordu (**doğru kodu ihlal saydı**); burada yüklemin baktığı yer yanlıştı (**ihlali
hiç görmedi**). *Ne sorduğun* ve *nereye sorduğun* — bu dosyanın iki ekseni.
*(İki bağımsız ölçüm önce 26 ↔ 25 verdi ve fark ÇÖZÜLDÜ — aşağıdaki § Bir adın geçmesi
bir BAĞIMLILIK değildir. Doğru sayı **25**; 26'daki fazlalık bir YORUM satırıydı.)*

### Bir adın geçmesi bir BAĞIMLILIK değildir
Kod tabanında bir adın geçmesi üç şeyden biri olabilir: **bağımlılık · atıf · tesadüf.**
Envanter yalnız birincisini sayar; yüklem ADI arıyorsa üçünü birden sayar.

> **Envanter yüklemi ADI değil BAĞI aramalı** — `from "…"` · `require(` · gerçek çağrı.
> Aksi hâlde **iyi yorumlanmış kod, kötü yazılmış bir yüklemin en büyük yanlış-pozitif
> kaynağı** olur: belgeleme kalitesi yüksek dosyalar envanteri şişirir.

*(Vaka 2026-09-13, ölçüldü: "şu ortak lib'i kaç bekçi kullanıyor" sorusuna `lib/<ad>`
metni aranarak **26**, gerçek import aranarak **25** cevabı çıktı. Tek fark
`test_consistency.ts:120` — bir YORUM satırı: `// Ölçü: scripts/lib/stok-defteri-bag-olcumu.ts (K = 0, …)`.
Dosya o lib'i import etmiyor, ondan BAHSEDİYOR. Aynı imzanın ikinci vakası aynı gün:
bir `grep` 6 eşleşme verdi, gerçek 3'tü — fazlalık bir **constraint adı** ile bir
**emsal yorumu**ydu.)*

**Savunma:** envanter sorusunu iki sütun yaz — **BAĞ** (koşar/import eder) ve **ATIF**
(adı geçer). İkisi farklı sorudur ve ikisinin de meşru kullanımı vardır; karıştırmak
"bu bekçi o taramayı koşar" cümlesini sessizce yanlışlar.
Kardeşleri § NE sorduğun kadar NEREYE sorduğun · § Sınırsız eşleşme
(`OLCUM-DISIPLINI-SINIFLAR.md`).

### Üyelik yalnız HANGİ DOSYALAR değil, HANGİ KOŞULLARDA sorusunu da taşır
Bir popülasyonu doğru saymak yetmez: *"bu popülasyonda kusur yok"* ile *"bu
popülasyonun BU REJİMDEKİ davranışında kusur yok"* farklı iki cümledir ve ikincisi
yazılmazsa okuyan birincisini anlar.

*(Vaka 2026-09-13, d9: 534 bekçi ulaşılamaz DB ile tarandı, *"kusur kovası boş"* denildi.
Popülasyon doğruydu — 534'ün 534'ü tarandı. Ama rejim popülasyonun parçası sayılmamıştı:
DB'siz rejimde bir dosyanın fikstür-yok dalı hiç tetiklenmiyordu, DB'li taze rejimde
tetikleniyor ve dosya özet satırını basmadan sessizce çıkıyordu.)*

> **Üyeliği sınarken iki soruyu birlikte sor:** *hangi öğeler* **ve** *hangi koşullarda*.
> İkincisi yazılmayan bir "0", kapsamı okunmadan taşınır.

**Savunma:** popülasyon cümlesinin yanına rejimi damgala (DB var/yok · sunucu ayakta mı ·
fikstür dolu mu · STRICT açık mı); `OLCUM-DISIPLINI.md` § Sayı yazma'daki eksen listesi
bunun tam hâlidir.
