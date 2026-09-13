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
//   §6 ⭐ ÇIKIŞ DALLARI: elle geri alınmış top stornoyu BLOKLAMAZ — statüsüne
//      dokunulmaz, yalnız defter karşılığı yazılır (LEDGER_ONLY); ters satırı
//      zaten yazılmış topta satır TEKRAR YAZILMAZ, yalnız sapma damgalanır.
//      Ters satırın GİRİŞ UCU ileri satırın kanıtından gelir (topun bugünkü
//      statüsünden DEĞİL); kanıt yoksa uç uydurulmaz, işlem 409'da durur
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
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { ensureIplikModuluAcik } from "./fixture-module-flags";
import { ensureTestAdmin } from "./fixture-test-user";

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
/** Aktör ölçülür: damga `reversedById` boş kalırsa "kim geri aldı" cevapsız olur. */
let ADMIN = "";

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
  ADMIN = (await ensureTestAdmin()).id;
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
  await stockCountReversalService.reverse(c1.id, "yanlış eksik işareti", ADMIN);
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
  // ⭐ İleri satır STOK DEFTERİ sözleşmesini taşır: çıkış ucu + statü + sebep kodu.
  // `fromStatus` boş olsaydı ters kaydın yönü aynalanamazdı.
  check(
    "§3c2 ⭐ İleri CANCEL satırı fromStatus + reasonCode taşıyor",
    cancelRows.length === 2 &&
      cancelRows.every(
        (w) => w.fromWarehouseId === wh.id && w.fromStatus != null && w.reasonCode === STOCK_MOVE_REASON.STOCK_COUNT,
      ),
    cancelRows.map((w) => `${String(w.fromStatus)}/${String(w.reasonCode)}`).join(" "),
  );
  // ⭐ TESPİT BAĞDAN: her ters satır KENDİ ileri satırını işaret eder, yönü aynalar.
  check(
    "§3c3 ⭐ Ters satır reversesMovementId ile ileri CANCEL'a bağlı + toStatus = ileri fromStatus",
    reversals.length === 2 &&
      reversals.every((w) => {
        const fwd = cancelRows.find((c) => c.id === w.reversesMovementId);
        return Boolean(fwd) && fwd!.rollId === w.rollId && w.toStatus === fwd!.fromStatus;
      }),
    reversals.map((w) => `${w.rollId.slice(0, 6)}→${String(w.reversesMovementId).slice(0, 6)}`).join(" "),
  );
  const var1After = await prisma.rollVariance.findMany({ where: { id: { in: var1.map((v) => v.id) } } });
  check("§3d ⭐ Sapma satırları DURUYOR ve reversedAt dolu", var1After.length === 2 && var1After.every((v) => v.reversedAt != null));
  const ym = await prisma.yarnMovement.findMany({ where: { stockCountId: c1.id }, orderBy: { createdAt: "asc" } });
  check("§3e İplik: ileri ADJUST_OUT durur + ters ADJUST_IN 20 · bakiye 500", ym.length === 2 && ym[0]!.kind === YarnMovementKind.ADJUST_OUT && ym[1]!.kind === YarnMovementKind.ADJUST_IN && Number(ym[1]!.qtyKg) === 20 && (await balance(yarn.id, wh.id)) === 500);
  const linesAfter = await prisma.stockCountLine.findMany({ where: { stockCountId: c1.id }, select: { id: true, found: true, countedQty: true, outOfScopeReason: true, updatedAt: true }, orderBy: { id: "asc" } });
  check("§3f Sayım satırları DEĞİŞMEDİ", JSON.stringify(linesAfter) === JSON.stringify(linesBefore));
  const head = await prisma.stockCount.findUniqueOrThrow({ where: { id: c1.id } });
  check(
    "§3g Sayım COMPLETED kaldı + storno damgası (tarih + AKTÖR + gerekçe)",
    head.status === "COMPLETED" && head.reversedAt != null && head.reversedById === ADMIN && head.reverseReason === "yanlış eksik işareti",
    `aktör=${head.reversedById}`,
  );
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

  // §6 ÇIKIŞ DALLARI (LEDGER_ONLY + ALREADY_REVERSED)
  const c4 = await runCount(wh.id, [r1, r2]);
  await inventory.restoreCancelledRoll(r1, undefined, { reason: "elle geri alındı" });
  const prev4 = (await stockCountReversalService.preview(c4.id)).data!;
  const p4 = (id: string) => prev4.rolls.find((r) => r.rollId === id);
  check(
    "§6a ⭐ Elle geri alınmış top BLOKLAMIYOR: dalı LEDGER_ONLY, gerekçesi yazılı",
    prev4.blockers.length === 0 && p4(r1)?.action === "LEDGER_ONLY" && (p4(r1)?.note ?? "").includes("yalnız defter"),
    `${p4(r1)?.action} / ${p4(r1)?.note}`,
  );
  check("§6b Diğer top RESTORE dalında", p4(r2)?.action === "RESTORE" && p4(r2)?.targetStatus === RollStatus.A1_STOCK);
  const rev4 = await stockCountReversalService.reverse(c4.id, "elle karışmış sayım", ADMIN);
  check(
    "§6c Yanıt iki dalı ayrı sayıyor (1 rafa döndü, 1 yalnız defter)",
    rev4.data?.restoredRolls === 1 && rev4.data?.ledgerOnlyRolls === 1,
    JSON.stringify(rev4.data),
  );
  const r1After = await prisma.roll.findUniqueOrThrow({ where: { id: r1 }, select: { status: true, cancelledAt: true } });
  const r2After = await prisma.roll.findUniqueOrThrow({ where: { id: r2 }, select: { status: true } });
  check("§6d LEDGER_ONLY topun STATÜSÜNE dokunulmadı", r1After.status === RollStatus.WAREHOUSE && r1After.cancelledAt === null);
  check("§6e RESTORE topu önceki rafına döndü", r2After.status === RollStatus.A1_STOCK);
  const revRows4 = await prisma.warehouseMovement.findMany({
    where: { stockCountId: c4.id, eventType: WarehouseEventType.CANCEL_REVERSAL },
    select: { rollId: true },
  });
  check("§6f İKİ topun da defter karşılığı yazıldı", revRows4.length === 2 && new Set(revRows4.map((r) => r.rollId)).size === 2, String(revRows4.length));
  const var4 = await prisma.rollVariance.findMany({ where: { rollId: { in: [r1, r2] }, sourceRefId: c4.id }, select: { reversedAt: true } });
  check("§6g İki sapma satırı da damgalandı", var4.length === 2 && var4.every((v) => v.reversedAt != null));

  // §6h ALREADY_REVERSED: ileri satır BAŞKA yol tarafından (elle geri alma)
  // terslenmişse storno satırı TEKRAR YAZMAZ — yalnız sapma damgasını atar.
  // ⚠️ Taklit satırın ŞEKLİ ARTIK BAĞLIDIR: elle geri alma yolu terslenmemiş
  // CANCEL'ı bulup `reversesMovementId`e yazar (tasarım D2b). Tespit yalnız bu
  // alandan yapıldığı için bağsız satır seddi AÇMAZ — onu §6h2 ölçüyor.
  const c5 = await runCount(wh.id, [r3]);
  const fwd5 = await prisma.warehouseMovement.findFirstOrThrow({
    where: { rollId: r3, stockCountId: c5.id, eventType: WarehouseEventType.CANCEL, reversesMovementId: null },
    select: { id: true },
  });
  await prisma.warehouseMovement.create({
    data: {
      rollId: r3,
      eventType: WarehouseEventType.CANCEL_REVERSAL,
      qty: 70,
      toWarehouseId: wh.id,
      toStatus: RollStatus.WAREHOUSE,
      reversesMovementId: fwd5.id,
      notes: "elle geri almanın yazdığı ters satır (taklit)",
    },
  });
  const prev5 = (await stockCountReversalService.preview(c5.id)).data!;
  check(
    "§6h ⭐ İleri satırı terslenmiş top: dal ALREADY_REVERSED",
    prev5.rolls.find((r) => r.rollId === r3)?.action === "ALREADY_REVERSED",
    JSON.stringify(prev5.rolls.map((r) => r.action)),
  );
  await stockCountReversalService.reverse(c5.id, "zaten kapanmış defter", ADMIN);
  const revOfFwd5 = await prisma.warehouseMovement.count({ where: { reversesMovementId: fwd5.id } });
  const var5 = await prisma.rollVariance.findFirst({ where: { rollId: r3, sourceRefId: c5.id }, select: { reversedAt: true } });
  check(
    "§6i ⭐ İleri satırın TEK tersi var (storno ikinci satır yazmadı)",
    revOfFwd5 === 1,
    `n=${revOfFwd5}`,
  );
  check("§6j Sapma damgası yine atıldı", var5?.reversedAt != null);

  // §6h2 ⭐ BAĞSIZ ters satır seddi AÇMAZ: tipi `CANCEL_REVERSAL` olan ama hiçbir
  // ileri satıra bağlanmayan satır "bu sayımın defteri kapandı" demez. Eski kural
  // (tip + belge bağı sayma) burada yanlış pozitif veriyordu.
  const r6 = await makeRoll(wh.id, fabric.id, 35, RollStatus.WAREHOUSE);
  const c6 = await runCount(wh.id, [r6]);
  await prisma.warehouseMovement.create({
    data: {
      rollId: r6,
      eventType: WarehouseEventType.CANCEL_REVERSAL,
      qty: 35,
      toWarehouseId: wh.id,
      toStatus: RollStatus.WAREHOUSE,
      stockCountId: c6.id,
      notes: "bağsız ters satır (sed açmamalı)",
    },
  });
  const prev6 = (await stockCountReversalService.preview(c6.id)).data!;
  check(
    "§6h2 ⭐ Bağsız CANCEL_REVERSAL satırı dalı ALREADY_REVERSED YAPMAZ",
    prev6.rolls.find((r) => r.rollId === r6)?.action === "RESTORE",
    JSON.stringify(prev6.rolls.map((r) => r.action)),
  );
  await stockCountReversalService.reverse(c6.id, "bağsız satıra rağmen storno", ADMIN);
  const fwd6Rev = await prisma.warehouseMovement.count({
    where: { rollId: r6, eventType: WarehouseEventType.CANCEL_REVERSAL, reversesMovementId: { not: null } },
  });
  check("§6h3 ⭐ Storno kendi bağlı ters satırını yazdı (bağsız satır onu engellemedi)", fwd6Rev === 1, `n=${fwd6Rev}`);

  // §6k ⭐ KARDEŞ SAYIMIN ters satırı seddi AÇMAZ (denetim bulgusu 2026-09-12):
  // SAY-A eksik işaretler → top elle geri alınır → SAY-B yine eksik işaretler →
  // LIFO SAY-B'yi önce stornolar (ters satır SAY-B'ye bağlı doğar) → SAY-A
  // stornolanırken o satır "zaten yazılmış" sayılmamalı, yoksa SAY-A'nın CANCEL
  // satırı sonsuza dek karşılıksız kalır.
  const r4 = await makeRoll(wh.id, fabric.id, 40, RollStatus.WAREHOUSE);
  const cA = await runCount(wh.id, [r4]);
  await inventory.restoreCancelledRoll(r4, undefined, { reason: "elle geri alındı (kardeş sonda)" });
  const cB = await runCount(wh.id, [r4]);
  await stockCountReversalService.reverse(cB.id, "kardeş sayım stornosu (LIFO)", ADMIN);
  await stockCountReversalService.reverse(cA.id, "eski sayım stornosu", ADMIN);
  const revA = await prisma.warehouseMovement.count({
    where: { rollId: r4, stockCountId: cA.id, eventType: WarehouseEventType.CANCEL_REVERSAL },
  });
  const revB = await prisma.warehouseMovement.count({
    where: { rollId: r4, stockCountId: cB.id, eventType: WarehouseEventType.CANCEL_REVERSAL },
  });
  check("§6k ⭐ Her sayımın CANCEL satırı KENDİ ters satırını aldı (kardeş satır seddi açmadı)", revA === 1 && revB === 1, `A=${revA} B=${revB}`);

  // §6l ⭐ ESKİ KAYIT DALI (grandfathering, tasarım D2b): ②-c öncesi yazılmış ileri
  // satır `fromStatus` TAŞIMAZ, yani yön aynalanamaz. Storno PATLAMAMALI — uç elle
  // kurulur.
  //
  // ⚠️ "BAĞSIZ" İDDİASI 2026-09-13'te TERS ÇEVRİLDİ: statüsüz ileri satırın tersi
  // artık `reverseLegacyStockMove` (K4) ile yazılıyor ⇒ satır BAĞLI doğuyor
  // (`reversesMovementId` → ileri satır). Bağsızlığın bedeli vardı: çift storno
  // seddi (DB unique) bağ olmadan çalışmaz ve "bu satır ters kayıt mı" sorusu
  // cevapsız kalırdı. Bağ yalnız ileri satır HİÇ yoksa kurulamaz.
  const r7 = await makeRoll(wh.id, fabric.id, 25, RollStatus.WAREHOUSE);
  const cL = await runCount(wh.id, [r7]);
  await prisma.$executeRaw`UPDATE warehouse_movements SET "fromStatus" = NULL
    WHERE "stockCountId" = ${cL.id}::uuid AND "eventType" = 'CANCEL'::"WarehouseEventType"`;
  // Bağın HANGİ satıra kurulduğunu ölç: `!== null` "bağlı" der, "doğru satıra bağlı" DEMEZ.
  const fwdL = await prisma.warehouseMovement.findFirstOrThrow({
    where: { rollId: r7, stockCountId: cL.id, eventType: WarehouseEventType.CANCEL },
    select: { id: true },
  });
  await stockCountReversalService.reverse(cL.id, "eski satir dali", ADMIN);
  const legacyRev = await prisma.warehouseMovement.findMany({
    where: { rollId: r7, stockCountId: cL.id, eventType: WarehouseEventType.CANCEL_REVERSAL },
    select: { reversesMovementId: true, toWarehouseId: true, toStatus: true },
  });
  check(
    "§6l ⭐ fromStatus'suz ileri satırda storno BAĞLI ters satır yazdı (uç elle kuruldu, bağ ileri satıra)",
    legacyRev.length === 1 &&
      legacyRev[0]!.reversesMovementId === fwdL.id &&
      legacyRev[0]!.toWarehouseId === wh.id &&
      legacyRev[0]!.toStatus === RollStatus.WAREHOUSE,
    JSON.stringify(legacyRev),
  );
  const r7After = await prisma.roll.findUniqueOrThrow({ where: { id: r7 }, select: { status: true } });
  check("§6l2 Eski satır dalında top yine rafına döndü", r7After.status === RollStatus.WAREHOUSE, r7After.status);

  // §6m ⭐ AYNI SAYIMDA İKİ İLERİ SATIR, biri ZATEN terslenmiş. Plan TERSLENMEMİŞ
  // olanı seçmek zorunda (yüklemde `reversesMovementId: null`): terslenmiş satırı
  // seçerse ya "zaten yazılmış" diye satır yazmaz ya ikinci kez terslemeye çalışıp
  // P2002'yi yanıltıcı hataya çevirir (6e'nin uyarısı, 2026-09-12).
  const r8 = await makeRoll(wh.id, fabric.id, 15, RollStatus.WAREHOUSE);
  const cM = await runCount(wh.id, [r8]);
  const fwdM = await prisma.warehouseMovement.findFirstOrThrow({
    where: { rollId: r8, stockCountId: cM.id, eventType: WarehouseEventType.CANCEL },
    select: { id: true },
  });
  // İkinci ileri satır SONRA doğar (plan `createdAt` sırasıyla okur, Map'te son kazanır)
  // ve ZATEN terslenmiştir — yüklem olmadan seçilecek satır BUDUR.
  const fwdM2 = await prisma.warehouseMovement.create({
    data: {
      rollId: r8,
      eventType: WarehouseEventType.CANCEL,
      qty: 15,
      fromWarehouseId: wh.id,
      fromStatus: RollStatus.WAREHOUSE,
      stockCountId: cM.id,
      notes: "ikinci ileri satır (taklit)",
    },
    select: { id: true },
  });
  await prisma.warehouseMovement.create({
    data: {
      rollId: r8,
      eventType: WarehouseEventType.CANCEL_REVERSAL,
      qty: 15,
      toWarehouseId: wh.id,
      toStatus: RollStatus.WAREHOUSE,
      stockCountId: cM.id,
      reversesMovementId: fwdM2.id,
      notes: "ikinci ileri satırın tersi (taklit)",
    },
  });
  const prevM = (await stockCountReversalService.preview(cM.id)).data!;
  check(
    "§6m ⭐ Terslenmiş ileri satır SEÇİLMEDİ (dal ALREADY_REVERSED değil)",
    prevM.rolls.find((r) => r.rollId === r8)?.action === "RESTORE",
    JSON.stringify(prevM.rolls.map((r) => r.action)),
  );
  await stockCountReversalService.reverse(cM.id, "iki ileri satir dali", ADMIN);
  const revOfFwdM = await prisma.warehouseMovement.count({ where: { reversesMovementId: fwdM.id } });
  check("§6m2 ⭐ Storno TERSLENMEMİŞ ileri satırı tersledi", revOfFwdM === 1, `n=${revOfFwdM}`);

  // §6n ⭐ TERS SATIRIN TİPİ `CANCEL` OLABİLİR: `reverseStockMove` override'sız
  // çağrılınca ileri satırın tipini KOPYALAR (elle "iptali geri al" yolu böyle
  // yazacak). O satır ileri satır SANILMAMALI — yüklemdeki `reversesMovementId: null`
  // onu ayırır; ayırmazsa storno bir ters kaydın tersini yazmaya çalışır (409).
  const r9 = await makeRoll(wh.id, fabric.id, 18, RollStatus.WAREHOUSE);
  const cN = await runCount(wh.id, [r9]);
  const fwdN = await prisma.warehouseMovement.findFirstOrThrow({
    where: { rollId: r9, stockCountId: cN.id, eventType: WarehouseEventType.CANCEL, reversesMovementId: null },
    select: { id: true },
  });
  await prisma.warehouseMovement.create({
    data: {
      rollId: r9,
      eventType: WarehouseEventType.CANCEL, // ⚠️ TİP ters kayıt DEMİYOR
      qty: 18,
      toWarehouseId: wh.id,
      toStatus: RollStatus.WAREHOUSE,
      stockCountId: cN.id,
      reversesMovementId: fwdN.id, // BAĞ ters kayıt DİYOR
      notes: "tipi CANCEL olan ters satır (taklit)",
    },
  });
  const prevN = (await stockCountReversalService.preview(cN.id)).data!;
  check(
    "§6n ⭐ Tipi CANCEL olan ters satır ileri satır SANILMADI (dal ALREADY_REVERSED)",
    prevN.rolls.find((r) => r.rollId === r9)?.action === "ALREADY_REVERSED",
    JSON.stringify(prevN.rolls.map((r) => r.action)),
  );
  await stockCountReversalService.reverse(cN.id, "tipi CANCEL olan ters satir dali", ADMIN);
  const revOfFwdN = await prisma.warehouseMovement.count({ where: { reversesMovementId: fwdN.id } });
  check("§6n2 ⭐ Yeni ters satır yazılmadı (ileri satırın tek tersi duruyor)", revOfFwdN === 1, `n=${revOfFwdN}`);

  // §6p ⭐ TOP STOK KÜMESİNDEN ÇIKMIŞ (LEDGER_ONLY dalı, ölçülmemiş bileşim 2026-09-13):
  // sayım topu düşürdü → elle geri alındı → top yoluna devam etti ve artık stok
  // kümesinde DEĞİL (sevk edildi, deposu boş). Ters satırın giriş ucu KANITTAN
  // gelmeli (ileri satırın `fromStatus`/`fromWarehouseId`ı = topun sayım anında
  // gözlendiği raf), topun BUGÜNKÜ statüsünden değil — yoksa satır "top stok
  // kümesine SHIPPED statüsünde girdi" der ki böyle bir olay HİÇ olmadı ve
  // statüsü stok kümesinde olmayan ucun deposu da olamaz (K1 uç şekli).
  //
  // Ölçülen dal AYNALAMA dalıdır (`reverseStockMove`): ileri satır `fromStatus`
  // taşıdığı için uç ondan aynalanır. İkizi §6r, ileri satır statü taşımadığında
  // planın `ledgerToStatus`ını ölçer — ikisi birlikte iki dalı kapatır.
  const r10 = await makeRoll(wh.id, fabric.id, 22, RollStatus.WAREHOUSE);
  const cP = await runCount(wh.id, [r10]);
  await inventory.restoreCancelledRoll(r10, undefined, { reason: "elle geri alındı (stok dışı sondası)" });
  // Topu stok kümesinin DIŞINA taşı: statü + depo birlikte değişir (deposuz stok
  // topu ayrı bir ihlaldir; bu sonda onu değil "uç nereden geliyor"u ölçüyor).
  await prisma.roll.update({ where: { id: r10 }, data: { status: RollStatus.SHIPPED, warehouseId: null } });
  // POZİTİF KONTROL: sonda iddia ettiği durumu GERÇEKTEN kurdu mu — kurmadıysa
  // aşağıdaki iki kontrol "stok dışı" senaryosunu hiç ölçmemiş olur (vakumen yeşil).
  const r10Setup = await prisma.roll.findUniqueOrThrow({ where: { id: r10 }, select: { status: true, warehouseId: true } });
  check(
    "§6p1 Sonda kurulumu: top stok kümesinin DIŞINDA (SHIPPED, deposuz)",
    r10Setup.status === RollStatus.SHIPPED && r10Setup.warehouseId === null,
    `${r10Setup.status}/${String(r10Setup.warehouseId)}`,
  );
  const prevP = (await stockCountReversalService.preview(cP.id)).data!;
  check(
    "§6p0 Stok dışına çıkmış top LEDGER_ONLY dalında (statüsüne dokunulmaz)",
    prevP.rolls.find((r) => r.rollId === r10)?.action === "LEDGER_ONLY",
    JSON.stringify(prevP.rolls.map((r) => r.action)),
  );
  await stockCountReversalService.reverse(cP.id, "stok disina cikmis top", ADMIN);
  const revP = await prisma.warehouseMovement.findMany({
    where: { rollId: r10, stockCountId: cP.id, eventType: WarehouseEventType.CANCEL_REVERSAL },
    select: { toWarehouseId: true, toStatus: true },
  });
  check(
    "§6p ⭐ Ters satırın giriş ucu KANITTAN (sayımın gözlediği raf), topun bugünkü SHIPPED statüsünden DEĞİL",
    revP.length === 1 && revP[0]!.toStatus === RollStatus.WAREHOUSE && revP[0]!.toWarehouseId === wh.id,
    JSON.stringify(revP),
  );
  const r10After = await prisma.roll.findUniqueOrThrow({ where: { id: r10 }, select: { status: true, warehouseId: true } });
  check(
    "§6p2 Topun statüsü ve deposu DEĞİŞMEDİ (defter karşılığı yazıldı, top geri çağrılmadı)",
    r10After.status === RollStatus.SHIPPED && r10After.warehouseId === null,
    `${r10After.status}/${String(r10After.warehouseId)}`,
  );

  // §6r ⭐ KANIT YOK → SATIR UYDURULMAZ, 409. §6p'nin ikizi: aynı bileşimde ileri
  // satır `fromStatus` TAŞIMAZSA (②-c öncesi eski kayıt) giriş ucu hiçbir yerden
  // türetilemez — `target` da boştur, çünkü top bu sayım tarafından iptalli değil.
  // Eski kod burada topun o anki statüsünü yazardı; artık işlem DURUR.
  const r11 = await makeRoll(wh.id, fabric.id, 12, RollStatus.WAREHOUSE);
  const cR = await runCount(wh.id, [r11]);
  await inventory.restoreCancelledRoll(r11, undefined, { reason: "elle geri alındı (kanıtsız sonda)" });
  await prisma.roll.update({ where: { id: r11 }, data: { status: RollStatus.SHIPPED, warehouseId: null } });
  await prisma.$executeRaw`UPDATE warehouse_movements SET "fromStatus" = NULL
    WHERE "stockCountId" = ${cR.id}::uuid AND "eventType" = 'CANCEL'::"WarehouseEventType"`;
  const kanitsiz = await expectErr(() => stockCountReversalService.reverse(cR.id, "kanitsiz storno", ADMIN));
  check(
    "§6r ⭐ Kanıt yoksa storno 409 REVERSAL_ENTRY_UNKNOWN (uç UYDURULMADI)",
    kanitsiz?.status === 409 && kanitsiz.code === "REVERSAL_ENTRY_UNKNOWN",
    JSON.stringify(kanitsiz),
  );
  const revR = await prisma.warehouseMovement.count({
    where: { rollId: r11, stockCountId: cR.id, eventType: WarehouseEventType.CANCEL_REVERSAL },
  });
  const cRHead = await prisma.stockCount.findUniqueOrThrow({ where: { id: cR.id }, select: { reversedAt: true } });
  check(
    "§6r2 409 sonrası tx geri sarıldı: ters satır yok, storno damgası yok",
    revR === 0 && cRHead.reversedAt === null,
    `satır=${revR} damga=${String(cRHead.reversedAt)}`,
  );

  // §7
  const svc = readFileSync(join(__dirname, "../src/services/stock-count-reversal.service.ts"), "utf8");
  // Plan katmanı AYRI dosyada (karar ↔ yazım ayrımı): tarama İKİSİNİ birden okur,
  // yoksa kural bölünmeyle sessizce kapsam dışına çıkar.
  const planHelper = readFileSync(
    join(__dirname, "../src/services/helpers/stock-count-reversal-plan.helper.ts"),
    "utf8",
  );
  const countSvc = readFileSync(join(__dirname, "../src/services/stock-count.service.ts"), "utf8");
  const route = readFileSync(join(__dirname, "../src/routes/stock-count.routes.ts"), "utf8");
  check(
    "§7a İptal metni tek kaynaktan (storno servisi ve plan helper'ı literal taşımaz)",
    !/`\$\{[^}]+\} sayımında bulunamadı`/.test(countSvc.replace(/export function stockCountCancelReason[\s\S]*?\n\}/, "")) &&
      !svc.includes("sayımında bulunamadı") &&
      !planHelper.includes("sayımında bulunamadı"),
  );
  check(
    // ⚠️ ETİKET ÖLÇTÜĞÜNDEN FAZLASINI İDDİA ETMEZ (denetim B23, 2026-09-12): servis
    // yüklemi eskiden yalnız `.delete` yasaklıyordu ama etiket "satır güncelleme yok"
    // diyordu. Doğru ayrım: İLERİ DEFTER satırı (`warehouseMovement`/`yarnMovement`)
    // ne silinir ne GÜNCELLENİR; `rollVariance.updateMany` ise MEŞRU damgadır (sapma
    // satırı duruyor, üstüne `reversedAt` yazılıyor) ve yasaklanamaz.
    "§7b Storno servisi ileri defter satırını silmiyor/GÜNCELLEMİYOR (sapma damgası istisna), plan helper'ı hiçbirine dokunmuyor",
    !/(warehouseMovement|yarnMovement)\.(delete|deleteMany|update|updateMany)|rollVariance\.delete|stockCountLine\.update/.test(svc) &&
      !/(warehouseMovement|yarnMovement|rollVariance)\.(delete|update)|stockCountLine\.update/.test(planHelper),
  );
  // ⚠️ PLAN KATMANI HİÇ YAZMAZ: karar ↔ yazım ayrımı mekanik ölçülür, yoksa bir
  // gün plan helper'ına "küçük bir create" eklenir ve önizleme yan etki üretir.
  check(
    "§7b2 ⭐ Plan helper'ı YAZMIYOR (create/createMany/update/upsert/executeRaw yok)",
    !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(planHelper) &&
      !/\$executeRaw/.test(planHelper),
  );
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
      // ⚠️ TERS SATIRLAR ÖNCE ve KÜME BAĞDAN BULUNUR: `reversesMovementId` kendine
      // bakan bir FK ve `onDelete: Restrict` — RESTRICT satır satır denetlenir (NO
      // ACTION gibi ifade sonuna ÖTELENMEZ), yani ileri satırla tersini tek
      // `deleteMany` silmek P2003'e düşer ve temizlik sessizce yarıda kalırdı
      // (ölçüldü 2026-09-13: 19 depo · 217 sayım artığı birikmişti).
      //
      // ⚠️ ÇOCUK KÜMESİ KAPSAMDAN DEĞİL BAĞDAN: elle geri alma yolunun yazdığı
      // `CANCEL_REVERSAL` satırları `stockCountId` TAŞIMAZ, yani "sayımın satırları"
      // süzmesine girmezler ama sayımın `CANCEL` satırını işaret ederler. Küme
      // `reversesMovement` ilişkisinden okunur; her defter satırının `rollId`i
      // olduğu için bu süzme çocukların tamamını kapsar.
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { reversesMovement: { rollId: { in: rollIds } } } });
      }
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
      // ⚠️ UYARI DEĞİL KIRMIZI: `console.warn` koşucunun yeşil çıktısında görünmez,
      // yani yarıda kalan temizlik ölçülmemiş bir artık bırakır (ölçüldü 2026-09-13).
      fail++;
      // Mesajın SONU okunur: Prisma'nın FK hatasında sebep (`constraint`) en sonda,
      // başta ise yalnız çağrı yeri ve kod dökümü var.
      console.error("❌ Temizlik YARIDA KALDI — artık bırakıldı:", (e as Error).message.replace(/\s+/g, " ").slice(-300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
