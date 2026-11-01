// Onay akışının saf parçaları: hangi 409 gerekçeyle geçilir, sonuç özeti nasıl okunur.
import axios from "axios";
import type { ApproveResult, AutoWorkOrderResult, DefaultItemSource, DeliveryNoteLine, EffectiveDefaultItem, IncomingDocumentSettings } from "./types";

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
  GELEN_BELGE_DEFAULT_ITEM_UNUSABLE: "Ürünü seçilmemiş satırların gireceği varsayılan ürün artık kullanılamıyor; hiç top girilmedi. Satırlara ürün seçin ya da varsayılan ürünü düzeltin.",
};

/** E4: kullanılamaz varsayılanın KAYNAĞINA göre yönlendirme; düzeltme yeri backend mesajındadır (yol burada yazılmaz). */
const UNUSABLE_BY_SOURCE: Record<DefaultItemSource, string> = {
  CUSTOMER: "Ürünü seçilmemiş satırlar sahibin müşteri varsayılanıyla girecekti ama o ürün artık kullanılamıyor; hiç top girilmedi. Satırlara ürün seçin ya da müşterinin varsayılan ürününü düzeltin.",
  FACTORY: "Ürünü seçilmemiş satırlar fabrika varsayılanıyla girecekti ama o ürün artık kullanılamıyor; hiç top girilmedi. Satırlara ürün seçin ya da fabrika ayarındaki varsayılan ürünü düzeltin.",
};

/** 409 `GELEN_BELGE_DEFAULT_ITEM_UNUSABLE` kaynağı (`details.source`); başka hata ya da kaynaksız (eski backend) → null. */
export function unusableDefaultSource(error: unknown): DefaultItemSource | null {
  if (errorCode(error) !== "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE" || !axios.isAxiosError(error)) return null;
  const s = (error.response?.data as { details?: { source?: unknown } } | undefined)?.details?.source;
  return s === "CUSTOMER" || s === "FACTORY" ? s : null;
}

/** Diyalogdaki hata metni: E3/E4 kodunda Türkçe yönlendirme + backend'in mesajı; diğerlerinde verilen yedek. */
export function approveErrorText(error: unknown, fallback: string): string {
  const c = errorCode(error);
  const src = unusableDefaultSource(error);
  const lead = src ? UNUSABLE_BY_SOURCE[src] : c ? APPROVE_ERROR_TEXT[c] : undefined;
  return lead ? `${lead} (${fallback})` : fallback;
}

const SOURCE_PHRASE: Record<DefaultItemSource, string> = { CUSTOMER: "Müşteri varsayılanıyla", FACTORY: "Fabrika varsayılanıyla" };
const SOURCE_PHRASE_LOWER: Record<DefaultItemSource, string> = { CUSTOMER: "müşteri varsayılanıyla", FACTORY: "fabrika varsayılanıyla" };
const SOURCE_NOUN: Record<DefaultItemSource, string> = { CUSTOMER: "müşteri varsayılanı", FACTORY: "fabrika varsayılanı" };

/**
 * Ürünsüz satırın ipucu — backend'in ETKİN varsayılanından (istemci sırayı uydurmaz). undefined (okunamadı/eski backend)
 * ya da kaynak yok → null (bugünkü "Kumaş seç" kalır).
 */
export function defaultItemHint(eff: EffectiveDefaultItem | null | undefined): { tone: "info" | "block"; source: DefaultItemSource; text: string } | null {
  if (!eff || !eff.source || !eff.itemId) return null;
  if (!eff.usable) return { tone: "block", source: eff.source, text: `Varsayılan ürün kullanılamıyor (${SOURCE_NOUN[eff.source]}): ${eff.problem ?? "Ürün bulunamadı."}` };
  return { tone: "info", source: eff.source, text: `${SOURCE_PHRASE[eff.source]} girecek: ${eff.name ?? ""}` };
}

/** Backend precheck'inin "açık satır" tanımı (`gelen-belge-onay.service.ts`): topsuz PENDING/FAILED/ENTERING. */
type PrecheckLine = Pick<DeliveryNoteLine, "status" | "rollId" | "itemId" | "needsReview">;
const isOpenLine = (l: PrecheckLine) => !l.rollId && (l.status === "PENDING" || l.status === "FAILED" || l.status === "ENTERING");

export interface ApprovePrecheck {
  /** Ürünü seçilmemiş açık satır sayısı. */
  unresolved: number;
  /** needsReview açık satır sayısı. */
  unreviewed: number;
  /** Onay engellenir mi (BLOCK + gözden geçirilmemiş · ürünsüz + etkin varsayılan yok · varsayılan ürün kullanılamaz). */
  blocked: boolean;
  messages: Array<{ tone: "info" | "warn" | "block"; text: string }>;
}

/**
 * Onay diyaloğu ön kontrol sayacı — backend precheck'inin aynası. `eff` sahibin etkin varsayılanı (eşleşme yanıtı);
 * okunamadıysa (undefined) ürünsüz satır yalnız sayılır. Ayar okunamadıysa (null) inceleme kipi hükmü verilmez.
 */
export function approvePrecheck(lines: readonly PrecheckLine[], settings: IncomingDocumentSettings | null | undefined, eff?: EffectiveDefaultItem | null): ApprovePrecheck {
  const open = lines.filter(isOpenLine);
  const unresolved = open.filter((l) => !l.itemId).length;
  const unreviewed = open.filter((l) => l.needsReview).length;
  const messages: ApprovePrecheck["messages"] = [];
  let blocked = false;
  if (unresolved > 0) {
    if (!eff) {
      messages.push({ tone: "info", text: `${unresolved} satırın ürünü seçilmemiş — varsayılan ürün onayda denetlenecek.` });
    } else if (!eff.source || !eff.itemId) {
      blocked = true;
      messages.push({ tone: "block", text: `${unresolved} satırın ürünü seçilmemiş — onay engellenir (ne müşteri ne fabrika varsayılan ürünü var).` });
    } else if (!eff.usable) {
      blocked = true;
      messages.push({ tone: "block", text: `${unresolved} satırın ürünü seçilmemiş ve ${SOURCE_NOUN[eff.source]} kullanılamıyor: ${eff.problem ?? "Ürün bulunamadı."}` });
    } else {
      messages.push({ tone: "info", text: `${unresolved} satır ${SOURCE_PHRASE_LOWER[eff.source]} girecek: ${eff.name ?? ""}` });
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

export interface AutoWorkOrderSummary {
  tone: "ok" | "warn";
  title: string;
  /** Grup başına satır: açılan İE no ya da elle açılma nedeni. */
  lines: Array<{ key: string; tone: "ok" | "warn"; text: string }>;
}

/** Onay sonrası otomatik iş emri özeti; alan yoksa (ayar kapalı / eski backend) null — diyalog bugünkü gibi kalır. */
export function summarizeAutoWorkOrders(r: AutoWorkOrderResult | undefined | null): AutoWorkOrderSummary | null {
  if (!r) return null;
  if (r.groups.length === 0) return null;
  const parts: string[] = [];
  if (r.opened > 0) parts.push(`${r.opened} iş emri açıldı`);
  if (r.manual > 0) parts.push(`${r.manual} grup elle açılmalı`);
  const title = parts.join(", ") + (r.reason ? ` — ${r.reason}` : "") + ".";
  const lines = r.groups.map((g) => {
    const name = `${g.itemName}${g.targets.length ? ` · ${g.targets.join(" + ")}` : " · desensiz"} (${g.rollCount} top)`;
    if (g.outcome === "OPENED") return { key: g.key, tone: "ok" as const, text: `${name}: ${g.workOrderNumber ?? "iş emri"} açıldı${g.attached != null ? `, ${g.attached} top bağlandı` : ""}` };
    return { key: g.key, tone: "warn" as const, text: `${name}: elle açılmalı — ${g.reason ?? "neden bildirilmedi"}` };
  });
  return { tone: r.manual > 0 ? "warn" : "ok", title, lines: r.reason ? [] : lines };
}
