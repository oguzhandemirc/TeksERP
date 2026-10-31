// =============================================================================
// BİRLEŞTİRME HARİTASI — Kalem bacağı
// =============================================================================
// ⚠️ SÖZLEŞME DEĞİŞMEDİ: bu dosya yalnız SATIRLARI taşır. `MERGE_MAP` tek nesne
// olarak `merge-map.ts`ten çıkmaya devam eder ve `master-data-merge.service`in
// jenerik sürücüsü (`MERGE_MAP[entity]` döngüsü) hiçbir değişiklik görmez.
//
// NEDEN BÖLÜNDÜ (2026-09-13): dosya `max-lines` sınırına (300) dayandı ve içinde
// DÖRT AYRI İŞ vardı — dört birleştirilebilir varlığın kuralları. Tavan burada
// gerçek bir dikiş gösterdi; her yeni model haritayı büyüteceği için (dokuma P2/P3)
// tavanı yükseltmek sınırı anlamsızlaştırırdı.
// =============================================================================
import type { MoveRule } from "./merge-map";

export const ITEM_MERGE_RULES: MoveRule[] = [
    { kind: "MOVE", model: "Roll", table: "rolls", column: "itemId", label: "Top" },
    { kind: "MOVE", model: "OrderLine", table: "order_lines", column: "itemId", label: "Sipariş kalemi" },
    { kind: "MOVE", model: "WorkOrder", table: "work_orders", column: "targetItemId", label: "Terbiye iş emri (hedef kumaş)" },
    { kind: "MOVE", model: "ProductRecipe", table: "product_recipes", column: "itemId", label: "Reçete" },
    // ⚠️ SIRA LOAD-BEARING (kilit sırası sınıfı, 2026-09-12): düşüm defteri
    // kartelalardan ÖNCE gelir. Kartela stok düşümü/stornosu da ilk önce düşüm
    // BAŞLIĞINI claim edip sonra kartelaya yazıyor; ters sıra iki tx arasında
    // 40P01 (deadlock) üretirdi. İki yolda tek sıra: düşüm → kartela.
    { kind: "MOVE", model: "SwatchStockReduction", table: "swatch_stock_reductions", column: "itemId", label: "Kartela stok düşümü" },
    { kind: "MOVE", model: "Swatch", table: "swatches", column: "itemId", label: "Kartela" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "itemId", label: "İade" },
    // 2026-09-12 (devere Faz 1a) — çözgü kartının İPLİĞİ. MOVE, CONFLICT değil:
    // bağ bir REFERANSTIR (parasal/ticari/kalite sonucu yok) ve `warp_specs`te
    // `yarnItemId` üzerinde tekillik kısıtı YOK, yani taşımak çakışma üretemez.
    // Taşınmazsa çözgü kartı mezar taşına bakmaya devam eder ve levent doğarken
    // denye ölü karttan okunurdu. `YarnMovement.itemId` emsali.
    { kind: "MOVE", model: "WarpSpec", table: "warp_specs", column: "yarnItemId", label: "Çözgü kartı (iplik)" },
    // 2026-09-13 (dokuma P1) — üç `weaving_orders` bağı da MOVE: referans bağ,
    // tekillik kısıtı yok; taşınmazsa dokuma işi ölü kayda bağlı kalır.
    { kind: "MOVE", model: "WeavingOrder", table: "weaving_orders", column: "itemId", label: "Dokuma iş emri" },
    // 2026-09-13 (dokuma P2) — koşumun "ne dokunuyor" ekseni. Aynı sınıf: referans
    // bağ, `machine_runs`ta `itemId` üstünde tekillik kısıtı yok. ⚠️ Koşum bir
    // DEFTER satırıdır ve geri alınmışı da taşınır — birleştirme kimliği
    // değiştirir, geçmişi değil.
    { kind: "MOVE", model: "MachineRun", table: "machine_runs", column: "itemId", label: "Tezgah koşumu" },
    // K4P-LAB (2026-10-25) — lab testinin kumaş snapshot'ı: referans bağ, tekillik yok;
    // birleştirme kimliği değiştirir, test sonucunu değil.
    { kind: "MOVE", model: "LabTest", table: "lab_tests", column: "itemId", label: "Lab testi" },
    // 2026-09-15 (fason G1) — fasona giden iplik kalemi (kind=YARN): referans bağ, tekillik yok;
    // `YarnMovement.itemId` ile aynı sınıf — birleştirme kimliği değiştirir, kg'yi değil.
    { kind: "MOVE", model: "SubcontractorDispatchItem", table: "subcontractor_dispatch_items", column: "yarnItemId", label: "Fason iplik kalemi" },
    {
      kind: "CONFLICT",
      model: "ItemAllowedColor",
      table: "item_allowed_colors",
      column: "itemId",
      label: "İzin verilen renk",
      uniqueOn: ["itemId", "colorId"],
      policy: "EMPTY_MEANS_ALL",
      why: "Satır kümesi KISITTIR, küme değil — boş = hepsi serbest. Yukarıdaki uzun nota bak.",
    },
    {
      kind: "CONFLICT",
      model: "ItemAllowedProperty",
      table: "item_allowed_properties",
      column: "itemId",
      label: "İzin verilen özellik",
      uniqueOn: ["itemId", "propertyId"],
      policy: "EMPTY_MEANS_ALL",
      why: "Aynı kural — boş = hepsi serbest.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerItemAlias",
      table: "customer_item_aliases",
      column: "itemId",
      label: "Müşteri ürün adı",
      uniqueOn: ["customerId", "itemId"],
      policy: "SKIP",
      why: "Müşteri tarafındakiyle aynı gerekçe — alias etikete basılıyor.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerItemColorAlias",
      table: "customer_item_color_aliases",
      column: "itemId",
      label: "Müşteri kumaşa özel renk adı",
      uniqueOn: ["customerId", "itemId", "colorId"],
      policy: "SKIP",
      why:
        "Müşteri tarafındakiyle aynı: survivor'ın adı kazanır, kaynaklar arası aynı anahtarda " +
        "kaynak sırasında İLK gelen kazanır, çakışmayan satır taşınır.",
    },
    // —— Ticaret / iplik / fatura bacağı ————————————————————————————————————
    { kind: "MOVE", model: "InvoiceLine", table: "invoice_lines", column: "itemId", label: "Fatura kalemi" },
    { kind: "MOVE", model: "YarnMovement", table: "yarn_movements", column: "itemId", label: "İplik hareketi" },
    {
      // Devere Faz 2 — lot kalemin ALTINDAKİ kimliktir (`[itemId, lotNo]` tekil): iki kalemde
      // aynı lot numarası varsa birleştirme iki lotu tek satıra indiremez (hareketleri ayrı
      // lotlara bağlı) — sessizce toplamak lot bakiyesini yalanlar. Farklı numaralar taşınır.
      kind: "CONFLICT",
      model: "YarnLot",
      table: "yarn_lots",
      column: "itemId",
      label: "İplik lotu",
      uniqueOn: ["itemId", "lotNo"],
      policy: "BLOCK",
      why: "Aynı lot numarası iki kalemde: lotlar hareketlerin kimliğidir, birleştirilemez — önce birini pasife alıp hareketlerini karşı lota düzeltme belgesiyle taşıyın.",
    },
    { kind: "MOVE", model: "PurchaseOrderLine", table: "purchase_order_lines", column: "itemId", label: "Alış siparişi kalemi" },
    {
      kind: "CONFLICT",
      model: "YarnStock",
      table: "yarn_stocks",
      column: "itemId",
      label: "İplik stok bakiyesi",
      uniqueOn: ["itemId", "warehouseId"],
      policy: "BLOCK",
      why:
        "Aynı depoda iki bakiye satırı DEFTERDİR: doğru sonuç toplama değil, hareket üreten bir " +
        "sayım/düzeltme belgesidir (kg sessizce toplanırsa `YarnMovement` toplamıyla drift eder " +
        "ve mutabakat §27 kırmızı yanar). Çakışma yalnız AYNI depoda doğar; farklı depolar taşınır.",
    },
    {
      kind: "CONFLICT",
      model: "FourPointRuleSet",
      table: "four_point_rule_sets",
      column: "itemId",
      label: "4 puan ürün kural seti",
      uniqueOn: ["customerId", "itemId"],
      policy: "BLOCK",
      why:
        "Aynı müşterinin iki ürününe ayrı spesifikasyon yazılmışsa birleşmiş üründe hangisinin " +
        "geçerli olduğunu yalnız kalite sorumlusu bilir (K4P); `customer_item_uq` ile birebir.",
    },
    { kind: "MOVE", model: "WeftSpecYarn", table: "weft_spec_yarns", column: "yarnItemId", label: "Atkı spesifikasyonu ipliği" },
    {
      kind: "CONFLICT",
      model: "YarnCostPrice",
      table: "yarn_cost_prices",
      column: "yarnItemId",
      label: "İplik maliyet fiyatı",
      uniqueOn: ["yarnItemId"],
      // Partial UNIQUE (`yarn_cost_prices_active_uq`) yalnız aktif satırda: damgalı geçmiş serbestçe taşınır.
      activeWhenNull: ["revokedAt"],
      policy: "BLOCK",
      why: "İki ipliğin de aktif maliyet fiyatı varsa hangisinin geçerli olduğunu yalnız muhasebe bilir (MAL-1; ItemPrice emsali).",
    },
    {
      kind: "CONFLICT",
      model: "CostStructure",
      table: "cost_structures",
      column: "itemId",
      label: "Ürün maliyet yapısı",
      uniqueOn: ["itemId"],
      policy: "BLOCK",
      why: "Kumaş başına tek maliyet yapısı (`itemId @unique`); iki yapıdan hangisinin doğru olduğu operatör kararıdır (MAL-1).",
    },
    {
      kind: "CONFLICT",
      model: "StandardCostVersion",
      table: "standard_cost_versions",
      column: "itemId",
      label: "Standart maliyet sürümü",
      // Sürüm numarası kumaş içinde sıralıdır (v1'den başlar): iki kumaşın da sürümü varsa numaralar çakışır.
      uniqueOn: ["itemId", "versionNo"],
      policy: "BLOCK",
      why: "Donmuş maliyet fotoğrafı; iki kumaşın sürüm geçmişi tek kumaşta birleştirilemez — hangisinin yürürlükte kalacağı muhasebe kararıdır (MAL-2).",
    },
    { kind: "MOVE", model: "StandardCostLine", table: "standard_cost_lines", column: "yarnItemId", label: "Standart maliyet kalemi ipliği" },
    // MAL-4: teklif kalemi ürüne referans bağdır (tekillik yok). Fiyat listesi satırı liste içinde ürün+renk başına tektir.
    { kind: "MOVE", model: "SalesQuoteLine", table: "sales_quote_lines", column: "itemId", label: "Teklif kalemi" },
    { kind: "MOVE", model: "CustomerDeliveryNoteLine", table: "customer_delivery_note_lines", column: "itemId", label: "Gelen belge satırı" },
    // E4: sahibe özel varsayılan ürün referans bağdır (ürün tarafında tekillik yok) — birleşen ürüne taşınır.
    { kind: "MOVE", model: "DeliveryNoteCustomerDefault", table: "delivery_note_customer_defaults", column: "defaultItemId", label: "Gelen belge varsayılan ürünü" },
    // H6: hizmet kalemi eşlemesi referans bağdır (tekillik yok) — birleşen hizmet kalemine taşınır.
    { kind: "MOVE", model: "FabricProperty", table: "fabric_properties", column: "serviceItemId", label: "Özellik hizmet eşlemesi" },
    { kind: "MOVE", model: "FabricPropertyValue", table: "fabric_property_values", column: "serviceItemId", label: "Gramaj değeri hizmet eşlemesi" },
    {
      kind: "CONFLICT",
      model: "ServiceBillingLink",
      table: "service_billing_links",
      column: "serviceItemId",
      label: "Hizmet fatura bağı",
      // Partial UNIQUE `service_billing_links_active_uq` (rollId, serviceItemId, workOrderStepId) NULLS NOT DISTINCT,
      // yalnız aktif. Anahtar BİLEREK geniş (adımı dışarıda): survivor yüklemi `=` ile eşler, adımsız (NULL) bağ
      // kaçardı — geniş anahtar fail-closed; iptal damgalı bağ serbestçe taşınır.
      uniqueOn: ["rollId", "serviceItemId"],
      activeWhenNull: ["revokedAt"],
      policy: "BLOCK",
      why:
        "Aynı top işi iki hizmet kalemiyle AYRI faturalanmışsa birleşmiş kalemde çift fatura olur; hangi " +
        "faturanın iptal edileceği muhasebe kararıdır (H7). Çakışmasız bağ taşınır (fatura kalemi emsali).",
    },
    // D4-H3: masraf payı hizmet kalemine referans bağdır (tekillik yok) — birleşen hizmet kalemine taşınır.
    { kind: "MOVE", model: "ExpenseAllocation", table: "expense_allocations", column: "serviceItemId", label: "Masraf payı (hizmet kalemi)" },
    // D4-G1a: sarf normu damgalı sürüm ana verisidir; partial UNIQUE (serviceItemId, consumableItemId) yalnız aktifte.
    {
      kind: "CONFLICT",
      model: "ServiceConsumableNorm",
      table: "service_consumable_norms",
      column: "serviceItemId",
      label: "Sarf normu (hizmet kalemi)",
      uniqueOn: ["serviceItemId", "consumableItemId"],
      activeWhenNull: ["revokedAt"],
      policy: "BLOCK",
      why: "İki hizmet kaleminin aynı sarf için ayrı aktif normu varsa birleşmiş kalemde hangisinin geçerli olduğunu yalnız maliyet sorumlusu bilir (ItemPrice emsali).",
    },
    {
      kind: "CONFLICT",
      model: "ServiceConsumableNorm",
      table: "service_consumable_norms",
      column: "consumableItemId",
      label: "Sarf normu (sarf kalemi)",
      uniqueOn: ["serviceItemId", "consumableItemId"],
      activeWhenNull: ["revokedAt"],
      policy: "BLOCK",
      why: "Aynı hizmette iki sarf kaleminin ayrı aktif normu varsa birleşmiş sarfta hangisinin geçerli olduğunu yalnız maliyet sorumlusu bilir.",
    },
    {
      kind: "CONFLICT",
      model: "PriceListLine",
      table: "price_list_lines",
      column: "itemId",
      label: "Fiyat listesi satırı",
      uniqueOn: ["priceListId", "itemId", "colorId"],
      policy: "BLOCK",
      why: "Aynı listede iki ürünün de satırı varsa birleşen ürüne iki fiyat düşer — hangisinin geçerli olduğu satış kararıdır (MAL-4).",
    },
    {
      kind: "CONFLICT",
      model: "CustomerLabSpec",
      table: "customer_lab_specs",
      column: "itemId",
      label: "Müşteri lab spesifikasyonu (ürün)",
      uniqueOn: ["customerId", "itemId", "testTypeId"],
      policy: "BLOCK",
      why:
        "Aynı müşterinin iki ürününe aynı test türü için ayrı sınır yazılmışsa birleşmiş üründe hangisinin " +
        "geçerli olduğunu yalnız kalite sorumlusu bilir (K4P-SERT); `customer_item_uq` ile birebir.",
    },
    {
      kind: "CONFLICT",
      model: "ItemPrice",
      table: "item_prices",
      column: "itemId",
      label: "Fiyat kartı",
      uniqueOn: ["itemId", "kind", "currency"],
      // İki KAYNAK arasında geniş anahtar yanlış bloklardı (farklı müşterilerin istisnaları
      // ya da varsayılan + istisna aynı hedefte yan yana durabilir): iki partial UNIQUE'in birebiri.
      crossSourceOn: { columns: ["customerId", "kind", "currency"], nullSafe: ["customerId"] },
      // Partial UNIQUE yalnız aktif satırda: damgalı fiyat geçmişi serbestçe taşınır (MAL-0b).
      activeWhenNull: ["revokedAt"],
      policy: "BLOCK",
      why:
        "Hangi fiyatın geçerli olduğunu yalnız operatör bilir. Anahtar BİLEREK iki partial " +
        "UNIQUE'in GENİŞ olanı: dar anahtar (`itemId, customerId, kind, currency`) kart " +
        "varsayılanlarını NULLS DISTINCT yüzünden çakışma saymaz ve düz UPDATE P2002 ile " +
        "patlardı — geniş anahtar bazı ayrılabilir satırları da bloklar, bu bilinçli fail-closed.",
    },
    {
      kind: "CONFLICT",
      model: "StockCountLine",
      table: "stock_count_lines",
      column: "itemId",
      label: "Sayım kalemi",
      uniqueOn: ["stockCountId", "itemId"],
      policy: "BLOCK",
      why:
        "Aynı sayım fişinde iki kalem birleşirse sayılan miktar sessizce kaybolur; sayım " +
        "tutanağı geçmiş bir ölçümün kaydıdır, yeniden yazılmaz. Çakışma yalnız AYNI fişte doğar.",
    },
];
