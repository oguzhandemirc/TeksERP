// =============================================================================
// EMANET EKSTRESİ — tel tipleri + iç olay şekli (genel fason F2, 2026-11-08)
// =============================================================================
// Panel (P1) bu tiplerin aynasını kurar; alan eklemek iki uçta iştir. Sayılar 3 haneye yuvarlı `number`.
// Değişmezler (bekçi `test_emanet_ekstre`): opening + Σ lines.effect = closing · Σ subjects = totals ·
// line.qty kolon toplamına katkıdır (storno satırı NEGATİF katkı, aynı satırda netlenmez).
// =============================================================================
import type { Prisma } from "@prisma/client";

export type StatementKind = "ROLL" | "YARN_LOT" | "WARP_BEAM";
/** Giren · Çıkan (BRÜT) · Fasondan doğrudan sevk · Fire/düzeltme. */
export type StatementColumn = "IN" | "OUT" | "DSK" | "SCRAP";

export interface StatementDocument {
  /** Belge türü: SHIPMENT · RETURN · GOODS_RECEIPT · STOCK_COUNT · DIRECT_SHIPMENT · INVOICE · SUBCONTRACTOR_DISPATCH · WARP_BEAM. */
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
  /** Top / lot / levent kimliği. */
  id: string;
  /** Barkod · lot no · levent no (barkodsuz topta null). */
  label: string | null;
  /** Kalem (top/lot) ya da çözgü kartı (levent) adı. */
  itemName: string | null;
}

export interface StatementLine {
  /** Olay anı (ISO); fabrika günü `day`. */
  at: string;
  day: string;
  subjectId: string;
  subjectLabel: string | null;
  column: StatementColumn;
  /** Kolon toplamına katkı — normal satırda pozitif, storno/dönüş satırında negatif. */
  qty: number;
  /** Kalana etkisi (işaretli): giren +, çıkan/DSK/fire −. */
  effect: number;
  /** Ters kayıt (storno) satırı mı — ileri satır silinmez, bu satır onu bugüne tersler. */
  reversal: boolean;
  /** Defter kodu (stok sebep kodu · sapma türü · iplik/levent olay türü). */
  code: string;
  document: StatementDocument | null;
}

export interface StatementSection {
  kind: StatementKind;
  unit: "m" | "kg";
  /** Kalanın kapsamı — her bölüm kendi modülünün tek-kaynak bakiye tanımını kullanır. */
  scope: string;
  totals: StatementTotals;
  subjects: StatementSubject[];
  lines: StatementLine[];
}

export interface StatementReconciliation {
  /** Canlı içerideki emanet metresi (İçerideki İşler kümesi, `currentQty`). */
  liveQty: number;
  /** Ekstre kalanı − canlı metre; 0 değilse defterde görünmeyen bir metraj değişimi var. */
  diffQty: number;
}

export interface ConsignedStatement {
  customer: { id: string; name: string; code: string | null };
  period: { from: string; to: string; fromAt: string; toAt: string };
  rolls: StatementSection;
  /** İplik modülü kapalı ya da `warehouse:read` yoksa null (`omitted`te sebebiyle). */
  yarnLots: StatementSection | null;
  /** Devere modülü kapalı ya da `warpbeam:read` yoksa null. */
  warpBeams: StatementSection | null;
  omitted: Array<{ kind: StatementKind; reason: "MODULE_DISABLED" | "PERMISSION_DENIED" }>;
  /** Yalnız dönem bugünü kapsıyorsa (geçmiş dönemde canlı durum ekstreyle kıyaslanmaz). */
  reconciliation: { rolls: StatementReconciliation } | null;
}

/** İç olay — defter satırından türetilmiş, kalana etkisi işaretli. */
export interface LedgerEvent {
  /** Eşitlik bozucu (aynı anda iki olay) — defter satır kimliği; storno satırında `:rev` ekli. */
  id: string;
  at: Date;
  subjectId: string;
  subjectLabel: string | null;
  itemName: string | null;
  column: StatementColumn;
  effect: Prisma.Decimal;
  reversal: boolean;
  code: string;
  document: StatementDocument | null;
}
