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

## Kapı doğduğu gün yazarını yakaladı

Kimlik kapısı `74553624` ile **15 gerçek ayrışmayla** doğdu ve düzeltmesi
(`5190e8a1`) hemen arkasından geldi. Aynı gün üç bağımsız yakalama yaptı:

- **Kendini yakaladı.** İlk koşumda `test_identity_ledger` haritada yoktu —
  yani yeni yazılan bir bekçi bile haritasız girebiliyormuş, ve kapı bunu ilk
  koşumunda kendi üzerinde gösterdi.
- **`6e`'yi İKİ KEZ yakaladı.** Önce altı stok defteri bekçisi HEAD'de
  commit'liyken harita satırları yoktu; sonra yeni bir bekçi eklenirken harita
  satırı yine unutuldu (`e5389e2d` ile düzeltildi). Aynı oturumun aynı hataya
  iki kez düşmesi, kuralın insan dikkatiyle tutulamayacağının kanıtıdır — kapının
  gerekçesi tam olarak budur.
- **`01`'i yakaladı.** `sebep-katalogu` koşum listesi `test_reason_preset_kind_parity`yi
  taşımıyordu.

Kapının varlık sebebi bir daha savunulmak zorunda kalmasın diye yazılıdır:
doğduğu gün, üç ayrı oturumda, üç gerçek eksik buldurdu.

## Sonda kendi girdisini kirletmemeli

`staged.mjs` amend düzeltmesinin (`b1b7df1b`) negatif sondasında, bash-guard
yolunu taklit eden sonda süreci komut metnini (`"git commit --amend"`) ARGÜMAN
olarak alıyordu. O dizge çocuk sürecin `ps` çıktısına sızdı; kapı `--amend`i
orada gördü ve **doğru cevabı yanlış ayaktan** verdi. Ölçüm yeşil görünüyordu,
sebebi yanlıştı.

**Kural:** *sonda, ölçtüğü mekanizmanın girdisini kirletmemeli — sonda argümanı,
ölçülen sinyalin taşıyıcısıyla aynı kanaldan geçmemeli.* Burada ölçülen sinyal
`ps` çıktısıydı, dolayısıyla senaryo bilgisi `ps`e sızmayan bir kanaldan
(ortam değişkeni) geçirildi ve sonda tekrarlandı.

Bu, "ölçtüğünü iddia eden yeşil" sınıfının o günkü ALTINCI görünümüydü; ilk
beşi koddaydı, altıncısı **ölçüm aracının kendisindeydi**. Kapı yazarken kapının
kendisini de ölç kuralının kardeşi: **sonda yazarken sondanın kendisini de ölç.**

## Yeni kapıların ilk gün getirisi

2026-09-12'de **dört** kapı doğdu ve **dördü de doğduğu gün gerçek bir kusur
yakaladı** — kurgu sondayla değil, ağaçta duran gerçek bir eksikle:

| kapı | ilk gün bulduğu GERÇEK kusur |
|---|---|
| `test_identity_ledger` | 15 ayrışma; sonrasında üç ayrı oturumda dört yakalama daha (kendisi · `6e`'nin altı stok defteri bekçisi · `01`'in `sebep-katalogu` kalemi) |
| migration monotonluk kapısı (`ea`) | test DB'sinde `160200` resolve edilmişken `160100` uygulanmamıştı; ayrıca kurgu sonda (`20260101000000_sonda_geriye_dusen`) da kırmızı verdi |
| `test_reason_preset_kind_parity` (`01`) | ilk koşumda gerçek drift: tabletin `ORDER_CANCEL` aynası eksikti |
| K6 §8 kapı↔anahtar ters kapsaması (`01`) | `kumasTeknikEnabled` ne yönetilen kümede ne muaf listesindeydi — hiçbir kümeye ait değildi |

### "Eksik olan" değil "hiçbir kümeye ait olmayan"

Son iki satır aynı aileden ve kimlik kapısının **B-c** ayağıyla da aynı: ölçülen
şey "listede olması gerekip olmayan" değil, **hiçbir listeye ait olmayan**.
`kumasTeknikEnabled` ne yönetiliyordu ne muaftı; `test_kanban_card_projection`
gerçekti ama haritanın hiçbir bölümünde yoktu. Bu sınıf tek bir kümeye bakarak
görünmez — iki kümenin FARKI değil, **birleşiminin dışı** aranır.

Kapı tasarımında tekrar edecek bir kalıp: bir kapsama kontrolü yazarken
"A'da olup B'de olmayan"ın yanına "ne A'da ne B'de olan"ı da sor.

### Kendi kendini emekliye ayıran işaret

İki ayrı yüzeyde aynı çözüm çıktı ve ikisi de elle bakım istemiyor:
- `TEKSERP_COMMIT_BASE` yalnız {HEAD, HEAD^} kümesinden bir değer kabul eder;
  kabukta unutulmuş bir SHA repo bir commit ilerleyince REDDEDİLİR.
- `01`'in `kumasTeknikEnabled` muafiyeti öyle yazıldı ki yüzey doğduğu gün §8b
  kapıyı tabloya zorlar, muaf satırı da §8e'den **ölü muaf** olarak kırmızı alır.

Kural: **kendi kendini emekliye ayıran işaret, elle bakım isteyen listeden
iyidir.** Elle tutulan muaf listesi düzelttiğin her şeyi sonsuza dek affeder.

Ölçüt olarak kayda geçsin: **bir kapı, doğduğu gün gerçek bir kusur
yakalamıyorsa ölçtüğü şeyin var olduğu kanıtlanmamıştır.** Kurgu sonda kapının
ÇALIŞTIĞINI gösterir; gerçek bir yakalama kapının GEREKLİ olduğunu gösterir.
İkisi ayrı sorulardır ve ikisi de sorulmalıdır.

## Ortak ağaçta çarpışma — ölçülen tek vaka

`74553624` (kimlik kapısı) commit'lenirken kapı 48 sn koştu; o sırada `d5`
`a99a4bc0`'ı indirdi ve HEAD kaydı. Commit `fatal: cannot lock ref 'HEAD'` ile
**reddedildi** — sessizce ezilmedi. Staged dosyalar index'te kaldı, kayıp olmadı,
yeni taban üzerinde tekrarlandı.

**Hüküm: iniş kilidi YAPILMAYACAK.** Git'in ref kilidi zaten atomiktir, yani
korunması gereken korunuyor; kaybedilen tek şey bir kapı koşumunun süresidir
(48 sn). Kilit dosyasının bedeli daha yüksek: bayat kilit beş oturumu birden
iniş-siz bırakır ve zaman aşımı eşiği seçilemez (kapı 48 sn ↔ `npm test` 6,5 dk).
Anlaşma kalır, **teşhis eklenir** — `scripts/hooks/pre-commit.mjs` artık HEAD'in
koşum sırasında kaydığını söyler ve "kayıp yok, staged dosyalar index'te kalır"
diye ekler.

## Nihai durum (push `9bfe18cb..fcc773ee`, 42 commit)

Tam koşum **494/494 · 441 sn · sıfır kırmızı**; kimlik kapısı push edilen uçta
**3/0 · 494 gerçek = 494 haritada**.

## Üçüncü okuma sınıfı: belgenin dünyaya göre bayatlaması

Kullanıcıya sunulan özetin incelemesinde iki sınıf arandı ve bulundu — **iç
çelişki** (aynı belgede "push tutuluyor" ile "gönderildi" yan yana) ve
**ölçülmemiş iddia** ("yıllardır yeşil veriyordu" → ölçüldü: repo beş aylık,
testin kendisi bir aylık). Ama `teks-erp-1e` üçüncü bir sınıf buldu ve bu ikisiyle
karıştırılmamalı:

> **Belge, kendi kapattığı işi ön şart olarak taşımaya devam ediyor.**

Somut vaka: özet "açılış fotoğrafı, şu iki yol bağlandıktan sonra çekilsin"
diyordu; o iki yol aynı gün bağlanıp inmişti (`3c15208c` + `27e785ce`). Cümle
kendi içinde tutarlıydı, yalnız **dünyaya göre** yanlıştı.

Farkı önemli: iç tutarlılık okuması bu sınıfı YAKALAMAZ. Belgeyi kendi içinde
kaç kez okursan oku çelişki çıkmaz; yakalamak için belgeyi **o gün kapanan işler
listesiyle** karşılaştırmak gerekir. Yani belge incelemesinin üç ayağı vardır:
① iç tutarlılık ② her iddianın ölçüsü ③ **belgenin dünyayla hizası**.

Ayrıca ölçmenin yönü hakkında bir not: `140–229 top/gün` rakamı gerçek ölçümdü
ama beş günlük bir pencereden alınıp genel durum gibi sunulmuştu. Yeniden ölçüm
(60 gün / 31 üretim günü) **ortanca 134, tepe 262** verdi — yani düzeltme kararı
zayıflatmadı, GÜÇLENDİRDİ. Dar pencereden ölçmek her zaman abartmaz; bazen
eksik gösterir ve o da kararı yanlış tarafa çeker.
