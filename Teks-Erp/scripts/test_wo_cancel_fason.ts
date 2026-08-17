// =============================================================================
// BEKÇİ — Fasonda top varken iş emri İPTAL EDİLEBİLİR (2026-08-17)
// Çalıştır: npx tsx scripts/test_wo_cancel_fason.ts
// =============================================================================
// Saha şikâyeti: "bir iş emrini iptal etmek çok zor, bazen iptal edilemiyor."
// Sebebi somuttu: fasonda (boyahanede) top varsa iptal SERT ENGELLENİYORDU
// ("fason malı ham stoğa geri dönemez") ve kullanıcının HİÇBİR çıkışı yoktu.
//
// Yeni kural: tamamlanmamış her iş emri iptal EDİLEBİLİR, ama fasondaki mal
// için karar AÇIKÇA verilir — iki seçenek, top top değil TOPLU:
//   RETURN_TO_STOCK → açık sevkler iptal, toplar ham stoğa
//   SCRAP           → açık sevkler iptal, toplar FİRE
//
// Bu bekçinin ölçtüğü üç şey:
//   1. Karar YOKKEN makine-okur kod döner (modal iki düğmeyi çizebilsin diye;
//      uzun bir açıklama metni saha kullanıcısına hiçbir şey anlatmıyordu).
//   2. Her iki karar da GERÇEKTEN uygulanır — top statüsü değişir.
//   3. İptal izi KOLONDA durur (audit 6 ayda arşivleniyor; sebep orada kalırsa
//      "neden iptal edildi" sorusu sessizce cevapsız kalır).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
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

async function errorOf(fn: () => Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { message: string; details?: { code?: string } };
    return { code: e.details?.code, message: e.message };
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const svc = new WorkOrderService();
  const woIds: string[] = [];
  const rollIds: string[] = [];
  let itemId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-CANFAS-${ts}`, name: "TEST CANCEL FASON", itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemId = item.id;
    const station = await prisma.station.findFirst({
      where: { isActive: true, type: "EXTERNAL" },
      select: { id: true },
    });
    check("fason (EXTERNAL) istasyon bulundu", Boolean(station));
    if (!station) return;

    /** Fasonda topu olan bir iş emri kurar. */
    async function makeWo(tag: string) {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-CANFAS-${tag}-${ts}`,
          status: "IN_PROGRESS",
          type: "STOCK_PRODUCTION",
          targetItemId: item.id,
          steps: { create: [{ stationId: station!.id, stepSequence: 1, status: "ACTIVE" }] },
        },
        select: { id: true, steps: { select: { id: true } } },
      });
      woIds.push(wo.id);
      const roll = await prisma.roll.create({
        data: {
          itemId: item.id,
          initialQty: 100,
          currentQty: 100,
          status: "AT_SUBCONTRACTOR",
          currentStepId: wo.steps[0].id,
        },
        select: { id: true },
      });
      rollIds.push(roll.id);
      return { woId: wo.id, rollId: roll.id };
    }

    // ── 1) Karar YOKKEN: makine-okur kod ────────────────────────────────────
    const a = await makeWo("A");
    const err = await errorOf(() => svc.softDelete(a.woId, undefined, { reason: "müşteri vazgeçti" }));
    check("kararsız iptal reddedildi", err !== null);
    check(
      "hata MAKİNE-OKUR kod taşıyor (modal düğmeleri çizebilsin)",
      err?.code === "FASON_DECISION_REQUIRED",
      err?.code ?? err?.message ?? "",
    );

    // ── 2) RETURN_TO_STOCK ──────────────────────────────────────────────────
    await svc.softDelete(a.woId, undefined, {
      reason: "müşteri vazgeçti",
      fasonAction: "RETURN_TO_STOCK",
    });
    const woA = await prisma.workOrder.findUnique({
      where: { id: a.woId },
      select: { status: true, cancelReason: true, cancelledAt: true },
    });
    const rollA = await prisma.roll.findUnique({ where: { id: a.rollId }, select: { status: true } });
    check("iş emri iptal edildi", woA?.status === "CANCELLED", woA?.status ?? "");
    check("fasondaki top HAM STOĞA döndü", rollA?.status === "STOCK", rollA?.status ?? "");

    // ── 3) İptal izi KOLONDA ────────────────────────────────────────────────
    check("iptal sebebi kolonda", woA?.cancelReason === "müşteri vazgeçti", woA?.cancelReason ?? "—");
    check("iptal zamanı kolonda", Boolean(woA?.cancelledAt), woA?.cancelledAt?.toISOString() ?? "—");

    // ── 4) SCRAP ────────────────────────────────────────────────────────────
    const b = await makeWo("B");
    await svc.softDelete(b.woId, undefined, {
      reason: "mal bozuk geldi",
      fasonAction: "SCRAP",
    });
    const rollB = await prisma.roll.findUnique({ where: { id: b.rollId }, select: { status: true } });
    check("FİRE kararında top SCRAP oldu", rollB?.status === "SCRAP", rollB?.status ?? "");

    // ── 5) Fasonsuz iş emri hâlâ tek adımda iptal olur (regresyon) ──────────
    const plain = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-CANFAS-C-${ts}`,
        status: "IN_PROGRESS",
        type: "STOCK_PRODUCTION",
        targetItemId: item.id,
      },
      select: { id: true },
    });
    woIds.push(plain.id);
    await svc.softDelete(plain.id, undefined, { reason: "gereksiz açıldı" });
    const woC = await prisma.workOrder.findUnique({
      where: { id: plain.id },
      select: { status: true },
    });
    check("fasonsuz iptal karar SORMADAN çalışıyor", woC?.status === "CANCELLED", woC?.status ?? "");

    // ── 6) Tamamlanmış iş emri hâlâ iptal EDİLEMEZ (sınır korunuyor) ────────
    const done = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-CANFAS-D-${ts}`,
        status: "COMPLETED",
        type: "STOCK_PRODUCTION",
        targetItemId: item.id,
      },
      select: { id: true },
    });
    woIds.push(done.id);
    const doneErr = await errorOf(() =>
      svc.softDelete(done.id, undefined, { reason: "olmaz", fasonAction: "RETURN_TO_STOCK" }),
    );
    check("tamamlanmış iş emri iptal edilemiyor", doneErr !== null, doneErr?.message ?? "");
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
