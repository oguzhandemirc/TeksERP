/**
 * Aday doğrulama — keşif sonucuna ASLA tek başına güvenilmez.
 *
 * mDNS kaydı ölü olabilir (sunucu hard-kill edildi, goodbye paketi gitmedi ve
 * kayıt ~120 sn yaşıyor), tarama başka bir servisi yakalamış olabilir. Gerçek
 * karar HTTP'den gelir.
 *
 * ⚠️ ESKİ BACKEND DESTEĞİ: kimlik ucu 404 verirse `/health`e düşer. Oradan
 * `status:"UP"` alırsak aday GERÇEKTİR — yalnız kimliği yoktur. Bu bir
 * uyuşmazlık DEĞİLDİR ve kullanıcıya "farklı sunucu" diye sorulmaz.
 *
 * `node:http` kullanılıyor: axios main process'te yok ve tek bir GET için
 * bağımlılık eklemeye değmez.
 */
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import type { TLSSocket } from "node:tls";
import {
  DISCOVERY_IDENTITY_PATH,
  parseIdentityPayload,
  type ServerIdentity,
} from "../../shared/discovery.js";
import { parseTlsAdvert, type TlsAdvert } from "../../shared/lan-tls.js";

export interface ProbeResult {
  identity: ServerIdentity | null;
  rttMs: number;
  /** Sunucunun keşif yükündeki TLS ilanı (güven kaynağı DEĞİL). */
  tls: TlsAdvert | null;
  /** https probunda el sıkışmada GÖZLENEN sertifikanın parmak izi; http'de null. Kararı çağıran verir. */
  observedFingerprint: string | null;
}

interface RawResponse {
  status: number;
  body: string;
  observedFingerprint: string | null;
}

/**
 * https probu sertifikayı KABUL EDER ve parmak izini gözlem olarak döner: kendinden imzalı sertifika
 * zincirle doğrulanamaz, güven kararı sabitle karşılaştırmadadır (docs/design/LAN-TLS.md §6).
 */
function requestFor(url: string, timeoutMs: number, strictTls: boolean, onRes: (res: http.IncomingMessage) => void): http.ClientRequest {
  if (!url.startsWith("https:")) return http.get(url, { timeout: timeoutMs }, onRes);
  // strictTls: internet kipi — zincir + ad doğrulaması (genel CA); sabitli kipte gözlem için kabul edilir.
  return https.get(url, { timeout: timeoutMs, rejectUnauthorized: strictTls }, onRes);
}

function peerFingerprint(res: http.IncomingMessage): string | null {
  const sock = res.socket as TLSSocket | null;
  if (!sock || typeof sock.getPeerCertificate !== "function") return null;
  const raw = sock.getPeerCertificate(false)?.raw;
  return raw ? createHash("sha256").update(raw).digest("hex") : null;
}

/** Tek GET. Asla throw etmez; ulaşılamazsa null. */
function get(url: string, timeoutMs: number, strictTls = false): Promise<RawResponse | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: RawResponse | null): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      const req = requestFor(url, timeoutMs, strictTls, (res) => {
        const observedFingerprint = peerFingerprint(res);
        const chunks: Buffer[] = [];
        // Kötü niyetli/yanlış bir servis sonsuz gövde akıtabilir — 64 KB'de kes.
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > 64 * 1024) {
            req.destroy();
            done(null);
            return;
          }
          chunks.push(c);
        });
        res.on("end", () =>
          done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), observedFingerprint }),
        );
        res.on("error", () => done(null));
      });
      req.on("timeout", () => {
        req.destroy();
        done(null);
      });
      req.on("error", () => done(null));
    } catch {
      done(null);
    }
  });
}

/**
 * Adayı doğrular.
 *  • kimlik ucu 200 → `{ identity }`
 *  • kimlik ucu 404 ama `/health` UP → `{ identity: null }` (ESKİ BACKEND, geçerli aday)
 *  • başka her şey → null (aday değil)
 *
 * ⚠️ `requireIdentity` — YEDEK PORTLARDA `/health` YOLU KAPALI. `{"status":"UP"}`
 * TeksERP'e özgü bir gövde değildir (Spring Boot Actuator birebir aynısını
 * basar); varsayılan portta bu riski "eski backend'i kaybetmemek" için
 * alıyoruz, 5000/3000/8080'de almıyoruz — o portlar kimlik ucuyla BİRLİKTE
 * tarama kapsamına girdi, orada eski backend vakası YOK. Kararı çağıran
 * vermez, `identityRequiredForPort` verir (tek kaynak).
 */
export async function probeIdentity(
  baseUrl: string,
  timeoutMs = 2000,
  opts: { requireIdentity?: boolean; strictTls?: boolean } = {},
): Promise<ProbeResult | null> {
  const started = Date.now();
  const root = baseUrl.replace(/\/+$/, "");

  const res = await get(`${root}${DISCOVERY_IDENTITY_PATH}`, timeoutMs, opts.strictTls === true);
  if (res && res.status === 200) {
    try {
      const body = JSON.parse(res.body) as { tls?: unknown } | null;
      const identity = parseIdentityPayload(body);
      if (identity) {
        return {
          identity,
          rttMs: Date.now() - started,
          tls: parseTlsAdvert(body?.tls),
          observedFingerprint: res.observedFingerprint,
        };
      }
    } catch {
      /* gövde JSON değil → aşağıdaki /health yoluna düş */
    }
  }

  // Eski backend (uç yok) ya da yanıt bozuk: canlılık ucuyla teyit et.
  if (opts.requireIdentity) return null;
  const health = await get(`${root}/health`, timeoutMs, opts.strictTls === true);
  if (!health || health.status !== 200) return null;
  try {
    const parsed = JSON.parse(health.body) as { status?: unknown };
    if (parsed?.status !== "UP") return null;
  } catch {
    return null;
  }
  return { identity: null, rttMs: Date.now() - started, tls: null, observedFingerprint: health.observedFingerprint };
}
