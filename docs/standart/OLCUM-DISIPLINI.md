# Ölçüm disiplini

Bu belge **ölçüm aracının kendisi** hakkındadır — `grep`, `psql -c`, tek kullanımlık
script, `ps`, `git log` sorgusu. Yazdığımız kodun geçtiği kapılardan hiçbiri onları
denetlemez.

> **Kod bir kapıdan geçer, ölçüm aracı geçmez.** Her satır kod tip kontrolünden,
> lint'ten, bekçiden, negatif sondadan ve commit kapısından geçer. Ölçüm için
> yazılan tek kullanımlık `grep` hiçbirinden geçmez — gözden geçirilmemiş,
> sondasız. Sonra çıktısına koddan **daha çok** güvenilir, çünkü "ölçtüm" denir.
>
> Ölçüldü (2026-09-12, altı oturumlu tur): **on ölçüm aracı arızası, iki gerçek
> kod gerilemesi.** Altı oturumun hiçbiri bu sınıftan muaf çıkmadı.

Buradaki kurallar **mekanik değildir ve mekanikleştirilemez** — tek kullanımlık bir
`grep`e kapı yazılmaz. Tek savunma cümlenin kendisidir:

> **Her ölçümü raporlarken NEYİ ölçtüğünü ve NASIL doğruladığını yaz.**

## Kurtarıcı kurallar — birbirinin tersi, ikisi de üç saniye

```
sıfır dönen ölçüm      → POZİTİF KONTROL ile doğrula   (desen TUTMUYOR olabilir)
sıfırdan farklı dönen  → ÖRNEKLE doğrula               (desen FAZLA yakalıyor olabilir)
```

- **Pozitif kontrol:** desen sıfır dönüyorsa **kısalt ve tekrar koş**. Hâlâ sıfırsa
  sonuç gerçektir; sayı çıkarsa deseni sen yanlış yazmışsındır.
- **Örnekle doğrulama:** desen sayı döndürüyorsa **hangileri** olduğuna bak. Sayı
  doğru, kapsam yanlış olabilir.

Ortak hâli: **sayıya değil örneğe bak.**

Ve en ucuzu: **bir iddiayı sınamanın en ucuz yolu, iddianın verdiği ÖRNEĞİ ağaçta
aramaktır.**

## Arıza sınıfları

### 1 · Araç bozuk
Çıktı boş ya da anlamsız gelir; fark edilir, en ucuz sınıf.
**Savunma:** çıktıyı okumadan sonuç yazma.

### 2 · Soru yanlış
Araç çalışır, cevap **ayırt edici değildir** — aynı çıktıyı iki farklı dünya da
üretirdi.
**Savunma:** *"bu kanıt, alternatif dünyada FARKLI olur muydu?"* Cevap hayırsa
kanıt değildir.

### 3 · Kural cümlesi yanlış
Araç ve soru doğru, **dünya modeli** yanlış. İki ölçüm doğrudur, aralarındaki
çıkarım ölçüsüzdür.
**Savunma:** arızayı **izole ortamda yeniden üret**. Üretemiyorsan kuralın yanlış.

### 4 · Araç ölçümün içinde
`ps | grep` kendini sayar; sonda, ölçtüğü sinyalin taşıyıcısını kirletir.
**Savunma:** `pgrep -f` ya da `grep -v grep`. Sonda argümanı, ölçülen sinyalin
taşıyıcısıyla **aynı kanaldan geçmemeli**.

### 5 · Kontrol grubu kirli
"Öncesi"ni ölçerken ortam zaten "sonrası"dır.
**Savunma:** ortamın da "öncesi" olduğunu ayrıca ölç — ilgili tabloların boş
olduğunu saymak genellikle tek sorgudur.
**İkinci yüzeyi:** ortam **ölçüm sırasında** değişir. O zaman tek yol, **ölçüm
öncesi ve sonrası ucu karşılaştırmak**.
*Vaka: bir bekçi için "zaten kırmızıydı" hükmü, test edilen değişikliğin kendi
artığını taşıyan DB'de verildi. Temiz ayırt edici koşulunca hüküm değişti.*

### 6 · Ölçüt doğru ama dar
Bir davranışı ölçer, değişmezin tamamını değil. Sızıntı **iki koşum arasındaki
farkta** yaşar, tek koşumun içinde değil.
**Savunma:** ölçütün neyi DIŞARIDA bıraktığını yaz.

### 7 · Geçmiş zamanlı beyan, karşılıksız
"Yapıldı" yazar, ağaçta yapılmamıştır.
**Savunma:** **geçmiş zamanla yazılmış her "yapıldı" cümlesi ölçülmemiş bir
iddiadır** — yazmadan önce ağaçta ara.

### 8 · Ölçülen değişken SABİT
Araç çalışır, soru doğrudur, kontrol grubu temizdir — ama **kontrolün baktığı şey
iki değer alamaz**. Cevap her zaman aynıdır, yeşil kalır, kimse şüphelenmez.

> **Bir kontrolün anlamlı olması için, ölçtüğü şeyin İKİ DEĞER alabilmesi gerekir.**

Vaka: bir bekçiye *"varsayılan depo var mı"* kontrolü yazılmak üzereydi — ama
`main()`in ilk işi `ensureDefaultWarehouse()` çağırmaktı. Cevap her koşumda "var"
olurdu. Ölçülebilir sinyal **durum değil EYLEM**ti (`action=promoted/created`).

**Teşhis yöntemi — kuralın en kullanışlı yarısı:**
> **Negatif sondayı KURAMIYORSAN, kontrol bir sabiti ölçüyordur. Kuramamak zaten
> teşhistir.**

Yani sonda yalnız bekçiyi doğrulamaz, **kontrolün anlamlı olup olmadığını da
ortaya çıkarır.** Sondayı kuramadığın an düzeltilecek şey sonda değil kontroldür.

### 9 · Geç ölçüm — anlık ölçümle pencere iddiası
İddianın konusu bir **zaman aralığı**, ölçüm ise **şu an**. Sonuç doğru çıkabilir,
iddia yine de kurulmamıştır.
**Kurtarma:** ölçümü iddianın aralığını **kuşatacak** biçimde al — aralığın
başından bir damga (koşum başlangıcı, son commit zamanı) ile karşılaştır.
Kuşatamıyorsan iddiayı daralt: *"şu an temiz"* de, *"o sırada temizdi"* deme.
### Çöken sonda, sonda değildir
Negatif sonda kırmızı verdi diye geçerli değildir; kırmızının **ölçmek istediğin
KONTROLDEN** geldiği ayrıca doğrulanır.
**Ayırt edici:** FAIL **satır sayısı** ↔ özet **sayısı**. Uyuşmuyorsa fark bir
çökmedir. *(Vaka: özet "3 başarısız" dedi, ekranda 2 FAIL vardı; üçüncüsü bir
`.catch()`ten geliyordu — bölümün hiçbir kontrolü koşmamıştı.)*
**Kurtarma:** sondayı **sahte nesneyle kurma** — gerçek çağrıyı **gerçek ama
yanlış girdiyle** koştur. Sahte nesne kod yolunu değil, kod yolunun **kurulumunu**
kırar.

### Zıt iki cevap = ortam farkı
Aynı script, aynı ağaç, aynı saniye **zıt iki cevap** veriyorsa bu bir kapı hatası
değil bir **ortam farkıdır** — ve ortam farkı her zaman bulunabilir. Çelişkiyi
*"tuhaf"* diye geçmek, teşhisi kaçırmanın en yaygın yolu.
*(Vaka: aynı kapı elle YEŞİL, hook içinde KIRMIZI. Sebep: kısmi/pathspec commit'te
git geçici indeks kuruyor ve başkasının sahnelenmiş dosyası hook'a untracked
görünüyor.)*
**Kurtarma:** iki ortamın **farkını** ölç (env · cwd · indeks · kullanıcı), sonucu değil.

### Kaçışın asıl maliyeti
Bir kaçışın asıl maliyeti bir kuralı çiğnemek değil — **bir sorunun sorulmasını
engellemektir.** Kaçış varken teşhise ihtiyaç duyulmaz; çelişki **ilginç olmaktan
çıkar.** *(Vaka: aynı kırmızıya üç kez kaçışla yaklaşıldı, dördüncüde ölçümle —
kök sebep dördüncüde çıktı.)*

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

## Teşhis mesajı da bir yüklemdir

Bir bekçi iki şey söyler: **kırmızı mı** ve **neden kırmızı**. İkincisi de bir
yüklem taşır ve birincisinden ayrışabilir.

Vaka: bir bekçinin teşhis mesajı `isDefault + isActive` diyordu; ürün yalnız
`isDefault`e bakıyordu. Bekçi, ürün DOĞRU çalışırken **yanlış teşhis** yazdıracaktı
— kırmızı doğru, sebebi yanlış. Bu, hatayı arayan kişiyi var olmayan bir soruna
gönderir.

> **Aynı soruyu cevaplayan HER yüklem — kod yolu, sorgu ve TEŞHİS MESAJI —
> birlikte değişir.**

Üçüncüsü bugüne kadar yazılı değildi; ilk ikisi kök `CLAUDE.md` § Tek kaynak'ta
"boğaz-ikiz" olarak duruyor. O cümlenin genişletilmesi kullanıcının yetkisindedir;
burada bekçi yüzeyi için yazılıdır.

## Doğru çıkması yöntemi doğrulamaz
Sonuç doğru olduğu için yöntemi aklamak, başlı başına bir ölçüm hatasıdır.
Yöntem sonuçtan **ayrı** değerlendirilir: *"bu yöntem yanlış bir dünyada da aynı
cevabı verir miydi?"*
**Kurtarma:** hükmü verirken yöntemi de yaz; okuyan ikisini ayrı sınayabilsin.

## Aynı numara, farklı şey — yerel kopya ≠ uzak gerçek
`origin/main` **yerel bir kopyadır**; uzak başı `git ls-remote origin main` söyler.
İkisi çoğu zaman aynı numarayı gösterir ve bu, **farklı iki şeyi ölçtüklerini**
gizler.
**Kurtarma:** uzak hakkında iddia kuracaksan uzağa sor. Genel hâli: **bir vekil
üzerinden ölçtüğünde, vekilin ne zaman tazelendiğini de ölç.**

## Asenkron eylemde tek ölçüm yetmez

`port serbest ≠ süreç ölü` · `PID öldü ≠ dinleyen ölü` · `kill gitti ≠ süreç gitti`.
Üçü aynı kuralın görünümüdür: portun bırakılması, sürecin ölmesi, sinyalin
işlenmesi eylemden SONRA, belirsiz gecikmeyle olur. Hata "ölçmedim" değil, **"bir
kez ve çok erken ölçtüm"**.

> **Kapatınca ölç, tutmazsa bekle ve yeniden ölç, zaman aşımında sessizce geçme.**

## Atıfta eşik düşmesi

Başkasının belgesi, çıktısı ya da beyanı hakkında kurduğun her cümle bir
**iddiadır** ve ölçülmeden kurulmaz. Kendi ölçümüne uyguladığın eşiği, başkasının
işine atıf yaparken düşürmek en sık tekrarlayan hatadır.
**Kurtarma:** atıf yapmadan önce **kaynağı aç ve ara** — *bir iddiayı sınamanın en
ucuz yolu, iddianın verdiği örneği ağaçta aramaktır.*

## Yapısal sonda — "gerekçesi ölçülmedi"nin çıkış yolu

Bir sondanın gerekçesi bugün ölçülemiyorsa (`RECETELER.md` md. 20 ②), **"hayır"
demeden önce sor: bu kusurun YAPISAL bir izi var mı?**

> **Davranışsal sonda, ölçeceği davranış henüz yokken uyur. Yapısal sonda aynı
> kusuru BUGÜN silahlanarak yakalar — çünkü davranışı değil kodun ŞEKLİNİ ölçer.**

İş bölümü: yapısal sonda yanlış yüklemin **yazılmasını**, davranışsal sonda
**davranışını** yakalar. İlki bugün, ikincisi koşul doğduğu gün. "Gerekçesi
ölçülmedi" şerhi ancak **yapısal iz de yoksa** yazılır.

## Sayı yazma

**Sayı taşıyan her belge satırı bir bakım borcudur.** Bu belgede ve yazacağın her
belgede:

- **Damgalı ölçümün PAYDASI** ise kalır — payda olduğu açıkça yazılarak
  (*"2026-09-05 ölçümü: o günkü 455 dosya için 369 sn"*).
- **Tek başına bir durum beyanı** ise kalkar. Yerine ölçüm komutu yazılır.

Ayırt etme yöntemi: *cümleyi bugün okuyan biri ondan ne çıkarır — "o gün böyleydi"
mi, "bugün böyle" mi?*

> **Var olmayan bir sayı bayatlayamaz.**

## Kapının ölüm biçimleri

Ölçümü kapıya çevirirken hepsini birden gözet; hepsi kapıyı **kaldırmadan**
işlevsizleştirir. Bugüne kadar altı tanesi adlandırıldı — **numaralanmıyorlar**,
çünkü sıra iki oturumda çakıştı ve başlıktaki sayı zaten borçtur.

1. **Yanlış kırmızı** — doğru işte kırmızı verirse ilk hafta devre dışı bırakılır.
2. **Yavaşlık** — bedel değişenle orantılı olmaktan çıkarsa kaçış kullanılmaya
   başlanır.
3. **Gürültü** — çıktısı okunmayacak kadar uzunsa ikinci gün göz ardı edilir.
   **Doğru olması kurtarmaz.**

4. **Erken sertlik** — tavsiye olması gereken bir ölçüm kapıya çevrilirse kural
   tümden sökülür.
5. **Okunmayan tavsiye** — çıktısı kimsenin bakmadığı yere düşen tavsiye hiç yoktur.
6. **Doğru davranışı pahalı kılmak** — başka bir kurala uyanı cezalandıran kapı,
   o kuralın terk edilmesini öğretir. *(Vaka: ortak ağaç disiplini gereği pathspec
   ile commit atan kişiyi, kapının kendisi durduruyordu.)*

İlk üçünde kapı yanlış davranır; 3'te doğru davranır ve yine ölür; 6'da **kapı
doğru, kurban haklı** — en sinsisi budur.

## Kırmızıyı sınıflandırma

`gerçek kusur · testin kendi hatası · çevresel · yapısal olarak ölçülemez`

Dördüncüsü düzeltilecek bir şey değildir; "gerekçesi ölçülmüş atlama"nın karşılığıdır.
**Etiketi ölçmeden yapıştırma** — çevresel olan düzeltilebilir, yapısal olan yalnız
başka bir ortamda ölçülebilir; ikisini ayırmadan verilen hüküm ya gerçek bir kusuru
gizler ya çalışan bir kapıyı gevşetir.
