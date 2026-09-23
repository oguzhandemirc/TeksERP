# Ölçüm disiplini — SONDA GEÇERLİLİĞİ

Bu dosya [`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'ten **aile olarak**
ayrıldı (2026-09-23, tavan): oradaki sınıflar *ölçümün kendisinin* arızalarıdır, buradakiler
tek bir alt sorunun — ***sondam geçerli mi?*** — arızalarıdır. Ayrım biçimsel değil: bir
sonda koşulduğunda cevaplanması gereken soru kümesi kapalıdır ve hep aynı sırayla sorulur.

> **Neden ayrı dosya:** negatif sonda bu depoda bir ZORUNLULUKTUR (yeni bekçi, korunan
> davranış bozulunca kırmızı verdiği ÖLÇÜLEREK yazılır) — yani her yeni bekçi bu ailenin
> tamamını okur. Sınıf kataloğunun ortasına gömülü olduğunda okunmuyordu.

**Sıra kuraldır.** Bir sonda ısırmadığında hipotezler şu sırayla sınanır: ① mutasyon indi
mi · ② korunan davranış o kodda yaşıyor mu · ③ vaka bu kapıyı izole ediyor mu · ④ yazma
yolu gerçekten koşuldu mu. Ancak dördü de geçtikten sonra "kapı zayıf" denir.

### Çöken sonda, sonda değildir
Negatif sonda kırmızı verdi diye geçerli değildir; kırmızının **ölçmek istediğin
KONTROLDEN** geldiği ayrıca doğrulanır.
**Ayırt edici:** FAIL **satır sayısı** ↔ özet **sayısı**. Uyuşmuyorsa fark bir
çökmedir. *(Vaka: özet "3 başarısız" dedi, ekranda 2 FAIL vardı; üçüncüsü bir
`.catch()`ten geliyordu — bölümün hiçbir kontrolü koşmamıştı.)*
**Kurtarma:** sondayı **sahte nesneyle kurma** — gerçek çağrıyı **gerçek ama
yanlış girdiyle** koştur. Sahte nesne kod yolunu değil, kod yolunun **kurulumunu**
kırar.

**Kardeş biçim — çökme HİÇ kırmızı üretmez ve "ısırmadı" diye okunur.** Yukarıdaki
vakada çökme sahte bir kırmızı üretiyordu; ters yönü daha sinsidir: mutasyon
**derlenmez ya da çalışma anında patlar**, sonda hiç koşmaz, çıktıda ❌ satırı
olmaz ve sondayı koşan bunu *"kapı bu ihlali görmüyor"* diye okur — yani kapıyı
suçlar, oysa ölçüm hiç yapılmamıştır.

**Üçüncü biçim — mutasyon ARACIN KENDİ kuralı yüzünden inmez.** Yukarıdaki iki vakada
mutasyon derlenmiyor ya da patlıyordu; burada araç **sessizce hiçbir şey yapmaz.**
*(Vaka 2026-09-23: `perl -0pi -e 's|^import|…'` — `-0` SLURP modunda `^` yalnız
DOSYA BAŞINA uygulanır ve hedef dosya yorumla başlıyordu. Perl hata vermedi, çıkış
kodu 0'dı, sonda "ısırmadı" göründü ve kapı bir an suçlandı. Tekrarı `grep -c` ile
mutasyonun indiği DOĞRULANARAK yapıldı; kapı ısırdı.)*
⇒ **Bir sonda ısırmadığında sorulacak İLK soru "kapı mı kör" değil, "mutasyon
gerçekten indi mi"dir** — ve cevabı mutasyonun kendisini ÖLÇEREK verilir
(`grep -c`, `git diff --stat`), "komutu koştum" diyerek değil.
> ***Sondanın mutasyonu ÇALIŞABİLİR olmalı:*** kaynak metnini ya da davranışı
> ölçen bir sondada mutasyon, ürün kodunun **derlenip koşmasına izin veren**
> gerçekçi bir değişiklik olmalıdır — yoksa ölçülen şey kapı değil **kaza**dır.
*(Vaka 2026-09-22, iki kez aynı gün: ① bir servise yalnız `prisma.roll.findFirst`
çağrısı eklendi ama `prisma` import edilmedi ⇒ `ReferenceError`, bekçi çöktü, çıktı
boş; import da eklenince ❌2 geldi. ② bir servisin kod üretimi kaldırıldı ⇒ create
`validateCode`ta fırlattı ve bekçi çöktü; **bekçiye `dene()` sarmalı eklenerek**
"create patlarsa o iddia ❌ olur" hâline getirildi, sonra ❌10 ölçüldü.)*
**İki çıkış yolu var ve ikisi de meşru:** mutasyonu derlenebilir yap, **ya da**
bekçiyi çökmeye dayanıklı yaz (beklenen patlamayı yakalayıp ❌ üret). İkincisi
tercih edilir: ürün kodu gerçekten patlarsa kapı yine kırmızı verir.

**Üçüncü biçim — kırmızı BAŞKA BİR KONTROLDEN gelir.** Çökme yok, mutasyon
uygulandı, sonda ısırdı — ama ısıran kapı, ölçmek istediğin kapı DEĞİL. Bu en
sinsisidir, çünkü ekranda "sonda geçerli" görünür.
**Ayırt edici:** ❌ satırının GEREKÇESİNİ oku, yalnız varlığını değil — beklediğin
hata kodu/mesajı mı geldi?
*(Vaka 2026-09-22: "okutulan seri düzenlenemez" kapısı `swatch` üstünde
sondalandı ve kırmızı verdi; ama gelen kod `NUMBER_SERIES_COUNTER_NOT_SCOPED`ti,
yani ısıran ÖNCEKİ kapıydı — kartelanın sayaç beyanı yoktu. Sonda, ölçmek
istediği kapı kaldırıldığında bile kırmızı kalıyordu. `shipment`a çevrilince —
her iki kapıyı da geçen tek seri — mutasyon "KABUL EDİLDİ" verdi ve sonda
gerçekten ölçmeye başladı.)*
**Kurtarma:** sondanın hedefini, ÖLÇÜLEN KAPIDAN BAŞKA hiçbir kapının
reddetmediği bir örnek üstünde kur. Örnek bulunamıyorsa kapı zaten başka bir
kapının gölgesindedir ve bunu BEYAN et.

### Bir sonda ISIRMAYINCA üç ayrı şey olmuş olabilir — üçü de ayrı ayrı sorulur
Sonda kırmızı vermediğinde varsayılan okuma *"kapı kör"* olur; oysa bu üç hipotezden
YALNIZ BİRİDİR ve en az olasısıdır:
1. **Mutasyon inmedi** (§ Çöken sonda'nın üçüncü biçimi) — önce bunu ölç.
2. **Korunan davranış O KODDA YAŞAMIYOR** — mutasyon indi, kapı sağlam, ama bozduğun
   satır ÖLÜ KOD. *(Vaka 2026-09-23: `seriesJoints` içine konan `dateSegment === "NONE"`
   dalı kaldırıldı, hiçbir iddia kırmızı vermedi; çünkü üreteç de eşleştirici de tarih
   boşken ikinci eklemi zaten hiç kurmuyordu. Dal kaldırıldı — **ölçülemeyen savunma,
   savunma değildir**.)*
3. **Sondanın hedefi BAŞKA bir kapı tarafından da yakalanıyor** → § Bir kapıyı ölçen sonda.
⇒ Üçü de "kapı zayıf" ile aynı çıktıyı verir (yeşil), bu yüzden hipotez SIRASI kuraldır.

### Bir kapıyı ölçen sonda, YALNIZ o kapının yakaladığı vakayı kullanmalı
Bir yüklemi sınamak için seçilen vaka BAŞKA bir yüklem tarafından da reddediliyorsa,
sonda o kapıyı **izole etmez**: kapıyı kaldırsan bile öteki reddeder ve iddia yeşil kalır.
*(Vaka 2026-09-23: "içe aktarım yazılabilirlik kapısını KURU koşuyor mu" iddiası KİLİTLİ
bir seriyle sınanıyordu; oysa kilitli seriyi `assertSeriesFormatAllowed` DA reddediyor.
Kapı kuru koşumdan çıkarıldı, iddia yeşil kaldı. İzole eden vaka OKUTULAN ama kilitli
OLMAYAN seriydi — onunla ısırdı.)*
⇒ Sonda tasarlarken sor: *bu vakayı yalnız ölçtüğüm kapı mı reddediyor?*

**Kardeş hâl — korunan DURUM sondada hiç kurulmamış olabilir.** Vaka doğru kapıyı hedeflese
bile, iddia sistemin yanlış BAŞLANGIÇ DURUMU üzerinde koşuyorsa düzeltmeyi geri aldığında da
yeşil kalır: reddi doğuracak durum hiç var olmamıştır.
*(Vaka 2026-09-23: "seri kendi eski biçimine dönebilmeli" iddiası seriyi `KS`te bırakıp
doğrudan `KS`i deniyordu; oysa reddi doğuran hâl serinin `KSZ`de OLMASIYDI. Düzeltme geri
alındı, iddia yeşil kaldı — çünkü "bugünkü biçim" zaten `KS`ti ve dar istisna da onu
geçiriyordu. İkinci yazım seriyi gerçekten `KSZ`ye taşıdı, taşındığını ayrı bir körlük zemini
iddiasıyla ölçtü ve sonda ısırdı.)*
⇒ Bir sonda ısırmayınca sorulacak ikinci soru: *iddianın reddi doğuracak DURUMU gerçekten
kurdum mu, yoksa kurulduğunu mu varsaydım?* Kurulumun kendisi ayrı bir körlük zemini iddiasıyla
ölçülür — geri alma ise ölçülen kod yolundan DEĞİL, doğrudan yazmayla yapılır (düzeltme
bozulursa teardown da düşer ve artık bırakır).

### Kapıları ölçmek, YAZMA YOLUNU ölçmek değildir
Bir yazma yolunun kapıları eksiksiz ölçülebilir ve yazma yolunun KENDİSİ hiç
koşulmamış olabilir: bütün sonda kolları "reddedilen" vakalardan seçilmişse yürütme
hiç oraya girmez.
*(Vaka 2026-09-23: yapılandırma paketi içe aktarımında `updateSeriesFormat` çağrısı ham
bir `prisma.update` ile değiştirildi ve HİÇBİR iddia kırmızı vermedi — bütün kollar HATA
veren serilerdi, `writeItem`a hiç girilmiyordu. Çare: BAŞARILI bir yolu da koşturan ve
yazmanın GÖZLENEBİLİR SONUCUNU (zaman çizgisine satır düştü mü) ölçen bir iddia.)*
⇒ **Kodun ne ÇAĞIRDIĞINI okumak yerine ne BIRAKTIĞINI ölç** — çağrı bir uygulama
ayrıntısı, bıraktığı iz ise davranışın kendisidir.

### Bir düzeltme, sondayı SUSTURARAK da "çalışabilir"
Kırmızıyı yeşile çeviren her değişiklik düzeltme değildir: bazıları kapının ÖLÇTÜĞÜ ŞEYİ
daraltır. Bu yüzden bir bekçi düzeltmesinden sonra **bekçinin hâlâ ısırdığı yeniden
ölçülür** — "bekçi yeşil" yeterli değildir.
*(Vaka 2026-09-23: `(bu commit)` işaretli satırın sha'sını blame'leyen kol, satır
numarası revizyonlar arası kaydığı için kırmızı veriyordu. İlk düzeltme `git blame
--contents` idi: bekçi yeşile döndü ama negatif sonda da ısırmaz oldu — git, geçmişte
HİÇ olmayan bir satırı komşusunun commit'ine atfediyor. Düzeltme geri alındı; doğru
çözüm satırı İÇERİKLE bulmaktı ve fail-closed korundu.)*
⇒ ***Yeşil görünen ama ısıramayan bir kapı, hiç kapı olmamasından kötüdür*** — çünkü
artık kimse oraya bakmaz.
