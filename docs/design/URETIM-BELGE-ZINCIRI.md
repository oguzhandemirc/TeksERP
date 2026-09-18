# ÜRETİM BELGE ZİNCİRİ — devere · dokuma · ham giriş ve sonrası

> **Soru (kullanıcı, 2026-09-18):** levent (devere), dokuma ve ham girişten sonrası (fason · kurşun ·
> tambur) üç ayrı iş emri tipi mi? İş emri süreçleri "profesyonel programlardaki gibi" olsun; önce
> **bağlı olup olmama** kararlaştırılsın; sonra izleme planı.
>
> **Kullanıcı ilkesi (03:50):** *"bizi ayıran şey UI ve süreçlerin KOLAY ve BASİT yürütülmesi — simple
> is more."* ⇒ Profesyonel programların **MODELİ** alınır, **ekran kalabalığı alınmaz**. Karmaşıklık
> modelde yaşar; yüzeyde tek yol olur. Bu yüzden §6'da her tablet akışının **adım sayısı** bir kabul
> ölçütüdür — model doğru ama operatör iki ekran fazla dokunuyorsa tasarım reddedilir.
>
> **Durum:** KARAR BELGESİ — uygulama kullanıcı testinden SONRAKİ faz. §8'deki üç seçenekten biri
> seçilmeden kod yazılmaz. §1 araştırma, §2 ölçüm, §3–§7 öneri.

## 0. Yöntem ve kapsam beyanı

- **Ölçülen** (bu repo, 2026-09-18): şema modelleri ve bağları, tablet modül listesi — §2.
- **Araştırılan** (kamuya açık kaynak, WebSearch): SAP PP · Datatex NOW · Infor CloudSuite Fashion
  (M3) · BMSvision WeaveMaster · TR dikeyleri (Uyumsoft, Nebim) ve dokumacı ERP rehberleri — §1,
  kaynaklar §9.
- **ÖLÇÜLEMEDİ** (dürüstlük kaydı): Infor M3'ün dokuma/terbiye için AYRI emir tipi kullanıp
  kullanmadığı ve TR dikeylerinde **ayrı bir çözgü/levent belgesi** olup olmadığı kamuya açık
  kaynaklardan doğrulanamadı; bu satırlar tabloda "doğrulanamadı" diye durur, "yok" diye değil.
  Ürün dokümantasyonu erişimi olan biri bunları kapatabilir.

## 1. SEKTÖR ARAŞTIRMASI

### 1.1 Ortak kalıp: TALEP belgesi ile İCRA belgesi ayrıdır

Dört sistemin dördünde de planlama çıktısı ile sahada icra edilen belge **ayrı nesnelerdir**:

- **SAP PP:** MRP bir *planlı sipariş* (planned order) üretir — bu hâlâ MRP tarafından değiştirilebilir
  bir ÖNERİDİR; *üretim siparişine* (production order) dönüştürüldüğü anda sahada koşan KESİN bir
  belge olur ve MRP ona dokunmaz. Dönüşümde planlı sipariş silinir.
- **Datatex NOW:** üretim modeli açıkça **iki varlık** üzerine kurulu — *Production Demand*
  (planlamadan otomatik doğar; makine çizelgesi, malzeme ve kapasite rezervasyonu) ve *Production
  Order* (departman/proses seviyesine göre işlerin gruplanması, izleme ve malzeme/kapasite kaydı).
- **BMSvision WeaveMaster** (dokuma MES'i): *Planboard* grafik çizelge, izleme sistemiyle entegredir
  ve "planlayıcı emirleri gerçek zamanlı bilgiyle güncellenir" — yani emir planlama tarafında yaşar,
  saha ona rapor eder.
- **TR dikeyleri:** iş emri "üretim modülünün temel veri birimi" olarak tanımlanır; Nebim'de iş emri
  ve **bölüm bazında** planlar ayrı ayrı takip edilir, renk/adet bazında farklı zamanlarda planlanır.

⇒ **Bizim için sonucu:** "tek belge + tip" kalıbı sektörde YOK; olan şey **seviyeli belgeler + aralarında
bağ**. Bizde de `WeavingOrder` (dokuma icra) ile `WorkOrder` (top rotası) farklı sorulara cevap veriyor.

### 1.2 Tekstile özgü: ara seviyeler kendi kimliğini taşır

Datatex'in çok seviyeli tekstil yapısında sistem, bitmiş kumaş için çözgü ve atkı ipliği ihtiyacını
hesaplarken **ara seviyelerin üretim miktarlarını da** hesaplar: boyalı iplik → **çözgü leventi** →
ham kumaş → bitmiş kumaş. Ve izlenebilirlikte **emir, levent, tezgah, iplik lotu ve top kimlikleri
elle yeniden girilmeden akar**. Dokumacı ERP rehberlerinde tipik akış şöyle tarif edilir: müşteri
spesifikasyonu → iplik rezervasyonu → **çözgü ve haşıl** → **tezgah tahsisi** → ham top üretimi →
muayene/derecelendirme → bitmiş top → sevk; ham kumaş "Parti No · Tezgah No · Vardiya" ile izlenir ki
bir kusur makineye ya da iplik lotuna kadar geri götürülebilsin.

⇒ **Bizim için sonucu:** levent bir ARA SEVİYEDİR ve kendi kimliği olması sektör standardıdır — bugün
zaten öyle (`WarpBeam`). Eksik olan, o kimliğin **hangi talebi beslediğinin** yazılı olmaması.

### 1.3 Saha kaydı emre BAĞLI mı? — iki ekseni karıştırmayın

Brief'teki "order-bound confirmation mı backflush/unbound mı" sorusu aslında **iki ayrı eksendir** ve
sektör kaynakları bunları ayırıyor:

| Eksen | Soru | SAP'taki karşılığı |
|---|---|---|
| **A — Kayıt bir belgeye bağlı mı?** | Operatörün bildirdiği üretim hangi belgeye yazılıyor? | Onay (confirmation, CO11N) **daima bir emre** yazılır. SAP'ta "emirsiz üretim bildirimi" yoktur |
| **B — Bileşen/çıktı otomatik mi düşülür?** | Sarfiyat elle mi girilir, onayla birlikte otomatik mi? | **Backflush**: onay anında bileşenleri otomatik düşer. Emirle ilgisi yok; emrin İÇİNDEKİ bir ayardır |

Backflush'ın sektördeki uyarısı da doğrudan bizim vakamıza bakıyor: bileşen tüketimi parti başına
DEĞİŞİYORSA ya da operasyon günlerce sürüyorsa backflush önerilmez — çünkü malzeme sürecin başında
tüketilir, onay ise sonunda gelir ve stok farkı doğar. **Dokuma tam bu sınıftadır:** levent tüketimi
ölçüme bağlıdır ve koşum günlerce sürer ⇒ bizde de levent tüketimi ayrı ve açık bir kayıttır
(`WarpBeamEvent`), doff/koşum onayına bindirilmez. Bu tasarım zaten sektör tavsiyesiyle aynı yerde.

### 1.4 Karşılaştırma tablosu

| Sistem | Talep/plan belgesi | İcra belgesi | Çözgü/levent ayrı belge mi | Saha kaydı belgeye bağlı mı | Bizdeki karşılık |
|---|---|---|---|---|---|
| SAP PP | Planlı sipariş (MRP önerisi) | Üretim siparişi (kesin) | Ayrı üretim siparişi (yarı mamul seviyesi) | **Evet** — onay daima emre yazılır; backflush ayrı eksen | `WorkOrder` ↔ `OrderLine` bağı var; dokuma tarafı bağsız |
| Datatex NOW | Production Demand | Production Order (departman/proses grubu) | **Evet** — levent ara seviye, kendi miktarı hesaplanır | **Evet** — emir/levent/tezgah/lot/top kimlikleri elle girilmeden akar | `WeavingOrder` + `WarpBeam` var, aralarında bağ YOK |
| Infor CloudSuite Fashion (M3) | Talep/planlama katmanı | Üretim emri | **doğrulanamadı** | **doğrulanamadı** | — |
| BMSvision WeaveMaster (MES) | Planboard (grafik çizelge) | Tezgahtaki emir | Ayrı modül olarak doğrulanamadı | **Evet** — planlayıcı emirleri gerçek zamanlı güncellenir | `MachineRun` ↔ `WeavingOrder` (bugün opsiyonel) |
| TR dikeyleri (Uyumsoft · Nebim) | Üretim planı / bölüm planı | İş emri ("temel veri birimi") | **doğrulanamadı** | Emir + bölüm bazlı takip | `WorkOrder` |

## 2. BUGÜNKÜ ZEMİN (ölçüldü 2026-09-18)

| Belge | Ne taşıyor | Neye BAĞLI | Neye bağlı DEĞİL |
|---|---|---|---|
| `WeavingOrder` | kumaş · renk? · çözgü kartı? · `plannedM` (HEDEF, tetik değil) · `executionKind` IN_HOUSE/SUBCONTRACTED (+ fasoncu XOR) · durum · plan tarihleri · kapanış/iptal | tezgah koşumları (`MachineRun.weavingOrderId`), fason sevk/kabul | **sipariş satırı YOK · iş emri YOK** |
| `WarpBeam` | çözgü kartı · köken (IN_HOUSE/PURCHASED/SUBCONTRACT/CONSIGNED) · durum · takılıysa makine+yuva | takıldığı makine (yalnız MOUNTED'da), iplik lotu olayları | **dokuma işi kolonu HİÇ YOK** — bağ yalnız *makine ∩ zaman penceresi*nden türetilir |
| `MachineRun` | tezgah · hat · başlangıç/bitiş · terimler | `weavingOrderId` **NULLABLE** | — (bağsız koşum bugün MEŞRU) |
| `DoffEvent` | indirilen kumaş anı | `machineRunId` (opsiyonel) | `weavingOrderId` **kolon değil** (koşumdan türer) |
| `Roll` (KK1) | `entrySource=WEAVING` + `doffEventId` | rotadaki adım (`currentStepId`) | doğrudan iş emri kolonu yok |
| `WorkOrder` | tip `ORDER_PRODUCTION`/`STOCK_PRODUCTION` · durum · plan | `WorkOrderToOrderLine` (tahsis + koparma damgası) | dokuma işine bağ YOK |

**Zincirin bugünkü hâli:** `OrderLine → WorkOrder` ✔ · `WeavingOrder → MachineRun → DoffEvent → Roll`
✔ (aşağı doğru) · **`OrderLine/WorkOrder ↔ WeavingOrder` ✘** · **`WeavingOrder ↔ WarpBeam` ✘**.
Yani üretimin ilk yarısı (levent + dokuma) ile ikinci yarısı (top rotası) **birbirini görmüyor**;
"bu sipariş için kaç metre dokundu" sorusu bugün ancak elle kurulan bir varsayımla cevaplanıyor.

## 3. KARAR 1 — üç belge mi, tek iş emri + tip mi?

**Öneri: ÜÇ BELGE KALIR.** `WarpBeam` (levent planı/kimliği) · `WeavingOrder` (dokuma icrası) ·
`WorkOrder` (topun rotası). Gerekçe üç ayrı ölçüte dayanıyor:

1. **MV-01 (kimlik ≠ rol):** üçü aynı nesnenin rolleri değil, **ayrı yaşam döngüleri olan ayrı
   nesnelerdir** — levent sarılır/takılır/tüketilir/biter; dokuma işi planlanır/koşar/kapanır; top
   rotada adım adım ilerler. Tek tabloya `type` ile toplamak, MV-01'in yasakladığı şeyin aynısıdır:
   farklı kimlikleri tek tabloda tutup ayrımı bir enum'a yaptırmak.
2. **Alan kümeleri ayrışır ⇒ XOR kolon sınıfı:** tek `WorkOrder`'da levent alanları (yuva, çözgü
   kartı, kalan metre) dokuma dışı emirlerde hep NULL, rota alanları levent emrinde hep NULL olurdu.
   Bu, `CariAccount` vakasının (MV-02, XOR'lu çift bağ) tekrarıdır — repo bunun bedelini bir kez ödedi.
3. **Altıncı enum değeri sınıfı:** `WorkOrderType`a üçüncü/dördüncü değer eklemek, tipi okuyan her
   yolu (rota, kapsama, rapor, izin) sessizce genişletir. Repo kuralı: enum'a değer eklemek reçeteli
   iştir ve "altıncı enum değeri unutuldu" bilinen bir sessiz hata sınıfıdır.

**Eksik olan belge sayısı değil, ARADAKİ BAĞ ve ORTAK DİL.** Sektör kalıbı da bu (§1.1): seviyeli
belgeler + aralarında talep zinciri.

### 3.1 Önerilen zincir (şema yalnız EKLER, her bağ OPSİYONEL doğar)

```
OrderLine ──(var)── WorkOrderToOrderLine ──(var)── WorkOrder ──(var)── WorkOrderStep ─→ Roll
    │                                                   ▲
    │  (YENİ, opsiyonel)                                │ (YENİ, opsiyonel: dokunan top hangi işten)
    ▼                                                   │
WeavingOrder ──(YENİ, opsiyonel)──→ WarpBeam      DoffEvent ─→ Roll (entrySource=WEAVING)
    │
    └──(var)── MachineRun ──(var)── DoffEvent
```

Üç yeni bağ, üçü de nullable ve **varsayılanı bugünkü davranış**:

| # | Bağ | Anlamı | Zorunlu mu |
|---|---|---|---|
| Y1 | `WeavingOrder.orderLineId?` (ya da `WorkOrderToOrderLine` emsali bir pivot) | "bu dokuma işi hangi siparişi besliyor" | HAYIR — stoka dokuma meşru |
| Y2 | `WarpBeam.weavingOrderId?` | "bu levent hangi iş için sarıldı" | HAYIR — stoğa/serbest levent meşru |
| Y3 | `WorkOrder.weavingOrderId?` (ya da `Roll` üzerinden türetme) | "bu top hangi dokuma işinden doğdu" | HAYIR — dışarıdan gelen top meşru |

⚠️ **Y1 için pivot mu kolon mu**, MV kapılarıyla §7'de cevaplanıyor: bir dokuma işi birden çok
sipariş satırını besleyebiliyorsa (kısmi tahsis) `WorkOrderToOrderLine` emsali **pivot** doğru;
besleyemiyorsa kolon yeter. **Bu, kullanıcıya sorulacak tek modelleme sorusudur** (§8'de seçenek).

## 4. KARAR 2 — hangi tablet akışı hangi belgeye, ZORUNLU mu OPSİYONEL mi?

İlke: **belge ZORUNLU olduğu an, operatörün önüne bir seçim ekranı gelir.** Bu yüzden zorunluluk
yalnız iki koşulda meşrudur: (a) kaydın anlamı belgesiz TANIMSIZ oluyorsa, (b) belgesiz kayıt
sonradan elle düzeltilemeyecek bir defter satırı yazıyorsa. Onun dışında **opsiyonel + varsayılan
doldurma** (bağlamdan türet) tercih edilir — "simple is more".

| Tablet akışı | Belge | Bağ | Gerekçe | Bağsız kayıt meşru mu |
|---|---|---|---|---|
| **Levent Sarım** (devere) | `WeavingOrder` | **OPSİYONEL** (Y2) | Levent stoğa da sarılır; iş belliyse seçim bağlamdan ön-dolar | **Evet** — "serbest levent"; raporda *işsiz levent* kovası |
| **Tezgah — koşum aç/kapa** | `WeavingOrder` | **OPSİYONEL ama VARSAYILAN DOLU** | Tezgahta takılı levent bir işe bağlıysa (Y2) koşum onu ÖN-DOLDURUR; operatör onaylar | **Evet** — stoka dokuma; raporda *işsiz koşum* |
| **Tezgah — duruş** | (koşumun belgesi) | **TÜRETİLİR** | Duruş koşuma yazılır; ayrı bağ SORULMAZ | — |
| **Tezgah — top indirme (doff)** | (koşumun belgesi) | **TÜRETİLİR** | Doff koşuma bağlı; iş bağı koşumdan gelir | — |
| **KK1 — ham giriş** | `WeavingOrder` (dokuma kökenli topta) | **TÜRETİLİR** (`doffEventId` → koşum → iş) | Operatör zaten doff seçiyor; ikinci soru sormak fazlalık | **Evet** — dışarıdan alınan/iade top: `entrySource` zaten söylüyor |
| **KK1 — yarı mamul / satın alma girişi** | — | **BAĞ YOK** | Bu top üretimden doğmadı | Evet (kural değil, tanım) |
| **Fason Dokuma Kabul** | `WeavingOrder` (SUBCONTRACTED) | **ZORUNLU — bugün de öyle** (ölçüldü: uç şeması `weavingOrderId`yi uuid olarak İSTER; kolon nullable çünkü model öteki makbuz türleriyle ortak, ayrımı CHECK yapar) | Fasona verilen iş zaten bir işe karşılık gider; makbuz hangi işe geldiğini söylemezse fire/kapanma ölçülemez | Hayır |
| **Fason Sevk / Kabul** (top rotası) | `WorkOrder` | **bugünkü davranış korunur** | Bu akış rota dünyasında; değişiklik önerilmiyor | — |
| **Kurşun · Tambur · KK2** | `WorkOrder` | **bugünkü davranış korunur** | Topun rotası; `currentStepId` zaten belge bağıdır | — |
| **Tartı/Paket · Sevkiyat** | `Shipment`/`Sack` | değişiklik yok | — | — |

**Bağsız kayıt raporda nasıl görünür** (ölçülebilir kural): her rapor, bağsız satırları **ayrı bir
kovada ve ADIYLA** gösterir — *işsiz levent*, *işsiz koşum*, *dokuma kökeni bilinmeyen top*. Sayıyı
gizlemek ya da "bilinmiyor" diye tek torbaya atmak yasak; kova adı ne olduğunu söyler. Bu, dokuma
raporlarındaki mevcut "ölçüldü mü elle mi" kaynak kolonu kuralının aynısıdır.

## 5. İZLEME PLANI — zincir üstünde ilerleme

### 5.1 Ölçülen büyüklükler (hepsi mevcut veriden, yeni hesap motoru YOK)

| Soru | Kaynak | Not |
|---|---|---|
| Sipariş satırı ne kadar karşılandı | `SackAllocation` (sevk anında) | bugün var |
| İş emri nerede | `WorkOrderStep` durumları | bugün var |
| Dokuma işi ne kadar ilerledi | Σ doff metre / `plannedM` | `plannedM` HEDEFTİR; %100 işi KAPATMAZ (kapanış açık karar) |
| Levent ne kadar kaldı | `WarpBeam` kalan metre — defterden (`remainingMTx`) | bugün var |
| Gecikme | plan tarihleri ↔ bugün | `WeavingOrder.plannedStartDate/plannedEndDate` |

### 5.2 Hub ekranı önerisi — TEK ekran, satır başına TEK zincir

**"Sipariş → Teslim" hub'ı:** her satır bir sipariş kalemi; sağa doğru dört kutu — *dokuma işi* ·
*levent* · *iş emri* · *sevk*. Her kutu üç şeyden birini gösterir: **yok** (bağ kurulmamış) ·
**ilerleme %** · **gecikme**. Kutuya tıklamak o belgeyi açar. Bağsız üretim (stoka dokuma) bu ekranda
**ayrı bir sekmede** durur — sipariş satırı olmayan işler ayrı sorudur, aynı listede karıştırılmaz.

⚠️ Bu ekran **yeni bir rapor ailesi değildir**: sayılar mevcut raporların okuduğu yerlerden gelir;
hub yalnız zinciri tek satırda birleştirir.

### 5.3 Rapor zinciri

Mevcut raporlara **bir eksen** eklenir (R5b kalıbı): dokuma raporlarına *dokuma işi* süzgeci, sipariş
raporlarına *dokuma durumu* kolonu. Yeni rapor açılmaz; süzgeç eksenleri mevcut şeritten gelir.

## 6. "SIMPLE IS MORE" — kabul ölçütleri (adım sayısı)

Model karmaşıklığı yüzeye SIZMAYACAK. Her akış için kabul ölçütü, bağ eklendikten SONRA da geçerli:

| Tablet akışı | Bugün | Bağ sonrası KABUL ÖLÇÜTÜ |
|---|---|---|
| Levent sarım | çözgü kartı seç → miktar → kaydet | **+0 dokunuş** — iş bağlamdan ön-dolar, değiştirmek isteyen tek dokunuşla açar |
| Koşum açma | tezgah → (iş) → kaydet | **+0 dokunuş** — takılı leventin işi ön-dolu gelir; yanlışsa tek dokunuş |
| Doff | miktar → kaydet | **+0** — bağ koşumdan türer, SORULMAZ |
| KK1 ham giriş | doff seç → ölçüler → kaydet | **+0** — iş bağı doff'tan türer |
| Fason dokuma kabul | iş seç → makbuz | **mevcut adım korunur** (iş zaten seçiliyor) |

⇒ **Hiçbir akışta yeni bir zorunlu ekran yok.** Bir bağ ancak "ön-doldur + tek dokunuşla değiştir"
biçiminde inebiliyorsa iner; inemiyorsa opsiyonel kalır ve rapor kovasıyla yaşar.

## 7. MV KAPILARI — her yeni bağ için cevap (`docs/standart/MASTER-VERI-TASARIMI.md`)

| Kapı | Cevap |
|---|---|
| **MV-01 kimlik ≠ rol** | Üç belge üç ayrı KİMLİK; tek tablo + `type` reddedildi (§3). Yeni bağlar rol değil **ilişki** ekler |
| **MV-02 finans kimliği tek** | Bu fazda para yüzeyi YOK; `WeavingOrder.subcontractorId` zaten `resolvePartyToCardTx` kalıbına tabi (fason = carinin rolü) |
| **MV-03 operasyon verisi profile** | Dokuma icrası `WeavingOrder`da kalır; fasoncu kimliği karta, profil operasyona bağlı |
| **MV-04 çapraz tekillik** | Yeni bağlar kimlik üretmiyor; numara üreten tek yer `weavingOrderNumber` (bugün var) |
| **MV-05 geriye dönüklük** | **Şema yalnız EKLER; her bağ NULLABLE doğar; varsayılan = bugünkü davranış; göç GEREKMEZ.** Eski istemci yeni alanı göndermez → bağsız kayıt yazar, bugünkü gibi çalışır. Bağın zorunlu hâle gelmesi (`NOT NULL`) ayrı bir fazın işidir ve koşulu ölçülür: bağsız kayıt sayısı 0 + eski istemci 0 |

## 8. KARAR ÖZETİ — kullanıcı seçecek

| # | Seçenek | Ne getirir | Ne götürür |
|---|---|---|---|
| **A** | **Üç belge + üç opsiyonel bağ + hub ekranı** ⭐ *önerilen* | Zincir uçtan uca okunur; "bu sipariş için kaç metre dokundu" cevaplanır; tablet akışlarında +0 dokunuş; göç yok | Üç nullable kolon/pivot + hub ekranı işi (orta büyüklükte bir dilim) |
| **B** | Yalnız **Y2** (levent → dokuma işi), ötekiler ertelensin | En küçük iş; leventin niçin sarıldığı yazılı olur | Sipariş ↔ dokuma sorusu cevapsız kalır; hub yarım |
| **C** | Tek `WorkOrder` + tip (dokuma/levent/rota) | Tek liste, tek ekran | **REDDEDİLİYOR**: MV-01 ihlali, XOR kolon yığını, altıncı enum sınıfı; ileride göç maliyeti (fason vakasının aynısı) |

**Öneri: A.** Gerekçe: sektör kalıbıyla aynı hizada (§1.1 seviyeli belge + bağ), MV kapılarını
geçiyor, şema yalnız ekliyor ve tablet akışlarına tek bir zorunlu ekran getirmiyor. A seçilirse
kullanıcıya sorulacak **tek modelleme sorusu** şudur: *bir dokuma işi birden fazla sipariş satırını
besleyebilir mi?* — Evet ise Y1 bir PİVOT (tahsis miktarıyla), hayır ise tek kolon.

## 9. Kaynaklar

- SAP PP — planlı sipariş ↔ üretim siparişi ve MRP zinciri: SAP Community tartışmaları ve
  `keyusertraining.com/en/sap-pp-production-type/`, `tutorialspoint.com/sap_pp/sap_pp_production_orders.htm`
- SAP onay/backflush ayrımı ve backflush'ın sakıncaları: SAP Help Portal "Production Order
  Confirmation", SAP Community "Why not to 'Backflush'?", `tutorialkart.com/sap-pp/backflushing-in-sap-pp-production-planning/`
- Datatex NOW üretim modeli (Production Demand ↔ Production Order), çok seviyeli tekstil yapısı ve
  kimlik akışı: `datatex.com/portfolio-items/production/`, `datatex.com/understanding-production-planning-in-the-textile-industry/`
- BMSvision WeaveMaster (dokuma MES'i, Planboard, gerçek zamanlı emir güncelleme):
  `bmsvision.com/products/weavemaster`
- Infor CloudSuite Fashion (M3) tekstil dikeyi: `infor.com/en-gb/products/cloudsuite-fashion`
- TR dikeyleri: `uyumsoft.com/tekstil-sektoru-erp/`, `uyumsoft.com/blog/is-emri-nedir-uretim-ve-bakim-sureclerinde-is-emri-yonetimi`, `nebim.com.tr/tr/uretim-planlama`
- Dokumacı ERP/MES rehberleri (ham kumaşın Parti/Tezgah/Vardiya ile izlenmesi, tipik akış):
  `ifactoryapp.com` tekstil sayfaları, `textileinfohub.com/how-to-choose-textile-erp/`

⚠️ Kaynakların çoğu ÜRÜN PAZARLAMA metnidir; alan davranışı (örn. terminalin operatöre ne sorduğu)
bu metinlerden TÜRETİLEMEZ. §1.4'te "doğrulanamadı" yazan hücreler bu yüzden boş bırakılmadı,
ADIYLA işaretlendi.
