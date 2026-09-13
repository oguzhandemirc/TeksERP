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

## Arıza sınıfları → ayrı dosya

Katalog iki katmanlıdır — **KATMAN 1** ölçümün kendisi (*sayı doğru mu?*), **KATMAN 2** ölçümden sonraki adım (*sayı doğru; ondan ÇIKARILAN ne?*) — sırasıyla [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) ve [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de yaşar.

Bölünme sebebi ölçüldü: katalog 2026-09-13'te tek günde **+16 sınıf** aldı ve bu dosya tavana dayanacaktı. Ayrım çizgisi bugünkü dört bölmeyle aynı — **YÖNTEM kalır, sınıf ENVANTERİ ayrılır**; sınıflar büyür, aşağıdaki yöntem kuralları büyümez.

⚠️ **KATMAN 2 daha sinsidir:** Katman 1'de ölçüm yanlıştır ve pozitif kontrol/örnekle doğrulama onu yakalar. Katman 2'de gözlem DOĞRUDUR ve doğrulanmıştır — bu yüzden ondan çıkarılan açıklama da doğrulanmış sanılır. **Hiçbir pozitif kontrol o katmanı yakalamaz.**

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
- **Kalan her sayı, onu ÜRETEN KOMUTLA birlikte yazılır.** `"76 sonekli helper"`
  değil, `` `find src -name '*.helper.ts' | wc -l` → 76 (2026-09-06)``. Böylece sayı
  bayatlasa bile **yanlışlanabilir kalır**; komutsuz sayı ne doğrulanabilir ne
  çürütülebilir.

⚠️ **Ölçüldü 2026-09-13 (örneklem: 95 sayı iddiasından 15, seed'li rastgele):**
kural satırlarındaki sayıların **9/15'i YENİDEN ÖLÇÜLEMEDİ** — bayat oldukları için
değil, **yüklemlerini taşımadıkları için**. *"269 servis dosyasında 2 kullanım"* —
hiçbir okuma 269 vermiyor (`*.service.ts` 118 · `src/services` altındaki tüm `.ts`
292); hangi kümenin sayıldığı yazılı değil. Bu, § Kapsamını yitirmiş ölçüm sınıfının
kural-kitabı tarafındaki hâlidir ve **eksik olan kural değil, uygulanmasıdır** —
yukarıdaki madde bu turdan ÖNCE de yazılıydı.

> **"Sağlıklı" burada "yanlış değil" demektir, "doğrulanabilir" demek DEĞİL.**

Ayırt etme yöntemi: *cümleyi bugün okuyan biri ondan ne çıkarır — "o gün böyleydi"
mi, "bugün böyle" mi?*

- **Bir sayı, alındığı KAPSAM ve AN'la birlikte taşınır.** Bir mandal/tavan bir ANın
  fotoğrafıdır; ölçüm tabanı **beyan edilir**. *(1e/ea)*
  ⚠️ **Ve taban yalnız COMMIT değildir: ağaç + VERİTABANI birlikte beyan edilir** —
  aynı commit'te farklı DB'de ölçmek farklı sayı verir. *(6e, yanlış DB'de ölçüp
  kendi yakaladı.)*
- **Bir boşluk sayısı, boşluk BÜYÜYORSA bir ölçüm değil bir ZAMAN DAMGASIDIR.** *(6e:
  defter boşluğu günde ~100 top büyüyordu — "şu kadar eksik" cümlesi ertesi gün yanlış.)*
  Büyüyen bir boşluk sayı ile değil, **hız ve tarih** ile yazılır.

> **Var olmayan bir sayı bayatlayamaz.**

## Mandal (tavan) yazma

Bir mandal — `devralınan: N`, `lint-baseline.json`, herhangi bir "yalnız düşer" sayısı —
iki kuralla hareket eder:

> **Mandal yalnız SIKILAŞTIRAN yönde ve yalnız AZ ÖNCE ÖLÇÜLEN değere hareket eder.**

**Yükseltmek ihlali ONAYLAMAK, düşürmek kazanımı KİLİTLEMEKTİR** — ve düşürme
**düzeltmeyle AYNI commit'te** olur, yoksa kazanım bir sonraki eklemede sessizce geri
verilir. *(1e)*

## "Kapalıdır" diyen cümle kapıyı adıyla taşır

> **Bir belgede *"tamdır / kapalıdır / artık olmuyor"* diyen her cümle, onu kapalı
> tutan KAPIYI adıyla taşır; taşımıyorsa cümle bir ÖLÇÜM değil bir ANIDIR.** *(1e)*

Kapısı yazılmayan bir "kapandı" cümlesi, yazıldığı gün doğrudur ve ertesi gün
yanlışlanamaz hâle gelir.

## Kimlik yazma — repo PUBLIC

Ölçüldü 2026-09-13: depo **herkese açık** (`gh repo view` → `visibility: PUBLIC`).
Belgelerdeki ölçümler bu yüzden iki farklı sınıfa ayrılır:

- **Sayı SERBEST** — 4.962 olay · 2.205 topun 1.678'i · 103/0/3. Vakayı taşıyan şey
  budur.
- **KİMLİK YOK** — barkod · çuval no · parti no · müşteri/cari adı · kullanıcı adı ·
  cihaz kimliği. Vaka *"bir top"*, *"bir müşteri kartı"*, *"bir tablet"* ile
  anlatılır; somut kimlik hiçbir şey eklemez.

Ayırt etme yöntemi: *bu dizgeyi bir yabancı okuduğunda fabrikanın hangi kaydına
işaret ettiğini bulabilir mi?* Bulabiliyorsa kimliktir ve çıkar.

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

## Hangi hipotez ölçülür

> **Bir hipotezin değeri DOĞRU ÇIKMASIYLA değil, ölçülmesinin UCUZ ve sonucunun AYIRT
> EDİCİ olmasıyla ölçülür.** *(1e)*

Çürüyen ucuz bir hipotez, ölçülmemiş doğru bir sezgiden iyidir — ve çürürken çoğu kez
aranmayan bir şey bulur.

## Bir turda ne taşınır

> **Bir turda taşınan her commit ya bir SORU sorar ya bir ÖLÇÜM ARACI taşır.** *(1e)*

Dışarıda tutulacak olan, **ölçüm aracının KALİBRASYONUNU** değiştirendir: aracı turun
ortasında ayarlamak, turun başındaki ölçümlerle sonundakileri karşılaştırılamaz kılar.
