// Yalnız testler için: destek uçlarının axios hata nesnesi (gerçek ağ YOK).
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

export function httpError(status: number, data: unknown = {}, headers: Record<string, string> = {}): AxiosError {
  const config = { headers: new AxiosHeaders() };
  const response = { status, statusText: String(status), data, headers, config } as AxiosResponse;
  return new AxiosError(`HTTP ${status}`, "ERR_BAD_RESPONSE", config, undefined, response);
}

export function codeError(status: number, code: string, extra: Record<string, unknown> = {}): AxiosError {
  return httpError(status, { success: false, message: "Sunucu mesajı", details: { code, ...extra } });
}

export function networkError(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK", { headers: new AxiosHeaders() });
}
