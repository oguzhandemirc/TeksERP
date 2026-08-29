// =============================================================================
// AUDIT REPRO — S-4-05: FASON KABUL REPLAY'İNİN ÜÇ DAVRANIŞI
//   ① aynı token EŞZAMANLI       → idempotent mi, yoksa teknik 409 mu?
//   ② aynı token FARKLI GÖVDE     → payload-özdeşlik kontrolü var mı?
//                                   (kardeş `kartela.reduceStock`
//                                    `CLIENT_TOKEN_COLLISION` verir)
//   ③ token YOK + KISMİ, aynı yük → küme-eşitliği guard'ı kısmiyi bilerek
//                                   atladığı için İKİNCİ makbuz doğuyor mu?
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
//
// Beklenen (sağlıklı sistem):
//   ① İkinci istek ya cached makbuzu döner ya da NET bir 409 verir; her iki
//      durumda da tek makbuz + tek born-roll seti kalır ve top metrajı bir
//      teslimat kadar düşer.
//   ② Farklı gövdeli aynı token, sessizce "başarılı" DÖNMEZ.
//   ③ Tokensiz mükerrer kısmi kabul metrajı İKİ KEZ düşürmez.
//
// Gözlenen: (çalıştırınca doldur — log audit/repro/S-4-05.log)
//
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-4-05.ts
//
// MEKANİZMA (kod kanıtı):
//   • Token kontrolü tx DIŞINDA (`subcontractor.service.ts:2350-2371`).
//   • `SubcontractorReceipt.clientToken` `@unique` → eşzamanlıda kaybeden
//     P2002 alır, ama tx `withBarcodeRetry` ile sarılı (`:2681`) → P2002 5 kez
//     yeniden denenir ve token hâlâ dolu olduğu için hep düşer.
//   • Küme-eşitliği guard'ı `:2436` `if (prior.items.some(i => i.isPartial))
//     continue;` — KISMİ makbuzlar bilerek kapsam dışı; kısmi teslimatın TEK
//     replay kimliği token'dır.
//   • Token hit dalı (`:2372-2378`) payload'ı KARŞILAŞTIRMAZ; kardeş
//     `kartela.service.ts:1412-1428` karşılaştırır.
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
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

const sub = new SubcontractorService();
const cards = new TravelerCardService();

const STAMP = `AUDITREPRO-S-4-05-${Math.random().toString(36).slice(2, 8)}`;
const BARCODE_PREFIX = `TST-S405-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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

async function setup(tag: string, qty = 100): Promise<Scenario> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${STAMP}-${tag}-${Math.floor(Math.random() * 1e6)}`.slice(0, 40),
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
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
    { workOrderId: wo.id, stepId: wo.steps[0]!.id, subcontractorId: SUB_BOYER, rollIds: [roll.id] },
    ADMIN,
  );
  return { woId: wo.id, boyaStep: wo.steps[0]!.id, rollId: roll.id };
}

/** Commit SONRASI, DB'DEN oku. */
async function snap(sc: Scenario): Promise<{
  receipts: number;
  born: number;
  bornQty: number;
  currentQty: number;
  status: RollStatus | null;
}> {
  const receipts = await prisma.subcontractorReceipt.count({
    where: { stepId: sc.boyaStep, cancelledAt: null },
  });
  const born = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: sc.woId } },
    select: { currentQty: true },
  });
  const roll = await prisma.roll.findUnique({
    where: { id: sc.rollId },
    select: { currentQty: true, status: true },
  });
  return {
    receipts,
    born: born.length,
    bornQty: born.reduce((s, b) => s + Number(b.currentQty), 0),
    currentQty: Number(roll?.currentQty ?? 0),
    status: roll?.status ?? null,
  };
}

type Call = { ok: boolean; receiptNo: string; msg: string; err: string };
function callReceive(sc: Scenario, token: string | null, qty: number): Promise<Call> {
  return sub
    .receive(
      {
        workOrderId: sc.woId,
        stepId: sc.boyaStep,
        subcontractorId: SUB_BOYER,
        ...(token ? { clientToken: token } : {}),
        returns: [{ rollId: sc.rollId, receivedQty: qty }],
        newRolls: [{ qty }],
      },
      ADMIN,
    )
    .then((r) => ({
      ok: true,
      receiptNo: (r.data as { receiptNo?: string } | null)?.receiptNo ?? "",
      msg: r.message ?? "",
      err: "",
    }))
    .catch((e: unknown) => ({ ok: false, receiptNo: "", msg: "", err: (e as Error).message }));
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO S-4-05 — fason kabul replay (${STAMP}) ===\n`);

  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun)
    throw new Error("Seed fixture eksik — önce 'npm run seed'");
  ITEM = item.id;
  ADMIN = admin.id;
  ST_BOYA = boya.id;
  ST_KURSUN = kursun.id;
  SUB_BOYER = boyer.id;

  // ── ① aynı token, EŞZAMANLI, aynı gövde ───────────────────────────────────
  console.log("--- ①a SIRALI: aynı token, aynı gövde (referans: cached dönmeli) ---");
  {
    const sc = await setup("T1S");
    const tok = randomUUID();
    const r1 = await callReceive(sc, tok, 51);
    const r2 = await callReceive(sc, tok, 51);
    const s = await snap(sc);
    console.log(
      `   r1=${r1.ok ? r1.receiptNo : `ERR(${r1.err.slice(0, 45)})`} · ` +
        `r2=${r2.ok ? `${r2.receiptNo} "${r2.msg.slice(0, 40)}"` : `ERR(${r2.err.slice(0, 45)})`} · ` +
        `makbuz=${s.receipts} born=${s.born}/${s.bornQty}m kalan=${s.currentQty}`,
    );
    check("①a sıralı replay: tek makbuz, tek born, kalan 49", s.receipts === 1 && s.born === 1 && s.currentQty === 49);
  }

  console.log("\n--- ①b PARALEL: aynı token, aynı gövde ---");
  {
    const sc = await setup("T1P");
    const tok = randomUUID();
    const [r1, r2] = await Promise.all([callReceive(sc, tok, 51), callReceive(sc, tok, 51)]);
    const s = await snap(sc);
    const okCount = [r1, r2].filter((r) => r.ok).length;
    console.log(
      `   r1=${r1.ok ? r1.receiptNo : `ERR(${r1.err.slice(0, 60)})`} · ` +
        `r2=${r2.ok ? r2.receiptNo : `ERR(${r2.err.slice(0, 60)})`} · ` +
        `makbuz=${s.receipts} born=${s.born}/${s.bornQty}m kalan=${s.currentQty}`,
    );
    check("①b paralel: tek makbuz + tek born + kalan 49", s.receipts === 1 && s.born === 1 && s.currentQty === 49);
    check(
      "①b paralel: kaybeden ANLAŞILIR bir hata alır (barkod/teknik mesaj DEĞİL)",
      okCount === 2 ||
        ![r1, r2].some((r) => !r.ok && /[Bb]arkod üretimi/.test(r.err)),
      `hatalar: ${[r1, r2].filter((r) => !r.ok).map((r) => r.err.slice(0, 60)).join(" | ") || "(yok)"}`,
    );
  }

  // ── ② aynı token, FARKLI gövde ────────────────────────────────────────────
  console.log("\n--- ② aynı token, FARKLI gövde (51 → 60) ---");
  {
    const sc = await setup("T2");
    const tok = randomUUID();
    const r1 = await callReceive(sc, tok, 51);
    const r2 = await callReceive(sc, tok, 60);
    const s = await snap(sc);
    console.log(
      `   r1=${r1.ok ? r1.receiptNo : `ERR(${r1.err.slice(0, 45)})`} · ` +
        `r2=${r2.ok ? `OK "${r2.msg.slice(0, 55)}"` : `ERR(${r2.err.slice(0, 55)})`} · ` +
        `defter kalan=${s.currentQty}`,
    );
    check(
      "② farklı gövdeli replay sessizce 'başarılı' DÖNMEZ (kardeş reduceStock CLIENT_TOKEN_COLLISION verir)",
      !r2.ok,
      r2.ok ? `success:true döndü, mesaj: "${r2.msg}"` : "",
    );
  }

  // ── ③ TOKENSIZ mükerrer kısmi kabul ───────────────────────────────────────
  console.log("\n--- ③ tokensiz mükerrer KISMİ kabul (küme-eşitliği guard'ı kısmiyi atlar) ---");
  {
    const sc = await setup("T3");
    const r1 = await callReceive(sc, null, 20);
    const r2 = await callReceive(sc, null, 20);
    const s = await snap(sc);
    console.log(
      `   r1=${r1.ok ? r1.receiptNo : `ERR(${r1.err.slice(0, 45)})`} · ` +
        `r2=${r2.ok ? r2.receiptNo : `ERR(${r2.err.slice(0, 45)})`} · ` +
        `makbuz=${s.receipts} born=${s.born}/${s.bornQty}m kalan=${s.currentQty}`,
    );
    check(
      "③ tokensiz mükerrer kısmi kabul ikinci kez metraj DÜŞÜRMEZ",
      s.currentQty === 80 && s.receipts === 1,
      `makbuz=${s.receipts} kalan=${s.currentQty} (mükerrerde 60 + 2 makbuz beklenir)`,
    );
  }

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
