# Ölçüm arıza sınıfları — iki katmanlı katalog

[`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'nin sınıf kataloğu; 2026-09-13'te oradan **bölünerek** geldi. Gerekçe ölçüldü: katalog o gün tek turda **+16 sınıf** aldı (altı oturumun ölçüm turu) ve tek dosyada tavanı aşacaktı. Ayrım çizgisi günün diğer dört bölmesiyle aynı: **YÖNTEM kalır, ENVANTER ayrılır.**

Yöntem kuralları orada: kurtarıcı ikili (pozitif kontrol ↔ örnekle doğrulama) · teşhis mesajı da bir yüklemdir · atıfta eşik düşmesi · yapısal sonda · sayı yazma · **kapının ölüm biçimleri** · kırmızıyı sınıflandırma — `docs/standart/OLCUM-DISIPLINI.md`.

⚠️ **Numaralar bu listenin SIRASIDIR, kalıcı kimlik değil.** Bir sınıf ADIYLA anılır; sıra iki oturumda çakıştı ve başlıktaki sayı zaten borçtur.

---

## Katalog iki katmanlıdır

| Katman | Soru | Ne yanlış gider |
|---|---|---|
| **1 · ölçümün kendisi** | sayı doğru mu? | araç, soru, kural cümlesi, kontrol grubu, kapsam |
| **2 · ölçümden SONRAKİ adım** | sayı doğru — ondan ÇIKARILAN ne? | mekanizma, birim, taşıma, arka durak, kaçış, dizge |

⚠️ **KATMAN 2 daha sinsidir.** Katman 1'de ölçüm yanlıştır ve pozitif kontrol/örnekle doğrulama onu yakalar. Katman 2'de gözlem DOĞRUDUR ve doğrulanmıştır — bu yüzden ondan çıkarılan açıklama da doğrulanmış sanılır. Hiçbir pozitif kontrol bu katmanı yakalamaz.

## KATMAN 1 · Arıza sınıfları — ölçümün kendisi

> ⚠️ **KATMAN 1 ikiye bölündü (2026-09-13).** Buradaki sınıflar ölçümün **KURGUSUNA** aittir —
> soru, kontrol grubu, ortam, deneyin kurulumu. Ölçüm **ARACININ** kendisine ait sınıflar
> (desen, komut, ayrıştırıcı, aracın varsayılanı ve kapsamı) [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md)'de.
> **Numaralar KORUNDU** — §1 ve §4 oraya gitti, buradaki dizide boşluk var ve bu bilinçlidir:
> bir sınıf ADIYLA anılır, numara yalnız listenin sırasıdır.

### 2 · Soru yanlış
Araç çalışır, cevap **ayırt edici değildir** — aynı çıktıyı iki farklı dünya da
üretirdi.
**Savunma:** *"bu kanıt, alternatif dünyada FARKLI olur muydu?"* Cevap hayırsa
kanıt değildir.

### 3 · Kural cümlesi yanlış
Araç ve soru doğru, **dünya modeli** yanlış. İki ölçüm doğrudur, aralarındaki
çıkarım ölçüsüzdür.
**Savunma:** arızayı **izole ortamda yeniden üret**. Üretemiyorsan kuralın yanlış.

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

### Ölçümün KURULUM adımı da ölçülen sistemin içindedir
*"Önce generate, önce build, önce migrate"* bir hazırlık **REFLEKSİDİR** — ölçüm değil
**MÜDAHALE**, ve gerekliliği ölçülmeden koşulmaz.
*(Vaka 2026-09-13: bir worktree'nin `node_modules`ü ana ağaca symlink'liydi; `prisma
generate` symlink'in ucundaki ORTAK dizine yazdı ve başka bir oturumun kodu 8 tip
hatası verdi — "şema aynıydı, sırf refleksle koşturdum".)*
**Savunma:** her hazırlık komutundan önce iki soru: **nereye yazıyor** ve **gerçekten
gerekli mi?**

### Paylaşılan ağaç ve çok-oturum sınıfları → ayrı dosya
Ölçümün kurgusu doğru olsa bile **ölçüm ORTAMI paylaşılıyorsa** ayrı bir sınıf ailesi
doğar: paylaşılan `node_modules`, paylaşılan indeks, ortak ref, başka oturumun
ağaç-bütünü komutu, `.git/index.lock`, ortak ağaçta kirlenen sayı, yanlış ağaçta ölçülen
pencere. Yedisi de [`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md)'de.

### Pozitif kontrolün KENDİSİ bir müdahaledir
Yasaklanmış bir şeyi bilerek yazmak, onu yasaklayan **her** kapının kapsamına girer.
*(Vaka: bir uyarının "ihlal dalı" uyarıyı üretmedi ama lint'i kırdı — deney
başarısız, yan etkisi başarılı.)*
**Savunma:** kuralı kırarak test edeceksen, o dosyayı **kaç kapının göreceğini ÖNCE
say**.

**Ve bu sınıf yalnız pozitif kontrole ait değil — desen üç ölçülmüş vakada tam:**

| Ölçüm aracının eylemi | Neyi bozdu |
|---|---|
| `prisma generate` (hazırlık refleksi) | **ORTAMI** — başka bir oturumun tip kontrolü |
| `Promise.all(tx.*)` pozitif kontrolü | **LİNT** kapısını |
| düşen temizlik | **MUTABAKAT** kapısını |

Üçü de ölçüm ARACININ yan etkisi, hiçbiri ürün kusuru — ve **üçünde de ilk teşhis
"ürün kusuru" yönündeydi.**
> **Beklenmedik bir kırmızı gördüğünde ilk soru *"ürün ne yaptı"* değil, *"BEN ne
> koşturdum"* olmalı.**

Kardeş sınıflar: § Ölçümün KURULUM adımı · § Bir temizlik eksikliğinin faturası.

### "Bende yok" bir ölçüm değildir
*"Nerede olabileceğini aramadım"* demektir.
*(Vaka: "komut metinleri bende yok" denildi; metinler oturum günlüklerindeydi ve
`toolUseID` ile kesin eşleme **23 yanlış pozitif** çıkardı — ikisi iddiayı kuranın
kendi komutlarıydı.)*
**Savunma:** yokluk beyanı, **aranan YERLERİN listesiyle** birlikte yazılır.

### Zengin kontrol grubu — yeşil, ölçümün değil ORTAMIN özelliği
§5'in (kirli kontrol grubu) kardeşi ve tersi: ortam kirli değil, **eksikliği
göremeyecek kadar DOLU**.
*(Vaka: tohumSUZ bir DB'de `test_tambur_over_quantity` çöktü; aynı bekçinin 16/16
yeşili tohumLU DB'de alınmıştı.)*
**Savunma:** yeşil bir bekçiyi **fakir** ortamda da koştur.

### "Bu benim değil" bir ÖLÇÜM olmalı, bir çıkarım değil
*(Vaka: bir kırmızının metnine — `customerName` — bakılıp "kalite değil, benim değil"
denildi; ölçünce **kendisiydi**. Mekanizma iki sıçrama uzaktaydı: boş kalite →
GEOMETRİ → `customerName` konumu.)*
> **Kırmızının KONUSU, kırmızının SEBEBİ değildir.**

### Dolu bir kolon, adının sorduğu soruyu cevaplamıyor olabilir
*(Vaka: `producedInStepId` "hangi adımda doğdu" der; gerçekte "en son hangi iş emrine
bağlandı" tutar — `attachRolls` ezer, `detachRolls` null'lar. Fabrikada **2.205 topun
1.678'i** sahte doğum izi taşıyor.)*
> **Kolon adı bir İDDİADIR, bir sözleşme değil.** Bir kolonu ölçüme sokmadan önce
> **YAZARLARINI say.**

### Bir kapının "neden kırmızı" cevabı, kapının ÇALIŞTIĞINI varsayar
Kırmızının sebebini ararken kapının koştuğu **sorulmamış bir öncüldür**.
*(Vaka: üç ORTAM kırmızısı, uzak kapının kalıcı kırmızılığının sebebi sanıldı; gerçek
sebep kapının **hiç koşmaması**ydı.)*
**Savunma:** sebep aramadan önce kapının KOŞTUĞUNU ölç — süre, adım sayısı, çıktı
hacmi. Kardeşi: `OLCUM-DISIPLINI-KAPI-OLUMU.md` § Kapının ölüm biçimleri ⑦–⑧.

### İki rejimli bekçi — tam kapsam tek koşumda ölçülemez
Bazı bekçilerin kapsamı, **birbirini DIŞLAYAN** ortam rejimlerine bölünür; her rejim
ayrı bir koşum ister ve tek koşumun yeşili "hepsi ölçüldü" demek değildir.
*(Vaka 2026-09-13: `test_superadmin` → hesap YOK rejiminde 103/0/3, hesap VAR
rejiminde 126/0/16. Paket bugüne kadar rejimlerin **hiçbirini** ayrı koşturmuyordu.)*
**Savunma:** rejimi olan bekçide rejim kümesini dosyanın başına YAZ ve her rejimin
kendi koşumu olduğunu ölç; yoksa ölçülmeyen rejim sessizce kapsam dışıdır.

### Bir işin "başarıyla bitti"si, SARMALAYICININ çıkış kodudur
Sarmalayıcı (arka plan görevi, `echo`lu zincir, `npx`, kabuk fonksiyonu) kendi
kodunu raporlar — **sarmaladığı işin kodunu değil**.
*(Vaka 2026-09-13: bir arka plan görevi "completed (exit code 0)" bildirdi; gerçek
`git commit` kodu **1**'di — zincirin son `echo`unun kodu raporlanmıştı. `RC=$?`
disiplini yakaladı.)*
**Savunma:** işin kodunu ARANIN kodundan ayır — `RC=$?` hemen işin ardından okunur.

> **Üçleme tamam — "ölçtüğün araç kapının kendisi değildir":**
> **kapsam** ayrışır (tam-proje lint ≠ commit kapısı) · **sınır** ayrışır (kırpılmış
> yığın, § Aracın VARSAYILANI) · **özne** ayrışır (sarmalayıcı ≠ iş, burası).

### Fikstürünü kendi kuran bekçi, KURDUĞUNU da ölçmek zorundadır
Bir ORM'in `data` nesnesindeki `undefined` **sessizce atılır**: alan hiç yazılmaz, hata
çıkmaz, satır oluşur. Fikstür adımı **hiç çalışmadan** yeşil görünür.
*(Vaka 2026-09-13: bir bekçi var olmayan bir enum üyesi yazdı — `RollStatus.DISPATCHED`,
gerçeği `SHIPPED`. ORM `undefined`ı attı, fikstürün "topu stok dışına çıkar" adımı hiç
koşmadı ve senaryo ÖLÇÜLMEMİŞ olarak yeşil kalacaktı.)* *(6e)*
> **Süzgeç no-op'u SONUCU değiştirir; `data` no-op'u FİKSTÜRÜ değiştirir** — ikincisi
> daha sessizdir, çünkü geriye kırmızı verecek bir şey kalmaz.

**Savunma: pozitif kontrol** — bu vakayı yakalayan tek şey oydu. Fikstür kurulduktan
sonra kurulanı GERİ OKU ve beklediğin değerde olduğunu ölç; yazdığını varsayma.

### Bir ortamı TARİF etmek, onu ARAMAK değildir
Bir ortam şartı yazdığın an ikinci soru ZORUNLUDUR: *"bu şartı bugün sağlayan bir hat
var mı?"* Tarif, varlığın kanıtı değildir. *(d5)*

### Bir örneklem yanlılığının VARLIĞINI bilmek, YÖNÜNÜ bilmek değildir
*"Bu örneklem yanlı"* demek, sonucun hangi tarafa kaydığını söylemez — düzeltme yönü
ayrıca ölçülür. *(ea; alfabetik dilimden alınan örneklem)*

### Bir kümeyi YAZARININ İZİNDEN bölersen, ölçtüğün şey yazardır
Kümeyi içeriğine göre değil, yazarın bıraktığı ize (yorum biçimi, ad kalıbı, dosya
düzeni) göre bölersen sonuç içerik hakkında değil **yazar hakkında** çıkar. *(ea)*

### Aynı KÖR NOKTAYI paylaşan iki ölçüm birbirini DOĞRULAMAZ
Bağımsızlık **KAYNAKTA değil YÖNTEMDE** olmalı. Farklı kişilerin aynı yöntemi
koşturması ölçümü **TEKRARLAR, doğrulamaz**.
*(Vaka `39c963b4`, 2026-09-13: iki oturum bağımsız ölçtü, İKİSİ DE "6 izsiz script"
buldu — ve ikisi de yanlıştı. Pozitif kontrol sayıyı çökertti: 1 gerçek ihlal + servis
üzerinden yazanlar (iz VAR) + populasyonun üyesi bile olmayan salt-okunur bir kapı.
Ortak kör nokta: ikisi de literal desen aradı, DOLAYLI çağrıyı göremedi.)*
> **Bir yüklem "yazma yolu"nu KAPANIŞINA kadar izlemiyorsa** (script → servis →
> audit/Prisma), meşru olanları ihlal gösterir.
**Savunma:** "iki bağımsız araç" derken araçların **yöntemi** farklı mı, onu ölç.

### Aynı kusuru İKİ dosyadan ölçebiliyorsan BOŞ olanı seçmek bir ÖLÇÜM KARARIDIR
Çekişmeli bir dosyada sonda atmak, sondanın sonucunu **başkasının yarım işine** bağlar.
*(Vaka `73919ea0`, 2026-09-13: sonda bilerek karşı taraftan kuruldu, çünkü asıl dosyada
o an başka bir oturum çalışıyordu.)*

### SONDA ailesi — sondanın SESSİZLİĞİ hiçbir tarafın lehine delil değildir
Bir sonda ısırmadıysa bu ne kapının sağlam olduğunu ne sondanın geçerli olduğunu
gösterir. Yedi biçim *(kaynak: oturum ölçümü 2026-09-13, `test_identity_ledger` sonda
turu; a maddesi sha'lı — `5ac6e830`)*:

| # | Biçim | Vaka |
|---|---|---|
| a | araç gözlenenin içinde | sentinel elenmedi, 8 karakteri gezildi → 216 sahte kırmızı (§ Mutasyonun ürettiği sayı) |
| b | **mutasyon UYGULANMADI** | `sed` çapası tutmadı; "kapı ısırmadı" görüldü. İkinci denemede hedef bekçi **yoktu** (ad yanlıştı). İki mekanizma daha ölçüldü (82, 2026-09-13): `sed '0,/…/s//…/'` deseni satır sonu biçimine uymadı ⇒ dosya DEĞİŞMEDİ, çıktıda `❌` yoktu ve "sonda yeşil kaldı" yazılacaktı; ve arka plan kabuğu `LANG` taşımadığı için Python heredoc'u Türkçe karakterde `SyntaxError` verdi ⇒ yama uygulanmadan `typecheck RC=0` **yeşil** geldi |
| c | **beyan basılmadı** | beyan ÖZET satırındaydı; tüm dosyalar elenince özet hiç koşmadı — *"sessiz dışlama olmasın"* satırı tam o durumda sessizdi |
| d | sonuç okunmadı | ölçüm ile eylem aynı zincirdeydi (`OLCUM-DISIPLINI-ARAC.md` § KABUK ailesi c) |
| e | çıktı kırpıldı | `tail` beyanın bulunduğu başı kesti (aynı yer, f) |
| f | **düzenleme artığı** | bir belgede kesik ad artığı kaldı; ölü link olmadığı için belge kapısı görmedi |
| g | ⚠️ **YANLIŞ ALAN** | mutasyon `Backend:` alanına yazıldı, kapı `bekçi:` alanını okuyor → ısırmadı. Doğru alana yazılınca ISIRDI |

⚠️ **(g) en sinsisidir: kapıyı HAKSIZ YERE ölü ilan ettirir.** O sondadan sonra
*"taban sert değil"* yazılacaktı.

> **Sonda, MUTASYONUN UYGULANDIĞINI ve DOĞRU ALANA dokunduğunu da ölçer.**

**Panzehir — iki adım, ikisi de ÖLÇÜM (82, 2026-09-13):**
1. **Değişikliği doğrula:** `shasum` önce/sonra FARKLI olmalı (ya da Python'da
   `assert old in s`). *"`sed` sessizce eşleşmedi"* bir SONUÇTUR, hata değil — kabuk
   çıkış kodu 0 döner ve hiçbir şey yazmaz.
2. **Kırmızıyı ADIYLA bekle:** hangi bölüm, hangi mesaj. ***`❌` YOKLUĞU ≠ sonda geçti***
   — beklenen kırmızının metnini önceden yaz, sonra ara.

⚠️ **Farkı kardeşlerinden:** § Sessiz kapı ölümü'nde ve *tek yönlü ölçülen kapı*da KAPI
ölüdür; burada **kapı sağlamdır, SONDA ölüdür** — ve ölü bir sonda kapıyı
*doğrulanmış* gösterir, yani zararı kapının ölümünden daha uzun yaşar.

### Bir sondanın DÜNKÜ sonucu, bugünkü koda dair bir iddia değildir
Sonda bir kereye mahsus bir tören değil, **bir ölçümdür** — ve ölçümler bayatlar.
Fikstür, taban, kapsam ya da kapının kendisi değiştiyse *"bekçi hâlâ ısırıyor mu"*
YENİDEN sorulur; eski yeşil devralınmaz.
*(Vaka 2026-09-13: bir düzeltmeden sonra negatif sonda devralınmayıp yeniden koşuldu —
fikstür değişmişti; ısırdı ve rakam 500'den 2100'e çıktı. Devralınsaydı "sonda geçerli"
cümlesi doğru görünecek, dayandığı ölçüm ise başka bir koda ait olacaktı.)*
> **Sondayı kod değişince değil, SONDANIN DÜNYASI değişince yenile** — fikstür, taban,
> kapsam, kapı. Dördünden biri oynadıysa dünkü sonuç bir anıdır, delil değil.
Kardeşi § SONDA ailesi ve `OLCUM-DISIPLINI-YUKLEM.md` § Bir "HEPSİ" iddiası.

### Tutmayan bir sonda İKİ şeyden birini söyler: kurgu yanlış YA DA kapı KÖR
*"Sonda tutmadı, demek ki temiz"* üçüncü bir seçenek değildir.
*(Vaka `b35a7a32` → `222cbf14`, 2026-09-13: bir sonda tutmadı; sebep kapının UZANTISIZ
adlara kör olmasıydı — 155 benzersiz ad, üstelik en yaygın biçim. "Temiz" denseydi kapı
kör hâliyle inecekti.)*

## KATMAN 2 · Ölçümden sonraki adım → ayrı dosya

[`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) (`docs/standart/OLCUM-DISIPLINI-CIKARIM.md`) — 2026-09-13'te buradan bölündü; katalog o gün **+20 sınıf** aldı ve bu dosya tavana 1.667 bayt kalmıştı. Tavan yükseltilmedi.

⚠️ Katman 2'de **gözlem DOĞRUDUR ve doğrulanmıştır** — bu yüzden ondan çıkarılan açıklama da doğrulanmış sanılır. **Hiçbir pozitif kontrol o katmanı yakalamaz.**
