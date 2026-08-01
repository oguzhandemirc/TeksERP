// =============================================================================
// TEST: getAttachedRolls select daraltması (over-fetch yok) — PR-2
// Çalıştır: npx tsx scripts/test_attached_rolls_select.ts
// =============================================================================
// getAttachedRolls() include:{item,color} (tüm sütunlar) → select (yalnız
// tüketicilerin okuduğu alanlar). Kanıt: dönen toplar HÂLÂ tüketici alanlarını
// (id/barcode/status/currentQty/item.name + color) taşıyor; over-fetch sütunları
// (roll.initialQty/width, item.code, color.createdAt) artık SEÇİLMİYOR. Her iki
// OR dalı (producedInStepId + currentStepId) da kapsanır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderStatus, RollStatus } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

// `getAttachedRolls()` sözleşmesi `ApiResponse<unknown[]>` döndürür — servis dar
// bir `select` yapıyor ama şeklini dışarı vermiyor. Bu yüzden testin doğruladığı
// şekil BURADA açıkça yazılır: aşağıdaki alan kontrolleri artık `unknown`/`{}`
// üzerinde değil, somut bir tip üzerinde derlenir. (Alan adı yanlış yazılırsa
// tsc söyler; eskiden `scripts/` hiç derlenmediği için sessizce geçerdi.)
type AttachedRoll = {
  id: string;
  barcode: string | null;
  status: string;
  currentQty: unknown; // Prisma Decimal — testte yalnız null-değil kontrolü var
  colorId: string | null;
  item: { id: string; name: string } | null;
  color: { id: string; code: string; name: string; hex: string | null } | null;
};

const svc = new WorkOrderService();
let ITEM = "",
  COLOR = "",
  GRADE = "",
  ADMIN = "",
  STATION = "";
const woIds: string[] = [];
const rollBarcodes: string[] = [];
const stamp = Date.now().toString().slice(-7);

async function main(): Promise<void> {
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "1.KALITE").id;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  const allowed = await prisma.itemAllowedColor.findFirst({ where: { itemId: ITEM }, select: { colorId: true } });
  COLOR = allowed ? allowed.colorId : need(await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }), "renk").id;

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-AR-WO-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetItemId: ITEM,
      steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
    },
    include: { steps: true },
  });
  woIds.push(wo.id);
  const stepId = wo.steps[0].id;

  const mkRoll = async (link: "produced" | "current", colorId: string | null): Promise<void> => {
    const barcode = `TST-AR-R${rollBarcodes.length}-${stamp}`;
    rollBarcodes.push(barcode);
    await prisma.roll.create({
      data: {
        barcode,
        itemId: ITEM,
        colorId,
        status: RollStatus.WAREHOUSE,
        currentQty: 100,
        initialQty: 100,
        width: 150,
        qualityGrade: "1.KALITE",
        qualityGradeId: GRADE,
        createdById: ADMIN,
        producedInStepId: link === "produced" ? stepId : null,
        currentStepId: link === "current" ? stepId : null,
      },
      select: { id: true },
    });
  };

  try {
    console.log("\n=== getAttachedRolls select daraltması ===");
    await mkRoll("produced", COLOR); // OR dalı 1
    await mkRoll("current", null); // OR dalı 2 (renksiz ham)

    const res = await svc.getAttachedRolls(wo.id);
    const rolls = res.data as AttachedRoll[];
    check("iki OR dalı da döndü (produced + current)", rolls.length === 2, `count=${rolls.length}`);

    const withColor = rolls.find((r) => r.colorId === COLOR);
    const rawRoll = rolls.find((r) => r.colorId === null);

    // Tüketici alanları MEVCUT (mobil WorkOrderDetailSheet + printWorkOrder)
    check("barcode mevcut", typeof withColor?.barcode === "string");
    check("status mevcut", typeof withColor?.status === "string");
    check("currentQty mevcut", withColor?.currentQty != null);
    check("item.name mevcut", typeof withColor?.item?.name === "string", withColor?.item?.name ?? "yok");
    check("color (renkli top) mevcut", withColor?.color != null && typeof withColor?.color?.hex === "string");
    check("color null (ham top) korunur", rawRoll != null && rawRoll.color === null);

    // Over-fetch YOK: select dışı sütunlar dönmemeli
    check("over-fetch yok: roll.initialQty seçilmedi", (withColor as Record<string, unknown>).initialQty === undefined);
    check("over-fetch yok: roll.width seçilmedi", (withColor as Record<string, unknown>).width === undefined);
    check(
      "over-fetch yok: item yalnız {id,name}",
      withColor?.item != null && (withColor.item as Record<string, unknown>).code === undefined
    );
    check(
      "over-fetch yok: color yalnız {id,code,name,hex}",
      withColor?.color != null && (withColor.color as Record<string, unknown>).createdAt === undefined
    );
  } finally {
    const rolls = await prisma.roll.findMany({ where: { barcode: { startsWith: "TST-AR-R" } }, select: { id: true } });
    await prisma.roll.deleteMany({ where: { id: { in: rolls.map((r) => r.id) } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  }

  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
