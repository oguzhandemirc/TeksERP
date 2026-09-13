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

> ⚠️ **Bir ölçümü KAPIYA çevirmek ayrı bir iştir ve ayrı dosyadadır:**
> [`OLCUM-DISIPLINI-KAPI.md`](OLCUM-DISIPLINI-KAPI.md) — mandal yazma · kapının ölüm
> biçimleri · kırmızıyı sınıflandırma · yerel yeşil ↔ HEAD · "kapalıdır" diyen cümle ·
> ölçüm bir kararı değiştirebiliyor mu. **Burası ölçümün NASIL YAPILDIĞI ve NASIL
> YAZILDIĞI**; orası ölçümün NASIL ZORLANDIĞI.

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

Katalog iki katmanlıdır — **KATMAN 1** ölçümün kendisi (*sayı doğru mu?*), **KATMAN 2** ölçümden sonraki adım (*sayı doğru; ondan ÇIKARILAN ne?*) — üç dosyada yaşar: KATMAN 1 ikiye ayrıldı — [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) (ölçümün **ARACI**) ve [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) (ölçümün **KURGUSU**); KATMAN 2 [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de.

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

⚠️ **Ve bir sayı değişmediği hâlde birkaç kez DEĞİŞTİYSE, değişen şey sayı değil
YÜKLEMDİR.** *(Vaka 2026-09-13: aynı soruya dört tur — 87/50/43 → 24/90/17 → 47/20 →
14 — ve arada ağaçta hiçbir şey değişmedi; her turda "sembol"ün ve "yol"un tanımı
sessizce değişmişti. Üçüncü sayı bir plana çevrilmişti.)*
**ÇÖZÜLMÜŞ EMSAL (2026-09-13) — dört sayı, dördü de DOĞRU:** *"kaç kesik alan var"*
sorusuna dört oturum dört sayı verdi (64 · 68 · 70 · 72) ve hiçbiri yanlış değildi:

| sayı | yüklem | ağaç |
|---|---|---|
| **64** | uzunluk `=== 80`, kural satırındaki **her** backtick span'ı | bir oturumun ağacı |
| **57** | uzunluk `=== 80`, yalnız **`bekçi:` alanı** | kapının kendi ölçümü |
| **63** | `=== 80` **∨ parantez dengesiz**, `bekçi:` alanı | aynı ağaç |
| 68 · 70 · 72 | aynı ikili yüklem | **başka ağaçlar**, farklı commit'ler |

⇒ Sayıyı iki şey birden oynattı: **yüklem** (tek imza ↔ iki imza; her span ↔ tek alan) ve
**ağaç** (kimin commit'leri dâhil). ⇒ Bir sayı taşınırken **ikisini birden** taşımalı.

> **Yüklem yazılmadıkça sayı TAŞINAMAZ** — ve alan kişi de sorumludur: yüklemsiz gelen
> bir sayıyı yüklemini sormadan plana çevirmek, onu üretmekle aynı sınıftır.

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

## Çapa yazma

> **Bir çapa, işaret ettiği yeri TEK BAŞINA bulduruyorsa çapadır.**

Ölçüsü ucuz: `git grep -l <sembol> | wc -l`. Ölçüldü 2026-09-13 —
`resolve` **858 dosyada** geçiyor (çapa DEĞİL) · `$transaction` 252 · `buffer` 73 ·
`setItem` 43 · `EN_AZ_TABLO_TOKEN` **2** (çapa).

⚠️ **İki şerh, yoksa kural kendi tuzağına düşer:**

1. **Ayırt edicilik ZAMANLA DÜŞER.** Bugün 2 dosyada geçen bir sembol yarın 40'ta
   geçebilir. ⇒ Çapayı seçerken sayıyı da yaz — `EN_AZ_TABLO_TOKEN (2, 2026-09-13)` —
   yoksa çapa kuralının kendisi bayatlar.
2. **`dosya:satır` bir ÇAPA değildir ama bir KONUMDUR**, ve ayırt edici bir sembol
   yokken hâlâ en iyisidir. ⇒ Kural *"satırı sil"* DEMEZ; **"ayırt edici bir sembol
   VARSA onu EKLE"** der. Ekleme, silmeden farklı bir iştir.
3. **Deterministik bir çapa varsa, sayı çapası KALDIRILIR — tazelenmez.** Bayat satır
   numaralarını güncellemek *saati sıfırlamaktır*: aynı çapa yarın yine kayar.
   *(Vaka `76b5a739`, 2026-09-13: bir tablodaki 12 şema satır çapasının 12'si de kaymıştı
   (~600 satır). Sayılar tazelenmedi, çapalar KALDIRILDI — model adı zaten deterministik
   bir çapadır: `grep "^model X"`.)*

*(Vaka 2026-09-13: 14 "dönüştürülebilir" çapa adayının 3'ü iyileşiyordu, 10'u
`dosya:satır`dan DAHA belirsiz bir yere işaret ediyordu, 1'i sahte eşleşmeydi —
gösterdiği sembol o dosyada hiç geçmiyordu. Dönüşüm işi bu ölçümle İPTAL edildi.)*

📌 **"Ayırt edici sembol EKLE" işi de ÖLÇÜLDÜ ve KAPANDI** (ön kayıtlı, 2026-09-13):
çözülen **47** çapanın **14'ünde** aday sembol var, ama yalnız **4'ü** ayırt edici
(`git grep -l` ≤ 5 dosya) — ve dördü de o sembolü **zaten taşıyor**. Kalan **33 çapada
hiç aday sembol yok**: orada `dosya:satır` gerçekten tek seçenek.
⇒ Eklenecek çapa **sıfır**. Ön kayıtlı bant *"≤4 → kalem değil, kapat"* idi; kalem
kapandı. *Bu, ölçümün bir işi doğurmak yerine ORTADAN KALDIRDIĞI üçüncü vaka.*

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

## Teşhis mi, ölçüm mü — kurala çevirmeden önce

> **Bir teşhis, ölçülmeden kurala çevrildiğinde yanlışlığı da KURUMSALLAŞIR** — ve
> düzeltmesi artık bir commit gerektirir.

*(Vaka 2026-09-13, üç adımlı zincir: bir oturum ölçmeden teşhis koydu · ikincisi onu
kurala çevirip İNDİRDİ · üçüncüsü ölçüp çürüttü. Kural kalıcı bir dosyaya yazılmıştı.)*

⇒ Kurala çevirmeden önce sor: **bu bir ÖLÇÜM mü, bir TEŞHİS mi?** — teşhisin sahibi
yönetici oturum olsa bile. Teşhis bir hipotezdir; kural bir taahhüt.

⚠️ Ve **yanlış panzehir, panzehirsizlikten kötüdür**: doğru refleksi tüketir. Yanlış
çıkan bir sınıf düzeltilirken **mekanizması** değiştirilir, başlığı değil — okuyan aynı
adı arayıp yeni mekanizmayı bulmalı.

## Hangi hipotez ölçülür

> **Bir hipotezin değeri DOĞRU ÇIKMASIYLA değil, ölçülmesinin UCUZ ve sonucunun AYIRT
> EDİCİ olmasıyla ölçülür.** *(1e)*

Çürüyen ucuz bir hipotez, ölçülmemiş doğru bir sezgiden iyidir — ve çürürken çoğu kez
aranmayan bir şey bulur.

## Bir turda ne taşınır

> **Bir turda taşınan her commit ya bir SORU sorar ya bir ÖLÇÜM ARACI taşır.** *(1e)*

Dışarıda tutulacak olan, **ölçüm aracının KALİBRASYONUNU** değiştirendir: aracı turun
ortasında ayarlamak, turun başındaki ölçümlerle sonundakileri karşılaştırılamaz kılar.

## Bayatlamanın SEKİZ biçimi

Bayatlık yalnız *"sayı eskidi"* değildir. Sekiz biçim ölçüldü ve **her birinin bedeli
farklıdır** *(kaynak: oturum ölçümü 2026-09-13; ⑤ ve ⑦ sha'lı)*:

| # | Biçim | Ne olur |
|---|---|---|
| ① | **satır no** | çapa kayar; doğrulanan şey satırın varlığı olur, BAĞIN durduğu DEĞİL |
| ② | **bağ / öncül** | atfın dayandığı alan kalkmıştır; madde **konusuzdur**, yanlış değil |
| ③ | **rezervasyon** | "şu numara önerildi" yazar, başkası inmiştir — bayat rezervasyon **HİÇ patlamaz** |
| ④ | **teşhis** | ölçülmeden kurala çevrilen teşhis, yanlışlığıyla kurumsallaşır (§ Teşhis mi, ölçüm mü) |
| ⑤ | **genelleştirme** | özel bir ölçüm genel kurala çevrilir; sınırı kaybolur — `a1ee02e9` |
| ⑥ | **kapanmış borç** | kapalı borç açık görünür; bedeli **yapılmış işi tekrar yaptırmak** (`73919ea0`) |
| ⑦ | ⚠️ **ABARTILMIŞ TEHLİKE** | tehlikeyi BÜYÜTEN bayatlık, ağırlığı yanlış yere verdirir — `994da11d`: *"preset düşerse rol şablonları da yazılmaz"* deniyordu; ölçüldü, sıra **izinler → şablonlar → presetler**, presetler EN SON, düşerse ötekiler ZATEN yazılmış |
| ⑧ | **beyan METNİ** | sayı beyanı yanlış ama kapı **varlığı** ölçtüğü için görmez (*"dört enumda"* yazıyordu, gerçek BEŞ) |

⚠️ **⑦ ve ⑧ en sinsileridir, çünkü ikisi de kapıdan geçer:** ⑦ okuyanı yanlış yere
ağırlık vermeye iter; ⑧'i ölçen kapı sayıyı değil VARLIĞI sorduğu için sessiz kalır.
📌 Ve ③ hiç patlamadığı için hiç fark edilmez — **bayatlığın tek biçimi "yanlış cevap"
değil, "hiç sorulmayan soru"dur.**
