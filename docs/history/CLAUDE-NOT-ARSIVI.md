# CLAUDE.md Karar Notları Arşivi

> **Bu dosya nedir:** Kök `CLAUDE.md`'deki tarihli karar notlarının TAM METNİ.
> 2026-08-17'de taşındı — CLAUDE.md her oturumun bağlamına otomatik yüklendiği
> için 150k karakter sınırını aşmıştı (186k). İçerik SİLİNMEDİ, buraya birebir
> taşındı; CLAUDE.md'de her not için kısa bir tetik satırı duruyor.
>
> **Kullanım:** CLAUDE.md'deki dizin satırı hangi alana dokunacaksan o notu
> işaret eder — o alanda çalışmadan önce buradaki TAM notu oku. Notlar
> kronolojik değil, CLAUDE.md'deki orijinal sırasıyla durur.
>
> **⚠️ Yeni not kuralı (dosya yeniden şişmesin):** Yeni tarihli karar notu
> ARTIK CLAUDE.md'ye değil BU DOSYAYA yazılır; CLAUDE.md'deki "Karar Notları
> Dizini"ne yalnız 1-4 satırlık özet + tetik eklenir.
>
> **⚠️ Sınıf etiketi kuralı (2026-09-03):** Bundan sonra her yeni karar notu başlığında `[ÇEKİRDEK]` (her fabrikada değişmez: defter semantiği, brüt sevk, idempotency, kilit sırası, fail-closed kapılar, sır hijyeni, veri bütünlüğü) ya da `[PROFİL]` (bu kurulumun seçimi) etiketi taşır; karışık notta profil-bağımlı cümle satır içinde ⚠️ ile işaretlenir — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §0/§11.
>
> **Okuma kuralı:** "adnansahin'de yok" = "bayrağı kapalı". Hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz.

---

> ⚠️ **PROFİL GERÇEĞİ:** "Rezerv YOK" · "mühür YOK" · `Sack.customerId` opsiyonel · tek depo — dördü de referans profilin (adnansahin, basit usul işlemeci) seçimidir; rezervasyon altyapısı `shipping.reservationEnabled` ile ayrı dilimde gelecek, çoklu depo `depo.multiEnabled` arkasında. Notun **stok yalnız DISPATCH'te düşer / `SackAllocation` sevk ANINDA yazılır / PLANNED tahsis sayılmaz** kısmı ÇEKİRDEK defter semantiğidir ve bayraklanmaz — bkz. MODUL-BAYRAK-TASARIM §4 karar #6, §9, §11.

> **NOT:** Tartı / paket / sevkiyat modülü **2026-07'de çuval depo modeline** geçti (`/api/shipping`, Shipment / Sack / **SackAllocation** / ShipmentOrder). Çuval bir **depo nesnesidir**; `Sack.customerId` **opsiyonel** (açılışta atanabilir, yoksa sevkte atanır), **mühür yok**. Akış: aç→okut→(opsiyonel tart) → çuval DEPODA (`shipmentId=null`, her an düzenlenebilir). **Rezerv yok** — `OrderLine.packedQty`/`Order.packedQty` ve `rebalanceCustomerPool` kaldırıldı; sipariş görünümü **İstenen | Sevk | Açık** (`Açık = quantity − shippedQty`). Sevkiyat depodan **çuval seçilerek** kurulur (`createShipment({ sackIds, customerId, orderIds? })`); sevk onayı (`shipping.confirmationEnabled`, varsayılan **kapalı**) → çuvallar **doğrudan sevk** edilir (`DISPATCHED`, yanıtta `dispatched=true`), onay **açık** → sevkiyat `PLANNED` kalır ve çıkış ayrıca `dispatchShipment` ile onaylanır — kapı önü ara adımı YOK (`PLANNED → DISPATCHED`). `SackAllocation` **sevk anında** seçilen siparişlere spec+şube FIFO ile yazılır (`distributeSacksToLines`). Stok yalnız DISPATCH'te `SHIPPED` düşer ve tahsis **dispatch'te** `shippedQty`'ye terfi eder (PLANNED tahsis sayılmaz). İptalde tahsis silinir, çuval depoya döner. Top→sipariş bağı yok. Tasarım: `docs/design/CUVAL-HAVUZU-TASARIM.md` (eski `docs/history/SEVKIYAT-LOOSE-TASARIM.md` superseded).

> ⚠️ **PROFİL GERÇEĞİ:** Çuval notunun üç yüzeydeki opt-in gösterimi, SACK etiketi alan seti ve "tek dokunuş tartı" bu kurulumun paketleme/sevkiyat tercihidir; **FAIL-CLOSED baskı** (şablon çözülemezse 400, başka `LabelKind`'a SAPMAZ) ve "blocklist yeni kolonu müşteri belgesine sızdırır" kuralı ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-07-30 — çuval notu + çuval etiketi + tek dokunuş tartı):**
> • **`Sack.notes`** (VarChar 500) = çuvalın İÇ serbest notu ("kendimiz için"). **Annotation'dır:** durumdan bağımsız her an yazılır (sevk edilmiş çuvala da), donmuş belgeye girmez, `resetSackWeightsTx` silmez, `touchWarehouseSackTx` guard'ı **uygulanmaz** (bkz. `Teks-Erp/CLAUDE.md` kontrol listesi istisnası — guard'ı ekleme). Uçlar: `GET/POST /api/shipping/sacks/:id/notes`.
> • **Gösterimi üç yerde de OPSİYONEL + varsayılan KAPALI:** (a) çuval etiketinde `sackNote` alanı (şablona sürüklenmezse basılmaz), (b) sevk irsaliyesi ÇUVAL LİSTESİ'nde "AÇIKLAMA" kolonu, (c) iç ekranlar. Belge kolonu **opt-in**: `DocCol.defaultHidden` + `DocumentConfig.columns[tablo].shown` (allowlist) — `hidden` blocklist'i o kolonda YOK SAYILIR, çünkü blocklist yeni kolonu varsayılan GÖRÜNÜR doğurur ve iç not müşteriye giden irsaliyeye sızar. Baskı diyaloğundaki tek-seferlik `?rowNotes=1` bayrağı kalıcı ayarı **EZER** (pure OR) ve hiçbir yere yazılmaz. Satır notları `BuilderEntry.resolveLiveRowNotes` ile **her baskıda canlı** çözülür.
> • **`LabelKind.SACK`** = çuval etiketi. Barkod + QR = **`Sack.sackNo`** (CV+GGAAYY+NNNN) — Sack'e ayrı `barcode` kolonu EKLENMEDİ ("tek kod" kuralı, `utils/code-format.ts`). Katalogda **ürün/renk alanı YOK** (çuval karışık içerikli → tek ürün adı sessizce yanlış olur); toplam metraj/kg/top adedi + müşteri/şube + not basılır. Baskı **FAIL-CLOSED**: SACK şablonu çözülemezse 400 (roll/swatch'a SAPMAZ — `label-html-landscape.helper` bilinmeyen kind'ı `ROLL_FINISHED`'a düşürüp tire dolu top etiketi basardı). Çuval kodu top alanına okutulursa `scanIntoSack`/`locateRoll` anlamlı 400 döner; mobil Paketleme ekranı kodu tanıyıp o çuvalı **aktif** yapar.
> • **Tartı tek dokunuş** (mobil): ⚖ → kantardan oku → **doğrudan kaydet** (modal yok). Elle giriş çuval kartının **⋮** menüsünde. `LabelKind` genişletmesi Electron/mobil'de **derleme hatası vermez** (ikisi de kendi bağımsız union'ını taşır) — yeni bağlam eklerken `labelTemplateService.ts`, `KINDS` dizileri, `PeripheralDevices` tipleri ve 4 literal `z.enum` elle güncellenmeli.

> ✅ **ÇEKİRDEK:** "değer `code`'dur ad değil" · `toLocaleUpperCase("tr")` yasağı · kalitesiz topta fail-closed · tek uygulama noktası `prepareElements` — dördü de fabrikadan bağımsız; bayraklanmaz (MODUL-BAYRAK-TASARIM §11).

> **NOT (2026-08-02 — koşullu etiket elemanı, `showIf`):** Etiket Stüdyosu'ndaki her eleman (veri alanı, sabit metin damgası, çerçeve…) **kaliteye göre koşullanabilir**: *"kaliteyi YALNIZ 2. kalitede bas"* ya da tersi. Koşul PAYLOAD'da değil **ELEMANDA** yaşar (`LabelElement.showIf = { field:"qualityGrade", op:"in"|"notIn", values:[kod…] }`) — aynı top, farklı şablon → farklı görünürlük.
> • **Değer `QualityGrade.code`'dur, ad DEĞİL** (`Roll.qualityGrade` snapshot'ı da koddur). UI kaliteleri ADIYLA listeler, JSON'a KODU yazar; karşılaştırma **yerel-bağımsız** büyük harfle yapılır — `toLocaleUpperCase("tr")` "1.kalite"yi "1.KAL**İ**TE" yapıp eşleşmeyi sessizce bozardı (kod kimliktir, görüntü metni değil).
> • **Kalitesi belirlenmemiş topta koşullu eleman BASILMAZ** (op fark etmez, fail-closed): koşul kaliteye soru sorar, kalite yoksa cevap yoktur. Aksi halde `notIn` ile kurulmuş bir "1. KALİTE" damgası fason dönüşü / açık kumaş topunun üstüne basılırdı.
> • **Tek uygulama noktası `config/label-elements.prepareElements`** — beş render yolu (kanvas HTML, PPLA, PPLB, ZPL, raster) onu çağırır. Yeni bir emitter yazarken `expandMultilineText`'i DOĞRUDAN çağırma: koşul o dilde sessizce çalışmaz. Koşulsuz şablonda dizi aynen geçer (bugünkü çıktı bayt-bayt aynı). Legacy akış-modeli (varyantsız şablon) koşul TAŞIMAZ — özellik yalnız kanvas varyantlarında.
> • **Koşullu alan bağlam KİMLİĞİ sayılmaz** (`collectBoundKeys` onu atlar): koşullu `sackNo` taşıyan şablon çuval bağlamına atanamaz, çünkü kimliği yalnız bazı baskılarda basar.
> • Stüdyo: tuvalde huni rozeti + özellik panelinde "Koşullu basım (kalite)" + önizlemede **"Örnek: <kalite>"** seçici (yalnız koşullu eleman varsa çıkar — yoksa istek/çıktı bugünküyle birebir). Kalite kataloğu `GET /api/quality-grades`'ten okunur; liste ucu artık `label-template:read`'i de kabul eder (tasarımcının ayrıca `quality:read` yetkisi olmasın diye; yazma uçları dokunulmadı). Bekçi: `scripts/test_label_element_condition.ts` (üç negatif sondayla kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** Brüt sevk · donmuş belge · "iade AYRI belgeyle kapanır" · "Güncel rozeti = son versiyon, içerik güncel DEĞİL" — MODUL-BAYRAK-TASARIM §11'in ilk maddesi (defter semantiği bayraklanmaz): iki müşterinin raporu aynı kelimeyle farklı şey söyleyemez.

> **NOT (2026-08-02 — sevk rakamı BRÜT'tür; iade onu geriye dönük değiştiremez):** Sevk edilmiş bir sevkiyatın metrajı **canlı çuval sorgusundan ÜRETİLMEZ**. Sebep saha vakası (SVK2007260001): sevkten 6 dk sonra 49 m'lik top iade alındı, `RollReturn` topun `sackId`'sini boşalttı ve aynı sevkiyat üç ekranda üç şey söyledi — PDF 501 m (donmuş belge), liste + muhasebe Excel'i 452 m (canlı). Muhasebe fişi aynı belge numarasıyla geçen ay 501, bugün 452 basıyordu. **Sektör standardı:** fatura sevk irsaliyesinden kesilir, iade AYRI belgeyle (iade irsaliyesi + iade faturası) kapanır; çıkış belgesi asla düzeltilmez. Uygulaması:
> • **`getDispatchReport` donmuş `PrintedDocument.snapshot`'tan okur** — fiş ile irsaliye tanım gereği BİREBİR. Donmuş belge yoksa (PLANNED) canlıya düşer ve `frozen:false` işaretlenir. Yanıt ayrıca `returns {count, meters}` taşır: **düşmek için değil, dipnot basmak için**. `collectShipmentDocContent` hâlâ canlı okur — "sevk anı" garantisini veren şey **freeze adımıdır**; yeni bir sevk-içeriği yüzeyi eklerken aynı kuralı uygula.
> • **Toplu muhasebe export'unda sevk satırları BRÜT** (`RollReturn`'den geri-ekleme; snapshot değil, çünkü 2000 sevkiyat × çeki satırı = perf kuralı 13 ihlali). Eskiden satırlar canlı=net idi **ve** ayrıca "İade" sayfası vardı → muhasebeci "sevk − iade" yapınca aynı metraj **iki kez** düşüyordu. Artık "sevk − iade = net" doğru. İki kümenin kapsamı bilinçli farklı: sevk satırları *dönemde sevk edilen*, iade satırları *dönemde iade alınan*.
> • **İade irsaliyesi (`RETURN_DISPATCH`) iade ANINDA donar** (tx içinde), iptalde `voidForSource` ile VOIDED'e çekilir. Eskiden yalnız biri ekranı açtığında lazy-init ile doğuyordu → hiç açılmayan iadenin resmi kaydı hiç oluşmuyordu.
> • **Ekranda sessizlik yok:** irsaliye diyaloğunda "sevk sonrası N top (M m) iade alınmıştır" bandı, Excel'de aynı bilgi dipnot olarak (rakamla aynı dosyada dursun diye — `SheetSpec.notes`), sevkiyat detayı → İadeler satırından iade irsaliyesine tıkla-git. Versiyon rozetindeki **"Güncel" = "en son versiyon, hiç revize edilmedi"** demektir, "içerik güncel" DEĞİL. Bekçi: `scripts/test_dispatch_report_gross.ts` (negatif sondayla kırmızı verdiği doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** "Sevkiyatlar (Muhasebe)" ekranı + `invoiceNo` fatura izi, muhasebecisi AYRI program kullanan kurulumun **dış muhasebe köprüsü**dür ve çekirdek sevkiyatın parçasıdır; `finance.enabled` açık kurulumda aynı ekran terfi eder ve çakışma `shipping.invoiceMode = dis|ic|ikisi` ile çözülür. `attachTotals`'ın BRÜT olması ve `dispatchedAt` union'ında iki tarafın alan adının farklı olması ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §6.

> **NOT (2026-08-02 — brüt kuralı LİSTE yüzeyine de uzandı + muhasebe ekranı tamamlandı):** Yukarıdaki brüt kuralı fişi/irsaliyeyi/Excel'i kapsıyordu ama **liste** hâlâ canlıydı: `RollReturn` topun `shipmentId`'sini NULL'ladığı için (`return.service.ts:324-325`) `_count.rolls` NET okunuyordu — donmuş irsaliye "2 top" derken liste "1 top" diyordu (metrajda çözülen sorunun adet ikizi). Muhasebe ekranında metraj **hiç yoktu**; canlı toplanarak eklenseydi SVK2007260001 vakası bu kez listede doğardı.
> • **`listShipments.attachTotals`** metraj + top adedini BRÜT üretir: canlı + iptal edilmemiş `RollReturn` geri-eklemesi. Snapshot OKUNMAZ (perf kuralı 13) — `accounting-export.service.ts:255` de aynı tercihi yapmıştı. **Kg geri-ekleme İSTEMEZ** (iade `Sack.weightKg`'a dokunmaz). `attachBadges` ile aynı yerleşim: merge/slice sonrası, yalnız sayfadaki id'ler; DIRECT satırlar sorguya girmez (`DirectShipment.totalQty` denormalize). Bu **operasyon Sevkiyatlar ekranını da** brüte çeker — bilinçli; "N iade" rozeti (artık ortak `components/operations/ReturnsBadge`) farkı söyler.
> • **`dispatchedAt` ile sıralama açıldı** — `cursor.ts` `sortNullable` (nulls-last) + Prisma `nulls: "last"`. ⚠️ Union'ın iki tarafında **alan adı farklı** (`Shipment.dispatchedAt` ↔ `DirectShipment.shippedAt`): direct dalı için `orderBy` VE cursor `where`'i ayrı kurulur — aynı `cw` nesnesini paylaşmak DirectShipment'ta olmayan alana filtre yazmaktı. Muhasebe listesinin varsayılanı `dispatchedAt desc`.
> • **Fatura izi:** `Shipment`/`DirectShipment`'a `invoiceNo` + `invoicedAt` + `invoicedById`. **ERP fatura KESMEZ** — bu yalnız dış muhasebe programındaki belgenin izidir (tutar/KDV YOK; muhasebe yüzeyi miktar-odaklı). Yalnız `DISPATCHED` işaretlenir (atomik claim); `invoiceNo: null` işareti kaldırır **ve tarihi de temizler** (yarım durum yok). Yeni izin **`shipping:invoice`** — muhasebeciye `shipping:write` vermek onu sevkiyat iptal edebilir yapardı.
> ⚠️ **2026-09-03 GÜNCELLEME:** "ERP fatura KESMEZ" cümlesi **finans modülü kapalıyken** doğrudur. `finance.enabled` açık kurulumda sevk sonrası taslak fatura ERP'nin kendi içinde doğar (`shipping.service.ts` → `maybeAutoDraftInvoiceAfterDispatch` → `helpers/shipment-auto-draft.helper`) ve `Invoice.shipmentId` + `invoices_one_active_per_shipment` partial unique'i şemada HAZIRDIR; `invoiceNo` elle izi ile iç faturanın çakışması `shipping.invoiceMode` ile yönetilir — bkz. MODUL-BAYRAK-TASARIM §6 / karar #10.
> • Ekran ayrımı korunuyor: **Sevkiyatlar** (operasyon, tüm statüler, iptal) ve **Sevkiyatlar (Muhasebe)** (salt-okunur DISPATCHED + fiş + dönem Excel + fatura) ayrı kişilerce kullanılıyor; **izinle ayrılmadı** (sevkiyatçının da belgelere erişimi gerekiyor). Muhasebe ekranı filtreleri: müşteri · şube · yön · fatura · iade · tarih; üstte dönem bandı (`?withSummary=true` — bayrak yoksa aggregate koşmaz). Bekçiler: `scripts/test_shipment_list_gross.ts`, `test_shipment_invoice.ts`, `test_shipment_list_sort.ts` (üçü de negatif sondayla kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** Tek kaynak (`RollReturn`, snapshot DEĞİL) · tx'siz iki sorguda dedup · `totalKg` değişmez · "mobil istemci brütü elle kurmaz" — dördü de fabrikadan bağımsız; MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-03 — brüt kuralı ÇUVAL İÇERİĞİ yüzeyine de uzandı; üçüncü ve son yüzey):** Yukarıdaki iki not fişi/irsaliyeyi/Excel'i ve listeyi kapsıyordu; **sevkiyat DETAYI** hâlâ canlıydı. Saha vakası SVK0308260001: sevk edildi, 4 top (212 m) iade alındı, detay ekranı iki çuvalı da **"Eşleşen top yok · 0 top"**, üst sayaçları **"Top 0 · Toplam Metraj 0 m"** gösterdi — aynı sevkiyatın irsaliyesi 4 top diyordu. Sebep aynı tek satır: iade `Roll.sackId` **VE** `shipmentId`'yi NULL'lar (`return.service.ts:322-325`); önceki düzeltmeler yalnız `shipmentId` tarafını telafi etmişti, **çuval kırılımı hiç telafi edilmemişti**.
> • **`getShipmentById` artık BRÜT** — `RollReturn`'den (`prevSackId`) çuval bazında geri-ekleme yapar. Kaynak **snapshot DEĞİL**: `attachTotals` ve `accounting-export` aynı kaynağı seçti; üçüncü bir kaynak üçüncü bir rakam demekti. Ayrıca `PrintedDocument.snapshot` bu iş için **yetersiz ve güvenilmez** — `cekiRows` kalite taşımıyor, eski snapshot'larda `width` yok, ve `reissue`/lazy-init yolları belgeyi **canlıdan** kurduğu için iadeden sonra doğan snapshot zaten NET olur. **Ek sorgu YOK** (`rollReturn.findMany` zaten koşuyordu, yalnız yukarı taşındı + select genişledi).
> • **İade satırı ÇUVALDA KALIR ve `returned` ile işaretlenir** (soluk satır + amber "İade" rozeti + tarih/sebep tooltip'i). Metraj **üstü çizili DEĞİL** — üstü çizgi "bu sayı geçersiz" der, oysa metraj brüt toplama dahildir ve irsaliyede durur. Satır **salt-okunur** (top zaten çuvalda değil). Ayrı "BU SEVKİYATTAN İADE EDİLENLER" kartı **aynen kalır** — sektör standardındaki ayrı iade defteri; çuvaldaki rozet onun yerine geçmez, **konumunu** söyler (ürün kararı, 2026-08-03).
> • **Üç tuzak, üçü de bekçide kilitli:** (1) `sacks[].rolls` ile `summary` AYRI toplanırsa çift sayım olur → tek `grossRolls` kaynağından türetilir; (2) `shipment.findUnique` ile iade sorgusu **ayrı sorgulardır (tx yok)** — arada bir iade commit olursa aynı top iki kez sayılır → canlı id kümesiyle **dedup**; (3) sentetik satır `sackId = prevSackId` **taşımalı**, yoksa `undefined == null` ile hem çuvalda hem "çuvalsız" kümesinde görünür. `status` alanına "iade" anlamı **YÜKLENMEZ** (o alan hayalet-top/`SACK_ABSENT` sözleşmesine ait).
> • **`totalKg` DEĞİŞMEZ** (iade `Sack.weightKg`'a dokunmaz → zaten brüt; geri-ekleme çift sayardı). **PLANNED sevkiyatta hiçbir şey değişmez** ve `if (DISPATCHED)` dalı da **EKLENMEDİ**: iade `roll.status=SHIPPED` istediği için PLANNED'da `RollReturn` doğamaz, sorgu doğal olarak boş döner. **İade iptali kendiliğinden toparlar** (`cancelledAt: null` süzgeci) — ek kod yok.
> • **Mobil ZORUNLU değişti:** `ShipmentDetailView` brüt rakamı istemcide elle kuruyordu (`rollCount + returnedCount`) → backend brütleşince **çift sayardı**. O satır kaldırıldı, yerine dipnot geldi. Mobil çuval kartı per-top satır basmadığı için işaret oraya **`sack.returnedCount`** ile konur ("N iade") — onsuz şişmiş rakam işaretsiz kalırdı. **Backend + Electron + APK aynı pencerede deploy edilmeli.**
> • **Kapsam DIŞI (bilinçli, ayrı iş):** `sack-search`/çuval etiketi yeniden basımı hâlâ canlı `sack.rolls` okuyor. ~~Ve daha öncelikli bir açık: `reissue` + lazy-init yolları…~~ → **2026-08-05'te KAPATILDI**, aşağıdaki nota bak. Bekçi: `scripts/test_shipment_detail_gross.ts` (33 kontrol; negatif sondayla 10 kontrolde kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** "Freeze tek koruma" varsayımının çürütülmesi ve "yeni sevk-içeriği yüzeyi eklerken sor: sevkten SONRA da koşar mı?" sorusu her kurulumda geçerlidir — MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-05 — BELGE YOLU da brütleşti; "canlı okuyor" ≠ "net üretiyor" ayrımı):** 2026-08-02/03 notları fişi, listeyi, Excel'i ve sevkiyat detayını brüte çekmişti; **belge ÜRETİCİSİ** (`shipping.service.collectShipmentDocContent`) hâlâ canlı okuyordu. "Freeze tek koruma" varsayımı YANLIŞTI: aynı üreticiyi **`reissue`** (gerekçeli revizyon) ve **lazy-init** (donmuş belgesi olmayan eski kayıt ilk açıldığında) sevkten SONRA da çağırır. Sonuç: iadeden sonra üretilen "donmuş" resmi belge **NET** doğuyordu (saha vakasının rakamlarıyla: 501 yerine 452). Ekran düzelmişti, kâğıt düzelmemişti.
> • Düzeltme, ekran tarafındakiyle **aynı kaynağı** kullanır: iptal edilmemiş `RollReturn` satırları `prevSackId` ile çuvallarına geri eklenir. Snapshot OKUNMAZ — `attachTotals`, `accounting-export` ve `getShipmentById` de `RollReturn`'ü seçti; dördüncü bir kaynak dördüncü bir rakam demekti.
> • **Diğer çağıranlarda NO-OP:** freeze sevk tx'inin İÇİNDE koşar (henüz iade yok), TASLAK önizleme PLANNED sevkiyat içindir ve iade `roll.status=SHIPPED` istediği için orada `RollReturn` doğamaz. Yani çalışan yollar bayt-bayt aynı kaldı.
> • **Üç tuzak, üçü de bekçide:** (1) çuval satırı + ürün özeti + çeki satırları **tek** `sacksGross` kaynağından türetilir (ayrı toplamak çift sayardı); (2) `shipment.findUnique` ile iade sorgusu **ayrı sorgulardır (tx yok)** → canlı id kümesiyle **dedup**; (3) **`totalKg` DEĞİŞMEZ** — iade `Sack.weightKg`'a dokunmaz, geri-ekleme kg'yi çift sayardı. `prevSackId` taşımayan eski iadeler (kolon 2026-06'da eklendi) **atlanır** — uydurma çuvala yazmaktansa eksik bırakılır.
> • Bekçi: `scripts/test_dispatch_report_gross.ts` **§2b** (34 kontrol; negatif sondayla 7 kontrolde kırmızı verdiği — ve tam olarak 452/1 top ürettiği — doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** "Kat 2 değerli, o yüzden index eklenmedi" ve kat kataloğunun içeriği (2-KAT/4-KAT/TUP) bu kurulumun ürün karakteristiğidir (`production.enabled`); **kanoniklik zorunluluğu** (ham değer filtrede sessizce 0 satır döndürür), **sebep audit'ten değil KOLONDAN okunur** ve **parti üç dalı (tek açık→bağla · çok→400 · hiç→null)** ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §5.2, §11.

> **NOT (2026-08-04 — topun KALICI alanları: kat + giriş sebebi; ve elle eklenen top artık PARTİLİ):** Elle top ekleme (Tambur "Düzelt → Manuel Top Ekle" + "Manuel Mod") sahada üç sessiz boşluk açıyordu; üçü de topun **kendi satırında** kapatıldı — migration `20260804210000_roll_fold_type_and_entry_reason`.
> • **`Roll.foldType` (VarChar 64) — kat topun KALICI özelliğidir.** Eskiden kat yalnız `WorkOrderStep.stepData` ve `RollOperation.metadata` JSON'larında yaşıyordu: indekslenemez, filtrelenemez, raporlanamaz. Kat **MİRAS ALINMAZ** — kesimde doğan çocuk ebeveyninin katını körlemesine devralmaz, **o kesimde SEÇİLEN** değer yazılır (kullanıcı kararı: *"o top kesilerek yeni bir kat değeri kazanabilir"*). Alan hiç GÖNDERİLMEZSE (eski APK) parent → iş emri planı sırası uygulanır; bu **miras değil**, sözleşme boşluğunun doldurulmasıdır — ikisi karıştırılırsa asıl kural sessizce bozulur. Beş yazma yolu: `cutOpenFabric` çocuğu · `cutWarehouseRoll` kesim çocuğu · yeniden-kesim artığı · `finalizeOpenFabric` çocuğu · elle giriş. **Kanoniklik ZORUNLU** (`normalizeFoldType`, kanonik "4-KAT"; TÜP/özel değer aynen geçer): `buildWhereClause` tanımadığı filtre anahtarını **HAM geçirir**, yani DB'de "4-KAT" varken istemci "4 kat" ararsa sorgu **0 satır döner ve hata/log ÇIKMAZ** — operatör "bu kumaştan hiç yok" sanır. Index **bilinçli EKLENMEDİ**: `rolls` zaten 18 index taşıyor, kat 2 değerli ve her zaman `status` ile birlikte süzülüyor.
> • **`Roll.entryReason` (VarChar 500) — sebep audit'ten DEĞİL kolondan okunur.** Sebep önce yalnız `SystemLog`'a yazılıyordu; `archive-scheduler` **6 ayda bir** (`MONTHS_TO_KEEP=6`) satırları `system_log_archives`'e **TAŞIR** → altı ay sonra "bu top nereden geldi" sorusunun cevabı sessizce kaybolurdu. Sektör standardı da budur: kaydın *kendi* satırındaki gerekçe alanı (SAP `MSEG-SGTXT`) denetim log'undan ayrıdır — audit *kim ne zaman değiştirdi* sorusuna bakar, gerekçe *verinin bir parçasıdır*. Audit yazımı **kaldırılmadı** (iki soru ayrı); okuma kolonu tercih eder, kolon boşsa eski kayıtlar için audit'e düşer. Geri doldurma: `scripts/backfill_roll_fold_and_reason.ts` (**dry-run varsayılan**, `--apply` öncesi her kaydı listeler).
> • **Nullable kolon eklemek PG11+'ta metadata-only'dir** — tablo yeniden yazılmaz (ölçüldü: dolu `rolls` üzerinde 6 ms; dev PG18, saha PG16.9). "Canlı tabloya kolon eklemek pahalı" sezgisi **DEFAULT'lu** kolonlar içindir; ikisi karıştırılıp kolon yerine JSON seçilmemeli.
> • **Elle eklenen top artık PARTİSİZ doğmaz.** Parti izlenebilirliğin birimidir ("üretime aynı anda giren top grubu") ve etki kümesini o tanımlar; ayrıca Electron iş emri detayı topları partiye göre grupladığı için partisiz top **PARTİSİZ kutusuna** düşüp mobil listede hiç görünmüyordu → operatör topu ekliyor, bulamıyor, **tekrar** ekliyordu. Sektör standardı (SAP "batch determination"): parti yönetimli malzemede sistem partiyi sessizce boş bırakamaz — ya türetir ya sorar. Üç dal: **tek açık parti → SORMADAN bağla** · **birden fazla → 400 `BATCH_REQUIRED` + seçenek listesi** · **hiç yok → NULL meşru**. "Açık" tanımı listeye değil **veriye** dayanır (partide canlı top var mı) ve ölü kümesi **tek kaynaktan** gelir: `K18_DEAD_STATUSES`. ⚠️ **`SCRAP` partiyi KAPATMAZ** — fire *gerçek bir karardır*, mal vardı ve üretildi; K18'e SCRAP eklemek burayı düzeltirken onlarca liste/lane filtresini de değiştirirdi (bekçi bu ayrımı kilitler). Seçenek listesi **her zaman reddeden tarafın ağzından** gelir: mobil partileri önden yüklemez, "gönder → sorulursa cevapla" akışını izler; aksi halde ekranda görünen parti backend'ce kapanmış sayılıp reddedilirdi. Parti kararı yanıtta **geri söylenir** (`batchId`/`batchNumber` + mesaj) — sessiz doğru cevap ≠ görünmez cevap. Audit `batchSource` (`OPERATOR`/`AUTO_SINGLE`/`NONE`) ile kararın sahibini yazar.
> • **SIRA sözleşmesi:** payload'ın KENDİ tutarlılığı (ürün/renk) **önce**, bağlam çözümü (parti) **sonra**. Parti kontrolü öne alınsaydı yanlış ürün gönderen istemci `ITEM_MISMATCH` yerine `BATCH_REQUIRED` alır, partiyi seçer, sonra asıl hatasını **iki tur sonra** öğrenirdi.
> • **Ürün/renk/en operatöre SORULMAZ** — iş emrinden gelir ve değiştirilemez (`ITEM_MISMATCH`/`COLOR_MISMATCH` hard guard). En de miras alınır: iş emrinin eni sabittir, tekrar sordurmak hem sürtünme hem çelişki riskidir. Kalite Tambur kararında belirlenir.
> • **Sebep artık HAZIR KATALOĞDAN seçilir** (`mobil/src/constants/manualReasons.ts`, iki ekran ORTAK). Serbest yazım kaldırılmadı, "Diğer"in altına alındı: eldivenli operatör vardiya ortasında `"aaa"` / `"."` gibi doldurmalar üretiyordu ve o, **boş bırakmaktan daha kötüdür** (denetimde cevap varmış gibi görünür, hiçbir şey söylemez). Kategori aynı zamanda veriyi **sayılabilir** yapar. ⚠️ Sahada sürekli "Diğer" seçiliyorsa **katalog yanlıştır**; gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi büyütme.
> • Bekçiler: `scripts/test_roll_fold_and_reason.ts` · `scripts/test_tambur_manual_batch.ts` (ikisi de negatif sondayla kırmızı verdiği doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** "Renkte `hasDefaultCategory` DE aranır, yoksa Tambur adımına renk yazılır" cümlesi, boya işini yalnız FASON firmanın yaptığı bu kurulumun topolojisinden doğar; iç boyahaneli kurulumda kural `stepCanApplyColor` üzerinden aynı kalır ama "kategorisiz istasyon = renk veremez" varsayımı geçersizdir. "Hedef ÖNERİDİR, kilit değil" · "istemci sözleşmesi DÜZ ID dizisi" · "istasyon değişince hedef sıfırlanır" ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §5.1/§5.2.

> **NOT (2026-08-06 — ROTA ŞABLONU artık HEDEF de saklar: adım başına renk + özellik):** Saha sorusu: *"rota oluştururken boyahane ekleyince orada alabileceği özellikleri göremiyorum ve seçemiyorum; bu kayıtlı rota kolay seçim işime yarayacak."* Yetenek chip'leri **vardı ama yanlış ekrandaydı**: iş emri formunun rota editörü (`RouteStepDetail`) onları çiziyordu, Tanımlar → Üretim Rotaları ekranındaki editör (`RouteStepEditor`) ise istasyon + not + fason firmadan ibaretti. Üstelik chip'lerde yapılan seçim **iş emrine** yazılıyordu, rotaya değil — yani şablon renk/özellik TAŞIMIYORDU. Migration `20260806000818_route_step_targets` (`RouteStep.plannedColorId` + `RouteStepProperty` pivotu; ikisi de nullable/yeni tablo → metadata-only).
> • **HEDEF BİR ÖNERİDİR, kilit DEĞİL.** Rota iş emrine uygulanınca istemci hedef alanları ön-doldurur, operatör değiştirebilir. `WorkOrder.targetColorId`/`WorkOrderTargetProperty` ile karıştırma: orası üretimin gerçek hedefi (sipariş kalemi kilitleyebilir), burası şablon varsayılanı. Adım tüketilirken hiçbir yere kopyalanmaz — kopyalayan tek yer istemcinin "rotayı uygula" adımıdır (`useDesignerSteps.seedFromRoute` → `WorkOrderFormView.applyRouteTarget`; mobil `useQuickWorkOrder.chooseRoute`). **Sipariş bağlı iş emrinde renge DOKUNULMAZ** — orada renk siparişin şartıdır.
> • **Çeviri kuralı: adım başına ↔ düz.** Rota hedefi adım bazında saklanır, iş emri hedefi tek/düzdür. Rotadan iş emrine: renk için **SON renk veren adım kazanır** (yeniden boyama varsa nihai renk odur), özellikler **birleşir**. İş emrinden rotaya ("Rotayı Kaydet"): `deriveStepTargets` düz hedefi adımlara **istasyon yeteneğiyle süzerek** dağıtır — ekranda chip'leri kapsayan kuralın aynısı, ayrı yazılırsa kaydedilen şablon backend'e takılır (400) ya da daha kötüsü hiçbir istasyonun uygulayamayacağı bir hedef taşır.
> • ⚠️ **RENKTE `hasDefaultCategory` DE ARANIR** (`route.service.applyStepTargets`). `deriveCapabilityFlags` kategorisiz istasyonda `canApplyColor: true` üretir — bu "bilinmiyor → serbest" demektir, "renk uygular" değil. Yalnız `canApplyColor`'a bakmak **Tambur adımına renk yazılmasına** izin verirdi. Panel, rota kapsama uyarısı ve mobil `routeApplyCaps` de bileşik koşulu kullanır. Özellik ise gerçek proses kısıtıdır → istasyonun `StationProperty` listesiyle sınırlıdır (renk kısıtı istasyon listesinden OKUNMAZ — 2026-08-02 kuralı, tüm katalog gösterilir).
> • ⚠️ **İstemci sözleşmesi DÜZ ID DİZİSİDİR** (`plannedPropertyIds`), ham Prisma nested write DEĞİL. `RouteService.ALLOWED_STEP_KEYS` `plannedProperties`'i **reddeder**; çeviriyi servis yapar. "İstemci zaten nested yazsın" diye gevşetmek, generic CRUD üzerinden ilişki manipülasyonunu kapatan F209 seddini (`connect`/`deleteMany` dahil) yeniden açardı.
> • ⚠️ **İstasyon değişince adımın hedefi SIFIRLANIR** (panel). Eski istasyonun özelliği yenisinde geçersizdir ve sessizce taşınırsa hata "Kaydet"e basınca, hiç dokunulmamış bir alandan gelirdi. Adım güncellemesi `deleteMany` + `create` olduğu için pivot satırları **CASCADE** ile düşer (aksi halde her kayıtta FK ihlali).
> • **Hedefsiz rota yolu bayt-bayt korunur:** hedef yoksa ek sorgu koşmaz, pivot satırı doğurmaz, `routeStepsToCreatePayload` alanları hiç göndermez. Reçetenin KENDİ rotası da hedefsiz kalır — hedef zaten `ProductRecipe`'te saklanıyor, ikinci kopya yaratmak iki kaynak demekti.
> • **Migration + backend + Electron aynı pencerede; APK ZORUNLU DEĞİL** (eski APK yeni alanları görmez → ön-doldurma olmaz, davranış bugünküyle aynı). Bekçi: `scripts/test_route_step_targets.ts` (20 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — `hasDefaultCategory` düşünce 1, allowlist gevşeyince 1, özellik yetenek kümesi körleşince 1; üçü de ayrıca "yarım kayıt bırakmaz" kontrolünü düşürdü).

> ⚠️ **PROFİL GERÇEĞİ:** Bu notun tamamı `production.enabled` altındaki **kurşun + KK2 tek fiziksel istasyon** (`StationKind.PROCESS_QC`) topolojisini varsayar — kaliteyi ayrı istasyonda yapan fabrikada ekran, rejim anahtarı ve "sonraki adım TAMBUR olmalı" şartı yeniden değerlendirilir (Faz B). Taşınabilir olan kısım: **tek kapı / tek yüklem** disiplini (`assertKursunTabletMayWrite`) ve "toplu sonuç PARÇALI, atlanan satır sebebiyle döner" kuralı — bkz. MODUL-BAYRAK-TASARIM §5.1, UYGULAMA-PLANI "Faz B" (R3).

> **NOT (2026-08-05 — KURŞUN PLANLAMA: iki ekran birleşti + bayrak artık REJİM anahtarı):** Saha sorusu: *"bypass açıkken operasyon menüsünde hem Kurşun Sırası hem Kurşun Dağıtım görünüyor, normal mi?"* Normaldi (2026-08-02 kuralı: *sırası* `!flag || tabletRegimeCount>0`, *dağıtım* `flag || pendingAssignmentCount>0` — ikisi de "işi kaldıysa dur"), ama **kuralın kendisi yanlıştı**: iki ekran AYNI iş emirlerini gösteriyordu ve planlamacı aynı işi iki menüde arıyordu.
> • **TEK EKRAN: "Kurşun Planlama"** (`/operations/kursun-dagitim`; `kursun-queue` route'u ona YÖNLENDİRİLİR — kayıtlı sekme/adres boşa düşmesin). Birleştirmenin dayanağı veri: `distribution` payload'ındaki **`waiting` listesi kuyruğun ta kendisi** ve `listQueue` ile **AYNI `orderBy`**'ı taşıyor (acil → urgentMarkedAt → priority → startedAt). İki bölüm üst üste: **Kurşun Sırası (bekleyen)** — sürükle-sırala + acil + [bayrak açıksa] makine seçici/Ata — ve **Makinelerde** (yalnız satır varsa çizilir). `KursunQueue/` klasörü, `KursunQueueRouteGate`, iki `visibleWhen` yüklemi ve `useKursunVisibility` **silindi**.
> • **KARO BAYRAKTAN BAĞIMSIZ** (Electron **ve** mobil): yalnız izinle süzülür (`quality:write` | `workorder:distribute`; mobilde `mobile:kursun-dagitim`). Bayrak artık **görünürlük** değil **REJİM** anahtarıdır. `GET /kursun-bypass/visibility` ucu **duruyor ama hiçbir yeni istemci çağırmıyor** — sahadaki ESKİ APK'lar onu hâlâ yokluyor, silmek deploy penceresinde 404 üretirdi.
> • **Sıralama izni GENİŞLEDİ:** `PATCH /kursun-qc/queue/reorder` artık `quality:write` **|** `workorder:distribute` **|** `mobile:kursun-dagitim` (eskiden yalnız ilki). Eski dar gerekçe "priority TABLET akışının sırasıdır, dağıtımcının sıralayacak şeyi yok" idi; birleşik ekranda bekleyen liste ile dağıtım listesi AYNI liste olduğu için düştü.
> • **SIRALAMA İKİ YERDE: bekleyen kuyruk VE makine İÇİ.** İkisi de aynı ucu ve aynı alanı (`WorkOrderStep.priority`) kullanır; çakışma yok çünkü bir adım aynı anda ya bekleyendir ya bir makinededir ya da tablet `open-cards`'ındadır — **üçü birbirini dışlar** ve yeniden numaralama yalnız kendi kümesine dokunur. ⚠️ Makine içi sıra `listDistribution`'da **JS ile** sıralanır (`sortByPlanOrder`), `orderBy` ile DEĞİL: kaynak atama satırı (`assignedAt asc` yüklenir), sıralama anahtarları ise adımdadır. Bu satır düşerse sürükleme priority'yi yazar, DB doğru olur ve **EKRAN HİÇ DEĞİŞMEZ** — hata yok, log yok; sahadan gelen tek belirti "sürüklüyorum, geri zıplıyor" olur. Son eşitlik bozucu `waiting`'de `startedAt`, `assigned`'da `assignedAt`'tir. **Her makine grubunun KENDİ `DndContext`'i vardır** — satırın makineler arası sürüklenmesi yapısal olarak imkânsız; makine değiştirmek bir yeniden ATAMA'dır (kaldır → tekrar ata) ve kazara sürüklemeyle yapılmamalıdır. Bekçi: `scripts/test_kursun_machine_order.ts` (12 kontrol; sıralama satırı kaldırılınca **4 kontrolde kırmızı** verdiği doğrulandı).
> • **YERLEŞİM = SEKME: havuz + makine başına bir sekme.** Önce iki bölüm üst üsteydi; makine sayısı arttıkça sayfa uzuyor ve **toplu seçim iki makineye birden taşabiliyordu**. Sekme bunu YAPISAL olarak çözer — ekranda tek liste vardır, "seçtiklerim nereye ait" sorusu doğmaz. Kaybedilen "hangi makine ne kadar dolu" görünürlüğü **sekme şeridine** taşındı (her sekmede iş adedi + metraj + bayat rozeti); sekmeye geçmeden yükü görmek dağıtım kararının ön koşuludur. ⚠️ Sekmeler **makine listesinden** doğar, dağıtılmış satırlardan DEĞİL: işi olmayan makinenin de sekmesi vardır ("boş mu, sekmesi mi yok?" sorusu operatörü durdurur ve boş makine tam da iş verilecek yerdir). Pasifleşmiş ama üstünde açık iş kalan makine için de sekme üretilir (`(pasif)` etiketiyle) — yoksa o işlere ulaşılamaz, havuza döndürülemezlerdi. Bekçi: `machine-tabs.test.ts`.
> • **TOPLU İŞLEM: `POST /kursun-bypass/assign-bulk` + `cancel-bulk`** (ikisi de `workorder:distribute`, en fazla 100 satır). Havuzdan toplu dağıtım ile makineler arası toplu TAŞIMA **aynı uçtur** — `assign` yeniden-atamayı taşıma olarak ele alıyor. **Seçim kimliği her yerde `workOrderStepId`** (`selection.ts`): havuzda ve makinede satırın tek benzersiz anahtarı odur; uçlara giden `workOrderId`/`assignmentId` seçili satırlardan TÜRETİLİR. Seçim sekme değişince TEMİZLENİR, ayrıca paneller `visibleSelection` ile ekrandaki satırlarla kesiştirir (ikinci hat).
> • ⚠️ **TOPLU SONUÇ PARÇALIDIR ve bu BİLİNÇLİDİR.** Tek transaction DEĞİL: (a) `assign` iş emri satırını kilitler, 50 satırı tek tx'te tutmak perf kuralı 10 ihlali + deadlock riskidir; (b) hepsi-ya-hiç yanlış semantiktir — listedeki bir iş bu arada uygunluğunu yitirdiyse diğerlerinin dağıtımını geri almak planlamacının niyetine aykırıdır (dağıtım zaten geri alınabilir). Karşılığında **atlanan her satır somut sebebiyle döner** (`failed[]`) ve arayüz onu uyarı toast'ında gösterir; havuz çubuğu ayrıca **seçim anında** "N tanesi dağıtıma uygun değil, atlanacak" der. *"42 atandı"* deyip 8'inin neden atlandığını yutmak en kötü davranıştır. Bekçi: `scripts/test_kursun_bulk.ts` (28 kontrol; satır hatası fırlatacak şekilde "hepsi-ya-hiç"e çevrilince kırmızı verdiği doğrulandı).
> • **Ekran deneme verisi:** `scripts/demo_kursun_planlama.ts` (`--apply` / `--cleanup`, varsayılan kuru anlatım). `DEMO-KRS-*` iş emirleri üretir — 5 bekleyen (biri acil) + 4 dağıtılmış (biri tek başına, üçü aynı makinede ki makine içi sıralama denenebilsin). **Canlı fabrika DB'sinde koşturulmaz.**
> • **KURŞUN TABLETİ BAYRAK AÇIKKEN SALT-OKUNUR** — ama **"her adım" DEĞİL, "dağıtıma UYGUN adım"**. Kör bir bayrak kilidi **ÇIKMAZ** üretirdi: kurşundan sonra **Tambur GELMEYEN** rotada (kurşun → zımpara → tambur) bypass kapanışını yapacak istasyon yoktur, yani iş ne tablette işlenebilir ne dağıtılabilirdi — hata yok, log yok, mal istasyonda kalır. Uygunluk kuralı zaten tam olarak *"bu adımı bypass rejimi taşıyabilir mi"* sorusunu yanıtlıyor; kilidi ona bağlamak tek tutarlı yanıttır.
> • **Tek kapı `helpers/kursun-bypass-eligibility.assertKursunTabletMayWrite`** — eski `assertStepNotBypassAssigned`'ın YERİNE geçti ve BEŞ tablet yazma yolunu da kapsar (KK2 tamamlama · hata kaydı · tablet adım kapatma · açık kumaş açma · kurşun bitirme). Üç dal: dağıtılmış → 409 (**ATAMA mesajı**, makine adıyla — daha somut olan önce sorulur) · bayrak açık + uygun → 409 (rejim mesajı) · aksi → serbest. **Bayrak kapalıyken maliyet tek ek sorgudur** (ayar okuması); uygunluk yüklemesi yalnız rejim açıkken koşar. Guard **UI'ya güvenmez ve güvenemez**: tablet offline kuyruk taşır, bayrak çevrildikten sonra flush edilen istek ekranı hiç görmeden gelir.
> • **Uygunluk kuralı artık TEK KAYNAK** (`resolveBypassBlockReason` + `loadBypassEligibilitySignals`): `listDistribution` toplu, tablet tekil çağırır. Kopyalansaydı ekran "Ata" derken tablet de yazabilir (ya da tersi) duruma düşerdi. `RouteStepRef`/`nextNonSkippedStep` de oraya taşındı.
> • **Mobil ZORUNLU değişti:** `KursunStepSummary.tabletReadOnly` (+ `bypassAssignment`) eklendi ve KursunQc ekranı kart açılınca yazma yüzeyini hiç çizmeyip mavi bilgi paneli basıyor. Alan eskiden **hiç okunmuyordu** — operatör dağıtılmış kartı okutup her butonda ham 409 yiyordu. Salt-okunur kararı ile guard **aynı fonksiyondan** beslenir. **Backend + Electron + APK aynı pencerede deploy edilmeli** (eski APK alanı görmez → yazmaya çalışır → 409).
> • **`listOpenCards` filtresi GENİŞLETİLMEDİ** (bilinçli): uygunluk hesabı rota + üç iz sorgusu ister, o uç ise tablet tarafından **5 saniyede bir** yoklanıyor; ayrıca uygun OLMAYAN adımlar listede KALMALI. Eski "sessiz 409" derdi kaynağında (bilgi paneliyle) çözüldü.
> • Bekçi: `scripts/test_kursun_regime_lock.ts` (21 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — rejim kilidi kaldırılınca 7, uygunluk süzgeci kaldırılınca (kör kilit) 2, salt-okunur bandı null'lanınca 2). `test_kursun_bypass.ts` 148/148 korundu.

> ⚠️ **PROFİL GERÇEĞİ:** "Tambur kilometre taşıdır" ve "bayrak AÇIK + adım bypass'a UYGUN" kapsamı bu kurulumun kurşun/tambur rotasına aittir (`production.enabled`); Tambur'suz rotalı fabrikada kilometre taşını rota belirler. Taşınabilir çekirdek: **milestone confirmation deseni**, "makine atfı UYDURULMAZ (`machineId=null` + görünür bant)" ve marker ön ek uyumu — bkz. MODUL-BAYRAK-TASARIM §5.1.

> **NOT (2026-08-06 — DAĞITIM ARTIK İŞİN ÖN KOŞULU DEĞİL: Tambur okutması kurşunu dağıtımsız da kapatır):** Saha sorusu: *"tambur kartı kurşundaki bir kartı okuttuğunda, henüz kurşun dağıtılmamış bile olsa kurşun tamamlandı sayılabilir; dağıtım çok önemli bir işlem değil, personel unutabiliyor."* Ölçüldü ve **gerçek bir KİLİTLENME** çıktı: bayrak açık + kurşun adımı dağıtılmamış olduğunda Tambur okutması `400 "Bu iş emrinin Tambur adımında şu an açık top yok… Tabletinizi yanlış istasyonda okutmuş olabilirsiniz"` veriyor, kurşun tableti ise rejim kilidi yüzünden salt-okunur (`"Kurşun dağıtımı açık — tablette işlem yapılmaz"`). **İki taraf da kapalı**; tek çıkış planlamacının dağıtım yapmasıydı ve mal o sırada Tambur'un önünde bekliyordu. Mesaj ayrıca **yanıltıcıydı** — operatör doğru istasyondaydı.
> • **Sektör karşılığı *milestone confirmation*** (SAP PP *Meilenstein-Rückmeldung*): kilometre taşı operasyonu onaylandığında öncesindeki onaylanmamış operasyonlar otomatik onaylanır. Tambur burada kilometre taşıdır. **Mekanizmanın tamamı zaten vardı** (`bypassPending` → sessiz kapanış → kart açılır); eksik olan tek şey mekanizmanın `KursunBypassAssignment` **satırına bağlı** olmasıydı. **Yeni kavram, yeni izin, yeni ekran, migration YOK.**
> • **Dağıtım artık MAKİNE ATFI için bir planlama kolaylığıdır**, işin ilerlemesinin ön koşulu değil. `findPendingForTambur` atama yoksa **SANAL bekleyen** üretir (`source: "UNASSIGNED"`), `completeFromTambur` ikinci dalıyla kapatır.
> • ⚠️ **KAPSAM: "her dağıtılmamış adım" DEĞİL — "bayrak AÇIK **ve** adım bypass'a UYGUN".** Tek kapı `resolveUnassignedTamburClosure`; yüklem kurşun tabletini kilitleyen `assertKursunTabletMayWrite` ile **AYNI kaynaktan** (`resolveBypassBlockReason` + `nextNonSkippedStep`) beslenir — ayrışsalardı "tablet yazamıyor ama Tambur da kapatamıyor" çıkmazı geri gelirdi. **Bayrak koşulu load-bearing:** kapalıyken kurşun tableti normal dijital akışta çalışıyor ve onu sessizce atlamak KK2 kalite verisini hiç girilmemiş bırakırdı. Okuma yolu (önizleme) ile yazma yolu (tx içi tazeleme) aynı fonksiyonu çağırır.
> • ⚠️ **MAKİNE ATFI UYDURULMAZ: `RollMovement.machineId = null`.** Varsayılan bir makineye yazmak makine bazlı hacim raporunu **sistematik olarak** yanlışlardı; boşluk dürüsttür. Bedeli bilinçli — o iş makine raporunda görünmez — ve **görünür kılınır**: `listDistribution.unassignedClosures` + Kurşun Planlama ekranındaki amber bant ("son 7 günde N iş dağıtılmadan kapandı"). Sayacın kaynağı **movement marker'ıdır, `SystemLog` DEĞİL** (`archive-scheduler` audit'i 6 ayda bir taşır — `Roll.entryReason` emsali). Yetenekler adımın **KENDİ** istasyonundan kopyalanır (tek PROCESS_QC istasyonu → atanmış yolla aynı satır).
> • ⚠️ **Marker `KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid>` — BASE ön ekle BAŞLAMAK ZORUNDA.** `hasBypassClosureOnProcessQcTx` (inventory) ve `loadBypassEligibilitySignals.closedNonBypass` bu satırları `startsWith(KURSUN_BYPASS_MARKER_PREFIX)` ile tanıyor; uyum koparsa çok-partili işin **İKİNCİ turu** "bypass dışı kapanmış hareket var" diye uygunluğunu kaybeder ve iş yeniden çıkmaza düşer (bekçide kilitli).
> • **Atomik claim EKLENMEDİ ve gerekmiyor:** atama satırı yok, claim'in işini `closeBypassMovementsTx`'in `exitedAt IS NULL` guard'ı + kapsam paritesi görüyor (3 paralel okutmadan yalnız biri kapatıyor — ölçüldü). İdempotent tekrarın izi de marker'dır (`findCompletedUnassignedClosure`) — o dal olmadan offline replay 404 alır ve operatör kendi bitirdiği işi "yok" diye görürdü.
> • ⚠️ **`completeUnassignedFromTambur`'un tx İÇİ tazelemesine BEKÇİ ERİŞEMEZ** — tek iş parçacıklı testte tx dışı ön kontrol her zaman önce reddediyor (körleştirilince test yeşil kalıyor, ölçüldü). Orası derinlik savunmasıdır; silmeden önce yerine ne koyduğunu bil. Testin ölçtüğü eşzamanlılık özelliği ayrıdır (N paralel okutma → 1 kapanış).
> • **Hata mesajı da düzeltildi:** 400 artık *"yanlış istasyonda okutmuş olabilirsiniz"* demiyor, somut sebebi söylüyor (`explainTamburScanBlock`). Zenginleştirme **yalnız gerçekten fırlatılacak dalda** koşar — `bypassPending` dolu olduğunda hata zaten yutuluyor ve sebep sorgusu bypass rejiminin EN SIK yolunda boşa koşardı.
> • **Migration YOK · izin YOK · APK ZORUNLU DEĞİL** (eski istemci yalnız `bypassPending.rolls` okuyor → yeni backend'le doğru çalışır; kaybedilen tek şey bilgi toast'ının ayrıntısı). **Backend + Electron aynı pencerede.** Bekçi: `scripts/test_kursun_unassigned_close.ts` (53 kontrol; **dört negatif sondayla** kırmızı verdiği doğrulandı — bayrak koşulu düşünce 4, marker ön ek uyumu kopunca 1, atıf uydurulunca 1; tx içi tazeleme sondası **yeşil kaldı ve bu bilinçli olarak yukarıda yazıldı**). `test_kursun_bypass.ts` 148/148 · `test_kursun_regime_lock.ts` 21/21 · `test_kursun_bulk.ts` 28/28 · `test_kursun_machine_order.ts` 12/12 korundu.

> ⚠️ **PROFİL GERÇEĞİ:** Tambur ekranı, "Son Çıkan Toplar" ve `mobile:tambur-duzelt` izni `production.enabled` yüzeyleridir; **`qtyOut=0` storno ≠ `qtyOut=qtyIn` dispozisyon**, "iptal edilen `clientToken` REPLAY EDİLEMEZ (409)", "barkod topun KİMLİĞİdir, koruma STATÜDEDİR" ve "alan eklemek yetmez, hangi YANITTA döndüğünü doğrula" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-05 — elle eklenen topu GERİ ALMA + topun izlenebilirlik yüzeyleri):** Saha yedi madde bildirdi; ikisi soruydu, beşi eksik. Çıkan ortak desen: *arka uç doğru, yüzey yok ya da yanlış yere bağlı.*
> • **GERİ ALMA — ikinci bir iptal motoru YAZILMADI.** Doğru semantik zaten `InventoryService.softDelete`'te yaşıyordu: `CANCELLED` + açık hareket **`qtyOut = 0`** ile kapanır ("mal bu istasyondan HİÇ geçmedi" = sektördeki *storno*). Bu, `rescueStuckRoll`/WO-kapanış dispozisyonunun **`qtyOut = qtyIn`** semantiğinden BİLİNÇLİ olarak farklıdır — orada mal gerçekten vardı ve çıktı, burada kayıt baştan hatalıydı; ikisi karıştırılırsa hiç var olmamış metraj istasyon iş hacmine yazılır. `TamburUndoService`'e **`MANUAL`** modu eklendi ve o motoru ÇAĞIRIR. Operatörün butonu zaten doğru yerdeydi ("Son Çıkan Toplar" satırındaki Geri Al) ve elle eklenen topta **görünüyor ama 400 veriyordu** — yani operatör "Geri Al" yazan modalda çıkmaza giriyordu. Yeni ekran/izin kodu doğmadı; undo route'ları `mobile:tambur-duzelt`'i de kabul ediyor (**karar: ekleyen kendisi geri alır** — yaratma ve iptal izinleri ayrı kümelerde kalsaydı hata yapan kişi vardiya ortasında birini beklerdi).
> • **Kapsam DAR ve blockReason ÇIKMAZ BIRAKMAZ:** yalnız elle eklenmiş + **hiç işlem görmemiş** top (kesilmemiş · `RollOperation` yok · tek hareket · çuval/sevkiyat yok). İhlalde mesaj *"süpervizöre başvurun"* der; sessiz 409, yanlış işlem yaptırmaktan sonra en kötüsüdür. Parti bağı iptalde **topta KALIR** (`softDelete` `batchId`'ye dokunmaz) — "hangi partiye yanlış top yazılmıştı" izi.
> • **`softDelete` artık hareket notunu EZMİYOR.** Eskiden `notes` körlemesine `"CANCELLED"` yazılıyordu ve elle eklemenin `TAMBUR_MANUAL_ROLL: <sebep>` izi siliniyordu; `entryReason` + audit kalsa da hareket geçmişi "bu top neden vardı" sorusunu cevaplayamaz oluyordu — tam da iptal edilmiş bir kaydı incelerken en gereken bilgi. Artık `CANCELLED (<eski not>)`.
> • **İptal edilmiş topun `clientToken`'ı REPLAY EDİLEMEZ** (409 `ENTRY_CANCELLED`). `produceFinishedRoll`'da bu dal yoktu: token tekrar gönderilince uç **`success: true` + iptal edilmiş topun barkodunu** dönüyordu — operatör "eklendi" görür, envanterde top YOKTUR. 409'dan kötüdür çünkü **sessizce yanlış** bir cevaptır. Mantıksal deneme iptalle KAPANIR; yeni top yeni token ister.
> • **BARKOD ERKEN DOĞMUYOR — sorun değil (soru cevaplandı).** Bu sistemde barkod "bitmiş ürün işareti" değil topun **kimliği**dir ve doğduğu an verilir; KK1 ham girişi de aynısını yapar (üstelik etiketi de bastırır, önünde tüm üretim varken). Erken barkodun sanılan riskleri (yanlışlıkla çuvala okutma / sevke girme) kodun her yerinde barkodun varlığıyla değil **STATÜ** ile kapatılmıştır (`IN_PRODUCTION` ∈ `NON_SACKABLE_STATUSES`). Barkod anlamını değiştirmeye kalkma; bu kural buraya yazıldı ki soru üçüncü kez sorulmasın.
> • **"Ekleme Nedeni" hiç çalışmamıştı** (regresyon DEĞİL): panel alanı **liste satırından** (`roll`) okuyordu, oysa `manualReason` **yalnız detay ucunda** döner. Özellik yazıldı, test edildi, commit edildi ve kullanıcıya **hiç ulaşmadı**. Ayrıca audit fallback'i `findFirst(orderBy: asc)` ile **en eski CREATE'i** seçiyordu — elle ekleme iki audit kaydı doğurur ve sebep İKİNCİDEDİR, yani fallback pratikte ölüydü. Ve kodun kendi yorumları üç dosyada *"şemada kolon değil, audit'ten okunur"* diyordu; **yanlış** (kolon `Roll.entryReason`, migration `20260804210000`). Ders: alanı eklemek yetmez, **hangi yanıtta döndüğünü** doğrula.
> • **"Kat" başlığı sıralanabilir görünüyordu ama `ROLL_SORTABLE_FIELDS`'te YOKTU** → tıklayınca sıralama olmuyor **ve** `query-parser` bilinmeyen alanı fallback'e düşürdüğü için sekmenin `updatedAt desc` varsayılanı sessizce `createdAt`'e kayıyordu ("Buraya geliş ≠ oluşturma" kuralının ihlali). `foldType` listeye eklendi. **İlişki üzerinden sıralama desteklenmiyor** — yeni "İstasyon" kolonuna bilerek `SortableHeader` KONMADI.
> • **Kat iki uçta da Zod'da YOKTU:** mobil "Manuel Mod" katı operatöre ZORUNLU soruyor ve gönderiyordu, `z.object` tanımadığı anahtarı **sessizce siliyordu** — operatör zorunlu alanı dolduruyor, veri hiçbir yere ulaşmıyordu. İki şemaya `foldTypeSchema` eklendi (kanonikleştirmeyi `.transform` kendisi yapar) ve "Manuel Top Ekle" de artık **kat soruyor** (kullanıcı kararı) — varsayılan ön seçim YOK, çünkü yanlış kat değeri boş değerden zararlıdır.
> • **Yeni izin `roll:history`** — top detayındaki **yaşam döngüsü** bölümü. Bölüm eskiden `RollOperation` okuyordu; o tablo bir yaşam döngüsü günlüğü DEĞİL, **istasyon işlem log'u**dur (5 enum + `workOrderStepId` NOT NULL) → depo/ham stok/elle eklenen/kesim-çocuğu toplarda **tanım gereği kalıcı boş** (ölçüm: 72 topun 45'i). Doğru veriyi üreten `GET /rolls/:id/history` **zaten vardı** ve mobil onu kullanıyordu; Electron hiç çağırmıyordu. **İzin yoksa bölüm HİÇ ÇİZİLMEZ** (boş kutu = "geçmiş yok" yalanı). ⚠️ Boot uzlaştırması izni DB'ye getirir ama **kullanıcılara atama elle yapılır**.
> • **İstasyon görünürlüğü:** liste yanıtı `currentStep → station` taşımıyordu, yani "Üretimde" sekmesinde kolon **yazılamazdı**. `ROLL_LIST_INCLUDE` + `findRollById` aynı şekli döner (ayrışırsa satır ile panel aynı top için farklı şey söyler). Filtre **istasyon KİMLİĞİ** (`currentStationId`) — mevcut `currentStepKind` TÜR sorar ve iki boyahaneyi tek seçenekte birleştirir; ikisi birlikte gelirse koşullar **birleştirilir**, üstüne yazılmaz.
> • **Arşiv → Sistem → Top Arşivi** (`/system/roll-archive`, `admin:settings`). Sekme **silinmedi taşındı**: o dört emekli statünün Electron'daki TEK liste yüzeyiydi ve bir kısmı barkodsuz olduğu için okutmayla da bulunamazdı — "zor bulunsun" ile "erişilemesin" farklı şeyler. `STATUS_GROUPS.ARCHIVE` anahtarı **duruyor** (yeni sayfa onu kullanır; silinirse tek kaynak kaybolur). ⚠️ Yan etki bilinçli: eskiden `roll:read` ile bakabilen depo/üretim personeli artık bakamaz.
> ⚠️ **2026-08-25'te GÜNCELLENDİ:** Arşiv artık DÖRT değil ALTI statü taşır — `CANCELLED` ve `SCRAP` eklendi (`Electron/src/pages/Operations/Rolls/service.ts`, `STATUS_GROUPS.ARCHIVE`); gerekçe ve sayfa araması için aşağıdaki 2026-08-25 ②b notuna bak.
> • Bekçi: `scripts/test_manual_roll_undo.ts` (24 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — not koruması kaldırılınca 1, MANUAL dalı kapatılınca çökerek exit 1, `ENTRY_CANCELLED` guard'ı kaldırılınca 2).

> ✅ **ÇEKİRDEK:** Giriş MOTORU (Roll doğuran servis + guard'lar) kapatılamaz çekirdektir — advisory kilit sırası, `clientEnteredAt` penceresi, `shouldReleaseInFlight` ve "5xx ulaşılamıyor DEĞİLDİR" her kurulumda geçerli. ⚠️ Değişebilen tek şey SUNUM: "KK1 istasyon ekranı" `production.enabled` altındadır, toptancı profilinde aynı motorun üstüne sade "Mal Girişi" ekranı gelir — bkz. MODUL-BAYRAK-TASARIM §4 karar #2, §12 kural 4.

> **NOT (2026-08-05 — KK1 mükerrer top koruması TAMAMLANDI: guard atomik + pencere OPERATÖRÜN saatiyle + "sunucu ölü" artık çevrimdışı):** 2026-08-03 vakası (sunucu restart → etiket çıkmadı → operatör defalarca bastı → N kopya) için kurulan iki hat **sahada çürütüldü**: tablette wifi kapatılıp aynı top peş peşe girildi, bağlantı gelince 46 ms içinde 5 kayıt yazıldı ve **bayrak AÇIK olmasına rağmen** hiçbiri 409 almadı. İki kök neden, ikisi de kapatıldı — migration `20260805090000_roll_client_entered_at`.
> • **Tuzak ATOMİK DEĞİLDİ (TOCTOU).** İkiz sorgusu tx DIŞINDA ve kilitsizdi (`prisma.roll.findFirst`), insert ayrı `$transaction`'daydı; mobil kuyruk ise bekleyenleri `Promise.all` ile **paralel** boşaltıyor ve KK1 mutation'ı `scope` taşımıyor → 5 sorgu da hiçbirinin commit'ini görmeden geçti. Commit'ler 7-17 ms arayla sıralıydı (barkod sayacı satır kilidi): **tx'ler sıralandı, guard sorguları sıralanmadı.** Artık sorgu tx içinde ve tx'in **İLK ifadesi** `pg_advisory_xact_lock(8021, hashtext(anahtar))`. ⚠️ **SIRA LOAD-BEARING**: kilit `findFirst`'ten ÖNCE (sonra alınırsa hiçbir şey kazanılmaz) ve `generateRollBarcode`'dan da ÖNCE (ters sıra ABBA deadlock + global sayaç kilidini guard boyunca tutmak). 2-argümanlı form bilinçli — 1-arg uzayı `session-registry`/`permission-management` ile paylaşılıyor ve KK1 anahtarı binlerce değer üretiyor. Saf parçalar `services/helpers/duplicate-guard.helper.ts`'te (kilit anahtarı Decimal'leri **DB hassasiyetine yuvarlar**; yuvarlamazsa `140.0001` ile `140.0004` ayrı kilit alır ve yarış tam da düzeltilen yerde açık kalır).
> • **Pencere SUNUCU saatiyle ölçülüyordu.** Offline kuyruk tek flush'ta boşaldığı için her kaydın `createdAt`'i milisaniyelerle ayrılır → **her flush DAİMA 90 sn penceresinin içindedir**. Guard atomik yapılsaydı bu kez tekstilde olağan olan "aynı partiden eşit metrajlı arka arkaya toplar" 409 fırtınası üretecekti. Yeni `Roll.clientEnteredAt` (nullable timestamptz) operatörün **bastığı anı** taşır; pencere iki yönlüdür (tek yönlü `gte` ile saati ileri kaymış cihazın satırları sonsuza dek ikiz görünürdü). Saat kayması ihmal edilebilir: guard zaten `createdById` **VE** `createdMachineId` eşitliği arıyor → iki damga **aynı cihazın aynı saatinden** gelir, sabit ofset farkta sadeleşir. Makul aralık dışı beyan (−36 sa / +5 dk) **saklanmaz** ve sunucu saatine düşülür — kolon doluysa "bu damgaya güvenildi" demektir. **400 DÖNMEZ**: bozuk RTC'li tablet üretimi durdurmamalı. **Index EKLENMEDİ** — çıpa `createdAt`'te kaldı (`duplicateGuardCreatedAtFloor`, sağlamlık ispatı orada); `rolls` zaten en çok indeksli tablo.
> • **İstemci: uçuş penceresi.** Yapışkan token yalnız `onError` sonrası kuruluyordu, o da `stationRetry` (4 deneme, ~5-47 sn) tükenince → kısa pm2 restart'ında her basış TAZE token alıyordu. Kural artık: **uçuşta AYNI yük → uçuştaki KİMLİĞİ (token + damga) yeniden kullan; FARKLI yük → yeni top.** Körü körüne collapse etmek 47 sn'lik pencerede sıradaki GERÇEK topu düşürürdü (eksik stok, kopyadan kötü). Parmak izi backend'in kimlik alanlarıdır; **kalite bilerek dışarıda** (iki basış arasında kalite düzeltilirse aynı top ikinci kez yazılırdı). Pencere `INFLIGHT_REUSE_WINDOW_MS = 90_000` — **backend penceresiyle bilerek AYNI**, iki katman aynı şeyi söylesin.
> • **B6 — "wifi var, sunucu ölü" artık ÇEVRİMDIŞI** (`offline/serverReachability.ts`). Eski tanım (`NetInfo.isConnected`) uygulamanın "online"ını *ağ linki var* diye kuruyordu; sunucu ölüyken istekler HTTP'ye çıkıp düşüyor, kuyruk hiç devreye girmiyordu. Sinyal artık **link AND erişilebilirlik**. Kanıt tabanlı: sağlıklı durumda ek istek YOK; hüküm gerçek bir isteğin **YANITSIZ** düşmesiyle verilir (`api.ts` interceptor'ı bildirir) ve ancak o zaman jitter'lı `/health` yoklaması başlar. ⚠️ **5xx "ulaşılamıyor" DEĞİLDİR** — sunucu cevap vermiştir; aksi hâlde tek bir hatalı uç tüm kuyruğu durdururdu.
>   - ⚠️⚠️ **B6 TEK BAŞINA YAPILSAYDI SAHA VAKASINI KUYRUK ÜZERİNDEN GERİ GETİRİRDİ**: sunucu ölüyken her panik basışı ayrı kayıt olarak kuyruğa girer, sunucu dönünce N kopya olarak akardı. Ayrım `shouldReleaseInFlight(reason)` ile **saf katmanda** yaşar (ekrandaki bir `if`'te kalsaydı tersine çevrilmesi hiçbir testi kırmazdı): **`'link'` → uçuş kimliğini BIRAK** (operatör çevrimdışı olduğunu biliyor, basışlar ayrı toplardır) · **`'server'` → KORU** (kesinti yeni fark ediliyor, basışlar panik olabilir). Koruma 90 sn ile sınırlı — 20 dakikalık kesintide sıradaki gerçek top yutulmaz.
> • **UI artık YALAN SÖYLEMİYOR.** `onMutate` koşulsuz yeşil "Top kaydedildi" basıyordu — operatörü tam da tekrar basmaya davet eden şey buydu. Online'da nötr "Kaydediliyor… bekle, tekrar basma"; yeşil `onSuccess`'e taşındı ve yalnız operatörün BEKLEDİĞİ deneme onaylanınca basılır. Kalıcı düşen kayıt ekrandan bağımsız bir `MutationCache` köprüsüyle yakalanır; bu delik `WORK_SESSION_REQUIRED` 409'unu da yutuyordu. ⚠️ Köprü `setMutationDefaults`'a **KONULAMAZ** — component `onError` onu EZER (query-core option sırası), kayıt "bazen" yakalanırdı. ⚠️ **KÖPRÜNÜN VARIŞ NOKTASI 2026-08-12'de DEĞİŞTİ**: kalıcı bir "ölü mektup kutusu" (`failedOps` + `OutboxModal`) yerine artık **anlık toast** (`offline/announceFailure.ts`) — bkz. aşağıdaki NOT. Buton **rengi sonucu söyler**: amber = yeni stok kaydı doğurur · marka = tekrar dener · mavi = yalnız kâğıt basar · kırmızı = kaydı yok eder.
> • **Bayrak panelden AÇILAMIYORDU** (`kk1DuplicateGuardEnabled` `feature-flag.routes.ts` `strictObject`'inde yoktu → PATCH 400). Asıl tehlike açamamak değil **KAPATAMAMAK**tı: yanlış pozitif dalgasında tek geri dönüş yolu odur. Üç-yer sözleşmesi artık mekanik (`scripts/test_feature_flag_contract.ts` — dört anahtar kümesi + körlük zemini + muaf bayatlığı); eski testler bayrağı servisten set ettiği için route'u hiç geçmiyordu, hata tam o boşluktan geçti.
> • Bekçiler (hepsi negatif sondayla kırmızı verdiği doğrulandı): `scripts/test_kk1_duplicate_guard.ts` (24 kontrol — 5 eşzamanlı birebir giriş → **1 geçer + 4×409**; kilit silinince 3 geçiyor) · `scripts/test_feature_flag_contract.ts` · mobil `entryAttempt` · `serverReachability` · `mutations` (kutu kaldırılınca `failedOps`/`OutboxModal` bekçileri `announceFailure` + `SyncStatusChip`'e devredildi). ⚠️ `test_kk1_duplicate_guard`'daki `Promise.allSettled` **MEŞRU** (perf kuralı 11 tek tx client'ı paylaşmaya ilişkindir; burada beş ayrı tx var) — "düzeltip" sıralı hale getirirsen bekçi sessizce ölür.

> ⚠️ **PROFİL GERÇEĞİ:** "ÖLÇEK TETİĞİ" maddesindeki rakamlar (87 giriş/30 gün, tek ham giriş istasyonu) bu fabrikanın hacmidir — başka kurulumda eşik ilk günden aşılabilir, o yüzden tetik kuralını (500+ giriş/gün ya da 4+ eşzamanlı istasyon → `pg_locks` ölçümü) kuruluma göre YENİDEN ölç. `readIdCondition`'sız elle id okuma → P2007, `kk1.historyAllEntriesEnabled` dört kapı ve `forcedCreatorFilter`'ın SAF katmanda olması ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-12 — GİRİŞ İZLENEBİLİRLİĞİ: "kim, nereden girdi" + kişiye özel listeler):** Ölçekleme sorusu ("yeni ham giriş istasyonları gelebilir, hangi personelin hangi kumaşı girdiği bulunmak istenir") üzerine kuruldu. **Veri modeli zaten hazırdı** (`createdById`/`createdMachineId`/`entryStationId` kolonlu + indeksli, `ROLL_LIST_INCLUDE` üçünü de taşıyor); eksik olan yalnız YÜZEYdi. ⚠️ **Elektron'daki mevcut iki filtreyle TEKRAR DEĞİL:** "İstasyon" = `currentStationId` (top ŞU AN nerede), "Giriş Kaynağı" = `entrySource` (girişin TÜRÜ); yeni eklenenler `createdById` (KİM) ve `entryStationId` (kalıcı köken — NEREDEN). Dördü farklı soru.
> • **İki hafif lookup ucu: `GET /rolls/entry-users` + `/rolls/entry-stations`** (`roll:read | MOBILE_ROLL_READ`) — kataloğu değil GERÇEK veriyi döner (top girmiş kullanıcı/istasyon; `groupBy` indeksli tekil kolonda). Gerekçe: kullanıcı listesi `admin:users` arkasında ve Rolls sayfası kullanıcılarının çoğunda o izin yok; ad zaten roll:read'in gördüğü satırlarda basılıyor — yeni bilgi sızmaz. ⚠️ Route'lar `/:id`'den ÖNCE (`/stats` emsali).
> • **Filtreler backend'de SIFIR işle çalıştı:** `createdById`/`entryStationId` generic `buildWhereClause` yolundan geçer (CSV→`in` otomatik). Bekçi `test_filter_multi_select` **§2b** bunu KİLİTLER: biri ileride bu anahtarları `buildRollWhere`'de elle okumaya başlar ve `readIdCondition`'ı atlarsa CSV uuid kolonuna ham gider (P2007). Canlı ölçüm: 100→2 satır, CSV 3 satır, lookup'lar 6 kullanıcı/1 istasyon döndü.
> • **Electron:** Rolls filtre şeridine "Ekleyen" + "Giriş İstasyonu" (multi-lookup, kaynak yeni uçlar) ve listeye "Giriş İstasyonu" kolonu (izlenebilirlik standardı gereği **varsayılan GİZLİ**, `initialVisibility`). ⚠️ `FilterBar` lookup varyantlarının `service` tipi `Pick<CrudService,"getAll">`e DARALTILDI — FilterBar yalnız onu çağırır; hafif lookup servisleri tam CrudService stub'u yazmak zorunda kalmaz. ⚠️ **Electron servis yolları TAM yazılır (`"/api/rolls/..."`)** — `apiClient.baseURL` `/api` İÇERMEZ (`createCrudService("/api/stations")` emsali); öneksiz yol 404 alır ve FilterBar hatayı yutup **"Sonuç yok."** gösterir (sahada yakalandı — filtre "boş" değil, istek yanlış kapıya gidiyordu). ⚠️ **"İstasyon" (currentStationId) filtresi base listeden çıkarıldı, yalnız Üretimde/Kurşun Bekleyen/Tambur Bekleyen sekmelerinde eklenir:** Ham Stok/Bitmiş Depo'daki toplar hiçbir istasyonda DURMAZ (currentStep yok) → filtre o sekmelerde daima boş liste döndürüp "bozuk" görünüyordu (2026-08-12 saha bulgusu). "Nereden girdi" sorusunun cevabı Giriş İstasyonu filtresidir.
> • **Yeni bayrak `kk1.historyAllEntriesEnabled` (varsayılan KAPALI) — dört kapı tam:** system-setting (SETTING_KEYS+interface+builder+update+read helper) · feature-flag.routes · Electron featureFlagService+settings-config ("KK1 / Kalite") · mobil featureFlag.service+useFeatureFlags. Bekçi `test_feature_flag_contract` 15/15.
> • **Mobil kapsam kuralları (saha kararı):** sağdaki **"Son Kayıtlar" HER ZAMAN kişiye özeldir** (`filter[createdById]=ben`, bayraktan bağımsız); **"Tüm Girişler"** bayrak KAPALIYKEN yalnız kendi kayıtları (başlıkta "· yalnız senin girişlerin" yazar — dar listeye bakan operatör "kayıtlar silinmiş" sanmasın) ve **Personel çipi HİÇ ÇİZİLMEZ** (ölü filtre "bastım, olmadı" üretir), AÇIKKEN herkes + Personel çipi. ⚠️ Zorlama **saf katmanda**: `rollHistoryFilter.forcedCreatorFilter` — ekrandaki bir `if`te yaşasaydı tersine çevrilmesi hiçbir testi kırmazdı; KK1 bunu filters'a **EN SON** yayar (çipten sızabilecek createdById'yi de ezer). Kimlik yüklenmemişse filtre üretilmez — boş string listeyi sessizce boşaltırdı. Bu bir YETKİ DUVARI DEĞİL ekran sadeleştirmesi (panel aynı veriyi görür); bayrak yüklenemezse DAR kapsama düşülür.
> • **Giriş istasyonu görünürlüğü:** mobil satırda operatör çipinin altına istasyon adı (veri varsa; 2026-08-05 öncesi toplar taşımaz → tek satır). "Giriş İstasyonu" filtre çipi mobilde **yalnız 2+ istasyon varken** belirir — tek istasyonda ayırt edeceği şey yok, seçenek listesi veriden geldiği için ikinci istasyon açıldığı gün kendiliğinden doğar.
> • **"Bu oturum" kovası artık İSTASYON KİMLİĞİ taşır** (`sessionBucketKey(kind, stationId)`): ikinci ham giriş istasyonu açıldığında iki istasyonun oturum listeleri karışmaz; stationId yokken tür tek başına (bugünkü davranışla birebir). Store persist edilmediği için göç yok.
> • **ÖLÇEK TETİĞİ (E, yazılı karar):** barkod sayacı advisory-lock ile serileşiyor ve tüm istasyonlar aynı günlük sayacı paylaşıyor — bugünkü hacimde (87 giriş/30 gün) sorun değil. **Günde 500+ giriş YA DA 4+ eşzamanlı ham giriş istasyonu** görüldüğünde kilit bekleme süresi ölçülmeli (`pg_locks` + giriş ucu latency'si) ve `/rolls` liste sorgusu EXPLAIN'lenmeli; o güne kadar ölçüm ekleme.
> • **Deploy: backend + Electron + APK aynı pencerede.** Migration YOK, yeni izin YOK. Eski APK + yeni backend zararsız (bayrağı görmez, eski davranış); yeni APK + eski backend → lookup 404 (çip seçeneksiz) + Son Kayıtlar filtresiz — kabul edilemez. Bekçiler: `test_filter_multi_select` 37/37 (§2b) · `test_feature_flag_contract` 15/15 · mobil `rollHistoryFilter.test` (+7, kapsam kuralı körleştirilince kırmızı verdiği doğrulandı) · `sessionEntriesStore.test` (+2). Tablette uçtan uca doğrulandı: bayrak kapalı → "yalnız senin girişlerin" + çip yok; bayrak açık → 36→47 kayıt + Personel çipi süzüyor (Eda→0).

> ⚠️ **PROFİL GERÇEĞİ:** "KK1 ve Tambur ekranları" `production.enabled` yüzeyleridir; toptancı/dokuma profilinde aynı bileşen başka ekran çiftine bağlanır. Taşınabilir çekirdek: **süzme SUNUCUDA** (cursor'lu listede istemci süzmesi yanlış "kayıt yok" üretir), `dateField` gönderilmezse aralık SESSİZCE yok sayılır, `last7` bugünü içerir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-12 — TOP LİSTESİ FİLTRESİ: zaman + kumaş, KK1 ile Tambur ORTAK):** Saha isteği: *"tüm girişler modalında zamana ve kumaşa göre arama yapabilelim, kısa tuşlar da olsun, sade UI, filtre backend'den gelsin."* İki modal da kapsandı (kullanıcı kararı): **KK1 → "Tüm Girişler"** (hiç filtresi yoktu) ve **Tambur → "Son Çıkan Toplar"** (arama vardı, tarih/kumaş yoktu).
> • **TEK BİLEŞEN, İKİ EKRAN:** `components/filters/RollFilterBar.tsx` (şerit) + `DateRangeSheet.tsx` (takvim) + **saf katman `rollHistoryFilter.ts`** (kısa yol → aralık çevirimi, sorgu parametresi üretimi, query anahtarı). Ayrı yazılsalardı "aynı düğme iki listede farklı aralık" kaçınılmazdı. Şerit: `Tümü · Bugün · Dün · Son 7 gün · Tarih seç · Kumaş (+ Temizle)`.
> • ⚠️ **SÜZME SUNUCUDA, İSTEMCİDE DEĞİL.** Listeler cursor'lu sonsuz kaydırma: istemcide süzmek yalnız O ANKİ SAYFAYI süzer ve operatör "kayıt yok" sanar — oysa kayıt bir sonraki sayfadadır. Doğrulandı: kumaş seçilince toplam sayaç da düşüyor (33 → 11).
> • ⚠️ **`dateField` GÖNDERİLMEK ZORUNDA.** `applyDateRange` alan adı yoksa aralığı **sessizce yok sayar** (`if (!params.dateField || !allowed.includes(...)) return`) — filtre seçili görünür, liste süzülmez. Bekçide kilitli.
> • **Backend zaten hazırdı, tek eksik kumaştı:** `/rolls` (KK1) `filter[itemId]` + `dateField/dateFrom/dateTo` destekliyordu; `/tambur/recent-output-rolls` tarihi destekliyor ama **`itemId` YOKTU** → eklendi (Zod `.uuid()` ile; ham CSV/serbest metin P2007 → 400 üretirdi). Yeni migration/izin YOK.
> • ⚠️ **YENİ PAKET EKLENMEDİ** — tarih seçici kütüphanesi yok ve eklemek riskli (`expo-audio` peer'ı bir kez `expo-asset`i köke çekip APK'yı açılışta çökertmişti). Takvim ızgarası elle yazıldı, sıfır bağımlılık.
> • **Sözleşme ayrıntıları:** `last7` **BUGÜNÜ İÇERİR** (bugün girilen topu düşürmek filtreyi "bozuk" gösterir) · özel aralık kısa yolu **EZER** (iki aralık aynı anda iddia edilmez) · query anahtarı `itemLabel`den ve `now`dan **bağımsızdır** (ad düzeltmesi ya da her render yeniden çekmesin) · gün sınırı **cihazın yerel günü**dür ve backend onu mutlak an olarak alır (Electron `useReportDateRange` ile aynı sözleşme) · **filtre yoksa tek parametre üretilmez** (mevcut istek bayt bayt korunur) · Tambur'da modal kapanınca filtre **sıfırlanır** (dün "Bugün" seçip kapatan operatör ertesi gün boş liste bulmasın).
> • **GÖRSEL (aynı gün, saha geri bildirimi):** ① **Seçici çipleri ayrıştı** — "Tarih seç" / "Kumaş Seç" beyaz zemin + kalın koyu kenarlık + sağda **▾** taşır; kısa yollar (Bugün/Dün/…) eski açık-gri hâlinde kaldı. Gerekçe: biri tek dokunuşta SONUÇ verir, diğeri bir EKRAN AÇAR; aynı görünürlerse operatör "bastım, bir şey olmadı" der. Aktif hâl ikisinde de dolu mavi (filtre uygulanıyor mesajı türden bağımsız). ② **Liste satırının kırpılan gölgesi:** satır `Surface elevation={1}` ile çiziliyordu; Android'de elevation gölgeyi kartın DIŞINA taşırır ve satır tam genişlikte olduğu için gölgenin sol/sağ ucu liste sınırında kesiliyor, ekranda "yarıda kesilmiş çerçeve" olarak görünüyordu. `elevation={0}` + **kenarlık** (`borderWidth:1 #e2e8f0`) + listeye 2px yatay nefes payı. Kenarlık kırpılmaz ve kartın sınırını daha net gösterir — yeni bir liste kartı yazarken gölge yerine kenarlık tercih et.
> • **AŞIM KESİMİ 0'DA TIKANIYORDU (2026-08-12 saha vakası, düzeltildi):** 500 m kayıtlı kumaş fiziksel 550 m çıkabilir ve fazlalık TEK kesimde bitmeyebilir (50 m → 3 top). `tambur.overQuantityEnabled` açıkken İLK aşım kesimi kalanı 0'a çekiyor; iki aşım dalının claim'i `currentQty: { gt: 0 }` şartı taşıdığı için 0'a inmiş topta İKİNCİ kesim **P2025'e düşüp "bu sırada değişti" YARIŞ mesajı** basıyordu — oysa yarış yok, mal fiziksel elde. Şart iki daldan da (cutOpenFabric + cutWarehouseRoll) kaldırıldı: **çifte-harcama koruması 0'ın altında anlamsızdır** (inilecek gerçek stok yok); her sıfır-üstü kesim çocuk + **sapma defteri** satırı üretir (iz kaybolmaz), KK2-reopen/statü/çuval guard'ları AYNEN durur. Normal dalın `gte` guard'ına DOKUNULMADI. Bekçi: `test_tambur_over_quantity` 10→13 (0'da 2. ve 3. kesim + her birinin sapma satırı; `gt:0` geri konunca 409'la çöktüğü doğrulandı). Backend-only — APK gerekmez.
> • **TAMBUR "SON ÇIKAN" FİLTRELERİ (2026-08-12 akşam, saha isteği):** Liste TÜM makinelerin kesimlerini gösterir (varsayılan bilinçli korundu) + üç yeni süzgeç: **"Bu makine"** tek-dokunuş tuşu (oturumun makinesi; makinesiz oturumda çizilmez) · **Personel** çipi (entry-users lookup'ı, 2+ seçenek varsa) · şerit hizası arama kutusuyla eşitlendi (searchRow'un 12px iç boşluğu şeride de verildi — `RollFilterBar` artık `style` ve `extraChips` prop'ları alıyor; ekran-özel tuşlar ayrı satır açmadan şeride girer). Backend: `recent-output-rolls`e `createdMachineId` + `createdById` (Zod `.uuid()`).
> • ⚠️ **KESİM ÇOCUKLARI MAKİNE DAMGASI ALMIYORDU** (bulgu filtreyi denerken çıktı): dört TAMBUR_SPLIT doğum yolu `createdById` yazıyor ama `createdMachineId` YAZMIYORDU → "Bu makine" süzgeci kesimleri hiç göremiyor, yalnız TAMBUR_MANUEL kayıtları buluyordu. Dördü de damgalandı (cutWarehouseRoll · finalizeWarehouseCut · cutOpenFabric · finalizeOpenFabric — sonuncusu zaten `machineId` parametresi alıyordu, yalnız doğuma yazılmıyordu; controller'lar `stamp?.machineId ?? req.device?.machineId` geçirir). **Eski kesimler geriye doldurulmadı** (emsal: entryStationId kararı) — süzgeçte görünmezler, bu dürüst. Bekçi: `test_tambur_cut_idempotency` +1 kontrol (damga) · `test_tambur_recent_output_filter` +2 (makine/personel süzgeci).
> • **YAN DÜZELTME — MANUEL GİRİŞTE NUMPAD ÖLÜ KALIYORDU (aynı gün, saha isteği):** `NumpadHost` `disabled = !target` ile çalışıyor ve KK1'de **metraj alanı hedefi hiç almıyordu** (`autoActivate` yalnız EN'de vardı) → manuel giriş açıkken tuşlar GRİ ve tıklanamaz; operatör önce metraj kutusuna dokunmak zorundaydı. EN girişi bayrakla kapalıysa ekranda hedef alacak başka alan da yok, yani numpad **tamamen** ölüydü. Düzeltme: metraj `autoActivate={!compact && manualMode}`, EN `autoActivate={!compact && !manualMode}`. ⚠️ **İkisini birden `autoActivate` yapma** — kazananı MOUNT SIRASI belirlerdi (EN sonra mount olduğu için o kazanır) ve operatör metraj beklerken tuşlar sessizce EN'i değiştirirdi. Ayrıca hedef bir şekilde boşalırsa (bugün `closeTarget`ı kimse çağırmıyor; tek satırlık bir değişiklik bunu bozabilir) manuel modda metraja **geri dönen** bir effect var — numpad bir daha ölü kalmasın. Tablette doğrulandı: kutuya hiç dokunmadan tuşlara basıldı, metraj yazdı; desen seçici açılıp kapandıktan sonra da yazmaya devam etti.
> • Bekçiler: mobil `rollHistoryFilter.test.ts` (16 kontrol) · backend `test_tambur_recent_output_filter.ts` (7 → 10; kumaş filtresi körleştirilince **2 kırmızı** verdiği doğrulandı). Backend ayrıca canlı veriyle sondalandı (filtresiz 24 → kumaşla 13, hepsi doğru kumaş). **Migration YOK · izin YOK; backend + APK aynı pencerede** (eski backend + yeni APK = Tambur'da kumaş filtresi sessizce yok sayılır).

> ⚠️ **PROFİL GERÇEĞİ:** "Kat" alanı ve Tambur kesim yolu `production.enabled`/`kumasTeknik.enabled` bağlamıdır; **"gövdeyi elle kuran her katman sessiz bir allowlist'tir"** (Zod dersinin istemci ikizi), "etikete katalog KODU basılır, ad değil" ve `present:false` sözleşmesi ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-13 — KESİMDE KAT SESSİZCE DÜŞÜYORDU: mutationFn gövdesi alanı geçirmiyordu):** Saha: *"kat sayısı 6 yaptım ve kaydettim, Electron'da göremedim."* Teşhis üç katmandı ve ikisi tuzaktı: ① Electron tarafı SAĞLAMDI (Kat kolonu listede varsayılan görünür + detay paneli basar) — görünmeyen şey hiç YAZILMAMIŞ değerdi; ② backend SAĞLAMDI (servis + HTTP uçtan uca `TUP`/`2-KAT` yazdı, canlı ölçüldü); ③ asıl hata MOBİLDE: `cutOpenFabricMutation.mutationFn` istek gövdesini ELLE kurarken `foldType`'ı geçirmiyordu — ekran gönderiyor (satır ~1647), tipin alanı var (~1074), gövde düşürüyor (~1082). **2026-08-05 "Zod sessizce siliyordu" dersinin istemci-tarafı ikizi: gövdeyi elle kuran her katman, tıpkı `z.object` gibi, sessiz bir allowlist'tir.** Tanı yöntemi de kayda değer: aynı isteği (a) servis katmanından (b) HTTP'den (c) tabletten atınca yalnız (c) NULL yazdı → fark istemcideydi. `finalizeOpenFabric` yolu SAĞLAMDI (offline `mutations.ts` gövdesinde alan + "bu satır unutulursa" uyarısı zaten vardı — aynı uyarı kesim yolunda yoktu). Depo kesimi (`cutWarehouseRoll`) mobilde kat SORMAZ ve bu bilinçli: alan gönderilmeyince backend parent katını miras uygular (yeniden-kesimde doğru varsayılan).
> • **DEVAMI (2026-08-13, aynı gün): KAT artık PANELDEN DÜZELTİLİR + ETİKETE BASILIR.** İki saha isteği: *"düzelt diyaloğuna kat alanını ekle"* ve *"etiketlerde de kat tipi ekleyebilelim"*.
>   - **Düzelt (`applyManualProperties`):** `foldType` alanı eklendi — üçlü sözleşme (`undefined` DOKUNMA · `null` TEMİZLE · kod YAZ) `foldTypeSchema` ile birebir. ⚠️ **Kanoniklik burada da `resolveFoldTypeForWrite`'tan geçer**, elle karşılaştırma yapma: ham "6 kat" kaydedilirse envanterin kat filtresi o topu **bulamaz ve hata/log çıkmaz**. ⚠️ **Kat, yukarıdaki "CHOICE satırları bu uçtan yönetilmez" (F1) kuralının İSTİSNASIDIR** çünkü pivotta değil `Roll.foldType` KOLONUNDA yaşar — Düzelt'teki salt-okunur GRAMAJ çipiyle karıştırma. Kat değişimi **`labelDirty`** işaretler (kat artık kâğıda basılıyor); aynı değer tekrar yazılırsa tetiklenmez. `relabel-context` katı döner, audit `oldData/newData`'ya girer (kanonik değerle).
>   - **Etiket:** `label-fields.ts` **ROLL_RAW + ROLL_FINISHED**'e `foldType` ("Kat") eklendi → Etiket Stüdyosu paleti backend katalogundan beslendiği için **Electron'da ek kod gerekmedi**. `LabelPayload.foldType` + `label-field-values.ts` case'i (HTML/PPLA/PPLB/ZPL **ortak** tek eşleme noktası — yeni emitter yazarken oradan geç). ⚠️ **Etikete katalog KODU basılır** ("6-KAT"), görünen ad DEĞİL: kod topun kimliğidir, ad panelden değişirse geçmiş baskılarla ayrışırdı; ayrıca ada çevirmek her etikete DB okuması eklerdi. Kat girilmemiş topta `present:false` → **şablonda alan dursa bile baskıda atlanır** (`sackNote` emsali), yani kanvas modelinde sürüklenmemişse hiç basılmaz — eski şablonlar bayt-bayt korunur. **ÇUVAL etiketinde YOK** (karışık içerik → tek kat sessizce yanlış olur; ürün/renk alanının olmama gerekçesiyle aynı).
>   - Migration YOK · izin YOK · APK YOK — **backend + Electron aynı pencerede**. Bekçi: `scripts/test_fold_edit_and_label.ts` (16 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — kanoniklik körleşince 4, `labelDirty` bağı kopunca 1, değer haritası silinince 2).
>   - ⚠️ **İKİ BEKÇİ FABRİKA VERİSİ DEV'E ÇEKİLİNCE ÇÖKTÜ — ikisi de bekçi kusuruydu, kod değil** (teşhis yöntemi: şablonu pasifleştirip testi tekrar koş; geçiyorsa hata VERİDEN doğuyor demektir): ① `test_fold_catalog` sondasını sabit `"6-KAT"` koduyla kuruyordu ve fabrika kataloğuna gerçekten 6-KAT eklendiği gün "bu değer katalogda YOK" varsayımını kaybedip **P2002 ile çöktü** — ölçtüğü kural doğru çalışırken. Kural: *"bu değer katalogda yok" diyen bir sonda, kataloğa eklenebilecek GERÇEK bir kodu kullanamaz* (artık `${PROBE}-KAT`). ② `test_label_canvas_equivalence` native çıktıyı **her dilde `asciiFold` ile** arıyordu; oysa **PPLB bilinçli olarak `cleanCtlCp1254` kullanır** (EPL2 header'ı `I8,E` → yazıcı GERÇEK Türkçe basar, "Şube"→"Þube" baytı). Fabrikanın çuval şablonu dev'e gelince Türkçe değerli iki alan (`branchName`, `sackNote`) ilk kez PPLB'den geçti ve bekçi "veri düştü" diye **sahte kırmızı** verdi. Beklenti artık emitter'ın kendi dönüşümüyle kurulur — yoksa Türkçe içeren HER yeni alan aynı yanlış alarmı üretir.
> • **İkinci bulgu — katalog kimliği:** kullanıcı "6 Kat" eklemek isterken panelden **`TUP` satırını yeniden adlandırmıştı** (kod TUP, ad "6 Kat") — kod KİMLİKTİR; tablet 6 Kat tuşuyla `TUP` gönderecek, filtre/metre eşleşmesi sessizce şaşacaktı. Düzeltme: TUP adı "Tüp"e geri döndü (sortOrder 50), **gerçek `6-KAT` değeri eklendi** (sortOrder 30). Ders: katalog UI'sinde ad değişikliği ile yeni değer ekleme ayrımı kullanıcıya net değil — değer YENİDEN ADLANDIRILIRKEN kodun değişmediğini söyleyen bir ipucu düşünülebilir.
> • Migration YOK · izin YOK · **yalnız yeni APK** (backend/Electron değişmedi). Deneme kesimleri (F0005-F0007) tekil geri almayla temizlendi; kullanıcının NULL katlı eski topları (F0001-F0004, F0008) geriye doldurulmadı — istenirse Electron "Düzelt" ile kat yazılabilir.

> ⚠️ **PROFİL GERÇEĞİ:** Tambur geri-alma modları ve modal metinleri `production.enabled` yüzeyidir; **"restore-toplamına giren HER kaynak `applyFull` terslemesine de eklenir, yoksa çift sayım"** senkron sözleşmesi ve **"genel 'stoktan kaldır' tuşu bilinçli RED — sebebi söyleyen TİPLİ olay yazılır"** kuralı ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-12 gece — TEKİL CANLANDIRMA (`SINGLE_RESTORE`) + F0402 sıfır-çocuk düzeltmesi + geri alma modalı sadeleşti):** Saha sorusu iki aşamada geldi: *"modal çok kalabalık, bu topu iptal et / sadece bu topu iş emrine geri al tuşu koy — diğer topları canlandırmak zorunluluk mu?"* ve *"iş emri bitmiş TEK topu canlandırmak mümkün değil o zaman?"* İkincisi gerçek bir boşluktu: kaynak arşivdeyken tekil geri alma yalnız **kayıt düzeltmesi** yazabiliyordu (metraj kaybolur, iş emri kapalı kalır) — "kumaş elimde, kaydı yanlış" gerçeğinin YOLU YOKTU; tek çıkış FULL'dü ve o kardeşleri de iptal ediyordu.
> • **Yeni mod `SINGLE_RESTORE` ("İş Emrine Geri Al")** = FULL'ün dirilme makinesi, TEK topun metrajıyla: çocuk iptal, metrajı kaynak topa geri konur, kaynak Tambur adımına (depo kesiminde kapanış-öncesi rafına) dirilir, kapalı iş emri + refakat kartı yeniden açılır, **kardeşlere dokunulmaz**. Ek izin/sebep İSTEMEZ (operatörün günlük düzeltmesi; FULL'ün `roll:manual-adjust` kapısı "geçmişi toptan yeniden yazma" içindi ve DURUYOR). FULL'den üç bilinçli fark: kapanışın sapma satırları TERSLENMEZ (kalan-metraj kararı ayakta) · `RollError` yeniden açılmaz · `TAMBUR_PROCESSED` izi yine silinir (iş yeniden açık; iz kalsa rapor çift sayardı). Aynı-gün ayarı (`tamburUndoFullSameDayOnly`) BUNA UYGULANMAZ — ayar adıyla FULL'ü kapılar.
> • ⚠️ **Metraj geri koyma İKİ DALDA FARKLI — `applySingle`ın canlı-kaynak dallarının aynası:** üretim akışı yalnız `currentQty` geri koyar (kesim yalnız onu düşmüştü, aşımda `initialQty` bump + `TAMBUR_UNDO_RESTORE` kaynaklı OVERAGE satırı); depo kesimi **ikisini birden** geri koyar (`cutWarehouseRoll` ikisini birden düşer — tek taraf yazılsaydı sahte AŞIM doğardı).
> • **F0402 çıkmazı kapandı:** tüm çocukları TEK TEK iptal edilmiş kapanışta FULL "iptal edilebilir çocuğu kalmamış" ile reddediyordu ve tekil iptallerin sapmaya yazdığı metraj (saha: 208 m) sonsuza dek kayıptı. `computeRestoredQty` artık **çocuk-kapsamlı `TAMBUR_UNDO_SINGLE` düzeltmelerini de sayar** (satırlar ÇOCUĞUN rollId'sinde — `roll: { parentRollId }` ile bulunur) ve sıfır-çocuk + `restored > 0` durumunda FULL çalışır. ⚠️ **SENKRON SÖZLEŞMESİ:** restore-toplamına giren HER kaynak `applyFull` 5b terslemesine de eklenir — yoksa metraj geri konur, sapma satırı canlı kalır, dönem raporu aynı metrajı İKİ KEZ görür (bekçide kilitli).
> • **Modal tek-eylem/iki-kart kurgusuna indi + METİN SETİ (kullanıcı kararı):** tuş yaptığı işin adını taşır — **Kesimi Geri Al** (canlı kaynak) · **Topu İptal Et** (arşiv, kayıt düzeltmesi) · **İş Emrine Geri Al** (canlandırma) · **Tümden Geri Al** · **Kaydı İptal Et** (manuel). Arşivli kaynakta iki tekil yol **seçim kartı** olarak çıkar, **ön seçim YOKTUR** (hangi gerçeğin doğru olduğunu yalnız operatör bilir; seçilmeden onay kapalı — "Önce seçim yapın"). "Tüm işlemi geri al (N top)" düz metin bağlantıdan **çerçeveli butona** çevrildi (saha: "tıklanabilir hissi vermiyor"); yetkisizde de görünür, engel sebebi o görünümde söylenir (kullanıcı kararı: gizleme). SINGLE görünümünde ayrı "Kaynak top"/"İptal edilecek parçalar" blokları BASILMAZ (tek kayıt zaten açıklama cümlesinde barkod+metrajla adlı — yıkıcı-işlem kuralı böyle sağlanır); backend'in arşiv uyarısı da düşürüldü (`warnings[]` yalnız description'da OLMAYAN bilgiyi taşır).
> • **Genel "X / stoktan kaldır" tuşu BİLİNÇLİ REDDEDİLDİ** (kullanıcı onayı): sektör standardında stok kaydı silinmez, sebebi söyleyen TİPLİ olay yazılır (storno / sayım farkı / fire / tersleme) ve buton o olayın adını taşır; genel X bu ayrımı yutar, üstelik "neden" sormak zorunda kalıp aynı menüye dönüşür. Mevcut istasyon-bazlı tipli çıkışlar (Depo "Stoktan Kaldır" · KK1 iptal · Tambur modalı · WO kapanış dispozisyonu) yeterli — eksik olan adlandırmaydı, o da düzeltildi.
> • **Yan düzeltme:** "Bu işten çıkanlar" paneli yeni-en-üstte sıralı ama ScrollView piksel ofsetini koruyordu — operatör aşağı kaydırdıysa yeni kesim görünmeden ekleniyordu; en üstteki topun KİMLİĞİ değişince liste başa döner (sabit aralıklı refetch'te kimlik değişmez, kaydırılan yer durur).
> • **Migration YOK · izin YOK · backend + APK aynı pencerede** (eski APK yeni modu göndermez → `defaultMode=SINGLE`'a düşer, bugünkü davranış; yeni APK + eski backend → `SINGLE_RESTORE` Zod'da yok, 400). Bekçi: `test_tambur_undo` 36 → **53 kontrol** (§9 canlandırma + §10 F0402; **üç negatif sondayla** kırmızı verdiği doğrulandı — tekil-kayıp sayımı körelince 2, çocuk-kapsamlı tersleme koparılınca 1, canlandırma kardeşleri iptal eder hâle getirilince 1).

> ⚠️ **PROFİL GERÇEĞİ:** "KK1'de tek kırmızı yüzey" ve yazıcı kuyruğu kararları bu kurulumun saha ergonomisidir; **"toast 'kayıt oluşmadı' DİYEMEZ — timeout ≠ yazılmadı"**, "çakışma 409'unun TEK yüzeyi modaldır" ve "köprü `setMutationDefaults`'a taşınamaz" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-12 — KAYIT KUYRUĞU KALDIRILDI: kalıcı düşüş artık DUYURULUR, saklanmaz + KK1'de tek kırmızı yüzey):** Saha gözlemi: KK1 header'ında aynı anda **iki kırmızı çip** ("4 KAYIT GİTMEDİ" + "3 ETİKET HATALI") ve altta **üçüncü bir kırmızı bant** duruyordu; operatörden üçünü ayırt etmesi bekleniyordu ve ikisi aynı şeyi söylüyordu. Kullanıcı kararı: *"backende istek gitmediyse o an sadece hata versin, bir yere yazmaya gerek yok."*
> • **ÖLÜ MEKTUP KUTUSU (`offline/failedOps.ts` + `components/outbox/OutboxModal.tsx` + `offline/retryFailedOp.ts`) SİLİNDİ.** Kök kusur *karışıklık değil YANLIŞLIK*tı: kutu iki bambaşka olayı tek başlıkta topluyordu — (a) istek **ULAŞMADI** (ağ/timeout) · (b) istek **ULAŞTI, sunucu 409 ile SORU SORDU** ("bu top az önce girilmiş olabilir") — ve başlık ikisine birden *"bilgisayara ULAŞMADI — sistemde kaydı YOK"* diyordu. (b) için bu yanlıştır ve operatörü ağ aramaya yönlendirir. Üstelik KK1'de aynı 409 **hem modal hem kutu satırı** doğuruyordu (çift muhasebe); modal cevapsız kapatılırsa satır kutuda çürüyordu (sahada gözlendi: 4 satır, 1 saatlik, ilgili toplar zaten sistemdeydi).
> • **YERİNE `offline/announceFailure.ts`:** `MutationCache.onError` köprüsü KALDI (observer'sız/restore edilmiş mutation'ları da kapsayan tek nokta — `setMutationDefaults`'a taşınamaz, component `onError` onu EZER), yalnız **varış noktası** değişti: kalıcı düşüş **anlık toast** basar ve hiçbir yere yazılmaz. Kayıp riski üç mevcut mekanizmayla karşılanır: KK1 online-only rejimi (çevrimdışıyken kayıt hiç denenmez) · sunucudaki **atomik mükerrer tuzağı** (belirsiz timeout sonrası yeniden giriş yakalanır) · yazıcı kuyruğu ("top KAYITLI, etiketi çıkmadı" ayrı ve kalıcı yüzey).
> • ⚠️ **ÇAKIŞMA 409'LARI TOAST BASMAZ** (`POSSIBLE_DUPLICATE` / `CLIENT_TOKEN_COLLISION`): onların TEK yüzeyi ekranın kendi modalıdır. Toast basmak aynı kararı ikinci kez, üstelik **cevaplanamaz** biçimde sordururdu — kutu döneminin asıl hatası buydu. Muafiyet listesi bilinçli DAR: `WORK_SESSION_REQUIRED` gibi çakışma-dışı 409'lar duyurulur (eskiden TAM SESSİZ kaybolan sınıf).
> • ⚠️ **TOAST "KAYIT OLUŞMADI" DEMEZ, DİYEMEZ.** Zaman aşımında sunucu COMMIT etmiş olabilir (*timeout "yazılmadı" demek DEĞİLDİR*); kesin yokluk iddiası, gerçekten yazılmış bir topu operatöre ikinci kez girdirirdi. Metin önce DOĞRULATIR: *"… · Listede yoksa tekrar girin."*
> • **KK1'DE TEK KIRMIZI YÜZEY:** header'daki **"N ETİKET HATALI"** çipi kaldırıldı, tek işi olan detay listesi **footer bandına** bağlandı (banda dokun → yazıcı kuyruğu; "Tekrar Bas" dışarıda kalır, %90 durumda istenen odur). Çipin **basım** göstergesi KALDI — anlıktır, nötr renktir ve "şu an bir şey oluyor" bilgisini başka hiçbir yüzey vermez. **Yazıcı kuyruğunun kendisi KALDI** (kaldırma önerilmedi): 07.08 vakasının panzehiri odur, "top KAYITLI, yeniden girme" der.
> • ⚠️ **İÇE AKTARMA DÖNGÜSÜ:** etiket sözlüğü `offline/stationLabels.ts`e taşındı çünkü `mutations.ts` → `queryClient.ts` import ediyor ve toast etiketi `queryClient`ten okunuyor; `mutations.ts` ikisini de **re-export** eder (çağrı yerleri değişmedi). Yeni `STATION_MUT` anahtarı eklerken etiketi oraya da yaz (bekçi: `mutations.test.ts`).
> • ⚠️ **AYNI GÜN BULUNAN KALICI KİLİTLENME (aynı pakette düzeltildi):** API kapatılıp geri açılınca uygulama ASLA çevrimiçiye dönmüyordu (yeniden başlatmak gerekiyordu). İki parça birlikte kilit üretiyordu: ① `serverReachability.healthUrl()` **DERLEME ZAMANI** `API_URL` sabitini yokluyordu, oysa gerçek istekler operatörün Ayarlar'dan girdiği adrese gidiyor (`api.ts` → `getCurrentBaseUrl()`) → yoklama **başka bir sunucuyu** soruyor ve adres düzeltilse bile asla tutmuyor; ② çevrimdışıyken TanStack Query sorguları duraklattığı için **hiçbir gerçek istek çıkmıyor** → `reportServerReachable`ın tek tetikleyicisi yoklama kalıyor. Yani ① kırılınca çıkış yolu YOK. Düzeltme: yoklama adresi **her çağrıda canlı okunur** · `revalidateServer()` (elle "Şimdi dene", çevrimdışı bandında) · **adres değişince otomatik yeniden değerlendirme** (`useBaseUrlStore.subscribe` — abonelik BU YÖNDE, tersi içe aktarma döngüsü olurdu) · backoff tavanı **30 → 10 sn** (yoklama zaten yalnız kesinti sürerken koşar, sağlıklı durumda tek ek istek bile atılmaz). Bekçi: `serverReachability.test.ts` (+5 kontrol; asıl hata geri konunca 2 kırmızı verdiği doğrulandı). Sahada doğrulandı: backend düşürüldü → kilitlendi → backend geri kaldırıldı → **tablete dokunmadan** çevrimiçiye döndü.
> • **Migration YOK · izin YOK · backend DEĞİŞMEDİ — saf mobil; YENİ APK ister.** Diskteki eski `TEKSERP_FAILED_OPS_V1` anahtarı okuyansız kalır (birkaç KB, `PERSIST_BUSTER` bump'ı **YAPILMADI** — o, kuyrukta bekleyen saha kayıtlarını silerdi). Bekçiler: `announceFailure.test.ts` (12 kontrol) · `SyncStatusChip.test.ts` (5) · `mutations.test.ts` köprü bloğu — **dört negatif sondayla** kırmızı verdiği doğrulandı (çakışma muafiyeti kalkınca 2, metin kesinleşince 1, kutu metni sunucu dalına sızınca 2, rozet dokunulabilir olunca 1). ⚠️ Sonda dersi: ilk yazımda rozet bekçisi **KÖR**dü — `setOnline(false)` yalnız *link* dalını çalıştırıyor, *sunucu* dalına sızan metin görülmüyordu; `reportServerUnreachable()` ile o dal da kurulmalı. `queryByRole('button')` de yetmez (sarmalayıcı `Animated.View`da rol yakalanmıyor) → basılabilir düğüm sayısına bakılır.

> ✅ **ÇEKİRDEK:** "Giriş noktası = en erken hareketin adım sırası", "çözülemezse bekleyen say (erken COMPLETED geç olandan kötü)" ve "bekçi ile ürün kodu AYNI kuralı söylemeli" — rota topolojisinden bağımsız; MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-04 — "GİRİŞ NOKTASI" kuralı: iş emrine AŞAĞIDAN katılan top yukarıdaki adımları bekletemez):** `recomputeStepStatus`'un bekleyen-top sorgusu naif hâliyle *"bu adımda hareketi yok + hâlâ üretimde"* diyordu. Bu, iş emrine **ortadan katılan** her topu yukarıdaki adımlar için **sonsuza dek** bekleyen sayıyordu. İki gerçek vaka: **fason dönüşü çocuğu** (kabulde orijinal emekliye ayrılır, makbuzdan yeni toplar doğar — bunlar fason adımının ÇIKTISIDIR, o adıma hiç girmediler ve giremezler) ve **elle eklenen top** (doğrudan Tambur adımına yazılır, üstteki Kurşun/Boyahane'ye hiç uğramaz). Sonuç ikisinde de aynıydı: kapanmış adım `closedCount>0 && pendingRolls>0` dalına düşüp **COMPLETED'tan ACTIVE'e geri dönüyor**, `ensureWorkOrderInProgress` iş emrini IN_PROGRESS'e çekiyor ve `completeWorkOrderIfStepsDone` o iş emrini **bir daha asla kapatamıyordu** — hata yok, log yok. Genel kural özel yamaların yerini aldı: topun **giriş noktası** = bu iş emrindeki EN ERKEN hareketinin adım sırası; o sıra bu adımdan büyükse top aşağıdan katılmıştır ve bu adım için hiç bekleme yaşamamıştır. Aynı top, henüz **ulaşmadığı** aşağı adımlar için hâlâ bekleyendir. Giriş noktası çözülemezse (veri tuhaflığı) **eski davranış**: bekleyen say — adımı erken COMPLETED yapmak, geç yapmaktan kötüdür. ⚠️ **Bekçi ile ürün kodu AYNI kuralı söylemeli**: `scripts/test_consistency.ts` §20 bu sorgunun aynasıdır; biri değişip diğeri kalırsa bekçi ya yanlış alarm verir ya gerçek drift'i kaçırır. `scripts/test_helpers.ts`'teki sahte `tx` de `roll.findMany` sözleşmesini taşır (birim testi durum makinesinin dallarını ölçer, kuralı değil — kural gerçek veri üzerinde §20 ve `test_fason_wrong_station_guidance` S1c ile doğrulanır).

> ⚠️ **PROFİL GERÇEĞİ:** Fason çeki / kabul makbuzu yüzeyleri fason modülü altındadır ve "fasona giden belgede parti varsayılan AÇIK" bu kurulumun boyahane ilişkisidir; **"`sections`/`columns.hidden` BLOCKLIST'tir → naif kolon müşteri belgesinde varsayılan GÖRÜNÜR doğar"**, "fazla işaretlemek güvenli, eksik hata" ve "GET bayrağı TEMİZLEMEZ" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §2/§11.

> **NOT (2026-08-05 — PARTİ NO KÂĞIDA BASILIR + refakat kartı "bayat" bayrağı):** Saha sorusu: *"Mobilden hızlı iş emri açınca parti no karta yazılıyor, bilgisayardan açıp fason sevk yapınca belgede yazmıyor."* İnceleme **iki ayrı kök neden** gösterdi ve ikisi de kapatıldı — migration `20260804213714_traveler_card_content_dirty`.
> • **Fason sevk irsaliyesinde parti no HİÇ YOKTU** — "belge önceden donmuş" sorunu DEĞİL: `SubcontractorDispatch.batchId` **NOT NULL** (K10 "bir sevk = bir parti") ve belge tam o create tx'inde donuyor, yani parti donarken zaten biliniyordu; payload'a hiç konulmamıştı. Dört yüzeye eklendi: **fason çeki** (`assembleFasonCekiDoc`, tekil `batchNumber`) · **fason kabul makbuzu** (`batchNumbers` — **ÇOĞUL**, çünkü bir kabul birden fazla sevki kapsayabilir; tekil alan sessizce yanlış olurdu) · **fasondan doğrudan sevk** · **müşteri sevk irsaliyesinin çeki tablosu** (kolon; parti **ÇUVAL değil TOP başına** taşınır — çuval karışık içerikli).
> • **Görünürlük varsayılanı bilinçli olarak İKİYE ayrıldı.** Fasona giden belgeler (çeki + makbuz) **varsayılan AÇIK** — boyahanenin operasyonel ihtiyacı. Müşteriye gidenler (doğrudan sevk + çeki tablosu) **opt-in**: `sections`/`columns.hidden` birer **BLOCKLIST**'tir, yani naif eklenen kolon canlı müşteri irsaliyelerinde **varsayılan GÖRÜNÜR** doğar ve sahadaki her belgenin yerleşimi sormadan değişirdi. Renderer'da `cfg.sections?.batchInfo === true` / `DocCol.defaultHidden` (allowlist). ⚠️ Panel tarafı da güncellenmeli: `Electron/documentConfig.resolveDocConfig` bölümleri "kayıtlı değer yoksa AÇIK" diye çözüyordu → **`DocSectionDef.defaultHidden`** eklendi; yalnız bir tarafı işaretlemek "panel açık der, belge boş çıkar" (ya da tersi) yalanını üretir.
> • **Eski donmuş belgeler DEĞİŞMEZ.** Alanlar `batchNumber?` (opsiyonel) → 2026-08-05 öncesi snapshot'larda yok, satır/kolon **basılmaz** ve çıktı bayt-bayt korunur (`fason-ceki.html` satırı "Tarih"in SONUNA eklenir — kendi satırında `${…}` bırakmak boş satır sokup parmak izini bozardı). Geriye dönük doldurma **YAPILMAZ**; `reissue` ile tazelenen belge yeni alanı alır (gerçek veriyle doğrulandı: FS0408260001 donmuş hâlde basmıyor, reissue sonrası basıyor).
> • **`TravelerCard.contentDirty`** — kart **iş emri açılışında** doğar/basılabilir, parti ise `attachRolls`'ta doğar; ayrıca kısmi sevkte kalanlar YENİ parti alır (`splitRemainder`) ve çok partili sevkte K11 merge kaynakları yutar. Üçünde de basılı kâğıt sessizce yanlışlanıyordu. Sistem bunu **top etiketi için zaten çözmüştü** (`Roll.labelDirty`/`Sack.labelDirty`); kartta karşılığı yoktu. Tek yazma noktası **`helpers/traveler-card-dirty.helper.markTravelerCardDirtyTx`**, 9 çağrı noktası: parti (`createBatchTx` — `splitBatch`/`splitRemainder` de buradan geçer · `mergeBatches` · `moveRolls`), fason sevk (oluştur · iptal · aktarım geri alma), WO içeriği (`update` · `replace` · `updateTargetProperties` · `updateStepPlanning`). Yön kuralı: **fazla işaretlemek güvenli, eksik işaretlemek hata.**
> • ⚠️ **K18 KURALI KARTA KOPYALANMAZ.** Rol etiketinde "ilk parti ataması bayraklanmaz" denir (etiket henüz parti numarasıyla basılmamıştır); **kartta TERSİ** geçerlidir — kart parti doğmadan basılabildiği için ilk doğuş tam da bayatlatan olaydır. Bekçi bu asimetriyi kilitler.
> • ⚠️ **`GET /traveler-cards/:id/html` bayrağı TEMİZLEMEZ** — o uç önizlemeyi de besler ("HTML almak" ≠ "basmak") ve GET'in yan etkisi olmamalı. Temizleyen: yeni **`POST /api/traveler-cards/:id/print-event`** (audit-only, versiyon ARTIRMAZ, snapshot'a dokunmaz — emsal `POST /api/labels/rolls/:id/print`) ve `reprint`. İstemciler baskı BAŞARIYLA döndükten sonra çağırır; iptal edilen baskı bayrağı temizlemez. Bildirim hatası yutulur (kâğıt çıktı, baskıyı hata ile kesme).
> • ⚠️ **ROZET YÜZEYLERİ 2026-08-06'da TAMAMEN KALDIRILDI (kullanıcı kararı) — backend DURUYOR.** Dört yüzey de silindi: Electron Belgeler diyaloğu ("Güncel değil") · Electron kart önizleme bandı · mobil Hızlı İş Emri detayındaki dokunulabilir bant (onu besleyen `traveler-card-active` sorgusu da düştü) · mobil Belgeler kartındaki "GÜNCEL DEĞİL". Gerekçe: işaret *sahadaki kâğıdın* eskidiğini söylüyordu, **ekrandaki belgenin değil** — ama operatör onu tam da bastığı belgenin yanında görüp "ekrandaki eski" diye okuyordu ve **içerik 2026-08-05'ten beri her baskıda canlı çözüldüğü için bu okuma HER ZAMAN yanlıştı**. Üstelik canlı bir iş emrinde işaret sürekli yanıyordu (parti doğumu / fason sevki / WO düzenlemesi işaretler, yalnız baskı olayı temizler) → gürültü sinyali yuttu. **Kolon, `markTravelerCardDirtyTx`, `print-event` temizliği ve audit `wasDirty` AYNEN duruyor** — backend'e tek satır dokunulmadı, kaybedilen tek şey gösterim. Bilinçli bedel: sahada dolaşan bayat kâğıdı tazeleme dürtüsü artık hiçbir ekranda yok. Geri istenirse çözüm bandı geri koymak DEĞİL, işareti gerçek karşılaştırmaya bağlamaktır (`planKey` + basılan parti parmak izi snapshot'a yazılır → "kartın basmadığı bir alanı düzenledim, rozet yandı" sınıfı yanlış pozitifler biter). Bekçiler: `scripts/test_traveler_card_stale.ts` · `test_shipment_doc_batch_column.ts` · `test_fason_ceki_html.ts` §10 (üçü de negatif sondayla kırmızı verdiği doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** Birleştirilen dört kaynağın ikisi (`SUBCONTRACTOR_RECEIPT`, `SUBCONTRACTOR_DIRECT_SHIP`) fason modülüne aittir — fason kapalı kurulumda liste iki kaynakla doğar. **"Liste izni ↔ baskı izni HİZALI olmalı, ayrışma = görünen satır + sessiz 403"** ve "iptal belge listede KALIR" ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §3 madde 4.

> **NOT (2026-08-05 — İŞ EMRİNİN BELGELERİ TEK UÇTAN: `GET /work-orders/:id/documents`):** Bir iş emrinin belgeleri **dört ayrı kaynakta** yaşıyor (`TravelerCard` + üç `PrintedDocType`) ve `findById` yalnız `steps[].dispatches`'i taşıyordu. Sonuç: **fason kabul makbuzu** ve **fasondan doğrudan sevk irsaliyesi** hiçbir istemciden iş emri üzerinden ULAŞILAMIYORDU — belge vardı, kapısı yoktu; mobilde ise belge listesi hiç yoktu (tek "Çıktı" butonu yalnız refakat kartını basıyordu). Yeni uç dört kaynağı tek listede döner (`docType` · `sourceId` · `documentNo` · `date` · `group` · `title`/`subtitle` · `cancelled` · kart için `contentDirty`); istemciler artık **kendi listelerini kurmaz** — yeni belge tipi eklenince tek yer güncellenir.
> • **Baskı iki uçtan:** `TRAVELER_CARD` → `/traveler-cards/:id/html` (+ `print-event`), diğerleri → `/printed-documents/:docType/:sourceId/html`. Mobil dallanma tek yerde (`services/workOrderDocuments.printDocument`).
> • ⚠️ **ELECTRON'DA HER SATIR ÖNİZLEME AÇAR (2026-08-06 düzeltmesi).** Diyalog kurulurken belge tipleri ikiye ayrılmıştı: kendi zengin diyaloğu olan ikisi (refakat kartı, fason sevk) önizleme açıyor, kalan ikisi (**fason kabul makbuzu**, **fasondan doğrudan sevk**) `printHtmlString` ile **doğrudan yazıcı diyaloğuna** gidiyordu — operatör ne bastığını göremiyordu ve bu iki belgede versiyon geçmişi / revizyon / baskı notu / PDF ekranda hiç yoktu (uçlar vardı). Oysa docType-agnostik `components/print/PrintedDocDialog` **zaten mevcuttu** ve aynı makbuz `FasonReceiveInline`'dan **onunla** açılıyordu; yani aynı belge bir kapıdan önizlemeli, diğerinden önizlemesiz çıkıyordu. Artık **varsayılan dal generik önizlemedir** — backend listeye yeni bir belge tipi eklerse sessizce "önizlemesiz" doğmaz. Revizyon izni `workorder:write` (DOC_PERMISSIONS write kümesiyle hizalı; ayrışırsa "Revize Et" görünür ama uç 403 verir). Mobil bilinçli olarak **doğrudan basmaya devam eder** (tablette önizleme adımı fazladan dokunuş). Saf Electron: migration/izin/APK yok.
> • ⚠️ **LİSTE İZNİ ile BASKI İZNİ HİZALI OLMALI.** Liste tek uçtan geliyor, baskı ise belge-tipi bazlı `DOC_PERMISSIONS` ile kapılı: ayrışırlarsa operatör satırı **görür**, basar, **hiçbir şey olmaz** (sessiz 403) ve sebebi hiçbir yerde yazmaz. Bu yüzden `SUBCONTRACTOR_RECEIPT` ve `SUBCONTRACTOR_DIRECT_SHIP` read listelerine `mobile:hizli-is-emri` (+ makbuza `mobile:fason-sevk`) eklendi. Bekçi bu hizayı **mekanik** doğrular (`DOC_PERMISSIONS` bu yüzden export edildi) — yeni belge tipi eklerken listeye de yaz.
> • **İPTAL EDİLMİŞ belge listede KALIR** (`cancelled: true`) — donmuş belge silinmez, VOIDED'e çekilip İPTAL filigranıyla basılır; dosyaya bakan kişi onu yeniden basabilmeli. İstemci rozetle ayırır. ⚠️ Electron'un **eski** Belgeler diyaloğu iptalleri gizliyor ve kendi listesini `wo.steps[].dispatches`'ten kuruyor — bilinçli, geçici ayrışma; o diyalog bu uca taşındığında davranış birleşir (kabul makbuzu + doğrudan sevk de orada görünür).
> • Sıralama sözleşmesi: **kart önce** (iş emri belgesi), sonra fason belgeleri **tarih DESC** — sahada aranan "en son basılan"dır. İstemci yeniden sıralamaz.
> • Mobilde giriş noktası: Hızlı İş Emri → iş emri detayı → **"Belgeler"** (eski "Çıktı" butonunun yerine; kart listenin ilk satırı, yani hâlâ tek dokunuş). Kart bayatsa detaydaki uyarı bandı **dokunulabilir** ve kartı doğrudan basar — uyarıyı gören operatörün düzeltmesi liste gezmeden olmalı. Bekçi: `scripts/test_workorder_documents.ts` (27 kontrol; listedeki HER satırın gerçekten render edildiğini de doğrular — "listede var ama basılamıyor" sınıfı; iki negatif sondayla kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** Storno ≠ iade (SAP VL09), `preShipStatus` ile rafın korunması, `freezeForSource` `max+1`, "tahsis SİLİNMEZ, `shippedQty` defterden türer", `documentSourceId` ile belge çözümü ve `shipping:undo-dispatch` görev ayrılığı — hepsi defter semantiği, bayraklanmaz (MODUL-BAYRAK-TASARIM §11).

> **NOT (2026-08-05 — SEVKİ GERİ AL (STORNO) ≠ İADE + çuval bazlı TOPLU İADE tek belgeyle):** Saha üç soru sordu: *"sevk edileni depoya geri çekebiliyor muyuz?"* · *"sevkiyattan tek çuvalı iade alabilir miyiz?"* · *"araç hâlâ kapıda, çuvaldan 2 top çıkarmamız lazım — nasıl?"* Üçünün de cevabı **iade**ydi ve iade bu iş için YANLIŞ araçtır. Migration `20260805100000_shipment_undo_and_return_group` (iki nullable kolon; metadata-only).
> • **AYRIM SEKTÖREL, keyfî değil:** *İade (RMA)* = mal müşteriye ULAŞTI ve geri geldi → çıkış belgesi **düzeltilmez** (brüt kuralı), ayrı iade irsaliyesi kesilir, iade defterine yazılır. *Storno* = mal **hiç çıkmadı**, kayıt erken/hatalı → çıkış belgesi **İPTAL** edilir, stok geri döner, iade defterine **GİRMEZ**. SAP karşılığı VL09 (*reverse goods issue*). Hiç çıkmamış malı iade yazmak yalnız olayı yanlış anlatmakla kalmaz, **iade nedeni zorunlu** olduğu için kalite geri-besleme verisini de kirletir. Projedeki emsal aynı ayrım: `softDelete` (`qtyOut=0`) ↔ WO-kapanış dispozisyonu (`qtyOut=qtyIn`).
> • **`Roll.preShipStatus` — sevk, topun önceki rafını YOK EDİYORDU.** `performDispatchTx` tek `updateMany` ile hepsini `SHIPPED` yapıyordu; çuvalda hem `WAREHOUSE` hem `A1_STOCK` (2. kalite) top bulunabildiği için geri almada hepsini WAREHOUSE'a döndürmek **2. kalite topu sessizce 1. kalite rafına** yazardı. Artık statüye göre gruplanıp her grup kendi snapshot'ıyla yazılır; storno okuyup NULL'lar. Emsal: `RollReturn.prevSackId/prevQualityGrade`.
> • **`freezeForSource` `version: 1` SABİT yazıyordu** — bir kaynağın İKİNCİ kez dondurulması hiç düşünülmemişti. Storno sonrası yeniden sevk `docType_sourceId_version` unique'ine çarpıp **500** verirdi, hem de tam sevk anında tx'i geri sararak. Artık `max+1` (ilk dondurmada davranış birebir aynı: kayıt yok → 1).
> • **Tahsis SİLİNMEZ:** `shippedQty` defterden türetilir ve yalnız DISPATCHED sevkiyattaki tahsisleri sayar → sevkiyat PLANNED'a dönünce karşılanma kendiliğinden düşer. Yapılan tek şey `recomputeOrderStatusForOrders` + `ShipmentOrder.isActive=true` (şemada "PLANNED mı" denormu). Kilit protokolü `performDispatchTx` ile simetrik.
> • **Kapsam DAR ve sebebi SÖYLENİR** (`resolveUndoBlockReason` TEK KAYNAK — önizleme ve mutasyon aynı yüklemi çağırır, yoksa ekran "yapılabilir" derken uç 409 verir): faturalanmış (dış muhasebede belge kesilmiş) · bu sevkiyattan iade alınmış (iki motor aynı topa dokunur) · **ayar açıksa** aynı gün değil. **Yeni ayar `shipping.undoDispatchSameDayOnly` varsayılan KAPALI** (tarih sınırı yok) — "aynı gün" TAKVİM günüdür, `factoryDayStart()` ile çözülür. Plaka/şoför **KORUNUR** (ürün kararı; yeniden sevkte zaten üzerine yazılır). **Yeni izin `shipping:undo-dispatch`** — `shipping:write` KAPSAMAZ: sevk eden herkes resmi çıkış belgesini iptal edip defteri geri saramamalı. ⚠️ Boot uzlaştırması izni DB'ye getirir, **kullanıcılara atama elle yapılır**.
> • **ÇOK KALEMLİ İADE — defter satır bazlı KALIR, BELGE grup bazına geçer.** `RollReturn.returnGroupId` (= grup LİDERİNİN id'si) eklendi; `POST /api/returns` artık `rollIds[]` de kabul ediyor (`rollId` **aynen çalışıyor** → mobil APK'ya dokunulmadı). N top = N defter satırı (brüt kuralı, `prevSackId` geri-ekleme ve iade raporları buna dayanıyor) ama **TEK irsaliye** (sektör standardı). Yeni uç `GET /api/returns/lookup-sack?sackCode=` — `lookupForReturn`in çuval kardeşi.
> • ⚠️ **ÜYE id'siyle belge çözülmez** (`buildReturnDispatchDoc` bilinçli `null` döner): aksi halde `getCurrent` lazy-init ile aynı grubun **İKİNCİ resmi kopyasını** farklı bir `sourceId` altında dondurur ve tek iade olayı iki belgeyle görünürdü (negatif sondayla gözlendi). İstemciler yanıttaki **`documentSourceId`** (`returnGroupId ?? id`) alanını kullanır — türetilmiş alan olmadan her istemci aynı `?? id` kuralını kopyalamak zorunda kalır ve kopyalamayan istemcide "irsaliye yok" sessizliği doğar. ⚠️ Alanı `select`'ten düşürmek de aynı sessizliği üretir (`getReturnById`'da tam bu oldu, bekçi yakaladı).
> • **Grup iptalinde belge VOID DEĞİL REVİZE:** bir kalem iptal → `reissueForSourceTx` ile v+1 (iptal edilen satır düşer, kalanlar için belge geçerli kalır); **son** aktif kalem de iptal → VOIDED. Tümünü void etmek, iadesi DURAN topların resmi kaydını sessizce yok ederdi. `reissueForSourceTx` public `reissue`den farklı olarak **kendi tx'ini açmaz** — kaynak mutasyonu ile belge revizyonu ya birlikte olur ya hiç.
> • **Renderer tek satırda çok kalemliye açıldı** (`rows: doc.lines ?? [doc.line]`): tablo zaten `buildDocTable` ile çiziliyordu. `lines` YALNIZ çok kalemlide yazılır, toplam satırı `footLabel` ile yalnız o durumda basılır → **tekil ve eski donmuş belgeler bayt-bayt aynı** çıkar.
> • **Yan düzeltme (Faz 0):** "Sevk Kapısı" karosu bayrak kapatılınca gizleniyor ama açık PLANNED sevkiyatların çıkış onayı YALNIZ o ekrandan yapılıyordu → mal kapıda, ekran yok. `visibleWhen` artık "bayrak açık **VEYA** çıkış bekleyen sevkiyat var". Ayrıca Paketleme/Çuvallar'da boş sonuçta **"sevk edilmiş olabilir"** ipucu (varsayılan kapsam DEĞİŞMEDİ — "depoda ne var" sorusu bulanmasın).
> ⚠️ **BU CÜMLE 2026-08-22'de GERİ ALINDI:** karo kuralı saf bayrağa indi — `Electron/src/pages/Operations/tile-config.ts` bugün `visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled`; "VEYA çıkış bekleyen PLANNED" dalı ve `sack-store/board?limit=1` sondası KALDIRILDI. Kapalı rejimde PLANNED sevkiyatın çözümü storno'nun `releaseSacks` seçeneği ve Sevkiyatlar detayındaki "Sevk Et" düğmesidir — aşağıdaki 2026-08-22 "SEVK KAPISI = BAYRAĞIN EKRANI" notuna bak.
> • **Mobil DEĞİŞMEDİ** (tekil iade sözleşmesi korunuyor, mobil RETURN_DISPATCH belgesi açmıyor) → **backend + Electron aynı pencerede**, APK gerekmez. Bekçiler: `scripts/test_shipment_undo_dispatch.ts` (36 kontrol) · `scripts/test_return_bulk_group.ts` (29 kontrol) — **üç negatif sondayla** kırmızı verdiği doğrulandı: `version:1` sabitlenince yeniden sevk çöktü (exit 1), `preShipStatus` yazımı kaldırılınca 5 kontrol (2. kalite topu WAREHOUSE'a döndü), üye-id kapısı kaldırılınca 2 kontrol (ikinci belge doğdu).

> ⚠️ **PROFİL GERÇEĞİ:** Sayfa boyu (A5), fason çeki grid'i ve "sayfa başına 50 top" bu fabrikanın kâğıt düzenidir — belge şablonu/ayar seviyesinde her kurulumda farklıdır. **DÖRT KAPI birlikte güncellenir yoksa ayar sessizce kaybolur**, `calc()`/`var()` yasağı ve şablon literalinde backtick yasağı ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-05 — BELGE YERLEŞİMİ: A5 yoğunluk profili + ALAN BAZLI punto/kalınlık):** Panel her belge için **A5 seçtiriyordu ama belgeler A4'e sabitlenmiş px ile yazılmıştı** — yani ayar vardı, karşılığı yoktu. Ölçüldü (headless Chrome, örnek veri): fason çeki A5'te **%105 → imza bloğu ikinci kâğıda düşüyordu** (sahanın "üste dayamıyor, alta dayıyor" şikâyeti; birinci kâğıdın dibinde boşluk, ikincisinde tek satır), **fasondan sevk 149px YATAY taşıyordu** (kâğıdın sağı kesilir), sevk irsaliyesi yazı ölçeği 1.4'te **%131 / iki sayfa / 48px taşma**. Çözüm refakat kartındaki (2026-08-03) kanıtlanmış paternin yayılmasıdır.
> • **İKİ YOĞUNLUK PROFİLİ, ÜÇ DOSYA:** `doc-density.ts` (altı belge ORTAK: sevk · fasondan sevk · fason kabul · kartela · kalite sertifikası · iade) + `fason-ceki.density.ts` (100 hücreli grid kendine özgü) + mevcut `traveler-card.density.ts`. Ortaklaştırma **ölçümle** meşru: altı belgenin CSS'i ortak seçicilerde BİREBİR aynı değerleri taşıyordu (`.company` 16 · `.title` 18 · `.sec` 3px 6px/11 · `.sign` gap 24/üst 28); tek fark `.box .row` etiket sütunuydu (72/64/56) → parametre. **A4 sütunu bugünkü sabitlerin aynısıdır** ve altı belgenin A4 çıktısı (gövde HTML'i dahil) dönüşüm sonrası **birebir aynı ölçüldü**.
> • ⚠️ **İKİ FARKLI ORAN, tek `scale()` DEĞİL:** genişlikler ~0.68 (geometrik zorunluluk), yazı boyları ~0.85 (okunabilirlik tabanı — fabrika kâğıdı elle okunuyor). Belgeye özel ölçüler ortak arayüze eklenmez; belge kendi A4 sayısını verir, `scaleW`/`scaleF` oranı uygular.
> • **YATAY TAŞMANIN KÖKÜ flex'ti, punto değil:** `.hr` (başlık sağ bloğu) ve `.box` (bilgi kutuları) `min-width: auto` + sabit genişlikli içerik yüzünden **küçülemiyordu**. `min-width: 0` + `.info { flex-wrap: wrap }` + `overflow-wrap: anywhere`. A4'te üçü zaten sığdığı için sarma hiç tetiklenmez → çıktı değişmez. Aynı kök neden fason çekinin "yazılar büyüyünce ekrana sığmıyor" şikâyetiydi.
> • **ALAN BAZLI PUNTO/KALINLIK** (`DocumentConfig.fields`): belge geneli `fontScale`/`fontWeight` TEK kolu çevirirdi; artık her alan ayrı (fason çekide 24, diğerlerinde 15–18). Saha isteği birebir buydu: *"metre ve cm verilerinin büyüklüğü kalınlığı ayrıca belirlenemiyor."* **ÜÇ KURAL, üçü de bekçide:** ① override yoksa **tek bayt CSS basılmaz** (ayara dokunmamış belge birebir korunur); ② **`calc()`/`var()` YASAK** — `scaleDocCss` yazı ölçeğini `font-size:\s*([\d.]+)px` regex'iyle uyguluyor, `calc()` o desene takılmaz ve genel ölçek tam da elle ayarlanmış alanlarda **sessizce ölürdü**; ③ her seçici **`.sheet ` ile öneklenir** → ortak chrome'dan her zaman daha özgül, CSS sırasından bağımsız kazanır.
> • ⚠️ **BELGEYE ÖZEL KURAL ORTAK KATMANDAN SONRA BASILIR** (eşit özgüllük → sonra gelen kazanır). Sıra bozulursa belgeler sessizce birbirine benzer. Korunanlar: sevk irsaliyesinde liste başlığı 12px + açıklama hücresi 10px + `.pgb`, kalite sertifikasında `.decl` + kendi `.tbl-cap` boşluğu, iade irsaliyesinde `.box`un **flex çocuğu olmaması**. **`totRow: false` iade irsaliyesine özeldir:** o belgede toplam satırı vurgusu HİÇ YOKTU; ortak katman uğruna canlı bir resmi belgenin görünümü sormadan değiştirilmedi (hizalamak istenirse bilinçli bir ürün kararıdır, refactor yan etkisi değil).
> • **`DOC_PAGINATION_CSS` altı belgeden yalnız sevk irsaliyesindeydi** → artık ortak katmanda. Tercih değil doğru baskının koşulu: çok sayfalı tabloda ikinci sayfa kolon adları olmayan çıplak sayı bloğu olarak basılıyordu.
> • **Fason çekiye özel dört yerleşim isteği** (saha): parti no **sol/sağ** (`placements.batchInfo`, varsayılan sağ) · **hesap no OPT-IN** (`sections.accountNo`, varsayılan KAPALI — istek "kaldır"dı; ⚠️ eski donmuş çekiler de yeniden basılınca bu satırı artık BASMAZ, bilinçli) · **kumaş adı + TÜM renkler üst bloğu** (`sections.fabricHeader`, OPT-IN; payload DEĞİŞMEDİ, alanlar snapshot'ta zaten vardı) · **grid grup sayısı 3/4/5** (`gridGroups`, varsayılan 5 = fiziksel form; A5'te punto büyütmenin tek yapısal yolu — 15 kolon 132mm'ye sığmıyor). Ayrıca panelde **kenar boşluğu artık kenar kenar** (üst/sağ/alt/sol) ve önizlemede **sayfaya sığma göstergesi** var.
> • ⚠️ **DÖRT KAPI BİRLİKTE GÜNCELLENİR, yoksa ayar SESSİZCE kaybolur:** ① `system-setting.DocumentConfig` tipi · ② `sanitizeDocumentsConfig` kayıt kapısı · ③ **`printed-document.controller.docConfigSchema`** (bir `z.object`tir, tanımadığı anahtarı hata vermeden ATAR → ayar kaydedilir, GERÇEK BASKIDA görünür, ama Belge Şablonları ekranının canlı önizlemesinde GÖRÜNMEZ; "önizleme = gerçek baskı" sözleşmesi ayarı yapan kişinin gözü önünde bozulur) · ④ Electron `documentConfig.ts` aynası. Bu iş sırasında ③ gerçekten atlanmıştı ve mekanik bekçiye bağlandı; aynı boşluktan geçmiş `columns.shown` da kapatıldı.
> • ⚠️ **Şablon literali içinde BACKTICK kullanma** (CSS yorumlarında bile) — JS template literal'ını ortadan böler, dosya derlenmez. Projede yazılı bir kural; bu iş sırasında iki kez ısırdı.
> • **Migration YOK · izin YOK · APK YOK** (mobil aynı backend HTML'ini basar) — **backend + Electron aynı pencerede**. Bekçiler: `scripts/test_doc_density_fields.ts` (107 kontrol, **altı negatif sondayla** kırmızı verdiği doğrulandı) · `scripts/test_fason_ceki_html.ts` (51 → **150 kontrol**, **yedi negatif sonda**).
> • **SAYFA BAŞINA TOP ADEDİ AYARLANIR — varsayılan 100 → 50 (2026-08-06, kullanıcı kararı).** Grid `5 grup × 20 satır = 100` ile sabitti; artık `gridRows` (1–40) de ayarlanıyor ve **sayfa başına top = `gridGroups × gridRows`** (varsayılan 5 × 10). Gerekçe: hücreler VERİ değil, **elle doldurulan boş kutulardır** ve tipik bir sevkte 100 kutunun çoğu boş basılıyordu. Panel tek kutu değil **sonucu** gösterir ("= sayfa başına 50 top"), çünkü kullanıcının önemsediği sayı odur. **Sözleşme:** sayı olan değer aralığa KIRPILIR, sayı olmayan değer varsayılana düşer — ikisi de baskı yolunu düşürmez.
>   - ⚠️ **ESKİ DONMUŞ ÇEKİLER DE ETKİLENİR** (anahtar taşımayan snapshot varsayılana düşer): 2026-08-06 öncesi bir çeki yeniden basılınca 100 değil 50 kutu çizilir ve 60+ toplu sevk iki sayfa olur. Bilinçli — topların kendisi, metrajı ve toplamı birebir aynı basılır; değişen yalnız boş kutu sayısıdır. Geçmiş görünümü birebir isteniyorsa çözüm varsayılanı geri almak değil, o belge için `gridRows: 20` yazmaktır.
>   - ⚠️ **KAYIT KAPISI BEKÇİSİZDİ:** `sanitizeDocumentsConfig`'ten `fields`/`placements`/`gridRows` silinse **hiçbir test kırmızı vermiyordu** (negatif sondayla ölçüldü) — yani "dört kapı" kuralının saklama ayağı yazılıydı ama korunmuyordu. `test_fason_ceki_html` §18 o kapıyı artık gerçek round-trip ile doğrular. Yeni bir `DocumentConfig` alanı eklerken §17 (önizleme şeması) ve §18 (kayıt kapısı) İKİSİ de genişletilir.
>   - ⚠️ **Slot kontrolleri `hasSlot` ile KESİN eşleşir:** düz `includes(">100<")` metraj hücresinden de eşleşiyordu ve "slot 100 var" testi varsayılan 50'ye indiği hâlde **yanlış sebeple yeşil** kalmıştı. Grid slot numarası yalnız `c-top` hücresinde durur.

> ⚠️ **PROFİL GERÇEĞİ:** Kaldırma bu kurulumun kullanıcı kararıdır, ürün kısıtı değil; başka fabrikada yeniden istenirse karar yeniden verilir. Taşınabilir olan tek şey tuzak: `findInPage` seçeneğindeki `findNext` "SONRAKİ eşleşme" değil "YENİ OTURUM BAŞLAT" demektir.

> **NOT (2026-08-06 — SAYFA İÇİ ARAMA (Ctrl+F) KALDIRILDI):** Uygulama içi metin araması (Chromium `findInPage` + arama çubuğu) yazıldı ve **aynı gün tamamen geri alındı** (kullanıcı kararı). Kayıt aramak için listenin kendi arama kutusu kullanılır — o sunucuya sorar ve TÜM kayıtlara bakar; sayfa içi arama yalnız o an DOM'da olan satırları görebildiği için zaten kısmi cevap veriyordu. Yeniden denenirse bilinmesi gereken tuzak: **Electron'un `findInPage` seçeneğindeki `findNext`, "sonraki eşleşme" DEĞİL "YENİ OTURUM BAŞLAT" demektir** (belge: *true for initial requests, false for follow-up*) — ters yazılınca hata vermez, `found-in-page` olayı hiç doğmaz ve çubuk ekranda duran kelimeye bile "0/0" der.

> **NOT (2026-08-06 — YETKİ DENETİMİ: rol şablonları da KODA taşındı; "izin DB'ye gelir ama kimseye ATANMAZ" boşluğu artık görünür):** Yetkilendirme baştan sona denetlendi. **Mekanik taraf temizdi**: katalog 67 ↔ DB 67 (ölü izin yok, kodda geçip katalogda olmayan yok) ve 496 uçtan 473'ü izin guard'lı — guard'sız 23'ün hepsi meşru (login/self-servis, cihaz el sıkışması, dinamik `DOC_PERMISSIONS`, anahtar-kapsamlı `flagWriteGuard`). Kırık olan **İÇERİK** tarafıydı ve iki ayrı yerden kanıyordu.
> • **Şablonlar `seed.ts`'te yaşıyordu ve seed yalnız ilk kurulumda koşar** — izin kataloğunun 2026-08-01'de kapattığı deliğin birebir ikizi. Ölçüm: canlı fabrikada **"Admin (Tam Yetki)" 55 izin, katalog 67** → o şablonla açılan yeni yönetici 12 yetkiyi ALMIYOR ve bunu hiçbir yerde göremiyordu. Çözüm aynı üç parça: **tek kaynak `constants/role-template-catalog.ts` → boot uzlaştırma `jobs/role-template-catalog.job.ts` (izinlerden SONRA, aynı zincirde — FK sırası) → bekçi `scripts/test_role_template_catalog.ts`**. Detay + tuzaklar: `Teks-Erp/CLAUDE.md`.
> • **Masaüstü rolü HİÇ YOKTU** (16 şablonun 15'i tek-ekran mobil) → üç büro kullanıcısı **birebir aynı 40 izinle** fiilen süper kullanıcıydı. Sekiz rol eklendi: Üretim Planlama · Depo & Sevkiyat · Muhasebe · Satış/Sipariş · Kalite · Belge & Etiket Tasarımı · **Üretim Süpervizörü** · Sistem Yöneticisi. **Görev ayrılığı (SoD) kodda ZATEN vardı ama kimse kullanmıyordu** — `shipping:write` (sevk eden) ≠ `shipping:invoice` (faturalayan) ≠ `shipping:undo-dispatch` (resmi çıkış belgesini iptal eden), ve `roll:manual-adjust` günlük iş değil süpervizör yetkisi. Bu üçü bilinçli olarak yalnız Muhasebe/Süpervizör rollerinde.
> • ⚠️ **Uzlaştırma İZNİ getirir, ATAMAZ** — kural değişmedi (*katalog koda, atama panele*) ve tam da bu yüzden sessizdi: canlıda **7 izin hiçbir kullanıcıda yoktu** (`document-template:read/write`, `settings:workstation`, `roll:history`, `shipping:undo-dispatch`, `mobile:kumas`, `mobile:siparis`) — yani o ekranlar deploy edilmiş ama **kimse açamıyordu**, `admin` dahil. Boşluğu gösteren tek yüzey artık **Yetki Kataloğu ekranındaki "N yetki hiçbir kullanıcıda yok" bandı** + satır başına kullanıcı/rol sayacı (`listPermissions` → `userCount`/`templateCount`). Yeni bir izin eklerken bu bandı kontrol et; atama hâlâ bilinçli bir karardır.
> • ⚠️ **Sistem rolü SİLİNMEZ, PASİFLEŞTİRİLİR** — sert silme bir sonraki `pm2 restart`'ta **diriliş** demekti. Kimlik `permission_templates.code`'dur (ad DEĞİL: fabrika yeniden adlandırırsa ada bakan uzlaştırma ikizini doğururdu); `code = null` fabrikanın kendi şablonudur ve uzlaştırma ona hiç dokunmaz. Migration `20260806040111_permission_template_code` (nullable kolon → metadata-only).
> • **Mevcut kullanıcıların yetkilerine DOKUNULMADI** (ürün kararı): canlı fabrikada daraltma ayrı ve bilinçli bir adımdır. Roller hazır duruyor; kimin hangi rolü alacağı panelden verilir.

> ✅ **ÇEKİRDEK:** `readIdCondition`/`readFilterList` tek kaynağı, üç arıza modu (P2007 · sessiz 0 satır · **filtre sessizce DÜŞER → YANLIŞ liste**), "backend ÖNCE" deploy sırası ve "iki değerli NOT NULL enum'da çoklu seçim gürültüdür" — hepsi fabrikadan bağımsız; MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-06 — FİLTRELERDE ÇOKLU SEÇİM: "CSV de bir string'dir" ve üç ayrı arıza modu):** Electron `FilterBar` çoklu seçimi `filter[colorId]=a,b` (CSV) olarak yollar. Jenerik yol (`buildWhereClause`) CSV'yi zaten `{ in: [...] }`'e çevirir — **ama büyük liste servisleri filtreyi ELLE okur** ve hepsi `typeof v === "string"` diyordu; CSV de bir string olduğu için ham geçiyordu. Tek kaynak artık **`utils/query-parser.readIdCondition`** (+ `readFilterList`): hiç değer → `null` · tek değer → **düz eşitlik** (mevcut `where` şekli bayt-bayt korunur) · N değer → `{ in: [...] }`. Elle okunan HER id filtresi oradan geçmeli.
> • ⚠️ **ARIZA MODU KOLON TİPİNE BAĞLI — "sessizce boş liste döner" diye genelleme YANLIŞ** (üçü de negatif sondayla ölçüldü): ① **uuid kolon** (itemId/colorId/customerId/subcontractorId…) → Postgres `invalid input syntax for type uuid` → Prisma **P2007** → `error.middleware` bunu **HTTP 400 + "Geçersiz veri formatı (örn. hatalı ID). Gönderilen değerleri kontrol edin."** mesajına çevirir (⚠️ servisi doğrudan çağıran bekçilerde ham Prisma hatası görülür, middleware devrede değildir — "500" sanma); ② **uuid olmayan string kolon** → **sessiz 0 satır** (`foldType` emsali, kendi bekçisinde); ③ **ön-süzgeçli alan** (`currentStationId`, UUID regex'inden geçiyor) → regex Prisma'dan ÖNCE çalıştığı için CSV elenir ve filtre **sessizce DÜŞER**, liste **filtresizmiş gibi** döner. Üçüncüsü en tehlikelisi: boş liste değil **YANLIŞ liste**, hata yok, log yok (ölçüm: iki istasyon seçilince 2 yerine **6 satır**).
> • ⚠️ **DEPLOY SIRASI PAZARLIK DIŞI — bu ①'in sahadaki tam karşılığıdır.** Yeni panel + ESKİ backend = çoklu seçilen HER lookup filtresinde *"Geçersiz veri formatı (örn. hatalı ID)"* 400'ü (2026-08-06'da canlı sunucuya karşı gözlendi). Backend ÖNCE deploy edilir; panel sonra. Tersi çalışır (eski panel CSV göndermez), aynı anda da çalışır — kabul edilemez olan yalnız "panel önde, backend geride" hâlidir.
> • Dokunulan yerler: `inventory.buildRollWhere` (itemId · colorId · currentStationId · subcontractorId · subcontractorCategoryId) · `order.extraWhere` (itemId · colorId — çoklu seçimde de **TEK `lines.some` bloğu** kalır, yani kumaş ∈ seçilenler VE renk ∈ seçilenler AYNI kalemde eşleşir) · `kartela` (liste `subcontractorId`, `getStock` itemId/colorId) · `production-balance.getBalance` (itemId). **İş Emirleri · Sevkiyatlar/Muhasebe · İadeler ek backend işi İSTEMEDİ** — o alanlar zaten `buildWhereClause` yolundan geçiyordu.
> • ⚠️ **ÇOKLU SEÇİM HER FİLTREYE UYMAZ; bilinçli TEKİL bırakılanları geri çevirmeden önce gerekçeyi çürüt.** **`destination`** (Sevkiyatlar + Muhasebe): NOT NULL + iki değerli → ikisini seçmek "filtre yok" ile aynıdır, yani hiçbir şey kazandırmaz; üstelik **zararlıdır** — `listShipments` "destination filtresi aktif mi" sorusuna `!= null` ile bakıp **DirectShipment'ları union'dan DÜŞÜRÜR** (o tabloda bu kolon yok), yani "ikisini de seç" diyen kullanıcı fasondan doğrudan sevkleri sessizce kaybederdi. **`WorkOrder.type`** aynı gerekçeyle tekil. **Kontrast — `foldType` ÇOKLU:** kat NULL olabildiği için "2-KAT + 4-KAT" gerçekten *"katı belirlenmiş toplar"* demektir. Kural: **iki değerli NOT NULL enum'da çoklu seçim gürültüdür; nullable alanda anlamlıdır.**
> • **Kapsam anahtarlarına DOKUNULMAZ:** `processingStatus` · `rollScope` · `shipmentScope` · `rollKind` · Çuvallar `scope` · Kartela `status` · Ürün Dengesi `status` · `invoiced` · `hasReturns`. Bunlar birbirini **DIŞLAYAN** if/else dallarıdır, OR semantiği yoktur; çoklu seçim kullanıcıya anlamsız kombinasyon vaat eder.
> • `dependent-lookup` (Şube) üst filtresi çoklu olabilir ve **ek kod GEREKMEDİ**: ham CSV `fetchOptions`'a aynen geçer, `/api/customer-branches` BaseService üzerinden `in`'e çevirir. Ama tekil id çözen yardımcılar kırılır — `useFasonScopeLabel` CSV'de `find(id)` ile `undefined` bulup rozeti filtre AKTİFKEN sessizce "Fasonda"ya düşürüyordu (artık tek seçimde AD, çok seçimde "N firma"; react-query anahtarı da `filter-lookup-multi` ile hizalandı, ayrışırsa aynı veri iki kez çekilir).
> • Migration YOK · izin YOK · APK YOK (mobil dokunulmadı) — **backend + Electron aynı pencerede** gitmeli (eski backend + yeni panel = uuid 500'leri). Bekçi: `scripts/test_filter_multi_select.ts` (28 kontrol; **iki negatif sondayla** kırmızı verdiği doğrulandı — `readIdCondition` eski hâline çevrilince P2007 ile çöktü, istasyon süzgeci tek-string'e çevrilince 2 yerine 6 satır döndü). Yeni bir liste yüzeyi eklerken bekçiye de satır ekle.

> ⚠️ **PROFİL GERÇEĞİ:** "Bugün fabrikada içeride yapılan bir proses yok" (KAPSAM DIŞI maddesi) ve `appliesColor=false` göçü bu kurulumun topolojisidir — iç boyahaneli/dokuma profilinde bu varsayım düşer. **Bu not aynı zamanda kalite-yetenek dönüşümünün (§5.1) ÖNCÜLÜDÜR:** renk ve özellik istasyon TÜRÜnden YETENEĞE taşındı, kalite üçüncüsü oldu — `Station.appliesQuality` **2026-09-03'te indi** (P4 Faz A; ikiz boğaz `stepCanApplyQuality` + `QUALITY_STATION_WHERE`), Faz B açık — bkz. MODUL-BAYRAK-TASARIM §5.1, UYGULAMA-PLANI P4.

> **NOT (2026-08-10 — ÜRETİM KARAKTERİSTİĞİ: kat KATALOĞA taşındı + istasyon-özellik DAVRANIŞ MODU + istasyon yeteneği kategoriden ayrıldı):** İki saha isteği tek modelde birleşti: *"2/4-KAT yerine 6/8-KAT gelince bunu üretim özelliğinden seçebilelim, Tambur'un önüne o iki seçenek gelsin"* ve *"bir özelliğin uygulanıp uygulanmadığı istasyon ekranında olsun — basması gereksin, gerekmesin ya da otomatik basılmış sayılsın"*. Sektör karşılığı SAP **Classification** (karakteristik + değer kümesi) ve rota operasyonundaki **Control Key** (onay zorunlu/opsiyonel/otomatik). Migration'lar: `20260809232529_property_value_type_and_station_mode` + `20260810010330_station_capability_flags`.
> • **KAT ARTIK KATALOG SATIRIDIR.** `FabricProperty.valueType` (BAYRAK|SEÇİM) + yeni `FabricPropertyValue` tablosu. Kat = `code:"KAT"`, tip SEÇİM, değerleri `2-KAT`/`4-KAT`/`TUP`. Fabrika `6-KAT`'ı panelden ekler; **sürüm gerekmez** (ilk dağıtımdan sonra). Öncesinde izin verilen değerler **dokuz yerde literal diziydi** ve `tambur.controller` `z.enum` ile 2/4-KAT'a kilitliydi.
> • ⚠️ **DEĞER KOLONDA SAKLANIR, PİVOTTA DEĞİL.** `Roll.foldType` / `WorkOrder.foldType` / `ProductRecipe.foldType` **aynen kalır**; katalog yalnız *"hangi değer geçerli + hangi istasyon sorar"* der. `RollProperty` bir **KÜME** modelidir (`@@unique([rollId,propertyId])`, değer kolonu yok) ve bir topa hem 2-KAT hem 4-KAT yazılmasını engelleyemez. İkinci bir SEÇİM tipli özellik doğduğunda ya kendi kolonunu ister ya pivota `valueId` eklenir.
> • ⚠️ **KOD ASCII OLMALI** (`TUP`, `TÜP` DEĞİL; görünen ad "Tüp" kalır). Türkçe karakterli kod, ASCII yazan her istemciyi sessizce reddettirir — ölçüldü: `test_recipe` "TUP" gönderip "TÜP" koduna takıldı. Karşılaştırma `toUpperCase()` ile, **`toLocaleUpperCase("tr")` DEĞİL** (2026-08-02 etiket `showIf` dersinin aynısı). Backend + panel + bekçi üçü de kuralı uygular.
> • ⚠️ **BİÇİM ile GEÇERLİLİK AYRI FONKSİYON.** `normalizeFoldType` (senkron, Zod içinde) yalnız `"4 kat" → "4-KAT"` yapar; `resolveFoldTypeForWrite` (asenkron, serviste) katalogla doğrular. Regex `[24]` → `\d+` genelleştirildi — yoksa katalog 6-KAT'ı öğrense bile `"6 kat"` normalleşmez, eşleşme kaçar ve değer ham geçerdi. **Katalog boşsa FAIL-OPEN** (göç koşmamış kurulumda iş emri açmak ve Tambur finalize durmasın). **Pasif değer yazmada KABUL EDİLİR** (katalogdan kaldırılan katı taşıyan eski iş emri düzenlenebilsin), seçici listesinde görünmez.
> • ⚠️ **SEÇİM tipli özellik HEDEF-ÖZELLİK seçicilerinden SÜZÜLÜR** (`isTargetableProperty` tek kaynak): rota adımı chip'leri, WO hedefleri, ürün izinli listesi, sipariş satırı. Sızsaydı planlamacı "Kat"ı işaretler (hangi kat?) ve `workorder.service`'in kapsama guard'ı iş emrini reddederdi. Panelde react-query anahtarı da ayrıldı (`fabric-properties/targetable`) — süzülmüş liste, ham liste bekleyen `RouteEditor`/`CapabilitiesEditSheet` ile aynı anahtarı paylaşıyordu.
> • ⚠️ **METRE SAPMASI KAPATILDI (en tehlikelisi).** `meterPeripheralFor` şöyleydi: `foldType === '4-KAT' ? '4-KAT' : '2-KAT'` — üçlü bir kararı ikiliye indiriyordu. 6-KAT eklendiği an 6 katlı top **2-KAT metresiyle** ölçülürdü: hata yok, log yok, yalnız yanlış metraj (aynı sapma bugün "TÜP"te de vardı). Artık rol **birebir** eşleşir; eşleşme yoksa **başka cihaza SAPMAZ**, `null` döner ve ekran "elle girin" der. Rolsüz cihaza düşme dalı da kaldırıldı. Yeni kat = katalog satırı **+ cihaz satırı**; ikincisi unutulursa özellik yarım çalışır ve ekran bunu söyler.
> • **İSTASYON-ÖZELLİK MODU (`StationProperty.mode`): AUTO | OPTIONAL | REQUIRED.** AUTO → operatöre sorulmaz, adım kapanınca yazılır · OPSİYONEL → tuş çıkar, işaretlenirse yazılır · ZORUNLU → işaretlenmeden adım kapanmaz. **Varsayılan OPSİYONEL** ve bu, şemanın kendi uyarısını kapatır: eskiden istasyona eklenen her özellik oradan geçen HER TOPA sessizce yazılıyordu.
> • ⚠️ **MOD ÇALIŞMA ZAMANINA AİT, PLANLAMAYA DEĞİL.** *"Bu istasyon bu özelliği VEREBİLİR mi"* sorusunun cevabı satırın **VARLIĞI**dır; mod yalnız *"nasıl teyit edilir"* der. OPTIONAL satırı kapsama dışı saymak, rotada zımpara adımı dururken ZIMPARALI hedefli iş emirlerini 409'a düşürürdü.
> • ⚠️ **KURŞUN BYPASS ATAMASI ARTIK `AUTO` ARAR** — satırın varlığı yetmez. Bypass'ta tablet salt-okunurdur, işaretleyecek operatör YOKTUR; OPTIONAL bir KURSUN satırı kapanışta topa hiç yazılmaz ve `computeWorkOrderLocks` "bu özelliği veren adım tamamlandı" derdi (kilit modeli sessizce yalan söylerdi). Göç `KURSUN_KK2/KURSUN`'u AUTO'ya çeker; **atlanırsa kurşun özelliği toplara yazılmayı bırakır.** Fason istasyonlarının satırları bilinçli OPSİYONEL kalır (o yolda `copyStationCapabilitiesToRoll` hiç çağrılmıyor; toplu AUTO işaretlemek iç boyahane akışı yazıldığı gün 7 özelliği sessizce yazdırırdı).
> • **İSTASYON YETENEĞİ KATEGORİDEN AYRILDI** — `Station.appliesColor` / `appliesProperty`. Eskiden bu yalnız `defaultCategory`'den türetiliyordu, yani **kategorisi olmayan bir İÇ istasyon tanım gereği "renk veremez"di**; iç boyahane/iç zımpara senaryosunun önündeki asıl engel buydu. ⚠️ Göçte **iç istasyonlara `appliesColor=FALSE`** yazıldı: eski kural `hasDefaultCategory && canApplyColor` bileşiğiydi ve kategorisiz istasyonda sonucu **false**'tu; `true` yazmak Tambur/Kurşun adımına renk yazılmasına izin verirdi (2026-08-06 uyarısı). Bayrak dürüstleşince bileşik koşul **dört dosyada** tek bayrağa indi.
> • ⚠️ **TEK YÜKLEM `stepCanApplyColor` / `stepCanApplyProperty`** (`helpers/step-capability.helper`): *adım verebilir ⇔ İSTASYON verir VEYA o adımda seçilen FASON HİZMETİ verir*. Rota adımı hedefi, WO kapsama guard'ı ve renk kilidi ONU paylaşır. `workorder.service`'teki guard artık *"rotada fason kategorisi var mı"* değil *"renk/özellik VEREBİLEN adım var mı"* diye sorar — tümü-iç rotalı hedefli iş emri artık **açılır** (eskiden 400). Guard create + replace'te **kopyalanmıştı**, tek fonksiyona indi.
> • ⚠️ **FASON KABUL KATEGORİDEN OKUMAYA DEVAM EDER** (`subcontractor.service`). İki ayrı soru: istasyon bayrağı *planlama* ("bu adım renk verebilir mi"), kategori bayrağı *çalışma zamanı* ("satın alınan bu hizmet renk uyguladı mı"). Birleştirme; bekçi ayrımı kaynak taramasıyla kilitler.
> • **KAPSAM DIŞI (bilinçli, ayrı iş):** iç istasyonun **operatör akışı** — tablet ekranı, adım başlat/bitir, topun ilerlemesi, yeni `RollOperationType`, yeni `mobile:*` izni. Bugün fabrikada içeride yapılan bir proses yok (kullanıcı kararı); model kuruldu, akış yazılmadı. Referans: `KursunQcScreen` 3.024 satır, `TamburScreen` 8.236 satır — genelleştirme ayrı bir iştir.
> • **DEĞER TAŞIYAN ÖZELLİK (2026-08-11) — kat artık tek örnek değil.** Saha isteği: *"kurşuna 25/50/75 gr tuşları koyalım, operatör '50 yaptım' desin"*. `RollProperty.valueId` (nullable FK → `FabricPropertyValue`) eklendi; `@@unique([rollId, propertyId])` KORUNUYOR ve **dışlayıcılığın kendisi odur** — bir topa aynı özellikten iki değer yazılamaz, düzeltme ÜSTÜNE yazar. Sözleşme `propertyIds: string[]` → **`properties: [{propertyId, valueCode?}]`** (branch sahaya çıkmadığı için geriye uyum yükü yok). Dört kural, dördü de bekçide: SEÇİM'de değer ZORUNLU · katalog dışı/pasif değer 400 · BAYRAK'a değer 400 (sessizce yutulmaz) · **SEÇİM özelliği AUTO moda ALINAMAZ** (AUTO "sorulmaz" demek; sistem 25 mi 50 mi olduğunu kendi seçemez). Değer taşımayan çağrı MEVCUT değeri SİLMEZ (bypass kapanışı emsali). FK **RESTRICT**: kullanılan değer satırı silinemez (zaten pasifleştiriliyor). Panel rozetinde değer BASILIR ("Gramaj: 50 gr") — hem listede hem detayda; yoksa operatörün tablette yaptığı seçim panelde okunamaz kalırdı. ⚠️ Kat bu yolu KULLANMAZ: değeri `Roll.foldType` kolonunda, çünkü filtrelenip sıralanıyor. Bekçi: `scripts/test_property_value_selection.ts` (27 kontrol; ALTI negatif sondayla kırmızı verdiği doğrulandı — değer yazımı körleşince 5, BAYRAK kontrolü kalkınca 1, Düzelt/hedef replace'leri körleşince 4, kesim mirası değere körleşince 1, Zod alanı silinince 2).
> • **SEKTÖR DENETİMİ (2026-08-11, aynı branch) — 24 doğrulanmış bulgu, hepsi kapatıldı.** 5 mercekli çapraz-doğrulamalı denetim; altı kök neden:
>   - ⚠️ **REPLACE'LER DEĞER-FARKINDA OLDU (F1 — en kritik).** "Roll.properties = hedef listesinin kopyası" varsayımı değer modeliyle bozuldu: SEÇİM satırını (GRAMAJ=50GR) İSTASYON OPERATÖRÜ yazar, hedef listesi değil. Düzelt (`applyManualProperties`) ve `updateTargetProperties` artık **yalnız BAYRAK satırlarını** replace eder (`property: { valueType: "FLAG" }` süzgüsü + create tarafında `partitionTargetableIds`); koşulsuz replace, planlamacı hedefe her dokunduğunda operatör seçimini sessizce silerdi. `propertyIds=[]` bile CHOICE satırına dokunmaz.
>   - **CHOICE HEDEF OLAMAZ — İKİ KATMAN.** Aktif seçim yapan 9 kapı (`WO create/replace/updateTargetProperties` · KK1 girişi · sipariş kalemi · rota adımı · ürün izinli ×2 · fason kabul) `assertTargetablePropertyIds` ile **adıyla 400**; mevcut listeyi geri yollayan echo uçları `partitionTargetableIds` ile **sessizce böler** (echo'yu 400'lemek, GRAMAJ'lı topun renk düzeltmesini imkânsız yapardı). İstemci süzgüleri: Electron `isTargetableProperty` + `PropertyChipsField valueType:"FLAG"` · mobil `useQuickWorkOrder` picker süzgüsü + `chooseRoute` planProps süzgüsü (rota select'i `valueType` döner; eski backend alanı göndermez → süzgü devreye girmez).
>   - **TİP GEÇİŞ KİLİTLERİ (F5/SEK-3):** `KAT` sistem karakteristiğidir, tipi HİÇ değiştirilemez · CHOICE→FLAG değer listesi/kullanım varken 400 · FLAG→CHOICE AUTO bağı varken (istasyon adıyla) / hedef pivotlarında kullanılırken / values'suz 400. `assertChoiceHasValues` sayacı yazma yolunun `isActive ?? true` varsayımıyla hizalandı (isActive'siz gönderen istemci sahte 400 yiyordu).
>   - **SOYAĞACI valueId TAŞIR (F6):** Tambur kesim çocukları (4 yol) + finalize + undo geri-kurulumu + fason kısmi sevk çocuğu — hepsi `valueId`'yi kopyalar; düşürülseydi çocuk "gramajı belirsiz" doğardı.
>   - **GÖRÜNÜRLÜK (VAL-02/03/04):** relabel-context `properties[].value` taşır → Düzelt diyaloğu SEÇİM'i salt-okunur çip basar ("GRAMAJ: 50 gr", değer istasyonda seçilir); mobil Tambur karar başlığı + Depo kartı çipleri değeri basar. `CapabilitiesEditSheet`'te CHOICE satırının AUTO tuşu disabled (backend zaten 400 — kilit hatayı Kaydet'e saklamamak için).
>   - ⚠️ **TAMBUR_1/KAT MODU OPTIONAL (SEK-5) — REQUIRED yalancı beyandı:** Tambur akışı capability kapısını HİÇ çağırmıyor (kat kolon-projeksiyon istisnası; UI zorunlu sorar, backend eski-APK sözleşmesi gereği null fallback kabul eder). Seed'ler OPTIONAL yazar; eski seed'le koşmuş kurulumda tek seferlik UPDATE (deploy dokümanı §11). **Yazılı ayrım:** *İSTASYON ekranı yeteneği adım payload'ından (Kurşun/QC2 → open-cards `stepSummary.properties`), PLANLAMA ekranı katalogdan (Tambur kat tuşları + Hızlı İş Emri → `code=KAT`) okur.* `GET /station-capabilities/for-session` bugün İSTEMCİSİZ — yorum + Swagger bunu açıkça söyler, "buradan çiziliyor" diye okuma.
>   - **Cila:** completeQc2 tekrar-basışta FARKLI seçim gönderilirse artık audit'lenir (`UPDATE` + `reappliedSelections` — değer düzeltmesi kayıtsız kalmaz); kursunFinish audit'i `selections` taşır; üç ucun Swagger'ı mod+değer sözleşmesini anlatır; `schema.prisma`'nın "kat serbest metin" / "değer RollOperation metadata'ya yazılır" bayat yorumları düzeltildi.
>   - Bekçiler: `scripts/test_property_targetable.ts` (22 kontrol — 9 kapının kaynak taraması körlük zeminli + WO/rota/ürün işlevsel 400'ler + geçiş kilitleri; **iki negatif sondayla** kırmızı verdiği doğrulandı: item kapısı silinince 3, KAT kilidi kalkınca 1) · `test_property_value_selection.ts` genişletmesi (yukarıda). ⚠️ Sipariş kalemi / fason kabul / KK1 kapıları işlevsel olarak DEĞİL kaynak taramasıyla kilitli (fixture maliyeti); kapı taşınırsa sayaç güncellenmeli.
> • **Migration + veri göçü + backend + Electron + APK aynı pencerede.** Veri göçü: `scripts/seed_fold_catalog_and_modes.ts` (dry-run varsayılan). Yeni izin YOK (`station-capabilities/for-session` mevcut `MOBILE_SESSION_PERMS`'i kullanır). ⚠️ *"Değer eklemek artık sürüm istemiyor"* vaadi **bu sürümden SONRASI** için geçerli — eski APK sabit iki tuşu göstermeye devam eder. Bekçiler: `scripts/test_fold_catalog.ts` (24) · `test_station_property_mode.ts` (19) · `test_station_capability_flags.ts` (17) — üçü de negatif sondayla kırmızı verdiği doğrulandı; mobil `useMachinePeripherals.test.ts` 6→12 kontrol.

> **NOT (2026-08-09 — RAPOR TEMELİ: topun ÜRETİM ZAMANI artık şemada; Kalite Karnesi):** Rapor denetiminde çıkan kök sorun: **her dönem-bazlı rapor "bu top ne zaman bitti" sorar ve bu bilgi şemada HİÇ YOKTU.** `Roll` yalnız `createdAt`/`updatedAt`/`cancelledAt`/`labelPrintedAt` taşıyordu; `finalizeRollsAtLastStep` topu WAREHOUSE'a çekerken hiçbir damga yazmıyordu; hareketten türetmek de **çalışmıyordu** (ölçüm: bitmiş topların HİÇBİRİNDE kapanmış `RollMovement` yok — Tambur kesim çocuğu ve elle eklenen top hiç hareket görmez, ebeveyni görür). Geriye tek seçenek `updatedAt` kalıyordu ve o **yasaklı** ("Buraya geliş ≠ oluşturma" notu: etiket yeniden basımı / not düzenlemesi de günceller). Fire raporu bugüne kadar tam o kumun üstündeydi. Migration `20260809090000_roll_production_timestamps` (iki nullable timestamptz → metadata-only).
> • **`Roll.finalizedAt`** = topun üretimden çıkıp nihai rafına girdiği an — kalite/fire/fason karnelerinin dönem çıpası. **`Roll.statusChangedAt`** = her statü geçişinde tazelenir; stok yaşlandırma/FIFO'nun (CLAUDE.md'nin "ayrı kolon gerekir" dediği şey) çıpası. **İkisini karıştırma:** yaşlandırma *"kaç gündür bu rafta"*, karne *"ne zaman üretildi"* sorar. `statusChangedAt`'e index BİLİNÇLİ eklenmedi (tüketicisi Stok Karnesi henüz yazılmadı; `rolls` zaten en çok indeksli tablo).
> • ⚠️ **YAZAN BİR TRIGGER'DIR, uygulama kodu DEĞİL** (`roll_stamp_production_timestamps`, BEFORE INSERT OR UPDATE). Gerekçe: `Roll.status`'e yazan **40+ çağrı noktası** var; birini atlamak raporda **sessiz eksik** demek (hata yok, log yok, o toplar hiçbir dönemde görünmez). Trigger atlanamaz — ham SQL bile geçemez — ve tek satır uygulama kodu değiştirmediği için mevcut yolların hepsi bayt-bayt aynı kaldı. Envanter + bekçi: `scripts/test_db_invariants.ts` **§6** (yeni bölüm; Prisma trigger'ı şemada temsil edemez → diğer şema-dışı nesnelerden farkı: partial index kaybolursa sorgu yavaşlar, **trigger kaybolursa veri hiç yazılmaz**).
> • ⚠️ **KAYNAK STATÜ LİSTESİ LOAD-BEARING.** Damga yalnız üretim tarafı statüden (`IN_PRODUCTION`/`STOCK`/`AT_SUBCONTRACTOR`/`RETURNED_FROM_SUBCONTRACTOR`) final statüye (`WAREHOUSE`/`A1_STOCK`/`SCRAP`) geçişte yazılır. **`SHIPPED` ve `CANCELLED` bilerek DIŞARIDA:** `SHIPPED → WAREHOUSE` sevk storno/iadesidir ve içeride olsaydı bir storno, aylar önce üretilmiş topu **BUGÜNÜN** karnesine sokup iki dönemi birden yanlışlardı. Doğrulandı (negatif sonda: SHIPPED listeye eklenince bekçi kırmızı).
> • ⚠️ **DAMGA ÜZERİNE YAZILIR (write-once DEĞİL).** Depo topu yeni bir iş emrine girip tekrar finalize olursa tazelenir — çünkü `qualityGradeId` de tazelenir. Sabitlenseydi top **ESKİ tarihle YENİ kaliteyi** taşırdı. Invariant: *`finalizedAt` her zaman mevcut `qualityGradeId` ile AYNI olaydan gelir.*
> • **Geçmiş `system_logs`'tan kurtarıldı:** `scripts/backfill_roll_production_timestamps.ts` (dry-run varsayılan, idempotent, **ham SQL ile yazar** — Prisma `update` `updatedAt`'i tazeler ve envanter sekmelerinin "Son İşlem" sıralaması tam o kolondan çözüldüğü için script SAHADAKİ HER LİSTEYİ yeniden sıralardı). Kuralı trigger ile **birebir aynı** olmak zorunda; ayrışırsa rapor backfill'in bittiği gün sessizce zıplar. İzi bulunamayan toplar tek tek **listelenir** (gizlenmez).
> • **KALİTE KARNESİ** (`GET /api/reports/quality/scorecard`, `report:quality`) — metraj ağırlıklı kalite dağılımı; kırılım kumaş × renk × fason × gün; dönem karşılaştırmalı. **Ölçü METREDİR, adet değil** (1000 m 1. kalite ile 5 m 2. kaliteyi 1'e 1 saymak oranı anlamsız yapar). Kapsam `K18_DEAD_STATUSES` dışlar (tüketilmiş ebeveyn metrajını çocuklarına devretti → ikisini de saymak aynı kumaşı iki kez saymak) ama **`SCRAP` DIŞLAMAZ** (fire gerçek bir üretim sonucudur ve karnenin ölçmesi gereken şeydir).
> • ⚠️ **"1. KALİTE" KODA GÖMÜLMEZ.** Başlık metriği *"katalogda en üst sıradaki kalitenin payı"*dır ve `quality_grades.sortOrder`'dan çözülür; ekran başlığını da o addan yazar. `code === "1.KALITE"` araması bu fabrikada çalışır, kaliteyi yeniden adlandıran fabrikada **sessizce boş karne** üretirdi. Bekçi bunu kaynak taramasıyla mekanik doğrular.
> • ⚠️ **FASON ATFI ÜÇ KOVALIDIR.** Ölçüm: fason dönüşünde doğmuş 21 topun yalnız 6'sında `parentReceiptId` dolu. Yalnız JOIN'e bakılsaydı kalan 15 top **"Fabrika içi"** satırına yazılırdı — eksik veri değil **YANLIŞ ATIF**: fasonun ürettiği kaliteyi fabrikanın hanesine yazmak, raporun var oluş sebebi olan sorunun (hangi boyahane iyi çalışıyor) tam tersini söyler. Üçüncü kova (`Fason (firma belirsiz)`) bu yüzden var; `entrySource` sorguda **load-bearing**.
> • **GERİYE DÖNÜK DÜZELTME (restatement) BİLİNÇLİDİR:** depo topu sonradan kesilirse ebeveyn üretildiği dönemin karnesinden düşer (metrajı artık çocuklarında); kalite sonradan "Düzelt" ile değişirse eski dönem yeni kaliteyle okunur. İkisi de sektör pratiği; alternatif (aynı kumaşı iki dönemde saymak) açıkça yanlıştır. Metraj `currentQty`'dir — finalize anındaki değer saklanmıyor.
> • **DÖNEM KARŞILAŞTIRMA ortak katmanda** (`reports/_shared.resolveCompareRange`): `prev` (aynı uzunlukta hemen önceki pencere — takvim ayı DEĞİL, çünkü kullanıcı 12 günlük aralık seçebiliyor) · `prevYear` (**takvim** yılı kaydırması, 365 gün değil) · `custom`. `prev`'in bitişi ana dönemin başlangıcından **1 ms önce** — iki pencere bitişik ama çakışmaz; çakışsaydı tam da ölçülen fark bozulurdu. Karşılaştırma istenmezse ikinci sorgu **hiç koşmaz**.
> • **EXPORT: TEK SPEC → ÜÇ ÇIKTI** (`Reports/_components/reportExport.ts`). Excel · PDF · Yazdır aynı `ReportExportSpec`'ten türer; ayrı ayrı yazmak "aynı başlık altında farklı rakam" demekti (bu projede bir kez yaşandı). Bekçi kolon kümesi eşitliğini **mekanik** doğrular (`reportExport.test.ts`). Rapor PDF'i `document-render/` dünyasına **girmez** — orası müşteriye giden resmi belgelerin (donmuş snapshot/versiyon/revizyon) alanı; karıştırılırsa ikisi de zarar görür.
> • **DÖRT KARNE DAHA + MENÜ SADELEŞTİRMESİ (aynı gün, ikinci tur).** Rapor menüsü **20 → 13**'e indi (17 kaldırıldı, 8 yeni yüzey eklendi). Yeni karneler ve her birinin kilitlediği kural:
>   - **Fire Karnesi** (`quality/scrap-scorecard`) — hurda metrajı + nedeni. **Kalite Karnesi ile AYNI evren**: `producedQty` ↔ `totalQty` birebir (bekçide kilitli), yoksa aynı ay için iki "üretim" rakamı dolaşıma girerdi. ⚠️ **İKİ ÇIPA, İKİ BİRİM**: hurda `finalizedAt` + METRE, hata tespiti `RollError.detectedAt` + ADET. Farklı birim bilinçli — toplanmaması gereken iki sayı aynı birimde basılmaz. ⚠️ Hata bağı `LATERAL … LIMIT 1`: düz JOIN, iki hatalı 100 m'lik topu **200 m hurda** gösterirdi. ⚠️ **"Kesim kaybı" metriği BİLİNÇLİ OLARAK YOK** — ölçüldü: tüketilen ebeveynin `currentQty`'si sıfırlanıyor, naif `Σ(initial−current)` **2522 m'lik hayali kayıp** raporluyordu; ebeveyn↔çocuk dengesi de tutarsız (0 metrajlı ebeveynler, açıklanamayan ±200/−50 m). Kesim-olayı kaydı doğana kadar yazılmayacak.
>   - **İade Karnesi** (`sales/return-scorecard`) — `RollReturn` verisinin Raporlar'daki İLK yüzeyi. ⚠️ **Payda BRÜT** (brüt kuralının 5. tüketicisi): net paydayla oran şişer ve **tam da en çok iade alınan dönemde en çok şişer**. ⚠️ Sebep ÜÇ DURUMLU (katalog / serbest metin / boş) ve serbest metinler TEK kovada — sayının kendisi *"katalog eksik"* sinyalidir. ⚠️ Oran KOHORT DEĞİL (bu ay gelen iade geçen ayın malı olabilir) ve bu hem ekranda hem Excel'de yazılı.
>   - **Fason Karnesi** (`subcontract/scorecard`) — sahada tartışılan rakam: **fason firesi**. ⚠️ Fire yalnız **KAPANMIŞ** kalemlerden hesaplanır; açık kalem paydaya girseydi dün sevk edilen parti %100 fire görünürdü (bekçide: %4 ↔ %68). ⚠️ Dönen metraj **TÜM** kabul satırlarının toplamıdır — mevcut `subcontract.report.service`'in `DISTINCT ON`'u orada doğruydu (bool + süre) ama metrajda 100 m'lik topun 2×48 dönüşünü 48 sayıp **52 m sahte fire** yazardı. ⚠️ Doğrudan sevk + iptal kapsam dışı.
>   - **Sevk & Termin (OTIF)** (`sales/shipment-scorecard`) — sevk hacmi + zamanında teslim. ⚠️ **Terminsiz sipariş orana GİRMEZ ama gizlenmez**: "zamanında" saymak oranı sahte yükseltir, "geç" saymak haksız düşürür; doğru olan paydadan çıkarıp sayıyı ayrıca göstermektir (bekçide %66,7 ↔ %50).
>   - ⚠️ **"DÖNEMDE SEVK EDİLEN METRAJ" TEK TANIM: `reports/_shipped.ts`.** İade Karnesi'nin PAYDASI ile OTIF'in BAŞLIK metriği aynı sorudur; ayrı yazılsalardı biri doğrudan sevkleri, diğeri iade geri-eklemesini unuturdu. Doğrudan sevkte metraj **denormalize `totalQty`**'dir (Sevkiyatlar ekranı onu kullanır) ama kırılım topları ister → fark, kumaşı bilinmeyen bir **mutabakat satırı** olarak eklenir: toplam ekranla birebir kalır, kırılım uydurma kumaşa yazılmaz.
>   - ⚠️ **`_shipped.ts`'teki `status = 'DISPATCHED'` süzgecinin kaybını BEKÇİ GÖREMEZ** (ölçüldü, yeşil kalıyor): storno `dispatchedAt`'i NULL'ladığı için aralık süzgeci PLANNED'ı zaten eliyor. Süzgeç o invariant'a *güvenmemek* için duruyor — silmeden önce onu kimin koruduğunu bil.
>   - **Kaldırılanlar ve gerekçeleri** (tile-config dosyalarında da yazılı): Hata Türü Dağılımı · İstasyon Hata Oranı · QC2 Kararları (→ Fire Karnesi) · Kurşun Uygulama Oranı (yönetim sorusu değil; iki bağımsız sayacı oranlıyordu) · Sipariş Gerçekleşme · Geç Teslimat (→ OTIF; eskisi tarih aralığı ALMIYORDU) · Fasoncu Performansı · Açık Fason Sevkleri (→ Fason Karnesi) · Fire & Hurda (→ Fire Karnesi; eskisi günü `rolls.updatedAt`'ten alıyordu) · Makine Kullanımı (veri kapsamı ~%31 ve bu bilinçli) · Hareket Geçmişi · Alias Eşleştirme (veri hijyeni sayacı, karar değiştirmiyor). "Operatör Performansı" → **"Operatör İş Hacmi"** (sıralama/performans ölçüsü olarak sunulmuyor). Ölü servisler/uçlar/sayfalar da silindi; `test_reports.ts` kalan dört rapora daraltıldı (fixture kurulumu bilinçli olarak korundu — bölüm bazlı kesim zinciri koparıyordu).
> • **ÜÇÜNCÜ TUR — kalan üç yüzey de yazıldı (aynı gün):** menü **20 → 13**, kaldırılan toplam **17**.
>   - **Nerede Takıldı (WIP)** (`production/wip`) — İstasyon Verimliliği'nin yerine. ⚠️ **İKİ ZAMAN ANLAYIŞI TEK EKRANDA:** *bekleyen* ANLIK SNAPSHOT'tır (tarih filtresi onu ETKİLEMEZ — "şu an nerede takılı" sorusunu filtrelemek planlamacıyı yanıltırdı), *geçen* dönemseldir. ⚠️ İstasyon listesi **iki kümenin BİRLEŞİMİ**: dönemde iş geçirmiş ama şu an boş istasyon da satır alır ("boş mu, hiç mi çalışmadı" sorusu operatörü durdurur — Kurşun Planlama sekme dersinin aynısı). ⚠️ Ortalama bekleme **TOP AĞIRLIKLI** (1 toplu ile 50 toplu istasyonu eşit saymaz). ⚠️ Eski raporun `qtyIn/qtyOut` fark kolonu **HİÇ BASILMAZ** — `qtyOut = qtyIn` tasarım gereğidir.
>   - **Stok & Ölü Stok** (`inventory/scorecard`) — Rulo Yaşlandırma + Stok Dağılımı birleşti. Çıpa **`Roll.statusChangedAt`**. ⚠️ **ÖLÜ STOK = ESKİ **VE** SİPARİŞSİZ**; ikisinden biri tek başına sorun değildir ve raporun tüm değeri KESİŞİMDEDİR (bekçi: yalnız eskiye baksa +400, yalnız siparişsize baksa +500, doğrusu +300). ⚠️ Siparişsizlik **SPEC bazındadır** — hangi FİZİKSEL topun karşılıksız olduğu iddia edilmez (edilseydi keyfi olurdu). ⚠️ Çıpası olmayan top yaş kovalarına **DAĞITILMAZ** ama metrajı toplama girer ve sayısı ayrıca basılır: *"yaşı bilinmiyor" ≠ "yeni"*, ikincisine yuvarlamak ölü stoğu sistematik olarak gizlerdi. Talep tanımı `production-balance` ile birebir. ⚠️ **`[status, statusChangedAt]` index'i EKLENMEDİ** — 99 satırda EXPLAIN seq-scan cezası göstermiyor ve `rolls` 19 indeksli; TETİKLEYİCİ dosya başlığında yazılı (~50k satır ya da EXPLAIN'de Seq Scan).
>   - **Parti İzleme** (`production/batch-trace`) — İZLEME ÇİFT YÖNLÜ oldu: Top İzleme İLERİ (top → istasyonlar), bu GERİ (parti → hangi müşteriye ne gitti). Şikâyet geldiğinde etki kümesini bulmanın tek yolu buydu ve hiçbir ekranda yoktu. ⚠️ **PARTİ NUMARASI BENZERSİZ DEĞİL** (P01…P99 döner, `@unique` kalktı) → arama **DAİMA aday listesi** döner, izleme `batchId` ile yapılır; tek sonuç varsaymak aynı numaralı BAŞKA partinin müşterilerini göstermek olurdu. ⚠️ **İADE EDİLMİŞ TOP MÜŞTERİ LİSTESİNDEN DÜŞMEZ** — iade `Roll.shipmentId`'yi NULL'lar, yalnız canlı bağa bakmak malı iade eden müşteriyi siler ve o, şikâyet araştırmasında **en çok aranan** müşteridir (`RollReturn.fromShipmentId` ile geri eklenir — brüt kuralının izleme karşılığı). ⚠️ Kesim çocuğu partiyi miras alır → tek `batchId` sorgusu yeter; ayrı soyağacı gezintisi çocukları iki kez sayardı.
>   - Bekçiler: `test_wip_scorecard` (19) · `test_stock_scorecard` (13) · `test_batch_trace` (15) — üçü de negatif sondayla kırmızı verdiği doğrulandı. ⚠️ İki sonda ilk yazımda **yeşil kaldı ve fixture düzeltildi**: WIP'te ağırlıklı ortalama (fixture'da ağırlık farkı yoktu) ve Stok'ta ölü stok eşiği (mutlak eşik gevşekti → temel ölçüp FARK kontrol edildi). Ayrıca WIP fixture'ı **geçmişe** kurulur, diğer karneler gibi geleceğe değil: ana metrik YAŞ ve gelecek tarihli hareket negatif yaş üretiyordu.
>   - **DURANLAR:** Top İzleme · Operatör İş Hacmi · Müşteri Sipariş Profili · iki Denetim raporu. Denetim ikilisi Sistem'e taşınacak (ayrı iş); diğerleri bilinçli olarak duruyor.
> • **Migration + backend + Electron aynı pencerede; APK gerekmez** (mobil dokunulmadı). **Deploy reçetesi: `docs/ops/SURUM-2026-08-09-RAPORLAR-DEPLOY.md`.** ⚠️ Sahada **`backfill` script'i migration'dan sonra koşulmalı** — atlanırsa Kalite · Fire · Stok karneleri geçmişsiz başlar (diğer beş yüzey etkilenmez) ve bunu ekrandaki uyarı bandı söyler, yani sessiz değildir. **Aciliyet ölçüldü ve düşük:** script idempotent, yalnız NULL doldurur, istendiği zaman koşulabilir; gerçek son tarih audit arşivlemesidir (`MONTHS_TO_KEEP=6`, en eski ROLL kaydı 2026-07-16 → ~2027-01). Bekçiler: `scripts/test_quality_scorecard.ts` (30 kontrol — rapor + trigger birlikte; **dört negatif sondayla** kırmızı verdiği doğrulandı: K18 dışlaması kalkınca 6, fason kovası kalkınca 3, metraj yerine adet sayılınca 12, trigger'a SHIPPED eklenince 1) · `test_db_invariants.ts §6` · Electron `reportExport.test.ts` (9 kontrol, iki negatif sonda).

> **NOT (2026-07-13 — "her rota final üretir"):** Fabrika jenerik bir operasyon servisi — bir WO herhangi bir işlem dizisidir, **son adımın çıktısı her zaman final ürün** (`finalizeRollsAtLastStep`). **Tambur zorunlu değil:** rota Kurşun/QC2 ile bitebilir (→ açık kumaş final) veya **fason (boyahane) ile bitebilir** (fason kabulü finalize eder — doğan açık-kumaş toplar `WAREHOUSE` + barkod, `form=ACIK`; eski STOCK-orphan limbosu kalktı). **top ⟺ Tambur; açık kumaş ⟺ diğer istasyonlar.** **`Roll.form` (TOP|ACIK)** otomatik. **`Roll.qualityGrade` NULLABLE** — kaliteyi yalnız kalite istasyonları (KK1 opsiyonel giriş, KK2/Kurşun, Tambur) belirler; kalitesiz top UI'da "—", istatistikte "Belirsiz". **WO artık `WAREHOUSE`/`A1_STOCK` topu da tüketir** (bir depo topu yeni WO'ya sokulabilir — örn. zımpara ya da WAREHOUSE açık kumaşı Tambur'a; finalize geri döndürür; detach: renksiz→STOCK, renkli→kalite/WAREHOUSE; çuval/sevkteki top bağlanamaz). Süpervizör **"Durum Düzelt" + "recover-to-production" KALDIRILDI** → yerine **IN_PRODUCTION-stuck "Kurtar"** (istasyonda takılı topu güvenle depoya al: açık movement kapanır, barkod üretilir, adım/WO recompute; `roll:manual-adjust`).
> ⚠️ **2026-09-03 DÜZELTMESİ:** Bu notun "kaliteyi yalnız kalite istasyonları (KK1 opsiyonel giriş, **KK2/Kurşun**, Tambur) belirler" cümlesi bugün YANLIŞTIR: `PROCESS_QC` kalite NOTU YAZMAZ — `Teks-Erp/src/services/kursun-qc.service.ts` içinde `qualityGrade` hiç geçmez (0 eşleşme); o istasyonun işi hata toplamak ve `QC2_COMPLETED` izi bırakmaktır. Kalite bugün İKİ kapıda doğar: KK1 girişi (`inventory.service`) ve Tambur finalize. ⚠️ Ayrıca "Tambur zorunlu değil / son adım finalize eder" kuralı ÇEKİRDEK'tir; "fabrika çözgü/dokuma yapmaz" ise PROFİL — bkz. MODUL-BAYRAK-TASARIM §5.1/§5.2.


> **NOT (2026-08-19 — Tambur plan-gerçek sapma kapısı + "Sipariş Bağla" [v1+v2] + planlamacı dağılım bandı):** Saha senaryosu: İE MAVİ açıldı, mal boyandı, tamburda beklerken müşteri "gri olacaktı" dedi; planlamacı hedefi GRİ'ye çevirdi (`changeTargetColor` sebep+izli) ama **elinde 12 topun ZATEN MAVİ boyandığını ekranda görmüyordu** ve tambur operatörü mavi topu tek kelime uyarı görmeden depoya indiriyordu — eski `colorWarning` yalnız yanıt `message`'ına yazılıyordu ve **tablet o alanı hiç okumuyordu** (ölü uyarı), üstelik yalnız "renksiz" topu kapsıyordu. Yanlış, en pahalı yerde (sevkiyatta) patlıyordu. Üç parça:
> • **TAMBUR ONAYLI DEVAM (blok değil — SAP "usage decision" karşılığı):** Üç depo-indiriş yolu TEK ortak yüklemden geçer (`helpers/tambur-plan-gate.helper.assertRollMatchesPlan`; kopyalanırsa biri ayrışır): `finalize` (kart cuts modeli) + `cutOpenFabric` (**per-cut modelde çocuk KESİM ANINDA depoya iner — kapı bitirmeyi bekleyemez**) + `finalizeOpenFabric` (yalnız `keep_*`; **scrap/discard kapı DIŞI** — fire satılabilir stok üretmez, sormak gürültü). Sapma varsa 409 `PLAN_MISMATCH` (`details.mismatches[]` insan-okur satırlar); operatör tablette onaylarsa AYNI istek `confirmMismatch:true` ile gider ve **imzalı karar audit'e düşer** (`TAMBUR_PLAN_MISMATCH_CONFIRMED`, `source` alanıyla hangi yoldan). Onay **TOP başına BİR KEZ** (`planMismatchConfirmedRef`) — seri kesimde her parçada sormak operatöre uyarıyı okumamayı öğretirdi. **Onay topun kaydını DEĞİŞTİRMEZ** (mal neyse o iner; düzeltme ayrı bilinçli işlem).
> • **Kapsam (kullanıcı kararı): renk + EŞİKLİ en.** Renk: hedeften farklı **VEYA** hedef varken renksiz. **Ters yön BİLİNÇLİ KAPSAM DIŞI** (hedef renksiz + top boyalı = zımpara WO'suna giren boyalı depo topu, meşru). En: `|fark| > TAMBUR_PLAN_WIDTH_TOLERANCE_CM` (=10; **eşit fark sapma DEĞİL**; `constants/tambur-plan-gate.ts` — panelden ayar istenirse DÖRT KAPI kuralıyla). Kalite bilinçli dışarıda (kalite kararını ZATEN tambur verir). ⚠️ Zod tanımadığı anahtarı sessizce siler — `confirmMismatch` üç şemaya da eklendi (`finalizeSchema`/`cutOpenFabricSchema`/`finalizeOpenFabricSchema`; `finalizeWarehouseCutSchema`'ya BİLEREK eklenmedi, o yolda WO yok) ve **offline kuyruk mutationFn'i elle gövde kurar** — `offline/mutations.ts`'e alan eklendi + `mutations.test.ts` sözleşme testi (varianceReason dersinin ikizi; sonda: satır düşünce kırmızı). Idempotent-retry erken dönüşleri kapıdan ÖNCE — onaylanmış işin replay'i kapıya çarpmaz.
> • **TAMBUR "SİPARİŞ BAĞLA" (üst şerit tuşu, yalnız `workorder:write` taşıyanda — 403'lük gri buton çizilmez):** `TamburOrderLinkSheet` iki sekme: **Uygun** (`GET /:id/linkable-order-lines` — kumaş+renk backend süzer, en farkı uyarı çipi) + **Tümü** (`/orders/order-lines/available` cursor'lu, 800ms debounce arama + müşteri/kumaş/renk filtresi [`OrderLineFilterSheet` yeniden kullanıldı] + En input'u; `width` parametresi mobil cursor helper'a eklendi). Uyumsuz satır GRİ + sebep çipi; **uyumsuz seçim YETKİYLE açılır, soruyla değil** (mükerrer-modal dersi: acele eden operatör onay ekranını okumaz): `roll:manual-adjust` taşımayana satır ölü, taşıyan süpervizör seçince "elindeki GERÇEKTEN bu mu?" soruları + zorunlu sebep. İki guard genişletildi ("yazabilen okuyabilir"): `linkable-order-lines` + `order-lines/available` any-listesine `workorder:write` eklendi.
> • **OVERRIDE ZİNCİRİ `POST /:id/order-links/override` (kullanıcı kararı: top + WO hedefi + bağ TEK uçta):** sırayla ① plan düzelt (`changeTargetColor`/`changeWidth` — kendi sebep+audit'leriyle) ② iş emrinin düzeltilebilir TÜM toplarını eşitle (`applyAttributeToRolls` → tekil motor; kısmi başarı bilinçli, fasondaki/sevkteki top `rollsFailed[]`e düşer ve tablet bunu toast'la yüzüne söyler) ③ bağı kur. **KUMAŞ (cins) FARKI HER ZAMAN 400** — topun cinsi hiçbir yoldan değiştirilemez (`applyManualProperties`'te alan bilinçli yok); zaten-uyumlu satır da 400 ("yanlış kapı" — normal bağla). **ÇİFT yetki kapısı route'ta AND** (`workorder:write` + `roll:manual-adjust` iki ayrı `requirePermission`) + F221 çift emniyeti (permissions tekil motora da geçer). ⚠️ **TEK TX DEĞİL — BİLİNÇLİ:** her adım kendi başına meşru; sıra öyle ki sonraki adımın düşmesi öncekini yanlışlamaz (plan düzeltmesi bağ kurulamasa da doğrudur — gerçek buydu diye onaylandı).
> • **PLANLAMACI DAĞILIM BANDI (Electron `ChangeTargetDialog`):** "Rengi/Eni Değiştir" açılınca amber bant: "Bu iş emrinde şu an: **12 top MAVİ · 3 top renksiz**" (+renk modunda "boyanmış mal için renk değişikliği kâğıt işi değildir — redye ya da stok" hatırlatması). Veri zaten `roll-attribute-targets`'tan iniyordu, yalnız özetlenmedi; saf panel işi.
> • Bekçi: `scripts/test_tambur_plan_gate.ts` (28 kontrol; **dört negatif sondayla** kırmızı verdiği doğrulandı — kapı throw'u kalkınca 8+, eşik `>=` olunca 1, kumaş sert engeli kalkınca 1, cut kapısı kalkınca 1) + mobil `mutations.test.ts` kuyruk sözleşmesi (1 sonda). Migration YOK, izin kataloğuna yeni kod YOK (mevcut kodlar); **backend + Electron + APK birlikte gitmeli** (eski APK kapıya çarpınca `confirmMismatch` gönderemez — ham 409 mesajı görür, akış kilitlenmez ama onaylayamaz; bu yüzden bayraksız kademeli değil, pencere birlikte).

> ✅ **ÇEKİRDEK:** "`code` rapor anahtarıdır ve ASLA değişmez, `label` serbest", üç kademeli okuma (sunucu → cihaz → APK zemini; boş liste operatörü kilitler), "silme yok/son aktif satır gizlenemez", uzlaştırma YALNIZ EKLER — kataloğun SAHİBİNİ fabrikaya vermek tam olarak çok-fabrika tasarımının istediği şeydir; yeni kind eklerken beş kapı birlikte güncellenir.

> **NOT (2026-08-19 — "Top başı" + hazır sebep katalogları KODDAN DB'ye):** Saha isteği iki cümleydi: *"tamburda fire girerken çıkan hazır mesajların en başına **top başı**nı koy"* ve ardından *"bu mesajları tambur isterse **kendi düzenleyebilsin** — her birinin yanına düzenleme ve çoğaltma tuşu, elle yazacaksa input **en altta değil en üstte** olsun"*. İkisi ayrı büyüklükte işlerdi: birincisi iki satırlık katalog düzenlemesi, ikincisi katalogun **sahibini değiştirmek**.
> • **DÖRT LİSTE TEK TABLODA (`ReasonPreset`, migration `20260819170000`):** fire (`ROLL_SCRAP`) · kayıt düzeltmesi (`ROLL_RECORD_CORRECTION`) · elle top ekleme (`ROLL_MANUAL_ENTRY`) · top iptali (`ROLL_CANCEL`). Öncesinde dördü de **kodda** yaşıyordu (`constants/variance-reasons.ts` + mobil `manualReasons.ts` / `cancelReasons.ts`) ve fabrikanın kendi diliyle sebep eklemesi **her seferinde bizim deploy'umuza** bağlıydı.
> • **KOD ≠ ETİKET, bu tablonun VAR OLMA sebebi:** `code` doğuşta yazılır, **ASLA düzenlenmez** (düzenleme ucu alanı hiç kabul etmez) — `RollVariance.reasonCode` satırda saklı olduğu için etiketi düzeltmek geçmiş raporu BOZMAZ, kodu düzeltmek altı aylık fire kırılımını ikiye bölerdi. **İKİ KİND İSTİSNADIR** (`KIND_STORES_TEXT`): elle ekleme ve iptal, kayda kod değil METİN yazar (`Roll.entryReason` / `Roll.cancelReason` serbest metin kolonları) → orada gruplama metne dayanır ve metni düzenlemek geçmişi eski metinle bırakır; **her iki düzenleme yüzeyi de bunu operatöre açıkça söyler** (kolonu `Roll`a eklemek + backfill bilinçli olarak ertelendi).
> • **ÜÇ KADEMELİ OKUMA, sırası load-bearing:** sunucu → cihazdaki son liste (AsyncStorage) → **APK'ya gömülü zemin**. Üçüncüsü kaldırılamaz: Tambur çevrimdışı çalışıyor ve fire kararında sebep ZORUNLU, yani boş liste "operatör Kaydet'e hiç basamaz" = malın tamburda kilitlenmesi demek. ⚠️ Her kademe **kararlı referans** döndürür (`?? []` YASAK — 2026-08-15 saha çökmesinin kök nedeni; bkz. `useFoldValues` notu). Bekçi: `mobil/src/hooks/useReasonPresets.test.tsx` (3 kontrol, negatif sondayla kırmızı verdiği doğrulandı).
> • **DOĞRULAMA DİNAMİK AMA HÂLÂ SENKRON:** `validateVarianceReason` tx İÇİNDE ve senkron çağrılıyor (`roll-variance.helper`), bu yüzden DB'ye async gitmek yerine servis kendi **modül önbelleğini** `registerReasonCatalogSource` ile sabitlere KAYDETTİRİR (bağımlılık yönü korunur: services → constants, tersi değil). Önbellek her yazmada tazelenir, TTL 60 sn ikinci bir yazara karşı; önbellek boş/bayatsa **kod kataloğuna düşer**. ⚠️ **GİZLENMİŞ kod da geçerli sayılır** — bayat liste taşıyan bir tablet vardiya ortasında 400 almamalı (LEGACY_REASON_CODE ile aynı gerekçe); gizleme bir GÖRÜNÜRLÜK kararıdır, geçerlilik kararı değil. Uydurma kod hâlâ fail-closed reddedilir.
> • **SİLME YOK, GİZLEME VAR** + **son aktif satır gizlenemez** (400): liste boşalırsa fire kararında "Kaydet" sonsuza dek kapalı kalırdı. Sistem satırı (`isSystem`) her boot'ta uzlaştırılır (`jobs/reason-preset-catalog.job.ts`, izin/rol kataloglarının üçüncü fazı olarak AYNI zincirde — soğuk açılış yeniden-deneme politikası ortak); uzlaştırma **YALNIZ EKLER**, fabrikanın düzenlediği etiketi/sırayı/gizliliğini EZMEZ. Sert silme bir sonraki `pm2 restart`'ta DİRİLİŞ olurdu (rol şablonu dersi).
> • **İZİN FORMÜLÜ — yeni kod ÜRETİLMEDİ (bilinçli):** okuma yalnız `verifyToken` (liste zaten her operatör ekranında çiziliyor; ayrı okuma izni, atanmadığı her tablette Tambur'un sebep adımını 403'e düşürürdü), yazma `roll:manual-adjust` **VEYA** `mobile:tambur-duzelt` — ikisi de zaten "veriyi elle düzeltebilen güvenilir kişi" demek ve zaten atanmış. Yeni bir `reason-catalog:write`, sahada **atanması unutulacak bir adım daha** olurdu (2026-08-01 kurşun bypass vakası). Tambur ekranı bu formülü zaten `canFieldFix` olarak taşıyordu.
> • **YERLEŞİM (saha isteğinin özü):** fire/kayıt-düzeltmesi adımında serbest metin kutusu artık **listenin ÜSTÜNDE** ve her zaman görünür; yazmaya başlamak "Diğer"i **kendiliğinden seçer** (eskiden kutu listenin ALTINDAYDI ve yalnız "Diğer" seçilince beliriyordu → operatör sekiz satırı geçip dibe iniyor, sonra kutuyu bulmak için ikinci kez kaydırıyordu). Her satırın yanında **düzenle + çoğalt**; kopya kaynağın **hemen altına** düşer ve anında seçili gelir.
> • ⚠️ **İPTAL EKRANINDA SATIR İÇİ KALEM YOK, gerekçesi yıkıcılık:** o chip'ler 2026-08-06 kararıyla **dokununca topu iptal eder**; yıkıcı bir aksiyonun 4 mm yanına düzenleme tuşu koymak, ıskalanan her dokunuşu iptal edilmiş bir top yapardı. Orada tek bir "Sebepleri düzenle" tuşu var, düzenleme ayrı yüzeyde (`ReasonPresetManagerSheet`). Fire ekranında seçim yıkıcı değil (ayrı "Kaydet" var) → satır içi tuşlar güvenli.
> • **ELECTRON: TEK KART, DÖRT SEKME** (Tanımlar → Üretim & Kalite → **Hazır Sebepler**). Dört ayrı kart menüyü kalabalıklaştırırdı ve dördü aynı şeyin (operatöre gösterilen hazır mesaj) bağlamlarıdır. Kart ve route AYNI izni taşır (`roll:read`; ayrışma = görünen kart + `/forbidden`), düzenleme tuşları `roll:manual-adjust` yoksa **çizilmez** (gri buton olmayan bir yolu vaat eder). Sıralama ok tuşlarıyla; `PickerModal` seçenek kartlarına opsiyonel `optionActions` eklendi (verilmezse hiç çizilmez — diğer picker'ların yerleşimi aynen korundu).
> • Bekçi: `scripts/test_reason_presets.ts` (25 kontrol — uzlaştırma idempotentliği + fabrika düzenlemesinin ezilmemesi + kod sabitliği + son-aktif guard'ı + dinamik doğrulama + **mobil çevrimdışı zemininin birebir aynası**; iki negatif sondayla kırmızı verdiği doğrulandı). **Migration + backend + Electron + APK aynı pencerede; backend ÖNCE** (yeni sebep kodu gönderen tablet, katalogu tanımayan bir sunucuda "Geçersiz sebep kodu" alır).

> ⚠️ **PROFİL GERÇEĞİ:** Bu notun tamamı fason modülü (hizmet ALAN yön) altındadır ve fason kapalı kurulumda hiçbir yüzeyi yoktur; boyahane profilinde (hizmet VEREN yön) aynı akışın AYNASI ayrı tasarım işidir. **Çekirdek olan:** `clientToken @unique` replay kimliği, "kalem yalnız TAM satırla kapanır — 21 filtre noktası", LIFO iptal ve "karne dönen metrajı DEFTERDEN okur" — bkz. MODUL-BAYRAK-TASARIM §2, §10.

> **NOT (2026-08-19 — Fason KISMİ KABUL + kalan-kapama + parti kuralı):** Saha vakası: boyahaneye giden 100 m topun 51 m'si geldi, 49 m sonra gelecek. Eski model top bazındaydı — kabul topu TÜKETİYORDU (`SUBCONTRACTOR_CONSUMED`), "yarısı geldi" diye bir yol yoktu; operatör ya bekliyor ya 49 m'yi sessizce buharlaştırıyordu. Yeni model SAP fason kısmi mal girişinin karşılığı: **her teslimat AYRI makbuz, sevk kalemi metraj defteri taşır.**
> • **ÇEKİRDEK: kısmi kabulde top TÜKETİLMEZ** — `AT_SUBCONTRACTOR` kalır, `currentQty` atomik decrement ile kalana iner (kısmi SEVK'teki orijinal-decrement deseninin dönüş aynası; sınıflandırma tam/kısmi kararı WO kilidi ALTINDA taze metrajla verilir). `returns[].receivedQty` verilmez ya da kalanı aşar/eşitlerse **TAM kabul — eski APK davranışı birebir korunur** (clamp: deftere kalan yazılır). Adım kapanışı değişmedi: `stillAtSubcontractor > 0` olduğu sürece adım ACTIVE, kart okutulabilir, WO fason hard-block'u doğru şekilde devrede.
> • **DEFTER: `SubcontractorReceiptItem.receivedQty` + `isPartial`** (migration `20260819200000`, additive). NULL = eski satır ("tamamı kabul edildi"; raporda `COALESCE(receivedQty, roll.currentQty)` — tüketim anında currentQty = kabul edilen kalan olduğundan iki rejim aynı sayıyı verir). ⚠️ **Kalem yalnız TAM (isPartial=false) aktif makbuz satırıyla "dönmüş" sayılır** — TÜM outstanding filtreleri `none: { isPartial: false, receipt: { cancelledAt: null } }` okur (21 kullanım noktası güncellendi: isBatchLockedTx, listPendingReturns, firma çözümü F74, quick-receive, traveler-card uyarısı, envanter "Fason Bilgisi", split/merge/surgery helpers…). Bu güncelleme atlanırsa kısmen dönmüş sevk "kapandı" görünür ve İKİNCİ teslimatın firma çözümü "kaynak sevk bulunamadı" ile düşer.
> • **İDEMPOTENCY DEĞİŞTİ: `SubcontractorReceipt.clientToken @unique`.** Eski küme-eşitliği guard'ı ("aynı top kümesi → cached makbuz") kısmi teslimatta İKİNCİ gelişi yutardı — aynı top iki teslimatta MEŞRU olarak tekrar gelir. Kural: token varsa replay kimliği ODUR (iptal edilmiş makbuzun token'ı 409 `RECEIPT_CANCELLED` — KK1 emsali); küme-eşitliği guard'ı yalnız **tam-tüketimli** makbuzlar için devrede (`prior.items.some(isPartial) → continue`). Yeni istemciler (APK/Electron) her mantıksal denemede yeni token üretir, retry aynısını taşır.
> • **PARTİ KURALI (sektör: her mal girişi kendi lotu / boya lotu ayrımı):** ilk teslimat giden partiyi SÜRDÜRÜR; aynı sevkin **ikinci+ teslimatında doğan toplar YENİ parti alır** (`createBatchTx`, `splitFromId` = kaynak parti — K5 kalan-böl kuralının dönüş aynası). Tespit sevk-kapsamlı: kaynak sevkte önceki aktif makbuz satırı var mı (kendi makbuzumuz yazılmadan ÖNCE sayılır — sıra load-bearing). Tek seferde tam dönüşte hiçbir şey değişmez.
> • **MOVEMENT SÖZLEŞMESİ:** kısmi kabulde movement AÇIK kalır; SON teslimatta kapanır ve `qtyOut = COALESCE(qtyIn, currentQty)` (sevk edilen TOPLAM — kalanı yazmak istasyon hacmini eksik gösterirdi; tek-teslimat yolunda qtyIn==currentQty olduğundan davranış birebir aynı). RollOperation `SUBCONTRACTOR_RETURNED` unique'i (rollId, stepId, opType) yüzünden ikinci teslimatın satırı skipDuplicates ile düşer — teslimat teslimat iz MAKBUZ KALEMLERİNDEDİR, op "ilk dönüş olayı"nın izi olarak kalır.
> • **KALAN-KAPAMA (`POST /api/subcontractor/close-remainder`):** "kalan gelmeyecek" → top `SUBCONTRACTOR_CONSUMED`, kalan metraj **sapma defterine FİRE** (`RollVariance` SCRAP, yeni source `SUBCONTRACTOR_REMAINDER`, sebep ReasonPreset **ROLL_SCRAP** kataloğundan — yeni kind AÇILMADI, fabrika aynı listeyi düzenler; geçersiz kod 400 fail-closed) + sevk kalemi **`SubcontractorDispatchItem.remainderClosedAt`** damgası (damgasız + tam-makbuzsuz kalem outstanding filtrelerinde SONSUZA DEK açık kalır ve parti kilidi hiç açılmazdı). Kapama ELLE ve sebep zorunlu; otomatik zaman aşımı YOK — bekleyen listesi yaş bandı basar ("N gündür fasonda", 7+ gün amber). İzin formülü mevcut: `workorder:write` ∨ `mobile:fason-kabul`.
> • **İPTAL LIFO:** aynı topa dokunan daha YENİ aktif makbuz varken eski makbuz iptal edilemez (409 `RECEIPT_NOT_LATEST`; önizleme `laterReceipts` döner). Geri sarma iki dallı: TAM kalem statüyü geri çeker (metraja dokunmaz), KISMİ kalem metrajı atomik increment ile GERİ KOYAR (statü zaten AT_SUB; kalan-kapama araya girdiyse claim 409). Sıra: sondan başa.
> • **KARNE DÜZELTMESİ (eski kod fire'ı HEP %0 basıyordu):** `subcontract-scorecard` dönen metrajı **defterden** okur (`SUM(COALESCE(receivedQty, currentQty))`) — eski kaynak `initialQty` giden metrajın kendisini "döndü" sayıyordu (canlı kopyada doğrulandı: giden=dönen birebir). "Kapandı" = tam makbuz VAR ∨ `remainderClosedAt`; kısmi satırlar kalemi AÇIK bırakır ve açık bakiye = giden − kısmen dönen. Kalan-kapamayla kapanan kalemin süresi ölçülmez (dönüş yok — kapama tarihi teslim süresi değildir).
> • **YÜZEYLER:** Mobil Fason Kabul — her işaretli satırda "Gelen (m)" girişi (varsayılan = kalan; düşürmek = kısmi), YARIM rozeti (`kalan/sevk m`) + yaş bandı, 🔥 kalan-kapama modalı (serbest metin üstte + fire chip'leri — Tambur kalan-karar deseni), onay modalında kısmi özeti; `clientToken` payload kurulumunda üretilir (offline replay aynı token). Electron — İş emri detayı + yan panelde **"Fason Kabul"** butonu → `FasonReceiveDialog` (sevk başına kart: top bazlı checkbox + gelen m + parçalar + renk + irsaliye/not + satır içi 🔥 kapama); kapatma diyaloğundaki hızlı panel ile Konumu Düzelt inline kabulü DEĞİŞMEDİ (hep tam kabul gönderir — kısmi oradan yapılmaz, ince ayar diyaloğa taşındı).
> • **Bekleyen listesi zenginleşti:** `pending-returns` toplarına `dispatchedQty` + `dispatchedAt` iliştirilir (`attachOpenDispatchInfo`) — yarım-kalan rozeti ve yaş bandının veri kaynağı; alanlar yoksa (eski backend) istemci rozet çizmez.
> • Bekçi: `scripts/test_fason_partial_receive.ts` (43 kontrol; P1 kısmi decrement · P2 takip teslimatı + yeni parti · P3 token replay · P4 movement qtyOut=qtyIn · P5 LIFO iptal + metraj geri koyma · P6 kalan-kapama + variance + damga · P7 fazla dönen clamp · P8 bekleyen listesi zenginleştirme · P9 karne gerçek fire). **Üç negatif sondayla kırmızı verdiği doğrulandı:** küme-guard'ının kısmi-atlaması kaldırılınca 10, karne `initialQty`'ye dönünce 2, yeni-parti dalı kapatılınca 2. **Deploy: migration + backend ÖNCE** (eski APK'lar tam kabulle çalışmaya devam eder), Electron + APK (2.9.1/vc48) sonra.

> ⚠️ **PROFİL GERÇEĞİ:** M1 ("Boyahaneye Geri Gönder") ve M4 (tabletten bağ sökme) üretim+fason yüzeyleridir; M3'ün kısa-kesim eşiği bu fabrikanın kesim pratiğidir. Taşınabilir çekirdek: **kanonik yüklem `stepCanApplyColor`** (moveService'in dar `colorStep`'i DEĞİL), `RollPlanDeviation`'ın `confirmationId` çift-sayım kilidi ve "birleştirme TEK yerde (`resolveShortCutConfig`)" — bkz. MODUL-BAYRAK-TASARIM §12 kural 4.

> **NOT (2026-08-19 — TAMBUR PAKETİ 2: sektör boşluklarının kapatılması; dördü de MEVCUT yetkiye bağlı, yetkisizde UI HİÇ çizilmez):** 2026-08-19'un ilk paketi (plan-sapma kapısı + Sipariş Bağla + kısa-kesim-A1) sektör standartlarına göre dört yeri bilinçli açık bırakmıştı; kullanıcı kararıyla dördü de kapatıldı. **Yeni izin kodu YOK** (kurşun bypass dersi: yeni kod = sahada unutulabilir atama) — hepsi `roll:manual-adjust`/`mobile:tambur-duzelt`/`workorder:write`/`report:quality`/`admin:settings` üzerinden.
> • **M1 — "BOYAHANEYE GERİ GÖNDER" (plan-sapma kararının REWORK kolu):** onay modalının 3. tuşu; `POST /tambur/manual/send-to-dye(-preview)` (bring çiftiyle AYNI izin). ⚠️ **HEDEFİ İSTEMCİ SEÇMEZ, SUNUCU ÇÖZER** — tablette rota yok (`GET /work-orders/:id` `mobile:tambur`u kapsamıyor) ve olsaydı bile yüklem ikinci kez yazılırdı. Çözüm **KANONİK** `stepCanApplyColor` (istasyon bayrağı VEYA fason hizmeti) — moveService'in kendi `colorStep`'i YALNIZ `requiredCategory` okur, İÇ boyahaneyi görmez; bekçinin en kritik senaryosu bu (yanlış çözümleyici kullanılırsa §2 kırmızı). **Çoklu boya adımında mevcut adımdan ÖNCEKİ en yakını** (max stepSequence): daha erkene dönmek aradaki adımları gereksiz diriltir ve QC-VOID kapsamını büyütür; SONRAKİ boya adımı hedef DEĞİL (ileri atlama "geri gönderme" değildir) → 400 `NO_DYE_STEP_IN_ROUTE`. Taşımanın tamamı `manualMove`e delege (QC/kurşun VOID, CUT hard-stop, SKIPPED→PENDING, WO diriltme); 2. audit `TAMBUR_SEND_TO_DYE`. **AT_SUBCONTRACTOR YAZILMAZ** — mal fason adımında ÜRETİMDE bekler, çıkış ayrıca Fason Sevk'ten (taşınan top o listede `dispatchableForStepId` ikinci dalıyla kendiliğinden görünür). ⚠️ Toast hedef istasyon adını MUTLAKA taşır: top Tambur listesinden düşer, operatör nereye gittiğini görmezse "kayboldu" der. Önizlemesiz uygulama YOK (TamburBringRollModal sözleşmesi), sebep ≥3 zorunlu.
> • **M2 — KALICI SAPMA DEFTERİ `RollPlanDeviation` + Plan-Sapma Karnesi (MİGRATION VAR):** bugünkü tek iz audit'teydi ve rapor için iki kez elverişsizdi (6 ayda arşive taşınır + **rapor katmanı arşivi HİÇ okumaz**; `newData` JSON indekssiz; `recordId` PARENT). Metadata/enum yolları elendi: `TAMBUR_PROCESSED` cut anında YOK + upsert `update:{}` + `@@unique` adım başına tek satır; enum genişletme şema notuyla emsalen reddedilmiş. **Granülerlik = onaylı kapı-geçişi × sapan alan**, `confirmationId` geçişi gruplar (`finalize`: geçiş başına, childRollId=null, qtyM=topun TÜM metrajı — çocuk başına satır "onay sayısı"nı kesim adedi kadar şişirirdi; `cut`: kesim başına + çocuk; `finalize-open-fabric`: kalan çocuk + **tx-içi TAZE** kalan, yalnız `wantChild` dalında). **`field` pg enum DEĞİL string** (tek kaynak TS union; üçüncü alan gelince ALTER TYPE churn'ü yok — `RollVariance.source` emsali). `assertRollMatchesPlan` artık `PlanMismatchItem[]` DÖNER (audit best-effort tx-DIŞI aynen kalır) ve üç çağıran **kendi tx'inde** `recordPlanDeviationTx` yazar → aynı `clientToken` replay'inde P2002 rollback defter satırını da geri sarar (bekçi C6 bunu ölçer). **Karne** `GET /api/reports/quality/plan-deviation-scorecard` (`report:quality`, yeni izin yok): ⚠️ **onay sayısı `COUNT(DISTINCT confirmationId)`, metraj imza başına TEK `qtyM`** — naif `SUM` renk+en sapan topu ÇİFT sayar (bekçi negatif sondayla kanıtladı: 140 ↔ 240). Alan kırılımı SATIR bazlıdır (aynı imzada iki olay gerçekten iki olaydır) ve ekranda "onay" ile "olay" AYRI adlandırılır. Gün serisi `factoryDaySql` (gece vardiyası doğru güne).
> • **M3 — KISA-KESİM EŞİĞİ MERKEZE + 3 DURUMLU CİHAZ OVERRIDE:** bayrak+eşik artık fabrika ayarı (`tambur.shortCutA1Enabled` / `...ThresholdM`, dört kapı: SETTING_KEYS + FeatureFlags + reader + getFeatureFlags + setFeatureFlags + `feature-flag.routes` strictObject + Electron tipi + panel + mobil arayüz/hook). Backend **ENFORCE ETMEZ** (kural istemcide; sunucuda ikinci kural çift kaynak olurdu). Eşiği temizleme `null` → depoda **0** yazılır (set() `InputJsonValue` null kabul etmez; okuma `<=0 → null` ile aynı "girilmemiş"e çözer). Cihazda artık bayrak+eşik değil **`tamburShortCutA1Override: 'server'|'on'|'off'`** — iki durumlu modelde "girilmemiş" ile "sunucuyu izle" aynı değere düşerdi; bilinmeyen disk değeri 'server'a düşer (cihaz sessizce fabrikadan AYRILMAZ). Birleştirme TEK yerde: `resolveShortCutConfig` ('on'da eşik CİHAZINKİdir, **fabrika eşiğine SIZMAZ** — operatörün görmediği bir sayıyla kesim yapılmaz). Override yetkisi **süpervizör çifti** (`roll:manual-adjust || mobile:tambur-duzelt`); sıradan operatör fabrika ayarını salt-okunur görür. Electron'da `FlagDef.numberField` genişletmesi — ⚠️ iç alan adı **`numberKey:`**, `key:` OLAMAZ (sözleşme bekçisi panel kümesini satır başı `key:` regex'iyle okur; sızarsa boolean kontrolü yanlış şey ölçer). Bekçiye **SAYISAL AYAK** eklendi (A+B+C üç-yer; sözleşmenin bu tarafı bugüne dek hiç ölçülmüyordu).
> • **M4 — TABLETTEN BAĞ SÖKME:** `TamburOrderLinkSheet`e **3. sekme "Bağlı (N)"** (üstte kompakt liste DEĞİL: FlashList'li gövdede scroll çakışması + sekmeleri itme riski; görünürlük sekme sayacıyla). Veri mevcut `woQ`dan (ek istek YOK). Backend ucu hazırdı (`workorder:write`; FROZEN 409; **ORDER_PRODUCTION son bağ 400**) — istemci aynası saf `canUnlinkOrderLine` ile ÖNDEN gösterilir (son sözü yine backend söyler). Kaldırma `ConfirmDialog` ile onaylanır ("karşılanma tablosu ve refakat kartı etkilenir").
> • **Bekçiler + negatif sondalar (hepsi kırmızı verdiği ölçülerek):** `test_tambur_plan_gate` 48 kontrol (C1-C10; sondalar: cut defteri silinince 4, confirmationId satır başına olunca 1, qtyM yanlış bağlanınca 1, C10 yerleşimi bozulunca 1) · `test_tambur_send_to_dye` 22 kontrol (sondalar: kanonik yüklem yerine requiredCategory → §2 patlar, "önceki" kuralı kalkınca §5) · `test_plan_deviation_scorecard` 12 kontrol (sondalar: naif SUM → 240, kırılım satır bazlı olunca) · `test_feature_flag_contract` +4 sayısal kontrol (sonda: şemadan düşünce 2 kırmızı) · mobil `resolveShortCutConfig.test` (sondalar: öncelik tersi, server eşiğine sızma) + `canUnlinkOrderLine.test` + `deviceSettingsStore.test` 3-durum yeniden yazımı. ⚠️ **C9 KÖR ÇIKTI ve dürüstçe yeniden adlandırıldı**: "kalan 0'ken satır yazılmaz" kontrolü aslında KAPININ `currentQty>0` şartını ölçüyor, yazımın `wantChild` dalında olmasını DEĞİL (defter dal dışına taşınınca yeşil kaldı — kapı hiç açılmadığı için mismatches boştu); yerleşim ayrıca **C10 yapısal kontrolüyle** kilitlendi (`child.id` yalnız o dalda kapsamda → TS + kontrol birlikte).
> • **Deploy:** backend ÖNCE (yeni uç/anahtar/tablo eski istemciyi bozmaz) → Electron + APK birlikte. Migration `20260819190000_roll_plan_deviations` (salt CREATE TABLE, additive, vardiya içinde uygulanabilir; prosedür: git add → db execute → resolve → `\d` doğrulaması). ⚠️ RESTRICT FK: top silen HER test cleanup'ı `rollPlanDeviation.deleteMany` içermeli.

> ⚠️ **PROFİL GERÇEĞİ:** "Stok üretimi" kavramının varlığı `workorder.stockProductionEnabled` ile bayraklanacak (varsayılan AÇIK); siparişsiz üretime izin vermeyen bir kurulumda bu notun STOK↔ORDER simetrisi tek yönlü kalır. **Çekirdek:** "tip HİÇBİR yerde beyan değil BAĞDAN TÜRER", atomik `updateMany WHERE type=STOCK` ve "liste/künye/kart ile detay ayrışmamalı" (türetilmiş alan sınıfı) — bkz. MODUL-BAYRAK-TASARIM §9.

> **NOT (2026-08-21 — İş emri TİPİ bağın AYNASIDIR: "Sipariş Bağla" STOK → SİPARİŞE ÖZEL çevirir):** Saha bildirimi: iş emri siparişe bağlı olduğu hâlde **listede "Stok"** yazıyor; detay paneli ve yan panel siparişi gösteriyor. 2026-08-21 10:33 yedeği (`tekserp_saha`) ile yeniden kuruldu: **13 iş emri** `type=STOCK_PRODUCTION` ama `work_order_to_order_lines` dolu — hepsi aynı sırayla: Eda iş emrini stok için açıyor (08:39–08:56), ~1 saat sonra "Sipariş Bağla" (`POST /work-orders/:id/order-links`, audit `ORDER_LINK_ADDED`) ile bağlıyor; `updatedAt` açılış saatinde kalmış, yani bağ yolu iş emri satırına hiç dokunmamış. **Kök neden:** `workorder-link.service.linkOrderLines` pivot satırını yazıp `WorkOrder.type`'a DOKUNMUYORDU; oysa tip sistemin her yerinde BEYAN değil BAĞDAN TÜRER — panel formu `buildPayload` (`hasLines ? ORDER : STOCK`), Hızlı İş Emri `createFromRolls`, `unlinkOrderLine`'ın "son bağ kaldırılamaz — tipini yalanlar" kuralı. Liste "Tip" kolonu · künye · yan panel başlığı · refakat kartı `type`'ı basar, detay paneli ise `orderLinks`'e bakar → iki yüzey ayrıştı. Bu yolun tek özel tarafı buydu (`update` PATCH bağ taşımaz, `replace` PUT tipi istemciden türetilmiş alır).
> • **Düzeltme:** ① `linkOrderLines` aynı tx'te `tx.workOrder.updateMany({ where: { id, type: STOCK }, data: { type: ORDER } })` — ATOMİK (yarışta iki çağrı da güvenle geçer, ikincisi `count=0`); yanıt `typeChanged`, mesaj "… İş emri artık Siparişe Özel.", audit `typeChanged` + `oldData.type→newData.type` (künyede "Ne değişti" satırı üretir); `linkOrderLineWithOverride` aynı yoldan geçer. ② **Tersi BİLİNÇLİ OLARAK YOK** — son bağ kalkınca STOK'a dönüş yazılmadı: `unlinkOrderLine` son bağı zaten reddediyor (mobil aynası `canUnlinkOrderLine` + test); ORDER→STOCK'un meşru yolları Düzenle formu (replace, satırsız payload → STOCK, `targetItemId` şart) ve sipariş iptalinde `CONVERT_TO_STOCK`. Açık soru olarak bırakıldı: stok iş emrine YANLIŞ sipariş bağlanırsa tablet "Sipariş Bağla" sekmesinden geri alınamaz hâle gelir (tip artık ORDER) — çıkış Düzenle formu. Simetrik model istenirse (son bağ → STOK, `targetItemId` yoksa red) üç yer birlikte: servis + `canUnlinkOrderLine` aynası + test. ③ Geçmiş kayıtlar **MIGRATION ile DEĞİL** — dry-run varsayılan `scripts/fix_workorder_type_from_links.ts --apply` (her iş emrini açılış/ilk bağ/siparişleriyle fabrika saatiyle listeler; CANCELLED/SUPERSEDED dışarıda; idempotent; audit `TYPE_DERIVED_FROM_LINKS` + `source`); fire-grade emsali: canlı veriye dokunan düzeltme listeleyip onaylatılır. Provada 13 satır, vardiya içinde koşulabilir.
> • **Bekçi:** `test_workorder_order_link` +6 kontrol (ilk bağda tip/`typeChanged`/mesaj/audit, tekrar bağlamada ve zaten-ORDER'da `typeChanged=false`, son bağdan önce tip ORDER); **negatif sonda:** flip `if (false && …)` yapılınca 7 kırmızı (50→43), dosya `cmp` ile birebir geri yüklendi. İstemci yanıt tipi `typeChanged?: boolean` (Electron + mobil) — yalnız tip; davranış değişikliği yok (Electron toast `res.message` basar ve `["work-orders"]` invalidate eder, liste kendiliğinden düzelir).
> • **Deploy:** backend tek başına yeter (ek yanıt alanı eski istemciyi bozmaz; APK/Electron bekletilmez) → sonra script `--apply` (`docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md §5b`). Migration YOK, izin YOK.
> • **Diğer yazma yolları da kapatıldı (aynı gün, 2. tur):** `WorkOrderService.create()` ve `replace()` sipariş satırı geldiğinde tipi STOK bırakıyordu (bağı yazıyor, üstelik `type === ORDER` koşullu sipariş-satırı doğrulamalarını — kumaş/renk/iptal — da atlıyordu); panel formu tipi satırdan türettiği için sahada görünmemişti ama kural istemci disiplinine aitti. Artık ikisinde de `allocations.length > 0 && type === STOCK → ORDER` (sunucu çevirir, sonra ORDER doğrulamaları koşar). Bekçi: `test_workorder_order_link` §2c (+2 kontrol; negatif sonda 2 kırmızı). **Kalan teorik boşluk (bilerek dokunulmadı):** sipariş iptali `UNLINK_ONLY` aksiyonu tek-siparişli PLANNED (tek izinli aksiyon) ve COMPLETED iş emrinde bağı silip tipi ORDER bırakır → "Siparişe Özel ama siparişsiz" (ters yön). Yedekte 0 kayıt; kapatılacaksa önizleme metni + apply tx birlikte değişir.
> • **3. tur — SİMETRİ + iptal akışı (aynı gün, kullanıcı kararı "3. ve 4. maddeyi ele alalım"):** ① `unlinkOrderLine`: siparişe özel iş emrinin SON bağı artık REDDEDİLMEZ — aynı tx'te taze bağ sayımı 0 ise `updateMany WHERE type=ORDER → STOCK`, yanıt `typeChanged`, mesaj "… İş emri artık Stok üretimi.", audit `oldData.type/newData.type`. Tek 400 kaldı: hedef kumaşı NULL olan siparişe özel iş emri (STOK'un değişmezi; `create` ORDER'da kumaşı siparişten türettiği için pratikte boş yok — yedekte 0/114). Eski "son bağ kaldırılamaz — tipini yalanlar" gerekçesi, tip bağı izlediği için ortadan kalktı. ② Sipariş iptali `cancelWithActions`: `UNLINK_ONLY` sonrası tx içinde kalan bağ 0 ise `type ORDER → STOCK` (`targetItemId NOT NULL`, terminal statü hariç) — PLANNED iş emrinde tek izinli aksiyon UNLINK_ONLY olduğu için "Siparişe Özel ama siparişsiz" yalnız oradan doğuyordu; `CONVERT_TO_STOCK` ile tek-siparişli WO'da artık aynı sonucu verir, fark niyet etiketi. Electron iptal diyaloğu tek-siparişli satırda "Stok üretimine döner" rozeti + UNLINK_ONLY açıklaması. ③ Mobil ayna `canUnlinkOrderLine(type, linkCount, hasTargetItem=true)` → `{allowed, reason, becomesStock}`; Tambur sheet son bağda satır notu + onay metnine "iş emri Stok üretimine dönecek"; `hasTargetItem` bilinmiyorsa engellemez (son söz backend). **Deploy sırası:** backend önce GÜVENLİ (eski APK aynası yalnız fazladan engeller: son bağı tabletten kaldıramaz, Düzenle/Electron'dan kaldırılır); APK ile açılır. Bekçiler: `test_workorder_order_link` 61 kontrol (+9: 5b simetri/hedef-kumaşsız red/gidiş-dönüş, §9 iptal UNLINK_ONLY→STOK); **iki negatif sonda:** unlink dönüşümü kapatılınca 4 kırmızı, iptal dönüşümü kapatılınca 1 kırmızı; mobil jest 6/6.

> ⚠️ **PROFİL GERÇEĞİ:** "bugün prod'da iç boyahane yok (aktif `appliesColor=true` tek istasyon 'Boyahane (Fason)')" cümlesi bu kurulumun ölçümüdür — iç boyahaneli profilde `kursunFinish` 3c dalı ilk günden canlıdır. **Çekirdek:** tek bekçi (`assertTargetColorChange`), "kilit ADIMA değil MALA bakar", üç sonuç (SERBEST / `COLOR_PARTIAL_CONFIRM` / `COLOR_DYED_BLOCKED`) ve "kumaş farkı HER ZAMAN red" — bkz. MODUL-BAYRAK-TASARIM §5.1.

> **NOT (2026-08-21 — Üretim rengi değişikliği TEK BEKÇİ + kısmi-boya onayı + fason kabul taze renk + sipariş kalemi rengi):** Kullanıcı sorusu *"bitmiş iş emri düzenlenebiliyor mu, renk değişince fasondaki/üretilmiş toplar etkileniyor mu?"* incelemesinde beş zafiyet bulundu ve kullanıcı kararıyla hepsi kapatıldı. Kök bulgu: renk değişikliğinin İKİ kapısı vardı (`PATCH /work-orders/:id` "Düzenle" ↔ `PATCH …/target-color` "Rengi Değiştir") ve **aynı izinle (`workorder:write`) farklı kural** uyguluyorlardı — ikincisi terminal statüyü, boya-bitti kilidini ve izinli renk listesini atlıyor, bitmiş iş emrinin planını bile değiştiriyordu.
> • **TEK BEKÇİ `helpers/workorder-target-color.helper.assertTargetColorChange`** — iki kapı da ondan geçer, sıra: ① terminal statü (COMPLETED/CANCELLED/SUPERSEDED → 409 `WO_PLAN_FROZEN`; *bitmiş iş emrinin planını geriye dönük değiştirmenin meşru ihtiyacı yok — toplar yanlışsa yol "Düzelt"*) ② renk aktif ③ `Item.allowedColors` ④ boya-bitti kilidi (`computeWorkOrderLocks.targetColor` → 409 `COLOR_LOCKED`) ⑤ **kısmi boya**: iş emrinin canlı toplarından biri ZATEN mevcut hedef renkteyse (fasondan döndü / iç istasyonda boyandı) ama kilit devrede değilse (kısmi kabul penceresi) → onaysız 409 `COLOR_PARTIAL_CONFIRM` ("N top zaten KIRMIZI boyandı; kalan M top MAVİ gelecek… Tebdil ile ayırın"); `confirmPartial:true` ile geçer, audit `partialConfirmed`; toplara DOKUNULMAZ (kilit yalnız HEPSİ döndüğünde — mevcut kural korundu; "telefonla renk değişti" senaryosu çalışır, iki renk bilinçli olur) ⑥ rota kapsaması: renk veren adım yoksa **REDDETME, UYAR** (`warnings[]`; açılışta `assertRouteCoversTargets` 400 vermeye devam eder). `ApiResponse.warnings?` alanı üç katmanda da eklendi (backend/Electron/mobil). Top kapsamı tek tanım: `helpers/workorder-rolls.helper.whereRollsOfWorkOrder` (link servisinden taşındı, aynı adla re-export).
> • **COMPLETED kapatma kümesi İKİ AYRI LİSTE:** `PLAN_CHANGE_FROZEN_STATUSES` (renk / en / uyumsuz-bağ override → COMPLETED dahil) ↔ link servisinin `FROZEN_STATUSES` (bağla / bağı kaldır / toplara uygula → yalnız CANCELLED+SUPERSEDED). **COMPLETED'da uyumlu "Sipariş Bağla" BİLEREK AÇIK** (stok için üretildi, sonra sipariş geldi). Electron başlık + yan panel `canChangePlan` ile Rengi/Eni Değiştir düğmelerini bitmiş iş emrinde çizmez; backend 409 tek gerçek kapı. Override zinciri (`linkOrderLineWithOverride`) `changeTargetColor`'ı **`confirmPartial:true`** ile çağırır — öncülü zaten "elimdeki mal siparişin renginde" beyanı + ② adımda topları eşitliyor; onayı tekrar sormak cevabı verilmiş soruyu sormaktı.
> • **Fason kabulde hedef renk KİLİT ALTINDA taze okunur** (`subcontractor.service.receive`): pre-tx okunan `wo.targetColorId` bayatlayabiliyordu ve tablet `appliedColorId`yi DAİMA gönderdiği için (override yolu) eski renk sessizce yazılırdı — pencere birkaç saniye değil, ekranın açık kaldığı tüm süreydi. İki koruma: (a) override yoksa renk taze hedeften; (b) istemci `expectedTargetColorId` (ekranı açarken gördüğü hedef, null=hedefsiz) gönderirse ve taze hedef farklıysa **409 `TARGET_COLOR_CHANGED`** (`currentColorName` details'te); alan yoksa kontrol yok (eski APK fail-open). Mobil `buildReceivePayload` alanı grup nesnesinden kendisi türetir (yeni arg yok, jest 44/44); `FasonKabulScreen` bu kodda `pending-returns`'ü tazeler + özel toast.
> • **"Renk veren adım" TEK YÜKLEM `stepCanApplyColor`** artık manuel taşıma backflush sentezi (`workorder-manual-move`) ve parti ayırma (`workorder-split.colorStep`) için de geçerli (eskiden yalnız `requiredCategory.appliesColor`). **`kursunFinish` 3c:** adım renk verebiliyorsa (istasyon bayrağı / fason hizmeti) ve top renksizse WO hedef rengi yazılır — fason kabulün iç-istasyon aynası; bugün prod'da iç boyahane yok (aktif `appliesColor=true` tek istasyon "Boyahane (Fason)"), tanımlandığı gün kendiliğinden çalışır.
> • **Sipariş kalemi rengi dar uç `PATCH /orders/:id/lines/:lineId/color`** (`OrderService.changeLineColor`, `order:write`, sebep ≥3 + audit `ORDER_LINE_COLOR_CHANGED`): genel `update`'in "iş emri açılmış siparişin kalemleri değiştirilemez" kuralı KORUNUR; yalnız renk alanı gevşetildi (müşteri telefonla rengi değiştirdiğinde plan + sözleşme birlikte düzelsin). Kumaş/metraj/en değişmez; iptal/tamamlanmış siparişte 409; kurallar WO hedef rengiyle aynı (aktif + müşteriye atanabilir + `allowedColors`).
> • **Electron `ChangeTargetDialog` (kullanıcı: "sade/özet"):** bant DURUMA GÖRE — *"N top boyahanede → kabulde yeni rengi alır"* (eski genel "boyanmış mal için kâğıt işi değildir" cümlesi 5 renksiz fason topunda YANLIŞ okunuyordu: sistem doğru şeyi yapıyordu, ekran tersini söylüyordu) · *"N top zaten X boyanmış → aşağıdan seç / Tebdil"* · *"N top değişmez (sevk/kesim)"*; sipariş uyumsuzluğu **ÖNCEDEN** listelenir, satır başına karar `Bağ kalsın (uyarı) · Bağı kopar · Siparişi de X yap`; 409 `COLOR_PARTIAL_CONFIRM` sunucu metniyle gösterilir, "Yine de değiştir" aynı isteği `confirmPartial` ile tekrarlar. Tebdil sihirbazı (`/work-orders/:id/split`: REDYE_SAME_COLOR / NEW_COLOR / UNDYED_MOVE) bu senaryonun ("bir kısmı eski renk, bir kısmı yeni renge → yeni iş emri") zaten var olan yoluydu — diyalogdan görünmüyordu.
> • **Bekçi:** `scripts/test_wo_target_color_guard.ts` (44 kontrol: §1 COMPLETED, §2 kilit iki kapıda, §3 izinli liste, §4 uyarı iki kapıda, §5 kısmi onay + audit + ölü top sayılmaz, §6 kabul 409/taze renk/eski APK, §7 kalem rengi, §8 iç istasyon renk yazar / vermeyen yazmaz). Komşular yeşil: `test_workorder_order_link` 61, `test_helpers` 61, `test_fason_partial_receive` 53, `test_kursun_bypass` 149, `test_tambur_plan_gate` 48. ⚠️ Negatif sonda (bekçiyi kasten kırıp kırmızı görmek) bu turda YAPILMADI — paylaşımlı ağaçta eşzamanlı ikinci oturum aynı dosyaları düzenliyordu, geçici src mutasyonu riskliydi; ilk fırsatta §1/§2/§5 için yapılmalı. **Migration YOK, izin YOK.** Deploy: backend ÖNCE güvenli (eski APK `expectedTargetColorId` göndermez → kontrol yok; eski Electron yalnız bitmiş iş emrinde 409 metni görür); Electron + APK sonra.
> • **2. TUR (aynı gün — kullanıcı: "planlamacı iş emrinin TÜM açık kumaşlarının rengini düzeltebilsin, Tambur renkle uğraşmasın"):** İlk turun "boya adımı COMPLETED → kilit" kuralı iki şeyi yanlışlıyordu: (a) boya bitmiş ama toplar renksizse de kilitliyordu; (b) asıl istenen düzeltmeyi — *"beyaz diye kaydedilmiş mal aslında ekru; plan + tüm açık kumaşlar ekruya"* — boya bittiği için engelliyordu ve **Tambur süpervizör zinciri** (`linkOrderLineWithOverride`, boya bittikten sonra çalışmak için yapılmıştı) aynı yüzden kırılmıştı. **KİLİT ARTIK ADIMA DEĞİL MALA BAKAR:** `mismatch` = canlı, boyanmış ve yeni renkte olmayan toplar (bu istekle düzeltilecekler `recolorRollIds` HARİÇ; fasondakiler hariç) · `pending` = henüz boyanmamış (renksiz+yolda ya da fasonda) → `mismatch=0` SERBEST (kayıt düzeltmesi — plan gerçeğe yetişir) · `mismatch>0 && pending>0` 409 `COLOR_PARTIAL_CONFIRM` (onayla geç) · `mismatch>0 && pending=0` 409 **`COLOR_DYED_BLOCKED`** ("mal zaten X boyandı, boyanacak top kalmadı — bu iş emri X biter → Tebdil / yeni iş emri / topları da düzelt"). `computeWorkOrderLocks.targetColor` yalnız Düzenle formunun alanını pasifleştirir (metni "Rengi Değiştir ile düzeltilir" diyor). Override zinciri `editableIds`'i plan yazımından ÖNCE çözüp `recolorRollIds` olarak geçer → yeniden çalışır. **Planlamacı yetkisi:** `POST …/apply-attribute-to-rolls` `requireAnyPermission("roll:manual-adjust","workorder:write")`; servis `workorder:write` taşıyan (süpervizör olmayan) kullanıcı için tekil motora izin listesi VERMEZ (= dahili çağrı; ALWAYS_BLOCKED + sebep yine motorda) — iş emri kapsamlı toplu düzeltme PLANLAMA işidir; tekil Düzelt / Tambur "Düzelt" eski kuralla (süpervizör) kalır. ⚠️ SoD notu (2026-08-06 "roll:manual-adjust yalnız Muhasebe/Süpervizör") bu kapsamda bilinçli genişletildi.
> • **Kabulde plandan farklı renk → TEK SORU (`planColorAction`):** tablet (`FasonKabulScreen`, ConfirmDialog) kaydetmeden önce sorar: **"İş emri de X olsun"** (`APPLY_TO_PLAN` → kabul tx'i sonrası best-effort `changeTargetColor(confirmPartial:true)`; tek bekçi reddederse kabul geçerli kalır, yanıt `warnings` ile söyler) · **"Sadece bu toplar"** (`ROLLS_ONLY` → doğan her top için `RollPlanDeviation` satırı tx İÇİNDE, `source="fason-receipt"` (`FASON_RECEIPT_DEVIATION_SOURCE`); **Tambur kapısı aynı top+alan+değerlerle satır görürse renk sorusunu TEKRAR SORMAZ** — plan sonradan değişirse değerler tutmaz, kapı yine sorar) · Vazgeç. Alan gönderilmezse eski davranış (Tambur yakalar). Electron `FasonReceiveDialog` renk seçtirmez (yalnız hedefsiz WO'da `colorRequired`) → orada soru yok. Mobil `buildReceivePayload` yalnız gerçekten farklıysa yazar (jest 44/44).
> • **Electron `ChangeTargetDialog`:** "Tümünü seç" (planlamacı düzeltmesi tek hamle), `recolorRollIds` ile plan isteği, `COLOR_DYED_BLOCKED` → kutu + düğmeler: *Tebdil — yeniden boya* (diyalog içinden `TebdilWizard`, boyanmış top içeren ilk parti) · *Yeni iş emri aç* (`/operations/work-orders/new`) · *Kayıt yanlış — tüm topları X yap* (Tümünü seç). Bekçi `test_wo_target_color_guard` **59** kontrol (§2 mal–plan: hepsi düzeltiliyor → serbest, yarısı → kapalı, boya bitmiş+renksiz → serbest; §9 kabul kararı ROLLS_ONLY/APPLY_TO_PLAN + kapı muafiyeti + plan değişince kapı yine sorar; §10 planlamacı toplu düzeltme / `roll:read` ile değil). Komşular yeşil: order_link 61 · plan_gate 48 · helpers 61 · fason_partial 53. Negatif sonda hâlâ yapılmadı (paylaşımlı ağaç).

> ⚠️ **PROFİL GERÇEĞİ:** Fason modülü yüzeyi; `fason.shrinkTolerancePct` varsayılanı (%10) bu fabrikanın boyahane deneyimidir, kumaş cinsine/kuruluma göre değişir. **Çekirdek:** "fark DEFTERE yazılır (`RollVariance`, `SUBCONTRACTOR_RETURN`)", `sourceRefId` terslemenin ADRESİDİR, "⚠️ toleransta `<=0 → null` kalıbı YASAK (0 = tolerans yok, null = varsayılan)" ve "RESTRICT FK: fason kabulü yapan HER test cleanup'ı `rollVariance.deleteMany` içermeli" — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-21 — FASON KABULÜ: "çekme" bir HATA DEĞİL, ÖLÇÜLEN BİR GERÇEK; kısmi kabul TEK soruya indi):** Saha vakası: 5 parça (30/40/50/60/70 m) boyahaneye gitti, **220 m** döndü. Operatör ekranda tıkandı — ve tıkanmasının iki ayrı sebebi vardı. **(1) Ekran normal işi hata sanıyordu:** ön-dolu "dönen" satırı 250 m geliyor, 220 yazılınca **"EKSİK DÖNEN −30 m"** bandı + turuncu buton + kırmızı **"Giden / gelen uyuşmuyor — Yine de Kabul Et?"** modalı çıkıyordu. Oysa boyahanede kumaş **çeker**; 250→220 (%12) tekstilde rutindir. **(2) Kısmi kabul yanlış soruyu soruyordu:** "bu toptan kaç metre geldi?" — boyahane parçaları **dikip tek parça boyadığı** için bu sorunun fiziksel cevabı YOKTUR. Operatör 5 alanı kafadan bölüştürmeye çalışıyor, her düşürdüğü satır ayrı bir **yarım top** doğuruyor (5 hayalet, adım ACTIVE, WO fason hard-block'u devrede) ve fiziksel olarak **yok olan** 30 m "fasonda bekleyen mal" diye kayda geçiyordu. **(3) Üstüne, o 30 m hiçbir yere yazılmıyordu:** makbuz kalemi "kalanın tamamı kabul edildi" diyor, doğan toplar 220 m taşıyor; fark yalnız iki tabloyu yan yana koyan birinin görebileceği bir çıkarma işlemiydi — bu yüzden **Fason Karnesi her firmaya %0 fire basıyordu** (`subcontract-scorecard` dönen metrajı defterden okur, defter TAM kabulde kalanın kendisidir → fark **yapısal olarak** sıfır).
> • **SORU DEĞİŞTİ — kalan TEK sayıdır, dağıtımı sistem yapar:** satır başına "Gelen (m)" varsayılan **GİZLİ** (kaçış kapısı "Top bazlı gir" — etiketi korunmuş parça / tek toplu kabul). Yerine **"Fasonda kalan var mı?"** anahtarı (varsayılan HAYIR) + tek "Kalan (m)" kutusu. Dağıtım **BÜYÜK TOPTAN** başlar (`resolveReturns`): kalan mümkün olan **EN AZ** topa yığılır — orantılı bölüştürme beş topun beşini birden yarım bırakır ve kalan geldiğinde beş ayrı ikinci kabul isterdi. Tamamı kalan top dönüş listesine **HİÇ GİRMEZ** ("0 metre kabul ettim" diye bir kayıt yoktur). Sıra **deterministik** (eşit metrajda `rollId` ikinci anahtar) — yoksa aynı ekran aynı girdiyle farklı payload üretir ve offline replay aynı token'la FARKLI içerik gönderir. Dağıtım bir **KURGUDUR** ve öyle olmak zorundadır (hangi metrenin hangi topta kaldığı bilinmiyor); doğru olan tek şey TOPLAMDIR ve o korunur. Kalan ≥ işaretli toplam → 400 değil ARAYÜZ engeli ("hiç gelmediyse topları işaretten çıkarın").
> • **FARKIN ADI KONDU: ÇEKME.** Bant artık `ÇEKME 30 m (%12)` / `FAZLA DÖNEN +N m` yazar; rengi **NÖTR** (mavi), **yalnız fabrikanın belirlediği toleransın üstünde** amber olur ve onay modalı çıkar. Onay modalı iki duruma indi: **işaretsiz top** ∨ **tolerans aşımı**. Beyan edilen kalan modal ÇIKARMAZ — operatörün bilerek yaptığı işi hata gibi göstermek, tam da kaldırılan sürtünmedir. Buton tolerans İÇİNDEKİ çekmede **sararmaz** (normal işi uyarı rengiyle boyamak uyarının anlamını tüketir).
> • **YENİ AYAR (dört kapı):** `fason.shrinkWarnEnabled` (default **TRUE**) + `fason.shrinkTolerancePct` (default **10**). Yön gerekçesi `readTamburShortCutA1Enabled`'ın TERSİ ve bilinçli: bu bayrak operatörün kararını DEĞİŞTİRMEZ, görünür bir gerçeği gösterir → görünürlük varsayılan açık doğar. ⚠️ Toleransta `<= 0 → null` kalıbı **KULLANILMAZ**: kısa-kesim eşiğinde 0 "girilmemiş" (kural inert), burada 0 "hiç tolerans yok" (kural HER farkta ateşler) — zıt davranışlar. `null` (alanı temizle) → **varsayılana** döner, 0'a değil; susturmanın yolu eşik değil BAYRAKtır. Backend **ENFORCE ETMEZ** — kural sunum katmanındadır, eşiğin altındaki fark da deftere aynen yazılır.
> • **ÇEKME ARTIK DEFTERDE:** `RollVariance`, yeni kaynak **`SUBCONTRACTOR_RETURN`**; eksi yön **SCRAP** (mal vardı, metre gitti — RECORD_CORRECTION DEĞİL: sistemdeki sayı yanlış değildi, kumaş gerçekten çekti), artı yön **OVERAGE**. Sebep **sistem kodudur** (`SHRINK_REASON_CODE = "FASON_CEKME"`) ve `SCRAP_REASONS`'a **EKLENMEDİ** — o liste operatörün Tambur fire ekranında gördüğü listedir; oraya "Fason çekmesi" koymak tamburda kesilen bir topun firesini yanlış kovaya yazmanın yolunu açardı. `validateVarianceReason` kodu **kabul eder**, `reasonsForKind` **döndürmez** (`LEGACY_REASON_CODE` ile birebir aynı desen). Kısmi kabulde de yazılır ve bu DOĞRUDUR (o teslimatta 51 düşülüp 48 geldiyse 3 m çekmiştir; fasonda bekleyen kalan hesabın DIŞINDADIR). Çok toplu kabulde fark **tüketilen metrajla orantılı** dağıtılır (`allocateShrink`) ve **yuvarlama artığı SON satıra biner** — satır satır yuvarlanan dağıtım defter toplamını sapmanın kendisinden farklı bırakır.
> • **MİGRATION VAR — `RollVariance.sourceRefId`** (`20260821120000_roll_variance_source_ref`, salt ADD COLUMN + index, additive, vardiya içinde uygulanabilir). **Terslemenin ADRESİDİR:** makbuz iptalinde satırlar SİLİNMEZ, `reversedAt` alır (append-only defter). ⚠️ `rollId + source + step` ile aramak YETMEZ ve bu load-bearing: kısmi teslimatta AYNI top AYNI adımda birden çok makbuzda sapma üretir, iptal ise **LIFO** olduğu için yalnız SONUNCUSUNU kaldırır — adres olmadan iptal, önceki teslimatın **meşru** sapmasını da sessizce terslerdi.
> • **KARNE DÜZELDİ:** `collectDispatchItems`'a `adj` LATERAL'i eklendi — dönen metraj = defter (düşülen) **+** çekme/fazla satırları (`SCRAP` eksi, `OVERAGE` artı, `reversedAt IS NULL`). ⚠️ **Açık bakiyeye (`openQty`) GİRMEZ** ve bu bilinçli: fasonda bekleyen bakiye onun hesabından DÜŞÜLMEMİŞ metrajdır; çekme düşülen kısımda yaşandı, bakiyeden de indirmek gelmemiş malı gelmiş saymak olurdu. Bekçideki eski beklenti (160/40) "defter = fiziksel dönen" varsayımını kodluyordu — fire'ı yapısal olarak 0'a çiviteyen şey tam olarak oydu; artık 164/36.
> • **ARAYÜZ HATASI DA KAPANDI (sessiz metraj ikizlenmesi):** Tek Parça modunda operatör 250→220 yazar (satır "manuel" olur), sonra gelmeyen bir topu işaretten çıkarırsa `rebuildPrefilledNewRolls` ön-dolu satırı manuelin **YANINA** ekliyor ve dönen metraj **220 + 180 = 400** oluyordu. Yeni kural: **TEK PARÇA MODUNDA SATIR SAYISI HER ZAMAN 1**; operatör sayıyı bir kez yazdıysa toplam ONUNDUR (işaret değişse de dokunulmaz — ölçtüğü metre, hangi topların geldiğine göre değişmez). "Parça Ekle" yalnız PER_ROLL'da görünür. Mod geçişi ayrı fonksiyona alındı (`switchReceiveMode`): parça→tek toplanır (notlar birleşir), tek→parça **dokunulmamışsa** açılır, yazılmışsa korunur (ön-dolu EKLENMEZ). "Tek Parça / Adet Adet Geldi" anahtarı **DURUYOR** — o "gelen kaç parça?" sorusudur, çekme ise "kaç metre?"; ikisi bağımsız.
> • **Kalan beyanı ön-dolguyu da düşürür** (`expectedQtysFor`): ham `currentQty` yazmak, operatörün kendi söylediği sayıyı yok sayıp her seferinde sahte bir 30 m'lik çekme göstermek olurdu. Ayrıca **"ölçtünüz mü?" sondası**: tek parça modunda sayı hâlâ otomatik (dokunulmamış) ve gidenle birebir aynıysa tek satırlık hatırlatma — engel değil (eski kırmızı modalın yerine geçen, bu kez GERÇEK olan uyarı).
> • **⚠️ RESTRICT FK YAN ETKİSİ (yakalandı ve kapatıldı):** sapma defteri satırı duran top SİLİNEMEZ → fason kabulü yapan test cleanup'ları `23001` ile **yarıda kalıyor** ve arkasında hayalet kayıt bırakıyordu (`test_wo_input_attach_window` düştü; bir koşum 49 orphan sevk + 60 orphan top bıraktı). **23 test dosyasına** `rollVariance.deleteMany` eklendi; ölçüldü: düzeltmeden sonra tam paket koşumu sayaçları **değiştirmiyor** (60/6/49 → 60/6/49). Yeni fason kabulü yapan test yazarken bu satır ZORUNLU.
> • **Bekçiler:** backend `test_fason_partial_receive` **53** kontrol (P10 çekme defteri + sistem sebebi + `sourceRefId` + iptal terslemesi + karneye girmeme · P11 çok toplu dağıtımda toplamın korunması); mobil jest **68** (`resolveReturns` 6 senaryo — 30/70/100 m kalan, determinizm, işaretsiz top; `shrinkInfo`/tolerans 5; `switchReceiveMode` 5; payload 3). **Altı negatif sonda ile kırmızı verdiği doğrulandı:** dağıtım küçükten büyüğe → 6 · SINGLE'da ön-dolu geri eklenince → 1 · tolerans bayrağı yok sayılınca → 1 · çekme yazımı kapatılınca → 10 · karne düzeltmesi kalkınca → 2 · tersleme adresi bozulunca → 2. Dosyalar `cmp` ile birebir geri yüklendi.
> • **Deploy:** **backend ÖNCE** (yeni uç yok; ek alan/ayar eski istemciyi bozmaz — eski APK kalan beyanı göndermez, tam kabul çalışmaya devam eder) → Electron + APK birlikte. Migration VAR, **yeni izin YOK**. ⚠️ `prisma db execute` bu turda sessizce düştü ama `migrate resolve --applied` yine de "uygulandı" dedi (D-23); kolon `\d roll_variances` ile doğrulanıp psql ile koşuldu — **resolve sonrası doğrulama opsiyonel değildir**.

> ✅ **ÇEKİRDEK:** Partial UNIQUE seddi (tombstone predicate'iyle), "uygulama bekçisi KALIR — mesajı o verir, DB sessiz son hat", "kodu SUNUCU türetir, serbest metne kod UYDURULMAZ" ve `legacyTexts` eski-ad sözlüğü — veri bütünlüğü sınıfı, bayraklanmaz. ⚠️ Yalnız KAPSAM profil: hangi tabloların sedli olduğu (bugün 3) kurulumun ana-veri hacmine göre genişler; yeni tabloya sed eklemeden önce `find_fold_duplicates.ts`.

> **NOT (2026-08-21 — SIFIRLAMA PENCERESİ: nameFold DB SEDDİ (3 tablo) + sebep KODU topun satırında):** Fabrika DB'si 2026-08-22'de sıfırlanıyor; "şimdiden revize edelim mi, ileride backfill'le uğraşmayalım" sorusu ölçüldü. Ticaret dalının (`feature/depo-mal-kabul`, 25 migration) mevcut tablolara dokunuşu küçük ve tamamı nullable (`rolls` 4 kolon, `sacks` 1, enum değerleri) → **pencere onun için değersiz**. Pencerenin tek gerçek işi, bugün canlıda mükerrer kayıtlar durduğu için konulamayan DB kısıtıydı (şemada dört yerde "Faz B6, kısıt HENÜZ YOK" yazıyordu; `20260819060000_search_fold §6` "sıfırlamadan sonra 5 satırlık risksiz migration" demişti). İkinci iş (b) pencereye bağlı değil ama erken yapılınca backfill sıfır.
> • **(a) KAPSAM KARARI (kullanıcı): 3 tablo** — `customers · items · subcontractors`. Yalnız bunlarda gerçek mükerrer vardı (pencere SADECE burada değerli), tombstone predicate'i (`mergedIntoId IS NULL`) yalnız bunlarda var, test etkisi küçük. Tasarım matrisi (`ARAMA-KATLAMA-SIRALAMA-TASARIM.md §2.2`, 16 tablo) ileride backfill'siz eklenebilir — diğer 12 `nameFold` tablosu uygulama bekçisiyle temiz kalır. **RENK BİLİNÇLİ HARİÇ:** `foldColorNameForCompare` ayraç + token-sırası bağımsız ("055-BEYAZ" ≡ "BEYAZ 055"); düz `nameFold` üzerine kısıt uygulama kuralından ZAYIF olur ve yanlış güven verir (`color.service.ts` notu).
> • **Migration `20260821150000_name_fold_unique_live`:** ön kontrol DO bloğu (sedli üç tabloda `mergedIntoId IS NULL` grupları; varsa `RAISE EXCEPTION` + düzeltme adresi) + `CREATE UNIQUE INDEX IF NOT EXISTS "<tablo>_nameFold_key" … WHERE "mergedIntoId" IS NULL`. **Mükerrer varken DÜŞER — BİLİNÇLİ** (sıfırlama ertelenirse önce Sistem → Mükerrer Kayıtlar). Ad Prisma varsayılanı: şemadaki `@@unique([nameFold])` `map:`siz aynı adı üretir (drift yok — `@@unique` + `@default(dbgenerated())` kombinasyonu `migrate diff`te ÖLÇÜLDÜ, 4/4 yeşil) ve `error.middleware`in `_<kolon>_key` regex'i kolonu doğru çıkarır (`_live_key` gibi ek "live" döndürürdü). `@@index([nameFold])` KALIR (GIN/btree arama yolu). Şema yorumları dörtte de güncellendi (Item/Customer/Subcontractor "kısıt VAR", Color "bilinçli yok").
> • **Neye karşı (uygulama bekçisi check-then-act'tir):** ① yarış (iki SELECT boş, iki INSERT) ② `duplicateNameField` verilmeyen yeni servis sessizce guard'sız ③ import adaptörü `nameGuard` beyan etmezse kontrol koşmaz (fail-open) ④ script/elle SQL/geri yükleme. **Bekçi KALDIRILMAZ:** Türkçe, kod bilgili 409'u ("zaten var" ↔ "PASİF, aktifleştirin") o verir; DB seddi sessiz son hat. P2002 dalına `UNIQUE_COLUMN_LABELS` (`nameFold`→"ad"): "Bu ad zaten kayıtlı (büyük/küçük harf ve Türkçe karakter farkı sayılmaz)."
> • **Yan dokunuşlar:** `find_fold_duplicates.ts` soy bağlı tablolarda tombstone süzer (rapor kısıttan pesimist olmasın) + sedli tabloyu ⛔ işaretler · `import-name-guard` soy bağlı modelde `mergedIntoId:null` (önizleme ↔ DB aynı şeyi söyler) · `test_consistency §18` + `consistency-check.sql`: customers'a `mergedIntoId IS NULL` (ölçüldü: dev'deki ilk müşteri birleştirmesi §18'i KIRMIZI yaptı — her merge bunu yapardı) + metin güncel · `test_db_invariants` PARTIAL_INDEXES +3 (`uniq:true`, predicate `("mergedIntoId" IS NULL)`; 88/88) · `test_master_data_name_dup` **§9 DB seddi** (servis atlanarak `prisma.create` fold-eş → P2002; tombstone'a çevrilince aynı ad SERBEST; tombstone + canlı varken ikinci canlı yine P2002; items/subcontractors aynı; 22/22) · sabit adlı fixture'lar damgalı (`test_printed_documents` "Test Müşteri/Kumaş/Kartela Fason", `test_document_customization`, `test_masterdata_guards` — artık kalan ad 2. koşumu P2002'ye düşürür; `test_master_data_name_dup §8` istasyon üzerinde, sed dışı, dokunulmadı).
> • **Dev DB temizliği:** 8 grup (müşteri 1 · kumaş 4 · fason 3) `MasterDataMergeService.merge` ile (tombstone, FK-güvenli; hard-delete DEĞİL) birleştirildi — yalnız dev; prod boş doğar; `tekserp_saha`/`adnansahin_ticaret`'e migration koşulmaz. Kalan `colors` 1 + `stations` 3 test artığı sed dışı.
> • **(b) `Roll.entryReasonCode` / `cancelReasonCode`** (`20260821150100_roll_reason_codes`, VARCHAR(64) nullable, index yok, metadata-only). METİN görünen kayıt, KOD rapor anahtarı (`RollVariance.reasonCode` sözleşmesi). **Kodu sunucu çözer — `reason-preset.service.resolveReasonCode`:** açık `reasonCode` geldiyse katalogda doğrulanır (GİZLİ satır kabul; bilinmeyen → 400 `REASON_CODE_INVALID`; metin boşsa preset metniyle dolar — kod dolu/metin NULL olmasın); yoksa metin label VEYA fullText ile `foldNameForCompare` eşlenir ("yanlış metraj girildi" ≡ "Yanlış metraj girildi" → `YANLIS_METRAJ`); serbest metne kod UYDURULMAZ (NULL). **Async, tx DIŞINDA** (önbellek bayatsa DB'ye gider; `applyRollDispositionsTx` tx içinde katalog okumaz → çağıran `reasonCode` geçirir). Mobil bugün yalnız metin gönderiyor (`fullText ?? label`) → APK değişmeden ilk günden dolar. **Yazma yolları (tam):** entry tek satır `createInitialEntry` (`opts.entryReasonCode`) ← `tambur-manual` ×2 (Zod `reasonCode` opsiyonel — `z.object` strip tuzağı) · cancel: `inventory.softDelete` (query `?reasonCode=`; **yan düzeltme** `cancelReason` 500 kırpması yoktu) + `roll-disposition.helper` (`args.reasonCode`) ← WO cancel/close/batch-drop (Zod + input tipleri). Audit `newData.reasonCode`; restore kodu da NULL'lar; `getRollHistory` CREATED `manualReasonCode`; liste/detay/barkod `include:` → otomatik. Dokunulmayanlar (CANCELLED yazıp iz yazmayanlar): `tambur-undo` ×3, `hardDelete`, `subcontractor.service` ×2. `KIND_STORES_TEXT` bayrağı KALIR (fullText saklama kararı), "kod saklanmaz" anlamı düştü; Electron ReasonPresets uyarıları `warning`→`info` ("kod aynı, rapor bölünmez"); mobil aynaları **sonraki APK** (açık kod gönderimi: `RollCancelModal`, `TamburScreen`, `TamburManualRollModal` sabit diziden `useReasonPresets`'e; çevrimdışı `BUILTIN_*` kodları GÖNDERİLMEZ, sunucu türetir).
> • **Bekçiler:** `test_reason_presets` **§5** (38: label/fullText/katlanmış İ-ı/kind karışmaz/serbest→null/gizli satır/uydurma kod/açık kod+boş metin/açık kod+metin ezilmez) · `test_roll_cancel_undo` 48 (katlanmış eşleşme → kod; kısa doldurma → kod null; restore → null; serbest metin okutma yanıtında null) · `test_batch_drop` 33 · `test_roll_fold_and_reason` 15 · `test_tambur_manual_roll` 70 + `_produce` 78 (preset → `SAYIM_FARKI`; serbest → null; uydurma kod → 400). typecheck/typecheck:scripts/lint/check:migrations/migration_hygiene/schema_drift yeşil; Electron typecheck 0.
> • **Deploy:** ikisi de **backend ÖNCE**, istemci bekletilmez (ek Zod alanları opsiyonel; eski APK metin gönderir → kod türetilir). 28. migration sıfırlanmış DB'de risksiz; ertelenirse §10 reçetesi (`SURUM-2.9.0…md`). İzin YOK.

> ⚠️ **PROFİL GERÇEĞİ:** §21-§26 bekçilerinin bir kısmı fason/üretim varlıklarını sorgular — modül kapalı kurulumda o bölümler tanım gereği boş döner ve bu bir arıza DEĞİLDİR (bölüm kaldırılmaz, sıfır satır beklenir). **Çekirdek:** "TEK KAYNAK + AST bekçisi" deseni, `repointPendingBypassAssignmentsTx` sırası ve "üretilen metraj kalite kovası KATALOGDAN" — bkz. MODUL-BAYRAK-TASARIM §3 madde 8, §12 kural 9.

> **NOT (2026-08-21 akşam — Tutarlılık taraması: "türetilmiş alan / ayrışan yüzey" sınıfı kapatıldı):** `WorkOrder.type` hatasının (74d92085) sınıfından başka hata var mı diye 5 keşif ajanı + saha yedeği (`tekserp_saha`) tarandı (rapor `docs/design/TUTARLILIK-TARAMA-2026-08-21.md`), bulgular koddan teyit edilip 4 Opus ajanıyla uygulandı. **Kesin hatalar:** ① **Fason "açık+outstanding sevk" koşulu 22 yerde kopyaydı, 4'ünde `directShippedAt IS NULL` ve `receipt.cancelledAt IS NULL` YOKTU** (Fason Sevk picker `excludeWithOpenDispatch`, WO iptalinde açık sevk kapatma, mobil `hasOpenDispatch`, Hızlı Kabul preview) → kabul iptali (LIFO) sonrası sevk "kapalı", tam doğrudan-sevk sonrası "açık" sanılıyordu. TEK KAYNAK `helpers/fason-open-dispatch.helper.ts` (`OUTSTANDING_ITEM` · `OPEN_OUTSTANDING` · `outstandingItemOfOpenDispatch(extra)`; `as const` YOK, hep spread); 22 site helper'a bağlandı; AST bekçisi `test_fason_open_dispatch_single_source.ts` (kalıp `receiptItems→none→isPartial` yalnız helper'da; `cancelledAt:null + items.some` taşıyıp `directShippedAt` taşımayan dispatch where'i ihlal — `remainderClosedAt` ile model ayrımı) + davranış testi `test_fason_open_dispatch_semantics.ts`. ⚠️ **Davranış değişti:** kabul iptali sonrası WO Fason Sevk listesinden GİZLENİR (istenen); `subcontractor.service` sevk-iptali "başka açık sevk var mı" sayacı doğrudan-sevk edilmiş kardeşi artık açık saymaz (adım COMPLETED'a dönebilir — fiziksel gerçek). ② **`repointRollsTx` kurşun bypass atamasını taşımıyordu** → TRANSFER'da aynı tx'in sonundaki force-void atamayı iptal ediyor (makine atfı kayıp, Tambur "dağıtılmadan kapanış"), Tebdil/split'te SUPERSEDED WO'da öksüz atama. Çözüm: `kursun-bypass-guard.helper.repointPendingBypassAssignmentsTx` (workOrderId DENORMALİZE → ikisi birlikte; yalnız taşınan topların adımları; `repointRollsTx`'ten sonra, force-void'den ÖNCE — void kaynak WO id'siyle, repoint edilmiş satırı görmez); split'te hedef WO'ya atama TAŞINMAZ (toplar boyahaneye sarılır, planlamacı yeniden dağıtır) — recompute sonrası non-force `SPLIT_SOURCE` void + `supersedeEmptiedSourceWorkOrderTx`'te force `WO_SUPERSEDED` void. Bekçi `test_kursun_bypass_repoint.ts` (27). ③ **Kartelalık işareti değişince `Roll.labelDirty` yazılmıyordu** (etikette `kartelaMark` basılıyor): `setRollMarkedForKartela` atomik claim + `labelPrintedAt IS NOT NULL` ise her iki yönde bayat (basılmamış etiket bayatlamaz — sahte uyarı körleştirir). ④ **Sipariş iptali (`cancelWithActions` + legacy `softDelete`) kartı bayat işaretlemiyordu** → `markTravelerCardDirtyTx`; legacy `softDelete` artık yalnız PLANNED değil CANCELLED/SUPERSEDED dışı TÜM bağları siler + son bağı kalkan ORDER_PRODUCTION'ı STOCK'a çevirir (tip bağın aynası; `targetItemId` NULL ise çevirmez). ⑤ Electron `TravelerCardPrintDialog` ölü anahtar `["work-order"]` → `["work-order-detail"]`+`["work-order-branches"]` (2026-08-17 LinkOrderDialog dersinin ikinci vakası); ⑥ `BranchLanes` parti birleştirme `["work-orders"]` tazeler (transfer ile simetrik, onSettled). **Kararlar:** **D1** "üretilen metraj": liste `producedMeters` ve detay `producedRolls` artık AYNI tanım = 1. kalite + **A1** (fire hariç) ve kalite kovası KATALOGDAN (`roll-finalize.helper.loadProducedBuckets`: `QualityGrade.targetStatus` SCRAP→fire, A1_STOCK→a1, diğer/null/bilinmeyen→warehouse; isActive süzgeci YOK — pasif eski kod topun üstünde durur; `notIn: []` üretilmez; `unknownCodes` raporlanır); `"FIRE"/"A1"` gömülü kodlar kaldırıldı (şema 2467 ilkesi). Bekçi `test_produced_buckets.ts`. **D2** `Sack.labelDirty` artık üç yazma noktası: şablon değişimi · **içerik** (`markSackContentChangedTx` — eski `resetSackWeightsTx`; labelDirty AYRI updateMany — kg koşuluna bağlanırsa tartılmamış çuvalda hiç yazılmaz, ölçüldü) · **not** yalnız etkin şablon `sackNote` basıyorsa (`sackNoteAppearsOnLabel`, `CustomerTemplateRoute ?? LabelContextDefault` + `collectBoundKeys`). `repair_sack_ghost_rolls.ts`'teki elle kopyaya da eklendi. Bekçiler `test_label_dirty_sources.ts`, `test_order_cancel_card_dirty.ts`. **Küçükler:** `getCompletePreview.orderLinked` = `type===ORDER_PRODUCTION` (ikinci kaynak kalktı); Electron `RollDetailSheet` tek gösterim kaynağı `detail ?? roll`; "kalan metraj" üç kopya → `order-fulfillment.lineOpen` (clamp'li; davranış değişmiyor — tüketiciler `>0` süzüyor); mobil `PendingReturnGroup.workOrder.batchNumber` = İş Emri No yorumu. **Yeni bekçi çifti** `scripts/consistency-check-derived.sql` + `scripts/test_consistency_derived.ts` (test_consistency'ye DOKUNULMADI — eşzamanlı oturum düzenliyordu): §21 WO.type↔bağ (iki yönlü; `onDelete: Cascade` ile sessiz düşen bağ için), §22 IN_PROGRESS ama adımlar bitti, §23 açık bypass+terminal WO, §24a tek tam makbuzu iptal edilmiş "kapalı" kalem, §24b doğrudan-sevk + top hâlâ fasonda (spec'ten bilinçli sapma: `AT_SUBCONTRACTOR` süzgeci yoksa her meşru doğrudan-sevk drift sayılırdı), §25 kartela damgası baskıdan sonra değişmiş (audit `EXISTS`, 6 ay sınırı yazılı), §26 renk≠plan Tambur çıktısı — **bilgi modu** (saha'da 4 gerçek satır, 17 Ağu; kapı 19 Ağu) + §26b tarih eşikli gerçek check (`PLAN_GATE_SINCE`, varsayılan 2026-08-20; `roll_plan_deviations` sahada BOŞ → körlük zemini basılıyor). `--probe` aynı dosyada (ayrı test dosyası her `npm test`'te dev DB'ye bozuk satır yazardı), geri alınan tx içinde baseline farkıyla, 10/10 kırmızı→yeşil; gürültü filtresi eklenmedi (dev'de 501 fixture WO'da bile 0). **Doğrulama:** backend typecheck + typecheck:scripts + eslint temiz; 23 test yeşil (yeni 7 + komşular); Electron typecheck + vitest 128; mobil tsc. Negatif sondalar: I1 5, I2 10, I4 10 — hepsi kırmızı verdi, md5/sha ile geri yüklendi. **Migration/izin YOK; APK gerekmez** (mobil yalnız yorum); backend ÖNCE (K1 davranış değişikliği → operatöre not), Electron sonra. **Saha verisi (bu turda YAPILMADI, kullanıcı kararı):** IE1008260014 4 top EKRU↔BEYAZ · depoda FIRE 4 top · 2 top currentQty>initialQty · 3 mükerrer tanım · `fix_workorder_type_from_links.ts --apply` prod'da bekliyor. ⚠️ Paylaşımlı ağaç: eşzamanlı oturumun commit'leri (c3f6d118) ajanların bazı yeni dosyalarını yarım süpürdü (`test_fason_open_dispatch_single_source.ts` HEAD'de, helper'ı değil → HEAD'de o bekçi kırmızı) — bu paket commit edilince tutarlılık geri gelir.
> • **ANOMALİ TARAMASI (aynı gün, ikinci tur) — üç bulgu, üçü teyitli ve kapalı:** ① **Etiket düzenlenince eski metin koda çözülmüyordu** (taze-DB sondasında ölçüldü: `update()` eski label/fullText'i hiçbir yere yazmıyor; mobil `reason_presets_v1` önbelleği + `BUILTIN_*` zemini eski metni göndermeye devam eder → `Roll.*ReasonCode` NULL). Çözüm sektör kalıbı — stabil anahtar + ESKİ-AD SÖZLÜĞÜ: `reason_presets.legacyTexts TEXT[]` (`20260821220000_reason_preset_legacy_texts`), `ReasonPresetService.update` tek yazar (`nextLegacyTexts` saf: eskiler eklenir, güncel label/fullText'e eşit olanlar ve tekrarlar temizlenir, en yeni 20 kalır), çözücü sırası **güncel → eski adlar → null** (güncel ad eski ada karşı öncelikli: B'nin bugünkü adı A'nın dünkü adıysa B kazanır; iki satırda aynı eski ad → belirsiz → kod UYDURULMAZ). DTO'da salt-okunur (`legacyTexts`), Electron tipi opsiyonel, API'den düzenlenmez. Bekçi `test_reason_presets §6` (54). ② `workorder.routes.ts` `roll-attribute-targets` Swagger bloğunda `summary: "Toplara da uygula" için …` tırnaklı değer ardından metin → YAML parse düşüyor, uç Swagger'dan SESSİZCE kayboluyordu (sabahki `fc7a5034`'ten). Tırnak düzeltildi + **yeni bekçi `test_swagger_spec.ts`**: `swagger-jsdoc` aynı seçeneklerle `failOnErrors:true` (bozuk blok → kırmızı, dosya adı mesajda) + yol sayısı körlük zemini (≥120; bugün 382 yol / 469 işlem). `swagger.ts` `swaggerOptions`'ı export eder. Negatif sonda: blok bozulunca 3 kırmızı. ③ `seed-fixtures` upsert'i birleştirilmiş (tombstone) MUS-002'yi `isActive:true` ile DİRİLTİYORDU (dev DB'de ölçüldü) → `isMergedTombstone` yardımcısı: kod bulunur + `mergedIntoId` doluysa ATLA ve logla (ürün/renk/müşteri). Taze/CI DB'de davranış değişmez. Kapılar: typecheck/scripts/lint/drift/invariants/Electron typecheck yeşil.

> ✅ **ÇEKİRDEK:** **expand → backfill → contract** (kısıt veri temizlenmeden aynı sürümde gelmez) ve "prod'da `test_db_invariants` §1 kırmızı = enforce bekliyor, bilerek" — her müşteri kurulumunda aynen geçerli; yeni fabrikaya kurulumda taze DB sed'i ANINDA alır, göç edilen DB'de yumuşak kapı devreye girer.

> **NOT (2026-08-22 — SIFIRLAMA RAFA KALKTI: nameFold seddi YUMUŞAK KAPIYA çevrildi; mükerrer paneli tasarımı):** Dünkü 28. migration "mükerrer varken RAISE EXCEPTION" idi (plan boş DB'ydi). Sıfırlama ertelenince bu, prod'daki HER deploy'u (29/30 ve sonrası) 9 mükerrer grup birleştirilene dek bloke ederdi — ve birleştirme iş kararı. Sektör kuralı **expand → backfill → contract**: kısıt veri temizlenmeden aynı sürümde gelmez. Dosya prod'a hiç uygulanmadığı için düzenlendi (`search_fold` emsali): tablo tablo bakar, **mükerrer yoksa index kurulur, varsa NOTICE ile atlanır**; temizlik sonrası aynı dosya yeniden koşulur (idempotent enforce). Şema `@@unique` KALIR (dev/CI/taze kurulumda sed anında); prod'da o güne dek `test_db_invariants` §1 kırmızı = "enforce bekliyor" (bilerek, unutulmasın). Dev checksum'ı `_prisma_migrations` satırı silinip `migrate resolve --applied` ile yenilendi. Taze-DB + mükerrerli-DB sondaları: temizde 3 index kuruldu, mükerrerlide NOTICE + deploy geçti, temizlik sonrası yeniden koşumda kuruldu. Karar (kullanıcı): A yumuşak kapı · panel kapsamı ana veri 4'lü + müşteri şubeleri + toplar (hayalet KK1) + istasyon/makine/kategori · tespit kesin ad + kimlik + bulanık ad · birleştirmede alan-bazlı survivorship. Tasarım: `docs/design/MUKERRER-PANELI-TASARIM.md`.

> ⚠️ **PROFİL GERÇEĞİ:** `shipping.confirmationEnabled` bu kurulumda KAPALI (`readShipmentConfirmationEnabled` varsayılanı `false`) — not "kapalı rejim" davranışını anlatır; açık rejimli fabrikada PLANNED doğal durumdur ve storno varsayılanı işaretsiz gelir. **Çekirdek:** "karo `visibleWhen` SAF bayrak", "iptal gövdesi TEK KAYNAK (`cancelPlannedShipmentTx`)" ve "route bayrağa bakmaz — derin bağlantı açılır, yalnız menüde çizilmez" — bkz. MODUL-BAYRAK-TASARIM §3 madde 3.

> **NOT (2026-08-22 — SEVK KAPISI = BAYRAĞIN EKRANI; storno kapalı rejimde sevkiyatı KAPATIR):** Saha sorusu (prod yedeği `tekserp_20260822_013613.dump`): sevk onayı bayrağı KAPALI fabrikada Operasyon hub'ında "Sevk Kapısı" karosu beklenmedik şekilde belirdi. Sebep: `SVK2008260008` 2026-08-20'de doğrudan sevk edilmiş, 2026-08-21'de **storno** ("Boyer'de böyle bir sipariş yok") ile `DISPATCHED → PLANNED`'a düşmüştü; karo kuralı 2026-08-05'ten beri "bayrak açık **VEYA** çıkış bekleyen PLANNED varsa" idi (storno işi bayrağı aç-kapa edilebilir yaptığı için eklenmişti — yoksa çıkış onayı yalnız o ekranda olduğundan mal kapıda, ekran yok). Kullanıcı itirazı haklıydı: **bayrak kapalıysa çözüm Sevk Kapısı menüsünden geçmemeli.** Ölçülen boşluk iki parçaydı: (a) storno sonrası sevkiyat PLANNED'da **çuvalları üstünde kilitli** bekliyordu (Paketleme "önce Sevk Kapısı'nda çıkarın" diyordu, çuval bir gün kilitli kaldı) ve kapalı rejimde "planlı sevkiyat" kavramının karşılığı yoktu; (b) geri alma penceresi "sonra ne olacak"ı söylemiyordu. İptal yolu zaten menüsüz çalışıyordu (Sevkiyatlar → İptal Et).
> • **Karar: 1 + 2 birlikte (kullanıcı onayı).** ① Geri alma penceresine **"Sevkiyatı da kapat — çuvallar depoya dönsün"** seçeneği: backend `undoDispatch(…, { releaseSacks })` storno gövdesinin ardından **AYNI tx'te** `cancelPlannedShipmentTx` çağırır (CANCELLED; çuval `shipmentId/seq` null, top `shipmentId` null ama **`sackId` KORUNUR** — depoya dönen şey çuvaldır; tahsis silinir, `ShipmentOrder.isActive=false`, `shippedQty` 0, tüm irsaliye sürümleri VOIDED; iade defterine yine yazmaz). İptal gövdesi **TEK KAYNAK** oldu: `cancelShipment` de aynı helper'ı çağırır (ikinci kopya, storno kapanışının çuvalı üstünde unutmasıyla ayrışırdı). **Varsayılan İSTEMCİDE** ve önizlemedeki yeni `confirmationEnabled` alanından kurulur: kapalı rejim → işaretli (PLANNED beklemenin karşılığı yok), açık rejim → işaretsiz (PLANNED doğal durum); kullanıcı iki rejimde de değiştirir. Bedel: yeniden çıkış Paketleme'den **YENİ sevkiyat / yeni sevk no** (eski irsaliye zaten VOIDED). **Storno izni (`shipping:undo-dispatch`) kapanışı da kapsar** — aynı kararın parçası, ayrıca `shipping:write` aranmaz. Seçenek işaretsizken metin "planlı durumda bekler; Sevkiyatlar'dan **Sevk Et** (açık rejimde + Sevk Kapısı)" der; işaretliyken "sevkiyat iptal olur, yeniden göndermek için Paketleme'den yeni sevkiyat". Düğme adı seçime göre "Sevki Geri Al" / "Geri Al ve Kapat". ② **Sevkiyatlar detayı (sheet + tam sayfa) PLANNED sevkiyata "Sevk Et"** verir — Sevk Kapısı'nın ORTAK `DispatchConfirmDialog`'u (çuvallar canlı listelenir, irsaliye başarı panelinden basılır; `shipping:write`). Böylece bayrak açıkken kurulup sonra bayrağı kapatılmış eski PLANNED sevkiyatlar da Sevkiyatlar'dan çözülür (① bunları kapsamaz). ③ **Karo kuralı saf bayrağa indi**: `visibleWhen: ctx => ctx.shipmentConfirmationEnabled`; `OperationsVisibilityContext` tek alan (`pendingPlannedShipments` + `sack-store/board?limit=1` sondası KALKTI; `useOperationsVisibilityContext` artık yalnız bayrağı okur). Route (`/operations/sack-store`) bayrağa bakmaz — eski sekme/okutma hedefi ("Sevk Kapısı'nda aç") yine açılır, yalnız menüde/palette çizilmez. ④ Metinler: Paketleme kilit uyarısı "Sevkiyatlar'dan iptal edin (çuvallar depoya döner) ya da — sevk onayı açıksa — Sevk Kapısı'nda çıkarın"; Genel Ayarlar bayrak açıklaması ekranın yalnız açıkken göründüğünü ve storno varsayılanını söyler.
> • **Reddedilen seçenek:** "kapalı rejimde storno HER ZAMAN kapatsın (sorusuz)" — aynı araca yeniden yükleme senaryosunu (plaka/şoför bilinçli korunuyor) ve açık-rejimden kalan PLANNED'ları kapsamazdı; seçenek + Sevkiyatlar'da Sevk Et ikisini de karşılıyor. "Yalnız yönlendirme mesajı" da reddedildi — Sevk Kapısı bağımlılığını çözmez.
> • **Geriye uyumluluk / deploy:** migration YOK, izin YOK, APK YOK (mobilde storno yok; tablet "Sevk Çıkışı" izin kapılı, bayrağa bakmıyor — değişmedi). **Backend ÖNCE**: eski Electron `releaseSacks` göndermez → sunucu `false` sayar → eski PLANNED davranışı. Yeni Electron eski backend'e düşerse `releaseSacks` Zod'da bilinmeyen alan olarak yutulur (strip) → yine PLANNED; kullanıcıya "kapatıldı" demez çünkü mesaj sunucudan gelir. Prod'daki `SVK2008260008` hâlâ PLANNED — deploy sonrası Sevkiyatlar'dan **İptal Et** (sipariş yok) ile kapatılır.
> • **Bekçiler:** backend `test_shipment_undo_dispatch` **§10** (50 kontrol: `released/freedSacks`, CANCELLED, çuval havuza, toplar rafına + ÇUVALDA, tahsis 0, isActive false, shippedQty 0, 3 sürüm VOIDED, iade defteri boş, iptal sonrası storno/iptal idempotent; önizleme `confirmationEnabled` boolean). ⚠️ Testte `/iptal/i` **"İptal"** ile EŞLEŞMEZ (JS `i` bayrağı U+0130'u katlamaz) → `/[İi]ptal/`. Electron `tile-visibility.test` (bayrak kapalı → gizli; ctx anahtar listesi kilitli — sayaç geri eklenirse derlenmez), CommandPalette mock'ları sadeleşti, Shipments + SackStore vitest 38 yeşil; iki taraf typecheck + lint temiz. `test_swagger_spec` yeşil (YAML bloğuna `releaseSacks` eklendi).

> ⚠️ **PROFİL GERÇEĞİ:** Bulanık eşleştirme profilleri (FIRM/PRODUCT gürültü kelimeleri, eşik %90) **bu fabrikanın canlı kopyasıyla kalibre edildi** (9 yanlış pozitif → 1 gerçek); yeni fabrikada ad yapısı farklıdır → eşik ve gürültü listesi kurulum başına yeniden ölçülür (`duplicatesFuzzyThresholdPct` zaten panelde). **Çekirdek:** "birim KELİME, karakter DEĞİL", "`token_set_ratio` KULLANILMAZ", "kimlik alanına DB seddi BİLİNÇLİ YOK" ve "inceleme SQL'de, UYGULAMA MOTORDA" — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-22 — MÜKERRER PANELİ v2 P1 UYGULANDI):** Kullanıcı kararları: kapsam ana veri 4'lü + şube + toplar + istasyon/makine/kategori (P1'de yalnız 4'lü — motor desteği olmayan varlık kuyruğa girmez) · tespit kesin ad + kimlik + bulanık · eşik panelden · karar çift bazlı · hayalet topta asıl = etiketi basılan/hareket gören. **Kod:** `constants/duplicate-rules.ts` (kimlik kuralları: müşteri VKN/ihracat kodu/e-posta/telefon, fason VKN/telefon, kumaş kod harf-ikizi; renk hex BİLİNÇLİ YOK — canlıda `#ffffff` 7 meşru beyaz; gürültü kelimeleri; `FUZZY_PROFILE` FIRM/PRODUCT) · `utils/string-similarity.ts` (Jaro-Winkler, token-SORT, numerik token koruması, `compactKey`, `firmNameSimilarity`/`productNameSimilarity`) · `duplicate-detection.service` (tarama, union-find gruplama, referans sayısı, CSV) · `duplicate-review.service` (+ `DuplicateReview` tablosu, migration `20260822120000`) · merge hook MERGED · uçlar `/api/master-data/duplicates/candidates[.csv] | /reviews` · Electron `DuplicatesPage` (gerekçeli gruplar, çift başına Ertele/Mükerrer değil/Geri aç, CSV) · ayar dört kapı · bekçi `test_duplicate_detection` (55). **Canlı kopyada (2026-08-22 dump) üç tur ölçüm, her tur kuralı düzeltti:** ① `token_set_ratio` alt-küme adları %100 sayıyordu ("MODA" ⊂ "MODA ANKARA") → token-sort; ② kumaş/renkte gürültü listesi tek harfli ön ekleri ("A.GRİ", "S.BEYAZ") siliyor, Jaro-Winkler ön ek bonusu varyant ailelerini ("KRİSTAL GÜMÜŞ-EKRU/-GRİ", "ACTİVO SİYAH-(KREM/BEYAZ …)") %93-95'e çıkarıyordu → PRODUCT profili (gürültü yok, token sayısı eşit, JW yok); ③ birleşik token-sort oranı uzun ortak token'larla tek farklı kelimeyi sulandırıyordu (tag'li fixture'da "ekru"↔"gri" %90) → sıralı token çiftlerinin EN DÜŞÜK oranı. Sonuç: kumaş bulanık 9 yanlış pozitif grup → 1 gerçek (MIKROCANVAS/MİKRO CANVAS), renk 9 → 2 (kelime sırası; insan incelesin), müşteri 1 (BOYER EMRE/BOYER %90). Ders: bulanık kural **kayıt ailesinin yapısına** göre profillenmeli; tek genel skor ya gürültü ya da körlük üretir.
> • **4. TUR — KARŞILAŞTIRMA BİRİMİ KARAKTER DEĞİL KELİME (aynı gün, saha kararı):** Canlı kopyada müşteri tarafındaki tek bulanık aday `BOYER EMRE | BOYER` idi; kullanıcı **"farklı firma"** dedi. Ölçüldü: Jaro-Winkler **0.900** (tam eşikte), token-sort **0.500** — skoru eşiğe taşıyan şey JW'nin ORTAK ÖN EK BONUSU, yani adın sonuna eklenen ANLAMLI kelimeyi ("EMRE") yok sayması ("MODA" ↔ "MODA ANKARA" da aynı yoldan gelirdi). **JW kaldırıldı**; skor artık SIRALI KELİME HİZALAMASI (kelimeler sıralanır, karşılıklı eşlenir, eşi olmayan 0 alır): FIRM = çiftlerin ortalaması (gürültü kelimeleri düşülmüş), PRODUCT = en düşük çift + kelime sayısı eşitliği; iki profilde de sıkıştırılmış metin eşitse 1. Yan kazanç: eşik OKUNABİLİR bir ölçek oldu (%100 yazım/boşluk · %90 neredeyse aynı · %80 tek harf hatası) ve "fazladan anlamlı kelime" sınıfı HİÇBİR eşikte gelmiyor (0.50) — eskiden %80'e inince de geliyordu. Canlı kopyada eşik %90 ve %80 AYNI sonucu veriyor: müşteri 0 · kumaş 8 grup (1 bulanık: MIKROCANVAS/MİKRO CANVAS %100) · renk 5 (2 bulanık: kelime sırası) · fason 3. Bekçi 60 kontrol. **Ders:** bulanık eşleştirmede karakter benzerliği (JW/trigram) İSİM ALANLARINDA yanıltıcıdır — insan "kelime ekledi mi" diye bakar, algoritma da öyle bakmalı.
> • **P2–P5 UYGULANDI (2026-08-22 gecesi, kullanıcı "planı bitir" dedi):** ① **P2 alan-bazlı survivorship** — `merge-fields.ts` kataloğu (müşteri 12 · fason 5 · renk 3 · kumaş 1); `code` HİÇBİR varlıkta seçilemez (belgeye basılır + `@unique`; kaynağın kodunu taşımak tombstone'un kimliğini bozar), kimlik alanları zaten blocker. Seçim **DEĞER değil KAYIT** üzerinden (`fieldPicks[alan]=kayıtId`) — serbest metin alınsaydı uç, birleştirme kılığında sınırsız bir alan düzenleme API'si olurdu. Öneri kuralı MDM standardı (completeness → trust → recency). **⚠️ SIRA LOAD-BEARING:** survivor alan yazımı ATOMİK CLAIM'DEN SONRA — kaynaklar tombstone olduktan sonra partial UNIQUE onları dışlar; önce yazsaydık en sık senaryo ("kaynağın adını hedefe taşı") P2002 verirdi. Ad seçiminde grup dışı canlı eş → 409. İki ayrı audit satırı (kaynakta MERGE, survivor'da MERGE_FIELDS). Bekçi 54. ② **P3 kapsamı ÖLÇÜMLE önceliklendirildi:** canlıda şube 0 · istasyon/makine/kategori 0 · **top 6 küme / 8 fazla** → yalnız **P3c** yapıldı, diğerleri reçetesiyle ertelendi (sıfır ihtiyaç için üretim-kritik FK'lara yeni yazma yolu açmak yanlış). P3c'de fiil BİRLEŞTİRME DEĞİL İPTAL (top işlem kaydıdır; iki kaydı birleştirmek metrajı toplamak olurdu) — `MUKERRER` koduyla, topun KENDİ ucundan (`DELETE /api/rolls/:id`), toplu iptal ucu BİLİNÇLİ YOK ki etiket/çuval/sevk guard'ları atlanmasın; "asıl" = etiketi BASILAN top (sahadaki kâğıt onu gösteriyor); tespit `duplicate-rolls.service`e taşındı ve `find_duplicate_rolls.ts` artık yalnız YAZICI (script↔panel ayrışması yapısal olarak imkânsız). Bekçi 16. ③ **P4 CSV köprüsü** `apply_merge_decisions.ts` (dry-run varsayılan): dosya hataları TOPLU raporlanır ve hiçbir şey uygulanmaz, her satır önizlemeden geçer, `--apply`da düşen satır diğerlerini durdurmaz. **İnceleme SQL'de, uygulama MOTORDA** — ham UPDATE 42 kurallık FK haritasını, çakışma politikalarını, etiket/kart bayatlatmasını, advisory kilidi ve audit'i atlar. Canlı kopyada uçtan uca denendi (fason birleştirme + renk "mükerrer değil" → tarama 3→2 grup, çift gizlendi). ④ **P5:** enforce komutunu `find_fold_duplicates` temiz çıktıda kendisi yazdırıyor; kimlik alanına (VKN) DB seddi **bilinçli konulmadı** — aynı tüzel kişiye ikinci cari kart meşru bir iş kararı olabilir; kimlik alanı sektörde *eşleştirme sinyalidir*, tekillik kısıtı değil.

### 2026-08-22 — §13 kök nedeni: tekil geri almada AŞIM KORUMASI canlı dalda yoktu (ayna kırıktı)

> ⚠️ **PROFİL GERÇEĞİ:** §13'ün "canlıdaki 2 satır BİLEREK düzeltilmedi" ve §18'in "kumaş 5 · fason 2 grup" ölçümleri **bu fabrikanın verisidir** — yeni kurulumda mutabakat kapısı temiz doğar, o yüzden kırmızı satır "bilinen borç" değil GERÇEK bir sapma sayılır. **Çekirdek ve taşınabilir olan ders:** bir mutabakat kırmızısı üç ayrı şey demek olabilir — kod hatası (§13) · iş kararı bekleyen veri (§18) · sorgunun kör noktası (§20); üçünü ayırmadan "drift düzelt" demek ikisini yanlış yerden onarır.

Mükerrer paneli bitince, kullanıcının kararını bekleyen iki canlı-veri bulgusu (`§13`, `§20`)
**prod kopyasına karşı** ölçüldü (`tekserp_saha_0822`; `test_consistency` salt-okunurdur ve canlı
DB'ye karşı koşulabilecek şekilde yazılmıştır — asıl değeri orada). Sonuç: 22 bölümün **19'u
temiz**, üç sapma var ve üçünün de niteliği farklı.

**§13 (`currentQty > initialQty`) — 2 satır, KÖK NEDEN BULUNDU ve KOD TARAFI KAPANDI.**
İki topun ikisi de `SUBCONTRACTOR_RETURN`, ikisinde de `TAMBUR_UNDO_REOPEN` hareketi var, ikisinin
de TÜM çocukları `CANCELLED` ve birinde `currentQty` çocukların toplamına **birebir eşit** (698,9).
Yani metraj bir geri almayla geri konmuş. `tambur-undo.applySingle` üç dala ayrılıyor:

| Dal | Ne yapar | Aşım koruması |
|---|---|---|
| `parentArchived` | metraj geri DÖNMEZ, `RECORD_CORRECTION` yazılır | — (konu dışı) |
| `producedInStepId != null` → **`cutOpenFabric` (ÜRETİM)** | yalnız `currentQty` geri | **YOKTU** |
| else → `cutWarehouseRoll` (DEPO) | `currentQty` **ve** `initialQty` geri | yapısal olarak gereksiz |

Arşiv ikizi (`applySingleFromArchive`) ve `applyFull` ise `initialBump` hesaplayıp `initialQty`'yi
yukarı çekiyor **ve** deftere `OVERAGE`/`TAMBUR_UNDO_RESTORE` yazıyor. Üstelik arşiv dalının kendi
yorumu iki yolun *"birebir aynası"* olduğunu ve *"ayna bozulursa aynı kesimin canlı/arşiv geri alması
farklı muhasebe üretir"* dediğini söylüyordu — **ayna tam burada kırıktı.**

**Erişilebilirlik doğrulandı, varsayılmadı:** `tambur.overQuantityEnabled` **varsayılan AÇIK** ve canlı
DB'de bu anahtarın satırı **hiç yok** → üretimde açık. Senaryo sonda ile üretildi: 100 m kayıtlı topa
40+40+40 kesilir (aşım kesim anında deftere yazılır, `currentQty` 0'a tıkanır), parçalar tek tek geri
alınır → **üçüncüsünde** `currentQty(120) > initialQty(100)` ve deftere **hiç** satır düşmez.

    öncesi:  init=100 cur=120 · OVERAGE=1  ⛔
    sonrası: init=120 cur=120 · OVERAGE=2  ✅

Düzeltme arşiv ikizinin kalıbının **birebir aynısı** — yeni semantik yok: `TAMBUR_UNDO_RESTORE`
kaynağı 5b terslemesinin zaten kapsamı dışında (tersleme süzgeci bilerek dar: yalnız
`TAMBUR_FINALIZE`/`TAMBUR_WAREHOUSE_FINALIZE`; kesim anı aşımı da kapsam dışı, çünkü *kesimler
gerçekten yapıldı*).

- **Bekçi `test_tambur_undo §11`** (4 kontrol). §5 bu invariantı yalnız **FULL + DEPO kesiminde**
  ölçüyordu; üretim akışının kendi dalı **ölçüsüzdü** — bekçinin kör noktası, hatanın kendisiyle
  aynı yerdeydi. Negatif sondayla kırmızı verdiği kanıtlandı (koruma devre dışı → 3 kontrol düştü),
  dosya `md5` ile birebir geri yüklendi.
- ⚠️ **Canlıdaki 2 satır BİLEREK düzeltilmedi.** İkisi de 2026-08-08 / 08-11 tarihli, yani sapma
  defteri (`RollVariance`, 2026-08-19) gelmeden önce doğdular. Toplu `UPDATE` §13'ün kendi uyarısının
  ihlali olurdu ("geçmiş satırları toplu UPDATE ile düzeltmek kök nedeni gizler"); kapı onları
  görünür tutar ve düzeltmek bir **iş kararıdır**. Bölümü DARALTMA — düzeltilirse kendiliğinden
  yeşile döner.

**§18 (ad mükerreri) — 3 satır, doğrudan yeni panelin işi.** `items: BGR 150 ŞEFFAF` ·
`colors: 1195-GRİ` · `colors: ALTIN-EKRU`. Katlanmış ada göre bakınca (`find_fold_duplicates`,
prod kopyası): **kumaş 5 grup · renk 3 · fason 2**. Kumaş ve fason **sedli tablolar** → yumuşak kapı
o iki tabloda index'i ATLIYOR; birleştirilince migration yeniden koşulup enforce edilir. Renk sedsiz
(gözlem). Yani "sed neden eksik" sorusunun cevabı artık **panelin ekranında**.

**§20 (`WorkOrderStep.status`) — 1 satır, ZARARSIZ ve yapısal.** `IE0608260004` / Kurşun+KK2 adımı
`COMPLETED`, ama adımın tek topu (`T080826F0001`) sonradan iptal edildi → türetilen değer
`PENDING`'e çöküyor. Adım durumu **tarihsel bir olgudur** (2026-08-06'da gerçekten tamamlandı);
`recomputeStepStatus` ölü topları saymadığı için mutabakat onu sapma sanıyor. Veri bozuk DEĞİL,
mutabakat sorgusunun kör noktası — düzeltme gerekirse §20'ye "adımın tüm topları ölü statüdeyse
`COMPLETED` meşrudur" süzgeci eklenir, veriye dokunulmaz.

**Ders:** bir mutabakat kapısının kırmızısı üç ayrı şey demek olabilir — *kod hatası* (§13),
*iş kararı bekleyen veri* (§18), *sorgunun kör noktası* (§20). Üçünü ayırmadan "drift düzelt"
demek, ikisini yanlış yerden onarır.

---

## 2026-08-25 — Saha deploy sonrası üç arıza: "kutu var, uç yok" · "soru var, süreç yok" · "ölçek var, sınır yok"

> ⚠️ **PROFİL GERÇEĞİ:** ②'nin ölçümü ("230 iptal / 1 fire, sebepli 24 iptalin hepsi kayıt hatası") ve ②c'nin "parti engeli kaldırıldı" kararı bu fabrikanın kullanımına dayanır. **Çekirdek:** İptal (`CANCELLED`, stok düşmez, `qtyOut=0`) ↔ Fire (`SCRAP`, stok düşer, `qtyOut=qtyIn`) ayrımı ve iki sebep kataloğunun İKİ FARKLI kapıdan geçmesi (`resolveReasonCode` ↔ `validateVarianceReason`) defter semantiğidir; ③'ün `SegmentedButtons` kuralı ve "yerleşim hatasında tahmin değil ÖLÇÜM" dersi de her kurulumda geçerli.

Fabrikaya backend+Electron+APK deploy edildikten sonra üç şikâyet geldi. Üçü de farklı sınıf
ve üçü de **yeni kodun ilk kez sahaya inmesiyle** görünür oldu. Teşhis, sunucunun 25.08 02:00
yedeği (`tekserp_saha_0825`, 2431 top / 209 iş emri) üzerinde yapıldı — 189 migration'ın hepsi
uygulanmıştı, yani hiçbiri veri/deploy arızası değildi.

### ① "Fasona renksiz gitsin" — YEDİ katmanda sessiz düşüş

`WorkOrderStep.dispatchWithoutColor` (2026-08-17 "ekru" kuralı) panelde işaretlenebiliyor,
kaydediliyor, çekide renk **yine basılıyordu**. Ölçüm: canlıda **623 iş emri adımının hiçbirinde**
işaretli değil; `route_steps`'te de sıfır. Yani özellik 8 gündür vardı ve **bir kez bile** üretime
yansımamıştı.

Sebep tek bir hata değil, aynı alanın yedi ayrı yerde düşmesiydi:

| # | Katman | Etki |
|---|---|---|
| 1-4 | `workorder.controller` Zod şemaları (`create.steps` · `create.stepPlanning` · `replace.steps` · `replace.stepPlanning`) | Zod bilinmeyen anahtarı **sessizce siler** — istek 200 döner, alan yoktur |
| 5-7 | `workorder.service`'in üç Prisma adım-yazımı (create nested `steps.create` · replace `update` · replace `create`) | `finalSteps` alanı taşıyordu ama DB'ye hiç ulaşmıyordu |
| + | `RouteService.ALLOWED_STEP_KEYS` | Şablona kaydetmek 400 verirdi → "şablondan miras" yolu da hiç kurulamadı |

⚠️ **Servis katmanı BAŞTAN DOĞRUYDU** (`overlay?.dispatchWithoutColor ?? s.dispatchWithoutColor ?? false`
üç yerde de duruyordu). Bu yüzden servisi doğrudan çağıran bir test **yeşil kalırdı** — bekçinin §1'i
bilerek METİN üzerinden koşar ve dört Zod bloğunu + üç yazım noktasını + allowlist'i ayrı ayrı arar.

Electron'un ana iş emri formu alanı **zaten gönderiyordu** (`stepsToCustom` taşıyor, F0813 "kesimde
kat düşüyordu" dersinin uygulanmış hâli); düşüş tamamen backend'deydi. Şablon yolları (
`buildFasonPlans` · `routeStepsToCreatePayload` · `workOrderPayload.stepPlanning`) taşımıyordu →
onlar da eklendi. ⚠️ `stepPlanning` süzgecine `dispatchWithoutColor` DA girer: yalnız o kutuyu
işaretleyip firma/kategori/not girmeyen adım aksi halde tamamen düşerdi.

Mobil Hızlı İş Emri'ne kutu eklendi (rota adımları ekranı, fason adımlarında). Değer **her fason adımı
için AÇIKÇA gönderilir (true de false da)**: yalnız true'yu göndermek, şablonda işaretli bir adımı
operatörün kapatma niyetini sessizce yutardı.

Bekçi: `scripts/test_dispatch_without_color.ts` (18 kontrol). İki negatif sondayla kırmızı verdiği
doğrulandı (Zod alanı silinince 1, create yazımı silinince 4 kontrol düştü); dosyalar `md5` ile
birebir geri yüklendi.

### ② Ölü etiket onayı KALDIRILDI — ve "stoktan kaldır" ikiye ayrıldı

Masaüstünde etiketi basılmış hiçbir top iptal edilemiyordu: `BulkCancelRollsDialog` düz
`DELETE /api/rolls/:id` çağırıyor, `confirmLabelPrinted`'i **hiç göndermiyordu** → 409 `LABEL_PRINTED`.
Üstelik hata `catch {}` ile yutulup yalnız "0 başarılı, 1 başarısız" yazılıyordu, yani operatör sebebi
hiçbir yerden öğrenemiyordu. (Aynı guard mobilde bağlıydı ve çalışıyordu — yüzeyler ayrışmıştı.)

**Kullanıcı kararı: guard kalksın.** Gerekçe kabul edildi çünkü doğrudur: onay bir sektör standardı
DEĞİLDİ — 2026-08-05'teki tek bir olaydan sonra eklenmiş yerel bir korumaydı ve karşılığında bir
"ölü etiket toplama" süreci hiçbir zaman kurulmadı. Kimsenin kullanmadığı bir liste uğruna operatörü
durduran onay, sıfır kazanç karşılığında yol kesiyordu. ⚠️ **KOLON DURUYOR**: `labelPrintedAt` baskı
anında otomatik yazılır, kimseye iş çıkarmaz ve soru bir gün sorulursa cevabı orada. Kaldırılan şey
veri değil, **soru**. `confirmLabelPrinted` sözleşme uyumu için kabul edilmeye devam eder (sahadaki
APK'lar gönderiyor) ama hiçbir kapı açmaz — geri koyarken bunu da hatırla, yalnız 409'u geri koymak
bayrağı göndermeyen istemcileri sessizce kilitler.

**Asıl kazanım ayrımın kendisi.** Kullanıcı "silme sektör standardına aykırıysa doğrusu ne" diye
sordu; cevap: fiziksel silme hiçbir ERP'de yok (geçmiş rapor bugün değişir, basılmış belgeler
sahipsiz kalır) ama **iki ayrı eylem** standarttır ve sistemde zaten ikisi de vardı:

| | Anlam | Stok | Fire raporu | SAP karşılığı |
|---|---|---|---|---|
| **İptal** (`CANCELLED`) | "Bu kayıt hiç olmamalıydı" | Düşmez (mal zaten yoktu) | Girmez | ters kayıt / MBST |
| **Fire** (`SCRAP`) | "Mal vardı, artık yok" | Gerçekten düşer | Girer | fire mal çıkışı / 551 |

Canlı veri kararı doğruladı: **230 iptal / 1 fire**, ve sebep yazılmış 24 iptalin tamamı
("Yanlış ürün/renk", "Mükerrer giriş", "Yanlış metraj", "Top fiziksel olarak yok") gerçekten kayıt
hatası. Yani saha zaten doğru kutuyu kullanıyor; eksik olan fire kutusunun masaüstünde hiç olmamasıydı.

Uygulama: `softDelete`'e `mode: "CANCEL" | "SCRAP"` eklendi + yeni uç
`POST /api/rolls/:id/scrap` (izin **`roll:manual-adjust`** — `roll:write` yetmez, fire gerçek bir
stok değeri kararıdır; iş emri kapanış dispozisyonlarıyla aynı çizgi). Farklar:

- **Hareket kapanışı:** iptal `qtyOut = 0` (storno — mal o istasyondan hiç geçmedi), fire
  `qtyOut = qtyIn` (mal geçti, sonra fire oldu). 0 yazmak istasyonun iş hacminden metrajı geriye
  dönük siler ve üretim raporunda hayalet kayıp yaratır.
- **Sebep kataloğu AYRI ve iki FARKLI kapıdan geçer** (`KIND_STORES_TEXT` ayrımı): `ROLL_CANCEL`
  metin saklar → `resolveReasonCode` (async); `ROLL_SCRAP` saklamaz → `validateVarianceReason`
  (senkron). ⚠️ `resolveReasonCode` bunu **tip düzeyinde** reddeder (`TextReasonKind`) — zorlama.
  Kodsuz fire'da kod **uydurulmaz**: `validateVarianceReason`'un `LEGACY_*` kovası sapma defterine
  aittir, topun satırına değil.
- **Çıkış izi kolonları PAYLAŞILIR** (`cancelledAt/ById/Reason/ReasonCode/preCancelStatus`). Adları
  "cancel" olsa da anlamları "defterden düşme izi"dir; hangi mod olduğu `status` ile okunur ve ayrım
  tek+kesin. Ayrı `scrapReason*` kolonları **açılmadı**: canlı DB'ye migration eklemenin karşılığı
  yalnız kolon adının hoşluğu olurdu. Geri alma yalnız `CANCELLED`'ta çalışır
  (`resolveRollRestoreBlockReason` ilk ifadesi statüye bakar) → fire geri alınamaz, doğrusu da bu.

Masaüstü penceresi yeniden yazıldı: her top için `cancel-preview` (uç 2026-08-05'ten beri vardı,
masaüstünden **hiç çağrılmıyordu**), engelli toplar denenmez ve backend'in KENDİ cümlesiyle listelenir,
başarısızların sebebi artık yutulmaz, etiket bilgisi satırda **bilgi** olarak durur, fire şıkkı
izinsiz kullanıcıya **çizilmez** (tıklayıp 403 almasın — kart↔route hizası kuralının aynısı).

Bekçiler: `test_roll_cancel_undo` §2/§2b **tersine çevrildi** (46→53 kontrol; §7 fire ayrımı eklendi)
+ `BulkCancelRollsDialog.test.tsx` (5 kontrol — iki modun ayrı uçlara gitmesi, engelli topun
denenmemesi, etiketin engel OLMAMASI).

#### ②b "İptal ettim, top arşivinde göremedim" — kayıt korunuyordu ama ULAŞILAMIYORDU

İlk iptal denemesinin hemen ardından çıktı ve ② ile aynı sınıf: **söz veri düzeyinde
tutuluyor, yüzeyde tutulmuyor.** `STATUS_GROUPS.ARCHIVE` yalnız dört "tüketilmiş" statüyü
taşıyordu (`RETURNED_FROM_SUBCONTRACTOR` · `TAMBUR_CONSUMED` · `SUBCONTRACTOR_CONSUMED` ·
`KARTELA_CONSUMED`); envanter sekmelerinin hiçbiri ölü statü listelemez. Sonuç: iptal edilen
ya da fire edilen bir top **hiçbir Electron yüzeyinde görünmüyordu**. Barkodla aramak da çare
değildi — iptal edilenlerin bir kısmı barkodsuz açık kumaştır. Canlı kopyada **231 CANCELLED
+ 1 SCRAP** kayıt böyle görünmezdi.

Düzeltme üç parça: ① `ARCHIVE` kümesine `CANCELLED,SCRAP` eklendi; ② sayfaya **arama kutusu**
kondu (200+ satırlık arşivde barkodu bilinen kaydı gözle taramak gerçek kullanım değil —
backend zaten barkodu TAM eşleştiriyor, kumaş/renk/alias `contains`); ③ **"Kayıt Türü"**
daraltma filtresi eklendi. ⚠️ Filtre anahtarı bilerek `statusIn`, `status` DEĞİL: backend
önceliği `statusIn[] > status > varsayılan` olduğu için sayfanın zorunlu kümesini EZER ve
seçenekler arşiv kümesinin alt kümesi olduğundan ezmek zararsızdır; `status` kullanılsaydı
aynı alana iki değer yazılır ve hangisinin kazandığı belirsiz kalırdı.

Ölçüldü (canlı kopya, gerçek liste yolundan): eski kümeyle barkod araması **0 satır**, yeni
kümeyle `T240826F0035/CANCELLED`. İptal penceresinin başarı bildirimi artık nereye gittiğini
de söylüyor ("Sistem → Top Arşivi'nde barkodla aranabilir") — arşiv 2026-08-05'te bilinçli
olarak "zor bulunsun" diye Sistem hub'ına taşınmıştı, o karar duruyor ama artık çıkmaz değil.
⚠️ Yan etki DEVAM EDİYOR: arşiv `admin:settings` arkasında, yani depo/üretim personeli iptal
edilen topu göremez. Bekçi: `Rolls/service.test.ts` — arşiv kümesi iptal+fire içerir, dört
tüketilmiş statüyü korur ve CANLI statü sızdırmaz.

#### ②c "Partiye kayıtlı" engeli KALDIRILDI — kullanıcı kararı: "SAP'taki gibi yap"

İptali geri alma yüklemi (`resolveRollRestoreBlockReason`) `batchId` dolu olan her topu
reddediyordu. Sektör karşılaştırması yapıldı ve karar buna dayandı:

**Standarda UYAN taraf.** "İptalin iptali" gerçek bir ERP kavramıdır (SAP: ters kaydın ters
kaydı) ve kapsamı somut ölçütlerle daraltmak da standarttır — SAP bir mal hareketinin iptalini
*sonrasında hareket olduysa · mal tüketildiyse · sevk edildiyse · dönem kapandıysa* reddeder.
Bizim kuralların dördü bunun birebir karşılığı (`movementCount` · `childCount` ·
`sackId/shipmentId` · `dispatchItemCount/kartelaItemCount`), beşincisi (`currentStepId`) de
"süreç emrine bağlı" karşılığı. Ters kaydın İZLİ olması da standarttır ve bizde var
(`CANCEL_RESTORED` audit'i, kim/ne zaman/neden).

**Standarda UYMAYAN taraf.** SAP'ta parti (Charge/Batch) bir ANA VERİ nesnesidir; bir belgenin
partili olması ters kaydı engellemez — engelleyen şey partinin sonradan hareket etmesi ya da
tüketilmesidir, ki onu ayrı kural zaten yakalıyor. Ölçüm (canlı kopya): 231 iptalin **86'sı
YALNIZ bu kural yüzünden** kilitliydi ve **85'i Tambur çıktısıydı** — sıfır hareket, sıfır
istasyon işlemi, sıfır çocuk. Parti kaydı onların üretimden geçtiğini değil, hangi grupta
DOĞDUKLARINI söylüyordu.

⚠️ Kuralın gerekçesi olarak gösterilen "adım durumu geri sarılmalı" riski burada YOK:
`recomputeStepStatus` partiye **hiç bakmaz** (üç sayacı da hareket üzerinden çalışır), yani
hareketsiz bir topu diriltmek hiçbir adım sayacını değiştiremez. O riski taşıyan tek kural
`movementCount > 0` ve o BUNDAN ÖNCE kontrol ediliyor. Geri koymadan önce bu paragrafı çürüt.

Sonuç (ölçüldü, canlı kopyada gerçek yüklem yolundan): geri alınabilir iptal **130 → 216/231**.
Kalan 15'in 11'i hareket görmüş, 4'ü istasyon işlemi almış — SAP'ın da reddedeceği durumlar.

⚠️ **AÇIK KALAN İKİ NOKTA (bilinçli, iş kararı bekliyor).**
① *Eski kayıtların rafı:* geri alma topu `preCancelStatus`'a döndürür; 05.08 öncesi 84 iptalde
o kolon NULL ve fallback `STOCK`'tur → bitmiş depo malı Ham Stok'a döner. Blokla çözmek
REGRESYON olurdu: bugün geri alınabilen 42 topun rafı da bilinmiyor. Doğru çözüm rafı topun
kendi verisinden (kalite `targetStatus`) türetmek, ama bu yeni bir yüklem demek — ölçülüp ayrı
karar verilmeli.
② *İz temizliği:* `restoreCancelledRoll` `cancelledAt/Reason/Code/preCancelStatus` kolonlarını
TEMİZLER, geçmiş yalnız audit'te kalır. SAP'ta orijinal belge durur. Kolonda kalıcı iz tutmak
migration ister; geri alma artık çok daha sık kullanılabilir olduğu için bu tercih yeniden
değerlendirilebilir (kök CLAUDE.md kuralı: "sebep audit'ten değil KOLONDAN okunur").

### ③ Fason Kabul'de "devasa dikey boşluk" — SegmentedButtons satırın tamamını alıyor, başlık SIFIR genişlikte

⚠️ **İlk teşhis YANLIŞTI ve düzeltildi.** İlk turda sebep "cihazın yazı ölçeği + sınırsız sarma +
dikey ortalama" sanıldı; `numberOfLines` ve `flex-start` yamasıyla APK 2.9.4 çıktı. Sahada boşluk
**sürdü** (bu kez düğmelerin ALTINDA). Bu kez tahmin yerine **tabletteki gerçek yerleşim ölçüldü**
(`adb exec-out screencap` + `uiautomator dump` → her kutunun piksel sınırları):

- Hayır/Evet düğmeleri satırın **tamamını** kaplıyor (x 55–1095 = 1040 px).
- "Fasonda kalan var mı?" başlığı ve açıklaması **hiç çizilmiyor** (görünüm ağacında yok).
- Düğmelerin altında ~380 px boşluk.

**Mekanizma:** RN Paper `SegmentedButtons`'ın her düğmesi `flex: 1`dir. Yoga, flex-grow çocuğu olan
bir kabı "at-most" ölçümünde **mevcut genişliğin tamamına** açar (non-legacy stretch:
`totalFlexGrowFactors ≠ 0` → `availableInnerMainDim` daraltılmaz) → SegmentedButtons = satır
genişliği → yanındaki `flex: 1` başlık kutusu **sıfır genişlik** alır → sıfır genişlikte metin
**karakter karakter alt alta sarılır**: başlık 21 karakter × ~18 px ≈ **380 px görünmez yükseklik**.
İlk sürümde açıklama (~100 karakter, `numberOfLines`sız) da aynı şekilde sarılıyordu → asıl
"devasa" boşluk; `alignItems: center` düğmeleri o bandın ortasına park ediyordu (operatörün tarifi
birebir: "uzun boşluk, ortasında evet/hayır, altında yine boşluk"). `numberOfLines={3}` açıklamayı
kısalttı ama başlık serbest kaldı → 2.9.4'teki ~380 px.

Bu aynı zamanda **"neyin evet/hayır'ı belli değil"** şikâyetinin cevabı: soru ekrana hiç çıkmıyordu.

**Düzeltme (2.9.5):** kart DİKEY — soru, cevap, detay alt alta; SegmentedButtons kendi satırında tam
genişlik; seçenekler kendini anlatır (**"Hepsi geldi" / "Bir kısmı fasonda kaldı"**, ikonlu —
başlık okunmasa da karar düğmeden belli). Top-bazlı giriş açıkken soru gizlenir ("iki dil aynı anda
okunmaz" kuralı). `newRollHeader`'daki `flex-start` yaması geri alındı (orada sorun yoktu — RN Paper
Button içerik genişliğinde kalır, flex:1 çocuğu yok).

**Genel kural:** `SegmentedButtons` bir `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ; yanına
bir şey konacaksa ona AÇIK `width` verilir (`minWidth` YETMEZ — 2.9.4'te `minWidth: 150` vardı ve
işe yaramadı). Bekçi: `mobil/src/test/segmented-buttons-row.guard.test.ts` (TS AST; sarmalayan
elemanın `style`ını `StyleSheet.create` anahtarından/satır içinden çözer; körlük zemini ≥3 kullanım;
negatif sondayla kırmızı verdiği doğrulandı — satıra sarılınca `FasonKabulScreen.tsx:1915`).

**Ders:** yerleşim hatasında tahmin değil ÖLÇÜM — tablet USB'deyken `uiautomator dump` her kutunun
sınırını verir; "hangi kutu 380 px" sorusu 30 saniyede cevaplanır. İlk turda ekran görüntüsü
istemeden koddan teşhis koymak tam olarak yanlış yere yama yazdırdı.

---

## 2026-08-25 — "Bitmiş kumaş tekrar iş emrine bağlanabiliyor mu?" — evet, ama HİÇBİR istemciden yapılamıyordu

> ⚠️ **PROFİL GERÇEĞİ:** "Ölçüm: 980 topun 4'ü iki WO'dan geçmiş" ve "sahadaki iki rotada da planlı firma yok" bu kurulumun verisidir. **Çekirdek ve çok-fabrikada tam da aranan ders:** *backend destekliyordu ama HİÇBİR istemci kullanamıyordu* — bir yeteneğin "var" sayılması için motor + en az bir çıkış yüzeyi + izin ataması ÜÇÜNÜN birden olması gerekir (aynı sınıf: modül anahtarı açık ama ekran yok). ⚠️ "Fason firma seçicisi LOAD-BEARING" uyarısı fason modülüne bağımlıdır.

Saha sorusu: bitmiş, final stoğa girmiş bir ürün tekrar boyahaneye gönderilebilir mi?

**Backend 2026'dan beri destekliyordu.** `attachRolls` ve `quickStart` kabul listesi
`STOCK / WAREHOUSE / A1_STOCK` — "her işlem final üretir" modelinin doğrudan sonucu: bir depo
topu yeni bir iş emrine sokulur, bitince finalize onu depoya geri indirir (`test_wo_warehouse_attach`
bunu 2026'dan beri doğruluyordu).

**Ama hiçbir istemci kullanamıyordu — İKİ ayrı kopukluk:**
1. **Masaüstünde ekran yoktu.** `PATCH /:id/attach-rolls` 2026-06-12'de kaldırılmıştı (hiçbir
   istemci çağırmıyordu) ve `quick-start`'ın Electron istemcisi hiç yazılmamıştı.
2. **Tablet okutmada eliyordu:** `useQuickWorkOrder.addRolls` içinde
   `if (roll.status !== 'STOCK') → "Stokta değil"`. Yani Hızlı İş Emri bitmiş topu kabul etmiyordu.

Ölçüm bunu doğruluyor: canlıda 980 topun **4'ü** iki iş emrinden geçmiş ve dördü de HAM
top (fasonda tüketilen normal akış). Bitmiş malı geri üretime alma yolu sahada **hiç
kullanılmamış** — çünkü kullanılamıyordu.

**Yapılan:** Envanter → Bitmiş Depo'da satır seçince çıkan **"Yeniden Üretime Al"**
(`ReworkRollsDialog`) → mevcut `POST /api/work-orders/quick-start`. Yeni uç YOK, migration YOK,
yeni izin YOK (`workorder:write` zaten kabul ediliyor). Ham Stok'ta GÖSTERİLMEZ: oradaki top
zaten üretime girmemiş, "yeniden" diye bir şey yok.

⚠️ **FASON FİRMA SEÇİCİSİ LOAD-BEARING.** İlk hâlinde yoktu ve "Fasona gönder" anahtarı
**sessiz bir no-op**tu: backend sevki ancak adımın firması çözülebiliyorsa yapar ve sahadaki iki
rotanın da adımlarında planlı firma YOK (ölçüldü) → anahtar açık kalır, çeki listesi hiç doğmazdı.
Firma `stepPlanning` overlay'iyle gider (mobil Hızlı İş Emri'yle aynı yol). Bekçi ayrıca buton
metninin de aynı yüklemden (`willDispatch`) beslendiğini kilitler — ayrıştığında buton olmayacak
bir sevki vaat ediyordu.

⚠️ **ÖLÜ ETİKET UYARISI — burada KESİN, o yüzden var.** Fason kabulünde orijinal top TERMINAL'e
çekilir (`SUBCONTRACTOR_CONSUMED`) ve makbuzdan YENİ kayıt doğar; koddaki gerekçe aynen: *"Top
fasona gittiyse mutlaka açıldı — boyahane/zımpara fark etmez, KİMLİĞİNİ KAYBEDER."* Yani bitmiş,
etiketi basılı bir topun barkodu bu yolculukta kesin olarak geçersizleşir ve mal YENİ barkodla
döner. Bu, aynı gün KALDIRILAN genel iptal onayından farklıdır: orada geçersizleşme bir
OLASILIKTI (kâğıt henüz yapıştırılmamış olabilir), burada KESİN. Yine de **engel değil bilgi**.
Koşul dar tutuldu (etiketli top **ve** ilk adım fason) — geniş tutmak uyarıyı gürültüye çevirirdi.

**Uçtan uca ölçüm (canlı kopya, gerçek servis yolundan):**
`T240826F0034` WAREHOUSE → iş emri `IE2508260002` · parti `P90` · fason çekisi `FS2508260001` →
top `AT_SUBCONTRACTOR`. Firma seçilmeyen ikinci denemede sevk beklendiği gibi atlandı
(iş emri açıldı, top `IN_PRODUCTION`).

**AÇIK:** tablet hâlâ bitmiş topu okutamıyor (`status !== 'STOCK'` elemesi duruyor). Masaüstü
yolu açıldığı için akış artık mümkün; tabletin de açılması AYRI bir karar (APK gerektirir).

> ⚠️ **BU AÇIK AYNI GÜN KAPANDI (2026-08-25 akşam):** eleme kaldırıldı ve karar saf yükleme taşındı — `mobil/src/screens/Modules/HizliIsEmri/scanClassify.ts` (dosya başlığı bu satırın kaldırıldığını açıkça yazar) + `useQuickWorkOrder.ts`; sıra kuralı da orada: iptal → statü → çuval/sevkiyat → kumaş kilidi. Ayrıntı için aşağıdaki "Mobil 'Yeniden Üretime Al'" notuna bak.

Bekçi: `ReworkRollsDialog.test.tsx` (7 kontrol — sözleşme gövdesi · dar uyarı koşulu · farklı
kumaş/çuval ön-engeli · firmasız sevk vaadi yasağı).

## 2026-08-25 — Prod oturumunun üç "dev'de yapılacaklar" notu teyit edildi ve uygulandı (kur.ps1 · renk seddi · deploy notu)

> ⚠️ **PROFİL GERÇEĞİ:** `kur.ps1`, renk seddi ve `SURUM-2.9.0` bu fabrikanın kurulum/sunucu gerçeğidir; çok-fabrika döneminde `kur.ps1` ve deploy reçetesi **müşteri başına** doğrulanır (yayın adresi pakete derleme anında gömülür). **Çekirdek ders:** "prod notunun TEŞHİSİ tutar, 'repoda şu var / şu bekçi yeter' cümleleri VARSAYIMDIR" — 6'sı ölçümle düzeltildi; ayrıca "beklenen değeri gerçek değerle AYNI kaynaktan alan kapı, o kaynağın yanlış olmasını yakalayamaz".

Fabrika sunucusundaki Claude oturumu 24-25 Ağustos'ta üç not yazdı (`docs/history/*-DEV-YAPILACAKLAR.md`, her birinin başında "uygulandı — şu düzeltmelerle" damgası). Üçü de **teşhiste doğru, teslimatta/bekçide hatalıydı** — sınıf olarak: prod tarafı kodu göremez, "repoda böyle" varsayımlarını ölçemez. Her iddia repo + `tekserp_saha_0825` (prod'un temizlik-öncesi kopyası) ile ölçüldü.

### ① `kur.ps1` — otomatik geri alma çalışan kurulumu siliyordu (`deploy/kur.ps1`)
- **Açık gerçek:** `GeriAlOtomatik` "sil"e HEDEFE (`app\` var mı), "geri koy"a KAYNAĞA (`app.eski-*` var mı) bakıyordu. `[5/9]`'daki ilk `Move-Item` takılınca (açık Explorer/terminal/editor) `app.eski` hiç oluşmaz ama `app\` silinirdi. **Harness ile kanıtlandı:** orijinal script sahte klasörlerde `app\`'ı siliyor (`deploy/test/run-harness.sh docs/history/kur.ps1.2026-08-24.orig` → S1 4 kırmızı), onarılmış sürüm 12/12.
- **Onarım:** `app.eski` yoksa hiçbir şey silinmez + mevcut `app\` **pm2 ile geri kaldırılır** (notun yaması yalnız komut basıyordu → fabrika kapalı kalırdı); `Remove-Item`/`Move-Item` `-ErrorAction Stop` + try/catch (yarım silinmiş `app\` üzerine `Move-Item` düşmez, **içine taşır** — not "düşer" diyordu); `ecosystem.config.js` yoksa `Push-Location`'a girilmez; `KokeDon` (cwd `app\` içinde bırakılmaz) `GeriAlOtomatik`'in **ilk satırında** ([6/9] çağrıları `Set-Location $appDir` sonrası koşuyor — not yalnız script sonunu öneriyordu) + `Fail` + tüm çıkışlar; `-GeriAl` modunda aynı sınıf açık kapatıldı.
- **Yama 3 (kilit sondası) reddedildi:** `pm2 delete` sonrasına düşmek zorunda → `Fail` fabrikayı kapalı bırakırdı; Yama 1 + pm2 restart aynı sonucu fazladan taşıma riski olmadan verir.
- **Teslimat:** dosya repoda YOKTU (installer klasörü `ea478488`'de silinmiş; `git log --all -- "*kur.ps1"` boş) ve **script kendini güncelleyemez** (paket `app\` altına iner, script bir üst dizinde) → `deploy/kur.ps1` kaynak, sunucuya **elle kopya** (`deploy/README.md`). `paketle.ps1` hâlâ yalnız sunucuda — açık iş. pwsh Mac'te kurulu değil (brew cask pkg sudo ister); Microsoft tarball'ı `PWSH=` ile yeter.

### ② Renk ad seddi — uygulama kuralının SQL ikizi üzerinde (`20260825120000_color_name_unique_live`)
- Diğer 3 tablonun seddi 4 yolu kapatıyordu (yarış · `duplicateNameField` unutması · içe aktarım fail-open · elle SQL); renkte dördü açıktı. Düz `nameFold` renkte ZAYIF (ayraç + sayı-sırası bağımsız kural) → `public.tr_fold_color(name)` ifadesi üzerinde partial UNIQUE `colors_nameFoldColor_key` (`mergedIntoId IS NULL`), yumuşak kapı + `IF NOT EXISTS` (re-run = enforce).
- **Ayırıcı sınıfı AÇIK yazıldı, `\s` değil:** JS `foldColorNameForCompare` JS `\s` ile böler (NBSP/U+2028… dahil), PG `\s` ASCII-dışında ctype'a bağlı (dev ICU ↔ saha C) → `[\t\n\v\f\r    -     　﻿-]+`. **Tüm BMP + korpusta JS≡SQL** (`test_fold_contract` §2b, 40/0 — aynı dosyada, "tek bekçi" kuralı türeve de uygulanır).
- **Notun iki yanlış iddiası:** (a) "Prisma ifade-UNIQUE'i DROP etmek ister → drift allowlist" — **ölçüldü, drift YOK** (`users_username_lower_uq` emsali; `test_schema_drift` 4/0 index canlıdayken); şema notu buna göre yazıldı. (b) "§8 parmak izi — önerilir" — asıl zorunlu olan **§5 `EXPRESSION_UNIQUES` girdisi** (kapı iki yönlü, envanter-dışı index KIRMIZI; dev'de index kurulmadığı için sinsi — kırmızı ilk CI/prod'da çıkardı). Bölüme `predicate` desteği eklendi.
- **Yan düzeltmeler:** `find_fold_duplicates` renk grubunu düz `nameFold` ile kuruyordu (seddin yakaladığı çiftleri KAÇIRIR, "temiz" der, migration ATLANDI der) → JS renk kuralı; + iki **keskin tarama** (noktalama-sız ad, harf-duyarsız kod — prod'da 4 mükerrer bunlardan kaçmıştı; dev'de 3 kod çakışması buldu). `ColorService.assertNameAvailable` tombstone'u DIŞLAR (base.service ile hizalı — eskiden "PASİF var, aktifleştirin" deyip birleşmişi diriltmeye davet ediyordu). `error.middleware` `nameFoldColor`→"ad". `test_color_name_dup` +2, `test_master_data_name_dup` §9 renk sondası.
- **Sonda kendi kendini çürüttü (ders):** `Test Sed Renk ${suffix} 055` ↔ `055-… ${suffix}` — suffix salt rakam olduğu için kuralda **rakam blokları kendi sırasını korur** → eşit DEĞİL; sed doğruydu, sonda yanlıştı. Rakamlı fixture'ı harfe yapıştır (`X${suffix}`).
- Migration/izin YOK dışında: **migration VAR**, prod'da 0 grup ölçülmüş → ilk deploy'da kurulur (NOTICE `index kuruldu`).

### ③ Deploy notu düzeltmeleri (`SURUM-2.9.0` damgalandı + 12 madde · runbook §3/§9 paket akışı)
- İki 🔴: `SURUM §3` **ve** `DEPLOY-RUNBOOK §3` `git pull → build` anlatıyordu (fabrika paketle kuruluyor); `/health | findstr auditGuard` **hiç geçemez** (alan `/api/admin/health`, `admin:settings`). Prod notu yalnız runbook'u görmüştü — aynı bayat akış `MIGRATION-DEPLOY.md`, `URETIM-KONTROL-LISTESI.md`, `PM2-GECIS-DEVIR-NOTU.md`'de de vardı → tarihsel bandı. Runbook'un "migration öncesi otomatik yedek YOK" notu da bayattı (`kur.ps1` adım 3 `premigrate_` alır).
- Notun yanlışı: "swagger uyarısını not zaten söylüyor" → söylemiyordu; eklendi. Doğrulananlar: 4 fire migration'ı tabloda yoktu (eklendi), `import_runs` 17→16 kolon, `*_nameFold_key` "0 satır" ↔ "customers kurulur" çelişkisi (canlı: 1 → temizlik sonrası 3), boot log'u (`master-data:merge` + `WEB_SALES`), 13→35 iş emri, bekçi rakamları.
- **CSV:** prod'un sonradan birleştirdiği 4 grup `mukerrer-kararlari-2026-08-22.csv`'ye eklendi (kodlar dev kopyasından — prod'un temizlik-öncesi verisiyle birebir); V-1430 EKLENMEDİ (prod hangisini bıraktı yazmamış). ⚠️ CSV ayırıcısı `;` — gerekçe içinde `;` kullanılmaz (ilk yazımda iki satır bozuldu).
- **Dev DB prod'a eşitlendi:** 13 karar dev'de uygulandı (`--apply`), iki migration dosyası yeniden koşuldu → `colors` + `customers` + `subcontractors` sedleri dev'de kurulu; `items` V-1430 yüzünden atlanıyor (dev'in tek kırmızısı: `test_db_invariants` 90/1). Drift 4/0.

**Genel ders — prod'dan gelen "yapılacaklar" notu:** teşhis ölçümle gelir ve tutar; "repoda şu var / şuraya yaz / şu bekçi yeter" cümleleri ise **varsayımdır** — uygulamadan önce her biri ölçülür (bu turda 6 böyle cümle çıktı, 6'sı da düzeltildi). Notlar `docs/history`'de damgalı: nerede yanıldıkları da yazılı kalsın ki aynı sınıf bir daha tanınsın.

---

## 2026-08-25 (akşam) — Mobil "Yeniden Üretime Al" + Fason Kabul boşluğunun GERÇEK sebebi

> ⚠️ **PROFİL GERÇEĞİ:** "ham+bitmiş aynı WO'da SERBEST · hedef renk BOŞ gelir · sebep İSTEĞE BAĞLI · 2. kalite DAHİL" dört karar da bu kurulumun tercihi (`production.enabled`); `WORK_ORDER_REWORK` kataloğunun içeriği de fabrikaya aittir. **Çekirdek:** yeni `ReasonPresetKind` eklerken **beş kapı birlikte** (şema+migration · backend katalog · Electron KIND_TABS · mobil union · mobil zemin) ve "mobil zemin GERÇEK kodları taşır" kuralı.

### A. Fason Kabul "devasa boşluk" — ikinci tur, bu kez ölçülerek

İlk tur yanlış teşhis koydu (yazı ölçeği) ve APK 2.9.4 boşuna çıktı. Tablet USB'deyken
`uiautomator dump` gerçek sebebi 30 saniyede verdi — ayrıntı ③ bölümünde. Ders kalıcı:
**mobil yerleşim şikâyetinde koddan tahmin yok, cihazdan ölçüm var.**

### B. Mobil Hızlı İş Emri artık BİTMİŞ topu da alıyor

Backend 2026'dan beri `STOCK / WAREHOUSE / A1_STOCK` kabul ediyordu ama iki istemci de
kapalıydı: masaüstünde ekran yoktu (aynı gün `ReworkRollsDialog` ile açıldı), tablette ise
okutma `if (roll.status !== 'STOCK') reject` ile eliyordu. Yani "bitmiş kumaşı tekrar
boyahaneye gönder" **hiçbir yerden yapılamıyordu** — 980 topun 4'ü iki WO'dan geçmiş, dördü de
ham top.

**Kullanıcı kararları:** ham+bitmiş aynı WO'da serbest (rozetle) · hedef renk boş gelir ·
sebep isteğe bağlı (hazır metinler + serbest kutu) · 2. kalite dahil.

**Uygulama:**
- `scanClassify.ts` — okutma kararı SAF yükleme alındı (satır içi `if` zinciri kaldırıldı).
  ⚠️ Sıra load-bearing: statü kontrolü çuval kontrolünden ÖNCE. `SHIPPED` bir topa "çuvaldan
  çıkarın" demek malın müşteride olduğunu gizler; bekçide ayrı kontrol var.
- `RollPickerModal.scopeTabs` — "Ham Stok / Bitmiş Depo" sekmesi. Sekme anahtarı sorgu
  anahtarına `effectiveFilters` üzerinden girer; girmezse sekme değişince liste tazelenmez.
  Prop verilmeyen beş çağıran (Kartela/Paket/Fason/İade) etkilenmez.
- `reworkPayload.ts` — sebep İKİ hedefe: metin → 1. adım notu → **fason çekisine talimat**;
  kod+metin → `WorkOrder.parameters.rework` (rapor anahtarı). Migration YOK: `parameters`
  zaten JSON kolon ve `quick-start` Zod şeması onu kabul ediyor.
  ⚠️ Kod UYDURULMAZ — bu kind metin saklamaz, sunucu koddan türetmez; katalogda olmayan kod
  bile rapora GİDER (bayat listeli tablet), ama kâğıda kod BASILMAZ.
- Yeni `ReasonPresetKind.WORK_ORDER_REWORK` (migration `20260825140000`) + 6 sistem satırı.
  **Beş kapı birlikte:** şema · backend katalog · Electron `KIND_TABS` · mobil union ·
  mobil çevrimdışı zemin. Mobil zemin GERÇEK kodları taşır (`BUILTIN_*` DEĞİL) — diğer iki
  metin-saklayan listeden farkı bu; uydurma kod rapor anahtarını çöpe çevirirdi.
- `ReasonPresetPicker` — serbest metin ÜSTTE + chip'ler altında deseni (2026-08-19 fire
  ekranından) üç kopyadan TEK bileşene alındı.
- Ölü etiket uyarısı onay adımında, koşul DAR (etiketli **ve** ilk adım fason). Burada
  geçersizleşme KESİN (fason kabulünde top `SUBCONTRACTOR_CONSUMED` olur, mal yeni barkodla
  döner) — aynı gün kaldırılan genel iptal onayından farkı budur.

**Bekçiler:** `scanClassify.test.ts` (12) · `reworkPayload.test.ts` (8) ·
`ReasonPresetPicker.test.tsx` (6) · `segmented-buttons-row.guard.test.ts` (2). Dördü de
negatif sondayla kırmızı verdi (eleme geri konunca 4 kontrol, çeki talimatı susunca 4 kontrol),
dosyalar `shasum` ile birebir geri yüklendi.

**AÇIK:** mevcut bir iş emrine sonradan top EKLEME hâlâ yok (`attach-rolls` ucu 2026-06-12'de
kaldırıldı) — her iki istemci de YENİ iş emri açar. SAP'ta da rework ayrı emirdir; kapatılan
boşluk bu değil.

## 2026-08-26 — Fabrikanın kendi eklediği sebep 60 saniyelik bir pencerede yaşıyordu ("taze ya da hiç" yanlış takas)

> ✅ **ÇEKİRDEK — çok-fabrikada BİRİNCİ SINIF:** "TTL'in işi TAZELİK'tir GEÇERLİLİK değil" (bayat liste döner + arka planda tazeler), "bayatlık ≠ boşluk — önbellek HİÇ dolmadıysa fail-closed KALIR", tek-uçuş yalnız ARKA PLANA ait (yazmalar kendi yazdığını görmek zorunda) ve "geçersiz kod `AppError` 400, düz `Error` 500'e düşer ve mobil kuyruk 5xx'i geçici sanar". Fabrikanın kendi kataloğunu düzenleyebilmesi tam olarak tek-gövde/çok-fabrika modelinin çalışma koşuludur.

**Saha bulgusu:** Tambur → "Bitir" → en alttaki **"Kayıt düzeltmesi"** → hazır seçeneklerden
biriyle sorunsuz, ama fabrikanın panelden/tabletten **kendi eklediği** sebeple: önce iyimser
"Tambur tamamlandı", sonra `1 sync`, sonra **"tamamlanmadı — sunucu hatası"**.

**Kök neden — bekçinin kör noktası hatanın kendisiyle aynı yerdeydi.** Sapma doğrulaması
(`validateVarianceReason`) transaction İÇİNDE ve SENKRON koşuyor, bu yüzden katalogu modül
düzeyi bir önbellekten okuyor (`reason-preset.service.cachedRows`). Önbelleğin 60 sn TTL'i
vardı ve dolduğunda fonksiyon **`null` dönüyordu** → doğrulama `constants/variance-reasons.ts`
KOD kataloğuna düşüyordu. Orada yalnız **sistem** satırları var. Yani:

* sistem kodu (`OLCUM_HATASI`, `TOP_BASI`…) her koşulda geçiyor,
* fabrikanın eklediği kod yalnız **bir yazma işleminden sonraki 60 saniye** içinde geçiyor.

Önbelleği tazeleyen tek şey boot ve katalog YAZMALARI olduğu için o pencere pratikte hiç açık
olmuyordu: sebebi ekleyen kişi bir dakika içinde denerse çalışıyor, operatör ertesi gün
denerse çalışmıyordu. **Ölçüldü** (dev DB, gerçek 61 sn beklemeyle): taze önbellekte KABUL,
61 sn sonra `Geçersiz sebep kodu: … (geçerli: OLCUM_HATASI, GIRIS_FAZLA, MUKERRER_KAYIT,
YANLIS_TOP, DIGER)`. `test_reason_presets §3` bunu göremezdi çünkü doğrulamadan hemen ÖNCE
`refreshReasonPresetCache()` çağırıyor, yani ölçümünü hep taze pencerede yapıyordu.

**Karar: TTL'in işi TAZELİK'tir, GEÇERLİLİK değil.** 60 sn önce okunmuş bir liste, hiç
okunmamış bir listeden her koşulda daha doğrudur. `cachedRows` artık **bayat listeyi de
döndürür** ve bayatlık okumayı düşürmek yerine arka planda bir tazeleme TETİKLER
(`scheduleBackgroundRefresh` — çağıranı bekletmez, tek-uçuş, DB düşerse 5 sn geri çekilir ve
ELDEKİ liste korunur). Aynı dayanıklılık async metin-kind yolunda da var (`rowsForTextKind`
artık başarısız tazelemeyi yutup bayat listeyle devam eder).

⚠️ **Bayatlık ≠ boşluk, ayrım bilinçli:** önbellek HİÇ dolmadıysa (boot uzlaştırması henüz
koşmadı) hâlâ kod kataloğuna düşülür ve fabrika kodu reddedilir — elde doğrulanacak bir şey
yokken fail-closed doğrudur. `expireReasonPresetCacheForTest()` (bayatlatır, satırları
KORUR) ile `invalidateReasonPresetCache()` (satırları da düşürür) bu yüzden ayrı iki
fonksiyondur; bekçi ikisini karıştırırsa düzeltmeyi değil başka bir şeyi ölçer.

⚠️ **Tek-uçuş tekilleştirmesi YALNIZ arka plan tazelemesine ait.** `refreshReasonPresetCache`
o kapıdan geçirilmedi: `create`/`update`/`duplicate`/`reorder` kendi yazdığını GÖRMEK zorunda,
uçuştaki (yazmadan ÖNCE başlamış) bir okumaya iliştirilemez — iliştirilseydi hata daha dar
ama aynı sınıftan geri gelirdi.

**İkinci kusur — "sunucu hatası" mesajının kendisi.** `validateVarianceReason` düz `Error`
atıyordu; `error.middleware` onu **500**'e çeviriyordu. Sonuç iki katmanlı: operatör sebebi
söylemeyen bir mesaj görüyor, mobil kuyruk da 5xx'i geçici sanıp **üç kez daha deniyor**
(`offline/mutations.ts`: 4xx fail-fast, 5xx üç deneme). Geçersiz sebep kodu bir İSTEMCİ
hatasıdır → artık `AppError.badRequest` + `details.code` (`REASON_CODE_INVALID` /
`REASON_TEXT_REQUIRED`), yani `resolveReasonCode`'un metin-kind tarafıyla aynı sözleşme.
`subcontractor.service` "kalan kapama"daki elle try/catch sarmalayıcısı kaldırıldı — kural
artık kapının kendisinde ve sarmalayıcı `details.code`'u yutuyordu.

**Bekçi:** `test_reason_presets` §3b (bayat önbellek) · §3c (400, 500 değil) · §3d (soğuk
önbellek bilinçli fail-closed) — 66 kontrol. **Dört negatif sondayla kırmızı verdiği
doğrulandı:** ① bayat→`null` geri konunca 4 kontrol, ② arka plan tazelemesi silinince 1,
③ 400 yerine düz `Error` atılınca 2, ④ `expireForTest` satırları da silseydi 3.
⚠️ "Kendini onarır" kontrolünün İLK yazımı **etkisiz sondaydı** — "kod kabul edildi mi" diye
soruyordu ve bayat liste de EVET der (② sondası yeşil kaldı). Dürüst ölçüm: önbelleğin
GÖRMEDİĞİ bir satır (servisle değil **doğrudan prisma ile** yazılır, yoksa create kendi
tazeler) bayat okumadan sonra görünür oluyor mu.

**Migration YOK · izin YOK · APK YOK.** Yalnız backend; deploy edilince sahadaki tabletler
değişmeden düzelir. Kapsam dışı bırakılan: geçmişte bu yüzden düşen kayıtlar (operatör
tekrar girdi, sistemde iz yok).

---

## 2026-08-26 — Electron dağıtımı: setup elden ele taşınıyordu, güncelleyici KURULUYDU ama hiçbir yere bağlanmamıştı

> ⚠️ **PROFİL/OPS GERÇEĞİ:** Bu not TEK MÜŞTERİ döneminde başladı ve aynı gün çok-müşteriye taşındı — bugünkü geçerli yol düzeni `guncelleme.etkiliyazilim.com/<müşteri>/<ürün>/` (tek kaynak `Electron/shared/update-feed.ts` + `shared/musteri.json`). **Çekirdek:** "yayın adresi pakete DERLEME ANINDA gömülür → yanlış müşteri kodu başka fabrikanın güncellemesini kurar ve hata SESSİZDİR", `latest.yml` EN SON yüklenir, CF proxy AÇIK kalmalı, `add_header … always` YASAK.

**Şikâyet:** "Electron uygulamasını setup haline getirip fabrikada tek tek dağıtıyorum, bu çok yorucu."

**Ölçüm:** `electron-updater@6.8.3` `Electron/package.json` bağımlılıklarında **duruyordu**, ama `electron/` altında tek referansı yoktu (`grep` → 0 sonuç) ve `build.publish` bloğu da yoktu — yani electron-builder `latest.yml`i hiç üretmiyordu. "Yazıldı ama mount edilmedi" sınıfının bir başka örneği: paket kurulu, kablo yok.

**Kurulan akış:** yayın adresi generic provider (`https://demo.etkiliyazilim.com/guncelleme/electron/`); panel açılıştan 30 sn sonra ve 4 saatte bir `latest.yml`e bakar, yeni sürümü arka planda indirir, ekranın üstünde "Yeni sürüm hazır" şeridi çıkarır, kurulum kullanıcı "Yeniden Başlat" dediğinde yapılır. İşletme reçetesi: `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`.

> ⚠️ **BU ADRES BAYAT (aynı notun ilerisinde değiştirildi):** yayın bugün `https://guncelleme.etkiliyazilim.com/<müşteri>/<ürün>/` altındadır ve müşteri kodu tek kaynaktan gelir — `Electron/shared/musteri.json` (`kod: "adnansahin"`) + `Electron/shared/update-feed.ts`; `demo.etkiliyazilim.com/guncelleme/electron/` yalnız ilk kurulumun tarihçesidir, yeni paket ASLA o adrese kurulmaz.

**Kararlar ve neden böyle:**

- **Kurulum yeri `perMachine: true` KALDI** (kullanıcı kararı) — uygulama "Program Files"ta olduğu için her kurulumda Windows bir kez izin sorar. ⚠️ **O makinedeki hesap yönetici değilse güncelleme O MAKİNEDE hiç kurulmaz** (panel eski sürümle çalışmaya devam eder — sessiz bir "bazıları güncellendi, bazıları güncellenmedi" durumu doğurur). Ölçülmedi; sahada tek makinede bakılacak. Çıkış yolu tek satır: `nsis.perMachine:false` + bir elle tur daha.
- **`autoInstallOnAppQuit = false`** — kapanışta sessiz kurulum bilerek KAPALI. perMachine kurulumda kurulum yönetici izni ister; kapanışta tetiklenseydi operatör gittikten sonra ekranda cevapsız bir UAC penceresi asılı kalırdı. Kurulum yalnız kullanıcı başındayken, şeritten tetiklenir.
- **`quitAndInstall(true, true)`** — sessiz kurulum + kurulumdan sonra otomatik yeniden açılış. `isSilent=false` NSIS sihirbazını açar ve operatöre "İleri, İleri" yaptırırdı.
- **Şerit YALNIZ `ready` durumunda çıkar.** `downloading` gösterilmez (arka plan işi, gürültü); `error` de gösterilmez — internete çıkamayan bir makine her açılışta kırmızı şerit görürse şerit anlamını yitirir (körleşme). Hata Genel Ayarlar → Bu Bilgisayar → **Güncelleme** sekmesinde, oraya bakan kişiye yazılıdır.
- **Dosya adı ASCII'ye çevrildi** — `artifactName` eskiden `${productName}` kullanıyordu, yani ad "Adnan Şahin ERP-2.7.1-Setup.exe" oluyordu. Bu ad `latest.yml` içinde URL olarak geçer; `Ş` + boşluk aktarımda (FTP / nginx / Windows→Linux kopya) sessizce bozulup 404 üretir. Ürün adı kısayolda AYNEN kalır, değişen yalnız DOSYA adı: `TeksERP-<sürüm>-Setup.exe`.
- **Yayın adresi TEK KAYNAK `shared/update-feed.ts`** ve `package.json > build.publish` ile eşitliği bekçili (`src/test/update-feed-url.test.ts`, 3 kontrol; iki negatif sondayla kırmızı verdiği ölçüldü). Ayrışma arızası SESSİZDİR: uygulama A adresine bakar, Ayarlar ekranı B yazar, "dosyayı koydum ama gelmiyor" denir ve iz kalmaz. Bekçi ayrıca artifact adının ASCII kaldığını da kilitler.
- **Makineye özel adres ezmesi var** (`config.updateFeedUrl`, secure-store) — yayın adresi pakete DERLEME ANINDA gömüldüğü için, adres yanlış gömülürse düzeltmenin tek yolu yeni setup dağıtmak olurdu; yani tam da kaçınılmak istenen elle tur. Bozuk ezme sessizce yok sayılır ve varsayılana dönülür (makineyi güncellemesiz bırakmaktansa).
- **Hata metinleri Türkçeye çevriliyor** (`toTurkishError`) — ham metinler İngilizce ve teknik ("net::ERR_NAME_NOT_RESOLVED"); saha okuyucusu anlamadığı uyarıyı görmezden gelir. Tanınmayan hata ham hâliyle geçer (yutmak teşhisi imkânsız kılardı; tam metin `electron-log`ta zaten var).

**Kaçınılmaz olan:** otomatik güncelleme, makinede zaten güncelleyiciyi taşıyan bir sürüm varsa çalışır → sahadaki kurulumlar için **son bir elle tur** şart. Bundan sonrası kendiliğinden.

**Yan bulgu (bu işle ilgisiz, ortam):** `Electron/node_modules/recharts@3.8.1` diskte YARIM kuruluydu — `es6/util/cursor/` klasörü yoktu ve `electron-vite build` renderer aşamasında düşüyordu (npm tarball'ında dosyalar VAR, yani upstream değil yerel kurulum sorunu). `rm -rf node_modules/recharts && npm install recharts@3.8.1 --no-save` ile onarıldı, build çıkış kodu 0. Bu ağaçtan Windows setup üretmeden önce build'in yeşil olduğunu doğrula.

**Yayın sunucusu AYNI GÜN kuruldu ve doğrulandı.** Sunucuda nginx YOK — ortam **Docker + Traefik v3.5**. Ayrı statik servis eklendi (`/opt/stack/apps/tekserp-guncelleme`, nginx:alpine 64 MB), kural ``Host(`guncelleme.etkiliyazilim.com`)`` — kullanıcı Cloudflare'den A kaydını açtı. İlk kurulum `demo.etkiliyazilim.com` altında `PathPrefix(/guncelleme)` ile yapılmıştı; **kullanıcı ayrı alan adı istedi ve karar daha iyiydi**: demo bir SPA ve bilinmeyen HER yola 200 + `index.html` dönüyor (ölçüldü), yani yayın onun isim alanını paylaşsaydı "404 mü, SPA mı" ayrımı okunmaz olurdu. ⚠️ **TLS Cloudflare Origin CA** (`*.etkiliyazilim.com` wildcard, 2036'ya kadar, `traefik/dynamic/tls.yml` → default store; ACME YOK çünkü alan adı bu CF hesabının zone'unda değil): **Origin CA'ya yalnız Cloudflare Edge güvenir** → kaydın proxy'si (turuncu bulut) AÇIK olmak ZORUNDA; DNS-only'ye çevrilirse istemci sertifikayı reddeder ve güncelleme SESSİZCE durur. Wildcard sayesinde yeni alt alan adı için ek sertifika işi çıkmadı. Dosyalar `tekserp-demo`nun `public/`ine KONULMADI — orası imajın parçası, demo yeniden derlenince yayın silinirdi (fabrika sunucusundaki `kur.ps1` `app\` tuzağının ikizi). Yayın klasörünün sahipliği `oguzhan`a verildi: **`sudo` ile `scp` yapılamaz**. Ölçüm (canlı): `guncelleme.etkiliyazilim.com/electron/…` → 200 + `text/yaml` + `no-cache, must-revalidate`, `ssl_verify=0`, `server: cloudflare`, **`cf-cache-status: DYNAMIC`** (Cloudflare `latest.yml`i önbelleklemiyor — önbelleklese yeni sürüm saatlerce görünmezdi); demo kökü ve `/health` **hâlâ 200** (regresyon yok). Yayınlama `deploy/electron-yayinla.ps1` — asıl işi **sırayı unutturmamak** (`latest.yml` EN SON; ters sırada henüz yüklenmemiş bir `.exe`yi işaret eden yayın kalır).

**macOS'tan Windows paketi ALINABİLİYOR (ölçüldü, ama doğrulanmadı).** Düz `npm run build:win` macOS'ta düşer — `node-gyp does not support cross-compiling native modules from source`. Rebuild adımı atlanınca (`-c.npmRebuild=false`, script `build:win:cross`) 147 MB NSIS installer + blockmap + latest.yml sorunsuz üretildi, **wine bile gerekmedi**. Sebep: `serialport` ve `node-hid` **N-API prebuild** taşıyor (`node-napi-v4.node`) — Electron ABI'sinden bağımsızlar, rebuild gereksiz; Windows binary'lerinin (`PE32+ x86-64`) pakete girdiği tek tek ölçüldü. ⚠️ **"Doğru binary pakete girdi" ≠ "Windows'ta terazi/okuyucu açılıyor"**: bu modüller düşerse uygulama ÇÖKMEZ, sessizce `available:false` der — arıza kendini göstermez, sahada fark edilir. macOS paketi sahaya yayılmadan önce bir Windows makinesinde *Bu Bilgisayar → Yazıcı/Kantar* sekmelerinde cihazlar listelenmeli.

**⚠️ Cloudflare 404 tuzağı (aynı gün yaşandı, kalıcı düzeltildi):** nginx `.exe` başlığı `add_header ... always` ile yazılmıştı; `always` başlığı **hata yanıtlarına da** ekler ve Cloudflare origin'in talimatına uyup **404'ü bir hafta önbelleğe alır**. Paket yüklenmeden önce yapılan tek bir sonda isteği, dosya yüklendikten SONRA bile bir hafta 404 döndürdü (dosya sunucuda 147 MB duruyordu; `?cb=…` ile 200, temiz URL ile 404 — teşhis bu ikiliyle kurulur). Düzeltme: `always` kaldırıldı + `error_page 404 → Cache-Control: no-store` ikinci hattı. Önbellekte kalmış 404 yalnız **Cloudflare panelinden Purge by URL** ile temizlenir. Ders şu sınıfa girer: *bir başlık direktifi, hata yolunu da kapsadığında sessiz bir kalıcılık üretir.* Teşhis yayın script'lerine kalıcı olarak kondu (mobil oturumunun önerisi): temiz URL ↔ `?onbellek-atla=` kıyası "dosya yüklenmemiş" ile "önbellekte kalmış 404"ü AYIRIR — ikisi aynı görünür ama biri yeniden yüklemekle, diğeri yalnız purge ile çözülür; ayrıca `content-length` kıyası yarım yüklemeyi yakalar (200 döner ama eksiktir). Üç dal negatif sondayla ölçüldü. Sunucu yapılandırması artık repoda: `deploy/guncelleme-sunucusu/` (elle kopyalanır — `kur.ps1` ile aynı "servis kendini güncelleyemez" durumu).

**2026-08-27 — iki karar daha (ikisi de sahaya çıkmadan ÖNCE, yani bedava):** ① **Yol şeması müşteri bazlı oldu: `/<müşteri>/<ürün>/`** → `/adnansahin/electron/`, mobil `/adnansahin/mobil/`. Alan adı Etkili Yazılım'ın genel güncelleme sunucusudur; yeni müşteri eklemek yalnız klasör açmaktır (DNS/sertifika/servis YOK). Müşteri başına ALT ALAN ADI bilinçli seçilmedi: wildcard `*.etkiliyazilim.com` **iki seviyeli** adları kapsamaz. ⚠️ Bu kararın zamanlaması load-bearing: **adres pakete derleme anında gömülür**, sahaya çıktıktan sonra değiştirmek her makineyi tek tek gezmek demektir. ② **Güncelleme ZORUNLU** (kullanıcı kararı): şerit + "Sonra" ertelemesi kaldırıldı, yerine iki aşama geldi — inerken ince şerit (*"işinizi kaydedin"*), indikten sonra **kapatılamaz tam ekran kapı + 2 dk geri sayım** (`UpdateGate.tsx`, `GERI_SAYIM_SN`). Geri sayım zorunluluğu yumuşatmaz; güncelleme vardiya ortasında inebildiği için anında kesmek operatörün yarım formunu götürür ve olay *"bilgisayar kendi kendine kapandı"* diye okunurdu. İndirme şeridi de aynı sebeple load-bearing: kapı sürpriz olmasın. `install()` çift çağrılmasın diye ref (stale-closure kilidi) + state (buton kilidi) İKİSİ birden tutulur.

**Geçiş köprüsü (bir hafta sonra silinecek):** 2.8.0 paketi ESKİ adresi (`/electron/`) taşıyordu ve test için indirilmişti. O paketi kurmuş bir makine yalnız oraya bakar → 2.8.1 **her iki yola** kondu. Güncellendikten sonra yeni adrese kendiliğinden geçer. Eski yol boşaltılabilir hale gelince silinir.

**2026-08-27 (2. tur) — kullanıcı sordu: "otomatik denetliyor mu · modal çıkıyor mu · ara ara hatırlatıyor mu · backend hangi sürümü beklediğini söylüyor mu".** İlk ikisi vardı, son ikisi eksikti; ikisi de kapatıldı:

**① Kapı kalıcı kilitlenebiliyordu (gerçek hata).** `kuruldu` tek-atışlık bir kilitti; kurulum başlamazsa (Windows izin penceresine "Hayır" en olası sebep) kapatılamayan ve hiçbir şey yapmayan bir ekran kalıyordu — panel kullanılamaz hale gelirdi. `KURULUM_BEKLEME_MS` (20 sn) bekçisi eklendi: uygulama kapanmadıysa kilit açılır, *"Kurulum başlatılamadı"* yazar ve **5 dk sonra yeniden dener** (ilk geri sayımdan uzun: aynı soruyu iki dakikada bir sormak operatörü "Hayır"a şartlandırır). Kullanıcının "ara ara hatırlatıyor mu" sorusunun karşılığı budur.

**② İstemci sürüm politikası (`GET /api/client-policy/:istemci`, PUBLIC).** Backend "en az şu paneli bekliyorum" der; panel altındaysa **güncelleme inmemiş olsa bile** kapı açılır. Gerekçe deploy sırası: **backend ÖNCE** gider, yani yeni sözleşme çıktığında sahada bir süre eski paneller koşar ve bazı değişiklikler onlarda GÖRÜNÜR hata üretmez — alan sessizce düşer. Kararlar: değer **KODDA sabit** (`src/config/client-version-policy.ts`) — panelde ayar olsaydı yanlış girilen bir sayı sahadaki tüm panelleri kilitlerdi ve "şu API sürümü şu paneli gerektirir" cümlesi backend deploy'undan ayrı bir insan hamlesine bağlanırdı; istemci **FAIL-OPEN** (uç okunamaz/bozuk/404 → kilitleme YOK) — projenin fail-closed eğiliminin bilinçli istisnası, çünkü buradaki "kapalı" taraf tek bozuk yanıtla fabrikanın durması demek; uç **PUBLIC** (panel politikayı giriş öncesi sorar — kimlik aransaydı, sözleşmesi bozulduğu için giriş yapamayan panele "güncelle" diyebilme yolu kapanırdı; muafiyet gerekçesi `test_route_auth_coverage` EXEMPT'te); uç **parametreli** (yeni istemci route'a değil `CLIENT_VERSION_POLICIES` kayıt defterine yazılır). ⚠️ **`minVersion` sahadaki panel sürümünden BÜYÜK OLAMAZ** — olsaydı en güncel panel bile kapıda kalır ve indirecek bir şey olmadığı için ÇIKAMAZDI (kendi kendini kurtaramayan tek arıza biçimi); bekçi `test_client_policy.ts` (12 kontrol, iki negatif sondayla kırmızı). `minVersion` yalnız GERÇEK bir kırılmada yükseltilir; her sürümde artırmak, güncellemeyi indirememiş her makineyi üretim dışı bırakır.

**AÇIK EKSİK — mobilde sürüm kapısı YOK** (mobil oturumu ölçtü, 2026-08-27): istek başlıklarında sürüm yok, backend'de mobil kapısı yok, istemcide kontrol yok, 426 yok. ⚠️ `runtimeVersion` bu deliği KAPATMAZ — o JS↔native uyumunu bağlar, backend sözleşmesi hakkında bir şey söylemez; üstelik runtimeVersion artınca eski APK'lı tabletler hiç OTA almaz ve eski JS yeni backend'e karşı SÜRESİZ koşar (üstelik mobil bilinçli offline yazıyor → sessiz alan düşmesinin en kötü zemini). Uç parametreli olduğu için bağlanmak yalnız kayıt defteri satırı + istemci kodu ister. **Kullanıcı kararı bekliyor.**

**2026-08-27 (3. tur) — ÇOK MÜŞTERİ: "başka fabrikaya kurulum yaptığımda etkilenmemeli".** Yayın YOLU zaten müşteri bazlıydı; açık olan PAKET tarafıydı — adres pakete DERLEME ANINDA gömülüyor ve müşteri kodu elle değiştiriliyordu. Unutulan tek düzenleme "yeni fabrikanın paneli BAŞKA bir fabrikanın güncellemesini indirip kurar" sonucunu verirdi ve **hata sessizdir**: dosyalar kendi aralarında TUTARLI kalır, yalnızca yanlış müşteriyi gösterirler → tek müşteriyle hiç görünmez, ikincisinde patlar. Kurulan üç kademe: ① `shared/musteri.json` TEK KAYNAK (adres türetilir, elle yazılan ikinci kopya yok) · ② bekçi `update-feed-url.test.ts` (musteri.json ↔ package.json ↔ update-feed tutarlılığı — **sınırı dokümanda: üçü de aynı YANLIŞ müşteriyi gösterirse yakalayamaz**) · ③ **paketleme kapısı `deploy/electron-paketle.sh`**, derlemeden SONRA paketin İÇİNDEKİ `app-update.yml`i okuyup **argümanla verilen** müşteriyle kıyaslar.

⚠️ **Kademe ③'ün load-bearing özelliği: DAİRESEL DEĞİL.** Beklenen değer argümandan (bağımsız niyet beyanı), gerçek değer çıktıdan gelir. Beklenen değeri de `musteri.json`dan alsaydı kontrol yanlış müşteri kodunu ASLA yakalayamazdı. Genel kural (mobil oturumunun formülasyonu, kendi kapısı tam bu yüzden dairesel çıkmıştı): **beklenen değeri gerçek değerle AYNI kaynaktan alan bir kapı, o kaynağın yanlış olmasını yakalayamaz** — "bekçinin kör noktası hatanın kendisiyle aynı yerdeydi" desenlerinin genel hali. Ölçüldü: adnansahin paketi "yenifabrika" iddiasıyla sunulunca kapı durdurdu, doğru müşteride sessiz geçti. Ayrıca kapı derlemenin ÖNÜNDE değil ARDINDA durur — mobil tarafında önde duran kapı yüzünden yanlış adresli APK yayına çıkmıştı. Yayın komutu da hedefi paketin KENDİ kimliğinden çözer → "A paketini B klasörüne yükleme" hatası yapısal olarak imkânsız. Yeni fabrika: sunucuda `mkdir` + `electron-paketle.sh <müşteri>` + `electron-yayinla.sh`; DNS/sertifika/servis YOK. Sürüm politikası AYRI EKSEN (her fabrikanın kendi backend'i servis eder).

**Migration YOK · yeni izin YOK · APK YOK.** Sürüm 2.7.0 → 2.8.0 → 2.8.1 → **2.8.2**; yayında. ⚠️ Bu tur **backend deploy'u da gerektiriyor** (yeni uç). Kalan iş: **backend deploy + son elle tur** (§2).

---

## 2026-08-26 — Yarı mamul: filtre yetmedi, sekme oldu · ham stoktan iş emri açılamıyordu

> ⚠️ **PROFİL GERÇEĞİ:** "Boyalı gelen kumaşa sadece kurşun+tambur" senaryosu ve "prod'da SEMI_FINISHED SIFIR" ölçümü bu kurulumundur; ayrıca notun sonundaki **"Panelden yapılacak: 'Yarı Mamul (Kurşun+Tambur)' rotası"** maddesi kurulum başına tekrar edilir (rota kod değil VERİdir). **Çekirdek:** üç kapsam ve `RAW_STOCK`'un BİLEREK geniş olması, `rollScope` FAIL-CLOSED, "altıncı enum değeri unutuldu" sınıfı ve "rapor da ayrılmazsa çelişkiyi BİZ üretiriz".

**Saha şikâyeti iki maddeydi, ölçüm tek eksik olduklarını gösterdi.**

**① "Boyalı gelen kumaşa sadece kurşun+tambur yapacağız, bunu Electron'dan çözelim."**
Giriş 2026-08-17'de yapılmıştı (`entrySource=SEMI_FINISHED` + `forcedStatus=STOCK`, Manuel
Giriş'teki kutu). Eksik olan ÇIKIŞtı: o topu masaüstünden bir iş emrine bağlamanın yolu YOKTU.
"Yeniden Üretime Al" yalnız Bitmiş Depo sekmesinde çiziliyordu ve gerekçesi koda yazılmıştı:
*"Ham Stok'ta gösterilmez, oradaki top zaten üretime girmemiş — normal iş emri açma yolu
kullanılır."* **O yol yok:** Yeni İş Emri formu top almıyor, mevcut iş emrine top ekleme ucu
2026-06-12'de kaldırıldı. Yani gizlenen buton, olmayan bir kuralı taklit ediyordu. Backend
baştan beri üçünü de kabul ediyor (`quickStart.attachable` = STOCK/WAREHOUSE/A1_STOCK).

**Ölçüm (prod yedeği 2026-08-25, 2431 top): `SEMI_FINISHED` kaydı SIFIR.** Özellik bir haftadır
hiç kullanılmamış ve sebebi tek değil — 2026-08-17 paketinin ÜÇ ucu birden açık kalmıştı:
rota ("Yarı Mamul = Kurşun+Tambur") hiç oluşturulmamış (prod'da 2 rota var, ikisi de Boyahane
ile başlıyor) · `mobile:kk1-yari-mamul` izni 0 kullanıcıda · masaüstünde iş emri açılamıyor.
İlk ikisi `docs/ops/DEVIR-2026-08-17-FABRIKA-TALEP.md` kontrol listesinde madde 5-6 olarak
yazılı ve yapılmamış. **Ders: "backend hazır, arayüz sonra" biten bir iş değildir — çıkışı
olmayan bir giriş kapısı sıfır kullanım üretir ve bunu kimse hata olarak raporlamaz.**

**② "Yarı mamul envanterde ham stok gibi görünüyor, bu yanlış."** — Haklı.

**KARAR DÖNÜŞÜ (bilinçli).** `docs/design/FABRIKA-TALEP-2026-08-17.md §9` şöyle diyordu:
*"Yarı mamül ham stoğa düşer, üzerinde ayırt edici işaret taşır, Ham Stok listesinde FİLTREYLE
süzülür."* Filtre yetmedi: özellikle açılıp seçilmediği sürece yarı mamul ham kumaşın arasında
kayboluyor, stok adedi ve metraj toplamı ikisini tek rakamda topluyordu. **Değişen şey yalnız
GÖRÜNÜM: ayrı DEPO yine açılmıyor** (o kararın gerekçesi duruyor — fabrikada fiziksel karşılığı
yok), ayrı **sekme** açılıyor. Statü, `entrySource` ve stok mekaniği aynı.

**Terim:** "Yarı Mamul" (TDK yazımı; kodda her yerde "mamül" yazıyordu, 12 kullanıcı-görünür
nokta düzeltildi). Tekdüzen hesap planında 151 Yarı Mamuller, SAP'de HALB. Tekstil
alternatifleri bu kovayı adlandırmıyor: "ham bez" zaten boyasız malın adı, "boyalı ham" kendi
içinde çelişik.

### ⚠️ ÜÇ KAPSAM, biri BİLEREK geniş — `RAW_STOCK`'u DARALTMA

| Kapsam | Ne demek | Kim kullanır |
|---|---|---|
| `RAW_STOCK` | üretime girmemiş STOCK topu — **ham + yarı mamul** | **Mobil** Hızlı İş Emri top seçicisi |
| `RAW_STOCK_PURE` | yalnız ham | Masaüstü "Ham Stok" sekmesi |
| `SEMI_FINISHED` | yalnız yarı mamul | Masaüstü "Yarı Mamul" sekmesi |

`RAW_STOCK`'u "yarı mamul hariç" diye daraltmak **tableti bozar**: tablette üçüncü bir sekme
YOK ve o toplar listeden düşer — yani sahada çalışan tek yol kapanır. Bu yüzden birleşim
DOKUNULMADAN kaldı; APK sırası gelince tablet de üçüncü sekmeye geçer, **sunucu değişmeden**.
Negasyon istemciden söylenemez (`buildWhereClause` yalnız eşitlik/CSV-`in`/boolean üretir), o
yüzden ayrım servis katmanında yaşamak zorunda. Bekçi `test_semi_finished_entry §5`
birleşim = dar kapsamların toplamı eşitliğini ölçer — regresyon kapısı odur.

### Yol boyunca çıkan üç SESSİZ hata (hepsi aynı sınıf: "altıncı enum değeri unutuldu")

1. **`entryTitle` switch'i** (`inventory.service`) — `SEMI_FINISHED` case'i yoktu, `default`
   dalına düşüp topun geçmişinde **"Ham Giriş"** yazıyordu. Yorumu "beş değer de artık AÇIK
   case'le eşleniyor" diyordu; altıncı değer sonradan eklenmiş.
2. **Mobil KK1 "Son Kayıtlar" + "Tüm Girişler"** — `entrySource: 'SUPPLIER_RECEIPT,MANUAL_ENTRY'`
   ile süzüyordu, yani **KK1'in kendi yarı mamul modunun yazdığı topu KK1 gizliyordu**.
   Operatör az önce girdiği topu göremiyordu. (Düzeltme kodda; sahaya APK ile iner.)
3. **`entrySource` anahtarına yazan İKİ filtre** (Electron) — base "Giriş Kaynağı" (5 seçenek,
   SEMI_FINISHED yok) + Ham Stok'a eklenmiş "Giriş Türü" (3 seçenek). Aynı URL parametresine
   yazıp birbirlerini eziyorlardı. İkincisi silindi, seçenek tekine taşındı.

**Kalıcı çare:** bu üç yer de `Record<string,string>` / dizi literali / ham SQL olduğu için
derleyici sessiz kalıyordu. Tip-güvenli olan yerlerde (`Record<RollEntrySource, …>`) altıncı
değer zaten vardı. Yeni enum değeri eklerken **tip-güvenli olmayan** yüzeyleri ara.

### Rapor da ayrıldı (yoksa çelişkiyi BİZ üretecektik)

Stok Karnesi'nin "Ham" rakamı (`RAW = ["STOCK"]`) yarı mamulü içeriyordu. Envanteri ayırıp
raporu bırakmak, bugün olmayan bir çelişki doğururdu: ekran 800 der, rapor 950. `summary`'ye
`semiQty`/`semiCount` eklendi; yaş kovaları / ölü stok / `byItem` **yalnız `finished` üzerinde**
çalıştığı için onlara dokunulmadı — ölü stok rakamı etkilenmedi.

**Ayrımı TAKİP ETMEYEN yüzeyler (bilinçli, listelendi):** Kanban `hamStok` kolonu (düz
`status=STOCK`; akış görünümü, stok sayım yüzeyi değil) · mobil Depo "Ham" sekmesi
(`rollScope` kullanmıyor, APK işi) · Ürün Dengesi ve sipariş `freeStock` (**doğru davranış** —
yarı mamul gerçekten kullanılabilir arzdır, dokunulmadı).

**Beklenen ama sahada ilk kez görülecek:** renkli yarı mamul topu iş emrine bağlıyken hedef
renk değiştirilirse `workorder-target-color.helper` onu "zaten boyandı" sayar ve
`COLOR_DYED_BLOCKED` / `COLOR_PARTIAL_CONFIRM` sorar. Doğru semantik.

### Diğer kararlar
- **`rollScope` artık FAIL-CLOSED.** Tanınmayan değer eskiden hiçbir daralma yapmıyordu ve
  liste CANCELLED/SHIPPED dahil TÜM tabloyu döndürüyordu — hata yok, log yok. Değer hiçbir
  kullanıcı girdisinden gelmediği için (istemcilerde sabit) 400 güvenli.
- **Manuel Giriş'teki sessiz tuzak kapatıldı:** Ham Stok'ta renk seçip kutuyu işaretlemeyen
  operatörün topu Bitmiş Depo'ya düşüyordu, hiçbir uyarı yoktu. Artık amber uyarı çıkar
  (engel değil — renkli bitmiş mal girmek meşru). Yarı Mamul sekmesinden açılınca kutu
  ön-işaretli gelir ama GÖRÜNÜR kalır.
- **Sekme listeleri AÇIK yazılır:** `RollsTableBody` gövdesini Kartela ve Top Arşivi sayfaları
  da kullanıyor — "FINISHED_STOCK değilse göster" gibi negatif koşul oralara buton sızdırır.
- **Bekçi açığı kapatıldı:** `ROLL_TABS`'a sekme eklenip `buildRollForceFilters`'a dal
  yazılmayı unutmak **tip hatası vermiyordu**; sekme kapsamsız liste gösteriyordu. Yeni
  `service.test.ts` bölümü bunu ölçer (körlük zemini dahil).

**Migration YOK · yeni izin YOK · APK bu turda YOK.** Sıra: backend ÖNCE, Electron sonra
(eski Electron `RAW_STOCK` göndermeye devam eder — geriye uyumlu). Bekçiler:
`test_semi_finished_entry` (16, iki negatif sonda) · `test_stock_scorecard` (17, bir negatif
sonda) · Electron `Rolls/service.test.ts` (iki negatif sonda).

**Panelden yapılacak (kod değil):** "Yarı Mamul (Kurşun + Tambur)" rotası — bu rota olmadan
yarı mamul topa iş emri açılamaz.

## 2026-08-26 — Mobil uzaktan güncelleme: APK elden ele taşınıyordu, JS paketi hiç ayrılmamıştı

> ⚠️ **PROFİL/OPS GERÇEĞİ:** Yol `/adnansahin/mobil/` bu müşterinin segmentidir; yeni fabrika = sunucuda `mkdir <müşteri>/mobil` + `--musteri=` ile yayın (DNS/sertifika/servis YOK). **Çekirdek:** "ERP bağlantısı fabrika ağında kalır, güncelleme internetten gelir — İKİ KANAL, hiçbiri diğerinden TÜRETİLMEZ", manifest yayın anında DONDURULUR, `runtimeVersion` filtresi SUNUCUNUN işidir, kod imzalama AÇIK, `add_header … always` YASAK.

**Soru:** *"apk olarak upload ediyorum ve tek tek yüklüyorum tablet/telefonlara; Google Play'e
koyamıyorum, başka nasıl dağıtabiliriz?"*

**Teşhis — sorun dağıtım kanalı değil, AYRIM eksikliğiydi.** `expo-updates` KURULU DEĞİLDİ
(ölçüldü: `package.json`'da yok, `app.json`'da `updates` bloğu ve `runtimeVersion` yok), yani
"ekran metnini düzelttim" ile "yeni Bluetooth modülü ekledim" **aynı** maliyeti taşıyordu: her
ikisi de tam APK turu. Oysa değişikliklerin ~%90'ı JS'tir ve native'e hiç dokunmaz. Kurulan
şey iki KATMAN:

① **Uzaktan güncelleme (OTA)** — `expo-updates` + Expo Updates protokolü v1'i konuşan KENDİ
backend'imiz (`/api/mobile/updates/manifest` + `/assets`). EAS Update (Expo bulutu) BİLİNÇLİ
OLARAK ALINMADI: internet kopunca güncelleme yolu da kopardı ve bundle dış servise giderdi;
fabrika sunucusu zaten tabletlerin bağlı olduğu makinedir. Uçlar **PUBLIC** (JWT yok) —
kimlik aransaydı "açılmayan tablete düzeltme gönderme" yolu, yani kurtarmanın kendisi
kapanırdı.

② **Kurulum dosyası güncelleyicisi** — `/api/mobile/app-version` + `app-download`; tablette
tek dokunuş, Android'in kurulum ekranı açılır. Sessiz kurulum YOK (ancak MDM ile mümkün;
6-15 cihaz için maliyeti karşılığını vermedi — ölçülüp elendi).

**`runtimeVersion` bu paketin taşıyıcı direğidir.** Paket yalnız aynı runtimeVersion'ı taşıyan
APK'ya gider (sunucu tarafında fail-closed). Artırılmadan native değişiklik yayınlanırsa
sahadaki TÜM tabletler açılışta çöker — bu, sistemin tek "hepsini birden öldüren" senaryosu.
Bu yüzden `yayinla-ota.mjs` native girdilerin (bağımlılıklar + plugins + android bloğu) parmak
izini alır, öncekiyle karşılaştırır ve runtimeVersion artmadıysa DURUR.

**"Bayat adres" tuzağının OTA ikizi kapatıldı.** `build-apk.mjs`in başlığındaki iki ölçülmüş
tuzak (Gradle görevinin env değişikliğiyle geçersiz kılınmaması + Metro transform önbelleğinin
env'i anahtarına almaması) `expo export` yolunda da geçerlidir. Orada bedeli **bir cihazdı**;
burada **sahadaki her tablet**tir — yanlış adresli paketi dağıtan şey, güncelleme
mekanizmasının kendisi olurdu. Yayınlama script'i önbelleği siler ve **üretilen bundle'ın
içindeki adresi geri okur**; tutmazsa paket yayınlanmaz. Adres çözümü artık TEK KAYNAK
(`scripts/lib/adres.mjs`) — iki script farklı sırayla çözseydi aynı gün üretilen APK ile paket
farklı sunucuya bakabilirdi.

**Depo `app\` klasörünün DIŞINDA** (`C:\Etkili-Yazilim\mobil-guncelleme`, `MOBILE_UPDATE_DIR`
ile taşınır). İçeride olsaydı `kur.ps1` her backend deploy'unda yayındaki paketi ve geri dönüş
geçmişini silerdi — yani backend'i güncellemek mobil güncellemeyi öldürürdü, sessizce.

**Geri alma dosya silmez:** `updates/<rv>/YAYINDA` işaretçisine eski damga yazılır. İşaretçi
bozuksa sunucu **gürültülü hata** verir, sessizce en yeniye DÜŞMEZ (düşseydi geri alma yapan
kişi eski paketin yayında olduğunu sanırdı). Manifest'teki varlık URL'leri **damgaya
çivilidir** — Expo'nun referans implementasyonunda bu yok ve orada yarış var: manifest
alındıktan sonra yeni yayın yapılırsa varlıklar yeni paketten servis edilir, hash tutmaz.

**Yenileme kuralı (kullanıcı kararı):** indirilir indirilmez hemen yenilenir. Tek istisna veri
kaybı önlemesidir — **gönderilmemiş istasyon kaydı varken yenilemez** (`reloadAsync` JS'i
öldürür, uçuştaki KK1 girişi yarıda kalır); tavan 20 sn, dolarsa yenileme atlanır ve paket bir
sonraki açılışta uygulanır.

**Yolun ortasında çıkan gerçek açık — MÜHÜR.** Release APK Android'in **herkese açık deneme
mührüyle** imzalanıyordu (ölçüldü: `signingConfig signingConfigs.debug`, SHA1
`5E:8F:16:06:...` — standart debug key). İki sonucu vardı: aynı ağdaki biri uygulamanın
üstüne kurulabilen sahte paket hazırlayabilirdi, ve mühür bir gün değişirse (klasör her
derlemede yeniden üretiliyor) tabletlerde tek çare **silip yeniden kurmak** olurdu — kayıtlı
sunucu adresi, oturum, cihaz eşleşmesi ve bekleyen kayıtlar giderdi. Kullanıcı kendi mührünü
seçti (RSA 4096, 2056'ya kadar). ⚠️ İmza `plugins/withReleaseKeystore.js` ile **her
prebuild'de yeniden yazılır** — `android/` git dışı prebuild çıktısı olduğu için elle
düzenleme bir sonraki prebuild'de sessizce kaybolurdu (`usesCleartextTraffic`in 2026-08-15'te
ısırdığı tuzağın birebir aynısı); eklenti bulamadığı yapıyı **atlamaz, hata fırlatır**.
`build:apk` ayrıca üretilen APK'nın parmak izini mühürle karşılaştırır.

**Derleme kapısı ilk gerçek koşumda kendi hatasını yakaladı:** `expo prebuild` koşmadan
derleme yapılsa APK `ENABLED=false` ile, yani uzaktan güncelleme ALMADAN çıkacaktı ve bu
hiçbir yerde görünmeyecekti. ⚠️ Kapı yazılırken kör noktası da ölçüldü: manifest
`runtimeVersion`i **literal değil** `@string/expo_runtime_version` referansı olarak yazar —
düz karşılaştıran bir kapı HER ZAMAN kırmızı verir, bir süre sonra devre dışı bırakılır ve
gerçek sapmada da susar.

**Bekçinin kör noktası hatanın kendisiyle aynı yerdeydi (yine).** Protokol bekçisinin yol
kaçışı sondaları var OLMAYAN dosyaları hedefliyordu (`../../../etc/passwd` paket kökünün üç
üstünde = depo içi, yok) → koruma silindiğinde de 404 dönerdi ve bekçi **52/52 yeşil kaldı**.
Ölçülüp düzeltildi: kaçış sondası, kaçışın BAŞARILI olacağı gerçek bir hedefi denemeli.

**Kapsam dışı bırakılanlar (gerekçeli):** MDM (6-15 cihaz, kurulum maliyeti karşılığını
vermiyor) · kod imzalama (paketler LAN'da düz HTTP ile gelir, API ile aynı güven modeli;
sunucu HTTPS'e geçerse açılmalı) · çalışma anında değiştirilebilir güncelleme adresi
(`disableAntiBrickingMeasures` — yanlış adres uygulamayı kurtarılamaz hale getirir; bunun
yerine ayrışma Ayarlar → Güncelleme ekranında GÖRÜNÜR kılındı).

**Google'ın sideload doğrulaması** (2026-09'da dört ülke, 2027'de küresel; doğrulanmamış
geliştiricide yeniden başlatma + 24 saat bekleme) yalnız KURULUM DOSYASINI etkiler — uzaktan
güncelleme kapsam dışıdır. Türkiye ilk dalgada değil.

Reçete: `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`. Migration YOK, izin YOK.

### ⚠️ AYNI GÜN — KANAL DEĞİŞTİ: güncelleme fabrika sunucusundan İNTERNETE (VPS) alındı

Yukarıdaki her şey kuruldu ve ölçüldü, sonra kullanıcı kanalı değiştirdi: *"tabletler
güncellemeyi internetten alsın, aynı Electron'da olduğu gibi — fabrika ağına bağlılar ama
wifi ve LAN üzerinden internete de her zaman erişiyorlar."* Sahaya çıkmamıştı, dolayısıyla
geri alınan bir şey yok; değişen yalnız KANAL. **ERP bağlantısı aynı kaldı** — OTA
paketinin içindeki JS hâlâ fabrika sunucusuna konuşur.

**Kararı ÜÇ ÖLÇÜM belirledi (`expo-updates` native kaynağından):**

① **İmza gövdenin HAM baytları üzerinden doğrulanır** (`CodeSigningConfiguration.kt:93-96`)
→ manifest yayın anında **DONDURULMAK ZORUNDA**; sunucu her istekte yeniden üretirse
baytlar değişir ve tablet paketi reddeder. Bu kısıt "iki ayrı protokol implementasyonu"
sorusunu kendiliğinden çözdü: **üreten tek yer yayın script'i** (`mobil/scripts/lib/manifest.mjs`),
sunucu yalnız bayt servis eder. Backend'in render eden ~300 satırı SİLİNDİ, yerine statik
dosya servisi geldi ve VPS'teki nginx ile **birebir aynı yol düzenini** kullanıyor.

② **İstemci mükerrer indirmeyi KENDİSİ engeller** — üç kat: `commitTime`
(`LoaderSelectionPolicyFilterAware.kt:57`) → `id` (`Loader.kt:153-169`) → varlık bazında
(`FileDownloader.kt:364`). Bu yüzden VPS'e dinamik servis/yeni konteyner GEREKMEDİ; Electron'un
kullandığı nginx'e tek regex kural yetti (karar zaten kayıtlıydı: *"mobil `/mobil/` olarak
aynı servise eklenir"*).

③ **`runtimeVersion` filtresi SUNUCUNUN işi** — istemci indirme aşamasında BAKMIYOR
(`LoaderSelectionPolicyFilterAware.kt:16-58`); yanlış sürüm gelirse indirir, launcher eler ve
uygulama **sessizce** eski sürümle açılır. Çözüm yapısal: adres sürümü İÇERİR
(`/mobil/ota/54.2/manifest`), her APK yalnız kendi paketini görür.

**Kod imzalama AÇILDI** (kullanıcı kararı) — LAN'da opsiyoneldi, internette anlamı değişti:
paket = tablete kod göndermek, VPS'e sızan biri sahadaki HER tablete istediğini gönderebilirdi.
Özel anahtar `mobil/keystore/ota-keys/` (git dışı) ve **VPS'e GİTMEZ**. İmza geçersizse
istemci güncellemeyi REDDEDER ve eski sürümle çalışmaya devam eder. ⚠️ İmza açıkken **her
yanıt imzalı olmak zorunda** (`allowUnsignedManifests` varsayılan false) → statik kurguda
`noUpdateAvailable` direktifi hiç kullanılmaz, her zaman manifest servis edilir (mükerrer
indirmeyi zaten istemci engelliyor).

**APK arm64'e indirildi** — ölçüldü: 113 MB → **49 MB** (mimari başına sıkıştırılmış:
arm64 22,5 · v7a 15,3 · x86 24,5 · x86_64 23,9 · ortak 26,8). Artık internetten indiği için
anlamlı. ⚠️ Kurulumdan önce sahadaki cihazların arm64 olduğu ölçülmeli.

**Yol boyunca ısıran üç şey:**
- `npx expo-updates codesigning:configure` app.json'a **değerlendirilmiş** yapılandırmayı geri
  yazdı ve `updates.enabled`ı SESSİZCE `false` yaptı. O hâliyle derlenen APK hiç güncelleme
  almazdı ve bu hiçbir yerde görünmezdi → bekçiye alındı (`update-feed-url.test.ts`).
- `withReleaseKeystore` eklentisi **idempotent değildi**: ikinci `prebuild` koşumunda zaten
  uygulanmış hâli "beklediğim satırı bulamadım" diye hata sayıp prebuild'i düşürüyordu.
  Ayrım: ZATEN UYGULANMIŞ olmak başarıdır, BEKLENMEYEN şablon bulmak hatadır. Blok
  eşleştirmesi de regex'ten parantez saymaya çevrildi (tembel regex iç bloğun kapanışında
  duruyordu).
- Ayarlar ekranındaki **"iki adres farklı" uyarısı** kanallar ayrılınca her cihazda kalıcı
  olarak yanacaktı → kaldırıldı, iki bağlantı etiketleriyle bilgi olarak basılıyor. Hep
  bağıran bir uyarı bir süre sonra okunmayan bir uyarıdır ve gerçek sapmada da susar.

**Yeni/değişen bekçiler:** `test_mobile_update.ts` yeniden yazıldı (37 kontrol — donmuş
baytların BOZULMADAN servis edilmesi, imzanın sertifikayla doğrulanması, **backend ↔ mobil ↔
nginx sınırlayıcı tutarlılığı**; dört negatif sonda, *tek baytlık* bozulma dahil) ·
`update-feed-url.test.ts` (7, dört negatif sonda). nginx yapılandırması artık **repoda**
(`deploy/vps/`) — eskiden yalnız VPS'te yaşıyordu ve konteyner yeniden kurulsa kural sessizce
kaybolurdu.

**Yayın sunucusu KURULDU ve doğrulandı (2026-08-27).** Electron'u kuran oturumla konuşuldu ve
onların standardına hizalanıldı — bu, tek başına çalışırken üretilecek üç yanlıştan döndü:

- **Yol müşteri bazlı: `/<musteri>/<urun>/`** (`/adnansahin/mobil/`). Müşteri segmenti alt
  alan adı DEĞİL çünkü Cloudflare Origin CA wildcard'ı (`*.etkiliyazilim.com`) iki seviyeli
  adları kapsamıyor; her müşteri için ayrı sertifika gerekirdi. Kökte açtığım `html/mobil/`
  kaldırıldı.
- **Repo klasörü `deploy/guncelleme-sunucusu/`** (benim açtığım `deploy/vps/` silindi);
  sunucudaki config'e DOĞRUDAN dokunulmaz — repodaki dosya düzenlenip kopyalanır, yoksa
  değişiklik tek kopya olarak sunucuda kalır (`kur.ps1` ile aynı "servis kendini
  güncelleyemez" durumu).
- ⚠️ **Uzun-cache kurallarında `add_header … always` YASAK.** `always` başlığı HATA
  yanıtlarına da ekler ve Cloudflare origin'in talimatına uyup **404'ü de bir hafta**
  önbelleğe alır. Bir gün önce Electron'da birebir yaşanmış: 147 MB'lık paket sunucuda
  dururken adres 404 döndü, ancak CF panelinden "Purge by URL" ile çözüldü. Taslağımda APK
  kuralında tam da o `always` vardı; kaldırıldı. İkinci hat (`error_page 404 → no-store`)
  ölçülerek doğrulandı: yükleme öncesi attığım sondalar önbelleğe girmedi.

nginx değişikliği **yalnız ekleme** oldu (0 silinen / 40 eklenen satır, diff ile kanıtlandı);
`nginx -t` + reload sonrası `/electron/latest.yml` içeriğinin BİREBİR aynı kaldığı kıyaslandı.

**Uçtan uca ölçüm (canlı sunucuya karşı, istemcinin yaptığı iş birebir taklit edilerek):**
manifest 200 + `expo-protocol-version: 1` + doğru sınırlayıcı · imza **APK'ya gömülü
sertifikayla GEÇERLİ** · 43 varlığın 43'ü hash uyumlu indi (11,7 MB) · manifest no-cache,
paket 7 gün · APK sha256'sı künyedekiyle birebir. 14/14.

**Yan bulgu — aynı tuzağın zararsız biçimi yakalandı:** APK'nın içerik tipi ilk istekte
`octet-stream` olarak önbelleğe girmiş, kural düzeltildikten sonra bile temiz URL eski
başlığı döndürüyordu (`?cb=` ile doğru tip geliyor → teşhis: önbellek). Sürüm başına dosya
adı değiştiği için gelecek yayınları etkilemez, ama yayın script'ine **kalıcı bir teşhis**
eklendi: temiz URL ile `?cb=`li URL farklı yanıt veriyorsa gürültülü uyarı + "Purge by URL"
reçetesi. Sessiz bir tuzak, bağıran bir kontrole çevrildi.

Ayrıca `test_route_auth_coverage` kırmızıydı (uçlar kimliksiz, muaf listesinde değil) —
komşu oturum haber verdi, gerekçeli iki satırla kapatıldı: koruma kimlik değil KOD
İMZALAMADIR, uçlar giriş ekranından önce çağrılır.

**⚠️ YAYIN SONRASI YAKALANAN İKİ HATA (2026-08-27, kullanıcı "bitti mi?" diye sorunca):**

**① Yayınlanan APK YANLIŞ adresi taşıyordu.** Yol standardı `/adnansahin/`e taşınmadan
ÖNCE derlenmişti; APK içinde `…/mobil/ota/54.2/manifest` gömülüydü ve o adres 404 veriyor.
O APK kurulan tablet güncelleme sorar, 404 alır ve **bir daha hiç güncelleme almaz** —
üstelik hiçbir yerde görünmez. `build-apk.mjs`in kapısı bunu YAKALIYORDU (sonradan koşulunca
kırmızı verdi), ama derlemeden sonra tekrar koşulmadığı için yayın adımına ulaşamadı.
Ders: **kapı, korumak istediği adımın ÖNÜNDE durmalı.** `deploy/mobil-yayinla.mjs`e yükleme
ÖNCESİ bir kapı eklendi — APK'nın AndroidManifest'inden gömülü adresi okuyup bugünkü feed ile
karşılaştırıyor, tutmazsa yüklemeden duruyor. Bozuk APK sunucudan kaldırıldı.

**② `nativeParmakIzi` sürüm numarasını kapsıyordu — kapının kendisi zarar üretiyordu.**
`android.versionCode` parmak izine giriyordu; her APK sürümü sahte bir "native değişti"
alarmı üretip **gereksiz bir runtimeVersion artışına** zorlardı. Ve runtimeVersion artışı
sahadaki TÜM tabletleri uzaktan güncellemeden koparır (yeni APK kurulana dek paket almazlar)
— yani yanlış kapsamlı bir kapı, korumaya çalıştığı şeyin tam tersini yaptırırdı. Sürüm
numaraları kapsam dışına alındı.

**②b Düzeltmenin KENDİSİ aynı yanlış alarmı üretti — bir kat daha derin ders.** Kapsam
değişince kayıtlı taban ESKİ algoritmayla hesaplanmış kaldı ve karşılaştırma yine "native
değişti" dedi. Ölçümle çürütüldü: `versionCode` 54'e geri sarılınca hash kayıtla **birebir**
eşleşti (`30aca7a9…`), yani fingerprint girdilerinde değişen tek şey oydu. Yani iki hash
farklı kapsamla hesaplandığı için **karşılaştırılamaz**; bunu "değişti" diye okumak yanlış
teşhistir ve sonucu ağırdır (zararlı runtimeVersion artışı). Çözüm: parmak izi kaydına
**algoritma sürümü** (`alg`) yazılıyor; sürüm uyuşmazsa script ayrı ve doğru cümleyi kuruyor
— *"karşılaştırılamıyor, runtimeVersion ARTIRMA, native değişmediğinden eminsen tabanı
yenile"*. Genel kural: **bir kapının kapsamını değiştirmek, o kapının geçmiş kayıtlarını da
geçersizleştirir** — kayda kapsamın sürümü yazılmazsa kapı, ilk koşumunda yanlış bağırır.

**Yeni APK 2.9.8/vc55 olarak yayınlanıyor, aynı ada yeniden yüklenmedi:** APK adresi 7 gün
önbellekli; aynı ada yeniden yüklemek Cloudflare'de bir hafta boyunca BOZUK paketin servis
edilmesi riskiydi. Sürüm artırmak yeni adres demek — önbellek sorunu doğmadan çözülür.

**2026-08-27 (öğleden sonra) — İKİNCİ FABRİKA + SÜRÜM KAPISI.** Kullanıcı ikinci bir
fabrikaya kurulum yapacak; iki iş birlikte alındı.

**① Müşteri bazlı yayın.** Yol düzeni zaten `/<musteri>/<urun>/` idi; eksik olan PAKET
tarafıydı — müşteri kodu elle değiştiriliyordu ve unutulursa yeni fabrikanın tabletleri eski
müşterinin OTA'sını çekerdi. Kod artık `mobil/musteri.json`da TEK KAYNAK, adres ondan türer.
⚠️ **Asıl bulgu, mevcut kapının DAİRESEL olmasıydı:** APK'nın gömülü adresi `feed.cjs`teki
sabitle karşılaştırılıyordu, ama `app.config.js` de adresi AYNI dosyadan türetiyor — müşteri
yanlışsa ikisi de aynı yanlışı söyler ve kapı GEÇERDİ. Tek müşteriyle görünmez, ikincisinde
patlar. **Genel kural: beklenen değeri gerçek değerle AYNI kaynaktan alan bir kapı, o
kaynağın yanlış olmasını yakalayamaz** — beklenen değer bağımsız bir NİYET BEYANINDAN
gelmeli. Derleme ve yayın komutları artık `--musteri` zorunlu alıyor ve kapılar onunla
karşılaştırıyor. ⚠️ İkinci ders ölçümle geldi: yayın kapısının ilk yazımı `yayin.json`daki
`musteri` alanına bakıyordu ve **ateşlemedi** — alanı taşımayan eski bir paket geçti ve
yanlış müşteriye YÜKLENDİ (sunucudan temizlendi). Künye bir BEYANDIR; paketin tabletleri
nereye göndereceğini **manifestteki varlık URL'leri** söyler. Kontrol beyana değil artefakta
bakar.

**② Sürüm kapısı — mobilde İKİ EKSEN.** Komşu oturumun Electron için kurduğu
`client-policy` deseni alındı (`GET /api/client-policy/mobil`, kayıt defteri kodda sabit,
istemci fail-open, tanımsız istemci 404). ⚠️ Ama masaüstünde olmayan bir sorun çıktı:
**mobilde sürüm tek eksen değil.** APK sürümü yalnız kurulum dosyası değişince artar, JS
düzeltmesi ise OTA ile gider ve `versionName`i DEĞİŞTİRMEZ — yani "2.9.9 görünen" bir
tabletin JS'i haftalarca eski olabilir ve `minVersion` bunu ifade EDEMEZ. Politikaya
`minPaketTarihi` eklendi (istemci `Updates.createdAt` ile kıyaslar). ⚠️ `paketTarihi === null`
(hiç OTA almamış tablet) ESKİ SAYILMAZ — gömülü paket APK ile aynı yaşta; aksi hâlde yeni
kurulan her tablet kilitlenirdi. **Kilit KOŞULLU** (Electron'dan bilinçli fark): yalnız
düzeltme GERÇEKTEN kurulabilirken ve gönderilmemiş kayıt yokken kapanır, aksi halde kalıcı
şerit. Gerekçe: interneti kopuk bir tableti kilitlemek, güncellemeyi indiremediği için
**çıkışı olmayan** bir üretim durmasıdır ve mobil bilerek çevrimdışı yazabiliyor. Politika
**kendiliğinden müşteriye özeldir** (her fabrikanın kendi backend'i servis eder); yayın
kanalı ile politika ayrı eksenler.

Bekçiler: `clientPolicy.service.test.ts` (14 — iki zarar yönünü de ölçer) ·
`update-feed-url.test.ts` (10, müşteri türetme dahil) · komşunun `test_client_policy §5`
mobil satırını otomatik kapsıyor. Yayında: **APK 2.9.9/vc56** (keşif + müşteri kanalı +
sürüm kapısı, arm64) + OTA rv 54.2. Kullanıcı kararı **A**: tek APK, hepsi birlikte.

Kalan: **her tablette uygulamayı sil + yeni APK'yı kur** (mühür değişti, ayrıca arm64).

## 2026-08-26 (akşam) — Sebep listesi büyüyünce Kaydet ekran dışında kalıyordu + sıra artık sürüklenerek KALICI

> ⚠️ **PROFİL GERÇEĞİ:** Tambur sebep adımı `production.enabled` yüzeyidir ve "7. satırda görüldü" ölçümü bu fabrikanın katalog büyüklüğüdür. **Taşınabilir çekirdek:** üç bölge (sabit başlık · KAYAN liste · sabit footer), `mergeVisibleOrder` köprüsü ("sunucu TÜM id'leri ister, ekran yalnız AKTİF satırları çizer — gizli satır KENDİ YUVASINDA kalır") ve "sürükleme yalnız yetkilide, `builtin:` zemin satırlarında KAPALI".

**Saha bulgusu (ekrandan ölçüldü):** fabrika "Kayıt düzeltmesi" listesine kendi
sebeplerini ekledikçe (yedinci satırda görüldü) Tambur → Bitir → sebep adımında
**"Geri" ve "Kaydet" ekranın alt kenarında kesiliyordu** — operatör kararı
tamamlayamıyordu. Sebep yapısaldı: adım 2'nin başlığı, serbest metin kutusu,
sebep listesi ve footer TEK bir `View` içindeydi ve sheet `maxHeight: winH*0.85`
ile kırpılıyordu. Kırpılan taraf her zaman EN ALT, yani karar düğmeleri.

**① Üç bölge (bölünme load-bearing).** Başlık + serbest metin SABİT · sebep
listesi `Animated.ScrollView` içinde KAYAR (`flexShrink: 1` — sheet'in tavanı
aşıldığında kırpılacak tek bölge orası) · Geri/Kaydet SABİT footer (üst çizgili).
Liste büyüyen tek bölge olduğu için footer'ın ondan ayrı yaşaması bir tercih
değil zorunluluk: yeni sebep eklemek listeyi uzatır, footer'ı değil.

**② Sıra sürükle-bırakla KALICI.** Satır **basılı tutulup** sürüklenir
(`react-native-sortables` — projede zaten kuruluydu, `ModuleSelectScreen`
emsali; `Sortable.Touchable` ile tek dokunuş "seç", basılı tutma "sürükle",
ikisi çakışmaz). Bırakınca `PATCH /api/reason-presets/reorder` yazar — uç
2026-08-19'dan beri vardı ama HİÇBİR istemcisi yoktu.

⚠️ **Sunucu o kind'ın TÜM id'lerini ister, operatör ekranı yalnız AKTİF satırları
çizer.** Ham "görünenlerin sırası" gönderilemez (eksik liste → 400). Köprü
`mergeVisibleOrder` (mobil `reasonPreset.service.ts`, saf fonksiyon): gizli satır
TAM listede işgal ettiği YUVADA kalır, yalnız görünenlerin yuvalarına yeni sıra
yazılır. Naif çözüm (görünenler önce, gizliler sona) pasif satırları her
sürüklemede listenin dibine toplardı — masaüstü düzenleme ekranında görünür bir
yan etki. Tam liste **yazma anında** çekilir (`list(true)`), ekranda tutulan bir
kopya başka cihaz araya satır ekleyince bayat olurdu.

⚠️ **Yerel sıra (`localOrder`) başarıda TEMİZLENMEZ** — temizlenirse liste,
yenilenmiş sorgu inene kadar bir kare eski sırayı gösterir (göz kırpması).
Hata durumunda temizlenir (eski sıraya dön) + toast. Sürükleme yalnız
`canEditPresets` (`roll:manual-adjust` ∨ `mobile:tambur-duzelt`) olan kişide
açık; gömülü çevrimdışı zemin satırlarında (`builtin:` sentetik id) KAPALI —
sunucuda karşılığı olmayan satırın sırası yazılamaz.

**Bekçi:** `mobil/src/services/reasonPreset.order.test.ts` (8 kontrol —
`mergeVisibleOrder`'ın yuva korumasını, küme eşitliğini ve uzunluk invariantını
ölçer). Naif uygulamayla **4 kontrol kırmızıya döndü** (negatif sonda).

**Tablette uçtan uca doğrulandı** (APK 2.9.7/vc54, SM-X210): butonlar liste
uzarken görünür kaldı · `input motionevent` ile basılı-tut-sürükle → satır en
üste taşındı, `PATCH /reorder` 200 · `sortOrder` DB'de 0..6 yeniden yazıldı ·
uygulama tamamen kapatılıp açıldıktan sonra sıra KORUNDU · liste kayarken
başlık ve footer yerinde kaldı.

⚠️ **Kurulum notu:** 2.9.7 imza uyuşmazlığı verdi (uzaktan güncelleme paketi
mührü değiştirmiş) → kaldır+yeniden kur gerekti; cihaz kimliği değiştiği için
tablet `PENDING` düştü ve yönetici onayı istedi. Sahaya çıkarken bu iki adım
planlanmalı.

⚠️ **Yan bulgu (bu paketin dışı):** uzun süredir koşan dev backend
`GET /api/reason-presets`'te 400 veriyordu — başka bir oturumun eklediği
`ReasonPresetKind.ORDER_CANCEL` enum değeri DB'ye gelmiş, sürecin Prisma
client'ı eskiydi ve o satırları okurken P2023 atıyordu. `prisma generate` +
restart çözdü. Ders: paylaşımlı ağaçta uzun koşan dev sunucu, başkasının
migration'ıyla sessizce bayatlayabilir; belirti "uç 400 veriyor"dur, sebep
istemci değil ÜRETİLMİŞ CLIENT'tır.

**Migration/izin/backend değişikliği YOK** — yalnız mobil. Sahaya çıkması için
yeni APK gerekir.


---

## 2026-08-27 — "Sipariş bağlarsam hata veriyor, siparişsiz açınca geçiyor" — hedef, plandan değil SİPARİŞTEN türüyordu

> ⚠️ **ÇOK-FABRİKA AÇISINDAN EN ÖNEMLİ NOTLARDAN BİRİ:** "Boyahanesiz rota (kurşun+tambur) dışarıdan boyalı gelen mal için DOĞRUDUR" — yani rota kapsaması **REDDETMEZ, UYARIR** kuralı tam olarak farklı fabrika topolojilerini destekleme kararıdır (`ApiResponse.warnings`); fason kapalı bir kurulumda hedef renk hiçbir zaman uygulanmayabilir ve bu meşrudur. ⚠️ AÇIK kalan asimetri (oluşturma ↔ düzenleme) yeni profil eklenirken yeniden ölçülmeli — bkz. MODUL-BAYRAK-TASARIM §5.2, §11.

**Saha tarifi.** Mobil Hızlı İş Emri'nde sipariş bağlanıp rotada boyahane yoksa
(sadece kurşun+tambur, ya da sadece tambur) iş emri 400 ile düşüyor; aynı toplarla
siparişsiz açılınca sorunsuz geçiyor.

**Sebep.** Sipariş bağlanınca hedef renk **sipariş satırından TÜRETİLİYOR**
(`workorder.service.create` → `resolvedTargetColorId = onlyColorId`) — planlamacı hiç renk
seçmese bile. Hemen ardından `assertRouteCoversTargets` koşuyor ve *"hedef renk var ama rotada
renk veren adım yok"* diye reddediyor. Siparişsizken hedef renk hiç doğmadığı için kontrol de
çalışmıyor. **Aynı tuzak ÖZELLİKTE de vardı:** sipariş satırının `requiredProperties`'i de
otomatik hedefe geçiyor (`create`, `orderLineRequiredProperty` birleşimi) ve "rotada zımpara
yok" diye aynı şekilde 400 veriyordu.

**Kuralın gerekçesi burada geçersizdi.** Kural *"hedef asla uygulanmaz → planlama hatası"*
diyor. Ama dışarıdan boyalı gelen kumaşa yalnız kurşun+tambur yapılacaksa rotada boyahane
**olmaması doğrudur** ve eldeki mal zaten o renktedir — uygulanacak bir şey yoktur. Sipariş
satırındaki renk bir plan beyanı değil, **müşterinin ne istediğidir**.

**⚠️ AYRICA: aynı soruya iki farklı cevap veriliyordu.** 2026-08-21'de "Rengi Değiştir" yolu
yeniden yazılırken karar açıkça verilmiş ve koda yorum olarak da yazılmıştı —
`workorder-target-color.helper.ts`: *"Rota kapsaması — REDDETME, UYAR"* (`ApiResponse.warnings`).
Yani **mevcut** iş emrinin rengini değiştirirken uyarı, **yeni** iş emri açarken sert hata. O
gün düzenleme yolu düzeltilmiş, oluşturma yolu olduğu gibi bırakılmıştı.

### KARAR — İKİ AŞAMALI (aynı gün, ikinci tur kararı ilkini genişletti)

**Önce dar kapı denendi:** kural kalsın, nitelik eldeki topların HEPSİNDE varsa kontrol atlansın.
**Sonra kullanıcı asimetrinin tamamını kapatmayı seçti: KAPSAMA ARTIK REDDETMEZ, UYARIR.**
Üç kapı da (`create` · `replace` · "Rengi Değiştir") tek kuralı söylüyor; yanıt
`ApiResponse.warnings` taşıyor. Sektör dayanağı: rota/iş planı eksikliği ERP'lerde tipik olarak
uyarıdır (SAP PP'de yönlendirme uyarısı üretim emrini durdurmaz), planlamacı bilinçli geçebilir.

⚠️ **KABUL EDİLEN RİSK (kullanıcıya söylendi, kabul etti):** eksik rotayla iş emri açılabilir.
Bedeli uyarı metnine yüklendi — NE eksik olduğunu **ve SONUCUNU** somut söyler
(*"Rotada renk veren adım (boyahane) yok — toplar hedef rengi kendiliğinden ALMAYACAK…"*).
"Rota uygun değil" gibi genel bir cümle planlamacıya ne yapacağını söylemez.

**Dar kapı MANTIĞI DURUYOR, işi değişti:** artık engeli değil UYARIYI bastırıyor. Nitelik
topların hepsinde zaten varsa uyarının cümlesi ("kendiliğinden almayacak") **yanlış** olur ve
okunmayan bir uyarı üretir — okunmayan uyarı, olmayan uyarıdan kötüdür. `replace` mal bilgisini
canlıdan okur (bağlı toplar), `create`'te çağıran verir.

### Uygulama

Uyarıya çevirmek yerine **dar kapı** seçildi: nitelik eldeki topların **HEPSİNDE** zaten varsa
kontrol atlanır.

- `create()` üçüncü bir opsiyonel parametre alır: `goods { colorIds, propertyIdSets }` —
  bağlanacak topların HÂLİHAZIRDA taşıdığı nitelikler. **Yalnız `quickStart` doldurur**
  (tek yol: top okutarak açılan iş emri); `quickStart`'ın ön-doğrulama `select`'ine `colorId`
  + `properties` eklendi.
- **"Hepsi" load-bearing:** bir kısmı eksikse o toplar niteliği hiç kazanamaz → kural orada
  hâlâ gerçek bir planlama hatasını yakalıyor. `some` yazmak kapıyı sessizce açar.
- **Mal bilgisi yoksa muafiyet de yok** (F221 deseni). Masaüstü Yeni İş Emri formu top almaz →
  düz `create` → davranış **birebir eskisi gibi**. Muafiyetin varsayılanı AÇIK olsaydı orası
  sessizce gevşerdi.
- Muafiyet **hedef rengi SİLMEZ** — WO'ya yine siparişin rengi yazılır (belge/rapor/plan-sapma
  kapısı onu okuyor); atlanan şey yalnız rota kapsaması sorusudur.

**Bekçi `test_wo_route_coverage_goods.ts` (7).** Değeri NEGATİF durumlarda: ham mal → hâlâ
reddedilir · karışık küme (boyalı+ham) → hâlâ reddedilir · topsuz `create` → davranış
değişmedi. **İki negatif sondayla kanıtlandı:** `every`→`some` yapılınca karışık küme kontrolü,
`rollCount > 0` koşulu düşünce topsuz-create kontrolü kırmızıya döndü.

**Migration YOK · izin YOK · APK YOK** — düzeltme tamamen sunucuda; tablet aynı isteği
göndermeye devam eder, artık 400 almaz. Ekran tarafında ek bir iş gerekmiyor.

**Asimetri KAPANDI** (ikinci tur): create · replace · "Rengi Değiştir" üçü de uyarıyor.
`quickStart` `create`'in uyarılarını yanıtına taşır — taşımasaydı tablet iş emrini açar ve not
yolda kaybolurdu (uyarıya çevirmenin tüm anlamı o notun görünmesiydi; bekçi bunu ölçüyor).

---

## 2026-08-27 — Sipariş görünürlüğü: şerit + altı rapor + iptal sebebi + kalem iptali

> ✅ **ÇEKİRDEK:** Sipariş & Müşteri kapatılamaz çekirdek bloktur (MODUL-BAYRAK-TASARIM §2). Liste/cursor/özet TEK `where` (`BaseService.buildListWhere` — şerit listeden sapamaz), "iptal kalem `quantity` DEĞİL `shipped` ile sayılır", "açık talep süzgeci TEK KAYNAK `order-line-scope.helper` (`cancelledAt == null` **gevşek**)" ve "karşılanma raporu `getCoverageForLines` KULLANMAZ — havuzu her satıra tam yazar, çift sayım" — hepsi bayraklanmaz.

Saha isteği ikiydi: *"envanterdeki renkli özet şeridinin aynısı sipariş ekranında da olsun"*
ve *"siparişle ilgili kapsamlı raporlar"*. İkisi de yazılırken **ölçüm üç kez planı düzeltti** —
notun asıl değeri o üç düzeltmede.

### Özet şeridi — liste ile sapma YAPISAL olarak imkânsız

Envanterin `RollsStats`i çalışıyordu çünkü liste ve özet `buildRollWhere` ile AYNI where'i
paylaşıyor (o dosyanın yorumu sebebi yazıyor: *"filtre eşleşmediğinde istatistik listeden
sapar"*). `BaseService`te böyle bir metot **yoktu** — dört adım `findAllOffset` ve
`findAllCursor` içinde ayrı ayrı kopyalanmıştı. `buildListWhere` çıkarıldı; liste, cursor ve
yeni `GET /api/orders/stats` üçü de onu çağırır. Bekçi `test_order_stats` (33) şerit sayısını
listenin `withTotal` sayımıyla **her filtre kombinasyonunda** karşılaştırır.

⚠️ **İki kapsam bilinçli olarak FARKLI:** ADET listenin aynasıdır (panel iptalleri gizlediği
için İPTAL kovası yalnız tik açıkken dolar), METRAJ iptalleri HER ZAMAN dışlar — iptal edilmiş
siparişin açık metrajı yoktur. Birini diğerine uydurmak ya şeridin toplamını listenin satır
sayısından ayırır ya da iptal metrajını üretim planına sokar.

⚠️ **Şerit görünümü üç modlu ve tercih HESAPTA** (`prefs.orders.statsView`) — tema/renk gibi
kullanıcıyı takip eder. `UserPreference` "dört kapı" modelinin TERSİDİR: backend Zod'u
`z.record(z.string(), z.unknown())`, hiçbir anahtarı tanımaz/atmaz → **backend'de tek satır
değişmez**. Tuzak: `setPreference` önbellek boşken çağrılırsa `DEFAULT_PREFERENCES + patch`
yazıp 600 ms sonra TÜM blob'u ezer (favoriler, kolon düzeni, `mobileModuleOrder` dahil);
provider `ready` bayrağını üretir ama tüketicilerin hiçbiri kullanmıyordu — mod değiştirme
düğmesi `ready` gelmeden yazmaz.

### 30 günlük pencere kalktı → index BİLEŞİK olmak zorundaydı

Sipariş ekranı varsayılan son 30 günü gösteriyordu, yani *"ABC Tekstil'in 200 siparişi"*
sorusu pencere açıkken cevaplanamıyordu. Pencere kaldırıldı. `orders` üzerinde tek başına
`createdAt` index'i YOKTU: var olan `(status, createdAt DESC)` yalnız `status` EŞİTLİK
predicate'iyle ordering verir, panelin varsayılanı ise `status NOT IN ('CANCELLED')`.

⚠️ **Tekil `(createdAt)` YETMEDİ ve bu ölçümle bulundu:** `BaseService` sıralamaya HER ZAMAN
`id` tie-breaker'ı ekler (offset yolunda `orderBy` dizisi, cursor yolunda keyset koşulu), yani
gerçek sorgu `ORDER BY "createdAt" DESC, id DESC`. Tekil index'le plan `Incremental Sort`
(Presorted Key: createdAt) bırakıyordu. `(createdAt DESC, id DESC) WHERE status <> 'CANCELLED'`
ile hem varsayılan liste hem keyset cursor sayfa-2 temiz `Index Only Scan`'e oturdu.
Yeni bir sıralama index'i eklerken bu tie-breaker hatırlanmalı.

### Altı rapor — hangi soruyu cevapladıkları yazılı

Mevcut karnelerin HEPSİ sevk tarafına bakıyordu; sipariş GİRİŞİ hiç ölçülmüyordu.
Açık Sipariş Karşılanma · Sipariş Karnesi · Müşteri Karnesi (ABC+RFM) · Talep Analizi ·
Sipariş→Teslim Süresi · Sipariş İptal Karnesi.

⚠️ **Karşılanma raporu `order.service.getCoverageForLines` KULLANMAZ.** O motor fungible depo
havuzunu HER SATIRA TAM yazar — ekran içi tek sipariş için doğru, raporda ÇİFT SAYIM. Ölçüldü:
120 m'lik stokla üç sipariş de "sevk edilebilir" görünüyor. Motor `production-balance.service`;
havuz satırlara **aciliyet sırasına** göre bölünür (termin ASC, terminsiz EN SONA — söz
verilmemiş işi söz verilmiş işin önüne geçirmemek için).

⚠️ **Sipariş→Teslim Süresi'nde ana rakam MEDYANDIR**, ortalama yanında durur. Ortalama tek bir
felaket siparişle yukarı çekilir ve ona dayanan termin sözü siparişlerin yarısında tutmaz.
`minSample` (5) altında sayı BASILMAZ — az örneklemle hesaplanan medyan istatistik değil
tesadüftür. Bugün canlıda örneklem 1: ekran "yeterli veri yok" diyor ama "37 gündür bekleyen
açık sipariş" listesi yine işe yarıyor.

⚠️ `factoryMonthSql` `constants/time.ts`'e eklendi (`factoryDaySql` ikizi). Ayın ilk gecesi
(yerel 00:00–03:00) UTC'de HÂLÂ ÖNCEKİ AYDIR; çıplak `DATE_TRUNC('month')` mevsimsellik
serisini kaydırır. Saat dilimi literalini çağıran tarafa kopyalama.

### İptal sebebi: ÖNCE veri, SONRA rapor

İptal Karnesi'nin planı "audit hazır" varsayıyordu. Ölçüm çürüttü: `Order`'da iptal sebebi
kolonu YOKTU, iptal ucu sebep parametresi ALMIYORDU, audit kaydı bile yalnız
`{"status":"CANCELLED","actions":[]}` yazıyordu. Yani *"müşteriler neden vazgeçiyor"* sorusu
veri yokluğundan cevapsızdı. Sıra tersine çevrildi: önce `ReasonPresetKind.ORDER_CANCEL` +
`Order.cancelledAt/cancelReason/cancelReasonCode`, rapor sonra.

**KARAR — "değişiklik geçmişi" yarısı KAPSAM DIŞI (2026-08-27, kullanıcı onayı).**
Raporun planlanan ikinci yarısı ("sipariş sonrası ne değişti") YAZILMADI. Üç ölçüm:
① gerçek siparişlerdeki 29 `ORDER UPDATE` audit kaydının **hepsinde `changes` kolonu NULL** →
alan bazlı değişiklik çıkarılamıyor; ② plan sapmalarının **zaten kendi karnesi var**
(`plan-deviation-scorecard`) → o yarı tekrar olurdu; ③ geriye kalan tek ölçülebilir şey
"75 siparişin 17'si düzenlenmiş" sayacıydı ve iptal oranı **zaten Sipariş Karnesi'nde**.
Boş sütunlu bir rapor yüzeyi eklemek yanıltıcı olurdu (2026-08-09'da tam bu sebeple iki rapor
kaldırılmıştı). İleride istenirse ön koşul: `AuditService`in ORDER UPDATE'te `changes`
doldurması. Rapor `meta`sında ve servis başlığında da yazılı.

⚠️ **Çıpa `cancelledAt`** (iptalin OLDUĞU an), `orderDate` değil: sipariş Ocak'ta alınıp Mart'ta
iptal edilebilir. Sipariş Karnesi'ndeki iptal oranı FARKLI bir soruyu cevaplar ("bu ay ALINAN
siparişlerin kaçı sonradan iptal oldu") ve iki rakamın birbirini tutması GEREKMEZ.
Alan sonradan eklendiği için eski 4 iptalde NULL'dur → dönem raporuna girmezler; geriye dönük
damga UYDURULMADI, sayıları `undatedCancelCount` ile ayrıca döner ve ekranda yazılıdır.

### Sipariş KALEMİ iptali — asıl maliyet kolon değil, yayılım

10 kalemlik siparişin 3 kalemini iptal etmek bugüne dek İMKÂNSIZDI: kalem çıkarmanın tek yolu
hard-delete idi ve aktif iş emri bağı varsa tamamen reddediliyordu. Artık SOFT iptal — kalem
listede üstü çizili kalır, sevk edilmiş metrajı defterde durur, iş emri bağı otomatik kopar
(son bağsa iş emri STOK üretimine döner: "tip = bağın aynası").

⚠️ **Statü aritmetiği işin kalbi:** `recomputeOrderStatus`ta
`totalRequired = Σ(aktif.quantity) + Σ(iptal.shipped)`. İptal kalemin `quantity`si toplamda
kalsaydı sipariş o farkı ASLA kapatamaz, **sonsuza dek PARTIAL_SHIPPED** görünürdü. Son aktif
kalem gidince: sevk varsa COMPLETED, yoksa CANCELLED (kullanıcı kuralı).

⚠️ **`==` vs `===` — sessiz felç.** Süzgeç `cancelledAt == null` (GEVŞEK) yazılır. Alanı
`select`'ine almayan bir çağıran `undefined` gönderir ve KATI `=== null` orada FALSE döner →
TÜM kalemler iptal sayılır → sipariş sevk yokken CANCELLED'a düşer. Ölçüldü: `test_helpers`in
sahte tx'i tam bunu yaptı, dört senaryo birden bozuldu. Eksik bir alan siparişi iptal ettiremez.

⚠️ **Aktif-kalem kuralı TEK KAYNAK** `helpers/order-line-scope.helper.ts` + AST bekçisi
`test_order_line_scope_single_source` (fason `fason-open-dispatch.helper` emsali). Kural tek
cümle: **GELECEK sorusu süzer, GEÇMİŞ sorusu süzmez.** Ham SQL'de gerekçeli
`-- aktif-kalem-muaf:` işareti (`-- tz-ok:` deseninin ikizi) geçmiş sorgularını muaf tutar.
Bekçi, elle taramada KAÇIRILAN üç süzgeci buldu: talep analizinin aylık ham SQL'i, müşteri
sipariş profili, sevk & termin karnesinin `plannedQty`si.

⚠️ **Düzenleme yolu da kapatıldı:** sipariş formu kalemleri toptan gönderir; iptal edilmiş kalem
payload'da yoksa diff onu SİLER (iptal olgusu + sevk metrajı kaybolur), varsa metrajı
DEĞİŞTİRİLEBİLİR. İkisi de sunucuda kapalı, istemci disiplinine bırakılmadı.

**BİLİNEN SINIR (yazılı):** *"iptal anında iş emri açılmış mıydı"* ÖLÇÜLEMİYOR — iptal akışı WO
bağlarını koparır, karar anındaki bağ sonradan okunamaz. Vekil ölçüler `daysToCancel` +
`afterShipmentCount`. Ölçmek istenirse sayı iptal ANINDA dondurulmalı.

### Bekçinin kör noktası hatanın kendisiyle aynı yerdeydi (tekrar)

`test_order_line_cancel`ın ilk hâli aritmetik regresyonunu YAKALAMIYORDU: tek kalemli
senaryoda "hepsi iptal" dalı statüyü doğrudan belirliyor ve `totalRequired` hiç gözlenmiyor.
Negatif sonda ilk turda **yeşil kaldı**. Aritmetik ancak SİPARİŞTE AKTİF KALEM KALIRKEN görünür
(§4b). Bu dosyaya senaryo eklerken aynı tuzak geçerli.

**Migration:** `20260826120000` (orders sıralama index'i) · `20260826130000` (ORDER_CANCEL enum) ·
`20260826130100` (sipariş iptal izi) · `20260827100000` (kalem iptali).
**İzin YOK · APK YOK** (mobil sipariş iptal etmez). Backend ÖNCE deploy.

---

## 2026-08-27 (ikinci tur) — Yarı mamul ayrımı Kanban'a ve tablete taşındı + Kanban'ın ESKİ sapması

> ⚠️ **PROFİL GERÇEĞİ:** Kanban kolonları ve mobil Depo sekmeleri `production.enabled` yüzeyleridir; "bugün fark 0 ama tesadüfen" ölçümü bu kurulumun verisi. **Çekirdek:** "bekçi ANAHTAR değil SAYI SEMANTİĞİ ölçer" (pano=48 ↔ envanter=47 negatif sondası), "altıncı unutulmuş enum" sınıfı ve "üç yüzeyde TEK rakam" ilkesi — bkz. MODUL-BAYRAK-TASARIM §3 madde 8.

2026-08-26'da envanter sekmesi ayrılmış, ayrımı takip ETMEYEN yüzeyler gerekçeleriyle
listelenmişti. Kullanıcı o listeden ikisini kapsama aldı.

### ① Üretim Akışı (Kanban) — iki düzeltme, TEK dokunuş

**Yeni kolon "Yarı Mamul"**, Ham Stok'un yanında. Yan yana ama aynı kova değil: yarı mamul
boyahaneyi **atlar**, akışa Kurşun'dan girer. Renk bilerek AYRI (cyan) — iki kolon komşu ve
aynı aileden, aynı tonda olsalar operatör sayaçları karıştırır; ayrımın görünürlüğü bu paketin
varlık sebebi. Mobil Depo sekmesiyle aynı ton.

**⚠️ Aynı sorguda ESKİ ve BAĞIMSIZ bir sapma da kapandı.** Kolon `rollColumn(STOCK)` ile düz
`{ status }` sorguyordu — `currentStepId` koşulu YOKTU. Yani bir adıma bağlı STOCK topu panoda
sayılıyor, Envanter sekmesinde (`rollScope`) sayılmıyordu: **aynı adı taşıyan iki yüzey farklı
rakam basıyordu ve bu yarı mamulden tamamen bağımsızdı.** Bugün prod'da fark 0 (283 STOCK topun
hepsi adımsız), ama koşul olmadan eşitlik bir invariant değil TESADÜFtü.

**Bekçi genişletildi** (`test_production_flow_columns`): eskiden yalnız kolon ANAHTARLARININ
varlığını ölçüyordu, **sayı semantiğini değil** — panonun Envanter'den sapması bu yüzden yıllarca
görünmedi. Artık her iki kolonun toplamı Envanter kapsamlarıyla karşılaştırılıyor + kolonların
örtüşmediği ölçülüyor. **Negatif sonda:** adıma bağlı bir STOCK topu üretilip `currentStepId`
koşulu kaldırıldı → `pano=48 envanter=47`, kırmızı. Koşul geri konunca 47=47.

### ② Mobil Depo — "Ham" ikiye ayrıldı

`DepoScreen` sekmeleri: Tümü · Depo · Çuvalda · **Ham** · **Yarı Mamul** · Kartela · Kartelalık.
Eski "Ham" sekmesi düz `status:'STOCK'` gönderiyordu (`rollScope` DEĞİL) → yarı mamul ham kumaşla
karışıktı. Artık `rollScope=RAW_STOCK_PURE` / `SEMI_FINISHED`; **"Tümü" sekmesi bilerek statü
tabanlı kalır** (orada ayrım gerekmez, ayrı sekmeler zaten var).

⚠️ `rollScope=RAW_STOCK` (birleşim) Hızlı İş Emri top seçicisinde DOKUNULMADAN kaldı — daraltılsa
yarı mamul oradan düşerdi.

**Dağıtım:** APK GEREKMEZ — ve bu **ölçüldü, varsayılmadı**. Değişiklik saf JS (yeni native
modül/izin yok, `app.json`a dokunmuyor) → uzaktan güncellemeyle gider. `npm run yayinla`'nın native
parmak izi kontrolü: `3a17652b7719adb6` ↔ önceki kayıt `3a17652b7719adb6` (runtimeVersion 54.2),
**birebir aynı** → bağımlılıklar/plugins/`android` bloğunun hiçbirine dokunulmamış. "OTA'ya uygun
mu" sorusunu insan değil script cevaplar; yanlışlıkla native bir şeye dokunulsa script DURUR ve
"runtimeVersion artır + yeni APK" der.

Sıra: kullanıcı elle turu yapar (2.9.9 kurulur — mühür değişikliği yüzünden zaten gerekiyordu) →
sonra `npm run yayinla -- --musteri=adnansahin`. Uzaktan güncelleme yalnız 2.9.9 kurulu tabletlere
gider, o yüzden elle turdan ÖNCE yayınlamak işe yaramaz.

**Bu, uzaktan güncelleme paketinin ilk pratik faydası oldu:** normalde ikinci bir tablet turu
doğuracak bir iş, hiç tur gerektirmeden çıkıyor.

### ③ Görsel tur — gözle bakmasa yakalanamayacak iki bulgu

Playwright + `_electron.launch` ile uygulama gezildi (temiz `--user-data-dir` profili şart:
yoksa önceki turun oturumu geri yüklenir, giriş ekranı hiç çıkmaz ve seçiciler tutmaz).

1. **"Tip" kolonu yarı mamul topu "Bitmiş" gösteriyordu** (`columns.tsx`
   `rollProcessingState`): `status===STOCK ? (colorId ? "bitmis" : "ham")`. Backend'in "renk varsa
   bitmiş" sezgisinin İSTEMCİ İKİZİ — altıncı giriş kaynağını tanımıyordu. **Beşinci** "unutulmuş
   enum" vakası (öncekiler: `entryTitle`, mobil KK1 listesi, iki `entrySource` filtresi,
   `activity-utils` etiketleri). Yeni `yarimamul` durumu eklendi.
2. **Stok Karnesi'nin 5 kartı 1024px'te sıkışıyordu** — "9283,8 m" iki satıra kırılıyordu.
   `lg:grid-cols-3 xl:grid-cols-5` (beşli sıra yalnız 1280px'ten itibaren).

**Doğrulanan eşitlik:** Stok Karnesi "Ham 47 top" ↔ Envanter Ham Stok rozeti 47 ↔ Kanban Ham Stok
kolonu 47. Üç yüzey, tek rakam — paketin varlık sebebi olan invariant.

**Gözle doğrulanamayan:** Manuel Giriş'teki amber uyarı (renk seçili + kutu işaretsiz) — turda o
kombinasyona girilmedi, kullanıcının Windows provasında bakılacak.

**Ders:** birim testi + typecheck yeşilken bile ekrana bakmak iki gerçek hata buldu; ikisi de
"derleyici görmez" sınıfındaydı (biri string haritası, biri CSS breakpoint).

---

## 2026-08-27 (üçüncü tur) — Yarı mamul ayrımı: kalan dört yüzey. AYRIM GÖSTERİMDE, ARZDA DEĞİL

2026-08-26'daki taramada ayrımı takip ETMEYEN yüzeyler gerekçeleriyle listelenmişti; kullanıcı
**hepsini** kapsama aldı. **Gerekçe ölçümdü:** prod'da bugün 0 yarı mamul kaydı var → akış
başlamadan ÖNCE kapatılırsa sapmalar hiç görünmeden çözülür. Sonradan yapılsaydı fabrika önce
yanlış rakamı görür, düzelttiğimizde rakam kayardı ve "sistem tutarsız" izlenimi doğardı.

### ⚠️ PAKETİN TEK KURALI: yarı mamul ARZDIR, düşülmez — ayrı GÖSTERİLİR

Kullanıcı kararı ve sektör dayanağı aynı yerde buluşuyor: SAP'de HALB ayrı bir stok TÜRÜdür
(ayrı raporlanır, ayrı değerlenir) **ama MRP/ATP'de arza girer**. Yarı mamul rafta duran,
üretime sokulabilir maldır; arzdan düşmek olmayan bir "kumaş tedarik et" açığı uydururdu.
Bu kural aşağıdaki her maddede aynı biçimde uygulandı ve `test_semi_finished_surfaces` §2 ile
kilitlendi — **negatif sonda ölçtü:** yarı mamul arzdan düşürülünce 400 m'lik talepte **200 m
sahte kumaş açığı** doğuyor.

### ① Ürün (Kumaş) Dengesi — `production-balance.service`
`supply` groupBy'ına `entrySource` eklendi; `BalanceGroup.ham` daraldı, **yeni `yariMamul`**
alanı geldi. **`malzemeAcigi` İKİSİNİ BİRDEN düşer** (`uretilecek − (ham + yariMamul)`).
Ekranda: HAM kolonunun altında cyan `+ N yarı mamul` satırı (yalnız >0 iken), "İş Emri Aç"
diyaloğunda kumaş açığı uyarısı da **toplam arza** bakar (`spec.ham + spec.yariMamul`) — iki
taraf ayrışsaydı ekran ve backend farklı açık gösterirdi.

### ② Sipariş karşılama — `order.service`
`getCoverageForLines` → `freeSemiFinished` alanı; `matchFree`'ye opsiyonel `semi` süzgeci.
`getSpecAvailability` → aynı ikili. `netGap` DEĞİŞMEDİ (ham havuzu zaten hiç sayılmıyordu —
işlenmemiş girdi, mamul değil). Sipariş formundaki ipuçta artık "Ham: X · Yarı mamul: Y".
⚠️ Electron tarafında alan **opsiyonel** okunur (`?? 0`) — backend ÖNCE deploy edilir ama sıra
ters dönerse ipucu sessizce kaybolmasın.

### ③ İptal geri alma mesajı — `inventory.service.restoreCancelledRoll`
Her STOCK topu için *"tekrar ham stokta"* diyordu. Yarı mamul topu da STOCK'a döner ama
Envanter'de **"Yarı Mamul"** sekmesinde durur → operatörü yanlış sekmede arattırıyordu. Artık
`entrySource`e bakıp *"yarı mamul stoğunda"* diyor (`select`'e `entrySource` eklendi).

### ④ Kapanış dispozisyonu etiketi — üç yüzey birden
`"Ham stok"` → **`"Stoğa geri"`** (`WorkOrderCompleteDispositionList`), kalite hedef statüsü
`"Ham Stok (üretime devam)"` → **`"Stok (üretime devam)"`** (`QualityGrades/columns`), backend
sözleşme yorumu da düzeltildi. Gerekçe aynı: `STOCK` bir STATÜdür; topun hangi sekmede
görüneceğini `entrySource` belirler. Hint artık "(Ham Stok / Yarı Mamul)" diyor.
⚠️ `WorkOrderCompleteDialog.test` etiketi metinle arıyordu — test de güncellendi.

### Bekçi: `scripts/test_semi_finished_surfaces.ts` (10)
Dört yüzeyi de ölçer. **En değerli iki kontrol:**
- **§2** açık hesabı yarı mamulü arz sayıyor mu (negatif sonda: 200 m sahte açık)
- **§4 toplam korunuyor mu** — `ham + yarıMamul` ayırmadan önceki tek rakama eşit olmalı;
  eşit değilse bir yerde metraj DÜŞÜRÜLMÜŞ demektir (ayrım sunumdur, aritmetik değil)

⚠️ Fixture sırası load-bearing: **Ürün Dengesi TALEPTEN doğar**, sipariş kalemi olmayan bir
spec listede HİÇ görünmez. Önce talep, sonra ölçüm — ters sırada test "grup=0" ile düşer.

### Görsel doğrulama
Kumaş Dengesi'nde `ALP GÜMÜŞ · EKRU` satırı ekranda ölçüldü: **HAM 0 · "+ 640 yarı mamul" ·
ham açığı 260** (talep 900). Yarı mamul arza girmeseydi açık 900 çıkardı — kural ekranda da
doğrulanmış oldu.

**Migration YOK · yeni izin YOK · APK YOK.** Backend ÖNCE (Electron `freeSemiFinished`'i
opsiyonel okuduğu için ters sıra da çökmez, yalnız ipucu eksik kalır).

---

## 2026-09-01 — Patron modülü: fabrikaya GELEN PORT AÇMADAN uzaktan takip

> ⚠️ **PROFİL GERÇEĞİ:** `WEB_BOSS` şablonunun `report:finance` taşımaması "alt-ağaç zaten `requireFinanceEnabled` arkasında ve **fabrikada kapalı**" gerekçesine dayanır — `finance.enabled` AÇIK bir kurulumda bu gerekçe düşer ve şablon yeniden değerlendirilir. **Çekirdek:** uzaklık SOKETTEN çözülür (`clientType` güvenlik sınırı DEĞİL), Access JWT FAIL-CLOSED, JWKS TTL = tazelik (geçerlilik değil), `clientIpHeaderRemoteOnly`, helmet İKİ ÖRNEK / TEK PROCESS, uzakta 404 (403 keşfe davet) ve sır hijyeni — bkz. MODUL-BAYRAK-TASARIM §7, §12 kural 8.

**Talep:** patron dışarıdan stoğu/siparişi izlesin; ara sıra sipariş, iş emri ve
müşteri kaydı da açsın. Yani salt-okunur bir ayna DEĞİL, **canlı ve yazabilen dar
bir yüzey**.

### Neden tünel — ve neden ayna DEĞİL

Üç seçenek tartıldı. **Bulut ayna elendi** çünkü tek yönlüdür: yazma gelince ya
iki yönlü senkron yazılacaktı (çatışma çözümü + kuyruk + sıralama — ayrı bir
proje) ya da yazmalar için yine canlı bağlantıya düşülecekti. **Uygulama
seviyesi senkron da elendi**: bu koddaki atomik claim'ler, `pg_advisory_xact_lock`
(8021/8022/8024/8028) ve `clientToken` idempotency'sinin TAMAMI tek DB varsayar.

İlk tasarım WireGuard + kendi VPS'imizdi; **Cloudflare Tunnel + Access'e
çevrildi**. Fark tünelde değil KİMLİKTE: Access, ERP'ye ulaşmadan önce bir
e-posta OTP duvarı koyar ve bu TeksERP'ye tek satır kod yazmadan gelir.
"CF araya girer, trafiği görür" itirazı bu projede geçersiz — turuncu bulut
Origin CA yüzünden zaten zorunlu, yani CF her hâlde TLS'i sonlandırıyor.

### Uzaklık SOKETTEN çözülür — `clientType`ten değil

Aynı process iki dünyaya hizmet ediyor: LAN (`0.0.0.0:4000`) ve tünel
(`127.0.0.1:REMOTE_PORT`). Ayrımın kaynağı `req.socket.localPort`tur.

⚠️ **`clientType` bir güvenlik sınırı DEĞİLDİR** — gövdeden gelir, internetten
gelen biri `clientType:"electron"` yazıp LAN kurallarına (PIN girişi, TOTP
muafiyeti) düşerdi. Tünel dinleyicisi **yalnız `127.0.0.1`e** bağlanır; LAN'dan
erişilemediği için uydurulamaz ve **paylaşılan sır yoktur** (sızacak ya da
rotasyona girecek bir şey yok).

⚠️ **4001 `0.0.0.0`a AÇILAMAZ.** Açılırsa fabrikadaki herhangi biri kendini
"uzak" gösterebilir ya da tersi olur; iki yönde de kural seti sessizce yanlış
uygulanır. `HOST` env'i bilerek onurlandırılmaz — o LAN dinleyicisinin ayarıdır.

### İkinci katman: Access JWT, FAIL-CLOSED

Uzak `/api` isteklerinde `Cf-Access-Jwt-Assertion` RS256 + JWKS ile doğrulanır
(`jsonwebtoken` zaten bağımlılıkta; JWK→PEM `node:crypto`nun kendi `format:"jwk"`
desteğiyle — `jwks-rsa` GEREKMEZ).

Bu yalnız derinlik savunması değil: **Access politikası CF panelinden
yanlışlıkla kaldırılırsa** kimlik duvarı sessizce düşerdi ve bunu hiçbir yerden
göremezdik. Burada uzak erişim DURUR.

⚠️ JWKS önbelleğinde **TTL'in işi TAZELİKTİR, GEÇERLİLİK DEĞİL** (2026-08-26
`ReasonPreset` dersinin birebir aynısı): süre dolunca `null` dönüp fail-closed'a
düşmek, CF'e giden tek bir yavaş isteğin patronu kapıda bırakması demekti. Bayat
anahtarlar da döndürülür + arka planda tazeleme tetiklenir. **Bayatlık ≠ boşluk**:
önbellek HİÇ dolmadıysa fail-closed KALIR (ve bu güvenli — JWKS'e ulaşılamıyorsa
tünel de ayakta değildir, yani gerçek bir uzak istek gelemez).

### Uzakta kapalı yollar — neden 404, neden 403 değil

`login-quick-pin` · `login-card` · `mobile-users` · `/api/devices` ·
`/api/discovery` · `/api/mobile` · `/api-docs`.

En kritiği PIN: **`users.quickPin` 6 HANE, DÜZ METİN ve sistem genelinde
`@unique`** — yani PIN tek başına kimliği belirler. 10^6'lık bir uzayı internete
açmak tüm operatör hesaplarını kaba kuvvete açmaktır. `POST /api/devices/announce`
ise kimliksiz PENDING cihaz yaratır ve tavan 200'dür → tablet eşleştirmesi
DoS'lanabilirdi.

**403 değil 404**: 403 "burada bir şey var ama giremezsin" der ve keşfe davet
eder. Servis katmanında da ikinci hat var (`assertNotRemote`) — kenar denylist'i
bir refactor ya da yanlış mount sırasıyla düşerse devreye girer.

### Sessizce kapanan açık: `CLIENT_IP_HEADER`

Başlık app-wide okunsaydı **karışık modda LAN'daki biri
`CF-Connecting-IP: <rastgele>` yazarak giriş kilidini VE hız sınırını tamamen
etkisizleştirirdi** (her denemede farklı kova). Güven artık
`clientIpHeaderRemoteOnly` ile daraltılıyor ve bayrak `REMOTE_PORT`ten
TÜRETİLİYOR — uzaktan erişim kapalı kurulumlarda (demo dahil) davranış birebir
eskisi gibi.

⚠️ `TRUST_PROXY` app-wide AYARLANMAZ: Express'in `trust proxy`si uygulama
genelidir ve LAN'da da `X-Forwarded-For`a güvenirdi. Zaten `resolveClientIp`in
dokümanı 2026-08-14'te `TRUST_PROXY`nin bu işi çözemediğini canlı demoda
ölçmüştü — asıl mekanizma başlıktır.

### helmet İKİ ÖRNEK, tek process

HSTS + CSP `upgrade-insecure-requests` internette gerekli; **LAN'da AYNI
başlıklar paneli KIRAR** — tarayıcı `http://192.168.1.250:4000` adresini kalıcı
https'e çevirir, sunucu 443 dinlemediği için panel açılmaz ve geri dönüş
SUNUCUDA DEĞİL kullanıcının HSTS önbelleğindedir. Tek bir helmet örneğini
"ortalama" yapılandırmayla kurmak mümkün değil → iki örnek, istek başına seçim.

⚠️ Dispatcher'ın **fonksiyon adı `helmetMiddleware` olmak ZORUNDA**: Express
katman adını fonksiyondan alır ve `test_middleware_order` sırayı ADLA doğrular.
İsimsiz arrow yazıldığında katman "bulunamadı" olur ve sıra sözleşmesi
SESSİZCE ölçülmez hâle gelir (ilk yazımda tam bu oldu).

### İKİ DİNLEYİCİ ≠ İKİ PROCESS

`server.ts`teki tek-process invariantı korunuyor: presence Map'i, feature-flag
cache'i ve zamanlayıcı bayrakları PROCESS-local'dir; tek process içinde ikinci
bir soket açmak onların hiçbirini çoğaltmaz. Bozulan şey ikinci bir NODE SÜRECİ
olurdu — o hâlâ YASAK. (Invariant yorumu "tek `app.listen`" diyordu, düzeltildi.)

### TOTP — kendi kodumuz, dış vektörle doğrulandı

`node:crypto` HMAC-SHA1, yeni paket YOK. Standarda uyum **RFC 4226 + 6238 test
vektörleriyle DIŞARIDAN** doğrulandı; kendi ürettiğini doğrulayan bir tur hatalı
uygulamayı da onaylardı ve Google Authenticator uyumsuzluğu ancak sahada,
girişte görülürdü.

**Kurulumun TEK yolu yöneticinin açtığı 15 dk'lık tek kullanımlık penceredir.**
"Parola doğruysa kullanıcı kendi kursun" (TOFU) reddedildi: parola sızmışsa
saldırgan 2FA'yı KENDİ telefonuna bağlar ve meşru sahibi kilitler — yani 2FA'nın
koruduğu TEK senaryo kapanırdı.

⚠️ **İkinci faktör `issueToken`den ÖNCE koşar.** Sonraya bırakılsaydı yalnız
parolayı ele geçiren biri, TOTP'yi hiç geçemese bile meşru kullanıcıyı
oturumundan atabilirdi (`kick` politikası oturum kaydı açarken diğerlerini
düşürüyor).

**Üç hata kodu, üç farklı statü** ve ayrım keyfi değil — giriş kilidi yalnız
**401**'i kaba kuvvet sayar (`auth.controller` F49): 403 kurulum yok · 409 kod
istendi · 401 kod yanlış. 409'u 401 sanmak meşru kullanıcıyı KOD İSTENDİĞİ İÇİN
kilitler; 401'i 409 sanmak yanlış kod girmeyi sonsuz denemeye çevirir.

Kurtarma kodları **bcrypt** ile saklanır (`quickPin`/`cardToken`tan ayrılan
nokta ve bilinçli): kurtarma kodu parolaya denk bir sırdır, oysa PIN LAN-only
fiziksel bir kolaylıktır.

### `ClientType.WEB`

Web paneli Electron renderer'ının AYNI kodudur ve `clientType:"electron"`
gönderiyordu → patron telefondan girince masaüstü oturumunu DÜŞÜRÜYORDU
(`sameTypeSessionPolicy` varsayılanı `kick`). Artık kendi oturum yuvasını alıyor.

⚠️ `isDesktopClient`te **`!== "mobile"` YAZILMAZ**: `clientType` opsiyoneldir ve
`undefined` tarihsel olarak MOBİL demektir; negatif yazım alanı hiç göndermeyen
eski mobil istemcileri masaüstü sayıp hepsini 403'e düşürürdü.

Aynı dokunuşta **altıncı "unutulmuş enum değeri"** yakalandı:
`describeExistingSession` iki dallıydı ve `web`i sessizce "mobil cihaz" diye
gösteriyordu → `Record` biçimine alındı (dördüncü değer eklenirse TS derlemede
söyler).

### `GET /api/boss/overview` — tek uç, bölüm bazlı izin

Beş bölüm (stok · sipariş · üretim · sevkiyat · fason), **yeni iş mantığı YOK**:
mevcut rapor servisleri compose edilir. Naif çözüm istemcinin altı raporu ayrı
çağırmasıydı; bedeli tünel üzerinden altı gidiş-dönüş değil sadece — her istemci
hangi raporu çağıracağını KENDİ bilirdi ("ayrışan yüzey" sınıfı).

**İzin süzmesi SERVİSTE** (`GET /api/search` deseni) ve **yeni izin kodu YOK**
(2026-08-01 kurşun bypass dersi: yeni kod = sahada atanması unutulacak bir adım
daha). Yetkisiz bölümün SORGUSU HİÇ KOŞMAZ.

⚠️ **Üretim kartı ADET basar, metraj değil.** `getProductionFlow` kolon başına
yalnız sayım döndürüyor; burada metraja çevirmek aynı sorunun İKİNCİ tanımını
doğururdu (2026-08-27: pano 48 / envanter 47).

`WEB_BOSS` rol şablonu bilinçli DAR: `report:finance` YOK (alt-ağaç zaten
`requireFinanceEnabled` arkasında ve fabrikada kapalı — koymak hiçbir şey
açmayan ama "verilmiş" görünen bir izin bırakırdı), SoD üçlüsü YOK,
`report:audit` YOK (denetim takip değil YÖNETİM yüzeyi).

### `BossShell` — sekme sistemi bypass, router altyapısı DEĞİL

`AppShell` "uygulama içinde tarayıcı sekmeleri" modeli; telefonda sekme şeridi
ekranın üçte birini yer ve dokunmatikte kapatma düğmeleri isabet almaz.

⚠️ **Ama kendi memory router'ını KURMA.** `content-routes` sayfaları `useTabId`,
`TabPortalProvider` ve geçmiş defterine (`history-depth`) bağlı — onlarsız
`PageHeader`ın geri oku SESSİZCE ölür ve modaller yanlış yere portallanır. Tek
"boss" sekmesi açıp aynı makineyi kullanmak, detaya inişin bugünkü ekranlarla
çalışmasını sağlıyor.

⚠️ **Hash değişimi React'e hiçbir şey söylemez.** `Root` kapısı düz
`window.location.hash` okuyordu → "Tam panele geç" adresi değiştiriyor ama ekran
patron kabuğunda ASILI KALIYORDU; hata yok, log yok, tepkisiz düğme.
`useHashPath` (`useSyncExternalStore` + `hashchange`/`popstate`).

### Web paneli backend PAKETİNE girer

`deploy/paketle.ps1` `Electron/dist-web`i derleyip pakete koyar; sunucuda
`app\dist-web`. **Sürüm drift'i matematiksel olarak imkânsız** — ayrı kanaldan
yayınlansaydı SPA bir sürümü, API başka bir sürümü konuşabilirdi ve belirtisi
"ekran boş" olurdu.

⚠️ **Eksiklik SESSİZDİR**: `WEB_DIST_DIR` var olmayan bir klasörü gösterirse
`express.static` no-op olur ve kök (/) panelin YERİNE durum sayfasını basar. Bu
yüzden iki kapı: derleme başarısızsa paket ÜRETİLMEZ, derleme 0 dönüp BOŞ klasör
bırakırsa da üretilmez (`index.html` kontrol edilir).

⚠️ PowerShell'de **backtick KAÇIŞ karakteridir** — hata mesajında
`` `npm install` `` yazmak `` `n `` yüzünden satır kırıyordu.

### Bekçiler

| Bekçi | Kontrol | Negatif sonda |
|---|---|---|
| `test_remote_access_guard` | 51 | 4 (denylist · helmet · IP başlığı · Access JWT) |
| `test_totp` | 69 | RFC vektörleri dış referans |
| `test_boss_overview` | 60 | 4 (izin süzmesi · kolon sayımı · matchesPermission · kırılım) |
| `login-totp.test` (Electron) | 14 | 2 |
| `boss-shell.test` (Electron) | 11 | 3 |

⚠️ **`test_remote_access_guard`ın asıl iddiası "LAN yolu değişmedi"** ve bu
gerçek bir HTTP sunucusuyla, İKİ PORT üzerinden ölçülür. Yalnız uzak yolu test
etmek vakumen yeşil kalırdı (uzak yol zaten yeni kod).

⚠️ **`test_boss_overview`da kırılım kontrolü İLK YAZIMDA YOKTU** ve bunu negatif
sonda yakaladı: `byCustomer` alanını değiştirmek DERLENİYOR ve testi GEÇİYORDU.
Sonda seçerken ikinci tuzak: bu veride `openQty === uncoveredQty` (hiçbir sipariş
depodan karşılanmıyor) → o ikisini değiştiren sonda YEŞİL kalır; kırmızı kanıtı
`fromWarehouseQty` ile alınır.

⚠️ **`login-totp.test` ilk yazımda KENDİ YORUMUNU yakaladı** (doküman
bloğundaki `clientType:"electron"` ifadesini kod sandı). Kaynak taraması yapan
her bekçi önce yorumları atmalı — aynı ders `print-merge`te de ölçülmüştü.

### Canlı ölçüm (iki dinleyici, tek process)

LAN `clientType:"web"` girişi kabul · `/api/boss/overview` gerçek veri (ham
31971 · yarı 7660 · bitmiş 30671 m, 69 açık kalem / 78870 m, 23 geciken, 7
kolon, 6 istasyon, fasonda 1200 m) · tünel portunda Access başlığı yokken 403 ·
PIN/cihaz uçları tünelde 404 ama LAN'da 401/400 (erişilebilir) · HSTS + CSP
upgrade yalnız tünelde · `WEB_DIST_DIR` ile kök panel + asset 200.

**Migration:** `20260901173733_uzaktan_erisim_totp` (additive — `ALTER TYPE ADD
VALUE` + iki tablo). ⚠️ Prisma'nın ürettiği iki `DropForeignKey` satırı ELLE
SİLİNDİ (DEFERRABLE composite FK tuzağı, perf kuralı 4) ve `test_schema_drift`
ile doğrulandı. **Yeni izin kodu YOK · APK YOK.**

**AÇIK MADDELER:**
- Uzak TOTP akışı canlı ölçülemedi (tünel portu geçerli Access JWT'si istiyor) —
  gerçek CF kurulumunda bir kez denenmeli (reçete: kabul ölçümü #5).
- Fiziksel LAN regresyonu (tablet PIN + panel) fabrikada yapılmalı.
- **Faz 2 mobil uygulaması Access ile sürtüşecek**: native istemci servis
  token'ı ister, o da APK'ya gömülü paylaşılan bir sır demektir. O gün ya
  `/api/*` Access dışına alınıp yalnız SPA gatelenir, ya mobil için ayrı yol.
- Kesintide patron veri göremez (CF Error 1033). Kalıcı çözüm okuma replikası ve
  o **WireGuard ister** — CF Tunnel PostgreSQL replikasyonunu taşımaz.

### 2026-09-02/03 — Modül anahtarları P1: `finance.enabled` kalıbı beş modüle çoğaldı, üretim kapıya TERFİ etti, grandfathering "dünkü davranış"ı damgalar

> ✅ **ÇEKİRDEK — bu not sınıflamanın KENDİ TEMELİDİR:** tek gövde/çok fabrika altyapısı (7 anahtar · adlandırılmış middleware · tek kaynak `module-flags.ts` · bağımlılık iki yerde · `MODULE_DISABLED` · grandfathering "değer = DÜNKÜ DAVRANIŞ"). Bu dosyadaki eski notlar okunurken kural: **"adnansahin'de yok" = "bayrağı kapalı"**; hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz — bkz. MODUL-BAYRAK-TASARIM §11, §12 kural 6.

**Bağlam:** Tek gövde / çok fabrika kararı (`docs/design/MODUL-BAYRAK-TASARIM.md`, plan `MODUL-BAYRAK-UYGULAMA-PLANI.md` P1). Dilim 0 aynı gün: `main` ff-merge, `adnansahin` + `feature/depo-mal-kabul` emekli (fabrikadaki BUILD klonu hâlâ `adnansahin`'de — sıradaki paketlemeden önce sunucuda `git checkout main`, reçete `deploy/README.md`). Kod `feature/modul-bayrak` dalında; 7 keşif + 6 uygulama/doğrulama + 2 düzeltme/doğrulama ajanı (Opus/Sonnet), spec ve karar ana oturumda.

**Ne yapıldı (backend ÖNCE; Electron aynası dar; APK YOK; izin YOK; migration 1 — additive):**
- **Anahtarlar `finance.enabled` kalıbında** — `ticaret.enabled` · `iplik.enabled` · `depo.multiEnabled` · `kumasTeknik.enabled` · `tezgah.enabled` (+ mevcut `production.enabled`, `finance.enabled`). Tasarımdaki `modul.*` KAVRAMSAL sınıf adıdır, koda girmez. API/Electron alanı camelCase (`ticaretEnabled`…). Dört kapı + sekizinci ayak (middleware) her anahtarda.
- **Middleware adı = `require` + PascalCase(alan)**: `requireTicaretEnabled` · `requireIplikEnabled` · `requireDepoMultiEnabled` · `requireProductionEnabled` — hepsi YENİ dosya `src/middlewares/module.middleware.ts`, `finance.middleware` kalıbı, ARGÜMANSIZ `readXEnabled()` (cache'siz), 403 + **`details.code = "MODULE_DISABLED"` + `details.modul`** (kod TOP-LEVEL değil — `error.middleware` sözleşmesi; `body.code` okuyan istemci hep `undefined` görür). Jenerik `requireModule("x")` YASAK (bekçiler adı AST/metin arar — negatif sondayla ölçüldü: jenerikleştirince router KAPISIZ sayılır). Yer tutucu `kumasTeknik`/`tezgah`: middleware YOK, panel toggle YOK (`PANEL_EXEMPT` gerekçeli) — route'suz kapı `REGIME_GATES`te ölü satır olurdu.
- **Tek kaynak `src/constants/module-flags.ts`**: `MODULE_FLAG_KEYS` (7) · `MODULE_SETTING_KEYS` (7, BİLEREK düz string — `SETTING_KEYS`ten türetmek dairesel import → CommonJS'te `undefined` Set → K7 kapısı sessizce açılırdı) · `MODULE_DEPENDENCIES` (`iplik→ticaret`, `tezgah→production`) · `MODULE_LABELS`. Anahtarlar ortak ön ek taşımadığı için P2'nin "modül anahtarını yalnız süperadmin yazar" guard'ı ad kalıbıyla DEĞİL bu kümeyle yazılacak.
- **Bağımlılık (iplik→ticaret, tezgah→production) İKİ yerde, okuyucular HAM**: ① `requireIplikEnabled` ÖNCE ticareti ölçer (403 `modul:"ticaret", dependent:"iplik"` — operatörü doğru şaltere gönderir), ② `setFeatureFlags` yazma doğrulaması (`assertModuleDependencies`, tüm yazmalardan ÖNCE, tek yüklem "bağımlı açık kalacaksa ön koşul da açık kalmalı"; 400 `MODULE_DEPENDENCY`; tek gövdede ikisini birlikte açmak/kapatmak 200). `readIplikEnabled`/`getFeatureFlags` HAM DB değerini döner (panel toggle kendi yazdığını geri okur); etkin değer Electron ctx'te TEK yerde (`useOperationsVisibility`: `iplikEnabled = ticaret && iplik`), `yarn-regime` zinciri yeniden kurmaz.
- **Route kapıları**: purchase-order · item-price · stock-count → ticaret (finance'ten TAŞINDI); goods-receipt (kapısızdı) → ticaret; yarn → iplik; warehouse-transfer (kapısızdı) → depoMulti; üretim 10 router (route · product-recipe · workorder · production-balance · tambur · kursun-qc · kursun-bypass · traveler-card · batch · station-capability). **Bilinçli KAPISIZ** (başlık yorumunda): `/api/rolls` (karma — KK1 motoru çekirdek; üretim kapalıyken `/open-fabric`, `/:id/kursun-finish`, `/production-flow`, `/subcontractor-summary` AÇIK kalır, uç-bazlı kapı sonraki paket) · stations · machines · work-sessions · subcontractor* (modul.fason Dilim 1 dışı) · kartela/swatches · ortak kataloglar/baskı · traveler-templates · reports/dashboard. `traveler-card.routes` iki router taşır: kapı `travelerCardRouter`da, `workOrderTravelerRouter` kapıyı `workorder.routes`tan MİRAS alır (iki kez takmak her istekte ayar okumasını ikiye katlar). `warehouse.service`/`warehouse.routes` defteri KAPISIZ KALIR (fabrika yolları da yazar) — "kardeş uçlar da rejimsiz" cümlesi düzeltildi.
- **Servis-katmanı iplik kapısı (adversarial bulgu):** route kapısı yetmedi — `goods-receipt.service` ve `stock-count.service` YARN kalemi için `applyYarnMovementTx` çağırıyordu ve ikisi de ticaret kapısındaydı → ticaret AÇIK + iplik KAPALI kurulumda kg defteri doluyordu. Tek-kaynak kontrol `applyYarnMovementTx`in İLK ifadesi (`readIplikEnabled(tx)` → 403 `modul:"iplik"`); çağıranlara ayrıca kontrol YOK. Köprü bayrağı da tek resolver: `resolveYarnOutOnInvoiceEnabled` = finance && ticaret && iplik && altBayrak (`readFinanceYarnOutOnInvoiceEnabled` yalnız orada geçer).
- **Ham ayar ucu açığı kapandı:** `PUT /api/admin/settings/:key` modül anahtarına 400 `MODULE_KEY_RESERVED` — `STRUCTURED_SETTING_KEYS` boolean bayrakları içermiyordu, düz `"true"` string'i `flagWriteGuard`ı (ve P2'nin süperadmin dalını) tamamen atlardı.
- **Grandfathering migration `20260902230000_modul_anahtarlari_grandfathering`** — üç ders: ① **KOŞULLU** (`WHERE EXISTS (SELECT 1 FROM "rolls")`): koşulsuz INSERT taze kurulumu da damgalar ve P6 profil job'unun "satır varsa dokunma" sözleşmesini kalıcı no-op'a çevirir (`kur.ps1` yeni kurulumda da `migrate deploy` koşar); ② **değer = DÜNKÜ DAVRANIŞ, sabit değil**: `production=true`; `ticaret`/`iplik` := `finance.enabled` satırının değeri (dün o dört yüzey finance kapısındaydı — sabit `false` yazmak finance açık + ticaret verili kurulumda (demo) dört yüzeyi sessizce 403'e düşürürdü; Adnan: satır yok → false); `depo.multiEnabled` := `count(*)>1 FROM warehouses WHERE "isActive"` (Electron `useWarehouses` türevinin SQL aynası; `isActive` süzgeci load-bearing) ve koşulu `rolls VEYA aktif depo>1`; ③ `ON CONFLICT DO NOTHING`, DÜZ `now()` (kolonlar timestamptz — `AT TIME ZONE 'UTC'` 3 saat kaydırır), `updatedAt` elle, `description` metinleri `setFeatureFlags` dallarıyla BİREBİR (bekçi karşılaştırır). `readProductionEnabled`ın `if (!setting) return true` sigortası KORUNUR — damga sonrası canlıda ölçülmez, damgasız kopyada (eski dump/dev) sadeleştiren üretimi sessizce kapatır. `finance.enabled` bugün tam bu sınıfın kurbanı: ne migration ne seed ile doğdu, satırı yalnız panel/`setup-ticaret` yazar.
- **Sıfır fark ölçüldü (K13):** fabrika damgasıyla 71 mount'a kimlikli sonda → `MODULE_DISABLED` yalnız 6 mount; 4'ü (item-price · purchase-order · stock-count · yarn) `main`'de zaten `requireFinanceEnabled` ile 403'tü → statü değişmedi; YENİ 403 yalnız goods-receipts + warehouse-transfers (dump: 0 mal kabul · 0 depo · 0 transfer · 0 alış siparişi · 0 iplik hareketi). `production.enabled=false` → 11/11 üretim ucu 403, 22 çekirdek ucun hiçbiri. Dump provası: taze restore → 229 migration → 6 satır doğru; ikinci deploy "No pending"; boş DB → 0 satır; `test_consistency` aynı 4 bilinen bölüm (§1c/§1d/§13/§20); `test_db_invariants` 156/156.
- **`depo.multiEnabled` artık ANLIK DAMGA**: fabrika ikinci depo açınca yüzeyler eskisi gibi kendiliğinden BELİRMEZ — P5'e amber bant + Depolar ekranında ikinci aktif depo kaydında uyarı notu; anahtarı kimin açacağı kullanıcı-karar kuyruğunda.

**Bekçiler (her biri negatif sondalı, sonda tabloları dosya başlıklarında):** `test_module_flags` · `test_module_flag_off` (90; tek dosya, modül tablosuyla parametrik; STATİK ayak asıl güvence, HTTP ayağı ek — sunucu yoksa/giriş kilidiyse ATLANIR ve "N kontrol ölçülmedi" bandı basar; §1h 403'teki modül kodunu AST ile ölçer) · `test_module_grandfathering` · `test_{ticaret,iplik,depo_multi,production}_regime_gate` (ortak AST tarayıcı `scripts/lib/regime-gate-scan.ts`; üretim bekçisi model türetmesi DEĞİL pozitif ad listesi — üretimin "özel modeli" yok) · `test_feature_flag_contract` §15 + "her `REGIME_GATES` middleware'i ≥1 route'ta". Toplam **1036 kontrol yeşil**; 7 kör-nokta + 28 bozulma sondası kırmızı verdi. Commit'ler `c94035cc` (backend+bekçi) · `251767ca` (Electron) · `06e23448` (LoginPage typecheck onarımı). Adversarial turun beş **kör noktası** ve kapanışı: kapı YANLIŞ bayrağı okursa (§1c gövde penceresi 1600 karakterle sonraki fonksiyona taşıyordu; HTTP turu bayrakları hep birlikte oynatıyordu) → pencere sonraki `export`a kadar + iki yönlü çağrı kontrolü + "yalnız bu modül açık" tek-tek turu · 403'teki `modul` alanı doğrulanmıyordu → §4 `details.modul` · "cache" kelimesiz gerçek önbellek konabiliyordu → AST: dosya düzeyi `let`/mutable sabit/`Date.now` YASAK · migration'ın DEĞERLERİ ölçülmüyordu (ON CONFLICT yüzünden bir kez koşmuş DB'de bekçi kendi bozulmasını göremez) → SQL metninden VALUES ayrıştırma · `details.code` bir seviye sarılınca statik ayak kör → AST ikinci argüman doğrudan `code`. Ders: **"bekçi yeşil" ≠ "kapı doğru" — bekçinin ölçtüğü şeyi bozup kırmızıyı görmeden sayma; HTTP ayağı ÇALIŞAN sürecin kodunu ölçer, kaynak bozulunca yeşil kalır.**

**Süreç dersleri:** ① paralel doğrulayıcılar AYNI portu (4100) ve AYNI test DB'sini paylaştı → sahte kırmızılar; ajan başına port + "global durum yazan bekçi eşzamanlı koşmaz" notu. ② `Teks-Erp/.env` 31 Ağu'da izlemeden çıkarılmıştı ve diskte yoktu; peer git geçmişinden kurtardı (`tekserp_demo`yu gösterir) — env vermeden koşan her yazma-bekçisi kullanıcının dev DB'sine gider; `test_module_flag_off` hedef DB adını basar ve `tekserp` (fabrika prod adı) ise `BEKCI_PROD_ONAY=1` olmadan durur. ③ Dört mevcut bekçi route kaynağında `requireFinanceEnabled` METNİNİ arıyordu — kapı taşıma ile bekçi güncellemesi AYNI commit'te gitmek zorunda (`test_stock_count` 10h/10i · `test_item_price` §7b · `test_yarn_stock` 9a/9c · `test_warehouse_movements` §6c).

**AÇIK (sonraki paketler):** P2 süperadmin (`flagWriteGuard` üçüncü dal `MODULE_FLAG_KEYS.some`) · `SettingsRegimeKey`/`regime:` kategorileri DEĞİŞMEDİ — "Depo & Muhasebe" ayar bölümü hâlâ finance rejiminde (P5) · mobilde `MODULE_DISABLED`ın kullanıcı yüzü yok (`useVisibleScreens.conditional` boş; `announceFailure` dalı sonraki paket) · `/api/rolls` uç-bazlı kapı · fason/kartela anahtarları Dilim 1 dışı · 403 gerekçe metni dört yüzeyde finance→ticaret değişti (sürüm notuna: "İplik/Alış siparişi/Fiyat/Sayım ekranlarının kapalı olma SEBEBİ artık Ticaret modülü").

### 2026-09-03 — Süperadmin P2: gizli GERÇEK satır, `["*"]` tam yetki, tek-kaynak gizleme süzgeci, kilitlenme supabı

> ⛔ **AYNI GÜN GEÇERSİZLEŞEN KISIM (2026-09-03 P8):** Bu notun HESAP DOĞUŞUNU
> anlatan her cümlesi (`.env` tohumlaması · `readSuperadminEnv` · `SUPERADMIN_USERNAME/
> PASSWORD_HASH/PIN/TOTP_SECRET` · `SUPERADMIN_FORCE_SYNC` rotasyonu · `.env.example`
> bölümü) **artık yürürlükte DEĞİLDİR** — kodun tamamı kaldırıldı. Hesabın tek doğuş ve
> rotasyon yolu sunucuda elle koşulan `npm run superadmin:kur` (`-- --rotate`); boot job'ı
> yalnız kilit defterini tazeler ve `.env`de KALMIŞ satırları silinsinler diye UYARIR
> (anahtar adı basılır, değer asla). Notun geri kalanı — gizli satır, `["*"]` bypass'ı,
> tek-kaynak süzgeç, takma adlı audit, emniyet supabı, sır hijyeni — AYNEN geçerlidir.
> TAM METİN: aşağıdaki **"Süperadmin doğuşu (P8)"** notu.

> ✅ **ÇEKİRDEK:** Satıcı hesabı, `["*"]` kod bypass'ı, tek-kaynak gizleme süzgeci (`isSystemAccount:false` + AST bekçisi), takma adlı audit, kilitlenme supabı (hesap YOKSA guard dalı devre dışı) ve **sır hijyeni** (parola/PIN/ayar şifresi repoya, log'a, audit diff'ine GİRMEZ) — kuruluma bağlı DEĞİL; her müşteride aynı. ⚠️ Kuruluma bağlı tek şey hesabın KURULMUŞ olması: hesap doğmadan kilit mutlak değildir (doğuş yolu 2026-09-03 P8'den beri `npm run superadmin:kur`; ~~`.env` tohumlaması~~ kaldırıldı) — bkz. MODUL-BAYRAK-TASARIM §7, §12 kural 7/8.

**Bağlam:** Tasarım §7 (satıcı hesabı) + §12 kural 7/8; plan P2. 5 Opus keşif boyutu planı doğruladı ve ÜÇ yeni boşluk buldu: ① mobil `usePermission.has()` global `*`'ı TANIMIYORDU (süperadmin PIN'le girer, "yetkin yok" ekranına düşerdi — plan "tablet OTA opsiyonel" demişti, YANLIŞTI; saf JS, OTA yeter, APK gerekmez) · ② backend'de üç `includes("admin:*")` kapısı (`tambur-undo` GERÇEK kapı — süperadmin "Tümden geri alma"da iş-kuralı reddi alırdı; import/demo gösterim) · ③ audit listesi süperadminin `id`sini basıyor ve `GET /admin/users/:id/credentials` o id'nin DÜZ PIN'ini kontrolsüz veriyordu — id sızıntısı → PIN sızıntısı zinciri. Gizlenecek yüzey 5 değil 12 (+2 rapor HAM SQL ile `users`a JOIN — Prisma helper'ı göremez), 8 nokta gerekçeli süzülmez. Fabrika ölçümü (2 Eyl dump'ının TAZE kopyası): 9 kullanıcı · 16241 audit satırı, **641'i `userId IS NULL` sistem olayı** — NULLABLE tuzağı gerçek (test DB'sindeki 64/1952 rakamı ajan artıklarıyla şişmişti, arşive girmez).

**Beş ürün kararı (peer/kullanıcı onaylı):** Q1 sistem hesabı DB'de YOKSA guard üçüncü dalı DEVRE DIŞI (admin:settings yeter) + audit `SUPERADMIN_ABSENT_MODULE_WRITE`; hesap doğunca kilit mutlak (emniyet supabı dersi; adnansahin `.env` kurulana dek süperadminsiz — sert kilit deploy anında fabrikayı kilitlerdi) · Q2 `SUPERADMIN_TOTP_SECRET` .env'den tohumlanır, yoksa LAN-only; **kurtarma kodu BİLİNÇLİ YOK** (cihaz kaybı iki yollu: LAN + FORCE_SYNC; az yüzey > konfor) · Q3 audit satırları takma adla GÖRÜNÜR (karar #8 tam iz), id uçları **404** (403 varlığı doğrular), username nötr (`.env.example` "bakim") · Q4 yedek/db-copy düz PIN riski kabul + ~~`SUPERADMIN_FORCE_SYNC=true`~~ rotasyon (⛔ P8: `npm run superadmin:kur -- --rotate`) (hash/PIN/TOTP aynı yaşam döngüsü, tokenVersion++; env'de TOTP yoksa TEMİZLER — "env tek gerçek") · Q5 Modüller sekmesi fabrika adminine GÖRÜNÜR ama SALT-OKUNUR + bant. Giriş kilidi süperadmini de kapsar (muafiyet = parolaya sınırsız deneme).

**Uygulama (backend ÖNCE; Electron + mobil OTA; APK YOK; izin kodu YOK; migration 1 additive):**
- `User.isSystemAccount Boolean @default(false)` (`20260903010000_user_is_system_account`; backfill YOK, index YOK). Kimlik JWT'ye GİRMEZ: `verifyToken`ın zaten yaptığı tazelik okumasına tek kolon → `req.isSystemAccount` (ek sorgu sıfır, eski token penceresi yok, guard senkron); `/auth/me` `isSystemAccount` + `systemAccountExists` döner (panel aynı kaynaktan). Sahte JWT (`isSystemAccount:true` / `permissions:["*"]` claim'i) → 403 (kimlik DB'den).
- Tam yetki: `getEffectivePermissions` İLK ifadesi `["*"]` (grant sorgusu koşmaz, `user_permissions` satırı DOĞMAZ — panel izin sayaçları sızdırmaz). Süperadmin ROL DEĞİL (şablon izinleri KOPYALAR; katalogda `code:"*"` yok → panelden atanamaz, bekçi ölçer).
- **Tek kaynak `helpers/system-account.helper.ts`**: `VISIBLE_USER` · `visibleUserWhere(extra)` (süzgeç SONDA spread — çağıran ezemez; fason helper'ının TERSİ) · `VISIBLE_ACTOR` (ilişki zorunlu) · `VISIBLE_ACTOR_OR_SYSTEM` (nullable — bugün kullanılmıyor, sözleşme olarak durur) · `ACTOR_SELECT` + `maskSystemActor` · `SQL_VISIBLE_USER` (`IS NOT TRUE` — `= false` LEFT JOIN'de 641 sistem olayını düşürürdü) · `SQL_ACTOR_USERNAME/FULLNAME` (`Prisma.raw` — `${}` bind parametresi GROUP BY'da `$1/$3` ayrışıp "must appear in GROUP BY" ile düşüyordu, ölçüldü). 12 yüzey süzüldü; 8 nokta gerekçeli muaf (login yolları, devralma/idle, username tekillik, son-admin kapıları, cihaz "son oturum" — süzgeç yalan üretir).
- **Audit takma adı satır düzeyinde**: liste/detay/arşiv satırları KALIR, aktör `{id, username:"sistem", fullName:"Sistem Bakımı"}`, `isSystemAccount` alanı yanıttan DÜŞER (ilk koşumda canlı sızıntı ölçüldü), AUTH satırlarında `recordId` (login adı) da maskelenir (D1/D2 aynı anda buldu: `"recordId":"bakim"` + `"username":"sistem"` yan yana). Aktör DROPDOWN'u süzülür. `?recordId=<ad>` filtresi ham DB'ye bakar — kabul (ad sır değil, parola/PIN sır).
- **id → PIN zinciri**: `router.use("/users/:id", verifyToken, requireAnyPermission("admin:users","admin:settings"), blockSystemAccountTarget)` ÖNEK kapısı — 18 uç (yarınki 19.su dahil) sistem hesabında **404** + `SYSTEM_ACCOUNT_ACCESS_BLOCKED` audit (method+path). ⚠️ Önek izni altındaki rotaların BİRLEŞİMİ olmalı — ilk yazım `admin:users` idi ve `/credentials` (`admin:settings`) ucunu `admin:settings`-only kullanıcıdan çalıyordu (D1 ölçtü; bekçi §M AST ile önek ⊇ alt rotalar). 404 gövdesi/zamanlaması rastgele id ile birebir (orakül yok, n=30).
- **Guard üçüncü dal EN ÖNDE ve `.some`** (belge dalı `.every` — yönler TERS; `{ticaretEnabled, backupHour}` karma gövde ilk dalda kesilir), hata `MODULE_FLAG_SUPERADMIN_ONLY` (K7'nin `MODULE_KEY_RESERVED`inden ayrı: "yanlış kişi" ≠ "yanlış uç"); senkron. **Supap** `SystemAccountRegistry`: bilinmiyor = VAR (fail-closed; boot penceresinde bypass açılmasın), job tazeler, supap dalında TEMBEL DB doğrulaması (boot sonrası/db-copy sonrası doğan hesabı restart'sız görür — yalnız o dal async). Registry ENV'den değil DB'den: `.env`den SUPERADMIN_* silinse de hesap durdukça kilit sürer (ölçüldü).
- **Job `jobs/superadmin.job.ts`** ⛔ *(bu maddenin TAMAMI 2026-09-03 P8 ile kaldırıldı — job artık hesap yaratmaz/rotasyonlamaz; tarihsel kayıt olarak duruyor)*: saf `readSuperadminEnv` (bcrypt biçimi + 6 hane PIN + base32 TOTP doğrulanır; `process.env` mutasyonu yok); üçlü yoksa SESSİZ (tek info), biri yok/bozuksa GÜRÜLTÜLÜ (`reportJobFailure` → kalıcı SystemLog + /health) ve hesap YARATILMAZ ("kimse giremeyen hesap" yerine görünür arıza); varsa DOKUNMAZ; P2002 yarışı (`users_username_key|username_lower_uq|quickPin_key`) create VE update'te; FORCE_SYNC'te ad uyuşmazlığı → ad DEĞİŞMEZ + uyarı + `usernameMismatch`. Audit yükünde hash/PIN/TOTP/username YOK (`fullName` + totp durumu). `.env.example` bölümü + `docs/ops/UZAK-ERISIM-KURULUM.md` adımı (kur.ps1 `.env`i TAŞIR, GÜNCELLEMEZ — unutulabilir adım sınıfı).
- `*` körlükleri: Electron `hasAdminAccess` → `matchesPermission` (Sistem hub'ı + komut paleti kırılıyordu); mobil `has()` ilk satır `if (set.has('*')) return true;` (OTA); `tambur-undo`/`import`/`demo` → `matchesPermission(p, X) || matchesPermission(p, "admin:*")` (mevcut `admin:*` kısayolu KORUNUR — 3 kullanıcı taşıyor, düz çevirme yetki düşürürdü). `src/`de `includes("admin:*")` metni artık HİÇ yok — bekçi koşulsuz yasaklar.
- Electron: `SettingsCategory.superadminOnly` (regime GİZLER, bu KİLİTLER); `FeatureFlagSection.canEdit = hasPermission("admin:settings") && (!superadminOnly || isSystemAccount || !systemAccountExists)` — izin ∧ kimlik çarpımı; bant metni. `/auth/me` bilinmiyor durumunda `systemAccountExists:true` (panel de kilitli — kapıyla ayrışmaz).
- `SECRET_FIELDS`e `totpSecret`, `settingsPasswordHash` (P3), `superadminPin`; başlığa "maskeleme YALNIZ `changes`e uygulanır — oldData/newData/payload HAM yazılır, çağıranın yükü temiz olmak ZORUNDA". Sır grep'i TAM bcrypt gövdesi (53 karakter) ile yapılır — job'un hata metni `$2b$10$…` biçim ipucunu kalıcı log'a yazar, ön ek araması yanlış pozitif verir.

**Sıfır fark (Adnan):** taze dump'ta `isSystemAccount` 9/9 false, sistem hesabı 0; 71 mount hesapsız/hesaplı BİREBİR (37×200 · 21×404 · 13×403; MODULE_DISABLED yine 6); supap: hesapsız kurulumda fabrika admini modül anahtarını BUGÜNKÜ gibi yazar (200 + audit izi); `admin:*` taşıyan 3 kullanıcıda `hasAdminAccess` sonucu aynı. Dump provası: 230 migration, 2. deploy "No pending", `test_consistency` aynı 4 bilinen bölüm, `test_db_invariants` 157 (yeni §10 "sistem hesabı ≤ 1"); boş DB → job env'siz `absent`/geçersiz hash `invalid` (hesap yok, gürültülü)/geçerli `created`/2. koşum `exists`/FORCE_SYNC `synced` (tokenVersion 1→2).

**Bekçiler:** `test_superadmin` (§A–§M: guard 7 anahtar × 4 senaryo döngüsü, karma gövde, senkronluk + dal sırası, supap 4 durum, `["*"]` + grant 0, katalogda `*` yok, saf env okuyucusu, sır hijyeni AST, 404 zinciri, `/auth/me`, HTTP turu, aktör maskesi, önek izin birleşimi) · `test_superadmin_hidden_single_source` (Prisma/ilişki/ham-SQL/`includes("admin:*")`/allowlist/maske AST kolları) · `test_db_invariants §10` · `test_audit_depth` isimleri · Electron `auth.test` + `FeatureFlagSection` · mobil `usePermission.test`. Adversarial tur (Opus + **Fable** güvenlik kapısı): 20+ sonda; guard sağlam (`.some→.every` 4❌ · dal sırası 1❌ · async 39❌ · registry sahte açık 29❌ · JWT claim'den okuma 1❌ · sahte JWT 403/401 · Zod'a `isSystemAccount` sızdırma DB'de false); **üç kör nokta kapandı**: aktör maskesi bekçisiz (liste/detay maskesi silinince 99/0 yeşildi) · "hesap VAR + env YOK → kilit" ölçülmüyordu · `recordId` maskesi. Ders: **"maske aktör nesnesinde" yetmez — aynı satırın başka bir alanı kimliği geri verir; maske SATIR düzeyinde ve bekçi yanıt GÖVDESİNDE gerçek adı arar.**

**Süreç dersleri:** ① `pkill -f "tsx src/server.ts"` kullanıcının :4000 dev sunucusunu düşürdü (iki ajan, iki tur) → tasarım §12-12 kalıcı kural: yalnız kendi PID'in, paralel ajanlara ayrı port; ② spec'e yazılan ölçüm rakamı hangi DB'de ölçüldüğünü söylemeli (test DB artıklarıyla şişmiş sayı arşive girmesin); ③ "Sistem Bakımı" takma adı + süperadminin KENDİ oturumunda Topbar gerçek username'i gösterir (kendi yüzeyi, fabrika yüzeyi değil — bilinçli).

**AÇIK:** P5 Sistem Profili'nde "giriş yöntemlerinde PIN kapalıysa satıcı tablete giremez" bandı; audit dropdown `dropdownCache` + istemci `staleTime` üst üste (deploy sonrası ≤5 dk gecikmeli sızıntı, kabul); P3 ayar şifresi `SECRET_FIELDS`e önden kondu.
**Commit'ler:** `bfddd846` (backend + migration + bekçiler) · `745bf3eb` (Electron + mobil) · docs commit'i. Düzeltme turundan sonra son üç bulgu ana oturumda kapatıldı: `/auth/me` de tembel doğrulama yapar (`resolveSystemAccountLock` — guard ile ORTAK yüklem; hesapsız açılan sunucuda bekçi 137/1 → 138/0), statik §7 dört okuma yolunda elle `maskSystemActor(` yasağı (V sondası X3 `findArchiveById`de iki bekçiyi kör bırakıyordu), defter TEK YÖNDE tazelenir (kaldırma reçetesi restart ister). D1'in "önek kapısı regresyon" teşhisi ÖLÇÜLEREK ÇÜRÜTÜLDÜ (`/credentials` main'de de iki izin istiyordu) — düzeltme yine yapıldı ama gerekçesi "önek alt rotadan dar olamaz" invariantı; ölçüm tablosundaki sayı DB durumuna bağlıdır, kalıcı olan "hangi kontrol kırmızı olur" cümlesidir (bekçi başlığı iki taban yazar). Dev DB `tekserp_demo` 230 migration'a çıkarıldı (damga demo senaryosunu üretti: finance açık → ticaret/iplik açık, 2 depo → çoklu depo açık; sistem hesabı yok → supap açık).

### 2026-09-03 — Ayar şifresi P3: ikinci kapı BAŞLIKTA, hash `set()` dışında, kilit kovası girişten AYRI, kapsam "ayar yazan HER route"

**Bağlam:** Tasarım §7.2 ("davranış bayrağı ekranı her değişiklikte ikinci şifre sorar — açık kalmış admin oturumu"); gece kararları P3-1…P3-6 (`GECE-KARARLARI-2026-09-03.md`). Spec Fable, kod Opus, güvenlik doğrulaması Fable.

**Ne yapıldı (migration/izin/APK YOK; Adnan sıfır fark — hash satırı yokken hiçbir istek şifre istemez):**
- Hash `SystemSetting["security.settingsPasswordHash"]` (bcrypt 10) ama `systemSettingService.set()` ÜZERİNDEN DEĞİL — doğrudan upsert + ayrı audit (`SETTINGS_PASSWORD_SET/ROTATED/REVOKED {by}`); `security.*` ön eki `GET /admin/settings` listesinden ve `config-bundle`dan dışlanır (ön ek bazlı — yarınki ikinci sır da korunur); `PUT /admin/settings/:key` reserved anahtarı 400 (`constants/reserved-settings.ts` — module-flags gibi düz string, dairesel import → `undefined` Set tuzağı). `settingsPasswordRequired` `FeatureFlags` İÇİNE KONMADI (30 sn önbellek + dört kapıdan yazılabilir olurdu) — `GET /feature-flags` ve `/auth/me` yanıtına eklendi.
- Şifre YALNIZ `X-Settings-Password` başlığında (gövde strictObject; gövde alanı audit `changes`ine sızar; query erişim loguna düşer — ölçüldü). `requireSettingsPassword` (adlandırılmış, ASYNC, `flagWriteGuard`'dan SONRA — senkron guard sözleşmesi bozulmaz): ① süperadmin muaf ② belge-only gövde muaf (`document-template:write` büro personeli) ③ hash yok → uyur ④ kilit `bcrypt.compare`'den ÖNCE → 429 `SETTINGS_PASSWORD_LOCKED` ⑤ başlık yok → 403 `REQUIRED` (audit YOK) ⑥ yanlış → 403 `INVALID` + audit ⑦ doğru → audit `USED {userId, keys, path}`. Yönetim ucu `PUT/DELETE /admin/settings-password` yalnız süperadmin, aksi **404** (`requireSystemAccountOr404`, verifyToken'dan SONRA — kimliksiz 401).
- ⚠️ **Spec'imdeki gerçek hata ölçülerek düzeltildi:** "kilit kimliği `sp:<userId>`" reçetesi `resolveLoginLockoutKeys`in VARSAYILAN kapsamında (`LOGIN_LOCKOUT_SCOPE` yok → `ip`) kimliği DÜŞÜRÜYOR ve ayar şifresi denemeleri o IP'nin GİRİŞ kovasına yazılıyordu: 5 yanlış ayar şifresi → aynı IP'den `POST /auth/login` 429 (bir yönetici herkesi dışarıda bırakırdı). Ayrım artık anahtarın KENDİSİNDE (`resolveSettingsLockoutKeys` → her kovanın key'ine `sp:` ön eki); iki rejimde de ayrı kovalar (ölçüldü: ayar 429 iken login 200).
- **D2 (Fable) bulguları — düzeltme turunda kapatıldı:** ① `PATCH /admin/backups/offsite` + `POST /backups/offsite/authorize` ayar yazıyordu ama kapıda değildi (açık oturum yedek hedefini şifresiz değiştirebilirdi — tam pg_dump saldırgan rclone'a giderdi) → kapı + bekçi tripwire: `src/routes/**`te `systemSettingService.set(`/`setFeatureFlags(` çağıran HER route zincirinde `requireSettingsPassword` (iki yönlü muaf); "üç yüzey" sayısı elle sayılmaz. ② Şifre yalnız uzunluk denetleniyordu; Türkçe karakter/boşluk HTTP başlığında taşınamaz (fetch ByteString TypeError, curl UTF-8 → INVALID, OWS kırpması) → fabrika rotasyona kadar ÜÇ yüzeyden kilitli kalırdı → `^[\x21-\x7E]+$` + 8–**72** (bcrypt 72 bayt sessiz kırpma: 100 karakterlik şifrenin son 28'i sayılmıyordu). ③ Bekçi query-string fallback'ine KÖRDÜ ve USED audit'i `req.originalUrl` (query dahil) yazıyordu → `req.path` + §C davranış kontrolleri (gövde/query/cookie/benzer başlık → 403). ④ Kilitliyken her 429 bir LOCKED audit satırı (60 istek → +60; login kilidi yazmıyordu) → `justLocked` (kilit anında tek satır) — login yolu da hizalandı. ⑤ 429'da `Retry-After` başlığı yoktu → error middleware tek noktadan. ⑥ (P2 eki) oturum jti'si kullanıcıya bağlı değildi — JWT_SECRET bilinirse başka oturumun jti'siyle süperadmin kimliği üretilebiliyordu → `session.userId !== payload.userId` → 401.
- Electron: `withSettingsPassword` sarmalayıcısı (istek önce şifresiz gider; 403 REQUIRED/INVALID → `SettingsPasswordDialog` (App'te bir kez mount) → başlıkla tekrar; iptal → hata; LOCKED → kalan süre); `featureFlagService.update`/`setDocumentsLogo`/admin settings/backup offsite hepsi sarmalayıcıdan; Kaydet yanında kilit ikonu; süperadmin "Ayar şifresi" kartı (Tanımla/Değiştir/Kaldır; ASCII+72 anlık uyarı). Her kayıtta sorulur, oturumda hatırlanmaz.
- `test_document_template_permission` harness'ı `requireSettingsPassword` halkasını ADIYLA atlar (yetki değil NİYET kapısı; asenkron) — kapının kendi bekçisi ayrı.

**Bekçiler:** `test_settings_password` (§A–§L; HTTP ayağı sunucusuz "N kontrol ölçülmedi" bandı) + D2/düzeltme sondaları; adversarial ölçümler: zamanlama orakülü YOK (yanlış 8/72/128 kr ve doğru-ön-ekli hepsi ~59.6 ms, n=30), sahte JWT claim'leri yok sayılır, kilit XFF/CF-Connecting-IP/X-Real-IP uydurmayla atlatılamaz, `system_logs`+arşiv+erişim logu+yanıt gövdeleri+config-bundle'da şifre/hash 0.

**Ders:** "kilit anahtarı = `sp:<userId>`" gibi bir reçete, kilit yardımcısının KAPSAM rejimini bilmeden yazılırsa iki kapı aynı kovaya düşer — anahtar ayrımı kimlikte değil KEY'de yaşamalı. Sır taşıyan başlık için karakter kümesi ŞEMADA sınırlanmalı (RFC 7230 field-value); "her yerde Unicode serbest" refleksi burada kilitlenme üretir. "Üç yazma yüzeyi" gibi elle sayılmış listeler tripwire olmadan bir sonraki yüzeyde delinir.

**Düzeltme turu (aynı gün, D2 + V bulguları):** offsite kapısı + **AST tripwire** (kapsam elle sayılmaz: `src/routes/**` — ÖZYİNELİ, alt dizin zemini; dolaylı yazıcılar ayrı karar kaydı) · şifre `^[\x21-\x7E]+$` + 8–**72** (bcrypt 72 BAYT; `.trim()` yerine RED; servis katmanında ikinci hat) + backend↔Electron **ayna bekçisi** · USED audit yolu **`${req.baseUrl}${req.path}`** — salt `req.path` mount'a görelidir ve `PATCH /api/feature-flags` için `"/"` üretir (sızıntıyı kapatırken denetimin "hangi uçta" cevabı kaybolmuştu; harness artık Express mount'unu modelliyor) · LOCKED audit kilit **başına tek satır** (`justLocked`; login yolu da hizalandı, `LOGIN_LOCKED` artık yazılıyor) · `Retry-After` tek noktadan · oturum **jti ↔ userId** bağı (401 `SESSION_INVALID`, aynı kod/mesaj — orakül yok). Commit: `9f33d0e3` (WIP) + `f948780f` (düzeltme). Bekçi tabanı 134/0/13 (sunucusuz), 140/0 (HTTP'li).

**Ek dersler:** ① "üç yazma yüzeyi" gibi ELLE sayılmış kapsam listeleri bir sonraki yüzeyde delinir — kapsamın yüklemi ekran değil YAZMA'dır ve tripwire ile ölçülür; ② sızıntı kapatan düzeltme kimliği de götürebilir (`originalUrl` → `path` query'yi kesti ama yolu da sildi) — bekçi "ne YAZILMAMALI" kadar "ne YAZILMALI"yı da ölçmeli; ③ iki taraflı sabit (backend↔panel) ayna bekçisi olmadan sessizce ayrışır; ④ bekçi harness'ı çerçevenin semantiğini (Express mount göreliliği) modellemezse gerçek regresyonu göremez.

### 2026-09-03 — Kalite = istasyon YETENEĞİ (P4 Faz A): boğaz TEK DEĞİL İKİZ

**Bağlam:** Tasarım §5.1 + karar #11. "Bu adım kalite kontrol yürütür mü" sorusuna eskiden `step.station.kind === StationKind.PROCESS_QC` diye cevap veriliyordu ve literal 19 karar noktasına ELLE kopyalanmıştı — yani kalite bir YETENEK değil bir TÜR ADIydı: ikinci bir KK istasyonu tanımlamak imkânsızdı, bir kopyanın atlanması sessiz davranış farkı üretirdi.

**Ne yapıldı (davranış BİREBİR; fabrika dump'ında 23 uçta 0 statü kodu farkı, migration UPDATE 1 satır):**
- `Station.appliesQuality` kolonu + backfill (`WHERE kind='PROCESS_QC'`). Yeni tek kaynak `services/helpers/quality-station.helper.ts`.
- ⚠️ **BOĞAZ İKİZ:** saf yüklem `stepCanApplyQuality(station)` (bellek içi 11 nokta) + Prisma where parçası `QUALITY_STATION_WHERE` (13 nokta). Saf yüklem where'e GİREMEZ — sorgu DB'de koşuyor; özellikle `setQueueUrgent`in F167 atomik claim'ini "önce oku, sonra yüklemle kontrol et, sonra update" biçimine çevirmek check-then-act yarışını geri getirirdi. İkisi AYNI kuralı söyler ve BİRLİKTE değişir.
- **Faz A köprüsü:** yüklem `kind === PROCESS_QC || appliesQuality` okur — backfill'e GÜVENMEZ. Seed migration'dan SONRA boş tabloda koşar (2026-08-10 `appliesColor` tuzağının birebir tekrarı olurdu), o yüzden seed'e de açıkça `appliesQuality: true` yazıldı; dal onun İKİNCİ sigortası. Faz B'de dal düşmeden önce seed + prod ölçümü yapılır.
- `assertRollInStep(_, _, expectedKind)` → `assertRollInQualityStep` (argüman düştü); `hasBypassClosureOnProcessQcTx` → `hasBypassClosureOnQualityStepTx` (ad ↔ yüklem ayrışmasın). Kurşun bypass'ta makine LİSTESİ ile atama KABULÜ artık aynı ikizden besleniyor — ayrışsalardı listede görünen makine seçilince 400 alınır, dağıtımcı sebebi anlayamazdı.
- ⚠️ `assertWoAtStepKind(PROCESS_QC)` (kursun-qc) **DOKUNULMADI**: `roll-step.helper` TAMBUR ile PAYLAŞILIYOR, imzasını yetenekleştirmek Tambur kart-okutma yolunu da değiştirirdi. Bekçide gerekçeli muaf, Faz B'ye bırakıldı.
- `QUALITY_STATION_WHERE` `as const` DEĞİL `satisfies` ile yazılır (readonly literal `OR:` konumunda Prisma'nın mutable input tipine oturmaz — `fason-open-dispatch.helper` dersi); spread ile kullanılır ve aynı kapsamda ikinci bir `OR:` YAZILMAZ (biri sessizce kaybolur).
- Panel: "Kalite kontrol uygular" kutusu HER istasyon türünde görünür (gizli kural icat edilmez; yüklem KK1'de zaten etkisiz). ÖNCE `buildStationPayload` drift'i onarıldı — mevcut renk/özellik kutuları payload'a hiç girmiyordu, yani ÖLÜYDÜ.
- "KK1 WO adımı olamaz" kuralı **istemci sözleşmesi** olarak kaldı: backend `allowAsWorkOrderStep`ı HİÇ okumuyor (ölçüldü: 0 okuyucu), guard eklemek davranış değişikliği olurdu.

**Bekçi `test_station_quality_capability` (22):** ikizin CANLI eşdeğerliği dört köşe fixture'ıyla (where sonucu ≡ yüklem sonucu), koddaki `PROCESS_QC` literalleri SAYIM bazlı muafla, `STEP_QUALITY_SELECT` kullanımına TABAN SAYIM. Beş negatif sonda kırmızı verdi.

**Ders (bekçinin kendi kör noktası):** ilk yazımda İKİ kontrol de DOSYA bazlıydı ve sondalar bunu ölçtü — ① muaf dosya bazında olunca o dosyaya eklenen YENİ tür kontrolü sessizce kapsanıyordu; ② "dosyada `STEP_QUALITY_SELECT` geçiyor mu" kontrolü aynı dosyadaki İKİNCİ select'in alanı atlamasını gizliyordu. İkisi de sayım bazlıya çevrildi. Ayrıca "kind seçen her select yüklem içindir" varsayımı ölçümle çürüdü: `currentStepKind` gibi GÖRÜNTÜLEME select'leri de `kind` okur.

### 2026-09-03 — Tamlık bekçisi + kurulum profilleri (P6): profil dosyası pakete HİÇ GİRMİYORDU

**Bağlam:** Tasarım §3 ("her ekran bir modüle ya da çekirdek bloğa eşlenmek ZORUNDA") + §10 profiller.

- `ScreenEntry.modul` **ZORUNLU** alan; 93 ekranın (78 masaüstü + 15 tablet) tamamı eşlendi. Değer kümesi üçlü: `ModulKey` (7 anahtar, bekçi `MODULE_FLAG_KEYS` ile birebirler) · `cekirdek:*` (5 blok, ön ek ZORUNLU ki bir yazım hatasıyla modül adı karışmasın) · `planlanan:fason|kartela` (tasarımda var, kod anahtarı yok → hiza aranmaz ama ölü de sayılmaz). Alan **AİDİYET beyanıdır, GÖRÜNÜRLÜK kuralı değil** — gizleme `visibleWhen`in işi.
- ⚠️ Plandaki `MODULESIZ_EKRANLAR` muafı YAZILMADI: alan zorunlu olunca o liste doğduğu gün ölü olurdu ve "ölü muaf kırmızı" kuralı kendi listesine takılırdı. Muaflar KARO/KAPI eksenine taşındı.
- ⚠️ **Profiller TS sabiti** (`constants/module-profiles.ts`), plandaki `deploy/profiller/*.json` REDDEDİLDİ: `deploy/paketle.ps1` kopya listesi `deploy/`yi pakete HİÇ almıyor (ölçüldü) → job üretimde dosyayı bulamaz ve sessiz no-op'a düşerdi; taze müşteri kurulumu profilsiz doğar, kimse fark etmezdi.
- **Davranış bayrakları profile GİRMEZ:** `prisma/seed.ts` 27 davranış bayrağını `upsert.update` ile EZEREK yazıyor; profil de yazsaydı aynı anahtarın iki yazarı olur ve kazananı koşum sırası belirlerdi.
- Job: `TEKSERP_PROFIL` env'i YOKSA **hiçbir şey yazmaz** (varsayılan profil yazmak, operatör env'i doldurmadan sunucuyu bir kez açtığında yanlış profili KALICI damgalardı — "satır varsa dokunma" ile birleşince geri dönüşü olmazdı). Eksikler tek `createMany skipDuplicates` ifadesiyle (yarış güvenli). Bağımlılık doğrulaması SAF yüklemle: `assertModuleDependencies` private ve DB okuyor, `setFeatureFlags` de `userId` istiyor — job ikisini de çağıramaz, o yüzden üç koruma (bağımlılık · audit · K7 reddi) job'da YENİDEN kuruldu.
- `GET /api/admin/module-profile` salt okuma; fark SUNUCUDA hesaplanır (profil kaynağı istemciye sızmaz). YAZMA UCU YOK — profil uygulama mevcut `PATCH /feature-flags` kapısından geçer, yoksa süperadmin guard'ı + ayar şifresi zinciri ikinci kez kurulurdu (§12.5 kapı çoğaltma yasağı).

### 2026-09-03 — Panel modül kapıları + Sistem Profili (P5): kilit GİZLEME DEĞİLDİR

**Bağlam:** Tasarım §3.3 · §3.5 · §7.3.

- **İki CANLI ayrışma** kapandı (fabrikada görünmüyordu, ilk ticaret müşterisinde patlardı): Mal Kabul karosu çiziliyordu ama uç `requireTicaretEnabled` 403 veriyordu; Kalem Fiyatları karosu `financeEnabled` okuyordu ama uç ticaret kapısındaydı (yön TERS).
- ⚠️ **Ayar kategorilerinde modül = KİLİT, `regime` (gizleme) DEĞİL.** `regime`i modül anahtarlarına açmak §14'ün yasakladığı yol: ölçüldü, üretim/ticaret kategorilerine `regime` konsaydı dört+ okuyucu çekirdek route'lardan hâlâ ulaşılabilir olduğu için bekçi kırmızı verirdi. Yeni `moduleKey` alanı `superadminOnly` deseninin ikizi (o da KİLİTLER). `warehouse` kategorisi ikiye bölündü (ticaret / iplik) çünkü tek kategori iki modül taşıyordu.
- ⚠️ **Kilit İSTEMCİ-TARAFLIDIR:** bant "bu ayarlar dondu" der ama API hâlâ yazar (canlı ölçüldü). Tasarım §3.6 tek resolver bu pakette UYGULANMADI ve bant "etkisiz" DEMİYOR — sözün karşılığı yoksa yazılmaz. §3.6 Dilim 2'de.
- `finance` kategorisinin mevcut GİZLEME davranışı KORUNDU (Adnan'da finance kapalı → kategori bugün gizli; kilide çevirmek görünür fark olurdu). Tasarım §3.5 ile bu tutarsızlık sabah kararına bırakıldı.
- **Süperadmin kapısı TEK KAYNAK** `lib/superadmin-gate.ts` — dört tüketici de ithal ediyor. Üç kopya ayrışsaydı `!systemAccountExists` supabı birinde unutulur ve süperadminsiz kurulumda ekran hiç açılmaz, modüller bir daha yapılandırılamazdı.
- **Palet sızıntıları:** karo döngüsünün DIŞINDA kalan girdiler (`ops:work-order-new`, `def:station-capabilities`) üretim kapalıyken palette kalıyordu — form açılır, her istek 403. İkincisinin karosu hiç yok, yani palet ona giden TEK keşif yolu ve kapıyı ELLE taşımak zorunda. Karo hizası bekçisi bu yolu ölçemez (karo↔manifesto ekseninde çalışır).
- **"Kapatırsan gizlenir" önizlemesi MASAÜSTÜ ile TABLETİ AYRI sayar:** eskisi `app === "desktop"` süzüyordu ve üretim için "gizlenen ekranlar (9)" yazıp beş TABLET ekranını (KK1 · Kurşun · Tambur · Hızlı İş Emri · Kurşun Dağıtım) hiç anmıyordu — oysa hepsi `requireProductionEnabled` arkasında. Satıcı, üretimi kapatınca tabletin DURACAĞINI bu ekrandan öğrenemiyordu. Kapatma kararının bedeli farklı olduğu için sayılar ayrı tutulur.
- Manifesto okunamazsa liste HİÇ çizilmez (boş liste "hiçbir şey gizlenmeyecek" YALANI basardı).


### 2026-09-03 — Süperadmin doğuşu (P8): `.env` yolu kaldırıldı; script gerçek TTY olmadan SESSİZCE donuyordu

**Bağlam:** Tasarım §7.1 · P2 (satıcı hesabı) kapanışı. Kullanıcı kararı (peer üzerinden): "`.env` yolu KALDIRILIYOR — tek doğuş yolu script; iki yol daha fazla yüzey demek."

**Karar ve gerekçesi.** Satıcı hesabının tek doğuş ve rotasyon yolu artık sunucuda elle koşulan `npm run superadmin:kur` (`-- --rotate`). `.env` yolunda parola hash'i, PIN ve TOTP sırrı **diskte kalıcı** duruyordu: yedeğe giriyor, `kur.ps1` onu bir sonraki kuruluma taşıyor, ekran paylaşımında görünüyor ve üstelik "FORCE_SYNC satırını sonra kaldırın" gibi unutulabilir bir adım gerektiriyordu. Script'te sır yalnız süreç belleğinde yaşar ve terminale **bir kez** basılır. Kaldırma **sıfır fark**: sahadaki kurulumda `SUPERADMIN_*` satırları zaten yoktu (boot log'u "tanımlı değil" basıyordu).

- **Katmanlar AYRI, çünkü bekçi TTY sondası yazamaz:** saf `provisionSuperadmin(input, deps)` hiçbir şey **yazdırmaz** (bekçi onu doğrudan çağırır ve stdout'un boş olduğunu ölçer — bir `console.log` sızsaydı sır ekrana iki kez basılırdı); sırlar yalnız **dönüş değerinde** yaşar, dosyaya/log'a/audit yüküne geçmez.
- **İDEMPOTENT** (hesap varsa dokunmaz, çıkış 0): yoksa "bir daha çalıştırayım" refleksi satıcının elindeki parolayı öldürürdü. **MEVCUT KULLANICI YÜKSELTİLMEZ**: audit maskesi **satır düzeyindedir**, yükseltme fabrikanın kendi geçmişini bir anda "Sistem Bakımı" adına geçirirdi. Ad kontrolü büyük/küçük harf **duyarsız** — DB'de şema-dışı `users_username_lower_uq` var, düz eşitlik "BAKIM"ı geçirir ve INSERT ham P2002 ile düşerdi.
- **Boot job'ı artık hesap YARATMAZ.** Kalan iki işi: ① kilit defterini (`SystemAccountRegistry`) tazelemek — silinirse supap her boot'ta açık kalır ve **hiçbir test kırılmaz**; ② yaşam döngüsü audit'i. ⚠️ Audit çağrısı bilerek `src/` altında: `test_audit_labels` §3 yalnız `src/` ağacını tarayıp `logEvent({ action: "LİTERAL" })` literallerini toplar; çağrı `scripts/` altında kalsaydı iki olay da bekçinin **kör noktasında** doğar ve audit ekranında ham İngilizce basardı.

**C1 (MAJOR) — script gerçek TTY olmadan SESSİZCE sonsuza kadar kilitleniyordu.** `readline` TTY olmayan girdide ilk `question()`dan sonra stream'i tüketip `end`e düşüyor; sonraki soru **hiç cevaplanmıyor**, hata yok, zaman aşımı yok, süreç ve Prisma havuzu açık kalıyor. Ölçüm: boru üzerinden 120 sn donma, DB'ye tek satır yazılmadı, süreç ölmedi. Isırdığı yerler: `ssh sunucu 'npm run superadmin:kur'` (`-t` yok), `docker exec` (`-it` yok), pm2, CI. Hesabın **tek** doğuş yolu bu script olduğu için kurulum sessizce hesapsız kalıyor ve kimse fark etmiyordu.

- Düzeltme: `interaktif()`in ilk işi **fail-loud TTY kapısı** — çözümü de söyleyen hata (`ssh -t` / `docker exec -it` / sunucu konsolu), çıkış kodu 1. **`--help` kapının önünde**: yardım metni boruya basılabilmeli ve hiçbir soru sormadığı için donma riski taşımaz.
- Kapı, parola maskesini de **anlamlı kılan** şeydir: `sorGizli` artık maskeyi koşulsuz uygular ve readline `terminal: true` ile kurulur. Kaldırılan yanıltıcı yorum ("TTY yoksa maskelemenin anlamı yok — gizlenecek ekran yok") tam da desteklenmeyen yolu **destekleniyormuş gibi** anlatıyordu.
- Reçete uyarısı `KURULUM.md` A3b + `UZAK-ERISIM-KURULUM.md` §5'e girdi (`-t` unutulursa artık gürültülü hata; kurulum betiği/pm2/CI içinden çağırmayın).
- Bekçi `test_superadmin_provision` §7: çocuk süreç boru stdin'le koşulur, çıkış **25 sn zaman aşımıyla** beklenir. ⚠️ Sonda bilerek zaman aşımlıdır — asıl risk donmadır, hata değil; kapı düşerse bekçi de donsaydı kırmızı yerine **asılı bir koşum** olurdu. Ayrıca `--help`in boruda çalıştığı ölçülür (kapının yeri).

**C2 — `.env`de kalan `SUPERADMIN_*` satırları ölü ama CANLI SIR.** P2 yolunu kullanmış bir kurulumda o satırlar hâlâ çalışan bir parola hash'i, PIN ve TOTP sırrı taşır; sessizce yok saymak kurulumcuya **sırrın da kalktığını** düşündürürdü — kalkmadı, yalnız etkisizleşti. Boot'ta tek dallı uyarı basılır ve **yalnız anahtar adı**; değer asla (pm2 log'u fabrika sunucusunda okunabilir).
- ⚠️ Uygulama kısıtı: job dosyası **tam anahtar adı literali taşıyamaz** ve değeri alan adıyla okuyamaz — `test_superadmin_provision` §6 tam bu iki deseni arayarak `.env` yolunun geri gelmediğini ölçer. Bu yüzden tarama `Object.keys(process.env)` + ön ek ile yapılır. (İlk yazımda gerekçe yorumunun **kendisi** yasak literalleri içeriyordu ve bekçiyi kırdı — yorum da taranan metindir.)
- Bekçi §8: sentinel değerli gerçek bir ortam değişkeniyle uyarı üretilir; anahtar adının basıldığı **ve** değerin basılmadığı ölçülür. Körlük zemini: ortam temizken uyarı **yok** (her boot'ta bağıran uyarı görmezden gelinir hale gelir).

**C3 — bayat belge atıfları (ölü mekanizmayı yürürlükte anlatan beş yüzey).** Kök `CLAUDE.md` P2 satırı (`.env` tohumlaması + `FORCE_SYNC` rotasyonu) · tasarım §7.1 (kurtarma yollarından biri `SUPERADMIN_FORCE_SYNC` idi) · `DOKUMAN-MERCEK-RAPORU-2026-09-03.md` B18 — kaldırılan `.env` bloğunu `KURULUM.md`'ye **eklemeyi reçete ediyordu**, uygulansa sır yüzeyi geri gelirdi (artık "⛔ ÜSTÜ ÇİZİLDİ" şerhli, özet listesindeki 3. madde de) · `test_db_invariants` "sistem hesabı ≤ 1" kırmızı mesajı ölü mekanizmayı adres gösteriyordu · `test_superadmin_hidden_single_source` §1/§6 gerekçeleri ("hesabı YARATAN job", "TEK YAZAR boot job"). Aynı sınıftan dört kod yorumu da düzeltildi (`server.ts`, `system-account.registry.ts`, `feature-flag.routes.ts`, `test_superadmin.ts`).
- ⚠️ §6'nın anlamı değişti ve bu **yazıya geçti**: `isSystemAccount` yazan tek yer artık `src/` ağacında **değil** (`scripts/superadmin-olustur.ts`); dolayısıyla allowlist'in tamamı bugün **okuyucudur** ve `src/` altında yeni bir yazıcı belirirse o, P8'in kapattığı ikinci doğuş yolunun geri gelmesi demektir.

**C4** — `USERNAME_TAKEN` hata metni örnek olarak varsayılanla **aynı** adı (`bakim`) veriyordu: "bakim dolu → bakim seçin" döngüsü. Örnek `satici` / `bakim2` oldu.

### 2026-09-03 — Dilim 2 davranış bayrakları: varsayılan = BUGÜN, ve "çıkışsız kapı" bir tasarım hatasıdır

**Bağlam:** Tasarım §9 (eksik bayraklar) + karar #1/#10. Beş bayrak: `shipping.orderRequirement` (off|warn|block) · `shipping.weighRequiredEnabled` · `shipping.manualWeightRestrictedEnabled` · `shipping.invoiceMode` (dis|ic|ikisi) · `quality.gradeRequiredEnabled` · `batch.autoCreateEnabled`. Migration YOK (`Invoice.externalNo` şemada vardı). Sıfır fark temiz fabrika kopyasında kanıtlandı: aynı 4 bilinen `test_consistency` kırmızısı, yeni bayrak satırı 0.

**ÜÇ ÇIKIŞSIZ KAPI ÖLÇÜLDÜ ve üçü de tasarımı DEĞİŞTİRDİ:**
- `block` bugün açılsa fabrikada HİÇ sevkiyat kurulamazdı: tablet Paketleme ekranı `orderIds` göndermiyor. → Bayrak yazıldı, AÇILMADI; önkoşul PANEL METNİNDE ("tabletlerde sipariş seçici bulunan APK kurulu olmalı") ve bekçi o cümleyi METİNDEN ölçüyor (ölü şerh koruması).
- `manualWeightRestricted` eski istemcileri toplu 403'e düşürürdü (`source` opsiyonel ve MANUAL varsayılıyor). → Aynı muamele: yaz, açma, önkoşulu panele yaz.
- `batch.requiredEnabled` adı REDDEDİLDİ → **`batch.autoCreateEnabled`**. Sistemde parti YARATAN uç yok (`batch.routes` yalnız move/merge/split), yani "zorunlu" operatörü çıkışsız bırakırdı. **Ad yaptığı işi söylemeli:** 0 açık parti varsa sunucu partiyi kendisi açar.

**`warn` REJİMİ ÖNCE ONARILDI — "varsayılan = bugünkü davranış" cümlesi yalan olabilir.** Ölçüm üç boşluk buldu: Hızlı Sevk hiç uyarı üretmiyordu · Electron ve mobil yanıttaki `warnings`i hiç göstermiyordu · panelin `orderless` kutusu ÖLÜYDÜ (state vardı, gövdeye gitmiyordu). Yani bayrağı "bugünkü davranışla" eşitlemek, uygulamada "uyarının çoğu görünmüyor" demekti. Uyarı metni artık ORTAK yardımcıda — iki sevk yolu ayrışamaz. ⚠️ Bunun bedeli iki GÖVDE farkı: Hızlı Sevk artık `warnings` döndürüyor ve tartı hatası makine-okunur kod taşıyor. Statü kodları 20/20 birebir; eski istemciler kırılmıyor (ölçüldü: iki istemci de kendi uyarı cümlesini kendisi üretiyor, sunucunun metnine string bağı YOK) → deploy sırası serbest.

**⚠️ FASON DOĞRUDAN SEVK: aynı muhakeme bir bayrakta yapılıp ikizinde atlanmıştı.** Doğrulama canlı ölçtü: `block` açıkken `POST /subcontractor/dispatches/:id/direct-ship` tahsis göndermeden 200 döndü ve 110 m mal, müşteriye, SIFIR sipariş bağıyla bina dışına çıktı. `subcontractor.service`te rejim yüklemi hiç geçmiyordu. Bu İLAN EDİLMİŞ bir boşluk DEĞİLDİ: helper başlığı kabul edilen tek boşluğu (`dispatchShipment`e kapı konmaz) tek tek yazıyor ama fasondan söz etmiyordu — üstelik AYNI PAKETTEKİ `invoiceMode` doğrudan sevki BİLEREK kapsıyor ve panel metni bunu söylüyordu. Kapı takıldı (`orderless` kaçış alanıyla — yoksa fasonun son-durak akışı kilitlenirdi), Electron modalı hizalandı, bekçi §2.12 dört kontrolle çiviledi ve negatif sonda kırmızı verdi. **Ders: bir kapıyı bir yola takarken "bu malın çıktığı BAŞKA yol var mı" sorusu, kardeş bayrağın kapsam listesine bakılarak sorulur.**

**`quality.gradeRequiredEnabled` DAR kapsam** (KK1 · Tambur kalan-kuyruk · depo kesimi · WO kapanışının yalnız satılabilir dalları). Kapsam DIŞI dört yüzey bekçide NEGATİF sonda ile çivili: fason kabulü gradesiz top doğurmaya DEVAM eder (bilinçli null), son-adım finalize etkilenmez, `cutOpenFabric` etkilenmez, `attachRolls` hâlâ parti doğurur. Kapsam genişlemesi burada "sıfır fark" ihlalidir ve bayrak KAPALIYKEN değil AÇILDIĞI GÜN patlar.

**§3.6 tek resolver — yalnız ebeveyni OLAN bayraklara.** Ticaret/üretim altındaki 7 bayrak `resolveXEnabled` (modülAçık && altBayrak) ile okunur. Çekirdek bayraklar (kk1.* stok-giriş motoru, sevkiyat, ana veri) resolver ALMAZ: motor çekirdek, sunum modülde (karar #2). Sevkiyat bayrakları EBEVEYNSİZ — mekanik uygulayan biri `resolveX(modulAcik && …)` yazarsa ölü bir sabit doğar.

**BEKÇİNİN ÜÇÜNCÜ AYAĞI (`aEnum`):** `test_feature_flag_contract` bugüne kadar yalnız boolean (`aBool`) ve sayısal (`aNum`) anahtarları ölçüyordu; enum/metin anahtarlar HİÇBİR kontrolden geçmiyordu. Mevcut `sameTypeSessionPolicy` ne bir kümede ne bir muaftaydı — dört kapıdan biri düşse (ör. Zod satırı) her kontrol yeşil kalırdı. §16 on iki kontrol getirdi (dört kapı · şemanın KAPALI KÜME olduğu · panel `enumKey` ayağı · panel varsayılanı ↔ backend okuyucu · **çöp-değer kod sigortası**: DB'ye elle yazılmış geçersiz değer sahayı kilitlemez) ve boşluğu RETROAKTİF kapattı; 11 sondanın 11'i kırmızı verdi.

### 2026-09-03 — Süperadmin doğuşu P8: iki yol iki sır yüzeyi; sessiz kilitlenme kabul edilemez

**Karar (kullanıcı):** `.env` tohumlama yolu KALDIRILDI, tek doğuş yolu sunucuda elle koşulan `npm run superadmin:kur`. Gerekçe: ikinci yol ikinci sır yüzeyidir ve `.env` satırları yedeğe, `kur.ps1`in taşıdığı dosyaya, ekran paylaşımına giriyordu. Adnan sıfır fark — fabrikada `SUPERADMIN_*` zaten tanımsız (ölçüldü), script koşulmadıkça hesap doğmaz, emniyet supabı açık kalır.

- İnteraktif: kullanıcı adı · parola (iki kez, ekrana BASILMAZ) · PIN (boş → üretilir, BİR KEZ) · TOTP (üretilir, otpauth URI + terminal QR, BİR KEZ). Ham sırlar hiçbir dosyaya/log'a/audit yüküne girmez; çekirdek `provisionSuperadmin(input, deps)` SESSİZDİR (yazdırma interaktif katmanın işi) ve bekçi bunu stdout yakalayarak 0 bayt diye ölçer.
- ⚠️ **FAIL-LOUD TTY KAPISI — doğrulamanın bulduğu MAJOR.** Script gerçek TTY olmadan (`ssh` `-t`siz, `docker exec` `-it`siz, pm2/CI) ilk sorudan SONRA SESSİZCE SONSUZA KADAR DONUYORDU: hata yok, zaman aşımı yok, süreç ve Prisma havuzu açık. Sebep `readline` `terminal:false` modunda boruyu tek chunk alıp yalnız ilk satırı teslim ediyor. Hesabın TEK doğuş yolu bu script olduğu için kurulum sessizce tamamlanmamış kalır ve operatör "komutu koştum" der; boot logu "hesap yok" demeye devam eder. Artık ilk ifade `process.stdin.isTTY` kapısı + reçetelerde `ssh -t` uyarısı.
- İDEMPOTENT (hesap varsa dokunmaz) · `--rotate` (parola/PIN/TOTP + `tokenVersion++`, kullanıcı adı DEĞİŞMEZ — ad giriş kimliğidir) · **mevcut kullanıcı YÜKSELTİLMEZ** (büyük/küçük harf varyantları da reddedilir; gizli hesap görünür bir hesaptan türetilemez, çünkü o kullanıcının geçmişi/oturumları/audit satırları maskeli hesaba taşınamaz). Panelde düğme, API'de uç YOK — `admin:users` taşıyan herkesin kendini yükseltmesi demek olurdu.
- ⚠️ `.env`de KALAN eski satırlar için boot uyarısı (yalnız ANAHTAR ADI, değer ASLA): P2 yolunu kullanmış bir kurulumda o satırlar CANLI kimlik bilgisidir. Uyarı tespit eder, temizliği operatör yapar (reçetede adım var).
- Bayat belge atıfları düzeltildi; en tehlikelisi mercek raporunun "`.env` bloğunu KURULUM.md'ye EKLE" reçetesiydi — uygulansaydı P8'in kapattığı sır yüzeyi geri gelirdi. **Bu, "şerh yazmadan önce yeniden ölç" kuralının neden var olduğunun kanıtı.**

**Süreç dersi (ikisi de bu turda yaşandı):** ① Bir doğrulayıcı ölçümlerin TAMAMINI yapıp yapılandırılmış çıktıyı beş denemede veremeden düştü — bulgu transcript'ten kurtarıldı; şema alanlarına sınır koymak (findings ≤ 12, kanıt ≤ 2500 karakter) bunu önlüyor. ② Düzeltme turu API 500/529 ile iki kez düştü ama ajanlar işi BİTİRMİŞTİ; "rapor gelmedi" ile "iş yapılmadı" ayrı şeylerdir — ağacın durumu ölçülerek anlaşıldı (kapı takılı mı, bekçi ne diyor), rapora güvenilmedi.

