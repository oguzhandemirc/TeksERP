// Fabrikadan DIŞARI giden HTTPS istekleri (lisans yoklaması, kapı zili; ileride güncelleme
// ve eşitleme) — kurumsal proxy tek yerden. Proxy Node'un yerleşik `Agent({proxyEnv})`
// desteğiyle kurulur (yeni paket yok); ayar değişince ajan yeniden kurulur, restart gerekmez.
import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";

export type ProxySource = "panel" | "ortam" | "yok";

export interface EgressProxy {
  readonly adres: string | null;
  readonly atla: string | null;
}

export interface EgressOptions {
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Buffer;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Yanıt gövdesi tavanı; aşılırsa istek düşer. */
  readonly maxBytes?: number;
}

export interface EgressResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

/** Hata sınıfı — beklenen ağ arızasını programcı hatasından ayırmak için. */
export class EgressError extends Error {
  constructor(
    readonly code: "EGRESS_URL" | "EGRESS_PROXY_UNSUPPORTED" | "EGRESS_NETWORK" | "EGRESS_TIMEOUT" | "EGRESS_TOO_LARGE" | "EGRESS_ABORTED",
    message: string,
  ) {
    super(message);
    this.name = "EgressError";
  }
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

let panelProxy: EgressProxy = { adres: null, atla: null };
let extraCa: string | Buffer | null = null;
let agentKey = "";
let agent: https.Agent | null = null;
let plainAgent: http.Agent | null = null;

/** `https.Agent({proxyEnv})` Node ≥ 22.21 (22 hattı) / ≥ 24.5 ile gelir; eskisinde seçenek SESSİZCE yok sayılır. */
export function nodeSupportsProxyEnv(version: string = process.versions.node): boolean {
  const [major, minor] = version.split(".").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major >= 25) return true;
  if (major === 24) return minor >= 5;
  if (major === 22) return minor >= 21;
  return false;
}

function envProxy(): string | null {
  const v = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  return v && v.trim() ? v.trim() : null;
}

/** Etkin proxy: panelden girilen ayar ortam değişkenini EZER; ikisi de yoksa doğrudan. */
export function effectiveProxy(): { adres: string | null; atla: string | null; kaynak: ProxySource } {
  if (panelProxy.adres) return { adres: panelProxy.adres, atla: panelProxy.atla, kaynak: "panel" };
  const env = envProxy();
  if (env) return { adres: env, atla: process.env.NO_PROXY ?? process.env.no_proxy ?? null, kaynak: "ortam" };
  return { adres: null, atla: null, kaynak: "yok" };
}

/** Panel ayarını uygular (lisans deposu yüklenince ve ayar değişince çağrılır). */
export function setEgressProxy(proxy: EgressProxy): void {
  panelProxy = { adres: proxy.adres?.trim() || null, atla: proxy.atla?.trim() || null };
}

/** Test-only: yerel test sunucusunun öz-imzalı sertifikasını güvenilir kılar. */
export function setEgressTrustForTests(ca: string | Buffer | null): void {
  extraCa = ca;
  agentKey = "";
}

/** Kimlik bilgisini gizler — ekran ve audit yalnız ana makineyi görür. */
export function maskProxyUrl(adres: string | null): string | null {
  if (!adres) return null;
  try {
    const u = new URL(adres);
    return `${u.protocol}//${u.username ? "***@" : ""}${u.host}`;
  } catch {
    return "(biçimsiz)";
  }
}

function currentAgent(): https.Agent {
  const p = effectiveProxy();
  const key = JSON.stringify([p.adres, p.atla, extraCa ? "ca" : ""]);
  if (agent && key === agentKey) return agent;
  agent?.destroy();
  const base: https.AgentOptions = extraCa ? { ca: extraCa } : {};
  agent = p.adres
    ? new https.Agent({ ...base, proxyEnv: { HTTPS_PROXY: p.adres, HTTP_PROXY: p.adres, NO_PROXY: p.atla ?? "" } } as https.AgentOptions)
    : new https.Agent(base);
  agentKey = key;
  return agent;
}

/** Dışarı gidilebilecek adres: HTTPS; düz HTTP yalnız aynı makinedeki (geliştirme) sunucuya — hat dinlenemez. */
export function isEgressTargetAllowed(u: URL): boolean {
  return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname));
}

function resolveTarget(url: string): { u: URL; secure: boolean } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new EgressError("EGRESS_URL", "Dış adres çözülemedi");
  }
  if (!isEgressTargetAllowed(u)) throw new EgressError("EGRESS_URL", "Dış istek yalnız HTTPS olabilir");
  return { u, secure: u.protocol === "https:" };
}

function openRequest(url: string, opts: EgressOptions): Promise<IncomingMessage> {
  const { u, secure } = resolveTarget(url);
  if (secure && effectiveProxy().adres && !nodeSupportsProxyEnv()) {
    return Promise.reject(
      new EgressError("EGRESS_PROXY_UNSUPPORTED", `Bu Node sürümü (${process.version}) proxy ayarını desteklemiyor; Node 22.21+ / 24.5+ gerekir`),
    );
  }
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["content-length"] = String(Buffer.byteLength(opts.body));
    const reqOpts: https.RequestOptions = { method: opts.method, headers, signal: opts.signal };
    const req = secure
      ? https.request(u, { ...reqOpts, agent: currentAgent() })
      : http.request(u, { ...reqOpts, agent: (plainAgent ??= new http.Agent()) });
    const timer = setTimeout(() => req.destroy(new EgressError("EGRESS_TIMEOUT", "Dış istek zaman aşımına uğradı")), opts.timeoutMs);
    timer.unref();
    req.on("response", (res) => {
      clearTimeout(timer);
      resolve(res);
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      if (err instanceof EgressError) reject(err);
      else if (opts.signal?.aborted) reject(new EgressError("EGRESS_ABORTED", "Dış istek iptal edildi"));
      else reject(new EgressError("EGRESS_NETWORK", `Dış bağlantı kurulamadı (${(err as NodeJS.ErrnoException).code ?? err.name})`));
    });
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** Tek istek-yanıt; gövde belleğe alınır (tavanlı). */
export async function egressRequest(url: string, opts: EgressOptions): Promise<EgressResponse> {
  const res = await openRequest(url, opts);
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => res.destroy(new EgressError("EGRESS_TIMEOUT", "Dış yanıt zaman aşımına uğradı")), opts.timeoutMs);
    timer.unref();
    res.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        res.destroy(new EgressError("EGRESS_TOO_LARGE", "Dış yanıt izin verilenden büyük"));
        return;
      }
      chunks.push(c);
    });
    res.on("end", () => {
      clearTimeout(timer);
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
    });
    res.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof EgressError ? err : new EgressError("EGRESS_NETWORK", "Dış yanıt yarıda kesildi"));
    });
  });
}

/** Akış (SSE): yanıt başlıkları gelince döner; gövdeyi çağıran okur, `signal` ile kapatır. */
export function egressStream(url: string, opts: EgressOptions): Promise<IncomingMessage> {
  return openRequest(url, opts);
}
