// =============================================================================
// BEKÇİ — RAFTAN ÜRETİME GİREN HER YOL `PRODUCTION_ISSUE` YAZAR (stok defteri)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_manual_move
// =============================================================================
// NEDEN: raftaki (stok kümesindeki) top üretime DÖRT yoldan giriyordu ve yalnız
// biri (`attachRolls`) çıkış satırı yazıyordu. Manuel taşıma ("Konumu Düzelt"),
// elle top (Faz 1 rafa yazar, Faz 2 üretime alır) ve redye ayırma (iki dal)
// satırsızdı: top üretimde, defter "rafta" — mutabakat boşluğu (ölçüldü
// 2026-09-13/14, TAMBUR-GERI-ALMA-HUKUM §5). K=0 kapısı bu yolları göremiyordu:
// hiçbir kapıyı çağırmayan yol AST'ye görünmez, liste elle tutulur ve bunlar
// listede yoktu ("KÖR", beyanlı kapsam dışı değil).
//
// Yazıcı TEK: `helpers/production-issue-ledger.helper.ts` — yüklem (stok kümesi
// ∧ depo var ∧ metraj yazılabilir) ve satır dört yolda aynı; görüntü claim ÖNCESİ.
//
// ÖLÇÜLENLER
//   §1 Manuel taşıma: WAREHOUSE → adım ⇒ tek PRODUCTION_ISSUE çıkışı (uç: depo +
//      WAREHOUSE, adım damgası hedef adım), net 0 · §1b STOCK kaynağı da aynı
//   §2 Manuel taşıma: zaten üretimdeki top adım değiştirince satır YOK
//      (stok dışı → stok dışı; §64)
//   §3 Elle top: Faz 1 ENTRY_RECEIPT +q, Faz 2 PRODUCTION_ISSUE −q, net 0;
//      aynı clientToken ile tekrar ⇒ ikinci satır YOK (idempotent dal erken döner)
//   §4 Redye: (a) REDYE_SAME_COLOR raftaki her top için çıkış, damga = boyahane
//      adımı · (b) NEW_COLOR çıkış, damga = YENİ iş emrinin geri-giriş adımı ·
//      (c) partideki zaten-üretimde top satır almaz
//   §H ⭐ MUTABAKAT: fikstür toplarının canlı stok metrajı = Σdefter neti
//      (iki bağımsız kaynak; yazım öncesi bu eşitlik 4 yolda bozuluyordu)
//   §Z Körlük zemini: fikstür gerçekten satır üretti
//
// İKİ SONDA (koşuldu 2026-09-14): helper çağrıları kaldırılınca §1/§3/§4 kırmızı
// (negatif); helper ile §H boşluğu 0 (pozitif — yazım öncesi 100·n idi).
// =============================================================================
import { randomUUID } from "node:crypto";
import { RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { WorkOrderSplitService } from "../src/services/workorder-split.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { WAREHOUSE_STOCK_STATUSES } from "../src/services/helpers/warehouse-stock.helper";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLMM-${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];
let itemId = "";

interface Satir {
  id: string; eventType: WarehouseEventType; qty: unknown;
  fromWarehouseId: string | null; toWarehouseId: string | null;
  fromStatus: RollStatus | null; toStatus: RollStatus | null;
  reasonCode: string | null; workOrderStepId: string | null;
}
async function satirlar(rollId: string): Promise<Satir[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId }, orderBy: { createdAt: "asc" },
    select: { id: true, eventType: true, qty: true, fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true, reasonCode: true, workOrderStepId: true },
  });
}
const net = (rows: Satir[]): number => rows.reduce((a, r) => a + (r.toWarehouseId ? Number(r.qty) : 0) - (r.fromWarehouseId ? Number(r.qty) : 0), 0);
const cikislar = (rows: Satir[]): Satir[] => rows.filter((r) => r.reasonCode === STOCK_MOVE_REASON.PRODUCTION_ISSUE);

/** Canlı stok: stok kümesindeki topların metrajı (defterden BAĞIMSIZ kaynak). */
async function canliStok(ids: string[]): Promise<number> {
  const rows = await prisma.roll.findMany({ where: { id: { in: ids }, status: { in: [...WAREHOUSE_STOCK_STATUSES] } }, select: { currentQty: true } });
  return rows.reduce((a, r) => a + Number(r.currentQty), 0);
}

function need<T extends { id: string }>(row: T | null, label: string): string {
  if (!row) throw new Error(`Fikstür eksik: ${label}`);
  return row.id;
}

async function main(): Promise<void> {
  console.log("\n=== Raftan üretime giren yollar: PRODUCTION_ISSUE ===\n");
  const inventory = new InventoryService();
  const manualMove = new WorkOrderManualMoveService();
  const tamburManual = new TamburManualService();
  const split = new WorkOrderSplitService();

  // Aktör testin KENDİ fikstüründen (ortam kullanıcısına bağımlı değil — TD-17).
  const ADMIN = (await ensureTestAdmin()).id;
  const ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  const ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  const ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  const CAT_BOYA = need(await prisma.subcontractorCategory.findFirst({ where: { appliesColor: true }, select: { id: true } }), "appliesColor kategori");
  const renkler = await prisma.color.findMany({ where: { isActive: true }, select: { id: true }, take: 2 });
  if (renkler.length < 2) throw new Error("Fikstür eksik: en az iki aktif renk");
  const [RENK1, RENK2] = [renkler[0]!.id, renkler[1]!.id];
  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;

  /** Raf topu — gerçek giriş yolu (ENTRY_RECEIPT + depo damgası). */
  async function rafTopu(qty: number, forcedStatus: "WAREHOUSE" | "STOCK"): Promise<string> {
    const r = (await inventory.createInitialEntry({ itemId, initialQty: qty }, undefined, undefined, false, { forcedStatus })).data as { id: string };
    rollIds.push(r.id);
    return r.id;
  }

  // ── §1/§2 Manuel taşıma ─────────────────────────────────────────────────────
  const woA = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-A`, status: "IN_PROGRESS", steps: { create: [{ stationId: ST_KURSUN, stepSequence: 1, status: "ACTIVE" }, { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" }] } },
    select: { id: true, steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(woA.id);
  const [adimA1, adimA2] = [woA.steps[0]!.id, woA.steps[1]!.id];

  const rafW = await rafTopu(100, "WAREHOUSE");
  await manualMove.manualMove(woA.id, { rollIds: [rafW], targetStepId: adimA2, reason: "bekçi §1 konumu düzelt" }, ADMIN);
  const s1 = await satirlar(rafW);
  const c1 = cikislar(s1);
  check("§1 WAREHOUSE → adım: tek PRODUCTION_ISSUE çıkışı", c1.length === 1 && s1.length === 2, `satır=${s1.length} çıkış=${c1.length}`);
  check("§1 çıkış ucu depo + WAREHOUSE, giriş ucu yok, adım damgası hedef adım",
    !!c1[0] && c1[0].fromWarehouseId !== null && c1[0].fromStatus === RollStatus.WAREHOUSE && c1[0].toWarehouseId === null && c1[0].workOrderStepId === adimA2 && c1[0].eventType === WarehouseEventType.PRODUCTION,
    c1[0] ? `from=${c1[0].fromStatus} to=${c1[0].toStatus} step=${c1[0].workOrderStepId === adimA2 ? "hedef" : "?"}` : "satır yok");
  check("§1 ⭐ net 0 (giriş +100, çıkış −100) ve top üretimde", net(s1) === 0 && (await prisma.roll.findUnique({ where: { id: rafW }, select: { status: true } }))?.status === RollStatus.IN_PRODUCTION, `net=${net(s1)}`);

  const rafS = await rafTopu(80, "STOCK");
  await manualMove.manualMove(woA.id, { rollIds: [rafS], targetStepId: adimA1, reason: "bekçi §1b ham raf" }, ADMIN);
  const s1b = cikislar(await satirlar(rafS));
  check("§1b STOCK (ham raf) → adım: çıkış ucu STOCK, metraj 80", s1b.length === 1 && s1b[0]!.fromStatus === RollStatus.STOCK && Number(s1b[0]!.qty) === 80, `çıkış=${s1b.length}`);

  // §2 — zaten üretimdeki top adım değiştirince satır yok.
  const onceS2 = (await satirlar(rafS)).length;
  await manualMove.manualMove(woA.id, { rollIds: [rafS], targetStepId: adimA2, reason: "bekçi §2 adım değişimi" }, ADMIN);
  const sonraS2 = (await satirlar(rafS)).length;
  check("§2 üretimdeki top adım değiştirince satır YOK (stok dışı → stok dışı)", sonraS2 === onceS2, `önce=${onceS2} sonra=${sonraS2}`);

  // ── §3 Elle top (Faz 1 rafa, Faz 2 üretime) ──────────────────────────────────
  const woB = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-B`, status: "IN_PROGRESS", steps: { create: [{ stationId: ST_TAMBUR, stepSequence: 1, status: "ACTIVE" }] } },
    select: { id: true, steps: { select: { id: true } } },
  });
  woIds.push(woB.id);
  const adimB = woB.steps[0]!.id;
  // Parti VERİLMEZ: açık parti yok ⇒ NULL (top-duzeltme.md kuralı); boş parti "açık" sayılmaz (canlı top ister).
  const token = randomUUID();
  const elle = (await tamburManual.createManualRoll(
    { targetStepId: adimB, initialQty: 50, reason: "bekçi §3 elde top bulundu", clientToken: token, itemId },
    { machineId: null, stationId: null, userId: ADMIN },
  )).data as { rollId: string };
  rollIds.push(elle.rollId);
  const s3 = await satirlar(elle.rollId);
  const c3 = cikislar(s3);
  check("§3 elle top: ENTRY_RECEIPT +50 ve PRODUCTION_ISSUE −50, net 0", s3.length === 2 && c3.length === 1 && Number(c3[0]!.qty) === 50 && net(s3) === 0, `satır=${s3.length} net=${net(s3)}`);
  check("§3 çıkışın adım damgası hedef adım", c3[0]?.workOrderStepId === adimB);
  await tamburManual.createManualRoll(
    { targetStepId: adimB, initialQty: 50, reason: "bekçi §3 elde top bulundu", clientToken: token, itemId },
    { machineId: null, stationId: null, userId: ADMIN },
  );
  check("§3 aynı clientToken ile tekrar ⇒ ikinci çıkış satırı YOK (idempotent)", (await satirlar(elle.rollId)).length === 2);

  // ── §4 Redye ayırma (iki dal) ────────────────────────────────────────────────
  const woC = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-C`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 150, targetQuantity: 1000, targetItemId: itemId, targetColorId: RENK1,
      steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING", requiredCategoryId: CAT_BOYA }, { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" }] },
    },
    select: { id: true, workOrderNumber: true, steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(woC.id);
  const [adimBoya, adimTambur] = [woC.steps[0]!.id, woC.steps[1]!.id];
  await prisma.travelerCard.create({ data: { cardNumber: woC.workOrderNumber, barcode: woC.workOrderNumber, workOrderId: woC.id, version: 1, status: "ACTIVE", printedById: ADMIN } });
  const p1 = await prisma.batch.create({ data: { batchNumber: `${TAG}-P1`, workOrderId: woC.id }, select: { id: true } });
  const p2 = await prisma.batch.create({ data: { batchNumber: `${TAG}-P2`, workOrderId: woC.id }, select: { id: true } });
  const rafR1 = await rafTopu(100, "WAREHOUSE");
  const rafR2 = await rafTopu(100, "WAREHOUSE");
  const rafR3 = await rafTopu(100, "WAREHOUSE");
  // Raftaki üç top boyahane SONRASI konumda (producedInStep = Tambur) ve renkli ⇒ redye'ye uygun.
  await prisma.roll.updateMany({ where: { id: { in: [rafR1, rafR2] } }, data: { batchId: p1.id, producedInStepId: adimTambur, colorId: RENK1 } });
  await prisma.roll.updateMany({ where: { id: rafR3 }, data: { batchId: p2.id, producedInStepId: adimTambur, colorId: RENK1 } });
  // Partideki ZATEN üretimde top — satır almamalı.
  const uretimde = await prisma.roll.create({
    data: { barcode: `${TAG}-U`, itemId, initialQty: 100, currentQty: 100, status: RollStatus.IN_PRODUCTION, currentStepId: adimTambur, batchId: p1.id, colorId: RENK1, entrySource: "SUPPLIER_RECEIPT" },
    select: { id: true },
  });
  rollIds.push(uretimde.id);

  await split.splitBranch(woC.id, { batchId: p1.id, mode: "REDYE_SAME_COLOR", reason: "bekçi §4a" }, ADMIN);
  const c4a = [cikislar(await satirlar(rafR1)), cikislar(await satirlar(rafR2))];
  check("§4a REDYE_SAME_COLOR: raftaki iki topun ikisi de PRODUCTION_ISSUE aldı", c4a.every((c) => c.length === 1), `çıkış=${c4a.map((c) => c.length).join(",")}`);
  check("§4a damga = boyahane adımı, uç depo + WAREHOUSE", c4a.every((c) => c[0]?.workOrderStepId === adimBoya && c[0]?.fromStatus === RollStatus.WAREHOUSE && c[0]?.fromWarehouseId !== null));
  check("§4c partideki zaten-üretimde top satır ALMADI", (await satirlar(uretimde.id)).length === 0);

  await split.splitBranch(woC.id, { batchId: p2.id, mode: "NEW_COLOR", newColorId: RENK2, orderMode: "stock", reason: "bekçi §4b" }, ADMIN);
  const c4b = cikislar(await satirlar(rafR3));
  const r3 = await prisma.roll.findUnique({ where: { id: rafR3 }, select: { status: true, currentStep: { select: { workOrderId: true } } } });
  const klonWo = r3?.currentStep?.workOrderId ?? null;
  if (klonWo && klonWo !== woC.id) woIds.push(klonWo);
  check("§4b NEW_COLOR: raftaki top PRODUCTION_ISSUE aldı, top üretimde", c4b.length === 1 && r3?.status === RollStatus.IN_PRODUCTION, `çıkış=${c4b.length}`);
  check("§4b damga = YENİ iş emrinin geri-giriş adımı (kaynak WO'nun adımı değil)",
    !!klonWo && klonWo !== woC.id && c4b[0]?.workOrderStepId !== null && !woC.steps.some((s) => s.id === c4b[0]?.workOrderStepId),
    klonWo ? (klonWo === woC.id ? "klon WO yok" : "klon WO") : "adım yok");

  // ── §H MUTABAKAT — iki bağımsız kaynak ───────────────────────────────────────
  const canli = await canliStok(rollIds);
  let defter = 0;
  for (const id of rollIds) defter += net(await satirlar(id));
  check("§H ⭐ canlı stok metrajı = Σdefter neti (yazım öncesi boşluk 4 yolda 100·n idi)", canli === defter, `canlıStok=${canli} defterNet=${defter}`);
  check("§H2 üretime giren hiçbir fikstür topu defterde rafta kalmadı", defter === 0 && canli === 0, `defter=${defter}`);

  // ── §Z Körlük zemini ─────────────────────────────────────────────────────────
  let toplam = 0;
  for (const id of rollIds) toplam += (await satirlar(id)).length;
  check("§Z fikstür en az 12 defter satırı üretti (0 bulgu ≠ bakılmadı)", toplam >= 12, `n=${toplam}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    const all = await prisma.roll.findMany({ where: { OR: [{ id: { in: rollIds } }, { parentRollId: { in: rollIds } }] }, select: { id: true } });
    const ids = all.map((r) => r.id);
    if (ids.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollError.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
      await prisma.roll.deleteMany({ where: { parentRollId: { in: ids } } });
      await prisma.roll.deleteMany({ where: { id: { in: ids } } });
    }
    if (woIds.length) {
      const batches = await prisma.batch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
      const bids = batches.map((b) => b.id);
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: woIds } } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.batch.deleteMany({ where: { id: { in: bids }, splitFromId: { not: null } } });
      await prisma.batch.deleteMany({ where: { id: { in: bids } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...bids] } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
