// Portal JSON API istemcisi — aynı köken (çerez httpOnly + SameSite=Strict, CORS yok). Hata kodu
// `details.code` altında okunur (`body.code` hiç yok). Yazmalar yalnız application/json gövdeyle gider.

export type ApiBase = "/portal/api" | "/bayi/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Ağ hatası (yanıt yok): sonucu belirsizdir. */
export const NETWORK_ERROR_CODE = "AG_HATASI";

/** 409 "eşzamanlı işlem çakıştı; tekrar deneyin" (40001/40P01, claim kaybı): tx geri alındı, aynı kimlikle yinelenir. */
export const RETRY_CONFLICT_CODE = "TEKRAR_DENEYIN";

/**
 * Sonucu BELİRSİZ bırakan hata: istek sunucuda işlenmiş olabilir (ağ · zaman aşımı · 5xx) ya da
 * eşzamanlı çakışmayla geri alınmış olabilir (409 "tekrar deneyin"). Bu hatalarda
 * işlem kimliği yapışır: aynı deneme aynı kimlikle yinelenir, sunucu eylemi ikinci kez koşmaz.
 * Kesin 4xx (doğrulama, yetki, durum çakışması, kimlik çakışması) kimliği bırakır.
 */
export function isAmbiguousError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.code === NETWORK_ERROR_CODE || err.status === 0 || err.status === 408 || err.status >= 500) return true;
  return err.status === 409 && err.code === RETRY_CONFLICT_CODE;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiClient {
  readonly base: ApiBase;
  get<T>(path: string, query?: Readonly<Record<string, QueryValue>>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

export interface ApiClientOptions {
  /** Oturum düştüğünde (401 OTURUM_YOK) çağrılır — giriş ekranına dönülür. */
  readonly onSessionLost?: () => void;
  readonly fetchImpl?: typeof fetch;
}

function queryString(query: Readonly<Record<string, QueryValue>> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function createApiClient(base: ApiBase, options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown, query?: Readonly<Record<string, QueryValue>>): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}${queryString(query)}`, {
        method,
        credentials: "same-origin",
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, NETWORK_ERROR_CODE, "Sunucuya ulaşılamadı; bağlantınızı denetleyip yeniden deneyin");
    }
    let json: { success?: boolean; data?: unknown; message?: string; details?: Record<string, unknown> } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      json = {};
    }
    if (!res.ok || json.success === false) {
      const details = json.details ?? {};
      const code = typeof details.code === "string" ? details.code : res.status >= 500 ? "SUNUCU_HATASI" : "BILINMEYEN";
      const err = new ApiError(res.status, code, json.message ?? `İstek başarısız (${res.status})`, details);
      if (res.status === 401 && code === "OTURUM_YOK") options.onSessionLost?.();
      throw err;
    }
    return json.data as T;
  }

  return {
    base,
    get: (path, query) => request("GET", path, undefined, query),
    post: (path, body) => request("POST", path, body ?? {}),
    patch: (path, body) => request("PATCH", path, body ?? {}),
  };
}

/** Kullanıcıya gösterilecek ileti (hata kodu değil, sunucunun Türkçe metni). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Beklenmeyen bir hata oluştu";
}
