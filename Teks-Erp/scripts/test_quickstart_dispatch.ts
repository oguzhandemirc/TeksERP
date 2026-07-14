// =============================================================================
// TEST: Hızlı İş Emri + otomatik fason sevki + tek-kaynak "KUMAŞ İRSALİYESİ" çeki
//
// Saha isteği: hızlı iş emri tek seferde iş emri açar VE malı fasona gönderir
// (üretime başladı + mal gitti). İlk rota adımı fason (boyahane) ise sevk + çeki
// listesi birlikte oluşmalı. Çeki listesi tüm cihazlarda tek backend HTML'inden.
//
// Senaryolar:
//   A) dispatchFirstStep=true, ilk adım boyahane + firma → WO IN_PROGRESS, step
//      ACTIVE, SubcontractorDispatch + PrintedDocument(çeki) + toplar AT_SUBCONTRACTOR;
//      getHtml KUMAŞ İRSALİYESİ + 115/100/83→298 + istenen renk + firma adı içerir.
//   B) dispatchFirstStep=false → WO PLANNED, sevk YOK, toplar IN_PRODUCTION (planlandı).
//   C) dispatchFirstStep=true ama ilk adım INTERNAL → sevk atlanır, WO IN_PROGRESS.
//   D) dispatchFirstStep=true, ilk adım fason ama FİRMA YOK → sevk atlanır + uyarı,
//      WO PLANNED.
//
// Çalıştır: npx tsx scripts/test_quickstart_dispatch.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { RollStatus } from "@prisma/client";

// ── Fixture'lar (seed business-key ile çözülür — re-seed güvenli) ────────────
let ITEM = "";
let ITEM_NAME = "";
let GRADE = "";
let ADMIN = "";
let ST_BOYA = "";
let CAT_BOYA = "";
let ST_INTERNAL = "";
let SUB_BOYER = "";
let SUB_BOYER_NAME = "";
let COLOR: string | null = null;
let COLOR_NAME = "";
let BOYA_APPLIES_COLOR = false;

const woService = new WorkOrderService();
const createdWoIds: string[] = [];

async function resolveFixtures(): Promise<void> {
  const need = <T extends { id: string }>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v;
  };
  const item = need(
    await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true, name: true } }),
    "Item PATOS",
  );
  ITEM = item.id;
  ITEM_NAME = item.name;
  GRADE = need(
    await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }),
    "QualityGrade 1.KALITE",
  ).id;
  ADMIN = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "User admin",
  ).id;

  // Boyahane = EXTERNAL istasyon + (varsa) appliesColor kategorisi.
  const boya = need(
    await prisma.station.findFirst({
      where: { code: "BOYA_FASON" },
      select: { id: true, type: true, defaultCategory: { select: { id: true, appliesColor: true } } },
    }),
    "Station BOYA_FASON",
  );
  ST_BOYA = boya.id;
  CAT_BOYA = boya.defaultCategory?.id ?? "";
  BOYA_APPLIES_COLOR = boya.defaultCategory?.appliesColor ?? false;
  if (!CAT_BOYA) throw new Error("BOYA_FASON defaultCategory yok — fason adımı kategorisi gerekli.");
  if (boya.type !== "EXTERNAL") {
    throw new Error("BOYA_FASON istasyonu EXTERNAL değil — senaryo geçersiz.");
  }

  // Herhangi bir INTERNAL istasyon (Senaryo C: ilk adım fason-dışı).
  ST_INTERNAL = need(
    await prisma.station.findFirst({
      where: { type: "INTERNAL", isActive: true },
      select: { id: true },
    }),
    "INTERNAL istasyon",
  ).id;

  const boyer = need(
    await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true, name: true } }),
    "Subcontractor BOYER",
  );
  SUB_BOYER = boyer.id;
  SUB_BOYER_NAME = boyer.name;

  // İstenen renk (çeki listesinde "şu renge boya"). Boyahane appliesColor değilse
  // backend renk kabul etmeyebilir → renk göndermeyiz, renk doğrulamasını atlarız.
  if (BOYA_APPLIES_COLOR) {
    const c =
      (await prisma.color.findFirst({ where: { name: { contains: "BEYAZ" }, isActive: true }, select: { id: true, name: true } })) ??
      (await prisma.color.findFirst({ where: { isActive: true }, select: { id: true, name: true } }));
    if (c) {
      COLOR = c.id;
      COLOR_NAME = c.name;
    }
  }
}

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

let bc = 0;
function makeBarcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-QSD-${rand}${bc}`;
}

/** STOCK top oluştur (hızlı iş emri sadece STOCK topları bağlar). */
async function makeStockRoll(qty: number, width = 150): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: makeBarcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      qualityGrade: "1.KALITE",
      qualityGradeId: GRADE,
      width,
      createdById: ADMIN,
    },
    select: { barcode: true },
  });
  return r.barcode!;
}

/** SIRALI top oluştur — pg adapter tek bağlantıyı seri çalıştırır (Promise.all yok). */
async function makeStockRolls(qtys: number[]): Promise<string[]> {
  const out: string[] = [];
  for (const q of qtys) out.push(await makeStockRoll(q));
  return out;
}

// ── Senaryo A: Fasona Gönder (happy path) ────────────────────────────────────
async function scenarioA(): Promise<void> {
  console.log("\n── A) dispatchFirstStep=true · ilk adım boyahane + firma (115/100/83 → 298) ──");
  const qtys = [115, 100, 83];
  const barcodes = await makeStockRolls(qtys);

  const res = await woService.quickStart(
    {
      rollBarcodes: barcodes,
      steps: [
        { stationId: ST_BOYA, requiredCategoryId: CAT_BOYA, plannedSubcontractorId: SUB_BOYER },
        { stationId: ST_INTERNAL },
      ],
      width: 150,
      foldType: "2-KAT",
      ...(COLOR ? { targetColorId: COLOR } : {}),
      dispatchFirstStep: true,
    } as Parameters<WorkOrderService["quickStart"]>[0],
    ADMIN,
  );
  const data = res.data!;
  createdWoIds.push(data.workOrder.id);

  check("A: 3 top bağlandı", data.attached === 3, `attached=${data.attached}`);
  check("A: dispatch döndü (sevk yapıldı)", !!data.dispatch, JSON.stringify(data.dispatch));
  check("A: dispatchNo FS ile başlıyor (ayraçsız FSGGAAYYNNNN)", !!data.dispatch?.dispatchNo?.startsWith("FS"), data.dispatch?.dispatchNo);

  // WO + adım durumu
  const wo = await prisma.workOrder.findUnique({
    where: { id: data.workOrder.id },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  check("A: WO IN_PROGRESS (üretim başladı)", wo?.status === "IN_PROGRESS", wo?.status);
  check("A: ilk adım (boyahane) ACTIVE", wo?.steps[0].status === "ACTIVE", wo?.steps[0].status);

  // Toplar fasonda
  const rolls = await prisma.roll.findMany({ where: { barcode: { in: barcodes } }, select: { status: true } });
  check(
    "A: toplar AT_SUBCONTRACTOR",
    rolls.length === 3 && rolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR),
    rolls.map((r) => r.status).join(","),
  );

  // SubcontractorDispatch + item'lar
  const disp = await prisma.subcontractorDispatch.findUnique({
    where: { id: data.dispatch!.id },
    include: { items: true },
  });
  check("A: SubcontractorDispatch BOYER'a", disp?.subcontractorId === SUB_BOYER, disp?.subcontractorId);
  check("A: dispatch 3 item", disp?.items.length === 3, `items=${disp?.items.length}`);
  check("A: dispatch totalQty=298", Math.round(Number(disp?.totalQty ?? 0)) === 298, String(disp?.totalQty));

  // Çeki belgesi donmuş mu
  const pdoc = await prisma.printedDocument.findFirst({
    where: { docType: "SUBCONTRACTOR_DISPATCH", sourceId: data.dispatch!.id },
  });
  check("A: PrintedDocument(çeki) v1 ACTIVE", pdoc?.version === 1 && pdoc?.status === "ACTIVE", `v${pdoc?.version}/${pdoc?.status}`);

  // ── TEK KAYNAK HTML (KUMAŞ İRSALİYESİ) ──
  const htmlRes = await printedDocumentService.getHtml("SUBCONTRACTOR_DISPATCH", data.dispatch!.id);
  const html = (htmlRes.data as { html: string } | null)?.html ?? "";
  check("A: getHtml HTML döndü", html.length > 500, `len=${html.length}`);
  check("A: HTML başlık KUMAŞ İRSALİYESİ", html.includes("KUMAŞ İRSALİYESİ"));
  check("A: HTML İrsaliye No (dispatchNo)", html.includes(data.dispatch!.dispatchNo));
  check("A: HTML SAYIN = fason firma adı", html.includes(SUB_BOYER_NAME), SUB_BOYER_NAME);
  check("A: HTML grid metreleri (115/100/83)", html.includes("115") && html.includes("100") && html.includes("83"));
  check("A: HTML toplam metre 298", html.includes("298"));
  check("A: HTML CİNSİ (ürün adı)", html.includes(ITEM_NAME), ITEM_NAME);
  check("A: HTML 100 hücreli grid (Top/Metre/Cm)", html.includes("Top") && html.includes("Metre") && html.includes("Cm"));
  if (COLOR) {
    check("A: HTML istenen renk (hedef)", html.includes(COLOR_NAME), COLOR_NAME);
  } else {
    console.log("  (renk doğrulaması atlandı — boyahane kategorisi appliesColor=false)");
  }
}

// ── Senaryo B: Sadece planla (dispatchFirstStep=false) ───────────────────────
async function scenarioB(): Promise<void> {
  console.log("\n── B) dispatchFirstStep=false · ilk adım boyahane (sadece planla) ──");
  const barcodes = await makeStockRolls([200, 150]);
  const res = await woService.quickStart(
    {
      rollBarcodes: barcodes,
      steps: [
        { stationId: ST_BOYA, requiredCategoryId: CAT_BOYA, plannedSubcontractorId: SUB_BOYER },
        { stationId: ST_INTERNAL },
      ],
      width: 150,
      foldType: "2-KAT",
      dispatchFirstStep: false,
    } as Parameters<WorkOrderService["quickStart"]>[0],
    ADMIN,
  );
  const data = res.data!;
  createdWoIds.push(data.workOrder.id);

  check("B: dispatch YOK (null)", data.dispatch === null, JSON.stringify(data.dispatch));
  const wo = await prisma.workOrder.findUnique({
    where: { id: data.workOrder.id },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  check("B: WO PLANNED (sevk yok)", wo?.status === "PLANNED", wo?.status);
  check("B: ilk adım PENDING", wo?.steps[0].status === "PENDING", wo?.steps[0].status);
  const rolls = await prisma.roll.findMany({
    where: { barcode: { in: barcodes } },
    select: { status: true, currentStepId: true },
  });
  check(
    "B: toplar IN_PRODUCTION + ilk adıma bağlı (planlandı)",
    rolls.every((r) => r.status === RollStatus.IN_PRODUCTION && r.currentStepId === wo?.steps[0].id),
    rolls.map((r) => r.status).join(","),
  );
  const dispCount = await prisma.subcontractorDispatch.count({ where: { workOrderId: data.workOrder.id } });
  check("B: hiç SubcontractorDispatch yok", dispCount === 0, `count=${dispCount}`);
}

// ── Senaryo C: ilk adım INTERNAL → sevk atlanır ──────────────────────────────
async function scenarioC(): Promise<void> {
  console.log("\n── C) dispatchFirstStep=true · ilk adım INTERNAL (fason değil) ──");
  const barcodes = await makeStockRolls([120]);
  const res = await woService.quickStart(
    {
      rollBarcodes: barcodes,
      steps: [{ stationId: ST_INTERNAL }, { stationId: ST_BOYA, requiredCategoryId: CAT_BOYA, plannedSubcontractorId: SUB_BOYER }],
      width: 150,
      foldType: "2-KAT",
      dispatchFirstStep: true,
    } as Parameters<WorkOrderService["quickStart"]>[0],
    ADMIN,
  );
  const data = res.data!;
  createdWoIds.push(data.workOrder.id);

  check("C: dispatch YOK (ilk adım fason değil → atlandı)", data.dispatch === null, JSON.stringify(data.dispatch));
  const wo = await prisma.workOrder.findUnique({
    where: { id: data.workOrder.id },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  check("C: WO IN_PROGRESS (internal ilk adım üretime girer)", wo?.status === "IN_PROGRESS", wo?.status);
  check("C: ilk adım ACTIVE", wo?.steps[0].status === "ACTIVE", wo?.steps[0].status);
}

// ── Senaryo D: ilk adım fason ama firma YOK → atlanır + uyarı ────────────────
async function scenarioD(): Promise<void> {
  console.log("\n── D) dispatchFirstStep=true · ilk adım boyahane ama FİRMA YOK ──");
  const barcodes = await makeStockRolls([90]);
  const res = await woService.quickStart(
    {
      rollBarcodes: barcodes,
      // plannedSubcontractorId YOK → firma çözülemez
      steps: [{ stationId: ST_BOYA, requiredCategoryId: CAT_BOYA }, { stationId: ST_INTERNAL }],
      width: 150,
      foldType: "2-KAT",
      dispatchFirstStep: true,
    } as Parameters<WorkOrderService["quickStart"]>[0],
    ADMIN,
  );
  const data = res.data!;
  createdWoIds.push(data.workOrder.id);

  check("D: dispatch YOK (firma yok → atlandı)", data.dispatch === null, JSON.stringify(data.dispatch));
  check("D: mesajda firma uyarısı var", (res.message ?? "").toLowerCase().includes("firma"), res.message);
  const wo = await prisma.workOrder.findUnique({ where: { id: data.workOrder.id }, select: { status: true } });
  check("D: WO PLANNED (sevk yapılamadı)", wo?.status === "PLANNED", wo?.status);
}

async function cleanup(): Promise<void> {
  try {
    if (createdWoIds.length === 0) return;
    const steps = await prisma.workOrderStep.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { barcode: { startsWith: "TST-QSD-" } },
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: createdWoIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...rollIds, ...dispatchIds, ...createdWoIds] } },
    });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("\n(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

async function main(): Promise<void> {
  await resolveFixtures();
  console.log(`Fixture: ürün=${ITEM_NAME}, boyahane appliesColor=${BOYA_APPLIES_COLOR}, renk=${COLOR_NAME || "(yok)"}`);
  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
