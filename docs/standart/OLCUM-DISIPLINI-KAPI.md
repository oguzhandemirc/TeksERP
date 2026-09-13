# Ölçümü KAPIYA çevirmek

[`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'nin kapı yarısı; 2026-09-13'te oradan **bölünerek** geldi (o dosya tavana 1,8 KB kalmıştı ve tur boyunca beş kez yazıldı; tavan yükseltilmedi).

**Çizgi:** orası ölçümün **NASIL YAPILDIĞI ve NASIL YAZILDIĞI** (kurtarıcı ikili · sayı · çapa · kimlik · teşhis mi ölçüm mü); **burası ölçümün NASIL ZORLANDIĞI** — bir ölçümü kapıya çevirmek ayrı bir iştir ve kendi arıza sınıfları vardır.

Arıza sınıfı kataloğu üç dosyada: [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) (ölçümün aracı) · [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) (ölçümün kurgusu) · [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) (ölçümden sonraki adım).

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

## Kapının ölüm biçimleri

Ölçümü kapıya çevirirken hepsini birden gözet; hepsi kapıyı **kaldırmadan**
işlevsizleştirir. Aşağıdaki numaralar **bu listenin sırasıdır, kalıcı kimlik
DEĞİL** — sıra iki oturumda çakıştı; bir kapı ölümü ADIYLA anılır.

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
7. **Koruduğu şeyle İLGİSİZ bir sebeple SESSİZCE ölmek** — aşağıda; ilk altıdan
   ayrı bir sınıftır çünkü **ilk altısında kapı KOŞUYORDU**.
8. **Uzakta hiç AÇILMAMAK — ve gürültülü ölmek** — aşağıda; 7'den farkı sesidir.
9. **Gürültülü taban** — ihlali ADIYLA söyleyemeyen bir mandal (`455 > 454`) her
   kırmızıda arama gerektirir; maliyet teşhisten büyür ve taban **körü körüne
   güncellenmeye** başlar. Kapı koşar, sayı doğrudur, koruduğu şey erir. Panzehir
   § Mandal (tavan) yazma'da: taban sayı değil KÜME olsun. *(d5/ea)*

İlk üçünde kapı yanlış davranır; *gürültü*de doğru davranır ve yine ölür;
*doğru davranışı pahalı kılmak*ta **kapı doğru, kurban haklı**. Yedincide kapı hiç
koşmaz.

⚠️ **`okunmayan tavsiye`nin alt maddesi — ölçüldü 2026-09-13:** *bir uyarıyı OKUMAK
ölçüm sayılmaz; okumamak ise mazeret değildir.* **Yazılı bir uyarı bir kapı
değildir** — aynı gün dört kez doğrulandı: `check-migrations` `[ADVISORY] RESTRICT` ·
`roll-entry-station.helper` başlığı · `roll-step.helper` salınım notu · kök
`CLAUDE.md`'nin cleanup sırası kuralı. Dördü de yazılıydı, dördü de okunmamıştı.

### ⑦ Kapı, koruduğu şeyle ilgisiz bir sebeple sessizce ölebilir

Ölçüm (2026-09-13; 36 oturum günlüğü / 150.712 satır, `toolUseID` ile kesin eşleme):
`.claude/settings.json:23` komut kapısını **göreli yolla** çağırıyor; kabuk depo
kökünden kaydığı an node dosyayı bulamıyor ve Claude Code hatayı **NON-BLOCKING**
sayıyor. **4.962 ölü-kapı olayı · 24 ayrı yanlış dizin.** O komutların 27'si bir
yasağa uyuyordu; **23'ü desenin yanlış pozitifi**, 4'ü gerçek DB düşürmeydi (dördü de
oturumun kendi sonda DB'si). **Canlı veri kaybı ÖLÇÜLMEDİ.**

> **Yapılandırılmış bir kapı da bir kapı DEĞİLDİR — koştuğu ölçülmedikçe.**

⚠️ **Bir kapının ölü olduğunu, o kapının KENDİ ÇIKTISINDAN öğrenemezsin.** Ölü kapı
çıktı üretmez; ölçüm dışarıdan, oturum günlüklerinden geldi.

⚠️ **Fail-open yapılandırmayla kapatılamaz** (platform sınırı): yalnız çıkış kodu 2
engeller, **başlatılamayan kanca daima non-blocking**tir. Tek kalıcı koruma
yapılandırmanın DOĞRULUĞUNU ölçmektir — `Teks-Erp/scripts/test_hook_config.ts`
(`1e364f1b`), bugün bilerek kırmızı: `TEST-VE-DERLEME-SINIRLAR.md` §8.

## Yerel yeşil, BAŞKASININ commit edilmemiş düzeltmesi olabilir

Bir commit kapısı **çalışma ağacını** okur; CI **HEAD'i** okur. Ortak ağaçta ikisi aynı
şey değildir: bir eş oturumun henüz **commit etmediği** düzeltmesi senin koşumunu
yeşile boyar, ama commit'in HEAD'e indiğinde o düzeltme orada YOKTUR.

> **Bir kapıyı, kapatacağı ihlal HEAD'de AÇIKKEN indirme** — yerel yeşil yeterli
> değildir, ihlalin **commit edilmiş** olduğu ölçülür.

*(Vaka 2026-09-13: kimlik tekilliği kapısı çalışma ağacında yeşildi çünkü bir eş oturum
çakışan kimliği düzeltmişti; HEAD'de çakışma DURUYORDU. Kapı o hâlde inseydi ilk CI
koşumunda kırmızı verecek ve düzeltmeyi yapan değil, **ondan sonra commit atan herkes**
cezalanacaktı.)*

**Ölçüm:** yüklemini çalışma ağacına değil `git show HEAD:<yol>` içeriğine uygula.
Kardeşleri § Zengin kontrol grubu ve § Pencerenin BOŞ olduğunu ölçmek
(`OLCUM-DISIPLINI-SINIFLAR.md`).

### Kapsam: yalnız bekçi değil, AĞACI OKUYAN HER ARAÇ

> **Ortak ağaçta çalışan hiçbir aracın yeşili, `HEAD` hakkında bir şey SÖYLEMEZ.**
> `tsc` · `eslint` · bekçi · lint tavanı · mandal — hepsi AĞACI okur, ve ortak ağaçta
> ağaç **hiç kimsenin commit'i değildir.**

Söylemesi için iki yoldan biri: ya `git show HEAD:<yol>` okunur, ya da `git status` ile
ağacın **temiz olduğu AYRICA ölçülür**.

⚠️ **Yön BELİRSİZDİR, bu yüzden tek yönlü panzehir yetmez.** Ağaç bazen HEAD'den
ileridedir (birinin commit edilmemiş düzeltmesi → sahte YEŞİL), bazen geridedir (senin
kendi bozuk düzenlemen → sahte KIRMIZI). Kusur *"ağaç yanlış"* değil, ***"ağaç başka
bir zamanı gösteriyor"***.

*(Vaka 2026-09-13, kuralın yazılmasından ~20 dakika sonra ve **yöneticiyi** yakaladı:
`npx tsc --noEmit -p tsconfig.scripts.json` → **çıkış 0, sıfır hata**; "kalem kapandı"
yazılmak üzereydi. Doğru ölçüm `git status --porcelain` ile dosyanın **M** olduğunu,
`git show HEAD:<yol> | grep` ile de kusurun `main`de HÂLÂ DURDUĞUNU gösterdi. Yeşil,
bir başkasının ağaçtaki commit'siz düzeltmesindendi.)*

📌 Panzehirin kalıbı d5'in üç kapıda uyguladığı **HEAD ↔ ağaç karşılaştırması**dır:
iki tarafı da oku, yalnız ARTIŞI kırmızı say. Kural bir **gözlem**, kalıp onun
**panzehiri**.

### En ağır biçimi: KANCAYA yapılan commit'siz değişiklik

> **Bir KANCAYA yapılan commit'siz değişiklik, HERKESİN kapısını sessizce değiştirir.**

Kaynak dosyada commit'siz bir değişiklik yalnız **ölçümü bulandırır**; kancada
(`scripts/hooks/*`, `.githooks/*`) **altyapıyı değiştirir** — bir hatası olsa her
oturumun commit'i etkilenir ve kimse sahibine atfetmez, çünkü değişiklik hiçbir
commit'te görünmez.

> **Kapı değişiklikleri ağaçta BEKLEMEZ: ya commit'lidir, ya yoktur.**

*(Vaka 2026-09-13: bir oturum commit kapısının `✅ Teks-Erp · tip (+scripts)` satırından
"boşluk kapandı, sayaç durdu" sonucunu çıkardı. Ölçüm: `git status --porcelain` → `M`,
`git show HEAD:scripts/hooks/pre-commit.mjs | grep typecheck:scripts` → BOŞ. Kapı
değişikliği ağaçta bekliyordu.)*

## Kırmızıyı sınıflandırma

`gerçek kusur · testin kendi hatası · çevresel · yapısal olarak ölçülemez`

Dördüncüsü düzeltilecek bir şey değildir; "gerekçesi ölçülmüş atlama"nın karşılığıdır.
**Etiketi ölçmeden yapıştırma** — çevresel olan düzeltilebilir, yapısal olan yalnız
başka bir ortamda ölçülebilir; ikisini ayırmadan verilen hüküm ya gerçek bir kusuru
gizler ya çalışan bir kapıyı gevşetir.

⚠️ **`ARALIKLI` (flaky) bir teşhis DEĞİL, sebebi BULAMAYINCA varılan sınıftır.**
Aramadan varılırsa teşhis değil, **teşhisi erteleyen bir etikettir**. *(1e, kendi
hükmünü daraltarak.)*

> **Bayat KIRMIZI, bayat yeşilden PAHALIDIR.** Bayat yeşil yanlış güven verir; bayat
> kırmızı **var olmayan bir işi kuyruğa koyar** ve bir oturumu ona bağlar. *(d9)*

### ⑧ Uzaktaki kapı, ürünle ilgisiz bir sebeple HİÇ açılmayabilir

Faturalandırma · kota · izin — uzak koşucu işi **başlatmaz**, ama koşum **KIRMIZI
raporlar**. ⑦'den farkı tam burada: ⑦ sessizce ölür, **⑧ gürültülü ölür ve gürültüsü
onu CANLI gösterir.**

**Ölçüm (2026-09-13 01:0x, `gh run list` ile bağımsız doğrulandı):** son başarılı koşum
**2026-08-10 09:50 → 10:02 (11 dk 49 sn)**; ondan 2026-09-13 00:48'e kadar koşumların
hepsi FAILURE ve **3–39 saniye** sürmüş (gerçek paket ~6,5 dk). Altı job'un altısı
*"The job was not started because recent account payments have failed…"* ile hiç
başlamamış. ⇒ **34 gün boyunca uzakta hiçbir test koşmadı.**

> **Koşum SÜRESİ bir sağlık göstergesidir.** 6,5 dakikalık bir paketin 3 saniyede
> kırmızı vermesi testin değil **KAPININ** raporudur.

> **VAKA KAPANDI — 2026-09-13.** Sınıf geçerli, vakası bitti: 00:55:34'te başlayan
> koşum (`8f68c367`) altı job'u da gerçekten çalıştırdı. Pencere **2026-08-10 →
> 2026-09-13 00:48**'dir ve *"CI ölü"* cümlesi bugünden sonra ŞİMDİKİ ZAMANDA
> kurulamaz.

⚠️ Bu, § Geç ölçüm sınıfının **bu belge yazılırken yaşanmış** örneğidir: ortam
ölçümün kendisi sırasında değişti, ve ilk yazım şimdiki zamanlı olsaydı aynı gün
bayatlayacaktı.

⚠️ **Ve kapı açılır açılmaz iş gördü:** 34 günün ilk gerçek koşumunda `Mobil (tsc +
jest)` KIRMIZI verdi. Ölü kapının gizlediği kusurlar, kapı açıldığı gün toplu gelir —
*kapının kapalı olduğu süre, biriken kusurun ölçüsüdür.*

⚠️ **O 34 gün boyunca push öncesi tek gerçek kapı yerel `npm test`ti.** Bu, *"bir
tasarımın 'arka durağı var' cümlesi de bir İDDİADIR"* kuralının en pahalı örneği: aynı
hafta `.githooks/`te `pre-push` olmadığı ölçülmüştü — **aynı iddia bir kat yukarıda da
yanlışmış.** Arka durak varsayımı iki katmanda birden çürüdü.

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

## Bir kapının yeşili, ÖLÇTÜĞÜ İKİ UÇLA sınırlıdır

Bir kapı iki şeyi karşılaştırır. **Düzeltmeyi ÜÇÜNCÜ bir uca yaparsan kapı yeşil verir
ve yeşil YALAN olur.**

*(Vaka `d4cc3ea0`, 2026-09-13 — yakın kaçış: bir düzeltme betiği "düzeltildi" bastı ama
dosyaya HİÇBİR ŞEY yazmamıştı. Farklar **DB'de elle** kapatılınca `test_schema_drift`
yeşile döndü — oysa o bekçi **şema ↔ DB** karşılaştırır, **migration DOSYASI ↔ DB**
değil. Taze bir kurulumda — sahada, CI'da, yeni test DB'sinde — BAŞKA bir şema
doğacaktı. Taze DB'de baştan deploy yakaladı.)*

**Savunma:** kapının adını okurken *"hangi İKİ ucu karşılaştırıyor"* diye sor ve
düzeltmeyi o iki uçtan birine yap. Kapının göremediği üçüncü uç, kapının kapsam
beyanına yazılır.

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
