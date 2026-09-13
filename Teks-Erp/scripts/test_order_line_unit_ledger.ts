// =============================================================================
// OrderLine.unit — satır birimi ve metre defteri sınırı (karar ②, 2026-09-13)
// =============================================================================
// Koşum: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_order_line_unit_ledger.ts
//
// Korunan davranış (yanlışlanabilir cümleler):
//   ① Satır yaratılırken `unit` gönderilmezse KALEM KARTINDAN kopyalanır
//      (MT kalem → MT satır, KG kalem → KG satır); açık gönderilen değer kazanır;
//      geçersiz değer 400.
//   ② `update()` ile eklenen yeni satır da kopyalar; mevcut satırın birimi
//      gönderilmediyse DOKUNULMAZ.
//   ③ Sevk defteri METRE tutar: DISPATCHED tahsis MT satırda `shippedQty`ye
//      yazılır, KG satırda YAZILMAZ (0 kalır) — sipariş COMPLETED OLMAZ
//      (PARTIAL_SHIPPED), yanıt `warnings` taşır.
//   ④ Yalnız MT satırlı sipariş BUGÜNKÜ gibi kapanır (COMPLETED) — KG dalı
//      kapatılırken MT dalı kısılmadı.
//   ⑤ Yalnız KG satırlı sipariş: tahsis olsa da shippedQty 0, header Σ 0,
//      durum PARTIAL_SHIPPED ("bir şey çıktı" gerçeği), COMPLETED değil.
//   ⑥ Tolerans tuzağı: 3 kg'lık satır 5 m toleransın altında kalsa bile
//      sipariş kendiliğinden KAPANMAZ.
//   ⑦ Mutabakat §1'in fixture'a daraltılmış kopyası KG satırı görmez
//      (consistency-check.sql'deki `unit = 'MT'` süzgeci; mantık orada değişir).
//   ⑧ İçe aktarım (order.adapter → orderService.create): "Birim" sütunu boşsa
//      kalemden kopya (KG kalem → KG), doluysa etiketle ("Kilogram") → KG,
//      MT kalem + boş → MT.
//   ⑨ MEASURED_LINE (#7, 2026-09-13): metre Σ TALEP KG satırı görmez (üretim
//      dengesi Σ talep 0, satır listesi boş; MT talebi AYNEN — KG birimli MT
//      kalem de dışarıda); "açık" yüzeyleri KG satırı LİSTEDE tutar ama
//      openQty/netOpenQty null + measured:false (linkable, available legacy +
//      cursor); tahsis SÜZÜLMEZ (allocate KG need = quantity); "Miktar (m)"
//      başlığı tam 1 kez (donmuş sözleşme). Stok karnesi davranışsal ölçülmez
//      (talep içsel) — statik ayağı scope_single_source §3.
//
// Negatif sonda (2026-09-13, ölçüldü): `resolveLineUnit` kopyası `MT`ye
// sabitlendi → 11 ❌ (①b ①c ②a ③b–③e ⑤a–⑤c ⑥); `isMeasuredUnit` `true`ya
// sabitlendi → 9 ❌ (①c ③b–③e ⑤a–⑤c ⑥); `order.adapter` birim geçişi kapatıldı →
// 1 ❌ (⑧d). sha256 ile birebir geri yüklendi.
// ⑨ sondası (2026-09-13): production-balance'tan `...MEASURED_LINE` silindi → 3 ❌
// (⑨a Σ 243 · ⑨b 5 satır · ⑨c 75); `isMeasuredLine` hep true → 3 ❌ (⑨e ⑨g ⑨h,
// openQty 100 / measured true). sha256 ile geri yüklendi.
//
// Fixture: TST-OLU-* business-key; hardcoded UUID yok; finally'de FK sırasıyla
// temizlenir. Sipariş numaraları servis üretir → id listesiyle temizlenir.
import { ItemUnit, OrderStatus, ShipmentStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";
import { recomputeOrderStatusTx } from "../src/services/helpers/order-status.helper";
import { ImportService } from "../src/services/import/import.service";
import { ProductionBalanceService } from "../src/services/production-balance.service";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import { allocate } from "../src/services/helpers/allocation.helper";
import { Prisma } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { randomUUID } from "node:crypto";

const ts = Date.now();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const orderIds: string[] = [];
const importTokens: string[] = [];
const TOLERANCE_M = 5;

async function cleanup(): Promise<void> {
  const kuyruk = `-${ts}`;
  await prisma.sackAllocation.deleteMany({
    where: { sack: { sackNo: { startsWith: "TST-OLU-SACK-", endsWith: kuyruk } } },
  });
  await prisma.sack.deleteMany({ where: { sackNo: { startsWith: "TST-OLU-SACK-", endsWith: kuyruk } } });
  await prisma.shipment.deleteMany({ where: { shipmentNo: { startsWith: "TST-OLU-SH-", endsWith: kuyruk } } });
  if (orderIds.length > 0) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (importTokens.length > 0) {
    // SIRA ZORUNLU: ImportRunLine.importRun RESTRICT — önce satırlar.
    await prisma.importRunLine.deleteMany({ where: { importRun: { clientToken: { in: importTokens } } } });
    await prisma.importRun.deleteMany({ where: { clientToken: { in: importTokens } } });
  }
  // ⑨ WO'ları item'dan ÖNCE (targetItemId FK).
  await prisma.workOrder.deleteMany({ where: { workOrderNumber: { startsWith: "TST-OLU-WO-", endsWith: kuyruk } } });
  await prisma.item.deleteMany({ where: { code: { startsWith: "TST-OLU-ITM-", endsWith: kuyruk } } });
  await prisma.customer.deleteMany({ where: { code: `TST-OLU-CUS-${ts}` } });
}

type LineRow = { id: string; itemId: string; unit: ItemUnit; shippedQty: unknown };
async function linesOf(orderId: string): Promise<LineRow[]> {
  return prisma.orderLine.findMany({
    where: { orderId },
    select: { id: true, itemId: true, unit: true, shippedQty: true },
    orderBy: { createdAt: "asc" },
  });
}
async function statusOf(orderId: string): Promise<{ status: OrderStatus; shippedQty: number }> {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, shippedQty: true } });
  return { status: o.status, shippedQty: Number(o.shippedQty) };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`❌ ${engel}`);
    process.exit(1);
  }
  const svc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: [],
    codeSearchFields: ["orderNumber"],
    dateFields: ["createdAt", "deadline"],
    nestedCreateFields: ["lines"],
    defaultInclude: { lines: { include: { item: true } } },
  });

  try {
    const customer = await prisma.customer.create({
      data: { code: `TST-OLU-CUS-${ts}`, name: `Test OLU Müşteri ${ts}` },
      select: { id: true },
    });
    const itemMT = await prisma.item.create({
      data: { code: `TST-OLU-ITM-MT-${ts}`, name: `OLU Kumaş ${ts}`, itemType: "FABRIC", unit: ItemUnit.MT },
      select: { id: true },
    });
    const itemKG = await prisma.item.create({
      data: { code: `TST-OLU-ITM-KG-${ts}`, name: `OLU Örme ${ts}`, itemType: "FABRIC", unit: ItemUnit.KG },
      select: { id: true },
    });

    const createOrder = async (lines: Record<string, unknown>[]) => {
      const res = await svc.create({ customerId: customer.id, lines });
      const data = res.data as { id: string };
      orderIds.push(data.id);
      return { id: data.id, res };
    };

    // ── ① create: kopya + override + geçersiz ─────────────────────────────
    const o1 = await createOrder([
      { itemId: itemMT.id, quantity: 100 },
      { itemId: itemKG.id, quantity: 100 },
    ]);
    const l1 = await linesOf(o1.id);
    const l1MT = l1.find((l) => l.itemId === itemMT.id);
    const l1KG = l1.find((l) => l.itemId === itemKG.id);
    check("①a MT kalem → satır MT (unit gönderilmedi)", l1MT?.unit === ItemUnit.MT, String(l1MT?.unit));
    check("①b KG kalem → satır KG (kalem kartından kopya)", l1KG?.unit === ItemUnit.KG, String(l1KG?.unit));
    check("①c create yanıtı KG satır için warnings taşıyor",
      Array.isArray(o1.res.warnings) && o1.res.warnings.some((w) => /ölçemez/.test(w)),
      JSON.stringify(o1.res.warnings));

    const o2 = await createOrder([{ itemId: itemMT.id, quantity: 10, unit: "KG" }]);
    const l2 = await linesOf(o2.id);
    check("①d açık gönderilen unit kazanır (MT kalem, unit:KG → KG)", l2[0]?.unit === ItemUnit.KG, String(l2[0]?.unit));

    let bad: unknown = null;
    try {
      await svc.create({ customerId: customer.id, lines: [{ itemId: itemMT.id, quantity: 1, unit: "LB" }] });
    } catch (e) {
      bad = e;
    }
    const badStatus = (bad as { statusCode?: number } | null)?.statusCode;
    check("①e geçersiz unit → 400", badStatus === 400, `statusCode=${String(badStatus)}`);

    // ── ② update: yeni satır kopyalar, mevcut satıra dokunmaz ─────────────
    const o3 = await createOrder([{ itemId: itemMT.id, quantity: 50 }]);
    const l3a = await linesOf(o3.id);
    await svc.update(o3.id, {
      lines: [
        { id: l3a[0].id, itemId: itemMT.id, quantity: 50 },
        { itemId: itemKG.id, quantity: 20 },
      ],
    });
    const l3b = await linesOf(o3.id);
    const l3MT = l3b.find((l) => l.id === l3a[0].id);
    const l3KG = l3b.find((l) => l.itemId === itemKG.id);
    check("②a update ile eklenen KG satır kopyalandı", l3KG?.unit === ItemUnit.KG, String(l3KG?.unit));
    check("②b mevcut MT satır unit gönderilmeden DOKUNULMADI", l3MT?.unit === ItemUnit.MT, String(l3MT?.unit));

    // ── sevk fixture'ı: DISPATCHED sevkiyat + çuval + tahsis (metre) ────────
    const dispatchTo = async (suffix: string, allocs: Array<{ lineId: string; qty: number }>) => {
      const sh = await prisma.shipment.create({
        data: { shipmentNo: `TST-OLU-SH-${suffix}-${ts}`, customerId: customer.id, status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() },
        select: { id: true },
      });
      const sk = await prisma.sack.create({ data: { sackNo: `TST-OLU-SACK-${suffix}-${ts}`, shipmentId: sh.id }, select: { id: true } });
      for (const a of allocs) {
        await prisma.sackAllocation.create({ data: { sackId: sk.id, orderLineId: a.lineId, qty: a.qty } });
      }
    };
    const recompute = (orderId: string) =>
      prisma.$transaction((tx) => recomputeOrderStatusTx(tx, orderId, TOLERANCE_M));

    // ── ③ karma sipariş: MT satır ölçülür, KG satır ölçülmez ──────────────
    await dispatchTo("O1", [{ lineId: l1MT!.id, qty: 100 }, { lineId: l1KG!.id, qty: 100 }]);
    await recompute(o1.id);
    const l1s = await linesOf(o1.id);
    const s1 = await statusOf(o1.id);
    check("③a MT satır shippedQty = 100", Number(l1s.find((l) => l.id === l1MT!.id)?.shippedQty) === 100);
    check("③b KG satır shippedQty = 0 (metre defteri yazılmadı)",
      Number(l1s.find((l) => l.id === l1KG!.id)?.shippedQty) === 0,
      String(l1s.find((l) => l.id === l1KG!.id)?.shippedQty));
    check("③c sipariş COMPLETED DEĞİL → PARTIAL_SHIPPED", s1.status === OrderStatus.PARTIAL_SHIPPED, s1.status);
    check("③d header shippedQty yalnız metre Σ = 100", s1.shippedQty === 100, String(s1.shippedQty));
    const detail = await svc.findById(o1.id);
    check("③e findById warnings 'ölçemez' taşıyor",
      Array.isArray(detail.warnings) && detail.warnings.some((w) => /ölçemez/.test(w)),
      JSON.stringify(detail.warnings));

    // ── ④ yalnız MT: bugünkü kapanış korunur ──────────────────────────────
    const o4 = await createOrder([{ itemId: itemMT.id, quantity: 100 }]);
    const l4 = await linesOf(o4.id);
    await dispatchTo("O4", [{ lineId: l4[0].id, qty: 100 }]);
    await recompute(o4.id);
    const s4 = await statusOf(o4.id);
    check("④ yalnız MT satır, 100/100 m → COMPLETED (bugünkü davranış)", s4.status === OrderStatus.COMPLETED, s4.status);
    const d4 = await svc.findById(o4.id);
    check("④b MT siparişte warnings YOK", d4.warnings === undefined, JSON.stringify(d4.warnings));

    // ── ⑤ yalnız KG: tahsis var, ölçüm yok ────────────────────────────────
    const o5 = await createOrder([{ itemId: itemKG.id, quantity: 100 }]);
    const l5 = await linesOf(o5.id);
    await dispatchTo("O5", [{ lineId: l5[0].id, qty: 100 }]);
    await recompute(o5.id);
    const l5s = await linesOf(o5.id);
    const s5 = await statusOf(o5.id);
    check("⑤a yalnız KG: satır shippedQty 0", Number(l5s[0].shippedQty) === 0, String(l5s[0].shippedQty));
    check("⑤b yalnız KG: header shippedQty 0", s5.shippedQty === 0, String(s5.shippedQty));
    check("⑤c yalnız KG: 'bir şey çıktı' → PARTIAL_SHIPPED, COMPLETED değil",
      s5.status === OrderStatus.PARTIAL_SHIPPED, s5.status);

    // ── ⑥ tolerans tuzağı ─────────────────────────────────────────────────
    const o6 = await createOrder([
      { itemId: itemMT.id, quantity: 100 },
      { itemId: itemKG.id, quantity: 3 },
    ]);
    const l6 = await linesOf(o6.id);
    await dispatchTo("O6", [{ lineId: l6.find((l) => l.itemId === itemMT.id)!.id, qty: 100 }]);
    await recompute(o6.id);
    const s6 = await statusOf(o6.id);
    check("⑥ 3 kg'lık satır toleransın (5 m) altında olsa da KAPANMAZ",
      s6.status === OrderStatus.PARTIAL_SHIPPED, s6.status);

    // ── ⑦ mutabakat §1 (fixture'a daraltılmış kopya) KG satırı görmez ──────
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT ol.id
      FROM order_lines ol
      LEFT JOIN (
        SELECT sal."orderLineId", SUM(sal.qty) AS toplam
        FROM sack_allocations sal
        JOIN sacks sk ON sk.id = sal."sackId"
        JOIN shipments sh ON sh.id = sk."shipmentId"
        WHERE sh.status = 'DISPATCHED'
        GROUP BY sal."orderLineId"
      ) sa ON sa."orderLineId" = ol.id
      WHERE ol."orderId" = ${o1.id}::uuid
        AND ol."unit" = 'MT'
        AND ol."shippedQty" <> COALESCE(sa.toplam, 0)`;
    check("⑦ §1 süzgeci: KG satır (tahsis 100, shippedQty 0) mutabakata GİRMEZ", rows.length === 0, `${rows.length} satır`);

    // ── ⑧ içe aktarım yolu ─────────────────────────────────────────────────
    // Ham yönetici adı aranmaz — fixture kendi yöneticisini kurar (ortam bağımlılığı tavanı).
    const admin = await ensureTestAdmin();
    const token = randomUUID();
    importTokens.push(token);
    const ref = `TST-OLU-REF-${ts}`;
    const imp = await ImportService.apply(
      "order",
      [
        { rowNo: 1, cells: { ref, customerCode: `TST-OLU-CUS-${ts}`, itemCode: `TST-OLU-ITM-MT-${ts}`, quantity: "10" } },
        { rowNo: 2, cells: { ref, customerCode: `TST-OLU-CUS-${ts}`, itemCode: `TST-OLU-ITM-KG-${ts}`, quantity: "20" } },
        { rowNo: 3, cells: { ref, customerCode: `TST-OLU-CUS-${ts}`, itemCode: `TST-OLU-ITM-MT-${ts}`, quantity: "5", unit: "Kilogram" } },
      ],
      { clientToken: token, fileName: `TST-OLU-${ts}.csv`, mode: "upsert" },
      admin.id,
    );
    const impLines = await prisma.orderLine.findMany({
      where: { order: { customerId: customer.id, id: { notIn: orderIds } } },
      select: { orderId: true, itemId: true, unit: true, quantity: true },
      orderBy: { createdAt: "asc" },
    });
    for (const id of new Set(impLines.map((l) => l.orderId))) orderIds.push(id);
    check("⑧a içe aktarım tek sipariş, 3 satır yazdı", imp.created === 1 && impLines.length === 3,
      `created=${imp.created} lines=${impLines.length} status=${imp.status} failed=${imp.failed}`);
    const q = (n: number) => impLines.find((l) => Number(l.quantity) === n);
    check("⑧b MT kalem + boş Birim → MT", q(10)?.unit === ItemUnit.MT, String(q(10)?.unit));
    check("⑧c KG kalem + boş Birim → KG (kalemden kopya)", q(20)?.unit === ItemUnit.KG, String(q(20)?.unit));
    check("⑧d MT kalem + 'Kilogram' → KG (etiketle açık değer)", q(5)?.unit === ItemUnit.KG, String(q(5)?.unit));

    // ── ⑨ MEASURED_LINE: Σ talep KG'yi görmez, "açık" yüzeyleri null der ──────
    // Fixture hâli: o2 = MT kalem/KG birim 10 · o3 = MT 50 açık + KG 20 · o5 = yalnız
    // KG 100 (tahsis 100 m, shippedQty 0) · içe aktarım MT 10 + KG 20 + KG(etiket) 5.
    const balance = new ProductionBalanceService();
    const sumTalep = (groups: Array<{ talep: Prisma.Decimal }>) =>
      groups.reduce((s, g) => s.plus(g.talep), new Prisma.Decimal(0));
    const balKG = (await balance.getBalance({ itemId: itemKG.id })).data ?? [];
    const talepKG = sumTalep(balKG);
    check("⑨a üretim dengesi: KG kalem TALEBE GİRMEZ (Σ talep 0)", talepKG.isZero(), talepKG.toString());
    const kgLines = balKG.flatMap((g) => g.specs.flatMap((s) => s.lines));
    check("⑨b üretim dengesi: KG satır listesi BOŞ", kgLines.length === 0, `${kgLines.length} satır`);
    const balMT = (await balance.getBalance({ itemId: itemMT.id })).data ?? [];
    const talepMT = sumTalep(balMT);
    // Pozitif kontrol: MT açık = o3 50 + içe aktarım 10 = 60; o2'nin KG BİRİMLİ 10'u DIŞARIDA.
    check("⑨c üretim dengesi: MT talebi AYNEN 60 (KG birimli MT kalem dışarıda)", talepMT.equals(60), talepMT.toString());

    const mkWo = (suffix: string, itemId: string) =>
      prisma.workOrder.create({
        data: { workOrderNumber: `TST-OLU-WO-${suffix}-${ts}`, status: "PLANNED", type: "STOCK_PRODUCTION", targetItemId: itemId },
        select: { id: true },
      });
    const woKG = await mkWo("KG", itemKG.id);
    const woMT = await mkWo("MT", itemMT.id);
    const lkKG = ((await workOrderLinkService.getLinkableOrderLines(woKG.id)).data ?? []).find((l) => l.id === l5[0].id);
    check("⑨d linkable: KG satır LİSTEDE (üretime alınabilir kalır)", lkKG != null);
    check("⑨e linkable: KG satır openQty null + measured false",
      lkKG?.openQty === null && lkKG?.measured === false, JSON.stringify({ openQty: lkKG?.openQty, measured: lkKG?.measured }));
    const lkMT = ((await workOrderLinkService.getLinkableOrderLines(woMT.id)).data ?? []).find((l) => l.id === l3a[0].id);
    check("⑨f linkable: MT satır openQty 50 + measured true",
      lkMT?.openQty === 50 && lkMT?.measured === true, JSON.stringify({ openQty: lkMT?.openQty, measured: lkMT?.measured }));

    type AvailRow = { lineId: string; openQty: unknown; netOpenQty: unknown; measured: boolean };
    const avail = async (p: Parameters<typeof svc.findAvailableOrderLines>[0]) =>
      ((await svc.findAvailableOrderLines(p)) as { data: AvailRow[] }).data;
    const avKG = (await avail({ itemId: itemKG.id })).find((l) => l.lineId === l5[0].id);
    check("⑨g available (legacy): KG satır listede, openQty/netOpenQty null, measured false",
      avKG != null && avKG.openQty === null && avKG.netOpenQty === null && avKG.measured === false,
      JSON.stringify(avKG && { openQty: avKG.openQty, netOpenQty: avKG.netOpenQty, measured: avKG.measured }));
    const avKGc = (await avail({ itemId: itemKG.id, limit: 50, withInProduction: true })).find((l) => l.lineId === l5[0].id);
    check("⑨h available (cursor): KG satır listede, openQty/netOpenQty null, measured false",
      avKGc != null && avKGc.openQty === null && avKGc.netOpenQty === null && avKGc.measured === false,
      JSON.stringify(avKGc && { openQty: avKGc.openQty, netOpenQty: avKGc.netOpenQty, measured: avKGc.measured }));
    const avMT = (await avail({ itemId: itemMT.id })).find((l) => l.lineId === l3a[0].id);
    check("⑨i available (legacy): MT satır openQty 50 + measured true",
      avMT != null && Number(avMT.openQty) === 50 && avMT.measured === true,
      JSON.stringify(avMT && { openQty: String(avMT.openQty), measured: avMT.measured }));

    // Tahsis DEĞİŞMEZ: KG satırın ihtiyacı quantity − shippedQty (= quantity).
    const now = new Date();
    const alloc = allocate(
      [{ itemId: itemKG.id, colorId: null, width: null, currentQty: new Prisma.Decimal(100) }],
      [{ id: "kg", itemId: itemKG.id, colorId: null, width: null, quantity: new Prisma.Decimal(100),
         shippedQty: new Prisma.Decimal(0), deadline: null, orderDate: now, lineCreatedAt: now }],
    );
    check("⑨j allocate(): KG satır need = quantity (tahsis süzülmez, 100)", alloc.get("kg")?.equals(100) === true, alloc.get("kg")?.toString());
    // "Miktar (m)" içe aktarım başlığı DONMUŞ sözleşme (indirilmiş şablon) — tam 1 kez.
    const adapterSrc = fs.readFileSync(path.resolve(__dirname, "..", "src", "services", "import", "adapters", "order.adapter.ts"), "utf8");
    check("⑨k içe aktarım 'Miktar (m)' başlığı tam 1 kez (dokunulmadı)",
      (adapterSrc.match(/label: "Miktar \(m\)"/g) ?? []).length === 1);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Beklenmeyen hata:", err);
  await cleanup().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
