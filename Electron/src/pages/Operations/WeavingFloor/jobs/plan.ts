// Salon iş eylemlerinin SAF kısmı: seçimden hedef satırları, önizlemeden ilk işaretler ve gönderilecek satırlar.
import type { LiveLoom } from "../types";
import type { AssignTarget, BulkPreviewRow, BulkTarget, AssignRow } from "./runService";

export type JobDialogMode = "assign" | "replace";

export const rowKey = (r: BulkTarget): string => `${r.machineId}:${r.productionLineNo}`;

/** Seçimde birden çok hatlı tezgah varsa en büyük hat sayısı (hat sorusu yalnız o zaman sorulur); yoksa 1. */
export function maxLinesOf(looms: readonly LiveLoom[]): number {
  return looms.reduce((m, l) => Math.max(m, l.lines ?? 1), 1);
}

/** İş ver hedefleri: tek hatlı tezgah hep 1. hat; çok hatlıda seçilen hat (tezgahın hat sayısını aşarsa son hattı). */
export function assignTargetsOf(looms: readonly LiveLoom[], line: number): BulkTarget[] {
  return looms.map((l) => ({ machineId: l.id, productionLineNo: Math.min(Math.max(1, line), l.lines ?? 1) }));
}

/** İşsiz (numune) koşum seçimi — yalnız "iş zorunlu" ayarı kapalıyken çizilir. */
export const NO_JOB = "__numune__";
export const jobIdOf = (v: string | null): string | null => (v === NO_JOB ? null : v);

/** Tezgah başına iş (C.6): o tezgaha ayrı iş seçilmediyse "hepsine aynı iş". */
export function effectiveJobOf(loomId: string, shared: string | null, overrides: ReadonlyMap<string, string>): string | null {
  return overrides.get(loomId) ?? shared;
}

/** En az bir tezgahın işi ortak işten farklı mı — yalnız o zaman gövdede satır işi gider. */
export function isMixed(looms: readonly LiveLoom[], shared: string | null, overrides: ReadonlyMap<string, string>): boolean {
  return looms.some((l) => effectiveJobOf(l.id, shared, overrides) !== shared);
}

/** Önizleme ancak her tezgahın işi seçiliyken. */
export function allJobsChosen(looms: readonly LiveLoom[], shared: string | null, overrides: ReadonlyMap<string, string>): boolean {
  return looms.every((l) => effectiveJobOf(l.id, shared, overrides) !== null);
}

/** Karışık seçimde her hedefe kendi işi eklenir (null = işsiz); tek işte gövde bugünkü gibi — 2.15.6 sunucusu satır alanını tanımaz. */
export function withRowJobs(targets: readonly BulkTarget[], jobOf: ((machineId: string) => string | null) | null): AssignTarget[] {
  return jobOf ? targets.map((t) => ({ ...t, weavingOrderId: jobIdOf(jobOf(t.machineId)) })) : [...targets];
}

/** Bitir hedefleri: seçili tezgahların açık koşumu olan HER hattı. */
export function finishTargetsOf(looms: readonly LiveLoom[]): BulkTarget[] {
  return looms.flatMap((l) => (l.openRuns ?? []).map((r) => ({ machineId: l.id, productionLineNo: r.line })));
}

/** İlk işaretler: sunucunun varsayılanı; "İşi değiştir" ile açıldıysa Değiştir satırları da (niyet zaten değiştirmek). */
export function initialSelection(rows: readonly BulkPreviewRow[], mode: JobDialogMode): Set<string> {
  return new Set(rows.filter((r) => r.defaultSelected || (mode === "replace" && r.outcome === "REPLACE")).map(rowKey));
}

/** Satır seçilebilir mi — engelli satır işaretlenemez. */
export const selectable = (r: BulkPreviewRow): boolean => r.outcome !== "BLOCKED";

/** Satır token anahtarı: tezgah + hat + iş — iş değişirse yeni mantıksal deneme (aynı token başka yükle 409 olurdu). */
export const tokenKeyOf = (r: BulkPreviewRow): string => `${rowKey(r)}|${r.weavingOrder?.id ?? "-"}`;

/** Gönderilecek satırlar: işaretli + seçilebilir; dolu hatta eski koşum `replaceRunId` olarak gider (açık rıza); karışık seçimde satırın işi önizlemeden. */
export function assignRowsOf(rows: readonly BulkPreviewRow[], picked: ReadonlySet<string>, tokenOf: (key: string) => string, perRow = false): AssignRow[] {
  return rows
    .filter((r) => selectable(r) && picked.has(rowKey(r)))
    .map((r) => ({
      machineId: r.machineId,
      productionLineNo: r.productionLineNo,
      clientToken: tokenOf(tokenKeyOf(r)),
      replaceRunId: r.current ? r.current.id : null,
      ...(perRow ? { weavingOrderId: r.weavingOrder?.id ?? null } : {}),
    }));
}

export const OUTCOME_TEXT: Record<BulkPreviewRow["outcome"], string> = {
  START: "Başlar",
  REPLACE: "Eski iş biter, yeni iş başlar",
  SAME_JOB: "Zaten bu işte (yeniden başlatır)",
  FINISH: "İş biter",
  BLOCKED: "Olmaz",
};
