import { TERIM } from "@/lib/terim";
import { formatQty } from "@/lib/format";
import { isMeasuredUnit } from "@/lib/item-unit";
import { parseCountedQty } from "@/pages/Operations/StockCounts/stockCountRules";
import type { OrderAllocationSummary, OrderLinkAllocationInput, WorkOrder } from "./types";

/**
 * İş emri metresini sipariş bağlarına PAYLAŞTIRMA — panelin saf kuralları.
 * Paylaştırma yalnız plandır; tavan ve özet SUNUCUDA (`wo.allocation`). İstemci yalnız
 * diyalogda yazarken önizleme hesaplar.
 */

export const ALLOCATION_OVER_BASIS = "ALLOCATION_OVER_BASIS";

/** İptal/devredilmiş iş emrinde paylaştırma değişmez (backend 409 `WO_PLAN_FROZEN`). */
const FROZEN_STATUSES = new Set(["CANCELLED", "SUPERSEDED"]);

/** Sunucu miktarı (Decimal METİN gelir: "800.000") → sayı; bozuk/boş → 0. Kullanıcı metni için değil. */
export function qtyFromServer(v: number | string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Sunucu miktarı → giriş kutusu metni (virgül ondalık, ayırıcısız; 0 → boş). */
export function qtyToInputText(v: number | string | null | undefined): string {
  const n = qtyFromServer(v);
  return n > 0 ? formatQty(n, 3) : "";
}

/** Kullanıcı metni → metre. Boş = 0; binlik ayracı gibi duran girdi tahmin edilmez → null. */
export function parseAllocationInput(text: string): number | null {
  if (text.trim() === "") return 0;
  const p = parseCountedQty(text);
  return p ? p.value : null;
}

/** Metre metni (ayırıcısız, 1 ondalığa kadar). */
export const fmtM = (n: number): string => formatQty(n, 1);

/** Tavan türünün kısa etiketi: INPUT "Giren" · TARGET "Hedef" · NONE null. */
export function basisLabel(kind: OrderAllocationSummary["basisKind"] | undefined): string | null {
  if (kind === "INPUT") return "Giren";
  if (kind === "TARGET") return "Hedef";
  return null;
}

export interface AllocationPreview {
  basisLabel: string | null;
  basis: number | null;
  allocated: number;
  remaining: number | null;
  over: boolean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Yazarken önizleme: tavan sunucudan (`summary`), toplam formdaki değerlerden. */
export function previewAllocation(
  summary: OrderAllocationSummary | null | undefined,
  entered: readonly number[],
): AllocationPreview {
  const allocated = round3(entered.reduce((s, n) => s + n, 0));
  const basis = summary && summary.basisKind !== "NONE" ? summary.basis : null;
  const remaining = basis == null ? null : round3(basis - allocated);
  return {
    basisLabel: basis == null ? null : basisLabel(summary?.basisKind),
    basis,
    allocated,
    remaining,
    over: remaining != null && remaining < 0,
  };
}

/** Metre paylaştırılabilir satır mı (MT; KG/ADET'e metre yazılamaz — backend 400). */
export const isAllocatableUnit = (unit: string | null | undefined): boolean => isMeasuredUnit(unit);

type Links = NonNullable<WorkOrder["orderLinks"]>;

/** Formdaki metre birimli bağlar → gövde (boş = 0 = paylaştırma yok). Geçersiz biçim → null. */
export function buildAllocations(links: Links, qty: Readonly<Record<string, string>>): OrderLinkAllocationInput[] | null {
  const out: OrderLinkAllocationInput[] = [];
  for (const l of links) {
    if (!isAllocatableUnit(l.orderLine?.unit)) continue;
    const v = parseAllocationInput(qty[l.orderLineId] ?? "");
    if (v === null) return null;
    out.push({ orderLineId: l.orderLineId, allocatedQty: v });
  }
  return out;
}

/** "Paylaştır" düğmesi: açık bağ var · iptal/devredilmiş değil · `workorder:write`. */
export function canShowAllocate(
  wo: Pick<WorkOrder, "status" | "orderLinks"> | null | undefined,
  hasPermission: (perm: string) => boolean,
): boolean {
  if (!wo) return false;
  if ((wo.orderLinks?.length ?? 0) === 0) return false;
  if (FROZEN_STATUSES.has(wo.status)) return false;
  return hasPermission("workorder:write");
}

interface ApiErrorShape {
  response?: {
    status?: number;
    data?: {
      message?: string;
      details?: { code?: string; basis?: number; basisKind?: OrderAllocationSummary["basisKind"]; allocated?: number };
    };
  };
}

/**
 * Paylaştırma hatası → diyalog cümlesi. Kod `details.code`tan (`body.code` YOK).
 * `requestSum` = bu istekteki metreler; "kalan" = tavan − (sunucu toplamı − bu istek).
 */
export function allocationErrorText(err: unknown, requestSum: number): string {
  const e = err as ApiErrorShape | null;
  const status = e?.response?.status;
  const body = e?.response?.data;
  const d = body?.details;
  if (d?.code === ALLOCATION_OVER_BASIS && typeof d.basis === "number" && typeof d.allocated === "number") {
    const room = Math.max(0, round3(d.basis - d.allocated + requestSum));
    const what = d.basisKind === "TARGET" ? `${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} hedef metresini` : `${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} giren metreyi`;
    return `Paylaştırılan toplam, ${what} aşıyor (kalan ${fmtM(room)} m).`;
  }
  const msg = body?.message?.trim() || (status ? "" : "Sunucuya ulaşılamıyor.") || "Kaydedilemedi.";
  if (status === 409 && !/yenile|tekrar dene/i.test(msg)) return `${msg} Ekranı yenileyip tekrar deneyin.`;
  return msg;
}
