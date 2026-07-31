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
// Salt-okunur: hiçbir yazma/fixture yok, herhangi bir ortamda güvenle koşar.
// Koşum: npx tsx scripts/test_db_invariants.ts
// =============================================================================
import prisma from "../src/lib/prisma";

let pass = 0,
  fail = 0,
  warn = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
function warnLine(msg: string): void {
  warn++;
  console.log(`⚠️  ${msg}`);
}

/** Predicate karşılaştırması: PG sürüm/parantez farkına dayanıklı normalize. */
function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) PARTIAL INDEXLER (25) — ad + predicate + uniqueness
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
// 4) EXTENDED STATISTICS (1) — migration 20260614120000_system_log_daily_stats
// ─────────────────────────────────────────────────────────────────────────────
const EXT_STATS: Array<{ name: string; table: string }> = [{ name: "sl_day_exact", table: "system_logs" }];

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
  // Envanter dışı yeni partial index → uyarı (hata değil)
  const expectedIdxNames = new Set(PARTIAL_INDEXES.map((e) => e.index));
  for (const live of liveIdx) {
    if (!expectedIdxNames.has(live.index_name))
      warnLine(
        `Envanterde OLMAYAN partial index: ${live.table_name}.${live.index_name} WHERE ${live.predicate} → bu dosyaya ekle`
      );
  }

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
  const expectedCheckNames = new Set(CHECK_CONSTRAINTS.map((e) => e.name));
  for (const live of liveChecks) {
    if (!expectedCheckNames.has(live.name))
      warnLine(`Envanterde OLMAYAN CHECK: ${live.table_name}.${live.name} → bu dosyaya ekle`);
  }

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

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${warn > 0 ? `, ${warn} uyarı` : ""} ===`);
  if (fail > 0) {
    console.log(
      "\nDÜŞTÜYSE: bir migration şema-dışı bir DB nesnesini yok etmiş olabilir.\n" +
        "Onarım deseni: 20260612100000_repartialize_after_native_uuid — DROP INDEX + \n" +
        "CREATE INDEX ... WHERE ... ile predicate'i geri koy. Nesne KASTEN kaldırıldıysa\n" +
        "bu dosyadaki beklenen listeden de çıkar."
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
