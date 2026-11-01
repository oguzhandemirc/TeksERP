// Üretim önerisi diyaloğunun saf mantığı (SY-M3): per-kayıt seçim, uygula gövdesi, dışlanan satır cümleleri.
import type { ProductionProposal, ProposalApplyBody } from "./types";

export interface ProposalSelection {
  weaving: ReadonlySet<string>;
  workOrders: ReadonlySet<string>;
  /** Kullanıcının düzenlediği plan metresi (anahtar → metin); yoksa önerilen. */
  plannedM: ReadonlyMap<string, string>;
}

/** Varsayılan: izinli + engelsiz HER kayıt işaretli (önizleme listeler, kullanıcı istemediğini kaldırır). */
export function initialSelection(p: ProductionProposal): ProposalSelection {
  return {
    weaving: new Set(p.canCreate.weaving ? p.weavingOrders.map((w) => w.key) : []),
    workOrders: new Set(p.canCreate.workOrder ? p.workOrders.filter((w) => w.blockedCode == null).map((w) => w.key) : []),
    plannedM: new Map(),
  };
}

export function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Metin → pozitif sayı; boş = null (önerilen yok), geçersiz = NaN (gönderim kapanır). */
export function parsePlannedM(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : Number.NaN;
}

export function plannedMOf(sel: ProposalSelection, key: string, suggested: number | null): number | null {
  const edited = sel.plannedM.get(key);
  return edited === undefined ? suggested : parsePlannedM(edited);
}

/** Uygula gövdesi; geçersiz metre varsa null (düğme kapalı). Satır kimlikleri öneriden — istemci grup kurmaz. */
export function buildApplyBody(p: ProductionProposal, sel: ProposalSelection, clientToken: string): ProposalApplyBody | null {
  const weavingOrders = p.weavingOrders
    .filter((w) => sel.weaving.has(w.key))
    .map((w) => ({ key: w.key, orderLineIds: w.orderLines.map((l) => l.orderLineId), plannedM: plannedMOf(sel, w.key, w.plannedM) }));
  if (weavingOrders.some((w) => w.plannedM != null && Number.isNaN(w.plannedM))) return null;
  const workOrders = p.workOrders
    .filter((w) => sel.workOrders.has(w.key) && w.blockedCode == null)
    .map((w) => ({ key: w.key, orderLineIds: w.orderLines.map((l) => l.orderLineId) }));
  if (weavingOrders.length + workOrders.length === 0) return null;
  return { clientToken, weavingOrders, workOrders };
}

const EXCLUDED_REASON: Record<string, string> = {
  ORDER_LINE_ALREADY_PLANNED: "zaten planlanmış",
  ORDER_LINE_CLOSED: "açık metresi kalmamış",
  ITEM_NOT_WOVEN: "dokunan ürün değil (çözgü/atkı tanımı yok)",
  ROUTE_MISSING: "rota çözülemedi — terbiye iş emrini formdan açın",
};

export function excludedReason(code: string): string {
  return EXCLUDED_REASON[code] ?? code;
}

const KIND_LABEL: Record<"WEAVING" | "WORK_ORDER" | "LINE", string> = { WEAVING: "Dokuma", WORK_ORDER: "Terbiye", LINE: "Satır" };
export const excludedKindLabel = (k: "WEAVING" | "WORK_ORDER" | "LINE"): string => KIND_LABEL[k];

/** 409 ayrıntısındaki satır kimlikleri (`ORDER_LINE_ALREADY_PLANNED`); yoksa boş. */
export function conflictLineIds(e: unknown): string[] {
  const d = (e as { response?: { data?: { details?: { code?: string; orderLineIds?: unknown } } } } | undefined)?.response?.data?.details;
  return d?.code === "ORDER_LINE_ALREADY_PLANNED" && Array.isArray(d.orderLineIds) ? d.orderLineIds.filter((x): x is string => typeof x === "string") : [];
}

export function isConflict(e: unknown): boolean {
  return (e as { response?: { status?: number } } | undefined)?.response?.status === 409;
}
