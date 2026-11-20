import type { TicketStatus, TicketType } from "./types";

export const TYPE_LABEL: Record<TicketType, string> = {
  BUG: "Hata",
  QUESTION: "Soru",
  REQUEST: "İstek",
};

export const TYPE_HINT: Record<TicketType, string> = {
  BUG: "Bir şey çalışmıyor ya da yanlış çalışıyor",
  QUESTION: "Nasıl yapılır, ne anlama gelir",
  REQUEST: "Yeni özellik ya da değişiklik isteği",
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "Yeni",
  IN_PROGRESS: "İnceleniyor",
  WAITING_CUSTOMER: "Sizden bilgi bekleniyor",
  ANSWERED: "Yanıtlandı",
  CLOSED: "Kapandı",
};

/** Durum rozeti renkleri — "Sizden bilgi bekleniyor" ve "Yanıtlandı" kullanıcıdan eylem ister, öne çıkar. */
export const STATUS_CLASS: Record<TicketStatus, string> = {
  NEW: "border-info/30 bg-info/10 text-info",
  IN_PROGRESS: "border-primary/30 bg-primary/10 text-primary",
  WAITING_CUSTOMER: "border-warning/45 bg-warning/15 text-warning",
  ANSWERED: "border-success/35 bg-success/10 text-success",
  CLOSED: "border-transparent bg-muted text-muted-foreground",
};

export const STATUS_ORDER: TicketStatus[] = ["NEW", "IN_PROGRESS", "WAITING_CUSTOMER", "ANSWERED", "CLOSED"];

/** Süzgeç ön ayarları: "Açık" = kapalı olmayan her durum. */
export const STATUS_FILTERS: { key: string; label: string; statuses: TicketStatus[] | undefined }[] = [
  { key: "open", label: "Açık", statuses: ["NEW", "IN_PROGRESS", "WAITING_CUSTOMER", "ANSWERED"] },
  { key: "waiting", label: "Yanıt bekleyen", statuses: ["WAITING_CUSTOMER", "ANSWERED"] },
  { key: "closed", label: "Kapalı", statuses: ["CLOSED"] },
  { key: "all", label: "Tümü", statuses: undefined },
];

export const DISCLOSURE = "Destek talepleri Etkili Yazılım destek sisteminde işlenir.";

/** Kapanıştan sonra yanıt yazılabilen süre (sözleşme §5.5). */
export const REOPEN_WINDOW_DAYS = 14;

export function reopenDeadline(closedAt: string | null): Date | null {
  if (!closedAt) return null;
  const t = Date.parse(closedAt);
  return Number.isFinite(t) ? new Date(t + REOPEN_WINDOW_DAYS * 86_400_000) : null;
}
