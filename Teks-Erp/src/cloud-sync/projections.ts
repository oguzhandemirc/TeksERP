// =============================================================================
// PATRON BULUTU — PROJEKSİYON KATALOĞU (TEK KAYNAK)
// =============================================================================
// Buluta ne gider, hangi kolondan, hangi izinle, değişikliği nereden anlarız: bu
// dosya `docs/design/PATRON-BULUTU-ESITLEME.md` §3'ün KOD hâlidir ve o günden sonra
// belge buna uyar. Kolon listesi OPT-IN'dir — burada yazmayan kolon GİTMEZ.
// Adlar İngilizce; tel adları, projeksiyon adları ve kod değerleri Türkçe (sözleşme).
// =============================================================================
import { col, self, type Projection, type RecordProjection, type SnapshotProjection, type DataClass } from "./projection-types";
import { FACTS } from "./catalog-facts";

export * from "./projection-types";

// ── BOYUT projeksiyonları ─────────────────────────────────────────────────────
// Olgu satırları bu sözlüklere yalnız id ile işaret eder; ürün yeniden adlandırılınca
// bir satır gider, on bin sipariş kalemi değil.
const DIMENSIONS: readonly RecordProjection[] = [
  {
    name: "urun", kind: "KAYIT", role: "BOYUT", root: { table: "items", model: "Item" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("tur", "itemType"), col("birim", "unit"),
      col("yasamDurumu", "lifecycleStatus"), col("aktif", "isActive"), col("birlestigiKayit", "mergedIntoId")],
    derived: [], sources: [self("items")], deletion: "DAMGA", permission: "bulut:oturum", catalogVersion: 1,
  },
  {
    name: "renk", kind: "KAYIT", role: "BOYUT", root: { table: "colors", model: "Color" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("hex", "hex"), col("aktif", "isActive"),
      col("birlestigiKayit", "mergedIntoId")],
    derived: [], sources: [self("colors")], deletion: "YOK", permission: "bulut:oturum", catalogVersion: 1,
  },
  {
    name: "depo", kind: "KAYIT", role: "BOYUT", root: { table: "warehouses", model: "Warehouse" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("varsayilan", "isDefault"), col("aktif", "isActive")],
    derived: [], sources: [self("warehouses")], deletion: "DAMGA", permission: "bulut:oturum", catalogVersion: 1,
  },
  {
    name: "istasyon", kind: "KAYIT", role: "BOYUT", root: { table: "stations", model: "Station" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("tur", "type"), col("aktif", "isActive")],
    derived: [], sources: [self("stations")], deletion: "DAMGA", permission: "bulut:oturum", catalogVersion: 1,
  },
  {
    name: "cari-kart", kind: "KAYIT", role: "BOYUT", root: { table: "customers", model: "Customer" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("tur", "type"),
      col("musteriRolu", "isCustomerRole"), col("tedarikciRolu", "isSupplierRole"), col("fasonRolu", "isSubcontractorRole"),
      col("il", "city"), col("ilce", "district"), col("ulke", "country"), col("varsayilanYon", "defaultDestination"),
      col("yetkili", "contactName", "KISISEL"), col("telefon", "contactPhone", "KISISEL"),
      col("aktif", "isActive"), col("birlestigiKayit", "mergedIntoId"), col("olusturulma", "createdAt")],
    derived: [], sources: [self("customers")], deletion: "DAMGA", permission: "bulut:oturum", catalogVersion: 1,
  },
  {
    name: "sube", kind: "KAYIT", role: "BOYUT", root: { table: "customer_branches", model: "CustomerBranch" },
    columns: [col("id", "id"), col("cariKartId", "customerId"), col("kod", "code"), col("ad", "name"), col("il", "city"),
      col("ilce", "district"), col("varsayilanYon", "defaultDestination"), col("aktif", "isActive")],
    derived: [], sources: [self("customer_branches")], deletion: "YOK", permission: "bulut:oturum", catalogVersion: 1,
  },
  {
    name: "fason-firma", kind: "KAYIT", role: "BOYUT", root: { table: "subcontractors", model: "Subcontractor" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("cariKartId", "customerId"), col("aktif", "isActive"),
      col("birlestigiKayit", "mergedIntoId")],
    derived: [], sources: [self("subcontractors")], deletion: "YOK", permission: "bulut:oturum", catalogVersion: 1,
  },
];
// ── ANLIK (toplam) projeksiyonlar ─────────────────────────────────────────────
// Her turda bütünüyle yeniden hesaplanır; içerik özeti bir önceki ONAYLANANLA aynıysa
// GÖNDERİLMEZ. Çıktı `snapshots.ts`teki katı tel şemasından geçer (opt-in).
const SNAPSHOTS: readonly SnapshotProjection[] = [
  {
    name: "ozet", kind: "ANLIK", source: "cloud-sync/overview getFactoryOverview + dönem pencereleri",
    cadence: "HER_TUR", permission: "bulut:ozet:oku",
    reads: ["rolls", "order_lines", "orders", "sacks", "shipments", "work_order_steps", "subcontractor_dispatches", "subcontractor_dispatch_items"],
    sections: [
      { name: "ozet.stok", permission: "bulut:stok:oku" },
      { name: "ozet.siparis", permission: "bulut:siparis:oku" },
      { name: "ozet.uretim", permission: "bulut:uretim:oku", module: "production.enabled" },
      { name: "ozet.sevkiyat", permission: "bulut:sevkiyat:oku" },
      { name: "ozet.fason", permission: "bulut:uretim:oku" },
    ],
  },
  {
    name: "ozet-finans", kind: "ANLIK", source: "cloud-sync/snapshots: kasa/banka saklı bakiyeleri + ChequeService.summary/dueSummary + collectAgingRows kovaları",
    cadence: "HER_TUR", permission: "bulut:cari-bakiye:oku", module: "finance.enabled",
    reads: ["cash_boxes", "bank_accounts", "cheques", "invoices", "payments", "payment_allocations", "cari_accounts"],
  },
  {
    name: "stok-karnesi", kind: "ANLIK", source: "reports/stock-scorecard.report.service getStockScorecard",
    cadence: "SAATLIK", permission: "bulut:stok:oku", reads: ["rolls", "order_lines", "orders", "items", "colors"],
  },
  {
    name: "acik-siparis-karsilama", kind: "ANLIK", source: "reports/open-order-coverage.report.service getOpenOrderCoverage",
    cadence: "SAATLIK", permission: "bulut:siparis:oku", reads: ["order_lines", "orders", "rolls"],
  },
  {
    name: "rapor-katalogu", kind: "ANLIK", source: "cloud-sync/report-requests REMOTE_REPORTS ∩ constants/report-catalog (audit/* HARİÇ)",
    cadence: "GUNLUK", permission: "bulut:oturum", reads: [],
  },
  {
    name: "uretim-akisi", kind: "ANLIK", source: "inventory.service getProductionFlow({includeQueues,includeSevk}) + DashboardService.getStationsLiveState",
    cadence: "HER_TUR", permission: "bulut:uretim:oku", module: "production.enabled",
    reads: ["rolls", "work_order_steps", "stations", "sacks", "shipments"],
  },
  {
    name: "saglik", kind: "ANLIK", source: "lib/health-snapshot backupHealth (gece yedeği hükmü + zamanı; patron bildirimi 'yedek-basarisiz')",
    cadence: "HER_TUR", permission: "bulut:ozet:oku", reads: [],
  },
];
export const RECORD_PROJECTIONS: readonly RecordProjection[] = [...DIMENSIONS, ...FACTS];
export const SNAPSHOT_PROJECTIONS: readonly SnapshotProjection[] = SNAPSHOTS;
export const PROJECTIONS: readonly Projection[] = [...RECORD_PROJECTIONS, ...SNAPSHOT_PROJECTIONS];

/** Silme işaretinin kurulduğu 24 kök tablo — migration tetikleyicileri ile İKİ YÖNLÜ ölçülür. */
export const SYNC_ROOT_TABLES: readonly string[] = RECORD_PROJECTIONS.map((p) => p.root.table);

/** Alt satır izinleri (§3.1, §10): finans DIŞI projeksiyonun `.finans`ı `bulut:fiyat:oku`, finans projeksiyonununki kendi izni. */
export function subRowPermission(p: RecordProjection, dataClass: Exclude<DataClass, "ISLEM">): string {
  if (dataClass === "KISISEL") return "bulut:cari:oku";
  return p.module === "finance.enabled" ? p.permission : "bulut:fiyat:oku";
}

/** Tel projeksiyon adı: kök satır `<ad>`, alt satır `<ad>.finans` / `<ad>.kisisel`. */
export function subRowName(p: RecordProjection, dataClass: DataClass): string {
  if (dataClass === "ISLEM") return p.name;
  return `${p.name}.${dataClass === "FINANS" ? "finans" : "kisisel"}`;
}

/** Projeksiyonun hangi alt satırları var (kolon ya da türetilmiş alan sınıfından). */
export function subRowClasses(p: RecordProjection): Array<Exclude<DataClass, "ISLEM">> {
  const classes = new Set<DataClass>([...p.columns.map((c) => c.dataClass), ...p.derived.map((d) => d.dataClass)]);
  return (["FINANS", "KISISEL"] as const).filter((c) => classes.has(c));
}

/**
 * Türetilmiş alanın okuduğu ama değişiklik kaynağı OLMAYAN tablolar — kapsama gerekçesiyle.
 * Buradaki her satır ölçülmüş bir yan yoldur; gerekçesiz satır eklenmez (§4.3d bekçisi).
 */
export const READ_COVERAGE: Readonly<Record<string, string>> = {
  payment_allocations: "kapama ham UPDATE'leri invoices.paidTotal / payments.allocatedTotal / cheques.allocatedTotal ile birlikte updatedAt=NOW() yazar (ölçüldü, §4.2) — o üç tablo kaynaktır",
};

/**
 * Projeksiyon DEĞİL, değişiklik tespitinin kendisi için okunan tablolar (§4.4–4.5).
 * Birleştirme FK'ları ham UPDATE ile taşır ve `updatedAt`e dokunmaz; taşınan satırlar
 * `merge_operation_refs.rowIds`te durur.
 */
export const SYNC_AUX_READS: ReadonlyArray<{ readonly table: string; readonly watermark: string; readonly why: string }> = [
  { table: "merge_operations", watermark: "createdAt", why: "yeni birleştirme → refs'teki satırlar kirli" },
  { table: "merge_operations", watermark: "revertedAt", why: "geri alınan birleştirme → aynı satırlar yeniden kirli" },
  { table: "merge_operation_refs", watermark: "operationId", why: "MOVED satır kimlikleri (tableName, rowIds)" },
  { table: "sync_marks", watermark: "createdAt", why: "tetikleyicilerin yazdığı SILINDI/KIRLI işaretleri" },
];

/** Birleştirme varlığı → kök tablo (`merge_operations.entity`). */
export const MERGE_ENTITY_TABLES: Readonly<Record<string, string>> = {
  customer: "customers",
  item: "items",
  color: "colors",
  subcontractor: "subcontractors",
};

/**
 * Bilinçli olarak buluta GİTMEYEN tablolar — "neden yok" sorusu tek yerde (§3.4). Ne
 * katalogda ne burada olan tablo "sınıflanmamış"tır (opt-in gereği yine gitmez).
 */
export const DELIBERATELY_EXCLUDED: Readonly<Record<string, string>> = {
  system_logs: "audit ayak izidir, buluta gitmez (kök kural: audit yalnız yerel insan yüzeyi)",
  system_log_archives: "audit arşivi — aynı gerekçe",
  sessions: "kimlik akışı / telemetri",
  users: "fabrika kullanıcıları buluta gitmez (bulut hesapları bağımsız — B-Tur 2)",
  user_permissions: "fabrika yetkisi", permissions: "fabrika yetkisi",
  permission_templates: "fabrika yetkisi", permission_template_items: "fabrika yetkisi",
  totp_enrollments: "kimlik sırrı", user_recovery_codes: "kimlik sırrı", user_preferences: "kullanıcı tercihi",
  system_settings: "yapılandırma (şifre özetleri, kurulum kimliği taşır)",
  endpoint_latency_daily: "telemetri",
  sync_marks: "eşitlemenin kendi telemetrisi", sync_watermarks: "eşitlemenin kendi durum tablosu",
  rolls: "top düzeyi buluta gitmez (v1) — stok karnesi + sevkiyat/çuval toplamları yeter; top araması fabrikada",
  roll_status_events: "stok hareket defteri v1 dışı (hacim) — rapor isteğiyle", warehouse_movements: "aynı",
  roll_movements: "aynı", roll_operations: "üretim ayrıntısı", work_order_events: "iş emri hareket defteri v1 dışı",
  printed_documents: "belge içeriği", label_templates: "şablon", traveler_card_templates: "şablon",
  batches: "v2 adayı (parti izleme raporu isteğe bağlı)", packing_groups: "v2 adayı (sevk partisi)",
  purchase_orders: "v2 adayı (alış siparişi)", purchase_order_lines: "v2 adayı (alış siparişi)",
  goods_receipts: "v2 adayı (mal kabul)", sack_allocations: "sevk karşılama pivotu — sipariş sevkMiktari türetilmiş olarak gider",
  subcontractor_dispatches: "fason — v1'de özet 'fason' bölümü", subcontractor_dispatch_items: "fason — aynı",
  subcontractor_receipts: "fason — aynı", subcontractor_receipt_items: "fason — aynı",
  exchange_rates: "kur tablosu — finans satırları tutarTl'yi kendi kolonunda taşır",
  weaving_orders: "dokuma — v2 adayı", machine_runs: "tezgah defteri — randıman raporu isteğe bağlı",
  machine_stop_events: "tezgah defteri — duruş pareto raporu isteğe bağlı",
  warp_beams: "levent — v2 adayı", yarn_lots: "iplik — v2 adayı", yarn_stocks: "iplik — v2 adayı", yarn_movements: "iplik — v2 adayı",
  shipment_events: "sevkiyat olay defteri — v1'de durum/cikisTarihi yeter",
};

export function findRecordProjection(name: string): RecordProjection | undefined {
  return RECORD_PROJECTIONS.find((p) => p.name === name);
}

/** Bulut okuma izinleri (§10) — projeksiyonların izni bu kümeden olmak ZORUNDA (fail-closed). */
export const CLOUD_READ_PERMISSIONS = [
  "bulut:oturum",
  "bulut:ozet:oku",
  "bulut:siparis:oku",
  "bulut:sevkiyat:oku",
  "bulut:uretim:oku",
  "bulut:stok:oku",
  "bulut:cari:oku",
  "bulut:cari-bakiye:oku",
  "bulut:kasa:oku",
  "bulut:cek:oku",
  "bulut:fatura:oku",
  "bulut:tahsilat:oku",
  "bulut:fiyat:oku",
  "bulut:rapor:oku",
] as const;

/**
 * Tel projeksiyon adı → bulut izni: kök satır, alt satırlar, anlık bölümler. Bulutun RLS
 * süzmesi (§9.3) bu eşlemeyi kullanır; eşlenmeyen ad hiçbir hesaba görünmez DEĞİL, kurulumda
 * RED'dir (bekçi `test_bulut_projeksiyon_allowlist` §8).
 */
export function projectionPermissions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of RECORD_PROJECTIONS) {
    out.set(p.name, p.permission);
    for (const cls of subRowClasses(p)) out.set(subRowName(p, cls), subRowPermission(p, cls));
  }
  for (const s of SNAPSHOT_PROJECTIONS) {
    if (s.sections) for (const sec of s.sections) out.set(sec.name, sec.permission);
    else out.set(s.name, s.permission);
  }
  return out;
}
