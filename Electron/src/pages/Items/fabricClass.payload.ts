// K7/K8 gövde kuralları — sunucu `undefined` = dokunma: boş alan yalnız kayıtta değer VARSA `null` (temizle) gider.
import { ItemType } from "@/types/enums";
import type { ItemFormValues } from "./schema";
import type { Item, ItemCreatePayload } from "./types";
import { pctNumber } from "./fabricClass.schema";

type ClassValues = Pick<ItemFormValues, "itemType" | "composition" | "fabricTypeId" | "flameRetardancy" | "fibers">;
type FiberBody = Array<{ fiberTypeId: string; pct: string }>;

export function fabricClassFormValues(initial: Item): Pick<ItemFormValues, "composition" | "fabricTypeId" | "flameRetardancy" | "fibers"> {
  return {
    composition: initial.composition ?? "",
    fabricTypeId: initial.fabricTypeId ?? "",
    flameRetardancy: initial.flameRetardancy ?? "",
    fibers: (initial.fibers ?? []).map((f) => ({ fiberTypeId: f.fiberTypeId, pct: String(Number(f.pct)).replace(".", ",") })),
  };
}

/** Kumaş sınıflaması gövdesi — yalnız KUMAŞ. */
export function fabricClassPayload(v: ClassValues, initial: Item | null | undefined): Partial<ItemCreatePayload> {
  if (v.itemType !== ItemType.FABRIC) return {};
  const out: Partial<ItemCreatePayload> = {};
  if (v.fabricTypeId) out.fabricTypeId = v.fabricTypeId;
  else if (initial?.fabricTypeId) out.fabricTypeId = null;
  if (v.flameRetardancy) out.flameRetardancy = v.flameRetardancy;
  else if (initial?.flameRetardancy) out.flameRetardancy = null;
  const text = v.composition.trim();
  if (text) out.composition = text;
  else if (initial?.composition) out.composition = null;
  return out;
}

/** Form satırları → gövde (pay noktalı metin). */
export const fiberBody = (v: Pick<ItemFormValues, "fibers">): FiberBody =>
  v.fibers.map((r) => ({ fiberTypeId: r.fiberTypeId, pct: r.pct.trim().replace(",", ".") }));

/** Yeni iplik kartı: lif bileşimi doğuş gövdesinde (aynı tx). Düzenlemede gövdeye GİRMEZ (sunucu 400 verir). */
export function fibersCreatePayload(v: ClassValues, isEdit: boolean): { fibers?: FiberBody } {
  if (isEdit || v.itemType !== ItemType.YARN || v.fibers.length === 0) return {};
  return { fibers: fiberBody(v) };
}

/** Düzenlemede lif bileşimi değişti mi (sıra önemsiz, pay sayısal karşılaştırılır) → PUT /fibers. */
export function fibersChanged(v: ClassValues, initial: Item | null | undefined): boolean {
  if (!initial || v.itemType !== ItemType.YARN) return false;
  const key = (rows: Array<{ fiberTypeId: string; pct: string | number }>) =>
    rows.map((r) => `${r.fiberTypeId}:${pctNumber(String(r.pct))}`).sort().join("|");
  return key(v.fibers) !== key(initial.fibers ?? []);
}
