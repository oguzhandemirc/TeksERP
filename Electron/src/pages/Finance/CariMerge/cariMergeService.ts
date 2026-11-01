// =============================================================================
// CARİ BİRLEŞTİRME — panel istemcisi (D4-K3e; backend `finance-cari-merge.routes.ts`)
// =============================================================================
// Engel metinleri ve etiketler SUNUCUDAN gelir. Uygula gövdesi `.strict()` — ön izlemenin damgasıyla gider;
// arada kayıt değiştiyse sunucu 409 `CARI_MERGE_STALE` verir ve ön izleme yenilenir.
// =============================================================================
import apiClient from "@/services/apiClient";
import { upperTr } from "@/lib/tr-case";

export interface CariMergeCandidate {
  id: string;
  kind: "CUSTOMER" | "SUBCONTRACTOR";
  label: string;
  isActive: boolean;
  sourceId: string;
  targetId: string;
  balances: Array<{ currency: string; balance: string }>;
}

export interface CariMergeItem {
  currency: string;
  invoiceId: string | null;
  docNo: string;
  signedAmount: string;
  dueDate: string | null;
}

export interface CariMergePreview {
  sourceId: string;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
  alreadyMerged: boolean;
  blockers: string[];
  balances: Array<{ currency: string; source: string; target: string }>;
  items: CariMergeItem[];
  termsToCopy: Record<string, unknown>;
  draftInvoices: number;
  stamp: string;
}

export interface CariMergeResult {
  alreadyMerged: boolean;
  transferGroupId: string | null;
  legs: number;
  movedDrafts: number;
}

/** Hedefe taşınan terimlerin okunur adı (bilinmeyen alan adıyla gösterilir). */
const TERM_LABELS: Record<string, string> = {
  paymentTermDays: "vade günü", taxOffice: "vergi dairesi", riskLimit: "risk limiti", serviceBillingTrigger: "hizmet faturası tetiği",
  notes: "not", vatRate: "KDV oranı", withholdingEnabled: "tevkifat", withholdingNumerator: "tevkifat payı",
  withholdingDenominator: "tevkifat paydası", defaultCurrency: "para birimi",
};
export function termLabels(terms: Record<string, unknown>): string {
  return Object.keys(terms).map((k) => TERM_LABELS[k] ?? k).join(", ");
}

/** Yazılı onay kelimesi — yıkıcı işlemde kullanıcı bunu elle yazar. */
export const MERGE_CONFIRM_WORD = "BİRLEŞTİR";

export async function getMergeCandidates(cariId: string): Promise<CariMergeCandidate[]> {
  const r = await apiClient.get(`/api/finance/cari/${cariId}/merge-candidates`);
  return r.data.data as CariMergeCandidate[];
}

export async function getMergePreview(sourceId: string, targetId: string): Promise<CariMergePreview> {
  const r = await apiClient.get("/api/finance/cari/merge/preview", { params: { sourceId, targetId } });
  return r.data.data as CariMergePreview;
}

export function toApplyBody(p: Pick<CariMergePreview, "sourceId" | "targetId" | "stamp">, clientToken: string) {
  return { sourceId: p.sourceId, targetId: p.targetId, stamp: p.stamp, clientToken };
}

export async function applyCariMerge(p: CariMergePreview, clientToken: string): Promise<{ data: CariMergeResult; message?: string }> {
  const r = await apiClient.post("/api/finance/cari/merge", toApplyBody(p, clientToken));
  return r.data;
}

/** Onay yazısı karşılaştırması — büyük/küçük harf ve baştaki/sondaki boşluk tolere edilir (Türkçe İ dahil). */
export function isConfirmTyped(text: string): boolean {
  return upperTr(text.trim()) === MERGE_CONFIRM_WORD;
}

/** Uygula düğmesi: engel yok, zaten birleşmemiş, onay yazılmış. */
export function canApply(p: CariMergePreview | undefined, confirmText: string): boolean {
  return !!p && !p.alreadyMerged && p.blockers.length === 0 && isConfirmTyped(confirmText);
}
