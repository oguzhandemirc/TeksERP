// =============================================================================
// BEKÇİ: K4P 4 puan şeması — DB seddi (K4P-SEMA, 2026-10-24)
// Çalıştır: npx tsx scripts/test_k4p_sema_sedleri.ts
// =============================================================================
// NEDEN: SEMA dilimi INSPECTION satırı yazan HİÇBİR yol açmaz; muayene verisinin
// bütünlüğü ilk günden yalnız DB seddine (CHECK + partial unique) dayanır. Bu
// bekçi her seddi onu İHLAL eden gerçek bir INSERT/UPDATE ile ölçer — kısıtın
// "envanterde var" olması (test_db_invariants) yüklemin doğru olduğunu söylemez.
// Bütün yazılar TEK tx içinde, her deneme kendi SAVEPOINT'inde; sonda ROLLBACK.
//   §1 PROCESS satırı metresiz → 23514 (`roll_errors_meter_ck`)
//   §2 INSPECTION satırı: belgesiz / isProcessed=true → 23514; points=5 → 23514
//   §3 aynı (rollId, phase) iki aktif muayene → 23505; biri damgalanınca ikincisi yazılır
//   §4 widthSource=UNKNOWN iken widthCm dolu → 23514
//   §5 iki aktif FACTORY kural seti → 23505 (pasif ikinci serbest)
//   §6 DefectType.fixedPoints=0 → 23514
// Negatif sonda: `roll_errors_meter_ck` test DB'de düşürülünce §1 kırmızı.
// =============================================================================
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { pool } from "../src/lib/prisma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

type Outcome = { ok: true } | { ok: false; code: string; constraint?: string };

/** Tek ifadeyi kendi SAVEPOINT'inde dener; hata tx'i zehirlemez. */
async function attempt(c: PoolClient, sql: string, params: unknown[] = []): Promise<Outcome> {
  await c.query("SAVEPOINT k4p");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT k4p");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT k4p");
    const err = e as { code?: string; constraint?: string };
    return { ok: false, code: err.code ?? "?", constraint: err.constraint };
  }
}

function expectReject(label: string, o: Outcome, code: string, constraint: string): void {
  const ok = !o.ok && o.code === code && o.constraint === constraint;
  check(label, ok, o.ok ? "KABUL EDİLDİ — sed yok" : `${o.code} ${o.constraint ?? ""}`);
}

function expectAccept(label: string, o: Outcome): void {
  check(label, o.ok, o.ok ? "yazıldı" : `${o.code} ${o.constraint ?? ""}`);
}

const INSERT_ERROR = `INSERT INTO roll_errors
  (id, "rollId", "startMeter", origin, points, "inspectionId", "isProcessed", "updatedAt")
  VALUES ($1, $2, $3, $4::"RollErrorOrigin", $5, $6, $7, now())`;

const INSERT_INSPECTION = `INSERT INTO roll_inspections
  (id, "rollId", phase, "inspectedLengthM", "widthCm", "widthSource", "totalPoints",
   "defectCount", "unplacedDefectCount", "ruleSnapshot", "inspectedById", "updatedAt")
  VALUES ($1, $2, $3::"InspectionPhase", 100, $4, $5::"InspectionWidthSource", 0, 0, 0, '{}'::jsonb, $6, now())`;

async function main(): Promise<void> {
  console.log("=== K4P şema seddi bekçisi ===\n");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const user = await c.query<{ id: string }>(`SELECT id FROM users ORDER BY "createdAt" LIMIT 1`);
    if (!user.rows[0]) throw new Error("Fikstür eksik: kullanıcı yok (npm run seed)");
    const userId = user.rows[0].id;

    const itemId = randomUUID();
    await c.query(
      `INSERT INTO items (id, code, name, "itemType", "updatedAt") VALUES ($1, $2, $3, 'FABRIC', now())`,
      [itemId, `K4P-${itemId.slice(0, 8)}`, `K4P sed bekçisi ${itemId.slice(0, 8)}`],
    );
    const rollId = randomUUID();
    await c.query(
      `INSERT INTO rolls (id, "itemId", "initialQty", "currentQty", "updatedAt") VALUES ($1, $2, 100, 100, now())`,
      [rollId, itemId],
    );

    // ── §1 ─────────────────────────────────────────────────────────────────
    console.log("── §1 PROCESS metre garantisi ──");
    expectReject("§1 PROCESS satırı metresiz reddedilir",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, null, "PROCESS", null, null, false]),
      "23514", "roll_errors_meter_ck");
    expectAccept("§1 PROCESS satırı metreli yazılır (kontrol)",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, 12.5, "PROCESS", null, null, false]));

    // Muayene belgesi — §2 satırlarının bağlanacağı ebeveyn.
    const inspA = randomUUID();
    expectAccept("§2 ön koşul: RAW muayene belgesi yazılır",
      await attempt(c, INSERT_INSPECTION, [inspA, rollId, "RAW", 150, "ITEM_CARD", userId]));

    // ── §2 ─────────────────────────────────────────────────────────────────
    console.log("\n── §2 INSPECTION satırı seddi ──");
    expectReject("§2 INSPECTION satırı belgesiz (inspectionId NULL) reddedilir",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, null, "INSPECTION", 2, null, false]),
      "23514", "roll_errors_inspection_ck");
    expectReject("§2 INSPECTION satırı isProcessed=true reddedilir",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, null, "INSPECTION", 2, inspA, true]),
      "23514", "roll_errors_inspection_ck");
    expectReject("§2 INSPECTION satırı puansız reddedilir",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, 3, "INSPECTION", null, inspA, false]),
      "23514", "roll_errors_inspection_ck");
    expectReject("§2 points=5 reddedilir (tek hata ≤ 4)",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, 3, "INSPECTION", 5, inspA, false]),
      "23514", "roll_errors_points_ck");
    expectAccept("§2 metresiz INSPECTION satırı (konumsuz hata) yazılır",
      await attempt(c, INSERT_ERROR, [randomUUID(), rollId, null, "INSPECTION", 4, inspA, false]));
    // Mükerrer seddi yalnız PROCESS'e: revizyon aynı (top, metre, tür) üçlüsünü yeniden yazar.
    const dt = await c.query<{ id: string }>(`SELECT id FROM defect_types ORDER BY code LIMIT 1`);
    if (dt.rows[0]) {
      const dup = `INSERT INTO roll_errors (id, "rollId", "startMeter", "defectTypeId", origin, points, "inspectionId", "updatedAt")
        VALUES ($1, $2, 40, $3, $4::"RollErrorOrigin", $5, $6, now())`;
      await attempt(c, dup, [randomUUID(), rollId, dt.rows[0].id, "INSPECTION", 1, inspA]);
      expectAccept("§2 aynı (top, metre, tür) ikinci INSPECTION satırı mükerrer seddine takılmaz",
        await attempt(c, dup, [randomUUID(), rollId, dt.rows[0].id, "INSPECTION", 1, inspA]));
      await attempt(c, dup, [randomUUID(), rollId, dt.rows[0].id, "PROCESS", null, null]);
      expectReject("§2 aynı (top, metre, tür) ikinci PROCESS satırı mükerrer seddine takılır",
        await attempt(c, dup, [randomUUID(), rollId, dt.rows[0].id, "PROCESS", null, null]),
        "23505", "roll_errors_roll_meter_defect_uq");
    } else {
      check("§2 mükerrer seddi ölçümü için hata tipi fikstürü", false, "defect_types boş (npm run seed)");
    }

    // ── §3 ─────────────────────────────────────────────────────────────────
    console.log("\n── §3 tek aktif muayene ──");
    expectReject("§3 aynı (top, RAW) ikinci aktif muayene reddedilir",
      await attempt(c, INSERT_INSPECTION, [randomUUID(), rollId, "RAW", 150, "ITEM_CARD", userId]),
      "23505", "roll_inspections_one_active_uq");
    expectAccept("§3 aynı top FINAL fazı ayrı aktif muayene alır",
      await attempt(c, INSERT_INSPECTION, [randomUUID(), rollId, "FINAL", 150, "ITEM_CARD", userId]));
    await c.query(`UPDATE roll_inspections SET "supersededAt" = now(), "supersededById" = $2 WHERE id = $1`, [inspA, userId]);
    expectAccept("§3 eski belge supersededAt alınca yeni RAW revizyonu yazılır",
      await attempt(c,
        `INSERT INTO roll_inspections (id, "rollId", phase, revision, "supersedesId", "inspectedLengthM", "widthSource",
           "totalPoints", "defectCount", "unplacedDefectCount", "ruleSnapshot", "inspectedById", "updatedAt")
         VALUES ($1, $2, 'RAW', 2, $3, 100, 'UNKNOWN', 0, 0, 0, '{}'::jsonb, $4, now())`,
        [randomUUID(), rollId, inspA, userId]));
    expectReject("§3 hem revize hem iptal damgalı belge reddedilir",
      await attempt(c, `UPDATE roll_inspections SET "voidedAt" = now() WHERE id = $1`, [inspA]),
      "23514", "roll_inspections_stamp_ck");

    // ── §4 ─────────────────────────────────────────────────────────────────
    console.log("\n── §4 en kaynağı ↔ en ──");
    const roll2 = randomUUID();
    await c.query(
      `INSERT INTO rolls (id, "itemId", "initialQty", "currentQty", "updatedAt") VALUES ($1, $2, 50, 50, now())`,
      [roll2, itemId],
    );
    expectReject("§4 widthSource=UNKNOWN iken widthCm dolu reddedilir",
      await attempt(c, INSERT_INSPECTION, [randomUUID(), roll2, "RAW", 150, "UNKNOWN", userId]),
      "23514", "roll_inspections_width_ck");
    expectReject("§4 widthSource=ITEM_CARD iken widthCm boş reddedilir",
      await attempt(c, INSERT_INSPECTION, [randomUUID(), roll2, "RAW", null, "ITEM_CARD", userId]),
      "23514", "roll_inspections_width_ck");

    // ── §5 ─────────────────────────────────────────────────────────────────
    console.log("\n── §5 tek aktif fabrika kural seti ──");
    const RULE = `INSERT INTO four_point_rule_sets (id, name, scope, "isActive", "updatedAt")
      VALUES ($1, $2, 'FACTORY', $3, now())`;
    // Kurulumda zaten aktif fabrika seti varsa ilk INSERT sedde takılır — ölçüm yine geçerli.
    await attempt(c, RULE, [randomUUID(), "K4P bekçi A", true]);
    expectReject("§5 ikinci aktif FACTORY kural seti reddedilir",
      await attempt(c, RULE, [randomUUID(), "K4P bekçi B", true]),
      "23505", "four_point_rule_sets_one_factory_uq");
    expectAccept("§5 pasif ikinci FACTORY seti yazılır (sed yalnız aktife)",
      await attempt(c, RULE, [randomUUID(), "K4P bekçi C", false]));
    expectReject("§5 FACTORY setine müşteri bağı reddedilir",
      await attempt(c,
        `INSERT INTO four_point_rule_sets (id, name, scope, "customerId", "isActive", "updatedAt")
         VALUES ($1, 'K4P bekçi D', 'FACTORY', (SELECT id FROM customers LIMIT 1), false, now())`,
        [randomUUID()]),
      "23514", "four_point_rule_sets_scope_ck");

    // ── §6 ─────────────────────────────────────────────────────────────────
    console.log("\n── §6 sabit puan ──");
    const dtId = randomUUID();
    expectReject("§6 DefectType.fixedPoints=0 reddedilir",
      await attempt(c,
        `INSERT INTO defect_types (id, code, name, "fixedPoints", "updatedAt") VALUES ($1, $2, $3, 0, now())`,
        [dtId, `K4P${dtId.slice(0, 6)}`, `K4P sabit ${dtId.slice(0, 8)}`]),
      "23514", "defect_types_fixed_points_ck");
    expectAccept("§6 DefectType.fixedPoints=4 yazılır (kontrol)",
      await attempt(c,
        `INSERT INTO defect_types (id, code, name, "fixedPoints", "updatedAt") VALUES ($1, $2, $3, 4, now())`,
        [dtId, `K4P${dtId.slice(0, 6)}`, `K4P sabit ${dtId.slice(0, 8)}`]));
    expectReject("§6 Item.widthCm=0 reddedilir",
      await attempt(c, `UPDATE items SET "widthCm" = 0 WHERE id = $1`, [itemId]),
      "23514", "items_width_cm_ck");
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    c.release();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("❌ beklenmeyen hata:", e);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
