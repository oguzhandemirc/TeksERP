# Backend `2.10.0`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **2.9.8** (etiket `backend-v2.9.8` = `97d891c2`, 2026-09-07; kurulum 2026-09-07 07:51). Sahada **238** migration uygulanmış, son uygulanan `20260905172000_kapsanan_fazla_indexler`, sorunlu (yarım/geri alınmış) migration **0** — fabrika DB'sinde 2026-09-25 02:4x ölçüldü.

**2.9.9 hiç sahaya çıkmadı** — bu belgenin ilk hâli o numarayla yazılmıştı (`7910da55`); o
sekiz düzeltme §2a'dır, ayrı belge yaşamaz. Küçük hane ELLE artırıldı (yama = düzeltme,
küçük hane = yeni yetenek). **Paketleme `-Surum 2.10.0` ile koşulur:** `paketle.ps1`in yama
otomatiği `backend-v2.9.8` etiketinden `2.9.9` üretir, `backend-2.9.9.md`yi bulamaz ve DURUR.
`package.json` sürümünü ve `backend-v2.10.0` etiketini paketleme kendisi yazar.

**Belgenin ölçüldüğü ağaç:** `e9350eab` (main, 2026-09-24). Paket daha yeni bir commit'ten
çıkarsa §1 ve §4'teki sayılar o ağaçta yeniden sayılır (`prisma/migrations` altındaki dizin sayısı).

## 1. Özet

Stok defteri bütün hareketleri bağlı ters kayıtlarıyla tutuyor ve "yanlış işlem" yolları geri
alınabilir oldu; dokuma, devere (levent/iplik lotu) ve emanet modülleri ekranlarıyla birlikte
indi (üçünün de bayrağı KAPALI doğar); numaralandırma koddan veriye taşındı (53 seri,
Numaralandırma ekranı); sevk yönü cari/şubeye KİLİTLENDİ ve siparişin yönü doğuşta donuyor;
fason firması ayrı kimlik değil carinin ROLÜ oldu (kart ↔ hesap tek kimlik); kasa/banka
bakiyesinin tek yazarı var; sevk partisi, n irsaliye → 1 fatura, rapor görünürlük kapısı ve yeni
rapor eksenleri geldi; ayarlar ekran başına izne bölündü. **Panel 1.3.2 · tablet 1.0.8 ile AYNI
turda çıkar** — tablet 1.0.7 hiç yayınlanmadı, ATLANDI.

Ölçüm (git, `backend-v2.9.8..e9350eab`, 2026-09-25): **1280** commit, **797**'si `Teks-Erp/`a
dokunuyor · **109** yeni migration (toplam **347**) · **30** yeni model · **27** yeni enum ·
mevcut **8** enum'a **32** yeni değer · **14** yeni route dosyası (uç **718 → 840**, +122,
kaldırılan **0**) · **41** yeni izin kodu (kaldırılan **0**) · **3** yeni modül anahtarı
(`devere` · `dokuma` · `emanet`, üçü de KAPALI doğar) · düşen kolon **1**
(`PeripheralDevice.unit`) · yeni ortam değişkeni **0**.

## 2. Ne değişti

### 2a. Saha turu düzeltmeleri (eski "2.9.9" içeriği, 2026-09-07 → 09-10)

- `b18af0d0` — muhasebe sevk fişi Excel'i ad rejimini uyguluyor (`docNameMode`).
- `90d7c482` — `POST /printed-documents/:docType/sample-html` izni `admin:settings` →
  `DOCUMENT_DESIGN_READ` (GENİŞLEDİ; kimse yetki kaybetmez).
- `7693cfa8` — mobil etiket "Bas" audit izi (`LABEL_PRINTED`) düşmüyordu.
- `a55ab875` — kapanış 5 sn'yi doldurunca hangi fazda takıldığını log'a yazıyor.
- `4d1a2ebf` — süreç uyarıları yığın iziyle log'a (pg DeprecationWarning teşhisi).
- `d508bb60` — `kur.ps1` `[5/9]` dosya kilidi yarışı: taşıma 5 kez ısrar ediyor.
- `7b84d5ea` — offsite hedefi göreli yazılınca sessiz yerel kopya · "Otomatik yedek saati"
  ölü kumanda · `[offsite]` açılış yanlış alarmı kalktı.
- `3bc2c092` · `3460dba7` — yedekte PostgreSQL istemci↔sunucu sürüm kapısı üç sonuçlu.

### 2b. Stok defteri (WarehouseMovement) ve defter doktrini

- `f8423048` — altyapı: `from/to` uçları, `reversesMovementId`, `transformGroupId`, DB seddi
  (CHECK ×2), tek yazım kapısı. `WarehouseEventType` +6 (`PRODUCTION` · `EXTERNAL` ·
  `TRANSFORM` · `ADJUST` · `OPENING_BALANCE` · `CANCEL_REVERSAL`).
- Deftere bağlanan yollar: üretimden depoya giriş (`15410b07`), tambur finalize (`bb709bd9`),
  üretime alma (`0963d3d7`), iş emrinden çıkarma (`d4c07035`), adım yeniden açma
  (`b67ed2e7`), tambur geri alma (`7f8e432a`), iptal/geri alma (`3c15208c`), iade (`ac428cd3`),
  sevk + storno (`d78bbd22`), fason kabul/sevk/iptal (`d07248e8` `463efd03` `510081bf`
  `b27ac459`), transfer (`3c9caf7c`), kartela (`572b2594`), kesim = TRANSFORM çifti
  (`40a7f10a` `c2a10e88`), sayım stornosu (`1985f63c` `6c8c0cb5`), elle metraj düzeltmesi
  (`fd33f205`), açık kumaş/kurtarma girişleri (`7b6ee345` `d33e019b`), giriş ölçümü düzeltmesi
  (`15007b1d`).
- **Deposuz stok topu artık sevk/iade/fason/transfer/kartela yolunda 409 + barkod listesi**
  (`e765c832`); yeni toplar depo damgalı doğar (`dd68039d` `9837222a` `73b31e8b`); deploy
  günlüğü deposuz sayısını UYARIR, veri yazmaz (`5d85db5f`). ⚠️ Canlıdaki sayı için §5.
- `rolls_qty_le_initial` KOŞULLU doğrulanır (`249d8681`) — §4.
- Sil-yaz'dan damgaya: çuval tahsisi `SackAllocation.clearedAt` (`d05067c3`), çuval izi
  (`e05ee092`), top/iş emri özellik pivotu sürümleme Faz 1–2e (`db6f8f7b` `a7dd52fb`
  `b1fa7d51` `d72063f7` `786dd1a4` `3c53deaf`), iş emri ↔ sipariş kalemi bağı koparılır,
  silinmez (`4af71a54` `99f8fec8`), ölü topun özelliği silinmez (`3b65daea`).
- Kabul-anı metrajı defterden okunur — alış faturası taslağı ve sipariş karşılaması tambur
  aşımından etkilenmez (`d5ab05ac` `453d1ae6`).

### 2c. Geri alınabilir işlemler (hard delete kalktı)

- Çek stornosu `BOUNCE/RETURN/ENDORSE/PAY` (`2532fdca`) + bankaya verme stornosu
  `DEPOSIT_CANCEL` (`280740cd`); `ChequeEventType` +5, `CariTxnSource` +3.
- Stok sayımı stornosu (`88ebf3bb` `fbb67de8`), kartela düşümü geri alınır (`6844d714`),
  toplu aktarım geri sarma (`ac474d10` `c2431cb0`), master-data birleştirme geri alınır
  (`03d7b9b2` `7cdc5295`), tahsilat kapaması `revokedAt` (`ec594c63`), top operasyon/hareket izi
  damgalanır (`c45f8b28` `c2c6cdbd`), `ShipmentEvent` + `SackWeighing` olay defterleri
  (`af0f09ff`), plan sapması onayı (`4b666d33`), fason kabulü iptali (`b27ac459` `f54e1b03`
  `fb0ad67e`), istasyon/makine silme oturum geçmişiyle engellenir (`bde1d57e`).

### 2d. Sipariş · kalite · cihaz · iş emri

- `OrderLine.unit` (`b334a09e` `26721839`): `MT` varsayılanı, `items.unit`ten backfill;
  MT-dışı satırda karşılama ölçülmez. Fatura satırında birim ZORUNLU (`79a3241b` — §3).
- `QualityGrade.role` (`c599bfdf` `f6a7d0c5`): "1. kalite / 2. kalite / fire" koddan değil
  rolden çözülür; `skipCustomerName` (`3e8087ae`).
- `DefectType.isDefault` (`f87cb6e5` `85fe7c38`): tipsiz hata girişi varsayılana düşer;
  migration `GENEL` tipini varsayılan yapar.
- `PeripheralDevice.unit` KOLONU DÜŞTÜ (`bf918cef`) — çarpan yalnız `scale`; eski panelin
  gönderdiği `unit` yutulur.
- İş emri listesinde "Müşteri" (`a13ce352`), birincil müşteri = ilk bağlanan (`ef78b37c`),
  iptal önizlemesi ölü topu saymaz (`1e7754c6`); toplu sipariş şablonuna "Birim" (`7b8fad3c`);
  fason kısmi doğrudan sevk ve fasoncu karnesi düzeltmeleri (`5980ff06` `94b00d40`).

### 2e. Dokuma — şema + yazma yüzeyi + EKRANLAR (bayrak `dokuma.enabled` KAPALI doğar)

- Modeller: `WeavingOrder` · `MachineRun` · `MachineStopEvent/Reclass` · `ShiftDefinition/
  Instance` · `DoffEvent` + `Roll.doffEventId` + `RollEntrySource.WEAVING` · `MachineSpec` ·
  `MachineShiftStat` (+ `LineStat` · `StopBreakdown` · `StatSeal`) · `MachineCollector(Link)`.
- Panel: Dokuma İşleri ekranı + `requireDokumaEnabled` kapısı (`c27dbfd3`), tezgah duruşları
  ekranı (`e480eb97`), dokuma raporları — vardiya karnesi, mühür çevrimi, üç rapor ucu
  (`596b8660` `39221572` `724b8d48` `21c73a9b` `5b5fed03`), hat kırılımı (`c5356f02`).
- Tablet: Tezgah ekranı — top indirme/geri alma (`213b0416`), koşum (`56285e63`), duruş
  (`381f6ba5`); KK1 dokuma bağı (`ebf17eff`); `StationKind.WEAVING` oturum istasyonu, rota adımı
  değil (`fa3f9d1f`).
- Elle duruş girişi tek yazıcı (`ece78b66`), insan kararlı duruş silinemez trigger'ı
  (`91e24e3b`), duruş sebebi panelden (`b76a68b4`), hızlı sebep (`8bf7895d`), tezgah künyesi +
  gölge mod (`b0972c59`), `pick*` → `unit*` ad turu (`ff08523f`, 9 kolon RENAME — yalnız bu turda
  doğan tablolar), fason dokuma (`a78b2f1d` `47c7d8f2` `b1ca54c6`), üretim belge zinciri
  (`af717c9b` `2769656b`), indirme damgası DB saatinden (`e1a55406`).

### 2f. Devere · levent · iplik lotu (bayrak `devere.enabled` KAPALI doğar)

- `WarpSpec` + `WarpBeam` + `WarpBeamEvent` (`16dd775a` `137509df`), tablet levent sarım
  (`13424c8b`), iplik lotu (`c67460fc` `c2087507` `80b9f60c`) ve lot kalite bekletme
  (`0d175a6a` `7e8d4c5d`), tezgaha takma/sökme/tüketme Faz 3 (`8fb9ccbf` `127f2505`
  `a0ae6672`), tezgahtan inen topla otomatik düşüm (`0153741e`), rasel takımı "N adet"
  (`e0e884fd`), levent ve iplik fasona gider/döner (`5910a09e` `c76e596e` `913dc3b9`),
  `StationKind.WARPING` (`f4719bf2`), gövde no uyarısı (`9fbd66a5`).

### 2g. Emanet / konsinye (bayrak `emanet.enabled` KAPALI doğar)

- `ownerCustomerId` doğum niteliği (top · levent · lot) (`a4bdfe0d`), tablet KK1 "Sahibi"
  seçicisi (`3bba3840`), sevk önizlemesinde sahiplik uyarısı (`67414e4e`).

### 2h. Sevkiyat · sevk yönü · paketleme · iade · belgeler

- **Sevk yönü KİLİDİ** (2026-09-23; 2026-09-13'teki "varsayılan, kilit değil" kararını
  tersine çevirir): zincir şube → cari → boş; kilitliyse sevkiyat kilitli değeri alır, boşsa
  ilk sevkte operatör bir kez seçer ve karta/şubeye yazılır (`5e9a61bc` `721c7e92` `cd3f852c`
  `582621cd` `f17579c2` `ea2f3ad7` `54ce287f` `b3d0b0ae`). Boş carilere toplu atama YOK.
- **Siparişin yönü doğuşta donar** — `Order.destination` (`d2ea1d8f`); mevcut siparişler için
  geri doldurma betiği (`5cf1cffb`) — §5.
- İhracat kodu yalnız yurtdışı sevkiyatın belgesine, cari kodundan uydurulmaz (`8d8bbc64`
  `7dd2e349`).
- Sevk partisi — paketleme grubu bayrakla parti olur, çuval partide doğar ve ambalaj no alır
  (`a3e164f8` `29134135`); çeki listesi CL numarası basılan kâğıda bağlanır (`4913eb11`); parti
  kodu belgeye opt-in basılır (`b664cec4`).
- İade girişi dört kapsam tek pencere (`fe89342d`); iade belge no kolona alındı, geçmiş
  numaralar birebir aynı (`c26f3a5c` `c8415e80`); iade no fabrika gününden (`935076bb`).
- Sevki geri al önizlemesi etkilenen her kaydı listeler (`2a90cad9`); fatura taslağı BRÜT
  (`7fae2716`); muhasebe liste ↔ Excel aynı küme (`6d3d91b2`); belge tarihleri tek yardımcıdan,
  fabrika diliminde (`58c019ba`).

### 2i. Numaralandırma — biçim koddan VERİYE

- `number_series` tablosu + tek servis (`357b5b95`), serinin yapısal parçası (`c85a8be5`),
  barkod türü sunucudan çözülür — `/api/scan/series` · `/api/scan/resolve` (`e89e8e0e`).
- Sayacın kapsamı biçim damgasına bağlı (`d7b6bb8b`), okutulan seri SAHA HAZIR OLMADAN
  değişemez (`a188adab`), panel yazma yüzeyi + ekran (`9806e393` `a3f33985`), sayaç ayarları ve
  tükenme uyarısı (`0544c542` `36a0e1a0`), numara kaynağı serbest/sistem/elle (`8477ebc4`
  `ca710154` `6604a9fa`), biçim zaman çizgisi `number_series_lines` (`beb787ee` `9d29d499`
  `ad9f4f59`), yeni tarih segmentleri + ikinci ayraç (`d5ca9998` `8748cdd5`), yapılandırma
  paketi numara serilerini taşır (`a58fb572`).
- Faz E: 53 serinin sayaç kilidi 0 (`1fa2f9a5` `7fa866c5` `935cfcf1` `adae6f85` `948ff295`);
  istemci kilidi EKSEN düzeyinde (`24f1455e`); top barkodu açıldı, kapasite dolgudan ayrıldı
  (`148cdcd7`); etiket taşma kapısı (`53098c33`); kısa parti no ayar oldu (`38499260`);
  "Sıradaki numara" üretecin hesabı (`e9350eab`).
- Tohum biçimleri BUGÜNKÜ biçimdir: kurulumdan sonra hiçbir numara kendiliğinden değişmez.

### 2j. İş ortağı rol modeli · cari · finans · mal kabul

- Fason = carinin ROLÜ: `Subcontractor.customerId` profili (`d4f10b63`), cariye üç rol bayrağı
  (`7a6159ef`), "Yeni Cari + Fason iş yapar" tek işlem (`efbf9f38`), cari hesabın tek adresi kart
  (`1f3b9995` `7db7716d`), rol süzgeçli hesap listesi (`3770637e`), kart ↔ hesap birleşimi
  (`076bfa97`). Göç betiği `migrate_partner_roles.ts` — §5.
- Kasa/banka bakiyesi TEK YAZAR — carili tahsilat/ödeme kasa defterine `COLLECTION/PAYMENT`
  satırı yazar (`c300a060`); n irsaliye → 1 fatura, `InvoiceToGoodsReceipt` (`13f3e7ca`);
  tahsilat penceresinde açık faturalar (`4dad5730`).
- Mal kabul: satır bazında top sınıfı (`8eede064` `527a7cca`), ön-uçuş doğrulaması
  (`63eacfdf` `074c0900` `3f8946e5`).

### 2k. Raporlar

- Katalog tek kaynak (`d919a466`), **rapor görünürlük kapısı** `reports.closedKeys` +
  `requireReportOpen` 29 uçta (`61e5106b`; satır yoksa hepsi AÇIK).
- 29 rapor ucu tanınmayan sorgu anahtarını 400 ile reddeder (`725d7038`).
- Süzgeç eksenleri — levent/lot (`951b3069`), satış/müşteri/fason (`ddbdc25c` `f679ab33`
  `839de648` `43cd5a74`), finans (`014284dc` `75f5d927` `a398f298` `98b719ac`). Süzgeç
  verilmezse cevap bayt bayt eski.
- Yurtiçi/Yurtdışı Satış raporu + sevk/iade karnesine yön süzgeci (`e1413896` `9c88f51d`
  `12c474c0` `6019dda0` `08c478fc`); sipariş raporları donmuş yönü okur (`594bd434`);
  Üretim Zinciri raporu (`5772f983` `4207d3b3`).

### 2l. Yetki · ayarlar · altyapı

- Ayarlar ekran başına izne bölündü: 16 `settings:*` + 5 `system:*`; `admin:settings` şemsiye
  kalır; süperadmin ekranları (`54a389a3`) — §3.
- 403 yetki reddi `details.code` taşır — `PERMISSION_DENIED` (`0e760284`); "Saha operatörü"
  rol şablonu (`b7b25ca0`); top iptalinde sebep zorunlu bayrağı, KAPALI doğar (`3d017fa6`).
- Çıplak süzgeç (`?status=` yerine `filter[status]`) 400 `BARE_FILTER_PARAM` (`93ebd861`).
- Türkçe harf katlaması tek yardımcı (`7bc091bb`), seed ikinci koşumda güvenli (`abbeac04`),
  temiz DB'de migration sıra kapısı (`d51b4ec4`), `Session.clientVersion` (`0473d2bc`), P2002
  hedefi tek yardımcı (`bffdb7d7` `fbfaddc3`), ürün listesinde ilişki süzgeci (`feb88c5b`).

**`dist-web` DEĞİŞTİ.** Panel kaynağı 1.3.1 → 1.3.2 arasında geniş çapta değişti; web arayüzü
paketi yeniden derlenir. Patron modülünü (web) kullanan kurulumlarda arayüz güncellenir.

## 3. Sözleşme

- **Kırıldı mı:** **EVET — panel 1.3.1'de iki noktada; tablet 1.0.6'da HAYIR.** ① `WarehouseEventType`e
  altı yeni değer girdi ve **1.3.1'in Depo Hareketleri ekranı tanımadığı türde boş sayfaya
  düşer** (ölçüldü 2026-09-13; yeni backend'in ilk üretim/fason/kesim hareketinden itibaren).
  ② Süperadmin ekranları daraldı: **sistem hesabı VARSA** Endpoint Performansı · DB
  kopyası/geri yükleme · log arşivleme · log istatistiği uçları (10 uç) yalnız o hesaba açık,
  diğer `admin:settings`li kullanıcılar 403 `SUPERADMIN_ONLY` alır (bilinçli; 1.3.2'de de aynı;
  hesap hiç doğmamışsa kapı geçirir — fabrikada hesap var mı bu belgede ölçülmedi).
  ⇒ **backend + panel 1.3.2 AYNI PENCEREDE** (§5).
- **Eski istemci ne yapar (altı tetik, `e9350eab`'de yeniden ölçüldü):**
  - *Uç kaldırma:* **YOK.** Route dosyalarındaki (yöntem, yol) çiftleri 718 → 840; kalkan 0,
    kalkan mount 0 (14 yeni route dosyası).
  - *Alan adı:* düşen kolon **1** — `PeripheralDevice.unit`: 1.3.1 cihaz formu "birim" kutusunu
    boş gösterir, gönderdiği değer sunucuda yutulur (tolerans + DMMF süzgeci); çarpan zaten
    `scale`'di. Yeniden adlandırılan 9 kolon yalnız bu turda doğan dokuma tablolarında (sahada
    yok). Yanıt gövdelerindeki alan adları statik olarak tam ölçülemez; bilinen yeniden
    adlandırma yok.
  - *Tip/birim:* `OrderLine.unit` EKLEME — tablet 1.0.6 KG/ADET kalemi "m" etiketiyle gösterir,
    rakam doğru. Zorunlu → opsiyonel gevşeyen 9 alan (`Manifest.workOrderId` ·
    `SubcontractorDispatch.workOrderId/batchId/stepId` · `SubcontractorDispatchItem.rollId` ·
    `SubcontractorReceipt.workOrderId/stepId`): `null` yalnız yeni kayıt türlerinde doğar (çuval
    seçimli çeki listesi · dokuma işine bağlı fason · levent/iplik fason kalemi); eski istemci
    bunları üretmez, çeki listelerini iş emri üzerinden okuduğu için görmez; fason tarafı yalnız
    dokuma/devere bayrakları açılırsa doğar.
  - *Zorunlu parametre:* fatura satırında `unit` (`min(1)`) — 1.3.1 varsayılan `"m"` gönderir,
    yalnız kutu elle boşaltılırsa 400 "Satır birimi gerekli.". Rapor uçlarında tanınmayan anahtar
    400 — 1.3.1 yalnız sözleşmedeki adları gönderir (ölçüldü). Çıplak süzgeç 400 — iki eski
    istemcinin sorgu kurucusu süzgeci her zaman `filter[...]` sarar (`queryBuilder.ts` /
    `query-builder.ts`, eski etiketlerden ölçüldü). Sevk yönü: kilitli caride eski istemcinin
    gönderdiği farklı yön sevkiyat KURULURKEN kilitli değerle değiştirilir + `warnings`;
    PLANNED sevkiyatta yön DEĞİŞTİRME farklı değerle 409 `SHIPMENT_DESTINATION_LOCKED` (mesaj
    ekranda). Eski istemcinin önceden seçili yönü kartı KİLİTLEMEZ (`destinationChosen` yalnız
    yeni istemcide). `production.cancelReasonRequired` KAPALI doğar; açılırsa sebepsiz top iptali
    400 — istemciler güncellenmeden AÇILMAZ.
  - *Enum:* `WarehouseEventType` +6 (panel: yukarıdaki ①) · `CashTxnKind` +2
    (`COLLECTION/PAYMENT` — carili tahsilat/ödeme artık kasa defterine yazar; 1.3.1 Kasa
    Hareketleri listesinde bu satırların tür hücresi BOŞ görünür, çökmez; yalnız finans modülü
    açıksa) · `ChequeEventType` +5 / `CariTxnSource` +3 (yalnız yeni storno uçları yazar) ·
    `ReasonPresetKind` +5 (eski istemci kind'a göre süzer) · `RollEntrySource.WEAVING` ·
    `StationKind` +2 · `YarnMovementKind` +8 (yalnız dokuma/devere bayrakları açılırsa doğar).
    Tablet 1.0.6 bu değerlerin hiçbirini okumaz.
  - *İzin:* **41 yeni kod, 0 kalkan** (16 `settings:*` · 5 `system:*` · 8 `loom:*` · 4
    `mobile:*` · 3 `warpbeam:*` · 2 `warpspec:*` · 2 `weavingorder:*` · `shipping:packing-lot`).
    Mevcut uçlarda: çoğu GENİŞLEDİ (`admin:settings` yanına `system:*` / `settings:*`
    alternatifi); DARALAN yalnız yukarıdaki ② (10 uç, sistem hesabı varsa). Katalog boot'ta
    uzlaşır, ATAMAZ — yeni ekranlara yetkiyi panelden yönetici verir.
- **`minVersion` dokunuldu mu:** **HAYIR.** Değer KODDA sabit
  (`Teks-Erp/src/config/client-version-policy.ts`); panel 1.3.2 / tablet 1.0.8 eşiği ancak o
  sürümler SAHADAYKEN konabilir (sahadakinden büyük olamaz) ⇒ ayrı bir backend yamasının işi
  (§5 "sonraki adımlar"). Okutulan serilerin eksen kilitleri minVersion'a bağlıdır ve bu pakette
  KAPALI kalır — eski istemci bütün etiketleri okumaya devam eder.

## 4. Migration

- **Var mı:** **EVET — 109 adet** (`20260910120000_paketleme_grubu` … `20260924001000_roll_series_max_value`).
- **Toplam migration:** **347** (2.9.8'de 238). Kuran `[7/9]`da **109 migration uygulandığını**
  görmelidir (Prisma "347 migrations found in prisma/migrations" + 109 uygulanan migration
  listesi). "No pending migrations" ya da 109'dan farklı bir sayı görürse yanlış paket ya da
  yanlış DB'dir → DUR.
- **RAISE basan (koşullu, deploy'u DÜŞÜRMEZ):** — 109 dosyanın tamamı tarandı
  1. `20260912190000_rolls_qty_le_initial_validate` — `currentQty > initialQty` satırı 0 ise
     `VALIDATE`, değilse **WARNING** basar ve kısıt `NOT VALID` kalır. 15 Eylül dökümünde 2
     ihlal ölçüldü ⇒ `NOT VALID` BEKLENİR (onarım betiği koşulmayacak — §5).
  2. `20260913020000_order_line_unit` — **NOTICE**: MT-dışı satır ve MT-dışı + `shippedQty>0`
     satır sayısı; rakama DOKUNMAZ.
  3. `20260913120000_deposuz_stok_topu_uyarisi` — 0 ise **NOTICE**, değilse **WARNING** (deposuz
     stok topu sayısı); veri yazmaz. 15 Eylül dökümünde **513** — §5.
  4. `20260913120000_quality_grade_role` — aynı rolde birden çok AKTİF satır varsa **NOTICE** ve
     `quality_grades_role_key` index'i ATLANIR (bu fabrikada imkânsız: rol UNIQUE koddan damgalanır).
  - ⚠️ Prisma `migrate deploy` PostgreSQL NOTICE/WARNING satırlarını ekrana BASMAYABİLİR
    (ölçülmedi). Görünürse aynen rapora kopyalanır; görünmezse aynı sayılar §7'deki salt-okur
    SQL ile ölçülür. (`20260914091000` içindeki `RAISE EXCEPTION` bir trigger gövdesidir, deploy
    anında koşmaz.)
- **Başka koşullu adımlar (deploy'u düşürmez):**
  - `20260914031000_work_order_to_order_line_unlink` — bileşik PK varsa vekil `id` PK'ya takas.
  - `20260914096000_defect_type_is_default` — varsayılan hata tipi yoksa `GENEL`i yaratır/varsayılan yapar.
  - `20260912120000` · `20260913260000` · `20260915051000` — modül anahtarları `devere` ·
    `dokuma` · `emanet` = `false` (yalnız top taşıyan kurulumda).
  - `20260922210000_roll_return_number` ve `20260924001000_roll_series_max_value` içindeki
    `number_series` UPDATE'leri canlıda **no-op**: tablo aynı deploy'da boş doğar, satırlarını
    açılışta boot uzlaştırması yazar (kapasite tohumu 9999 dahil).
  - Kalan `DO` blokları yalnız idempotency kalkanıdır (`duplicate_object` / `IF NOT EXISTS`).
- **Veri yazan adımlar:** `order_lines.unit` backfill · `quality_grades` rol damgası (3 kod) ve
  `skipCustomerName` · `customers` rol bayrakları (`type`tan) · `invoice_to_goods_receipts`
  (faturadaki `goodsReceiptId`den) · `roll_returns.returnNo` (bugün basılan numaranın
  birebir aynısı) · `defect_types` varsayılanı · üç modül anahtarı.
- **`ALTER TYPE … ADD VALUE`: 23 dosya**, hepsi yalnız `ADD VALUE IF NOT EXISTS` taşır (55P04
  riski yok): `CariTxnSource` +3 · `ChequeEventType` +5 · `WarehouseEventType` +6 ·
  `ReasonPresetKind` +5 · `RollEntrySource` +1 · `StationKind` +2 · `YarnMovementKind` +8 ·
  `CashTxnKind` +2 · bu turda doğan `WarpBeamStatus` +4 · `WarpBeamOrigin` +1 ·
  `SubcontractorDispatchItemKind` +1 · `NumberSeriesDateSegment` +3.
- **Tablo tarayan / kilit alan adımlar** (fabrika hacminde — ~6,5 bin top — saniyeler):
  `VALIDATE`: `warehouse_movements` ×2 (`20260912150300`) · `rolls` (koşullu, `20260912190000`).
  `NOT VALID`'siz CHECK (ACCESS EXCLUSIVE + tam tarama): `yarn_movements` ×5 ·
  `subcontractor_dispatch_items` · `subcontractor_dispatches` · `subcontractor_receipts` ·
  `manifests` · `cash_transactions` · `reason_presets`. Mevcut tablolarda CONCURRENTLY'siz index: `rolls` ×2 ·
  `warehouse_movements` ×5 · `roll_movements` ×2 (unique takası) · `roll_operations` ×2 ·
  `sack_allocations` ×3 · `payment_allocations` ×3 · `roll_properties` /
  `work_order_target_properties` / `work_order_to_order_lines` ×2'şer (+ PK takası) ·
  `sacks` ×2 · `yarn_movements` ×4 · `subcontractor_*` ×7 · `orders` · `manifests` ×2 ·
  `roll_returns` · `items` · `roll_variances` · `cash_transactions` · `defect_types` ·
  `quality_grades` · `subcontractors`. DB düzeyindeki `statement_timeout=50s` bu hacimde sorun değil.
- ⚠️ **`SET lock_timeout = '3s'`** — `20260914030000` ve `20260914031000`. Oturum düzeyinde kalır;
  DB'de kilit tutan başka bir oturum varsa (gece yedeği `pg_dump`, açık pgAdmin/psql) `[7/9]`
  55P03 ile DÜŞER ve DB yarı göç etmiş kalır → §5 ön kontrol.
- **Düşen/yeniden adlandırılan:** `peripheral_devices.unit` DROP · `roll_operations` ve
  `sack_allocations` tam unique'leri → partial · `roll_movements` açık-hareket unique takası ·
  `work_order_to_order_lines` PK takası · 9 RENAME COLUMN (bu turda doğan tablolar).
- **Geri alınabilir mi:** HAYIR — bu depoda migration geri alınamaz; rollback = yedekten restore.
  109 migration'ın ilki geçtikten sonra `kur.ps1 -GeriAl` KOD'u geri alır, ŞEMAYI geri almaz (§6).
- **Prova:** 15 Eylül dökümünün kopyasında o günkü 79 bekleyen migration 6.514 top üzerinde
  temiz uygulandı (2026-09-15). 23 Eylül dökümünden kurulan `tekserp_fabrika_0923`te
  `migrate deploy` 238 → güncel koştu (1e/kullanıcı beyanı; bu belgeyi yazan oturum ÖLÇMEDİ ve
  son iki migration'ın o DB'de uygulandığını doğrulamadı). Paketleyen, paket ağacında
  "restore → migrate deploy → bekçiler → profil boot" sonucunu buraya yazar. Kuran provayı
  tekrar koşmaz, yalnız `[7/9]` çıktısını ve §7'yi raporlar.

## 5. Kurulum notu

- **Beklenen kesinti:** ölçülmedi — 2.9.8'de 23 sn; bu turda 109 migration (fabrika hacminde
  saniyeler) + ilk açılışta uzlaştırmalar. **1–2 dk planla.**
- **Sıra (bağlayıcı):**
  1. Ön kontrol (aşağıda) → 2. backend 2.10.0: yönetici PowerShell'de zip ile aynı klasörden
     `.\kur.ps1 -Paket .\PAKET.zip` (gerekirse `-UygulamaAdi`) → 3. §7 doğrulaması →
  4. iş ortağı rol göçü (dry-run → kullanıcı onayı → `--apply` → ikinci koşum 0) →
  5. **panel 1.3.2 + tablet 1.0.8 yayını AYNI PENCEREDE** (4. adım uzarsa panel 1.3.1'in Depo
     Hareketleri ekranı o süre boyunca yeni türlü satırda açılmaz — §3 ①) →
  6. diğer veri adımları (kullanıcı kararıyla) → 7. minVersion/kilit YOK (aşağıda, sonraki tur).
  Tablet kanalı (OTA mı APK mı) paketleme anında `npm run yayinla:check -- --musteri=…` ile
  kesinleşir, TAHMİN EDİLMEZ — `tablet-v1.0.6`dan bu yana `mobil/package.json`dan native modül
  taşıyan bağımlılıklar düştü (`cdcb73f4`), parmak izi değişmiş çıkabilir.
- **Ön kontrol (sunucuda, yönetici PowerShell, kurulumdan ÖNCE):**
  - Sunucudaki `C:\TeksERP\kur.ps1` ESKİ bir kopyadır (2026-09-04). Kurulum paketin İÇİNDEKİ
    `kur.ps1` ile koşulur; `C:\TeksERP\kur.ps1` onunla değiştirilir ve
    `Get-FileHash -Algorithm SHA256` ile iki dosyanın aynı olduğu doğrulanır. Referans:
    `e9350eab` ağacında `deploy/kur.ps1` SHA256 =
    `3af0fb57467989a510cfb1b89a1d21b340e1128935ac136ecc14009a9c20d0a1` (paketteki farklıysa paket
    başka ağaçtan çıkmıştır — pakettekine güven, farkı rapora yaz). Varsayılan kök zaten `C:\TeksERP`.
  - `kur.ps1`in çağırdığı yollar VAR mı: `C:\TeksERP\pm2\node_modules\.bin\pm2.cmd` ·
    `C:\TeksERP\pgsql\bin\pg_dump.exe` (junction → `D:\PostgreSQL\16\bin`) ·
    `C:\TeksERP\pg-setup\db-credentials.json` (içindeki `port` yeni PostgreSQL servisinin
    portuyla aynı olmalı). Biri yoksa kurulum BAŞLAMAZ.
  - `pm2 list` (`$env:PM2_HOME='C:\TeksERP\pm2-home'`): uygulama adı `kur.ps1`in varsayılanı
    `tekserp-backend-yeni` değilse `-UygulamaAdi` ile verilir — yoksa `[4/9]` yanlış adı siler,
    `[8/9]` aynı porta ikinci uygulama kaldırır.
  - Gece yedek görevi (TeksERP-DB-Backup; dökümler `_0300` damgalı) KOŞMUYOR olmalı; DB'ye
    açık pgAdmin/psql oturumu bırakılmaz (§4 `lock_timeout`).
  - Salt-okur ön ölçüm (§7'deki bağlantı kalıbıyla): `_prisma_migrations` 238 bitmiş / 0 sorunlu ·
    deposuz stok topu sayısı · `currentQty > initialQty` satır sayısı. Sayılar rapora yazılır.
- **Bu sürüme özel:**
  - Boot uzlaştırmaları ÇOK; ilk açılış log'unda BEKLENİR, hata değildir: izin kataloğu (+41,
    toplam 128) ve rol şablonları · sebep kataloğu (en az 36 yeni sistem sebebi: `MACHINE_STOP`
    23 · `WARP_RETURN` 3 · `WARP_BEAM_ADJUST` 3 · `WARP_BEAM_SCRAP` 4 · `YARN_SUBCONTRACT_RETURN`
    3) · `number-series: 53 yeni numara serisi eklendi` · numara kaynağı göçü
    (`workorder.partyCodeAuto` → `numberSource`, bir kez) · biçim satırları göçü · rapor
    görünürlük denetimi. Dokuma bayrağı kapalıyken vardiya takvimi no-op'tur.
  - **Yayın günü veri adımları** — migration DEĞİLDİR, `migrate deploy` ile gelmez; hepsi dry-run
    varsayılan, `--apply`ı KULLANICI koşar, teşhis çıktısı saklanır (`docs/kurallar/deploy-kurulum.md`,
    `docs/kurallar/surum-yayin.md`). ⚠️ Paket bu betikleri ve `tsx`i TAŞIMAZ (paket: `dist` ·
    `prisma` · `node_modules --omit=dev`); repo ağacından, `DATABASE_URL` fabrika DB'sini AÇIKÇA
    gösterecek biçimde koşulur — nereden koşulacağı kurulumdan önce kararlaştırılır. DB adı
    `db-credentials.json`/`.env`den okunur (2026-09-04 kurulumunda `tekserp_yeni`); betikler
    `tekserp` · `tekserp_prod` · `adnansahin_db` adlarını kuru koşumda bile REDDEDER.
    1. `migrate_partner_roles.ts` — **KOŞULUR, panel/tablet yayınından ÖNCE.** Dry-run → ÖNERİ
       satırları kullanıcıyla karara bağlanır → `--apply --canli-onay` (+ gerekirse
       `--baglan=SUBID:CUSTID`) → aynı komut ikinci kez: `DEĞİŞİKLİK: 0`. Beklenen (15 Eylül
       dökümü): 11 profil → 11 kart, 1 hesap taşınır. **Prova (25 Eylül 02:21 dökümü):** 8 bağsız
       profil → 5 yeni kart (Tedarikçi + Fason), 3 birleştirilmiş profil atlandı, öneri 0, hesap 0,
       ikinci koşum 0. Runbook `docs/ops/IS-ORTAGI-ROL-GOCU.md`.
    2. `remove_sack_note_element.ts` — **KOŞULUR:** dry-run (hangi şablon/varyantta kaç eleman —
       çıktı saklanır) → `--apply`. Yalnız SACK şablonlarındaki `sackNote` elemanını kaldırır;
       `Sack.notes` verisi ve basılmış etiketler değişmez.
    3. `backfill_order_destination.ts` — dry-run → `--apply --canli-onay` **KULLANICI kararı.**
       ⚠️ Kurulumdan hemen sonra **0 yazar**: yön zinciri (şube/cari yönü) bu turda doğan
       kolonlardır ve hepsi boştur (15 Eylül dökümünde 29/29 cari boş) ⇒ dry-run
       "Yazılacak: 0 · belirsiz: N" gösterir. Anlamlı koşum carilerin yönü girildikten SONRA;
       yalnız `destination IS NULL` satırlara yazar, ikinci koşum 0.
    4. `fix_tambur_undo_full_asim.ts` — **KOŞULMAZ** (kullanıcı kararı "dokunma", 2026-09-15).
       `rolls_qty_le_initial` `NOT VALID` kalır; `test_db_invariants` o satırda beklenen kırmızıyı verir.
    5. `backfill_roll_warehouse.ts` — **KOŞULUR (kullanıcı kararı 2026-09-25).** 2026-09-04 öncesi
       deposuz toplar bu sürümle sevk · iade · fason · transfer · kartela yolunda **409 + barkod
       listesi** verir. Dry-run → `--apply --onay=N --hedef=DBADI` (N = kuru koşumdaki sayı,
       birebir). `currentQty > initialQty` taşıyan satırlar (`rolls_qty_le_initial` ihlali, 4.
       maddenin konusu) ATLANIR ve adıyla listelenir (`6808c18e`). **Prova (25 Eylül 02:21
       dökümü):** 4.553 deposuz topun 452'si stok kümesinde; 4.551 top Merkez Depo'ya bağlandı,
       2 ihlalli top (üretimde) atlandı, stok kümesinde deposuz top 0 — sevk/iade kapısı yeşil.
  - **minVersion ve okutulan seri kilitleri — bu gece YAPILMAZ** (faz-E kararı): ① backend 2.10.0 →
    ② panel 1.3.2 + tablet 1.0.8 yayında (paketler `retiredFormats` okuyan istemci kodunu
    taşımalı — `surum-yayin.md`) → ③ Sistem → Bağlı İstemciler'de her cihaz yeni sürümde
    (`Session.clientVersion`) → ④ ayrı backend yaması: `client-version-policy.ts`te `minVersion`
    electron 1.3.2 · mobil 1.0.8 (sahadakinden büyük olamaz) → ⑤ o yamayla okutulan serilerin
    eksen kilitleri kendiliğinden açılır. Top barkodunun H/F harfi kalıcı kilitli kalır.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK · uygulanmış
  migration'a dokunma · postgres/node süreçlerini `Stop-Process` ile durdurma, PostgreSQL servisi
  `postgresql-tekserp`i durdurma/yeniden başlatma · PostgreSQL programı `D:\PostgreSQL\16` ve
  verisi `D:\PostgreSQL\data`ya dokunma · `C:\TeksERP\pgsql\bin` bir JUNCTION'dır (→
  `D:\PostgreSQL\16\bin`), `Remove-Item -Recurse` ile SİLİNMEZ · `C:\Etkili-Yazilim` artık YOK;
  `C:\Etkili-Yazilim.SILINECEK-20260925` kalıcı silinmeyi bekliyor — bu kurulumun konusu değil,
  dokunma · pm2 ikilisi `C:\TeksERP\pm2`, ev dizini `C:\TeksERP\pm2-home`, açılış görevi
  `C:\TeksERP\pm2-boot.cmd`, PATH'teki `C:\TeksERP\bin\pm2.cmd` — değiştirme · gece yedeği
  `C:\TeksERP\backups` + `E:\TeksERP-yedek` — silme/taşıma · `-GeriAl` ile `-Zorla` birlikte
  KULLANMA · başarısız kurulumu TEKRAR DENEME ·
  **`[7/9]` eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**

## 6. Geri alma

`C:\TeksERP\kur.ps1 -GeriAl`. Eşik ÖNCESİ hata: script kendini toplar, `app.eski-*` oluşmaz,
mevcut kurulum yeniden başlar. Eşik SONRASI (`[7/9]` migration'larının herhangi biri
uygulandıysa): **kod geri alınsa da şema 2.10.0'da kalır ve 2.9.8 kodu yeni şemada ÇALIŞMAZ** —
2.9.8 ağacına karşı ölçülen çarpışmalar: `peripheral_devices.unit` yok (2.9.8 istemcisi kolonu
seçer → cihaz/tartı sorguları P2022) · `work_order_to_order_lines` PK'sı vekil `id`ye döndü ve
`id`nin DB varsayılanı yok (2.9.8'in bağ yazımı `id` göndermez → NOT NULL ihlali) ·
`roll_operations` tam unique'i partial'a döndü (2.9.8 KK2/Tambur `upsert`i bileşik anahtarla
yazar; ON CONFLICT hedefi partial index'e eşleşmezse düşer — koşularak ölçülmedi) · 2.9.8
`clearedAt`/`revokedAt`/`unlinkedAt` damgalarını tanımaz, geri alınmış kayıtları canlı sayar.
⇒ **Eşik sonrası dönüş = yedekten
restore** (`[3/9]`da alınan `C:\TeksERP\backups\premigrate_*.dump`; raporda dosya adı ve boyutu
yazılır) + `-GeriAl`. `[7/9]` yarıda düşerse Prisma o migration'ı FAILED işaretler ve sonraki
deploy'u bloklar — elle `resolve` YAPILMAZ, insana rapor edilir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 list` (online mı, restart sayısı)
- `/health` (api + db + version = 2.10.0) — `/api/admin/health` kimlik ister, `/health` yeter
- `[7/9]`: **109 migration uygulandı** mı; NOTICE/WARNING satırları göründüyse aynen
- `cd C:\TeksERP\app; node node_modules\prisma\build\index.js migrate status` → 347 migration,
  şema güncel
- `backend-err.log` son 30 satır; açılış log'unda §5'teki uzlaştırma satırları (izin ·
  sebep · `number-series: 53`)
- salt-okur SQL (açılıştan ~1 dk sonra; parola yazılmaz, `db-credentials.json`dan okunur):

```powershell
$cred = Get-Content C:\TeksERP\pg-setup\db-credentials.json -Raw | ConvertFrom-Json
$u = if ($cred.user) { $cred.user } else { $cred.superuser }
$env:PGPASSWORD = if ($cred.pass) { $cred.pass } else { $cred.superpass }
$sql = Join-Path $env:TEMP "tekserp-2100-dogrula.sql"
@'
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS bitmis,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS sorunlu
  FROM _prisma_migrations;
SELECT count(*) AS deposuz_stok_topu FROM rolls
 WHERE "warehouseId" IS NULL
   AND status IN ('STOCK','WAREHOUSE','A1_STOCK','RETURNED_FROM_SUBCONTRACTOR');
SELECT conname, convalidated FROM pg_constraint
 WHERE conname IN ('rolls_qty_le_initial','warehouse_movements_qty_positive',
                   'warehouse_movements_direction_present');
SELECT count(*) FILTER (WHERE unit <> 'MT') AS mt_disi,
       count(*) FILTER (WHERE unit <> 'MT' AND "shippedQty" > 0) AS mt_disi_sevkli
  FROM order_lines;
SELECT code, role, "isActive" FROM quality_grades ORDER BY code;
SELECT indexname FROM pg_indexes WHERE indexname = 'quality_grades_role_key';
SELECT key, value FROM system_settings
 WHERE key IN ('devere.enabled','dokuma.enabled','emanet.enabled');
SELECT (SELECT count(*) FROM permissions) AS izin,
       (SELECT count(*) FROM number_series) AS numara_serisi;
'@ | Set-Content -Encoding ASCII $sql
& C:\TeksERP\pgsql\bin\psql.exe -h localhost -p $cred.port -U $u -d $cred.db -f $sql
$env:PGPASSWORD = ""
```

  Beklenen: `bitmis` 347 · `sorunlu` 0 · deposuz sayısı ön ölçümle aynı (15 Eylül: 513) ·
  `rolls_qty_le_initial` = f (ihlal varsa), iki `warehouse_movements_*` = t · `1.KALITE`=FIRST,
  `A1`=SECOND, `FIRE`=SCRAP ve index var · üç modül anahtarı `false` · `izin` ≥ 128 ·
  `numara_serisi` = 53. (SQL dosya üzerinden verilir: PowerShell 5.1 çift tırnaklı argümanı
  native komuta bozuk geçirir.)
- panel 1.3.2 / tablet 1.0.8 indi mi: Sistem → Bağlı İstemciler'de sürüm sütunu; 1.3.1 kalan
  makinede Depo Hareketleri açılmaz (§3 ①)
- Depolar → bir depo → Hareketler: yeni türlü satır (üretim/fason) düzgün çiziliyor mu
- Sevkiyat: yönü boş bir cariye sevk kurulurken yön BİR KEZ soruluyor mu (beklenen)
- yayın günü veri adımlarının dry-run çıktıları ve (yapıldıysa) `--apply` sonuçları; deposuz top kararı
- `[offsite]` açılış uyarısı ÇIKMAMALI; çıkıyorsa hedef gerçekten tanımsızdır
- ölçülen kesinti (bir sonraki belgeye taban olur)
