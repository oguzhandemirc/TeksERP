/** Destek talebi (3d-2) — backend `GET/POST /api/destek` yanıt şekli. */
export type SupportStatus = "GONDERILMEDI" | "ACIK" | "YANITLANDI" | "KAPANDI";

export interface SupportReply {
  readonly id: string;
  readonly body: string;
  readonly repliedAt: string;
}

export interface SupportTicket {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly status: SupportStatus;
  readonly ticketNo: string | null;
  readonly screenshotType: string | null;
  readonly panelVersion: string | null;
  readonly sentAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly sendAttempts: number;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: { readonly id: string; readonly fullName: string };
  readonly _count?: { readonly replies: number };
  readonly replies?: readonly SupportReply[];
}

export interface CreateSupportTicketBody {
  readonly clientToken: string;
  readonly konu: string;
  readonly aciklama: string;
  readonly ekranGoruntusu: { readonly tur: "image/jpeg" | "image/png"; readonly veri: string } | null;
}

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  GONDERILMEDI: "Gönderilmeyi bekliyor",
  ACIK: "Açık",
  YANITLANDI: "Yanıtlandı",
  KAPANDI: "Kapandı",
};

/** Rozet tonu: gönderilmemiş dikkat ister, yanıt yeni bilgi, kapalı nötr. */
export function supportStatusTone(s: SupportStatus): "destructive" | "default" | "secondary" | "outline" {
  if (s === "GONDERILMEDI") return "destructive";
  if (s === "YANITLANDI") return "default";
  if (s === "KAPANDI") return "outline";
  return "secondary";
}
