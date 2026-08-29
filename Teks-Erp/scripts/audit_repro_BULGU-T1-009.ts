// =============================================================================
// AUDIT REPRO — BULGU-T1-009: iş emri iptali fason sevkini kapatamazsa
// fasondaki mal telafisiz biçimde içeri alınır (tx DIŞI yazım geri sarılmaz).
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
//
// Mekanizma (workorder.service.ts):
//   prepareFasonCancelDecision (tx DIŞI):
//     · openDispatches = OPEN_OUTSTANDING → cancelBulk(...)          [:3247-3256]
//       ⚠️ dönüş değeri (failed[]) OKUNMAZ
//     · residual AT_SUBCONTRACTOR → prisma.roll.updateMany(IN_PRODUCTION)
//       ⚠️ tx DIŞINDA, KOŞULSUZ, telafisiz                          [:3271-3283]
//   softDelete tx'i (SONRA açılır):
//     · fasonInFlight guard'ı artık AT_SUBCONTRACTOR göremez → count=0 [:3423-3444]
//     · blanket updateMany: IN_PRODUCTION → STOCK                     [:3506-3520]
//   subcontractor.service.cancel(): kısmi makbuz da sevk iptalini engeller
//     (acceptedReceiptItem'da `isPartial` süzgeci YOK)                [:1963-1971]
//   cancelBulk(): AppError'ı yutup failed[]'e yazar                   [:2245-2252]
//
// Beklenen (sağlıklı sistem):
//   A) Sevk iptal edilemiyorsa iş emri iptali de BAŞARISIZ olur ve HİÇBİR
//      kalıcı iz bırakmaz (top AT_SUBCONTRACTOR kalır, sevk açık kalır).
//   B) Hangi dal koşarsa koşsun "açık+outstanding sevk kalemi" ile
//      "topun statüsü fason değil" ASLA aynı anda doğru olamaz.
//
// Gözlenen: aşağıdaki log (audit/repro/BULGU-T1-009.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-009.ts
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production") {
    throw new Error("REPRO: production ortamında koşturulamaz");
  }
  let host = "";
  let db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  }
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db") {
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
  }
}
devDbGuard();

import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";

const STAMP = `AUDITREPRO-T1009-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

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

// Yaratılan her şeyin id'si — finally temizliği için.
const trash = {
  rolls: [] as string[],
  receiptItems: [] as string[],
  receipts: [] as string[],
  dispatchItems: [] as string[],
  dispatches: [] as string[],
  batches: [] as string[],
  steps: [] as string[],
  wos: [] as string[],
  items: [] as string[],
  subs: [] as string[],
};

type Fixture = {
  woId: string;
  fasonStepId: string;
  srcRollId: string;
  bornRollId: string;
  dispatchId: string;
  dispatchNo: string;
};

/**
 * "100 m gitti, 51 m KISMİ kabul edildi, 49 m fasonda kaldı" durumunu birebir
 * kurar (receive() bu durumu böyle bırakır: kaynak top AT_SUBCONTRACTOR kalır,
 * currentQty kalana iner; born top makbuzdan doğar).
 *
 * @param withNextStep  true → fason ARA adım (born top IN_PRODUCTION + nextStep)
 *                      false → fason SON adım (born top WAREHOUSE)
 */
async function makeFixture(
  tag: string,
  itemId: string,
  subId: string,
  fasonStationId: string,
  innerStationId: string,
  withNextStep: boolean,
): Promise<Fixture> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${STAMP}-WO-${tag}`,
      status: "IN_PROGRESS",
      type: "STOCK_PRODUCTION",
      targetItemId: itemId,
      steps: {
        create: withNextStep
          ? [
              { stationId: fasonStationId, stepSequence: 1, status: "ACTIVE" },
              { stationId: innerStationId, stepSequence: 2, status: "PENDING" },
            ]
          : [{ stationId: fasonStationId, stepSequence: 1, status: "ACTIVE" }],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  trash.wos.push(wo.id);
  const steps = [...wo.steps].sort((a, b) => a.stepSequence - b.stepSequence);
  steps.forEach((s) => trash.steps.push(s.id));
  const fasonStep = steps[0]!;
  const nextStep = steps[1] ?? null;

  const batch = await prisma.batch.create({
    data: { batchNumber: `${STAMP.slice(-6)}-${tag}`, workOrderId: wo.id },
    select: { id: true },
  });
  trash.batches.push(batch.id);

  // Kaynak top: 100 m gitti, 51 m döndü → 49 m hâlâ fasonda.
  const src = await prisma.roll.create({
    data: {
      itemId,
      initialQty: 100,
      currentQty: 49,
      status: "AT_SUBCONTRACTOR",
      currentStepId: fasonStep.id,
      batchId: batch.id,
      entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  trash.rolls.push(src.id);

  const dispatch = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `${STAMP}-FS-${tag}`,
      workOrderId: wo.id,
      batchId: batch.id,
      stepId: fasonStep.id,
      subcontractorId: subId,
      totalQty: 100,
    },
    select: { id: true, dispatchNo: true },
  });
  trash.dispatches.push(dispatch.id);

  const di = await prisma.subcontractorDispatchItem.create({
    data: { dispatchId: dispatch.id, rollId: src.id, dispatchedQty: 100 },
    select: { id: true },
  });
  trash.dispatchItems.push(di.id);

  // KISMİ kabul: born top (51 m) — receive() ile birebir aynı alanlar.
  const born = await prisma.roll.create({
    data: {
      itemId,
      initialQty: 51,
      currentQty: 51,
      status: withNextStep ? "IN_PRODUCTION" : "WAREHOUSE",
      form: "ACIK",
      entrySource: "SUBCONTRACTOR_RETURN",
      batchId: batch.id,
      producedInStepId: fasonStep.id,
      currentStepId: nextStep ? nextStep.id : null,
    },
    select: { id: true },
  });
  trash.rolls.push(born.id);

  const receipt = await prisma.subcontractorReceipt.create({
    data: {
      receiptNo: `${STAMP}-SR-${tag}`,
      workOrderId: wo.id,
      stepId: fasonStep.id,
      subcontractorId: subId,
    },
    select: { id: true },
  });
  trash.receipts.push(receipt.id);

  const ri = await prisma.subcontractorReceiptItem.create({
    data: {
      receiptId: receipt.id,
      newRollId: born.id,
      sourceDispatchItemId: di.id,
      receivedQty: 51,
      isPartial: true, // ⚠️ kalemi KAPATMAZ → sevk hâlâ OPEN_OUTSTANDING
    },
    select: { id: true },
  });
  trash.receiptItems.push(ri.id);

  await prisma.roll.update({ where: { id: born.id }, data: { parentReceiptId: receipt.id } });

  return {
    woId: wo.id,
    fasonStepId: fasonStep.id,
    srcRollId: src.id,
    bornRollId: born.id,
    dispatchId: dispatch.id,
    dispatchNo: dispatch.dispatchNo,
  };
}

/** Ölçüm COMMIT SONRASI, DB'DEN (bellekteki dönüş değerine güvenilmez). */
async function measure(f: Fixture) {
  const [src, d, wo] = await Promise.all([
    prisma.roll.findUnique({
      where: { id: f.srcRollId },
      select: { status: true, currentStepId: true, currentQty: true },
    }),
    prisma.subcontractorDispatch.findUnique({
      where: { id: f.dispatchId },
      select: { cancelledAt: true },
    }),
    prisma.workOrder.findUnique({ where: { id: f.woId }, select: { status: true } }),
  ]);
  return {
    rollStatus: src?.status ?? "—",
    rollStep: src?.currentStepId ?? null,
    rollQty: Number(src?.currentQty ?? 0),
    dispatchOpen: d?.cancelledAt === null,
    woStatus: wo?.status ?? "—",
  };
}

async function main(): Promise<void> {
  const svc = new WorkOrderService();
  const subSvc = new SubcontractorService();
  let violations = 0;

  try {
    console.log(`# fixture damgası: ${STAMP}\n`);

    const fasonStation = await prisma.station.findFirst({
      where: { isActive: true, type: "EXTERNAL" },
      select: { id: true },
    });
    const innerStation = await prisma.station.findFirst({
      where: { isActive: true, type: { not: "EXTERNAL" } },
      select: { id: true },
    });
    check("fason (EXTERNAL) + iç istasyon bulundu", Boolean(fasonStation && innerStation));
    if (!fasonStation || !innerStation) return;

    const item = await prisma.item.create({
      data: { code: `${STAMP}-ITM`, name: `${STAMP} KUMAS`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    trash.items.push(item.id);
    const sub = await prisma.subcontractor.create({
      data: { code: `${STAMP}-SUB`.slice(0, 32), name: `${STAMP} BOYAHANE` },
      select: { id: true },
    });
    trash.subs.push(sub.id);

    // ── ÖN KOŞUL: kısmi makbuz sevk iptalini GERÇEKTEN engelliyor mu? ───────
    const pre = await makeFixture("PRE", item.id, sub.id, fasonStation.id, innerStation.id, false);
    const bulk = (await subSvc.cancelBulk(
      { dispatchIds: [pre.dispatchId], reason: "AUDIT REPRO ön koşul ölçümü" },
      undefined,
    )) as { data?: { cancelled: number; failed: Array<{ message: string }> } };
    check(
      "ÖN KOŞUL — kısmi makbuzlu sevk cancelBulk'ta DÜŞÜYOR (failed[])",
      (bulk.data?.cancelled ?? -1) === 0 && (bulk.data?.failed?.length ?? 0) === 1,
      `cancelled=${bulk.data?.cancelled} failed=${JSON.stringify(bulk.data?.failed?.map((x) => x.message))}`,
    );
    check(
      "ÖN KOŞUL — cancelBulk yine de success:true dönüyor (çağıran okumazsa hata kaybolur)",
      (bulk as { success?: boolean }).success === true,
    );

    // ── A) FASON SON ADIM: iptal BAŞARIYLA döner, mal ham stoğa düşer ───────
    console.log("\n── A) Fason SON adım (born top WAREHOUSE) ──");
    const a = await makeFixture("A", item.id, sub.id, fasonStation.id, innerStation.id, false);
    const beforeA = await measure(a);
    console.log(`   önce: roll=${beforeA.rollStatus}(${beforeA.rollQty}m) sevk_açık=${beforeA.dispatchOpen}`);
    const errA = await errorOf(() =>
      svc.softDelete(a.woId, undefined, {
        reason: "AUDIT REPRO: müşteri vazgeçti",
        fasonAction: "RETURN_TO_STOCK",
      }),
    );
    const afterA = await measure(a);
    console.log(
      `   sonra: istek=${errA ? `HATA(${errA.code ?? "-"})` : "BAŞARILI(200)"} ` +
        `roll=${afterA.rollStatus} step=${afterA.rollStep ?? "null"} ` +
        `sevk_açık=${afterA.dispatchOpen} wo=${afterA.woStatus}`,
    );
    const violA = afterA.dispatchOpen && !["AT_SUBCONTRACTOR", "SUBCONTRACTOR_CONSUMED"].includes(afterA.rollStatus);
    if (violA) violations++;
    check(
      "A — DEĞİŞMEZ: açık+outstanding sevkin topu fason statüsünde kalmalı",
      !violA,
      violA
        ? `İHLAL: sevk ${a.dispatchNo} AÇIK ama top ${afterA.rollStatus} (${afterA.rollQty} m iki yerde sayılıyor)`
        : `roll=${afterA.rollStatus}`,
    );

    // ── B) FASON ARA ADIM: tx guard 409 verir ama tx DIŞI yazım KALIR ───────
    console.log("\n── B) Fason ARA adım (born top IN_PRODUCTION + SUBCONTRACTOR_RETURN) ──");
    const b = await makeFixture("B", item.id, sub.id, fasonStation.id, innerStation.id, true);
    const beforeB = await measure(b);
    console.log(`   önce: roll=${beforeB.rollStatus}(${beforeB.rollQty}m) sevk_açık=${beforeB.dispatchOpen}`);
    const errB = await errorOf(() =>
      svc.softDelete(b.woId, undefined, {
        reason: "AUDIT REPRO: müşteri vazgeçti",
        fasonAction: "RETURN_TO_STOCK",
      }),
    );
    const afterB = await measure(b);
    console.log(
      `   sonra: istek=${errB ? `HATA(${errB.code ?? "-"})` : "BAŞARILI(200)"} ` +
        `roll=${afterB.rollStatus} sevk_açık=${afterB.dispatchOpen} wo=${afterB.woStatus}`,
    );
    // İstek REDDEDİLDİYSE hiçbir kalıcı iz kalmamalıdır (atomiklik).
    const violB = Boolean(errB) && afterB.rollStatus !== beforeB.rollStatus;
    if (violB) violations++;
    check(
      "B — İstek reddedildiyse top statüsü DEĞİŞMEMELİ (tx DIŞI yazım telafisiz)",
      !violB,
      violB
        ? `İHLAL: istek 409 döndü ama top ${beforeB.rollStatus} → ${afterB.rollStatus} olarak KALDI`
        : `roll=${afterB.rollStatus}`,
    );

    // B'nin İKİNCİ sonucu — KALICILIK ölçümü: tx DIŞI yazım, kullanıcı "önce
    // kabulü iptal et" talimatını yerine getirse bile YENİ ve BAŞKA bir engel
    // bırakır mı? (cancel() movedRolls guard'ı: status ≠ AT_SUBCONTRACTOR)
    if (violB) {
      // Makbuzu iptal et (kullanıcının yapması söylenen şey) — kendi fixture'ım.
      await prisma.subcontractorReceipt.updateMany({
        where: { id: { in: trash.receipts }, receiptNo: { endsWith: "-SR-B" } },
        data: { cancelledAt: new Date(), cancelReason: "AUDIT REPRO" },
      });
      const errCancel = await errorOf(() => subSvc.cancel(b.dispatchId, "AUDIT REPRO ikinci deneme", undefined));
      const stuck = errCancel?.code === "ROLLS_MOVED_PAST_DISPATCH";
      if (stuck) violations++;
      check(
        "B2 — Makbuz iptal edildikten SONRA sevk iptal edilebilmeli",
        !stuck,
        stuck
          ? `İHLAL: tx DIŞI yazım YENİ bir kilit bıraktı → ${errCancel?.code}: ${errCancel?.message}`
          : errCancel
            ? `başka sebeple düştü: ${errCancel.code ?? ""} ${errCancel.message}`
            : "iptal edilebildi",
      );
    }

    console.log(`\n>>> Toplam ihlal: ${violations}`);
  } finally {
    // FK sırasına göre temizlik — YALNIZ kendi damgamı taşıyanlar.
    const R = trash.rolls;
    await prisma.subcontractorReceiptItem.deleteMany({ where: { id: { in: trash.receiptItems } } }).catch(() => {});
    await prisma.roll.updateMany({ where: { id: { in: R } }, data: { parentReceiptId: null } }).catch(() => {});
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: trash.receipts } } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: trash.dispatchItems } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: trash.dispatches } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: R } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: R } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: R } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: R } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: R } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { id: { in: trash.batches } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: trash.wos } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { id: { in: trash.steps } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: trash.wos } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...trash.wos, ...trash.dispatches] } } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: trash.subs } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: trash.items } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Beklenmeyen hata:", err);
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
