# Ölçüm disiplini — BAŞLIK DİZİNİ

Ölçüm disiplini dosyalarının **her başlığı** burada, tek tabloda. Tek soruyu `grep`siz
cevaplar: ***bu bulgu zaten hangi başlığın altında?***

> **Neden var:** katalog 2026-09-13'te tek günde +16 sınıf aldı ve dokuz dosyaya
> bölünmeye başladı. Bölünmenin bedeli: *bir sınıfın zaten yazılı olup olmadığı* artık tek
> dosyada okunamıyor, her yeni bulguda dosyaların tamamı `grep`leniyor — ve `grep`
> **cümleyi değil deseni** bulur; aynı sınıf başka kelimelerle yazılmışsa görünmez.
> Mükerrer sınıf, kataloğun kendi arıza biçimidir.

**Nasıl kullanılır:** yeni bir ölçüm arızası yaşadığında önce bu tabloyu BAŞTAN SONA
oku. Yakın bir başlık varsa bulgu oraya **kardeş cümle** olarak iner; yoksa yeni
başlık açılır ve **aynı commit'te** buraya satır eklenir.

⚠️ **Her satır bir ÇAPADIR, süs değil.** Başlık hücresi `§ <başlık>`, dosya hücresi
backtickli dosya adıdır; bu çifti `test_belge_capa_atfi` **iki yönden** ölçer —
(a) dizindeki bir başlık hedef dosyada YOKSA kırmızı (yeniden adlandırılmış ya da
silinmiş başlık), (b) dosyalardaki bir başlık dizinde YOKSA kırmızı (dizin eksik
kalamaz). ⇒ **Dizin bayatlayamaz; bayatlatmayı deneyen commit durur.** İlk dolum
bir kereye mahsus üretildi (2026-09-13); bundan sonrasını üreteç değil KAPI tutar —
üretece bağlı bir dizin, üreteç koşulmadığı gün sessizce bayatlardı.

Sayı bir ölçümdür ve bu satır da kapı altındadır: **148 başlık / 11 dosya**
(ölçüldü 2026-09-13; kapı her koşumda yeniden sayar ve sayı tutmazsa kırmızı verir).

⚙️ **MÜKERRER TARAMASI (dizinin ilk kullanımı, 2026-09-14):** 147 başlık çiftlenip
sözcük örtüşmesi (Jaccard ≥ 0,28) ölçüldü → **9 aday, mükerrer YOK**; dokuzun altısı
*"→ ayrı dosya"* işaretçi başlığı, üçü bilerek koşut sınıf (`Sayı yazma` ↔ `Çapa yazma`,
⑦ ↔ ⑧ — metinleri birbirine zaten atıf yapıyor). Bulunan tek gerçek boşluk **eksik
KARDEŞ BAĞI**ydı, mükerrer değil: teşhis üçlüsü (yüklem · kip · kurala dönüşme) birbirine
işaret etmiyordu; aynı commit'te bağlandı.
⚠️ **Bu taramanın SINIRI beyan edilir:** sözcük örtüşmesi yalnız AYNI KELİMELERLE yazılmış
iki başlığı görür — *aynı sınıfı BAŞKA kelimelerle yazan* iki başlığı **göremez**, ki bu
dizinin var oluş sebebi tam olarak odur. ⇒ Tarama, okumanın yerine geçmez; **yeni sınıf
açan kişi tabloyu yine baştan sona okur.**

| # | başlık | dosya |
|---|---|---|
|  | § Kurtarıcı kurallar — birbirinin tersi, ikisi de üç saniye | (`OLCUM-DISIPLINI.md`) |
|  | § Arıza sınıfları → ayrı dosya | (`OLCUM-DISIPLINI.md`) |
|  | § Teşhis mesajı da bir yüklemdir | (`OLCUM-DISIPLINI.md`) |
|  | § Doğru çıkması yöntemi doğrulamaz | (`OLCUM-DISIPLINI.md`) |
|  | § Aynı numara, farklı şey — yerel kopya ≠ uzak gerçek | (`OLCUM-DISIPLINI.md`) |
|  | § Asenkron eylemde tek ölçüm yetmez | (`OLCUM-DISIPLINI.md`) |
|  | § Atıfta eşik düşmesi | (`OLCUM-DISIPLINI.md`) |
|  | § Yapısal sonda — "gerekçesi ölçülmedi"nin çıkış yolu | (`OLCUM-DISIPLINI.md`) |
|  | § Ölçümü YAZMA — sayı · çapa · kimlik → ayrı dosya | (`OLCUM-DISIPLINI.md`) |
|  | § Sayı yazma | (`OLCUM-DISIPLINI-YAZIM.md`) |
|  | § Çapa yazma | (`OLCUM-DISIPLINI-YAZIM.md`) |
|  | § Kimlik yazma — repo PUBLIC | (`OLCUM-DISIPLINI-YAZIM.md`) |
|  | § Teşhis mi, ölçüm mü — kurala çevirmeden önce | (`OLCUM-DISIPLINI.md`) |
|  | § Hangi hipotez ölçülür | (`OLCUM-DISIPLINI.md`) |
|  | § Bir turda ne taşınır | (`OLCUM-DISIPLINI.md`) |
|  | § Bayatlamanın SEKİZ biçimi | (`OLCUM-DISIPLINI.md`) |
| 1 | § Araç bozuk | (`OLCUM-DISIPLINI-ARAC.md`) |
| 4 | § Araç ölçümün içinde | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Yüklem (ne sorduğun) sınıfları → ayrı dosya | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Aracın VARSAYILANI ≠ olgunun özelliği — iki biçim | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § "Ölçemiyoruz" ile "ölçmek için aracı KURMADIK" aynı cümle değildir | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Bir NEGATİF bulgu, ikinci yönü ölçülmeden RAPOR EDİLMEZ | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Bir ÇAPA doküman linki olmayabilir — kod da bir dosyayı okur | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Bir düzeltmenin sonucu, DÜZELTİLEN KÜMEYE bakarak ölçülemez | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Araç VAR ile araç UYUMLU ayrı iki şeydir | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Bir LİSTE tek başına ölçüm aracı değildir — ELEME adımı onun yarısıdır | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Boş çıktı bir ÖLÇÜM değildir — iki dünya aynı boşluğu üretir | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Ağacı `git` üzerinden okuyan araç, kümesini İNDEKSTEN alır — yazdığın dosya orada olmayabilir | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Bir tarayıcı, kendi TARİF ETTİĞİ şeyin ÖRNEĞİNİ gerçek sanır | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Mutasyonun ürettiği sayı, MUTASYONDAN gelmiş olabilir | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Komutun SÜRECİ ve ORTAMI → ayrı dosya | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Kapı, kendi AYRIŞTIRICISININ darlığını SAYIYA çevirebilir — ve sayı CIRCIRA girer | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Anahtarla kurulan bir BEYAN TABLOSU, mükerreri SESSİZCE yutar | (`OLCUM-DISIPLINI-ARAC.md`) |
|  | § Dolaylılık — desen tabanlı ölçümün varsayılan kör noktası | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Çelişki yüklemi ≠ farklılık yüklemi | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Sezgisel eşleme, ölçümün KENDİSİNİ yakalayabilir | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Aracı değiştirmek kapsamı genişletmez — YÜKLEMİ genişletmek genişletir | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Tarama, aradığı şeyin YAZILIŞ BİÇİMİNİ değil KENDİSİNİ sormalı | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Bir YOKLUK iddiası, arandığı DESENLE yazılır | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Sınırsız eşleşme — sınırını BEYAN ETMEYEN yüklem alakasızı içeri alır | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Bir yüklem, aradığı şeyin BOZULMUŞ hâlini aramaz — bozulma ADAYI yok eder | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Bir POPÜLASYONU saymadan önce ÜYELİĞİNİ sına | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Sayma BİRİMİ, iddianın birimiyle aynı olmalı — yoksa cırcır yanlış pozitif üretir | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Yüklemi GEVŞEK bir cırcır, DOĞRU kodu da ihlal sayar — kapı düzeltmeyi CEZALANDIRIR | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Bir "HEPSİ" iddiası, kümeyi üreten yüklem kadar doğrudur | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § NE sorduğun kadar NEREYE sorduğun — yetenek ORTAK LIB'e çıkınca dosya bazlı envanter körleşir | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Bir adın geçmesi bir BAĞIMLILIK değildir | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § Üyelik yalnız HANGİ DOSYALAR değil, HANGİ KOŞULLARDA sorusunu da taşır | (`OLCUM-DISIPLINI-YUKLEM.md`) |
|  | § (c) Kurbanı bekçinin KENDİ fikstürü — alt dizgi | (`OLCUM-DISIPLINI-SINIRSIZ.md`) |
|  | § (d) KESİŞİMLE tanımlanan kapsam, YOKLUĞU göremez | (`OLCUM-DISIPLINI-SINIRSIZ.md`) |
|  | § (e) KISA + SAYISAL + KALABALIK KORPUS — çakışma bir ÇARPIMDIR | (`OLCUM-DISIPLINI-SINIRSIZ.md`) |
|  | § (f) BİRLEŞTİRME, hiçbir kolonda var olmayan bir KOMŞULUK uydurur | (`OLCUM-DISIPLINI-SINIRSIZ.md`) |
|  | § KABUK ailesi — "komut çalıştı" ile "ölçüm okundu" ayrı şeylerdir | (`OLCUM-DISIPLINI-SUREC.md`) |
|  | § ASILI KALMAK, çalışmanın DELİLİ değildir — stdin bekleyen komut "yavaş" görünür | (`OLCUM-DISIPLINI-SUREC.md`) |
|  | § KANCA ailesi — kendi repo'sunu kuran araç, KANCANIN git ortamını MİRAS ALIR | (`OLCUM-DISIPLINI-SUREC.md`) |
|  | § Yıkıcı bir yolun DÜZELTMESİ, önce KURBAN EDİLEBİLİR bir hedefte sınanır | (`OLCUM-DISIPLINI-SUREC.md`) |
|  | § Katalog iki katmanlıdır | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § KATMAN 1 · Arıza sınıfları — ölçümün kendisi | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 2 | § Soru yanlış | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 3 | § Kural cümlesi yanlış | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 5 | § Kontrol grubu kirli | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 6 | § Ölçüt doğru ama dar | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 7 | § Geçmiş zamanlı beyan, karşılıksız | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 8 | § Ölçülen değişken SABİT | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
| 9 | § Geç ölçüm — anlık ölçümle pencere iddiası | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Çöken sonda, sonda değildir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Zıt iki cevap = ortam farkı | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Ölçümün KURULUM adımı da ölçülen sistemin içindedir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Paylaşılan ağaç ve çok-oturum sınıfları → ayrı dosya | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Pozitif kontrolün KENDİSİ bir müdahaledir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § "Bende yok" bir ölçüm değildir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Zengin kontrol grubu — yeşil, ölçümün değil ORTAMIN özelliği | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § "Bu benim değil" bir ÖLÇÜM olmalı, bir çıkarım değil | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Dolu bir kolon, adının sorduğu soruyu cevaplamıyor olabilir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Bir kapının "neden kırmızı" cevabı, kapının ÇALIŞTIĞINI varsayar | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § İki rejimli bekçi — tam kapsam tek koşumda ölçülemez | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Bir işin "başarıyla bitti"si, SARMALAYICININ çıkış kodudur | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Fikstürünü kendi kuran bekçi, KURDUĞUNU da ölçmek zorundadır | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Bir ortamı TARİF etmek, onu ARAMAK değildir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Bir örneklem yanlılığının VARLIĞINI bilmek, YÖNÜNÜ bilmek değildir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Bir kümeyi YAZARININ İZİNDEN bölersen, ölçtüğün şey yazardır | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Aynı KÖR NOKTAYI paylaşan iki ölçüm birbirini DOĞRULAMAZ | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Aynı kusuru İKİ dosyadan ölçebiliyorsan BOŞ olanı seçmek bir ÖLÇÜM KARARIDIR | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § SONDA ailesi — sondanın SESSİZLİĞİ hiçbir tarafın lehine delil değildir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Bir sondanın DÜNKÜ sonucu, bugünkü koda dair bir iddia değildir | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Tutmayan bir sonda İKİ şeyden birini söyler: kurgu yanlış YA DA kapı KÖR | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § KATMAN 2 · Ölçümden sonraki adım → ayrı dosya | (`OLCUM-DISIPLINI-SINIFLAR.md`) |
|  | § Paylaşılan `node_modules` üstünde worktree, izolasyon değil TAKLİTTİR | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § Adıyla stage'lemek YETMEZ — indeks paylaşılan DURUMDUR | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § Ortak ağaçta "BENİM commit'im" diye bir şey yoktur — "ŞU ANKİ REF" vardır | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § Başka oturumun AĞAÇ-BÜTÜNÜ komutu, sondanı ZAMANDA DONDURUR | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § Ortak ağaçta ölçülen sayı, BAŞKASININ commit'siz işini içerir — ve çoğu kez LEHİNE | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § `.git/index.lock` bir KUYRUK değil, bir REDDİR | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § Pencerenin BOŞ olduğunu ölçmek, DOĞRU AĞAÇTA olduğunu ölçmek değildir | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § INDEX'ten okuyan bir kapının sondası, ATILABİLİR bir indekse kurulur | (`OLCUM-DISIPLINI-ORTAK-AGAC.md`) |
|  | § KATMAN 2 · Ölçümden sonraki adım | (`OLCUM-DISIPLINI-CIKARIM.md`) |
| 10 | § Doğru gözlemden yanlış mekanizma çıkarmak | (`OLCUM-DISIPLINI-CIKARIM.md`) |
| 11 | § İki sayı yan yana durunca aynı birimde sanılır | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Damgayı, ÖLÇTÜĞÜN SİSTEMİN saat diliminde oku — kendi sezginde değil | (`OLCUM-DISIPLINI-CIKARIM.md`) |
| 12 | § Kapsamını yitirmiş ölçüm | (`OLCUM-DISIPLINI-CIKARIM.md`) |
| 13 | § "Arka durağı var" cümlesi de bir İDDİADIR | (`OLCUM-DISIPLINI-CIKARIM.md`) |
| 14 | § Kapıyı aşmanın üç yolu | (`OLCUM-DISIPLINI-CIKARIM.md`) |
| 15 | § Bir dizge ne bağlamını ne modelini taşır | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § "0 mı?" ile "0 KALACAK mı?" aynı ölçümle cevaplanmaz | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Aynı doktrin cümlesinin iki uygulama yeri, aynı arızayı taşımaz | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir bulguyu KÜÇÜLTEN ölçüm de bir ölçümdür — ve daha zorudur | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir kontrolün gördüğü sayı, arızanın BOYUTU değildir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Sessiz atlama bir DAYANIKLILIK değil, bir GÖRÜNMEZLİK özelliğidir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir temizlik eksikliğinin faturası, onu ÜRETEN bekçiye çıkmaz | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § "Atlanan" sayısı, koşmayan YÜKLEM sayısı değildir — ve bir ALT SINIRDIR | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Muafiyet yazmadan önce sor: muaf olan şey kuralın DIŞINDA mı, yoksa KURAL mı yanlış çizilmiş? | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir atlama, ölçülebilen KOMŞUSUNU da götürürse kapsam sessizce kaybolur | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir deneyin ÜÇ olası sonucunun anlamı, deney koşulmadan ÖNCE yazılır | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir dosyanın TOPLAMINDAKİ fark, bir SİTEYE ancak tek dal varsa atfedilir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir kusurun ADI, kusurun YERİ değildir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Beyan, kapsamın YERİNE GEÇMEZ | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir KAPANIŞ ÖLÇÜTÜ, ölçtüğü MEKANİZMANIN adını taşımalı — yoksa kendi kendini onaylatır | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Ad kalıbı bir ÖLÇÜT değildir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir borç, koşulu sağlandığı için değil ÖNCÜLÜ yanlış olduğu için de kapanabilir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Kapanma koşulunu yazan not, KOŞULUN SAĞLANDIĞINI da aynı nota yazmalıdır | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Kapsamını yazmayan borç, okuyanı YANLIŞ YERE gönderir | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Devralınan kusur beklentisi, kusur kapandıktan sonra KÖRLÜK TALİMATINA döner | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Kesiklik, YANLIŞ bir iddiayı OKUNAMAZ kılarak KORUR | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bayat KURAL, doğru uygulama — kod, belgedeki cümleye sadık kalarak bozulur | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § İki operasyonel kural | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Bir kısıtın VARLIĞI, onu okuyan kodun o ihlalde ÇÖKECEĞİ anlamına gelmez | (`OLCUM-DISIPLINI-CIKARIM.md`) |
|  | § Mandal (tavan) yazma | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § "Kapalıdır" diyen cümle kapıyı adıyla taşır | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Kapının ÖLÜMÜ ve KIRMIZININ sınıflandırılması → ayrı dosya | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Ölçüm bir KARARI değiştirebiliyor mu | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Tavanın beyan edilmemiş ikinci işlevi | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Cırcıra İKİ sonda gerekir — negatif sonda yetmez | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Commit kapısı BEKÇİLERİ koşmaz | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Cırcır tabanı YALNIZ `git show HEAD:` içeriğinden ölçülür | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Sistemin ÜRETMEDİĞİ durumu ölçmenin iki aleti | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Bir mandalın TANECİĞİ, neyi ve NE ZAMAN ısırabileceğini belirler | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Bir bekçinin KENDİ yeşili, KAPIDAN geçeceğini söylemez — "koştu" ≠ "derlendi" | (`OLCUM-DISIPLINI-KAPI.md`) |
|  | § Kapının ölüm biçimleri | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § ⑦ Kapı, koruduğu şeyle ilgisiz bir sebeple sessizce ölebilir | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § Yerel yeşil, BAŞKASININ commit edilmemiş düzeltmesi olabilir | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § Kapsam: yalnız bekçi değil, AĞACI OKUYAN HER ARAÇ | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § En ağır biçimi: KANCAYA yapılan commit'siz değişiklik | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § Kırmızıyı sınıflandırma | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § ⑧ Uzaktaki kapı, ürünle ilgisiz bir sebeple HİÇ açılmayabilir | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § Bir kapının yeşili, ÖLÇTÜĞÜ İKİ UÇLA sınırlıdır | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § Bir kapının TETİĞİ bir OLAYI ölçer; TANISI bir ANLAM iddia eder | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § Bir kırmızının MESAJI, hangi kontrolün kırmızı olduğunu söylemez | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |
|  | § …ve etiketi SÜZGEÇ de yiyebilir — damga süzgecinin deseni metnin içinde de geçer | (`OLCUM-DISIPLINI-KAPI-OLUMU.md`) |

## Dosya → ne zaman oraya bakılır

| dosya | kapsam |
|---|---|
| [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md) | YÖNTEM — ölçüm nasıl yapılır, nasıl OKUNUR (13 başlık) |
| [`OLCUM-DISIPLINI-YAZIM.md`](OLCUM-DISIPLINI-YAZIM.md) | ölçümü YAZMA: sayı · çapa · kimlik (3 başlık) |
| [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) | KATMAN 1a — ölçümün ARACI (17 başlık) |
| [`OLCUM-DISIPLINI-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md) | KATMAN 1a′ — YÜKLEM (ne sorduğun) (15 başlık) |
| [`OLCUM-DISIPLINI-SINIRSIZ.md`](OLCUM-DISIPLINI-SINIRSIZ.md) | YÜKLEM'in § Sınırsız eşleşme VAKA envanteri (4 başlık) |
| [`OLCUM-DISIPLINI-SUREC.md`](OLCUM-DISIPLINI-SUREC.md) | komutun SÜRECİ ve ORTAMI (4 başlık) |
| [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) | KATMAN 1b — ölçümün KURGUSU (31 başlık) |
| [`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md) | KATMAN 1c — PAYLAŞILAN AĞAÇ, ÇOK OTURUM (8 başlık) |
| [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) | KATMAN 2 — ölçümden sonraki adım (31 başlık) |
| [`OLCUM-DISIPLINI-KAPI.md`](OLCUM-DISIPLINI-KAPI.md) | ölçümü KAPIYA çevirmek (11 başlık) |
| [`OLCUM-DISIPLINI-KAPI-OLUMU.md`](OLCUM-DISIPLINI-KAPI-OLUMU.md) | kapının ÖLÜMÜ, kırmızının okunması (11 başlık) |

