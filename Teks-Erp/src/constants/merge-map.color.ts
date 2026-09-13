// =============================================================================
// BİRLEŞTİRME HARİTASI — Renk bacağı
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

export const COLOR_MERGE_RULES: MoveRule[] = [
    { kind: "MOVE", model: "Roll", table: "rolls", column: "colorId", label: "Top" },
    { kind: "MOVE", model: "OrderLine", table: "order_lines", column: "colorId", label: "Sipariş kalemi" },
    { kind: "MOVE", model: "WorkOrder", table: "work_orders", column: "targetColorId", label: "İş emri (hedef renk)" },
    { kind: "MOVE", model: "RouteStep", table: "route_steps", column: "plannedColorId", label: "Rota adımı (hedef renk)" },
    { kind: "MOVE", model: "ProductRecipe", table: "product_recipes", column: "colorId", label: "Reçete" },
    { kind: "MOVE", model: "SubcontractorReceipt", table: "subcontractor_receipts", column: "appliedColorId", label: "Fason kabul (uygulanan renk)" },
    // Kilit sırası: düşüm defteri kartelalardan ÖNCE (yukarıdaki gerekçe).
    { kind: "MOVE", model: "SwatchStockReduction", table: "swatch_stock_reductions", column: "colorId", label: "Kartela stok düşümü" },
    { kind: "MOVE", model: "Swatch", table: "swatches", column: "colorId", label: "Kartela" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "colorId", label: "İade" },
    { kind: "MOVE", model: "WeavingOrder", table: "weaving_orders", column: "colorId", label: "Dokuma işi" },
    {
      kind: "CONFLICT",
      model: "ItemAllowedColor",
      table: "item_allowed_colors",
      column: "colorId",
      label: "İzin verilen renk",
      uniqueOn: ["itemId", "colorId"],
      policy: "UNION",
      why:
        "⚠️ Kumaş tarafındaki 'boş = hepsi' asimetrisi BURADA GEÇERLİ DEĞİL: bir rengin yerine " +
        "başka bir renk yazılıyor, kısıt daralmıyor. Çakışan satır (aynı kumaş, survivor renk) " +
        "silinir; çakışmayan taşınır.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerColorAlias",
      table: "customer_color_aliases",
      column: "colorId",
      label: "Müşteri renk adı",
      uniqueOn: ["customerId", "colorId"],
      policy: "MERGE_FIELDS",
      why: "Müşteri tarafındakiyle aynı: assigned = OR, alias = COALESCE.",
    },
    {
      kind: "CONFLICT",
      model: "StationColor",
      table: "station_colors",
      column: "colorId",
      label: "İstasyon rengi",
      uniqueOn: ["stationId", "colorId"],
      policy: "UNION",
      why:
        "Tablo DEPRECATED (2026-08-02: renk istasyon kısıtı değil; satırlar duruyor, okuyan kod " +
        "yok). Yine de taşınıyor — 'exempt' yazmak, tabloyu bir gün okuyan biri çıktığında " +
        "sessiz bir tutarsızlık bırakırdı; taşımak bedava.",
    },
];
