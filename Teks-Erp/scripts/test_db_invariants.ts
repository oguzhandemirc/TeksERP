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
