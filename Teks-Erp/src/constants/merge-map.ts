// =============================================================================
// ANA VERİ BİRLEŞTİRME HARİTASI (Faz B2)
// =============================================================================
// Bir mükerrer kaydı survivor'a birleştirirken ONA İŞARET EDEN her satırın ne
// olacağı burada yazılı. Önizleme, uygulama VE bekçi aynı haritadan beslenir —
// üçünün ayrışması mümkün olmasın diye (izin kataloğu dersi: kopyalanan liste
// zamanla ayrışır).
//
// ⚠️ TAM KAPSAMA MEKANİK DOĞRULANIR: `scripts/test_master_data_merge_fk_coverage.ts`
// `schema.prisma` metninden bu dört modele işaret eden HER FK'yı türetir ve
// haritanın hepsini kapsadığını İKİ YÖNLÜ kontrol eder (bilinmeyen FK düşürür,
// ölü giriş de düşürür). Kapattığı delik: "gelecek yıl biri 13. FK'yı ekler,
// merge onu sessizce ölü kayda bakar bırakır."
//
// ⚠️ Türetme kaynağı `Prisma.dmmf` OLAMAZ (ölçüldü 2026-08-19): Prisma 7'nin
// runtime DMMF'i ilişki alanında yalnız `{name, kind, type, relationName}`
// taşır — `relationFromFields` YOKTUR, yani "Roll ile Item ilişkili" bilinir
// ama HANGİ KOLON üzerinden bilinmez ve kayıt ilişkinin iki yanında da görünür
// (sahiplik ayırt edilemez). Bu yüzden bekçi şema METNİNİ ayrıştırır.

export const MERGE_ENTITIES = ["customer", "item", "color", "subcontractor"] as const;
export type MergeEntity = (typeof MERGE_ENTITIES)[number];

/** Çakışma çözüm politikaları — gerekçeleri aşağıdaki haritada satır satır. */
export type ConflictPolicy =
  /** Survivor'ın satırı kalır, kaynağınki ATILIR (değeri önizlemede + audit'te). */
  | "SKIP"
  /** Çakışmayan satır taşınır, çakışan satır SİLİNİR (saf M:N kolaylık bağı). */
  | "UNION"
  /** UNION ama composite PK: `updateMany` PK'nın yarısını değiştiremez → DELETE+INSERT. */
  | "UNION_COMPOSITE_PK"
  /** Alan alan birleşir (OR / COALESCE) — bkz. `customer_color_aliases`. */
  | "MERGE_FIELDS"
  /** "Boş = hepsi" asimetrisi: survivor boşsa kaynağınki ATILIR (bkz. aşağı). */
  | "EMPTY_MEANS_ALL"
  /** Çözülemez — 409 ile operatöre geri döner (bkz. şube ihracat kodu). */
  | "BLOCK";

export type MoveRule =
  | { kind: "MOVE"; model: string; table: string; column: string; label: string }
  | {
      kind: "CONFLICT";
      model: string;
      table: string;
      column: string;
      label: string;
      /** Çakışmayı doğuran UNIQUE kısıtın kolonları. */
      uniqueOn: string[];
      policy: ConflictPolicy;
      why: string;
    }
  | { kind: "EXEMPT"; model: string; table: string; column: string; reason: string };

// —————————————————————————————————————————————————————————————————————————————
// ⚠️ "BOŞ = HEPSİ" ASİMETRİSİ — bu dosyanın en sinsi tek maddesi.
// `item_allowed_colors` / `item_allowed_properties` satır kümesi bir KÜME değil
// bir KISITTIR: satır yoksa "hepsi serbest" demektir. Survivor BOŞ + kaynak 3
// satır → naif union survivor'ı HEPSİ'ten 3'e DARALTIR ve o kumaş bir daha 4.
// renkle sipariş edilemez. Doğrusu: survivor boşsa kaynağınki ATILIR.
// ⚠️ Bu YALNIZ kumaş birleştirmesinde geçerli. RENK birleştirmesinde aynı tablo
// düpedüz dedupe'dur (bir rengin yerine başka renk yazılıyor, kısıt daralmıyor).
// —————————————————————————————————————————————————————————————————————————————

export const MERGE_MAP: Record<MergeEntity, MoveRule[]> = {
  customer: [
    { kind: "MOVE", model: "Order", table: "orders", column: "customerId", label: "Sipariş" },
    { kind: "MOVE", model: "Shipment", table: "shipments", column: "customerId", label: "Sevkiyat" },
    { kind: "MOVE", model: "DirectShipment", table: "direct_shipments", column: "customerId", label: "Doğrudan sevkiyat" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "customerId", label: "İade" },
    { kind: "MOVE", model: "Sack", table: "sacks", column: "customerId", label: "Çuval" },
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
  ],

  item: [
    { kind: "MOVE", model: "Roll", table: "rolls", column: "itemId", label: "Top" },
    { kind: "MOVE", model: "OrderLine", table: "order_lines", column: "itemId", label: "Sipariş kalemi" },
    { kind: "MOVE", model: "WorkOrder", table: "work_orders", column: "targetItemId", label: "İş emri (hedef kumaş)" },
    { kind: "MOVE", model: "ProductRecipe", table: "product_recipes", column: "itemId", label: "Reçete" },
    { kind: "MOVE", model: "Swatch", table: "swatches", column: "itemId", label: "Kartela" },
    { kind: "MOVE", model: "SwatchStockReduction", table: "swatch_stock_reductions", column: "itemId", label: "Kartela stok düşümü" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "itemId", label: "İade" },
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
  ],

  color: [
    { kind: "MOVE", model: "Roll", table: "rolls", column: "colorId", label: "Top" },
    { kind: "MOVE", model: "OrderLine", table: "order_lines", column: "colorId", label: "Sipariş kalemi" },
    { kind: "MOVE", model: "WorkOrder", table: "work_orders", column: "targetColorId", label: "İş emri (hedef renk)" },
    { kind: "MOVE", model: "RouteStep", table: "route_steps", column: "plannedColorId", label: "Rota adımı (hedef renk)" },
    { kind: "MOVE", model: "ProductRecipe", table: "product_recipes", column: "colorId", label: "Reçete" },
    { kind: "MOVE", model: "SubcontractorReceipt", table: "subcontractor_receipts", column: "appliedColorId", label: "Fason kabul (uygulanan renk)" },
    { kind: "MOVE", model: "Swatch", table: "swatches", column: "colorId", label: "Kartela" },
    { kind: "MOVE", model: "SwatchStockReduction", table: "swatch_stock_reductions", column: "colorId", label: "Kartela stok düşümü" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "colorId", label: "İade" },
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
  ],

  subcontractor: [
    { kind: "MOVE", model: "SubcontractorDispatch", table: "subcontractor_dispatches", column: "subcontractorId", label: "Fason sevk" },
    {
      kind: "MOVE",
      model: "SubcontractorDispatch",
      table: "subcontractor_dispatches",
      column: "plannedSubcontractorId",
      label: "Fason sevk (planlanan firma)",
    },
    { kind: "MOVE", model: "SubcontractorReceipt", table: "subcontractor_receipts", column: "subcontractorId", label: "Fason kabul" },
    { kind: "MOVE", model: "KartelaDispatch", table: "kartela_dispatches", column: "subcontractorId", label: "Kartela sevk" },
    { kind: "MOVE", model: "KartelaReceipt", table: "kartela_receipts", column: "subcontractorId", label: "Kartela kabul" },
    { kind: "MOVE", model: "RouteStep", table: "route_steps", column: "plannedSubcontractorId", label: "Rota adımı (planlanan firma)" },
    { kind: "MOVE", model: "WorkOrderStep", table: "work_order_steps", column: "plannedSubcontractorId", label: "İş emri adımı (planlanan firma)" },
    {
      kind: "CONFLICT",
      model: "SubcontractorToCategory",
      table: "subcontractor_category_links",
      column: "subcontractorId",
      label: "Firma kategorisi",
      uniqueOn: ["subcontractorId", "categoryId"],
      policy: "UNION_COMPOSITE_PK",
      why:
        "⚠️ Composite PK (`@@id([subcontractorId, categoryId])`), surrogate `id` YOK. " +
        "`updateMany` ile PK'nın yarısını değiştirmek çakışan satırda P2002 verir ve " +
        "`skipDuplicates` bir UPDATE'te yoktur → çakışmayanı taşı, çakışanı SİL.",
    },
  ],
};

/** Bir varlığın haritasındaki tabloların düz listesi (önizleme/bekçi için). */
export function rulesFor(entity: MergeEntity): MoveRule[] {
  return MERGE_MAP[entity];
}
