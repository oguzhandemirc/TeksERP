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
    { kind: "MOVE", model: "WorkOrder", table: "work_orders", column: "targetItemId", label: "İş emri (hedef kumaş)" },
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
    { kind: "MOVE", model: "WeavingOrder", table: "weaving_orders", column: "itemId", label: "Dokuma işi" },
    // 2026-09-13 (dokuma P2) — koşumun "ne dokunuyor" ekseni. Aynı sınıf: referans
    // bağ, `machine_runs`ta `itemId` üstünde tekillik kısıtı yok. ⚠️ Koşum bir
    // DEFTER satırıdır ve geri alınmışı da taşınır — birleştirme kimliği
    // değiştirir, geçmişi değil.
    { kind: "MOVE", model: "MachineRun", table: "machine_runs", column: "itemId", label: "Tezgah koşumu" },
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
      model: "ItemPrice",
      table: "item_prices",
      column: "itemId",
      label: "Fiyat kartı",
      uniqueOn: ["itemId", "kind", "currency"],
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
