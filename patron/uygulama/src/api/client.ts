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

/** İndirilen dosya (dışa aktarma): ad sunucunun `Content-Disposition`ından, içerik ham bayt. */
export interface DownloadedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly data: ArrayBuffer;
}

export interface ApiClient {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  download(path: string, query?: Query): Promise<DownloadedFile>;
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

/** `attachment; filename="x.csv"` → `x.csv`; yoksa yedek ad. Yol ayırıcı ve tırnak ad dışında kalır. */
export function attachmentName(header: string | null, fallback: string): string {
  const m = header ? /filename="([^"/\\]+)"/.exec(header) : null;
  return m?.[1] ?? fallback;
}

export function createClient(opts: ClientOptions): ApiClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function send(method: string, path: string, g: { body?: unknown; query?: Query; accept: string; timeoutMs?: number }): Promise<Response> {
    const headers: Record<string, string> = { Accept: g.accept };
    const token = opts.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (g.body !== undefined) headers["Content-Type"] = "application/json";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), g.timeoutMs ?? opts.timeoutMs ?? 20_000);
    try {
      return await doFetch(`${base}/api${path}${queryString(g.query)}`, {
        method,
        headers,
        body: g.body === undefined ? undefined : JSON.stringify(g.body),
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı; bağlantınızı kontrol edin");
    } finally {
      clearTimeout(timer);
    }
  }

  async function fail(res: Response, parsed: unknown): Promise<never> {
    const err = isErrorBody(parsed)
      ? new ApiError(res.status, String(parsed.details.code ?? "BILINMIYOR"), parsed.message || "İstek reddedildi", parsed.details)
      : new ApiError(res.status >= 400 ? res.status : 502, "SUNUCU_HATASI", "Sunucudan beklenmeyen yanıt");
    if (err.status === 401) opts.onUnauthorized?.();
    throw err;
  }

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const res = await send(method, path, { body, query, accept: "application/json" });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (res.ok && typeof parsed === "object" && parsed !== null && (parsed as ApiOk<T>).success === true) {
      return (parsed as ApiOk<T>).data;
    }
    return fail(res, parsed);
  }

  /** Dosya indirme: başarıda ham bayt; hata yanıtı JSON zarfıdır (aynı `details.code` okuması). Büyük döküm için uzun süre. */
  async function download(path: string, query?: Query): Promise<DownloadedFile> {
    const res = await send("GET", path, { query, accept: "*/*", timeoutMs: 300_000 });
    if (!res.ok) return fail(res, await res.json().catch(() => null));
    let data: ArrayBuffer;
    try {
      data = await res.arrayBuffer();
    } catch {
      throw new ApiError(0, "AG_HATASI", "Dosya indirilirken bağlantı koptu; tekrar deneyin");
    }
    return { fileName: attachmentName(res.headers.get("content-disposition"), "disa-aktarma"), contentType: res.headers.get("content-type") ?? "application/octet-stream", data };
  }

  return {
    get: (path, query) => request("GET", path, undefined, query),
    post: (path, body) => request("POST", path, body ?? {}),
    patch: (path, body) => request("PATCH", path, body ?? {}),
    download,
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
