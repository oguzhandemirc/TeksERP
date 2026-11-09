// Gülkesim K27 aynı gönderen belge no — backend aynası tipler (`helpers/gelen-belge-mukerrer.helper.ts`); `types.ts` miras alır.
import type { NoteStatus } from "./types";

/** Aynı belge no tekrar gelirse — BLOCK engelle (varsayılan, bugünkü) · WARN işi süren eşte uyar · ALLOW serbest. */
export type DuplicateDocNoMode = "BLOCK" | "WARN" | "ALLOW";

export interface DuplicateDocNoSettings {
  /** Eski backend göndermez → alan çizilmez, gövdeye girmez. */
  duplicateDocNo?: DuplicateDocNoMode;
  defaultDuplicateDocNo?: DuplicateDocNoMode;
  /** Aynı sahip + müşteri parti no işi süren başka belgede: ALLOW serbest (varsayılan, bugünkü) · WARN uyar · BLOCK engelle. */
  duplicateBatchNo?: DuplicateDocNoMode;
  defaultDuplicateBatchNo?: DuplicateDocNoMode;
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

/** Aynı sahip + müşteri parti no'lu işi süren eş (backend `BatchNoPeer`; 409 `details.peers`). */
export interface BatchNoPeer {
  id: string;
  noteNo: string;
  customerBatchNo: string;
  workOrderNumber: string | null;
}

/** Mükerrer kapılarının operatör onay bayrakları — gövdeye aynen; iki kapı art arda 409 verirse ikisi birden taşınır. */
export interface DuplicateConfirms {
  confirmDuplicateDocNo?: true;
  confirmDuplicateBatchNo?: true;
}

/** Kayıt/onay 409'unun mükerrer künyesi: K27 belge no (yalnız WARN, onaylanır) · müşteri parti no (WARN onaylanır, BLOCK bilgi). */
export type DuplicateGateConflict =
  | { gate: "docNo"; confirmable: true; notice: DuplicateDocNoNotice }
  | { gate: "batchNo"; confirmable: boolean; peers: BatchNoPeer[] };
