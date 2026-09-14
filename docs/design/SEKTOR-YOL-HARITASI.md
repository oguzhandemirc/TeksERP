# Sektör yol haritası — eksik hareket/transaction tabloları

> **Ürün belgesi, mühendislik planı DEĞİL.** Kaynak: 2026-09-11 ultracode taraması — 13 tekstil iş alanı, 138 ajan, her bulgu ayrıca şemada çürütülmeye çalışıldı (yanlış pozitif elendi). Doktrin ve bugünkü defter envanteri: `docs/kurallar/defter.md`. Hikâye: `docs/history/CLAUDE-NOT-ARSIVI.md` 2026-09-10 / 2026-09-11.

> ⚠️ Bu belge **karar vermez, seçenek sunar.** Hiçbir madde onaylanmış iş değildir. `kim için` sütunu dürüsttür: `sektör geneli` = bugünkü fabrikanın hiç yapmadığı iş.

## ⬛ HEDEF KİTLE KARARI — 2026-09-11 (kullanıcı)

Bu belge 13 alanı eşit ağırlıkta taradı. Karar sonrası **ağırlık değişti**:

**HEDEF SEKTÖR: PERDE.** Kapsamdaki üretim alanları:
- **Dokuma — armür ve jakar** (fabrika bugün yapmıyor, ürün hedefi yapıyor)
- **Devere / leventleme** (çözgü hazırlama → levent → tezgaha bağlama → tüketim)
- **Boyahane FASON SÜREÇ olarak** kalır — iç boyahane defteri (kimyasal/reçete)
  öncelik DEĞİL; fason sevk/kabul zinciri zaten var.

**KAPSAM DIŞI: konfeksiyon / giyim.** Beden boyutu (`OrderLine`'a beden kırılımı,
pastal, demet, hat çıkışı) bu turda AÇILMAZ — sipariş/üretim/sevkiyat/faturalama
zincirinin tamamına dokunur ve perde işi beden taşımaz.

⚠️ **Kök `CLAUDE.md`'deki "Fabrika çözgü/dokuma yapmaz — kumaş hazır gelir"
cümlesiyle ÇELİŞMEZ**: o cümle BUGÜNKÜ FABRİKANIN PROFİLİDİR (adnansahin),
ürünün hedefi değil. Dokuma yetenekleri bayrakla açılır; referans profilde
kapalı kalır. "Tek gövde, çok fabrika" ilkesi korunur.

### Bu kararın taramada karşılığı

`dokuma-orme` alanının beş bulgusu (aşağıda) artık **birinci öncelik**:
`DoffEvent` (tezgah çıkışında top doğuşu — hangi levent, sayacın hangi
metresinden) · `LoomStopEvent` (çözgü/atkı kopuş ADEDİ) · `MachineSetupEvent`
(levent bağlama, tahar, tarak değişimi) · `Shift` (vardiya bazlı üretim) ·
`FabricInspectionLine` (4-punto muayene).

### ✅ SAHA KAYNAĞI GELDİ — `DOKUMA-DEVERE-SAHA-KAYNAGI.md`

2026-09-11: bir dokumacının sekiz belgesi okundu (desen kartı, devere formülü,
akış şeması, iplik irsaliyesi, çeki listesi) ve `docs/design/DOKUMA-DEVERE-SAHA-KAYNAGI.md`'ye
çevrildi. Aşağıdaki boşluğun bir kısmını KAPATIR — devere formülü, levent tanımı
ve desen kartının yapısı artık elimizde. **Tasarım yapmadan önce o belge okunur.**

İki bulgu tasarımı sadeleştiriyor: (1) `Desen` yeni bir üst düzey varlık DEĞİL,
kumaş `Item`'ının arkasındaki teknik reçetedir (sevk listesinde ürün desen+renk
ile anılıyor, zaten `Item`+`Color`). (2) Dokuma ve devere mevcut rotanın ÖNÜNE
eklenen iki adımdır, mevcut akışı bozmaz.

### ⚠️ TARAMA BOŞLUĞU — devere/leventleme AYRICA TARANMADI

Ajan istemi "çözgü hazırlama, levent" diyordu ama dönen bulgular TEZGAH
olaylarına odaklandı. **`WarpBeam`/Levent varlığı ve yaşam döngüsü hiç
incelenmedi** (çözgü hazırlama → levent → tezgaha bağlama → tüketim → boşalma;
levent başına iplik tüketimi, kalan metre, hangi tezgahta). Sistemde bugün levent
kavramı HİÇ YOK. Bu, ayrı bir tarama turu hak eder — kullanıcı devereyi özellikle
önemli saydı.

## Nasıl okunur

| Ciddiyet | Anlamı |
|---|---|
| 🔴 defter yalanı | Sistem bugün YANLIŞ bir şey söylüyor ya da sessizce kaybediyor |
| 🟠 veri kaybı | Bilgi hiç yazılmıyor; sonradan geri getirilemez |
| 🟡 raporlama kaybı | Veri var ama soru cevaplanamıyor |
| 🔵 yeni yetenek | Bugün kapsam dışı; sektöre açılmanın şartı |

**90 doğrulanmış bulgu** — 🔴 defter yalanı 18 · 🟠 veri kaybı 12 · 🟡 raporlama kaybı 28 · 🔵 yeni yetenek 32

Kim için: her ikisi 64 · sektör geneli 25 · bugünkü fabrika 1

---

## Alan alan bulgular

### Bakım (5)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **ConsumableMovement / SparePartMovement** | Yedek parça ve sarf malzeme (boya, kimyasal, yağ, iğne, bıçak, rulman) sisteme girip çıkıyor ama hiçbir stok defteri onları kapsamıyor — tüketim izsi… | ItemType.CONSUMABLE enum'da VAR (schema.prisma:69-73, etiketi 'Sarf' — src/services/import/adapters/item.adap… | her ikisi |
| 🟠 | **CalibrationRecord** | Kantarın veya metraj sayacının ayarı değiştiğinde (kalibrasyon, sıfırlama, tamir) hiçbir satır doğmuyor — ama o andan itibaren tüm geçmiş okumaların… | PeripheralDevice (schema.prisma:994-1105) cihazı ayrıntılı tanır — okuma modu (POLL/STREAM), pollCommand, `si… | her ikisi |
| 🟡 | **MaintenanceCost** | Bakım/tamir masrafı sisteme para olarak girebiliyor ama hangi makineye ait olduğu kaydedilmiyor; masraf makineden koparak serbest metin bir kategoriy… | KISMEN var, atıf yok: CashTransaction (schema.prisma:6898) EXPENSE türünü ve serbest `category` metnini taşır… | her ikisi |
| 🔵 | **MaintenanceOrder** | Bir makine arızalanır, tamir edilir ve fiziksel konfigürasyonu (değişen parça, ayar, revizyon) kalıcı olarak değişir; sistemde bu olayın hiçbir satır… | Hiç yok. prisma/schema.prisma'da ~120 modelin hiçbiri bakım/arıza/servis kavramı taşımıyor (maintenance|bakim… | her ikisi |
| 🔵 | **MachineMeterReading + MaintenancePlan** | Makinenin ne kadar çalıştığı hiçbir yerde birikmiyor: çalışma saati sayacı, işlenen toplam metraj/kg sayacı, atkı sayısı — hiçbiri kolon değil. Dolay… | Plan tarafı hiç yok. Sayaç tarafı KISMEN türetilebilir ama defter değil: RollMovement (schema.prisma:3569-360… | her ikisi |

### Boyahane / Terbiye (6)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **ChemicalMovement** | Boyarmadde ve yardımcı kimyasal miktarları. Bugün bu kalemler SATIN ALINABİLİYOR ama TÜKETİLEMİYOR: `ItemType.CONSUMABLE` için hiçbir stok/hareket ta… | Hiç yok. Kalem türü var (schema.prisma:69 `ItemType.CONSUMABLE`), kg defteri YarnMovement (schema.prisma:7399… | her ikisi |
| 🟠 | **ReworkEvent / RedyeOrder** | "Bu top ikinci kez boyandı" gerçeği ve sebebi. Tambur'daki "Boyahaneye Geri Gönder" akışı (`tambur-manual.service.ts:619`, `sendToDye`) topu geri taş… | Kısmen var ama kalıcı değil: akış `tambur-manual.service.ts:619-850`; iz `SystemLog` + `WorkOrder.parameters`… | her ikisi |
| 🟡 | **Gramaj (g/m²) ölçülen bir büyüklük değil** | Birim alan ağırlığı. Ram/sanfor/kalender geçişinin ürettiği ölçülebilir sonuç budur ve müşteri şartnamesindeki tolerans (ör. 180 g/m² ±5%) buna bakar… | Kısmen/dolaylı: `FabricProperty` CHOICE değeri (schema.prisma:5643, `FabricPropertyValue` 5293), `Roll.weight… | her ikisi |
| 🔵 | **ShadeAssessment + shade lot** | Rengin FİİLİ tonu. `Color` (schema.prisma:5093) bir katalog satırıdır (kod + ad + hex): renk ya vardır ya yoktur, tonu yoktur. Bir işten çıkan malın… | Hiç yok. Yan kanıt: fabrika ton sapmasını YAŞIYOR — `REWORK_REASONS`ın ilk maddesi `TON_TUTMADI` (`constants/… | her ikisi |
| 🔵 | **DyeRecipe + DyeRecipeLine** | Reçetenin İÇERİĞİ. Mevcut `ProductRecipe` ADI ÇAKIŞIYOR ama kapsamı bambaşkadır: kendi tanımına göre "bir ürünü (kumaş + renk + özellikler + en + rot… | Kısmen ve yanıltıcı adla: `ProductRecipe` (schema.prisma:1331) + `ProductRecipeProperty` (1387). Bunlar ürün… | sektör geneli |
| 🔵 | **ProcessParameterLog** | İşlemin NASIL yapıldığı. Boyamada sıcaklık-süre eğrisi (ısıtma °C/dk, fiksaj süresi, soğutma), ram/kurutmada makine hızı (m/dk), kamara sıcaklığı, ov… | Hiç yok. En yakın komşular: `RollMovement` (schema.prisma:3569) giriş/çıkış zamanı + makine + notes; `WorkOrd… | sektör geneli |

### Depo · Lokasyon · Lot (9)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **CONSUMABLE stok defteri** | ItemType.CONSUMABLE kalem kartı açılabiliyor ama o kalemin stoğunu tutan hiçbir tablo yok: Roll yalnız kumaş (metre), YarnStock/YarnMovement yalnız I… | prisma/schema.prisma:69 ItemType (YARN/FABRIC/CONSUMABLE), 340 ItemUnit (MT/KG/ADET). src/services/yarn.servi… | her ikisi |
| 🔴 | **İplik depolar arası transfer** | Depolar arası transfer belgesi yalnız Roll ve Sack taşıyor; iplik (kg) kapsam dışı. İpliği bir depodan diğerine taşımanın tek yolu elle bir OUT + ell… | prisma/schema.prisma:7358 YarnMovementKind (IN/OUT/ADJUST_IN/ADJUST_OUT — TRANSFER yok); 7415-7418 YarnMoveme… | sektör geneli |
| 🟠 | **Blokaj / karantina defteri** | Bir topu satıştan/sevkten geçici olarak çekme kararı (müşteri şikâyeti sonrası inceleme, laboratuvar sonucu beklenen mal, tedarikçi partisi şüphesi)… | prisma/schema.prisma:162 RollStatus (13 değer, blokaj yok); 312 RollErrorAction (yalnız CUT/NO_CUT); 3050 Rol… | her ikisi |
| 🟡 | **Tedarikçi / boya lot numarası (dye lot)** | İç parti (Batch) ve parti izleme raporu iyi kurulmuş; eksik olan DIŞ lot: gelen kumaşın tedarikçi parti numarası ve fason boyahaneden dönen malın boy… | prisma/schema.prisma:6234 GoodsReceipt.deliveryNoteNo; 3821 SubcontractorReceipt.manifestNo; 40 FabricPropert… | her ikisi |
| 🟡 | **Partisiz mal izlenemiyor** | Parti izleme (geri/ileri iz) tümüyle `Roll.batchId`'ye dayanıyor; ama parti üyeliği NULL olabilen bir alan: mal kabul fişiyle satın alınan toplar (PU… | src/services/reports/batch-trace.report.service.ts — getBatchTrace'in dört sorgusu da `r."batchId" = $1` üzer… | sektör geneli |
| 🔵 | **Raf / lokasyon (storage bin) defteri** | En küçük konum birimi DEPO. Topun/ipliğin depo İÇİNDE nerede durduğu (koridor-raf-göz), raftan rafa taşınması, toplama (picking) rotası hiçbir yerde… | Hiç yok. prisma/schema.prisma:6022 Warehouse (code/name/isDefault/isActive/address/notes — konum alt tablosu… | sektör geneli |
| 🔵 | **Döngüsel / kısmi sayım (cycle count)** | Bir sayım = bir depo = deponun TAMAMININ fotoğrafı; üstelik bir depoda aynı anda tek DRAFT sayım olabiliyor. Kalem bazlı, parti bazlı, raf bazlı ya d… | prisma/schema.prisma:7813 StockCount (yalnız warehouseId — kapsam alanı yok); src/services/stock-count.servic… | her ikisi |
| 🔵 | **Konsinye / emanet mal** | Ne Roll'da ne YarnStock'ta sahiplik alanı, ne de Warehouse'da depo TİPİ var (kendi deposu / emanet deposu / fason deposu / müşteride konsinye). Bugün… | Hiç yok. prisma/schema.prisma:6022 Warehouse'ta tip/kind kolonu yok; Roll'da ownership/ownerCustomerId yok (g… | sektör geneli |
| 🔵 | **Yolda (in-transit) stok** | Transfer anında mal çıkış deposundan düşüp varış deposuna giriyor; arada geçen süre (araç yolda, mal henüz teslim alınmadı) hiçbir yerde temsil edilm… | prisma/schema.prisma:6153 WarehouseTransferStatus (yalnız COMPLETED | CANCELLED) ve 6157-6159 model notu bunu… | sektör geneli |

### Enerji · Kimyasal · Uyum (10)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **ConsumableMovement / ConsumableStock** | CONSUMABLE bir kalemin miktarı: alış girişi, üretime çıkış, iade, sayım düzeltmesi. Hiçbiri deftere yazılmıyor. Daha kötüsü: bugün mal kabul fişinde… | ItemType.CONSUMABLE enum'da VAR (prisma/schema.prisma:69-73), import adaptöründe "Sarf" etiketiyle sunuluyor… | her ikisi |
| 🟡 | **WasteDisposal** | Hurdaya ayrılan malın binadan çıkışı. Fire KARARI ve miktarı ölçülüyor, ama o kumaşın kim tarafından, hangi atık koduyla (04 02 xx), kaç kg olarak, h… | KISMEN VAR ve doğru yarısı sağlam: RollVarianceKind.SCRAP vs CANCELLED ayrımı bilinçle kurulmuş (schema.prism… | her ikisi |
| 🟡 | **ComplianceCertificate** | Bir fason firmanın (özellikle boyahanenin) sertifikasının ne zaman verildiği, ne zaman dolduğu ve dolduktan sonra ona iş verilip verilmediği. Bugün s… | HİÇ YOK. Subcontractor (schema.prisma:4001-4082) yalnız code/name/taxNumber/phone/address/isActive/isFavorite… | her ikisi |
| 🟡 | **CertifiedLotLedger** | "Bu sevkiyattaki kumaş sertifikalı mıydı?" sorusunun cevabı. Fiziksel zincir izlenebilir ama sertifika NİTELİĞİ hiçbir yerde taşınmıyor: gelen malın… | KISMEN VAR ve fiziksel yarısı GÜÇLÜ: Roll.parentRollId soy bağı (schema.prisma:1663 civarı, RollLineage), Rol… | her ikisi |
| 🟡 | **LabTestResult** | Bir partiye uygulanan laboratuvar testinin kendisi: hangi test, hangi standart (ISO 105-C06 vb.), hangi laboratuvar, hangi rapor numarası, sonuç geçt… | KISMEN VAR ama başka soruyu cevaplıyor: RollError + DefectType (schema.prisma:3050, 2977) ve DefectSeverity g… | her ikisi |
| 🔵 | **ProcessExecution / RecipeExecution** | Bir boyama/terbiye/apre adımının nasıl koştuğu: hangi reçete, hangi dozajla, kaç derecede, kaç dakika, hangi flotte oranıyla. Bugün bu bilginin tamam… | HİÇ YOK. ProductRecipe (schema.prisma:1331-1385) adı 'reçete' olsa da bir ÜRÜN TANIMIdır — kalem + renk + en… | sektör geneli |
| 🔵 | **UtilityMeterReading / UtilityConsumption** | Fabrikanın enerji tüketimi tamamen sistem dışında. Ne sayaç okuması, ne dönem tüketimi, ne makine/istasyon bazlı dağıtım, ne de birim ürün başına ene… | HİÇ YOK. Machine (schema.prisma:893-945) yalnız kod/ad/istasyon ve cihaz ilişkileri taşır, sayaç veya güç ala… | sektör geneli |
| 🔵 | **WaterWithdrawal / EffluentDischarge + EffluentTestResult** | Çekilen su (şebeke/kuyu, m³), arıtmaya giren ve deşarj edilen atık su miktarı, deşarj noktası ve tarihi, periyodik analiz sonuçları (KOİ, pH, renk, A… | HİÇ YOK. Şemada water/su/atıksu/effluent/deşarj geçen tek model veya kolon yok; 'Su Geçirmezlik' yalnız Fabri… | sektör geneli |
| 🔵 | **ChemicalSpec** | Bir kimyasalın kimliği ve tehlike profili. MSDS'in hangi sürümünün geçerli olduğu, ne zaman güncellendiği, kimyasalın MRSL uyumlu olup olmadığı — hiç… | HİÇ YOK. Item (schema.prisma:1410-1495) yalnız code/name/itemType/unit/isActive/pendingReview + künye + birle… | sektör geneli |
| 🔵 | **EmissionEntry + EmissionFactor** | Fabrikanın ve sevk edilen her partinin karbon ayak izi. Ne hesap var, ne de hesabı besleyecek veri var — bu bulgu diğer üçüne (enerji, su, kimyasal)… | HİÇ YOK. Şemada carbon/karbon/CO2/emisyon/footprint geçen tek satır yok (grep sıfır; 'cancelledBy' dışında eş… | sektör geneli |

### Fason (4)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **Fason emanet stok / konum defteri** | Malın FABRİKA DIŞINA ÇIKIŞI konum defterine hiç yazılmıyor. Fasona sevkte WarehouseMovement satırı doğmuyor; buna karşılık fason dönüşünde born (açık… | Kısmen var. WarehouseEventType (schema.prisma:6078) yedi değer taşıyor (ENTRY/TRANSFER/TRANSFER_REVERSAL/SHIP… | her ikisi |
| 🔴 | **Kısmi doğrudan sevkte ana topun ORİJİNAL metrajı izsiz düşü…** | Fasondan doğrudan müşteriye kısmi sevkte top bölünürken ana topun yalnız currentQty'si değil initialQty'si de düşürülüyor: `data: { currentQty: { dec… | Var ama sil-yaz: src/services/subcontractor.service.ts:600 (createFasonShipChild / applyDirectShipSplits yolu… | bugünkü fabrika |
| 🟡 | **Fason hizmet siparişi + hakediş defteri (SubcontractOrder /…** | Fason işin BİRİM FİYATI, mutabık kalınan tutar ve söz verilen dönüş tarihi hiçbir yerde kaydedilmiyor. Fasondan mal kabul edildiği anda doğan BORÇ de… | Kısmen var, ama parası yok: SubcontractorDispatch (schema.prisma:3615) ve SubcontractorReceipt (3812) miktarı… | her ikisi |
| 🔵 | **Fasona verilen yardımcı malzeme / bileşen defteri (boya, ki…** | Fasoncuya kumaş DIŞINDA verilen hiçbir şey kayda giremiyor: boya/kimyasal, konfeksiyonda aksesuar (düğme, fermuar, etiket, karton), örme/dokuma fason… | Hiç yok. SubcontractorDispatchItem.rollId NOT NULL (schema.prisma:3686) — sevk kalemi yapısal olarak yalnız b… **F1 2026-09-14:** kalem POLİMORFİK oldu (`kind` ROLL \| WARP_BEAM, `rollId` NULL olabilir) — levent indi; iplik `YARN` G1 İNDİ 2026-09-15 (`fason.md` G1 satırı) — boya/kimyasal gibi SARF kalemi hâlâ yok (iplik dışı `ItemType` fason kalemi açılmadı). | sektör geneli |

### Finans defter bütünlüğü (5)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **ChequePurpose / CollateralRegister** | `ChequeStatus.AT_BANK` iki tamamen farklı ticari olayı tek durumda topluyor: TAHSİLE verilen çek (parası gelecek) ve TEMİNATA verilen çek (parası gel… | Kısmen var — `prisma/schema.prisma:7023` `ChequeStatus.AT_BANK` (tek değer, amaç kolonu yok), `:7160` `Cheque… | her ikisi |
| 🟡 | **CariNettingEntry (Cari Virman / Mahsuplaşma)** | Aynı tüzel kişi hem müşteri hem fason firma olduğunda İKİ ayrı cari hesabı doğuyor (`CariAccount.customerId` XOR `subcontractorId`) ve bu iki bakiye… | Hiç yok — `prisma/schema.prisma:6325` `CariAccount` (customerId XOR subcontractorId, CHECK ile kilitli); enge… | her ikisi |
| 🟡 | **InvoiceOffset (Fatura↔Fatura mahsup)** | `SALES_RETURN` / `PURCHASE_RETURN` faturaları deftere yazılıyor ama HİÇBİR ŞEKİLDE kapatılamıyor: `directionMatchesInvoice` yalnız IN↔SALES ve OUT↔PU… | Kısmen var — engel `src/services/payment-allocation.service.ts:120-126` (`directionMatchesInvoice`, yorumda g… | her ikisi |
| 🟡 | **CariRevaluationEntry (Dönem Sonu Kur Değerleme)** | Dönem sonunda AÇIK duran dövizli fatura/çek/bakiyeler yeniden değerlenmiyor; gerçekleşmemiş kur farkı (unrealized FX) hiçbir yerde ne hesaplanıyor ne… | Hiç yok — `prisma/schema.prisma:7307` `CariPeriodClose` (closingBalance tek kolon, para birimi bazında, TL ka… | her ikisi |
| 🟡 | **ExpenseAllocation (Masraf Yansıtma / Gider Dağıtımı)** | `CashTransaction` bilinçli olarak CARİSİZ ve kategorisi serbest metin; hiçbir iş nesnesine bağı yok (cari, sipariş, iş emri, sevkiyat, mal kabul fişi… | Hiç yok — `prisma/schema.prisma:6898` `CashTransaction` (yalnız `category` serbest metin, `description`, `ref… | her ikisi |

### İplik · Hammadde · Ham kumaş (9)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **Karantina/bloke stok + mal kabul muayene kararı (usage deci…** | Girişte kusurlu bulunan mal ile temiz mal defterde AYNI: kabul edilen ham kumaş/iplik doğrudan kullanılabilir stoğa düşüyor. "Bu mal karantinada, kar… | Hiç yok. RollStatus (schema.prisma:162) 13 değer taşıyor — QUARANTINE/BLOCKED/REJECTED yok; ham top STOCK'a d… | her ikisi |
| 🔴 | **PurchaseReturn (tedarikçiye iade irsaliyesi)** | Kabul edilmiş maldan bir KISMININ tedarikçiye geri gitmesi hiçbir şekilde yazılamıyor. Bugün tek yol fişin tamamını iptal etmek; işlem görmüş top var… | Hiç yok. GoodsReceipt.cancel (src/services/goods-receipt.service.ts:1241) tüm fişi CANCELLED yapar; uç doküma… | her ikisi |
| 🔴 | **İplik/hammadde depolar arası transfer belgesi (YarnTransfer)** | İplik bir depodan diğerine taşındığında ortak bir belge doğmuyor: iki bağımsız elle hareket satırı yazılıyor, bunlar birbirine bağlı değil. Yarım kal… | Kısmen var ama iplik kapsam dışı. WarehouseTransfer (schema.prisma:6165) + WarehouseMovement (6099) tam bu iş… | sektör geneli |
| 🟠 | **Sarf malzeme (boya/kimyasal/ambalaj) stok ve sarfiyat defte…** | ItemType.CONSUMABLE kalemlerin (boya, kimyasal, koli, karton, etiket) girişi, tüketimi ve bakiyesi hiçbir defterde yok. Daha kötüsü sessiz bir defter… | Hiç yok + yanlış yola düşüyor. YarnStock/YarnMovement kapsamı açıkça yalnız YARN (yorum src/services/yarn.ser… | sektör geneli |
| 🟡 | **RollSupplierOrigin / Roll.supplierId + tedarikçi lot & irsa…** | KK1'den (SUPPLIER_RECEIPT) giren her ham topun HANGİ TEDARİKÇİDEN, hangi irsaliyeyle, tedarikçinin hangi parti/top numarasıyla geldiği hiç yazılmıyor… | Kısmen var, ama YANLIŞ YOLDA. Tedarikçi yalnız GoodsReceipt.supplierId (schema.prisma:6225) ve PurchaseOrder.… | her ikisi |
| 🟡 | **YarnMovementKind'a fire/kayıt-düzeltmesi ayrımı + reasonCode** | İplikte fire (mal vardı, kullanılamadı), sayım farkı, yanlış giriş düzeltmesi ve nem/tartı farkı AYNI iki kovaya (ADJUST_IN/ADJUST_OUT) düşüyor ve se… | Kısmen var. YarnMovementKind (schema.prisma:7358) yalnız IN/OUT/ADJUST_IN/ADJUST_OUT; YarnMovement'ta reasonC… | sektör geneli |
| 🟡 | **Kabul muayenesi ölçüm defterinin 4-puan sistemine genişleti…** | Girişte tespit edilen kumaş hatasının BÜYÜKLÜĞÜ izsiz: hatanın nerede başladığı yazılıyor ama uzunluğu/şiddet puanı yazılmıyor. Bu yüzden 100 m²/100… | Kısmen var. RollError (schema.prisma:3050) hata haritasını tutuyor: startMeter, defectTypeId, tespit/işlem kü… | her ikisi |
| 🔵 | **MaterialOwnership / konsinye-emanet stok defteri (mal kimin…** | Depoda duran malın MÜLKİYETİ hiçbir yerde yazmıyor; her top ve her kg fabrikanın malı sayılıyor. Müşterinin işlenmek üzere bıraktığı kumaş/iplik (fas… | Hiç yok. Roll'da owner/consignment alanı yok (schema.prisma:1512-1636 alan listesi); YarnStock (7376) yalnız… | sektör geneli |
| 🔵 | **İplik/sarf malzemenin fasona verilmesi ve dönüşü (iplik boy…** | Fasona iplik ya da sarf malzeme gönderildiğinde hiçbir iz doğmuyor: mal depodan elle ADJUST_OUT ile düşülüyor (ya da hiç düşülmüyor), fason firmada n… | Hiç yok. Fason sevk/kabul defteri yalnız TOP taşır: SubcontractorDispatchItem.rollId NOT NULL (schema.prisma:… **F1 2026-09-14:** kalem POLİMORFİK oldu (`kind` ROLL \| WARP_BEAM, `rollId` NULL olabilir) — levent indi; ~~iplik `YARN` değeri F3~~ **G1 İNDİ 2026-09-15:** iplik kalemi (`kind=YARN`, kg) + `YarnMovement SUBCONTRACT_*` dört tür + türetilmiş fason bakiyesi (`yarn-balance`) — bu boşluk KAPANDI; panel yüzeyi G1p, sarılan levent bağı G1c. | sektör geneli |

### Kalite · Fire · Şikâyet (6)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **RollError append-only değil** | Kalite hata kaydının kendisi ve verilmiş karar. İki yol geçmişi sessizce değiştiriyor: (1) `deleteError` hata satırını FİZİKSEL siliyor (yalnız isPro… | Var ama defter semantiği eksik: RollError (schema.prisma:3050-3108) mutable bir tablo — tespit/karar ayrımı (… | her ikisi |
| 🟠 | **CustomerComplaint / QualityClaim** | Müşterinin kalite itirazı. Bugün defter yalnız FİZİKSEL GERİ GELEN TOPU kaydediyor (RollReturn.rollId zorunlu). Mal geri gelmeden yapılan şikâyet — '… | Kısmen var — ama yalnız iade kolu: RollReturn (schema.prisma:4963) iyi kurulmuş bir defter (spec snapshot, ço… | her ikisi |
| 🟡 | **ReworkOrder / rework izi** | Yeniden üretim olayı ve sebebi. Depodaki bitmiş topu tekrar üretime alma akışı VAR, ama sebebi WorkOrder.parameters JSON'una ('parameters.rework') ya… | Kısmen var: yeniden üretim sebep kataloğu gerçek ve iyi tasarlanmış (ReasonPresetKind.WORK_ORDER_REWORK, sche… | her ikisi |
| 🔵 | **Puanlı hata kaydı (4-point / 10-point sistem)** | Hatanın büyüklüğü. RollError yalnız `startMeter` (tek NOKTA) tutuyor ve model yorumu bunu açıkça beyan ediyor: 'Hata sadece NOKTA olarak takip edilir… | Kısmen var: hata tipi kataloğu (DefectType, schema.prisma:2977), tespit metresi (RollError.startMeter, schema… | her ikisi |
| 🔵 | **QualityHold / karantina-blokaj defteri** | Malın satılabilirlik durumu. Kalite şüphesi doğduğunda (müşteri şikâyeti geldi, parti şüpheli, lab sonucu bekleniyor) bir topu/partiyi/çuvalı geçici… | Hiç yok. RollStatus'ta HOLD/QUARANTINE/BLOCKED değeri yok (schema.prisma:162-180: STOCK, IN_PRODUCTION, SCRAP… | her ikisi |
| 🔵 | **CorrectiveAction / CAPA (düzeltici-önleyici faaliyet, 8D)** | Tekrarlayan kalite probleminin kapatılması. Sistemde hata (RollError), fire (RollVariance), plan sapması (RollPlanDeviation) ve iade (RollReturn) kay… | Hiç yok. Şema genelinde 'capa|corrective|duzeltici|nonconform|8D' hiç eşleşmiyor. En yakın komşular sinyal ür… | sektör geneli |

### Maliyetlendirme (12)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **PurchasePriceVariance + LandedCostAllocation** | Mal kabulde topa donan fiyat ile faturada fiilen kesilen fiyat FARKLI olabiliyor; fatura satırında fiyat elle değiştirilirse Roll.purchasePrice geri… | Kısmen: Roll.purchasePrice (schema:1756) ve YarnMovement.unitPrice (7428) kabul anında donuyor ("maliyet/fatu… | her ikisi |
| 🟠 | **RollCostLayer** | Roll.purchasePrice YALNIZ mal kabulünde yazılıyor; Tambur kesiminde doğan çocuk toplar, fason dönüşünde doğan toplar ve split/merge çıktıları purchas… | Roll.purchasePrice (prisma/schema.prisma:1756 — kolon notu zaten "üretimden doğan topun alış fiyatı YOKTUR" d… | her ikisi |
| 🟡 | **ProductionMaterialIssue** | Boya/kimyasal/yardımcı madde/aksesuar (ItemType.CONSUMABLE) hiçbir yerde stoktan düşmüyor ve iş emrine yazılmıyor; iplikte çıkış var ama nedeni izsiz… | Kısmen: YarnMovement (prisma/schema.prisma:7399; kind enum 7358; belge bağları 7411-7415) + YarnStock (7376).… | her ikisi |
| 🟡 | **SubcontractorCharge** | Fasona giden metrenin/kilonun birim ücreti hiçbir yerde saklanmıyor: sevk anında anlaşılan tarife izsiz. Fason faturası geldiğinde "hangi sevk kalemi… | Hiç yok. SubcontractorDispatch (schema:3615) ve SubcontractorDispatchItem (3683) yalnız metraj/ağırlık taşıyo… | her ikisi |
| 🟡 | **LaborConfirmation** | İşçilik SÜRESİ maliyet birimi olarak hiçbir yerde tutulmuyor. Bugünkü izler ham: RollMovement enteredAt/exitedAt farkı TOP başına geçen süredir, oper… | Kısmen: RollMovement (schema:3569 — qtyIn/qtyOut, enteredAt/exitedAt, operatorId, machineId) ve WorkSession (… | her ikisi |
| 🟡 | **InventoryValuation** | İplik stoğu yalnız kilo olarak biliniyor, değeri hesaplanamıyor: giriş satırında fiyat var, ÇIKIŞ satırında maliyet yok ve bakiye kaydında değer kolo… | Kısmen: YarnStock (schema:7376) yalnız balanceKg tutuyor (değer kolonu YOK); YarnMovement.unitPrice (7428) ya… | her ikisi |
| 🔵 | **WorkOrderCostEntry** | Bir iş emrine akan hiçbir maliyet satırı yok: malzeme, işçilik, makine, fason, enerji, genel gider hiçbiri emre yazılmıyor. WorkOrder kapandığında (W… | Hiç yok. WorkOrder modelinde (prisma/schema.prisma:2450-2555) tek bir maliyet/tutar kolonu bulunmuyor; hedef… | her ikisi |
| 🔵 | **ActivityRate** | Süreyi/miktarı paraya çeviren oran hiçbir yerde yok, dolayısıyla oranın DEĞİŞİM tarihçesi de yok. Oran sonradan tek kolon olarak eklenirse (ItemPrice… | Hiç yok. Machine (schema:893) kartında saatlik oran/kapasite kolonu yok; Station (786) ve RouteStep (1251) ya… | her ikisi |
| 🔵 | **StandardCostVersion + RecipeComponent** | "Bu ürün ne kadara mal olmalı" beyanı hiç yok; reçete miktar taşımıyor. Sapma hesabının referans bacağı olmadığı için gerçekleşen maliyet bir şeyle K… | Kısmen (yalnız iskelet): ProductRecipe (schema:1331) item+renk+en+katlama+rota tutuyor, ProductRecipeProperty… | her ikisi |
| 🔵 | **CostVariance** | Standart ile gerçekleşen arasındaki fark hiçbir yerde satır olarak doğmuyor. DİKKAT — ad tuzağı: mevcut RollVariance bir MALİYET sapması DEĞİL, METRA… | Hiç yok (maliyet sapması olarak). Metraj tarafı VAR: RollVariance (schema:3175) + RollVarianceKind (118-130),… | her ikisi |
| 🔵 | **CostCenter + OverheadAllocationRun** | Kira, elektrik, maaş gibi giderler kasadan çıkıyor ama hiçbir üretim birimine bağlanmıyor: masraf yeri kavramı yok, giderin makine/istasyon/iş emri b… | Kısmen (yalnız gider kaydı): CashTransaction (schema:6898) — CashTxnKind.EXPENSE "kira, maaş, elektrik…" (687… | her ikisi |
| 🔵 | **UtilityConsumption** | Parti/makine başına enerji ve su tüketimi hiç ölçülmüyor, dolayısıyla maliyete de girmiyor; ayrıca atık su/çevre raporlaması için gereken tüketim izi… | Hiç yok. Ne Machine (schema:893) ne Station (786) ne de RollMovement (3569) tüketim/sayaç alanı taşıyor; ener… | sektör geneli |

### Satınalma · Mal kabul (6)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **SupplierReturn** | Tedarikçiye geri gönderilen malın depodan çıkışı. Para tarafı VAR, mal tarafı YOK: `InvoiceType.PURCHASE_RETURN` (alış iade faturası) kesilebiliyor v… | Kısmen var (yalnız para bacağı). `WarehouseEventType` (prisma/schema.prisma:6078) yedi değerinde SUPPLIER_RET… | her ikisi |
| 🔴 | **SupplierInvoiceMatch** | Tedarikçinin gönderdiği faturadaki miktar ve fiyat. Sistemdeki alış faturası tedarikçinin belgesi değil, BİZİM fişten TÜRETTİĞİMİZ belgedir; tedarikç… | Kısmen var (2-way'in de altında). Fatura fişten üretiliyor: src/services/invoice.service.ts:466-708 (`goodsRe… | her ikisi |
| 🟠 | **PurchaseOrderRevision** | PurchaseOrderLine.qty, unitPrice, notes ve kalem kümesinin tamamı. `update()` kalemleri REPLACE ediyor (`deleteMany` + yeniden `create`) — eski mikta… | Hiç yok. src/services/purchase-order.service.ts:707 `update()`; kalem replace :764-780; audit yükü :784-791.… | her ikisi |
| 🟠 | **IncomingLot / YarnLot** | Tedarikçinin parti/lot numarası hiç kaydedilmiyor; dolayısıyla "bu top hangi boya partisinden geldi", "aynı lottan kaç metre kaldı", "bu lot sorunlu,… | Hiç yok. `Batch` (prisma/schema.prisma:2560) bir ÜRETİM partisidir — `workOrderId` NOT NULL, yani iş emri olm… | her ikisi |
| 🟠 | **ConsumableMovement** | CONSUMABLE kalemlerin tüm stok hareketi. Kalem kartında tür VAR ama bu türün ne bakiyesi ne defteri var; satın alınan boya/kimyasal/aksesuar deftere… | Hiç yok (katalog dışında). `ItemType.CONSUMABLE` prisma/schema.prisma:69 ve `Item.itemType` schema.prisma:141… | sektör geneli |
| 🟡 | **Kalem bazlı termin + tedarikçi karnesi kaynağı (PurchaseOrd…** | Kalem/renk bazlı teslim tarihi ve dolayısıyla zamanında teslim ölçümü. Termin yalnız sipariş BAŞLIĞINDA; "Renk A 15 Mart, Renk B 30 Mart" tek sipariş… | Kısmen var. `PurchaseOrder.expectedDate` başlıkta (prisma/schema.prisma:7529); `PurchaseOrderLine` (schema.pr… | her ikisi |

### Satış · Karşılama · ATP (7)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **OrderPromiseChange (Termin Revizyon Defteri)** | Order.deadline tek, serbestçe değişebilen bir kolon. Kısmi sevk edilmiş (PARTIAL_SHIPPED) siparişte bile PATCH ile değiştirilebiliyor — üstelik updat… | schema.prisma:2256 Order.deadline (tek kolon, revizyon alanı yok; requestedDeadline/confirmedDeadline yok). s… | her ikisi |
| 🟠 | **OrderLineChange (Sipariş Değişiklik Defteri)** | OrderLine.quantity, unitPrice, colorId, width, pieceLengthM sil-yaz güncelleniyor. 10.000 m sipariş 3.000 m'ye çekildiğinde eski miktar hiçbir kalıcı… | schema.prisma:2346 OrderLine (değişiklik izi taşıyan tek alan cancelledAt/cancelReasonCode). src/services/ord… | her ikisi |
| 🟡 | **OrderPromiseCheck (ATP/CTP Söz Verme Kaydı)** | Müsaitlik tamamen anlık hesap: getSpecAvailability kendi yorumunda "ANLIK FOTOĞRAF — rezervasyon değildir" diyor; getCoverageForLines de her çağrıda… | src/services/order.service.ts:1600-1683 getSpecAvailability (snapshot saklamıyor), :1432-1587 getCoverageForL… | her ikisi |
| 🟡 | **PriceCondition / OrderLineDiscount** | Sipariş satırında İSKONTO ALANI HİÇ YOK: OrderLine yalnız unitPrice taşıyor (InvoiceLine'da discountRate VAR — schema.prisma:6539). Yani satışta konu… | schema.prisma:2358 OrderLine.unitPrice (iskonto/KDV/para birimi alanı yok; para birimi yalnız Order başlığınd… | her ikisi |
| 🔵 | **OrderLineSchedule (Teslimat Programı Satırı)** | Bugün hiç yok: termin yalnız SİPARİŞ BAŞLIĞINDA (Order.deadline). OrderLine'ın kendi teslim tarihi bile yok, dolayısıyla "5.000 m'nin 2.000'i 15 Mart… | hiç yok — schema.prisma:2346 OrderLine'da tarih alanı yok; termin yalnız schema.prisma Order.deadline'da. | her ikisi |
| 🔵 | **StockReservation / AllocationLedger** | Rezervasyon kavramı BİLİNÇLİ olarak yok ("rezerv/packedQty YOK — düşüş yalnız sevkte"); açık miktar = quantity − shippedQty. Sonuç: iki satıcı aynı d… | schema.prisma:2801 WorkOrderToOrderLine.allocatedQty (mutable, geçmişsiz, okunmuyor) — src/services/helpers/c… | sektör geneli |
| 🔵 | **PrintedDocType.ORDER_CONFIRMATION** | Siparişin karşı tarafa teyit edilen hâli (miktar, fiyat, termin, renk/en, tolerans) hiçbir zaman dondurulmuyor. Sipariş başlığı ve kalemleri sonradan… | schema.prisma:4337-4381 PrintedDocType — 17 belge tipi var (sevk irsaliyesi, fason kabul, fatura, mutabakat m… | her ikisi |

### Üretim yürütme · Vardiya · OEE (6)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🔴 | **WorkSession süresi çalışma süresi değil** | Makine/operatör durduğunda oturum sessizce kapanıyor ve geri döndüğünde YENİ bir oturum açılıyor. Aradaki boşluğun süresi ölçülüyor ama SEBEBİ hiçbir… | `prisma/schema.prisma:1146` `enum WorkSessionEndReason` — `IDLE // Hareketsizlik zaman aşımı (tembel kapatma… | her ikisi |
| 🔴 | **Adım/iş emri duraklatma defteri** | Bir adımın 'başladı' ve 'bitti' anı arasında ne olduğu izsiz: iş üç kez durup başladıysa, gece boyunca beklediyse, malzeme beklediyse — hepsi tek bir… | `prisma/schema.prisma:2618` `model WorkOrderStep` — yalnız `startedAt` / `completedAt` (satır ~2627-2628), ar… | her ikisi |
| 🟠 | **MachineReading / MachineCounter** | Kantar ve metre cihazlarından okunan her ham değer kullanıldıktan sonra buharlaşıyor: yalnız türetilmiş sonuç (çuval brüt kg, top metrajı) kalıyor, o… | `prisma/schema.prisma:994` `model PeripheralDevice` — `readMode` (POLL/STREAM), `pollCommand`, `identifyPatte… | her ikisi |
| 🟡 | **Shift / ShiftInstance (Vardiya takvimi ve vardiya örneği)** | Vardiya devri iz bırakmadan oluyor: bir vardiyanın başlangıç/bitiş anı, o vardiyada hangi istasyonun/makinenin planlı çalıştığı, planlı mola ve planl… | Hiç yok. En yakını `src/constants/time.ts` (FABRİKA GÜNÜ, Europe/Istanbul, gece yarısını geçen vardiya için y… | her ikisi |
| 🟡 | **PlanRevision** | Termin ve planlanan başlangıç/bitiş tarihleri sil-yaz güncelleniyor: bir siparişin ya da iş emrinin kaç kez ertelendiği, ilk verilen sözün ne olduğu,… | `prisma/schema.prisma` `model Order` — `deadline DateTime?` (satır ~2272), tek ve değiştirilebilir; iptal içi… | her ikisi |
| 🔵 | **Standart süre (norm/SAM) ve setup / parti-değişim süresi** | Bir adımın ne kadar SÜRMESİ gerektiği hiçbir yerde tanımlı değil; dolayısıyla ne kadar sürdüğü ölçülse bile 'sapma' hesaplanamıyor. Renk/parti değişi… | `prisma/schema.prisma:1251` `model RouteStep` ve `prisma/schema.prisma:1331` `model ProductRecipe` — hiçbirin… | her ikisi |

### Dokuma / Örme (5)

| ! | Önerilen defter | İzsiz değişen | Bugün nerede | Kim için |
|---|---|---|---|---|
| 🟠 | **DoffEvent / tezgah çıkışı top doğumu** | Kendi tezgahımızda dokunan/örülen bir topun DOĞUŞU kayıt altına alınamıyor: hangi tezgah, hangi levent, tezgah sayacının hangi metresinden hangisine,… | KISMEN VAR, kritik değer eksik. `RollEntrySource` (schema.prisma:77–117) yedi değer taşıyor — SUPPLIER_RECEIP… | sektör geneli |
| 🟡 | **Shift / ShiftProductionLog** | Sistemde VARDİYA diye bir kavram yok. Üretim miktarı yalnız top doğduğunda (olay bazlı) yazılıyor; 'A vardiyası 3 numaralı tezgahta kaç metre üretti'… | KISMEN VAR ama yanlış nesne. `WorkSession` (schema.prisma:1160) en yakın kayıt: userId + deviceId + machineId… | her ikisi |
| 🟡 | **FabricInspectionLine / ham muayene hata haritası** | Hatanın UZUNLUĞU ve topun ENİNDEKİ yeri kaydedilmiyor, dolayısıyla puan hesaplanamıyor ve kalite kademesi (1./2. kalite) ölçülmüş bir sayıdan değil o… | KISMEN VAR ve iyi kurulmuş. `RollError` (schema.prisma:3050) hata noktasını metre cinsinden tutuyor (`startMe… | her ikisi |
| 🔵 | **LoomStopEvent (kopuş) / çözgü–atkı kopuş sayacı** | Çözgü kopuşu, atkı kopuşu, iğne kırılması hiçbir yere yazılmıyor. Bu kayıtlar genel makine duruşundan AYRI bir defterdir: bir kopuş 20 saniye sürer,… | HİÇ YOK. Kopuş/duruş sebebi için katalog da yok: `ReasonPresetKind` (schema.prisma:135) altı değer taşır (ROL… | sektör geneli |
| 🔵 | **MachineSetupEvent / desen–parti değişimi (tahar, tarak, çöz…** | Tezgahın bir işten diğerine geçiş süresi ve o geçişte ne yapıldığı (yeni levent bağlama/düğüm, tahar, tarak değişimi, örmede iğne/çap değişimi) hiçbi… | HİÇ YOK, ve referans değeri de yok. `RouteStep` (schema.prisma:1251) ve `WorkOrderStep` (2618) alanlarının ta… | sektör geneli |

---

## Taramanın kendi kör noktaları — tamamlık eleştirmeni

> Son ajan "bu tarama neyi kaçırdı" sorusunu sordu. Aşağıdakiler **hiç bakılmamış** alanlardır; yukarıdaki tabloda yokturlar.

**A. HİÇ BAKILMAMIŞ ALANLAR**

**[konfeksiyon] BEDEN boyutu şemada hiç yok** — `OrderLine` = item + colorId + width + qty(m); `ItemUnit.ADET` var ama beden kırılımı taşıyacak yer yok. Defter: `OrderLineSize` (renk×beden matrisi), `CuttingOrder` + `Lay/Marker` (pastal serim: kat, marker verimi), `BundleTicket` (demet izleme), `SewingLineOutput` (hat/saat çıkış + dikim hatası). Konfeksiyon + örme hedef kitlenin en büyük dilimi ve tek satır yok. (yeni-yetenek)

**[baski] Baskı alanı hiç taranmamış** — şablon/rotasyon ve pat yok. Defter: `ScreenAsset` (şablon/gravür kimliği, rapor ölçüsü, kullanım sayacı, ömür/hurda), `PrintPasteBatch` (patlanan boya hazırlama, kalan patın iadesi/imhası — kimyasal defterinden AYRI bir kol), `StrikeOff` (baskı numunesi müşteri onayı). (yeni-yetenek)

**[numune-koleksiyon] Numune İŞ AKIŞI ve sezon boyutu yok** — `Swatch` renk kartelasıdır, numune talebi değil; `Item`'da koleksiyon/sezon alanı yok. Defter: `SampleRequest` (talep → numune üretimi → gönderim → müşteri kararı: onay/revizyon/red, revizyon turu), `Collection/Season` boyutu. "Geçen sezon bu desende ne sattık" sorulamıyor. (yeni-yetenek)

**[ihracat-lojistik] İhracat belgesi diye bir şey yok** — `Shipment.destination=EXPORT` + serbest `procedureCode` string'inden ibaret. Defter: `ExportDeclaration` (beyanname no, GTİP, menşe, Incoterm, çıkış teyidi/kapanış), `TransportOrder` (konteyner/konşimento/CMR, navlun, sigorta poliçesi), `LetterOfCredit` (akreditif: vade, evrak ibrazı, iskonto), `InwardProcessing` (DİİB sayacı — ithal girdiye karşılık ihracat kapatma mutabakatı; kapatılmayan belge = vergi + ceza). (yeni-yetenek)

**[e-belge] e-İrsaliye/e-Fatura entegrasyon defteri yok; sevk↔fatura bağı tek string** — `Shipment.invoiceNo` serbest metin ve şemada "bir sevk = bir fatura varsayımı; kısmi faturalama modellenmedi" yazılı. Defter: `EDocument` (tip, ETTN/UUID, gönderim durumu, GİB/uygulama yanıtı, red-itiraz-iptal) + sevk↔fatura N:N eşleşme satırı. e-İrsaliye TR'de zorunlu; irsaliyeyi bu sistem basıyor. (defter-yalani)

**[konsinye-cikis] Müşteri konsinyesi / teşhir stoğu — ÇIKIŞ yönü** (bulunan "konsinye" maddesi GİREN mala aitti): `SHIPPED` = satıldı varsayımı. Konsinye sevkte mülkiyet devrolmaz; fabrika kendisi fason çalışırsa (mal müşterinin) sevk yine satış sayılır. Defter: `ConsignmentPlacement` + dönemsel `ConsignmentSalesReport` (satış bildirimi anında fatura + gerçek çıkış) + geri çekme. (defter-yalani)

**[satis-oncesi] Teklif ve sözleşme yok** — `Quotation` modeli yok, sipariş yoktan doğuyor. Defter: `Quotation` + revizyon + "teklif→sipariş dönüşüm" izi, `SalesContract` (yıllık miktar/fiyat anlaşması ve ondan çekilen sipariş). Ek: `CariAccount.riskLimit` var ve `finance.riskLimitBlockEnabled` 409 veriyor, ama "yine de geçir" kararının kim/gerekçe kaydı yok. (veri-kaybi)

**[personel] Login'siz personel, puantaj ve parça-başı yok** — `User` bir OTURUM hesabıdır; tablet kullanmayan işçinin kimliği hiç yok. Bulunan Shift/LaborConfirmation bunun ÜSTÜNE oturacak ama tabanı yok. Defter: `Employee` (login'siz kart), `AttendanceRecord` (giriş-çıkış/mesai), `PieceRateEarning` (parça-başı hakediş — konfeksiyonda ücretin tamamı). (yeni-yetenek)

**[demirbas] Ekipman/kalıp kartı yok** — `Machine` yalnız {kod, ad, istasyon}. Tarak, tahar, şablon, aparat, ölçü aleti, kalıp hiç yok; bulunan bakım/kalibrasyon defterlerinin bağlanacağı nesne eksik. Defter: `Equipment/FixedAsset` (seri no, alım tarihi/bedeli, garanti, amortisman). (yeni-yetenek)

**B. KESİŞİMDE DURAN, HİÇBİR ALANIN SAHİPLENMEDİĞİ DEFTERLER**

**[secere] Üretim şeceresi 1:N — BİRLEŞTİRME yönü yapısal olarak yok**: `Roll.parentRollId` TEK ebeveyn, şema yalnız BÖLÜNMEYİ modelliyor. Laminasyon/kaplama, iki topun eklenmesi, harman, iplik→kumaş, kesilen parçaların tek mamule girmesi temsil edilemiyor. Defter: `ProductionInput` (girdi lot/rulo × çıktı × miktar). Bunsuz geri izleme (bu malda hangi lotlar var), ileri izleme ve GERİ ÇAĞIRMA imkânsız. (veri-kaybi)

**[iplik-mamul] YarnMovement ile Roll doğumu arasında HİÇBİR bağ yok** — `YarnMovement`in belge bağları yalnız `goodsReceiptId` / `invoiceId` / `stockCountId`; `workOrderId` ve `rollId` YOK. Dokuma/örmede hammadde tüketimi ile mamul üretimi iki bağımsız defter → randıman (kg girdi → m/kg çıktı) ve fire ölçülemez. Bulunan `ProductionMaterialIssue` maliyet tarafıydı; buradaki eksik MİKTAR mutabakatı. (defter-yalani)

**[recete-bom] Reçete ≠ BOM** — `ProductRecipe` = {item, renk, en, rota, özellikler}; hiçbir MALZEME bileşeni yok. Sistemin "bir metre kumaş neyden yapılır" cevabı yok → malzeme ihtiyaç planı (MRP) hesaplanamaz, fason'a verilecek yardımcı malzeme miktarı türetilemez. Defter: `RecipeComponent` (malzeme × miktar/birim × fire%) — maliyet başlığındaki `StandardCostVersion`'dan bağımsız, ÜRETİM planlamasının şartı. (yeni-yetenek)

**[birim] m ↔ kg ikiliği hiçbir yerde yok** — `OrderLine.quantity`, `SackAllocation.qty`, `shippedQty`, `Order.shippedQty` hepsi METRE; `Roll.weightKg` yalnız bilgi notu. Örme kumaş sektörünün tamamı KG ile satar, boyahane KG ile fiyat verir. İhtiyaç: kalem bazında `unit` + `UnitConversion` (item bazlı m↔kg, gramaj×en'den türetilir) ve karşılama defterinin çift birimli olması. Bugün kg ile satan müşterinin sipariş karşılaması yanlış hesaplanır. (defter-yalani)

**[mutabakat] Defterler arası mutabakat yok** — bir topun hayatı dört deftere dağılmış (`RollMovement` · `WarehouseMovement` · `RollOperation` · `SubcontractorDispatchItem/Receipt`) ve hiçbir yerde "Σgiriş − Σçıkış = mevcut" eşitliği ölçülmüyor; üstelik `WarehouseMovement` statü terfisini (STOCK→WAREHOUSE) bilinçli olarak YAZMIYOR, yani konum defteri ile statü zaten ayrışık. Finans tarafında sayaç↔defter mutabakatı (`paidTotal`, `CariBalance`) var, MAL tarafında yok. İhtiyaç: topun tek zaman çizgisi görünümü + gece koşan fark raporu. (defter-yalani)

**C. TERS YOL KÖŞELERİ (bakılmamış)**

**[sayim] Sayım fark fişinin ters yolu yok** — `stock-count.service.ts:418`: "COMPLETED TERMİNALDİR (geri alma yok, `cancel` yalnız DRAFT'ta)". Yanlış "bulunamadı" işaretiyle tamamlanan sayım N topu iptal eder; tek çıkış yolu top-top elle restore. Defter: `StockCountReversal` (fark fişinin tek belgede stornosu). (defter-yalani)

**[ice-aktarma] Toplu içe aktarımın geri alma yolu yok** — `import.service.ts:592`: "geri alınamaz (hangi kayıtların yazıldığı bilinmez)". `ImportRun` yalnız SAYAÇ tutuyor (created/updated/failed), yazılan satırların KİMLİĞİNİ tutmuyor. Defter: `ImportRunLine` (satır → yaratılan/güncellenen kayıt id + önceki değer) → koşum geri sarılabilsin. (veri-kaybi)

**[birlestirme] Master-data birleştirmenin ters yolu yok** — `mergedIntoId` tombstone kalıcı, `unmerge` yok; hangi referansların taşındığı kalıcı kolonda değil (audit'te, 6 ayda arşivleniyor). Yanlış birleştirilen iki müşteri/ürün/renk ayrılamıyor. Defter: `MergeOperation` + taşınan referans satırları. (veri-kaybi)

**[kartela] `SwatchStockReduction` tek yönlü** — yalnız DÜŞÜM satırı var, ters kayıt yok; yanlış düşülen kartela geri gelmiyor. "Deftere yazan her ileri kaynağın `*_CANCEL` ters yolu olmalı" kuralının doğrudan ihlali. (defter-yalani)

**D. ZAMAN BOYUTU**

**[donem-kilidi] Stok/üretim tarafında dönem kapanışı YOK** — kapanış yalnız cari (`CariPeriodClose`) ve kasa/banka (`CashPeriodClose`); `assertPeriodOpenTx` yalnız `CariTransaction` yazan beş yolda koşuyor. Depo/top/iplik hareketleri kapanmış aya geriye dönük yazılabiliyor → beyan edilmiş stok ve maliyet rakamı sessizce değişiyor. Defter: `InventoryPeriodClose` (depo × dönem fotoğrafı + hareket sayısı) + aynı fail-closed kilit yüklemi. (defter-yalani)

**[as-of] Tarihe göre stok kesiti alınamıyor** — `Roll` statü geçmişi yok; şema açıkça "statü TERFİSİ hareket DEĞİLDİR… statü izi audit'tedir" diyor, audit ise 6 ayda arşivleniyor. "1 Ocak'ta depoda ne vardı, o gün kaç top üretimdeydi" sorusu 6 ay sonra cevapsız — envanter değerleme, dönemsel KPI ve denetim bunun üstüne kurulur. Defter: `RollStatusHistory` (append-only geçiş) veya statü olaylarının `WarehouseMovement`'a alınması. Bulunan "WorkOrder statü geçmişi yok" maddesinin TOP'taki ikizi ve daha ağırı. (raporlama-kaybi)

**[yeniden-hesap] Düzeltme koşumunun kendisi deftere yazmıyor** — `Order.shippedQty`, `OrderLine.shippedQty`, `Invoice.paidTotal`, `CariBalance`, `YarnStock` denormalize sayaçları yeniden hesaplanabiliyor ama "ne zaman, hangi kapsamda, önceki→sonraki değer" hiçbir yere yazılmıyor; sessiz düzeltme denetim boşluğudur (sevkiyat defter boşluğu onarımı tam olarak bu sınıf). Defter: `RecomputeRun` (kapsam, kayıt sayısı, önceki/sonraki, fark). (raporlama-kaybi)

---

## Sonraki adım

Bu belge onaylanmış bir plan değildir. Karara bağlanması gereken üç soru:

1. **Hedef kitle nereye kadar?** Konfeksiyon ve örme, bulguların en büyük dilimini açıyor (beden, pastal, demet, hat çıkışı, kg satış) ve bugünkü şemada tek satır karşılığı yok. Kapsam kararı verilmeden alt maddeler sıralanamaz.
2. **Hangi bulgular ürün, hangileri borç?** 🔴 ve 🟠 olanların çoğu bugünkü fabrikayı da ilgilendiriyor (`her ikisi`); 🔵 olanlar saf ürün yatırımı.
3. **Tek gövde ilkesi korunur mu?** Her yeni defter bayrakla açılıp kapanabilmeli; `if (musteri === 'X')` yasağı burada da geçerli (`docs/design/MODUL-BAYRAK-TASARIM.md` §11).
