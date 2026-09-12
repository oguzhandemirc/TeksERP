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

## İki kurtarıcı kural — birbirinin tersi, ikisi de üç saniye

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

## Yedi arıza sınıfı

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

## Asenkron eylemde tek ölçüm yetmez

`port serbest ≠ süreç ölü` · `PID öldü ≠ dinleyen ölü` · `kill gitti ≠ süreç gitti`.
Üçü aynı kuralın görünümüdür: portun bırakılması, sürecin ölmesi, sinyalin
işlenmesi eylemden SONRA, belirsiz gecikmeyle olur. Hata "ölçmedim" değil, **"bir
kez ve çok erken ölçtüm"**.

> **Kapatınca ölç, tutmazsa bekle ve yeniden ölç, zaman aşımında sessizce geçme.**

## Sayı yazma

**Sayı taşıyan her belge satırı bir bakım borcudur.** Bu belgede ve yazacağın her
belgede:

- **Damgalı ölçümün PAYDASI** ise kalır — payda olduğu açıkça yazılarak
  (*"2026-09-05 ölçümü: o günkü 455 dosya için 369 sn"*).
- **Tek başına bir durum beyanı** ise kalkar. Yerine ölçüm komutu yazılır.

Ayırt etme yöntemi: *cümleyi bugün okuyan biri ondan ne çıkarır — "o gün böyleydi"
mi, "bugün böyle" mi?*

> **Var olmayan bir sayı bayatlayamaz.**

## Kapının üç ölüm biçimi

Ölçümü kapıya çevirirken üçünü birden gözet; üçü de kapıyı **kaldırmadan**
işlevsizleştirir.

1. **Yanlış kırmızı** — doğru işte kırmızı verirse ilk hafta devre dışı bırakılır.
2. **Yavaşlık** — bedel değişenle orantılı olmaktan çıkarsa kaçış kullanılmaya
   başlanır.
3. **Gürültü** — çıktısı okunmayacak kadar uzunsa ikinci gün göz ardı edilir.
   **Doğru olması kurtarmaz.**

İlk ikisinde kapı yanlış davranır; üçüncüsünde **doğru davranır ve yine ölür**.

## Kırmızıyı sınıflandırma — dört kova

`gerçek kusur · testin kendi hatası · çevresel · yapısal olarak ölçülemez`

Dördüncüsü düzeltilecek bir şey değildir; "gerekçesi ölçülmüş atlama"nın karşılığıdır.
**Etiketi ölçmeden yapıştırma** — çevresel olan düzeltilebilir, yapısal olan yalnız
başka bir ortamda ölçülebilir; ikisini ayırmadan verilen hüküm ya gerçek bir kusuru
gizler ya çalışan bir kapıyı gevşetir.
