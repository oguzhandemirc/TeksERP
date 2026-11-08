# Finans · Sağlamlık sınıfları
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/finans.md`.

Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Cari taşırken: ① taraf yazımı TEK UPDATE (`customerId` + `subcontractorId: null` + `kind`; `cari_accounts_party_xor`, `cari_accounts_kind_matches_party`) · ② `CariBalance` taşınmaz, `(cariId, currency)` başına TOPLANIR · ③ defter satırının pointer'ı taşınır, içeriği değişmez.
- **[ÇEKİRDEK]** Fatura kapamasını çözmek satırı silmez, `revokedAt`/`revokedById`/`revokeReason` damgalar; atomik claim `updateMany WHERE {id, revokedAt: null}`; her okuyucu (yaşlandırmanın yedi ham SQL'i dahil) `ACTIVE_ALLOCATION`dan süzer; ikinci `deallocate` 409.
- **[ÇEKİRDEK]** Cari hesap yalnız karta bağlanır (firma başına tek, `CariAccount.customerId`); fason profiline bağlı hesap geçiş artığıdır, göçle karta taşınır (defter satırı silinmez). Çapa `docs/design/IS-ORTAGI-ROL-MODELI.md §2.1`.
- **[ÇEKİRDEK]** Sevk rakamı her yüzeyde BRÜT: fiş/irsaliye donmuş snapshot'tan; liste (`attachTotals`), muhasebe Excel'i ve detay canlı + iptal edilmemiş `RollReturn` geri-eklemesi; kg geri-ekleme istemez; iade ayrı belge, çıkış belgesi düzeltilmez.
- **[ÇEKİRDEK]** `Shipment/DirectShipment.invoiceNo+invoicedAt+invoicedById` dış belgenin izidir (tutar/KDV yok); yalnız DISPATCHED işaretlenir (atomik claim); `invoiceNo:null` izi ve tarihi temizler; storno kapısı `invoiceNo`ya bakar → iç fatura onayı damgayı her modda yazar.
- **[ÇEKİRDEK]** SINIF 2 — Ters yol: deftere yazan her ileri kaynağın tipli `*_CANCEL` ters yolu olur (`reversesTxnId` self-FK @unique); ileri enum değeriyle ters değeri birlikte ekle; ters kayıt DAİMA bugüne (`txnDate = now`).
- **[ÇEKİRDEK]** Çekte her ileri olayın `*_CANCEL` çifti var (`DEPOSIT_CANCEL` dahil): storno ileri satırı silmez, bugüne yazar, durumu `fromStatus`a döndürür, izin `finance:cheque`; para oynatmayan storno dönem kapısını ve 8028'i çağırmaz; para etkisi tek kaynak `CHEQUE_EVENT_CASH_EFFECT`.
- **[ÇEKİRDEK]** Kasa/banka: her ileri hareket bir `CashTransaction` (`paymentId` dahil); `balance`ı yalnız `helpers/cash-ledger.helper.ts` (`applyCashTxTx` · `cancelCashTxTx` · `moveAccountBalanceTx`) yazar; ödeme satırı ödeme iptaliyle CANCELLED; okuyucu yalnız satırsız ödemeyi sayar.
- **[ÇEKİRDEK]** SINIF 3 — Kilit sırası: tek tx'te çok kilit deterministik sırada (`assertPeriodsOpenTx`; tekil guard'ı bir tx'te iki kez çağırma); uzaylar arası uzay no ARTAN; envanter `period-guard.helper.ts` başlığı; PG 40P01/40001 → 409.
- **[ÇEKİRDEK]** SINIF 4 — Çift yüklem: durum ↔ sayaç çiftinde iki yazar da karşı koşulu atomik WHERE'e koyar (`claimTx allocatedTotal:0` ↔ `bumpChequeAllocated status NOT IN no-money`) + CHECK `cheques_terminal_not_allocated`; tek yönlü CAS YASAK.
- **[ÇEKİRDEK]** SINIF 5 — Tek kaynak satır: çok-tipli belge satırları tek assembler'dan (`assembleReceiptLines` FABRIC|YARN; `_shipped.ts`; `producedOutputWhere`); tüketici tabloya doğrudan gitmez.
- **[ÇEKİRDEK]** Ortak Konvansiyonlar (UUID/zaman damgası, soft delete, audit, beş sağlamlık sınıfı, yıkıcı işlemde detaylı onay) bayrakla kapanmaz; 'bizde olmasın' talebinin cevabı süreç/eğitimdir (MODUL-BAYRAK-TASARIM §11).

### Yasaklar

- **[ÇEKİRDEK]** Olay defterinde kronoloji `createdAt`tir, `eventDate` değil; 'en son olay' `createdAt desc` ile aranır.
- **[ÇEKİRDEK]** TR-only bilinçlidir: mesajlar Türkçe, i18n/sözlük altyapısı kurulmaz, bugünden hazırlık yapılmaz.

### Reçeteler

- **[ÇEKİRDEK]** SINIF 1 — İki tarih: yeni mali belge tipinde 'kâğıdın tarihi = işlem tarihi mi?' sor; değilse iki alan (`Cheque.issueDate` ↔ `postingDate`), defter/kilit/belge-no/kur `postingDate`ten. Payment/Invoice tek tarihli meşrudur; çift tarihi yayma.
- **[ÇEKİRDEK]** İki SAAT: ms sıralaması karşılaştırılan iki damgayı aynı saatten al (Prisma `@default(now())` Node saati, trigger/SQL `now()` DB saati); levent olayı `createdAt`i tek yazarda `clock_timestamp()`ten.

### Kararlar

- **[PROFİL]** Fatura rejimi `shipping.invoiceMode`: `dis` (varsayılan) · `ic` (elle iz 400 INVOICE_TRACE_DISABLED, numara yalnız iç onaydan) · `ikisi` (serbest + amber). İz kaldırma her modda açık; kapı serviste (`assertInvoiceTraceAllowed`).
- **[ÇEKİRDEK]** `shipping:invoice` ayrı izindir; muhasebeciye `shipping:write` verilmez; route yalnız `shipping:invoice` ister; `shipping:invoice` taşıyan şablon `shipping:write` taşımaz.
- **[ÇEKİRDEK]** Çek bordrosunun tek resmî belgesi `ChequeDeliveryNote` (BRD); önizleme numarasız taslak (`POST …/cheque-delivery-notes/draft`, yazmaz); PDF/Excel tek `DocColSpec`ten; kayıt `clientToken` taşır.
- **[ÇEKİRDEK]** `finance.chequeNoteMovementEnabled` KAPALI → bordro belge-only; AÇIK → hareket fişi (banka → bankaya verme, cari → ciro, ek izin `finance:cheque`; tekil işlem tek satırlı bordro); ters yolu `ChequeEvent.deliveryNoteId` seçer; hareketli iptal satır seçimi + sebep ister.
- **[PROFİL]** `finance.blockNegativeCashEnabled` varsayılan KAPALI; açıkken kasayı eksiye düşüren 4 ileri yol 409, BANKA ve ters/storno muaf. `finance.defaultVatRate` varsayılan 20; panel `emptyLine` + mal-kabul alış taslağı tek kaynaktan.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Ekstre satırı ters-kayıt bağını kendisi taşır (`reversedByTxnId`); sezgisel sayım yalnız eski-backend fallback'i.
- **[ÇEKİRDEK]** Cari defter okuyucuları sırayı yalnız `CARI_STATEMENT_ORDER` (`txnDate`, `createdAt`, `id`) ve `CARI_TXN_LATEST_FIRST`ten (`helpers/finance.helper.ts`) alır; ekran/PDF/Excel aynı satırları okur; eşitlik ölçülürse yazar tek damgaya bağlanır.
- **[ÇEKİRDEK]** Negatif kasa guard'ının serileştiricisi 8028 advisory kilididir (`FOR UPDATE` yalnız derinlik); storno/ters yollar muaf.
- **[ÇEKİRDEK]** Kasa/banka bakiyesi okuyan her yüzey çek para etkisini `CHEQUE_EVENT_CASH_EFFECT`ten (`helpers/cheque-cash-events.helper.ts`) alır; `e.type IN (…)` elle yazılmaz.
- **[ÇEKİRDEK]** Fatura satırında `unit` zorunlu (Zod `min(1)`), servis `?? "m"` taşımaz; birim tek sözlükten basılır (`constants/item-unit.ts` `unitLabel`).
- **[ÇEKİRDEK]** Mal kabul doğrulama hatası (lot, bobin, ürün yok/pasif/sarf, miktar) satır yazılmadan reddedilir: `assertReceiptLinesValid` (`helpers/goods-receipt-preflight.helper`) `create` ve `POST /:id/lines`te, 400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo, code, message}]`.
- **[ÇEKİRDEK]** Mal kabulde koşu anı hatası (yarış/409, kilit) için satır-satır tx ve `failed[]` kalır; panel `RECEIPT_LINES_INVALID`i satıra bağlar, modal kapanmaz; bayrağı biliyorsa (`useDevereLotRequired`) önceden işaretler.
- **[ÇEKİRDEK]** Masraf özeti ve kasa kategori gruplaması yalnız `helpers/expense-summary.helper.ts` (`getExpenseSummary`, `cashCategoryKey`): evren EXPENSE satırları (`amountTry`), iptal iptal ayında eksi; `CAT:` anahtarını başka dosyada yazma; kategori kataloğu kurma.
- **[ÇEKİRDEK]** `ExpenseAllocation`ı yalnız `expense-allocation.service` yazar (8036 → masraf FOR UPDATE → 8028 → Σ pay ≤ 100; değişim = damga + yeni satır); kârlılık yalnız `listExpenseAllocationsAsOf`tan okur; "şu an aktif bağ" okuyucusu yazma.
- **[ÇEKİRDEK]** Kasa Hareketleri kategori süzgeci `cashCategoryKey` ile; `helpers/cash-category-filter.helper.ts` ham değerlere çözer; tanınmayan 400 `CASH_CATEGORY_FILTER_INVALID`; değer CSV'ye bölünmez; eşleşme SQL trim'iyle değil.

### Tuzaklar

- **[ÇEKİRDEK]** `dispatchedAt` sıralamasında `Shipment.dispatchedAt` ↔ `DirectShipment.shippedAt`: direct dalı için orderBy ve cursor where ayrı kurulur, `cw` paylaşılmaz; shippedAt NON-NULL → sortNullable yok.

### Kararlar

- **[ÇEKİRDEK]** Toplu açılış aktarımı yalnız tekil servislerden yazar (`setOpeningBalance` · `chequeService.create` · `itemPriceService.upsert`); ikinci defter yazarı açma; geri sarma `REVERSE_ENTRY` · `REVOKE_VERSION`.
- **[ÇEKİRDEK]** `ItemPrice` silinmez/ezilmez: değişim `revokedAt` damgası (partial unique `revokedAt IS NULL`); okuma `ACTIVE_ITEM_PRICE`/`itemPriceValidAt`, tarihli `resolveItemPrice*({ asOf })`; `isActive` ekleme.
- **[ÇEKİRDEK]** Hizmet fiyatını yalnız `pickServicePrice` sırasıyla seç (müşteri kademe → müşteri gram → genel kademe → istasyon gram → kalem fiyatı; tabloda olmayan kademe fiyatsız + uyarı); ileri tarihli fiyatı zamanlanmış damgayla yaz (yürürlükteki `revokedAt` = yeni `validFrom`), "şu an"ı `itemPriceNow` ile oku.
- **[ÇEKİRDEK]** Cari kartında rol bayrağı tek kaynaktır: ticari yön `isCustomerRole`/`isSupplierRole`den; `Customer.type` yalnız geriye dönük okunur, ASLA yazılmaz.
- **[ÇEKİRDEK]** Fason bacağı (`subcontractorId`) `resolvePartyToCardTx` (`helpers/party-card.helper.ts`) ile karta çözülür (`ensureCariAccountTx` + `cariService.create`); bağsız profil fason hesabına gider.
- **[ÇEKİRDEK]** Kart → hesap yalnız `findCariAccountForCardTx`; hesap satırı yalnız `ensureCariAccountTx`te (`createMany skipDuplicates`); eski bacaktaki tek hesabı TEK UPDATE ile çevir; kartın kendi hesabı önce (pasifse 409); çiftler `scripts/fix_cari_cift_hesap.ts`.
- **[ÇEKİRDEK]** Kart varsa hesap vardır: terimler (`paymentTermDays` · `defaultCurrency` · `taxOffice` · `riskLimit`) `CariAccount`ta, kart TX'inde doğar (`createCardTx` → `bornCariAccountTx`) yalnız `finance.enabled` açıkken; sonradan `scripts/migrate_cari_accounts_backfill.ts` (`--canli-onay`).
- **[ÇEKİRDEK]** `helpers/customer-finance-bridge.helper.ts` finans helper'ını DİNAMİK import eder. Kart → hesap tek yol `resolveCariAccountByCustomerTx` + `GET /finance/cari/by-customer/:customerId` (404 `CARI_ACCOUNT_MISSING`, yaratmaz); form kod aramasıyla hesap bulmaz.
- **[ÇEKİRDEK]** Kart formu `finance{…}` `finance:write` (403 `PERMISSION_DENIED`) + modül (403 `MODULE_DISABLED`), `cariService.update` ile; `GET /customers/:id` `cariAccountId` + `finance`ı yalnız `finance:read`le verir; `POST /finance/cari` 400 `CARI_ACCOUNT_BORN_WITH_CARD`.
- **[ÇEKİRDEK]** Kart açan bekçi `scripts/fixture-customer-cleanup.ts` `cleanupTestCustomers` ile siler, hatayı yutmaz (`.catch(() => {})` yasak); `withBarcodeRetry` yalnız kod P2002'sini dener (`p2002TargetsCode`), ad seddi 409 `CUSTOMER_NAME_DUPLICATE`.
- **[ÇEKİRDEK]** n irsaliye → 1 fatura: pivot `InvoiceToGoodsReceipt` (REPLACE, tek yazar `writeInvoiceReceiptsTx`); kapılar `helpers/invoice-receipts.helper.ts` (aynı tedarikçi kartı, para birimi, açık fiş; çift bağ 409 `GOODS_RECEIPT_ALREADY_INVOICED`; FOR UPDATE).
- **[ÇEKİRDEK]** `finance.invoiceMatchTolerance` (varsayılan KAPALI) + `invoiceQtyTolerancePct`/`invoicePriceTolerancePct` onayda ölçülür (400 `INVOICE_RECEIPT_MISMATCH`, `details.differences`); seçici `GET /api/goods-receipts?filter[invoiced]=false`.
- **[ÇEKİRDEK]** Tedarikçi kimliği de karttır: alış siparişi/mal kabul (`resolveSupplierParty`) ve PURCHASED levent yazımda `resolvePartyToCardTx` ile karta çözer; uyum çözümden sonra ölçülür; okuma iki bacağı kabul eder; profil→kart okuması tek helper.
- **[ÇEKİRDEK]** Hizmet satırını yalnız emanet top için `collectShipmentServiceBilling` (`helpers/service-billing.helper.ts`) kurar; iş başına tek aktif `ServiceBillingLink` (`service_billing_links_active_uq`); `serviceAt` = ilk SIMULATED olmayan OUT okuması; iptal bağı aynı tx'te damgalar.
- **[ÇEKİRDEK]** Faturalı işin düzeltmesi ve sevk geri alması 409 `SERVICE_ALREADY_BILLED`; `finance.serviceBilling.enabled` kapalıyken taslak bayt-aynı; Σ satır qty ≠ Σ bağ metresi 409 `SERVICE_LINES_MISMATCH`; bağlı taslak 8023 kilidini İLK alır.
- **[ÇEKİRDEK]** Dönem sonu hizmet faturası yalnız `collectPeriodServiceBilling` (`service-period-invoice.service.ts`); 8023 id sırası; kapalı dönem 409 `SERVICE_PERIOD_CLOSED`; `trigger=PERIOD_END`de sevk taslağına hizmet satırı koyma; geri alma kapısı `listShipmentServiceBilledDocNos`.
- **[ÇEKİRDEK]** Tetik yalnız `resolveCustomerServiceBillingTrigger` (`CariAccount.serviceBillingTrigger`, NULL = fabrika ayarı); dönem taslağı "Her sevkte" müşteriye de açık; `DISPATCH_DAY`de her iş kendi sevk anının fiyatına çözülür.
- **[ÇEKİRDEK]** Panel sevk taslağının hizmet bağlarını gövdeden alma: 8023 altında `resolveShipmentServiceLinksTx` (`helpers/service-preview-gate.helper.ts`) ile yeniden çöz; uyuşmazlık 409 `SERVICE_PREVIEW_STALE`, bağsız emanet hizmet satırı 409 `SERVICE_LINE_UNLINKED`; ata kalanı DECLARED.
- Hizmet faturası tetiğini kart formunda (`finance.serviceBillingTrigger`) yalnız `cariService.update` ile yaz.
- **[ÇEKİRDEK]** `collectServiceBillingDraft` fatura tx'inde tx istemcisini (`db`) kullanır; dönem toplayıcısı doğrudan sevkleri (DSK, `roll.directShipmentId`) de sayar; dönem taslağına aktif bağsız eşlenmiş hizmet satırı eklenemez → 409 `SERVICE_LINE_UNLINKED`.
- **[ÇEKİRDEK]** Kurşun dışı hizmet işi `listFlagServiceWorks` (`helpers/service-flag-work.helper.ts`); metre: istasyon okuması → fason kabul (RECEIVED) → Tambur kesimi (CUT) → mevcut (DECLARED); `KURSUN` okunmaz; faturalı özellik geri alınmaz (409); gelir `ItemPrice`, `FinishingRate` okunmaz.
- **[ÇEKİRDEK]** Adım hizmet işi (`finance.serviceBilling.stepWorks`, [PROFİL] kapalı) yalnız `listStepServiceWorks` (`helpers/service-step-work.helper.ts`): süreç türü → kart yalnız `service_item_processes` (tür başına tek kart); iç adım kapanmış aktif hareketle (OUT → IN → `qtyOut`), dış adım yalnız iptalsiz kabulde (RECEIVED); yalnız simüle okumalı adım girmez, metresi bulunamayan iş uyarısız düşmez; aynı TOP (soyu dahil) aynı adımda kurşun/bayrak verdiyse adım işi yazma — öncelik top başına, sevk birlikteliğine bağlanmaz.
- **[ÇEKİRDEK]** Levent sarımı ve dokuma hizmeti (`finance.serviceBilling.weavingWorks`, [PROFİL] kapalı; ikisini birden kapılar — patron kabulü): levent işini yalnız AKTİF `SHIP_TO_OWNER` olayından ve yalnız DÖNEM taslağına yaz (`helpers/service-winding-work.helper.ts`, bağ `WARP_BEAM`/`rollId` null/WOUND; levent TEK sarım işidir — faturalı anahtarı yalnız levent, kart değil; bizde sarılmamış levent uyarısız düşer; fiyat her çıkışın KENDİ anından, bütün anlar tek sorguda `resolveItemPricesAtMany`); emanet çıkış iptali bağı `revokeWindingLinksForConsignmentTx` ile aynı tx'te damgalar (DRAFT dışı faturada 409 `CONSIGNMENT_BEAM_INVOICED`), fatura tx'i leventi FOR UPDATE kilitleyip olayı yeniden doğrular; dokuma işinin öznesi doğan toptur, zincir yalnız `weaving-order-of-roll.helper`.
- **[ÇEKİRDEK]** Hizmet kalemi yalnız `pickServiceItemId` (`helpers/service-item-pick.helper.ts`): çeşit değeri → özellik → ana bayrak; `.serviceItemId ?? ifade` zinciri başka dosyada yazılmaz.
- **[ÇEKİRDEK]** Miktar yalnız `helpers/service-quantity.helper.ts` (`serviceWorkQuantity`, `linkBilledQty`); `finance.serviceBilling.brodeUnit` ([PROFİL] METER) yalnız `BRODE_PROPERTY_CODE`; `ItemPrice.priceUnit` uyuşmazsa fiyat yok; eksik adet/vuruş girmez; `billedMeters` miktar değil.
- **[ÇEKİRDEK]** Brode adedi tablette çıkış okumasında (`meterOut.pieceCount`); sayaç OFF iken PIECE/STITCH ↔ OFF iki yönde 400 `BRODE_UNIT_NEEDS_METER_CAPTURE`.
- **[ÇEKİRDEK]** Yeni özellik/değer → hizmet kartı eşlemesi `assertServiceItemUsable(DEFINITION)`den geçer (409 `ITEM_INACTIVE`); yalnız aynı kaydın taşıdığı eşleme yeniden doğrulanmaz.
- **[ÇEKİRDEK]** Eşleme, müşterili aktif `ItemPrice`, aktif sarf normu ve taslak fatura satırı hizmet kartının canlı referansıdır (`SERVICE_ITEM_LIVE_REF_KINDS`, `helpers/service-item-lifecycle.helper.ts`): pasife alma 409 `ITEM_HAS_LIVE_REFERENCES` + liste; yazım `assertServiceItemUsableTx(DEFINITION)`, `withServiceMapping` → `withServiceItemLocks` (8030 SHARED → `service_items` FOR SHARE).
- **[ÇEKİRDEK]** Hizmet kartı yalnız `service_items`'ta yaşar (`items_no_service_ck`); fatura satırı konusu `lineType` ile seçilir (PRODUCT→`itemId`, SERVICE→`serviceItemId`, TEXT→ikisi boş; `invoice_lines` CHECK), `lineType`siz eski gövdeyi yalnız `helpers/invoice-line-subject.helper.ts` (`classify`) çözer.
- **[ÇEKİRDEK]** `CariHold`ı (tek aktif, `releasedAt IS NULL`) yalnız `cari-hold.service` koyar/açar (damga, claim, silinmez, deftere girmez); soru yalnız `helpers/cari-hold.helper.ts` (`activeHoldByCari` · `activeHoldByCustomer` · `assertCariNotHeldTx` → 409 `CARI_HOLD`); finans import etmez.
- **[ÇEKİRDEK]** Aynı kartın iki hareketli hesabını yalnız virmanla birleştir (`helpers/cari-merge.helper.ts`; bugün tarihli `CARI_TRANSFER` çiftleri, kur dönüşümü yok, kaynak pasif + `mergedIntoId`; engel 409 `CARI_MERGE_BLOCKED`); geri alma yalnız `revertCariMerge`; birleşmiş hesabı çözücü seçmez.
- **[ÇEKİRDEK]** Panel birleştirme `planCariMerge`/`applyCariMerge` çağırır; `cariMergePlanStamp` değiştiyse 409 `CARI_MERGE_STALE`; `clientToken` virman grubu kimliği; birleşmiş hesap alan kaynak olamaz; izin `finance:cari-merge` (SoD).
- **[ÇEKİRDEK]** Birleşmiş (`mergedIntoId`) hesaba defter satırı/kapama/kapama çözme yazma (`assertPeriodOpenTx`, `helpers/cari-merged-guard.helper.ts` → 409 `CARI_MERGED`); istisna `allowMerged`.
- **[ÇEKİRDEK]** Cari kilidi kapısı yalnız beş boğazda: gelen belge onayı (`cariHoldIntakeGate`), sipariş `prepareOrderCreate` + `update` INTAKE · `createShipmentCoreTx` + `performDispatchTx` SHIPMENT · `confirm` SALES INVOICE; taslak/iade/storno/tahsilat helper'ı import etmez.
- **[PROFİL]** Kilitli caride emanet sevki `finance.cariHold.emanetShipment` (EXEMPT varsayılan · PROCESSED_HELD · ALL_HELD); karar ve `PROCESSED_ROLL_WHERE` yalnız `emanetShipmentReleaseTx` (`helpers/emanet-shipment.helper.ts`); 409 `CARI_HOLD` `details.heldRolls`.
- **[ÇEKİRDEK]** Risk limiti yalnız `riskExposureTx` (`helpers/risk-exposure.helper.ts`; `cari_balances` FOR UPDATE); fatura onayı ek = tutar, iş kabulü/sevk ek = 0, `finance.riskLimitBlock.intake` / `.shipment` açıkken; aşım 409 `RISK_LIMIT_EXCEEDED`.
- **[PROFİL]** `finance.riskLimit.currencyMode` `riskExposureTx` içinde okunur (`PER_CURRENCY` varsayılan · `TRY_CONVERTED` `resolveExchangeRateTx` ile kilitten sonra); kur yoksa 409 `RISK_LIMIT_FX_MISSING`, kur 1 varsayma.
- **[PROFİL]** KDV/tevkifat ön değeri yalnız `resolveInvoiceTaxDefaults` (`helpers/invoice-tax-defaults.helper.ts`): satış: cari ?? `finance.defaultVatRate`/`finance.withholding.*`; alış: KDV genel, tevkifat fason carisinin `purchaseWithholding*`ı ?? `finance.withholding.purchase.*` (genel yalnız fason rolü olan karta — kart aynı zamanda tedarikçiyse iplik/sarf faturasında da önerilir, satırda düzeltilir; saf tedarikçi ve tarafsız 0; varsayılan kapalı); oranı koda yazma; panel `GET /api/finance/invoices/tax-defaults` · bekçi: `test_kdv_tevkifat_ayari` <sub>(arşiv:2026-11-08)</sub>.
- **[ÇEKİRDEK]** Satış faturasında iş emrinin `materialProvidedBy` değeri `US` ise (işi yapan ve ana hammaddeyi veren bu fabrika) tevkifat önerisini 0'a çek (`performerSuppliedMainMaterial`); CUSTOMER · MIXED · NULL ve alış faturası bugünkü zincirde kalır; bekçi `test_kdv_tevkifat_ayari` §8 <sub>(arşiv:2026-11-08 F7b)</sub>.

## Geçersiz kılınan kurallar — bunlara UYMA

- "ERP fatura KESMEZ" yalnız finans modülü kapalı kurulumda doğrudur; açıkken iç fatura kesilir, çakışma `shipping.invoiceMode` ile yönetilir.

## Çözülmüş çelişkiler

- `invoiceNo` dış iz olarak kalır (`dis`), iç onay her modda damgalar, elle iz `ic`de 400.
- Beş sınıf ÇEKİRDEK; iki ticaret bayrağının değeri [PROFİL].

## Açık sorular

- Kök dizin satırı 'ERP fatura KESMEZ' niteliksiz.
- Sınıf 1/2/5 için adlı mekanik bekçi belirsiz.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_hizmet_adim_isi`, `test_hizmet_ozne_polimorfik`, `test_fatura_liste_suzgec`, `test_brode_fiyat_birimi`, `test_masraf_ozeti`, `test_masraf_bagi`, `test_kasa_kategori_suzgeci`, `test_hizmet_brode_tambur`, `test_desen_fatura_kalemi`, `test_cari_ekstre_sirasi`, `test_cek_bordro_hareket`, `test_cek_bordro_taslak_token`, `test_cek_bordro_excel_esit`, `test_cek_bordro_altin`, `test_partner_roles`, `test_cari_kart_hesap`, `test_cari_birlestirme_virman`, `test_cari_birlestirme_panel`, `test_kart_teardown_hesap`, `test_cari_hesap_tek_yazar`, `test_cari_kilit`, `test_cari_kilit_kapilar`, `test_risk_limiti_kapilar`, `test_risk_limiti_tl_cevrimi`, `test_cari_kilit_emanet_ayari`, `test_sevk_kapisi_cari_kilit`, `test_finance_regime_gate`, `test_supplier_party_tek_adres`, `test_invoice_receipts`, `test_auto_draft_shipment`, `test_cash_single_writer`, `test_cash_negative_guard`, `test_cash_period_close`, `test_cheque_portfolio`, `test_cheque_reversal`, `test_defter_ters_yol`, `test_consistency`, `test_dispatch_report_gross`, `test_exchange_rate_fetch`, `test_finance_documents`, `test_finance_flag_off`, `test_finance_invoice`, `test_finance_opening`, `test_finance_reports`, `test_finance_vat`, `test_fx_diff_report`, `test_goods_receipt`, `test_goods_receipt_preflight`, `test_goods_receipt_invoice`, `test_gr_order_price_currency`, `test_iplik_regime_gate`, `test_item_price`, `test_item_price_surum`, `test_official_finance_docs`, `test_payment_allocation`, `test_period_close`, `test_purchase_order`, `test_receipt_qty_readers`, `test_receipt_qty_single_source`, `test_roll_po_line_trace`, `test_setup_ticaret`, `test_shipment_invoice`, `test_shipping_flags`, `test_status_labels`, `test_stock_count`, `test_ticaret_links_and_filters`, `test_ticaret_regime_gate`, `test_ticaret_turkish_search`, `test_yarn_stock`, `test_yarn_lot`, `test_hizmet_fatura`, `test_hizmet_kalemi_yaris`, `test_kdv_tevkifat_ayari`, `test_cari_kilit_panel`, `test_import_acilis_aktarimi`, `test_migrate_partner_roles`, `test_shipment_list_gross`, `test_db_invariants`, `test_warp_beam_auto_consume`, `test_role_template_catalog`, `test_yetki_denetimi`, `test_feature_flag_contract`, `test_shipment_list_sort`, `test_hizmet_fiyati`, `test_item_archive_gate`

İstemci: `supplierParty.test.ts`, `useItemPriceSuggestion.test.ts`, `audit-labels.trade.test.ts`, `prices.test.ts`, `regime.test.ts`, `carilerPaging.test.ts`, `CariEditDialog.test.ts`, `cashTxnRules.test.ts`, `chequeBordro.test.ts`, `chequeDeliveryNote.test.ts`, `chequeNoteMovement.test.ts`, `ChequeBordroDialog.movement.test.tsx`, `DeliveryNoteCancelPanel.test.tsx`, `chequeExport.test.ts`, `reversal.test.ts`, `transitions.test.ts`, `InvoiceFormDialog.test.tsx`, `cashService.test.ts`, `invoiceDetail.test.ts`, `invoiceDetailPermission.test.tsx`, `invoiceForm.test.ts`, `invoicesList.test.ts`, `officialDocs.test.ts`, `paymentFilters.test.ts`, `reconciliationLetter.test.ts`, `settlement.test.ts`, `statementDevir.test.ts`, `statementLink.test.ts`, `ShipmentInvoiceDraft.test.tsx`, `accounting-export.test.ts`, `invoiceDraftLines.test.ts`, `invoiceDraftVisibility.test.ts`, `GoodsReceiptDetailSheet.test.tsx`, `GoodsReceiptFormDialog.test.tsx`, `GoodsReceiptsPage.test.tsx`, `goodsReceipt-regime.test.ts`, `receiptFeedback.test.ts`, `receiptImport.test.ts`, `receiptLineRows.test.ts`, `service.test.ts`, `filterScope.test.ts`, `fulfillment.test.ts`, `po-regime.test.ts`, `receiptOrderFields.test.ts`, `receiptSync.test.ts`, `returnInvoice.test.ts`, `qty.test.ts`, `yarn-regime.test.ts`, `chequeDueExport.test.ts`, `fxDiffExport.test.ts`, `statementExport.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

`CLAUDE-NOT-ARSIVI.md:53-61` (2026-08-02 brüt liste) · `arsiv/2026-09.md` (09-23 İki saat) · `arsiv/2026-10.md` (10-29 Gülkesim H7, H8, H8b, D4-H1, F1, K3b) · `arsiv/2026-11.md` (11-08 hizmet kartı `service_items` ayrımı · 11-08 genel fason F3 adım hizmeti · 11-08 genel fason F4 polimorfik özne).
