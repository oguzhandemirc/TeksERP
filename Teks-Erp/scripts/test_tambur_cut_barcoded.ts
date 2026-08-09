// Option A doğrulama — Tambur'da BARKODLU top kesilebilir (barkod-reddi kaldırıldı,
// 2026-07-16). Tambur adımında IN_PRODUCTION duran barkodlu bir TOP'u cutOpenFabric
// ile kes; eskiden "Bu Roll açık kumaş değil (barkodlu)" ile reddediliyordu (ölü rulo).
//
// 2026-07-27 yeniden yazım: eski sürüm hardcoded WO/roll UUID'lerine bağlıydı ve
// reseed'de P2025 ile kırılıyordu (repo kuralı: hardcoded UUID yazma). Fixture artık
// dinamik — TEST- prefix'li WO + Tambur adımı + barkodlu top script içinde doğar,
// finally'de sökülür; seed master-data'sı business-key ile çözülür.
import { RollStatus, StationKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

const rollIds: string[] = [];
let woId: string | null = null;

(async () => {
  const svc = new TamburService();
  const stamp = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  try {
    const item = await prisma.item.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
    const station = await prisma.station.findFirstOrThrow({
      where: { kind: StationKind.TAMBUR },
      select: { id: true },
    });
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-IE-BC-${stamp}`, status: "IN_PROGRESS" },
      select: { id: true },
    });
    woId = wo.id;
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
      select: { id: true },
    });
    // Barkodlu TOP — Konumu-Düzelt senaryosu: depodan Tambur'a alınmış barkodlu top.
    const parentBarcode = `TEST-BC-${stamp}`;
    const roll = await prisma.roll.create({
      data: {
        barcode: parentBarcode,
        itemId: item.id,
        initialQty: 300,
        currentQty: 300,
        status: RollStatus.IN_PRODUCTION,
        currentStepId: step.id,
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    rollIds.push(roll.id);
    await prisma.rollMovement.create({
      data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: 300 },
    });
    console.log(`Barkodlu top ${parentBarcode} → Tambur'da IN_PRODUCTION, 300m. Kesiliyor (100m)...`);

    let threw: string | null = null;
    let res: Awaited<ReturnType<typeof svc.cutOpenFabric>> | null = null;
    try {
      res = await svc.cutOpenFabric(roll.id, { lengthMeters: 100, status: "WAREHOUSE" });
    } catch (e) { threw = (e as Error).message; }

    ok(threw === null, `kesim REDDEDİLMEDİ (eski barkod-reddi yok) ${threw ? "→ " + threw.slice(0, 60) : ""}`);
    if (res) {
      const child = res.data?.childRoll as
        | { id: string; barcode: string | null; entrySource: string; parentRollId: string | null }
        | undefined;
      if (child) rollIds.push(child.id);
      ok(!!child && child.barcode !== null && child.barcode !== parentBarcode, `çocuk taze barkodla doğdu (${child?.barcode})`);
      ok(child?.entrySource === "TAMBUR_SPLIT", "çocuk entrySource=TAMBUR_SPLIT");
      ok(child?.parentRollId === roll.id, "çocuk parent'a bağlı");
      ok(res.data?.parentRemainingQty === 200, `parent kalan metraj 200m (${res.data?.parentRemainingQty})`);
      const parent = await prisma.roll.findUniqueOrThrow({
        where: { id: roll.id },
        select: { barcode: true, currentQty: true, status: true },
      });
      ok(parent.barcode === parentBarcode, "parent barkodunu KORUDU");
      ok(Number(parent.currentQty) === 200, `parent metrajı düştü (${Number(parent.currentQty)}m)`);
      ok(parent.status === RollStatus.IN_PRODUCTION, "parent Tambur'da IN_PRODUCTION kaldı (finalize edilmedi)");
    }
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      if (woId) {
        await prisma.systemLog.deleteMany({ where: { recordId: woId } });
        await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
        await prisma.workOrder.delete({ where: { id: woId } });
      }
      console.log("(temizlendi — TEST- fixture WO/adım/toplar silindi)");
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
