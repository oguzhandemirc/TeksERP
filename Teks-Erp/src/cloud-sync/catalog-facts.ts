// Patron bulutu projeksiyon kataloğu — OLGU projeksiyonları (iş kayıtları). Tek kaynak
// `projections.ts` üzerinden dışa açılır; tasarım `docs/design/PATRON-BULUTU-ESITLEME.md` §3.2.
import { factoryDaySql } from "../constants/time";
import { col, derived, lookup, self, via, type RecordProjection } from "./projection-types";

// ── OLGU projeksiyonları ──────────────────────────────────────────────────────
const WO_OF_ROLLS =
  'SELECT DISTINCT s."workOrderId" AS root_id FROM "rolls" r JOIN "work_order_steps" s ON s."id" IN (r."producedInStepId", r."currentStepId") WHERE r."id" = ANY($1::uuid[])';
const WO_OF_STEPS = 'SELECT DISTINCT s."workOrderId" AS root_id FROM "work_order_steps" s WHERE s."id" = ANY($1::uuid[])';
const WO_OF_ORDER_LINES =
  'SELECT DISTINCT l."workOrderId" AS root_id FROM "work_order_to_order_lines" l WHERE l."orderLineId" = ANY($1::uuid[]) AND l."unlinkedAt" IS NULL';
const WO_OF_ORDERS =
  'SELECT DISTINCT l."workOrderId" AS root_id FROM "work_order_to_order_lines" l JOIN "order_lines" ol ON ol."id" = l."orderLineId" WHERE ol."orderId" = ANY($1::uuid[]) AND l."unlinkedAt" IS NULL';

// Görünen ad (cari/ürün/renk) olgu satırında türetilir: ad değişince bağlı kökler yeniden gider.
const ORDERS_OF_CUSTOMERS = 'SELECT o."id" AS root_id FROM "orders" o WHERE o."customerId" = ANY($1::uuid[])';
const SHIPMENTS_OF_CUSTOMERS = 'SELECT s."id" AS root_id FROM "shipments" s WHERE s."customerId" = ANY($1::uuid[])';
const LINES_OF_ITEMS = 'SELECT l."id" AS root_id FROM "order_lines" l WHERE l."itemId" = ANY($1::uuid[])';
const LINES_OF_COLORS = 'SELECT l."id" AS root_id FROM "order_lines" l WHERE l."colorId" = ANY($1::uuid[])';
const NAME_OF = (model: string): string => `cloud-sync/derived displayNames: ${model}.name (BOYUT \`ad\` ile aynı kolon)`;

/** Efektif vade (belge vadesi → tarih + cari vade günü) — `resolveEffectiveDue`in SQL ikizi (UTC oturum, tam gün = 86 400 sn). */
const EFFECTIVE_DUE_SQL =
  'COALESCE(i."dueDate", i."issueDate" + c."paymentTermDays" * interval \'86400 seconds\')';
const DUE_CROSSING_FROM = `FROM "invoices" i LEFT JOIN "cari_accounts" c ON c."id" = i."cariId" WHERE i."status" <> 'DRAFT' AND ${EFFECTIVE_DUE_SQL} >= $1 AND ${EFFECTIVE_DUE_SQL} < $2`;

/** Teklif ertesi fabrika gününün başında "süresi doldu" olur: geçerlilik (önceki konum günü, ufuk günü] aralığındaki SENT teklifler. */
const QUOTE_EXPIRY_CROSSING = {
  name: "gecerlilik",
  // Getter: fabrika dilimi (dönemli) sorgu anında çözülür; dilim literali bu dosyaya yazılmaz.
  get sql(): string {
    return `SELECT q."id" AS root_id FROM "sales_quotes" q WHERE q."status" = 'SENT' AND q."validUntilDate" >= ${factoryDaySql("$1::timestamptz").sql} AND q."validUntilDate" < ${factoryDaySql("$2::timestamptz").sql}`;
  },
};
const QUOTES_OF_CUSTOMERS = 'SELECT q."id" AS root_id FROM "sales_quotes" q WHERE q."customerId" = ANY($1::uuid[])';
const NOT_DRAFT_QUOTE = `EXISTS (SELECT 1 FROM "sales_quotes" q WHERE q."id" = t."quoteId" AND q."status" <> 'DRAFT')`;

export const FACTS: readonly RecordProjection[] = [
  {
    name: "siparis", kind: "KAYIT", role: "OLGU", root: { table: "orders", model: "Order" },
    columns: [col("id", "id"), col("siparisNo", "orderNumber"), col("cariKartId", "customerId"), col("subeId", "branchId"),
      col("yon", "destination"), col("doviz", "currency"), col("tutar", "totalAmount", "FINANS"), col("durum", "status"),
      col("siparisTarihi", "orderDate"), col("termin", "deadline"), col("sevkMiktari", "shippedQty"),
      col("tamamlanma", "completedAt"), col("iptalTarihi", "cancelledAt"), col("iptalSebepKodu", "cancelReasonCode"),
      col("olusturulma", "createdAt")],
    derived: [
      derived("acikMiktar", "helpers/order-line-scope.helper isActiveLine + isMeasuredLine: Σ(quantity − shippedQty)", ["order_lines"]),
      derived("kalemSayisi", "helpers/order-line-scope.helper isActiveLine", ["order_lines"]),
      derived("gecikmis", "helpers/order-deadline.helper daysPastDeadline ≠ null ∧ açık durum (PENDING · APPROVED · PARTIAL_SHIPPED)", ["orders"], { timeBound: true }),
      derived("musteriAdi", NAME_OF("Customer"), ["customers"]),
    ],
    sources: [self("orders"), via("order_lines", "orderId"), lookup("customers", "id", ORDERS_OF_CUSTOMERS, "cari adı değişince siparişleri yeniden gider")],
    crossings: [{ name: "termin", sql: 'SELECT o."id" AS root_id FROM "orders" o WHERE o."deadline" >= $1 AND o."deadline" < $2' }],
    deletion: "YOK", permission: "bulut:siparis:oku", retention: { wireFields: ["siparisTarihi"], sql: 't."orderDate"' }, catalogVersion: 1,
  },
  {
    name: "siparis-kalemi", kind: "KAYIT", role: "OLGU", root: { table: "order_lines", model: "OrderLine" },
    columns: [col("id", "id"), col("siparisId", "orderId"), col("urunId", "itemId"), col("renkId", "colorId"),
      col("miktar", "quantity"), col("birim", "unit"), col("birimFiyat", "unitPrice", "FINANS"), col("en", "width"),
      col("sevkMiktari", "shippedQty"), col("parcaBoyu", "pieceLengthM"), col("musteriUrunAdi", "customerItemName"),
      col("musteriRenkAdi", "customerColorName"), col("iptalTarihi", "cancelledAt"), col("iptalSebepKodu", "cancelReasonCode"),
      col("olusturulma", "createdAt")],
    derived: [
      derived("acikMiktar", "helpers/order-line-scope.helper isActiveLine + isMeasuredLine: quantity − shippedQty (ölçülmeyen birimde null)", ["order_lines"]),
      derived("urunAdi", NAME_OF("Item"), ["items"]),
      derived("renkAdi", NAME_OF("Color"), ["colors"]),
    ],
    sources: [self("order_lines"), lookup("items", "id", LINES_OF_ITEMS, "ürün adı değişince kalemleri yeniden gider"),
      lookup("colors", "id", LINES_OF_COLORS, "renk adı değişince kalemleri yeniden gider")],
    deletion: "DAMGA", permission: "bulut:siparis:oku", retention: { wireFields: ["olusturulma"], sql: 't."createdAt"' }, catalogVersion: 1,
  },
  {
    name: "sevkiyat", kind: "KAYIT", role: "OLGU", root: { table: "shipments", model: "Shipment" },
    columns: [col("id", "id"), col("sevkNo", "shipmentNo"), col("durum", "status"), col("cariKartId", "customerId"),
      col("subeId", "branchId"), col("yon", "destination"), col("cikisTarihi", "dispatchedAt"), col("disFaturaNo", "invoiceNo"),
      col("faturalanma", "invoicedAt"), col("iptalTarihi", "cancelledAt"), col("olusturulma", "createdAt")],
    derived: [
      derived("toplamMetre", "helpers/shipment-gross-totals.helper loadShipmentGrossTotals.grossMeters (BRÜT, tek RR görüntü)", ["rolls", "roll_returns"]),
      derived("toplamKg", "helpers/shipment-gross-totals.helper loadShipmentGrossTotals.kg", ["sacks"]),
      derived("cuvalSayisi", "listShipments _count.sacks ile aynı sayım", ["sacks"]),
      derived("topSayisi", "helpers/shipment-gross-totals.helper grossRollCount (canlı + iptal edilmemiş iade)", ["rolls", "roll_returns"]),
      derived("siparisIdleri", "shipment_orders kümesi (listShipments `_count.orders` ile aynı; isActive yalnız PLANNED denormudur, süzülmez)", ["shipment_orders"]),
      derived("musteriAdi", NAME_OF("Customer"), ["customers"]),
    ],
    sources: [self("shipments"),
      via("sacks", "shipmentId", "ESKİ sevkiyat ayrılmada görünmez → sacks_sync_parent_moved tetikleyicisi"),
      via("rolls", "shipmentId", "ESKİ sevkiyat ayrılmada görünmez → rolls_sync_parent_moved tetikleyicisi"),
      via("roll_returns", "fromShipmentId"),
      lookup("customers", "id", SHIPMENTS_OF_CUSTOMERS, "cari adı değişince sevkiyatları yeniden gider")],
    markedBy: [{ table: "shipment_orders", trigger: "shipment_orders_sync_dirty" }],
    deletion: "YOK", permission: "bulut:sevkiyat:oku",
    retention: { wireFields: ["cikisTarihi", "olusturulma"], sql: 'COALESCE(t."dispatchedAt", t."createdAt")' }, catalogVersion: 1,
  },
  {
    name: "dogrudan-sevk", kind: "KAYIT", role: "OLGU", root: { table: "direct_shipments", model: "DirectShipment" },
    columns: [col("id", "id"), col("sevkNo", "shipmentNo"), col("cariKartId", "customerId"), col("subeId", "branchId"),
      col("toplamMetre", "totalQty"), col("topSayisi", "rollCount"), col("cikisTarihi", "shippedAt"),
      col("disFaturaNo", "invoiceNo"), col("faturalanma", "invoicedAt"), col("olusturulma", "createdAt")],
    derived: [], sources: [self("direct_shipments")],
    deletion: "YOK", permission: "bulut:sevkiyat:oku",
    retention: { wireFields: ["cikisTarihi", "olusturulma"], sql: 'COALESCE(t."shippedAt", t."createdAt")' }, catalogVersion: 1,
  },
  {
    name: "cuval", kind: "KAYIT", role: "OLGU", root: { table: "sacks", model: "Sack" },
    columns: [col("id", "id"), col("cuvalNo", "sackNo"), col("sevkiyatId", "shipmentId"), col("cariKartId", "customerId"),
      col("subeId", "branchId"), col("depoId", "warehouseId"), col("partiId", "packingGroupId"), col("ambalajNo", "packageNo"),
      col("kg", "weightKg"), col("tartilma", "weighedAt"), col("olusturulma", "createdAt")],
    derived: [
      derived("topSayisi", "helpers/sack-content-totals.helper loadSackContentTotals.rollCount (hayaletsiz)", ["rolls"]),
      derived("metre", "helpers/sack-content-totals.helper loadSackContentTotals.totalQty (hayaletsiz)", ["rolls"]),
    ],
    sources: [self("sacks"), via("rolls", "sackId", "ESKİ çuval ayrılmada görünmez → rolls_sync_parent_moved tetikleyicisi")],
    deletion: "DAMGA", permission: "bulut:sevkiyat:oku", retention: { wireFields: ["olusturulma"], sql: 't."createdAt"' }, catalogVersion: 1,
  },
  {
    name: "is-emri", kind: "KAYIT", role: "OLGU", root: { table: "work_orders", model: "WorkOrder" },
    columns: [col("id", "id"), col("isEmriNo", "workOrderNumber"), col("tur", "type"), col("durum", "status"),
      col("urunId", "targetItemId"), col("renkId", "targetColorId"), col("hedefMiktar", "targetQuantity"), col("en", "width"),
      col("planBaslangic", "plannedStartDate"), col("planBitis", "plannedEndDate"), col("aktif", "isActive"),
      col("iptalTarihi", "cancelledAt"), col("olusturulma", "createdAt")],
    derived: [
      derived("uretilenMetre", "workorder.service withProductionMeters.producedMeters", ["rolls", "work_order_steps"]),
      derived("girenMetre", "workorder.service withProductionMeters.inputMeters (computeWoInput)", ["rolls", "roll_movements", "work_order_steps"]),
      derived("siparisMetre", "workorder.service withProductionMeters.orderedMeters", ["work_order_to_order_lines", "order_lines"]),
      derived("cariKartIdleri", "helpers/work-order-customers.helper rollupWorkOrderCustomers (bağlanma sırası, liste önizlemesi)", ["work_order_to_order_lines", "order_lines", "orders"]),
      derived("aktifIstasyonId", "helpers/work-order-current-step.helper currentWorkOrderStep", ["work_order_steps"]),
    ],
    sources: [self("work_orders"),
      via("work_order_steps", "workOrderId"),
      lookup("rolls", "id", WO_OF_ROLLS, "ESKİ adım ayrılmada görünmez → rolls_sync_parent_moved tetikleyicisi"),
      lookup("roll_movements", "workOrderStepId", WO_OF_STEPS),
      via("work_order_to_order_lines", "workOrderId"),
      lookup("order_lines", "id", WO_OF_ORDER_LINES),
      lookup("orders", "id", WO_OF_ORDERS)],
    deletion: "YOK", permission: "bulut:uretim:oku", module: "production.enabled",
    retention: { wireFields: ["olusturulma"], sql: 't."createdAt"' }, catalogVersion: 1,
  },
  {
    name: "cari-hesap", kind: "KAYIT", role: "OLGU", root: { table: "cari_accounts", model: "CariAccount" },
    columns: [col("id", "id"), col("tur", "kind"), col("cariKartId", "customerId"), col("fasonFirmaId", "subcontractorId"),
      col("varsayilanDoviz", "defaultCurrency"), col("vadeGun", "paymentTermDays", "FINANS"), col("riskLimiti", "riskLimit", "FINANS"),
      col("aktif", "isActive")],
    derived: [
      derived("bakiyeler", "cari.service list: cari_balances (sıfır olmayan, para birimi sırasıyla)", ["cari_balances"], { dataClass: "FINANS" }),
      derived("gecikmis", "reports/finance-aging.report collectAgingRows(asOf=şimdi).overdueTotal — cari listesinin withOverdue'su ile AYNI çekirdek",
        ["invoices", "payments", "cheques", "cari_accounts", "payment_allocations"], { timeBound: true, dataClass: "FINANS" }),
    ],
    sources: [self("cari_accounts"),
      { table: "cari_balances", watermark: "updatedAt", tieBreaker: [{ column: "cariId", cast: "uuid" }, { column: "currency", cast: '"Currency"' }], root: { kind: "column", column: "cariId" } },
      via("invoices", "cariId"), via("payments", "cariId"), via("cheques", "cariId")],
    crossings: [{ name: "vade", sql: `SELECT DISTINCT i."cariId" AS root_id ${DUE_CROSSING_FROM}` }],
    deletion: "YOK", permission: "bulut:cari-bakiye:oku", module: "finance.enabled", catalogVersion: 1,
  },
  {
    name: "cari-hareket", kind: "KAYIT", role: "OLGU", root: { table: "cari_transactions", model: "CariTransaction" },
    columns: [col("id", "id"), col("cariHesapId", "cariId"), col("doviz", "currency"), col("tarih", "txnDate"),
      col("borc", "debit", "FINANS"), col("alacak", "credit", "FINANS"), col("tutarTl", "amountTry", "FINANS"),
      col("kur", "exchangeRate", "FINANS"), col("kaynak", "sourceType"), col("faturaId", "invoiceId"), col("tahsilatOdemeId", "paymentId"),
      col("cekId", "chequeId"), col("tersKayitId", "reversesTxnId"), col("aciklama", "description"), col("olusturulma", "createdAt")],
    derived: [], sources: [self("cari_transactions", "createdAt")],
    deletion: "YOK", permission: "bulut:cari-bakiye:oku", module: "finance.enabled",
    retention: { wireFields: ["tarih"], sql: 't."txnDate"' }, catalogVersion: 1,
  },
  {
    name: "kasa", kind: "KAYIT", role: "OLGU", root: { table: "cash_boxes", model: "CashBox" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("doviz", "currency"), col("bakiye", "balance", "FINANS"),
      col("aktif", "isActive")],
    derived: [], sources: [self("cash_boxes")], deletion: "YOK", permission: "bulut:kasa:oku", module: "finance.enabled", catalogVersion: 1,
  },
  {
    name: "banka", kind: "KAYIT", role: "OLGU", root: { table: "bank_accounts", model: "BankAccount" },
    columns: [col("id", "id"), col("kod", "code"), col("ad", "name"), col("banka", "bankName"), col("doviz", "currency"),
      col("bakiye", "balance", "FINANS"), col("aktif", "isActive")],
    derived: [], sources: [self("bank_accounts")], deletion: "YOK", permission: "bulut:kasa:oku", module: "finance.enabled", catalogVersion: 1,
  },
  {
    name: "kasa-hareketi", kind: "KAYIT", role: "OLGU", root: { table: "cash_transactions", model: "CashTransaction" },
    columns: [col("id", "id"), col("belgeNo", "docNo"), col("tur", "kind"), col("yon", "direction"), col("durum", "status"),
      col("kasaId", "cashBoxId"), col("bankaId", "bankAccountId"), col("doviz", "currency"), col("tutar", "amount", "FINANS"),
      col("tutarTl", "amountTry", "FINANS"), col("tarih", "txnDate"), col("kategori", "category"), col("aciklama", "description"),
      col("transferGrubu", "transferGroupId"), col("tahsilatOdemeId", "paymentId"), col("iptalTarihi", "cancelledAt"),
      col("olusturulma", "createdAt")],
    derived: [], sources: [self("cash_transactions")], deletion: "YOK", permission: "bulut:kasa:oku", module: "finance.enabled",
    retention: { wireFields: ["tarih"], sql: 't."txnDate"' }, catalogVersion: 1,
  },
  {
    name: "cek-senet", kind: "KAYIT", role: "OLGU", root: { table: "cheques", model: "Cheque" },
    columns: [col("id", "id"), col("belgeNo", "docNo"), col("tur", "kind"), col("belgeTuru", "docType"), col("durum", "status"),
      col("cariHesapId", "cariId"), col("cirolananCariHesapId", "endorsedToCariId"), col("bankaId", "bankAccountId"),
      col("doviz", "currency"), col("tutar", "amount", "FINANS"), col("tutarTl", "amountTry", "FINANS"),
      col("eslesen", "allocatedTotal", "FINANS"), col("duzenleme", "issueDate"), col("vade", "dueDate"), col("kayitTarihi", "postingDate"),
      col("seriNo", "serialNo"), col("banka", "bankName"), col("kesideci", "drawerName", "KISISEL"), col("iptalTarihi", "cancelledAt"),
      col("olusturulma", "createdAt")],
    derived: [], sources: [self("cheques")], deletion: "YOK", permission: "bulut:cek:oku", module: "finance.enabled",
    retention: { wireFields: ["vade", "olusturulma"], sql: 'COALESCE(t."dueDate", t."createdAt")' }, catalogVersion: 1,
  },
  {
    name: "cek-hareketi", kind: "KAYIT", role: "OLGU", root: { table: "cheque_events", model: "ChequeEvent" },
    columns: [col("id", "id"), col("cekId", "chequeId"), col("tur", "type"), col("onceki", "fromStatus"), col("sonraki", "toStatus"),
      col("tarih", "eventDate"), col("karsiCariHesapId", "counterCariId"), col("olusturulma", "createdAt")],
    derived: [], sources: [self("cheque_events", "createdAt")],
    deletion: "YOK", permission: "bulut:cek:oku", module: "finance.enabled",
    retention: { wireFields: ["tarih"], sql: 't."eventDate"' }, catalogVersion: 1,
  },
  {
    name: "fatura", kind: "KAYIT", role: "OLGU", root: { table: "invoices", model: "Invoice" },
    scope: { note: "taslak (DRAFT) buluta GİRMEZ; taslağın silinmesi kapsam dışı", prismaWhere: { status: { not: "DRAFT" } }, sql: `t."status" <> 'DRAFT'` },
    columns: [col("id", "id"), col("belgeNo", "docNo"), col("tur", "type"), col("durum", "status"), col("cariHesapId", "cariId"),
      col("doviz", "currency"), col("kur", "exchangeRate", "FINANS"), col("tarih", "issueDate"), col("vade", "dueDate"),
      col("disNo", "externalNo"), col("araToplam", "subtotal", "FINANS"), col("iskonto", "discountTotal", "FINANS"),
      col("kdv", "vatTotal", "FINANS"), col("tevkifat", "withholdingTotal", "FINANS"), col("genelToplam", "grandTotal", "FINANS"),
      col("genelToplamTl", "grandTotalTry", "FINANS"), col("odenen", "paidTotal", "FINANS"), col("sevkiyatId", "shipmentId"),
      col("dogrudanSevkId", "directShipmentId"), col("onay", "confirmedAt"), col("iptalTarihi", "cancelledAt"),
      col("olusturulma", "createdAt")],
    derived: [
      derived("acikTutar", "helpers/finance.helper invoiceOpenAmount (grandTotal − paidTotal)", ["invoices"], { dataClass: "FINANS" }),
      derived("vadesiGecti", "reports/finance-aging.report resolveEffectiveDue + daysOverdueAt + bucketOfDaysOverdue + isOverdueBucket",
        ["invoices", "cari_accounts"], { timeBound: true }),
    ],
    sources: [self("invoices"),
      lookup("cari_accounts", "id", 'SELECT i."id" AS root_id FROM "invoices" i WHERE i."cariId" = ANY($1::uuid[])', "cari vade günü efektif vadeyi değiştirir")],
    crossings: [{ name: "vade", sql: `SELECT i."id" AS root_id ${DUE_CROSSING_FROM}` }],
    deletion: "KAPSAM_DISI", permission: "bulut:fatura:oku", module: "finance.enabled",
    retention: { wireFields: ["tarih"], sql: 't."issueDate"' }, catalogVersion: 1,
  },
  {
    name: "fatura-kalemi", kind: "KAYIT", role: "OLGU", root: { table: "invoice_lines", model: "InvoiceLine" },
    scope: {
      note: "üst fatura taslak değil (kalem yalnız taslakta değişir — invoice.service düzenleme claim'i status = DRAFT)",
      prismaWhere: { invoice: { status: { not: "DRAFT" } } },
      sql: `EXISTS (SELECT 1 FROM "invoices" i WHERE i."id" = t."invoiceId" AND i."status" <> 'DRAFT')`,
    },
    columns: [col("id", "id"), col("faturaId", "invoiceId"), col("sira", "lineNo"), col("urunId", "itemId"),
      col("aciklama", "description"), col("miktar", "qty"), col("birim", "unit"), col("birimFiyat", "unitPrice", "FINANS"),
      col("iskontoOrani", "discountRate", "FINANS"), col("kdvOrani", "vatRate", "FINANS"),
      col("tevkifatOrani", "withholdingRate", "FINANS"), col("tutar", "lineTotal", "FINANS"), col("kdvTutari", "vatAmount", "FINANS")],
    derived: [],
    sources: [lookup("invoices", "id", 'SELECT l."id" AS root_id FROM "invoice_lines" l WHERE l."invoiceId" = ANY($1::uuid[])', "kalem üst faturayla birlikte gider (kalemde updatedAt yok)")],
    deletion: "KAPSAM_DISI", permission: "bulut:fatura:oku", module: "finance.enabled",
    retention: {
      wireFields: [],
      parent: { projection: "fatura", wireKey: "faturaId" },
      sql: '(SELECT i."issueDate" FROM "invoices" i WHERE i."id" = t."invoiceId")',
    },
    catalogVersion: 1,
  },
  {
    name: "tahsilat-odeme", kind: "KAYIT", role: "OLGU", root: { table: "payments", model: "Payment" },
    columns: [col("id", "id"), col("belgeNo", "docNo"), col("yon", "direction"), col("yontem", "method"), col("durum", "status"),
      col("cariHesapId", "cariId"), col("doviz", "currency"), col("tutar", "amount", "FINANS"), col("tutarTl", "amountTry", "FINANS"),
      col("eslesen", "allocatedTotal", "FINANS"), col("kasaId", "cashBoxId"), col("bankaId", "bankAccountId"),
      col("tarih", "paymentDate"), col("referans", "reference"), col("iptalTarihi", "cancelledAt"), col("olusturulma", "createdAt")],
    derived: [
      derived("eslesmemis", "helpers/finance.helper unallocatedAmount (amount − allocatedTotal)", ["payments"], { dataClass: "FINANS" }),
    ],
    sources: [self("payments")],
    deletion: "YOK", permission: "bulut:tahsilat:oku", module: "finance.enabled",
    retention: { wireFields: ["tarih"], sql: 't."paymentDate"' }, catalogVersion: 1,
  },
  {
    name: "fiyat", kind: "KAYIT", role: "OLGU", root: { table: "item_prices", model: "ItemPrice" },
    columns: [col("id", "id"), col("urunId", "itemId"), col("cariKartId", "customerId"), col("tur", "kind"), col("doviz", "currency"),
      col("fiyat", "price", "FINANS"), col("degisim", "updatedAt")],
    derived: [], sources: [self("item_prices")],
    // Damgalı (değişmiş/kaldırılmış) fiyat güncel değildir: kapsamdan çıkınca bulut satırı düşer (MAL-0b).
    scope: { note: "damgalı (kaldırılmış/değişmiş) fiyat güncel değildir; kapsamdan çıkınca bulut satırı düşer", prismaWhere: { revokedAt: null }, sql: `t."revokedAt" IS NULL` },
    deletion: "YOK", permission: "bulut:fiyat:oku", module: "finance.enabled", catalogVersion: 1,
  },
  // ── Maliyet & teklif (MAL-8): tutar/kur/maliyet/marj yalnız `.finans` (izni `bulut:maliyet:oku`, subRowPermission) ──
  {
    name: "teklif", kind: "KAYIT", role: "OLGU", root: { table: "sales_quotes", model: "SalesQuote" },
    // Taslak satış yüzü değildir (kalemi silinir/değişir); gönderilince buluta girer. Teklif hard delete edilmez.
    scope: { note: "taslak (DRAFT) teklif buluta GİRMEZ", prismaWhere: { status: { not: "DRAFT" } }, sql: `t."status" <> 'DRAFT'` },
    columns: [col("id", "id"), col("no", "quoteNo"), col("revizyon", "revisionNo"), col("cariKartId", "customerId"), col("durum", "status"),
      col("tarih", "quoteDate"), col("gecerlilik", "validUntilDate"), col("doviz", "currency"), col("siparisId", "convertedOrderId"),
      col("degisim", "updatedAt"), col("toplamTutar", "totalAmount", "FINANS"), col("kur", "fxRate", "FINANS"),
      col("toplamMaliyetTl", "totalCostTry", "FINANS")],
    derived: [
      derived("suresiDoldu", "helpers/sales-quote-state.helper isQuoteExpired (SENT ∧ geçerlilik < fabrika günü; liste süzgeciyle ikiz)", ["sales_quotes"], { timeBound: true }),
      derived("brutMarjPct", "helpers/quote-view.helper quoteMargin.marjPct ((toplam × kur − maliyet) / (toplam × kur); maliyet yoksa null)", ["sales_quotes"], { dataClass: "FINANS" }),
      derived("musteriAdi", NAME_OF("Customer"), ["customers"]),
    ],
    sources: [self("sales_quotes"), lookup("customers", "id", QUOTES_OF_CUSTOMERS, "cari adı değişince teklifleri yeniden gider")],
    crossings: [QUOTE_EXPIRY_CROSSING],
    deletion: "YOK", permission: "bulut:teklif:oku", module: "maliyet.enabled",
    retention: { wireFields: ["tarih"], sql: 't."quoteDate"' }, catalogVersion: 1,
  },
  {
    name: "teklif-kalemi", kind: "KAYIT", role: "OLGU", root: { table: "sales_quote_lines", model: "SalesQuoteLine" },
    scope: { note: "üst teklif taslak değil (kalem yalnız taslakta eklenir/silinir)", prismaWhere: { quote: { status: { not: "DRAFT" } } }, sql: NOT_DRAFT_QUOTE },
    columns: [col("id", "id"), col("teklifId", "quoteId"), col("sira", "lineNo"), col("urunId", "itemId"), col("renkId", "colorId"),
      col("tanim", "description"), col("miktar", "quantity"), col("birim", "unit"), col("birimFiyat", "unitPrice", "FINANS"),
      col("tutar", "lineTotal", "FINANS"), col("metreMaliyetiTl", "costPerMTry", "FINANS"), col("karPct", "markupPct", "FINANS")],
    derived: [],
    sources: [self("sales_quote_lines"),
      lookup("sales_quotes", "id", 'SELECT l."id" AS root_id FROM "sales_quote_lines" l WHERE l."quoteId" = ANY($1::uuid[])', "teklif gönderilince kalemleri kapsama girer")],
    deletion: "KAPSAM_DISI", permission: "bulut:teklif:oku", module: "maliyet.enabled",
    retention: { wireFields: [], parent: { projection: "teklif", wireKey: "teklifId" }, sql: '(SELECT q."quoteDate" FROM "sales_quotes" q WHERE q."id" = t."quoteId")' },
    catalogVersion: 1,
  },
  {
    name: "standart-maliyet", kind: "KAYIT", role: "OLGU", root: { table: "standard_cost_versions", model: "StandardCostVersion" },
    columns: [col("id", "id"), col("urunId", "itemId"), col("surum", "versionNo"), col("durum", "status"), col("hesapTarihi", "computedAt"),
      col("metreMaliyetiTl", "totalCostPerMTry", "FINANS")],
    derived: [
      ...(["cozguTl", "atkiTl", "dokumaTl", "terbiyeTl", "genelGiderTl"] as const).map((g) =>
        derived(g, "helpers/cost-component-groups.helper sumCostGroups (standard_cost_lines.amountPerMTry, COST_COMPONENT_GROUP)", ["standard_cost_lines"], { dataClass: "FINANS" })),
      derived("urunAdi", NAME_OF("Item"), ["items"]),
    ],
    sources: [self("standard_cost_versions"), via("standard_cost_lines", "versionId"),
      lookup("items", "id", 'SELECT v."id" AS root_id FROM "standard_cost_versions" v WHERE v."itemId" = ANY($1::uuid[])', "ürün adı değişince sürümleri yeniden gider")],
    deletion: "YOK", permission: "bulut:teklif:oku", module: "maliyet.enabled", catalogVersion: 1,
  },
];
