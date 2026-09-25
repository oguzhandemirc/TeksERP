// =============================================================================
// İş emri hareket defteri GEÇMİŞ DOLDURMA — SAF türetme (DB'siz; tasarım §8.1, S5 = A)
// =============================================================================
// Girdi: iş emrinin kalıcı kolonları + adımların başlama/bitiş anları + o iş emrinin audit
// satırları (sıcak ∪ arşiv, zaman sırasıyla) + defterde zaten olanlar. Çıktı: yazılacak
// olaylar (geçmiş anlarıyla), yaklaşık künye ve dürüstlük kaydı (türetilemeyenler).
//   • Kolonlardan: CREATED (createdAt/createdById), iptal (cancelledAt/ById/Reason).
//   • Audit'ten BİR KEZ: renk · en · tip (bağ) · değiştir-yaz · düzenle · arşiv · kilit · elle kapanış.
//   • Yaklaşık: tamamlanma = son adım bitişi (elle kapanış yoksa); künye o anla (S5 = A).
//   • Türetilemeyen: otomatik başlama, yeniden açılma, aradaki tamamlanmalar.
// Defterde CREATED satırı olan iş emri atlanır (idempotent); canlı defterin ilk satırından
// SONRAKİ türetmeler yazılmaz (canlı kayıt çiftlenmez).
// =============================================================================

import { diffTrackedFields, type WorkOrderFieldValues } from "../../src/services/helpers/workorder-field-diff.helper";

type Json = Record<string, unknown>;

export interface BackfillWo {
  id: string;
  workOrderNumber: string;
  status: string;
  type: string;
  createdAt: Date;
  createdById: string | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancelReason: string | null;
  routeTemplateId: string | null;
  targetItemId: string | null;
  targetColorId: string | null;
  steps: { startedAt: Date | null; completedAt: Date | null }[];
}

export interface BackfillAudit {
  action: string;
  oldData: unknown;
  newData: unknown;
  changes: unknown;
  userId: string | null;
  deviceId: string | null;
  createdAt: Date;
}

export interface BackfillExisting {
  hasCreated: boolean;
  firstEventAt: Date | null;
  hasCompletedEvent: boolean;
  snapshotCount: number;
}

export interface DerivedEvent {
  kind: "CREATED" | "STATUS_CHANGED" | "FIELD_CHANGED";
  field?: string;
  from?: string | null;
  to?: string | null;
  trigger: string;
  reason?: string | null;
  userId: string | null;
  deviceId: string | null;
  at: Date;
  /** Aynı kaynaktan (tek audit satırı) doğan satırlar tek grup. */
  group: string;
  payload?: Json;
}

export interface Derived {
  events: DerivedEvent[];
  snapshot: { closedAt: Date; startedAt: Date } | null;
  losses: string[];
}

const LINK_TRIGGER: Record<string, string> = {
  ORDER_LINK_ADDED: "ORDER_LINK",
  ORDER_LINK_REMOVED: "ORDER_UNLINK",
  TYPE_DERIVED_FROM_LINKS: "TYPE_DERIVED_FROM_LINKS",
};
const REPLACE_FIELDS = ["type", "targetColorId", "targetItemId", "routeTemplateId"] as const;
const SEED_FIELDS = [...REPLACE_FIELDS, "width"] as const;
const OTHER_TYPE: Record<string, string> = { ORDER_PRODUCTION: "STOCK_PRODUCTION", STOCK_PRODUCTION: "ORDER_PRODUCTION" };

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
function changesOf(v: unknown): { field: string; old: unknown; new: unknown }[] {
  return Array.isArray(v) ? (v as { field: string; old: unknown; new: unknown }[]).filter((c) => c && typeof c.field === "string") : [];
}
function pick(src: Json, keys: readonly string[]): WorkOrderFieldValues {
  const out: Json = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out as WorkOrderFieldValues;
}

/** Tek iş emrinin türetme durumu — handler'lar olay biriktirir, alan durumunu ilerletir. */
class Ctx {
  events: DerivedEvent[] = [];
  state: Json = {};
  losses: string[] = [];
  manualCloseAt: Date | null = null;
  cancelAudit: BackfillAudit | null = null;
  supersede: BackfillAudit | null = null;
  private seq = 0;

  fields(a: BackfillAudit, trigger: string, before: WorkOrderFieldValues, after: WorkOrderFieldValues, reason?: unknown): void {
    const group = `a${this.seq++}`;
    for (const c of diffTrackedFields(before, after)) {
      this.events.push({ kind: "FIELD_CHANGED", field: c.field, from: c.from, to: c.to, trigger, reason: str(reason), userId: a.userId, deviceId: a.deviceId, at: a.createdAt, group });
    }
    Object.assign(this.state, after);
  }

  status(a: { userId: string | null; deviceId: string | null; createdAt: Date }, from: string, to: string, trigger: string, reason?: unknown): void {
    this.events.push({ kind: "STATUS_CHANGED", field: "status", from, to, trigger, reason: str(reason), userId: a.userId, deviceId: a.deviceId, at: a.createdAt, group: `s${this.seq++}` });
  }
}

function handleEvent(ctx: Ctx, a: BackfillAudit, ev: string, od: Json, nd: Json): void {
  if (ev === "TARGET_COLOR_CHANGED") {
    ctx.fields(a, "COLOR_CHANGE", { targetColorId: od.targetColorId ?? ctx.state.targetColorId }, { targetColorId: nd.targetColorId ?? null }, nd.reason);
  } else if (ev === "TARGET_WIDTH_CHANGED") {
    const trigger = nd.source === "FASON_RECEIPT" ? "FASON_RECEIPT_WIDTH" : "WIDTH_CHANGE";
    ctx.fields(a, trigger, { width: od.width ?? ctx.state.width }, { width: nd.width ?? null }, nd.reason);
  } else if (LINK_TRIGGER[ev]) {
    const ch = changesOf(a.changes).find((c) => c.field === "type");
    if (ch) ctx.fields(a, LINK_TRIGGER[ev], { type: ch.old }, { type: ch.new });
    else if (nd.typeChanged && typeof nd.type === "string") ctx.fields(a, LINK_TRIGGER[ev], { type: od.type ?? OTHER_TYPE[nd.type] }, { type: nd.type });
  } else if (ev === "ARCHIVED") {
    ctx.fields(a, "WO_ARCHIVE", { isActive: true }, { isActive: false });
  } else if (ev === "SPLIT_SOURCE" && nd.sourceWorkOrderCancelled) {
    ctx.supersede = a;
  }
}

function handlePlain(ctx: Ctx, a: BackfillAudit, od: Json, nd: Json): void {
  const ch = changesOf(a.changes);
  if (nd.replace) {
    const keys = REPLACE_FIELDS.filter((k) => nd[k] !== undefined);
    const before = ch.length ? Object.fromEntries(ch.map((c) => [c.field, c.old])) : pick(ctx.state, keys.filter((k) => ctx.state[k] !== undefined));
    const after = ch.length ? Object.fromEntries(ch.map((c) => [c.field, c.new])) : pick(nd, keys.filter((k) => ctx.state[k] !== undefined));
    ctx.fields(a, "WO_REPLACE", before as WorkOrderFieldValues, after as WorkOrderFieldValues);
    Object.assign(ctx.state, pick(nd, keys));
  } else if (nd.manualComplete) {
    ctx.manualCloseAt = a.createdAt;
    ctx.status(a, "IN_PROGRESS", "COMPLETED", "MANUAL_COMPLETE", nd.reason);
  } else if (nd.status === "CANCELLED") {
    ctx.cancelAudit = a;
  } else if (od.status === "PLANNED" && nd.status === "IN_PROGRESS") {
    ctx.status(a, "PLANNED", "IN_PROGRESS", "WO_LOCK");
  } else if (a.action === "UPDATE" && ch.length > 0) {
    ctx.fields(a, "WO_UPDATE", Object.fromEntries(ch.map((c) => [c.field, c.old])) as WorkOrderFieldValues, Object.fromEntries(ch.map((c) => [c.field, c.new])) as WorkOrderFieldValues);
  } else if (a.action === "UPDATE" && Object.keys(od).length > 0 && !nd.fasonTransfer) {
    ctx.fields(a, "WO_UPDATE", od as WorkOrderFieldValues, nd as WorkOrderFieldValues);
  }
}

function maxDate(ds: (Date | null)[]): Date | null {
  const t = ds.filter((d): d is Date => d !== null).map((d) => d.getTime());
  return t.length ? new Date(Math.max(...t)) : null;
}
function minDate(ds: (Date | null)[]): Date | null {
  const t = ds.filter((d): d is Date => d !== null).map((d) => d.getTime());
  return t.length ? new Date(Math.min(...t)) : null;
}

function closeTerminal(ctx: Ctx, wo: BackfillWo, ex: BackfillExisting): Date | null {
  if (wo.status === "CANCELLED") {
    const ca = ctx.cancelAudit;
    const at = wo.cancelledAt ?? ca?.createdAt ?? null;
    if (!at) ctx.losses.push("iptal anı yok");
    else {
      const from = str(obj(ca?.oldData).status) ?? (wo.steps.some((s) => s.startedAt) ? "IN_PROGRESS" : "PLANNED");
      const nd = obj(ca?.newData);
      ctx.status({ userId: wo.cancelledById ?? ca?.userId ?? null, deviceId: ca?.deviceId ?? null, createdAt: at }, from, "CANCELLED", nd.via ? "OPS_SQL" : "WO_CANCEL", wo.cancelReason ?? nd.reason ?? nd.via);
    }
  }
  if (wo.status === "SUPERSEDED") {
    if (!ctx.supersede) ctx.losses.push("devir anı yok");
    else ctx.status(ctx.supersede, "IN_PROGRESS", "SUPERSEDED", "WO_SPLIT_SUPERSEDE");
  }
  if (wo.status !== "COMPLETED") return null;
  if (ctx.manualCloseAt) return ctx.manualCloseAt;
  const last = maxDate(wo.steps.map((s) => s.completedAt));
  if (!last) {
    ctx.losses.push("tamamlanma anı yok (adım bitişi yok)");
    return null;
  }
  if (!ex.hasCompletedEvent) ctx.status({ userId: null, deviceId: null, createdAt: last }, "IN_PROGRESS", "COMPLETED", "APPROX_LAST_STEP");
  return last;
}

/** Tek iş emri — `audits` ZAMAN SIRALI (eski → yeni). */
export function deriveWorkOrder(wo: BackfillWo, audits: BackfillAudit[], ex: BackfillExisting): Derived {
  if (ex.hasCreated) return { events: [], snapshot: null, losses: [] };
  const ctx = new Ctx();
  const create = audits.find((a) => a.action === "CREATE");
  const split = audits.some((a) => obj(a.newData).event === "SPLIT_TARGET");
  const cnd = obj(create?.newData);
  ctx.events.push({
    kind: "CREATED", to: "PLANNED", trigger: split ? "WO_SPLIT_CLONE" : "WO_CREATE",
    userId: wo.createdById ?? create?.userId ?? null, deviceId: create?.deviceId ?? null, at: wo.createdAt, group: "c",
    payload: {
      type: str(cnd.type) ?? wo.type, routeTemplateId: str(cnd.routeTemplateId) ?? wo.routeTemplateId,
      targetItemId: str(cnd.targetItemId) ?? wo.targetItemId, targetColorId: str(cnd.targetColorId) ?? wo.targetColorId, backfill: true,
    },
  });
  if (create) Object.assign(ctx.state, pick(cnd, SEED_FIELDS));
  else ctx.losses.push("açılış audit'i yok (değiştir-yaz farkı çıkarılamaz)");
  for (const a of audits) {
    if (a.action === "CREATE") continue;
    const nd = obj(a.newData);
    const ev = str(nd.event);
    if (ev) handleEvent(ctx, a, ev, obj(a.oldData), nd);
    else handlePlain(ctx, a, obj(a.oldData), nd);
  }
  const closedAt = closeTerminal(ctx, wo, ex);
  const epoch = ex.firstEventAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const events = ctx.events.filter((e) => e.at.getTime() < epoch).sort((x, y) => x.at.getTime() - y.at.getTime());
  const snapshot = wo.status === "COMPLETED" && ex.snapshotCount === 0 && closedAt && closedAt.getTime() < epoch
    ? { closedAt, startedAt: minDate(wo.steps.map((s) => s.startedAt)) ?? wo.createdAt }
    : null;
  return { events, snapshot, losses: ctx.losses };
}
