/** Merkezin `{ error: { code, message } }` yanıtı (ya da ağ/zaman aşımı) için hata. */
export class DestekApiError extends Error {
  constructor(
    /** Ör. `INVALID_SIGNATURE`, `NOT_FOUND`, `REOPEN_WINDOW_EXPIRED`; ağ hatasında `NETWORK_ERROR`, zaman aşımında `TIMEOUT`. */
    readonly code: string,
    /** HTTP durum kodu; ağ hatasında 0. */
    readonly status: number,
    message: string,
    /** 429'da `Retry-After` (sn). */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'DestekApiError';
  }
}

/** Webhook doğrulama hatası. */
export class DestekWebhookError extends Error {
  constructor(
    readonly code: 'INVALID_SIGNATURE' | 'TIMESTAMP_OUT_OF_RANGE' | 'INVALID_PAYLOAD',
    message: string,
  ) {
    super(message);
    this.name = 'DestekWebhookError';
  }
}
