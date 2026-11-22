// =============================================================================
// LEVENT GÖVDESİ — okut-say (devere S7): beklenen ↔ okunan, DURUMSUZ (hiçbir şey yazmaz)
// =============================================================================
// Sayım belgesi/tablosu YOK (plan §4): fark, mevcut elle geçişle (`/:id/transition`) satır satır düzeltilir;
// önerilen hareket `suggestCountFix` ile buradan döner. Kod çözümü TEK boğaz `matchBeamBodyNos` (S3 kuralı + ayarı).
// =============================================================================
import { BeamBodyStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { BEAM_BODY_EVENT_LABELS, BEAM_BODY_STATUS_LABELS, type BeamBodyManualKind } from "../../constants/beam-body";
import { matchBeamBodyNos } from "../helpers/beam-body-no.helper";
import { readDevereBodyNoLooseMatch } from "../system-setting/devere-body";

/** Tek istekte en çok okutma (tablet sayımı; depo gövde envanteri yüzler mertebesinde). */
export const BEAM_BODY_COUNT_MAX_CODES = 1000;
/** Depo kapsamında beklenen durumlar (bakımdaki gövde okunursa "başka yerde" + Bakımdan çıkar önerisi). */
const STOCK_STATUSES: readonly BeamBodyStatus[] = [BeamBodyStatus.EMPTY_STOCK, BeamBodyStatus.FULL_STOCK];
/** Devereci kapsamında beklenen durumlar (DB CHECK: subcontractorId ⇒ bu küme). */
const OUT_STATUSES: readonly BeamBodyStatus[] = [BeamBodyStatus.AT_SUBCONTRACTOR, BeamBodyStatus.FULL_OUT];

/** `warehouseId: null` = bizdeki bütün depolar (depo seçilmeden kaydedilen gövdeler dahil). */
export type BeamBodyCountScope = { warehouseId: string | null } | { subcontractorId: string };

const COUNT_SELECT = {
  id: true, bodyNo: true, status: true, isActive: true, warehouseId: true, subcontractorId: true,
  warehouse: { select: { name: true } }, subcontractor: { select: { name: true } }, machine: { select: { code: true } },
} satisfies Prisma.BeamBodySelect;
type CountRow = Prisma.BeamBodyGetPayload<{ select: typeof COUNT_SELECT }>;

export interface BeamBodyCountSuggestion { kind: BeamBodyManualKind; label: string; subcontractorId?: string; warehouseId?: string; reason?: string }
export interface BeamBodyCountLine {
  id: string;
  bodyNo: string;
  status: BeamBodyStatus;
  statusLabel: string;
  /** Kayıttaki yer, günlük dille ("Depo A" · "Deverecide: X" · "Tezgâh T-12"). */
  placeLabel: string;
  /** Okunan ham kod (beklenip okunmayanda yok). */
  code?: string;
  matchedBy?: "NORMALIZED";
  suggestion: BeamBodyCountSuggestion | null;
}
export interface BeamBodyCountPreview {
  scope: { kind: "WAREHOUSE" | "SUBCONTRACTOR"; id: string | null; label: string };
  expectedCount: number;
  matched: BeamBodyCountLine[];
  missing: BeamBodyCountLine[];
  unexpected: BeamBodyCountLine[];
  unknown: Array<{ code: string; candidates: string[] }>;
}

function placeLabel(r: CountRow): string {
  if (r.machine) return `Tezgâh ${r.machine.code}`;
  if (r.subcontractor) return `Deverecide: ${r.subcontractor.name}`;
  if (r.warehouse) return r.warehouse.name;
  return BEAM_BODY_STATUS_LABELS[r.status];
}

const isStockScope = (s: BeamBodyCountScope): s is { warehouseId: string | null } => "warehouseId" in s;

/** Kapsamın beklediği gövde mi (yer + durum + aktif) — beklenen kümenin bellek ikizi (`expectedWhere`). */
export function isExpectedInScope(r: Pick<CountRow, "status" | "isActive" | "warehouseId" | "subcontractorId">, scope: BeamBodyCountScope): boolean {
  if (!r.isActive) return false;
  if (isStockScope(scope)) return STOCK_STATUSES.includes(r.status) && (scope.warehouseId === null || r.warehouseId === scope.warehouseId);
  return OUT_STATUSES.includes(r.status) && r.subcontractorId === scope.subcontractorId;
}

function expectedWhere(scope: BeamBodyCountScope): Prisma.BeamBodyWhereInput {
  if (isStockScope(scope)) return { isActive: true, status: { in: [...STOCK_STATUSES] }, ...(scope.warehouseId ? { warehouseId: scope.warehouseId } : {}) };
  return { isActive: true, status: { in: [...OUT_STATUSES] }, subcontractorId: scope.subcontractorId };
}

const sug = (kind: BeamBodyManualKind, extra: Omit<BeamBodyCountSuggestion, "kind" | "label"> = {}): BeamBodyCountSuggestion => ({ kind, label: BEAM_BODY_EVENT_LABELS[kind], ...extra });

/**
 * Farkı kapatan elle geçiş önerisi (yalnız öneri — yazımı mevcut `/:id/transition` yapar, kararı orada sunucu verir).
 * `seen` = bu kapsamda okundu (başka yerde kayıtlı); değilse beklenip okunmadı. Belirsiz durumda öneri yok.
 */
export function suggestCountFix(r: Pick<CountRow, "status" | "isActive">, scope: BeamBodyCountScope, seen: boolean): BeamBodyCountSuggestion | null {
  if (!r.isActive) return null;
  const wh = isStockScope(scope) && scope.warehouseId ? { warehouseId: scope.warehouseId } : {};
  if (seen && isStockScope(scope)) {
    if (r.status === BeamBodyStatus.AT_SUBCONTRACTOR) return sug("RETURN_EMPTY", wh);
    if (r.status === BeamBodyStatus.FULL_OUT) return sug("RETURN_EMPTY", { ...wh, reason: "Gövde sayımında depoda boş okundu" });
    if (r.status === BeamBodyStatus.MAINTENANCE) return sug("MAINTENANCE_OUT", wh);
    return null;
  }
  if (seen && !isStockScope(scope)) return r.status === BeamBodyStatus.EMPTY_STOCK ? sug("SHIP_EMPTY", { subcontractorId: scope.subcontractorId }) : null;
  // Deverecide beklenip okunmayan boş gövde: bizde olabilir — yalnız AT_SUBCONTRACTOR'da (dolu dışarıdaki sarım taşır).
  if (!seen && !isStockScope(scope) && r.status === BeamBodyStatus.AT_SUBCONTRACTOR) return sug("RETURN_EMPTY");
  return null;
}

async function scopeLabel(scope: BeamBodyCountScope): Promise<BeamBodyCountPreview["scope"]> {
  if (isStockScope(scope)) {
    if (scope.warehouseId === null) return { kind: "WAREHOUSE", id: null, label: "Bütün depolar" };
    const w = await prisma.warehouse.findUnique({ where: { id: scope.warehouseId }, select: { name: true, isActive: true } });
    if (!w?.isActive) throw AppError.badRequest("Depo bulunamadı ya da pasif", { code: "BEAM_BODY_PLACE_INVALID" });
    return { kind: "WAREHOUSE", id: scope.warehouseId, label: w.name };
  }
  const s = await prisma.subcontractor.findUnique({ where: { id: scope.subcontractorId }, select: { name: true, isActive: true } });
  if (!s?.isActive) throw AppError.badRequest("Devereci bulunamadı ya da pasif", { code: "BEAM_BODY_PLACE_INVALID" });
  return { kind: "SUBCONTRACTOR", id: scope.subcontractorId, label: s.name };
}

/** Okunan kodları kapsamın beklenen kümesiyle karşılaştırır. YAZMAZ (ne olay, ne audit, ne sayaç). */
export async function previewBeamBodyCount(scope: BeamBodyCountScope, codes: readonly string[]): Promise<BeamBodyCountPreview> {
  if (codes.length > BEAM_BODY_COUNT_MAX_CODES) throw AppError.badRequest(`Tek sayımda en çok ${BEAM_BODY_COUNT_MAX_CODES} okutma`, { code: "BEAM_BODY_COUNT_TOO_MANY" });
  const head = await scopeLabel(scope);
  const matches = await matchBeamBodyNos(prisma, codes, { loose: await readDevereBodyNoLooseMatch() });
  const unknown: BeamBodyCountPreview["unknown"] = [];
  const seenBy = new Map<string, { code: string; matchedBy: "EXACT" | "NORMALIZED" }>();
  const ambiguousIds = new Set<string>();
  for (const [code, m] of matches) {
    if (m.ids.length === 1) {
      if (!seenBy.has(m.ids[0]!)) seenBy.set(m.ids[0]!, { code, matchedBy: m.matchedBy });
    } else {
      unknown.push({ code, candidates: m.ids });
      m.ids.forEach((id) => ambiguousIds.add(id));
    }
  }
  const expected = await prisma.beamBody.findMany({ where: expectedWhere(scope), select: COUNT_SELECT, orderBy: { bodyNo: "asc" } });
  const seenRows = await prisma.beamBody.findMany({ where: { id: { in: [...new Set([...seenBy.keys(), ...ambiguousIds])] } }, select: COUNT_SELECT, orderBy: { bodyNo: "asc" } });
  const noById = new Map(seenRows.map((r) => [r.id, r.bodyNo]));
  for (const u of unknown) u.candidates = u.candidates.map((id) => noById.get(id) ?? id);
  const line = (r: CountRow, seen: boolean): BeamBodyCountLine => {
    const s = seenBy.get(r.id);
    return {
      id: r.id, bodyNo: r.bodyNo, status: r.status, statusLabel: BEAM_BODY_STATUS_LABELS[r.status], placeLabel: placeLabel(r),
      ...(s ? { code: s.code } : {}), ...(s?.matchedBy === "NORMALIZED" ? { matchedBy: "NORMALIZED" as const } : {}),
      suggestion: seen && isExpectedInScope(r, scope) ? null : suggestCountFix(r, scope, seen),
    };
  };
  const matched: BeamBodyCountLine[] = [];
  const unexpected: BeamBodyCountLine[] = [];
  for (const r of seenRows) {
    if (!seenBy.has(r.id)) continue;
    (isExpectedInScope(r, scope) ? matched : unexpected).push(line(r, true));
  }
  const missing = expected.filter((r) => !seenBy.has(r.id)).map((r) => line(r, false));
  return { scope: head, expectedCount: expected.length, matched, missing, unexpected, unknown };
}

export interface BeamBodyCountContext {
  warehouses: Array<{ id: string; name: string; expectedCount: number }>;
  subcontractors: Array<{ id: string; name: string; expectedCount: number }>;
  /** Depo seçilmeden kaydedilmiş dahil, bizdeki bütün gövdeler (Bütün depolar kapsamı). */
  stockTotal: number;
}

/** Kapsam seçimi: aktif depolar + gövde bulunduran devereciler, beklenen sayılarıyla (aynı yüklem). */
export async function beamBodyCountContext(): Promise<BeamBodyCountContext> {
  const byWh = await prisma.beamBody.groupBy({ by: ["warehouseId"], where: expectedWhere({ warehouseId: null }), _count: { _all: true } });
  const bySub = await prisma.beamBody.groupBy({ by: ["subcontractorId"], where: { isActive: true, status: { in: [...OUT_STATUSES] } }, _count: { _all: true } });
  const warehouses = await prisma.warehouse.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const subIds = bySub.map((g) => g.subcontractorId).filter((id): id is string => id !== null);
  const subs = subIds.length ? await prisma.subcontractor.findMany({ where: { id: { in: subIds }, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const whCount = new Map(byWh.map((g) => [g.warehouseId, g._count._all]));
  const subCount = new Map(bySub.map((g) => [g.subcontractorId, g._count._all]));
  return {
    warehouses: warehouses.map((w) => ({ ...w, expectedCount: whCount.get(w.id) ?? 0 })),
    subcontractors: subs.map((s) => ({ ...s, expectedCount: subCount.get(s.id) ?? 0 })),
    stockTotal: byWh.reduce((n, g) => n + g._count._all, 0),
  };
}
