# Ölçümü KAPIYA çevirmek

[`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'nin kapı yarısı; 2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 1,8 KB kalmıştı ve tur boyunca beş kez yazıldı; tavan yükseltilmedi).

**Çizgi:** orası ölçümün **NASIL YAPILDIĞI ve NASIL YAZILDIĞI** (kurtarıcı ikili · sayı · çapa · kimlik · teşhis mi ölçüm mü); **burası ölçümün NASIL ZORLANDIĞI** — bir ölçümü kapıya çevirmek ayrı bir iştir ve kendi arıza sınıfları vardır.

Arıza sınıfı kataloğu dört dosyada: [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) (ölçümün aracı) · [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) (ölçümün kurgusu) · [`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md) (paylaşılan ortam) · [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) (ölçümden sonraki adım).

---

## Mandal (tavan) yazma

Bir mandal — `devralınan: N`, `lint-baseline.json`, herhangi bir "yalnız düşer" sayısı —
iki kuralla hareket eder:

> **Mandal yalnız SIKILAŞTIRAN yönde ve yalnız AZ ÖNCE ÖLÇÜLEN değere hareket eder.**

**Yükseltmek ihlali ONAYLAMAK, düşürmek kazanımı KİLİTLEMEKTİR** — ve düşürme
**düzeltmeyle AYNI commit'te** olur, yoksa kazanım bir sonraki eklemede sessizce geri
verilir. *(1e)*

> **Bir mandalın tabanı, ihlali ADIYLA söyleyebiliyorsa SAYI değil KÜME olmalıdır.**
> Ön koşul: küme üyelerinin **sabit kimliği** olmalı. *(d5 ve ea, bağımsız olarak aynı
> sonuca vardı.)*

*Vakalar:* `lint-baseline` **"455 > 454"** dedi — hangi fonksiyon olduğu ARANARAK
bulundu · `test_quality_code_literal` **"217 > 216"** dedi — kaynağın kendi düzeltmesi
olduğu ARANARAK bulundu. Karşı örnek: `test_identifier_language` tabanı **adlarla**
tuttu, teşhis sıfır saniye sürdü.

⚠️ **Ters tuzak:** `dosya::satır` bir küme GİBİ görünür ama üyelerinin sabit kimliği
YOKTUR — satır kayar, küme değişir, kapı gürültü üretir. Ve **gürültülü bir kapı, körü
körüne güncellenerek ölür** (kapının dokuzuncu ölüm biçimi).

## "Kapalıdır" diyen cümle kapıyı adıyla taşır

> **Bir belgede *"tamdır / kapalıdır / artık olmuyor"* diyen her cümle, onu kapalı
> tutan KAPIYI adıyla taşır; taşımıyorsa cümle bir ÖLÇÜM değil bir ANIDIR.** *(1e)*

Kapısı yazılmayan bir "kapandı" cümlesi, yazıldığı gün doğrudur ve ertesi gün
yanlışlanamaz hâle gelir.

**Ve "kapısı var" demek yetmez — ÜÇ AYRI DURUM vardır, üçü aynı görünür:**

| Durum | Ne var, ne yok | Düzeltme |
|---|---|---|
| **DİLEK** — hiç uygulanmamış kural | cümle var, uyum ÖLÇÜLMEMİŞ | ölç, sonra kuralı gerçeğe göre yaz |
| **KAPISIZ SAYI** — mandal düzyazıda | sayı var, onu okuyan kapı YOK | kapıyı kur; sayıyı GÜNCELLEME (bkz. § Mandal) |
| **YANLIŞ ADLA ANILAN GERÇEK KAPSAM** | kapsam VAR, atıftaki ad yanlış | **atfı düzelt** — kapı yazma |

*(Üç vaka, 2026-09-13: `ILKELER.md` tanımlayıcı kuralı — 876 ad, hiç ısırmamış · `devralınan:`
tavanları — kapısızken 18→30 ve 53→78, `be330599` ile kapandı · `test_surum_notlari.ts` —
üç yerde anılıyor, YOK; ama kapsamı `Electron/src/lib/surum-notlari.test.ts` ve
`scripts/check-surum-notlari.mjs` olarak VAR.)*

⚠️ **Üçüncüsü en tehlikesiz görünüp en çok zaman yiyendir:** okuyan bekçiyi arar, bulamaz,
**yazmaya kalkar** ve var olanı İKİZLER.
📌 Panzehir: **bir bekçi adını belgeye yazmadan önce `git ls-files | grep` ile varlığını
ÖLÇ** — çıkış kodunu okuyarak, `2>/dev/null` yazmadan (bkz. `OLCUM-DISIPLINI-ARAC.md`
§ Boş çıktı bir ÖLÇÜM değildir).

⚠️ **Ve dördüncü, en sinsi hâli:** ***zorlaması OLAN ama hiç ISIRMAYAN kural, ölçülüyor
SANILIR*** — dilekten tehlikelidir, çünkü `zorlama:` etiketi okuyanı rahatlatır. *(d9:
`ILKELER.md`'nin bekçisi 106 commit boyunca giren 32 Türkçe adın SIFIRINI gördü.)*

## Kapının ÖLÜMÜ ve KIRMIZININ sınıflandırılması → ayrı dosya
Bir kapıyı **yazmak** ile bir kapının **ölümünü/kırmızısını okumak** ayrı iki iştir.
İkincisi — kapının ölüm biçimleri, yerel yeşilin başkasının düzeltmesi olması, ağacı okuyan
her araç, kancaya yapılan commit'siz değişiklik, kırmızıyı sınıflandırma, yeşilin iki
uçla sınırlı oluşu — [`OLCUM-DISIPLINI-KAPI-OLUMU.md`](OLCUM-DISIPLINI-KAPI-OLUMU.md)'de.


## Ölçüm bir KARARI değiştirebiliyor mu

> **Ölçüm ile eylem AYNI atomik adımdaysa, ölçüm kararı değiştiremez — yalnız kayda
> geçer.** Kendisinden sonra geleni durduramayan bir kapı, kapı değil **GÜNLÜKTÜR**.
> *(6e)*

**Ve ölçümün VARLIĞI, ölçümün işe yaradığının kanıtı değildir** *(6e)*: yanlış DB ·
yanlış mekanizma · yanlış zamanlama — üçü de *"ölçüm yapıldı"* satırını sorunsuz geçer.
Sorulacak şey *"ölçtüm mü"* değil, ***"bu ölçüm yanlış bir dünyada FARKLI çıkar mıydı"***.

## Tavanın beyan edilmemiş ikinci işlevi

> **Bir boyut tavanı yalnız büyümeyi durdurmaz; DUVARA DAYANDIĞI YER, dosyanın bölünme
> çizgisini gösterir** — ve o çizgi önceden tahmin edilemez, ancak baskı altında görünür.

*(2026-09-13: altı dosya duvara dayandı; beşinde çizgi net çıktı — yöntem ↔ kapı,
araç ↔ kurgu, kural ↔ envanter…)*

⚠️ **AMA TAVAN YANILABİLİR — ve bugün bir kez yanıldı.** `BACKEND.md` duvara dayandı ve
**hiçbir dikiş göstermedi**: "içerik yanlış dosyada" hipotezi ölçüldü ve çürüdü
(taşınabilir aday **%4**), gerçek sebep **kanıt kuyruğuydu** (`zorlama:` + `kanıt:` +
`devralınan:` = dosyanın **%44'ü**). Orada bölmeye kalkmak **yapay bir çizgi** çizmek
olurdu.

> **Tavan bir dikiş gösterir — dosyanın içinde gerçekten İKİ İŞ varsa. Yoksa gösterdiği
> şey dikiş değil, işin kendi BOYUTUDUR.**

**Ayırt eden soru:** baskı noktasındaki içerik **iki farklı SORUYA mı** cevap veriyor,
yoksa **tek soruya iki KATMANDA mı**? İlki bölünür; ikincisi bölünmez, yalnız ölçülür.

📌 Ve bu, gecenin genel dersinin kapı yüzü: **tavan bir ARAÇTIR, bir HÜKÜM değil** —
sayı doğru, çıkarım ayrı bir iş.

## Cırcıra İKİ sonda gerekir — negatif sonda yetmez

Bir cırcır (taban yalnız düşer) iki ayrı yeteneği vardır ve **negatif sonda yalnız
birini ölçer**:

```
NEGATİF sonda : ihlal ekle  → sayı ARTAR, kapı kırmızı   ✓ "kapı ısırıyor mu"
POZİTİF sonda : borcu KAPAT → sayı DÜŞER                  ✓ "taban inebiliyor mu"
```

> **Tabanı DÜŞÜREMEYEN bir cırcır, kapısızlıktan KÖTÜDÜR** — borç kapatılamaz, sayı hiç
> inmez, kapı ilk sıkışmada susturulur, üstelik *"çalışıyor"* görünerek.

*(Vaka `ce666b78`, 2026-09-13: B kolunun pozitif sondası, negatif sondanın **yapısal
olarak göremeyeceği** bir kusuru buldu — yüklem `Kapanır:` alanını `bekçi:`
backtick'lerinin İÇİNDE arıyordu, oysa o bir KARDEŞ alan. Bir kurala kapanma koşulu
eklemek sayıyı düşürmüyordu. `B−` 37→38 kırmızı ✓ · `B+` 38→37 TUTMADI ✗.)*

📌 Ve bu, *"sonda doğru alana dokunduğunu da ölçmelidir"* kuralının bir adım ötesi:
**doğru alana dokunuldu, kapı kırmızı verdi, VE YİNE DE bozuktu.** İkisi farklı şey
ölçüyor.

## Commit kapısı BEKÇİLERİ koşmaz

Commit kapısı tip + lint + lint tavanı + hızlı testi koşar; **bekçileri koşmaz.**
⇒ Yeni bir dosya **yalnız ELLE koşturulduğu kadar ölçülür.**

> **Yeni bir dosya yazdığında, o dizini tarayan BÜTÜN tarayıcılara koştur** — yalnız
> seni yakalayana değil.

*(Vaka `643cc52c`, 2026-09-13: aynı gün İKİ oturum aynı bedeli CI'da ödedi — ikisi de
kendi indirdikleri mandalın saatler sonra kendi yeni dosyalarını yakalamasıyla. Biri
altı tarayıcıyı birden koşturarak dersi genelleştirdi.)*

📌 **Kendine uygulanmayan kural için tek çare KAPIDIR**; *"bunu biliyorum"* bir kapı
değildir. İki vakada da yakalayan belge değil kapı oldu.

## Cırcır tabanı YALNIZ `git show HEAD:` içeriğinden ölçülür

> **Bir cırcır tabanı ÇALIŞMA AĞACINDAN ASLA ölçülmez.** Ortak ağaçta o ağaç hiç
> kimsenin commit'i değildir; içinde başka oturumların **commit edilmemiş** kapanışları
> vardır ve taban onların üstüne kilitlenir.

Sonuç, kapının en kötü ölüm biçimi: taban gerçeğin **altına** iner, kapı **herkese**
kırmızı verir, ve suçlu görünen ihlali yapan değil **ondan sonra commit atan** kişidir.

*(Vaka 2026-09-13: bir taban 37 → 27'ye çekilmek üzereydi; ölçüm çalışma ağacında
alınmıştı ve o ağaçta 13 kapanış vardı — yalnız 6'sı ölçümü yapanın. HEAD'de
`git show HEAD:` ile ölçülünce gerçek **37/37** çıktı. Aynı gün aynı sınıf **beş kez**
ısırdı ve her seferinde başka bir aracı yakaladı: bir taban tazelemesi · bir sayaç ·
bir kural dosyası · satır numarası çapaları · bu taban.)*

**Ölçüm:** yüklemini `git ls-tree HEAD` + `git show HEAD:<yol>` içeriğine uygula; ya da
en azından `git status --porcelain <dizin>` çıktısının BOŞ olduğunu **ayrıca** ölç.
⚠️ Ve **hesaplama, ÖLÇ**: "37 − 6 = 31" bir tahmindir; tabanın kendi yüklemi (`KOSULSUZ`
· `KAPANIR`) seninkinden farklı olabilir — bugün tam bu yüzden aynı soruya iki sayı
çıktı (kapı 27, bağımsız kopya 24).

📌 Ve düzeltmenin yeri: **push'tan ÖNCE `--amend`**. Bir commit inmiş sayıldığı an
**push** anıdır, commit anı değil; yerel duran bir commit'te tabanı düzeltmek main'e
hiç yanlış taban sokmaz. *"Sonra ikinci commit'le düzeltirim"* dürüsttür ama bir koşum
boyunca herkesi kırmızıda bırakır.

## Sistemin ÜRETMEDİĞİ durumu ölçmenin iki aleti

Bir değişmezi sınamak için bazen **sistemin doğal olarak üretmediği** bir durum gerekir.
İki alet vardır ve seçimi tek soru belirler:

> **Sistemin üretmediği şey VERİ mi, KURAL mı?**
> Veriyse → **satırı elle kur.** Kuralsa (kapı o durumu dışlıyorsa) → **kapının
> kendisini boz.**

*(İki vaka, aynı gün: bir süzgeç kusurunda storno `dispatchedAt`i NULL'ladığı için
doğal veri o satırı hiç üretmiyordu ⇒ satır elle kuruldu. Bir trigger kusurunda ise
trigger o durumu zaten dışlıyordu ⇒ trigger'ın kaynak listesi bozuldu ve bekçi
33/0 → 32/1 düştü; kırmızı olan tam beklenen kontroldü.)*

⚠️ **İkinci alet daha tehlikelidir: KAPIYI bozan sonda, GERİ ALINDIĞINI da ölçmek
zorundadır.** Bozulan şey bir kapıdır; sessizce bozuk kalırsa **herkesin yeşili yanlış
olur** ve kimse bunu kendi koşumundan anlayamaz.
> **Geri alma bir iddiadır; sha ile ölçülmedikçe kurulmamıştır.**
*(Emsal: `pg_get_functiondef` sha'sı alındı, geri alındıktan sonra birebir karşılaştırıldı
ve bekçi yeniden koşturularak 33/0'a döndüğü görüldü.)*
Kardeşi § Yerel yeşil ↔ HEAD: orada yeşil başkasının işinden gelir, burada **senin geri
almadığın bozuktan**.

### Bir mandalın TANECİĞİ, neyi ve NE ZAMAN ısırabileceğini belirler
*"Mandal doğduğu gün ısıramaz"* cümlesi **fazla geniştir ve yanlıştır**. Doğrusu: bir
mandal **devralınan popülasyonu** ısıramaz — ama **anahtar uzayında YENİ bir üyeyi**
doğduğu gün ısırır. Hangisinin olacağını belirleyen şey mandalın **taneciğidir**.

*(Vaka 2026-09-13: `test_olcum_iddiasi` mandalı — anahtarı bir SAYI değil, çıplak ölçüm
iddiası taşıyan **DOSYA KÜMESİ**. İndiği gün yeni bir bekçi dosyası
(`test_stock_ledger_tambur_undo.ts:274`, çıplak "ölçüldü") tabanda olmadığı için
**hemen kırmızı verdi**. Aynı gün, aynı mandal, aynı taban.)*

⚠️ **Ve her taneciğin kendi kör noktası vardır — bu mandal onu kendi ağzından basıyor:**
*"Tanecik DOSYA: aynı dosyaya İKİNCİ bir çıplak iddia eklemek mandalı UYANDIRMAZ."*
Ölçüldü 2026-09-13: taban **63 dosya**, ağaçta **87 çıplak iddia** ⇒ 24 iddia taban
dosyalarının İÇİNDE yaşıyor ve mandala görünmez. Kör nokta teorik değil, **canlı**.

| tanecik | doğduğu gün ısırır mı | kör noktası |
|---|---|---|
| SAYI (N ihlal) | **BOŞLUĞU varsa** hayır — N'e kadar sessiz | hangi satırlar olduğu bilinmez; ihlal takası serbest |
| KÜME (dosya/ad) | **evet** — yeni üye anında | mevcut üyenin İÇİNDEKİ ikinci ihlal |
| yok (taban 0) | evet, her şeye | yok — ama ancak devralınan borç AYNI commit'te ödenirse kurulabilir |

⚠️ **SAYI taneciğinde belirleyici olan tanecik değil BOŞLUKTUR (taban − gerçek).**
Taban ölçülen değere EŞİT konursa boşluk sıfırdır ve cırcır, küme taneciği gibi **ilk
yeni üyede** ısırır; "N'e kadar sessiz" satırı boşluk bırakılmış cırcırları anlatır.
*(Vaka 2026-09-14: `test_defter_ters_yol` §10b2 — `TEARDOWN_DISI_TABAN` ölçülen değere
(61) çakılmıştı. İndiği gün, aynı trende gelen bir dilim teardown DIŞINDA defter satırı
silince **62 > 61** verdi ve commit trenden düştü. Kapı doğduğu gün ısırdı; taban
sabitine dokunulmadı, ihlal onarıldı — cırcırın doğru yönü budur.)*
⇒ Cırcır yazarken boşluğu BİLEREK seç: sıfır boşluk anında ısırır ama devralınan borcu
kapatma baskısı yaratır; boşluk bırakmak borç ödemeyi kolaylaştırır, **karşılığında ilk
N ihlali görünmez kılar**. Üçüncü seçenek yok, ve seçim yazılmazsa ölçülemez.

> **Bir kapıyı yargılamadan önce türünü değil ANAHTARINI sor:** *neyi sayıyor, ve benim
> eklediğim şey o anahtarda YENİ mi?* "Mandal mı tarayıcı mı" ayrımı bu soruyu
> cevaplamaz — ikisi de anahtarına göre ısırır ya da susar.

**Savunma:** mandal yazarken taneciği **başlığa** yaz ve kör noktasını **aynı cümlede**
beyan et; okuyan, yeşilin neyi kapsamadığını kapının kendisinden öğrensin.

### Bir bekçinin KENDİ yeşili, KAPIDAN geçeceğini söylemez — "koştu" ≠ "derlendi"
`npx tsx scripts/x.ts`in yeşil vermesi, aynı dosyanın tip kapısından geçtiği anlamına
**gelmez**: koşucu ile tip kapısı FARKLI yapılandırma okur ve koşucu, derleyicinin
reddettiği bir yazımı çalıştırabilir.

*(Vaka 2026-09-13: yeni bir bekçi `tsx` ile 3/0 yeşil koştu ve üç sondası da iki yönlü
doğrulandı; commit kapısı `TS1343 — 'import.meta' meta-property is only allowed when
the 'module' option is …` ile düştü. Kod doğruydu, **yazım o projenin derleyici ayarıyla
uyumsuzdu**. Kapı 84 saniye sonra, ölçüm bittikten çok sonra konuştu.)*

> **Bir bekçi iki kez bitirilir:** ① kendisi koşar ② o projenin **tip kapısı** onu derler.
> İkincisi ayrı bir ölçümdür ve komutu `package.json > scripts`ten OKUNUR, uydurulmaz
> (`TEST-VE-DERLEME-BEKCI.md` [TD-41]).

**Savunma:** yeni bekçiyi sıfırdan değil **KARDEŞ bir bekçinin kalıbından** başlat
(burada `__dirname`, `scripts/lib/kural-dosyalari.ts`); kalıp, o projenin derleyici
ayarıyla uyumlu olduğu **zaten ölçülmüş** bir seçimdir — ve kalıptan sapmak sessiz değil,
kapıda gürültülü bir bedel öder.
