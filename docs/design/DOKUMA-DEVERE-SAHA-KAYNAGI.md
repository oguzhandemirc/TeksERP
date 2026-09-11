# Dokuma + Devere — SAHA KAYNAĞI (bir dokumacının belgeleri)

> **Kaynak:** 2026-09-07'de bir dokumacının gönderdiği sekiz fotoğraf (`~/Downloads/dokuma-kaynak/`, WhatsApp). 2026-09-11'de okundu ve buraya çevrildi. **Fotoğraflar repoya KONMADI** (kişisel/WhatsApp içeriği); burada içerikleri sadakatle yazılı.
>
> Bu belge TASARIM DEĞİL, **saha gerçeğidir**. Tasarım kararları `SEKTOR-YOL-HARITASI.md` ve tezgah izleme tasarımında. Buradaki her satır bir belgeden okundu; **çıkarım yaptığım yerler açıkça işaretli**, emin olmadıklarım "⚠️ doğrulanmalı" diye.

## 1 · DESEN KARTI — armür kaldırma planı

İki örnek kart okundu: `UA6007` ve `UA6007A`.

Kartın yapısı (üstten alta):

- **DESEN NO** — `UA6007` (kimlik)
- **Kaldırma planı tablosu**, üç bloktan oluşuyor:
  - Sol blok: sütun **1–2**
  - Orta blok: sütun **3–14**
  - Sağ blok: sütun **1. 2. 3.**
  - Satırlar = atkı sırası (pick), hücrede **X** = o çerçeve o atkıda kalkar
  - ⚠️ Sol/orta blok ayrımının anlamı DOĞRULANMALI (kenar/çerçeve ayrımı olabilir). Sağ bloğun **atkı ipliği seçimi** olduğu neredeyse kesin: 1./2./3. numaraları alttaki "ATKI İPLİKLERİ" listesiyle birebir eşleşiyor.
- **ÇÖZGÜ:** `600 KAR İPİ 70 DN` (tek çözgü ipliği, denye ile)
- **ATKI SIKLIĞI:** `18 ATKI/CM` (elle düzeltilmiş — basılı değer üstü çizilip 18 yazılmış)
- **ATKI İPLİKLERİ** — numaralı liste:
  - `UA6007`: 1. 600 KAR İPİ · 2. 600 KAR İPİ · 3. 150 DN TEKSTURE
  - `UA6007A`: 1. **PUL 3 MML** · 2. 600 KAR İPİ · 3. 150 DN TEKSTURE
- Elle not: `200 m` (sipariş/levent boyu olabilir — ⚠️ doğrulanmalı)

### ⭐ EN ÖNEMLİ BULGU — varyant, çözgüyü PAYLAŞIR

`UA6007A` kartının üstünde el yazısıyla: **"Çözgü = UA6007"**.

İki desen arasındaki TEK fark birinci atkı ipliği (`600 KAR İPİ` ↔ `PUL 3 MML`).
Çözgü aynı, kaldırma planı aynı, atkı sıklığı aynı.

**Sonucu operasyonel ve büyük:** bir levent birden çok deseni besleyebilir. Atkı
değiştirmek dakikalar sürer; çözgü/levent değiştirmek (tahar, tarak, düğüm)
saatler. Kurulum defteri bu ikisini AYIRMAK zorunda, yoksa randıman ve planlama
yanlış çıkar.

## 2 · DEVERE (çözgü hazırlama) — üç girdi, bir formül

Dokumacı iki ayrı kâğıda aynı şeyi yazmış:

> **Devere**
> - Kaç adet tel
> - Hangi denye ip
> - Kaç mt.

Ve formül, en net hâliyle:

```
Devere = Çözgü

Kaç adet tel × Kaç denye × Kaç mt.
────────────────────────────────── = Kaç kg.
              9000
```

Sayısal örnek (ayrı kâğıt): `3500 × 300 × 7000 / 9000 = Kaç kg`

⚠️ **BÖLEN DOĞRULANMALI.** Denye tanımı "9000 metrede gram" olduğundan
kilogram için klasik bölen **9.000.000**'dur (`tel × metre × denye ÷ 9.000.000`).
Kâğıtta `9000` yazıyor — ya gram sonucu veriyor ya da dokumacı 1000'i zihinden
uyguluyor. **Formülün YAPISI kesin, ÖLÇEĞİ teyit edilmeli.**

⚠️ Örnekteki `3500 × 300 × 7000` sırası da belirsiz: formül sırası
tel × denye × mt ise 3500 tel / 300 denye / 7000 m demektir. Doğrulanmalı.

**Atkılık** için ayrı ve eksik bir not var: `Atkılık … /100 =` — hesap
tamamlanmamış. ⚠️ Atkı tüketim formülü dokumacıdan ayrıca sorulmalı.

## 3 · İPLİK — iki kullanım sınıfı

Akış çizimindeki ayrım:

```
İplik ─┬─ ATKILIK
       └─ ÇÖZGÜLÜK ──► Devere ──► Çözgü sarılık (Tel adedi · Metre · Denye)
```

Yani aynı iplik kalemi **atkılık** ya da **çözgülük** olarak kullanılıyor ve
çözgülük olan devereden geçip **levent**e dönüşüyor. Levent üç değerle
tanımlanıyor: tel adedi, metre, denye.

## 4 · ÜRETİM AKIŞI (elle çizilmiş şema)

```
Devere ──► Dokuma ──► Kurşun ──► Tambur ──► (Kalite)
```

Şemada ayrıca: tezgah/operatör adları tekrar tekrar daire içine alınmış
("Uğur" ×5 civarı — ⚠️ tezgah adı mı operatör mü belirsiz), `400 gr`,
`200 × 5`, `4000`, `200 linear` gibi sayılar.

**Kritik gözlem:** `Kurşun` ve `Tambur` TeksERP'de ZATEN VAR. Yani dokuma ve
devere, mevcut rotanın **ÖNÜNE** eklenen iki adımdır — mevcut akışı değiştirmez,
uzatır. Bu, "yeni mimari gerekmez, rota şablonuna iki istasyon eklenir"
tezini destekler (kök `CLAUDE.md`: "devere/dokuma/haşıl yeni mimari istemez").

## 5 · İPLİK GİRİŞİ (tedarikçi irsaliyesi — Yanteks)

Gerçek bir iplik sevk belgesi okundu:

| Alan | Değer |
|---|---|
| Cari hesap | kod + unvan + adres + vergi dairesi/no |
| Sipariş No | `WEB35013` |
| Satır | Kodu `153.01.0652` · Açıklama `YAN 1029-K` |
| **Bobin Adet** | 9 · 10 · 8 |
| **Seri / Lot** | `YAN 1029-K` (üç satırda da aynı) |
| **Miktar** | 20,73 · 21,46 · 18,64 **Kilogram** |
| Toplam | 60,83 kg |

**Sonucu:** iplik **bobin** hâlinde ve **lot** ile geliyor; miktar **kg**.
Üç satır aynı lot ama farklı bobin adedi/kg — yani parti içinde tartılı
kırılım var. Mevcut `YarnMovement` kg tutuyor ama **lot ve bobin adedi yok**
(`YarnLot` zaten "açık yükseltme yolu" olarak şemada anılıyor).

## 6 · ÇIKIŞ BELGESİ (çeki/sevk listesi)

| Alan | Örnek |
|---|---|
| Kod / tarih | `BUĞRA 04` · 17.08.2026 |
| Ambalaj | `10 ÇUVAL` · `FAN KARGO` |
| Satırlar | `A800 · V01 · 50 Mt.` (desen · renk · metre), onlarca satır |
| Özet | **DESEN · TOP SAYISI · METRE · birim $ · tutar $** |
| | `A800` → 67 TOP · 3.215,7 MT · 1,70 $ · 5.466,69 $ |
| | `D2175` → 11 TOP · 523,9 MT · 1,90 $ · 995,41 $ |

### ⭐ İKİNCİ ÖNEMLİ BULGU — ürün kimliği DESEN + RENK

Sevk listesinde ürün **desen kodu** (`A800`, `D2175`) + **renk kodu** (`V01`)
ile anılıyor ve fiyat **desen başına $/metre**.

TeksERP'de bu zaten `Item` + `Color` ile modelli. Yani **`Desen` yeni bir üst
düzey varlık DEĞİL** — kumaş `Item`'ının arkasındaki TEKNİK REÇETEDİR
(mevcut `ProductRecipe` ile aynı sınıf). Bu, tasarımı ciddi biçimde
sadeleştirir: desen kartı `Item`'a bağlı bir reçete kaydıdır, paralel bir
ürün ağacı değil.

⚠️ `UA6007` (desen kartı) ile `A800` (sevk listesi) farklı kodlama
şemalarında — biri teknik desen no, diğeri ticari ürün kodu olabilir.
**İlişkileri doğrulanmalı.**

## 7 · Tasarıma doğrudan giren çıkarımlar

1. **Levent (`WarpBeam`) = devere çıktısı**, üç alanla tanımlı: tel adedi ·
   metre · denye(iplik). İplik stoğunu formülle tüketir.
2. **Bir levent → çok desen.** Levent–desen bağı 1:N; atkı değişimi ucuz,
   levent değişimi pahalı. Kurulum defteri ikisini ayırmalı.
3. **Atkı sıklığı (atkı/cm) sayaç dönüşümünün anahtarı:** tezgah atkı sayar,
   `metre = atkı ÷ (atkı/cm × 100)`. Yani desen kartındaki `18 ATKI/CM`
   olmadan tezgah sayacı metreye çevrilemez. **Randıman hesabının girdisi bu.**
4. **İplik iki sınıf:** atkılık / çözgülük. `Item`'a bir ayrım alanı gerekir.
5. **İplik lot + bobin adedi** girişte var, sistemde yok.
6. **Dokuma ve devere mevcut rotanın ÖNÜNE eklenir**, mevcut akışı bozmaz.

## 8 · Dokumacıya sorulacaklar (açık uçlar)

1. Devere formülünde bölen **9000 mi 9.000.000 mu**; sonuç gram mı kg mı?
2. Örnekteki `3500 × 300 × 7000` sırası: hangisi tel, hangisi denye, hangisi metre?
3. **Atkı tüketim formülü** nedir? (kâğıtta `Atkılık … /100 =` yarım kalmış)
4. Desen kartındaki sol blok (sütun 1–2) ile orta blok (3–14) ayrımı ne? Kenar mı?
5. `UA6007` (desen no) ile `A800` (sevk listesi kodu) arasındaki ilişki ne?
6. Akış şemasındaki tekrar eden "Uğur" — tezgah adı mı, operatör mü?
7. Bir levent kaç metre olur, tipik aralık ne? (kartta `200 m` notu var,
   devere örneğinde `7000` geçiyor — ikisi farklı şeyler olmalı)
8. Tezgahlar hangi marka/model, veri çıkışı var mı (sayaç ekranı, seri port,
   ağ)? Duruş sebebini operatör nereye giriyor bugün?
