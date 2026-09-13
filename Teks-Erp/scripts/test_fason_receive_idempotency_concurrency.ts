// TEST: Fason kabul — idempotency replay + eşzamanlılık + çoklu parti + reopen.
//
// Hepsi "yanlış born-roll sayısı" sınıfının eşzamanlılık/çoğullama kolları:
//   IC1 Idempotency: aynı receive() payload'ı 2× → ikinci cached, İKİNCİ receipt YOK, born=1
//   IC2 Eşzamanlı aynı-top kabul: iki receive() paralel → atomik claim → born=1 (çift değil)
//   IC3 Çoklu parti izolasyonu: 2 dispatch; parti1 kabul → yalnız parti1 born, parti2 dokunulmaz
//   IC4 COMPLETED adım reopen: tam kabul → COMPLETED → ek parti dispatch → ACTIVE → kabul, birikim
//
// Rota: [1] BOYA_FASON (EXTERNAL) → [2] KURSUN_KK2 (INTERNAL)
// Çalıştır: npx tsx scripts/test_fason_receive_idempotency_concurrency.ts
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus } from "@prisma/client";
import { randomUUID } from "crypto";

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "";
let GRADE_CODE = "";
const WIDTH = 250;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const _gradeRow = await roleGrade("FIRST");
  GRADE = _gradeRow.id;
  GRADE_CODE = _gradeRow.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "Station KURSUN_KK2");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FIC-${rand}${bc}`;
}

const createdWoIds: string[] = [];
const allStepIds: string[] = [];

async function stockRoll(qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: WIDTH, createdById: ADMIN },
  });
  return r.id;
}

interface Wo { woId: string; boyaStep: string; kursunStep: string; }

// WO + 2 adım + traveler card + N stok top (sevk EDİLMEMİŞ). Dispatch senaryoda yapılır.
async function setupWoOnly(tag: string, count: number): Promise<{ wo: Wo; rollIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6);
  const woRow = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-FIC-${tag}-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
        { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(woRow.id);
  const boyaStep = woRow.steps[0].id, kursunStep = woRow.steps[1].id;
  allStepIds.push(boyaStep, kursunStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, woRow.id, ADMIN));
  const rollIds: string[] = [];
  for (let i = 0; i < count; i++) rollIds.push(await stockRoll(300));
  return { wo: { woId: woRow.id, boyaStep, kursunStep }, rollIds };
}

async function bornLive(woId: string, kursunStep: string): Promise<number> {
  return prisma.roll.count({ where: { parentReceipt: { workOrderId: woId }, parentRollId: null, currentStepId: kursunStep, status: RollStatus.IN_PRODUCTION } });
}
async function activeReceiptCount(woId: string): Promise<number> {
  return prisma.subcontractorReceipt.count({ where: { workOrderId: woId, cancelledAt: null } });
}
async function boyaStatus(boyaStep: string): Promise<StepStatus> {
  const st = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
  return st!.status;
}

async function main(): Promise<void> {
  await resolveFixtures();

  // ═══ IC1 — IDEMPOTENCY REPLAY ═══
  console.log("\n=== IC1: aynı receive() 2× → ikinci cached, ikinci receipt YOK, born=1 ===");
  {
    const { wo, rollIds } = await setupWoOnly("IC1", 2);
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const payload = { workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] };
    await sub.receive(payload, ADMIN);
    const res2 = await sub.receive(payload, ADMIN); // birebir replay
    check("IC1: ikinci çağrı idempotent cached döner (success)", res2.success === true);
    check("IC1: aktif receipt sayısı 1 (ikinci receipt açılmadı)", (await activeReceiptCount(wo.woId)) === 1, `receipt ${await activeReceiptCount(wo.woId)}`);
    check("IC1: born sayısı 1 (replay born çift doğurmadı)", (await bornLive(wo.woId, wo.kursunStep)) === 1, `born ${await bornLive(wo.woId, wo.kursunStep)}`);
  }

  // ═══ IC2 — EŞZAMANLI AYNI-TOP KABUL (atomik claim) ═══
  console.log("\n=== IC2: iki receive() AYNI top için paralel → atomik claim → born=1 ===");
  {
    const { wo, rollIds } = await setupWoOnly("IC2", 2);
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const payload = { workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] };
    // Ayrı service çağrıları (her biri kendi tx'i) — tx-İÇİ Promise.all DEĞİL.
    const results = await Promise.allSettled([sub.receive(payload, ADMIN), sub.receive(payload, ADMIN)]);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    console.log(`     (sonuç: ${ok} başarılı/cached, ${rejected} reddedildi)`);
    // İNVARYANT: timing ne olursa olsun (kaybeden 409 VEYA idempotent cached) born ÇİFT olmamalı.
    check("IC2: eşzamanlı kabul → TAM 1 born (çift doğum yok)", (await bornLive(wo.woId, wo.kursunStep)) === 1, `born ${await bornLive(wo.woId, wo.kursunStep)}`);
    check("IC2: aktif receipt sayısı 1", (await activeReceiptCount(wo.woId)) === 1, `receipt ${await activeReceiptCount(wo.woId)}`);
    const r1 = await prisma.roll.findUnique({ where: { id: rollIds[0] }, select: { status: true } });
    check("IC2: r1 tam olarak bir kez CONSUMED", r1?.status === RollStatus.SUBCONTRACTOR_CONSUMED);
  }

  // ═══ IC3 — ÇOKLU PARTİ İZOLASYONU ═══
  console.log("\n=== IC3: 2 ayrı sevk (parti); parti1 kabul → yalnız parti1 born, parti2 dokunulmaz ===");
  {
    const { wo, rollIds } = await setupWoOnly("IC3", 3); // r0,r1 = parti1; r2 = parti2
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollIds[0], rollIds[1]] }, ADMIN);
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollIds[2]] }, ADMIN);
    // Parti1 kabul (2 top → 2 parça)
    await sub.receive({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: rollIds[0] }, { rollId: rollIds[1] }], newRolls: [{ qty: 290 }, { qty: 285 }] }, ADMIN);
    check("IC3: parti1 kabul → 2 born", (await bornLive(wo.woId, wo.kursunStep)) === 2, `born ${await bornLive(wo.woId, wo.kursunStep)}`);
    const r2 = await prisma.roll.findUnique({ where: { id: rollIds[2] }, select: { status: true, currentStepId: true } });
    check("IC3: parti2 topu (r2) hâlâ AT_SUBCONTRACTOR @ Boyahane (dokunulmadı)", r2?.status === RollStatus.AT_SUBCONTRACTOR && r2?.currentStepId === wo.boyaStep);
    check("IC3: Boyahane adımı hâlâ ACTIVE (parti2 bekliyor)", (await boyaStatus(wo.boyaStep)) === StepStatus.ACTIVE);
    // Parti2 kabul → birikim 3, adım COMPLETED
    await sub.receive({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: rollIds[2] }], newRolls: [{ qty: 295 }] }, ADMIN);
    check("IC3: parti2 kabul → toplam 3 born (birikim doğru)", (await bornLive(wo.woId, wo.kursunStep)) === 3, `born ${await bornLive(wo.woId, wo.kursunStep)}`);
    check("IC3: iki parti de dönünce Boyahane COMPLETED", (await boyaStatus(wo.boyaStep)) === StepStatus.COMPLETED);
  }

  // ═══ IC4 — COMPLETED ADIM REOPEN (çoklu sevk) ═══
  console.log("\n=== IC4: tam kabul → COMPLETED → ek parti dispatch → ACTIVE → kabul, birikim ===");
  {
    const { wo, rollIds } = await setupWoOnly("IC4", 1);
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    await sub.receive({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] }, ADMIN);
    check("IC4: tek top tam kabul → 1 born + Boyahane COMPLETED", (await bornLive(wo.woId, wo.kursunStep)) === 1 && (await boyaStatus(wo.boyaStep)) === StepStatus.COMPLETED);
    // Ek parti: yeni stok top aynı Boyahane adımına sevk → COMPLETED'i reopen eder
    const extra = await stockRoll(300);
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds: [extra] }, ADMIN);
    check("IC4: ek parti dispatch → Boyahane ACTIVE'e reopen", (await boyaStatus(wo.boyaStep)) === StepStatus.ACTIVE);
    await sub.receive({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: extra }], newRolls: [{ qty: 295 }] }, ADMIN);
    check("IC4: ek parti kabul → toplam 2 born (kümülatif, çift yok)", (await bornLive(wo.woId, wo.kursunStep)) === 2, `born ${await bornLive(wo.woId, wo.kursunStep)}`);
    check("IC4: ek parti dönünce Boyahane yine COMPLETED", (await boyaStatus(wo.boyaStep)) === StepStatus.COMPLETED);
  }

  // ═══ IC5 — AYNI TOKEN, EŞZAMANLI (BULGU-T1-005) ═══
  // Tx-ÖNCESİ token kontrolü SIRALI replay'i yakalar; EŞZAMANLI olanı yakalayamaz:
  // iki istek de o kontrolü geçer, ikincisi `receipt.create`te clientToken
  // P2002'sine çarpar. Eskiden predicate'siz `withBarcodeRetry` onu barkod
  // çakışması sanıp 5 kez tekrarlıyor ve "Barkod üretimi 5 denemede başarısız
  // oldu" 409'u dönüyordu. Operatör o mesajı görüp kabulü ELLE yeniden giriyor
  // (yeni token → guard yok) ve teslimat İKİ KEZ düşülüyordu.
  console.log("\n=== IC5: aynı clientToken paralel → tam 1 makbuz, iki istek de başarılı ===");
  {
    const { wo, rollIds } = await setupWoOnly("IC5", 1);
    await sub.dispatch({ workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const token = randomUUID();
    const istek = () =>
      sub.receive(
        {
          workOrderId: wo.woId, stepId: wo.boyaStep, subcontractorId: SUB_BOYER,
          clientToken: token,
          returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 280 }],
        },
        ADMIN,
      );
    const sonuc = await Promise.allSettled([istek(), istek()]);
    const basarili = sonuc.filter((r) => r.status === "fulfilled").length;
    const mesajlar = sonuc.map((r) =>
      r.status === "fulfilled"
        ? String((r.value as { message?: string }).message ?? "")
        : String((r.reason as Error).message ?? ""),
    );
    const makbuzSayisi = await prisma.subcontractorReceipt.count({
      where: { clientToken: token },
    });
    check("IC5: iki istek de BAŞARILI (yanıltıcı barkod-409'u yok)", basarili === 2, mesajlar.join(" || ").slice(0, 160));
    check("IC5: yalnız TEK makbuz doğdu", makbuzSayisi === 1, `makbuz=${makbuzSayisi}`);
    check(
      "IC5: kaybeden istek idempotent replay mesajı döndü",
      mesajlar.some((m) => m.includes("idempotent retry")),
      mesajlar.join(" || ").slice(0, 160),
    );
    check("IC5: teslimat TEK kez düşüldü (born 1)", (await bornLive(wo.woId, wo.kursunStep)) === 1, `born ${await bornLive(wo.woId, wo.kursunStep)}`);
    // Temizlik makbuzları iş emri üzerinden buluyor (cleanup: workOrderId IN
    // createdWoIds) — bu makbuz da o WO'ya bağlı, ek kayda gerek yok.
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`SONUÇ: ${pass} geçti, ${fail} başarısız`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: { OR: [
        { currentStepId: { in: allStepIds } },
        { producedInStepId: { in: allStepIds } },
        { parentReceipt: { workOrderId: { in: createdWoIds } } },
        { barcode: { startsWith: "TST-FIC-" } },
      ] }, select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
