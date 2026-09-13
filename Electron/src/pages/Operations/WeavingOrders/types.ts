// =============================================================================
// DOKUMA İŞİ — panel tipleri (backend `WeavingOrderDto` aynası)
// =============================================================================
// Dokuma işi bir `WorkOrder` DEĞİLDİR: kendi varlığı, kendi yaşam döngüsü
// (PLANNED → IN_PROGRESS → COMPLETED | CANCELLED). `PLANNED → IN_PROGRESS`in tek
// yazarı koşum-açma ucudur; panelde "başlat" düğmesi YOKTUR — "devam ediyor"
// demek tezgahta koşum var demektir. `plannedM` hedeftir, tetik değil.
// =============================================================================

export type WeavingOrderStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type WeavingExecutionKind = "IN_HOUSE" | "SUBCONTRACTED";

interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface WeavingOrder {
  id: string;
  weavingOrderNumber: string;
  itemId: string;
  colorId: string | null;
  warpSpecId: string | null;
  /** Hedef metre — NULL açık uçlu iş (levent bitene kadar). */
  plannedM: number | null;
  executionKind: WeavingExecutionKind;
  subcontractorId: string | null;
  status: WeavingOrderStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  notes: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  item: Ref;
  color: Ref | null;
  warpSpec: Ref | null;
  subcontractor: Ref | null;
  /** Kapanışı engelleyen açık koşum sayısı (backend `endedAt IS NULL AND revokedAt IS NULL`). */
  openRunCount: number;
}

export interface WeavingStatusMeta {
  label: string;
  /** Düzenlenebilir / kapatılabilir / iptal edilebilir mi (backend `WEAVING_ORDER_OPEN_STATUSES`). */
  open: boolean;
  badgeClass: string;
}

/** Durum sözlüğü — `open` backend'in açık-durum kümesinin aynasıdır. */
export const WEAVING_STATUS_META: Record<WeavingOrderStatus, WeavingStatusMeta> = {
  PLANNED: { label: "Planlandı", open: true, badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  IN_PROGRESS: {
    label: "Devam Ediyor",
    open: true,
    badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
  COMPLETED: { label: "Tamamlandı", open: false, badgeClass: "bg-muted text-muted-foreground" },
  CANCELLED: { label: "İptal", open: false, badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
};

export const WEAVING_STATUSES: WeavingOrderStatus[] = ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

export const WEAVING_KIND_LABEL: Record<WeavingExecutionKind, string> = {
  IN_HOUSE: "Kendi tezgahımızda",
  SUBCONTRACTED: "Fasonda dokunuyor",
};

/** `<input type="date">` değeri → ofsetli ISO; boş → null (backend `datetime({ offset: true })`). */
export function plannedToIso(day: string | undefined | null): string | null {
  const t = (day ?? "").trim();
  if (!t) return null;
  const [y, m, d] = t.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/** ISO → `YYYY-MM-DD` (form ön-doldurma). */
export function isoToDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Ekranda bir GÜN — yerel tarih. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR");
}

const M = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
/** Metre — null "açık uçlu" demektir, 0 değil. */
export function formatPlannedM(v: number | null): string {
  return v === null ? "Açık uçlu" : `${M.format(v)} m`;
}
