// =============================================================================
// FASON DEVERE — deverecide tutulan iplik · iade · siparişler arası aktarma panel tipleri (D6b-2)
// =============================================================================
// Backend `services/warping-order/{yarn-return,returns-read,yarn-transfer,yarn-transfer-shared,yarn-transfer-cancel}.ts`
// ile birebir; sayılar METİN gelir (`toFixed(3)`). Tutma satırında iplik kodu/adı YOK → sipariş planından eşlenir.
// =============================================================================

export interface WarpingYarnHolding {
  dispatchItemId: string;
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  /** Kalemin asıl sahibi sipariş (aktarımla gelende kaynak sipariş). */
  ownWarpingOrderId: string;
  /** false = başka siparişten aktarımla gelen kalem. */
  own: boolean;
  yarnItemId: string;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  outKg: string;
  returnedKg: string;
  transferInKg: string;
  transferOutKg: string;
  holdingKg: string;
}

export interface WarpingYarnReturnBody {
  dispatchItemId: string;
  qtyKg: number;
  reasonCode: string;
  warehouseId?: string | null;
  /** Kullanılamaz (fire) kg — boş/0 = yalnız iade. */
  wasteKg?: number | null;
  /** Fire gerekçesi — serbest metin, isteğe bağlı. */
  wasteReason?: string | null;
  /** H1: koli / bobin adedi — bilgi (defter değil); yalnız girilince gider. */
  packageCount?: number;
  bobbinCount?: number;
  clientToken?: string;
}

/** `POST /:id/yarn-returns/preview` gövdesi — sebep önizlemede isteğe bağlı. */
export interface WarpingYarnReturnPreviewBody {
  dispatchItemId: string;
  qtyKg: number;
  wasteKg?: number | null;
  reasonCode?: string;
}

export interface WarpingYarnReturnPreview {
  holdingKg: string;
  returnKg: string;
  wasteKg: string;
  keepKg: string;
  /** İpliğin fire yüzdesi (önceki canlı fire dahil); fire yoksa null. */
  wastePct: string | null;
  tolerancePct: string | null;
  overTolerance: boolean;
  /** Kaydedilince sipariş kapanır mı (kalan 0 + kapanış ön koşulu). */
  willClose: boolean;
  warnings: string[];
}

export interface WarpingYarnReturnResult {
  movementId: string;
  itemCode: string;
  itemName: string;
  qtyKg: string;
  wasteKg: string;
  holdingKg: string;
  autoClosed: boolean;
  replayed: boolean;
}

export interface WarpingYarnReturnRow {
  movementId: string;
  createdAt: string;
  dispatchItemId: string;
  dispatchId: string;
  dispatchNo: string;
  ownDispatch: boolean;
  yarnItemId: string;
  yarnItemCode: string;
  yarnItemName: string;
  warehouseId: string;
  warehouseName: string | null;
  lotId: string | null;
  lotNo: string | null;
  qtyKg: string;
  /** Bu iadeyle yazılan fire (canlı); eski sunucuda yok. */
  wasteKg?: string;
  /** H1: koli / bobin adedi (bilgi); girilmediyse null, eski sunucuda yok. */
  packageCount?: number | null;
  bobbinCount?: number | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  note: string | null;
  status: "ACTIVE" | "CANCELLED";
  canCancel: boolean;
  cancelBlockedReason: string | null;
}

export interface WarpingTransferLine {
  yarnItemId: string;
  qtyKg: number;
  lotId?: string | null;
  dispatchItemId?: string;
}

export interface WarpingTransferFields {
  toWarpingOrderId: string;
  lines: WarpingTransferLine[];
  note?: string | null;
}

export interface WarpingTransferPreview {
  allocations: Array<{ dispatchItemId: string; dispatchNo: string; yarnItemId: string; lotId: string | null; lotNo: string | null; ownerCustomerId: string | null; qtyKg: string }>;
  totalKg: string;
  ownerCustomerId: string | null;
}

export type WarpingTransferKind = "TRANSFER" | "TRANSFER_CANCEL";

export interface WarpingTransferBatch {
  batchId: string;
  kind: WarpingTransferKind;
  fromWarpingOrderId: string;
  fromOrderNo: string;
  toWarpingOrderId: string;
  toOrderNo: string;
  createdAt: string;
  note: string | null;
  totalKg: string;
  cancelled: boolean;
  cancelBatchId: string | null;
  rows: Array<{ transferId: string; kind: string; dispatchItemId: string; dispatchNo: string; yarnItemId: string; code: string; name?: string; lotId: string | null; lotNo: string | null; qtyKg: string; reversesId: string | null }>;
}

export interface WarpingTransferCancelPreview {
  batch: WarpingTransferBatch;
  canCancel: boolean;
  blockedReason: string | null;
  items: Array<{ dispatchItemId: string; dispatchNo: string; code: string; name?: string; lotNo: string | null; qtyKg: string; targetHoldsKg: string }>;
}
