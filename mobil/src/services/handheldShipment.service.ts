import { apiClient } from './api';
import type { CursorPaginatedResponse } from '../types/api';
import type { ShipmentStatus } from './packing.service';

// =============================================================================
// El terminali sevkiyatı (v2) — `/api/shipping/shipments/...handheld` uçları (sözleşme A1–A7).
// Sınıflandırma SUNUCUDADIR: istemci yalnız `outcome`a göre onay sorar ve gelen `state`i çizer
// (yerel hesap yok). Bayrak kapalıyken bütün uçlar 403 `HANDHELD_DISABLED` döner.
// =============================================================================

export type HandheldReadiness = 'READY' | 'IN_PROCESS';

export interface HandheldRoll {
  id: string;
  barcode: string;
  itemName: string;
  colorName: string | null;
  meters: number;
  weightKg: number | null;
  readinessClass: HandheldReadiness;
  status: string;
}

export interface HandheldSack {
  id: string;
  sackNo: string;
  seq: number | null;
  seqLabel: string | null;
  weightKg: number | null;
  weightSource: 'MANUAL' | 'SCALE' | 'SIMULATED' | null;
  /** İçerikteki topların kg toplamı; kg'lı top yoksa null. */
  rollKgSum: number | null;
  rollKgMissing: number;
  meters: number;
  labelDirty: boolean;
  rolls: HandheldRoll[];
}

export interface HandheldLoadState {
  shipment: {
    id: string;
    shipmentNo: string;
    status: 'PLANNED' | 'DISPATCHED';
    customer: { id: string; name: string };
    branch: { id: string; name: string } | null;
    createdAt: string;
    dispatchedAt: string | null;
    plateNumber: string | null;
    driverName: string | null;
    /** Yalnız DISPATCHED (irsaliye no). */
    documentNo: string | null;
  };
  sacks: HandheldSack[];
  loose: { unitId: string | null; rolls: HandheldRoll[] };
  summary: {
    sackCount: number;
    nonEmptySackCount: number;
    rollCount: number;
    looseRollCount: number;
    meters: number;
    kg: number | null;
    kgMissing: number;
  };
}

/** Yük yeri: çuval ya da çuvalsız (sackId null, etiket "Çuvalsız"). */
export interface UnitRef {
  sackId: string | null;
  label: string;
}

export type HandheldRejectReason =
  | 'NOT_FOUND'
  | 'AMBIGUOUS_CODE'
  | 'SACK_CODE'
  | 'ROLL_IN_OTHER_SHIPMENT'
  | 'ROLL_SHIPPED'
  | 'ROLL_IN_POOL_SACK'
  | 'OWNER_MISMATCH'
  | 'WAREHOUSE_MISMATCH'
  | 'ROLL_NOT_PHYSICAL';

export type HandheldOutcome =
  | { kind: 'added'; rollId: string; barcode: string; to: UnitRef; replayed?: true }
  | { kind: 'transferred'; rollId: string; barcode: string; from: UnitRef; to: UnitRef }
  | { kind: 'needsRemoveConfirm'; rollId: string; barcode: string; from: UnitRef }
  | { kind: 'removed'; rollId: string; barcode: string; from: UnitRef; unitDissolved: boolean; replayed?: true }
  | { kind: 'needsNotReadyConfirm'; rollId: string; barcode: string; reason: 'ROLL_NOT_READY'; stageLabel: string }
  | { kind: 'sackSelected'; sackId: string; sackNo: string }
  | {
      kind: 'rejected';
      reason: HandheldRejectReason;
      message: string;
      barcode: string;
      meta?: { shipmentNo?: string; sackNo?: string; ownerName?: string; status?: string };
    };

export interface ScanBody {
  barcode: string;
  targetSackId: string | null;
  confirmRemove?: boolean;
  confirmNotReady?: boolean;
  isRetry?: boolean;
  clientToken: string;
}

export interface DispatchBody {
  plateNumber?: string | null;
  driverName?: string | null;
  expectedRollCount: number;
}

export interface DispatchResult {
  shipmentId: string;
  shipmentNo: string;
  documentNo: string | null;
  rollCount: number;
  sackCount: number;
  looseRollCount: number;
  droppedEmptySacks: string[];
  state: HandheldLoadState;
  replayed?: boolean;
}

/** `GET /shipping/shipments` satırı — yalnız bu ekranın okuduğu alanlar (brüt toplamlar sunucuda). */
export interface ShipmentListRow {
  kind?: 'SHIPMENT' | 'DIRECT';
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  createdAt: string;
  dispatchedAt: string | null;
  customer: { id: string; code?: string; name: string };
  branch: { id: string; name: string } | null;
  totalMeters?: number;
  totalKg?: number;
  /** `sacks` = canlı TÜM yük birimleri (çuval + dökme + araba); `bulks`/`carts` ayrıca. */
  _count: { sacks: number; rolls: number; bulks?: number; carts?: number };
}

/** Yanıt zarfı: `{ success, data }` — zarfsız gövde de kabul (aynı alanlar). */
function unwrap<T>(body: unknown): T {
  const b = body as { data?: unknown } | null;
  return (b && typeof b === 'object' && 'data' in b && b.data !== undefined ? b.data : body) as T;
}

const base = '/shipping/shipments';

export const handheldShipmentService = {
  /** A1 — cari için boş PLANNED sevkiyat (clientToken zorunlu; aynı token aynı sevkiyatı döner). */
  open: (body: { customerId: string; branchId?: string | null; clientToken: string }): Promise<HandheldLoadState> =>
    apiClient.post(`${base}/handheld`, body).then((r) => unwrap<HandheldLoadState>(r.data)),

  /** A2 — güncel yük durumu (PLANNED ve DISPATCHED). */
  getState: (shipmentId: string): Promise<HandheldLoadState> =>
    apiClient.get(`${base}/${shipmentId}/handheld`).then((r) => unwrap<HandheldLoadState>(r.data)),

  /** A3 — tek okutma ucu; iş kararı `outcome`ta, ekranın verisi `state`te. */
  scan: (shipmentId: string, body: ScanBody): Promise<{ outcome: HandheldOutcome; state: HandheldLoadState }> =>
    apiClient
      .post(`${base}/${shipmentId}/scan`, body)
      .then((r) => unwrap<{ outcome: HandheldOutcome; state: HandheldLoadState }>(r.data)),

  /** A4 — sevkiyat içinde çuval aç (numara doğuşta). */
  openSack: (
    shipmentId: string,
    clientToken: string,
  ): Promise<{ sack: { id: string; sackNo: string; seq: number | null; seqLabel: string | null }; state: HandheldLoadState }> =>
    apiClient.post(`${base}/${shipmentId}/sacks`, { clientToken }).then((r) => unwrap(r.data)),

  /** A5 — çuvala elle kg; null = kg'yi kaldır. */
  setSackWeight: (shipmentId: string, sackId: string, weightKg: number | null): Promise<{ state: HandheldLoadState }> =>
    apiClient.put(`${base}/${shipmentId}/sacks/${sackId}/weight`, { weightKg }).then((r) => unwrap(r.data)),

  /** A6 — sevk et (boş çuvallar düşer; yük ekranla aynı değilse 409 LOAD_CHANGED). */
  dispatch: (shipmentId: string, body: DispatchBody): Promise<DispatchResult> =>
    apiClient.post(`${base}/${shipmentId}/handheld-dispatch`, body).then((r) => unwrap<DispatchResult>(r.data)),

  /** A7 — Sevk Çıkışı listesi (cursor). Parametreler `elSevk/listQuery.listQueryParams`ten (tek kaynak). */
  list: (params: Record<string, string>): Promise<CursorPaginatedResponse<ShipmentListRow>> =>
    apiClient
      .get<CursorPaginatedResponse<ShipmentListRow>>(`${base}?${new URLSearchParams(params).toString()}`)
      .then((r) => r.data),
};

/** Hata kodu (`details.code`) — `body.code` okunmaz. */
export function errorCode(err: unknown): string | null {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  return typeof code === 'string' ? code : null;
}
