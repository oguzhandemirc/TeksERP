// =============================================================================
// BELİRSİZ MÜŞTERİ KODU 409'U — panel okutma noktalarının ortak çözücüsü (D4-F1c, K12)
// =============================================================================
// Backend tek boğazı (`roll-scan-resolve.helper.ts`) iki müşteride aynı kodu okutunca
// 409 `CUSTOMER_CODE_AMBIGUOUS` + adaylar döner. Tekil işlem yapan nokta aday modalını
// açar; seçim işlemi topun İÇ barkoduyla yeniden sürdürür. SESSİZ SEÇİM YOK.
// =============================================================================
import axios from "axios";

export const CUSTOMER_CODE_AMBIGUOUS = "CUSTOMER_CODE_AMBIGUOUS";

export interface CustomerCodeCandidate {
  rollId: string;
  /** Topun iç barkodu — seçim işlemi bununla sürdürür; null'sa aday seçilemez. */
  barcode: string | null;
  customerId: string;
  customerName: string;
  code: string;
  currentQty: number;
  /** D4-F1c ile eklendi; eski backend göndermez. */
  status?: string;
}

export interface AmbiguousCustomerCode {
  scannedCode: string;
  message: string;
  candidates: CustomerCodeCandidate[];
}

interface AmbiguousBody {
  message?: string;
  details?: { code?: unknown; scannedCode?: unknown; candidates?: unknown };
}

function readBody(body: unknown): AmbiguousCustomerCode | null {
  const b = body as AmbiguousBody | undefined;
  if (b?.details?.code !== CUSTOMER_CODE_AMBIGUOUS || !Array.isArray(b.details.candidates)) return null;
  return {
    scannedCode: typeof b.details.scannedCode === "string" ? b.details.scannedCode : "",
    message: b.message ?? "",
    candidates: b.details.candidates as CustomerCodeCandidate[],
  };
}

/** Hata bir belirsiz müşteri kodu 409'uysa adaylarıyla döner; değilse null (bugünkü hata yolu sürer). */
export function readAmbiguousCustomerCode(error: unknown): AmbiguousCustomerCode | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  return readBody(error.response.data);
}

/**
 * Interceptor kapısı: istek `customerCodeChoice` ile işaretliyse belirsizlik 409'unun genel
 * toast'ı basılmaz — modal ekranda açılır. İşaretsiz istekte toast bugünkü gibi.
 */
export function isChoiceHandledConflict(status: number | undefined, body: unknown, optedIn: boolean | undefined): boolean {
  return optedIn === true && status === 409 && readBody(body) !== null;
}
