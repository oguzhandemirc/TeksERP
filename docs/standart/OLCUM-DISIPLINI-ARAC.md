# Ölçüm arıza sınıfları · KATMAN 1a — ölçümün ARACI

[`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'in ölçüm ALETİNE ait yarısı; 2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 1,6 KB kalmıştı ve aktif yazılıyordu; tavan yükseltilmedi).

**Çizgi:** buradaki sınıflarda kusur **aletin kendisindedir** — desen, komut, ayrıştırıcı, aracın varsayılanı, aracın kapsamı. Ölçümün **KURGUSUNA** ait sınıflar (soru, kontrol grubu, deneyin kurulumu) `OLCUM-DISIPLINI-SINIFLAR.md`'de; **paylaşılan ORTAMA** ait olanlar [`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md)'de; **KATMAN 2** (sayı doğru; ondan çıkarılan ne) [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de; yöntem ve kapı ölümleri [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de.

⚠️ **Numaralar KORUNDU** — §1 ve §4 burada, ötekiler orada; dizide boşluk vardır ve bu bilinçlidir. **Bir sınıf ADIYLA anılır**, numara yalnız listenin sırasıdır.

---

### 1 · Araç bozuk
Çıktı boş ya da anlamsız gelir; fark edilir, en ucuz sınıf.
**Savunma:** çıktıyı okumadan sonuç yazma.

### Aracın DOĞRU cevap verdiği koşum, onu DOĞRULAMAZ — yanlış demesi gereken yerde sına
Bir ölçüm aracını *"çalıştı"* diye kabul etmek, onu yalnız **doğru cevabı zaten bildiğin**
bir koşumda görmektir. Araç o koşumda doğruyu söylerken **başka bir soruyu** cevaplıyor
olabilir; ayrımı ancak **yanlış demesi GEREKEN** bir girdi gösterir.

*(Vaka 2026-09-14, kusur 5e'de: *"bir commit indi mi"* sorusuna
`git merge-base --is-ancestor <sha> origin/main` aracı seçildi ve **doğru** çalıştı —
çünkü elimdeki sha, entegratörün gönderdiği CHERRY-PICK sha'sıydı. Aracı kendi orijinal
sha'mla hiç denemedim. Denenince: orijinal ✗ "inmemiş", cherry-pick'i ✓ "inmiş" —
**aynı içerik, iki cevap.** Araç bozuk değildi; SORUSU başkaydı: *"bu sha ata mı"* ≠
*"bu içerik indi mi"*.)*

> **Negatif sonda yalnız KAPIYA değil, ÖLÇÜM ARACINA da uygulanır:** aracı, cevabın
> **HAYIR olması gereken** bir girdiyle koş. Hayır demiyorsa ölçtüğün şey senin sandığın
> şey değildir.
📌 Ucuz biçim: her araç seçiminde iki girdi hazırla — biri olumlu, biri **olumsuz kontrol**.
Olumsuz kontrol yoksa, aracın kapsamını değil yalnız o günkü şansını ölçmüş olursun.
Kardeşleri § 1 · Araç bozuk · § Bir tarayıcı, kendi TARİF ETTİĞİ şeyin ÖRNEĞİNİ gerçek
sanır · § Boş çıktı bir ÖLÇÜM değildir.

### 4 · Araç ölçümün içinde
`ps | grep` kendini sayar; sonda, ölçtüğü sinyalin taşıyıcısını kirletir.
**Savunma:** `pgrep -f` ya da `grep -v grep`. Sonda argümanı, ölçülen sinyalin
taşıyıcısıyla **aynı kanaldan geçmemeli**.

**Kardeş biçim — BEKLENTİ ile ÖLÇÜLEN aynı kaynaktan geliyorsa iddia totolojidir.**
Bir bekçi *"üretilen kod `FSN` ile başlamalı"* diyorsa ve beklenen ön eki de
üretilen kodu da **aynı tablodan** okuyorsa, o tabloyu değiştiren her mutasyon
bekçiyi **yeşil bırakır**: ölçülen şey "kod doğru mu" değil, "iki okuma birbirine
eşit mi"dir.
*(Vaka 2026-09-22: `test_subcontractor_code_autogen` beklentiyi
`seriesCodePrefix("subcontractor")`tan alıyordu; katalogdaki ön ek `FSN`→`XYZ`
yapılınca bekçi **12/12 yeşil** kaldı.)*
⚠️ **Çare her zaman "bekçiyi düzeltmek" değildir.** O vakada ön ek değişince kodun
da değişmesi **doğru davranıştı** — yani bekçi yanlış şeyi ölçmüyordu, İDDİASI
ölçtüğünden büyüktü. Üç adım: ① iddiayı ölçtüğü kadar daralt · ② ölçülmeyen ekseni
**beyan et** ve onu gerçekten ölçen bekçiyi adıyla göster (burada
`test_number_series §1`, ölçüldü: aynı mutasyonda ❌2) · ③ mümkünse o eksenden
**bağımsız** bir iddia ekle (burada eski rejimin imzası: iki tire + rastgele
kuyruk — ön ekten bağımsız, ve ısırdı).

### Yüklem (ne sorduğun) sınıfları → ayrı dosya
Aletin **çalışması** ile aletin **ne sorduğu** ayrı iki kusur ailesidir. İkincisi —
desenin kapsamı, eşleşmenin sınırı, popülasyonun üyeliği, gevşek ya da dar yüklem —
[`OLCUM-DISIPLINI-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md)'de.


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

⭐ **Ve elemenin kendisi listede DURMALIDIR:**
> **Eksik bir listeyi "unutulmuş" sanmak, yanlış bir listeden daha kolaydır.**
> Bilerek dışarıda bırakılan üyeler **gerekçesiyle listede durur** — yoksa sonraki kişi
> onları "eksik" sanıp ekler ve elemeyi bozar.

*(Emsal: `TR_KAPSAM_DISI_GEREKCELI` — 2–3 harfli çakışan kökler dışarıda tutulduklarını
ADIYLA ve GEREKÇESİYLE söyleyen bir küme olarak duruyor.)* Bu, *"reddedilen bir şıkkın
gerekçesi yazılmazsa altı ay sonra yeniden önerilir"* kuralının **veri dosyası** yüzüdür.

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
> ⚠️ Ama `git ls-files`in kendi sınırı var ve aşağıdaki başlık onu anlatıyor: **izlenmeyen
> dosya o komut için YOKTUR.**

⚠️ **Ayrı ve hâlâ geçerli bir vaka — aynı üst sınıftan:** bir kapı yanlış dizinden
koşturulup `MODULE_NOT_FOUND` verdi ve az kalsın *"kapı bozuk"* denecekti. Monorepo'da
`cwd` gerçekten önemlidir; ama 01'in vakasında **sebep o değildi**. Ve evde zaten yazılı
olan satırın ihlali: **`>/dev/null` gerekçeyi yutar.**

### Ağacı `git` üzerinden okuyan araç, kümesini İNDEKSTEN alır — yazdığın dosya orada olmayabilir
`git ls-files` **çalışma dizinini değil İNDEKSİ** listeler. Yeni yazılmış ama `git add`
edilmemiş bir dosya ağaçta DURUR, o komut için **YOKTUR** — ve fark sessizdir, çünkü
eksik üye bir hata değil bir **boşluk** üretir; boşluk da çoğu yüklemde yeşildir.

*(Vaka 2026-09-14: `test_belge_capa_atfi` hedef kümesini `git ls-files "*.md"` ile kuruyor.
Yeni yazılan `OLCUM-DISIPLINI-DIZIN.md` izlenmiyordu ⇒ kapı **"dizin: YOK"** dedi, dosya
gözümün önünde dururken. `git add` sonrası aynı koşumda 141 satır belirdi. Kapı doğruydu,
EVRENİ eksikti.)*

⚠️ **Ve bu sınıf YALNIZ BOŞ kümeyle sessiz olmaz — küme dolu ama EKSİK olabilir.**
*(İkinci vaka, d9 2026-09-14: aynı sınıf, ama tasarım anında yakalandı — bir bekçinin
hedef kümesi `git ls-files src scripts` ile kuruluyordu ve negatif sonda dosyası
izlenmediği için sonda ISIRMADI; kapıyı değil SONDANIN SESSİZLİĞİ ele verdi. O koşumda
1.168 dosya taranıyordu: "kapsam boş" alarmı ÇALMAZDI, yalnız yeni dosya eksikti.
Çare `--cached --others --exclude-standard`.)*
⇒ **Körlük zemini (`kapsam > 0`) bu sınıfı YAPISAL OLARAK göremez** — eksiklik sayıyı
sıfıra indirmez, bir azaltır.

> **Bir aracın EVRENİ de bir yüklemdir:** `git ls-files` (indeks) · `find`/`readdir`
> (çalışma ağacı, `.gitignore`'u görmez) · `git show HEAD:` (son commit) · `git diff --cached`
> (sahne) **dört FARKLI kümedir** ve aynı soruya farklı cevap verirler.
📌 Panzehir: *"bu araç hangi evreni okuyor ve bu commit'in içeriği o evrende mi?"* — yeni
dosya yazdıysan ölçümden ÖNCE `git add`, ya da evreni bilerek çalışma ağacına çevir.
⚠️ Ve tersi de tuzaktır: cırcır tabanını çalışma ağacından okumak, eş oturumun commit
etmediği işini kendi sayına katar — bkz. `OLCUM-DISIPLINI-ORTAK-AGAC.md` § Ortak ağaçta
ölçülen sayı, BAŞKASININ commit'siz işini içerir.

### Bir tarayıcı, kendi TARİF ETTİĞİ şeyin ÖRNEĞİNİ gerçek sanır
Biçim tarif eden belgeler (`README`, şablon, başlık örneği) tarayıcının kapsamı
dışında bırakılır — ve bu **bir muafiyet değil, TANIM GEREĞİDİR**: orada duran şey bir
kural değil, **kuralın resmidir**. *(5e teşhis · d5 formülasyon)*
*(Vaka 2026-09-13: kimlik tekilliği kapısı üç çakışma bildirdi; üçüncüsü
`docs/standart/README.md`'deki `- **[BE-07]** <emir kipi…>` biçim örneğiydi. Aynı sınıf
aynı gece bir başka oturuma dört kez çarptı.)*
⚠️ Ters yönü de var ve bu belgede yaşandı: *yasağı anlatan cümle, yasağın kendisi
sayılabilir* (§ Dolaylılık'ın ters yönü).

### Mutasyonun ürettiği sayı, MUTASYONDAN gelmiş olabilir
Bir sondanın ürettiği sayıyı bulgu saymadan önce, o sayının **mutasyonun KENDİSİNDEN**
gelip gelmediğini ölç. Sonda aracı ölçtüğü şeyin içine karıştığında ürettiği sayı bir
ölçüm DEĞİLDİR.
*(Vaka `5ac6e830`, 2026-09-13: bir sentinel değer (`"bicimsiz"`) truthy bir string
olduğu için eleme koşulundan geçti ve döngü onun **8 KARAKTERİNİ** gezdi — 8 × 27 = 216
sahte kırmızı. Sayı bir bulgu sanıldı ve onunla başka bir oturumun DOĞRU teşhisi
"düzeltildi". Sentinel adıyla elenince aynı mutasyonda sonuç **0 · 0**.)*
> **`!x` bir sentinel'i ELEMEZ** — sentinel ekleyen, her TÜKETİCİYİ adıyla eler.
Kardeşi § 4 · Araç ölçümün içinde.

### Komutun SÜRECİ ve ORTAMI → ayrı dosya
Aletin **ne yaptığı** ile aleti çalıştıran **sürecin/ortamın** ne yaptığı ayrı iki kusur
ailesidir. İkincisi — kabuk, asılı kalan süreç, kancanın miras verdiği git ortamı, yıkıcı
yolun sondası — [`OLCUM-DISIPLINI-SUREC.md`](OLCUM-DISIPLINI-SUREC.md)'de.


### Kapı, kendi AYRIŞTIRICISININ darlığını SAYIYA çevirebilir — ve sayı CIRCIRA girer
Bir kapı alanı okurken kullandığı sınır, alanın gerçek sınırı olmayabilir. O zaman kapı
**ağaçtaki kusuru değil, KENDİ OKUMASINI** sayar — ve o sayı bir cırcır tabanına
yazıldıysa kusur kozmetik olmaktan çıkar: **taban şişer, kapı GEVŞER.**

*(Vaka 2026-09-13, ölçüldü: kesik `bekçi:` alanı kapısının ayrıştırıcısı
`` bekçi: `[^`]*` `` — ilk kapanış backtick'inde durur. Alanın İÇİNDE backtick olan dört
satırda kapı alanın yarısını okudu ve "parantez dengesiz ⇒ kesik" dedi. Gerçek alanlar
tamdı: 45→70 · 9→64 · 36→70 · 97→169 karakter. 59'un 4'ü ağaçta yoktu.)*

⚠️ **Yönü de ölçüldü:** sahte kesikler tabanı 4 birim YUKARIDA tutuyordu, yani cırcır
gerçek dört yeni kesiği sessizce yutabilirdi. **Aracın hatası simetrik değildir** — bir
yönde gürültü, diğer yönde KORUMA KAYBI.

> **Ayrıştırıcının SINIRI, ölçülen şeyin sınırıyla aynı mı?** Alanın ayracı, alanın
> içinde de geçebilen bir karakterse cevap HAYIRDIR.

**Savunma:** aracın okuduğu değeri, aynı satırdan **bağımsız ikinci bir sınırla** (burada
`· bekçi: ` ile ` <sub>` arası) yeniden çıkar ve iki okumayı karşılaştır; fark **kusurun
değil ARACIN** ölçüsüdür. Kalıcı çare ayracı içerikte geçemeyecek biçimde seçmek ya da
alandan ayracı yasaklamaktır.

⚠️ **Aynı mekanizma bu turda İKİ ayrı alanda çıktı** (`Kapanır:` ve `bekçi:`) — yani
bulgu bir satırın değil, **alan biçiminin** özelliğidir: backtick'le sınırlanan her
serbest-metin alanı bu sınıftadır.
Kardeşleri § Bir tarayıcı, kendi TARİF ETTİĞİ şeyin ÖRNEĞİNİ gerçek sanır ·
§ Bir yüklem, aradığı şeyin BOZULMUŞ hâlini aramaz.

### Anahtarla kurulan bir BEYAN TABLOSU, mükerreri SESSİZCE yutar
`new Map(anahtar → satır)` ile kurulan her envanter/beyan tablosu aynı anahtarın ikinci
girdisini **hata vermeden ezer**. Kapı tabloyu okur, tek satır görür, **yeşil kalır** —
oysa kaynakta iki beyan vardır ve biri hiç ölçülmemiştir.

*(Vaka 2026-09-13, 01 ölçtü: `defter-beyan.ts`'de aynı model İKİ KEZ beyan edildi — bayat
tabanda kırmızı olan bir bölüm için yazıldı, ama `main`de başka bir oturum zaten
yazmıştı; üç yollu birleştirme ikisini de aldı. `test_defter_ters_yol` 165/0 YEŞİL
döndü. `beyanMap` mükerreri sessizce çökertiyordu; "beyan tablosunda model TEKİLDİR"
diye bir sonda yoktu.)*

> **Bir tablo anahtarla kuruluyorsa, o anahtarın TEKİLLİĞİ ayrı bir iddiadır** — ve
> ölçülmedikçe kurulmamıştır. Tablo büyüdükçe iddia daha da görünmez olur.

⚠️ **Ortak ağaç bu sınıfın DOĞUM YOLUDUR:** mükerreri üreten şey yazarın dikkatsizliği
değil, iki oturumun aynı satırı birbirinden habersiz yazması ve birleştirmenin ikisini de
kabul etmesidir (`OLCUM-DISIPLINI-ORTAK-AGAC.md`).

**Savunma:** tabloyu kuran yerde `size` ile ham satır sayısını karşılaştır (`Map.size <
satır sayısı ⇒ mükerrer`) ve farkı **kırmızı** yap. Emsal: kural kimliği tekilliği
`scripts/check-docs.mjs`te tam bu yüzden ayrı bir kapıdır — `- **[ID]**` satırları da bir
beyan tablosudur ve mükerrer ID sessizdi.
