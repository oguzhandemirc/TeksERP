# e-İrsaliye (E-IRS) — Plan v1

> Durum: PLAN (kod yok). Tarih: 2026-10-24. Yazar: plan ajanı (Opus). Bağlayıcı girdi: `scratchpad/erp/KARARLAR.md` G2 madde 1 + G3; patron kararları P1–P2 (aşağıda §0.3). Dilim istemleri: `scratchpad/erp/E-IRS/istemler/<KOD>.md`.
> Kaynak uyarısı: mevzuat bilgisi G-R2 raporundan (blog/entegratör kaynaklı) ve genel UBL-TR bilgisinden gelir; GİB kılavuzu ve XSD paketi bu turda DOĞRUDAN okunmadı. **⚠ doğrulanacak** işaretli her madde E4-XML diliminden ÖNCE GİB "e-İrsaliye UBL-TR Kılavuzu" + "e-İrsaliye Uygulama Kılavuzu" ve mali müşavirle teyit edilir (§7 veto listesi).

## §0 Amaç ve kapsam

### 0.1 Amaç
Sevkiyat TeksERP'te doğuyor (sevk anı, çuval, top, metre). e-İrsaliye mükellefi fabrika bugün aynı irsaliyeyi muhasebe/e-belge programında ELLE yeniden yazıyor; bu çift giriş ve belge başına usulsüzlük cezası riskidir (G-R2 §4). v1, sevk edilmiş bir sevkiyattan GİB uyumlu **UBL-TR 1.2 e-İrsaliye XML'i (DespatchAdvice)** üretir, yapısal olarak doğrular, dışa aktarır (fabrika kendi entegratör portalına elle yükler), ETTN ve durumu elle kaydettirir; entegratör **bağdaştırıcı arayüzünü** ve bir **simülasyon bağdaştırıcısını** kurar. v2, kullanıcı entegratör seçip test hesabı verince gerçek API bağdaştırıcılarını ekler.

### 0.2 Kapsam
| Var (v1) | Yok (v1) |
|---|---|
| Müşteri sevkiyatı (`Shipment`, DISPATCHED, yurt içi) için giden e-İrsaliye | **Fatura / e-Fatura / e-Arşiv** — "ERP fatura kesmez" kararı sürer (KARARLAR G1) |
| Senaryo `TEMELIRSALIYE`, tip `SEVK` | Gelen e-İrsaliye (alıcı olduğumuz belgeler), alıcı tarafı irsaliye yanıtı üretme |
| XML üret · yapısal doğrula · indir · yeniden üret (gönderilmeden önce) | Fason sevk, fasondan doğrudan sevk, kartela sevki, depo transferi (v1.1; kayıt modeli kaynak türü taşıyarak hazır doğar) |
| ETTN/numara/durum/yanıt ELLE kaydı (dışa-aktar bağdaştırıcısı) | İhracat (EXPORT) sevkiyatı — ⚠ mevzuat akışı doğrulanacak, v1'de kart "desteklenmiyor" der |
| Bağdaştırıcı arayüzü + simülasyon bağdaştırıcısı | Gerçek entegratör API'si (v2), arka plan durum yoklama işi (v2), mali mühür/imza (entegratörde) |
| Storno kapısı: gönderilmiş e-İrsaliyeli sevk geri alınamaz | Tablet ekranı (v1'de tablet değişmez) |
| Panel: sevkiyat detayında e-İrsaliye kartı, liste süzgeci, ayar ekranı | Patron bulutu projeksiyonu (v1'de değişmez) |

### 0.3 Bağlayıcı kararlar (bu plana işlendi)
- **K1 (KARARLAR G2-1):** v1/v2 ayrımı yukarıdaki gibi. Numara: GİB e-İrsaliye biçimi (3 karakter seri + 4 hane yıl + 9 hane sıra) mevcut numara serisi tablosuyla.
- **K2 (KARARLAR G3):** e-İrsaliye XML'i belge tasarımcısından BAĞIMSIZDIR (makine okur belge); belge tasarımcısının veri sözleşmesi kataloğuna bağlanmaz.
- **P1 — Karar: modül anahtarı YOK, YAPILANDIRMA KAPISI var [PROFİL].** `MODUL-BAYRAK-TASARIM.md` §11 "Mevzuat bayraklanmaz — e-fatura/e-irsaliye entegrasyon/sürüm işidir" kuralı geçerlidir: `eIrsaliye.enabled` modül anahtarı AÇILMAZ, `MODULE_FLAG_KEYS` genişlemez. Özellik bir **yapılandırma kapısıyla** açılır: firma (gönderici) resmi künyesi + e-İrsaliye numara serisi + bağdaştırıcı seçimi (`yok` varsayılan · `disaAktar` · `simulasyon` · ileride entegratör kodları) + yürürlük tarihi tanımlanmadıkça özellik **"Yapılandırılmamış"** durumundadır; sevkiyat akışı bayt-bayt BUGÜNKÜ gibi çalışır. Yarım yapılandırmada XML ÜRETİLMEZ (fail-closed): uç 409 `EIRSALIYE_NOT_CONFIGURED` + Türkçe eksik listesi + ayar yolu (`settingScreenPath`). Bu bir davranış bayrağı değil, gerçeği tarif eden VERİ'dir (dört mekanizma merdiveninde "VERİ" basamağı) — §11 ile uyumlu.
- **P2 — Karar: SAAS-TASARIM A5 daraltılır.** "Resmi belge müşteri yazılımında doğar" ilkesi e-İrsaliye için DARALTILIR: irsaliye TeksERP'te doğduğu için e-İrsaliye XML'i de TeksERP'te üretilir. **Fatura ilkesi aynen kalır** (ERP fatura kesmez). E0-DOC dilimi: arşiv notu (`docs/history/arsiv/2026-10.md`) + `docs/kurallar/sevkiyat.md`'ye TEK kural satırı + `docs/design/SAAS-TASARIM.md` A5'e daraltma notu.

### 0.4 Çekirdek / profil ayrımı
- [ÇEKİRDEK] durum makinesi, numara biçimi kapısı, XML'in değişmezliği, storno kapısı, idempotency, kilit, olay defteri, fail-closed hazırlık kapısı.
- [PROFİL] bağdaştırıcı seçimi, seri ön eki (3 karakter), yürürlük tarihi, firma künyesi (veri).

## §1 Mevzuat özeti ve senaryolar

### 1.1 Kim mükellef (G-R2 §C)
- e-Fatura mükellefi + brüt satış hasılatı ≥10 M TL → e-İrsaliye zorunlu (VUK 509 Sıra No'lu Tebliğ; eşik 2026 için blog kaynaklı **⚠ doğrulanacak**). Tekstil cirodan bağımsız özel kapsamda değil. 50–500 çalışanlı hedef fabrikanın hemen hepsi mükellef.
- Ceza: belge başına özel usulsüzlük (~17.000 TL, 2026 aktarımı **⚠ doğrulanacak**).
- Kanal: GİB Portal · özel entegratör · doğrudan entegrasyon. Hedef kitle pratikte **özel entegratör** kullanır (Sovos/Foriba, QNB eFinans, Uyumsoft, Logo, İzibiz, Nilvera, EDM…). Sözleşmeyi fabrika imzalar; TeksERP yalnız bağlayıcı yazar; maliyet kontör başınadır (G-R2 §C "Özel entegratör modeli").
- İmza: mali mühür/e-imza entegratörde atılır; TeksERP imzasız UBL üretir (**⚠ doğrulanacak**: `cac:Signature` öğesinin imzasız belgede de VKN'li yer tutucu olarak zorunlu olup olmadığı).

### 1.2 Senaryo ve tip
- `cbc:ProfileID = TEMELIRSALIYE` — v1'in tek senaryosu. Diğer profiller (ör. hal kayıt sistemi irsaliyesi) kapsam dışı (**⚠ doğrulanacak**: tekstilde başka profil gerekmez).
- `cbc:DespatchAdviceTypeCode = SEVK`. `MATBUDAN` (sistem arızasında kâğıda düzenlenen irsaliyenin sonradan e-İrsaliye'ye aktarımı) v1.1 adayıdır (**⚠ doğrulanacak**).
- Zamanlama: e-İrsaliye malın **fiili sevkinden önce** düzenlenir; `cac:Delivery/cac:Despatch/cbc:ActualDespatchDate|Time` fiili sevk anıdır (**⚠ doğrulanacak**: düzenleme anı ile fiili sevk anı arasındaki izin verilen fark). TeksERP'te "Sevk Et" kamyonun yüklenip çıktığı andır (`Shipment.dispatchedAt`) ve kâğıt irsaliye bugün o anda basılıyor; v1 akışı: Sevk Et → (aynı ekranda) e-İrsaliye hazırla/üret → portala yükle → araç çıkar. PLANNED aşamasında e-İrsaliye üretilmez (içerik henüz donmamıştır).

### 1.3 İptal ve düzeltme — GİB'de "iptal" yok
- Gönderilmiş (GİB'e iletilmiş) e-İrsaliye **iptal edilemez** (**⚠ doğrulanacak**; bazı entegratörler portal üzerinden "iptal talebi" anlatıyor — mevzuattaki karşılığı teyit edilecek).
- Alıcı, belgeyi aldıktan sonra **İrsaliye Yanıtı** (UBL `ReceiptAdvice`) ile teslim aldığı / eksik / fazla / reddettiği miktarı bildirir (süre 7 gün **⚠ doğrulanacak**).
- Hatalı belgenin düzeltilmesi: alıcı yanıtıyla reddedilir/kısmi kabul edilir; gönderici gerekiyorsa YENİ e-İrsaliye düzenler (yeni numara + yeni ETTN).
- Alıcı e-İrsaliye sistemine kayıtlı değilse ne olur (kâğıt irsaliye mi, e-İrsaliye'nin kâğıt çıktısı mı) **⚠ doğrulanacak**; v1 her yurt içi alıcı için üretime izin verir, kart bir bilgi satırı gösterir.

### 1.4 Bizim storno/iade ile eşleşme
TeksERP'in çekirdek ayrımı (`sevkiyat.md`): **Storno** = mal hiç çıkmadı → çıkış belgesi VOIDED, stok rafa; **İade** = mal ulaştı ve döndü → çıkış belgesi düzeltilmez, ayrı iade belgesi + `RollReturn`.

| TeksERP olayı | e-İrsaliye durumu | Davranış |
|---|---|---|
| Storno (DISPATCHED→PLANNED) | kayıt yok · TASLAK · OLUSTURULDU · HATA · IPTAL | **İzinli.** Kayıt yerinde kalır; kâğıt irsaliye v+1 doğunca kart "kaynak değişti — yeniden üretin" uyarısı verir (türetilir, kolon yok). Yeniden sevkte AYNI numara + ETTN ile yeniden üretilir (GİB'e hiç gitmedi). |
| Storno | GONDERILDI · KABUL · KISMI_KABUL · REDDEDILDI | **409.** `resolveUndoBlockReason` yeni engel: "Bu sevkiyatın e-İrsaliyesi GİB'e gönderilmiş (<no>) — geri alınamaz. Mal çıkmadıysa alıcı irsaliye yanıtıyla reddeder; mal çıktıysa iade akışını kullanın." (fatura engelinin ikizi) |
| İptal / storno+kapat (`cancelPlannedShipmentTx` → CANCELLED) | TASLAK · OLUSTURULDU · HATA | Kayıt aynı tx'te **IPTAL** (yerel: "GİB'e gönderilmedi"). Önizleme bunu SOMUT listeler; OLUSTURULDU'da numara boşta kalır uyarısı (§6 R3). |
| İade (`RollReturn`) | herhangi | e-İrsaliye'ye DOKUNULMAZ (brüt kural: çıkış belgesi düzeltilmez). Alıcının bize göndereceği iade e-İrsaliyesi "gelen belge"dir, v1 dışı. |
| Alıcı yanıtı RED/KISMİ | REDDEDILDI/KISMI_KABUL | Elle kaydedilir (yanıt notu + miktar özeti). Mal dönerse iade akışı ayrıca yürür; yeni e-İrsaliye gerekiyorsa aynı sevkiyat için YENİ kayıt (`replacesId`). |
| Kâğıt irsaliye revizyonu (`reissue`, onarım v+1) | gönderilmiş | v1: kart uyarır ("kâğıt v3, e-İrsaliye v2'den üretildi"); revizyon ENGELLENMEZ (karar K-A, §7). |

## §2 Veri eşlemesi (TeksERP → UBL-TR DespatchAdvice)

**Tek kaynak içerik:** XML, sevkiyatın **ACTIVE `SHIPMENT_DISPATCH` `PrintedDocument` snapshot'ından** üretilir — kâğıt irsaliyeyle aynı donmuş, BRÜT içerik (`collectShipmentDocContent`; iade sonrası yeniden üretimde bile brüt). Kayıt hangi sürümden üretildiğini (`printedDocumentId`, `printedDocVersion`) saklar. Ürün adı rejimi tek helper'dan (`document-render/shipment-name-mode.cozAdRejimi`), sayılar `docNum(snapshot)`tan (ticari yuvarlama damgası) geçer. Tarih/saat fabrika diliminden (`src/constants/time.ts`).

| UBL öğesi | Kaynak | Durum / tamamlama |
|---|---|---|
| `cbc:UBLVersionID` = 2.1 · `cbc:CustomizationID` = TR1.2(.1) | sabit (`constants/e-irsaliye.ts`) | **⚠ doğrulanacak** tam değer |
| `cbc:ProfileID` = TEMELIRSALIYE | sabit | — |
| `cbc:ID` (16 kr.) | numara serisi `eIrsaliye` (§3.6), OLUSTURULDU anında doğar | — |
| `cbc:CopyIndicator` = false | sabit | — |
| `cbc:UUID` (ETTN) | `crypto.randomUUID()` OLUSTURULDU anında | büyük/küçük harf **⚠** |
| `cbc:IssueDate` / `cbc:IssueTime` | üretim anı, fabrika dilimi | — |
| `cbc:DespatchAdviceTypeCode` = SEVK | sabit | — |
| `cbc:Note` | `Shipment.dispatchNote` + sipariş no'ları (`header.orderNos`) + "N top" özeti | sipariş `cac:OrderReference` yerine not (OrderReference tarih ister, snapshot'ta yok) **⚠** |
| `cbc:LineCountNumeric` | satır sayısı | — |
| `cac:DespatchSupplierParty/cac:Party` (gönderici) | **YENİ** `company.legalIdentity` ayarı: VKN/TCKN, unvan, vergi dairesi, cadde/sokak, bina no, ilçe, il, posta kodu, ülke, MERSİS, ticaret sicil, telefon, e-posta | bugünkü `company.name` + serbest metin `companyLetterhead.taxInfo` yapısal değil → E3 yeni alan; unvan boşsa `company.name` önerilir |
| `cac:DeliveryCustomerParty/cac:Party` (alıcı) | `Customer.name`, `Customer.taxNumber` (10=VKN, 11=TCKN; başka uzunluk → 400), adres: şube seçiliyse `CustomerBranch.address/city/district`, yoksa `Customer.address/city/district/country` | vergi dairesi: `CariAccount.taxOffice` (yalnız finans/cari varsa) — yoksa boş; zorunluysa karar K-B (§7). TCKN'li alıcıda `cac:Person` (ad/soyad) gerekir **⚠** → üretim penceresinde sorulur. İl/ilçe boşsa fail-closed: "Cari kartında il/ilçe eksik" + `ekranYolu` |
| `cac:Shipment/cbc:ID` | `Shipment.shipmentNo` | — |
| `cac:Shipment/cbc:GrossWeightMeasure` (KGM) | `totals.totalKg` (>0 ise) | — |
| `cac:Shipment/.../TotalTransportHandlingUnitQuantity` | `manualSackCount ?? sackCount` | öğe adı **⚠** |
| `cac:ShipmentStage/cac:TransportMeans/.../cbc:LicensePlateID schemeID="PLAKA"` | `Shipment.plateNumber` (öneri) → e-İrsaliye kaydında `plaka` | eksikse pencerede zorunlu |
| `cac:TransportHandlingUnit/cac:TransportEquipment/cbc:ID schemeID="DORSEPLAKA"` | YOK → kayıtta `dorsePlaka` (opsiyonel) | — |
| `cac:ShipmentStage/cac:DriverPerson` (FirstName, FamilyName, NationalityID=TCKN) | `Shipment.driverName` tek metin → kayıtta `soforAd`, `soforSoyad`, `soforTckn` | TCKN YOK → pencerede sorulur; KVKK: audit/log'a maskeli |
| `cac:Delivery/cac:CarrierParty` (taşıyıcı unvan + VKN) | `Shipment.carrier` serbest metin → kayıtta `tasiyiciUnvan`, `tasiyiciVkn` | plaka+şoför YA DA taşıyıcı VKN kuralı **⚠ doğrulanacak** |
| `cac:Delivery/cac:Despatch/cbc:ActualDespatchDate|Time` | `Shipment.dispatchedAt` (fabrika dilimi) | — |
| `cac:DespatchLine/cbc:ID` | 1..n | — |
| `cac:DespatchLine/cbc:DeliveredQuantity unitCode="MTR"` | `products[].totalMeters` (`docNum`) | birim KAYNAĞI izler (`sevkiyat.md`: defter metre tutar); "kg" basılmaz |
| `cac:DespatchLine/cbc:Note` | "N top" | — |
| `cac:DespatchLine/cac:Item/cbc:Name` | `products[].name` / `customerName` (ad rejimi canlı okunur, XML'e DONAR) | — |
| `cac:Item/cac:SellersItemIdentification/cbc:ID` | snapshot'ta ürün kodu yok | v1 boş (opsiyonel **⚠**) |
| GTİP (`CommodityClassification`) | yok | e-İrsaliye'de zorunlu değil **⚠ doğrulanacak**; ihracat v1 dışı |
| Değer/fiyat (`cac:Shipment/cbc:DeclaredForCarriageValueAmount` vb.) | yok (miktar-odaklı sevk) | v1 basmaz **⚠** |
| XSLT görünüm (`AdditionalDocumentReference`) | yok | entegratör varsayılan şablonu; zorunlu değil **⚠** |

Eksik verinin TEK tamamlanma noktası e-İrsaliye kaydıdır (taşıma bilgileri + TCKN'li alıcının ad/soyadı); `Shipment`a yeni kolon AÇILMAZ (BaseController "yeni skaler kolon yazılabilir alandır" riski ve dispatch yolu değişmez). Öneri: aynı plakanın son e-İrsaliye kaydındaki şoför/dorse bilgisi pencerede önerilir (sorgu, master tablo yok).

## §3 Mimari

### 3.1 Tablolar (E1-SEMA)
- **`EIrsaliye`** (durum tablosu, `e_irsaliyeler`): `id` UUID · `sourceType` enum `EIrsaliyeSourceType {SHIPMENT}` (v1.1'de `SUBCONTRACTOR_DISPATCH`, `DIRECT_SHIPMENT`, … `ALTER TYPE ADD VALUE` reçetesiyle) · `sourceId` UUID (FK yok, `PrintedDocument` emsali; bütünlük serviste) · `shipmentId` UUID? (v1'de dolu, FK `Shipment` — liste süzgeci join'i için) · `status` `EIrsaliyeStatus` · `documentNo` VarChar(16)? `@unique` · `ettn` UUID? `@unique` · `confirmedNo`/`confirmedEttn` (entegratör portalı farklı verdiyse; ⚠) · `adapter` VarChar(32) (üretildiği andaki bağdaştırıcı; `simulasyon` kaydı rozetle ayrılır) · `printedDocumentId` UUID?, `printedDocVersion` Int? · `currentXmlId`, `sentXmlId` UUID? · taşıma alanları (`plaka`, `dorsePlaka`, `soforAd`, `soforSoyad`, `soforTckn`, `tasiyiciUnvan`, `tasiyiciVkn`) · `aliciKisiAd`/`aliciKisiSoyad` (TCKN'li alıcı) · `sentAt`, `responseAt`, `responseNote` VarChar(1000), `responseSummary` Json? · `lastDownloadedAt`, `downloadCount` (durum kolonu: "indirildi mi" sorusu yeniden üretim onayına girer) · `replacesId` UUID? (REDDEDILDI'nin yerine geçen) · `clientToken` UUID? `@unique` · `createdAt/updatedAt` Timestamptz · künye (`createdById`, `updatedById`).
  - **Partial unique** (migration SQL'inde, şemada yorumla beyan): `(sourceType, sourceId) WHERE status NOT IN ('IPTAL','REDDEDILDI')` — kaynak başına TEK canlı kayıt.
  - **DB CHECK seddi (çift yüklem):** `status IN (OLUSTURULDU, GONDERILDI, KABUL, KISMI_KABUL, REDDEDILDI, HATA) ⇒ documentNo, ettn, currentXmlId NOT NULL`; `status IN (GONDERILDI, KABUL, KISMI_KABUL, REDDEDILDI) ⇒ sentXmlId, sentAt NOT NULL`; `documentNo ~ '^[A-Z0-9]{3}20[0-9]{2}[0-9]{9}$'`.
- **`EIrsaliyeXml`** (`e_irsaliye_xmllari`, append-only, `updatedAt` YOK): `id`, `eIrsaliyeId` FK, `version` Int (`@@unique([eIrsaliyeId, version])`, max+1), `ettn`, `xml` Text, `sha256` Char(64), `validation` Json (yapısal doğrulama raporu), `createdById`, `createdAt`. **Değişmez:** DB trigger UPDATE/DELETE'i reddeder (`e_irsaliye_xml_degismez`). Sınıf: defter beyanında `SATIR_EBEVEYN` — tersi kaydın IPTAL'idir; "DONMUŞ İLERİ DEĞER" (`defter.md` üçüncü sınıf b). Gönderilen sürüm `EIrsaliye.sentXmlId` ile mühürlenir; sonrası yeni sürüm YAZILAMAZ (servis kapısı + trigger: kaydın durumu GONDERILDI+ iken INSERT reddi).
- **`EIrsaliyeEvent`** (`e_irsaliye_olaylari`, append-only DEFTER, `ShipmentEvent` emsali): `id`, `eIrsaliyeId`, `type` `EIrsaliyeEventType`, `fromStatus`, `toStatus`, `xmlId?`, `note`, `actorId`, `createdAt` (belirlenimli artan damga; "en son" okuyucusu `id` eşitlik bozucusuyla). Türler: `HAZIRLANDI` (DOĞUŞ) · `OLUSTURULDU` · `XML_YENIDEN_URETILDI` · `GONDERILDI` ↔ `GONDERIM_GERI_ALINDI` · `YANIT_KAYDEDILDI` ↔ `YANIT_GERI_ALINDI` · `HATA_ALINDI` · `IPTAL_EDILDI` (TERMINAL). Beyan `scripts/lib/defter-beyan.ts`: `KARSI_OLAY` çiftleri; tek yazar `services/e-irsaliye/e-irsaliye-event.helper.ts` `writeEIrsaliyeEventTx`.
- Audit: kayıt CUD'ları `AuditService.log` (tableName `E_IRSALIYE`; XML ve TCKN yüke GİRMEZ — yalnız no/durum/sha). `EIrsaliyeXml` ve `EIrsaliyeEvent` `scripts/lib/audit-muafiyeti.ts`te gerekçeyle muaf (defter/donmuş belge kendisi iz).
- Saklama: XML ve olaylar budanmaz (VUK saklama süresi; defter iş verisidir). Liste sorgusu XML'i ÇEKMEZ (snapshot kuralı).

### 3.2 Durum makinesi
```
(yok) --hazırla--> TASLAK --üret--> OLUSTURULDU --gönder/elle işaretle--> GONDERILDI --yanıt--> KABUL | KISMI_KABUL | REDDEDILDI
                     |                 |  ^  \--yeniden üret (aynı no+ETTN, xml v+1)          \--hata--> HATA --düzelt+üret--> OLUSTURULDU (yeni ETTN ⚠)
                     |                 |  '-- gönderim kaydını geri al (yalnız disaAktar, eirsaliye:undo)
                     '--iptal----------'--iptal--> IPTAL (yerel; GİB'e gitmedi)        REDDEDILDI --yeni kayıt (replacesId)-->
```
- Her geçiş: `prisma.$transaction` → İLK ifade `lockShipmentScopeTx(tx, shipmentId)` (mevcut `SHIPMENT_LOCK_NS` 8023, sahibi `shipment-locks.helper.ts`; YENİ uzay açılmaz — storno ile aynı kilitte serileşir) → atomik claim `tx.eIrsaliye.updateMany({where:{id, status: beklenen}})` + `count===0 → 409 EIRSALIYE_STATE_CONFLICT` → olay satırı aynı tx'te → audit tx DIŞINDA.
- Tek geçiş helper'ı: `transitionEIrsaliyeTx(tx, {id, from, to, event, patch})` — durum ve olay ayrışamaz.
- Hazırlık ön koşulları (hazırla/üret): sevkiyat DISPATCHED · `destination=DOMESTIC` · `dispatchedAt ≥ yürürlük tarihi` · hazırlık kapısı HAZIR · ACTIVE `SHIPMENT_DISPATCH` belgesi var (yoksa lazy-init mevcut yolla).
- **İdempotency:** "hazırla" kayıt yaratır → `clientToken @unique`, replay TEK boğaz `helpers/token-replay.helper.ts` (dört durum; beyan `scripts/lib/token-replay-beyan.ts` + `istemci-token-beyan.ts`). "üret" kayıt yaratmaz ama numara tüketir: atomik claim TASLAK→OLUSTURULDU yarışta ikinciyi 409'a düşürür; numara `nextSeriesNo` ile tx içinde, `withBarcodeRetry` sarmalı, `documentNo @unique` — **sayaç satırlı seri (`reserveSeriesNo`) KULLANILMAZ**, çünkü o yol tx geri dönünce boşluk bırakır; GİB sırası boşluksuz olmalıdır (⚠).
- **Dış G/Ç tx dışında:** bağdaştırıcı `gonder()` çağrısı tx'ten ÖNCE yapılır; sonuç geldikten sonra claim. Claim düşerse (yarış) sonuç loglanır, "Durumu sorgula" düzeltir. v2'de gönderim ETTN ile idempotent olmalıdır (entegratör aynı ETTN'i ikinci kez kabul etmez).

### 3.3 Bağdaştırıcı arayüzü (E5-MOTOR)
`src/services/e-irsaliye/adapters/adapter.types.ts`:
```ts
export interface EIrsaliyeAdapter {
  readonly kod: string;                       // "disaAktar" | "simulasyon" | v2: entegratör kodu
  readonly etiket: string;                    // Türkçe ad
  readonly yetenek: { gonder: boolean; durumSorgula: boolean; yanitAl: boolean };
  gonder(g: { xml: string; ettn: string; belgeNo: string; aliciVkn: string }): Promise<GonderSonuc>;
  durumSorgula(r: { ettn: string; saglayiciRef?: string | null }): Promise<DurumSonuc>;
}
type GonderSonuc = { ok: true; saglayiciRef?: string } | { ok: false; hata: string; gecici: boolean };
type DurumSonuc = { durum: "GONDERILDI" | "KABUL" | "KISMI_KABUL" | "REDDEDILDI" | "HATA"; aciklama?: string; yanit?: unknown };
```
- `disaAktar`: tüm yetenekler `false`; panel elle düğmeleri gösterir (XML indir · "Portala yükledim" + ETTN/no teyidi · "Yanıt kaydet").
- `simulasyon`: GİB'e HİÇBİR şey göndermez; `gonder` → GONDERILDI; `durumSorgula` belirlenimli (ETTN son hanesine göre KABUL / REDDEDILDI / HATA) — test ve eğitim için. Kayıt `adapter='simulasyon'` taşır, kart kalıcı kırmızı bant "SİMÜLASYON — GİB'e gitmedi" basar (kök kural: uydurulmuş değer `SIMULATED` diye işaretlenir). Simülasyon kaydı da storno kapısına takılır (gerçeği taklit eder; mesaj "simülasyon" der).
- `registry.ts`: `resolveAdapter(config)` — tanınmayan kod 400 (fail-closed).
- v2 sınırları (şimdiden yazılır): kimlik bilgisi DB'de şifreli, log/audit/sürüm notuna girmez (sır hijyeni); polling işi arka planda (backend tek süreç; donanım değil, ama yine de ayrı iş değil `jobs/` kalıbı); entegratöre giden HTTPS çağrısı kökteki "dışarı giden istek kurulum anahtarıyla imzalanır" kuralının KAPSAMI DIŞINDA mı — karar K-D (§7).

### 3.4 XML üretimi ve doğrulama (E4-XML)
- **Paket YOK:** backend'de XML kütüphanesi yok; UBL üretimi deterministik, düz ağaç → küçük kendi yazıcımız (`ubl-xml-writer.ts`: öğe/öznitelik kaçışı `& < > " '`, ad alanı bildirimleri, sabit öğe sırası, UTF-8, girinti yok). Yeni npm paketi gerekmez. (Alternatif aday `xmlbuilder2` — yalnız E4 ajanı yazıcının yetmediğini ÖLÇERSE ve kullanıcı onaylarsa; varsayılan: paket yok.)
- `despatch-advice.builder.ts`: `buildDespatchAdvice(input: DespatchInput): string` saf fonksiyon; `DespatchInput` §2 tablosunun tipli karşılığı.
- `despatch-advice.source.ts`: snapshot (+ firma künyesi + kayıt alanları + ad rejimi) → `DespatchInput` saf eşleme.
- `despatch-advice.validate.ts`: yapısal doğrulama (zorunlu alanlar, VKN 10 hane + sağlama, TCKN 11 hane + sağlama, numara regex'i, UUID, `unitCode` izin listesi `MTR/KGM/C62`, `LineCountNumeric = satır sayısı`, tarih biçimleri, metin uzunlukları) → `{ ok, hatalar: {alan, mesaj}[] }` Türkçe. Üretim yolu `ok=false` ise XML saklamaz, 400 `EIRSALIYE_VALIDATION` + liste döner.
- **XSD doğrulaması (yalnız CI/geliştirme):** GİB UBL-TR XSD paketi `Teks-Erp/resources/ubl-tr/` altına konursa bekçi `scripts/test_e_irsaliye_xsd.ts` altın örnekleri `xmllint --noout --schema` ile doğrular. Paketin repoya alınması (lisans) ve CI imajına `libxml2-utils` eklenmesi **kullanıcı onayı** ister (§7 V3). Onay gelene dek bekçi "ATLANDI" der ve bunu SONUÇ satırında ayrı sayar (sessiz yeşil değil). Şematron (XSLT 2) v1 dışı.
- Altın örnekler: `scripts/fixtures/e-irsaliye/*.xml` — VKN'li alıcı, TCKN'li alıcı, taşıyıcılı, çok satırlı; bayt-eşit karşılaştırma.

### 3.5 Yapılandırma kapısı (E3-AYAR) — P1
- **Firma resmi künyesi** `company.legalIdentity` (JSON; `companyLetterhead` emsali: `FeatureFlags.companyLegalIdentity`, `settings:company` kapsamı, `sanitizeCompanyLegalIdentity`). Kimliktir; ileride başka belgeler de okur.
- **e-İrsaliye ayarı** `eIrsaliye.config` (JSON; `FeatureFlags.eIrsaliyeConfig`, YENİ dar izin `settings:e-irsaliye`): `{ adapter: "yok" | "disaAktar" | "simulasyon", yururlukTarihi: "YYYY-MM-DD" | null }` — varsayılan `{adapter:"yok", yururlukTarihi:null}` = BUGÜNKÜ davranış.
- **Hazırlık tek kaynağı** `resolveEIrsaliyeReadiness(db)` → `{ durum: "YAPILANDIRILMAMIS" | "HAZIR", eksikler: string[] }`: künye alanları geçerli (VKN/TCKN sağlaması dahil) · `eIrsaliye` seri satırı GİB biçiminde · adapter ≠ `yok` ve kayıtlı · yürürlük tarihi dolu. Her yazma ucu ve panel kartı bu tek fonksiyonu sorar (AST bekçisi: ikinci hazırlık yüklemi yasak).
- Ayar yazımı `PATCH /api/feature-flags` zinciri (`flagWriteGuard` → `requireSettingsPassword`) — yeni ayar ucu AÇILMAZ (AST tripwire kapsamı kendiliğinden).
- Panel: Ayarlar → Firma (künye alanları) ve Ayarlar → e-İrsaliye (bağdaştırıcı seçimi, yürürlük tarihi, durum rozeti "Yapılandırılmamış / Hazır", eksikler listesi, seri bilgisine bağlantı). `test_feature_flag_contract` A–D kümeleri, `settings-config.ts`, `flag-modules.ts` (`cekirdek`), `settings-scopes.ts`.

### 3.6 Numara serisi (E2-SERI)
- Katalog satırı `eIrsaliye`: `seedPrefix "EIR"` (öneri; fabrika değiştirir), `seedDateSegment YYYY`, `seedDigits 9`, `seedSeparator ""`, `seedMaxValue 999999999`, `seedWrap false`, `panelGroup "sevkiyat"`, `countTable {model:"eIrsaliye", field:"documentNo", birim:"belge"}`, `scopedCounter hazir` (üreteç `nextSeriesNo`), okutulmaz.
- **GİB biçim kapısı:** yeni katalog alanı `fixedShape` (`{prefixRe:"^[A-Z0-9]{3}$", dateSegment:"YYYY", digits:9, separator:"", not}`) → `assertSeriesFormatAllowed` bu seride yalnız 3 karakterlik ön eki yazdırır; tarih/hane/ayraç alanları panelde PASİF + `lockedReason`-benzeri cümle ("GİB e-İrsaliye numarası 3 karakter seri + yıl + 9 hane olmak zorunda"). Taşma: "kod genişler" kuralının BEYANLI istisnası — 999.999.999'da 409 (`wrap=false`). Uyumluluk matrisi (`test_number_series` §matris) `fixedShape` serisinde yalnız ön ek dönüşümünü dener; beyan kapsam tablosunda GÖRÜNÜR.
- Yıl: `IssueDate` yılı = numaradaki yıl (fabrika günü). Aynı yılda boşluksuz sıra: numara yalnız TASLAK→OLUSTURULDU claim'inde ve aynı tx'te doğar; OLUSTURULDU→IPTAL boşluk bırakır (§6 R3).

### 3.7 Uçlar ve izinler (E5-MOTOR)
`src/routes/e-irsaliye.routes.ts` → `app.use("/api/e-irsaliye", …)`; `router.use(verifyToken)`; modül kapısı YOK (anahtar yok) — her yazma ucu hazırlık kapısını servis içinde çağırır.

| Uç | İzin | Not |
|---|---|---|
| `GET /readiness` | `eirsaliye:read` | kart/ayar rozeti |
| `GET /by-shipment/:shipmentId` | `eirsaliye:read` | canlı kayıt + geçmiş kayıtlar + türetilmiş "kaynak değişti" uyarısı + olaylar |
| `POST /by-shipment/:shipmentId` (hazırla; `clientToken`) | `eirsaliye:write` | TASLAK; taşıma alanları önerisiyle |
| `PATCH /:id` (taşıma/alıcı kişi alanları) | `eirsaliye:write` | yalnız TASLAK/OLUSTURULDU/HATA |
| `POST /:id/generate` · `POST /:id/regenerate` | `eirsaliye:write` | regenerate: `lastDownloadedAt` doluysa gövdede `onay:true` ister |
| `GET /:id/xml?version=` | `eirsaliye:read` | indirme `lastDownloadedAt/downloadCount` yazar (GET yan etkisi bilinçli: ayrı `POST /:id/download` tercih edilir — E5 karar verir, panel POST ile alır) |
| `POST /:id/send` (bağdaştırıcı) · `POST /:id/mark-sent` (elle; `confirmedEttn?`, `confirmedNo?`) | `eirsaliye:write` | adapter yeteneğine göre biri 400 |
| `POST /:id/poll` | `eirsaliye:write` | `durumSorgula` yeteneği |
| `POST /:id/response` (elle yanıt: KABUL/KISMI_KABUL/REDDEDILDI/HATA + not + özet) | `eirsaliye:write` | |
| `POST /:id/undo-sent` · `POST /:id/undo-response` | `eirsaliye:undo` | yalnız `disaAktar`; karşı olay; önizleme ucu `GET /:id/undo-preview` |
| `POST /:id/cancel` | `eirsaliye:write` | TASLAK/OLUSTURULDU/HATA → IPTAL; önizleme numara boşluğunu söyler |

İzin kataloğu (`permission-catalog.ts`, module `LOGISTICS`): `eirsaliye:read`, `eirsaliye:write`, `eirsaliye:undo`, `settings:e-irsaliye`. Rol şablonu: read+write → Sevkiyat sorumlusu, Muhasebe, Süpervizör; `eirsaliye:undo` → yalnız Muhasebe/Süpervizör (SoD ruhu: storno kapısını açan anahtar); `settings:e-irsaliye` → Yönetici. Ekran manifestosu: sevkiyat ekranlarının `capabilities`ine eklenir; ayar ekranı `modul: "cekirdek:sevkiyat-depo"`. Swagger blokları.

### 3.8 Sevkiyat entegrasyonu (E6-SEVK)
- `ShippingService.resolveUndoBlockReason` girdisine `eIrsaliye: {documentNo, status, adapter} | null` eklenir; okuma `undoDispatch` tx'inde kilitten SONRA (`readLiveEIrsaliyeForShipmentTx`), önizlemede aynı helper → tek yüklem.
- `cancelPlannedShipmentTx` (tek kaynak iptal gövdesi): canlı kayıt TASLAK/OLUSTURULDU/HATA ise aynı tx'te IPTAL + olay (`voidLocalEIrsaliyeTx`); GONDERILDI+ ise 409 (normalde storno kapısı buraya ulaşmayı engeller; ikinci sed). İptal ve storno+kapat önizlemeleri etkilenen e-İrsaliye kaydını listeler.
- Liste süzgeci: `listShipments` filtresi `eIrsaliye = EKSIK | TASLAK | OLUSTURULDU | GONDERILDI | KABUL | REDDEDILDI | HATA | SIMULASYON` SUNUCUDA, liste + cursor + özet şeridi aynı where'den (`filtre-liste.md`). `EKSIK` = DISPATCHED ∧ DOMESTIC ∧ `dispatchedAt ≥ yürürlük` ∧ canlı kayıt yok. Hazırlık YAPILANDIRILMAMIS iken süzgeç yok sayılmaz → 400 (fail-closed, tanınmayan kapsam).
- `dispatchShipment` / `createShipment` yolları DEĞİŞMEZ (sevk kancası yok; e-İrsaliye sevk tx'ini asla düşürmez).

## §4 UI

### 4.1 Panel (Electron)
- **Sevkiyat detayı** (sheet `ShipmentSheetBody.tsx` + tam sayfa `detail/ShipmentDetailPage.tsx`): yeni `EIrsaliyeCard` (`pages/Operations/Shipments/eirsaliye/`). Kart yalnız hazırlık HAZIR ve kullanıcı `eirsaliye:read` sahibiyken çizilir; YAPILANDIRILMAMIS iken hiç çizilmez → bugünkü ekran aynı. İçerik: durum rozeti (Hazırlanmadı · Taslak · Oluşturuldu · Gönderildi · Kabul · Kısmi kabul · Reddedildi · Hata · İptal; simülasyon kırmızı bandı), belge no + ETTN (kopyala), XML sürüm/sha kısaltması, "kaynak değişti" uyarısı, olay zaman çizelgesi (fabrika saati).
- Eylemler (izin + durum + bağdaştırıcı yeteneğine göre): **e-İrsaliye hazırla** (pencere: plaka, dorse, şoför ad/soyad/TCKN, taşıyıcı unvan/VKN, TCKN'li alıcıda kişi ad/soyad; son kullanılan şoför önerisi) → **XML üret** (doğrulama hataları alan alan listelenir) → **XML indir** → **Portala yükledim** (ETTN/no teyidi; farklıysa girilir) → **Yanıt kaydet** → **Gönderim kaydını geri al** (önizlemeli) → **İptal** (önizlemeli). Yıkıcı her eylemde etkilenen kayıt somut listelenir.
- EXPORT sevkiyatta kart "İhracat sevkiyatı için e-İrsaliye v1'de desteklenmiyor" der.
- **Storno penceresi** (`UndoDispatchDialog`): backend engel cümlesini olduğu gibi basar (yeni kod yok).
- **Sevkiyatlar listesi** (`ShipmentsPage.tsx`, `columns.tsx`): "e-İrsaliye" süzgeci (yalnız HAZIR iken) + opsiyonel durum rozeti kolonu; süzme sunucuda.
- **Ayarlar:** Firma bölümü (`CompanySettingsSection.tsx`) yapısal künye alanları; yeni "e-İrsaliye" bölümü; Numaralandırma ekranında `eIrsaliye` serisi kilitli alanları ve cümlesiyle.
- Panel aynaları: `Electron/src/lib/permissions.ts`, `services/featureFlagService.ts`, `lib/route-modules.ts` (gerekirse), `types/enums.ts` + `lib/audit-labels.ts` `ENUM_LABELS` (yeni enum'lar).

### 4.2 Tablet
v1'de tablet DEĞİŞMEZ: e-İrsaliye ofis/muhasebe işidir; tablet "Sevk Et"i aynen yapar. Tablet storno yolunda yeni 409 cümlesi backend'den gelir ve mevcut hata gösterimiyle basılır (yeni kod yok). v1.1 adayı: tablet sevk başarı ekranında "e-İrsaliye bekleniyor" bilgisi.

### 4.3 Eski istemci
Yeni uçlar ekleniyor, mevcut sözleşme kırılmıyor. Eski panel kartı göstermez; storno engelini mesaj olarak görür. `minVersion` gerekmez. Backend önce, panel sonra.

## §5 Dilimler

Model: hepsi **Opus high**. Paralellik ≤3 ajan: D1'de E1-SEMA ∥ E2-SERI ∥ E4-XML ajanla koşar; E0-DOC (yalnız belge, S) ilk boşalan ajana ya da 1e'ye verilir. Dosya çakışması: `sevkiyat.md`/`BEKCI-HARITASI.md` satırları bölüm SONUNA eklenir, çakışma `git merge origin/main` ile çözülür.

| Kod | Dalga | Bağımlılık | Özet | Büyüklük |
|---|---|---|---|---|
| E0-DOC | D1 | — | P2 karar yazımı: arşiv notu + `sevkiyat.md` tek satır + SAAS-TASARIM A5 notu + MODUL-BAYRAK-TASARIM §11 çapraz not | S |
| E1-SEMA | D1 | — | Prisma enum/model + migration (partial unique, CHECK, değişmezlik trigger'ı) + defter beyanı + audit muafiyeti + DB seddi bekçisi | M |
| E2-SERI | D1 | — | `eIrsaliye` numara serisi + `fixedShape` GİB biçim kapısı + panel kilit cümlesi | M |
| E4-XML | D1 | — (saf) | yazıcı + builder + kaynak eşleme + yapısal doğrulayıcı + VKN/TCKN + altın örnekler + (onaylıysa) XSD bekçisi | L |
| E3-AYAR | D2 | E2 | `company.legalIdentity` + `eIrsaliye.config` + `settings:e-irsaliye` + hazırlık tek kaynağı + panel ayar bölümleri | M |
| E5-MOTOR | D3 | E1, E2, E3, E4 | servis + geçiş helper'ı + bağdaştırıcılar + uçlar + izinler + rol + ekran manifestosu + swagger + idempotency | L |
| E6-SEVK | D4 | E5 | storno kapısı + iptal gövdesi + önizlemeler + liste süzgeci | M |
| E7-PANEL | D5 | E5, E6 | sevkiyat kartı + pencereler + liste süzgeci UI + aynalar + ekran görüntüleri | L |
| E8-UCTAN | D6 | E7 | uçtan uca HTTP bekçisi (disaAktar + simulasyon), profil matrisi, belge toplama, kullanıcı deneme notu | M |

Her dilim istemi bekçileri, negatif sondayı, kabulü ve riski kendi içinde taşır. Özet:

- **E1-SEMA** dosyalar: `Teks-Erp/prisma/schema.prisma`, `Teks-Erp/prisma/migrations/<ts>_e_irsaliye/migration.sql` (`--create-only`), `Teks-Erp/scripts/lib/defter-beyan.ts`, `Teks-Erp/scripts/lib/audit-muafiyeti.ts`, yeni Teks-Erp:scripts/test_e_irsaliye_db_invariants.ts. Bekçi: `test_defter_ters_yol`, `test_audit_muafiyeti`, `test_db_invariants`, `test_migration_enum_add_value`, yeni bekçi (CHECK/partial unique/trigger; negatif sonda: CHECK'i kaldır → ❌). Kabul: migration en eski canlı dump provası notu PR'da; bekçiler yeşil. Risk: Prisma partial index'i bilmez → drift; şema yorumu + `map:` adlandırma.
- **E2-SERI** dosyalar: `Teks-Erp/src/constants/number-series-catalog.ts`, `number-series-catalog.types.ts`, `Teks-Erp/src/services/number-series.service.ts` (kapı), `Teks-Erp/scripts/test_number_series.ts`, `test_number_series_panel.ts`, `Electron/src/pages/GeneralSettings/Numbering/*`. Bekçi: `test_number_series` (§1 BEKLENEN, §matris), `test_number_series_panel`, panel vitest. Negatif sonda: kapıyı kaldır → 4 hane ön ek kabul edilir → ❌. Risk: matris bekçisinin `fixedShape`i tanımaması.
- **E3-AYAR** dosyalar: `Teks-Erp/src/services/system-setting.service.ts`, `src/routes/feature-flag.routes.ts`, `src/constants/settings-scopes.ts`, `src/constants/permission-catalog.ts` (`settings:e-irsaliye`), `src/constants/panel-ayar-yolu.ts`, yeni `src/services/e-irsaliye/e-irsaliye-readiness.helper.ts`, `src/services/e-irsaliye/tax-id.ts` (E4 ile ortak — E3 yazar, E4 import eder; E4 önce inerse tersine), `Electron/src/services/featureFlagService.ts`, `Electron/src/pages/GeneralSettings/{CompanySettingsSection.tsx, settings-config.ts, flag-modules.ts}` + yeni bölüm. Bekçi: `test_feature_flag_contract`, `test_settings_scopes`, `test_settings_password`, `test_ayar_yol_tarifi`, `test_permission_catalog`, yeni `test_e_irsaliye_readiness.ts` (negatif sonda: eksik VKN'de HAZIR dönmesi). Kabul: varsayılanla `GET /api/feature-flags` bugünkü alanları bayt-eşit + iki yeni alan varsayılanda.
- **E4-XML** dosyalar (yeni): `Teks-Erp/src/services/e-irsaliye/{ubl-xml-writer.ts, despatch-advice.builder.ts, despatch-advice.source.ts, despatch-advice.validate.ts, despatch-advice.types.ts}`, Teks-Erp:src/constants/e-irsaliye.ts, Teks-Erp:scripts/test_e_irsaliye_xml.ts, `Teks-Erp/scripts/fixtures/e-irsaliye/*.xml`, (onaylıysa) `test_e_irsaliye_xsd.ts`. Negatif sonda: kaçışı kaldır (`&` ham) → ❌; satır sayısını boz → ❌. Kabul: altın örnekler bayt-eşit, ⚠ maddeleri dosya başlığında liste.
- **E5-MOTOR** dosyalar: yeni `src/services/e-irsaliye/{e-irsaliye.service.ts, e-irsaliye-transition.helper.ts, e-irsaliye-event.helper.ts, adapters/*}`, `src/routes/e-irsaliye.routes.ts`, `src/app.ts`, `permission-catalog.ts`, `role-template-catalog.ts`, `screen-catalog.ts`, `scripts/lib/token-replay-beyan.ts`, `scripts/lib/istemci-token-beyan.ts`, yeni `scripts/test_e_irsaliye_flow.ts`. Bekçi: `test_permission_catalog`, `test_role_template_catalog`, `test_screen_catalog`, `test_route_auth_coverage`, `test_route_mount_reachability`, `test_swagger_spec`, `test_token_replay_bogaz`, `test_client_token_idempotency`, `test_advisory_lock_namespaces`, `test_defter_ters_yol`, `test_audit_okuma_kaynagi`. Negatif sonda: claim'i `findUnique→update`a çevir → eşzamanlı üret testi ❌; hazırlık kapısını atla → ❌.
- **E6-SEVK** dosyalar: `src/services/shipping.service.ts` (yalnız çağrı satırları), yeni `src/services/e-irsaliye/e-irsaliye-shipment.helper.ts`, Electron `UndoDispatchDialog`/`CancelShipmentDialog` önizleme listesi (backend alanı varsa). Bekçi: `test_shipment_undo_dispatch`, `test_shipment_event_ledger`, `test_shipment_list_gross`, `test_dispatch_report_gross`, yeni `test_e_irsaliye_storno.ts`. Negatif sonda: engel satırını kaldır → gönderilmiş kayıtla storno 200 → ❌.
- **E7-PANEL** dosyalar: `Electron/src/pages/Operations/Shipments/eirsaliye/*` (yeni), `ShipmentSheetBody.tsx`, `detail/ShipmentDetailPage.tsx`, `ShipmentsPage.tsx`, `columns.tsx`, `Electron/src/lib/permissions.ts`, `types/enums.ts`, `lib/audit-labels.ts`. Testler: vitest (kart durum matrisi, izin/yetenek düğme görünürlüğü, YAPILANDIRILMAMIS'ta kart yok). Ekran görüntüleri incelenir.
- **E8-UCTAN**: `scripts/bekci-http` kalıbında yeni `test_e_irsaliye_e2e.ts` (yapılandır → sevk → hazırla → üret → indir → işaretle → storno 409 → yanıt → simülasyon gönder/sorgula; iptal yolu), `Teks-Erp/docs/BEKCI-HARITASI.md` `## sevkiyat`, `docs/kurallar/sevkiyat.md` + `numaralandirma.md` kural satırları birleşik kontrol, deneme notu (1e'nin yayın sonrası uçtan uca sınaması için adım listesi).

## §6 Riskler
- **R1 Mevzuat doğrulanmadı (yüksek):** ⚠ maddelerin bir kısmı yanlış çıkarsa E4 eşlemesi ve §1.3 kuralları değişir. Azaltım: E4'ten önce V1 (müşavir + GİB kılavuzu) ve bir entegratör portalına test yüklemesi; XML üretimi tek modülde, eşleme tablosu tek dosyada.
- **R2 Şema/kılavuz sürümü değişir:** GİB UBL-TR paketi güncellenir (CustomizationID, zorunlu alan). Azaltım: sabitler `constants/e-irsaliye.ts`te; XSD bekçisi paketi sürümüyle anar; değişiklik "sürüm işi"dir (§11).
- **R3 Numara boşluğu:** OLUSTURULDU kayıt GİB'e gitmeden iptal edilirse sıra boşluk bırakır (⚠ boşluğun mevzuat sonucu doğrulanacak). Azaltım: numara yalnız "üret"te doğar; storno kaydı iptal ETMEZ (yeniden sevkte aynı numara); iptal önizlemesi boşluğu açıkça söyler; v1.1 seçeneği "son verilen numarayı geri al" (yalnız LIFO).
- **R4 Elle mod insan hatası:** kullanıcı XML'i indirip yüklemeden "yükledim" der ya da yükleyip işaretlemez. Azaltım: liste süzgeci `OLUSTURULDU` ve `EKSIK`; indirme sayacı; geri al karşı olayı; v2 API bunu kapatır.
- **R5 Kâğıt ↔ e-İrsaliye ayrışması:** gönderimden sonra kâğıt irsaliye revize edilirse iki belge ayrışır. v1 uyarır, engellemez (K-A).
- **R6 Portal ETTN/no'yu yeniden üretir:** bazı portallar XML'deki numarayı/ETTN'i ezer. Azaltım: `confirmedNo/confirmedEttn`; ekran ikisini de gösterir.
- **R7 Kişisel veri (şoför TCKN):** KVKK. Azaltım: yalnız e-İrsaliye kaydında; audit/log'da maskeli; liste uçlarında dönmez.
- **R8 Mega servis:** `shipping.service.ts` 5.900 satır; E6 yalnız çağrı satırı ekler, mantık helper'da.
- **R9 Simülasyonun gerçek sanılması:** kalıcı kırmızı bant + `adapter` kolonu + süzgeçte ayrı değer.

## §7 Veto listesi / kullanıcı kararları

> 2026-10-25 durum: açık maddelerin mali müşavir/GİB ve kullanıcı onay listesi `docs/design/E-IRSALIYE-DOGRULAMA.md`. P1/P2 belgelere işlendi (arşiv 2026-10-24).

- **V1 Mali müşavir + GİB doğrulaması:** §1 ve §2'deki tüm ⚠ maddeler (eşik, ceza, iptal yokluğu, yanıt süresi, kayıtsız alıcı, ihracat akışı, numara boşluğu, taşıma bilgisi zorunluluğu, vergi dairesi zorunluluğu, CustomizationID). E4 başlamadan önce.
- **V2 Entegratör seçimi + test hesabı (v2 için):** fabrika hangi entegratörü kullanıyor (Logo/Mikro tarafında zaten olan); test ortamı kimlik bilgisi. v1'de yalnız portal yükleme denemesi için bir test hesabı yeterli.
- **V3 XSD paketi ve CI aracı:** GİB UBL-TR XSD paketinin repoya alınması (lisans) + CI imajına `libxml2-utils` (xmllint). Onaysızsa XSD bekçisi "ATLANDI" der.
- **V4 Yeni paket:** varsayılan YOK; `xmlbuilder2` yalnız ölçülmüş gerekçeyle ve onayla.
- **K-A** ~~Gönderilmiş e-İrsaliyeli sevkiyatta kâğıt irsaliye revizyonu v1'de uyarır, engellemez~~ **GEÇERSİZ → 2026-10-25 (patron kararı E6): revizyon kilitli, 409 `EIRSALIYE_PAPER_LOCKED`.** Eski metin: — kullanıcı "engelle" derse E6'ya bir kapı eklenir.
- **K-B** Alıcı vergi dairesi zorunlu çıkarsa: `Customer.taxOffice` (kimlik) eklenip `CariAccount.taxOffice` ile tek kaynağa indirilmesi ayrı iş (master veri + finans).
- **K-C** (UYGULANDI, E3-AYAR) Yapılandırma kapısının varsayılanı `adapter: "yok"` — her kurulumda kapalı doğar (P1); deneme profilinde bile elle yapılandırılır (JSON ayar test profiline girmez).
- **K-D (v2)** Entegratöre giden istekler kökteki "dışarı giden her istek kurulum anahtarıyla imzalanır" kuralının istisnası mı (üçüncü taraf API kendi kimlik doğrulamasını ister) — `patron-bulutu.md`/`kesif-cihaz.md` sahipleriyle karar.
- **K-E** e-İrsaliye düzenleme zamanı: v1 yalnız DISPATCHED sonrası üretir; fabrika "sevkten önce" (PLANNED) üretim isterse sevk onayı rejimiyle ayrı tasarım.
