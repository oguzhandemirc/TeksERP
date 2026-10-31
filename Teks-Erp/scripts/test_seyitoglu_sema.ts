// =============================================================================
// SEYİTOĞLU ŞEMA PAKETİ (SY-MIG: MİG-1 · MİG-2a · MİG-2b · MİG-3) — DB SEDLERİNİN DAVRANIŞI
// -----------------------------------------------------------------------------
// Bu dilim yalnız şema yazar; davranış A2/D2/K1 dilimlerinindir. Burada ölçülen tek şey
// migration'ların kurduğu SEDLERİN gerçekten ısırdığı ve eski tekilliğin `recipeId IS NULL`
// satırlarda AYNEN korunduğudur (Adnan Şahin / dokuma varsayılanı bayt-aynı).
// Tüm yazımlar TEK tx içinde, her sonda SAVEPOINT'le; sonda tx geri alınır (kalıntı yok).
// Tasarım: ~/.tekserp/yeni-dokuma-fabrikasi/TASARIM-2026-10-31.md §2.4, §3.4, §4.4, §5.4, §7.4, §12.4, §16.2.
// Koşum: npx tsx scripts/test_seyitoglu_sema.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const ZERO_HASH = "a".repeat(64);
class Rollback extends Error {}

function sqlState(e: unknown): string {
  const meta = (e as { meta?: { code?: string } }).meta;
  if (meta?.code) return meta.code;
  const m = /\b(23\d{3})\b/.exec(String((e as Error).message ?? e));
  return m ? m[1] : "?";
}

/** SAVEPOINT içinde koşar; beklenen SQLSTATE (null = başarı) ile karşılaştırır. */
async function probe(tx: Prisma.TransactionClient, label: string, sql: string, expected: string | null): Promise<void> {
  await tx.$executeRawUnsafe("SAVEPOINT p");
  try {
    await tx.$executeRawUnsafe(sql);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT p");
    check(label, expected === null, expected ? `beklenen ${expected}, yazım GEÇTİ` : "yazıldı");
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT p");
    const code = sqlState(e);
    check(label, expected === code, expected ? `SQLSTATE ${code}` : `beklenmeyen hata ${code}`);
  }
}

async function scalar<T>(tx: Prisma.TransactionClient, sql: string): Promise<T> {
  const rows = await tx.$queryRawUnsafe<Array<{ v: T }>>(sql);
  return rows[0]?.v as T;
}

async function main(): Promise<void> {
  console.log("\n=== SEYİTOĞLU şema paketi — DB sedleri ===");
  const tag = randomUUID().slice(0, 8).toUpperCase();
  const yarn = randomUUID();
  const fabric = randomUUID();
  const warp = randomUUID();
  const recipe1 = randomUUID();
  const recipe2 = randomUUID();
  const params = randomUUID();
  const list = randomUUID();

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO items (id, code, name, "itemType", "updatedAt") VALUES
           ('${yarn}', 'TEST-SYY-${tag}', 'TEST SY iplik ${tag}', 'YARN', now()),
           ('${fabric}', 'TEST-SYF-${tag}', 'TEST SY kumas ${tag}', 'FABRIC', now())`
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO warp_specs (id, code, name, "yarnItemId", "endsCount", "updatedAt")
           VALUES ('${warp}', 'TEST-SYW-${tag}', 'TEST SY cozgu ${tag}', '${yarn}', 5250, now())`
        );

        console.log("\n── §1 MİG-1 desen kartı / varyant / çözgü fire payı ──");
        const wasteSql = (v: string) => `UPDATE warp_specs SET "wastePct" = ${v} WHERE id = '${warp}'`;
        await probe(tx, "§1a wastePct = 100 → CHECK 23514", wasteSql("100"), "23514");
        await probe(tx, "§1b wastePct = -0.01 → CHECK 23514", wasteSql("-0.01"), "23514");
        await probe(tx, "§1c wastePct = 99.99 yazılır", wasteSql("99.99"), null);
        await probe(tx, "§1d wastePct = NULL (bugünkü) yazılır", wasteSql("NULL"), null);

        const design = (id: string, code: string, name: string, frames: string) =>
          `INSERT INTO weave_designs (id, code, name, kind, "frameCount", "updatedAt")
           VALUES ('${id}', '${code}', '${name}', 'LENO', ${frames}, now())`;
        await probe(tx, "§1e frameCount = 33 → CHECK 23514", design(randomUUID(), `D1-${tag}`, `Desen A ${tag}`, "33"), "23514");
        await probe(tx, "§1f frameCount = 32 yazılır", design(randomUUID(), `D2-${tag}`, `Desen A ${tag}`, "32"), null);
        await probe(tx, "§1g AD SEDDİ: aynı katlanmış ad (farklı kod) → 23505", design(randomUUID(), `D3-${tag}`, `DESEN a ${tag}`, "NULL"), "23505");

        const recipe = (id: string, code: string, variant: string) =>
          `INSERT INTO product_recipes (id, code, name, "itemId", "variantCode", "updatedAt")
           VALUES ('${id}', '${code}', 'TEST SY varyant ${code}', '${fabric}', ${variant}, now())`;
        await probe(tx, "§1h varyant V01 yazılır", recipe(recipe1, `R1-${tag}`, "'V01'"), null);
        await probe(tx, "§1i aynı ürüne ikinci V01 → kısmi unique 23505", recipe(randomUUID(), `R2-${tag}`, "'V01'"), "23505");
        await probe(tx, "§1j varyant V02 yazılır", recipe(recipe2, `R3-${tag}`, "'V02'"), null);
        await probe(tx, "§1k kodsuz reçete ×2 serbest (1)", recipe(randomUUID(), `R4-${tag}`, "NULL"), null);
        await probe(tx, "§1l kodsuz reçete ×2 serbest (2)", recipe(randomUUID(), `R5-${tag}`, "NULL"), null);

        await probe(
          tx,
          "§1m ek çözgü katmanı yazılır (beamMode verilmeden)",
          `INSERT INTO item_warp_layers (id, "itemId", "warpSpecId", role, "sortOrder", "updatedAt")
           VALUES ('${randomUUID()}', '${fabric}', '${warp}', 'LENO', 0, now())`,
          null
        );
        const mode = await scalar<string>(tx, `SELECT "beamMode"::text AS v FROM item_warp_layers WHERE "itemId" = '${fabric}'`);
        check("§1n beamMode varsayılanı SEPARATE_BEAM (bugünkü ayrı levent)", mode === "SEPARATE_BEAM", String(mode));

        console.log("\n── §2 MİG-2a enum değerleri ──");
        const enumHas = (t: string, v: string) =>
          scalar<boolean>(tx, `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = '${t}' AND e.enumlabel = '${v}') AS v`);
        check("§2a CostComponent.WEAVING_PICK", await enumHas("CostComponent", "WEAVING_PICK"));
        check("§2b CostComponent.PROCESS", await enumHas("CostComponent", "PROCESS"));
        check("§2c FinishingBasis.KG", await enumHas("FinishingBasis", "KG"));

        console.log("\n── §3 MİG-2b atkı ücreti çifti + aktif sürüm tekilliği ──");
        await tx.$executeRawUnsafe(`INSERT INTO cost_structures (id, "itemId", "updatedAt") VALUES ('${randomUUID()}', '${fabric}', now())`);
        const pick = (rate: string, cur: string) =>
          `UPDATE cost_structures SET "loomPickRate" = ${rate}, "loomPickCurrency" = ${cur} WHERE "itemId" = '${fabric}'`;
        await probe(tx, "§3a ücret dolu, döviz boş → CHECK 23514", pick("0.02", "NULL"), "23514");
        await probe(tx, "§3b döviz dolu, ücret boş → CHECK 23514", pick("NULL", "'USD'"), "23514");
        await probe(tx, "§3c negatif ücret → CHECK 23514", pick("-0.01", "'USD'"), "23514");
        await probe(tx, "§3d ikisi dolu (0,02 USD) yazılır", pick("0.02", "'USD'"), null);
        await probe(tx, "§3e ikisi boş (bugünkü) yazılır", pick("NULL", "NULL"), null);

        await tx.$executeRawUnsafe(
          `INSERT INTO cost_parameter_sets (id, "versionNo", status, "activatedAt", "supersededAt", "loomHourRateTry",
             "laborHourRateTry", "loomsPerOperator", "energyKwhPerLoomHour", "energyPriceTryPerKwh", "overheadPct",
             "defaultWarpWastePct", "defaultWeftWastePct", "defaultFabricWastePct", "defaultEfficiencyPct",
             "beamPrepCostTry", "defaultBeamLengthM", "weftSelvedgeAllowanceCm", "defaultMarkupPct", "updatedAt")
           VALUES ('${params}', ${900000 + Math.floor(Math.random() * 99999)}, 'SUPERSEDED', now(), now(), 1, 1, 1, 1, 1, 1, 1, 1, 1, 90, 0, 1000, 2, 10, now())`
        );
        const defPick = (rate: string, cur: string) =>
          `UPDATE cost_parameter_sets SET "defaultLoomPickRate" = ${rate}, "defaultLoomPickCurrency" = ${cur} WHERE id = '${params}'`;
        await probe(tx, "§3f parametre seti: ücret dolu, döviz boş → CHECK 23514", defPick("0.02", "NULL"), "23514");
        await probe(tx, "§3g parametre seti: ikisi dolu yazılır", defPick("0.02", "'USD'"), null);

        const version = (no: number, recipeId: string | null, loom: string) =>
          `INSERT INTO standard_cost_versions (id, "itemId", "versionNo", status, "parameterSetId", "rawCostPerMTry",
             "totalCostPerMTry", "warpKgPerM", "weftKgPerM", "loomMPerHour", "fxRates", "inputSnapshot", "inputHash",
             warnings, "recipeId", "updatedAt")
           VALUES ('${randomUUID()}', '${fabric}', ${no}, 'ACTIVE', '${params}', 1, 1, 0.1, 0.1, ${loom}, '{}', '{}',
             '${ZERO_HASH}', '[]', ${recipeId ? `'${recipeId}'` : "NULL"}, now())`;
        await probe(tx, "§3h desen geneli ACTIVE v1 yazılır", version(1, null, "12.5"), null);
        await probe(tx, "§3i desen geneli İKİNCİ ACTIVE → 23505 (eski tekillik aynen)", version(2, null, "12.5"), "23505");
        await probe(tx, "§3j varyant V01 ACTIVE yazılır (loomMPerHour NULL)", version(3, recipe1, "NULL"), null);
        await probe(tx, "§3k varyant V01 İKİNCİ ACTIVE → 23505", version(4, recipe1, "12.5"), "23505");
        await probe(tx, "§3l varyant V02 ACTIVE yazılır", version(5, recipe2, "12.5"), null);

        console.log("\n── §4 MİG-3 fiyat listesi tekilliği (varyant genişlemesi) ──");
        await tx.$executeRawUnsafe(
          `INSERT INTO price_lists (id, "listNo", "clientToken", name, currency, "updatedAt")
           VALUES ('${list}', 'TEST-SYL-${tag}', '${randomUUID()}', 'TEST SY liste ${tag}', 'USD', now())`
        );
        const line = (no: number, recipeId: string | null) =>
          `INSERT INTO price_list_lines (id, "priceListId", "lineNo", "itemId", "recipeId", "unitPrice", "updatedAt")
           VALUES ('${randomUUID()}', '${list}', ${no}, '${fabric}', ${recipeId ? `'${recipeId}'` : "NULL"}, 1, now())`;
        await probe(tx, "§4a varyantsız satır yazılır", line(1, null), null);
        await probe(tx, "§4b aynı ürün+renk varyantsız İKİNCİ satır → 23505 (eski tekillik aynen)", line(2, null), "23505");
        await probe(tx, "§4c aynı ürün V01 satırı yazılır", line(3, recipe1), null);
        await probe(tx, "§4d aynı ürün V01 İKİNCİ satır → 23505", line(4, recipe1), "23505");

        throw new Rollback();
      },
      { timeout: 60_000 }
    );
  } catch (e) {
    if (!(e instanceof Rollback)) {
      check("tx beklenmeyen hatayla düştü", false, String((e as Error).message ?? e).slice(0, 300));
    }
  }
  const leftover = await prisma.item.count({ where: { code: { in: [`TEST-SYY-${tag}`, `TEST-SYF-${tag}`] } } });
  check("§9 geri alındı — kalıntı yok", leftover === 0, `kalan ${leftover}`);

  console.log(`\n=== Sonuç: ${passed} geçti, ${failed} başarısız ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
