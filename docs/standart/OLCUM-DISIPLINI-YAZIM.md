# Ölçüm disiplini — ÖLÇÜMÜ YAZMA (sayı · çapa · kimlik)

Bu dosya [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'den **AİLE çizgisiyle** ayrıldı
(2026-09-14): orada ölçümün NASIL YAPILDIĞI ve NASIL OKUNDUĞU, burada **kâğıda nasıl
döküldüğü**. Üçünün ortak imzası şu: hepsi *ölçümden SONRA* yazılan bir metnin kuralıdır
ve hepsi okuyucunun yarın yanlışlayabilmesi için vardır — nitelenmemiş sayı, hedefini
bulmayan çapa ve repoya sızan kimlik aynı arızanın üç yüzüdür: **yazılan şey ölçümün
kendisinden fazlasını iddia eder.**

⚠️ Bölme ölçütü HIZ'dı, uzaklık değil (ölçüldü 2026-09-14): bölünen dosya son yedi günde
26 commit almıştı ve tavana 2.494 bayt kalmıştı; bu üç bölüm onun **%53'üydü**.

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

⚠️ **ÜÇÜNCÜ EKSEN, aynı gün ortaya çıktı — AYRIŞTIRICI SÜRÜMÜ.** Yukarıdaki dört sayının
dördü de, alanı `` bekçi: `[^`]*` `` ile okuyan ESKİ ayrıştırıcıyla ölçüldü; o ayrıştırıcı
alanın içindeki backtick'te duruyordu. Düzeltilince (`556b151a`) **aynı yüklem, aynı ağaç,
farklı sayı** verdi: dört alan "kesik" olmaktan çıktı, 11 bekçi adı da alanın okunmayan
yarısından ortaya geldi. (Sınıf: `OLCUM-DISIPLINI-ARAC.md` § Kapı, kendi AYRIŞTIRICISININ darlığını SAYIYA çevirebilir.)

⚠️ **DÖRDÜNCÜ ve BEŞİNCİ EKSEN, aynı gün — YÜK ve REJİM.** *(d9, ölçüldü 2026-09-13.)*
534 bekçi **ulaşılamaz DB** ile tarandı ve *"kusur kovası BOŞ"* denildi. Doğruydu —
**o rejimde.** Saatler sonra CI'da `test_qc2_idempotency` ısırdı: *"çıkış 0 ∧ özet yok ∧
beyan yok"*. Sebep dosyanın kendisinde yazılı — `:50-51` fikstür bulunamayınca bir satır
basıp `return` ediyor ve `=== Sonuç ===` satırı `:132`de, yani **erken dönüşten SONRA**.

| rejim | PROCESS_QC adımı · uygun top | sonuç |
|---|---|---|
| bir oturumun `_test` DB'si | 10 · 206 | dal tetiklenmez, dosya normal koşar |
| CI'ın taze DB'si | 0 · 0 | **erken dönüş, SESSİZ** |

Aynı yüklem, aynı ağaç, aynı ayrıştırıcı — **farklı rejim, farklı sayı.**

> **Bir sayının kimliği, ölçümün KOŞULLARIDIR.** Bugüne kadar adı konmuş eksenler:
> *yüklem* (ne sordun) · *ağaç* (hangi commit) · *ayrıştırıcı* (aracın hangi sürümü) ·
> *yük* (hangi hacim) · *rejim* (DB var/yok · sunucu ayakta/değil · fikstür dolu/boş ·
> STRICT açık/kapalı).

⚠️ **REJİM ekseninin ÖLÇÜM ALETİNE dönen yüzü** *(d9, 2026-09-13)*: bir alet yalnız TEK bir
rejimde kayıt tutuyorsa ve ölçtüğü olay BAŞKA bir rejimde gerçekleşiyorsa, o alet penceresi
dolsa da **hüküm veremez** — eşiği YAPISAL OLARAK dolmaz. Sıklık defteri
(`Teks-Erp/scripts/lib/siklik-defteri.ts`) tam bunu yaşadı: eşik `≥3 kırmızı` istiyordu,
kırmızılar YALNIZ CI'da oluyordu, defter ise yalnız yerel ağaca yazıyordu (10 kayıt, onu da
yeşil + yerel). ⇒ **Bir aletin KAPSAMI ölçtüğü olayın rejimini içermiyorsa, önce kapsam BEYAN
edilir, sonra eşik o kapsamda anlamlı hâle getirilir** — ve tek yönlü veri bir satırı KAPATMAZ,
yalnız aramayı öbür rejime taşır.

⭐ **Ve rejim ekseninin ikinci yüzü: bir kontrolün DOĞRU olması, DOĞRU YERDE koştuğu
anlamına gelmez — KOŞUM YERİ (job · rejim · çalışma dizini) de bir ölçüm koşuludur.**
*(d9, 2026-09-14; günün üçüncü üyesi. ① `test_latency_persist`in penceresi süreç SAAT
DİLİMİNE bağlıydı · ② `test_yerel_ayar_bagimliligi` süreç YEREL AYARINA · ③ `test_hook_config`
**§6** Electron vitest yapılandırmasını okuyor ama Backend job'ında Electron bağımlılığı
YOK. Üçünde de yüklem doğru; değişen, koştuğu YER.)*
> Bir kontrol *"neyi ölçtüğünü"* yazar da *"NEREDE koşması gerektiğini"* yazmazsa, yanlış
> job'a düştüğü gün ya sahte kırmızı ya sahte yeşil verir — ve ikisi de kontrolün kendi
> hatası sanılır.
📌 Panzehir: kontrolün BAĞIMLILIĞINI adıyla yaz (hangi paket · hangi kök · hangi env) ve
koştuğu job'ı o bağımlılığa göre seç; taşınamıyorsa kapsamı BEYAN et. *(Gözlem 2026-09-14,
5e: `§6a/§6b` benim ağacımda da kırmızı ve hata metni Electron çözümlemesini gösteriyor —
teşhis d9'unkiyle tutarlı; kalem d9'da.)*
Kardeşi § Zıt iki cevap = ortam farkı (`OLCUM-DISIPLINI-SINIFLAR.md`).

⚠️ **Ve asıl uyarı sayıda değil, LİSTENİN KENDİSİNDE:** bu liste tek günde **iki → üç →
beş** oldu. *"Üç parçadır"* cümlesi yazıldığı gün doğruydu ve aynı gün bayatladı. ⇒
Eksen sayısını ezberleme; **eksen listesini AÇIK yaz** ve yeni bir sayı üretirken sor:
*bu sayıyı, benimkinden farklı bir koşulda ölçen biri farklı bulur muydu?*

**Savunma (d9):** bir tablo üretirken **başlığına damgaları ÖNCE yaz, satırları sonra
doldur** — sonradan eklenen damga, eksik olanı hatırlatmaz.

⚠️ **Farkı çözen şey SAYI değil SATIRDIR.** İki bağımsız ölçüm ayrıldığında sayıları
karşılaştırmak yetmez — *hangi satır* sorusuna inilmeden fark kapanmaz.
*(Vaka 2026-09-13: iki oturum 26 ↔ 25 ölçtü ve **ikisi de karşı tarafın haklı olduğunu
varsaydı** — biri kendi sayısını "dar" sanıp yükseğini yazdı, öteki kendi desenini
suçladı. Fark ancak tek bir satıra inilince çözüldü: fazlalık bir YORUM satırıydı,
doğru sayı 25'ti. İkisi de emin olsaydı yanlış sayı kalacaktı.)*

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

- **Bir belge bir bekçiden söz ederken SAYIYI değil ARM'ı yazar.** Kontrol sayısı
  bir koşumun özelliğidir (döngüler, atlanan HTTP turu, fixture) ve sessizce
  bayatlar; **bölüm adı ile o bölümün İDDİASI** bekçi yeniden yazılmadıkça durur.
  *(Vaka 2026-09-13: iki kural satırı `test_superadmin_visible (30 kontrol)` diyordu,
  kaynakta 27 vardı. 30'u 27 ile değiştirmek aynı bayatlamayı bir yıl sonra tekrar
  kurmaktı; yerine `§1 (gizleme sembolleri kaynakta YOK) + §6 (yetki bozulmadı)`
  yazıldı — okuyan hem NEREYE bakacağını hem NE beklediğini görüyor.)*
  Sayı yine de yazılacaksa **yanına neyin sayısı olduğu** yazılır
  (`§7 (8; …)` = o bölümdeki kontrol adedi, koşum adedi değil).

- **İLERİ TARİHLİ ölçüm iddiası — tarih de bir ÖLÇÜMDÜR, tahmin edilmez.** Bir ölçüme
  konan tarih onun *ne zaman doğru olduğunu* söyler; yanlış yazılırsa ölçüm **geleceğe
  ait** görünür ve hiçbir kapı bunu görmez.
  ⚠️ **`check-docs`ın tarihsiz-sayı kolu burada KÖRDÜR:** yüklemi
  `/\b20\d{2}-\d{2}-\d{2}\b/` — tarihin **VARLIĞINI** arar, **DOĞRULUĞUNU** değil.
  Tarihli ama yanlış bir satır, tarihsizinden daha ikna edicidir.
  *(Vaka 2026-09-13, aynı gün İKİ kez: sabah bir reçete satırı, akşam entegratör oturumu
  gece yarısını geçtiğini sanıp saatlerce `2026-09-14` yazdı ve peer'lar ondan devraldı —
  25 dosya / 53 satır (hüküm başlığı, sabit yorumları, arşiv başlıkları, kural satırları,
  kanca yorumları) tek commit'le geri çekildi. Dokunulmayanlar bilinçli: Electron fikstür
  tarihleri ve **uygulanmış** bir migration yorumu — migration immutable'dır, kapı
  durdurur.)*
  > **Tarih yazarken `date` KOŞULUR.** Uzun bir oturumda "şu an saat kaç" bir HATIRLAMA
  > değil bir ÖLÇÜMDÜR; bağlam ne kadar uzunsa tahmin o kadar kayar.

> **Var olmayan bir sayı bayatlayamaz.**
> Var olması gerekiyorsa, **yanında yükleminin adı durur.**

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
