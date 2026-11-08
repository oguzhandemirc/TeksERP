// EMANET EKSTRESİ — `GET /api/consigned-work/:customerId/statement` tel tiplerinin aynası (backend
// `Teks-Erp/src/services/consigned-statement/types.ts`; alan eklemek iki uçta iştir). Sayılar 3 haneye yuvarlı.
// Değişmezler sunucuda ölçülür: opening + Σ lines.effect = closing · Σ subjects = totals.

export type StatementKind = "ROLL" | "YARN_LOT" | "WARP_BEAM";
/** Kolon anlamı bölüme göre değişir — etiket daima `StatementSection.columnLabels`ten okunur. */
export type StatementColumn = "IN" | "OUT" | "DSK" | "SCRAP";

export interface StatementDocument {
  type: string;
  id: string;
  no: string | null;
}

export interface StatementTotals {
  opening: number;
  in: number;
  out: number;
  dsk: number;
  scrap: number;
  closing: number;
}

export interface StatementSubject extends StatementTotals {
  id: string;
  label: string | null;
  itemName: string | null;
}

export interface StatementLine {
  at: string;
  /** Fabrika günü (YYYY-MM-DD). */
  day: string;
  subjectId: string;
  subjectLabel: string | null;
  column: StatementColumn;
  /** Kolon toplamına katkı — storno satırında negatif. */
  qty: number;
  /** Kalana etkisi (işaretli). */
  effect: number;
  reversal: boolean;
  code: string;
  document: StatementDocument | null;
}

export interface StatementSection {
  kind: StatementKind;
  unit: "m" | "kg";
  scope: string;
  columnLabels: Record<StatementColumn, string>;
  totals: StatementTotals;
  subjects: StatementSubject[];
  lines: StatementLine[];
}

export interface StatementReconciliation {
  liveQty: number;
  diffQty: number;
}

export interface ConsignedStatement {
  customer: { id: string; name: string; code: string | null };
  period: { from: string; to: string; fromAt: string; toAt: string };
  rolls: StatementSection;
  yarnLots: StatementSection | null;
  warpBeams: StatementSection | null;
  omitted: Array<{ kind: StatementKind; reason: "MODULE_DISABLED" | "PERMISSION_DENIED" }>;
  reconciliation: { rolls: StatementReconciliation } | null;
}
