// Durum etiketleri (Türkçe) — liste süzgeci, rozet ve onay sonucu aynı sözlüğü okur.
import type { LineStatus, NoteSourceKind, NoteStatus } from "./types";

export const NOTE_STATUS_LABEL: Record<NoteStatus, string> = {
  DRAFT: "Taslak",
  APPROVING: "Onaylanıyor",
  APPROVED: "Onaylandı",
  PARTIAL: "Kısmi",
  CANCELLED: "İptal",
};

export const NOTE_STATUS_VARIANT: Record<NoteStatus, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "secondary",
  APPROVING: "outline",
  APPROVED: "default",
  PARTIAL: "destructive",
  CANCELLED: "outline",
};

export const SOURCE_LABEL: Record<NoteSourceKind, string> = { OCR: "Fotoğraf", MANUAL: "Elle", IMPORT: "Excel" };

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  PENDING: "Bekliyor",
  ENTERING: "Giriliyor",
  ENTERED: "Girildi",
  FAILED: "Girilemedi",
  SKIPPED: "Atlandı",
};

/** Yazılabilir mi: başlık/satır düzenleme yalnız DRAFT (PARTIAL'da yalnız FAILED satır atlanır/düzeltilir). */
export const isEditable = (s: NoteStatus) => s === "DRAFT";
export const isApprovable = (s: NoteStatus) => s === "DRAFT" || s === "PARTIAL";
