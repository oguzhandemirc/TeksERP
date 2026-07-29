// Sipariş "İş Emri" rollup filtresi (filter[woState]) testi.
// Çalıştırma:  npx tsx scripts/test_order_filter_wostate.ts
//
// Semantik sözleşme: OrderService.extraWhere → buildWoStateWhere, Electron
// work-order-rollup.ts (deriveWoRollup) ile birebir aynı sonucu vermeli:
//   aktif küme = CANCELLED + SUPERSEDED hariç bağlı WO'lar
//   NONE=aktif yok · PLANNED=yalnız planlı · IN_PROGRESS=en az bir üretimde
//   VEYA (planlı+tamamlanmış karışımı) · COMPLETED=hepsi tamamlanmış
//
// Veri: tek kullanımlık müşteri + ürün + 7 sipariş + 6 WO (TEST- prefix,
// business-key; hardcoded UUID yok). finally'de temizlenir.
//
// Doğrulananlar:
//   1. NONE → bağsız + yalnız-CANCELLED + yalnız-SUPERSEDED siparişler
//   2. PLANNED → yalnız planlı-WO'lu sipariş
//   3. IN_PROGRESS → üretimdeki + (PLANNED+COMPLETED karışımı) siparişler
//   4. COMPLETED → yalnız tamamlanmış-WO'lu sipariş
//   5. CSV çoklu seçim (PLANNED,COMPLETED) → ikisinin birleşimi
//   6. Geçersiz değer sessizce düşer → filtresiz sonuçla aynı
//   7. total = data uzunluğu (sayfa içinde) — DB-taraflı filtre, UI-taraflı değil

import { Request } from "express";
import { WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { OrderService } from "../src/services/order.service";

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

// parseQueryParams yalnız req.query'yi okur — gerçek HTTP gerekmez.
function makeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

interface OffsetResult {
  data: Array<{ id: string }>;
  pagination: { total: number };
}
const idsOf = (r: OffsetResult): Set<string> => new Set(r.data.map((o) => o.id));
const sameSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

async function main(): Promise<void> {
  const svc = new OrderService({
    modelName: "order",
    tableName: "ORDER",
    searchFields: ["orderNumber"],
    dateFields: ["createdAt", "deadline"],
    defaultInclude: { lines: true },
    nestedCreateFields: ["lines"],
  });

  const ts = Date.now();
  const customer = await prisma.customer.create({
    data: { code: `TST-WOS-CUS-${ts}`, name: "Test WoState Müşteri" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-WOS-ITM-${ts}`, name: "Test WoState Ürün", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });

  const mkOrder = (n: number, lineCount = 1) =>
    prisma.order.create({
      data: {
        orderNumber: `TEST-WOS-${ts}-${n}`,
        customerId: customer.id,
        lines: {
          create: Array.from({ length: lineCount }, () => ({ itemId: item.id, quantity: 100 })),
        },
      },
      select: { id: true, lines: { select: { id: true }, orderBy: { createdAt: "asc" } } },
    });
  const mkWo = (n: number, status: WorkOrderStatus) =>
    prisma.workOrder.create({
      data: { workOrderNumber: `TEST-WOS-WO-${ts}-${n}`, status },
      select: { id: true },
    });
  const link = (workOrderId: string, orderLineId: string) =>
    prisma.workOrderToOrderLine.create({ data: { workOrderId, orderLineId } });

  const orderIds: string[] = [];
  const woIds: string[] = [];

  try {
    // Kompozisyon (→ beklenen rollup):
    //   oNone: bağ yok                          → NONE
    //   oPlanned: PLANNED                       → PLANNED
    //   oInprog: IN_PROGRESS                    → IN_PROGRESS
    //   oMixed: COMPLETED + PLANNED (2 kalem)   → IN_PROGRESS (karışım kararı)
    //   oDone: COMPLETED                        → COMPLETED
    //   oCancelled: yalnız CANCELLED            → NONE (iptal bağ sayılmaz)
    //   oSuperseded: yalnız SUPERSEDED          → NONE (devredilen aktif değil)
    const oNone = await mkOrder(1);
    const oPlanned = await mkOrder(2);
    const oInprog = await mkOrder(3);
    const oMixed = await mkOrder(4, 2);
    const oDone = await mkOrder(5);
    const oCancelled = await mkOrder(6);
    const oSuperseded = await mkOrder(7);
    const all = [oNone, oPlanned, oInprog, oMixed, oDone, oCancelled, oSuperseded];
    orderIds.push(...all.map((o) => o.id));

    const woPlanned = await mkWo(1, WorkOrderStatus.PLANNED);
    const woInprog = await mkWo(2, WorkOrderStatus.IN_PROGRESS);
    const woDoneA = await mkWo(3, WorkOrderStatus.COMPLETED);
    const woPlannedB = await mkWo(4, WorkOrderStatus.PLANNED);
    const woDoneB = await mkWo(5, WorkOrderStatus.COMPLETED);
    const woCancelled = await mkWo(6, WorkOrderStatus.CANCELLED);
    const woSuperseded = await mkWo(7, WorkOrderStatus.SUPERSEDED);
    woIds.push(
      ...[woPlanned, woInprog, woDoneA, woPlannedB, woDoneB, woCancelled, woSuperseded].map(
        (w) => w.id,
      ),
    );

    await link(woPlanned.id, oPlanned.lines[0].id);
    await link(woInprog.id, oInprog.lines[0].id);
    await link(woDoneA.id, oMixed.lines[0].id);
    await link(woPlannedB.id, oMixed.lines[1].id);
    await link(woDoneB.id, oDone.lines[0].id);
    await link(woCancelled.id, oCancelled.lines[0].id);
    await link(woSuperseded.id, oSuperseded.lines[0].id);

    // Sorgular fixture müşterisine daraltılır (customerId skaler → safeFilters geçer).
    const query = (woState?: string) =>
      svc.findAll(
        makeReq({
          "filter[customerId]": customer.id,
          ...(woState !== undefined ? { "filter[woState]": woState } : {}),
          pageSize: "200",
        }),
      ) as Promise<OffsetResult>;

    const rNone = await query("NONE");
    check(
      "1. NONE → bağsız + yalnız-CANCELLED + yalnız-SUPERSEDED",
      sameSet(idsOf(rNone), new Set([oNone.id, oCancelled.id, oSuperseded.id])),
      `total=${rNone.pagination.total}`,
    );

    const rPlanned = await query("PLANNED");
    check(
      "2. PLANNED → yalnız planlı sipariş",
      sameSet(idsOf(rPlanned), new Set([oPlanned.id])),
      `total=${rPlanned.pagination.total}`,
    );

    const rInprog = await query("IN_PROGRESS");
    check(
      "3. IN_PROGRESS → üretimdeki + karışım (PLANNED+COMPLETED)",
      sameSet(idsOf(rInprog), new Set([oInprog.id, oMixed.id])),
      `total=${rInprog.pagination.total}`,
    );

    const rDone = await query("COMPLETED");
    check(
      "4. COMPLETED → yalnız tamamlanmış sipariş",
      sameSet(idsOf(rDone), new Set([oDone.id])),
      `total=${rDone.pagination.total}`,
    );

    const rMulti = await query("PLANNED,COMPLETED");
    check(
      "5. CSV çoklu seçim → planlı + tamamlanmış birleşimi",
      sameSet(idsOf(rMulti), new Set([oPlanned.id, oDone.id])),
      `total=${rMulti.pagination.total}`,
    );

    const rAll = await query();
    const rInvalid = await query("FOO");
    check(
      "6. Geçersiz değer sessizce düşer → filtresizle aynı",
      sameSet(idsOf(rInvalid), idsOf(rAll)) && rAll.data.length === all.length,
      `filtresiz=${rAll.pagination.total} geçersiz=${rInvalid.pagination.total}`,
    );

    check(
      "7. total = data uzunluğu (DB-taraflı filtre)",
      rNone.pagination.total === rNone.data.length &&
        rInprog.pagination.total === rInprog.data.length,
    );
  } finally {
    // Sıra: pivot → sipariş (satırlar cascade) → WO → master. Test kendi yarattığını siler.
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => undefined);
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
