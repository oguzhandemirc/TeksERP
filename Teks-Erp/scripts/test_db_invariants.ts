// =============================================================================
// Şema-DIŞI DB invariant guard'ı — `schema.prisma`'nın temsil EDEMEDİĞİ
// PostgreSQL nesnelerinin canlı DB'de gerçekten durduğunu doğrular.
//
// NEDEN VAR: Prisma şema dili partial index predicate'i, CHECK constraint,
// DEFERRABLE composite FK ve extended statistics ifade edemez. Bu nesneler raw
// SQL migration ile kurulur ve `schema.prisma` onların varlığını BİLMEZ. Sonuç:
// Prisma'nın ürettiği bir migration onları sessizce yok edebilir.
//
// Bu tam olarak bir kez OLDU: `20260611084953_native_uuid_pk_fk` FK kolonlarını
// DROP COLUMN + ADD COLUMN ile yeniden yarattı; bağımlı 9 partial index düştü ve
// Prisma onları TAM index olarak yeniden yazdı. `20260612100000_repartialize_
// after_native_uuid` elle onardı. O onarımı tetikleyen şey bir insanın fark
// etmesiydi — mekanik hiçbir koruma yoktu:
//   • CI (`.github/workflows/ci.yml`) `migrate deploy`'u BOŞ DB'de doğrular →
//     index tanımı bozulsa bile yeşil kalır.
//   • `prisma migrate diff` hiçbir otomasyonda koşmuyor.
//   • Kural yalnız migration başlıklarındaki yorumlarda + schema comment'lerinde.
// Bu dosya o boşluğu kapatır: predicate kaybolursa test DÜŞER.
//
// Baseline canlı `adnansahin_db`'den `pg_get_expr`/`pg_constraint` ile birebir
// alındı (2026-07-30) ve kaynak envanteriyle örtüştü. Beklenen listeyi elle
// güncellemek bilinçli: yeni bir partial index eklendiğinde bu dosyaya da
// yazılmalı — böylece envanter TEK ve DOĞRULANAN yerde yaşar (bayatlayan
// dokümantasyon tablosu yerine).
//
// KAPI İKİ YÖNLÜDÜR (2026-08-01): beklenen nesnenin KAYBI kadar, envanterde
// OLMAYAN bir nesnenin VARLIĞI da testi düşürür. Beş bölümün beşinde de
// `checkNoExtras()` koşar. Tek yönlü olsaydı envanter sessizce eksik kalırdı ve
// "envanter tek ve doğrulanan yerde yaşar" iddiası kâğıt üstünde kalırdı — nitekim
// eski sürümde tespit yalnız 2 bölümde vardı ve o ikisi de `exit 0`'lı ⚠️ basıyordu.
//
// Salt-okunur: hiçbir yazma/fixture yok, herhangi bir ortamda güvenle koşar.
// Koşum: npx tsx scripts/test_db_invariants.ts
// =============================================================================
import prisma from "../src/lib/prisma";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/**
 * ENVANTER-DIŞI NESNE TESPİTİ — beş bölümün ortak kapısı.
 *
 * NEDEN `check()` ve NEDEN UYARI DEĞİL (2026-08-01 denetim düzeltmesi): bu tespit
 * eskiden `warnLine()` ile ⚠️ basıyordu ve süreç yine `exit 0` veriyordu. İki kat
 * sessizdi:
 *   1. Uyarı çıkış kodunu düşürmediği için `npm test` YEŞİL kalıyordu.
 *   2. `run-all-tests.ts` özet satırını yalnız "N geçti, M başarısız" regex'inden
 *      kazıdığı için uyarı metni toplu koşum çıktısında HİÇ görünmüyordu — yani
 *      uyarıyı okuyacak bir insan bile yoktu.
 * Sonuç: beklenen listede olmayan bir partial index / CHECK sessizce geçiyordu ve
 * bu dosyanın var oluş sebebi ("envanter TEK ve DOĞRULANAN yerde yaşasın") fiilen
 * çürüyordu. Artık envanter-dışı nesne = KIRMIZI.
 *
 * Bu bilinçli olarak "gürültülü" bir kapıdır: yeni bir partial index / CHECK /
 * DEFERRABLE FK / statistics eklediğinde test DÜŞER ve seni bu dosyaya yazmaya
 * zorlar. Doğru tepki nesneyi SİLMEK değil, beklenen listeye EKLEMEKtir.
 */
function checkNoExtras(
  sectionLabel: string,
  liveNames: string[],
  expectedNames: Set<string>,
  describe: (name: string) => string
): void {
  const extras = liveNames.filter((n) => !expectedNames.has(n));
  check(
    `${sectionLabel}: envanter-dışı nesne yok`,
    extras.length === 0,
    extras.length === 0
      ? `${liveNames.length} canlı nesnenin tamamı beklenen listede`
      : `${extras.length} nesne bu dosyadaki beklenen listede YOK → ekle (silme!): ` +
        extras.map(describe).join(" · ")
  );
}

/** Predicate karşılaştırması: PG sürüm/parantez farkına dayanıklı normalize. */
function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) PARTIAL INDEXLER (26) — ad + predicate + uniqueness
//    uniq alanı KRİTİK: `schema.prisma:1603-1605` predicate farkını drift
//    saymaz ama index↔unique farkını SAYAR ("aksi halde migrate dev sonsuz
//    CREATE üretir"). Bu yüzden ikisi ayrı ayrı doğrulanır.
// ─────────────────────────────────────────────────────────────────────────────
const PARTIAL_INDEXES: Array<{
  table: string;
  index: string;
  uniq: boolean;
  predicate: string;
  why: string;
}> = [
  // rolls — null-yoğun FK'lar (migration 20260606001717 → 20260612100000 onarımı)
  { table: "rolls", index: "rolls_sackId_idx", uniq: false, predicate: `("sackId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "rolls", index: "rolls_shipmentId_idx", uniq: false, predicate: `("shipmentId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "rolls", index: "rolls_parentReceiptId_idx", uniq: false, predicate: `("parentReceiptId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "rolls", index: "rolls_batchId_idx", uniq: false, predicate: `("batchId" IS NOT NULL)`, why: "null-yoğun FK (parti modeli)" },
  { table: "rolls", index: "rolls_markedForKartela_idx", uniq: false, predicate: `("markedForKartela" = true)`, why: "kartela adayı seyrek" },
  { table: "rolls", index: "rolls_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  { table: "rolls", index: "rolls_labelCustomerId_idx", uniq: false, predicate: `("labelCustomerId" IS NOT NULL)`, why: "null-yoğun FK (stok etiketi yaygın); sorgu yolu hep 'şu müşterinin topları'" },
  { table: "rolls", index: "rolls_goodsReceiptId_idx", uniq: false, predicate: `("goodsReceiptId" IS NOT NULL)`, why: "null-yoğun FK: yalnız mal kabulle doğmuş toplarda dolu (migration 20260813090000)" },
  {
    table: "rolls",
    index: "rolls_finalizedAt_idx",
    uniq: false,
    predicate: `("finalizedAt" IS NOT NULL)`,
    why: "kalite/fire/fason karnelerinin dönem taraması; yalnız üretimi bitmiş toplar damgalı (migration 20260809090000)",
  },
  // swatches
  { table: "swatches", index: "swatches_createdAt_idx", uniq: false, predicate: `("cancelledAt" IS NULL)`, why: "iptal edilmemiş kartela listesi" },
  { table: "swatches", index: "swatches_parentReceiptId_idx", uniq: false, predicate: `("parentReceiptId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "swatches", index: "swatches_shipmentId_idx", uniq: false, predicate: `("shipmentId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "swatches", index: "swatches_sackId_idx", uniq: false, predicate: `("sackId" IS NOT NULL)`, why: "null-yoğun FK" },
  // work_orders / work_order_steps
  { table: "work_orders", index: "work_orders_splitFromId_idx", uniq: false, predicate: `("splitFromId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "work_orders", index: "work_orders_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency" },
  {
    table: "work_order_steps",
    index: "work_order_steps_stationId_status_isUrgent_priority_started_idx",
    uniq: false,
    predicate: `(status <> 'COMPLETED'::"StepStatus")`,
    why: "açık-kart kuyruğu; COMPLETED yığını indekslenmez",
  },
  // kursun_bypass_assignments — LOAD-BEARING unique (migration 20260731120000_add_kursun_bypass_assignment)
  {
    table: "kursun_bypass_assignments",
    index: "kursun_bypass_one_pending_per_step_uq",
    uniq: true,
    predicate: `(("completedAt" IS NULL) AND ("cancelledAt" IS NULL))`,
    why: "adım başına TEK AÇIK bypass ataması — düz @unique DEĞİL, çünkü fason çok-partide aynı adıma yeni atama gerekir",
  },
  // roll_movements — biri LOAD-BEARING unique
  { table: "roll_movements", index: "roll_movements_exitedAt_idx", uniq: false, predicate: `("exitedAt" IS NOT NULL)`, why: "kapanmış movement raporu" },
  {
    table: "roll_movements",
    index: "roll_movements_one_open_per_roll_step_uq",
    uniq: true,
    predicate: `("exitedAt" IS NULL)`,
    why: "TEK açık movement seddi — eşzamanlı çift ilerletmeyi DB'de bloklar",
  },
  // roll_errors
  { table: "roll_errors", index: "roll_errors_isProcessed_idx", uniq: false, predicate: `("isProcessed" = false)`, why: "açık hata kuyruğu" },
  { table: "roll_errors", index: "roll_errors_roll_meter_defect_uq", uniq: true, predicate: `("defectTypeId" IS NOT NULL)`, why: "aynı metrede mükerrer hata seddi" },
  // roll_returns — çok kalemli iade grubu (migration 20260805100000)
  { table: "roll_returns", index: "roll_returns_returnGroupId_idx", uniq: false, predicate: `("returnGroupId" IS NOT NULL)`, why: "null-yoğun: tekil iadelerde NULL" },
  // ticaret paketi — çoklu depo + mal kabul (migration 20260813090000)
  {
    table: "warehouses",
    index: "warehouses_isDefault_key",
    uniq: true,
    predicate: `("isDefault" = true)`,
    why: "sistemde TEK varsayılan depo — düz unique olsaydı toplam İKİ depo tutulabilirdi (traveler_card_templates_one_default emsali)",
  },
  { table: "warehouse_transfers", index: "warehouse_transfers_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  { table: "goods_receipts", index: "goods_receipts_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  { table: "warehouse_movements", index: "warehouse_movements_transferId_idx", uniq: false, predicate: `("transferId" IS NOT NULL)`, why: "null-yoğun belge bağı (KK1/tambur girişleri belgesiz)" },
  { table: "warehouse_movements", index: "warehouse_movements_goodsReceiptId_idx", uniq: false, predicate: `("goodsReceiptId" IS NOT NULL)`, why: "null-yoğun belge bağı" },
  // ticaret paketi — çuval-bütün transfer (migration 20260813212341)
  { table: "warehouse_movements", index: "warehouse_movements_sackId_idx", uniq: false, predicate: `("sackId" IS NOT NULL)`, why: "null-yoğun: yalnız çuval-bütün transfer satırları taşır" },
  { table: "sacks", index: "sacks_warehouseId_idx", uniq: false, predicate: `("warehouseId" IS NOT NULL)`, why: "eski çuvallar NULL (lazy adoption) — dolu satırlar 'bu depoda hangi çuvallar' sorgusunun yolu" },
  // ticaret paketi — ön muhasebe (migration 20260813201311)
  // ⚠️ "BİR KAYNAK → EN ÇOK BİR AKTİF FATURA". Uygulama katmanındaki
  // findFirst→if→create yarışa açıktır; yapısal engel partial unique'tir. Aynı
  // sevkiyat iki kez faturalanırsa cari bakiyesi sessizce İKİ KATINA çıkar ve
  // fark ay sonunda müşteriyle yüzleşince anlaşılır.
  // `status <> 'CANCELLED'`: iptal edilmiş fatura yerinde kalır (donmuş belge
  // silinmez) ama yeni fatura kesilmesini ENGELLEMEMELİDİR — storno'nun amacı bu.
  { table: "invoices", index: "invoices_one_active_per_shipment", uniq: true, predicate: `(("shipmentId" IS NOT NULL) AND (status <> 'CANCELLED'::"InvoiceStatus"))`, why: "bir sevkiyat → tek aktif fatura" },
  { table: "invoices", index: "invoices_one_active_per_direct_shipment", uniq: true, predicate: `(("directShipmentId" IS NOT NULL) AND (status <> 'CANCELLED'::"InvoiceStatus"))`, why: "bir doğrudan sevk → tek aktif fatura" },
  { table: "invoices", index: "invoices_one_active_per_return_group", uniq: true, predicate: `(("returnGroupId" IS NOT NULL) AND (status <> 'CANCELLED'::"InvoiceStatus"))`, why: "bir iade grubu → tek aktif fatura" },
  { table: "invoices", index: "invoices_one_active_per_subcon_receipt", uniq: true, predicate: `(("subcontractorReceiptId" IS NOT NULL) AND (status <> 'CANCELLED'::"InvoiceStatus"))`, why: "bir fason kabul → tek aktif fatura" },
  { table: "invoices", index: "invoices_one_active_per_goods_receipt", uniq: true, predicate: `(("goodsReceiptId" IS NOT NULL) AND (status <> 'CANCELLED'::"InvoiceStatus"))`, why: "bir mal kabul fişi → tek aktif alış faturası" },
  { table: "invoices", index: "invoices_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  { table: "payments", index: "payments_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  // ticaret paketi — carisiz kasa hareketi (migration 20260813230932)
  { table: "cash_transactions", index: "cash_transactions_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  // ⚠️ AÇILIŞ HESAP BAŞINA TEK: ikinci devir satırı "hangisi gerçek açılış"
  // sorusunu cevapsız bırakır ve bakiyeyi sessizce şişirir. İptal edilmiş
  // açılış yenisini ENGELLEMEZ (yanlış devir düzeltilebilmeli).
  { table: "cash_transactions", index: "cash_txn_one_opening_per_cashbox", uniq: true, predicate: `((kind = 'OPENING'::"CashTxnKind") AND ("cashBoxId" IS NOT NULL) AND (status <> 'CANCELLED'::"PaymentStatus"))`, why: "kasa başına tek açılış" },
  { table: "cash_transactions", index: "cash_txn_one_opening_per_bank", uniq: true, predicate: `((kind = 'OPENING'::"CashTxnKind") AND ("bankAccountId" IS NOT NULL) AND (status <> 'CANCELLED'::"PaymentStatus"))`, why: "banka hesabı başına tek açılış" },
  { table: "cari_accounts", index: "cari_accounts_customerId_key", uniq: true, predicate: `("customerId" IS NOT NULL)`, why: "müşteri başına tek cari; NULL'lar (fason cariler) girmez" },
  { table: "cari_accounts", index: "cari_accounts_subcontractorId_key", uniq: true, predicate: `("subcontractorId" IS NOT NULL)`, why: "fason başına tek cari; NULL'lar (müşteri cariler) girmez" },
  // ticaret paketi — çek/senet portföyü (migration 20260814101000)
  { table: "cheques", index: "cheques_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency: NULL'lar unique'e girmez" },
  // ticaret paketi — fatura kapama (migration 20260814102000)
  // ⚠️ AÇIK FATURA yolu. Predicate LOAD-BEARING ve iki işi var: (1) kapanmış +
  // iptal edilmiş faturalar indekse hiç girmez → index cironun değil AÇIK
  // BAKİYENİN büyüklüğünde kalır; (2) predicate düşerse yaşlandırma raporu
  // sessizce tüm fatura geçmişini tarar (sonuç doğru, sorgu yıllar içinde
  // yavaşlar — hata da log da yok).
  {
    table: "invoices",
    index: "invoices_open",
    uniq: false,
    predicate: `((status = 'CONFIRMED'::"InvoiceStatus") AND ("paidTotal" < "grandTotal"))`,
    why: "açık fatura taraması (yaşlandırma + kapama ekranı) — kapanan satırlar indeksten düşer",
  },
  // ticaret paketi — cari dönem kapanışı (migration 20260814103000)
  // ⚠️ PARTIAL olması ZORUNLU: reopen satırı SİLMEZ, işaretler. Düz unique
  // olsaydı yeniden açılan dönem BİR DAHA kapatılamazdı (eski satır anahtarı
  // tutmaya devam eder, ikinci kapanış P2002 alırdı).
  {
    table: "cari_period_closes",
    index: "cari_period_close_active_uq",
    uniq: true,
    predicate: `("reopenedAt" IS NULL)`,
    why: "cari+para birimi+dönem başına TEK AKTİF kapanış; yeniden açılanlar anahtarı bırakır",
  },
  // 2026-08-14 — Paket D fiyatlama (migration 20260814072115_paket_d_...).
  // ⚠️ İKİ partial unique, çünkü `customerId IS NULL` = KART VARSAYILANI ve
  // Postgres NULL'ları birbirine eşit SAYMAZ: düz unique aynı kaleme iki
  // "varsayılan fiyat" satırı doğmasına izin verirdi ve `resolveItemPrice`
  // hangisini seçtiğini kimse söyleyemezdi (hata çıkmaz, fiyat SALINIR).
  {
    table: "item_prices",
    index: "item_price_default_uq",
    uniq: true,
    predicate: `("customerId" IS NULL)`,
    why: "kalem+yön+para birimi başına TEK kart varsayılanı",
  },
  {
    table: "item_prices",
    index: "item_price_customer_uq",
    uniq: true,
    predicate: `("customerId" IS NOT NULL)`,
    why: "kalem+müşteri+yön+para birimi başına TEK istisna",
  },
  // 2026-08-14 — sağlamlık paketi (migration 20260814110200_saglamlik_paketi).
  // Storno bağı: bir defter satırı EN FAZLA BİR KEZ terslenebilir.
  {
    table: "cari_transactions",
    index: "cari_transactions_reversesTxnId_key",
    uniq: true,
    predicate: `("reversesTxnId" IS NOT NULL)`,
    why: "çift storno P2002→409; null-yoğun kolon → partial",
  },
  // Kasa/banka dönem kapanışı — cari_period_close_active_uq'nun hesap-bazlı
  // ikizleri. `reopenedAt IS NULL`: yeniden açılan dönem anahtarı bırakır;
  // hesap kolonu predicate'te: XOR gereği yarısı NULL, index kendi tarafını taşır.
  {
    table: "cash_period_closes",
    index: "cash_period_close_box_active_uq",
    uniq: true,
    predicate: `(("reopenedAt" IS NULL) AND ("cashBoxId" IS NOT NULL))`,
    why: "kasa+dönem başına TEK AKTİF kapanış",
  },
  {
    table: "cash_period_closes",
    index: "cash_period_close_bank_active_uq",
    uniq: true,
    predicate: `(("reopenedAt" IS NULL) AND ("bankAccountId" IS NOT NULL))`,
    why: "banka+dönem başına TEK AKTİF kapanış",
  },
  // orders
  { table: "orders", index: "orders_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency" },
  // swatch_stock_reductions
  { table: "swatch_stock_reductions", index: "swatch_stock_reductions_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "kartela stok-düşüm idempotency" },
  // batches
  { table: "batches", index: "batches_splitFromId_idx", uniq: false, predicate: `("splitFromId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "batches", index: "batches_mergedIntoId_idx", uniq: false, predicate: `("mergedIntoId" IS NOT NULL)`, why: "null-yoğun FK" },
  // label_templates / variants — şema-DIŞI unique'ler
  { table: "label_templates", index: "label_templates_one_default_per_kind", uniq: true, predicate: `("isDefault" = true)`, why: "kind başına TEK varsayılan şablon" },
  { table: "label_template_variants", index: "label_template_variants_one_primary", uniq: true, predicate: `("isPrimary" = true)`, why: "şablon başına TEK primary varyant" },
  // traveler_card_templates — şema-DIŞI unique. PARTIAL olması ZORUNLU: düz unique
  // olsaydı `isDefault=false` de benzersiz sayılır, sistemde toplam iki şablon tutulabilirdi.
  { table: "traveler_card_templates", index: "traveler_card_templates_isDefault_key", uniq: true, predicate: `("isDefault" = true)`, why: "sistemde TEK varsayılan refakat kartı şablonu" },
  // work_sessions — şema-DIŞI unique'ler
  { table: "work_sessions", index: "work_sessions_active_machine_uq", uniq: true, predicate: `(("endedAt" IS NULL) AND ("machineId" IS NOT NULL))`, why: "makine başına TEK aktif oturum" },
  { table: "work_sessions", index: "work_sessions_active_device_uq", uniq: true, predicate: `("endedAt" IS NULL)`, why: "cihaz başına TEK aktif oturum" },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2) CHECK CONSTRAINTLER (7) — migration 20260708120000_faz4_db_constraint_hardening
//    `NOT VALID` eklenip sonra VALIDATE edildiler → `convalidated` da doğrulanır
//    (validate edilmemiş bir CHECK eski satırları korumaz).
// ─────────────────────────────────────────────────────────────────────────────
const CHECK_CONSTRAINTS: Array<{ table: string; name: string }> = [
  { table: "rolls", name: "rolls_currentQty_nonneg" },
  { table: "rolls", name: "rolls_initialQty_nonneg" },
  { table: "rolls", name: "rolls_weightKg_nonneg" },
  { table: "order_lines", name: "order_lines_quantity_pos" },
  { table: "order_lines", name: "order_lines_shippedQty_nonneg" },
  { table: "sacks", name: "sacks_weightKg_nonneg" },
  { table: "work_order_steps", name: "work_order_steps_time_order" },
  // 2026-07-31 denetimi (A6+G-9) — migration 20260731120000_audit_check_hardening:
  { table: "roll_movements", name: "roll_movements_qtyIn_nonneg" },
  { table: "roll_movements", name: "roll_movements_qtyOut_nonneg" },
  { table: "roll_movements", name: "roll_movements_weightIn_nonneg" },
  { table: "roll_movements", name: "roll_movements_weightOut_nonneg" },
  { table: "roll_errors", name: "roll_errors_startMeter_nonneg" },
  { table: "sack_allocations", name: "sack_allocations_qty_pos" },
  { table: "subcontractor_direct_ship_allocations", name: "subcontractor_direct_ship_allocations_qty_pos" },
  { table: "work_order_to_order_lines", name: "work_order_to_order_lines_allocatedQty_nonneg" },
  { table: "subcontractor_dispatch_items", name: "subcontractor_dispatch_items_dispatchedQty_pos" },
  { table: "subcontractor_dispatch_items", name: "subcontractor_dispatch_items_dispatchedWeight_nonneg" },
  { table: "kartela_dispatch_items", name: "kartela_dispatch_items_dispatchedQty_pos" },
  { table: "kartela_dispatch_items", name: "kartela_dispatch_items_dispatchedWeight_nonneg" },
  { table: "kartela_receipt_items", name: "kartela_receipt_items_kartelaCount_pos" },
  { table: "swatch_stock_reductions", name: "swatch_stock_reductions_count_pos" },
  { table: "direct_shipments", name: "direct_shipments_totalQty_pos" },
  { table: "direct_shipments", name: "direct_shipments_rollCount_pos" },
  { table: "roll_returns", name: "roll_returns_qty_pos" },
  { table: "work_orders", name: "work_orders_stockprod_targetItem" },
  // 2026-08-09 — sapma defteri (migration 20260809015353_roll_variance_ledger).
  // `qty` HER ZAMAN pozitif; yönü `kind` söyler. İşaretli sayı saklamak
  // "SUM(qty)" yazan her raporu sessizce yanlışlar (biri işareti dikkate alır,
  // diğeri almaz) ve bu yıllar sonra fark edilir.
  { table: "roll_variances", name: "roll_variances_qty_positive" },
  // 2026-08-13 — ön muhasebe (migration 20260813201311_finance_preaccounting).
  // Muhasebe seddleri "veri tutarlı olsun" değil "DEFTER OKUNABİLİR olsun"
  // içindir: yönü iki yerde saklayan (işaretli tutar) ya da yarım durum bırakan
  // (onaylı ama kim/ne zaman boş) bir satır, denetimde hiçbir şey kanıtlamaz.
  { table: "cari_accounts", name: "cari_accounts_party_xor" },
  { table: "cari_accounts", name: "cari_accounts_kind_matches_party" },
  { table: "payments", name: "payments_account_xor" },
  { table: "payments", name: "payments_amount_positive" },
  { table: "payments", name: "payments_rate_positive" },
  { table: "cari_transactions", name: "cari_txn_debit_credit_xor" },
  { table: "invoices", name: "invoices_status_stamps" },
  { table: "invoices", name: "invoices_rate_positive" },
  { table: "invoice_lines", name: "invoice_lines_positive" },
  { table: "exchange_rates", name: "exchange_rates_rate_positive" },
  // 2026-08-14 — carisiz kasa hareketi (migration 20260813230932_cash_transaction).
  { table: "cash_transactions", name: "cash_txn_account_xor" },
  { table: "cash_transactions", name: "cash_txn_amount_positive" },
  { table: "cash_transactions", name: "cash_txn_rate_positive" },
  // Tür ↔ yön tutarlılığı: "gider ama bakiye artmış" satırı kasa defterini
  // okunamaz yapar.
  { table: "cash_transactions", name: "cash_txn_kind_matches_direction" },
  // Virman satırı grubunu taşımak ZORUNDA (grupsuz TRANSFER_OUT = karşı bacağı
  // bulunamayan yarım virman); tekil hareket taşıyamaz.
  { table: "cash_transactions", name: "cash_txn_transfer_group" },
  { table: "cash_transactions", name: "cash_txn_cancel_stamp" },
  // Alış fiyatı negatif olamaz (0 meşru: bedelsiz numune).
  { table: "rolls", name: "rolls_purchase_price_nonneg" },
  // 2026-08-14 — çek/senet portföyü (migration 20260814101000_cheque_portfolio).
  { table: "cheques", name: "cheques_amount_positive" },
  { table: "cheques", name: "cheques_rate_positive" },
  // ⚠️ CİRO TUTARLILIĞI — planın yazdığı KATI çift-yönlü eşitlik
  // (`status='ENDORSED'` ⇔ `endorsedToCariId IS NOT NULL`) BİLİNÇLİ OLARAK
  // uygulanmadı, çünkü planın KENDİ kuralıyla çelişiyordu: "BOUNCE → ENDORSED'dan
  // geldiyse ciro carisine ters CREDIT". Ciro edilmiş çek karşılıksız çıkınca
  // durum BOUNCED olur ama ters kaydın kime yazılacağı hâlâ BİLİNMEK ZORUNDA.
  // Korunan iki yarı: ENDORSED ciro carisiz olamaz + canlı/ciro edilmemiş çek
  // (PORTFOLIO/AT_BANK/ISSUED) sahte ciro izi taşıyamaz.
  { table: "cheques", name: "cheques_endorsed_cari" },
  // Olay satırı kasa VEYA banka taşır, ikisi birden değil ("en çok bir" —
  // olayların çoğu hiçbir hesaba dokunmaz). payments_account_xor ile aynı gerekçe.
  { table: "cheque_events", name: "cheque_events_account_not_both" },
  // 2026-08-14 — fatura kapama (migration 20260814102000_payment_allocation).
  { table: "payment_allocations", name: "payment_allocations_source_xor" },
  { table: "payment_allocations", name: "payment_allocations_amount_positive" },
  // ⚠️ SAYAÇ SEDDLERİ — `Order.shippedQty` dersinin (seddi OLMAYAN denormalize
  // alan, drift'i yıllarca görünmez) muhasebe karşılığı. Üst sınır DB'de kilitli
  // olduğu için "tutarından fazla kapanmış fatura" satırı YAZILAMAZ; bu üçü
  // düşerse kapama sayaçları sessizce gerçeğin üstüne çıkabilir.
  { table: "invoices", name: "invoices_paid_total_range" },
  { table: "payments", name: "payments_allocated_total_range" },
  { table: "cheques", name: "cheques_allocated_total_range" },
  // 2026-08-14 — Paket D (migration 20260814072115_paket_d_...).
  // Miktar HER ZAMAN pozitif; yönü `kind` söyler (WarehouseMovement emsali).
  // Sıfır da yasak: "hiçbir şey olmadı" bir defter satırı değildir.
  { table: "yarn_movements", name: "yarn_movements_qty_positive" },
  // Fiyat negatif olamaz; SIFIR serbest (promosyon/numune satırı meşru).
  { table: "item_prices", name: "item_prices_price_nonneg" },
  { table: "purchase_order_lines", name: "purchase_order_lines_qty_positive" },
  { table: "purchase_order_lines", name: "purchase_order_lines_received_nonneg" },
  // ⚠️ `receivedQty <= qty` seddi BİLİNÇLİ OLARAK YOK: fiziksel olarak fazla mal
  // GELEBİLİR ve kayıt gerçeği yazmalıdır. Servis uyarır, DB engellemez — aksi
  // halde depocu gelen malı sisteme HİÇ giremezdi. Bu satır bir eksiklik değil,
  // yazılı bir karardır; "tamamlamak" için eklemeyin.
  // ⚠️ `yarn_stocks.balanceKg >= 0` seddi de YOK: sayım girilmeden çıkış
  // yapılırsa bakiye GERÇEKTEN eksidir ve GÖRÜNMELİDİR. Sıfıra kırpmak eksiği
  // gizleyip envanteri sessizce yanlışlardı.
  // 2026-08-14 — sağlamlık paketi (20260814110200).
  // Kapanış hesabı kasa XOR banka (Payment/CashTransaction sözleşmesi).
  { table: "cash_period_closes", name: "cash_period_close_account_xor" },
  // ⚠️ SINIF 4 SEDDİ: parasız-terminal çekte (BOUNCED/RETURNED/CANCELLED) canlı
  // kapama tutarı olamaz. Uygulamanın çift yönlü CAS yüklemi atlanırsa (ham SQL,
  // yeni geçiş yolu) satırın kendisi direnir. COLLECTED bilinçli DIŞARIDA:
  // tahsil edilmiş çeke kapama meşrudur.
  { table: "cheques", name: "cheques_terminal_not_allocated" },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3) DEFERRABLE COMPOSITE FK'lar (2) — çuval/sevkiyat tutarlılık seddi.
//    `schema.prisma:2557-2558`: "migrate dev bu 2 FK'yı DROP etmek İSTER. ASLA
//    uygulama." Her diff'te spurious drop üretiyorlar → en aktif drift kaynağı.
//    DEFERRED olmaları load-bearing: tx içinde sackId ve shipmentId ayrı
//    UPDATE'lerle yazılır, ara durum geçici olarak tutarsızdır.
// ─────────────────────────────────────────────────────────────────────────────
const DEFERRABLE_FKS: Array<{ table: string; name: string }> = [
  { table: "rolls", name: "rolls_sackId_shipmentId_consistency_fkey" },
  { table: "swatches", name: "swatches_sackId_shipmentId_consistency_fkey" },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4) EXTENDED STATISTICS (1) — migration 20260614120000_system_log_daily_stats,
//    ifadesi 20260801050000_system_log_daily_stats_tz ile fabrika saat dilimine
//    taşındı (audit "daily" serisi artık Europe/Istanbul takvim günü keser).
//    ⚠️ Bu bekçi yalnız nesnenin VARLIĞINI görür — ifade servisteki
//    `factoryDaySql` metniyle uyuşmazsa istatistik sessizce devre dışı kalır
//    (sonuç doğru, sorgu ~2x yavaş). İfadeyi değiştirirsen migration'ı da yaz.
// ─────────────────────────────────────────────────────────────────────────────
const EXT_STATS: Array<{ name: string; table: string }> = [{ name: "sl_day_exact", table: "system_logs" }];

// ─────────────────────────────────────────────────────────────────────────────
// 5) EXPRESSION UNIQUE'ler (2) — migration 20260731160000_lowprio_unique_hardening
//    Prisma expression index modelleyemez → şema-dışı. App-level case-insensitive
//    ad kontrolünün (mode:'insensitive') YARIŞ penceresini kapatan DB seddi (A7).
// ─────────────────────────────────────────────────────────────────────────────
const EXPRESSION_UNIQUES: Array<{ table: string; index: string; expr: string }> = [
  { table: "users", index: "users_username_lower_uq", expr: "lower(username)" },
  { table: "permission_templates", index: "permission_templates_name_lower_uq", expr: "lower(name)" },
];

// ─────────────────────────────────────────────────────────────────────────────
// 6) TRIGGER'lar (1) — migration 20260809090000_roll_production_timestamps
//    Prisma trigger modelleyemez → şema-dışı ve DİĞERLERİNDEN DAHA KRİTİK:
//    partial index kaybolursa sorgu yavaşlar (sonuç doğru kalır), trigger
//    kaybolursa kolon HİÇ yazılmaz ve tüm dönem raporları sessizce boşalır.
// ─────────────────────────────────────────────────────────────────────────────
const TRIGGERS: Array<{ table: string; trigger: string; timing: string[]; why: string }> = [
  {
    table: "rolls",
    trigger: "rolls_stamp_production_timestamps",
    // BEFORE zorunlu: AFTER trigger NEW'i değiştiremez → damgalama sessizce
    // hiçbir şey yazmaz. INSERT dalı da zorunlu: doğrudan final statüde doğan
    // toplar (fason kabul çocuğu) başka hiçbir yerde damgalanmaz.
    timing: ["BEFORE INSERT OR UPDATE", "FOR EACH ROW"],
    why: "Roll.finalizedAt / statusChangedAt'in TEK yazma noktası — kalite/fire/fason karnelerinin dönem çıpası",
  },
];

async function main(): Promise<void> {
  console.log("\n=== Şema-dışı DB invariant guard'ı ===");
  console.log(
    `Beklenen: ${PARTIAL_INDEXES.length} partial index · ${CHECK_CONSTRAINTS.length} CHECK · ${DEFERRABLE_FKS.length} DEFERRABLE FK · ${EXT_STATS.length} statistics\n`
  );

  // ── 1) Partial indexler ──
  console.log("── 1) Partial indexler (predicate + uniqueness) ──");
  const liveIdx = await prisma.$queryRaw<
    Array<{ table_name: string; index_name: string; is_unique: boolean; predicate: string }>
  >`
    SELECT t.relname AS table_name,
           c.relname AS index_name,
           i.indisunique AS is_unique,
           pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND i.indpred IS NOT NULL
  `;
  const idxByName = new Map(liveIdx.map((r) => [r.index_name, r]));

  for (const exp of PARTIAL_INDEXES) {
    const live = idxByName.get(exp.index);
    if (!live) {
      // En tehlikeli senaryo: index var ama predicate'i DÜŞMÜŞ (tam index'e
      // dönmüş) → yukarıdaki sorgu (indpred IS NOT NULL) onu hiç getirmez.
      // Ayırt et: aynı adda predicate'siz bir index var mı?
      const full = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'public' AND c.relname = ${exp.index} AND c.relkind = 'i'
      `;
      const existsAsFull = Number(full[0]?.n ?? 0) > 0;
      check(
        `${exp.index}`,
        false,
        existsAsFull
          ? `PREDICATE DÜŞMÜŞ — index TAM index'e dönmüş (bir migration onu yeniden yaratmış). Beklenen: WHERE ${exp.predicate}`
          : `index HİÇ YOK (${exp.table})`
      );
      continue;
    }
    const predOk = norm(live.predicate) === norm(exp.predicate);
    const uniqOk = live.is_unique === exp.uniq;
    if (predOk && uniqOk) {
      check(`${exp.index}`, true, exp.why);
    } else {
      const problems: string[] = [];
      if (!predOk) problems.push(`predicate DEĞİŞMİŞ: beklenen "${exp.predicate}", canlı "${live.predicate}"`);
      if (!uniqOk)
        problems.push(
          `uniqueness DEĞİŞMİŞ: beklenen ${exp.uniq ? "UNIQUE" : "index"}, canlı ${live.is_unique ? "UNIQUE" : "index"}` +
            (exp.uniq ? " — SED KAYBOLDU, mükerrer kayıt mümkün" : "")
        );
      check(`${exp.index}`, false, problems.join(" | "));
    }
  }
  // Envanter dışı partial index → KIRMIZI.
  // Bir index hem partial hem expression olabilir (indpred + indexprs birlikte);
  // öyle bir nesne iki sorgudan da döner. Sahipliği tek bölüme bağlamak için
  // karşı envanter burada muaf tutulur — aksi halde aynı nesne iki bölümde birden
  // "envanter dışı" sayılır ve düzeltmesi imkânsız bir çifte hata üretir.
  const expectedIdxNames = new Set([
    ...PARTIAL_INDEXES.map((e) => e.index),
    ...EXPRESSION_UNIQUES.map((e) => e.index),
  ]);
  checkNoExtras(
    "1) Partial indexler",
    liveIdx.map((r) => r.index_name),
    expectedIdxNames,
    (n) => {
      const l = idxByName.get(n);
      return `${l?.table_name}.${n} WHERE ${l?.predicate}`;
    }
  );

  // ── 2) CHECK constraintler ──
  console.log("\n── 2) CHECK constraintler (var + validated) ──");
  const liveChecks = await prisma.$queryRaw<
    Array<{ table_name: string; name: string; validated: boolean; def: string }>
  >`
    SELECT conrelid::regclass::text AS table_name,
           conname AS name,
           convalidated AS validated,
           pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace
  `;
  const checkByName = new Map(liveChecks.map((r) => [r.name, r]));

  for (const exp of CHECK_CONSTRAINTS) {
    const live = checkByName.get(exp.name);
    if (!live) {
      check(exp.name, false, `CHECK constraint YOK (${exp.table}) — negatif/sıfır değer artık DB'de engellenmiyor`);
      continue;
    }
    if (!live.validated) {
      check(exp.name, false, "mevcut ama NOT VALID — eski satırlar doğrulanmamış");
      continue;
    }
    check(exp.name, true, live.def.replace(/\s+/g, " ").slice(0, 62));
  }
  // NOT: `contype='c'` yalnız gerçek CHECK'leri getirir. PostgreSQL 18'de NOT NULL
  // kısıtları da kataloğa girdi ama `contype='n'` ile — bu sorguya sızmazlar
  // (dev PG 18.4 / CI PG 16'da sayım birebir aynı çıktı: 25).
  checkNoExtras(
    "2) CHECK constraintler",
    liveChecks.map((r) => r.name),
    new Set(CHECK_CONSTRAINTS.map((e) => e.name)),
    (n) => `${checkByName.get(n)?.table_name}.${n}`
  );

  // ── 3) DEFERRABLE composite FK'lar ──
  console.log("\n── 3) DEFERRABLE composite FK'lar ──");
  const liveFks = await prisma.$queryRaw<
    Array<{ table_name: string; name: string; deferrable: boolean; deferred: boolean; def: string }>
  >`
    SELECT conrelid::regclass::text AS table_name,
           conname AS name,
           condeferrable AS deferrable,
           condeferred AS deferred,
           pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  `;
  const fkByName = new Map(liveFks.map((r) => [r.name, r]));

  for (const exp of DEFERRABLE_FKS) {
    const live = fkByName.get(exp.name);
    if (!live) {
      check(
        exp.name,
        false,
        `composite FK YOK (${exp.table}) — muhtemelen bir 'migrate dev' spurious DROP'u uygulanmış (schema.prisma:2557 uyarısı)`
      );
      continue;
    }
    if (!live.deferrable || !live.deferred) {
      check(
        exp.name,
        false,
        `mevcut ama DEFERRABLE INITIALLY DEFERRED DEĞİL (deferrable=${live.deferrable}, deferred=${live.deferred}) — tx içi ara tutarsızlık artık patlar`
      );
      continue;
    }
    check(exp.name, true, "DEFERRABLE INITIALLY DEFERRED");
  }
  // Envanter-dışı DEFERRABLE FK → KIRMIZI. Karşılaştırma kümesi TÜM FK'lar değil,
  // yalnız `condeferrable` olanlardır: sıradan FK'ları Prisma datamodel'den üretir
  // ve `test_schema_drift.ts` doğrular; buranın konusu Prisma'nın temsil EDEMEDİĞİ
  // ertelenmiş kısıtlardır. Yeni bir DEFERRABLE FK sessizce doğarsa (ya da mevcut
  // biri elle DEFERRABLE yapılırsa) `migrate dev` onu her diff'te DROP etmek ister
  // ve kimse bunu bilmez — o yüzden burada tespit ediliyor.
  checkNoExtras(
    "3) DEFERRABLE FK'lar",
    liveFks.filter((r) => r.deferrable).map((r) => r.name),
    new Set(DEFERRABLE_FKS.map((e) => e.name)),
    (n) => `${fkByName.get(n)?.table_name}.${n} — ${fkByName.get(n)?.def}`
  );

  // ── 4) Extended statistics ──
  console.log("\n── 4) Extended statistics ──");
  const liveStats = await prisma.$queryRaw<Array<{ name: string; table_name: string }>>`
    SELECT stxname AS name, stxrelid::regclass::text AS table_name
    FROM pg_statistic_ext
    WHERE stxnamespace = 'public'::regnamespace
  `;
  const statByName = new Map(liveStats.map((r) => [r.name, r]));
  for (const exp of EXT_STATS) {
    const live = statByName.get(exp.name);
    check(
      exp.name,
      live != null,
      live != null
        ? `${live.table_name} — DATE_TRUNC('day') planner tahmini`
        : `statistics nesnesi YOK (${exp.table}) — günlük audit sorgusu yanlış plan seçebilir`
    );
  }
  // Envanter-dışı statistics → KIRMIZI. Bir CREATE STATISTICS raw migration'la
  // gelir ve `schema.prisma` onu bilmez; envantere yazılmazsa bir sonraki
  // Prisma-üretimi migration onu sessizce düşürebilir (bu dosyanın kuruluş hikâyesi).
  checkNoExtras(
    "4) Extended statistics",
    liveStats.map((r) => r.name),
    new Set(EXT_STATS.map((e) => e.name)),
    (n) => `${statByName.get(n)?.table_name}.${n}`
  );

  // ── 5) Expression unique'ler ──
  console.log("\n── 5) Expression unique'ler (var + UNIQUE + ifade) ──");
  const liveExpr = await prisma.$queryRaw<
    Array<{ table_name: string; index_name: string; is_unique: boolean; expr: string | null }>
  >`
    SELECT t.relname AS table_name,
           c.relname AS index_name,
           i.indisunique AS is_unique,
           pg_get_expr(i.indexprs, i.indrelid) AS expr
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND i.indexprs IS NOT NULL
  `;
  // pg_get_expr "lower((username)::text)" döner — cast/paren/boşluk fold'la karşılaştır.
  const foldExpr = (s: string) => s.toLowerCase().replace(/::text/g, "").replace(/[()\s]/g, "");
  const exprByName = new Map(liveExpr.map((r) => [r.index_name, r]));
  for (const exp of EXPRESSION_UNIQUES) {
    const live = exprByName.get(exp.index);
    if (!live) {
      check(exp.index, false, `expression index YOK (${exp.table}) — case yarışı seddi kayıp`);
      continue;
    }
    const exprOk = live.expr != null && foldExpr(live.expr) === foldExpr(exp.expr);
    const uniqOk = live.is_unique;
    if (exprOk && uniqOk) {
      check(exp.index, true, exp.expr);
    } else {
      check(
        exp.index,
        false,
        (!uniqOk ? "UNIQUE düşmüş — sed kayboldu. " : "") +
          (!exprOk ? `ifade DEĞİŞMİŞ: beklenen ${exp.expr}, canlı ${live.expr ?? "?"}` : ""),
      );
    }
  }
  // Envanter-dışı expression index → KIRMIZI. Partial envanteri burada muaf
  // (bkz. 1. bölümdeki karşılıklı muafiyet notu — nesnenin sahibi tek bölüm olsun).
  checkNoExtras(
    "5) Expression index'ler",
    liveExpr.map((r) => r.index_name),
    new Set([...EXPRESSION_UNIQUES.map((e) => e.index), ...PARTIAL_INDEXES.map((e) => e.index)]),
    (n) => {
      const l = exprByName.get(n);
      return `${l?.table_name}.${n} ON (${l?.expr})`;
    }
  );

  // ── 6) Trigger'lar ──
  // Prisma trigger'ı ŞEMADA TEMSİL EDEMEZ — yani bu bölüm olmadan bir trigger
  // sessizce kaybolabilir ve kaybını hiçbir şey söylemez. Diğer şema-dışı
  // nesnelerden FARKI: partial index kaybolursa sorgu yavaşlar (sonuç doğru
  // kalır), trigger kaybolursa VERİ YAZILMAZ ve raporlar sessizce boşalır.
  console.log("\n── 6) Trigger'lar (var + zamanlama + olay) ──");
  const liveTriggers = await prisma.$queryRaw<
    Array<{ table_name: string; trigger_name: string; def: string }>
  >`
    SELECT t.relname AS table_name,
           tg.tgname  AS trigger_name,
           pg_get_triggerdef(tg.oid) AS def
    FROM pg_trigger tg
    JOIN pg_class t     ON t.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal
  `;
  const trgByName = new Map(liveTriggers.map((r) => [r.trigger_name, r]));
  for (const exp of TRIGGERS) {
    const live = trgByName.get(exp.trigger);
    if (!live) {
      check(exp.trigger, false, `trigger YOK (${exp.table}) — ${exp.why}`);
      continue;
    }
    // Zamanlama LOAD-BEARING: AFTER trigger NEW'i değiştiremez, yani BEFORE
    // düşerse damgalama sessizce hiçbir şey yazmaz (hata da vermez).
    const defN = norm(live.def);
    const timingOk = exp.timing.every((frag) => defN.includes(norm(frag)));
    check(
      exp.trigger,
      timingOk,
      timingOk ? `${exp.table} · ${exp.timing.join(" ")}` : `tanım DEĞİŞMİŞ: ${live.def}`
    );
  }
  checkNoExtras(
    "6) Trigger'lar",
    liveTriggers.map((r) => r.trigger_name),
    new Set(TRIGGERS.map((e) => e.trigger)),
    (n) => `${trgByName.get(n)?.table_name}.${n}`
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE iki ayrı senaryo var — mesaj hangisi olduğunu söylüyor:\n" +
        "  (a) BEKLENEN NESNE KAYIP/BOZUK → bir migration şema-dışı bir DB nesnesini yok\n" +
        "      etmiş. Onarım deseni: 20260612100000_repartialize_after_native_uuid —\n" +
        "      DROP INDEX + CREATE INDEX ... WHERE ... ile predicate'i geri koy. Nesne\n" +
        "      KASTEN kaldırıldıysa bu dosyadaki beklenen listeden de çıkar.\n" +
        "  (b) ENVANTER-DIŞI NESNE → DB'de beklenen listede olmayan bir nesne var.\n" +
        "      Doğru tepki nesneyi SİLMEK DEĞİL: yeni eklediğin partial index/CHECK/\n" +
        "      DEFERRABLE FK/statistics ise bu dosyadaki ilgili diziye yaz (gerekçe\n" +
        "      cümlesiyle). Sen eklemediysen nereden geldiğini bul — elle açılmış bir\n" +
        "      nesne bir sonraki Prisma migration'ında sessizce kaybolur."
    );
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
