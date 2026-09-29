// Satıcı hata tipi — gövde backend ile aynı: {success:false, message:<TR>, details:{code}}.
import type { ProtocolErrorCode, VendorErrorCode } from "../lisans-protokol";

export type VendorCode = VendorErrorCode | ProtocolErrorCode;

export class VendorError extends Error {
  constructor(
    readonly status: number,
    readonly code: VendorCode,
    message: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, VendorError.prototype);
  }
}

export const vendorError = (status: number, code: VendorCode, message: string): VendorError =>
  new VendorError(status, code, message);

/** İmzalı istek doğrulanamadı: JWS/İSTEK kodları olduğu gibi, diğerleri genel koda iner. */
export function requestRejected(code: ProtocolErrorCode, message: string): VendorError {
  const passThrough = code.startsWith("JWS_") || code.startsWith("ISTEK_");
  return new VendorError(401, passThrough ? code : "ISTEK_GECERSIZ", message);
}

export const retryConflict = (): VendorError =>
  new VendorError(409, "SUNUCU_HATASI", "Eşzamanlı işlem çakıştı; lütfen tekrar deneyin");
