// =============================================================================
// TeksERP — OKUTMAYLA ROTA servisi (K29, 2026-11-03; ayar `production.routeMode=SCAN`)
// =============================================================================
// Karar `helpers/okutmayla-rota.helper.ts`te (saf). Burada: kart → İE, kart çözümü kapısı (`gateByCard` — Kurşun/KK
// ve Tambur `by-card` aynı kapıdan), önizleme ve UYGULAMA. Uygulama tek tx: WO satır kilidi (`touchWorkOrderTx`) →
// kararı TAZE okuma → ATLANDI claim'i → (ekleme) → topları taşıma claim'i → durum hesapları → olay defteri. Audit tx dışında.
// Atlanan adım SİLİNMEZ (status SKIPPED, `skipReason=SCAN_SKIP`); bekleyen kuyruk hareketi GERİ ALINIR (istasyondan
// geçmiş sayılmaz) — fatura/maliyet gerçekleşen işten türediği için atlanan adım onlara girmez.
// =============================================================================
import { Prisma, RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { normalizeScanCode } from "../utils/code-format";
import { AuditService } from "./audit.service";
import {
  entryPendingRollWhere,
  loadScanRouteFacts,
  planScanRoute,
  scanRouteEnabledFor,
  type ScanRoutePlan,
  type ScanRouteFacts,
} from "./helpers/okutmayla-rota.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { revokeRollMovements } from "./helpers/roll-movement.helper";
import { ensureWorkOrderInProgress, recomputeStepStatus } from "./helpers/roll-step.helper";
import { readStepSnapshotsTx, recordStepDiffTx } from "./helpers/workorder-field-diff.helper";
import { recordStepPlanChangesTx } from "./helpers/workorder-event.helper";
import { resolveStationDefaultTargets, type DefaultTarget } from "./helpers/station-default-targets.helper";
import { ACTIVE_TARGET_VALUE, setWorkOrderTargetValuesTx } from "./helpers/workorder-target-value.helper";
import { FOLD_PROPERTY_CODE } from "./helpers/fold-type";
import { tokenReplay } from "./helpers/token-replay.helper";
import { stepRunsStepFlow, STEP_FLOW_SELECT } from "./helpers/quality-station.helper";

/** Tabletin göreceği karar özeti (önizleme ve `SCAN_ROUTE_AVAILABLE` hata ayrıntısı). */
export interface ScanRouteView {
  kind: "OPEN_EXISTING" | "MOVE" | "INSERT" | "BLOCKED";
  workOrderId: string;
  stationId: string;
  stationName: string;
  targetStepId: string | null;
  skipped: Array<{ stepId: string; stationName: string }>;
  warnings: string[];
  block: null | { code: string; stepId: string; stationName: string; rollCount: number; message: string; closable: boolean };
  /** Türkçe tek cümle — eski istemci banner'ında görünen metin. */
  message: string;
}

export interface ScanRouteApplyResult {
  kind: "NOOP" | "MOVE" | "INSERT";
  workOrderId: string;
  targetStepId: string;
  insertedStepId: string | null;
  skipped: Array<{ stepId: string; stationName: string }>;
  warnings: string[];
  /** Hedef değer eklenemediyse (kilitli/çözülemedi) uyarı — sessiz değil. */
  targetsAdded: string[];
}

interface ApplyCtx {
  userId: string | null;
  stationId: string | null;
  deviceId: string | null;
  machineId: string | null;
}

const SKIP_REASON = "SCAN_SKIP";
const STATUS_LABEL: Record<StepStatus, string> = { PENDING: "Bekliyor", ACTIVE: "Aktif", COMPLETED: "Tamamlandı", SKIPPED: "Atlandı" };

async function cardWorkOrder(cardBarcode: string): Promise<{ workOrderId: string }> {
  const card = await prisma.travelerCard.findUnique({ where: { barcode: normalizeScanCode(cardBarcode) }, select: { status: true, workOrderId: true } });
  if (!card) throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
  if (card.status !== "ACTIVE") throw AppError.badRequest(`Bu refakat kartı aktif değil (durum: ${card.status})`);
  return { workOrderId: card.workOrderId };
}

async function stationName(stationId: string): Promise<string> {
  const st = await prisma.station.findUnique({ where: { id: stationId }, select: { name: true } });
  if (!st) throw AppError.badRequest("Oturum istasyonu bulunamadı.", { code: "SCAN_ROUTE_NO_SESSION" });
  return st.name;
}

function viewOf(plan: ScanRoutePlan, facts: ScanRouteFacts, station: { id: string; name: string }, closableStepIds: Set<string>): ScanRouteView {
  const nameOf = new Map(facts.steps.map((s) => [s.id, s.stationName]));
  const base = { workOrderId: facts.workOrderId, stationId: station.id, stationName: station.name };
  if (plan.kind === "OPEN_EXISTING") {
    return { ...base, kind: plan.kind, targetStepId: plan.targetStepId, skipped: [], warnings: [], block: null, message: `"${station.name}" adımı açılıyor.` };
  }
  if (plan.kind === "BLOCKED") {
    const closable = plan.code === "SCAN_ROUTE_OPEN_ELSEWHERE" && closableStepIds.has(plan.stepId);
    return { ...base, kind: plan.kind, targetStepId: null, skipped: [], warnings: [], message: plan.message,
      block: { code: plan.code, stepId: plan.stepId, stationName: plan.stationName, rollCount: plan.rollCount, message: plan.message, closable } };
  }
  const skipped = plan.skipStepIds.map((id) => ({ stepId: id, stationName: nameOf.get(id) ?? "?" }));
  const skipText = skipped.length ? ` Atlanacak: ${skipped.map((s) => s.stationName).join(", ")}.` : "";
  const head = plan.kind === "INSERT"
    ? `"${station.name}" bu işin rotasında yok — okutmaya göre rotada adım olarak eklenecek.`
    : `"${station.name}" adımına geçilecek.`;
  return { ...base, kind: plan.kind, targetStepId: plan.kind === "MOVE" ? plan.targetStepId : null, skipped, warnings: plan.warnings, block: null,
    message: `${head}${skipText} Tablet uygulamasını güncelleyin ya da panelden konumu düzeltin.` };
}

/** "Bitmiş say ve geç" yalnız mevcut kart akışı kapatma yolu (kurşun/KK `finishStep`) olan adımda sunulur. */
async function closableSteps(facts: ScanRouteFacts): Promise<Set<string>> {
  const rows = await prisma.workOrderStep.findMany({ where: { id: { in: facts.steps.map((s) => s.id) } }, select: { id: true, station: { select: STEP_FLOW_SELECT } } });
  return new Set(rows.filter((r) => stepRunsStepFlow(r.station)).map((r) => r.id));
}

async function decide(workOrderId: string, stationId: string): Promise<{ plan: ScanRoutePlan | null; view: ScanRouteView | null }> {
  const station = { id: stationId, name: await stationName(stationId) };
  const facts = await loadScanRouteFacts(prisma, workOrderId);
  const plan = planScanRoute(facts, station);
  return { plan, view: plan ? viewOf(plan, facts, station, await closableSteps(facts)) : null };
}

/**
 * Kart çözümü kapısı (Kurşun/KK + Tambur `by-card`). `null` → bugünkü çözüm aynen (SIRALI / istasyon kapsam dışı /
 * karar yok). `{ stepId }` → toplar zaten bu istasyonun adımında. Taşıma/ekleme/engel → 400 `SCAN_ROUTE_AVAILABLE`
 * (GET yazmaz; yeni tablet ayrıntıdaki kararla POST eder, eski tablet metni banner'da görür).
 */
export async function gateByCard(workOrderId: string, stationId: string | null): Promise<{ stepId: string } | null> {
  if (!(await scanRouteEnabledFor(stationId))) return null;
  const { plan, view } = await decide(workOrderId, stationId!);
  if (!plan) return null;
  if (plan.kind === "OPEN_EXISTING") return { stepId: plan.targetStepId };
  throw AppError.badRequest(view!.message, { code: "SCAN_ROUTE_AVAILABLE", scanRoute: view });
}

export async function previewScanRoute(cardBarcode: string, stationId: string | null): Promise<{ enabled: boolean; view: ScanRouteView | null }> {
  const { workOrderId } = await cardWorkOrder(cardBarcode);
  if (!stationId) throw AppError.badRequest("Okutmaya göre rota için tablette istasyon oturumu gerekli.", { code: "SCAN_ROUTE_NO_SESSION" });
  if (!(await scanRouteEnabledFor(stationId))) return { enabled: false, view: null };
  return { enabled: true, view: (await decide(workOrderId, stationId)).view };
}

/** Topların müşterisi (S10 çözücüsü müşteri varsayılanını önce okur) — gelen belgenin sahibi. */
async function customerOf(workOrderId: string): Promise<string | null> {
  const roll = await prisma.roll.findFirst({
    where: { OR: [{ batch: { workOrderId } }, { currentStep: { workOrderId } }], deliveryNoteLine: { note: { ownerCustomerId: { not: null } } } },
    select: { deliveryNoteLine: { select: { note: { select: { ownerCustomerId: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return roll?.deliveryNoteLine?.note.ownerCustomerId ?? null;
}

/** S10 hedefleri: İE'de o özellik için AKTİF hedef YOKSA eklenir (var olan ezilmez; yeni kural yazılmaz). */
async function addMissingTargetsTx(tx: Prisma.TransactionClient, workOrderId: string, defaults: DefaultTarget[], userId: string | null): Promise<string[]> {
  const active = await tx.workOrderTargetValue.findMany({ where: { workOrderId, ...ACTIVE_TARGET_VALUE }, select: { propertyId: true } });
  const have = new Set(active.map((a) => a.propertyId));
  const items = defaults.filter((t) => t.valueType !== "FLAG" && t.valueId && t.propertyCode !== FOLD_PROPERTY_CODE && !have.has(t.propertyId));
  if (items.length > 0) {
    await setWorkOrderTargetValuesTx(tx, { workOrderId, items: items.map((t) => ({ propertyId: t.propertyId, valueId: t.valueId })), userId });
  }
  const added = items.map((t) => `${t.propertyName}: ${t.valueName}`);
  const fold = defaults.find((t) => t.propertyCode === FOLD_PROPERTY_CODE && t.valueCode);
  if (fold) {
    const r = await tx.workOrder.updateMany({ where: { id: workOrderId, foldType: null }, data: { foldType: fold.valueCode } });
    if (r.count > 0) added.push(`${fold.propertyName}: ${fold.valueName}`);
  }
  return added;
}

/** Ekleme yeri açılır: `insertSeq` ve sonrası +1 (tekil sıra ertelenemez → negatif park, -1, ters çevir). */
async function shiftStepsFromTx(tx: Prisma.TransactionClient, workOrderId: string, insertSeq: number): Promise<void> {
  const where = { workOrderId, stepSequence: { gte: insertSeq } };
  const moved = await tx.workOrderStep.updateMany({ where, data: { stepSequence: { multiply: -1 } } });
  if (moved.count === 0) return;
  await tx.workOrderStep.updateMany({ where: { workOrderId, stepSequence: { lt: 0 } }, data: { stepSequence: { decrement: 1 } } });
  await tx.workOrderStep.updateMany({ where: { workOrderId, stepSequence: { lt: 0 } }, data: { stepSequence: { multiply: -1 } } });
}

const stale = () => AppError.conflict("İş bu sırada başka bir okutmayla değişti — kartı yeniden okutun.", { code: "SCAN_ROUTE_STALE" });

type ScanStation = { id: string; name: string; type: string };
type ApplyArgs = { workOrderId: string; station: ScanStation; defaults: DefaultTarget[]; ctx: ApplyCtx & { clientToken: string | null } };
type StepInfo = { name: string; status: StepStatus; seq: number };

async function moveRollsToTargetTx(
  tx: Prisma.TransactionClient,
  a: { workOrderId: string; station: ScanStation; fromStepIds: string[]; targetStepId: string; ctx: ApplyCtx },
): Promise<void> {
  const { workOrderId, station, targetStepId, ctx } = a;
  const plan = { fromStepIds: a.fromStepIds };
  const rolls = await tx.roll.findMany({
    where: { OR: [{ currentStepId: { in: plan.fromStepIds }, status: RollStatus.IN_PRODUCTION }, entryPendingRollWhere(workOrderId)] },
    select: { id: true, currentQty: true, weightKg: true, currentStepId: true, producedInStepId: true },
  });
  if (rolls.length === 0) throw stale();
  const ids = rolls.map((r) => r.id);
  await revokeRollMovements(tx, { rollIds: ids, workOrderStepIds: plan.fromStepIds, onlyOpen: true, reason: `SCAN_ROUTE: ${station.name} okutması`, userId: ctx.userId });
  const claimed = await tx.roll.updateMany({
    where: { id: { in: ids }, status: RollStatus.IN_PRODUCTION, OR: [{ currentStepId: { in: plan.fromStepIds } }, { currentStepId: null }] },
    data: { currentStepId: targetStepId },
  });
  if (claimed.count !== ids.length) throw stale();
  const unborn = rolls.filter((r) => !r.producedInStepId).map((r) => r.id);
  if (unborn.length > 0) await tx.roll.updateMany({ where: { id: { in: unborn }, producedInStepId: null }, data: { producedInStepId: targetStepId } });
  if (station.type !== "EXTERNAL") {
    await tx.rollMovement.createMany({
      data: rolls.map((r) => ({ rollId: r.id, workOrderStepId: targetStepId, qtyIn: r.currentQty, weightIn: r.weightKg, operatorId: ctx.userId, machineId: ctx.machineId, notes: "SCAN_ROUTE" })),
    });
  }
}

async function writeScanRouteEventsTx(
  tx: Prisma.TransactionClient,
  a: { workOrderId: string; station: ScanStation; skipStepIds: string[]; before: Awaited<ReturnType<typeof readStepSnapshotsTx>>; nameOf: Map<string, StepInfo>; ctx: ApplyCtx },
): Promise<void> {
  const { workOrderId, station, before, nameOf, ctx } = a;
  const plan = { skipStepIds: a.skipStepIds };
  const groupId = randomUUID();
  const reason = `${station.name} okutması${ctx.deviceId ? ` (cihaz ${ctx.deviceId.slice(0, 40)})` : ""}`;
  await recordStepDiffTx(tx, workOrderId, { before, after: await readStepSnapshotsTx(tx, workOrderId) }, { trigger: "SCAN_ROUTE", userId: ctx.userId, reason, groupId });
  const after = new Map((await tx.workOrderStep.findMany({ where: { id: { in: plan.skipStepIds } }, select: { id: true, stepSequence: true } })).map((s) => [s.id, s.stepSequence]));
  for (const id of plan.skipStepIds) {
    const s = nameOf.get(id)!;
    await recordStepPlanChangesTx(tx, workOrderId, {
      step: { id, stepSequence: after.get(id) ?? s.seq, stationName: s.name },
      changes: [{ field: "status", from: s.status, to: StepStatus.SKIPPED, fromLabel: STATUS_LABEL[s.status], toLabel: STATUS_LABEL.SKIPPED }],
    }, { trigger: SKIP_REASON, userId: ctx.userId, reason, groupId });
  }
}

async function applyPlanTx(tx: Prisma.TransactionClient, args: ApplyArgs): Promise<ScanRouteApplyResult> {
  const { workOrderId, station, defaults, ctx } = args;
  await touchWorkOrderTx(tx, workOrderId);
  const wo = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { status: true } });
  if (!wo || wo.status === WorkOrderStatus.COMPLETED || wo.status === WorkOrderStatus.CANCELLED || wo.status === WorkOrderStatus.SUPERSEDED) {
    throw AppError.conflict("İş emri kapalı; okutmayla adım eklenemez.", { code: "SCAN_ROUTE_WO_CLOSED" });
  }
  const facts = await loadScanRouteFacts(tx, workOrderId);
  const plan = planScanRoute(facts, station);
  const noop = (targetStepId: string): ScanRouteApplyResult => ({ kind: "NOOP", workOrderId, targetStepId, insertedStepId: null, skipped: [], warnings: [], targetsAdded: [] });
  if (!plan) {
    const own = facts.steps.filter((s) => s.stationId === station.id);
    if (own.length === 0) throw AppError.conflict("Bu işte taşınacak top yok.", { code: "SCAN_ROUTE_NOTHING" });
    return noop(own[own.length - 1]!.id);
  }
  if (plan.kind === "OPEN_EXISTING") return noop(plan.targetStepId);
  if (plan.kind === "BLOCKED") throw AppError.conflict(plan.message, { code: plan.code, stepId: plan.stepId, stationName: plan.stationName, rollCount: plan.rollCount });

  const before = await readStepSnapshotsTx(tx, workOrderId);
  const nameOf = new Map(facts.steps.map((s) => [s.id, { name: s.stationName, status: s.status, seq: s.stepSequence }]));

  // 1) Öndeki bekleyenler ATLANDI — atomik claim (beklenen durum PENDING/ACTIVE).
  if (plan.skipStepIds.length > 0) {
    const r = await tx.workOrderStep.updateMany({
      where: { id: { in: plan.skipStepIds }, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
      data: { status: StepStatus.SKIPPED, skipReason: SKIP_REASON, completedAt: null },
    });
    if (r.count !== plan.skipStepIds.length) throw stale();
  }

  // 2) Hedef adım: var olan ya da sahada eklenen.
  let targetStepId: string;
  let insertedStepId: string | null = null;
  if (plan.kind === "INSERT") {
    await shiftStepsFromTx(tx, workOrderId, plan.insertSeq);
    const created = await tx.workOrderStep.create({
      data: {
        workOrderId, stationId: station.id, stepSequence: plan.insertSeq,
        addedVia: "SCAN", addedById: ctx.userId, addedDeviceId: ctx.deviceId?.slice(0, 128) ?? null, clientToken: ctx.clientToken,
      },
      select: { id: true },
    });
    targetStepId = insertedStepId = created.id;
  } else {
    targetStepId = plan.targetStepId;
  }

  // 3) Toplar hedefe: kaynakta açık kuyruk hareketi geri alınır (o istasyondan geçmedi), hedefte yeni hareket.
  await moveRollsToTargetTx(tx, { workOrderId, station, fromStepIds: plan.fromStepIds, targetStepId, ctx });

  // 4) Durumlar (sıralı; SKIPPED terminaldir, recompute dokunmaz).
  const all = await tx.workOrderStep.findMany({ where: { workOrderId }, select: { id: true }, orderBy: { stepSequence: "asc" } });
  for (const s of all) await recomputeStepStatus(tx, s.id);
  await ensureWorkOrderInProgress(tx, workOrderId, { trigger: "SCAN_ROUTE", refType: "WORK_ORDER_STEP", refId: targetStepId });

  // 5) Olay defteri: rota satırı (ekleme) + atlanan adım başına durum satırı. Cihaz/istasyon gerekçede.
  await writeScanRouteEventsTx(tx, { workOrderId, station, skipStepIds: plan.skipStepIds, before, nameOf, ctx });

  const targetsAdded = plan.kind === "INSERT" ? await addMissingTargetsTx(tx, workOrderId, defaults, ctx.userId) : [];
  return {
    kind: plan.kind, workOrderId, targetStepId, insertedStepId,
    skipped: plan.skipStepIds.map((id) => ({ stepId: id, stationName: nameOf.get(id)!.name })),
    warnings: plan.warnings, targetsAdded,
  };
}

type PriorStep = { id: string; workOrderId: string; stationId: string };

function replayFor(workOrderId: string, stationId: string) {
  return tokenReplay<PriorStep, ScanRouteApplyResult>({
    find: (db, clientToken) => db.workOrderStep.findUnique({ where: { clientToken }, select: { id: true, workOrderId: true, stationId: true } }),
    alive: { neverDies: "sahada eklenen adım satırı ölü duruma geçmez (atlanırsa bile satır yerinde; panel silerse token da gider)" },
    identity: (p) => [
      { ad: "workOrderId", mevcut: p.workOrderId, gelen: workOrderId },
      { ad: "stationId", mevcut: p.stationId, gelen: stationId },
    ],
    collision: "Bu okutma kimliği başka bir işe/istasyona ait; kartı yeniden okutun.",
    respond: (p) => ({ kind: "INSERT", workOrderId: p.workOrderId, targetStepId: p.id, insertedStepId: p.id, skipped: [], warnings: [], targetsAdded: [] }),
  });
}

/**
 * Okutmaya göre rotayı UYGULAR. `closeOpenStepId`: tablet "X'i bitmiş say ve geç" dedi → engelleyen adım
 * MEVCUT kapatma yoluyla (kurşun/KK `finishStep`; QC2 eksikse 400 aynen) kapatılır, sonra karar yeniden verilir.
 */
export async function applyScanRoute(
  cardBarcode: string,
  input: { clientToken: string; closeOpenStepId?: string | null },
  ctx: ApplyCtx,
): Promise<ScanRouteApplyResult> {
  const { workOrderId } = await cardWorkOrder(cardBarcode);
  if (!ctx.stationId) throw AppError.badRequest("Okutmaya göre rota için tablette istasyon oturumu gerekli.", { code: "SCAN_ROUTE_NO_SESSION" });
  if (!(await scanRouteEnabledFor(ctx.stationId))) {
    throw AppError.conflict("Bu istasyonda okutmaya göre rota kapalı.", { code: "SCAN_ROUTE_DISABLED" });
  }
  const stationId = ctx.stationId;
  const st = await prisma.station.findUnique({ where: { id: stationId }, select: { id: true, name: true, type: true } });
  if (!st) throw AppError.badRequest("Oturum istasyonu bulunamadı.", { code: "SCAN_ROUTE_NO_SESSION" });

  const result = await replayFor(workOrderId, stationId).run(input.clientToken, async () => {
    if (input.closeOpenStepId) {
      const { plan } = await decide(workOrderId, stationId);
      if (plan?.kind === "BLOCKED" && plan.code === "SCAN_ROUTE_OPEN_ELSEWHERE" && plan.stepId === input.closeOpenStepId) {
        const step = await prisma.workOrderStep.findUnique({ where: { id: plan.stepId }, select: { station: { select: STEP_FLOW_SELECT } } });
        if (!stepRunsStepFlow(step?.station)) {
          throw AppError.badRequest(`"${plan.stationName}" adımı buradan kapatılamaz; kendi ekranından bitirin.`, { code: "SCAN_ROUTE_CLOSE_UNSUPPORTED" });
        }
        const { KursunQcService } = await import("./kursun-qc.service");
        await new KursunQcService().finishStep({ stepId: plan.stepId }, ctx.userId ?? undefined, ctx.machineId);
      }
    }
    const defaults = (await resolveStationDefaultTargets([stationId], await customerOf(workOrderId)))[0]?.targets ?? [];
    return prisma.$transaction((tx) => applyPlanTx(tx, { workOrderId, station: st, defaults, ctx: { ...ctx, clientToken: input.clientToken } }));
  });

  if (result.kind !== "NOOP") {
    await AuditService.log({
      userId: ctx.userId ?? undefined,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      newData: { scanRoute: result.kind, station: st.name, targetStepId: result.targetStepId, insertedStepId: result.insertedStepId, skipped: result.skipped.map((s) => s.stationName), targetsAdded: result.targetsAdded },
    });
  }
  return result;
}
