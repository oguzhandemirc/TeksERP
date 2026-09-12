# Kimlik kapısı — eşik ölçümü (2026-09-12)

> **Bu belge bir KANITTIR, tasarım değil.** `scripts/test_identity_ledger.ts`in
> kullandığı 0.95 eşiği bir tahmin değil bir ölçüm sonucudur; eşik bir gün
> tartışılırsa gerekçe burada durur. Kapının tasarımı ve kuralları
> `docs/kurallar/` içindedir.

## Soru

Kapı, bir kimlik kümesinden üye düştüğünde kırmızı verir. Ama **yeniden
adlandırma** da bir düşme + bir doğuş olarak görünür. Düzyazı başlıklarında
(`docs/kurallar/*.md`, `BEKCI-HARITASI.md`) her yazım düzeltmesi arşiv notu
gerektirirse kapı ilk haftasında "gereksiz bürokrasi" damgası yer ve devre dışı
bırakılır. O hâlde: **yakın-eşleşme eşiği kaç olmalı?**

## Yöntem

Tahmin edilmedi, **geçmiş oynatıldı**. `docs/kurallar/*.md` + `BEKCI-HARITASI.md`
dosyalarına dokunan her commit için ebeveyniyle karşılaştırıldı, `^## ` başlık
kümesinden düşen her üye bir "olay" sayıldı. Her olayda düşen başlığın yeni
kümedeki en yakın kardeşi arandı (`editRatio`, `utils/string-similarity.ts`).
Sonra aday eşiklerde kaç olayın kırmızı vereceği sayıldı.

Ölçüm evreni: **55 commit · 40 olay** (2026-09-12 itibarıyla).

## Ham sonuç — ve neden YANILTICI

| eşik | kırmızı |
|---|---|
| 0.95 | 33 / 40 |
| 0.90 | 7 / 40 |
| 0.85 | 3 / 40 |
| **0.80** | **0 / 40** |

Naif okuma "eşik 0.80" der. **Yanlıştır.** Kırmızı veren olaylar tek tek
okununca hepsinin aynı şey olduğu görüldü — gerçek bir düşme değil, **başlığa
gömülü ELLE SAYAÇ artışı**:

```
'db-invariant (29)'                        → 'db-invariant (30)'          0.882
'fason (89)'                               → 'fason (90)'                 0.800
'Bekçiler … (84 backend · 13 istemci)'     → '… (85 backend · 13 istemci)' 0.983
```

Eşiği 0.80'e çekmek, kapıyı **sayaç gürültüsüne uydurmak** ve gerçek yeniden
adlandırmalara kör etmek olurdu. Doğru hamle tolerans değil **normalizasyon**:
başlık kimliği hesaplanırken parantezli sayı ATILIR, çünkü o sayı kimlik değil
**türetilmiş veridir**.

## Normalizasyon sonrası

| sınıf | sayı |
|---|---|
| Toplam olay | 40 |
| Normalizasyon sonrası TAM eşleşen (salt sayaç artışı) | 33 |
| 0.95–1.00 arası (çok-sayaçlı başlık, `(N backend · M istemci)`) | 7 |
| **0.95 altı — gerçek düşme adayı** | **0** |

**55 commitlik gerçek geçmişte tek bir sessiz başlık kaybı yok.** Yani 0.95
gürültüye verilmiş bir ödün değil, gelecekteki bir yazım düzeltmesi için
sigortadır.

## Karar

- **Eşik = 0.95**, yalnız DÜZYAZI sınıfında (`docs/kurallar/*.md` `^## ` ·
  `BEKCI-HARITASI.md` başlıkları).
- **Kod kimliğinde tolerans YOK** (izin/ekran anahtarı · `schema.prisma`
  model/alan · bekçi dosya adı · `surum-notlari.json` madde id): bir harf farkı
  yanlış şeyi işaret eder, sözleşme kırar.
- Normalizasyon: karşılaştırmadan önce parantezli sayı çıkarılır ve metin
  repo'nun kendi katlamasından geçer (`utils/search-fold.ts`; ham `toLowerCase`
  Türkçe İ/ı tuzağına düşer, zaten yasak).
- Bekçi çıktısına şu satır basılır:
  `eşik=0.95 · kaynak: 2026-09-12 ölçümü, 55 commit / 40 olay, normalizasyon sonrası kırmızı 0`

## Yan bulgu — ölçümün ortaya çıkardığı canlı bayatlık

Gürültünün kaynağı elle sayaçlar olduğu için, sayaçların BUGÜN doğru olup
olmadığı da ölçüldü (beyan edilen sayı ↔ altında listelenen ad sayısı):

| dosya | beyan | gerçek |
|---|---|---|
| `belge-etiket.md` | 32 istemci | **34** |

`belge-etiket.md`in listesi AYRICA doğrulandı: listelenen 34 istemci bekçisinin
34'ü de gerçekte var, mükerrer yok. Yani **liste doğru, bayat olan yalnız sayıydı**
— sayıyı başlıktan silmek hiçbir bilgi kaybetmiyor. Bu, "sayaç başlıktan çıksın"
kararının ampirik onayıdır.

Diğer 24 alan dosyası tutarlı. Ayrıca `teks-erp-1e` denetiminde
`sebep-katalogu.md` bekçi listesinin yeni bekçiyi taşımadığı ve
`docs/kurallar/README.md:22` sayacının bayat olduğu bulundu.

**İki kontrol farklıdır ve ikisi de gereklidir:**
- **B1** beyan sayısı ↔ listelenen ad sayısı
- **B2** listelenen adlar ↔ gerçek `scripts/test_*.ts` ∪ `BEKCI-HARITASI.md`

Sayı ile liste BİRLİKTE bayatlarsa B1 yeşil görünür, B2 kırmızı verir.

## Tekrar üretimi

Ölçüm script'i saf Python, salt-okunur (`git show` dışında hiçbir şeye
dokunmaz). Kapıya çevrildiğinde `scripts/test_identity_ledger.ts` içinde aynı
mantık TypeScript'e taşınır ve `utils/string-similarity.ts` içe aktarılır —
mesafe fonksiyonu ikinci kez YAZILMAZ (tek kaynak kuralı).

## Kararın sonucu — sayaç başlıktan çıkarıldı

Bu ölçümün doğrudan sonucu: **40 olayın 40'ı sayaç gürültüsüydü**, yani başlığa
gömülü elle sayaç kimliği sürekli çalkalıyordu. Çözüm eşiği düşürmek (kapıyı
gürültüye uydurmak) değil, **sayıyı kimlikten çıkarmak** oldu:

- `## Bekçiler — bu alana dokununca koş (85 backend · 13 istemci)` → `## Bekçiler — bu alana dokununca koş`
- `BEKCI-HARITASI.md` → `## fason (90)` yerine `## fason`
- `docs/kurallar/README.md` sayacı belgede yaşamaz, kapının çıktısından okunur.

**Var olmayan bir sayı bayatlayamaz.** Normalizasyon mantığı ve bu ölçüm yine de
saklandı: yarın başka bir türetilmiş parça bir başlığa girerse gerekçe hazır olsun.

## Kapı yazarken kapının kendisini de ölç

Bu turun ikinci dersi, ölçümden değil KAPIYI YAZMAKTAN çıktı. Yön B'nin dört alt
kontrolü ilk taslakta **harita bölümleri üzerinden** dönüyordu. O kurguda,
`BEKCI-HARITASI.md`de bölümü olmayan bir alan dosyası sessizce atlanır — yani
kapı, tam da ölçmeye çalıştığı hastalığı (bir kümenin gerçek kaynağıyla
ayrışması) kendi içinde taşırdı ve bunu YEŞİL olarak raporlardı.

Düzeltme, aynı veriye iki yönden bakmak oldu:
- **B-a / B-b** → `docs/kurallar/*.md` dosyaları üzerinden döner (alan dosyası
  kaynak, harita ölçülen)
- **B-d** → harita bölümleri üzerinden döner (harita kaynak, alan listesi ölçülen)

Kural olarak: **bir kapının kapsama kümesini, kapının ölçtüğü belgeden türetme.**
Türetirsen kapı kendi kör noktasını üretir ve o nokta hiçbir zaman kırmızı vermez.

İlgili ikinci sınır, kapının başlığında da yazılı: Yön A'nın tabanı
`merge-base HEAD origin/main` olduğu için kapı yalnız HENÜZ İTİLMEMİŞ işi ölçer;
**bir kez itilmiş sessiz düşme bu kapıyla bir daha yakalanmaz.** Bu bilinçli bir
sınırdır (push öncesi `npm test` doğru penceredir), gizlenmiş bir eksik değil.

## Kırmızıyı görünce düzeltme refleksi

Kapı disiplininin son parçası kapıyı YAZMAKLA değil, kapı kırmızı verdikten
sonra ne yapıldığıyla ilgili. **Elinde kırmızı bir bekçiyle "düzelteyim" refleksi
en tehlikeli andır:** kırmızının kodu mu yoksa beklentiyi mi suçladığı
ölçülmeden yapılan düzeltme, doğru çalışan bir kapıyı testi yeşile boyamak için
gevşetir — kapının varlık sebebinin tam tersi yönü.

**Canlı örnek (2026-09-12).** `test_module_flag_off.ts` altı kırmızı verdi:
`/api/warp-specs` `modul=ticaret` diyordu, bekçi `iplik`/`devere` bekliyordu.
İlk okuma "devere kapısı yanlış modüle bağlanmış" der. Ölçüm başka şey söyledi:
- Rota adlı kapıyı kullanıyor (`warp-spec.routes.ts:36` → `requireDevereEnabled`),
  jenerik `requireModule` değil — kural zaten uygulanmış.
- Kapı zinciri KASITLI olarak sırayla ölçüyor ve **eksik OLANI** bildiriyor
  (`module.middleware.ts:148-170`; `module-flags.ts:71-74`de de yazılı):
  ticaret kapalı → `ticaret`, iplik kapalı → `iplik`, devere kapalı → `devere`.
- Yani `modul=ticaret` DOĞRU cevaptı.

Kırılan şey kural değil, **bekçinin tek-seviye varsayımıydı**: iki halkalı
zincirler için doğru kodlanmış, üç halkalı zincirde (devere → iplik → ticaret)
yanlış. Düzeltme bekçi tarafında yapıldı, middleware'e dokunulmadı.

**Kural:** kırmızıyı düzeltmeden önce üç ihtimali ayır — ① senaryo/beklenti
yanlış ② kod yanlış ③ bekçi yeni bir sınıfın varlığından habersiz yazılmış.
(1) ve (3) bekçi tarafı, (2) kod tarafı; ayrım yapılmadan atılan her adım
kapıyı gevşetme riskini taşır.
