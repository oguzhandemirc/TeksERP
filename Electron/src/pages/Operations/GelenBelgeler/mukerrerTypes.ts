// Gülkesim K27 aynı gönderen belge no — backend aynası tipler (`helpers/gelen-belge-mukerrer.helper.ts`); `types.ts` miras alır.
import type { NoteStatus } from "./types";

/** Aynı belge no tekrar gelirse — BLOCK engelle (varsayılan, bugünkü) · WARN işi süren eşte uyar · ALLOW serbest. */
export type DuplicateDocNoMode = "BLOCK" | "WARN" | "ALLOW";

export interface DuplicateDocNoSettings {
  /** Eski backend göndermez → alan çizilmez, gövdeye girmez. */
  duplicateDocNo?: DuplicateDocNoMode;
  defaultDuplicateDocNo?: DuplicateDocNoMode;
}

/** Aynı belge no'lu, İŞİ SÜREN eş belge (backend `DocNoPeer`). */
export interface DocNoPeer {
  id: string;
  noteNo: string;
  status: NoteStatus;
  /** Eşin toplarının iptal dışı iş emirleri (en çok 3). */
  workOrderNumbers: string[];
}

/** Detay yanıtı `duplicateDocNo` (yalnız WARN kipinde, taslakta, işi süren eş varken); eski backend göndermez. */
export interface DuplicateDocNoNotice {
  senderDocNo: string;
  peers: DocNoPeer[];
}

export interface DuplicateDocNoDetailFields {
  /** WARN kipi: aynı gönderen belge no'lu işi süren eşler (bilgi şeridi); eski backend göndermez / yoksa null. */
  duplicateDocNo?: DuplicateDocNoNotice | null;
}
