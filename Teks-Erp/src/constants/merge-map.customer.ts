// =============================================================================
// BİRLEŞTİRME HARİTASI — Müşteri bacağı
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

export const CUSTOMER_MERGE_RULES: MoveRule[] = [
    { kind: "MOVE", model: "Order", table: "orders", column: "customerId", label: "Sipariş" },
    { kind: "MOVE", model: "WarpBeam", table: "warp_beams", column: "supplierId", label: "Levent (hazır alım tedarikçisi)" },
    { kind: "MOVE", model: "Shipment", table: "shipments", column: "customerId", label: "Sevkiyat" },
    { kind: "MOVE", model: "DirectShipment", table: "direct_shipments", column: "customerId", label: "Doğrudan sevkiyat" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "customerId", label: "İade" },
    { kind: "MOVE", model: "Sack", table: "sacks", column: "customerId", label: "Çuval" },
    // Paketleme grubu (çalışma yaftası) da TAŞINIR: grup cariye özeldir ve
    // birleştirilen carinin açık hazırlıkları kaybolmamalı. Çuvallar `sacks`
    // satırıyla zaten taşınıyor; grup kaydı taşınmasaydı FK, birleştirmede
    // ölmüş bir cariye bakar kalırdı.
    { kind: "MOVE", model: "PackingGroup", table: "packing_groups", column: "customerId", label: "Paketleme grubu" },
    { kind: "MOVE", model: "Roll", table: "rolls", column: "labelCustomerId", label: "Top (etiket müşterisi)" },
    { kind: "MOVE", model: "Route", table: "routes", column: "customerId", label: "Rota şablonu" },
    {
      kind: "CONFLICT",
      model: "CustomerBranch",
      table: "customer_branches",
      column: "customerId",
      label: "Şube",
      uniqueOn: ["customerId", "code"],
      policy: "BLOCK",
      why:
        "Şube kodu gümrük belgesine basılan İHRACAT KODUDUR. NULL'lamak da son ek uydurmak da " +
        "basılan değeri değiştirir; doğru değeri yalnız operatör bilir. NULL kodlu şubeler " +
        "PG'de çakışmaz — onlar serbestçe taşınır, blok yalnız NOT NULL çakışmasında.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerItemAlias",
      table: "customer_item_aliases",
      column: "customerId",
      label: "Müşteri ürün adı",
      uniqueOn: ["customerId", "itemId"],
      policy: "SKIP",
      why:
        "Alias fiziksel ETİKETE basılıyor; survivor'ınki ŞU ANDA doğru basıyor. Kaynağınkini " +
        "üstüne yazmak, çalışan bir etiketi sessizce değiştirmek olurdu. Atılan değer " +
        "önizlemede gösterilir ve audit'e yazılır.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerColorAlias",
      table: "customer_color_aliases",
      column: "customerId",
      label: "Müşteri renk adı",
      uniqueOn: ["customerId", "colorId"],
      policy: "MERGE_FIELDS",
      why:
        "Düz SKIP burada YANLIŞ: `assigned` bayrağı 'bu renk bu müşteriye atanmış' demek. " +
        "Kaynağa atanmış bir renk survivor'da atanmamışsa, SKIP o rengi survivor'ın " +
        "'Müşteri Renkleri' listesinden DÜŞÜRÜR ve picker'da görünmez olur. " +
        "Doğrusu alan alan: assigned = OR, alias = COALESCE(survivor, kaynak).",
    },
    {
      kind: "CONFLICT",
      model: "CustomerTemplateRoute",
      table: "customer_template_routes",
      column: "customerId",
      label: "Belge şablon yönlendirmesi",
      uniqueOn: ["customerId", "kind"],
      policy: "SKIP",
      why:
        "Hangi şablonun basılacağı — survivor'ın ayarı son bilinçli karardır. " +
        "⚠️ Anahtar `templateId` DEĞİL `kind` (LabelKind); iki müşteri aynı türü farklı " +
        "şablona yönlendirmiş olabilir.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerStandaloneLabel",
      table: "customer_standalone_labels",
      column: "customerId",
      label: "Serbest etiket bağı",
      uniqueOn: ["customerId", "templateId"],
      policy: "UNION",
      why: "Saf M:N kolaylık bağı — birleşim kayıpsız ve doğru anlam.",
    },
    // —— Ticaret / ön muhasebe bacağı ——————————————————————————————————————
    // Bu dört FK ana veri birleştirmesinden SONRA main'e girdi (finans + satın
    // alma paketleri) ve haritaya hiç yazılmamıştı: birleştirme onları sessizce
    // atlıyor, satırlar tombstone bir müşteriye bakmaya devam ediyordu.
    { kind: "MOVE", model: "GoodsReceipt", table: "goods_receipts", column: "supplierId", label: "Mal kabul fişi (tedarikçi)" },
    { kind: "MOVE", model: "PurchaseOrder", table: "purchase_orders", column: "supplierId", label: "Alış siparişi (tedarikçi)" },
    {
      kind: "CONFLICT",
      model: "CariAccount",
      table: "cari_accounts",
      column: "customerId",
      label: "Cari hesap",
      uniqueOn: ["customerId"],
      policy: "BLOCK",
      why:
        "İki cari hesabın birleşmesi DEFTER kararıdır, taşıma değil: bakiye, para birimi ve " +
        "hareket geçmişi iki ayrı hesapta yaşıyor ve doğru kapanış yalnız muhasebenin bileceği " +
        "bir mahsup/virman belgesidir. Kısıt kolonun KENDİSİNDE (`customerId @unique`), yani " +
        "çakışma ancak İKİ tarafın da hesabı varsa doğar; tek taraflıysa satır serbestçe taşınır.",
    },
    {
      kind: "CONFLICT",
      model: "ItemPrice",
      table: "item_prices",
      column: "customerId",
      label: "Müşteri fiyat istisnası",
      uniqueOn: ["itemId", "customerId", "kind", "currency"],
      policy: "BLOCK",
      why:
        "Hangi fiyatın geçerli olduğunu yalnız operatör bilir — biri sessizce silinirse fatura " +
        "yanlış tutarla kesilir. Anahtar `item_price_customer_uq` ile birebir; kart varsayılanı " +
        "(customerId IS NULL) bu kolonun kaynak kümesine zaten girmez.",
    },
];
