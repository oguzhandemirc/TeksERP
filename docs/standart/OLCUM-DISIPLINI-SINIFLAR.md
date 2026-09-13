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

**Savunma:** sınırı olan her araçta (yığın derinliği, sonuç tavanı, `head`, `grep -m`,
ajan çıktı kırpması) sınırı ÖNCE kaldır, sonra ölç.

### Ölçümün KURULUM adımı da ölçülen sistemin içindedir
*"Önce generate, önce build, önce migrate"* bir hazırlık **REFLEKSİDİR** — ölçüm değil
**MÜDAHALE**, ve gerekliliği ölçülmeden koşulmaz.
*(Vaka 2026-09-13: bir worktree'nin `node_modules`ü ana ağaca symlink'liydi; `prisma
generate` symlink'in ucundaki ORTAK dizine yazdı ve başka bir oturumun kodu 8 tip
hatası verdi — "şema aynıydı, sırf refleksle koşturdum".)*
**Savunma:** her hazırlık komutundan önce iki soru: **nereye yazıyor** ve **gerçekten
gerekli mi?**

### Paylaşılan `node_modules` üstünde worktree, izolasyon değil TAKLİTTİR
O worktree'de koşan her **üretim** komutu — `generate` · `install` · `npx` ·
`tsc --build` · `.cache` yazan her araç — ana ağaca yazar. `prisma generate` okuma
gibi görünür, **YAZAR**.
⚠️ Ortak ağaç riskinin **altıncı ısırığı**, ve ilk beşin panzehirleri (pathspec
commit · worktree · adıyla stage'leme) burada **TUTMAZ**: onlar *dosya* üzerindeydi,
bu **üretilmiş artefakt** üzerinde.
**Savunma:** izolasyon iddiası ancak `node_modules` ve üretilmiş çıktı dizinleri de
ayrıyken kurulur.

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

### "Ölçemiyoruz" ile "ölçmek için aracı KURMADIK" aynı cümle değildir
Araç eksikliğini bir **bilgi sınırı** sanmak. İlki dünyanın özelliği, ikincisi
masanın.
*(Vaka: bir kalem bir hafta boyunca "kanıtlanamaz — bu makinede `gh` yok" diye açık
bırakıldı. `gh` kurulumu on dakika sürdü ve cevap ANINDA çıktı.)*
**Savunma:** "ölçemiyoruz" yazmadan önce, ölçmek için gereken aracın **kurulma
maliyetini** yaz. Yazamıyorsan cümle "kurmadık"tır.

### Bir kapının "neden kırmızı" cevabı, kapının ÇALIŞTIĞINI varsayar
Kırmızının sebebini ararken kapının koştuğu **sorulmamış bir öncüldür**.
*(Vaka: üç ORTAM kırmızısı, uzak kapının kalıcı kırmızılığının sebebi sanıldı; gerçek
sebep kapının **hiç koşmaması**ydı.)*
**Savunma:** sebep aramadan önce kapının KOŞTUĞUNU ölç — süre, adım sayısı, çıktı
hacmi. Kardeşi: `OLCUM-DISIPLINI.md` § Kapının ölüm biçimleri ⑦–⑧.

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

### Adıyla stage'lemek YETMEZ — indeks paylaşılan DURUMDUR
Ortak ağaçta `git add <dosya>` doğru refleks ama **koruma değil**: dosyan artık
PAYLAŞILAN indekstedir ve **başka bir oturumun pathspec'siz `git commit`i onu kendi
commit'ine alır.** Kayıp dosya değil, **gerekçedir** — iş ağaçta durur, commit mesajı
başkasınındır ve o mesaj artık ne olduğunu YANLIŞ anlatır.
*(Vaka 2026-09-13 05:19: adıyla stage'lenmiş üç dosya, komşu bir oturumun
`git add <kendi dosyası> && git commit` çağrısıyla onun commit'ine girdi. Aynı anda
başka bir oturum `git commit -F … -- <yol>` biçimini kullanıyordu ve o hiç etkilenmedi.)*
> **Panzehir: stage etme.** `git commit -- <pathspec>` tek adımdır ve indekste pencere
> bırakmaz. `git add` + `git commit` iki adımdır; aradaki her saniye açık bir kapıdır.

⚠️ Ortak ağaç riskinin **yedinci ısırığı** ve önceki panzehirlerin en çok güvenileni
(*"adıyla stage'le"*) tam burada yetersiz kalıyor — çünkü o kural **kendi commit'ini**
dar tutar, **başkasınınkini** değil.

### `.git/index.lock` bir KUYRUK değil, bir REDDİR
Paylaşımlı ağaçta eşzamanlı commit **serileştirilmez**; ikincisi düşer.
*(Vaka: iki oturum aynı anda commit attı. Doğru hamle kilidi SİLMEK değildi — gerçek
bir süreç tutuyordu — bekleyici kurmaktı.)*
⚠️ Tehlikesi bir üstteki sınıfa açılır: **aynı saniyede deneyen biri sessizce düşer ve
çıkış kodunu ölçmeyen fark etmez.**
**Savunma:** kilidi asla körlemesine silme (önce tutan süreci ölç); commit'i bekleyici
ile sıraya sok ve çıkış kodunu OKU.

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

## KATMAN 2 · Ölçümden sonraki adım → ayrı dosya

[`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) (`docs/standart/OLCUM-DISIPLINI-CIKARIM.md`) — 2026-09-13'te buradan bölündü; katalog o gün **+20 sınıf** aldı ve bu dosya tavana 1.667 bayt kalmıştı. Tavan yükseltilmedi.

⚠️ Katman 2'de **gözlem DOĞRUDUR ve doğrulanmıştır** — bu yüzden ondan çıkarılan açıklama da doğrulanmış sanılır. **Hiçbir pozitif kontrol o katmanı yakalamaz.**
