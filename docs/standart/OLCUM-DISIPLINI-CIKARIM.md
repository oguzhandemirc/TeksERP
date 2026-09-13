# Ölçüm arıza sınıfları · KATMAN 2 — ölçümden sonraki adım

[`OLCUM-DISIPLINI-SINIFLAR.md`](OLCUM-DISIPLINI-SINIFLAR.md)'in ikinci katmanı; 2026-09-13'te oradan **bölünerek** geldi (katalog tek günde +20 sınıf aldı; tavan yükseltilmedi). **KATMAN 1 — ölçümün kendisi** orada, **yöntem kuralları ve kapının ölüm biçimleri** [`OLCUM-DISIPLINI.md`](OLCUM-DISIPLINI.md)'de.

**Buradaki her sınıfta ÖLÇÜM GEÇERLİDİR.** Yanlış olan, ölçümden sonra atılan adım — mekanizma, birim, taşıma, arka durak, kaçış, dizge. Katman 1'de ölçüm yanlıştır ve pozitif kontrol/örnekle doğrulama onu yakalar; **burada gözlem doğrudur ve doğrulanmıştır, bu yüzden açıklama da doğrulanmış sanılır. Hiçbir pozitif kontrol bu katmanı yakalamaz.**

⚠️ **Numaralar bu listenin SIRASIDIR, kalıcı kimlik değil** — bir sınıf ADIYLA anılır.

---

## KATMAN 2 · Ölçümden sonraki adım

Buradaki her sınıfta **ölçüm geçerlidir**. Yanlış olan, ölçümden sonra atılan adım.

### 10 · Doğru gözlemden yanlış mekanizma çıkarmak
Gözlem doğrulanabiliyor; **açıklama** doğrulanmıyor ama doğrulanmış sanılıyor.
*(Vaka 2026-09-12: aynı doğru kapı gözlemini paylaşan üç oturum, üç ayrı uydurma
mekanizma üretti.)*
**Savunma:** gözlemi ve mekanizmayı AYRI cümleler olarak yaz; mekanizmanın kendi
ayırt edici sondasını sor — *"bu mekanizma yanlışsa hangi ölçüm farklı çıkardı?"*

### 11 · İki sayı yan yana durunca aynı birimde sanılır
İki ölçüm de geçerlidir; yanlış olan **ikisini aynı eksende okumaktır**.
*(Vaka: `62/1` ↔ `63/0` KONTROL sayılarıydı, eşik ise SATIR sayısındaydı.)*
⚠️ **Hiçbir pozitif kontrol bunu yakalayamaz** — iki sayı da doğrudur.
**Savunma:** yan yana yazdığın her iki sayıya BİRİMİNİ iliştir; birim yazılamıyorsa
sayılar karşılaştırılamaz.

### Damgayı, ÖLÇTÜĞÜN SİSTEMİN saat diliminde oku — kendi sezginde değil
§11'in (birim) zaman eksenindeki hâli ve daha sinsisi: **araç bozuk değil, sayı doğru,
OKUMA yanlış.**
*(Vaka 2026-09-13: `sacks.createdAt` UTC `22:25:28` ↔ Europe/İstanbul `01:25:27.956`.
Üç saatlik fark, *"benden önce doğmuş"* ile *"tam benim koşumumun anı"* arasındaki
farkı üretti; ölçen kişi **kendi ölçüm artığını** başka bir bekçinin temizlik kusuru
sandı — ve ikinci bir oturum bunu onayladı.)*
> **Bir ölçümün ürettiği hikâye ne kadar tutarlıysa, birim hatasını o kadar iyi
> gizler.**

📌 **Bu sınıfın kapısı YOK ve bu ölçüldü:** projenin iki savunması —
`PG_SESSION_OPTIONS -c timezone=UTC` ve *"tek kaynak `src/constants/time.ts`"* —
**koda** bakar. **Elle sorgu yazan insana bakan hiçbir şey yok.**
**Savunma:** damga okurken saat dilimini ölçüme YAZ (`… AT TIME ZONE 'Europe/Istanbul'`
ya da açıkça "UTC"), ve karşılaştırdığın iki damganın aynı dilimden geldiğini doğrula.

### 12 · Kapsamını yitirmiş ölçüm
Araç doğruydu, kapsam bilinçliydi; kusur ölçümün **TAŞINMASINDADIR** — kapsam
sonuçla birlikte seyahat etmedi ve sayı, doğduğu yerden geniş bir iddiaya dönüştü.
**Savunma:** sayıyı **nitelendirerek** taşı (*"X koşulunda, Y hariç: 42"*). Niteliği
düşen sayı artık o ölçümün sonucu değildir.

### 13 · "Arka durağı var" cümlesi de bir İDDİADIR
Bir kapıyı gevşetirken *"nasılsa şurada yakalanır"* demek, o "şura"nın
**varlığını ölçmeyi** gerektirir.
*(Vaka 2026-09-12: gevşetme gerekçesi bir `pre-push` hook'una dayandırıldı; ölçüldü
2026-09-13 — `core.hooksPath=.githooks` ve o dizinde YALNIZ `pre-commit` var, `pre-push` YOK.)*
⚠️ **Yön asimetrisi:** bu hataya **gevşetirken** düşülür; sıkılaştırırken kimse arka
durak aramaz.
**Savunma:** arka durağı ADIYLA yaz ve aynı cümlede varlığını ölç.

### 14 · Kapıyı aşmanın üç yolu
| Yol | Görünürlük | Gerçek maliyet |
|---|---|---|
| **Kaçış** (`TEKSERP_HOOK_SKIP=1`, `--no-verify`) | kayda geçer, yetki ister | orta |
| **Lafızdan kaçış** — kapının metnini sağlayıp ruhunu atlamak | **görünmez** | **en yüksek** |
| **Yöntem değiştirmek** | en pahalı GÖRÜNEN | gerçekte en ucuzu |

Bir kaçışın asıl maliyeti bir kuralı çiğnemek değil — **bir sorunun sorulmasını
engellemektir.** Kaçış varken teşhise ihtiyaç duyulmaz; çelişki **ilginç olmaktan
çıkar.** *(Vaka: aynı kırmızıya üç kez kaçışla yaklaşıldı, dördüncüde ölçümle —
kök sebep dördüncüde çıktı.)*
**Kapı kaçışı KULLANICI KARARIDIR**; ajan kendi başına kaçışa yetkili değildir.

### 15 · Bir dizge ne bağlamını ne modelini taşır
Bir ad, bayrak ya da sabit **metin olarak** eşleşir; hangi dosyada, hangi tabloda,
hangi modelde yaşadığını taşımaz.
*(Bir gecede dört nüks: fonksiyon adı yorum metninde · `isDefault` dört ayrı tabloda ·
tolerans satırı yorum içinde · `grep` artefaktından kurulup başkasına iş olarak
verilen liste.)*
**Savunma:** dizgeyi taşıyan her listeye **nerede yaşadığını** yaz; taşıyamıyorsan
liste bir iş tanımı değil bir arama çıktısıdır. Yakın akrabaları: KATMAN 1 § Dolaylılık ve § Teşhis mesajı da bir yüklemdir.

### "0 mı?" ile "0 KALACAK mı?" aynı ölçümle cevaplanmaz
İlki bir **SAYIM**, ikincisi bir **YAZAR ENVANTERİ**.
*(Vaka: "deposuz top 0" doğruydu — ama `backfill_roll_warehouse` HİÇBİR zincirde yok
⇒ o 0 bir kod özelliği değil bir **OLAY**: birinin bir kez elle koşturması. 11 terfi
yolunun hiçbiri `warehouseId`ye dokunmuyor.)*
**Savunma:** bugünkü sayı bir değişmez iddiası kuracaksa, o alana YAZAN yolları say.

### Aynı doktrin cümlesinin iki uygulama yeri, aynı arızayı taşımaz
*(Vaka: *"TTL tazeliktir"* → **JWKS** = kapsam EKSİK + üstelik FAZLA kapsam beyan
eden bir atıf; **`ReasonPreset`** = kapsam TAM + hiç atıf YOK. Simetri varsayılsaydı
gereksiz ikinci bir bekçi yazılır, gerçek eksik — bir belge satırı — ıskalanırdı.)*
> **Yanlış bir atıf, atıfsızlıktan daha tehlikelidir:** yanlışsa yalan söyler, yoksa
> yalnız sessiz kalır.

### Bir bulguyu KÜÇÜLTEN ölçüm de bir ölçümdür — ve daha zorudur
*(Vaka: bir `rows[0]` bulgusu "sapma"dan "çoklu adayda fail-closed yok"a indi;
`3d8341de`in yorumu kuralı **bilerek** bırakmıştı.)*
**Savunma:** bulguyu büyüten ölçüm kendiliğinden yazılır; **küçülteni yazmak disiplin
ister** — ve bulgunun boyutu da bir iddiadır.

### Bir kontrolün gördüğü sayı, arızanın BOYUTU değildir
*(Vaka: `test_consistency` §10 yalnız "adımsız `IN_PRODUCTION`" **üçünü** görüyordu;
gerçek artık koşum başına **7 top + 5 sapma** idi.)*
**Savunma:** kontrolün YÜKLEMİNİ, arızanın TANIMIYLA yan yana koy — fark oradadır,
sayıda değil.

### Sessiz atlama bir DAYANIKLILIK değil, bir GÖRÜNMEZLİK özelliğidir
Hatayı ortadan kaldırmaz; **onu arayacak kişiden gizler.**
*(Bir günde üç kez: `writeWarehouseMovement`in `return false`u · on üç temizlik
adımındaki `.catch(() => {})` — fatura BAŞKA bir bekçiye çıkıyordu · üç terfi
sitesi.)*
**Savunma:** yutulan her hata en az bir yere **sayılarak** düşer; "best-effort"
demek, "izsiz" demek değildir.

### Bir temizlik eksikliğinin faturası, onu ÜRETEN bekçiye çıkmaz
Artık, üreteni yeşil bırakıp **başkasını** kırmızıya düşürür — ve teşhis o başkasında
aranır.
*(Üç ölçülmüş vaka, üç farklı kurban: `test_tambur_over_quantity`in `.catch(() => {})`i
→ fatura **`test_consistency` §10**'a (`562b8cf6`) · bekçi fikstürlerinin 24 deposuz
stok topu → fatura **§29 kapısına** · bir ölçüm betiğinin düşen temizliği → fatura
**`test_consistency` §6**'ya.)*
**Savunma:** temizlik hatası **yutulmaz, BASILIR** (`temizlikHatasi` deseni) ve silme
sırası defter bağlarına uyar. Kardeşi bir üstteki § Sessiz atlama: aynı `.catch(() => {})`,
burada faturası başkasına çıkıyor.

### "Atlanan" sayısı, koşmayan YÜKLEM sayısı değildir — ve bir ALT SINIRDIR
Atlanan BÖLÜM sayılır; her bölümün içinde kaç yüklem olduğu bilinmez ve **oran
bekçiden bekçiye değişir**.
*(Vaka 2026-09-13: bir bekçide 18 atlama → **24** yeni yüklem; bir başkasında 20
atlama → **+17**. Beş portun toplamı: beyan edilen 61 kör yüklemden **57'si
kapatıldı, 62 yüklem ilk kez koştu, 0 kusur çıktı**.)*
> **Beyan edilmiş bir eksiklik bile, ölçülmeden BİLİNMİYOR.** "18 atlama" bir envanter
> değil bir alt sınırdır.
**Savunma:** atlama sayısını kapsam iddiasına çevirme; kapatınca **ne kadar yüklemin
ilk kez koştuğunu** ayrıca say.

### Muafiyet yazmadan önce sor: muaf olan şey kuralın DIŞINDA mı, yoksa KURAL mı yanlış çizilmiş?
*(Vaka 2026-09-13: yeni bir enum aynası bir tripwire'a takıldı. Muafiyet yazılmadı,
**kural düzeltildi** — kapı "fabrikanın AÇIK katalog kodlarını tipe gömmek"i
hedefliyordu, takılan şey ise bir **KAPALI şema enum'unun aynası**ydı. Ayrım yapısal
kuruldu: tripwire artık şemayı okuyor ve üyeler birebir örtüşüyorsa ayna sayıyor —
beyan değil, ÖLÇÜM.)*
⭐ Ve doğru çizilen istisna **ikinci bir sınıfı da kapattı**: tam örtüşme arandığı
için ayna şemadan **ayrışırsa da** kırmızı veriyor — yani "aynanın üyeleri hayalet"
kusurunun kapısı da kurulmuş oldu.
> **Bir istisna, doğru çizilirse ikinci bir sınıfı da kapatabilir; bir muafiyet yalnız
> listeyi büyütür.**

### Bir atlama, ölçülebilen KOMŞUSUNU da götürürse kapsam sessizce kaybolur
*(Vaka: bir testte dosya-varlığı yüklemi ayrı bir `it`e çıkarıldı; yanındaki
yapılandırma alanı kontrolleri **her ortamda koşmaya devam etti**. Aynı `it` içinde
kalsalardı bir sonraki kişi atlamayı genişletir ve üçü birden kaybolurdu.)*
> **Beyanlı atlama bir MUAFİYET değil, bir GÖRÜNÜRLÜK kararıdır** — sıkı modda
> (`TEKSERP_STRICT=1`) atlama yoktur, koşar ve kırmızı verir.
**Savunma:** atlanacak yüklemi kendi bloğuna al; atlama **en dar** yüklemi kapsasın.
Kardeşi bir üstteki § "Atlanan" sayısı bir ALT SINIRDIR.

### Bir deneyin ÜÇ olası sonucunun anlamı, deney koşulmadan ÖNCE yazılır
Ön kayıt: sonucu gördükten sonra yazılan ölçüt **her zaman tutar**.
*(Emsal biçim — bir koşucu düzeltmesinin sınanması: **kırmızı + ad geldi** → teşhis
var · **kırmızı + ad gelmedi** → düzeltme eksik, kusur bende · **yeşil** →
sıra/ortam bağımlılığı KANITLANDI ama sebep hâlâ bilinmiyor ⇒ kalem **kapanmaz,
sınıfı değişir**.)*
⚠️ Gerekçesi tam üçüncü sonuçtadır: ***"düzeldi" diye kapatma baskısı orada doğar.***
> **Sonucu önceden anlamlandırmak, sonucu gördükten sonra savunma refleksiyle
> yorumlamayı engeller.**
*(İkinci vaka: yan yana duran iki ön kayıt — ikisi de tutmadı; tutmaması da bir
bulguydu ve ancak ÖNCE yazıldıkları için bulguydu.)*

### Bir dosyanın TOPLAMINDAKİ fark, bir SİTEYE ancak tek dal varsa atfedilir
İki koşum arasında bir dosyanın toplamı değiştiyse, bunu belirli bir satıra
bağlayabilmen için o dosyada **veriye bağlı TEK bir dal** olması gerekir. Birden çok
dal varsa fark hangisinden geldi, bilinmiyor. *(d5)*
**Savunma:** atıf kurmadan önce dalları say; sayamıyorsan farkı dosyaya ata, satıra değil.

### Bir kusurun ADI, kusurun YERİ değildir
Kendi verdiğin sınıf adı iki adım sonra **senin için kanıta dönüşüyor**: adı koyan
sensin, ama sonra ona sanki bağımsız bir ölçümmüş gibi dayanıyorsun. *(ea)*
**Savunma:** sınıf adını kanıt olarak kullanma — ada değil, adı doğuran ÖLÇÜME dön.
Kardeşi § "Bu benim değil" bir ÖLÇÜM olmalı.

### Beyan, kapsamın YERİNE GEÇMEZ
`atla()` bir boşluğu **GÖRÜNÜR** kılar, **KAPATMAZ**. Beyan edilmiş bir atlama dürüsttür
ama kapsam değildir; "beyan ettim" ile "ölçtüm" aynı cümle değil. *(1e)*
Kardeşleri § "Atlanan" sayısı bir ALT SINIRDIR ve § Bir atlama, komşusunu da götürürse.

### İki operasyonel kural

- **Paket içinde kırmızı + tek başına yeşil ⇒ kusur kodda değil, koşumun DURUMUNDA.**
  Sıra, paylaşılan DB, artık veri — ayırt edici koşum sırasını değiştirmektir.
- **Bir düzeltme, komşu bir kusurun SEMPTOMUNU kaldırabilir — kusuru değil.**
  Yeşile dönen şeyin, düzelttiğini sandığın şey olduğunu ayrıca ölç.
