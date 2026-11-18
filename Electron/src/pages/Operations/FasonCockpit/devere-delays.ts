// Fason kokpiti — devere gecikmeleri bandı (D8b): backend `services/warping-order/delays.ts` aynası + servis + saf etiketler.
// Panel tarih/gecikme HESAPLAMAZ: durum ve gün sunucudan; süzme sunucuda (`filter[state]`, `filter[subcontractorId]`).
import apiClient from "@/services/apiClient";
import { formatQty } from "@/lib/format";

export const DEVERE_DELAY_STATES = ["OVERDUE", "DUE_SOON", "NO_DUE_DATE", "ALL"] as const;
export type DevereDelayState = (typeof DEVERE_DELAY_STATES)[number];
export const DEVERE_DELAY_QUERY_KEY = "fason-cockpit-devere-delays";

export interface DevereDelayRow {
  warpingOrderId: string;
  orderNo: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  subcontractor: { id: string; name: string };
  warpSpec: { id: string; code: string; name: string };
  expectedReturnAt: string | null;
  dueSource: "ORDER" | "DISPATCH" | null;
  overdueDays: number | null;
  state: "OVERDUE" | "DUE_SOON" | "NO_DUE_DATE" | "LATER";
  firstDispatchedAt: string | null;
  targetLengthM: string;
  receivedLengthM: string;
  remainingLengthM: string;
}

export interface DevereDelayResult {
  data: DevereDelayRow[];
  summary: { openCount: number; overdueCount: number; dueSoonCount: number; noDueDateCount: number };
}

/** Süzgeç → sorgu (saf; `ALL` ve boş firma gönderilmez). */
export function devereDelayParams(state: DevereDelayState, subcontractorId: string | null): Record<string, string> {
  const p: Record<string, string> = {};
  if (state !== "ALL") p["filter[state]"] = state;
  if (subcontractorId) p["filter[subcontractorId]"] = subcontractorId;
  return p;
}

export async function listDevereDelays(state: DevereDelayState, subcontractorId: string | null): Promise<DevereDelayResult> {
  const res = await apiClient.get<{ success: boolean; data: DevereDelayResult }>("/api/warping-orders/delays", { params: devereDelayParams(state, subcontractorId) });
  return res.data.data;
}

/** Çip etiketi + sayaç (sayaçlar durum süzgecinden bağımsız gelir). */
export function devereChipLabel(state: DevereDelayState, s: DevereDelayResult["summary"] | null): string {
  const n = (v: number) => (s ? ` (${v})` : "");
  switch (state) {
    case "OVERDUE": return `Geciken${n(s?.overdueCount ?? 0)}`;
    case "DUE_SOON": return `2 gün içinde${n(s?.dueSoonCount ?? 0)}`;
    case "NO_DUE_DATE": return `Terminsiz${n(s?.noDueDateCount ?? 0)}`;
    case "ALL": return `Tüm açık${n(s?.openCount ?? 0)}`;
  }
}

/** Satırın termin metni: gecikme günü sunucudan; sevk termininden geldiyse söylenir. */
export function devereDueText(r: Pick<DevereDelayRow, "overdueDays" | "dueSource">): string {
  const d = r.overdueDays;
  const src = r.dueSource === "DISPATCH" ? " (sevk termini)" : "";
  if (d === null) return "Termin yok";
  if (d > 0) return `${d} gün gecikti${src}`;
  if (d === 0) return `Bugün dönmeli${src}`;
  return `${-d} gün var${src}`;
}

/** Hedef/gelen metre — kg/metre ayırıcısız (`formatQty`). */
export function devereProgressText(r: Pick<DevereDelayRow, "targetLengthM" | "receivedLengthM" | "remainingLengthM">): string {
  return `gelen ${formatQty(r.receivedLengthM, 0)} / ${formatQty(r.targetLengthM, 0)} m · kalan ${formatQty(r.remainingLengthM, 0)} m`;
}

/** Bant boşken (seçili durumda satır yok) gösterilecek cümle. */
export function devereEmptyText(state: DevereDelayState): string {
  switch (state) {
    case "OVERDUE": return "Termini geçmiş açık devere siparişi yok.";
    case "DUE_SOON": return "Önümüzdeki 2 gün içinde dönmesi gereken devere siparişi yok.";
    case "NO_DUE_DATE": return "Terminsiz açık devere siparişi yok.";
    case "ALL": return "Açık devere siparişi yok.";
  }
}
