// Patron bulutu HTTP istemcisi — platformdan bağımsız (uygulama + Node duman betiği aynı kodu koşar).
// Hata kodu yalnız `details.code`ten okunur; ağ/zaman aşımı/5xx "belirsiz" sayılır (işlem kimliği yapışır).
import type { ApiErrorBody, ApiOk } from "./wire";

export type ErrorKind = "AG" | "OTURUM" | "YETKI" | "CAKISMA" | "GECERSIZ" | "BULUNAMADI" | "SUNUCU";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  get kind(): ErrorKind {
    if (this.status === 0) return "AG";
    if (this.status === 401) return "OTURUM";
    if (this.status === 403) return "YETKI";
    if (this.status === 404) return "BULUNAMADI";
    if (this.status === 409) return "CAKISMA";
    if (this.status >= 500) return "SUNUCU";
    return "GECERSIZ";
  }

  /** Sonuç belirsiz mi — sunucu işledi mi bilinmiyor (aynı işlem kimliğiyle tekrar denenir). */
  get ambiguous(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface ClientOptions {
  readonly baseUrl: string;
  readonly getToken: () => string | null;
  /** 401: oturum düştü — uygulama girişe döner. */
  readonly onUnauthorized?: () => void;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export type Query = Readonly<Record<string, string | number | undefined>>;

export interface ApiClient {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

function queryString(q: Query | undefined): string {
  if (!q) return "";
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function isErrorBody(x: unknown): x is ApiErrorBody {
  if (typeof x !== "object" || x === null) return false;
  const b = x as { success?: unknown; details?: unknown };
  return b.success === false && typeof b.details === "object" && b.details !== null;
}

export function createClient(opts: ClientOptions): ApiClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = opts.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await doFetch(`${base}/api${path}${queryString(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı; bağlantınızı kontrol edin");
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (res.ok && typeof parsed === "object" && parsed !== null && (parsed as ApiOk<T>).success === true) {
      return (parsed as ApiOk<T>).data;
    }
    const err = isErrorBody(parsed)
      ? new ApiError(res.status, String(parsed.details.code ?? "BILINMIYOR"), parsed.message || "İstek reddedildi", parsed.details)
      : new ApiError(res.status >= 400 ? res.status : 502, "SUNUCU_HATASI", "Sunucudan beklenmeyen yanıt");
    if (err.status === 401) opts.onUnauthorized?.();
    throw err;
  }

  return {
    get: (path, query) => request("GET", path, undefined, query),
    post: (path, body) => request("POST", path, body ?? {}),
    patch: (path, body) => request("PATCH", path, body ?? {}),
  };
}

/** Kullanıcıya gösterilecek TR ileti. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "YETKI") return err.message || "Bu işlem için yetkiniz yok";
    return err.message;
  }
  return "Beklenmeyen bir hata oluştu";
}
