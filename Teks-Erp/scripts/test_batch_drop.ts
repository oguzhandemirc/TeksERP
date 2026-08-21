// =============================================================================
// TEST: PARTİ DÜŞÜRME — `POST /work-orders/:id/batches/:batchId/drop`
// Çalıştır: npx tsx scripts/test_batch_drop.ts
// =============================================================================
//   A) İŞ EMRİ DEVAM EDER: parti düşer, WO IN_PROGRESS kalır, diğer parti dokunulmaz.
//   B) RENGE DUYARLI GERİ ÇEKME: renkli top ham stoğa DEĞİL depoya döner; önizleme
//      bunu `revertStatus` ile önceden söyler (etiket yalan söylemesin).
//   C) `batchId` KURALI: STOCK/SCRAP partiden KOPAR, CANCELLED KALIR.
//      ⚠️ SCRAP K18'de olmadığı için partide kalsaydı lane'de sonsuza dek "üretimde"
//      görünürdü — kontrol tam olarak bunu kilitler.
//   D) PARTİ SİLME: hepsi ayrıldıysa izsiz parti silinir; bir top CANCELLED ise KALIR.
//   E) KART BAYAT + adım yeniden hesap + `noLiveRollsRemain`.
//   F) ENGELLER: birleştirilmiş parti → 409; başka iş emrinin partisi → 400.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, WorkOrderStatus } from "@prisma/client";

const svc = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
async function expectThrow(
  label: string,
  fn: () => Promise<unknown>,
  msgPart?: string,
): Promise<void> {
  let err: string | null = null;
  try {
    await fn();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

let ITEM = "";
let ADMIN = "";
let COLOR = "";
let ST_KURSUN = "";
let ST_TAMBUR = "";
const WIDTH = 250;
const woIds: string[] = [];
const rollIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  return `TST-BDR-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`;
}

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(
    await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }),
    "Item PATOS",
  );
  ADMIN = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin",
  );
  COLOR = need(
    await prisma.color.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif renk",
  );
  ST_KURSUN = need(
    await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }),
    "KURSUN_KK2",
  );
  ST_TAMBUR = need(
    await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }),
    "TAMBUR_1",
  );
}

async function makeWo(): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-BDR-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_KURSUN, stepSequence: 1, status: "PENDING" as const },
          { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" as const },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

/** Bir attach dalgası = bir parti (K3). `colored` → renkli (işlenmiş) top. */
async function attachWave(
  woId: string,
  qtys: number[],
  colored = false,
): Promise<{ batchId: string; rollIds: string[] }> {
  const codes: string[] = [];
  const ids: string[] = [];
  for (const qty of qtys) {
    const code = barcode();
    const r = await prisma.roll.create({
      data: {
        barcode: code,
        itemId: ITEM,
        initialQty: qty,
        currentQty: qty,
        status: RollStatus.STOCK,
        width: WIDTH,
        createdById: ADMIN,
        ...(colored ? { colorId: COLOR } : {}),
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    ids.push(r.id);
    codes.push(code);
  }
  await svc.attachRolls(woId, codes, ADMIN);
  const roll = await prisma.roll.findUnique({ where: { id: ids[0] }, select: { batchId: true } });
  return { batchId: roll!.batchId!, rollIds: ids };
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === A + C + D: iki partili iş emri, biri düşürülüyor ===
    console.log("\n=== A/C/D) Parti düşer, iş emri devam eder; batchId kuralı ===");
    {
      const { woId } = await makeWo();
      const w1 = await attachWave(woId, [100, 200, 300]);
      const w2 = await attachWave(woId, [400]);

      // Kartı önce temiz say ki "bayat işaretlendi" kontrolü anlamlı olsun.
      await prisma.travelerCard.updateMany({
        where: { workOrderId: woId },
        data: { contentDirty: false },
      });

      const preview = (await svc.getBatchDropPreview(woId, w1.batchId)).data as {
        canDrop: boolean;
        rollCount: number;
        otherBatches: unknown[];
      };
      check("önizleme: düşürülebilir", preview.canDrop === true);
      check("önizleme: 3 top", preview.rollCount === 3, String(preview.rollCount));
      check("önizleme: 1 parti daha kalıyor", preview.otherBatches.length === 1);

      const res = (
        await svc.dropBatch(
          woId,
          w1.batchId,
          {
            reason: "Müşteri bu kalemden vazgeçti",
            dispositions: [
              { rollId: w1.rollIds[1], action: "SCRAP" },
              { rollId: w1.rollIds[2], action: "CANCELLED" },
            ],
          },
          ADMIN,
        )
      ).data as {
        droppedCount: number;
        batchDeleted: boolean;
        noLiveRollsRemain: boolean;
      };

      const wo = await prisma.workOrder.findUnique({
        where: { id: woId },
        select: { status: true },
      });
      check("iş emri IN_PROGRESS KALDI", wo?.status === WorkOrderStatus.IN_PROGRESS, String(wo?.status));
      check("3 top düşürüldü", res.droppedCount === 3, String(res.droppedCount));
      check("canlı top kaldı (diğer parti)", res.noLiveRollsRemain === false);

      const r0 = await prisma.roll.findUnique({
        where: { id: w1.rollIds[0] },
        select: { status: true, batchId: true, currentStepId: true },
      });
      const r1 = await prisma.roll.findUnique({
        where: { id: w1.rollIds[1] },
        select: { status: true, batchId: true },
      });
      const r2 = await prisma.roll.findUnique({
        where: { id: w1.rollIds[2] },
        select: { status: true, batchId: true, cancelReason: true, cancelReasonCode: true, preCancelStatus: true },
      });

      check("karar verilmeyen top STOCK", r0?.status === RollStatus.STOCK, String(r0?.status));
      check("STOCK topu partiden KOPTU", r0?.batchId === null);
      check("STOCK topu adımdan çıktı", r0?.currentStepId === null);
      check("fire topu SCRAP", r1?.status === RollStatus.SCRAP, String(r1?.status));
      check("⚠️ SCRAP topu partiden KOPTU (K18'de değil, lane'de görünürdü)", r1?.batchId === null);
      check("hatalı kayıt CANCELLED", r2?.status === RollStatus.CANCELLED, String(r2?.status));
      check("⚠️ CANCELLED topu partide KALDI (K18-gizli tarihçe)", r2?.batchId === w1.batchId);
      check("CANCELLED iptal izi taşıyor", r2?.cancelReason === "Müşteri bu kalemden vazgeçti");
      // Serbest metin (katalogda yok) → sebep KODU uydurulmaz, NULL (2026-08-21).
      check("CANCELLED serbest metinde cancelReasonCode null", r2?.cancelReasonCode === null, String(r2?.cancelReasonCode));
      check("CANCELLED preCancelStatus", r2?.preCancelStatus === RollStatus.IN_PRODUCTION);

      check("parti SİLİNMEDİ (CANCELLED top içinde)", res.batchDeleted === false);
      const stillThere = await prisma.batch.findUnique({ where: { id: w1.batchId } });
      check("parti satırı duruyor", stillThere !== null);

      // Lane kontrolü: düşen partide yalnız K18-gizli top kaldığı için lane BOŞ.
      const branches = (await svc.getBranches(woId)).data as {
        batches: { batchId: string; rollCount: number }[];
      };
      const droppedLane = branches.batches.find((b) => b.batchId === w1.batchId);
      check(
        "lane'de düşen partide canlı top YOK",
        !droppedLane || droppedLane.rollCount === 0,
        `rollCount=${droppedLane?.rollCount}`,
      );
      const keptLane = branches.batches.find((b) => b.batchId === w2.batchId);
      check("diğer parti dokunulmadı", keptLane?.rollCount === 1, String(keptLane?.rollCount));

      const card = await prisma.travelerCard.findFirst({
        where: { workOrderId: woId },
        select: { contentDirty: true },
      });
      check("refakat kartı BAYAT işaretlendi", card?.contentDirty === true);
    }

    // === B) RENGE DUYARLI GERİ ÇEKME ===
    console.log("\n=== B) Renkli top ham stoğa DEĞİL depoya döner ===");
    {
      const { woId } = await makeWo();
      const w = await attachWave(woId, [500], true); // renkli

      const preview = (await svc.getBatchDropPreview(woId, w.batchId)).data as {
        rolls: { id: string; revertStatus: string }[];
      };
      check(
        "önizleme revertStatus = WAREHOUSE",
        preview.rolls[0]?.revertStatus === RollStatus.WAREHOUSE,
        String(preview.rolls[0]?.revertStatus),
      );

      await svc.dropBatch(woId, w.batchId, { reason: "Yanlış iş emri açıldı" }, ADMIN);
      const roll = await prisma.roll.findUnique({
        where: { id: w.rollIds[0] },
        select: { status: true, batchId: true, barcode: true },
      });
      check(
        "renkli top WAREHOUSE'a döndü (STOCK DEĞİL)",
        roll?.status === RollStatus.WAREHOUSE,
        String(roll?.status),
      );
      check("partiden koptu", roll?.batchId === null);
      check("barkodu var (her kumaşa etiket)", Boolean(roll?.barcode));
    }

    // === D2 + E) HEPSİ AYRILDI: parti silinir, canlı top kalmaz ===
    console.log("\n=== D2/E) Tek partili iş emri: parti silinir, noLiveRollsRemain ===");
    {
      const { woId, stepIds } = await makeWo();
      const w = await attachWave(woId, [120, 130]);

      const res = (
        await svc.dropBatch(woId, w.batchId, { reason: "Mükerrer kayıt" }, ADMIN)
      ).data as { batchDeleted: boolean; noLiveRollsRemain: boolean };

      check("izsiz boş parti SİLİNDİ", res.batchDeleted === true);
      const gone = await prisma.batch.findUnique({ where: { id: w.batchId } });
      check("parti satırı yok", gone === null);
      check("canlı top KALMADI", res.noLiveRollsRemain === true);

      const wo = await prisma.workOrder.findUnique({
        where: { id: woId },
        select: { status: true },
      });
      check(
        "⚠️ iş emri COMPLETED YAPILMADI (üretildi demek olurdu)",
        wo?.status === WorkOrderStatus.IN_PROGRESS,
        String(wo?.status),
      );
      const steps = await prisma.workOrderStep.findMany({
        where: { id: { in: stepIds } },
        select: { status: true },
      });
      check("adımlar terminal değil (iş emri canlı)", steps.length === 2);
    }

    // === F) ENGELLER ===
    console.log("\n=== F) Engeller ===");
    {
      const a = await makeWo();
      const b = await makeWo();
      const wa = await attachWave(a.woId, [100]);
      await attachWave(b.woId, [100]);

      await expectThrow(
        "başka iş emrinin partisi → 400",
        () => svc.dropBatch(b.woId, wa.batchId, { reason: "test sebebi" }, ADMIN),
        "bu iş emrine ait değil",
      );
      await expectThrow(
        "gerekçesiz → 400",
        () => svc.dropBatch(a.woId, wa.batchId, { reason: "ab" }, ADMIN),
        "en az 3 karakter",
      );

      // Birleştirilmiş (K17) parti — tarihçe satırı, işlem survivor'da yapılır.
      const other = await attachWave(a.woId, [50]);
      await prisma.batch.update({
        where: { id: wa.batchId },
        data: { mergedIntoId: other.batchId },
      });
      await expectThrow(
        "birleştirilmiş parti → 409",
        () => svc.dropBatch(a.woId, wa.batchId, { reason: "test sebebi" }, ADMIN),
        "birleştirilmiş",
      );
      await prisma.batch.update({ where: { id: wa.batchId }, data: { mergedIntoId: null } });
    }
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { batchId: null } });
    await prisma.travelerCardScan.deleteMany({
      where: { card: { workOrderId: { in: woIds } } },
    });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.updateMany({
      where: { workOrderId: { in: woIds } },
      data: { mergedIntoId: null, splitFromId: null },
    });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
