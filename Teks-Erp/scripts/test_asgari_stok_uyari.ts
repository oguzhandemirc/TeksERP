// =============================================================================
// ASGARİ STOK UYARISI BEKÇİSİ (iplik + sarf stok listeleri, 2026-11-25)
// =============================================================================
//   §1 tek yüklem `isBelowMinStock`: altı → evet · eşit/üstü → hayır · eşik boş → hayır · arşiv → hayır
//   §2 iplik stok listesi: satıra `minStockQty` + `belowMinStock` (KALEM toplamı, bütün depolar);
//      özet `belowMinItemCount` FACETED (onlyNonZero'dan bağımsız); `belowMin` seçilince liste aynı
//      where'den döner (sıfır bakiyeli satır dahil) → liste kalem sayısı = özet sayısı
//   §3 sarf stok listesi: aynı alanlar; `summary.belowMinCount` = `belowMin` listesinin satır sayısı;
//      eşik boş / eşitlik / arşiv uyarı üretmez; `itemId` süzgeci
//   §4 körlük zemini: ortamın bütününde de iplik `belowMin` listesinin kalem sayısı = özet sayısı
//
// NEGATİF SONDA — 2026-11-25 koşuldu (cp + geri alma):
//   `isBelowMinStock` `lt` → `lte` yapılınca §1b ❌ · §3b ❌ (eşitlik asgari altı sayıldı) ·
//   iplik listesinde `belowMin` dalı `where`e düşürülünce §2e ❌ (liste özetle ayrıştı)
// Koşum: npx tsx scripts/test_asgari_stok_uyari.ts
// =============================================================================
import { ItemLifecycleStatus, Prisma, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { itemService } from "../src/routes/item.routes";
import { yarnService } from "../src/services/yarn.service";
import { listConsumableStock } from "../src/services/consumable-stock.service";
import { isBelowMinStock } from "../src/services/helpers/min-stock.helper";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureIplikModuluAcik } from "./fixture-module-flags";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const D = (v: number | string) => new Prisma.Decimal(v);
const TAG = `TEST-ASG-${Date.now().toString(36).toUpperCase()}`;
const items: string[] = [];
const warehouses: string[] = [];
const consMoves: string[] = [];
let modulGeriAl: (() => Promise<void>) | null = null;
// Fikstür arşivi (items_lifecycle_isactive_ck: isActive yaşam döngüsünden türer).
const ARCHIVE = { lifecycleStatus: ItemLifecycleStatus.ARCHIVED, isActive: false };

async function main(): Promise<void> {
  console.log("\n=== Asgari stok uyarısı ===\n");

  // §1 — tek yüklem
  check("§1a altı → asgari altı", isBelowMinStock(D(9.999), D(10), false));
  check("§1b eşit → asgari altı DEĞİL", !isBelowMinStock(D(10), D(10), false));
  check("§1c üstü → değil", !isBelowMinStock(D(11), D(10), false));
  check("§1d eşik boş → uyarı yok", !isBelowMinStock(D(-5), null, false));
  check("§1e arşiv kart → uyarı yok", !isBelowMinStock(D(0), D(10), true));
  check("§1f eksi bakiye eşikli → asgari altı", isBelowMinStock(D(-1), D(10), false));

  modulGeriAl = await ensureIplikModuluAcik();
  const admin = await ensureTestAdmin();
  const mk = async (suffix: string, body: Record<string, unknown>): Promise<string> => {
    const res = (await itemService.create({ name: `${TAG} ${suffix}`, ...body }, admin.id, { notify: false })) as { data?: { id?: string } };
    const id = res.data?.id;
    if (!id) throw new Error(`kart doğmadı: ${suffix}`);
    items.push(id);
    return id;
  };

  // §2 — iplik
  const wh1 = await prisma.warehouse.create({ data: { code: `${TAG}-D1`, name: `${TAG} Depo 1` }, select: { id: true } });
  const wh2 = await prisma.warehouse.create({ data: { code: `${TAG}-D2`, name: `${TAG} Depo 2` }, select: { id: true } });
  warehouses.push(wh1.id, wh2.id);
  const y1 = await mk("Y1", { itemType: "YARN", unit: "KG", minStockQty: "100" }); // 60 + 30 = 90 < 100
  const y2 = await mk("Y2", { itemType: "YARN", unit: "KG", minStockQty: "100" }); // 150 ≥ 100
  const y3 = await mk("Y3", { itemType: "YARN", unit: "KG" }); // eşik yok
  const y4 = await mk("Y4", { itemType: "YARN", unit: "KG", minStockQty: "50" }); // 20 − 20 = 0 < 50
  const y5 = await mk("Y5", { itemType: "YARN", unit: "KG", minStockQty: "100" }); // 10 < 100 ama arşiv
  const mv = (itemId: string, warehouseId: string, kind: YarnMovementKind, qtyKg: number) =>
    yarnService.createMovement({ itemId, warehouseId, kind, qtyKg });
  await mv(y1, wh1.id, YarnMovementKind.IN, 60);
  await mv(y1, wh2.id, YarnMovementKind.IN, 30);
  await mv(y2, wh1.id, YarnMovementKind.IN, 150);
  await mv(y3, wh1.id, YarnMovementKind.IN, 5);
  await mv(y4, wh1.id, YarnMovementKind.IN, 20);
  await mv(y4, wh1.id, YarnMovementKind.OUT, 20);
  await mv(y5, wh1.id, YarnMovementKind.IN, 10);
  await prisma.item.update({ where: { id: y5 }, data: ARCHIVE });

  const yIds = [y1, y2, y3, y4, y5].join(",");
  const all = await yarnService.listStocks({ itemId: yIds, pageSize: 200 });
  const flag = new Map(all.data.map((r) => [`${r.item.id}|${r.warehouse.id}`, r.belowMinStock]));
  check("§2a Y1 her iki depo satırı asgari altı (kalem toplamı 90 < 100)", flag.get(`${y1}|${wh1.id}`) === true && flag.get(`${y1}|${wh2.id}`) === true);
  check("§2b Y2 (150 ≥ 100) · Y3 (eşik yok) · Y5 (arşiv) uyarısız",
    flag.get(`${y2}|${wh1.id}`) === false && flag.get(`${y3}|${wh1.id}`) === false && flag.get(`${y5}|${wh1.id}`) === false);
  check("§2c Y4 sıfır bakiye asgari altı", flag.get(`${y4}|${wh1.id}`) === true);
  const y1Row = all.data.find((r) => r.item.id === y1);
  const y3Row = all.data.find((r) => r.item.id === y3);
  check("§2d minStockQty satırda (Y1 '100.000', Y3 null)", y1Row?.minStockQty === "100.000" && y3Row?.minStockQty === null, `${y1Row?.minStockQty}/${y3Row?.minStockQty}`);
  check("§2d2 özet belowMinItemCount = 2", all.totals.belowMinItemCount === 2, String(all.totals.belowMinItemCount));

  const below = await yarnService.listStocks({ itemId: yIds, pageSize: 200, belowMin: true, onlyNonZero: true });
  const belowItems = new Set(below.data.map((r) => r.item.id));
  check("§2e belowMin listesi yalnız Y1 + Y4 (sıfır satır dahil, onlyNonZero uygulanmaz)",
    belowItems.size === 2 && belowItems.has(y1) && belowItems.has(y4) && below.pagination.total === 3, `${[...belowItems].length} kalem / ${below.pagination.total} satır`);
  check("§2f liste kalem sayısı = özet sayısı", belowItems.size === below.totals.belowMinItemCount);
  check("§2g liste toplamı aynı where'den (60 + 30 + 0 = 90)", D(below.totals.balanceKg).eq(90), below.totals.balanceKg);

  const nonZero = await yarnService.listStocks({ itemId: yIds, pageSize: 200, onlyNonZero: true });
  check("§2h onlyNonZero Y4 satırını gizler ama özet FACETED kalır (2)",
    !nonZero.data.some((r) => r.item.id === y4) && nonZero.totals.belowMinItemCount === 2);
  const wh2List = await yarnService.listStocks({ itemId: yIds, warehouseId: wh2.id, pageSize: 200 });
  check("§2i depo süzgecinde de kalem düzeyi (Y1 Depo 2 satırı 30 kg, işaretli)",
    wh2List.data.length === 1 && wh2List.data[0]?.belowMinStock === true && wh2List.totals.belowMinItemCount === 1);

  // §3 — sarf
  const c1 = await mk("C1", { itemType: "CONSUMABLE", unit: "ADET", minStockQty: "10" }); // 4 < 10
  const c2 = await mk("C2", { itemType: "CONSUMABLE", unit: "ADET", minStockQty: "10" }); // 10 = 10
  const c3 = await mk("C3", { itemType: "CONSUMABLE", unit: "ADET" }); // eşik yok, 0
  const c4 = await mk("C4", { itemType: "CONSUMABLE", unit: "KG", minStockQty: "5" }); // hareketsiz 0 < 5
  const c5 = await mk("C5", { itemType: "CONSUMABLE", unit: "ADET", minStockQty: "10" }); // 1 < 10 ama arşiv
  for (const [itemId, qty] of [[c1, 4], [c2, 10], [c5, 1]] as const) {
    const m = await prisma.consumableMovement.create({ data: { itemId, kind: "RECEIPT_IN", qty }, select: { id: true } });
    consMoves.push(m.id);
  }
  await prisma.item.update({ where: { id: c5 }, data: ARCHIVE });
  const cIds = [c1, c2, c3, c4, c5].join(",");
  const cl = await listConsumableStock({ itemId: cIds });
  const cf = new Map(cl.rows.map((r) => [r.itemId, r]));
  check("§3a C1 (4 < 10) ve C4 (hareketsiz 0 < 5) asgari altı", cf.get(c1)?.belowMinStock === true && cf.get(c4)?.belowMinStock === true);
  check("§3b C2 eşitlik asgari altı DEĞİL", cf.get(c2)?.belowMinStock === false);
  check("§3c C3 eşik yok · C5 arşiv → uyarısız", cf.get(c3)?.belowMinStock === false && cf.get(c5)?.belowMinStock === false && cf.get(c5)?.isActive === false);
  check("§3d minStockQty satırda (C1 '10.000', C3 null)", cf.get(c1)?.minStockQty === "10.000" && cf.get(c3)?.minStockQty === null);
  check("§3e itemId süzgeci yalnız fikstürü döner (5)", cl.rows.length === 5 && cl.summary.itemCount === 5, String(cl.rows.length));
  check("§3f özet belowMinCount = 2", cl.summary.belowMinCount === 2, String(cl.summary.belowMinCount));
  const cb = await listConsumableStock({ itemId: cIds, belowMin: true });
  check("§3g belowMin listesi = özet (2 satır, C1 + C4)",
    cb.rows.length === 2 && cb.summary.itemCount === 2 && cb.summary.belowMinCount === 2 && cb.rows.every((r) => r.belowMinStock));
  const cOne = await listConsumableStock({ itemId: c1 });
  check("§3h tek itemId (ürün penceresi yolu)", cOne.rows.length === 1 && cOne.rows[0]?.belowMinStock === true && cOne.rows[0]?.balance === "4.000");

  // §4 — körlük zemini: ortamın bütününde liste ↔ özet
  const g = await yarnService.listStocks({ belowMin: true, pageSize: 200 });
  if (g.pagination.total <= 200) {
    const gi = new Set(g.data.map((r) => r.item.id));
    check("§4a bütün ortamda iplik belowMin kalem sayısı = özet", gi.size === g.totals.belowMinItemCount && gi.size >= 2, `${gi.size}/${g.totals.belowMinItemCount}`);
  } else console.log("⏭ §4a ortamda 200'den çok asgari altı satır — sayfa sınırı, atlandı");
  const gc = await listConsumableStock({ belowMin: true });
  const gcAll = await listConsumableStock({});
  check("§4b bütün ortamda sarf belowMin satırı = özet", gc.rows.length === gcAll.summary.belowMinCount && gc.rows.length >= 2);
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    try {
      if (items.length) {
        await prisma.yarnMovement.deleteMany({ where: { itemId: { in: items } } });
        await prisma.yarnStock.deleteMany({ where: { itemId: { in: items } } });
      }
      if (consMoves.length) await prisma.consumableMovement.deleteMany({ where: { id: { in: consMoves } } });
      if (items.length) await prisma.item.deleteMany({ where: { id: { in: items } } });
      if (warehouses.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouses } } });
      if (modulGeriAl) await modulGeriAl();
    } catch (e) {
      console.error("temizlik hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
