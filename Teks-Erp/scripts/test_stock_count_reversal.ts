// =============================================================================
// BEKÇİ — SAYIM STORNOSU (tamamlanmış sayımın fark fişi tek belgede geri alınır)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_count_reversal
// =============================================================================
// NEDEN: Tamamlanmış sayım terminaldi; yanlış "bulunamadı" işareti N topu iptal
// ediyordu ve tek çıkış top-top elle geri almaydı (o yol depo/sapma defterine
// ters satır yazmıyor). Storno ileri kaydı DEĞİŞTİRMEDEN karşı satır yazmalı.
//
// ÖLÇÜLENLER
//   §1 İleri bağlar: sayımın CANCEL satırı `stockCountId`, sapması `sourceRefId` taşır
//   §2 Önizleme: her top hedef rafıyla, iplik farkı ters yönüyle, engel yok
//   §3 ⭐ Storno: toplar ÖNCEKİ rafına · CANCEL satırı DURUR + CANCEL_REVERSAL doğar ·
//      sapma satırı DURUR + reversedAt · iplik net ters ADJUST · sayım satırları
//      değişmez · sayım COMPLETED + damga · tutanak VOIDED
//   §4 İkinci storno 409; önizleme "zaten stornolanmış" der
//   §5 ⭐ LIFO: sonraki tamamlanmış sayım varken eskisi 409 ve damga geri sarılır;
//      sıra korunursa ikisi de stornolanır (eski bağsız sapma metinle bulunur)
//   §6 ⭐ HEP-YA-HİÇ: tek topu elle geri alınmış sayım 409, diğer top İPTAL KALIR,
//      hiçbir ters satır yazılmaz
//   §7 Kaynak: iptal metni tek kaynaktan; storno servisinde defter silme yok;
//      rota iki izni birden ister
// =============================================================================
import { ItemType, ItemUnit, PrintedDocStatus, PrintedDocType, RollStatus, StockCountLineKind, WarehouseEventType, YarnMovementKind } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { stockCountService } from "../src/services/stock-count.service";
import { stockCountReversalService } from "../src/services/stock-count-reversal.service";
import { yarnService } from "../src/services/yarn.service";
import { AppError } from "../src/utils/app-error";
import { ensureIplikModuluAcik } from "./fixture-module-flags";

let modulGeriAl: (() => Promise<void>) | null = null;
const inventory = new InventoryService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-SSTR-${Date.now()}`;
const warehouseIds: string[] = [];
const itemIds: string[] = [];
const rollIds: string[] = [];

function errOf(e: unknown): { status?: number; code?: string; message: string } {
  if (e instanceof AppError) return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code, message: e.message };
  return { message: (e as Error).message };
}
async function expectErr(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return errOf(e);
  }
}

async function makeRoll(warehouseId: string, itemId: string, qty: number, status: RollStatus): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId, initialQty: qty }, undefined, undefined, false, { warehouseId, forcedStatus: status });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

/** Sayım aç → verilen topları eksik işaretle, kalanları bulundu → iplik sayılanını yaz → tamamla. */
async function runCount(warehouseId: string, missing: string[], yarnCounted?: { itemId: string; qty: number }): Promise<{ id: string; countNo: string }> {
  const created = await stockCountService.create({ warehouseId });
  const { id, countNo } = created.data as { id: string; countNo: string };
  const lines = await prisma.stockCountLine.findMany({ where: { stockCountId: id }, select: { id: true, kind: true, rollId: true, itemId: true } });
  for (const l of lines) {
    if (l.kind === StockCountLineKind.ROLL) {
      await stockCountService.markLine({ stockCountId: id, lineId: l.id, found: !missing.includes(l.rollId as string) });
    } else if (yarnCounted && l.itemId === yarnCounted.itemId) {
      await stockCountService.markLine({ stockCountId: id, lineId: l.id, countedQty: yarnCounted.qty });
    }
  }
  await stockCountService.complete(id);
  return { id, countNo };
}

async function balance(itemId: string, warehouseId: string): Promise<number> {
  const s = await prisma.yarnStock.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId } }, select: { balanceKg: true } });
  return Number(s?.balanceKg ?? 0);
}

async function main(): Promise<void> {
  modulGeriAl = await ensureIplikModuluAcik();
  console.log("\n=== Sayım stornosu ===\n");
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-A`, name: `${TAG} Depo` }, select: { id: true } });
  warehouseIds.push(wh.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} İplik`, itemType: ItemType.YARN, unit: ItemUnit.KG }, select: { id: true } });
  itemIds.push(fabric.id, yarn.id);
  const r1 = await makeRoll(wh.id, fabric.id, 100, RollStatus.WAREHOUSE);
  const r2 = await makeRoll(wh.id, fabric.id, 50, RollStatus.A1_STOCK);
  const r3 = await makeRoll(wh.id, fabric.id, 70, RollStatus.WAREHOUSE);
  await yarnService.createMovement({ itemId: yarn.id, warehouseId: wh.id, kind: YarnMovementKind.IN, qtyKg: 500 });

  // §1
  const c1 = await runCount(wh.id, [r1, r2], { itemId: yarn.id, qty: 480 });
  const cancelRows = await prisma.warehouseMovement.findMany({ where: { rollId: { in: [r1, r2] }, eventType: WarehouseEventType.CANCEL } });
  const var1 = await prisma.rollVariance.findMany({ where: { rollId: { in: [r1, r2] } } });
  check("§1a Sayımın CANCEL satırları sayıma bağlı (stockCountId)", cancelRows.length === 2 && cancelRows.every((w) => w.stockCountId === c1.id));
  check("§1b Sapma satırları sayıma bağlı (sourceRefId)", var1.length === 2 && var1.every((v) => v.sourceRefId === c1.id));
  check("§1c İplik 500 → 480", (await balance(yarn.id, wh.id)) === 480);

  // §2
  const prev = (await stockCountReversalService.preview(c1.id)).data!;
  const t = (id: string) => prev.rolls.find((r) => r.rollId === id)?.targetStatus;
  check("§2a Önizleme engelsiz", prev.blockers.length === 0 && prev.rolls.every((r) => !r.blocker), JSON.stringify(prev.blockers));
  check("§2b Her top ÖNCEKİ rafına (WAREHOUSE / A1_STOCK)", t(r1) === RollStatus.WAREHOUSE && t(r2) === RollStatus.A1_STOCK);
  check("§2c İplik: ADJUST_IN 20 kg, bakiye 480 → 500", prev.yarn.length === 1 && prev.yarn[0]!.reversalKind === YarnMovementKind.ADJUST_IN && Number(prev.yarn[0]!.balanceAfterKg) === 500);

  // §3
  const linesBefore = await prisma.stockCountLine.findMany({ where: { stockCountId: c1.id }, select: { id: true, found: true, countedQty: true, outOfScopeReason: true, updatedAt: true }, orderBy: { id: "asc" } });
  await stockCountReversalService.reverse(c1.id, "yanlış eksik işareti");
  const rolls = await prisma.roll.findMany({ where: { id: { in: [r1, r2] } }, select: { id: true, status: true, cancelledAt: true, cancelReason: true, preCancelStatus: true, warehouseId: true } });
  const rr = (id: string) => rolls.find((r) => r.id === id)!;
  check("§3a Toplar önceki rafında, iptal alanları boş, deposu aynı", rr(r1).status === RollStatus.WAREHOUSE && rr(r2).status === RollStatus.A1_STOCK && rolls.every((r) => !r.cancelledAt && !r.cancelReason && !r.preCancelStatus && r.warehouseId === wh.id));
  const cancelAfter = await prisma.warehouseMovement.count({ where: { rollId: { in: [r1, r2] }, eventType: WarehouseEventType.CANCEL } });
  const reversals = await prisma.warehouseMovement.findMany({ where: { rollId: { in: [r1, r2] }, eventType: WarehouseEventType.CANCEL_REVERSAL } });
  check("§3b ⭐ CANCEL satırları DURUYOR", cancelAfter === 2, String(cancelAfter));
  check(
    "§3c ⭐ CANCEL_REVERSAL: top başına bir, hedef depo, sayım bağı, CANCEL ile aynı metraj",
    reversals.length === 2 && reversals.every((w) => w.toWarehouseId === wh.id && !w.fromWarehouseId && w.stockCountId === c1.id && Number(w.qty) === Number(cancelRows.find((c) => c.rollId === w.rollId)?.qty)),
  );
  const var1After = await prisma.rollVariance.findMany({ where: { id: { in: var1.map((v) => v.id) } } });
  check("§3d ⭐ Sapma satırları DURUYOR ve reversedAt dolu", var1After.length === 2 && var1After.every((v) => v.reversedAt != null));
  const ym = await prisma.yarnMovement.findMany({ where: { stockCountId: c1.id }, orderBy: { createdAt: "asc" } });
  check("§3e İplik: ileri ADJUST_OUT durur + ters ADJUST_IN 20 · bakiye 500", ym.length === 2 && ym[0]!.kind === YarnMovementKind.ADJUST_OUT && ym[1]!.kind === YarnMovementKind.ADJUST_IN && Number(ym[1]!.qtyKg) === 20 && (await balance(yarn.id, wh.id)) === 500);
  const linesAfter = await prisma.stockCountLine.findMany({ where: { stockCountId: c1.id }, select: { id: true, found: true, countedQty: true, outOfScopeReason: true, updatedAt: true }, orderBy: { id: "asc" } });
  check("§3f Sayım satırları DEĞİŞMEDİ", JSON.stringify(linesAfter) === JSON.stringify(linesBefore));
  const head = await prisma.stockCount.findUniqueOrThrow({ where: { id: c1.id } });
  check("§3g Sayım COMPLETED kaldı + storno damgası", head.status === "COMPLETED" && head.reversedAt != null && head.reverseReason === "yanlış eksik işareti");
  const doc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.STOCK_COUNT, sourceId: c1.id }, orderBy: { version: "desc" } });
  check("§3h Tutanak VOIDED, gerekçe 'Storno: …'", doc?.status === PrintedDocStatus.VOIDED && (doc?.voidReason ?? "").startsWith("Storno:"), `${doc?.status} ${doc?.voidReason}`);

  // §4
  const again = await expectErr(() => stockCountReversalService.reverse(c1.id, "ikinci kez"));
  check("§4a İkinci storno 409 STOCK_COUNT_NOT_REVERSIBLE", again?.status === 409 && again.code === "STOCK_COUNT_NOT_REVERSIBLE", JSON.stringify(again));
  const prevAgain = (await stockCountReversalService.preview(c1.id)).data!;
  check("§4b Önizleme 'zaten stornolanmış' der", prevAgain.blockers.some((b) => b.includes("zaten stornolanmış")));

  // §5 LIFO
  const c2 = await runCount(wh.id, [r3]);
  const c3 = await runCount(wh.id, [r1]);
  const lifo = await expectErr(() => stockCountReversalService.reverse(c2.id, "eski önce"));
  const c2Head = await prisma.stockCount.findUniqueOrThrow({ where: { id: c2.id } });
  check("§5a ⭐ Sonraki sayım varken eskisi 409 BLOCKED (sonraki sayım adıyla)", lifo?.status === 409 && lifo.code === "STOCK_COUNT_REVERSAL_BLOCKED" && lifo.message.includes(c3.countNo), lifo?.message);
  check("§5b Damga geri sarıldı", c2Head.reversedAt === null);
  // Eski (bağsız) sapma satırı: storno onu iptal metniyle bulmalı.
  await prisma.rollVariance.updateMany({ where: { rollId: r1, sourceRefId: c3.id }, data: { sourceRefId: null } });
  await stockCountReversalService.reverse(c3.id, "önce en son");
  await stockCountReversalService.reverse(c2.id, "sonra öncesi");
  const r13 = await prisma.roll.findMany({ where: { id: { in: [r1, r3] } }, select: { status: true } });
  check("§5c LIFO sırasıyla ikisi de stornolandı; bağsız sapma metinle bulundu", r13.every((r) => r.status === RollStatus.WAREHOUSE));

  // §6 HEP-YA-HİÇ
  const c4 = await runCount(wh.id, [r1, r2]);
  await inventory.restoreCancelledRoll(r1, undefined, { reason: "elle geri alındı" });
  const partial = await expectErr(() => stockCountReversalService.reverse(c4.id, "elle karışmış"));
  const r2State = await prisma.roll.findUniqueOrThrow({ where: { id: r2 }, select: { status: true } });
  const c4Rev = await prisma.warehouseMovement.count({ where: { stockCountId: c4.id, eventType: WarehouseEventType.CANCEL_REVERSAL } });
  const c4Head = await prisma.stockCount.findUniqueOrThrow({ where: { id: c4.id } });
  check("§6a ⭐ Elle geri alınmış topu olan sayım 409 BLOCKED", partial?.status === 409 && partial.code === "STOCK_COUNT_REVERSAL_BLOCKED", JSON.stringify(partial));
  check("§6b Diğer top İPTAL KALDI (kısmi storno yok)", r2State.status === RollStatus.CANCELLED);
  check("§6c Hiçbir ters satır yazılmadı + damga yok", c4Rev === 0 && c4Head.reversedAt === null);
  const prev4 = (await stockCountReversalService.preview(c4.id)).data!;
  check("§6d Önizleme engelli topu gerekçesiyle listeler", prev4.rolls.some((r) => r.rollId === r1 && (r.blocker ?? "").includes("iptali geri alınmış")));

  // §7
  const svc = readFileSync(join(__dirname, "../src/services/stock-count-reversal.service.ts"), "utf8");
  const countSvc = readFileSync(join(__dirname, "../src/services/stock-count.service.ts"), "utf8");
  const route = readFileSync(join(__dirname, "../src/routes/stock-count.routes.ts"), "utf8");
  check("§7a İptal metni tek kaynaktan (servislerde elle `sayımında bulunamadı` literali yok)", !/`\$\{[^}]+\} sayımında bulunamadı`/.test(countSvc.replace(/export function stockCountCancelReason[\s\S]*?\n\}/, "")) && !svc.includes("sayımında bulunamadı"));
  check("§7b Storno servisinde defter silme/güncelleme yok", !/(warehouseMovement|yarnMovement|rollVariance)\.delete|stockCountLine\.update/.test(svc));
  check("§7c Rota: reverse iki izni birden ister", /"\/:id\/reverse"[\s\S]{0,200}roll:manual-adjust[\s\S]{0,80}yarn:write/.test(route));
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    if (modulGeriAl) await modulGeriAl().catch((e: Error) => console.error("modül bayrakları geri yazılamadı:", e.message));
    try {
      const counts = await prisma.stockCount.findMany({ where: { warehouseId: { in: warehouseIds } }, select: { id: true } });
      const ids = counts.map((c) => c.id);
      if (ids.length) {
        await prisma.yarnMovement.deleteMany({ where: { stockCountId: { in: ids } } });
        await prisma.warehouseMovement.deleteMany({ where: { stockCountId: { in: ids } } });
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: ids } } });
        await prisma.stockCountLine.deleteMany({ where: { stockCountId: { in: ids } } });
        await prisma.stockCount.deleteMany({ where: { id: { in: ids } } });
      }
      if (rollIds.length) {
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (itemIds.length) {
        await prisma.yarnMovement.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.yarnStock.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      }
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
