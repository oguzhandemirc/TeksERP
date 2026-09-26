// =============================================================================
// Bekçi: DEPO/STOK HAREKET DEFTERİNİN SAATİ — top başına kesin artan damga + tek sıra tanımı
// Çalıştır: npx tsx scripts/test_depo_defteri_damgasi.ts   (DB ister; tx GERİ ALINIR)
// =============================================================================
// Ölçüm (2026-09-26, sıcak tek tx, tek topta 300 ileri + bağlı ters): Prisma'nın ms'lik istemci
// saatiyle 599 komşudan 113–188'i AYNI ms'e düşüyordu ve `(createdAt, id)` sırasında ters satır
// ilerisinden ÖNCE görünüyordu (5–15 kez); okuyucular (depo hareket listesi, "en son terslenmemiş
// ileri satır" findFirst'leri) eşitlik bozucusuzdu. Kök kural: olay anını yazar verir.
//   §1 ⭐ saat: dört yazarın (`writeWarehouseMovement` · `writeWarehouseMovements` · `postStockMove` ·
//      `postStockMoves`) ve ters yolun (`reverseStockMove`) satırı, topun son (gelecekteki) satırından
//      SONRA damgalanır; aynı tx'te ardışık ileri + ters satırlar kesin artan
//   §2 ⭐ tek sıra tanımı (AST, DB'siz): `src/` altında `warehouseMovement.find*` sıralaması yalnız
//      `MOVEMENT_ASC`/`MOVEMENT_DESC`ten gelir — ya sabitin kendisi ya da öneki olan dizinin KUYRUĞU
//      (`[{ rollId }, ...MOVEMENT_ASC]`, top başına gruplama); elle `{ createdAt }` yok; sabitler eşitlikte
//      `id` taşır. Körlük zemini: ≥ 15 sıralı okuyucu.
// Gerekli mi: doğduğu gün tabandaki 17 okuyucunun 16'sı eşitlik bozucusuzdu; düzeltme aynı commit'te.
// Sonda (✓B3, bu commit; md5 ile geri alındı): ① `postStockMove` damgayı vermez → §1 ❌2 ·
// ② "son satır + 1 ms" terimi kalkar → §1 ❌6 · ③ bir okuyucu elle `{ createdAt: "desc" }`e döner → §2 ❌1.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import prisma, { pool } from "../src/lib/prisma";
import {
  MOVEMENT_ASC,
  MOVEMENT_DESC,
  postStockMove,
  postStockMoves,
  writeWarehouseMovement,
  writeWarehouseMovements,
} from "../src/services/helpers/warehouse-ledger.helper";
import { reverseStockMove } from "../src/services/helpers/warehouse-ledger-reverse.helper";
import { walkTs } from "./lib/ts-tarama";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const ROOT = join(__dirname, "..");
class GeriAl extends Error {}

async function saat(): Promise<void> {
  console.log("§1 ⭐ Saat — top başına kesin artan (tx geri alınır)");
  const TAG = `TST-DDD-${Date.now()}`;
  let olcum: { gelecek: number; yazar: Array<[string, number]>; ardisik: number[] } | null = null;
  await prisma.$transaction(async (tx) => {
    const wh = await tx.warehouse.findFirstOrThrow({ where: { isDefault: true }, select: { id: true } });
    const item = await tx.item.create({ data: { code: TAG, name: TAG, itemType: "FABRIC" }, select: { id: true } });
    const roll = await tx.roll.create({
      data: { barcode: TAG, itemId: item.id, initialQty: 100, currentQty: 100, status: "WAREHOUSE", warehouseId: wh.id, entrySource: "SUPPLIER_RECEIPT" },
      select: { id: true },
    });
    const [g] = await tx.$queryRaw<Array<{ at: Date }>>`
      INSERT INTO "warehouse_movements" ("id","rollId","eventType","toWarehouseId","qty","reasonCode","createdAt")
      VALUES (${randomUUID()}::uuid, ${roll.id}::uuid, 'ENTRY', ${wh.id}::uuid, 100, 'TST_FUTURE',
        now() + interval '1 hour') -- tz-ok: timestamptz, sonda satırı bilerek gelecekte
      RETURNING "createdAt" AS at`;
    const son = async (): Promise<number> =>
      (await tx.warehouseMovement.findFirstOrThrow({ where: { rollId: roll.id }, orderBy: MOVEMENT_DESC, select: { createdAt: true } })).createdAt.getTime();
    const yazar: Array<[string, number]> = [];
    const giris = { rollId: roll.id, eventType: "ENTRY" as const, qty: 1, toWarehouseId: wh.id };
    await writeWarehouseMovement(tx, giris, { onUnwritable: "throw" });
    yazar.push(["writeWarehouseMovement", await son()]);
    await writeWarehouseMovements(tx, [giris], { onUnwritable: "throw" });
    yazar.push(["writeWarehouseMovements", await son()]);
    const stok = { rollId: roll.id, eventType: "PRODUCTION" as const, qty: 100, from: { warehouseId: wh.id, status: "WAREHOUSE" as const }, to: { warehouseId: null, status: "IN_PRODUCTION" as const }, reasonCode: "PRODUCTION_ISSUE" };
    const ileri = await postStockMove(tx, stok);
    yazar.push(["postStockMove", await son()]);
    await reverseStockMove(tx, ileri, { reasonCode: "TST_REVERSE" });
    yazar.push(["reverseStockMove", await son()]);
    await postStockMoves(tx, [stok]);
    yazar.push(["postStockMoves", await son()]);
    for (let i = 0; i < 10; i++) {
      const id = await postStockMove(tx, stok);
      await reverseStockMove(tx, id, { reasonCode: "TST_REVERSE" });
    }
    const hepsi = await tx.warehouseMovement.findMany({ where: { rollId: roll.id }, orderBy: MOVEMENT_ASC, select: { createdAt: true } });
    olcum = { gelecek: g!.at.getTime(), yazar, ardisik: hepsi.map((r) => r.createdAt.getTime()) };
    throw new GeriAl();
  }).catch((e: unknown) => { if (!(e instanceof GeriAl)) throw e; });
  const o = olcum as { gelecek: number; yazar: Array<[string, number]>; ardisik: number[] } | null;
  if (!o) { check("ölçüm alındı", false); return; }
  let onceki = o.gelecek;
  for (const [ad, t] of o.yazar) {
    check(`${ad}: satır topun son satırından SONRA`, t > onceki, `${new Date(onceki).toISOString()} → ${new Date(t).toISOString()}`);
    onceki = t;
  }
  const a = o.ardisik;
  check(`aynı tx'te ${a.length} satır kesin artan (eşit an yok)`, a.every((t, i) => i === 0 || t > a[i - 1]!), `${new Set(a).size} farklı an`);
}

function tekSiraTanimi(): void {
  console.log("§2 ⭐ Tek sıra tanımı — okuyucular `MOVEMENT_ASC`/`MOVEMENT_DESC`");
  check("sabitler eşitlikte id taşır",
    JSON.stringify(MOVEMENT_ASC) === '[{"createdAt":"asc"},{"id":"asc"}]' && JSON.stringify(MOVEMENT_DESC) === '[{"createdAt":"desc"},{"id":"desc"}]');
  const sabit = new Set(["MOVEMENT_ASC", "MOVEMENT_DESC"]);
  const ihlal: string[] = [];
  let sirali = 0;
  for (const abs of walkTs(join(ROOT, "src"))) {
    const sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.Latest, true);
    const git = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && /^find/.test(n.expression.name.text)
        && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === "warehouseMovement") {
        const arg = n.arguments[0];
        const ob = arg && ts.isObjectLiteralExpression(arg)
          ? arg.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "orderBy")
          : undefined;
        if (ob) {
          sirali++;
          const ini = ob.initializer;
          const son = ts.isArrayLiteralExpression(ini) ? ini.elements[ini.elements.length - 1] : undefined;
          const kuyruk = !!son && ts.isSpreadElement(son) && ts.isIdentifier(son.expression) && sabit.has(son.expression.text)
            && ts.isArrayLiteralExpression(ini) && ini.elements.slice(0, -1).every((e) => !/createdAt|\bid\b/.test(e.getText()));
          if (!((ts.isIdentifier(ini) && sabit.has(ini.text)) || kuyruk)) {
            ihlal.push(`${relative(ROOT, abs)}:${sf.getLineAndCharacterOfPosition(ob.getStart()).line + 1} ${ob.initializer.getText().replace(/\s+/g, " ")}`);
          }
        }
      }
      ts.forEachChild(n, git);
    };
    git(sf);
  }
  check("körlük zemini: ≥ 15 sıralı okuyucu tarandı", sirali >= 15, `${sirali}`);
  check("elle sıralama yok (hepsi tek sıra tanımından)", ihlal.length === 0, ihlal.join(" · "));
}

async function main(): Promise<void> {
  tekSiraTanimi();
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("hedef DB fixture DB'si", false, engel); return; }
  await saat();
}

main()
  .catch((e: unknown) => {
    fail++;
    console.log(`  ❌ beklenmeyen hata — ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
