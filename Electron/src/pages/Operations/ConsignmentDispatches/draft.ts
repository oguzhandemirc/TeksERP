// Emanet çıkış taslağı (saf): kalem ekleme/çıkarma, tel gövdesi, önizleme satırı eşleşmesi. React'siz → test aynı kodu koşar.
import type {
  ConsignmentDispatchCreateInput,
  ConsignmentDispatchItemInput,
  ConsignmentDispatchPreview,
  ConsignmentDispatchPreviewLine,
} from "./types";

export interface DraftItem {
  /** Taslak içi kimlik: levent `beam:<id>`, iplik `yarn:<lotId>:<warehouseId>` — aynı lot × depo iki satır olmaz. */
  key: string;
  input: ConsignmentDispatchItemInput;
  label: string;
  sub: string;
}

export function draftKey(input: ConsignmentDispatchItemInput): string {
  return input.kind === "WARP_BEAM" ? `beam:${input.warpBeamId}` : `yarn:${input.lotId}:${input.warehouseId}`;
}

/** Aynı anahtar yeniden eklenirse YERİNE geçer (iplikte kg düzeltmesi); sıra korunur. */
export function upsertItem(items: DraftItem[], next: DraftItem): DraftItem[] {
  const i = items.findIndex((x) => x.key === next.key);
  if (i < 0) return [...items, next];
  return items.map((x, j) => (j === i ? next : x));
}

export interface DraftMeta {
  plateNumber: string;
  driverName: string;
  notes: string;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function buildBody(
  ownerCustomerId: string,
  items: DraftItem[],
  meta: DraftMeta,
): Omit<ConsignmentDispatchCreateInput, "clientToken"> {
  return {
    ownerCustomerId,
    items: items.map((x) => x.input),
    plateNumber: orNull(meta.plateNumber),
    driverName: orNull(meta.driverName),
    notes: orNull(meta.notes),
  };
}

/** Önizleme satırı → taslak kalemi. Levent `refId` = leventId; iplik `refId` = lotId (aynı lot iki depodan gelirse sıra eşler). */
export function previewLineFor(
  preview: ConsignmentDispatchPreview | undefined,
  items: DraftItem[],
  key: string,
): ConsignmentDispatchPreviewLine | null {
  if (!preview) return null;
  const idx = items.findIndex((x) => x.key === key);
  const byIndex = preview.lines[idx];
  const item = items[idx];
  if (!item || !byIndex) return null;
  const ref = item.input.kind === "WARP_BEAM" ? item.input.warpBeamId : item.input.lotId;
  return byIndex.refId === ref
    ? byIndex
    : (preview.lines.find((l) => l.refId === ref && l.kind === item.input.kind) ?? null);
}
