# Ölçüm arıza sınıfları · KATMAN 1a — ölçümün ARACI

[`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'in ölçüm ALETİNE ait yarısı; 2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 1,6 KB kalmıştı ve aktif yazılıyordu; tavan yükseltilmedi).

**Çizgi:** buradaki sınıflarda kusur **aletin kendisindedir** — desen, komut, ayrıştırıcı, aracın varsayılanı, aracın kapsamı. Ölçümün **KURGUSUNA** ait sınıflar (soru, kontrol grubu, ortam, deneyin kurulumu) `OLCUM-DISIPLINI-SINIFLAR.md`'de; **KATMAN 2** (sayı doğru; ondan çıkarılan ne) [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de; yöntem ve kapı ölümleri [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de.

⚠️ **Numaralar KORUNDU** — §1 ve §4 burada, ötekiler orada; dizide boşluk vardır ve bu bilinçlidir. **Bir sınıf ADIYLA anılır**, numara yalnız listenin sırasıdır.

---

### 1 · Araç bozuk
Çıktı boş ya da anlamsız gelir; fark edilir, en ucuz sınıf.
**Savunma:** çıktıyı okumadan sonuç yazma.

### 4 · Araç ölçümün içinde
`ps | grep` kendini sayar; sonda, ölçtüğü sinyalin taşıyıcısını kirletir.
**Savunma:** `pgrep -f` ya da `grep -v grep`. Sonda argümanı, ölçülen sinyalin
taşıyıcısıyla **aynı kanaldan geçmemeli**.

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

### Aracın VARSAYILANI ≠ olgunun özelliği — iki biçim
Araç DOĞRU çalışıyor, çıktısı da doğru; yanlış okunan şey **varsayılan ayarıdır**.
§1'den (araç bozuk) farkı bu: orada çıktı anlamsızdır, burada çıktı doğru ve EKSİK.

**(a) Aracın çıktı SIKLIĞI, olgunun sıklığı değildir.**
Node bir deprecation'ı **süreç başına bir kez** basar; *"bir kez gördüm"* bir sıklık
değil, **aracın politikasıdır**. *(Vaka 2026-09-13: beş ayrı süreçte koşulunca aynı
uyarı 5/5 deterministik çıktı — olgu hiç seyrek değilmiş.)*
> **Bir sayacı okumadan önce, aracın o sayacı NASIL bastığını ölç.** Bastırma ·
> örnekleme · tavan · yuvarlama — hepsi **olgunun değil aracın** özelliğidir.

**(b) Kırpılmış yığından mekanizma okunmaz.**
İlk deneme 10 karede kesildi; `Error.stackTraceLimit = 100` ile `Array.map` karesi
**göründü** ve mekanizma tam oydu. Aynı gün ikinci vaka: bir site sayımı 163 → **251**
çıktı, tek sebep aracın varsayılan sonuç sınırıydı.
> **İki bağımsız vaka, tek kural: aracın varsayılan SINIRI, bulgunun sınırı sanılır.**

**(c) Bir aracın SESSİZLİĞİ bir veri değildir.**
Araç bir satırı basmıyorsa bu *"o şey yok"* demek değil, **aracın bastırma
politikası** demektir — ve o politika ölçülebilir. *(d5: koşucu, geçen dosyayı hiç
basmıyordu; "listede yok" ⇒ "koşmadı" sanıldı.)*

**Savunma:** sınırı ve sessizliği olan her araçta (yığın derinliği, sonuç tavanı,
`head`, `grep -m`, ajan çıktı kırpması, "yalnız hataları bas" modu) **politikayı ÖNCE
oku**, sonra ölç.

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

### "Ölçemiyoruz" ile "ölçmek için aracı KURMADIK" aynı cümle değildir
Araç eksikliğini bir **bilgi sınırı** sanmak. İlki dünyanın özelliği, ikincisi
masanın.
*(Vaka: bir kalem bir hafta boyunca "kanıtlanamaz — bu makinede `gh` yok" diye açık
bırakıldı. `gh` kurulumu on dakika sürdü ve cevap ANINDA çıktı.)*
**Savunma:** "ölçemiyoruz" yazmadan önce, ölçmek için gereken aracın **kurulma
maliyetini** yaz. Yazamıyorsan cümle "kurmadık"tır.

### Bir NEGATİF bulgu, ikinci yönü ölçülmeden RAPOR EDİLMEZ
Ölçülemiyorsa **"bulamadım"** diye yazılır, **"yok"** diye değil.
> **Pozitif bulgular kendilerini savunur** (siteyi gösterirsin); **negatifler
> savunmaz** — *"yok"* cümlesi, aracın körlüğüyle *"göremedim"*den ayırt edilemez.

*(Üç vaka, bir gün: ① *"boş kesişim"* — ilk `grep` bir job'u "hiç yazmıyor" gösterdi,
oysa bir yardımcı üzerinden **bir sıçrama ötede** yazıyordu. ② `grep`ten kurulan dört
site, ölçünce **on** çıktı. ③ *"komut metinleri bende yok"* — metinler oturum
günlüklerindeydi.)*
**Savunma:** her negatif bulgu için **ters yönü** ölç (hedeften kaynağa, çağrandan
çağırana); ölçemiyorsan cümleyi zayıflat. Kardeşi: § "Bende yok" bir ölçüm değildir.

### Bir ÇAPA doküman linki olmayabilir — kod da bir dosyayı okur
Belge kapısı yalnız **link** arar. Ama bir bekçinin `readFileSync` ile okuduğu yol da
bir çapadır, ve taşındığında **sessizce kopar** — belge kapısı yeşil kalır.
*(Vaka 2026-09-13: bir standart dosyasının §2 tablosu ayrı dosyaya bölündü;
`check-docs` rc=0 verdi, ama bir bekçi o tabloyu doğrudan okuyup ayrıştırıyordu ve
21/6'ya düştü.)*
**Savunma:** bir belgeyi taşımadan önce **koddan da ara** (`grep -r "<dosya adı>"
scripts/ src/`), yalnız `.md` linklerinden değil.

📌 **Öneri (uygulanmadı):** belge kapısı, KAYNAK KODDA geçen `docs/…` yollarını da çapa
saysın. Bugünkü bakış açısı *"bu linkin hedefi var mı"*; eksik olan yön **koddan
belgeye** olan bağ. Sahibi kapı alanıdır, bu belge yalnız sınıfı kaydeder.

⭐ **Yakalayan şey bekçinin KENDİ körlük zemini oldu** — "ayrıştırdığım tablo BOŞ mu"
diye soran bir kontrol, tablo boşalınca sessiz yeşil vermek yerine kırmızı verdi.
> **Girdisini ayrıştıran her bekçi, girdinin BOŞ gelmesini de bir kırmızı saymalıdır.**
> Boş girdi her yüklemi "ihlal yok" ile geçirir; körlük zemini olmayan bekçi,
> kaynağı kaybolduğu gün EN GÜRÜLTÜSÜZ biçimde ölür.

⚠️ Ve düzeltirken **ikinci** bir kör nokta çıktı: aynı bekçinin bölüm regex'i son alt
bölümü hiç yakalamıyordu (ardında başlık yoktu), yani **belge DÜZENİNE bağımlıydı** ve
bunu kimse bilmiyordu. *Bir kusuru düzeltmek, komşusunu görünür kılar.*

### Bir düzeltmenin sonucu, DÜZELTİLEN KÜMEYE bakarak ölçülemez
Düzelttiğin kümeye bakmak yalnız *"gitti mi"*yi söyler; *"yerine yenisi geldi mi"*yi
söylemez. **İki fark birden alınır: `eski \ yeni` VE `yeni \ eski`.** *(ea)*
**Savunma:** tek yönlü fark bir düzeltmeyi asla doğrulamaz — düzeltme yeni site
üretebilir ve o siteler ilk kümede yoktur.

### Araç VAR ile araç UYUMLU ayrı iki şeydir
Aracın kurulu olması, ölçtüğün sistemle **aynı sürüm hattında** olduğunu söylemez.
*(d9: `pg_dump` 18.6 ↔ sunucu 16.15 — araç vardı, uyumlu değildi.)*
**Savunma:** sürüm bağımlı araçta iki sürümü de yaz.

### Bir YOKLUK iddiası, bakılan DİZİNİ gösterir
Monorepo'da aynı adı taşıyan iki dizin varken (`scripts/` ↔ `Teks-Erp/scripts/`,
`src/` ↔ `Teks-Erp/src/`), `ls`in ya da `find`in boş dönmesi **bir ölçüm değildir** —
aracın `cwd`sini gösterir.
*(İki vaka, aynı gece: biri "`test_advisory_lock_namespaces` yok" dedi — vardı, komşu
kökteydi; öteki kapıyı `Teks-Erp/Teks-Erp/`den koşturup `MODULE_NOT_FOUND` aldı ve az
kalsın "kapı bozuk" diyecekti.)*
**Savunma:** yokluk iddiasını **`git ls-files | grep`** ile kur — git ağacın TAMAMINA
bakar, senin `cwd`ine değil. Kardeşi `OLCUM-DISIPLINI-SINIFLAR.md` § "Bende yok" bir
ölçüm değildir.

### Bir tarayıcı, kendi TARİF ETTİĞİ şeyin ÖRNEĞİNİ gerçek sanır
Biçim tarif eden belgeler (`README`, şablon, başlık örneği) tarayıcının kapsamı
dışında bırakılır — ve bu **bir muafiyet değil, TANIM GEREĞİDİR**: orada duran şey bir
kural değil, **kuralın resmidir**. *(5e teşhis · d5 formülasyon)*
*(Vaka 2026-09-13: kimlik tekilliği kapısı üç çakışma bildirdi; üçüncüsü
`docs/standart/README.md`'deki `- **[BE-07]** <emir kipi…>` biçim örneğiydi. Aynı sınıf
aynı gece bir başka oturuma dört kez çarptı.)*
⚠️ Ters yönü de var ve bu belgede yaşandı: *yasağı anlatan cümle, yasağın kendisi
sayılabilir* (§ Dolaylılık'ın ters yönü).
