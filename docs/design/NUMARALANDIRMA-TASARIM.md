# Numaralandırma Şablonları — tasarım

> Canlı tasarım belgesi. Kural özeti `docs/kurallar/numaralandirma.md`, karar hikâyesi `docs/history/CLAUDE-NOT-ARSIVI.md` 2026-09-22. Faz A · B · C indi; Faz D kâğıtta.

## §0 Problem

Repoda 39 numara üreteci var ve ön ekleri servislerde literal. Yazılım başka fabrikalara satılacak; her fabrika kendi ön ekini/biçimini ister. Bugün bunu değiştirmenin tek yolu kod değiştirmek — yani müşteri başına fork, kök `CLAUDE.md`'nin yasakladığı şey.

İkinci tetik ölçüldü: "sevkiyat içi çuval sırası ön eki" ayarı sunum katmanında canlı okunuyordu; program ekranı eski, belge yeni ön eki gösterdi. Kullanıcının koyduğu değişmez:

> "belge-çıktı-programdaki veriler birbiriyle aynı olmalı; programda p-2 yazarken çıktı p20260202 görmemeliyiz."

## §1 Sektör karşılaştırması

| Sistem | Model | Geçmişe etki | Sıfırlama |
|---|---|---|---|
| **SAP** | Number Range Object (NRIV) — nesne başına aralıklar, iç/dış numara | Yok; aralık değişimi yalnız yeni belgeye | Mali yıla bağlı aralık |
| **Dynamics BC** | No. Series + No. Series Line (başlangıç tarihli satır) | Yok; yeni satır kendi başlangıç tarihinden itibaren geçerli | Satır değişimiyle |
| **Odoo** | `ir.sequence` — prefix/suffix'te tarih yer tutucuları, padding, `ir.sequence.date_range` | Yok | Tarih aralığı kaydıyla |
| **Logo / Netsis / Mikro** | "Numaralama şablonu" — sabit metin + tarih + sayaç + işyeri segmentleri | Yok ("şablon değişikliği yalnız yeni fişleri etkiler") | Şablondaki tarih parçasıyla |

Ortak payda üç cümle: **(a)** biçim veridir, kodda değil · **(b)** geçmiş asla yeniden numaralanmaz · **(c)** sayaç kapsamı biçimin tarih parçasından doğar. Tasarım bu üçünü aynen alır.

## §2 Model

```
NumberSeries { key(unique) · label · prefix · dateSegment · digits · separator
               retiredPrefixes[] · scanned · editable · updatedById }
enum NumberSeriesDateSegment { NONE  DDMMYY  YYMM  YYYYMM  YY  YYYY }
```

**Kod-sahipli alanlar** (boot uzlaştırması her açılışta tazeler): `label` · `scanned` · `editable`, ayrıca yalnız kodda yaşayan `kind` ve `lockedReason`.
**Veri-sahipli alanlar** (yalnız panel yazar, uzlaştırma DOKUNMAZ): `prefix` · `dateSegment` · `digits` · `separator` · `retiredPrefixes`.

Kod üretimi: `seriesPrefix()` sabit başı kurar (`prefix [sep] [tarih] [sep]`), sayaç o başla başlayan kodların sayısal max'ı + 1, kod = baş + `padStart(digits)`.

| Seri | Bugünkü kod | prefix · dateSegment · digits · sep |
|---|---|---|
| `sack` | `CV2209260001` | CV · DDMMYY · 4 · "" |
| `packingLotCode` | `PRT-2609-0001` | PRT · YYMM · 4 · "-" |
| `packingLotName` | `P-3` | P · NONE · 1 · "-" |
| `item` | `STK-000001` | STK · NONE · 6 · "-" |

## §3 Reddedilen seçenekler

1. **Geçmişi yeniden numaralandırma** — donmuş belge müşteride basılı, depodaki çuval etiketi eski barkodu taşıyor, numara defter satırlarında referans. Sektörde de yok.
2. **Serbest maske stringi** (`{PREFIX}{DDMMYY}{####}`) — sayaç sorgusu literal başı hesaplayabilmeli; maske ayrıştırma ister, çakışma kapısını zorlaştırır ve kullanıcıya sözdizimi öğretir. Yapılandırılmış alanlar + canlı önizleme daha az hata üretir.
3. **Ayrı `NumberSeriesCounter` tablosu** — rollback'te boşluk doğurur, yeni advisory uzayı ister ve türetilmiş sayacın cevaplamadığı hiçbir soruyu cevaplamaz. Tarih segmenti sıfırlama dönemini zaten kodluyor.
4. **Feature-flag satırı olarak modellemek** — `settings-config.ts`'e dördüncü satır türü eklemek 6 dosya + sözleşme bekçisinin iç-alan-adı kuralını değiştirmek demekti; numaralandırma davranış anahtarı değil yapılandırma verisidir.
5. **Küresel ön ek tekilliği** — ölçüldü: bugün `KS`, `IADE` ve `P` zararsızca çakışıyor (ayrı tablolar, okutulmuyorlar). Küresel kapı doğduğu gün üç yanlış kırmızı verirdi.

## §4 Fazlar

- **Faz A (indi, 2026-09-22):** şema + katalog + servis + boot uzlaştırması + 39 çağrı yerinin bağlanması + `test_number_series` (26 kontrol, dört negatif sonda). Kullanıcıya görünür değişiklik YOK.
- **Faz B (indi, 2026-09-22):** barkod sınıflandırması sunucuya — `GET /api/scan/series`, `search.service.EXACT_FORMATS` tablodan türetilir, `Electron/src/lib/scanner/barcode-kind.ts` ve mobildeki üç regex (`PaketlemeScreen:75` · `DepoScreen:309` · `FasonSevkScreen:82-83`) kalkar, tanınmayan kod `GET /api/scan/resolve`a sorulur, `client-version-policy` `minVersion` YÜKSELMEDİ ve bu ÖLÇÜLDÜ (altı sözleşme tetiğinin hiçbiri ateşlenmiyor; eşik C0b'ye taşındı). Taranan serilerin ön eki bu faz inmeden düzenlenebilir olmaz (kullanıcı kararı). Saha ölçümü: 8.089 gerçek kodda GERİLEME 0.
- **Faz C (indi, 2026-09-22):** panel ekranı (Ayarlar → Numaralandırma), izin `settings:numbering` + ayar şifresi, canlı önizleme ve ölçülmüş etki cümlesi; `RollReturn.returnNo` kolonu (bugün `id`'den türetiliyor); `shippingSackSeqPrefix` deseninden dosya-adı kıran karakterlerin çıkarılması.
  - **C0 (indi):** sayacın KAPSAMI `NumberSeries.formatChangedAt` damgasına bağlandı — sayaç yalnız biçim yürürlüğe girdikten sonra doğan kodlara bakar (tarih segmenti düşünce sabit baş kısalıyor ve eski rejim sayaca giriyordu: sıra 4 yerine 2.209.260.004) ve üretilen kod var olanların üstünden ATLAR (kapsam daraltması sayacı 1'e döndürebiliyor; aynı gün geri alınan bir biçim değişikliği var olan kodu yeniden üretirdi ve `withBarcodeRetry` bunu deterministik tekrarlayıp 409'la bitirirdi). Sayacı hazırlanmamış seri panelden DÜZENLENEMEZ (`scopedCounter` beyanı).
  - **ÖN KOŞUL (C0b) — İNDİ:** taranan (`scanned`) serilerin ön eki panelden değiştirilebilir olmadan ÖNCE `client-version-policy.ts`teki `minVersion`, Faz B'yi (sunucu tabanlı okutma sınıflandırması) taşıyan sürüme yükselir; sıra **önce istemci yayını, sonra backend**. Eşik ileriye dönük bir sürüm TAHMİNİ değil, o yeteneği taşımayan SON sürümdür (`FAZ_B_ONCESI`); iki eksen (panel + tablet) birlikte aranır, `web` muaftır çünkü web paketi backend'in İÇİNDE gider (drift imkânsız — okutma yapmadığı için DEĞİL: özet kabuğu `operations` yollarını açar ve orada yedi okutan yüzey vardır, ölçüldü).
    Gerekçe: Faz B'yi taşımayan bir panel/tablet kendi SABİT regex'iyle okumaya devam eder; ön ek değiştiği an kodu SESSİZCE yanlış türe çözer (çuval kodunu top sanıp "Top bulunamadı" der). Sessiz yanlış dal, 400'den pahalıdır.
    ⚠️ Faz B'de bu eşik **bilerek yükseltilmedi**: altı sözleşme tetiğinin hiçbiri ateşlenmiyor (uç eklendi, yanıt şekli aynı, zorunlu parametre GEVŞEDİ, enum ve izin kümesi aynı) ve kırılma yokken eşiği yükseltmek, güncellemeyi indiremeyen her makineyi çıkışsız biçimde üretim dışı bırakırdı.
    ⇒ Bu ön koşul bir CÜMLE olarak bırakılmaz, **kapı** olur: `updateSeriesFormat`, `scanned: true` bir serinin biçimini değiştirmeyi `minVersion` yeterli sürüme ulaşmadıkça 400 `NUMBER_SERIES_CLIENT_TOO_OLD` ile reddeder (mesajda gereken sürüm yazılı). Böylece "önce istemciyi güncelle" bir niyet değil bir seddir.
  - **C2 (indi):** `RollReturn.returnNo` kolonu + belge-çapalı geri doldurma. Numara SATIRA değil BELGEYE aittir (belge `returnGroupId ?? id` ile çözülür): üye satırlar liderin numarasının kopyasını taşır, tekillik BELGE başınadır (`returnGroupId IS NULL OR = id` — yalnız `IS NULL` demek grupların tamamını kısıt dışında bırakırdı).
  - **C4 (indi):** `shippingSackSeqPrefix` deseninde YAZMA yüklemi daraldı (eğik çizgi dosya/sayfa adını kırıyordu), OKUMA yüklemi GENİŞ kaldı — aynı fonksiyon sevk anında DONMUŞ ön eki de süzüyor ve daraltmak geçmiş belgeyi bugün boş gösterirdi.

- **Faz D (indi, 2026-09-23) — KAPANDI.** Biçim artık tamamen VERİ: kullanıcı ön eki, tarih segmentini, haneyi, İKİ ayracı, sayacı ve numara kaynağını panelden yönetir; geçmiş asla yeniden numaralanmaz.
  - **YAPILDI**
    - **D1** kalan seriler panele (52 seri, `panelGroup` ile bölümlenmiş).
    - **D2** sayaç ailesi: başlangıç · adım · üst sınır · tükenme uyarısı. Hane bir DOLGU ayarıdır, kapasite değil (taşma genişletir, sarmaz); sayacı durduran tek şey `maxValue`dur.
    - **D3** numara kaynağı (`FREE`/`SYSTEM`/`MANUAL`) — iki değerli bir bayrak bugünkü davranışı İFADE EDEMİYORDU; eski `partyCodeAuto` ayarı bundan TÜRETİLİR oldu (damgalı tek seferlik göç).
    - **D4** tarihe bağlı geçiş (`number_series_lines`, Dynamics "No. Series Line" kalıbı): "1 Ocak'tan itibaren şu biçim". Biçim artık bir DEĞER değil bir ZAMAN ÇİZGİSİ; `number_series` kolonları yürürlükteki satırın ÖNBELLEĞİ ve tek yazar ikisini tek tx'te yazar. Emekli BİÇİMLER kendi segment/hanesiyle denenir (eski `retiredPrefixes` yalnız ön ek eksenini koruyordu).
    - **D5** tarih segmenti TEK KAYNAK (`DATE_SEGMENTS`) + üç yeni segment (`DDMMYYYY` · `MMYY` · `YYYYMMDD`) + İKİNCİ AYRAÇ (`separator2`, tarih↔sayaç eklemi). İstemciler sunucu tablosunu artık HEP-YA-HİÇ reddetmiyor: tanınmayan satır atılır, gerisi kullanılır.
    - **D6** yapılandırma paketi numara serilerini taşır — ama panelin YAZARINDAN geçerek; kapıları atlayan içe aktarım modu YOK. Ayar şifresi kapısı uca değil İÇERİĞE takılı.
    - **D7** bayat biçim açıklamaları gerçeğe hizalandı, `sample-data.ts` örnekleri seriden türetiliyor, yeni literaller cırcırla kapatıldı.
  - **ERTELENDİ (gerekçesiyle)**
    - **Şube/depo kod segmenti** — çok kurulumlu/çok depolu senaryoda anlamlı; `adnansahin`de tek kurulum tek ana depo var, yani bugün ÜRETİLEMEYEN bir durumu modellemek olurdu. `separator2` ile birlikte gelen üçüncü bir parça, biçim uzayını da kapasite kapısını da ölçülmemiş biçimde büyütür.
    - **Boşluk doldurma rejimi** (iptal edilen numaranın yeniden kullanımı) — defter semantiğiyle çakışır, ayrı bir karar ister.
    - **Tekillik KAPSAMI ayarı** (yıllık/süresiz) — bugünkü kapsam tarih segmentinden türüyor ve ikinci bir ayar iki gerçek üretirdi.
    - **Biçim değişikliğini geri alma düğmesi** ve **değişiklik geçmişi ekranı** — veri (`number_series_lines`) ARTIK VAR, yani ikisi de bir sonraki fazın ekran işidir; motor beklemiyor.
    - **Mükerrer kod tarayıcısı** — `number_series` tekilliği zaten DB seviyesinde; tarayıcı ancak geçmiş onarımı kararı verilirse anlamlı.
  - **REDDEDİLDİ (yeni; §3'ün devamı)**
    - **Numaraya SONEK eklemek ve parça SIRASINI değiştirmek** — kullanıcı kararı. Sayaç kuyruğu sabit başın SONUNDA olmak zorunda: `where: { gte, startsWith }` sorgusu ve emekli biçim eşleşmesi bu varsayıma dayanıyor; sıra serbestleşirse sayaç kapsamı ayrıştırılabilir bir string olmaktan çıkar.
    - **Örnek kodları elle yazmaya devam etmek** — biçim veri olduğu an her literal bir zaman bombası; ölçüldü (68 literal) ve cırcırla dondu.
    - **İçe aktarımda kapıları atlayan bir mod** — paketin hedefteki canlı numaralandırmayı değiştirmesi panelden değiştirmekle AYNI şeydir; tam olarak o kapılar sahadaki barkodun okunamaz hâle gelmesini engelliyor.
  - **AÇIK BORÇ:** `number_series` biçim kolonlarının kaldırılması (zaman çizgisi tek gerçek olduğuna göre önbellek bir gün gereksizleşebilir). Ölçülebilir koşul: `resolveSeriesFormat` çağrılarının HİÇBİRİ senkron olmak zorunda kalmadığında — bugün önbellek senkron okuma içindir, kaldırmak her çağrı yerini `async` yapardı.

- **Faz E (indi, 2026-09-23) — KAPANDI.** Amaç: "her seri tamamen özelleştirilebilir olsun; geriye dönük uyumluluk kesinlikle olmalı, bir kod değişince eski verileri bozmamalı" (kullanıcı). **SAYAÇ kilidi 13 → 0; kataloğun 52 serisinin hepsi ya açık ya da ÖLÇÜLMÜŞ bir yapısal gerekçeyle kilitli.**
  - **YAPILDI**
    - **E1** kilit metinleri, hata yüzeyi ve önizleme: kilit cümlesi TEK KAYNAK (neden · ne zaman açılır · eylem kimde), jargon kaldırıldı, bekleyen değişiklik iptal edilebilir, emekli ön ek hijyeni (veri düzeltme + CHECK).
    - **E2** SAYAÇ kilidinin kaldırılması, alan alan: depo-ticaret → master veri → üretim → okutulan aile → finans. Her seride üreteç ortak C0 yoluna (`nextSeriesNo`/`nextSeriesSeq`) geçti ve yükleyici DOĞUŞ ANINI taşır — çağrının doğru fonksiyona yapılması yetmez, satırın biçimi de ölçülür (`directShipment` çağrıyı yapıyordu ama çıplak string döndürdüğü için kapsam damgası SESSİZCE kapalıydı).
    - **E3** geriye dönük uyumluluk matrisi (`test_number_series_geri_uyumluluk`, 225 kontrol): **L0** beyan ↔ gerçek (her serinin üreteci ADIYLA ölçülür; `scopedCounter.uretec` bir yol ya da YOL LİSTESİ olabilir — `workOrder` ve `subcontractorDispatch`in İKİ üreteci var), **L1** biçim ekseni (49 seri × her dönüşüm = 921 dönüşüm; eski kod tanınmaya devam eder, yeni kod geçerlidir, sayaç ilk BOŞ sıradan başlar), **L2** kayıt ekseni (49 açık serinin 49'u GERÇEK kayıtla, servis yolundan).
    - **E4** İSTEMCİ kilidi SERİ düzeyinden EKSEN düzeyine indi: hangi alanın eski istemciyi kırdığı ölçülür, kırılmayan eksen bugün serbesttir.
  - **KALAN KİLİTLER (tamamı ölçülmüş)**
    - **YAPISAL (2)** — küme KAPALI: `roll` (top barkodunda tarih ile sıra ARASINDA duran faz harfi `H`/`F` + `RollBarcodeCounter` anahtarı) · `batchDaily` (P01…P99 fiziksel plaka seti, körlemesine sarar). Gerekçesi çürüyen kilit, kilit değil KALINTIDIR ve kaldırılır — `returnDoc` ve `workOrder` bu yüzden kümeden çıktı.
    - **İSTEMCİ (eksen düzeyinde)** — `test_eski_istemci_okutma` sahadaki panel 1.3.1 ve tablet 1.0.6/1.0.7 sınıflandırıcılarını git'ten kurup simüle ederek ÖLÇTÜ:

      | Seri | Eski istemcide KIRILAN eksen(ler) | Bugün serbest |
      |---|---|---|
      | `sack` (çuval) | ön ek · tarih · hane · ayraç · ikinci ayraç | — (tablet `/^CV\d{10}$/` ile tanıyor) |
      | `workOrder` (iş emri / refakat kartı) | ön ek · ayraç | tarih · hane · ikinci ayraç |
      | `swatch` (kartela kartı) | ön ek | tarih · hane · iki ayraç |
      | `subcontractorDispatch` · `subcontractorReceipt` | ön ek | tarih · hane · iki ayraç |
      | `kartelaDispatch` · `kartelaReceipt` | ön ek | tarih · hane · iki ayraç |
      | `shipment` (sevkiyat) | — (hiçbiri) | hepsi |

      **Açılma koşulu:** sahadaki **panel 1.3.1'in ÜSTÜNE** ve **tablet 1.0.8 ya da üstüne** çıkılıp kurulması. Tablette eşik 1.0.7 DEĞİL 1.0.8'dir ve bu ölçülmüştür: `1.0.7` etiketi Faz B'yi taşımayan bir commit'i de kapsıyor, yani o sürüm atlanır.
  - **KAPILAR (hepsi fail-closed, hepsi negatif sondayla doğrulandı)**
    - **① karakter kümesi · ② hane ve KOLON KAPASİTESİ** — kod hedef kolona sığmalı (`packingLotCode` + 8 hane = 17 karakter, kolon `VarChar(16)`: o ayardan sonra hiçbir sevk partisi açılamazdı).
    - **③ tarama uzayında ön ek çakışması** + **③a SONUÇ KAPISI** — ölçüt ön ek EŞİTLİĞİ değil, üretilen kodun NEYE ÇÖZÜLDÜĞÜ: okutulmayan bir seri de tarama uzayına düşen kod üretebilir. Devralınan çakışma serinin BÜTÜN zaman çizgisinden (yürürlükteki + emekli + tohum) hesaplanır; yalnız bugüne bakan bir istisna kullanıcıyı kendi eski biçimine dönemez hâle getiriyordu (K24).
    - **④ paylaşılan kolonda ön ek tekilliği** — aynı `countTable` altındaki iki seri ne eşit ne birinin BAŞLANGICI olan ön ek taşıyabilir, EMEKLİ ön ekler dahil. ③ TARAMA uzayını, ④ SAYAÇ uzayını korur.
    - **C0 kapsam damgası** ve **C0b/E4 istemci ekseni** — yazma yolu ve yapılandırma paketi ÖNİZLEMESİ aynı üç yüklemden geçer (önizleme eksen kapısını çağırmıyordu: paket "uygulanacak" derken uygulama 400 veriyordu).
    - **L0 beyan ↔ gerçek** ve **E3 matrisi** ve **eski istemci İKİ YÖNLÜ kapısı** (simülasyonun kırdığı her eksen tabloda VAR · tablodaki her eksen simülasyonda GERÇEKTEN kırılıyor).
  - **ÖLÇÜLEN BORÇ (kapatılmadı, beyanlı):** kasa kodu (`cashAccount`, ön ek `KS`, okutulmaz) ile kartela sevk belge no (`kartelaDispatch`, ön ek `KS`, okutulur) aynı biçime çözülüyor. Çakışma yıllardır var ve zararsız sayılmış; kapı YENİ ihlali engeller, bugünkü durumu yasaklamaz (yasaklasaydı o serinin hane sayısı bile değiştirilemezdi). Kapatmak bir ÖN EK GÖÇÜ kararıdır ve kullanıcıya aittir.
  - **AÇIK İŞ:** yok. Kilitlerin açılması artık bir KOD işi değil bir YAYIN işidir (panel + tablet sürümü).
