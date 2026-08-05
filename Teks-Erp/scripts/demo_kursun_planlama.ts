// =============================================================================
// Kurşun Planlama — EKRAN DENEME VERİSİ (dev/demo)
// =============================================================================
// Kurşun Planlama ekranının iki bölümünü de DOLU görmek için iş emri üretir:
// bekleyen kuyruk (sürükle-bırak sıralama) + iki makineye dağıtılmış işler
// (makine içi sürükle-bırak sıralama).
//
// ⚠️ BU BİR TEST SCRIPTİ DEĞİLDİR (`test_` öneki bilinçli olarak YOK — `npm test`
// toplayıcısına girmemeli; kayıt yaratır ve kendi başına temizlemez).
//
// ⚠️ CANLI FABRİKA DB'sinde KOŞTURMA. Ürettiği her şey `DEMO-KRS` ön ekini taşır
// ve `--cleanup` ile birebir geri alınır; yine de üretim veritabanında sahte iş
// emri = operatörün ekranında sahte iş demektir.
//
// Kullanım:
//   npx tsx scripts/demo_kursun_planlama.ts             # ne yapacağını yazar (varsayılan)
//   npx tsx scripts/demo_kursun_planlama.ts --apply     # üretir
//   npx tsx scripts/demo_kursun_planlama.ts --cleanup   # ürettiklerini siler
//
// Üretilen kurgu:
//   • 5 BEKLEYEN iş emri — biri ACİL (kuyruğun başına pinlenir; sürüklenemez
//     olduğunu görmek için bilerek var), diğer dördü sürüklenebilir.
//   • 4 DAĞITILMIŞ iş emri — 3'ü "Kalite Kontrol - Makine 1", 1'i Makine 2
//     (bir makinede birden çok satır olmadan makine içi sıralama denenemez).
//   • Her iş emri rotası [Kurşun+KK2 → Tambur] → hepsi dağıtıma UYGUN doğar.
//   • Toplar BARKODSUZ açık kumaş (fason dönüşü emsali) ve kurşun adımında AÇIK.
// =============================================================================

import {
  RollForm,
  RollStatus,
  StationKind,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunBypassService } from "../src/services/kursun-bypass.service";

const PREFIX = "DEMO-KRS";
const bypassSvc = new KursunBypassService();

/** Bekleyen kuyruk: [iş emri eki, top metrajları, acil mi] */
const WAITING_SPEC: Array<[string, number[], boolean]> = [
  ["B1", [420, 380], false],
  ["B2", [610], false],
  ["B3", [250, 300, 190], false],
  ["B4", [880], true], // ACİL — kuyruğun başına pinlenir
  ["B5", [530, 470], false],
];

/** Dağıtılmışlar: [iş emri eki, top metrajları, makine sırası (0/1)] */
const ASSIGNED_SPEC: Array<[string, number[], number]> = [
  ["M1-A", [700, 640], 0],
  ["M1-B", [520], 0],
  ["M1-C", [310, 290], 0],
  ["M2-A", [960], 1],
];

async function need<T>(row: T | null | undefined, label: string): Promise<T> {
  if (!row) throw new Error(`Ön koşul eksik: ${label}`);
  return row;
}

async function resolveContext() {
  const item = await need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true, name: true } }),
    "aktif Item",
  );
  const kursun = await need(
    await prisma.station.findFirst({
      where: { kind: StationKind.PROCESS_QC, isActive: true },
      select: { id: true, name: true },
    }),
    "PROCESS_QC istasyonu",
  );
  const tambur = await need(
    await prisma.station.findFirst({
      where: { kind: StationKind.TAMBUR, isActive: true },
      select: { id: true, name: true },
    }),
    "TAMBUR istasyonu",
  );
  const admin = await need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcısı",
  );
  const machines = await prisma.machine.findMany({
    where: { isActive: true, station: { kind: StationKind.PROCESS_QC } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (machines.length === 0) {
    throw new Error(
      "Ön koşul eksik: PROCESS_QC istasyonuna bağlı AKTİF makine yok — dağıtım kurulamaz.",
    );
  }
  return { item, kursun, tambur, admin, machines };
}

type Ctx = Awaited<ReturnType<typeof resolveContext>>;

async function createWorkOrder(
  ctx: Ctx,
  suffix: string,
  qtys: number[],
  isUrgent: boolean,
  priority: number,
): Promise<{ id: string; number: string; kursunStepId: string }> {
  const number = `${PREFIX}-${suffix}`;

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: ctx.item.id,
      steps: {
        create: [
          {
            stationId: ctx.kursun.id,
            stepSequence: 1,
            status: StepStatus.ACTIVE,
            // Kuyruk sırası bu alandan okunur; ekrandaki sürükleme onu yeniden yazar.
            priority,
            isUrgent,
            urgentMarkedAt: isUrgent ? new Date() : null,
          },
          { stationId: ctx.tambur.id, stepSequence: 2, status: StepStatus.PENDING },
        ],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  const kursunStepId = wo.steps.find((s) => s.stepSequence === 1)!.id;

  const batch = await prisma.batch.create({
    data: { batchNumber: `${PREFIX}P-${suffix}`, workOrderId: wo.id },
    select: { id: true },
  });

  await prisma.travelerCard.create({
    data: {
      cardNumber: number,
      barcode: number,
      workOrderId: wo.id,
      status: TravelerCardStatus.ACTIVE,
    },
  });

  for (const qty of qtys) {
    const roll = await prisma.roll.create({
      data: {
        // Barkodsuz açık kumaş: fason dönüşü topunun birebir emsali.
        barcode: null,
        itemId: ctx.item.id,
        batchId: batch.id,
        initialQty: qty,
        currentQty: qty,
        status: RollStatus.IN_PRODUCTION,
        currentStepId: kursunStepId,
        entrySource: "SUBCONTRACTOR_RETURN",
        form: RollForm.ACIK,
      },
      select: { id: true },
    });
    await prisma.rollMovement.create({
      data: { rollId: roll.id, workOrderStepId: kursunStepId, qtyIn: qty },
    });
  }

  return { id: wo.id, number, kursunStepId };
}

async function apply(): Promise<void> {
  const ctx = await resolveContext();

  const existing = await prisma.workOrder.count({
    where: { workOrderNumber: { startsWith: PREFIX } },
  });
  if (existing > 0) {
    console.log(
      `⚠️  Zaten ${existing} adet ${PREFIX} iş emri var. Önce --cleanup koşun (mükerrer üretmiyorum).`,
    );
    return;
  }

  console.log(`Kumaş: ${ctx.item.name} · İstasyonlar: ${ctx.kursun.name} → ${ctx.tambur.name}`);
  console.log(`Makineler: ${ctx.machines.map((m) => m.name).join(" · ")}\n`);

  console.log("── Bekleyen kuyruk ──");
  let priority = 0;
  for (const [suffix, qtys, urgent] of WAITING_SPEC) {
    const wo = await createWorkOrder(ctx, suffix, qtys, urgent, (priority += 10));
    const total = qtys.reduce((a, b) => a + b, 0);
    console.log(
      `  ✓ ${wo.number}  ${qtys.length} top · ${total} m${urgent ? "  [ACİL]" : ""}`,
    );
  }

  console.log("\n── Makinelere dağıtılmış ──");
  for (const [suffix, qtys, machineIdx] of ASSIGNED_SPEC) {
    const machine = ctx.machines[Math.min(machineIdx, ctx.machines.length - 1)];
    const wo = await createWorkOrder(ctx, suffix, qtys, false, (priority += 10));
    // Gerçek servis yolundan geçiyoruz: uygunluk + makine yeteneği + audit
    // doğrulamaları koşsun (elle INSERT edilen atama, ekranda çalışmayan bir
    // satır üretebilirdi).
    await bypassSvc.assign({ workOrderId: wo.id, machineId: machine.id }, ctx.admin.id);
    const total = qtys.reduce((a, b) => a + b, 0);
    console.log(`  ✓ ${wo.number}  ${qtys.length} top · ${total} m  → ${machine.name}`);
  }

  console.log(
    `\nHazır. Electron → Operasyonlar → "Kurşun Planlama" (sayfayı yenileyin).\n` +
      `Geri almak için: npx tsx scripts/demo_kursun_planlama.ts --cleanup`,
  );
}

async function cleanup(): Promise<void> {
  const wos = await prisma.workOrder.findMany({
    where: { workOrderNumber: { startsWith: PREFIX } },
    select: { id: true, workOrderNumber: true },
  });
  if (wos.length === 0) {
    console.log(`Silinecek ${PREFIX} iş emri yok.`);
    return;
  }
  const woIds = wos.map((w) => w.id);

  const rolls = await prisma.roll.findMany({
    where: { batch: { workOrderId: { in: woIds } } },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);

  const assignments = await prisma.kursunBypassAssignment.findMany({
    where: { workOrderId: { in: woIds } },
    select: { id: true },
  });

  console.log(
    `Siliniyor: ${wos.length} iş emri · ${rollIds.length} top · ${assignments.length} dağıtım`,
  );
  for (const w of wos) console.log(`  - ${w.workOrderNumber}`);

  await prisma.kursunBypassAssignment.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.travelerCardScan.deleteMany({
    where: { card: { workOrderId: { in: woIds } } },
  });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  await prisma.systemLog.deleteMany({
    where: { recordId: { in: [...woIds, ...rollIds, ...assignments.map((a) => a.id)] } },
  });

  console.log("Temizlendi.");
}

async function describe(): Promise<void> {
  const existing = await prisma.workOrder.count({
    where: { workOrderNumber: { startsWith: PREFIX } },
  });
  const waitingTotal = WAITING_SPEC.reduce((s, [, q]) => s + q.reduce((a, b) => a + b, 0), 0);
  const assignedTotal = ASSIGNED_SPEC.reduce((s, [, q]) => s + q.reduce((a, b) => a + b, 0), 0);

  console.log("Kurşun Planlama — ekran deneme verisi (hiçbir şey YAZILMADI)\n");
  console.log(`  --apply    → ${WAITING_SPEC.length} bekleyen (${waitingTotal} m, 1 acil)`);
  console.log(`               ${ASSIGNED_SPEC.length} dağıtılmış (${assignedTotal} m, 2 makineye)`);
  console.log(`               hepsi "${PREFIX}-*" numaralı iş emirleri olarak doğar`);
  console.log(`  --cleanup  → "${PREFIX}*" ile başlayan HER ŞEYİ siler`);
  console.log(`\n  Şu an DB'de ${existing} adet ${PREFIX} iş emri var.`);
  console.log("\n⚠️  Canlı fabrika veritabanında koşturmayın.");
}

(async () => {
  const mode = process.argv.includes("--apply")
    ? "apply"
    : process.argv.includes("--cleanup")
      ? "cleanup"
      : "describe";
  try {
    if (mode === "apply") await apply();
    else if (mode === "cleanup") await cleanup();
    else await describe();
  } catch (e) {
    console.error("HATA:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
})();
