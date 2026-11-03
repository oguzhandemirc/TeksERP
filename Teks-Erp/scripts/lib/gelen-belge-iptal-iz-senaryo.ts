// =============================================================================
// test_gelen_belge_iptal ek senaryoları (inceleme bulguları, 2026-11-03) — ana bekçinin 300 satır tavanı için ayrı.
//   §9  ⭐ işlem İZİ yalnız RollOperation değildir: aktif muayene / saha hatası / lab testi / kartela kesimi olan ham
//       stok topu belgeyle düşmez (önizleme BLOCKED, iptal 409); iptal edilmiş (voided) muayene iz değildir.
//   §10 ⭐ belge iptalinden ÖNCE tek tek iptal edilmiş (SKIP) top, belge iptal edildikten sonra geri alınamaz
//       (restore 409 RESTORE_BLOCKED) — yoksa iptal edilmiş belgenin malı stokta dirilir.
// =============================================================================
import crypto from "node:crypto";
import prisma from "../../src/lib/prisma";
import { cancelDeliveryNote } from "../../src/services/gelen-belge-iptal.service";
import { previewDeliveryNoteCancel } from "../../src/services/gelen-belge-iptal-onizleme.service";
import { InventoryService } from "../../src/services/inventory.service";

type Check = (label: string, ok: boolean, extra?: string) => void;
type ErrorOf = (fn: () => Promise<unknown>) => Promise<{ status: number; code?: string; blockers?: Array<{ code: string }> } | null>;
type ApprovedNote = (docNo: string, n: number) => Promise<{ id: string; rolls: Array<{ id: string; barcode: string }> }>;
export interface IzDeps { tag: string; actorId: string; fabric: string; check: Check; errorOf: ErrorOf; approvedNote: ApprovedNote; openWo: (barcodes: string[]) => Promise<string>;
  /** Kartela kesimi fikstürü — kartela yazımı tek yazarlıdır (`test_swatch_event_yazar`), `test_` dosyası kurar. */
  cutSwatch: (parentRollId: string) => Promise<unknown> }

const inv = new InventoryService();
const REASON = "Yanlış belge girildi";

function inspection(rollId: string, actorId: string, voided: boolean) {
  return prisma.rollInspection.create({
    data: {
      rollId, phase: "RAW", inspectedLengthM: 40, widthSource: "UNKNOWN", totalPoints: 0, defectCount: 0, unplacedDefectCount: 0,
      ruleSnapshot: {}, inspectedById: actorId, ...(voided ? { voidedAt: new Date(), voidedById: actorId, voidReason: "test" } : {}),
    },
    select: { id: true },
  });
}

export async function scenarioTraces(d: IzDeps): Promise<void> {
  console.log("§9 İz türleri (muayene / hata / lab / kartela)");
  const n = await d.approvedNote(`${d.tag}-IZ`, 5);
  const [insp, voided, err, lab, sw] = n.rolls as [typeof n.rolls[0], typeof n.rolls[0], typeof n.rolls[0], typeof n.rolls[0], typeof n.rolls[0]];
  await inspection(insp.id, d.actorId, false);
  await inspection(voided.id, d.actorId, true);
  await prisma.rollError.create({ data: { rollId: err.id, origin: "PROCESS", startMeter: 10, errorType: "test" } });
  await prisma.labTest.create({ data: { testNo: `${d.tag}-LAB`, itemId: d.fabric, testedOn: new Date(), rollId: lab.id } });
  await d.cutSwatch(sw.id);
  const pv = await previewDeliveryNoteCancel(n.id);
  const by = new Map(pv.rolls.map((r) => [r.rollId, r]));
  const codesOf = (id: string) => (by.get(id)?.blockers ?? []).map((b) => b.code);
  d.check("§9 ⭐ aktif muayeneli STOCK top → BLOCKED (ROLL_INSPECTION)", by.get(insp.id)?.outcome === "BLOCKED" && codesOf(insp.id).includes("ROLL_INSPECTION"), codesOf(insp.id).join(","));
  d.check("§9 iptal edilmiş muayene iz değil → CANCEL", by.get(voided.id)?.outcome === "CANCEL", codesOf(voided.id).join(","));
  d.check("§9 ⭐ saha hatası → BLOCKED (ROLL_ERROR)", codesOf(err.id).includes("ROLL_ERROR"), codesOf(err.id).join(","));
  d.check("§9 ⭐ lab testi → BLOCKED (ROLL_LAB_TEST)", codesOf(lab.id).includes("ROLL_LAB_TEST"), codesOf(lab.id).join(","));
  d.check("§9 ⭐ kartela kesimi → BLOCKED (ROLL_SWATCH)", codesOf(sw.id).includes("ROLL_SWATCH"), codesOf(sw.id).join(","));
  d.check("§9 cancellable=false + mesaj ne yapılacağını söyler", !pv.cancellable && pv.blockers.every((b) => /önce/.test(b.message)), pv.blockers.map((b) => b.message).join(" | "));
  const e = await d.errorOf(() => cancelDeliveryNote(n.id, { clientToken: crypto.randomUUID(), reason: REASON }, d.actorId));
  d.check("§9 ⭐ iptal → 409 BLOCKED (ROLL_INSPECTION)", e?.status === 409 && e.code === "DELIVERY_NOTE_CANCEL_BLOCKED" && !!e.blockers?.some((b) => b.code === "ROLL_INSPECTION"), JSON.stringify(e?.code));
  const live = await prisma.roll.count({ where: { id: { in: n.rolls.map((r) => r.id) }, status: "CANCELLED" } });
  d.check("§9 engelde hiçbir top düşmedi", live === 0, `iptal=${live}`);
  const w = await d.approvedNote(`${d.tag}-IZW`, 1);
  const wo = await d.openWo([w.rolls[0]!.barcode]);
  const step = await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: wo }, select: { id: true } });
  await prisma.rollError.create({ data: { rollId: w.rolls[0]!.id, origin: "PROCESS", startMeter: 5, errorType: "test", detectedAtStepId: step.id } });
  const pw = (await previewDeliveryNoteCancel(w.id)).workOrders.find((x) => x.id === wo);
  d.check("§9 ⭐ adımda tespit edilen hata → iş emri işlem görmüş (seçilemez)", pw?.selectable === false, JSON.stringify(pw));
}

export async function scenarioSkipRestore(d: IzDeps): Promise<void> {
  console.log("§10 Tek tek iptal edilmiş top + belge iptali → geri alınamaz");
  const n = await d.approvedNote(`${d.tag}-SK`, 2);
  const [one, two] = n.rolls as [typeof n.rolls[0], typeof n.rolls[0]];
  await inv.softDelete(one.id, d.actorId, { confirmLabelPrinted: true, reason: "Hatalı kayıt" });
  const pv = await previewDeliveryNoteCancel(n.id);
  d.check("§10 tek tek iptal edilmiş top SKIP", pv.rolls.find((r) => r.rollId === one.id)?.outcome === "SKIP");
  await cancelDeliveryNote(n.id, { clientToken: crypto.randomUUID(), reason: REASON }, d.actorId);
  const st = await prisma.roll.findMany({ where: { id: { in: [one.id, two.id] } }, select: { id: true, status: true, cancelReasonCode: true } });
  d.check("§10 SKIP topun kendi iptal sebebi korunur (K15 dokunmaz)", st.find((r) => r.id === one.id)?.cancelReasonCode !== "GELEN_BELGE_IPTAL" && st.every((r) => r.status === "CANCELLED"), JSON.stringify(st));
  const e = await d.errorOf(() => inv.restoreCancelledRoll(one.id, d.actorId));
  d.check("§10 ⭐ iptal edilmiş belgenin topu geri alınamaz → 409 RESTORE_BLOCKED", e?.status === 409 && e.code === "RESTORE_BLOCKED", JSON.stringify(e));
  const after = await prisma.roll.findUnique({ where: { id: one.id }, select: { status: true } });
  d.check("§10 top CANCELLED kalır", after?.status === "CANCELLED", String(after?.status));
}
