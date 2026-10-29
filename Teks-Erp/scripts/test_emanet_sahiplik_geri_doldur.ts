// =============================================================================
// BEKÇİ — EMANET SAHİPLİK GERİ DOLDURMA BETİĞİ (H10b, `scripts/fix_emanet_owner_backfill.ts`)
// =============================================================================
//   §1 Teşhis: sahipli atanın sahipsiz çocuğu + torunu ÇOCUK adayı (atanın sahibi)
//   §2 Teşhis: aynı sahipli iki kaynaktan doğan top DOĞAN adayı; doğan topun sahipsiz çocuğu da aday
//   §3 Teşhis: sahipli + sahipsiz kaynaklı makbuz BELİRSİZ (aday değil); hepsi sahipsiz makbuz ve
//      sahipsiz atanın çocuğu aday DEĞİL; zaten sahipli çocuk aday değil
//   §4 Uygulama: yalnız listelenen id'ler yazılır + audit `EMANET_OWNER_BACKFILL`; ikinci teşhis boş;
//      sayı tutmazsa (veri değişti) tx geri alınır
// Negatif sonda (2026-10-29): betikte `{ strict: true }` kaldırılınca §3 "belirsiz makbuz" kırmızı (geri alındı).
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { applyProposals, diagnose } from "./fix_emanet_owner_backfill";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const STAMP = Date.now().toString(36);
const P = `TEST-EBF-${STAMP}`;
const fx = { itemId: null as string | null, customerIds: [] as string[], rollIds: [] as string[], receiptIds: [] as string[], stationId: null as string | null, woId: null as string | null };

async function main(): Promise<void> {
  console.log("=== Emanet sahiplik geri doldurma betiği (H10b) ===");
  const item = await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST EBF kumaş ${STAMP}`, itemType: ItemType.FABRIC }, select: { id: true } });
  fx.itemId = item.id;
  const mkCust = async (tag: string) => {
    const c = await prisma.customer.create({ data: { code: `${P}-${tag}`.slice(0, 32), name: `TEST EBF ${tag} ${STAMP}` }, select: { id: true } });
    fx.customerIds.push(c.id);
    return c.id;
  };
  const A = await mkCust("A");
  const B = await mkCust("B");
  const mkRoll = async (owner: string | null, extra: { parentRollId?: string; parentReceiptId?: string } = {}) => {
    const r = await prisma.roll.create({ data: { itemId: item.id, initialQty: 10, currentQty: 10, ownerCustomerId: owner, ...extra }, select: { id: true } });
    fx.rollIds.push(r.id);
    return r.id;
  };
  const sub = await ensureTestDyeHouse();
  // Makbuz başlığı iş emri + adım ister (subcontractor_receipts_header_ck).
  const st = await prisma.station.create({ data: { code: `${P}-F`.slice(0, 32), name: `TEST EBF fason ${STAMP}`, type: "EXTERNAL", kind: "SUBCONTRACTOR" }, select: { id: true } });
  fx.stationId = st.id;
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-WO`, steps: { create: [{ stationId: st.id, stepSequence: 1 }] } }, select: { id: true, steps: { select: { id: true } } } });
  fx.woId = wo.id;
  const mkReceipt = async (tag: string, sources: string[]) => {
    const rc = await prisma.subcontractorReceipt.create({ data: { receiptNo: `${P}-${tag}`, subcontractorId: sub.id, workOrderId: wo.id, stepId: wo.steps[0]!.id, items: { create: sources.map((newRollId) => ({ newRollId })) } }, select: { id: true } });
    fx.receiptIds.push(rc.id);
    return rc.id;
  };

  // Çocuk zinciri.
  const P1 = await mkRoll(A);
  const C1 = await mkRoll(null, { parentRollId: P1 });
  const G1 = await mkRoll(null, { parentRollId: C1 });
  const C2 = await mkRoll(B, { parentRollId: P1 }); // zaten sahipli (yanlış bile olsa betik dokunmaz)
  const P2 = await mkRoll(null);
  const C3 = await mkRoll(null, { parentRollId: P2 });
  // Makbuz doğumları.
  const S1 = await mkRoll(A);
  const S2 = await mkRoll(A);
  const R1 = await mkReceipt("R1", [S1, S2]);
  const B1 = await mkRoll(null, { parentReceiptId: R1 });
  const BC1 = await mkRoll(null, { parentRollId: B1 });
  const S3 = await mkRoll(A);
  const S4 = await mkRoll(null);
  const R2 = await mkReceipt("R2", [S3, S4]);
  const B2 = await mkRoll(null, { parentReceiptId: R2 });
  const S5 = await mkRoll(null);
  const S6 = await mkRoll(null);
  const R3 = await mkReceipt("R3", [S5, S6]);
  const B3 = await mkRoll(null, { parentReceiptId: R3 });
  // Doğan topun kaynağı kendisi geri doldurulacak bir çocuksa (C1 → A) zincir yürür.
  const R4 = await mkReceipt("R4", [C1]);
  const B4 = await mkRoll(null, { parentReceiptId: R4 });

  const ours = new Set(fx.rollIds);
  const d1 = await diagnose();
  const mine = d1.proposals.filter((p) => ours.has(p.rollId));
  const of = (id: string) => mine.find((p) => p.rollId === id);

  console.log("\n── §1 çocuk zinciri ──");
  check("sahipsiz çocuk C1 → atanın sahibi (ÇOCUK)", of(C1)?.ownerCustomerId === A && of(C1)?.kind === "CHILD" && of(C1)?.fromId === P1, JSON.stringify(of(C1)));
  check("torun G1 → A (zincir)", of(G1)?.ownerCustomerId === A, JSON.stringify(of(G1)));

  console.log("\n── §2 makbuzdan doğan ──");
  check("aynı sahipli iki kaynaktan doğan B1 → A (DOĞAN)", of(B1)?.ownerCustomerId === A && of(B1)?.kind === "BORN" && of(B1)?.fromId === R1, JSON.stringify(of(B1)));
  check("doğan topun çocuğu BC1 → A", of(BC1)?.ownerCustomerId === A, JSON.stringify(of(BC1)));
  check("kaynağı geri doldurulacak çocuk olan makbuzun doğanı B4 → A", of(B4)?.ownerCustomerId === A, JSON.stringify(of(B4)));

  console.log("\n── §3 aday olmayanlar ──");
  const conflict = d1.conflicts.find((c) => c.receiptId === R2);
  check("sahipli + sahipsiz kaynaklı makbuz BELİRSİZ, doğan top aday değil", !!conflict && conflict.rollIds.includes(B2) && !of(B2), JSON.stringify({ conflict, b2: of(B2) }));
  check("hepsi sahipsiz kaynaklı makbuzun doğanı aday değil (fabrika malı)", !of(B3) && !d1.conflicts.some((c) => c.receiptId === R3));
  check("sahipsiz atanın çocuğu ve zaten sahipli çocuk aday değil", !of(C3) && !of(C2));
  check("aday kümesi tam olarak beklenen 5 top", mine.length === 5, mine.map((p) => p.rollId).join(","));

  console.log("\n── §4 uygulama ──");
  // Veri değişti: listelenen topa araya sahip yazıldıysa hiçbir şey yazılmaz.
  await prisma.roll.update({ where: { id: G1 }, data: { ownerCustomerId: B } });
  const changed = await applyProposals(mine).then(() => "yazıldı", (e: Error) => e.message);
  const c1After = await prisma.roll.findUnique({ where: { id: C1 }, select: { ownerCustomerId: true } });
  check("sayı tutmayınca tx geri alındı (C1 hâlâ sahipsiz)", changed.startsWith("Veri değişti") && c1After?.ownerCustomerId === null, changed);
  await prisma.roll.update({ where: { id: G1 }, data: { ownerCustomerId: null } });
  const n = await applyProposals(mine);
  const after = await prisma.roll.findMany({ where: { id: { in: [C1, G1, B1, BC1, B4, B2, B3, C3, C2] } }, select: { id: true, ownerCustomerId: true } });
  const ownerAfter = new Map(after.map((r) => [r.id, r.ownerCustomerId]));
  check("5 top yazıldı, hepsi A", n === 5 && [C1, G1, B1, BC1, B4].every((id) => ownerAfter.get(id) === A), JSON.stringify(after));
  check("listelenmeyenlere dokunulmadı", ownerAfter.get(B2) === null && ownerAfter.get(B3) === null && ownerAfter.get(C3) === null && ownerAfter.get(C2) === B);
  const audits = await prisma.systemLog.count({ where: { recordId: { in: [C1, G1, B1, BC1, B4] }, tableName: "ROLL", newData: { path: ["event"], equals: "EMANET_OWNER_BACKFILL" } } });
  check("her yazım için audit (EMANET_OWNER_BACKFILL)", audits === 5, String(audits));
  const d2 = await diagnose();
  check("ikinci teşhis: bu bekçinin toplarında aday yok", d2.proposals.every((p) => !ours.has(p.rollId)), JSON.stringify(d2.proposals.filter((p) => ours.has(p.rollId))));
  check("belirsiz makbuz ikinci teşhiste de listelenir", d2.conflicts.some((c) => c.receiptId === R2));
}

async function cleanup(): Promise<void> {
  const del = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { fail++; console.log(`❌ temizlik ${label}: ${String(e).slice(0, 200)}`); } };
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: fx.rollIds } } }));
  await del("roll bağları", () => prisma.roll.updateMany({ where: { id: { in: fx.rollIds } }, data: { parentRollId: null, parentReceiptId: null } }));
  await del("receiptItem", () => prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: fx.receiptIds } } }));
  await del("receipt", () => prisma.subcontractorReceipt.deleteMany({ where: { id: { in: fx.receiptIds } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  if (fx.woId) { const id = fx.woId; await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: id } })); await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id } })); }
  if (fx.stationId) { const id = fx.stationId; await del("station", () => prisma.station.deleteMany({ where: { id } })); }
  if (fx.itemId) { const id = fx.itemId; await del("item", () => prisma.item.deleteMany({ where: { id } })); }
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } }));
}

const engel = hedefDbEngeli();
(engel ? Promise.reject(new Error(`DURDURULDU — ${engel}`)) : main())
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    if (!engel) await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
