// =============================================================================
// AUDIT REPRO — S-4-02: KISMİ KABUL × "KALAN GELMEYECEK" (closeRemainder)
//   ① eşzamanlı çakışma  ② kapama sonrası kabul iptalinin ÇIKMAZI
//      (önizleme `allSafe:true` der, uç 409 verir ve geri dönüş yolu YOKTUR)
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
//
// Beklenen (sağlıklı sistem):
//   ① Eşzamanlı kısmi kabul + kalan kapama: ikisi de WO satırını kilitlediği
//      için serileşir; kazanan hangisi olursa olsun `Σ(defter düşümü) +
//      Σ(SUBCONTRACTOR_REMAINDER fire) == giden metraj` korunur ve negatif
//      metraj doğmaz.
//   ② Kalan kapatıldıktan sonra o topa ait KISMİ makbuzun iptal önizlemesi
//      (`getCancelPreview`) engeli GÖSTERMELİ (`allSafe:false`) — LIFO ve
//      parti-uyuşmazlığı engelleri için zaten böyle yapılıyor
//      (`subcontractor.service.ts:4661-4694`: laterReceipts + batchMismatch).
//
// Gözlenen: (çalıştırınca doldur — log audit/repro/S-4-02.log)
//
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_S-4-02.ts
//
// MEKANİZMA (kod kanıtı):
//   • `closeRemainder` (`subcontractor.service.ts:3346`) topu
//     SUBCONTRACTOR_CONSUMED'a çeker (`:3419-3427`).
//   • `cancelReceipt`ın KISMİ dalı (`:4930-4944`) `updateMany where { id,
//     status: AT_SUBCONTRACTOR, currentStepId }` ister → kapamadan sonra
//     count=0 → 409 ("kalan kapatılmış olabilir"), ve `closeRemainder`ın
//     GERİ ALMA ucu YOKTUR (grep: `closeRemainder` tek yazma noktası,
//     `remainderClosedAt` yalnız `:3450`de yazılır, hiçbir yerde temizlenmez).
//   • `getCancelPreview` (`:4581`) yalnız born-roll engellerini, K14 parti
//     uyuşmazlığını ve LIFO makbuzlarını sorar; makbuzun ORİJİNAL toplarının
//     güncel statüsüne HİÇ bakmaz → `allSafe: true` döner.
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

import { RollStatus, RollVarianceKind, ReasonPresetKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { VARIANCE_SOURCES } from "../src/constants/variance-reasons";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

const sub = new SubcontractorService();
const cards = new TravelerCardService();

const STAMP = `AUDITREPRO-S-4-02-${Math.random().toString(36).slice(2, 8)}`;
const BARCODE_PREFIX = `TST-S402-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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
let SCRAP_REASON = "";

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

/** Commit SONRASI, DB'DEN oku — defter mutabakatı. */
async function ledger(sc: Scenario): Promise<{
  rollStatus: RollStatus | null;
  currentQty: number;
  receiptSum: number;
  remainderScrap: number;
  shrinkScrap: number;
  activeReceipts: number;
}> {
  const roll = await prisma.roll.findUnique({
    where: { id: sc.rollId },
    select: { status: true, currentQty: true },
  });
  const items = await prisma.subcontractorReceiptItem.findMany({
    where: { newRollId: sc.rollId, receipt: { cancelledAt: null, stepId: sc.boyaStep } },
    select: { receivedQty: true },
  });
  const varRows = await prisma.rollVariance.findMany({
    where: { rollId: sc.rollId, reversedAt: null },
    select: { qty: true, source: true, kind: true },
  });
  const activeReceipts = await prisma.subcontractorReceipt.count({
    where: { stepId: sc.boyaStep, cancelledAt: null },
  });
  const sum = (src: string) =>
    varRows
      .filter((v) => v.source === src && v.kind === RollVarianceKind.SCRAP)
      .reduce((s, v) => s + Number(v.qty), 0);
  return {
    rollStatus: roll?.status ?? null,
    currentQty: Number(roll?.currentQty ?? 0),
    receiptSum: items.reduce((s, i) => s + Number(i.receivedQty ?? 0), 0),
    remainderScrap: sum(VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER),
    shrinkScrap: sum(VARIANCE_SOURCES.SUBCONTRACTOR_RETURN),
    activeReceipts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// KOL A — eşzamanlı kısmi kabul × kalan kapama
// ─────────────────────────────────────────────────────────────────────────────
async function armConcurrent(label: string, parallel: boolean): Promise<boolean> {
  const sc = await setup(label.replace(/[^A-Za-z0-9]/g, "").slice(0, 6), 100);

  const recv = () =>
    sub
      .receive(
        {
          workOrderId: sc.woId,
          stepId: sc.boyaStep,
          subcontractorId: SUB_BOYER,
          returns: [{ rollId: sc.rollId, receivedQty: 51 }],
          newRolls: [{ qty: 51 }],
        },
        ADMIN,
      )
      .then(() => ({ ok: true as const, err: "" }))
      .catch((e: unknown) => ({ ok: false as const, err: (e as Error).message }));

  const close = () =>
    sub
      .closeRemainder(
        { stepId: sc.boyaStep, rollId: sc.rollId, reasonCode: SCRAP_REASON, reasonText: STAMP },
        ADMIN,
      )
      .then((r) => ({ ok: true as const, closed: r.data.closedQty, err: "" }))
      .catch((e: unknown) => ({ ok: false as const, closed: 0, err: (e as Error).message }));

  let a: { ok: boolean; err: string };
  let b: { ok: boolean; closed: number; err: string };
  if (parallel) {
    [a, b] = await Promise.all([recv(), close()]);
  } else {
    a = await recv();
    b = await close();
  }

  const st = await ledger(sc);
  const accounted = st.receiptSum + st.remainderScrap;
  const ok =
    st.currentQty >= 0 &&
    // Her iki işlem de geçtiyse defter 100'ü tam kapatmalı; biri düştüyse
    // kapatılan miktar 100'ü AŞMAMALI.
    accounted <= 100 + 0.001 &&
    (!(a.ok && b.ok) || Math.abs(accounted - 100) < 0.001);
  console.log(
    `   [${label}] kabul=${a.ok ? "OK" : `ERR(${a.err.slice(0, 40)})`} · ` +
      `kapama=${b.ok ? `OK(${b.closed})` : `ERR(${b.err.slice(0, 40)})`} · ` +
      `top=${st.rollStatus}/${st.currentQty} · defter=${st.receiptSum} + fire=${st.remainderScrap} = ${accounted}`,
  );
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// KOL B — kapama sonrası kabul iptalinin ÇIKMAZI (önizleme ↔ uç ayrışması)
// ─────────────────────────────────────────────────────────────────────────────
async function armDeadEnd(): Promise<void> {
  const sc = await setup("DEAD", 100);

  const res = await sub.receive(
    {
      workOrderId: sc.woId,
      stepId: sc.boyaStep,
      subcontractorId: SUB_BOYER,
      returns: [{ rollId: sc.rollId, receivedQty: 51 }],
      newRolls: [{ qty: 51 }],
    },
    ADMIN,
  );
  const receipt = res.data as { id: string; receiptNo: string };

  // İkinci masa "kalan gelmeyecek" der.
  const closed = await sub.closeRemainder(
    { stepId: sc.boyaStep, rollId: sc.rollId, reasonCode: SCRAP_REASON, reasonText: STAMP },
    ADMIN,
  );
  console.log(`   [DEAD] kalan kapatıldı: ${closed.data.closedQty} m fire`);

  // Şimdi ilk masa "51 değil 15 girmişim" der ve kabulü iptal etmek ister.
  const prev = await sub.getCancelPreview(receipt.id);
  const p = prev.data;
  console.log(
    `   [DEAD] önizleme: allSafe=${p.allSafe} · laterReceipts=${JSON.stringify(p.laterReceipts)} · ` +
      `batchMismatch=${p.batchMismatch.blocked}`,
  );

  // Born topu cascade listesine ver (önizlemenin dediği gibi).
  const born = await prisma.roll.findMany({
    where: { parentReceiptId: receipt.id },
    select: { id: true },
  });
  let cancelErr = "";
  let cancelOk = false;
  try {
    await sub.cancelReceipt(receipt.id, `${STAMP} yanlis metraj`, ADMIN, born.map((b) => b.id));
    cancelOk = true;
  } catch (e) {
    cancelErr = (e as Error).message;
  }
  console.log(`   [DEAD] iptal: ${cancelOk ? "OK" : `ERR(${cancelErr.slice(0, 90)})`}`);

  check(
    "D1 önizleme ile uç AYNI cevabı verir (allSafe=true ⇒ iptal geçer)",
    p.allSafe === cancelOk,
    `allSafe=${p.allSafe} cancelOk=${cancelOk}`,
  );
  check(
    "D2 iptal reddedildiyse önizleme bunu ÖNCEDEN söylemiş olmalı (allSafe=false)",
    cancelOk || p.allSafe === false,
    `allSafe=${p.allSafe}`,
  );

  // "Kalan kapamasını geri al" diye bir çıkış var mı? (mekanik sonda)
  const hasUndo =
    typeof (sub as unknown as Record<string, unknown>).undoCloseRemainder === "function" ||
    typeof (sub as unknown as Record<string, unknown>).reopenRemainder === "function";
  check("D3 kalan kapamasının geri alma yolu VAR", hasUndo, hasUndo ? "" : "servis üzerinde undo ucu yok");

  const st = await ledger(sc);
  console.log(
    `   [DEAD] son durum: top=${st.rollStatus}/${st.currentQty} · aktif makbuz=${st.activeReceipts} · ` +
      `defter=${st.receiptSum} · kalan-fire=${st.remainderScrap} · çekme-fire=${st.shrinkScrap}`,
  );
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO S-4-02 — kısmi kabul × kalan kapama (${STAMP}) ===\n`);

  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun)
    throw new Error("Seed fixture eksik — önce 'npm run seed'");

  // Fire sebep kodu KATALOGDAN okunur (yeni satır YARATILMAZ — salt-okunur denetim).
  const preset = await prisma.reasonPreset.findFirst({
    where: { kind: ReasonPresetKind.ROLL_SCRAP, isActive: true },
    select: { code: true },
    orderBy: { sortOrder: "asc" },
  });
  if (!preset) throw new Error("Aktif ROLL_SCRAP sebep kaydı yok — repro kurulamadı (seed gerekir).");

  ITEM = item.id;
  ADMIN = admin.id;
  ST_BOYA = boya.id;
  ST_KURSUN = kursun.id;
  SUB_BOYER = boyer.id;
  SCRAP_REASON = preset.code;
  console.log(`Fire sebep kodu: ${SCRAP_REASON}\n`);

  console.log("--- KOL A1: SIRALI (kabul → kapama) ---");
  check("A1 sıralı: defter mutabakatı korunuyor", await armConcurrent("SIRALI", false));

  console.log("\n--- KOL A2: PARALEL (kabul ‖ kapama) ---");
  check("A2 paralel: defter mutabakatı korunuyor", await armConcurrent("PARALEL", true));

  console.log("\n--- KOL A3: PARALEL × 10 tekrar ---");
  let broke = 0;
  for (let i = 0; i < 10; i++) {
    if (!(await armConcurrent(`P#${i + 1}`, true))) broke++;
  }
  check("A3 10 paralel turun hepsinde mutabakat korundu", broke === 0, `bozulan=${broke}/10`);

  console.log("\n--- KOL B: kapama sonrası kabul iptali (önizleme ↔ uç) ---");
  await armDeadEnd();

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
