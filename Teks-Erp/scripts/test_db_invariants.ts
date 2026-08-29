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
// 1) PARTIAL INDEXLER (38) — ad + predicate + uniqueness
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
  { table: "rolls", index: "rolls_directShipmentId_idx", uniq: false, predicate: `("directShipmentId" IS NOT NULL)`, why: "null-yoğun FK — fason doğrudan sevk izi (K7c, 2026-08-29)" },
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
  // orders
  { table: "orders", index: "orders_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "idempotency" },
  { table: "orders", index: "orders_active_createdAt_idx", uniq: false, predicate: `(status <> 'CANCELLED'::"OrderStatus")`, why: "varsayılan liste sıralaması: panel iptalleri gizler (hideCancelled), o yüzden (status, createdAt) bileşiği ordering veremez — 30 günlük tarih penceresi kaldırıldıktan sonra tek koruma bu" },
  // swatch_stock_reductions
  { table: "swatch_stock_reductions", index: "swatch_stock_reductions_clientToken_key", uniq: true, predicate: `("clientToken" IS NOT NULL)`, why: "kartela stok-düşüm idempotency" },
  // batches
  { table: "batches", index: "batches_splitFromId_idx", uniq: false, predicate: `("splitFromId" IS NOT NULL)`, why: "null-yoğun FK" },
  { table: "batches", index: "batches_mergedIntoId_idx", uniq: false, predicate: `("mergedIntoId" IS NOT NULL)`, why: "null-yoğun FK" },
  // ana veri birleştirme soy bağı (migration 20260819210000) — Batch emsalinin
  // dört ana-veri varlığına taşınması. Birleşmiş kayıt İSTİSNADIR (binlerce
  // satırda bir avuç) ve sorgu yolu daima "şu survivor'ın çocukları".
  { table: "customers", index: "customers_mergedIntoId_idx", uniq: false, predicate: `("mergedIntoId" IS NOT NULL)`, why: "null-yoğun FK (birleştirme tombstone'u seyrek)" },
  { table: "items", index: "items_mergedIntoId_idx", uniq: false, predicate: `("mergedIntoId" IS NOT NULL)`, why: "null-yoğun FK (birleştirme tombstone'u seyrek)" },
  { table: "colors", index: "colors_mergedIntoId_idx", uniq: false, predicate: `("mergedIntoId" IS NOT NULL)`, why: "null-yoğun FK (birleştirme tombstone'u seyrek)" },
  { table: "subcontractors", index: "subcontractors_mergedIntoId_idx", uniq: false, predicate: `("mergedIntoId" IS NOT NULL)`, why: "null-yoğun FK (birleştirme tombstone'u seyrek)" },
  // AD MÜKERRERİ DB SEDDİ (D3/B6, 2026-08-21 — migration 20260821150000_name_fold_unique_live):
  // şemada `@@unique([nameFold])` (index↔unique farkı drift sayılır), DB'de PARTIAL —
  // tombstone (mergedIntoId IS NOT NULL) aynı katlanmış adı meşru olarak taşır, predicate onu
  // dışarıda bırakır. RENK BİLİNÇLİ YOK (foldColorNameForCompare, JS guard). `uniq` düşerse
  // "SED KAYBOLDU" — uygulama bekçisi (check-then-act) yarış/atlama yollarını kapatmaz.
  // ⚠️ YUMUŞAK KAPI (2026-08-22): migration mükerrer varken bu index'leri ATLAR. PROD'da
  // temizlik bitene dek bu üç satır KIRMIZI olabilir ve bu BİLEREK böyle — "enforce bekliyor"
  // sinyali (çözüm: mükerrerleri birleştir → migration dosyasını yeniden koş). Dev/CI temiz.
  { table: "customers", index: "customers_nameFold_key", uniq: true, predicate: `("mergedIntoId" IS NULL)`, why: "ad mükerreri DB seddi — tombstone hariç (prod'da eksikse: temizlik + enforce bekliyor)" },
  { table: "items", index: "items_nameFold_key", uniq: true, predicate: `("mergedIntoId" IS NULL)`, why: "ad mükerreri DB seddi — tombstone hariç (prod'da eksikse: temizlik + enforce bekliyor)" },
  { table: "subcontractors", index: "subcontractors_nameFold_key", uniq: true, predicate: `("mergedIntoId" IS NULL)`, why: "ad mükerreri DB seddi — tombstone hariç (prod'da eksikse: temizlik + enforce bekliyor)" },
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
// `notValid` = BİLİNÇLİ yumuşak kapı: kısıt YENİ ve GÜNCELLENEN satırları zorlar
// ama eski ihlalleri geçmişte bırakır. Gerekçesi ZORUNLU (`why`) — çünkü "NOT
// VALID kalmış, VALIDATE etmeyi unutmuşuz" ile "bilerek yumuşak" arasındaki fark
// yalnız burada yazılıdır. Temizlik bitince girdiyi sil, `VALIDATE` et.
const CHECK_CONSTRAINTS: Array<{ table: string; name: string; notValid?: string }> = [
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
  // 2026-08-29 denetimi (K1) — migration 20260829140000_denetim_sema_kisitlari.
  // "Topun kalan metrajı giriş metrajını aşamaz." Depo kesimi `initialQty`ye
  // dokunduğu için yıllarca ihlal edilebiliyordu (T1-044 · T1-001 · T1-002 ·
  // T3-011 · T2-016); kod tarafı düzeltildi, bu DB seddi ikinci hattır.
  {
    table: "rolls",
    name: "rolls_qty_le_initial",
    notValid:
      "Fabrika verisinde 2 ESKİ ihlal satırı var (ölçüldü). Toplu UPDATE ile " +
      "'düzeltmek' kök nedeni gizler ve kapıyı görünmez yapar — satırlar bilerek " +
      "duruyor. Temizlik yapılınca: ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial;",
  },
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
// 5) EXPRESSION UNIQUE'ler (3) — 20260731160000_lowprio_unique_hardening (2) +
//    20260825120000_color_name_unique_live (1).
//    Prisma expression index modelleyemez → şema-dışı. App-level case-insensitive
//    ad kontrolünün (mode:'insensitive') YARIŞ penceresini kapatan DB seddi (A7).
//    `predicate` verilirse index hem ifade hem PARTIAL'dır: sahibi BU bölümdür
//    (§1 karşı-envanter muafiyetiyle kabul eder), predicate de burada doğrulanır.
//    ⚠️ Renk seddi YUMUŞAK KAPI ile gelir: mükerrer taşıyan DB'de index ATLANIR ve
//    bu satır KIRMIZI kalır — bilerek ("enforce bekliyor" sinyali; §1 nameFold emsali).
// ─────────────────────────────────────────────────────────────────────────────
const EXPRESSION_UNIQUES: Array<{ table: string; index: string; expr: string; predicate?: string; why?: string }> = [
  { table: "users", index: "users_username_lower_uq", expr: "lower(username)" },
  { table: "permission_templates", index: "permission_templates_name_lower_uq", expr: "lower(name)" },
  {
    table: "colors",
    index: "colors_nameFoldColor_key",
    expr: "tr_fold_color(name)",
    predicate: `("mergedIntoId" IS NULL)`,
    why: "renk ad seddi — ayraç + sayı-sırası bağımsız SQL ikizi; tombstone hariç (eksikse: temizlik + enforce bekliyor)",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 6) TRIGGER'lar (3) — 20260809090000 (roll damgası) + 20260819161000 (audit guard)
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
  {
    table: "system_logs",
    trigger: "system_logs_block_tamper",
    // ⚠️ OLAY SIRASI PG'NİN KANONİK SIRASI OLMAK ZORUNDA. Migration'da
    // "UPDATE OR DELETE OR TRUNCATE" yazılmıştır ama `pg_get_triggerdef`
    // ruleutils sırasına çevirir (INSERT, DELETE, UPDATE, TRUNCATE) →
    // buraya yazım sırasını kopyalarsan kontrol DAİMA kırmızı verir.
    timing: ["BEFORE DELETE OR UPDATE OR TRUNCATE", "FOR EACH STATEMENT"],
    why: "Audit değiştirilemezliği (ISO 27001 A.8.15) — koruma teks.audit_guard GUC'u ile PROD'da açılır, arşivleyici teks.audit_purge ile geçer (migration 20260819161000)",
  },
  {
    // ⚠️ AYRI AD ZORUNLU: aşağıdaki envanter trigger'ları YALNIZ ADA GÖRE
    // haritalıyor (`trgByName`); iki tabloda aynı adı kullanmak Map'te tekini
    // bırakır ve envanter sessizce yanlış çalışır. Fonksiyon tek, trigger iki.
    table: "system_log_archives",
    trigger: "system_log_archives_block_tamper",
    timing: ["BEFORE DELETE OR UPDATE OR TRUNCATE", "FOR EACH STATEMENT"],
    why: "Arşiv de audit'tir — koruma yalnız sıcak tabloda olsaydı 6 aylık gecikmeyle beklenen kurcalama yolu açık kalırdı",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 7-8-9) ARAMA KATLAMASI nesneleri (migration 20260819060000_search_fold)
// ─────────────────────────────────────────────────────────────────────────────
// Üçü de `schema.prisma`'nın temsil edemediği sınıfta: uzantı, fonksiyon,
// collation ve GENERATED ifadesi. Kaybolurlarsa belirtiler SESSİZDİR:
//   • `tr_fold` düşerse → gölge kolonların hepsi düşer (bağımlı), arama patlar.
//   • `tr_fold`ın GÖVDESİ değişirse → saklanan katlamalar bayatlar, JS ikiziyle
//     ayrışır ve arama SESSİZCE eksik sonuç verir (asıl tehlike bu).
//   • `tr_sort` düşerse → ad kolonları varsayılan collation'a döner ve sahadaki
//     C locale kurulumunda Ç/Ğ/İ/Ö/Ş/Ü ile başlayan her ad Z'den sonra sıralanır.
//   • GENERATED ifadesi düşerse → kolon sıradan bir kolona döner, uygulama onu
//     yazmadığı için sonsuza kadar NULL kalır ve arama boş döner.
const REQUIRED_EXTENSIONS: Array<{ name: string; why: string }> = [
  { name: "plpgsql", why: "PostgreSQL varsayılanı — trigger fonksiyonları" },
  { name: "pg_trgm", why: "gin_trgm_ops — `contains` aramasını index'e bağlayan tek yol" },
];
// Kurulu olabilir ama HİÇBİR ŞEY KULLANMAZ. `unaccent` dev DB'sinde elle
// kurulmuş (bu repoda hiçbir migration onu kurmuyor) ve arama tasarımı bilerek
// ondan VAZGEÇTİ (JS'te birebir üretilemiyordu — bkz. src/utils/search-fold.ts).
// Sahadaki kurulumda YOKTUR; bu yüzden "zorunlu" listesine konamaz.
const TOLERATED_EXTENSIONS = new Set(["unaccent"]);

const EXPECTED_FUNCTIONS: Array<{ name: string; volatility: string; bodyFragments: string[]; why: string }> = [
  {
    name: "tr_fold",
    volatility: "i", // IMMUTABLE — index/GENERATED ifadesinde kullanılabilmesi için ŞART
    // Gövde parmak izi: katlamanın DÖRT load-bearing adımı. Biri düşerse JS
    // ikiziyle ayrışır; `test_fold_contract.ts` bunu ayrıca ölçer ama bu kontrol
    // "fonksiyon sessizce değiştirildi" senaryosunu envanter tarafında yakalar.
    bodyFragments: ["normalize", "NFD", 'COLLATE "C"', "translate"],
    why: "arama katlaması — JS `foldSearchText` ile birebir aynı çıktı",
  },
  {
    // 20260825120000_color_name_unique_live — renk ad seddinin ifadesi. Parmak izi:
    // taban katlama (`tr_fold(`) + token sırası (`WITH ORDINALITY`) + sayısal-önce
    // sıralama ('^[0-9]+$') + birleştirme (`string_agg`). JS ikizi
    // `foldColorNameForCompare`; birebirlik `test_fold_contract.ts` §2b'de (tüm BMP).
    name: "tr_fold_color",
    volatility: "i",
    bodyFragments: ["tr_fold(", "WITH ORDINALITY", "^[0-9]+$", "string_agg"],
    why: "renk ad seddi — JS `foldColorNameForCompare` ile birebir aynı çıktı",
  },
];

const EXPECTED_COLLATIONS: Array<{ name: string; why: string }> = [
  { name: "tr_sort", why: "Türkçe SIRALAMA (arama katlamasının tersi: ç≠c)" },
];

// Gölge kolon sayısı — tek tek listelemek yerine ZEMİN + ifade doğrulaması.
// Tek tek liste 31 satır bakım yükü olurdu ve asıl risk "biri eksildi" değil,
// "hepsi birden düştü / ifade değişti"dir.
const FOLD_COLUMN_MIN = 31;
const FOLD_EXPR_FRAGMENT = "tr_fold";

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
      if (exp.notValid) {
        // Bilinçli yumuşak kapı — YEŞİL ama GÖRÜNÜR. Gerekçe her koşumda basılır
        // ki "geçici" durum sessizce kalıcılaşmasın.
        check(exp.name, true, `BİLİNÇLİ NOT VALID — ${exp.notValid.slice(0, 90)}`);
        continue;
      }
      check(exp.name, false, "mevcut ama NOT VALID — eski satırlar doğrulanmamış");
      continue;
    }
    if (exp.notValid) {
      // Ters yön: envanter "yumuşak" diyor ama kısıt VALIDATE edilmiş → temizlik
      // bitmiş demektir, girdi bayat. Ölü muaf gerçek bir ihlali gizler.
      check(exp.name, false, "envanterde BİLİNÇLİ NOT VALID yazıyor ama kısıt VALIDATE edilmiş — girdiyi kaldır");
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
  console.log("\n── 5) Expression unique'ler (var + UNIQUE + ifade + predicate) ──");
  const liveExpr = await prisma.$queryRaw<
    Array<{ table_name: string; index_name: string; is_unique: boolean; expr: string | null; predicate: string | null }>
  >`
    SELECT t.relname AS table_name,
           c.relname AS index_name,
           i.indisunique AS is_unique,
           pg_get_expr(i.indexprs, i.indrelid) AS expr,
           pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND i.indexprs IS NOT NULL
  `;
  // pg_get_expr "lower((username)::text)" döner — cast/paren/boşluk/şema fold'la karşılaştır.
  const foldExpr = (s: string) =>
    s.toLowerCase().replace(/public\./g, "").replace(/::text/g, "").replace(/[()\s]/g, "");
  const exprByName = new Map(liveExpr.map((r) => [r.index_name, r]));
  for (const exp of EXPRESSION_UNIQUES) {
    const live = exprByName.get(exp.index);
    if (!live) {
      check(
        exp.index,
        false,
        exp.predicate
          ? `expression index YOK (${exp.table}) — ${exp.why ?? "sed kayıp"}`
          : `expression index YOK (${exp.table}) — case yarışı seddi kayıp`,
      );
      continue;
    }
    const exprOk = live.expr != null && foldExpr(live.expr) === foldExpr(exp.expr);
    const uniqOk = live.is_unique;
    // Predicate yalnız beklenen partial ise ölçülür; beklenmeyen bir predicate de
    // sapmadır (sed daralmış demektir) — iki yön de kırmızı.
    const predOk = exp.predicate ? live.predicate != null && norm(live.predicate) === norm(exp.predicate) : live.predicate == null;
    if (exprOk && uniqOk && predOk) {
      check(exp.index, true, exp.predicate ? `${exp.expr} WHERE ${exp.predicate}` : exp.expr);
    } else {
      check(
        exp.index,
        false,
        (!uniqOk ? "UNIQUE düşmüş — sed kayboldu. " : "") +
          (!exprOk ? `ifade DEĞİŞMİŞ: beklenen ${exp.expr}, canlı ${live.expr ?? "?"}. ` : "") +
          (!predOk ? `predicate DEĞİŞMİŞ: beklenen ${exp.predicate ?? "(yok)"}, canlı ${live.predicate ?? "(yok)"}` : ""),
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


  // ── 7) Uzantılar ──────────────────────────────────────────────────────────
  console.log("\n── 7) Uzantılar ──");
  const liveExt = await prisma.$queryRaw<Array<{ extname: string; extversion: string }>>`
    SELECT extname, extversion FROM pg_extension
  `;
  const extNames = new Set(liveExt.map((e) => e.extname));
  for (const exp of REQUIRED_EXTENSIONS) {
    check(exp.name, extNames.has(exp.name), exp.why);
  }
  checkNoExtras(
    "7) Uzantılar",
    liveExt.map((e) => e.extname).filter((n) => !TOLERATED_EXTENSIONS.has(n)),
    new Set(REQUIRED_EXTENSIONS.map((e) => e.name)),
    (n) => n
  );

  // ── 8) Fonksiyon + collation ──────────────────────────────────────────────
  console.log("\n── 8) Katlama fonksiyonu + sıralama collation'ı ──");
  const liveFns = await prisma.$queryRaw<Array<{ proname: string; vol: string; body: string }>>`
    SELECT p.proname, p.provolatile::text AS vol, pg_get_functiondef(p.oid) AS body
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY(ARRAY['tr_fold', 'tr_fold_color'])
  `;
  const fnByName = new Map(liveFns.map((f) => [f.proname, f]));
  for (const exp of EXPECTED_FUNCTIONS) {
    const live = fnByName.get(exp.name);
    if (!live) {
      check(exp.name, false, `fonksiyon YOK — ${exp.why}`);
      continue;
    }
    check(`${exp.name} IMMUTABLE`, live.vol === exp.volatility, `volatility=${live.vol} (beklenen ${exp.volatility})`);
    const missing = exp.bodyFragments.filter((f) => !live.body.includes(f));
    check(
      `${exp.name} gövde parmak izi`,
      missing.length === 0,
      missing.length === 0 ? exp.why : `EKSİK adım: ${missing.join(", ")} — JS ikiziyle ayrışmış olabilir`
    );
  }
  const liveColl = await prisma.$queryRaw<Array<{ collname: string; provider: string }>>`
    SELECT collname, collprovider::text AS provider FROM pg_collation
    WHERE collnamespace = 'public'::regnamespace
  `;
  const collNames = new Set(liveColl.map((c) => c.collname));
  for (const exp of EXPECTED_COLLATIONS) {
    check(exp.name, collNames.has(exp.name), exp.why);
  }
  checkNoExtras(
    "8) Collation'lar",
    liveColl.map((c) => c.collname),
    new Set(EXPECTED_COLLATIONS.map((e) => e.name)),
    (n) => n
  );

  // ── 9) Katlanmış gölge kolonlar ───────────────────────────────────────────
  console.log("\n── 9) Katlanmış gölge kolonlar (GENERATED STORED) ──");
  const liveGen = await prisma.$queryRaw<Array<{ tbl: string; col: string; expr: string }>>`
    SELECT c.relname AS tbl, a.attname AS col,
           pg_get_expr(d.adbin, d.adrelid) AS expr
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND a.attgenerated = 's' AND NOT a.attisdropped
  `;
  // ⚠️ KÖRLÜK ZEMİNİ: sorgu bir refactor'da boşa düşerse "hiç kolon yok" ile
  // "hepsi doğru" aynı yeşile çıkardı.
  check(
    `körlük zemini: ≥${FOLD_COLUMN_MIN} gölge kolon bulundu`,
    liveGen.length >= FOLD_COLUMN_MIN,
    `${liveGen.length} kolon`
  );
  const wrongExpr = liveGen.filter((g) => !(g.expr ?? "").includes(FOLD_EXPR_FRAGMENT));
  check(
    "her gölge kolon tr_fold() ile üretiliyor",
    wrongExpr.length === 0,
    wrongExpr.length === 0
      ? `${liveGen.length} kolonun tamamı`
      : `ifadesi FARKLI: ${wrongExpr.map((g) => `${g.tbl}.${g.col}`).join(", ")}`
  );
  // ⚠️ BU İKİ KONTROL `base.service.ts`'in YAZMA/SIRALAMA/FİLTRE SÜZGECİNİ
  // TAŞIYOR. Prisma 7 runtime DMMF'i "bu kolonu DB üretiyor" bilgisini taşımıyor
  // (alan başına yalnız name/kind/type), o yüzden uygulama `Fold` son ekine
  // bakıyor. Sözleşme İKİ YÖNLÜ olmak zorunda:
  //   ileri  — GENERATED bir kolon `Fold` ile bitmezse süzgeç onu KAÇIRIR →
  //            istemci o alanı gönderince PostgreSQL 500 verir.
  //   geri   — `Fold` ile biten SIRADAN bir kolon eklenirse süzgeç onu YANLIŞLIKLA
  //            düşürür → alan sessizce hiç yazılmaz (çok daha sinsi).
  const notFoldNamed = liveGen.filter((g) => !g.col.endsWith("Fold"));
  check(
    "adlandırma sözleşmesi (ileri): her GENERATED kolon `<kolon>Fold`",
    notFoldNamed.length === 0,
    notFoldNamed.map((g) => `${g.tbl}.${g.col}`).join(", ") || "sapma yok"
  );
  const foldNamedNotGenerated = await prisma.$queryRaw<Array<{ tbl: string; col: string }>>`
    SELECT c.relname AS tbl, a.attname AS col
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname LIKE '%Fold' AND a.attgenerated <> 's'
  `;
  check(
    "adlandırma sözleşmesi (geri): `Fold` ile biten sıradan kolon YOK",
    foldNamedNotGenerated.length === 0,
    foldNamedNotGenerated.map((g) => `${g.tbl}.${g.col}`).join(", ") ||
      "sapma yok — süzgeç yalnız DB-üretimli kolonları düşürüyor"
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
