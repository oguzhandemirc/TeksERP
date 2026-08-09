// Tambur finalize — WO guard + kapama + çocuk damgası testi (2026-07-27 düzeltmeleri).
// Doğrulananlar:
//   1. İptal edilmiş (CANCELLED) WO'nun Tambur adımındaki top finalize EDİLEMEZ (409)
//      ve top IN_PRODUCTION kalır — eskiden çocuklar doğar, WO COMPLETED'a dirilirdi.
//   2. Canlı WO'da finalize başarır: parent TAMBUR_CONSUMED, kesim + kuyruk çocukları doğar.
//   3. Çocuklar İŞLEMİN YAPILDIĞI Tambur adımını damgalar (producedInStepId=step.id —
//      cutOpenFabric paritesi; eski kod parent'ın producedInStepId'sini kalıtırdı).
//   4. WO kapaması currentStep'ten çözülür: producedInStepId=null parent'ta bile
//      son adım tamamlanınca WO COMPLETED olur (completeWorkOrderIfStepsDone).
//   5. Movement kapanışında qtyOut = qtyIn (istasyona giren işlenmiş metraj) —
//      finalize öncesi cutOpenFabric kesimi olsa bile (eski kod kalan metrajı yazıp
//      istasyon iş-hacmi raporundan kesilen metrajı düşürüyordu).
//   6. WO üretim çıktısı (producedRolls) fasonsuz rotada da sayılır — eski tanım
//      parent=SUBCONTRACTOR_RETURN şartıyla stok-parent'lı çocukları 0 sayıyordu.
// Fixture tamamen TEST- prefix'li ve kendi kendini temizler; seed master-data'sı
// business-key ile çözülür (hardcoded UUID yok).
import { Prisma, RollStatus, StationKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { WorkOrderService } from "../src/services/workorder.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};

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
      data: { workOrderNumber: `TEST-IE-${stamp}`, status: "IN_PROGRESS" },
      select: { id: true },
    });
    woId = wo.id;
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
      select: { id: true },
    });
    const makeRoll = async () => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-WOG-${stamp}-${rollIds.length}`,
          itemId: item.id,
          initialQty: 100,
          currentQty: 100,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: step.id,
          // producedInStepId BİLEREK null (Top Kesme çocuğu senaryosu) — WO
          // çözümü artık currentStep'ten; null köken WO kapamayı engellememeli.
          entrySource: "SUPPLIER_RECEIPT",
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      await prisma.rollMovement.create({
        data: { rollId: r.id, workOrderStepId: step.id, qtyIn: 100 },
      });
      return r;
    };

    // ── 1. CANCELLED WO guard'ı ──
    const roll1 = await makeRoll();
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "CANCELLED" } });
    let threw: string | null = null;
    try {
      await svc.finalize({ rollId: roll1.id, decisions: [], cuts: [{ length: 40, qualityGrade: "1.KALITE", relatedErrorIds: [] }] });
    } catch (e) { threw = (e as Error).message; }
    // NOT: /iptal/i Türkçe 'İ' (U+0130) ile eşleşmez — sabit alt-dizgiyle kontrol.
    ok(threw !== null && threw.includes("finalize edilemez"), "iptal WO'da finalize reddedildi", threw ?? "hata yok!");
    const r1After = await prisma.roll.findUniqueOrThrow({ where: { id: roll1.id }, select: { status: true } });
    ok(r1After.status === RollStatus.IN_PRODUCTION, "top IN_PRODUCTION kaldı (claim tüketmedi)", r1After.status);
    const woCancelled = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { status: true } });
    ok(woCancelled.status === "CANCELLED", "WO CANCELLED kaldı (dirilmedi)", woCancelled.status);

    // ── 2-6. Canlı WO'da: önce kesim (30m), sonra finalize (40m + 30m kuyruk) ──
    await prisma.workOrder.update({ where: { id: wo.id }, data: { status: "IN_PROGRESS" } });
    const cutRes = await svc.cutOpenFabric(roll1.id, { lengthMeters: 30, status: "WAREHOUSE" });
    const preCutChild = cutRes.data?.childRoll as { id: string } | undefined;
    if (preCutChild) rollIds.push(preCutChild.id);
    ok(!!preCutChild, "finalize öncesi cutOpenFabric çocuğu doğdu (30m)");

    const res = await svc.finalize({ rollId: roll1.id, decisions: [], cuts: [{ length: 40, qualityGrade: "1.KALITE", relatedErrorIds: [] }] });
    const children = res.data.splitRolls;
    children.forEach((c) => rollIds.push(c.id));
    ok(children.length === 2, "kesim + kalan kuyruk = 2 çocuk", `n=${children.length}`);
    ok(res.data.originalRoll.status === RollStatus.TAMBUR_CONSUMED, "parent TAMBUR_CONSUMED", res.data.originalRoll.status);
    const stamped = await prisma.roll.findMany({
      where: { id: { in: children.map((c) => c.id) } },
      select: { producedInStepId: true },
    });
    ok(stamped.every((c) => c.producedInStepId === step.id), "çocuklar Tambur adımını damgaladı (producedInStepId=step)", stamped.map((c) => c.producedInStepId ?? "null").join(","));
    const woAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { status: true } });
    ok(woAfter.status === "COMPLETED", "WO kapandı (producedInStepId=null parent'a rağmen)", woAfter.status);
    const stepAfter = await prisma.workOrderStep.findUniqueOrThrow({ where: { id: step.id }, select: { status: true } });
    ok(stepAfter.status === "COMPLETED", "Tambur adımı COMPLETED", stepAfter.status);

    // ── 5. Movement kapanışı qtyOut = qtyIn (kesime rağmen 100, kalan 70 değil) ──
    const closedMove = await prisma.rollMovement.findFirstOrThrow({
      where: { rollId: roll1.id, workOrderStepId: step.id },
      select: { qtyOut: true, qtyIn: true, exitedAt: true },
    });
    ok(closedMove.exitedAt !== null, "Tambur movement'ı kapandı");
    ok(
      closedMove.qtyOut !== null && new Prisma.Decimal(closedMove.qtyOut).equals(100),
      "movement qtyOut = qtyIn (100m — kesilen 30m rapor hacminden düşmedi)",
      `qtyOut=${closedMove.qtyOut}`,
    );

    // ── 5b. İdempotent retry cevabı YALNIZ finalize'ın kendi çocuklarını döner ──
    // (eski davranış: parent'ın TÜM TAMBUR_SPLIT çocukları — pre-cut C0 dahil —
    //  dönüyordu; istemci retry'de C0'a mükerrer etiket basardı.)
    const retry = await svc.finalize({ rollId: roll1.id, decisions: [], cuts: [{ length: 40, qualityGrade: "1.KALITE", relatedErrorIds: [] }] });
    ok(/idempotent/i.test(retry.message ?? ""), "retry idempotent yola düştü", retry.message ?? "");
    ok(
      retry.data.splitRolls.length === 2 &&
        !retry.data.splitRolls.some((c) => c.id === preCutChild?.id),
      "retry cevabı yalnız finalize çocukları (2) — pre-cut çocuğu YOK",
      `n=${retry.data.splitRolls.length}`,
    );

    // ── 6. WO üretim çıktısı fasonsuz rotada sayılıyor (3 çocuk / 100m) ──
    const detail = await new WorkOrderService().findById(wo.id);
    const produced = (detail.data as { producedRolls?: { count: number; totalMeters: unknown } } | null)?.producedRolls;
    ok(produced?.count === 3, "producedRolls.count = 3 (kesim + finalize 2)", `count=${produced?.count}`);
    ok(
      produced != null && new Prisma.Decimal(produced.totalMeters as Prisma.Decimal).equals(100),
      "producedRolls.totalMeters = 100 (fasonsuz rota, eski tanımda 0'dı)",
      `m=${produced?.totalMeters}`,
    );
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      // Söküm: op → movement → property → log → roll → step → WO.
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
