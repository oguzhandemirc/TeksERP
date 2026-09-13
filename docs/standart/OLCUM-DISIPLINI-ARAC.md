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

### Bir LİSTE tek başına ölçüm aracı değildir — ELEME adımı onun yarısıdır
Kök/desen listesiyle çalışan her ölçümde liste *neyi arayacağını*, eleme adımı *neyi
saymayacağını* söyler. Eleme yazılmazsa liste **kendi çakışmalarını sayar**.
*(Ölçüldü 2026-09-13: 2–3 harfli Türkçe kökler İngilizceyle çakışıyor — `al`→alert ·
`ver`→verify · `ad`→admin · `bul`→bulk. Elemesiz tur **1.667**, elemeli tur **876**;
fark tamamen aracın kendi gürültüsüydü.)*
> **Bir listeyi kurala bağlarken elemeyi de bağla** — yoksa kural, listenin değil
> çakışmanın ölçüsü olur.
Kardeşi § Tarama, aradığı şeyin YAZILIŞ BİÇİMİNİ değil KENDİSİNİ sormalı.

### Boş çıktı bir ÖLÇÜM değildir — iki dünya aynı boşluğu üretir
*"Yok"* ile *"var ama eşleşmedi"* **aynı boş çıktıyı** verir. Ayıran şey çıktı değil
**ÇIKIŞ KODUDUR** — ve `2>/dev/null` mesajı yutar ama **kodu yutmaz**:

```
grep -c DESEN <var olan dosya>   → çıktı boş, çıkış 1   (dosya var, eşleşme yok)
grep -c DESEN <olmayan dosya>    → çıktı boş, çıkış 2   (dosya yok)
```
*(Ölçüldü 2026-09-13: `2>/dev/null` ile İKİ çıktı da boş, iki çıkış kodu FARKLI.
Vaka 01'e ait: bir bekçinin "yok" sanılması, dosya yerindeyken desenin eşleşmemesiydi.)*

> **Yokluk iddiasını POZİTİF kanıtla kur:** `git ls-files | grep` (ağacın tamamı,
> `cwd`den bağımsız) — ya da `ls <yol>` çalıştır ve **çıkış kodunu OKU, stderr'i yutma**.

⚠️ **Ayrı ve hâlâ geçerli bir vaka — aynı üst sınıftan:** bir kapı yanlış dizinden
koşturulup `MODULE_NOT_FOUND` verdi ve az kalsın *"kapı bozuk"* denecekti. Monorepo'da
`cwd` gerçekten önemlidir; ama 01'in vakasında **sebep o değildi**. Ve evde zaten yazılı
olan satırın ihlali: **`>/dev/null` gerekçeyi yutar.**

### Bir tarayıcı, kendi TARİF ETTİĞİ şeyin ÖRNEĞİNİ gerçek sanır
Biçim tarif eden belgeler (`README`, şablon, başlık örneği) tarayıcının kapsamı
dışında bırakılır — ve bu **bir muafiyet değil, TANIM GEREĞİDİR**: orada duran şey bir
kural değil, **kuralın resmidir**. *(5e teşhis · d5 formülasyon)*
*(Vaka 2026-09-13: kimlik tekilliği kapısı üç çakışma bildirdi; üçüncüsü
`docs/standart/README.md`'deki `- **[BE-07]** <emir kipi…>` biçim örneğiydi. Aynı sınıf
aynı gece bir başka oturuma dört kez çarptı.)*
⚠️ Ters yönü de var ve bu belgede yaşandı: *yasağı anlatan cümle, yasağın kendisi
sayılabilir* (§ Dolaylılık'ın ters yönü).
