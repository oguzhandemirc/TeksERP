// =============================================================================
// Test: İş emri listesi `filter[fasonda]=1` + kalemler arası kumaş/renk karışıklığı (2.11.3)
// Çalıştır: npx tsx scripts/test_wo_fasonda_ve_renk_karisim.ts
// =============================================================================
// A1: "en az bir topu şu an fasonda" süzgeci — anlam satır rozetiyle
//     (`currentFasonStations`) aynı; sayım listeyle aynı where'den; geçersiz
//     değer 400 INVALID_FILTER_VALUE (eskiden anahtar Prisma'ya sızıp 500 verirdi).
// A2: Bir iş emri tek kumaş + tek renk üretir. Hedef verilmiş olsa da kalemler
//     arası karışıklık 400 (create / replace / link / override yolları).
// Temizlik: finally bloğunda, yalnız kendi ürettiklerini siler.
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import { WorkOrderService } from "../src/services/workorder.service";

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

interface CaughtError {
  message: string;
  statusCode?: number;
  code?: unknown;
}
/** Hata bekleyen çağrılar için: hata özeti, hata YOKSA null. */
async function expectError(fn: () => Promise<unknown>): Promise<CaughtError | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { message?: string; statusCode?: number; details?: { code?: unknown } };
    return { message: e.message ?? String(err), statusCode: e.statusCode, code: e.details?.code };
  }
}
const errStr = (e: CaughtError | null): string => (e ? `${e.statusCode} ${String(e.code)} ${e.message}` : "hata yok");

interface WoRow {
  id: string;
  workOrderNumber: string;
  currentFasonStations?: string[];
}
interface WoResult {
  data: WoRow[];
  pagination: { total: number };
}

async function main(): Promise<void> {
  const ts = Date.now();
  const P = `TEST-WOMIX-${ts}`;
  const items: string[] = [];
  const colors: string[] = [];
  const customers: string[] = [];
  const orders: string[] = [];
  const wos: string[] = [];
  const stations: string[] = [];
  const batches: string[] = [];
  const rolls: string[] = [];
  const svc = new WorkOrderService();

  try {
    const customer = await prisma.customer.create({
      data: { code: `${P}-CUS`, name: `${P} MUSTERI` },
      select: { id: true },
    });
    customers.push(customer.id);
    const itemA = await prisma.item.create({
      data: { code: `${P}-ITA`, name: `${P} KUMAS A`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    const itemB = await prisma.item.create({
      data: { code: `${P}-ITB`, name: `${P} KUMAS B`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    items.push(itemA.id, itemB.id);
    const kirmizi = await prisma.color.create({ data: { code: `${P}-KRM`, name: `${P} KIRMIZI` }, select: { id: true } });
    const mavi = await prisma.color.create({ data: { code: `${P}-MAV`, name: `${P} MAVI` }, select: { id: true } });
    colors.push(kirmizi.id, mavi.id);

    const fasonSt = await prisma.station.create({
      data: { code: `${P}-FSN`, name: `${P} FASON BOYA`, type: "EXTERNAL", kind: "SUBCONTRACTOR" },
      select: { id: true },
    });
    const colorSt = await prisma.station.create({
      data: { code: `${P}-BOY`, name: `${P} IC BOYA`, type: "INTERNAL", kind: "OTHER", appliesColor: true },
      select: { id: true },
    });
    stations.push(fasonSt.id, colorSt.id);

    // ── §1 A1: filter[fasonda] ─────────────────────────────────────────────
    const mkWo = async (suffix: string): Promise<{ woId: string; stepId: string; batchId: string }> => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${P}-IE-${suffix}`,
          status: "IN_PROGRESS",
          type: "STOCK_PRODUCTION",
          targetItemId: itemA.id,
          width: 300,
          steps: { create: [{ stationId: fasonSt.id, stepSequence: 1 }] },
        },
        select: { id: true, steps: { select: { id: true } } },
      });
      wos.push(wo.id);
      const b = await prisma.batch.create({
        data: { batchNumber: `${P}-B-${suffix}`.slice(0, 60), workOrderId: wo.id },
        select: { id: true },
      });
      batches.push(b.id);
      return { woId: wo.id, stepId: wo.steps[0]!.id, batchId: b.id };
    };
    const mkRoll = async (batchId: string, stepId: string, status: "AT_SUBCONTRACTOR" | "IN_PRODUCTION"): Promise<void> => {
      const r = await prisma.roll.create({
        data: { itemId: itemA.id, initialQty: 50, currentQty: 50, width: 300, status, batchId, currentStepId: stepId },
        select: { id: true },
      });
      rolls.push(r.id);
    };
    const woA = await mkWo("A"); // kısmi fason: bir top dışarıda, bir top içeride
    await mkRoll(woA.batchId, woA.stepId, "AT_SUBCONTRACTOR");
    await mkRoll(woA.batchId, woA.stepId, "IN_PRODUCTION");
    const woB = await mkWo("B"); // fasonu yok
    await mkRoll(woB.batchId, woB.stepId, "IN_PRODUCTION");

    const list = async (q: Record<string, string>): Promise<WoResult> =>
      (await svc.findAll({ query: { search: `${P}-IE`, pageSize: "200", ...q } } as unknown as Request)) as WoResult;

    const all = await list({});
    check("süzgeçsiz: A ve B listede", all.data.some((w) => w.id === woA.woId) && all.data.some((w) => w.id === woB.woId), String(all.data.length));
    const f1 = await list({ "filter[fasonda]": "1" });
    check("fasonda=1: kısmi fasondaki A görünür", f1.data.some((w) => w.id === woA.woId));
    check("fasonda=1: fasonu olmayan B görünmez", !f1.data.some((w) => w.id === woB.woId));
    check("fasonda=1: sayım = liste", f1.pagination.total === f1.data.length && f1.data.length === 1, `${f1.pagination.total}/${f1.data.length}`);
    const rowA = f1.data.find((w) => w.id === woA.woId);
    check("fasonda=1: A satırında fason rozeti dolu (aynı anlam)", (rowA?.currentFasonStations?.length ?? 0) > 0, JSON.stringify(rowA?.currentFasonStations));
    const fTrue = await list({ "filter[fasonda]": "true" });
    check("fasonda=true da çalışır", fTrue.data.length === 1 && fTrue.data[0]!.id === woA.woId);
    for (const bad of ["0", "yes"]) {
      const e = await expectError(() => list({ "filter[fasonda]": bad }));
      check(`fasonda=${bad} → 400 INVALID_FILTER_VALUE`, e?.statusCode === 400 && e.code === "INVALID_FILTER_VALUE", errStr(e));
    }

    // ── Sipariş: karışık kalemler ──────────────────────────────────────────
    const order = await prisma.order.create({
      data: {
        orderNumber: `${P}-ORD`,
        customerId: customer.id,
        lines: {
          create: [
            { itemId: itemA.id, colorId: kirmizi.id, width: 300, quantity: 100 },
            { itemId: itemA.id, colorId: mavi.id, width: 300, quantity: 100 },
            { itemId: itemB.id, colorId: kirmizi.id, width: 300, quantity: 100 },
            { itemId: itemA.id, colorId: null, width: 300, quantity: 100 },
            { itemId: itemA.id, colorId: kirmizi.id, width: 300, quantity: 50 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, itemId: true, colorId: true, quantity: true } } },
    });
    orders.push(order.id);
    const L = order.lines;
    const aRed = L.find((l) => l.itemId === itemA.id && l.colorId === kirmizi.id && Number(l.quantity) === 100)!;
    const aRed2 = L.find((l) => l.itemId === itemA.id && l.colorId === kirmizi.id && Number(l.quantity) === 50)!;
    const aBlue = L.find((l) => l.itemId === itemA.id && l.colorId === mavi.id)!;
    const bRed = L.find((l) => l.itemId === itemB.id)!;
    const aNone = L.find((l) => l.itemId === itemA.id && l.colorId === null)!;
    const steps = [{ stationId: colorSt.id }];

    // ── §2 create: iki renk ─────────────────────────────────────────────────
    const eNull = await expectError(() =>
      svc.create({ type: "ORDER_PRODUCTION", targetItemId: itemA.id, targetColorId: null, width: 300, steps, orderLineIds: [aRed.id, aBlue.id] }),
    );
    check("create: iki renk + targetColorId:null → 400 MIXED_COLOR", eNull?.statusCode === 400 && eNull.code === "WORK_ORDER_MIXED_COLOR", errStr(eNull));
    const eUndef = await expectError(() =>
      svc.create({ type: "ORDER_PRODUCTION", targetItemId: itemA.id, width: 300, steps, orderLineIds: [aRed.id, aBlue.id] }),
    );
    check("create: iki renk + targetColorId yok → 400 MIXED_COLOR", eUndef?.statusCode === 400 && eUndef.code === "WORK_ORDER_MIXED_COLOR", errStr(eUndef));
    const eExplicit = await expectError(() =>
      svc.create({ type: "ORDER_PRODUCTION", targetItemId: itemA.id, targetColorId: kirmizi.id, width: 300, steps, orderLineIds: [aRed.id, aBlue.id] }),
    );
    check("create: iki renk + açık hedef renk → 400 MIXED_COLOR", eExplicit?.statusCode === 400 && eExplicit.code === "WORK_ORDER_MIXED_COLOR", errStr(eExplicit));

    // ── §3 create: karışık kumaş + açık hedef ──────────────────────────────
    const eItem = await expectError(() =>
      svc.create({ type: "ORDER_PRODUCTION", targetItemId: itemA.id, targetColorId: kirmizi.id, width: 300, steps, orderLineIds: [aRed.id, bRed.id] }),
    );
    check("create: karışık kumaş + açık hedef kumaş → 400 MIXED_ITEM", eItem?.statusCode === 400 && eItem.code === "WORK_ORDER_MIXED_ITEM", errStr(eItem));

    // ── §6 pozitif: tek renk (+ renksiz kalem) mevcut davranış ─────────────
    const okSingle = await svc.create({ type: "ORDER_PRODUCTION", width: 300, steps, orderLineIds: [aRed.id, aRed2.id] });
    wos.push(okSingle.data!.id);
    const okSingleWo = await prisma.workOrder.findUnique({ where: { id: okSingle.data!.id }, select: { targetColorId: true, targetItemId: true } });
    check("create: tek renk iki kalem → geçer, hedef kalemden türer", okSingleWo?.targetColorId === kirmizi.id && okSingleWo.targetItemId === itemA.id);
    const okWithNull = await svc.create({ type: "ORDER_PRODUCTION", targetColorId: kirmizi.id, width: 300, steps, orderLineIds: [aRed.id, aNone.id] });
    wos.push(okWithNull.data!.id);
    check("create: KIRMIZI + renksiz kalem, hedef KIRMIZI → geçer", Boolean(okWithNull.data?.id));

    // ── §4 replace ──────────────────────────────────────────────────────────
    const eRep = await expectError(() =>
      svc.replace(okSingle.data!.id, { targetItemId: itemA.id, targetColorId: kirmizi.id, width: 300, steps, orderLineIds: [aRed.id, aBlue.id] }),
    );
    check("replace: iki renk + açık hedef → 400 MIXED_COLOR", eRep?.statusCode === 400 && eRep.code === "WORK_ORDER_MIXED_COLOR", errStr(eRep));
    const eRepItem = await expectError(() =>
      svc.replace(okSingle.data!.id, { targetItemId: itemA.id, targetColorId: kirmizi.id, width: 300, steps, orderLineIds: [aRed.id, bRed.id] }),
    );
    check("replace: karışık kumaş → 400 MIXED_ITEM", eRepItem?.statusCode === 400 && eRepItem.code === "WORK_ORDER_MIXED_ITEM", errStr(eRepItem));

    // ── §5 link: hedef rengi boş iş emri ───────────────────────────────────
    const stockWo = await prisma.workOrder.create({
      data: { workOrderNumber: `${P}-IE-STK`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemA.id, targetColorId: null, width: 300 },
      select: { id: true },
    });
    wos.push(stockWo.id);
    const firstLink = await expectError(() => workOrderLinkService.linkOrderLines(stockWo.id, [aRed.id]));
    check("link: hedef rengi boş WO'ya KIRMIZI kalem → geçer", firstLink === null, errStr(firstLink));
    const eLink = await expectError(() => workOrderLinkService.linkOrderLines(stockWo.id, [aBlue.id]));
    check("link: ardından MAVİ kalem → 400 MIXED_COLOR", eLink?.statusCode === 400 && eLink.code === "WORK_ORDER_MIXED_COLOR", errStr(eLink));
    const eLinkBoth = await expectError(() => workOrderLinkService.linkOrderLines(stockWo.id, [aRed2.id, aBlue.id]));
    check("link: tek istekte KIRMIZI+MAVİ → 400 MIXED_COLOR", eLinkBoth?.statusCode === 400 && eLinkBoth.code === "WORK_ORDER_MIXED_COLOR", errStr(eLinkBoth));
    check(
      "link: reddedilen bağlar YAZILMADI",
      (await prisma.workOrderToOrderLine.count({ where: { workOrderId: stockWo.id } })) === 1,
    );

    // ── §7 override: hedef↔kalem farkını aşar, kalemler ARASI karışıklığı aşmaz ─
    const eOvr = await expectError(() =>
      workOrderLinkService.linkOrderLineWithOverride(stockWo.id, aBlue.id, "test override sebebi", undefined, ["roll:manual-adjust"]),
    );
    check("override: KIRMIZI bağlı WO'ya MAVİ kalem → 400 MIXED_COLOR", eOvr?.statusCode === 400 && eOvr.code === "WORK_ORDER_MIXED_COLOR", errStr(eOvr));
    const afterOvr = await prisma.workOrder.findUnique({ where: { id: stockWo.id }, select: { targetColorId: true } });
    check("override reddinde hedef renk DEĞİŞMEDİ (plan yazılmadan durdu)", afterOvr?.targetColorId === null, String(afterOvr?.targetColorId));
  } finally {
    // Kural bozukken (negatif sonda) yanlışlıkla doğan iş emirleri de numara önekinden toplanır.
    const stray = await prisma.workOrder.findMany({
      where: { OR: [{ workOrderNumber: { startsWith: P } }, { orderLinks: { some: { orderLine: { orderId: { in: orders } } } } }] },
      select: { id: true },
    });
    for (const w of stray) if (!wos.includes(w.id)) wos.push(w.id);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...wos, ...rolls] } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rolls } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: batches } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: wos } } });
    await prisma.station.deleteMany({ where: { id: { in: stations } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } });
    await prisma.color.deleteMany({ where: { id: { in: colors } } });
    await prisma.item.deleteMany({ where: { id: { in: items } } });
    await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
