# Ticaret Paketi — Çoklu Depo + Mal Kabul + Ön Muhasebe (2026-08)

> **Durum:** ✅ Paket 1 (Çoklu Depo + Mal Kabul) ve Paket 2 (Ön Muhasebe) UYGULANDI — cari/fatura/çek/kasa servisleri, sağlamlık paketi migration'ları ve bekçileri canlı. "Para tarafı yok" ölçümü 2026-08 başına aittir. Canlı kural özeti: `docs/kurallar/finans.md`.
> Kanonik referanslar: `Teks-Erp/prisma/schema.prisma`, `Teks-Erp/src/services/inventory.service.ts`
> (`createInitialEntry`), `Teks-Erp/src/services/helpers/roll-entry-station.helper.ts` (12 giriş yolu envanteri),
> `Teks-Erp/src/services/printed-document.service.ts` (donmuş belge zinciri).

## Neden

Yazılım bugün **tek bir üretici fabrikada** çalışıyor (canlı, gerçek veri). İkinci bir müşteri profili
doğdu: **üretim yapmayan bir alım-satım firması** (perde kumaşı topu; USD/TL/EUR/RUB ile çalışıyor,
birden fazla deposu var, ön muhasebe istiyor). Üretim modülleri o firmada izinle gizlenebiliyor —
mimari değişiklik gerekmiyor. Gerçek boşluklar üç tane:

1. **Depo bir varlık değil, bir statü.** `RollStatus.WAREHOUSE` + `shipmentId/sackId` boşluğu "depoda"
   demek (`getWarehouseScope`). Fabrikanın tek deposu olduğu için bu bugüne kadar doğruydu.
2. **Üretimsiz mal girişi yok.** Stoka top sokan bütün kapılar üretim akışından geçiyor
   (KK1 ham girişi, Tambur finalize, fason kabulü).
3. **Para tarafı yok.** Cari hesap, fatura, tahsilat, döviz — hiçbiri modelde yok
   (yalnız `Order.currency` + `OrderLine.unitPrice` tohumu ekili).

> ⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md`. "Tek depo" referans fabrikanın kurulumudur; sistem tarafında karşılığı artık bir **modül anahtarıdır** (`depo.multiEnabled`, varsayılan KAPALI — `src/constants/module-flags.ts`). Ayrım veri-türevi ("kaç depo var") değil anahtardır: transfer uçları `requireDepoMultiEnabled` ile kapılıdır (`warehouse-transfer.routes.ts:24`), depo **defteri** ise kapısız çekirdektir (fabrika yolları da yazar).

### Pazarlıksız kısıt: fabrikada SIFIR görünür fark

Aynı kod canlı fabrikaya da gidecek. Fabrika kullanıcısı güncellemeden sonra **tek piksel** fark
görmemeli. Bu, tasarımın her adımını şekillendirir ve üç katmanla garanti edilir:

| Katman | Kural |
|---|---|
| **Backend** | Hiçbir mevcut uca zorunlu yeni parametre eklenmez. Depo verilmeyen her yol `resolveTargetWarehouseId` ile **varsayılan depoya** düşer. |
| **Arayüz** | "Tek değerken gizle": aktif depo sayısı 1 ise depo seçici / kolon / filtre / transfer karosu **çizilmez** (emsal: mobil `PlaceActions.tsx:51-59` `optionCount > 1`). |
| **Modül** | Ön muhasebe izin + bayrak arkasında; ikisi de varsayılan kapalı. |

Üçü de bekçiyle kilitlenir (`test_single_warehouse_parity.ts`, `test_finance_flag_off.ts`).

---

# Paket 1 — Çoklu Depo + Mal Kabul

## 1. Depo (`Warehouse`)

Saf tanım verisi → `BaseService` + `BaseController` (emsal `routes/return-reason.routes.ts:14-27`),
Electron tarafında 5-dosya CRUD kalıbı (`electron-admin-page` skill'i).

- `code` (autoCode `DP`+GGAAYY+NNNN), `name`, `isDefault`, `isActive`, `address`, `notes`.
- **`isDefault` tek satır olabilir** — partial unique (`WHERE "isDefault" = true`), ham SQL migration
  (Prisma şemada ifade edemez) + `scripts/test_db_invariants.ts` envanterine yazılır.
- Guard'lar (BaseService override): varsayılan depo pasifleştirilemez/silinemez; içinde top olan depo
  silinemez.

⚠️ **Depo `Station` DEĞİLDİR.** İstasyon bir üretim noktasıdır (`StationKind`), depo bir stok
lokasyonudur. İkisini birleştirmek fabrikadaki istasyon listesine sahte "depo" satırları sokardı.

## 2. Topun deposu (`Roll.warehouseId`)

Nullable FK + `@@index([warehouseId, status])`. Semantik: **"topun şu an bulunduğu / en son bulunduğu
depo"** — `SHIPPED`/`SCRAP`/`CANCELLED` topta da korunur, hiç NULL'lanmaz.

- Bu yüzden sevk stornosu için ayrı bir snapshot alanı GEREKMEZ (`preShipStatus` emsalinin aksine):
  geri dönüş adresi topun kendi satırında zaten duruyor.
- **NULL yalnız backfill öncesi geçici durumdur.** Backfill'den sonra bekçi NULL sayısını 0'a sabitler;
  `SET NOT NULL` bir sonraki sürümde atılır. Gerekçe: 9 fiziksel `roll.create` noktasının biri gözden
  kaçarsa NOT NULL production'da 500 üretir — nullable + bekçi aynı garantiyi risksiz verir.
- **Tek doldurma noktası** `helpers/warehouse.helper.resolveTargetWarehouseId(tx, explicit?)`:
  açık depo verildiyse o, verilmediyse `isDefault` depo. Fabrika akışları hiç parametre vermez.

## 3. Depo hareket defteri (`WarehouseMovement`)

⚠️ **`RollMovement`'a DOKUNULMAZ.** O tablonun `workOrderStepId` alanı **NOT NULL**'dır ve bir iş emri
ADIMINA giriş/çıkışı temsil eder; depo olayları (giriş, sevk, iade, iptal) oraya yapısal olarak sığmaz.
Ayrıca ölçüldü: bugün depo hayatı **tamamen hareketsiz** (bitmiş topların hiçbirinde kapanmış
`RollMovement` yok). Ayrı tablo emsali ve gerekçesi `RollVariance` (schema:2148-2232).

Append-only, satır başına bir olay:

| Alan | Not |
|---|---|
| `eventType` | `ENTRY · TRANSFER · TRANSFER_REVERSAL · SHIPMENT · SHIPMENT_REVERSAL · RETURN · CANCEL` |
| `fromWarehouseId?` / `toWarehouseId?` | TRANSFER'de ikisi de dolu ve farklı; ENTRY'de `from` boş; SHIPMENT'ta `to` boş |
| `qty` | Olay anındaki metraj — **her zaman POZİTİF**, yönü `eventType` söyler (RollVariance emsali) |
| `transferId? · goodsReceiptId? · shipmentId? · rollReturnId?` | Belge bağları (typed FK, polimorfik değil) |

**Satır yazan olaylar ve yerleri:** `createInitialEntry` (ENTRY — KK1 ham giriş, elle ekleme, Tambur
manuel, Mal Kabul; tüm sarmalayıcılar bedava kapsanır) · fason dönüşü born topları (ENTRY — mal
gerçekten dışarıdan geldi) · `performDispatchTx` (SHIPMENT) · sevk stornosu (SHIPMENT_REVERSAL) ·
`return.service` (RETURN) · `softDelete` (CANCEL) · transfer servisi (TRANSFER / TRANSFER_REVERSAL).

⚠️ **KESİM ÇOCUĞU SATIR YAZMAZ.** Bu defter bir *hareket* defteridir; kesim bir **dönüşümdür**,
hareket değil — mal zaten o depoda ve toplam metraj değişmiyor. Çocuğa ENTRY yazmak depoya
giren malı **ikinci kez** saydırırdı (100 m'lik top 2×50 olunca depoya 100 m daha girmiş görünür).
Çocuğun nerede olduğu zaten kendi `warehouseId`'sinde yazılı (ebeveynden miras).

**Diğer bilinçli yazmayanlar:** `STOCK → WAREHOUSE` statü terfisi (`prepareRawForSale`) — konum
değişmiyor, bu defter **konum** defteridir; fason/kartela sevk-kabul dış akışı (Faz 2 — ticaret
firması kullanmıyor); **backfill** (açılış durumu `Roll.warehouseId`'dedir, yüz binlerce anlamsız
"başlangıç" satırı üretilmez).

## 4. Transfer belgesi (`WarehouseTransfer`)

- `transferNo` = `DT`+GGAAYY+NNNN (`nextPrefixedSequenceTx` + `withBarcodeRetry` deseni).
- **Tek adımlı commit** — "yolda" (in-transit) durumu YOK: yerel depolar arası taşımada araç takibi
  ihtiyacı yok. Gerekirse `status` enum'una SONA `IN_TRANSIT` eklenerek açılır.
- **Satır tablosu yok** — kalemler `WarehouseMovement` satırlarıdır (`transferId`); belge içeriği
  zaten `PrintedDocument` snapshot'ında donar.
- Guard'lar (ihlalde **top listeli** hata): top `warehouseId == from` · `status ∈ {STOCK, WAREHOUSE,
  A1_STOCK, RETURNED_FROM_SUBCONTRACTOR}` · `sackId == null` · `shipmentId == null`.
  ⚠️ Çuvaldaki top transfer edilemez — bu, `Sack`'e depo boyutu eklememeyi meşru kılan kuraldır.
- İptal: toplar hâlâ `to` deposunda ve serbestse geri taşınır (`TRANSFER_REVERSAL` + `voidForSource`).
- Belge tipi `PrintedDocType.TRANSFER_DISPATCH` (enum'a **SONA** eklenir) + `registerPrintedDocBuilder`
  + `DOC_PERMISSIONS` girdisi (`printed-document.routes.ts`).

## 5. Mal Kabul (`GoodsReceipt`)

Üretimsiz giriş: tedarikçiden gelen mal → depo → top satırları → barkod + etiket → `WAREHOUSE`.

- `receiptNo` = `MK`+GGAAYY+NNNN; `warehouseId`; **`supplierId?`** (`Customer` + `CompanyType.SUPPLIER`
  — yeni tedarikçi modeli açılmaz); **`deliveryNoteNo?`** (tedarikçinin kâğıt irsaliye numarası).
- **Alış siparişi (`PurchaseOrder`) Faz 2** (kullanıcı kararı: sipariş opsiyonel olacak). Faz 1'de
  tedarikçi + serbest irsaliye no izlenebilirlik için yeterli; model borcu yaratmaz.
- `Roll.goodsReceiptId?` (nullable FK + index) — top ↔ fiş bağı.
- **Motor yeniden yazılmaz:** satır başına `InventoryService.createInitialEntry(..., { forcedStatus:
  WAREHOUSE, forcedEntrySource: PURCHASE_RECEIPT, warehouseId, goodsReceiptId })`. Emsal çağıran
  `tambur-manual.service.produceFinishedRoll:1138` (iş emrisiz, hareketsiz, doğrudan depoya).
  Böylece mükerrer tuzağı (advisory lock), `clientToken` idempotency, barkod rezervasyonu, izinli
  renk/özellik doğrulaması ve etiket snapshot'ı bedavaya gelir.
  ⚠️ Satır başına ayrı `clientToken` — ağ kopmasında yarım fiş mükerrer top doğurmaz.
- `RollEntrySource.PURCHASE_RECEIPT` (enum'a SONA).
- Fiş iptali: toplardan hiçbiri sevk edilmemişse hepsi `softDelete` + CANCEL hareketi + belge VOID.
- Belge tipi `PrintedDocType.GOODS_RECEIPT`.
- **Electron: ayrı sayfa** (`pages/Operations/GoodsReceipt/`). ⚠️ Rolls'daki `ManualEntryDialog`
  GENİŞLETİLMEZ — o tekil-top/`MANUAL_ENTRY` semantiği taşıyor ve fabrika kullanıyor; oraya depo +
  tedarikçi + çok satır eklemek fabrikada görünür fark ve regresyon riski demek.
- **Mobil mal kabul Faz 2.** Bugünkü tek giriş ekranı KK1 ve `RAW_QC` çalışma oturumu istiyor;
  ticaret firmasında istasyon yok. (Ara çözüm: giriş Electron'dan yapılır, `entryStationId: null` meşru.)

## 6. Tek-depo gizleme

`multiWarehouse = aktif depo sayısı > 1`. Electron'da tek kaynak `useWarehouses()` → `useMultiWarehouse()`.
Koşullu yüzeyler: Rolls "Depo" kolonu + filtresi · top detay panelindeki "Depo" satırı · Mal Kabul depo
seçici · Transfer karosu (`OperationsVisibilityContext`'e `multiWarehouse` alanı, `visibleWhen` deseni) ·
rapor kırılımları. **"Depolar" tanım kartı bu kuralın dışındadır** (`warehouse:read` izniyle görünür) —
ikinci depoyu yaratabilmenin tek yolu odur.

## 7. Migration + backfill sırası

1. **Migration A** (tek dosya, tamamı additive): yeni tablolar + `rolls.warehouse_id` / `goods_receipt_id`
   nullable kolonları + indexler + partial unique + enum SONA eklemeleri.
   ⚠️ `ALTER TYPE ... ADD VALUE` ile eklenen değer **aynı migration içinde kullanılamaz**.
   ⚠️ `migrate dev` `sacks`/`swatches` composite FK'larını DROP etmek ister — `--create-only` + o
   satırları elle sil (`schema.prisma:2557-2558`).
2. **Varsayılan depoyu BOOT uzlaştırması üretir** (`ensureDefaultWarehouse()`, izin kataloğu job'u
   emsali) — migration'a INSERT gömülmez: uuid/isim taşa yazılır ve taze kurulum seed'iyle çatallanır.
3. **`scripts/backfill_roll_warehouse.ts`** — dry-run varsayılan, `--apply` ile yazar, batched.
   Fabrikada %100 doğru: tek depo vardı, dolayısıyla "hangi depoydu" sorusunun cevabı kesin.
   ⚠️ Ham SQL ile yazar — Prisma `update` `updatedAt`'i tazeler ve envanter listelerinin "Son İşlem"
   sıralaması tam o kolondan çözülür (emsal: `backfill_roll_production_timestamps.ts`).
4. Kod devrede → NULL doğamaz. 5. Sonraki sürümde `SET NOT NULL`.

> ⚠️ Profil gerçeği — backfill'in "hangi depoydu" varsayımı yalnız **tek depolu geçmiş** için geçerlidir; çok depolu bir kurulumda aynı script kullanılamaz (`depo.multiEnabled` — bkz. yukarıdaki §1 şerhi ve `MODUL-BAYRAK-TASARIM.md`).

## 8. İzinler

`warehouse:read` · `warehouse:write` · **`warehouse:transfer`** (ayrı: depo adını düzeltebilen herkes
stok taşıyamamalı) · `goods-receipt:read` · `goods-receipt:write`.
⚠️ `goods-receipt:*` mevcut rol şablonlarına **EKLENMEZ** — Mal Kabul karosu yalnız izinle kapılı
(tek depolu ticaret firması da kullanacağı için `multiWarehouse` şartı konamaz), şablona akarsa
fabrikada karo belirir. `WEB_WAREHOUSE_SHIPPING`'e yalnız `warehouse:read` + `warehouse:transfer`.

⚠️ **2026-09 güncellemesi —** Mal Kabul artık **yalnız izinle kapılı DEĞİL**: `goods-receipt.routes.ts:27` üzerinde `requireTicaretEnabled` modül kapısı var (`MODUL-BAYRAK-TASARIM.md` karar #4 — planın iki bilinçli statü değişikliğinden biri; ölçüm: fabrika dump'ında 0 mal kabul). Paragrafın gerekçesi ("`multiWarehouse` şartı konamaz") DOĞRU kalır — kapı çoklu depoya değil **ticaret modülüne** bağlandı; depo transferi ayrıca `requireDepoMultiEnabled` taşır (`warehouse-transfer.routes.ts:24`). İzin katmanı da yerinde durur: iki kapı, iki soru ("bu kurulum ticaret paketini kullanıyor mu" ≠ "bu kullanıcı yetkili mi").

## 9. Bekçiler

| Dosya | Ölçtüğü |
|---|---|
| `test_warehouse_transfer.ts` | Depo CRUD guard'ları · transfer happy path + 4 red dalı · iptal → geri taşıma + VOID |
| `test_goods_receipt.ts` | Çok satırlı fiş · `clientToken` replay · entrySource/status/warehouse damgaları · fiş iptali |
| **`test_single_warehouse_parity.ts`** | Tek depoda API yanıtları ve `getWarehouseScope` sayıları güncelleme öncesiyle birebir; `multiWarehouse=false` |
| `test_db_invariants.ts` (ek) | `warehouseId` NULL = 0 · tek `isDefault` · hareket yön kuralları · partial unique envanteri |
| `test_consistency.ts` (ek) | Son hareket ↔ `Roll.warehouseId` · transfer hareket sayısı · aktif fiş ↔ top durumu |

---

# Paket 2 — Ön Muhasebe (tasarlandı, henüz yazılmadı)

**Kapsam:** cari hesap · dövizli fatura KAYDI · tahsilat/ödeme · kasa/banka · dört rapor.
**Kapsam dışı:** e-fatura/GİB (dış programda kesilir, numarası `externalNo` ile eşlenir), resmi
defter/beyanname, bordro, ürün maliyeti. Çek/senet ve fatura-kapama (`PaymentAllocation`) Faz 2.

## 10. Model çekirdeği

- **`CariAccount`** — `Customer`/`Subcontractor`'a 1:1 köprü (`customerId` XOR `subcontractorId`).
  Vergi dairesi, varsayılan para birimi, vade günü, risk limiti BURADA yaşar; mevcut kartlara tek kolon
  eklenmez (fabrika DB'sine sıfır dokunuş). Cari **lazy** açılır: ilk finans işleminde upsert.
- **`CariBalance`** — denorm bakiye, PK `[cariId, currency]`. ⚠️ **Döviz bakiyeleri AYRI tutulur**,
  TL'ye ezilmez: USD borcu TL kurdan toplanırsa bakiye her gün "değişir" ve mutabakat imkânsızlaşır.
  Ledger insert'iyle **aynı tx'te** atomik `increment`; doğruluğu `test_consistency` bölümüyle kilitlenir.
- **`Invoice` + `InvoiceLine`** — tip (SALES/PURCHASE/+RETURN) · durum DRAFT→CONFIRMED→CANCELLED ·
  `currency` + `exchangeRate` + `grandTotalTry` damgası · `externalNo` · kaynak bağları
  (`shipmentId?`/`directShipmentId?`/`returnGroupId?`/`subcontractorReceiptId?`) · satırda
  KDV oranı + iskonto + **tevkifat** (tekstil fason işçiliği).
  ⚠️ **Bir kaynak → en çok bir AKTİF fatura**: partial unique index (`WHERE status <> 'CANCELLED'`).
  Otomasyon ile elle basış yarışırsa biri yapısal olarak düşer.
- **`CariTransaction`** — append-only defter (debit/credit iki kolon + `amountTry`); UPDATE/DELETE YOK,
  düzeltme daima **ters kayıt**.
- **`Payment`** (+`clientToken`), **`CashBox`/`BankAccount`** (tek para birimli — RUB kasası ayrı kart),
  **`ExchangeRate`** (elle giriş; TCMB otomasyonu Faz 2).
- `Currency` enum'a **`RUB`** (SONA, kendi migration'ı) + `src/config/currencies.ts`.

## 11. Akış kuralları

- **Otomasyon YALNIZ TASLAK üretir.** Üç bayrak (`finance.autoDraftFrom{Shipment,Return,
  SubcontractorReceipt}`), üçü de varsayılan KAPALI. Bayrak kapalıyken "belgeden üret" düğmesi durur —
  yani üç kip var: otomatik · istek üzerine · sıfırdan elle. Cari hesaba tek kuruş, ancak muhasebecinin
  **onayıyla** işler. Gerekçe: muhasebede kayıt sorumluluktur; sistemin habersiz cari işlemesi
  mutabakatta "bu kaydı kim attı" kaosu üretir.
- **Onay tek tx:** atomik claim (`updateMany WHERE {id, status: DRAFT}`) → toplamlar satırlardan
  **yeniden** hesaplanıp damgalanır (istemci toplamına güvenilmez, `Prisma.Decimal` `.plus()`) →
  `CariTransaction` → `CariBalance` → kaynak sevkin `invoiceNo/invoicedAt/invoicedById` üçlüsü
  damgalanır. Bu son adım bedava bir koruma getirir: **faturalı sevk storno edilemez** guard'ı
  (`shipping.service.ts:1890-1905`) finans modülünü kendiliğinden korur.
- **İptal = STORNO.** CONFIRMED fatura silinmez/düzenlenmez: CANCELLED + ters ledger kaydı + ters
  bakiye + sevk işaretinin temizlenmesi, hepsi tek tx. Düzeltme akışı = iptal + yeni fatura.
- **Yaşlandırma Faz 1'de rapor-anı FIFO** ile hesaplanır (yazma yolu karmaşıklaşmasın).
  ⚠️ Bilinen sınır: "şu ödemeyi şu faturaya say" Faz 1'de tutulamaz — `PaymentAllocation` Faz 2.

## 12. Yüzey ve izin

Electron `nav-config.ts`'e **tek satır "Muhasebe"** + hub sayfası (Operations hub'ının ikizi; karo
`permissionAny` ≡ route `requireAnyPermission` — `accounting-dispatch`'teki bilinen sapma tekrarlanmaz).
Karolar: Cari Hesaplar · Cari Ekstre · Faturalar · Tahsilat/Ödeme · Kasa & Banka · (mevcut) Sevk Faturalama.

İzinler `module: "FINANCE"`, `category: "web"` (⚠️ `PermissionCategory` enum'una DOKUNULMAZ — o
"hangi istemci" sorusudur, modül adı serbest string'dir): `finance:read` (tutar görme kapısı) ·
`finance:write` · `finance:invoice` (onay/iptal) · `finance:payment` · `report:finance`.
Görev ayrılığı bilinçli: fatura kesen ≠ para tahsil eden ≠ sevk eden.

Raporlar: cari bakiye · yaşlandırma 30/60/90 · cari ekstre · kasa/banka özeti. Ortak metrik tek dosyada
(`reports/_receivable.ts`, `_shipped.ts` emsali) — ekstre ile yaşlandırma aynı sayıyı iki yerde
hesaplarsa kaçınılmaz olarak ayrışır.

---

## 13. Kurulum profilleri

| | Fabrika (mevcut) | Ticaret firması |
|---|---|---|
| Depo | Tek (Merkez) → tüm depo yüzeyleri gizli | N depo + transfer |
| Mal girişi | KK1 / üretim akışı | Mal Kabul fişi |
| Üretim modülleri | Aktif | İzinle gizli |
| Ön muhasebe | Bayrak kapalı (isterse açılır) | Açık |

Ayrı kurulum = ayrı veritabanı (multi-tenant DEĞİL; bkz. `SAAS-TASARIM.md`, "ileride" bandında).
