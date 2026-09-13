# Ölçüm disiplini — SINIRSIZ EŞLEŞME vaka envanteri

Bu dosya [`OLCUM-DISIPLINI-YUKLEM.md`](OLCUM-DISIPLINI-YUKLEM.md) § Sınırsız eşleşme'nin
**vaka envanteridir**: orada kural cümlesi ve vaka tablosu durur, burada her vakanın
ÖLÇÜMÜ — korpus, payda, kapsam beyanı, panzehir. Ayrım biçimsel değil: *kural sabittir,
vaka envanteri her yeni ölçümle büyür* (bölme ölçütü ve emsalleri `README.md`'de).

Tablodaki harfler burayla birebirdir. **(a)** ve **(b)** tek satırda kapanıyor — ölçümleri
tabloda tam, ayrıntı gerekmedi; bu dosya (c)'den başlar.

### (c) Kurbanı bekçinin KENDİ fikstürü — alt dizgi
⭐ **(c) ailenin en pahalı biçimi, çünkü kurban bekçinin KENDİ ürettiği değer.**
*(d9, ölçüldü: sonda değeri `TEST-KAT-${Date.now()}-KAT`. Damga **9 ile bittiğinde**
dizgi `…5549-KAT` oluyor ve `"9-KAT"` alt dizgisini İÇERİYOR ⇒ yüklem alakasız bir
değerle eşleşiyor. "Aralıklılık" gizemi değil **damga aritmetiği**: `Date.now() % 10 === 9`
⇒ 1/10; CI'daki iki kırmızının ikisi de 9 ile bitiyordu — `1789324255549` · `1789323101009`.
Üç hipotez kuruldu (başka testin fikstür kalıntısı · kendi kalıntısı · bayat önbellek) ve
**üçü de yanlıştı**. Düzeltme `675211b2`: liste artık TOKEN olarak okunuyor, dört sonda,
biri (§0c) eski yüklemin yanılgısını BELGELİYOR.)*

> **Bir bekçi, kendi fikstürünü ortama koyduğu anda KENDİ YÜKLEMİNİN GİRDİSİ hâline
> gelir.** ⇒ Sınırı beyan etmek yetmez; ayrıca sor: ***sondanın ÜRETTİĞİ değer, sondanın
> YÜKLEMİNE girdi olabilir mi?*** *(Kuralın kendisi `OLCUM-DISIPLINI-YUKLEM.md`'de durur;
> burada vakanın yanında tekrar edilmesi bilinçlidir — ölçümü okuyan kuralı da görsün.)*
