// =============================================================================
// TeksERP - Ürün yaşam döngüsü GÖÇ SONDASI (URUN-YASAM-DONGUSU.md §7, §10.5)
// =============================================================================
// Canlı referans (D1) İKİ yerde yazılı: migration `20260925100000_urun_yasam_dongusu`
// backfill'inin SQL bloğu (bir kez, göçte) ve `item-lifecycle.helper` (her geçişte).
// İkisi aynı kartları saymazsa göç bir kartı yanlış duruma koyar: canlı referanslı kart
// ARCHIVED olur (D1 ihlali doğuştan) ya da referanssız kart PHASE_OUT'ta takılır.
//
// Ölçüm: migration dosyasındaki `-- D1-BASLA … -- D1-BITTI` bloğu AYNEN okunur ve DB'deki
// HER kart için SQL kümesi ↔ TS kümesi karşılaştırılır. Test DB'sinde fikstürle, prova
// DB'sinde (fabrika dökümü kopyası) gerçek veriyle koşar. Ek olarak göç SONRASI D1 sorgusu
// (Pasif + canlı referans) 0 ve CHECK seddi yerinde olmalı.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { ItemLifecycleStatus, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { InventoryService } from "../src/services/inventory.service";
import { countItemLiveRefs, totalLiveRefs } from "../src/services/helpers/item-lifecycle.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const MIGRATION = path.resolve(__dirname, "..", "prisma", "migrations", "20260925100000_urun_yasam_dongusu", "migration.sql");
const TAG = `TST-GS-${Date.now()}`;
const inventory = new InventoryService();
const itemIds: string[] = [];
const yarnStockIds: string[] = [];

function d1Block(): string {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const m = sql.match(/-- D1-BASLA[^\n]*\n([\s\S]*?)-- D1-BITTI/);
  if (!m) throw new Error("migration D1 bloğu bulunamadı (işaretler silinmiş olabilir)");
  return m[1]!;
}

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const wh = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!wh) throw new Error("Fikstür eksik: varsayılan depo (ensureDefaultWarehouse)");

  // Fikstür: her kartın canlılığı bilinen biçimde kurulur (SQL ↔ TS iki yönlü sınansın).
  const mk = async (s: string, t: "FABRIC" | "YARN" = "FABRIC") => {
    const r = await itemService.create({ name: `${TAG} ${s}`, itemType: t, unit: t === "YARN" ? "KG" : "MT" });
    const id = (r.data as { id: string }).id;
    itemIds.push(id);
    return id;
  };
  const canliTop = await mk("CANLI TOP");
  await inventory.createInitialEntry({ itemId: canliTop, initialQty: 30 }, admin.id);
  const oluTop = await mk("OLU TOP");
  const olu = await inventory.createInitialEntry({ itemId: oluTop, initialQty: 30 }, admin.id);
  await prisma.roll.update({ where: { id: (olu.data as { id: string }).id }, data: { status: RollStatus.SHIPPED } });
  const iplikArti = await mk("IPLIK ARTI", "YARN");
  const iplikSifir = await mk("IPLIK SIFIR", "YARN");
  for (const [itemId, balanceKg] of [[iplikArti, 12], [iplikSifir, 0]] as const) {
    const ys = await prisma.yarnStock.create({ data: { itemId, warehouseId: wh.id, balanceKg }, select: { id: true } });
    yarnStockIds.push(ys.id);
  }
  const bos = await mk("BOS");
  await itemService.transitionLifecycle(bos, ItemLifecycleStatus.ARCHIVED, null, admin.id);

  console.log("=== 1) SQL (migration) ↔ TS (helper) aynı kartları sayıyor ===");
  const block = d1Block();
  check("D1 bloğu okundu ve sekiz tabloya bakıyor", ["rolls", "work_orders", "order_lines", "purchase_order_lines", "weaving_orders", "machine_runs", "subcontractor_dispatch_items", "yarn_stocks"].every((t) => block.includes(`"${t}"`)));
  const sqlRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT i.id::text AS id FROM "items" i WHERE (${block})`);
  const sqlSet = new Set(sqlRows.map((r) => r.id));
  const all = await prisma.item.findMany({ select: { id: true } });
  const tsSet = new Set<string>();
  // Göçten SONRA eklenen türler (kullanıcı kararıyla): göç SQL'i dondurulmuş tarihtir, onları
  // tanımaz. Kıyas bu türleri ADIYLA dışarıda tutar — sessiz fark değil, beyan.
  const GOC_SONRASI_TURLER = new Set<string>(["SWATCH"]); // S4, 2026-09-26: canlı kartela
  for (const it of all) {
    const sayim = (await countItemLiveRefs(prisma, it.id)).filter((c) => !GOC_SONRASI_TURLER.has(c.kind));
    if (totalLiveRefs(sayim) > 0) tsSet.add(it.id);
  }
  const sadeceSql = [...sqlSet].filter((x) => !tsSet.has(x));
  const sadeceTs = [...tsSet].filter((x) => !sqlSet.has(x));
  console.log(`   · ${all.length} kart tarandı · SQL ${sqlSet.size} canlı · TS ${tsSet.size} canlı`);
  check("yalnız SQL'in canlı saydığı kart yok", sadeceSql.length === 0, sadeceSql.slice(0, 5).join(","));
  check("yalnız TS'in canlı saydığı kart yok", sadeceTs.length === 0, sadeceTs.slice(0, 5).join(","));
  check("körlük zemini: fikstür canlıları iki tarafta da var", sqlSet.has(canliTop) && sqlSet.has(iplikArti) && tsSet.has(canliTop) && tsSet.has(iplikArti));
  check("körlük zemini: ölü top / sıfır bakiye / boş kart iki tarafta da CANLI DEĞİL", ![oluTop, iplikSifir, bos].some((x) => sqlSet.has(x) || tsSet.has(x)));

  console.log("\n=== 2) Göç sonrası değişmezler ===");
  const ihlal = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "items" i WHERE i."lifecycleStatus" = 'ARCHIVED' AND (${block})`,
  );
  check("Pasif kartta canlı referans 0 (D1)", ihlal[0]!.n === 0, `${ihlal[0]!.n}`);
  const ck = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'items_lifecycle_isactive_ck'`,
  );
  check("CHECK items_lifecycle_isactive_ck yerinde", ck[0]!.n === 1);
  const drift = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "items" WHERE ("lifecycleStatus" = 'ARCHIVED') <> (NOT "isActive")`,
  );
  check("isActive ↔ lifecycleStatus ayrışan kart 0", drift[0]!.n === 0, `${drift[0]!.n}`);
  const mezar = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "items" WHERE "mergedIntoId" IS NOT NULL AND "lifecycleStatus" <> 'ARCHIVED'`,
  );
  check("birleştirilmiş kart (mezar taşı) hep ARCHIVED", mezar[0]!.n === 0, `${mezar[0]!.n}`);
}

async function temizle(): Promise<void> {
  if (yarnStockIds.length > 0) await prisma.yarnStock.deleteMany({ where: { id: { in: yarnStockIds } } });
  if (itemIds.length === 0) return;
  const rolls = await prisma.roll.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } });
  const rollIds = rolls.map((x) => x.id);
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: itemIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle().catch((e) => console.error("temizlik:", (e as Error).message));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
