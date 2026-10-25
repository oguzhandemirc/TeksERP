// Sertifika ekranının saf kuralları — rozet, etiket, boş durum. Süre hesabı SUNUCUDA (`daysLeft`,
// `certificateExpiryWhere`); burada yalnız gösterim eşiği var.
import type { CertificateRow, CertificateStatusFilter } from "./service";

export const HOLDER_LABEL = { OWN: "Fabrika", PARTNER: "İş ortağı" } as const;

export const STATUS_FILTER_LABEL: Record<CertificateStatusFilter, string> = {
  active: "Etkin", expiring: "Süresi dolan / dolmak üzere", expired: "Süresi dolmuş", revoked: "İptal edilen", renewed: "Yenilenen", all: "Tümü",
};

export type ExpiryTone = "expired" | "soon" | "ok" | "inactive";
export interface ExpiryBadge { tone: ExpiryTone; text: string }

/** Kalan gün rozeti: iptal/yenilenmiş → durum; ≤0 kırmızı "Süresi doldu"; ≤ eşik sarı; üstü nötr. */
export function expiryBadge(r: Pick<CertificateRow, "active" | "daysLeft" | "revokedAt" | "renewedBy">, soonDays: number): ExpiryBadge {
  if (r.revokedAt) return { tone: "inactive", text: "İptal edildi" };
  if (r.renewedBy) return { tone: "inactive", text: "Yenilendi" };
  if (r.daysLeft < 0) return { tone: "expired", text: `Süresi doldu · ${-r.daysLeft} gün önce` };
  if (r.daysLeft === 0) return { tone: "expired", text: "Süresi doldu · bugün" };
  if (r.daysLeft <= soonDays) return { tone: "soon", text: `${r.daysLeft} gün kaldı` };
  return { tone: "ok", text: `${r.daysLeft} gün kaldı` };
}

export const TONE_CLASS: Record<ExpiryTone, string> = {
  expired: "border-destructive/40 bg-destructive/10 text-destructive dark:border-red-400/50 dark:text-red-300",
  soon: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ok: "border-border text-muted-foreground",
  inactive: "border-border bg-muted text-muted-foreground",
};

export interface CertificateFilterState { status: CertificateStatusFilter; days: number; holder: "" | "OWN" | "PARTNER"; q: string }
export const EMPTY_CERTIFICATE_FILTERS: CertificateFilterState = { status: "active", days: 30, holder: "", q: "" };

export function isCertificateFilterDirty(f: CertificateFilterState): boolean {
  return f.status !== "active" || f.days !== 30 || f.holder !== "" || f.q.trim() !== "";
}

export function certificateEmptyMessage(f: CertificateFilterState): string {
  if (isCertificateFilterDirty(f)) return "Süzgeçlere uyan sertifika yok. Süzgeçleri temizleyip yeniden bakın.";
  return "Henüz etkin sertifika yok. “Yeni Sertifika” ile OEKO-TEX, GOTS gibi belgelerinizi ve bitiş tarihlerini girin.";
}

export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
