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

### Kapsam, ölçümün İÇİNE değil YANINA yazılır
Yukarıdaki cümlenin eksik yarısı: *"nasıl doğruladın"* kadar **NEREDE ölçtüğün** de
rapora girer. **Bir ölçüm aracının çıktısı, aracın KOŞTUĞU YERLE sınırlıdır** — ve bu
sınır çıktının İÇİNDE görünmez; sayı tek başına kendini evrensel gösterir.

*(Üç emsal, hepsi 2026-09-14, d9 ölçtü:* ① *CI çıktısı yalnız O KOŞUMDA atlayanı gösterir
— kopya atlama defterleri CI'da **6** sanıldı, statik tarama **14** buldu
(`1e20acfb` altı kopya + `75df651b` sekiz kopya daha).* ② *Kapı defteri yalnız deftere
YAZAN worktree'leri görür; eski tabanlı bir ağaç satır bırakmaz ⇒ "ısırık sayısı" gözlenen
❌'tir, POPÜLASYON değil.* ③ *Bir bekçi koşumu yalnız O VERİTABANINDAKİ veriyi görür.
Dördüncüsü de aynı gün, bu satırı yazarken çıktı: d5'in bana ilettiği iki sha
(`1e20acfb`/`75df651b`) origin'de `1e20acfb`/`75df651b` olarak duruyor — **oturumun
gördüğü sha, okuyucunun bulacağı sha değil**; atıf da kapsam taşır.)*

⚠️ **Ve mekanizma tek cümleyle:** bir koşum, **koşulu SAĞLANAN** dalları basar;
sağlanmayanlar çıktıda **hiç görünmez** ve yokmuş gibi sayılır. Yukarıdaki 6 ↔ 14 farkı
buydu — sekiz kopya hiç ATLAMAMIŞTI, bu yüzden atlama defterinde hiç görünmediler.
⇒ ***Bir POPÜLASYON sorusu, koşum çıktısından CEVAPLANAMAZ; statik taranır.*** *(d9'un
formülasyonu.)*

> **Sayının yanına üç şey yazılır: NE ölçüldü · NEREDE ölçüldü · NE ölçülmedi.**
> Üçüncüsü olmadan okuyucu, ikincisini evrensel sanar.
📌 Yazım biçimi de ölçüldü: *"N ısırık"* değil ***"gözlenen N ❌ · kapsam: şu ağaçlar /
şu koşullar"***. Popülasyona ihtiyacın varsa **aracı değiştir** — koşum değil TARAMA.
📌 Bu cümlenin iki özel hâli ayrı dosyalarda ve ikisi de bunun altındadır:
· **Tümleyeni BAS** — kapsamı ölçen kapı, kapsam DIŞINDA kalanı da saysın
(`OLCUM-DISIPLINI-YUKLEM.md` § Sınırsız eşleşme, (d) satırı).
· **Koşum YERİ bir ölçüm koşuludur** — bir kontrolün doğru olması, doğru yerde koştuğu
anlamına gelmez (`OLCUM-DISIPLINI-YAZIM.md` § Sayı yazma, rejim ekseni).

## Aile — hangi soru hangi dosyada

Ölçüm disiplini **on bir dosyadır** ve hepsi aynı soruyu bölerek cevaplar. Buradan
başla, sorunun sahibine git:

| Sorun | Dosya |
|---|---|
| *Ölçümü nasıl yaparım, sonucu nasıl okurum?* (pozitif kontrol · eşik · yapısal sonda) | **bu dosya** |
| *Ölçümü nasıl YAZARIM?* — sayı · çapa · kimlik | [`-YAZIM.md`](OLCUM-DISIPLINI-YAZIM.md) |
| *Aletim mi bozuk?* — desen, komut, ayrıştırıcı, aracın varsayılanı | [`-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) |
| *Doğru şeyi mi sordum?* — desenin kapsamı, eşleşmenin sınırı, popülasyon üyeliği | [`-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md) |
| *Sınırsız eşleşmenin VAKALARI* — korpus, payda, kapsam beyanı | [`-SINIRSIZ.md`](OLCUM-DISIPLINI-SINIRSIZ.md) |
| *Komut gerçekten koştu mu?* — kabuk, asılı süreç, kancanın git ortamı | [`-SUREC.md`](OLCUM-DISIPLINI-SUREC.md) |
| *Deneyi doğru mu kurdum?* — kontrol grubu, ortam, sondanın kendisi | [`-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) |
| *Ağacı/indeksi BAŞKASIYLA mı paylaşıyorum?* | [`-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md) |
| *Sayı doğru; ondan ÇIKARDIĞIM doğru mu?* | [`-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md) |
| *Bu ölçümü KAPIYA nasıl çeviririm?* — mandal, cırcır, taban | [`-KAPI.md`](OLCUM-DISIPLINI-KAPI.md) |
| *Kapım öldü mü, bu kırmızı ne diyor?* | [`-KAPI-OLUMU.md`](OLCUM-DISIPLINI-KAPI-OLUMU.md) |
| *Bu sınıf zaten yazılı mı?* — **her başlık tek tabloda** | [`-DIZIN.md`](OLCUM-DISIPLINI-DIZIN.md) |

⚠️ Sıra rastgele değil: üstteki üç satır ölçümün KENDİSİ, ortadakiler ölçümün
KURGUSU ve ORTAMI, alttakiler ölçümden SONRASI. Bir arıza yaşadığında yukarıdan
aşağı in — çoğu vaka ilk üçte biter.
📌 **Yeni bir sınıf yazmadan önce `-DIZIN.md`yi baştan sona oku** (bir dakika);
mükerrer sınıf bu kataloğun kendi arıza biçimidir.

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

Katalog iki katmanlıdır — **KATMAN 1** ölçümün kendisi (*sayı doğru mu?*), **KATMAN 2** ölçümden sonraki adım (*sayı doğru; ondan ÇIKARILAN ne?*) — üç dosyada yaşar: KATMAN 1 üçe ayrıldı — [`OLCUM-DISIPLINI-ARAC.md`](OLCUM-DISIPLINI-ARAC.md) (ölçümün **ARACI**), [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md) (ölçümün **KURGUSU**) ve [`OLCUM-DISIPLINI-ORTAK-AGAC.md`](OLCUM-DISIPLINI-ORTAK-AGAC.md) (ölçüm **ORTAMI paylaşılıyorsa**); KATMAN 2 [`OLCUM-DISIPLINI-CIKARIM.md`](OLCUM-DISIPLINI-CIKARIM.md)'de.

> 🔎 **Bu ailenin BAŞLIK DİZİNİ ayrı dosyada:** [`OLCUM-DISIPLINI-DIZIN.md`](OLCUM-DISIPLINI-DIZIN.md) — her başlık tek tabloda. *"Bu bulgu zaten hangi başlığın altında?"* sorusu oradan `grep`siz cevaplanır. **Yeni başlık açan commit oraya da satır ekler**; `test_belge_capa_atfi` iki yönden ölçer (ölü başlık ↔ eksik satır), dizin bayatlayamaz.

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
Kardeşleri § Teşhis mi, ölçüm mü (teşhis KURALA çevrilmeden önce) ve
§ Bir kapının TETİĞİ bir OLAYI ölçer; TANISI bir ANLAM iddia eder
(`OLCUM-DISIPLINI-KAPI-OLUMU.md`) — **üçü aynı ayrımın üç yüzü**: burada teşhisin
YÜKLEMİ, orada teşhisin KİPİ, ötekinde teşhisin KURALA dönüşmesi.

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

## Ölçümü YAZMA — sayı · çapa · kimlik → ayrı dosya
Ölçümü YAPMAK ile onu YAZMAK ayrı iki iştir ve ikincisi büyüyen taraftır:
bir sayının nasıl nitelendirileceği, bir çapanın nereye bağlanacağı, kimliğin
repoya nasıl girmeyeceği — [`OLCUM-DISIPLINI-YAZIM.md`](OLCUM-DISIPLINI-YAZIM.md)'de.
Burası ölçümün NASIL YAPILDIĞI ve NASIL OKUNDUĞU; orası kâğıda NASIL DÖKÜLDÜĞÜ.

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
Kardeşleri § Teşhis mesajı da bir yüklemdir ve § Bir kapının TETİĞİ bir OLAYI ölçer;
TANISI bir ANLAM iddia eder (`OLCUM-DISIPLINI-KAPI-OLUMU.md`).

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
| ⑦ | ⚠️ **ABARTILMIŞ TEHLİKE** | tehlikeyi BÜYÜTEN bayatlık, ağırlığı yanlış yere verdirir — `d4cc3ea0`: *"preset düşerse rol şablonları da yazılmaz"* deniyordu; ölçüldü, sıra **izinler → şablonlar → presetler**, presetler EN SON, düşerse ötekiler ZATEN yazılmış |
| ⑧ | **beyan METNİ** | sayı beyanı yanlış ama kapı **varlığı** ölçtüğü için görmez (*"dört enumda"* yazıyordu, gerçek BEŞ) |

⚠️ **⑦ ve ⑧ en sinsileridir, çünkü ikisi de kapıdan geçer:** ⑦ okuyanı yanlış yere
ağırlık vermeye iter; ⑧'i ölçen kapı sayıyı değil VARLIĞI sorduğu için sessiz kalır.
📌 Ve ③ hiç patlamadığı için hiç fark edilmez — **bayatlığın tek biçimi "yanlış cevap"
değil, "hiç sorulmayan soru"dur.**
