// Belirsiz müşteri kodu 409'u fikstürü (D4-F1c) — panel okutma noktası testlerinin ortak girdisi.
import { AxiosError, AxiosHeaders } from "axios";
import type { CustomerCodeCandidate } from "@/lib/customer-code-choice";

export const SHARED_CODE = "MK-ORTAK-1";

export const CANDIDATES: CustomerCodeCandidate[] = [
  { rollId: "r-a", barcode: "T-IC-A", customerId: "c-a", customerName: "ALFA PERDE", code: SHARED_CODE, currentQty: 41.5, status: "STOCK" },
  { rollId: "r-b", barcode: "T-IC-B", customerId: "c-b", customerName: "BETA TEKSTİL", code: SHARED_CODE, currentQty: 37, status: "STOCK" },
];

/** Sunucunun `ambiguousCustomerCodeError` gövdesinin aynası. */
export function ambiguousError(candidates: CustomerCodeCandidate[] = CANDIDATES): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("409", "ERR_BAD_REQUEST", config, null, {
    status: 409,
    statusText: "Conflict",
    headers: {},
    config,
    data: {
      success: false,
      message: `"${SHARED_CODE}" birden çok müşteride kayıtlı`,
      details: { code: "CUSTOMER_CODE_AMBIGUOUS", scannedCode: SHARED_CODE, candidates },
    },
  });
}

/** İlk çağrıda (müşteri kodu) 409, iç barkodla `ok(code)` döner. */
export function ambiguousThen<T>(ok: (code: string) => T) {
  return async (code: string): Promise<T> => {
    if (code === SHARED_CODE) throw ambiguousError();
    return ok(code);
  };
}
