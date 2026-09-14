// =============================================================================
// Test: FASON DOKUMA (G2, 2026-09-14) — polimorfik başlık · levent sevki · top kabulü
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts subcontractor_weaving
//
//   §1 Fikstür: fasoncu, çözgü kartı, iki HAZIR levent, SUBCONTRACTED + IN_HOUSE dokuma işi, iş emri.
//   §2 Sevk: başlık dokuma işine bağlı (WO/adım/parti NULL), leventler SHIP_OUT,
//      iş PLANNED → IN_PROGRESS; boş liste 400; in-house iş 409; kapalı iş 409.
//   §3 ⭐ İŞ EMRİ YOLU BAYT BAYT: dokuma sevki iş emri yoluna girince 409
//      `DISPATCH_NOT_WORK_ORDER_BOUND` (cancel · dye overlay · talimat); adım
//      kapsamlı listeler dokuma sevkini göstermez; ROLL sevki başlığı eskisi gibi.
//   §4 Kabul: makbuz dokuma işine bağlı, top `entrySource=WEAVING` + `parentReceiptId`,
//      partisiz, stok defterine ENTRY_RECEIPT; token replay aynı makbuz; kötü satır failed[].
//   §5 `weavingOrderOfRoll` tek okuyucu: RECEIPT yolu · bağsız top null · AST (zincir
//      başka dosyada yok).
//   §6 Ters yollar: makbuz iptali canlı topla 409 BORN_ROLLS_ALIVE, toplar iptal
//      edilince OK; sevk iptali dönmüş leventle 409, sonra SHIP_OUT_CANCEL + READY.
//   §7 DB sedleri: başlık her iki kolu dolu / boş → 23514 (sevk + makbuz).
//   §8 TABLET bağlamı (G2t): opt-in allowlist — cari/depo/fiyat/iş emri anahtarı yok,
//      yalnız dönmemiş leventli sevkler; dokuma kapalıyken servis düzeyinde 403 MODULE_DISABLED.
//
//   Negatif sondalar (kırmızı görülerek): cancel()'dan `assertWorkOrderBound` düşürülünce
//   §3a ❌ · claim'den `executionKind: SUBCONTRACTED` düşürülünce §2d ❌ ·
//   `createInitialEntry`den `parentReceiptId` yazımı düşürülünce §4b/§5a ❌.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Prisma, RollEntrySource, RollStatus, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { returnWarpBeam } from "../src/services/subcontractor-beam.service";
import { InventoryService } from "../src/services/inventory.service";
import { cancelWeavingDispatch, dispatchForWeaving, receiveForWeaving } from "../src/services/subcontractor-weaving.service";
import { cancelWeavingReceipt, getWeavingSubcontractSummary, previewCancelWeavingReceipt } from "../src/services/subcontractor-weaving-receipt.service";
import { weavingOrderOfRoll } from "../src/services/helpers/weaving-order-of-roll.helper";
import { getWeavingTabletContext } from "../src/services/subcontractor-weaving-tablet.service";
import { AppError } from "../src/utils/app-error";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    if (e instanceof Prisma.PrismaClientKnownRequestError) return AppError.conflict(`prisma ${e.code}`, { code: e.code });
    // Beklenmeyen hata da ❌ satırı olsun (bekçinin dili ölmesin): kapı düşerse yol
    // Prisma doğrulama hatasıyla çöker, bu 409 DEĞİLDİR ve öyle raporlanır.
    return new AppError(`beklenmeyen: ${String((e as Error).message ?? e).slice(0, 80)}`, 500, true, { code: "UNEXPECTED" });
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
async function pgHata(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const m = /\b(23\d{3})\b/.exec(String((e as Error).message ?? e));
    return m?.[1] ?? "başka";
  }
}

const TAG = `TEST-FDK-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const svc = new SubcontractorService();
const inventory = new InventoryService();

/** §5b AST: iki zincir yalnız helper'da. */
function astTekOkuyucu(): void {
  const helper = "src/services/helpers/weaving-order-of-roll.helper.ts";
  const ihlal: string[] = [];
  const gez = (dir: string) => {
    for (const ad of readdirSync(dir)) {
      const p = path.join(dir, ad);
      if (statSync(p).isDirectory()) gez(p);
      else if (p.endsWith(".ts") && !p.endsWith(helper)) {
        const t = readFileSync(p, "utf8");
        const receiptZinciri = /parentReceipt\s*:\s*\{[^}]*weavingOrderId/s.test(t);
        const doffZinciri = /doffEvent\s*:\s*\{[^}]*machineRun\s*:\s*\{[^}]*weavingOrderId/s.test(t);
        if (receiptZinciri || doffZinciri) ihlal.push(path.relative(ROOT, p));
      }
    }
  };
  gez(path.join(ROOT, "src"));
  check("§5b ⭐ AST: `parentReceipt→weavingOrderId` / `doffEvent→machineRun→weavingOrderId` zinciri yalnız helper'da", ihlal.length === 0, ihlal.join(", "));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== FASON DOKUMA (G2) BEKÇİSİ ===\n");
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!item) throw new Error("Seed fixture eksik (PATOS)");
  const admin = await ensureTestAdmin();
  const whId = await fixtureWarehouseId();
  const fotoDevere = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, select: { value: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-FAS`, code: `${TAG}-FS`.slice(0, 32), type: StationType.EXTERNAL }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} dokumacı` }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  const beamIds: string[] = [];
  const woIds: string[] = [];
  const weavingIds: string[] = [];
  const dispatchIds: string[] = [];
  const receiptIds: string[] = [];
  const rollIds: string[] = [];

  async function hazirLevent(metre: number): Promise<string> {
    const p = await createWarpBeam({ warpSpecId: spec.id, plannedLengthM: metre, originKind: WarpBeamOrigin.PURCHASED, subcontractorId: sub.id, physicalBeamNo: null });
    beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: metre, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  }
  async function dokumaIsi(n: string, kind: WeavingExecutionKind): Promise<string> {
    const w = await prisma.weavingOrder.create({
      data: {
        weavingOrderNumber: `${TAG}-${n}`,
        itemId: item!.id,
        executionKind: kind,
        subcontractorId: kind === WeavingExecutionKind.SUBCONTRACTED ? sub.id : null,
        status: WeavingOrderStatus.PLANNED,
      },
      select: { id: true },
    });
    weavingIds.push(w.id);
    return w.id;
  }
  const durum = async (id: string): Promise<WarpBeamStatus> => (await prisma.warpBeam.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
  const olay = (id: string) => prisma.warpBeamEvent.findMany({ where: { beamId: id }, orderBy: { createdAt: "asc" }, select: { kind: true } });
  const woDurum = async (id: string) => (await prisma.weavingOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, create: { key: SETTING_KEYS.DEVERE_ENABLED, value: "true" }, update: { value: "true" } });
    console.log("── §1 Fikstür ──");
    const b1 = await hazirLevent(1000);
    const b2 = await hazirLevent(800);
    const fasonIs = await dokumaIsi("F1", WeavingExecutionKind.SUBCONTRACTED);
    const kendiIs = await dokumaIsi("K1", WeavingExecutionKind.IN_HOUSE);
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item.id, steps: { create: [{ stationId: st.id, stepSequence: 1, status: "PENDING" }] } },
      include: { steps: true },
    });
    woIds.push(wo.id);
    check("§1 iki hazır levent READY, fason + in-house dokuma işi PLANNED", (await durum(b1)) === WarpBeamStatus.READY && (await woDurum(fasonIs)) === WeavingOrderStatus.PLANNED);

    console.log("\n── §2 Sevk ──");
    check("§2a boş levent listesi → 400 WEAVING_DISPATCH_EMPTY", kod(await beklenenHata(() => dispatchForWeaving({ weavingOrderId: fasonIs, warpBeamIds: [] }, admin.id))) === "WEAVING_DISPATCH_EMPTY");
    const d1 = await dispatchForWeaving({ weavingOrderId: fasonIs, warpBeamIds: [b1, b2], plateNumber: "34 FD 1" }, admin.id);
    const d1Id = (d1.data as { id: string }).id;
    dispatchIds.push(d1Id);
    const d1Row = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d1Id }, select: { weavingOrderId: true, workOrderId: true, stepId: true, batchId: true, subcontractorId: true, _count: { select: { items: true } } } });
    check("§2b ⭐ başlık dokuma işine bağlı: weavingOrderId dolu, WO/adım/parti NULL, fasoncu işten", d1Row.weavingOrderId === fasonIs && d1Row.workOrderId === null && d1Row.stepId === null && d1Row.batchId === null && d1Row.subcontractorId === sub.id && d1Row._count.items === 2);
    check("§2c leventler SHIPPED_OUT, SHIP_OUT olayı kaleme bağlı", (await durum(b1)) === WarpBeamStatus.SHIPPED_OUT && (await olay(b1)).at(-1)?.kind === "SHIP_OUT");
    check("§2c′ iş PLANNED → IN_PROGRESS (claim)", (await woDurum(fasonIs)) === WeavingOrderStatus.IN_PROGRESS);
    check("§2d ⭐ in-house dokuma işine fason sevki → 409 WEAVING_ORDER_NOT_SUBCONTRACTED", kod(await beklenenHata(() => dispatchForWeaving({ weavingOrderId: kendiIs, warpBeamIds: [b1] }, admin.id))) === "WEAVING_ORDER_NOT_SUBCONTRACTED");
    const kapaliIs = await dokumaIsi("F2", WeavingExecutionKind.SUBCONTRACTED);
    await prisma.weavingOrder.update({ where: { id: kapaliIs }, data: { status: WeavingOrderStatus.COMPLETED } });
    check("§2e kapalı işe sevk → 409 WEAVING_ORDER_NOT_OPEN", kod(await beklenenHata(() => dispatchForWeaving({ weavingOrderId: kapaliIs, warpBeamIds: [b1] }, admin.id))) === "WEAVING_ORDER_NOT_OPEN");

    console.log("\n── §3 İş emri yolu bayt bayt ──");
    check("§3a ⭐ dokuma sevki iş emri iptal yoluna girince 409 DISPATCH_NOT_WORK_ORDER_BOUND", kod(await beklenenHata(() => svc.cancel(d1Id, `${TAG} yanlış yol`, admin.id))) === "DISPATCH_NOT_WORK_ORDER_BOUND");
    check("§3b boya kaplaması / talimat yolu da kapalı → 409", kod(await beklenenHata(() => svc.getDispatchDyeOverlay(d1Id))) === "DISPATCH_NOT_WORK_ORDER_BOUND" && kod(await beklenenHata(() => svc.updateInstruction(d1Id, "x", admin.id))) === "DISPATCH_NOT_WORK_ORDER_BOUND");
    const rollFix = await prisma.roll.create({ data: { barcode: `${TAG}-R1`, itemId: item.id, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, warehouseId: whId, width: 250 }, select: { id: true } });
    rollIds.push(rollFix.id);
    const dWo = await svc.dispatch({ workOrderId: wo.id, stepId: wo.steps[0].id, subcontractorId: sub.id, rollIds: [rollFix.id] }, admin.id);
    const dWoId = (dWo.data as { id: string }).id;
    dispatchIds.push(dWoId);
    const dWoRow = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: dWoId }, select: { weavingOrderId: true, workOrderId: true, stepId: true, batchId: true } });
    check("§3c ROLL sevki başlığı eskisi gibi: WO/adım/parti dolu, weavingOrderId NULL", dWoRow.workOrderId === wo.id && dWoRow.stepId === wo.steps[0].id && !!dWoRow.batchId && dWoRow.weavingOrderId === null);
    const bekleyen = await svc.listPendingReturns();
    const bekleyenIds = JSON.stringify(bekleyen.data);
    check("§3d adım kapsamlı liste dokuma sevkini GÖSTERMEZ, iş emri sevkini gösterir", !bekleyenIds.includes(d1Id) && bekleyenIds.includes(dWoId));

    console.log("\n── §4 Kabul (top doğar) ──");
    const tok = crypto.randomUUID();
    const k1 = await receiveForWeaving({ weavingOrderId: fasonIs, clientToken: tok, manifestNo: "IRS-1", rolls: [{ initialQty: 480, width: 150 }, { initialQty: 470 }, { initialQty: -5 }] }, admin.id);
    const k1d = k1.data as { receipt: { id: string; receiptNo: string }; rolls: { id: string; initialQty: number }[]; failed: { index: number }[] };
    receiptIds.push(k1d.receipt.id);
    rollIds.push(...k1d.rolls.map((r) => r.id));
    const k1Row = await prisma.subcontractorReceipt.findUniqueOrThrow({ where: { id: k1d.receipt.id }, select: { weavingOrderId: true, workOrderId: true, stepId: true, subcontractorId: true } });
    check("§4a makbuz dokuma işine bağlı (WO/adım NULL), 2 top doğdu, 1 satır failed[]", k1Row.weavingOrderId === fasonIs && k1Row.workOrderId === null && k1Row.stepId === null && k1d.rolls.length === 2 && k1d.failed.length === 1 && k1d.failed[0].index === 2);
    const doganlar = await prisma.roll.findMany({ where: { id: { in: k1d.rolls.map((r) => r.id) } }, select: { entrySource: true, parentReceiptId: true, batchId: true, doffEventId: true, status: true, warehouseMovements: { select: { reasonCode: true } } } });
    check("§4b ⭐ doğan top: entrySource=WEAVING, parentReceiptId=makbuz, partisiz, indirmesiz, stok defterinde ENTRY_RECEIPT",
      doganlar.length === 2 && doganlar.every((r) => r.entrySource === RollEntrySource.WEAVING && r.parentReceiptId === k1d.receipt.id && r.batchId === null && r.doffEventId === null && r.warehouseMovements.some((m) => m.reasonCode === "ENTRY_RECEIPT")));
    const k1r = await receiveForWeaving({ weavingOrderId: fasonIs, clientToken: tok, manifestNo: "IRS-1", rolls: [{ initialQty: 480, width: 150 }, { initialQty: 470 }, { initialQty: -5 }] }, admin.id);
    check("§4c token replay (aynı gövde) → aynı makbuz, yeni top YOK", (k1r.data as { receipt: { id: string } }).receipt.id === k1d.receipt.id && (await prisma.roll.count({ where: { parentReceiptId: k1d.receipt.id } })) === 2);
    check("§4c′ aynı token BAŞKA işe → 409 CLIENT_TOKEN_COLLISION (gövde kapısı)", kod(await beklenenHata(() => receiveForWeaving({ weavingOrderId: kendiIs, clientToken: tok, rolls: [{ initialQty: 1 }] }, admin.id))) === "CLIENT_TOKEN_COLLISION");
    check("§2b′ sevk totalQty = Σ levent metresi (consistency §19)", Number((await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d1Id }, select: { totalQty: true } })).totalQty) === 1800);
    check("§4d in-house işe fason kabulü → 409", kod(await beklenenHata(() => receiveForWeaving({ weavingOrderId: kendiIs, rolls: [{ initialQty: 1 }] }, admin.id))) === "WEAVING_ORDER_NOT_SUBCONTRACTED");
    await returnWarpBeam(d1Id, { warpBeamId: b2, lengthM: 30 }, admin.id);
    const ozet = (await getWeavingSubcontractSummary(fasonIs)).data as { totals: { sentM: number; returnedM: number; bornM: number; differenceM: number } };
    check("§4e özet: giden 1800 m · dönen levent 30 m · doğan 950 m · fark 820 (çözgü metresi bazında)", ozet.totals.sentM === 1800 && ozet.totals.returnedM === 30 && ozet.totals.bornM === 950 && ozet.totals.differenceM === 820, JSON.stringify(ozet.totals));

    console.log("\n── §5 weavingOrderOfRoll ──");
    const via = await weavingOrderOfRoll(prisma, k1d.rolls[0].id);
    check("§5a makbuzdan doğan top → { via: RECEIPT, dokuma işi }", via?.via === "RECEIPT" && via.weavingOrderId === fasonIs);
    check("§5a′ bağsız top → null (uydurulmaz)", (await weavingOrderOfRoll(prisma, rollFix.id)) === null);
    astTekOkuyucu();

    console.log("\n── §6 Ters yollar ──");
    const onizleme = (await previewCancelWeavingReceipt(k1d.receipt.id)).data as { canCancel: boolean; aliveCount: number };
    check("§6a makbuz iptali önizlemesi: 2 canlı top, canCancel false", !onizleme.canCancel && onizleme.aliveCount === 2);
    check("§6b canlı topla makbuz iptali → 409 BORN_ROLLS_ALIVE (barkodlar adıyla)", kod(await beklenenHata(() => cancelWeavingReceipt(k1d.receipt.id, `${TAG} iptal`, admin.id))) === "BORN_ROLLS_ALIVE");
    for (const r of k1d.rolls) await inventory.softDelete(r.id, admin.id, { reason: `${TAG} top iptal`, confirmActive: true });
    check("§6c toplar iptal edilince makbuz iptali OK (cancelledAt üçlüsü)", (await cancelWeavingReceipt(k1d.receipt.id, `${TAG} iptal`, admin.id)).success && (await prisma.subcontractorReceipt.findUniqueOrThrow({ where: { id: k1d.receipt.id }, select: { cancelledAt: true } })).cancelledAt !== null);
    check("§6c′ iptal makbuzun topu artık dokuma işine bağlı SAYILMAZ", (await weavingOrderOfRoll(prisma, k1d.rolls[0].id)) === null);
    check("§6d dönmüş levent varken sevk iptali → 409 WARP_BEAM_RETURNED", kod(await beklenenHata(() => cancelWeavingDispatch(d1Id, `${TAG} iptal`, admin.id))) === "WARP_BEAM_RETURNED");
    const d2 = await dispatchForWeaving({ weavingOrderId: fasonIs, warpBeamIds: [b2] }, admin.id); // b2 döndü → READY → yeniden sevk
    const d2Id = (d2.data as { id: string }).id;
    dispatchIds.push(d2Id);
    const ipt = await cancelWeavingDispatch(d2Id, `${TAG} sevk iptal`, admin.id);
    check("§6e sevk iptali: levent READY, SHIP_OUT_CANCEL yazıldı, ikinci iptal 409", ipt.success && (await durum(b2)) === WarpBeamStatus.READY && (await olay(b2)).at(-1)?.kind === "SHIP_OUT_CANCEL" && kod(await beklenenHata(() => cancelWeavingDispatch(d2Id, "tekrar", admin.id))) === "DISPATCH_CANCELLED");
    check("§6f iş emri sevki dokuma iptal yoluna girince 409 DISPATCH_NOT_WEAVING_BOUND", kod(await beklenenHata(() => cancelWeavingDispatch(dWoId, "yanlış yol", admin.id))) === "DISPATCH_NOT_WEAVING_BOUND");

    console.log("\n── §8 Tablet bağlamı (G2t) ──");
    const fotoDokuma = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, select: { value: true } });
    const fotoProd = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.PRODUCTION_ENABLED }, select: { value: true } });
    try {
      await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, create: { key: SETTING_KEYS.DOKUMA_ENABLED, value: "true" }, update: { value: "true" } });
      await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.PRODUCTION_ENABLED }, create: { key: SETTING_KEYS.PRODUCTION_ENABLED, value: "true" }, update: { value: "true" } });
      const ctx = (await getWeavingTabletContext()).data;
      const me = ctx.weavingOrders.find((w) => w.id === fasonIs);
      const IZINLI = ["id", "weavingOrderNumber", "status", "item", "color", "subcontractor", "openDispatches"].sort().join(",");
      check("§8a bağlam açık fason işi taşır, in-house/kapalı işi taşımaz", !!me && !ctx.weavingOrders.some((w) => w.id === kendiIs || w.id === kapaliIs));
      check("§8a′ ⭐ allowlist: iş anahtarları TAM küme, sevk/levent anahtarları dar (cari/depo/fiyat yok)",
        !!me && Object.keys(me).sort().join(",") === IZINLI && me.subcontractor !== null && !("id" in (me.subcontractor as object)) &&
        me.openDispatches.every((d) => Object.keys(d).sort().join(",") === "beams,dispatchId,dispatchNo,dispatchedAt" && d.beams.every((b) => Object.keys(b).sort().join(",") === "beamNo,id,sentM")),
        me ? Object.keys(me).join(",") : "iş yok");
      check("§8b yalnız DÖNMEMİŞ leventler: b1 (fasonda) listede, b2 (döndü) yok; d2 iptal → yok", !!me && me.openDispatches.length === 1 && me.openDispatches[0]!.dispatchId === d1Id && me.openDispatches[0]!.beams.map((b) => b.id).join(",") === b1);
      await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, data: { value: "false" } });
      check("§8c ⭐ dokuma kapalıyken servis düzeyinde 403 MODULE_DISABLED (modul dokuma)", kod(await beklenenHata(() => getWeavingTabletContext())) === "MODULE_DISABLED");
    } finally {
      if (fotoDokuma) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DOKUMA_ENABLED }, data: { value: fotoDokuma.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DOKUMA_ENABLED } });
      if (fotoProd) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.PRODUCTION_ENABLED }, data: { value: fotoProd.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.PRODUCTION_ENABLED } });
    }

    console.log("\n── §7 DB sedleri ──");
    check("§7a sevk başlığı iki kol dolu → 23514", (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_dispatches (id, "dispatchNo", "workOrderId", "stepId", "batchId", "weavingOrderId", "subcontractorId", "totalQty", "updatedAt") VALUES (gen_random_uuid(), ${`${TAG}-X1`}, ${wo.id}::uuid, ${wo.steps[0].id}::uuid, ${dWoRow.batchId}::uuid, ${fasonIs}::uuid, ${sub.id}::uuid, 0, now())`)) === "23514");
    check("§7b sevk başlığı iki kol boş → 23514", (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_dispatches (id, "dispatchNo", "subcontractorId", "totalQty", "updatedAt") VALUES (gen_random_uuid(), ${`${TAG}-X2`}, ${sub.id}::uuid, 0, now())`)) === "23514");
    check("§7c makbuz başlığı iki kol dolu / boş → 23514",
      (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_receipts (id, "receiptNo", "workOrderId", "stepId", "weavingOrderId", "subcontractorId", "updatedAt") VALUES (gen_random_uuid(), ${`${TAG}-X3`}, ${wo.id}::uuid, ${wo.steps[0].id}::uuid, ${fasonIs}::uuid, ${sub.id}::uuid, now())`)) === "23514" &&
      (await pgHata(() => prisma.$executeRaw`INSERT INTO subcontractor_receipts (id, "receiptNo", "subcontractorId", "updatedAt") VALUES (gen_random_uuid(), ${`${TAG}-X4`}, ${sub.id}::uuid, now())`)) === "23514");
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);

  async function temizle(): Promise<void> {
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: weavingIds } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpSpec.delete({ where: { id: spec.id } }).catch(() => undefined);
    await prisma.item.delete({ where: { id: yarn.id } }).catch(() => undefined);
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: st.id } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...dispatchIds, ...receiptIds, ...beamIds, ...woIds, ...weavingIds, ...rollIds] } } });
    if (fotoDevere) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, data: { value: fotoDevere.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_ENABLED } });
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
