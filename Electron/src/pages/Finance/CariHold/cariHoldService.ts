// =============================================================================
// CARİ KİLİDİ — panel istemcisi (D4-I3; backend D4-I1a `finance-cari-hold.routes.ts`)
// =============================================================================
// Metinler (rozet/şerit) SUNUCUDAN gelir; burada yalnız form ↔ gövde dönüşümü var. Gövde `.strict()` — anahtar
// eklemek iki uçta yapılır.
// =============================================================================
import apiClient from "@/services/apiClient";

export type CariHoldScope = "INTAKE" | "SHIPMENT" | "INVOICE";
export type CariHoldReasonCode = "BORC" | "RISK" | "ANLASMAZLIK" | "DIGER";

export const CARI_HOLD_SCOPE_OPTIONS: ReadonlyArray<{ value: CariHoldScope; label: string; hint: string }> = [
  { value: "INTAKE", label: "Yeni iş kabulü", hint: "Gelen belge onayı ve sipariş durur." },
  { value: "SHIPMENT", label: "Sevk", hint: "Sevkiyat oluşturma ve sevk onayı durur." },
  { value: "INVOICE", label: "Fatura onayı", hint: "Satış faturası onayı durur." },
];
export const CARI_HOLD_REASON_OPTIONS: ReadonlyArray<{ value: CariHoldReasonCode; label: string }> = [
  { value: "BORC", label: "Borç" },
  { value: "RISK", label: "Risk" },
  { value: "ANLASMAZLIK", label: "Anlaşmazlık" },
  { value: "DIGER", label: "Diğer" },
];

/** Liste satırının kilit görünümü (Cariler · İçerideki İşler · Sevke Hazır İşler) — metin sunucudan. */
export interface ListHoldView {
  held: boolean;
  holdScopes: CariHoldScope[];
  holdText: string | null;
}

export interface CariHoldRow {
  id: string;
  cariId: string;
  scopes: CariHoldScope[];
  reasonCode: CariHoldReasonCode;
  reasonLabel: string;
  reasonText: string | null;
  placedById: string;
  placedByName: string | null;
  createdAt: string;
  releasedAt: string | null;
  releasedByName: string | null;
  releaseReason: string | null;
}

export interface CariHoldState {
  cariId: string;
  active: CariHoldRow | null;
  history: CariHoldRow[];
}

/** Kilit hedefi: Cari Hesaplar satırından hesap kimliği, cari kartından kart kimliği. */
export type CariHoldTarget = { cariId: string } | { customerId: string };

export async function getCariHolds(target: CariHoldTarget): Promise<CariHoldState> {
  if ("cariId" in target) {
    const r = await apiClient.get(`/api/finance/cari/${target.cariId}/holds`);
    return { cariId: target.cariId, ...(r.data.data as Omit<CariHoldState, "cariId">) };
  }
  const r = await apiClient.get(`/api/finance/cari/by-customer/${target.customerId}/holds`);
  return r.data.data as CariHoldState;
}

export interface PlaceHoldForm {
  scopes: CariHoldScope[];
  reasonCode: CariHoldReasonCode;
  reasonText: string;
}

export async function placeCariHold(cariId: string, form: PlaceHoldForm, clientToken: string): Promise<{ message?: string }> {
  const r = await apiClient.post(`/api/finance/cari/${cariId}/holds`, toPlaceBody(form, clientToken));
  return r.data;
}

export async function releaseCariHold(holdId: string, reason: string): Promise<{ message?: string }> {
  const r = await apiClient.post(`/api/finance/cari/holds/${holdId}/release`, { reason: reason.trim() });
  return r.data;
}

/** Ayar `finance.cariHold.defaultScope` ("INTAKE,SHIPMENT") → formun ön seçili kutuları; tanınmayan parça düşer. */
export function scopesFromSetting(value: string | null | undefined): CariHoldScope[] {
  const raw = (value ?? "INTAKE,SHIPMENT").split(",").map((s) => s.trim());
  return CARI_HOLD_SCOPE_OPTIONS.map((o) => o.value).filter((s) => raw.includes(s));
}

/** Form → strict gövde (D4-I1a `placeSchema`). */
export function toPlaceBody(form: PlaceHoldForm, clientToken: string) {
  return {
    blocksIntake: form.scopes.includes("INTAKE"),
    blocksShipment: form.scopes.includes("SHIPMENT"),
    blocksInvoice: form.scopes.includes("INVOICE"),
    reasonCode: form.reasonCode,
    reasonText: form.reasonText.trim() || null,
    clientToken,
  };
}

export function scopeLabels(scopes: readonly CariHoldScope[]): string {
  return CARI_HOLD_SCOPE_OPTIONS.filter((o) => scopes.includes(o.value)).map((o) => o.label).join(", ");
}

export const RELEASE_REASON_MIN = 3;
