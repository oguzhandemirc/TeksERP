// Onay akışının saf parçaları: hangi 409 gerekçeyle geçilir, sonuç özeti nasıl okunur.
import axios from "axios";
import type { ApproveResult, DeliveryNoteLine, IncomingDocumentSettings } from "./types";

/** Gerekçeyle (varianceReason) geçilebilen kapılar — backend `gelen-belge-onay.service.ts` precheck. */
export const VARIANCE_CODES = new Set(["TOTAL_MISMATCH", "DELIVERY_NOTE_PAGES_MISSING"]);

/** Hata kodu YALNIZ `details.code`ten (`body.code` hep undefined — kök kural). */
export function errorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const c = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof c === "string" ? c : null;
}

export function needsVarianceReason(error: unknown): boolean {
  const c = errorCode(error);
  return c !== null && VARIANCE_CODES.has(c);
}

/** E3 kapıları için diyalog dili — backend mesajı satır no listesi taşır, bu cümle operatöre ne yapacağını söyler. */
export const APPROVE_ERROR_TEXT: Record<string, string> = {
  DELIVERY_NOTE_REVIEW_PENDING: "Gözden geçirilmemiş satır var ve fabrika ayarı bu durumda onayı engelliyor. Sarı işaretli hücreleri gözden geçirip yeniden onaylayın.",
  GELEN_BELGE_DEFAULT_ITEM_UNUSABLE: "Ürünü seçilmemiş satırların gireceği varsayılan ürün artık kullanılamıyor; hiç top girilmedi. Satırlara ürün seçin ya da Genel Ayarlar'daki varsayılan ürünü değiştirin.",
};

/** Diyalogdaki hata metni: E3 kodunda Türkçe yönlendirme + backend'in satır listesi; diğerlerinde verilen yedek. */
export function approveErrorText(error: unknown, fallback: string): string {
  const c = errorCode(error);
  return c && APPROVE_ERROR_TEXT[c] ? `${APPROVE_ERROR_TEXT[c]} (${fallback})` : fallback;
}

/** Backend precheck'inin "açık satır" tanımı (`gelen-belge-onay.service.ts`): topsuz PENDING/FAILED/ENTERING. */
type PrecheckLine = Pick<DeliveryNoteLine, "status" | "rollId" | "itemId" | "needsReview">;
const isOpenLine = (l: PrecheckLine) => !l.rollId && (l.status === "PENDING" || l.status === "FAILED" || l.status === "ENTERING");

export interface ApprovePrecheck {
  /** Ürünü seçilmemiş açık satır sayısı. */
  unresolved: number;
  /** needsReview açık satır sayısı. */
  unreviewed: number;
  /** Onay engellenir mi (BLOCK + gözden geçirilmemiş · ürünsüz + ayar boş · varsayılan ürün kullanılamaz). */
  blocked: boolean;
  messages: Array<{ tone: "info" | "warn" | "block"; text: string }>;
}

/** Onay diyaloğu ön kontrol sayacı — backend precheck'inin aynası; ayar okunamadıysa (null) yalnız sayar, hüküm vermez. */
export function approvePrecheck(lines: readonly PrecheckLine[], settings: IncomingDocumentSettings | null | undefined): ApprovePrecheck {
  const open = lines.filter(isOpenLine);
  const unresolved = open.filter((l) => !l.itemId).length;
  const unreviewed = open.filter((l) => l.needsReview).length;
  const messages: ApprovePrecheck["messages"] = [];
  let blocked = false;
  if (unresolved > 0 && settings) {
    const d = settings.defaultItem;
    if (!d) {
      blocked = true;
      messages.push({ tone: "block", text: `${unresolved} satırın ürünü seçilmemiş — onay engellenir (varsayılan ürün ayarı boş).` });
    } else if (d.problem) {
      blocked = true;
      messages.push({ tone: "block", text: `${unresolved} satırın ürünü seçilmemiş ve varsayılan ürün kullanılamıyor: ${d.problem}` });
    } else {
      messages.push({ tone: "info", text: `${unresolved} satır varsayılan ürünle girecek: ${d.name}` });
    }
  }
  if (unreviewed > 0 && settings) {
    if (settings.unreviewedApproval === "BLOCK") {
      blocked = true;
      messages.push({ tone: "block", text: `${unreviewed} satır gözden geçirilmeli — onay engellenir.` });
    } else {
      messages.push({ tone: "warn", text: `${unreviewed} satır gözden geçirilmedi — onay uyarıyla geçer.` });
    }
  }
  return { unresolved, unreviewed, blocked, messages };
}

export interface ApproveOutcome {
  status: "APPROVED" | "PARTIAL" | "OTHER";
  title: string;
  failed: Array<{ lineNo: number; blockNo: number; reason: string }>;
}

export function summarizeApprove(r: ApproveResult): ApproveOutcome {
  const failed = r.note.lines
    .filter((l) => l.status === "FAILED")
    .map((l) => ({ lineNo: l.lineNo, blockNo: l.blockNo, reason: l.failReason ?? "Sebep bildirilmedi" }));
  const s = r.note.status;
  const counts = `${r.summary.entered} top girildi${r.summary.replayed ? `, ${r.summary.replayed} önceden girilmiş` : ""}${r.summary.skipped ? `, ${r.summary.skipped} atlandı` : ""}`;
  if (s === "APPROVED") return { status: "APPROVED", title: `Onaylandı — ${counts}.`, failed };
  if (s === "PARTIAL") return { status: "PARTIAL", title: `Kısmi onay — ${counts}, ${r.summary.failed} satır girilemedi.`, failed };
  return { status: "OTHER", title: `Durum: ${s}`, failed };
}
