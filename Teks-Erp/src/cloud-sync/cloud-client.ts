// Patron bulutuna TEL katmanı: kurulum anahtarıyla imzalı İSTEK (`amac: esitle`), gzip'li
// gövde, taşıma soyutlaması (test enjeksiyonu), hata sınıflaması. Lisans tel katmanının
// (`services/helpers/license-wire.helper`) kalıbı; imza protokolün `signRequest`inden geçer.
import { gzipSync } from "node:zlib";
import { EgressError, egressRequest } from "../lib/http-egress";
import { getLicenseStore } from "../lib/license/store";
import { REQUEST_HEADER, isoToMs, signRequest } from "../lib/license/protocol";
import { requestClockSkewMs } from "../lib/license/request-clock";
import { CloudErrorResponseSchema } from "./wire";

const CLOUD_TIMEOUT_MS = 60_000;
const RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

export interface CloudHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}
export interface CloudHttpResponse {
  readonly status: number;
  readonly body: Buffer;
}
export type CloudTransport = (req: CloudHttpRequest) => Promise<CloudHttpResponse>;

export const egressCloudTransport: CloudTransport = async (req) => {
  const res = await egressRequest(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    timeoutMs: CLOUD_TIMEOUT_MS,
    maxBytes: RESPONSE_MAX_BYTES,
  });
  return { status: res.status, body: res.body };
};

export type CloudResult =
  | { readonly ok: true; readonly json: unknown }
  /** `status` 0 = ağ hatası (beklenen; iş kaydına yazılmaz). */
  | { readonly ok: false; readonly status: number; readonly code: string };

export interface CloudCallContext {
  readonly baseUrl: string;
  readonly installationId: string;
  readonly transport: CloudTransport;
}

/** Aynı mantıksal deneme için ağ tekrarı (paket kimliği sabit, imza her denemede taze). */
const NETWORK_RETRIES = 2;

type Attempt = CloudResult | { readonly ok: false; readonly status: number; readonly code: string; readonly serverTimeMs?: number };

/** Ağ tekrarlı gönderim; imza damgası `nowMs()`ten (D4 düzeltmesinde duvar − pay). */
async function sendWithRetries(ctx: CloudCallContext, req: { url: string; raw: Buffer; gzip: boolean }, nowMs: () => number): Promise<Attempt> {
  const store = getLicenseStore();
  if (!store?.key || store.problem) return { ok: false, status: 0, code: "LISANS_DEPOSU_YOK" };
  let last: Attempt = { ok: false, status: 0, code: "EGRESS_NETWORK" };
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    const token = signRequest({ installationId: ctx.installationId, purpose: "esitle", body: req.raw, key: { privateKey: store.key.privateKey, nowMs: nowMs() } });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      [REQUEST_HEADER]: token,
      ...(req.gzip ? { "content-encoding": "gzip" } : {}),
    };
    let res: CloudHttpResponse;
    try {
      res = await ctx.transport({ url: req.url, method: "POST", headers, body: req.raw });
    } catch (err) {
      last = { ok: false, status: 0, code: err instanceof EgressError ? err.code : "EGRESS_NETWORK" };
      continue;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(res.body.toString("utf8")) as unknown;
    } catch {
      json = null;
    }
    if (res.status >= 200 && res.status < 300) return { ok: true, json };
    const err = CloudErrorResponseSchema.safeParse(json);
    const t = err.success ? err.data.details.sunucuSaati : undefined;
    last = { ok: false, status: res.status, code: err.success ? err.data.details.code : `HTTP_${res.status}`, ...(t ? { serverTimeMs: isoToMs(t) } : {}) };
    // Yalnız sonucu belirsiz bırakan hata tekrar denenir (5xx); kesin 4xx'te tekrar yok.
    if (res.status < 500) return last;
  }
  return last;
}

/**
 * İmzalı POST. `gzip` açıkken `govdeOzeti` SIKIŞTIRILMIŞ ham baytların özetidir (§6.1 — sunucu açmadan önce
 * özetler). Bulut saati kayıkken (`ISTEK_ZAMAN` + `sunucuSaati`) istek BİR KEZ düzeltilmiş damgayla, yeni nonce'la
 * yeniden imzalanır (D4, lisans kanalıyla aynı yardımcı); ikinci `ISTEK_ZAMAN`da durulur.
 */
export async function cloudPost(ctx: CloudCallContext, path: string, body: unknown, opts: { gzip: boolean }): Promise<CloudResult> {
  const text = JSON.stringify(body);
  const raw = opts.gzip ? gzipSync(Buffer.from(text, "utf8")) : Buffer.from(text, "utf8");
  const req = { url: `${ctx.baseUrl}${path}`, raw, gzip: opts.gzip };
  const first = await sendWithRetries(ctx, req, Date.now);
  if (first.ok) return first;
  const skewMs = requestClockSkewMs(first.code, "serverTimeMs" in first ? first.serverTimeMs : undefined, Date.now());
  const final = skewMs === null ? first : await sendWithRetries(ctx, req, () => Date.now() - skewMs);
  return final.ok ? final : { ok: false, status: final.status, code: final.code };
}
