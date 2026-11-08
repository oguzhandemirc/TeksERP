// =============================================================================
// EMANET ÇIKIŞ BELGESİ (genel fason F5) — TEL SÖZLEŞMESİ (şema öncüsü 2026-11-08)
// =============================================================================
// Uçların gövdesi F5'te yazılır; panel (P3) ve tablet (T1) bu tiplere göre paralel yazılır.
// Tam sözleşme (yol · izin · hata kodu · eski istemci): ~/.tekserp/plan/SOZLESME-fason-dalga2.md §F5.
// Sayılar telde string (Decimal → `toFixed`), tarihler ISO string. Top bu belgeye GİRMEZ (brüt sevk kuralı).
// =============================================================================

export type ConsignmentItemKindWire = "WARP_BEAM" | "YARN";

/**
 * POST gövdesinin kalemi — WARP_BEAM ⇒ `warpBeamId`; YARN ⇒ `yarnItemId` + `warehouseId` + `lotId` + `qtyKg`.
 * YARN `lotId` ZORUNLU (tip + Zod + servis; DB CHECK `consignment_dispatch_items_kind_ref_ck` lotId'yi SORMAZ — şema boşluğu): sahip `YarnLot.ownerCustomerId`den
 * (≠ `ownerCustomerId` ⇒ 409 `CONSIGNMENT_OWNER_MISMATCH`), bakiye lot × depo düzeyinde (aşarsa 409
 * `CONSIGNMENT_YARN_INSUFFICIENT`).
 */
export type ConsignmentDispatchItemInput =
  | { kind: "WARP_BEAM"; warpBeamId: string }
  | { kind: "YARN"; yarnItemId: string; warehouseId: string; lotId: string; qtyKg: string };

/** `POST /api/consignment-dispatches/preview` ve `POST /api/consignment-dispatches` gövdesi (aynı şekil). */
export interface ConsignmentDispatchCreateInput {
  ownerCustomerId: string;
  items: ConsignmentDispatchItemInput[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
  /** Mantıksal deneme başına UUID; yalnız oluştur ucunda (önizleme yok sayar). */
  clientToken?: string;
}

export interface ConsignmentDispatchItemDto {
  id: string;
  kind: ConsignmentItemKindWire;
  warpBeam: { id: string; beamNo: string; warpSpecName: string | null } | null;
  /** Levent kaleminde çıkan metre (snapshot). */
  lengthM: string | null;
  yarnItem: { id: string; code: string; name: string } | null;
  warehouse: { id: string; name: string } | null;
  lot: { id: string; lotNo: string } | null;
  qtyKg: string | null;
}

export interface ConsignmentDispatchDto {
  id: string;
  dispatchNo: string;
  ownerCustomer: { id: string; code: string | null; name: string };
  dispatchedAt: string;
  dispatchedBy: { id: string; name: string } | null;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: ConsignmentDispatchItemDto[];
  totals: { beamCount: number; beamLengthM: string; yarnKg: string };
}

/** Önizleme satırı: yazmaz; engelli kalem `blockedReason` taşır (oluştur ucu aynı yüklemle 409 verir). */
export interface ConsignmentDispatchPreviewLine {
  kind: ConsignmentItemKindWire;
  refId: string;
  label: string;
  qty: string;
  unit: "METER" | "KG";
  ownerCustomerId: string | null;
  blockedReason: ConsignmentDispatchErrorCode | null;
}

export interface ConsignmentDispatchPreview {
  ownerCustomer: { id: string; name: string };
  lines: ConsignmentDispatchPreviewLine[];
  totals: { beamCount: number; beamLengthM: string; yarnKg: string };
  canCreate: boolean;
  warnings: string[];
}

/** `GET /api/consignment-dispatches/:id/cancel-preview` — iptalin etkilediği HER kaydı listeler. */
export interface ConsignmentDispatchCancelPreview {
  id: string;
  dispatchNo: string;
  canCancel: boolean;
  blockedReason: ConsignmentDispatchErrorCode | null;
  /** İptalde READY'ye dönecek leventler ve depoya geri yazılacak iplik satırları. */
  affected: Array<{ kind: ConsignmentItemKindWire; refId: string; label: string; qty: string; unit: "METER" | "KG" }>;
  /**
   * F4: iptalde damgalanacak (revoke) levent sarım hizmet bağları. Bağın faturası DRAFT değilse iptal 409
   * `CONSIGNMENT_BEAM_INVOICED` (önce fatura iptal edilir) — `canCancel=false`, satır yine listelenir.
   */
  billingLinks: Array<{ linkId: string; warpBeamId: string; invoiceId: string; invoiceNo: string | null; invoiceStatus: string }>;
}

/** `POST /api/consignment-dispatches/:id/cancel` gövdesi. */
export interface ConsignmentDispatchCancelInput {
  reason: string;
  /** Önizlemede görülen belge damgası (bayat önizleme 409 `CONSIGNMENT_DISPATCH_CHANGED`). */
  expectedUpdatedAt?: string;
}

/** `GET /api/consignment-dispatches` sorgusu — süzme SUNUCUDA, liste + cursor + şerit tek where'den. */
export interface ConsignmentDispatchListQuery {
  "filter[ownerCustomerId]"?: string;
  "filter[status]"?: "ACTIVE" | "CANCELLED" | "ALL";
  "filter[from]"?: string;
  "filter[to]"?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface ConsignmentDispatchListRow {
  id: string;
  dispatchNo: string;
  ownerCustomer: { id: string; name: string };
  dispatchedAt: string;
  cancelledAt: string | null;
  beamCount: number;
  beamLengthM: string;
  yarnKg: string;
}

export interface ConsignmentDispatchListResult {
  data: ConsignmentDispatchListRow[];
  nextCursor: string | null;
  summary: { count: number; activeCount: number; beamCount: number; yarnKg: string };
}

/** `details.code` değerleri (Türkçe mesaj `message`ta). */
export type ConsignmentDispatchErrorCode =
  | "CONSIGNMENT_ITEMS_EMPTY"
  | "CONSIGNMENT_OWNER_MISMATCH"
  | "CONSIGNMENT_BEAM_NOT_READY"
  | "CONSIGNMENT_YARN_INSUFFICIENT"
  | "CONSIGNMENT_DISPATCH_CANCELLED"
  | "CONSIGNMENT_DISPATCH_CHANGED"
  | "CONSIGNMENT_BEAM_MOVED_AFTER"
  | "CONSIGNMENT_BEAM_INVOICED"
  /** Aynı token farklı gövde — TEK boğaz `token-replay.helper` bu kodu üretir (sözleşmedeki `CLIENT_TOKEN_CONFLICT` adı düzeltildi). */
  | "CLIENT_TOKEN_COLLISION";
