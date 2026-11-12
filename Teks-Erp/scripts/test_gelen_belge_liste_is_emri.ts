// =============================================================================
// Test: Gelen belge listesi "İş emri" sütunu — `GET /irsaliyeler` kalemi `workOrders: {id, workOrderNumber}[]` (2026-11-10)
// Çalıştır: npx tsx scripts/test_gelen_belge_liste_is_emri.ts
// Kaynak: `services/gelen-belge-liste-is-emri.service.ts` (`loadNoteWorkOrders`, sayfa başına tek ham SQL) +
//   `helpers/workorder-rolls.helper.ts` `rollWorkOrderEdgesSql` (üç bağın SQL ikizi), liste `listDeliveryNotes`.
//   §1 ⭐ satır → top → parti → İE bağı listede görünür (rotasız İE: yalnız parti üyeliği)
//   §2 ⭐ iptal (CANCELLED) İE görünmez; aynı belgenin canlı İE'si kalır
//   §3 bağsız belge (satırı yok / satırı topsuz) → []
//   §4 ⭐ iki İE'ye dağılmış belge → iki İE, İE no sırasıyla, tekil (aynı İE'nin iki topu tek çip)
//   §5 ⭐ adım dalları (durduğu adım · üretildiği adım) da bağ; SQL kümesi = `whereWorkOrdersOfRolls` Prisma kümesi
//   §6 kalem yalnız id + workOrderNumber taşır
// NEGATİF SONDA (2026-11-10, tek tek, geri alındı):
//   • SQL'den `w.status <> 'CANCELLED'` düşürüldü → §2 + §2b + §5c ❌ (8/3)
//   • `rollWorkOrderEdgesSql`ten `producedInStepId` dalı silindi → §5a + §5c ❌ (9/2)
//   • `DISTINCT` düşürüldü → §4 + §5c ❌ (aynı İE iki kez; 9/2)
// =============================================================================
import { randomUUID } from "crypto";
import { RollForm, RollStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { listDeliveryNotes } from "../src/services/gelen-belge-note.service";
import { whereWorkOrdersOfRolls } from "../src/services/helpers/workorder-rolls.helper";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-GBIE-${STAMP}`;
const fx = { woIds: [] as string[], rollIds: [] as string[], noteIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[] };

type Item = { id: string; workOrders?: Array<{ id: string; workOrderNumber: string }> };

async function main(): Promise<void> {
  console.log("=== Gelen belge listesi — bağlı iş emirleri ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazılabilir", false, engel); return; }

  const itemId = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST GBIE kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(itemId);
  const stationId = (await prisma.station.create({ data: { code: `${P}-ST`.slice(0, 32), name: `TEST GBIE ist ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", department: "KALITE" }, select: { id: true } })).id;
  fx.stationIds.push(stationId);

  // İE no'ları kasıtlı ters sırada yaratılır: sıralama yaratılış değil İE no olmalı.
  const mkWo = async (tag: string, status: WorkOrderStatus = WorkOrderStatus.IN_PROGRESS) => {
    const w = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-${tag}`, status }, select: { id: true, workOrderNumber: true } });
    fx.woIds.push(w.id);
    return w;
  };
  let seq = 0;
  const mkRoll = async (data: { batchId?: string; currentStepId?: string; producedInStepId?: string }) => {
    const r = await prisma.roll.create({
      data: { barcode: `${P}-R${seq++}`.slice(0, 40), itemId, initialQty: 10, currentQty: 10, status: data.currentStepId ? RollStatus.IN_PRODUCTION : RollStatus.STOCK, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK, ...data },
      select: { id: true },
    });
    fx.rollIds.push(r.id);
    return r.id;
  };
  const mkBatch = async (workOrderId: string, n: string) => (await prisma.batch.create({ data: { workOrderId, batchNumber: `${P}-${n}`.slice(0, 64) }, select: { id: true } })).id;
  const mkStep = async (workOrderId: string) => (await prisma.workOrderStep.create({ data: { workOrderId, stationId, stepSequence: 1 }, select: { id: true } })).id;
  let noteSeq = 0;
  const mkNote = async (rollIds: Array<string | null>) => {
    const n = await prisma.customerDeliveryNote.create({
      data: { noteNo: `${P}-N${noteSeq++}`.slice(0, 32), sourceKind: "MANUAL", status: "APPROVED", lines: { create: rollIds.map((rollId, i) => ({ lineNo: i + 1, meters: 10, rollId })) } },
      select: { id: true },
    });
    fx.noteIds.push(n.id);
    return n.id;
  };

  // §1 rotasız İE: top yalnız parti üyesi
  const woA = await mkWo("A");
  const note1 = await mkNote([await mkRoll({ batchId: await mkBatch(woA.id, "B-A") })]);
  // §2 iptal + canlı
  const woCancel = await mkWo("C-IPTAL", WorkOrderStatus.CANCELLED);
  const woLive = await mkWo("C-CANLI");
  const note2 = await mkNote([await mkRoll({ batchId: await mkBatch(woCancel.id, "B-CI") }), await mkRoll({ batchId: await mkBatch(woLive.id, "B-CC") })]);
  const note2b = await mkNote([await mkRoll({ batchId: await mkBatch(woCancel.id, "B-CI2") })]);
  // §3 bağsız
  const note3a = await mkNote([]);
  const note3b = await mkNote([null, await mkRoll({})]);
  // §4 iki İE (Z önce yaratılır, sıralı dönüşte M önce), M'nin iki topu
  const woZ = await mkWo("D-Z");
  const woM = await mkWo("D-M");
  const bM = await mkBatch(woM.id, "B-M");
  const note4 = await mkNote([await mkRoll({ batchId: await mkBatch(woZ.id, "B-Z") }), await mkRoll({ batchId: bM }), await mkRoll({ batchId: bM })]);
  // §5 adım dalları
  const woCur = await mkWo("E-CUR");
  const woProd = await mkWo("E-PRD");
  const note5 = await mkNote([await mkRoll({ currentStepId: await mkStep(woCur.id) }), await mkRoll({ producedInStepId: await mkStep(woProd.id) })]);

  const res = await listDeliveryNotes({ q: P, limit: 200 } as never);
  const rows = new Map((res.items as unknown as Item[]).map((r) => [r.id, r]));
  const nums = (id: string) => (rows.get(id)?.workOrders ?? []).map((w) => w.workOrderNumber);
  check("liste fikstür belgelerini döndü", fx.noteIds.every((id) => rows.has(id)), `${rows.size}/${fx.noteIds.length}`);

  check("§1 ⭐ satır → top → parti → İE listede görünür", JSON.stringify(nums(note1)) === JSON.stringify([woA.workOrderNumber]), JSON.stringify(nums(note1)));
  check("§2 ⭐ iptal İE görünmez, canlı İE kalır", JSON.stringify(nums(note2)) === JSON.stringify([woLive.workOrderNumber]), JSON.stringify(nums(note2)));
  check("§2b yalnız iptal İE'ye bağlı belge → []", Array.isArray(rows.get(note2b)?.workOrders) && nums(note2b).length === 0, JSON.stringify(nums(note2b)));
  check("§3a satırsız belge → []", Array.isArray(rows.get(note3a)?.workOrders) && nums(note3a).length === 0);
  check("§3b topsuz/İE'siz satırlı belge → []", Array.isArray(rows.get(note3b)?.workOrders) && nums(note3b).length === 0);
  check("§4 ⭐ iki İE'ye dağılmış belge → iki İE, İE no sırasıyla, tekil", JSON.stringify(nums(note4)) === JSON.stringify([woM.workOrderNumber, woZ.workOrderNumber]), JSON.stringify(nums(note4)));
  check("§5a ⭐ durduğu adım + üretildiği adım dalları da bağ", JSON.stringify(nums(note5)) === JSON.stringify([woCur.workOrderNumber, woProd.workOrderNumber]), JSON.stringify(nums(note5)));

  // §5 SQL ikizi ↔ Prisma tek tanım (iptal hariç), her fikstür belgede
  const diff: string[] = [];
  for (const noteId of fx.noteIds) {
    const viaPrisma = (await prisma.workOrder.findMany({ where: { AND: [whereWorkOrdersOfRolls({ deliveryNoteLine: { noteId } }), { status: { not: WorkOrderStatus.CANCELLED } }] }, select: { id: true } })).map((w) => w.id).sort();
    const viaSql = (rows.get(noteId)?.workOrders ?? []).map((w) => w.id).sort();
    if (JSON.stringify(viaPrisma) !== JSON.stringify(viaSql)) diff.push(noteId);
  }
  check("§5c ⭐ SQL kümesi = `whereWorkOrdersOfRolls` Prisma kümesi (her fikstür belge)", diff.length === 0, diff.join(","));

  check("§6 kalem yalnız id + workOrderNumber taşır", (rows.get(note4)?.workOrders ?? []).every((w) => Object.keys(w).sort().join(",") === "id,workOrderNumber"));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await del("satır", () => prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: fx.noteIds } } }));
  await del("belge", () => prisma.customerDeliveryNote.deleteMany({ where: { id: { in: fx.noteIds } } }));
  await del("top", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("parti", () => prisma.batch.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("adım", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("iş emri", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("istasyon", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("kalem", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  check("temizlik: TEST-GBIE kalıntısı yok", (await prisma.customerDeliveryNote.count({ where: { id: { in: fx.noteIds } } })) === 0 && (await prisma.workOrder.count({ where: { id: { in: fx.woIds } } })) === 0);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e); })
  .finally(async () => {
    stopNotificationJobs();
    await cleanup().catch((e) => { fail++; console.error("TEMİZLİK HATASI:", e); });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
