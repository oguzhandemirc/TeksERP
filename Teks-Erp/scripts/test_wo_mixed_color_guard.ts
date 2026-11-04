// =============================================================================
// Test: Bir iş emri TEK renk / TEK kumaş — karışık sipariş kalemi her yolda 400
// Çalıştır: npx tsx scripts/test_wo_mixed_color_guard.ts
// =============================================================================
// Saha vakası (2026-11): tek iş emrine BEYAZ + EKRU kalem bağlandı, hedef renk NULL
// kaldı, mal boyahaneye renksiz gitti. Eski denetim yalnız `targetColorId === undefined`
// iken koşuyordu (tablet hep `null` gönderir), sonradan bağlama hedef NULL ise hiç
// karşılaştırmıyordu. Kapı TEK helper: `assertWorkOrderLinesSingleSpec`.
//   §0 AST: create · replace · linkOrderLines helper'ı çağırır; kod sabiti yalnız helper'da
//   §1 create: iki renk + null / undefined / açık hedef → 400 WO_LINES_MIXED_COLOR
//   §2 create: tek renk + null → bugünkü davranış (ölçüldü 2026-11-04: 400 "uyuşmuyor"); tek renk + undefined → hedef türer
//   §3 create: karışık kumaş → 400 WO_LINES_MIXED_ITEM (hedef ürün verilse de)
//   §4 replace: iki renk + null / undefined → 400
//   §5 sonradan bağlama, hedef renk NULL: farklı renkli ikinci kalem 400; aynı renk ve renksiz geçer; tek çağrıda karışık 400
//   §6 sonradan bağlama, hedef kumaş NULL: farklı kumaşlı ikinci kalem 400
//   §7 override (uyumsuz bağ): hedef↔kalem farkını düzeltir ama kalemler arası karışıklığı
//      delemez — mevcut BEYAZ bağa EKRU override 400 ve plan (hedef renk) DEĞİŞMEZ
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import ts from "typescript";
import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import {
  WO_LINES_MIXED_COLOR_CODE,
  WO_LINES_MIXED_ITEM_CODE,
} from "../src/services/helpers/workorder-line-spec.helper";

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
interface Caught { statusCode?: number; message: string; code?: string }
async function catchErr(fn: () => Promise<unknown>): Promise<Caught | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; details?: { code?: string } };
    return { statusCode: err.statusCode, message: err.message ?? String(e), code: err.details?.code };
  }
}
const show = (c: Caught | null): string => (c ? `${c.statusCode} ${c.code ?? "-"} ${c.message}` : "hata yok");

// ── §0 AST: kapı üç yolda çağrılıyor, kural tek yerde ─────────────────────────
function methodCalls(file: string, methodName: string, callee: string): boolean {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let found = false;
  const visitBody = (n: ts.Node): void => {
    // Serbest fonksiyon (`assert…(x)`) ya da üye çağrısı (`this.prepareCreate(x)`).
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
      if (name === callee) found = true;
    }
    ts.forEachChild(n, visitBody);
  };
  const visit = (n: ts.Node): void => {
    const isTarget =
      (ts.isMethodDeclaration(n) && n.name.getText(src) === methodName) ||
      (ts.isFunctionDeclaration(n) && n.name?.text === methodName);
    if (isTarget && (n as ts.FunctionLikeDeclarationBase).body) visitBody((n as ts.FunctionLikeDeclarationBase).body!);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}
function section0(): void {
  console.log("\n§0 AST — tek kapı");
  const root = join(__dirname, "..", "src", "services");
  const woFile = join(root, "workorder.service.ts");
  const linkFile = join(root, "workorder-link.service.ts");
  // create (quickStart + üretim önerisi de) → createFresh → prepareCreate → kapı.
  check("create() → createFresh", methodCalls(woFile, "create", "createFresh"));
  check("createFresh() → prepareCreate", methodCalls(woFile, "createFresh", "prepareCreate"));
  check("quickStartFresh() → create", methodCalls(woFile, "quickStartFresh", "create"));
  for (const [file, method] of [[woFile, "prepareCreate"], [woFile, "replace"], [linkFile, "assertLinkSetSingleSpec"]] as const) {
    check(`${method}() → assertWorkOrderLinesSingleSpec çağırır`, methodCalls(file, method, "assertWorkOrderLinesSingleSpec"));
  }
  for (const method of ["linkOrderLines", "linkOrderLineWithOverride"]) {
    check(`${method}() → assertLinkSetSingleSpec çağırır`, methodCalls(linkFile, method, "assertLinkSetSingleSpec"));
  }
  // Kod sabitinin literal'i yalnız helper'da — ikinci bir yerel "karışık renk" kapısı doğmasın.
  for (const f of [woFile, linkFile]) {
    const txt = readFileSync(f, "utf8");
    check(`${f.split("/").pop()} WO_LINES_MIXED_* literal'i taşımaz`, !/"WO_LINES_MIXED_(COLOR|ITEM)"/.test(txt));
  }
}

const woService = new WorkOrderService();
const ts0 = Date.now();
const created = { customers: [] as string[], items: [] as string[], colors: [] as string[], orders: [] as string[], wos: [] as string[], stations: [] as string[] };

async function main(): Promise<void> {
  section0();
  try {
    const customer = await prisma.customer.create({
      data: { code: `TEST-WOMIX-CUS-${ts0}`, name: `TEST WOMIX MUSTERI ${ts0}` },
      select: { id: true },
    });
    created.customers.push(customer.id);
    const itemA = await prisma.item.create({
      data: { code: `TEST-WOMIX-ITA-${ts0}`, name: `TEST WOMIX KUMAS A ${ts0}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    const itemB = await prisma.item.create({
      data: { code: `TEST-WOMIX-ITB-${ts0}`, name: `TEST WOMIX KUMAS B ${ts0}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    created.items.push(itemA.id, itemB.id);
    const beyaz = await prisma.color.create({ data: { code: `TEST-WOMIX-BYZ-${ts0}`, name: `TEST BEYAZ ${ts0}` }, select: { id: true } });
    const ekru = await prisma.color.create({ data: { code: `TEST-WOMIX-EKR-${ts0}`, name: `TEST EKRU ${ts0}` }, select: { id: true } });
    created.colors.push(beyaz.id, ekru.id);
    const station = await prisma.station.create({
      data: { code: `TEST-WOMIX-ST-${ts0}`, name: `TEST WOMIX ST ${ts0}`, type: "INTERNAL", kind: "OTHER", appliesColor: true },
      select: { id: true },
    });
    created.stations.push(station.id);
    const steps = [{ stationId: station.id }];

    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-WOMIX-ORD-${ts0}`,
        customerId: customer.id,
        lines: {
          create: [
            { itemId: itemA.id, colorId: beyaz.id, width: 300, quantity: 500 },
            { itemId: itemA.id, colorId: beyaz.id, width: 300, quantity: 400 },
            { itemId: itemA.id, colorId: ekru.id, width: 300, quantity: 300 },
            { itemId: itemB.id, colorId: beyaz.id, width: 300, quantity: 200 },
            { itemId: itemA.id, colorId: null, width: 300, quantity: 100 },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, quantity: true } } },
    });
    created.orders.push(order.id);
    // Kalemler miktarla ayırt edilir (fikstürde her miktar tek).
    const L = (q: number): string => order.lines.find((l) => Number(l.quantity) === q)!.id;
    const BYZ1 = L(500), BYZ2 = L(400), EKR = L(300), B_BYZ = L(200), RENKSIZ = L(100);
    const linkCount = async (woId: string): Promise<number> =>
      prisma.workOrderToOrderLine.count({ where: { workOrderId: woId, unlinkedAt: null } });
    const woCountBefore = await prisma.workOrder.count({ where: { orderLinks: { some: { orderLineId: { in: [BYZ1, EKR] } } } } });

    // ── §1 create: iki renk ────────────────────────────────────────────────
    console.log("\n§1 create — iki renk");
    for (const [label, targetColorId] of [["null", null], ["undefined", undefined], ["açık hedef BEYAZ", beyaz.id]] as const) {
      const e = await catchErr(() => woService.create({ type: "ORDER_PRODUCTION", steps, orderLineIds: [BYZ1, EKR], targetColorId }));
      check(`iki renk + targetColorId ${label} → 400 ${WO_LINES_MIXED_COLOR_CODE}`, e?.statusCode === 400 && e.code === WO_LINES_MIXED_COLOR_CODE, show(e));
    }
    const e1 = await catchErr(() => woService.create({ type: "ORDER_PRODUCTION", steps, orderLineIds: [BYZ1, EKR], targetColorId: null }));
    check("mesaj iki rengi ve sipariş no'yu söyler", !!e1 && e1.message.includes("BEYAZ") && e1.message.includes("EKRU") && e1.message.includes(`TEST-WOMIX-ORD-${ts0}`), e1?.message);
    const woCountAfter = await prisma.workOrder.count({ where: { orderLinks: { some: { orderLineId: { in: [BYZ1, EKR] } } } } });
    check("reddedilen create iş emri/bağ yazmadı", woCountAfter === woCountBefore, `${woCountBefore} → ${woCountAfter}`);

    // ── §2 create: tek renk (bugünkü davranış) ───────────────────────────────
    console.log("\n§2 create — tek renk (bugünkü davranış korunur)");
    // Ölçüldü (2026-11-04, main `ecaff2891`, değişiklikten önce): tek renk + null → 400 "Hedef renk ... uyuşmuyor".
    const e2 = await catchErr(() => woService.create({ type: "ORDER_PRODUCTION", steps, orderLineIds: [BYZ1, BYZ2], targetColorId: null }));
    check("tek renk + null → 400 'uyuşmuyor' (karışık-renk kodu DEĞİL)", e2?.statusCode === 400 && e2.code !== WO_LINES_MIXED_COLOR_CODE && e2.message.includes("uyuşmuyor"), show(e2));
    const ok2 = await woService.create({ type: "ORDER_PRODUCTION", steps, orderLineIds: [BYZ1, BYZ2] });
    created.wos.push(ok2.data!.id);
    const wo2 = await prisma.workOrder.findUnique({ where: { id: ok2.data!.id }, select: { targetColorId: true, targetItemId: true } });
    check("tek renk + undefined → hedef renk kalemden türer", wo2?.targetColorId === beyaz.id && wo2.targetItemId === itemA.id);
    const ok2b = await woService.create({ type: "ORDER_PRODUCTION", steps, orderLineIds: [BYZ1, BYZ2], targetColorId: beyaz.id });
    created.wos.push(ok2b.data!.id);
    check("tek renk + aynı açık hedef → geçer", !!ok2b.data?.id);

    // ── §3 create: karışık kumaş ─────────────────────────────────────────────
    console.log("\n§3 create — karışık kumaş");
    for (const [label, targetItemId] of [["hedef yok", undefined], ["hedef A", itemA.id]] as const) {
      const e = await catchErr(() => woService.create({ type: "ORDER_PRODUCTION", steps, orderLineIds: [BYZ1, B_BYZ], targetItemId, targetColorId: beyaz.id }));
      check(`iki kumaş (${label}) → 400 ${WO_LINES_MIXED_ITEM_CODE}`, e?.statusCode === 400 && e.code === WO_LINES_MIXED_ITEM_CODE, show(e));
    }

    // ── §4 replace ───────────────────────────────────────────────────────────
    console.log("\n§4 replace — iki renk");
    const stock = await woService.create({ type: "STOCK_PRODUCTION", targetItemId: itemA.id, steps });
    created.wos.push(stock.data!.id);
    for (const [label, targetColorId] of [["null", null], ["undefined", undefined]] as const) {
      const e = await catchErr(() => woService.replace(stock.data!.id, { targetItemId: itemA.id, steps, orderLineIds: [BYZ1, EKR], targetColorId }));
      check(`replace iki renk + ${label} → 400 ${WO_LINES_MIXED_COLOR_CODE}`, e?.statusCode === 400 && e.code === WO_LINES_MIXED_COLOR_CODE, show(e));
    }
    check("reddedilen replace bağ yazmadı", (await linkCount(stock.data!.id)) === 0);

    // ── §5 sonradan bağlama, hedef renk NULL ─────────────────────────────────
    console.log("\n§5 order-links — hedef renk NULL");
    const nullWo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOMIX-N-${ts0}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemA.id, targetColorId: null },
      select: { id: true },
    });
    created.wos.push(nullWo.id);
    await workOrderLinkService.linkOrderLines(nullWo.id, [BYZ1]);
    check("ilk kalem (BEYAZ) bağlandı", (await linkCount(nullWo.id)) === 1);
    const e5 = await catchErr(() => workOrderLinkService.linkOrderLines(nullWo.id, [EKR]));
    check(`farklı renkli ikinci kalem → 400 ${WO_LINES_MIXED_COLOR_CODE}`, e5?.statusCode === 400 && e5.code === WO_LINES_MIXED_COLOR_CODE, show(e5));
    check("reddedilen bağ yazılmadı", (await linkCount(nullWo.id)) === 1);
    await workOrderLinkService.linkOrderLines(nullWo.id, [BYZ2]);
    check("aynı renkli ikinci kalem geçer", (await linkCount(nullWo.id)) === 2);
    await workOrderLinkService.linkOrderLines(nullWo.id, [RENKSIZ]);
    check("renksiz kalem renkli bağla karışabilir", (await linkCount(nullWo.id)) === 3);
    // Bağı kaldırılmış (unlinkedAt) kalem kümeye girmez: EKRU'yu kaldırılmış bağ olarak ekle → BEYAZ hâlâ geçer.
    const nullWo2 = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOMIX-N2-${ts0}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemA.id, targetColorId: null },
      select: { id: true },
    });
    created.wos.push(nullWo2.id);
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: nullWo2.id, orderLineId: EKR, allocatedQty: 0, unlinkedAt: new Date() } });
    const e5b = await catchErr(() => workOrderLinkService.linkOrderLines(nullWo2.id, [BYZ1]));
    check("kaldırılmış bağın rengi sayılmaz", e5b === null, show(e5b));
    const nullWo3 = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOMIX-N3-${ts0}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemA.id, targetColorId: null },
      select: { id: true },
    });
    created.wos.push(nullWo3.id);
    const e5c = await catchErr(() => workOrderLinkService.linkOrderLines(nullWo3.id, [BYZ1, EKR]));
    check(`tek çağrıda iki renk → 400 ${WO_LINES_MIXED_COLOR_CODE}`, e5c?.statusCode === 400 && e5c.code === WO_LINES_MIXED_COLOR_CODE, show(e5c));

    // ── §6 sonradan bağlama, hedef kumaş NULL ────────────────────────────────
    console.log("\n§6 order-links — hedef kumaş NULL");
    const noItemWo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOMIX-I-${ts0}`, status: "PLANNED", type: "ORDER_PRODUCTION", targetItemId: null, targetColorId: null },
      select: { id: true },
    });
    created.wos.push(noItemWo.id);
    await workOrderLinkService.linkOrderLines(noItemWo.id, [BYZ1]);
    const e6 = await catchErr(() => workOrderLinkService.linkOrderLines(noItemWo.id, [B_BYZ]));
    check(`farklı kumaşlı ikinci kalem → 400 ${WO_LINES_MIXED_ITEM_CODE}`, e6?.statusCode === 400 && e6.code === WO_LINES_MIXED_ITEM_CODE, show(e6));

    // ── §7 override: hedef↔kalem farkı düzelir, kalemler arası karışıklık delinmez ──
    console.log("\n§7 order-links/override — karışık küme");
    const REASON = "TEST womix override sebebi";
    const ovWo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOMIX-O-${ts0}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemA.id, targetColorId: beyaz.id },
      select: { id: true },
    });
    created.wos.push(ovWo.id);
    await workOrderLinkService.linkOrderLines(ovWo.id, [BYZ1]);
    const e7 = await catchErr(() => workOrderLinkService.linkOrderLineWithOverride(ovWo.id, EKR, REASON));
    check(`BEYAZ bağlı iş emrine EKRU override → 400 ${WO_LINES_MIXED_COLOR_CODE}`, e7?.statusCode === 400 && e7.code === WO_LINES_MIXED_COLOR_CODE, show(e7));
    const ovAfter = await prisma.workOrder.findUnique({ where: { id: ovWo.id }, select: { targetColorId: true } });
    check("reddedilen override planı değiştirmedi (hedef hâlâ BEYAZ)", ovAfter?.targetColorId === beyaz.id);
    check("reddedilen override bağ yazmadı", (await linkCount(ovWo.id)) === 1);
    // Belgelenmiş amaç (yanlış renkle açılmış iş emrini kalemin rengine çekmek) çalışmaya devam eder.
    const ovWo2 = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOMIX-O2-${ts0}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemA.id, targetColorId: ekru.id },
      select: { id: true },
    });
    created.wos.push(ovWo2.id);
    const e7b = await catchErr(() => workOrderLinkService.linkOrderLineWithOverride(ovWo2.id, BYZ2, REASON));
    const ov2 = await prisma.workOrder.findUnique({ where: { id: ovWo2.id }, select: { targetColorId: true } });
    check("bağsız iş emrinde override geçer, hedef kalemin rengine döner", e7b === null && ov2?.targetColorId === beyaz.id && (await linkCount(ovWo2.id)) === 1, show(e7b));
  } finally {
    // Sonda/kırmızı koşumda kapı açık kalırsa servis bizim kalemlere iş emri yazar — onları da topla.
    const linked = await prisma.workOrderToOrderLine.findMany({
      where: { orderLine: { orderId: { in: created.orders } } },
      select: { workOrderId: true },
    });
    const wos = [...new Set([...created.wos, ...linked.map((l) => l.workOrderId)])];
    await prisma.systemLog.deleteMany({ where: { recordId: { in: wos } } }).catch(() => {});
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: wos } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: wos } } });
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: { in: wos } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: wos } } });
    await prisma.station.deleteMany({ where: { id: { in: created.stations } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.color.deleteMany({ where: { id: { in: created.colors } } });
    await prisma.item.deleteMany({ where: { id: { in: created.items } } });
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
