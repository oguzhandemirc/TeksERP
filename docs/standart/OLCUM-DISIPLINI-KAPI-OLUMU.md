# Ölçüm disiplini — KAPININ ÖLÜMÜ ve KIRMIZININ okunması

[`OLCUM-DISIPLINI-KAPI.md`](OLCUM-DISIPLINI-KAPI.md)'nin ikinci yarısı; 2026-09-13'te
oradan **bölünerek** geldi (o dosya tavana 1,5 KB kalmıştı ve haftanın en hızlı yazılan
ölçüm dosyasıydı — 7 günde 8 commit; tavan yükseltilmedi).

**Çizgi:** orada bir kapı **YAZILIR** (mandal, cırcır, taban, tavan, tanecik, sonda);
**burada bir kapı ÖLÜR ya da KIRMIZI verir ve o kırmızı OKUNUR.** İkisinin ortak yanı
kapıdır, ama soruları terstir: *"nasıl kurarım"* ↔ *"bu yeşil/kırmızı ne diyor".*

⚠️ **En sık hata burada başlar:** bir kırmızının sebebi çoğu kez koruduğu şey DEĞİLDİR
(§ ⑦, § ⑧) — ve bir yeşilin sebebi çoğu kez senin kodun değildir (§ Yerel yeşil).

Ölçüm yöntemi ve sayı yazma [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de; arıza sınıfları
[`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) (alet) ·
[`OLCUM-DISIPLINI-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md) (ne/nereye sorduğun) ·
[`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) (kurgu) ·
[`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md) (paylaşılan ortam) ·
[`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) (KATMAN 2).

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
10. **Assert etmeyen kapı** — ölçüm yapılır, sayı **basılır**, ama hiçbir `check`
   ona bağlı değildir; "K = 0 kapısı" diye anılan şey bir **bilgi satırıdır**. Kapı
   koşar, çıktısı doğrudur, sayı 5'e çıksa da yeşil kalır — ve herkes o sayıyı "kapı
   tutuyor" diye taşır. *(Vaka 2026-09-13: `test_stok_defteri_bag_olcumu §4` gerçek
   ağacın K'sını `bilgi:` satırına basıyordu; beş kapısız yol bulunduğunda anlaşıldı.
   Panzehir: her basılan sayı ya bir `check`in konusudur ya "bilgi" damgasını
   TAŞIR ve belgede kapı diye anılmaz.)* *(6e/1c)*

11. **Beyan VAR, mekanizma YOK** — kapı *"N atlandı"* basabilecek biçimde yazılmıştır
   ama sayacı hiç artmaz: beyan **sözdizimsel ayakta, semantik ölü**. Çıktı her koşumda
   "0 atlandı" der ve bu *"hiçbir şey atlanmadı"* diye okunur; oysa ölçülen hiçbir şey
   yoktur. *(Vaka 2026-09-14: `test_label_dirty_sources`; d9 buldu ve `lib/atlama`ya
   bağladı — `1e20acfb`/`75df651b`.)* Panzehir: beyan eden bekçi ortak defteri İTHAL
   eder (kopya defter yasak, mandal `test_atlama_defteri`); kopya defter, ilk gün doğru
   yazılsa bile ikinci gün sessizce ölür.
12. **Beyan VAR, sayı YOK — iki okuyuculu beyan tek okuyucuya görünür** — atlama İNSANA
   görünür (`(DB bölümü atlandı)` gibi serbest metin) ama MAKİNEYE görünmez (koşucunun
   `Sonuç:` ayrıştırıcısı sayı ister ve serbest metni **0** sayar). Toplamda kapsam
   kaybı **sıfır** görünür. *(Vaka 2026-09-14: `test_peripheral_for_device`; d9.)*
   ⇒ ***İki okuyuculu her beyan İKİ okuyucuya da görünmeli*** — bekçi çıktısı,
   `ApiResponse.warnings`, harita hücresi, sürüm notu: hepsi aynı sınıf.

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

### ⑨ HEDEF BAYATLIĞI — dünya değişir, kapının elle seçtiği örnek bayatlar

Bir kapı bir SINIFI korur ("kilitli seri düzenlenemez"), ama iddiasını o sınıfın ELLE
SEÇİLMİŞ bir ÜYESİ üstünden kurar. Üye sınıftan çıktığı gün iddia ölçmeyi bırakır — ve bu
İKİ YÖNDE de bozulur:
- **sessiz körlük:** seçilen üye artık o sınıfın örneği değildir, iddia vakumen yeşildir;
- **yanlış kırmızı:** korunan şey BAŞARILDIĞI için kapı kırmızı verir ve düzeltme isteyen
  taraf, aslında hedefi tazelemek zorundadır.

*(Ölçüldü 2026-09-23, tek günde BEŞ kez: `test_number_series_scope §4` hedefi üç kez elle
başka bir seriye çekildi · `test_number_series_panel §1` ve `§3`ün örnekleri açıldı ·
`test_config_bundle §9c` iş emrinin HANE eksenini kullanıyordu ve o eksen açıldığı gün
"paket kapıyı dolanıyor" diye kırmızı verdi — oysa paket doğru davranıyordu. Beşincisi
bir GERÇEK kusuru da gizliyordu: hedef tazelenince önizleme ile yazmanın ayrıştığı ortaya
çıktı.)*

⇒ **Hedef ELLE SEÇİLMEZ, KEŞİFLE BULUNUR:** kapı sınıfın bir üyesini çalışma anında
kataloğdan/şemadan arar ve bulduğunu ÇIKTISINA YAZAR (`… (keşfedilen hedef: X)`), ki
neyin ölçüldüğü koşumdan okunabilsin.
⇒ **Üye kalmazsa sonuç ÜÇÜNCÜ HÂLDİR:** *ölçülemedi — iddia artık gözlemlenemiyor.*
"Uyumlu" demek, ölçülmemiş bir şeyi ölçülmüş göstermek olurdu.
⇒ **Kapanış koşulu böylece ÖLÇÜLEBİLİR olur:** kapı kendi gereksizleştiğini söyler. O
noktada doğru hareket bölümü SİLMEKTİR — ama silmenin ön koşulu, korunan davranışı ölçen
BAŞKA bir kapıyı adıyla göstermektir.
⚠️ **Sonucu UYGULAYAN bir iddia bayatlarsa kalıcı VERİ de bırakır:** `§9c` reddedilmesini
beklediği paket kalemini uyguladı ve iki ayrı test veritabanında seriyi 5 haneye taşıdı.
Bu yüzden yazan her iddia, kapı bozukken yazdığını da ID ile geri alır.

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
Kardeşleri § Zengin kontrol grubu (`OLCUM-DISIPLINI-SINIFLAR.md`) ve § Pencerenin BOŞ
olduğunu ölçmek (`OLCUM-DISIPLINI-ORTAK-AGAC.md`).

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

⚠️ **POPÜLASYONUN TAMAMI aynı anda kırmızıysa önce ALETİ şüphelen.** Gerçek kusur
DAĞILIR: on dosyanın üçü, kırk kuralın altısı. *"Hepsi"* bir kusur deseni değil, bir
ALET desenidir — yanlış yazılmış tek bir yüklem her üyeyi aynı anda düşürür.
*(Vaka 2026-09-14: bir ön kontrol, dizin dosyasının **10 dosyanın 10'unda** "beyan YOK"
dedi; sebep desende bir karakterdi — `` `) `` yazılmıştı, doğrusu `` `] ``. Düzeltilince
10/10 temiz. Aynı gün gerçek kapı aynı veriyi 9/9 yeşil ölçmüştü ⇒ iki ölçüm ÇELİŞİYORDU
ve çelişkinin tarafı hangisiyse hatalı olan oydu.)*
📌 Ucuz ayırt edici: **oranı oku.** %100 ve %0 aletin imzasıdır; aradaki her şey
olgununkidir. ⇒ Önce pozitif kontrol (*bu desen BİLİNEN bir üyeyi buluyor mu?*), sonra
hüküm. Kardeşi § 1 · Araç bozuk (`OLCUM-DISIPLINI-ARAC.md`).

⚠️ **Ve karşı uçta: SÜREKLİ bir kırmızı sessiz değildir, DUYULMAZDIR.** Her turda kırmızı
basan bir kapı listeyi okuyanın gözünde arka plana karışır ve **YENİ bir kırmızıyı da
gizler**; bedelini yalnız borcun sahibi değil, o listeye bakan herkes öder. *(d9,
`c3ba2d94`, ölçüldü 2026-09-14; emsal: stok defterinin `K_TABAN` cırcırı.)*
📌 Panzehir, kapıyı gevşetmek DEĞİL: beklenen kırmızıyı **BEYAN** et — tarih + sahip +
KAPANIŞ KOŞULU taşıyan bir girdi (`BEKLENEN_EKSIK` kalıbı). Beyanlı olan kırmızı basmaz,
**beyansız olan basar**; ve beyan kendi kendini tazeler: koşul gerçekleşince girdi ölü
muaf olur ve kapı onu da söyler.

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

### Bir kapının TETİĞİ bir OLAYI ölçer; TANISI bir ANLAM iddia eder
Kırmızının doğru olması, kırmızının **cümlesinin** doğru olduğunu göstermez. Tetik bir
olayı görür ve bu ölçülebilir; tanı o olayın NE ANLAMA GELDİĞİNİ söyler ve **bu ayrı bir
ölçümdür, tetiğin içinde yapılamaz.** ⇒ İkisi ayrı ayrı yanlışlanabilir — ve **tanı daha
kolay yanılır, çünkü onu hiçbir şey ölçmez.**

*(Vaka 2026-09-13: `test_dokuma_rapor_onkosullari` §3d, envanter dışı bir
`MachineDataSource` kolonu doğduğunda kırmızı verecek şekilde kurulmuştu — tetiği bir ad
tahmini değil DAVRANIŞTI ve ilk kez `doff_events.counterSource` ile uyandı. **Uyanış
doğruydu.** Ama mesaj kesin konuşuyordu: *"YENİ bir kaynak kolonu, raporun TAŞIYICISININ
geldiğini söyler ⇒ ÇIKTI bekçisi yazılmalı."* Şemada ölçüldü: `counterSource`,
`counterAtDoff` ile çift çalışan, doff'taki sayaç okumasının KÖKENİNİ taşıyan bir **olay
kolonu** — kaynak-beyanı ailesinden, ama raporun taşıyıcısı DEĞİL.)*

*(İkinci vaka, aynı gün: bir watchdog dosya tavanı aşıldığı için **doğru** ateşledi, ama
tanısı *"asılı kaldı"* dedi; üç bağımsız ölçüm dosyanın yalnız **yavaş** olduğunu gösterdi
— 42 sn. Aynı imza: olay gerçek, anlam uydurma.)*

> **Tetik mesajı KESİN değil SORU kurar:** *"şu geldi"* der, *"şu demektir"* demez.
> Sınıflandırmayı okuyandan ister, kendi yapmaz.

**Savunma:** mesajı iki parçalı yaz — ① ne ÖLÇÜLDÜ (olay, adıyla) ② hangi AYRIMIN
yapılması gerekiyor (şıklarıyla). Tanı bir kez yanıldıysa **satır kendi yanılgısını
taşısın** (*"bu satır önce (a)yı kesin söylüyordu ve ilk uyanışında YANILDI"*) — bir
envanterin güvenilirliği, çürütülen satırlarını da taşımasıyla ölçülür.
Kardeşleri § Bir kapının "neden kırmızı" cevabı, kapının ÇALIŞTIĞINI varsayar ·
`OLCUM-DISIPLINI-YUKLEM.md` § Sınırsız eşleşme (yüklem neyi tutar) ve § NE sorduğun kadar
NEREYE sorduğun (yüklem nereye bakar) — bu ikisi tetiğe, buradaki tanıya aittir.
Ve `OLCUM-DISIPLINI.md` § Teşhis mesajı da bir yüklemdir (tanının YÜKLEMİ) ·
§ Teşhis mi, ölçüm mü — kurala çevirmeden önce (tanının KURALA dönüşmesi).

### Bir kırmızı ÖTEKİNİ GİZLER — ilk kırmızı düzelene kadar ikincisi YOKTUR
Kırmızı bir dosyaya ikinci bir kırmızı eklendiğinde **hiçbir şey değişmez**: koşum zaten
kırmızıydı, sayaç zaten artmıştı, okuyan zaten *"bu dosya kırmızı"* diye biliyordu. İkinci
kusur **doğduğu gün görünmez** ve ilk kusur kapanana kadar da görünmez — yani en uzun
yaşayan kusur, en gürültülü komşunun yanındakidir.

*(Vaka 2026-09-14: `ENTRY_CORRECTION` yazıcısı bir bekçinin FK temizliğini kırdı; kırmızı
**#49'dan beri** oradaydı ama aynı dosyanın başka bir kırmızısının arkasında durduğu için
hiçbir turda fark edilmedi.)*

> **Bir bekçinin KIRMIZI SAYISI da bir ölçümdür** — "kırmızı mı" ikili sorusu, içeride
> kaç kusur olduğunu gizler. Kırmızı bir dosyayı düzeltirken *"kaç ❌ vardı, kaç kaldı"*
> yaz; sayı düşmüyorsa düzelttiğin kusur başkasıydı.
📌 Panzehir iki adım: ① kırmızı bir dosyaya dokunan commit, o dosyanın ❌ SAYISINI önce ve
sonra basar · ② "bilerek kırmızı" kaydı ADIYLA ve SAYISIYLA tutulur (`BEKCI-HARITASI.md`
§ bilerek-kirmizi) — sayı tutulmazsa yeni bir kusur eski gerekçenin altına saklanır.
Kardeşleri § Bir kırmızının MESAJI, hangi kontrolün kırmızı olduğunu söylemez ·
§ SÜREKLİ bir kırmızı sessiz değil DUYULMAZDIR (aynı ailenin öteki ucu).

### Bir kırmızının MESAJI, hangi kontrolün kırmızı olduğunu söylemez
Kontrol **etiketi** ile kontrol **mesajı** ayrı iki bilgidir ve yalnız etiket hangi
iddianın düştüğünü söyler. Mesaj paylaşılabilir: iki ayrı kontrol aynı metni basıyorsa,
elde yalnız mesaj kalınca **geçen** ile **düşen** birbirinden ayırt edilemez.

*(Vaka 2026-09-13, d9: bir aralıklı kırmızının kökü, `❌` **etiketi** görünene kadar
bulunamadı — koşucunun son-30 satır penceresi etiketi düşürüyordu ve elde kalan mesaj,
**geçen** bir kontrolünkiyle birebir aynıydı. Üç hipotez kuruldu, üçü de yanlıştı; kök
sebep ancak etiket geri gelince göründü.)*

> **Kırmızıyı ADIYLA oku.** Pencere kırpıyorsa pencereyi büyüt, mesajdan tahmin yürütme —
> *"mesaj şuna benziyor"* bir teşhis değil, bir benzerlik gözlemidir.

**Savunma:** koşum çıktısını kırpan her araç (pencere, `tail`, `head`, grep süzgeci)
etiketi de kırpabilir; kırmızı ararken süzgeci **etiket satırına** kur, mesaja değil.
Kardeşleri § Bir kapının TETİĞİ bir OLAYI ölçer; TANISI bir ANLAM iddia eder ·
`OLCUM-DISIPLINI-SINIFLAR.md` § SONDA ailesi (e: çıktı kırpıldı).

### …ve etiketi SÜZGEÇ de yiyebilir — damga süzgecinin deseni metnin içinde de geçer
Üstteki sınıfın ikinci kapısı: etiket **basılmış** olabilir ve yine de elinize
ulaşmayabilir, çünkü araya koyduğunuz **damga süzgeci** onu yutmuştur. Bu, *araç
gözlenenin içinde* ailesinin (`OLCUM-DISIPLINI-ARAC.md` § 4) log tarafındaki hâlidir:
süzgecin deseni, süzdüğü metnin İÇİNDE de geçiyor.

*(Vaka 2026-09-13, yeniden üretildi: CI logundan damga `sed 's/.*Z //'` ile kesiliyordu.
Bekçi etiketi **`… GÖRÜNMEZ`** — yani **Z ile bitiyor**. `.*` açgözlü olduğu için süzgeç
SON `Z ` eşleşmesine kadar her şeyi sildi ve geriye yalnız mesaj kaldı.)*

```
ham      : 2026-09-13T10:22:31.004Z ❌ pasif değer hata listesinde GÖRÜNMEZ — 'X' geçerli değil
.*Z      : — 'X' geçerli değil                       ← etiket VE ❌ işareti gitti
^[0-9…]Z : ❌ pasif değer hata listesinde GÖRÜNMEZ — 'X' geçerli değil
```

⚠️ **Kayıp yalnız etiket değil, KIRMIZI İŞARETİNİN KENDİSİ (`❌`) oldu** — yani çıktı
"hiç kırmızı yok" gibi okundu. Rapor *"etiket yok"* diye çıktı; etiket vardı.

> **Damga süzgeci BAŞLANGICA ÇAPALI olur** (`^[0-9T:.-]+Z `) ya da hiç süzme.
> Serbest `.*` içeren her süzgeç, süzdüğü metnin kendi kelimelerine açıktır.

Kardeşi § Bir kırmızının MESAJI, hangi kontrolün kırmızı olduğunu söylemez ·
`OLCUM-DISIPLINI-YUKLEM.md` § Sınırsız eşleşme (aynı gevşeklik, ölçüm tarafında).
