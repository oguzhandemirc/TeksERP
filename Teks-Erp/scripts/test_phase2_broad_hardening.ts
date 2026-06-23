// =============================================================================
// TEST: Faz 2 — broad-audit güvenli sertleştirme
// Çalıştır: npx tsx scripts/test_phase2_broad_hardening.ts
// =============================================================================
// Kapsam (en yüksek-sinyal davranış değişiklikleri):
//   A) ColorService hex format guard: geçersiz #RRGGBB reddedilir, geçerli/boş geçer.
//   B) voidCard ATOMİK CLAIM: iki paralel voidCard → tam 1 başarı + tam 1×409
//      (pre-check 400 ≠ claim 409 ayrımıyla claim'in tetiklendiği kanıtlanır).
// Diğer fixler (qualitygrade route-Zod, order.cancel claim, kursun take, preview
// no-swallow) ya HTTP-katmanı ya ağır-setup gerektirdiğinden burada değil; tsc+lint
// + tam suite regresyonu kapsıyor.
// =============================================================================

import prisma from "../src/lib/prisma";
import { ColorService } from "../src/services/color.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { AppError } from "../src/utils/app-error";
import { WorkOrderStatus } from "@prisma/client";

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
function is409(e: unknown): boolean {
  return e instanceof AppError && e.statusCode === 409;
}
function is400(e: unknown): boolean {
  return e instanceof AppError && e.statusCode === 400;
}

const colors = new ColorService({ modelName: "color", tableName: "COLOR" });
const cards = new TravelerCardService();

let ADMIN = "",
  STATION = "";
const woIds: string[] = [];
const colorIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  STATION = need(
    await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "Station BOYA_FASON"
  ).id;
}

// ── A) ColorService hex guard ────────────────────────────────────────────────
async function testColorHex(): Promise<void> {
  console.log("\n=== A) ColorService hex format guard ===");
  let badErr: unknown;
  try {
    await colors.create({ code: "TST-P2-CLR-BAD", name: "test kötü", hex: "zzzz" }, ADMIN);
  } catch (e) {
    badErr = e;
  }
  check("create geçersiz hex → 400", is400(badErr));

  const okRes = await colors.create({ code: "TST-P2-CLR-OK", name: "test iyi", hex: "#1A2B3C" }, ADMIN);
  const okId = (okRes.data as { id?: string } | null)?.id;
  if (okId) colorIds.push(okId);
  check("create geçerli hex → success", okRes.success === true && !!okId);

  const noHexRes = await colors.create({ code: "TST-P2-CLR-NOHEX", name: "test hexsiz" }, ADMIN);
  const noHexId = (noHexRes.data as { id?: string } | null)?.id;
  if (noHexId) colorIds.push(noHexId);
  check("create hex'siz → success (opsiyonel)", noHexRes.success === true);

  let updErr: unknown;
  try {
    if (okId) await colors.update(okId, { hex: "#GGG" }, ADMIN);
  } catch (e) {
    updErr = e;
  }
  check("update geçersiz hex → 400", is400(updErr));
}

// ── B) voidCard atomik claim ─────────────────────────────────────────────────
async function makeWoWithCard(): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `TST-P2-WO-${woIds.length}-${Date.now().toString().slice(-5)}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetQuantity: 100,
      steps: { create: [{ stationId: STATION, stepSequence: 1, status: "PENDING" as const }] },
    },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const card = await prisma.travelerCard.findFirst({
    where: { workOrderId: wo.id, status: "ACTIVE" },
    select: { id: true },
  });
  return need(card, "ACTIVE traveler card").id;
}

async function testVoidCardClaim(): Promise<void> {
  console.log("\n=== B) voidCard atomik claim ===");

  const c1 = await makeWoWithCard();
  const r = await cards.voidCard(c1, "test iptal", ADMIN);
  check("voidCard happy: success", r.success === true);
  const after = await prisma.travelerCard.findUnique({ where: { id: c1 }, select: { status: true } });
  check("voidCard happy: status=VOIDED", after?.status === "VOIDED");

  const c2 = await makeWoWithCard();
  const settled = await Promise.allSettled([
    cards.voidCard(c2, "paralel iptal A", ADMIN),
    cards.voidCard(c2, "paralel iptal B", ADMIN),
  ]);
  const okCount = settled.filter((s) => s.status === "fulfilled").length;
  const conflictCount = settled.filter(
    (s) => s.status === "rejected" && is409((s as PromiseRejectedResult).reason)
  ).length;
  check("paralel voidCard: tam 1 başarılı", okCount === 1, `ok=${okCount}`);
  check("paralel voidCard: tam 1 × 409 (claim)", conflictCount === 1, `409=${conflictCount}`);
}

async function cleanup(): Promise<void> {
  const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cardRows.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.customerColorAlias.deleteMany({ where: { colorId: { in: colorIds } } });
  await prisma.color.deleteMany({ where: { OR: [{ id: { in: colorIds } }, { code: { startsWith: "TST-P2-CLR" } }] } });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    await testColorHex();
    await testVoidCardClaim();
  } finally {
    await cleanup();
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
