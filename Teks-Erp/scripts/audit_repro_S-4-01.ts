// =============================================================================
// AUDIT REPRO — S-4-01: fason kabul commit'i ile "Rengi Değiştir" çakışınca
//   mal–plan uyum bekçisi (COLOR_DYED_BLOCKED / COLOR_PARTIAL_CONFIRM) ATLANIYOR
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
//
// Beklenen (sağlıklı sistem): fason kabul commit ettikten SONRA iş emrinin hedef
//   rengini değiştirmeye çalışan istek, eldeki BOYANMIŞ (born) toplarla
//   uyuşmadığı için 409 `COLOR_DYED_BLOCKED` (boyanacak top kalmadıysa) ya da
//   409 `COLOR_PARTIAL_CONFIRM` almalıdır — `workorder-target-color.helper`
//   2026-08-21 kararı: "KİLİT ADIMA DEĞİL MALA BAKAR".
//
// Gözlenen: (çalıştırınca doldur — log audit/repro/S-4-01.log)
//
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-4-01.ts
//
// MEKANİZMA (kod kanıtı):
//   • `subcontractor.service.ts:2679` `receive` tx'i `touchWorkOrderTx` ile WO
//     satırını KİLİTLER ve uzun sürer (barkod rezervasyonu, born roll create,
//     movement, plan-sapma, refakat kartı taraması).
//   • `workorder-link.service.ts:527` `changeTargetColor` **tx AÇMAZ ve WO
//     kilidini ALMAZ**: `assertTargetColorChange(prisma, …)` (`:524`) mal–plan
//     sayımını HAVUZ client'ıyla, kilidin DIŞINDA yapar.
//   • `workorder-target-color.helper.ts:150` mismatch sorgusu
//     `status: { notIn: [...K18_DEAD_STATUSES, AT_SUBCONTRACTOR] }` diyor →
//     toplar HÂLÂ FASONDAYKEN mismatch = 0 → bekçi SERBEST der.
//   • `workorder-link.service.ts:566-573` atomik claim yalnız
//     `targetColorId: wo.targetColorId` koşulunu pinler — TOP KÜMESİNİ pinlemez.
//     `receive` targetColorId'ye dokunmadığı için claim commit'ten sonra da geçer.
//   → Bekçi "fasonda mal var, serbest" derken, claim'in commit ettiği anda mal
//     çoktan içeride ve ESKİ renkte boyanmış olur.
//
// Migration/flag/ayar DEĞİŞTİRİLMEZ.
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "",
    db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { RollStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

const sub = new SubcontractorService();
const links = new WorkOrderLinkService();
const cards = new TravelerCardService();

const STAMP = `AUDITREPRO-S-4-01-${Math.random().toString(36).slice(2, 8)}`;
const BARCODE_PREFIX = `TST-S401-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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

const createdWoIds: string[] = [];
const allStepIds: string[] = [];

let ITEM = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_KURSUN = "";
let SUB_BOYER = "";
let COLOR_A = "";
let COLOR_B = "";

let bc = 0;
function barcode(): string {
  bc += 1;
  return `${BARCODE_PREFIX}-${bc}-${Math.floor(Math.random() * 1e5)}`;
}

interface Scenario {
  woId: string;
  boyaStep: string;
  rollId: string;
}

/** Tek fason adımı (son adım DEĞİL — born top IN_PRODUCTION doğsun) + 1 top, sevkli. */
async function setup(tag: string, qty = 100): Promise<Scenario> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${STAMP}-${tag}-${Math.floor(Math.random() * 1e6)}`.slice(0, 40),
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      targetColorId: COLOR_A,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(wo.id);
  const boyaStep = wo.steps[0]!.id;
  allStepIds.push(wo.steps[0]!.id, wo.steps[1]!.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  const roll = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      width: 250,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  await sub.dispatch(
    { workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [roll.id] },
    ADMIN,
  );
  return { woId: wo.id, boyaStep, rollId: roll.id };
}

/** Commit SONRASI, DB'DEN oku: WO hedef rengi + canlı boyanmış top dağılımı. */
async function state(woId: string): Promise<{
  targetColorId: string | null;
  bornColorIds: Array<string | null>;
}> {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { targetColorId: true },
  });
  const born = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId } },
    select: { colorId: true, status: true },
  });
  return {
    targetColorId: wo?.targetColorId ?? null,
    bornColorIds: born
      .filter((b) => b.status === RollStatus.IN_PRODUCTION || b.status === RollStatus.WAREHOUSE)
      .map((b) => b.colorId),
  };
}

type ArmResult = {
  recvOk: boolean;
  recvErr: string;
  colorOk: boolean;
  colorErrCode: string;
  colorErr: string;
  after: Awaited<ReturnType<typeof state>>;
};

async function runArm(label: string, parallel: boolean): Promise<ArmResult> {
  const sc = await setup(label.replace(/[^A-Za-z0-9]/g, "").slice(0, 6));

  const recvCall = () =>
    sub
      .receive(
        {
          workOrderId: sc.woId,
          stepId: sc.boyaStep,
          subcontractorId: SUB_BOYER,
          // Kabul TAM: top tüketilir → adım COMPLETED, "boyanacak top" KALMAZ
          // (pendingCount = 0) → doğru cevap COLOR_DYED_BLOCKED olmalıdır.
          returns: [{ rollId: sc.rollId }],
          newRolls: [{ qty: 92 }],
        },
        ADMIN,
      )
      .then(() => ({ ok: true as const, err: "" }))
      .catch((e: unknown) => ({ ok: false as const, err: (e as Error).message }));

  const colorCall = () =>
    links
      .changeTargetColor(sc.woId, COLOR_B, `${STAMP} renk degisikligi`, ADMIN)
      .then(() => ({ ok: true as const, code: "", err: "" }))
      .catch((e: unknown) => ({
        ok: false as const,
        code: ((e as { details?: { code?: string } }).details?.code ?? "") as string,
        err: (e as Error).message,
      }));

  let recv: { ok: boolean; err: string };
  let color: { ok: boolean; code: string; err: string };
  if (parallel) {
    // Renk isteğini kabul tx'i AÇILDIKTAN sonra başlat: bekçi okuması kilidin
    // dışında koşsun, claim ise kilidi bekleyip commit'ten SONRA uygulansın.
    const recvP = recvCall();
    await new Promise((r) => setTimeout(r, 25));
    const colorP = colorCall();
    [recv, color] = await Promise.all([recvP, colorP]);
  } else {
    recv = await recvCall();
    color = await colorCall();
  }

  const after = await state(sc.woId);
  console.log(
    `   [${label}] kabul=${recv.ok ? "OK" : `ERR(${recv.err.slice(0, 45)})`} · ` +
      `renk=${color.ok ? "OK(değişti)" : `ERR(${color.code || color.err.slice(0, 45)})`} · ` +
      `WO.targetColor=${after.targetColorId === COLOR_A ? "A" : after.targetColorId === COLOR_B ? "B" : String(after.targetColorId)} · ` +
      `born renkleri=[${after.bornColorIds.map((c) => (c === COLOR_A ? "A" : c === COLOR_B ? "B" : String(c))).join(",")}]`,
  );
  return {
    recvOk: recv.ok,
    recvErr: recv.err,
    colorOk: color.ok,
    colorErrCode: color.code,
    colorErr: color.err,
    after,
  };
}

/** İhlal: kabul BAŞARILI + renk değişikliği BAŞARILI + eldeki mal yeni renkte DEĞİL. */
function violated(r: ArmResult): boolean {
  return (
    r.recvOk &&
    r.colorOk &&
    r.after.targetColorId === COLOR_B &&
    r.after.bornColorIds.length > 0 &&
    r.after.bornColorIds.every((c) => c !== COLOR_B)
  );
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO S-4-01 — fason kabul × "Rengi Değiştir" (${STAMP}) ===\n`);

  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true, allowedColors: { select: { colorId: true } } } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun)
    throw new Error("Seed fixture eksik (PATOS / admin / BOYA_FASON / KURSUN_KK2) — önce 'npm run seed'");

  // Renkler: ürünün izinli listesi doluysa ORADAN seç (bekçi 3. adımı 400 vermesin).
  const allowed = item.allowedColors.map((a) => a.colorId);
  const colors = await prisma.color.findMany({
    where: { isActive: true, ...(allowed.length > 0 ? { id: { in: allowed } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 2,
  });
  if (colors.length < 2)
    throw new Error("İki aktif (ve ürüne izinli) renk gerekli — repro kurulamadı.");
  ITEM = item.id;
  ADMIN = admin.id;
  ST_BOYA = boya.id;
  ST_KURSUN = kursun.id;
  SUB_BOYER = boyer.id;
  COLOR_A = colors[0]!.id;
  COLOR_B = colors[1]!.id;
  console.log(`Renkler: A=${colors[0]!.name} (plan) → B=${colors[1]!.name} (yeni plan)\n`);

  // ── KOL 1: SIRALI (referans davranış — bekçi doğru cevabı vermeli) ──
  console.log("--- KOL 1: SIRALI (önce kabul commit, sonra 'Rengi Değiştir') ---");
  const seq = await runArm("SIRALI", false);
  check(
    "S1 sıralı: kabul sonrası renk değişikliği 409 COLOR_DYED_BLOCKED ile REDDEDİLİR",
    !seq.colorOk && seq.colorErrCode === "COLOR_DYED_BLOCKED",
    `code=${seq.colorErrCode || "(yok)"} ok=${seq.colorOk}`,
  );
  check("S1 sıralı: değişmez korundu (mal ↔ plan)", !violated(seq));

  // ── KOL 2: PARALEL ──
  console.log("\n--- KOL 2: PARALEL (kabul tx'i açıkken 'Rengi Değiştir') ---");
  const par = await runArm("PARALEL", true);
  check(
    "P1 paralel: bekçi yine devrede (renk sessizce değişmedi)",
    !violated(par),
    `code=${par.colorErrCode || "(yok)"} colorOk=${par.colorOk}`,
  );

  // ── KOL 3: 10 tekrar ──
  console.log("\n--- KOL 3: PARALEL × 10 tekrar ---");
  let broke = 0;
  for (let i = 0; i < 10; i++) {
    const r = await runArm(`P#${i + 1}`, true);
    if (violated(r)) broke++;
  }
  console.log(
    `\n10 paralel turun ${broke} tanesinde "WO planı B, eldeki mal A" durumu ` +
      `HİÇBİR onay sorulmadan oluştu.`,
  );
  check("R1 10 turun hiçbirinde mal–plan bekçisi atlanmadı", broke === 0, `atlanan=${broke}/10`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: allStepIds } },
          { producedInStepId: { in: allStepIds } },
          { parentReceipt: { workOrderId: { in: createdWoIds } } },
          { barcode: { startsWith: BARCODE_PREFIX } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }); // RESTRICT FK
    await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    const cardRows = await prisma.travelerCard.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    if (cardRows.length > 0) {
      await prisma.travelerCardScan.deleteMany({
        where: { cardId: { in: cardRows.map((c) => c.id) } },
      });
      await prisma.travelerCard.deleteMany({ where: { id: { in: cardRows.map((c) => c.id) } } });
    }
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } },
    });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log(`\n[temizlik] ${createdWoIds.length} iş emri / ${rollIds.length} top silindi.`);
  } catch (e) {
    console.error("Temizlik hatası (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
