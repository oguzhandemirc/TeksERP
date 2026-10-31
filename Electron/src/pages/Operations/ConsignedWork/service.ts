// İÇERİDEKİ İŞLER (ister 3.2) — `GET /api/consigned-work` aynası. Emanet modülü kapalıyken uç 403 MODULE_DISABLED.
import apiClient from "@/services/apiClient";

export interface ConsignedBucket {
  count: number;
  /** `currentQty` toplamı — Envanter özet şeridinin "Metre"siyle aynı kolon. */
  qty: number;
}

export interface ConsignedOwnerRow {
  ownerCustomerId: string;
  ownerName: string;
  /** Adımsız ham emanet — Ham Stok sekmesi. */
  waiting: ConsignedBucket;
  /** Adımsız yarı mamul emanet (gelen belge onayı böyle doğurur) — Yarı Mamul sekmesi. */
  waitingSemi: ConsignedBucket;
  inProcess: ConsignedBucket;
  ready: ConsignedBucket;
  other: ConsignedBucket;
  total: ConsignedBucket;
  /** D4-I3: sahibin cari kilidi (rozet; metin sunucudan) — eski backend göndermez. */
  hold?: { held: boolean; holdScopes: string[]; holdText: string | null };
}

export interface ConsignedWorkSummary {
  rows: ConsignedOwnerRow[];
  totals: Omit<ConsignedOwnerRow, "ownerCustomerId" | "ownerName">;
}

export const CONSIGNED_WORK_QUERY_KEY = "consigned-work";
export const CONSIGNED_WORK_PATH = "/operations/icerideki-isler";

export async function getConsignedWork(): Promise<ConsignedWorkSummary> {
  const r = await apiClient.get<{ success: boolean; data: ConsignedWorkSummary }>("/api/consigned-work");
  return r.data.data;
}
