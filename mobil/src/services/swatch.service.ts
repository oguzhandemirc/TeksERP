import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Swatch (Kartela) — TartıPaket scan akışında kartela barkodu çözümlemesi
// =============================================================================

export interface SwatchByBarcode {
  id: string;
  barcode: string;
  cardNumber: string;
  length: number;
  width: number | null;
  weightKg: number | null;
  sackId: string | null;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
  parentRoll?: {
    id: string;
    barcode: string;
    ownerCustomerId: string | null;
  } | null;
}

export const swatchService = {
  getByBarcode: (barcode: string): Promise<ApiResponse<SwatchByBarcode | null>> =>
    apiClient
      .get<ApiResponse<SwatchByBarcode | null>>(
        `/swatches/by-barcode/${encodeURIComponent(barcode)}`
      )
      .then((r) => r.data),
};
