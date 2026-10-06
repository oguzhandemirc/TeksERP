/**
 * Bekçi (HTTP ayağı): LAN TLS dual kipinde çalışan GERÇEK sunucu (docs/design/LAN-TLS.md §5).
 *
 * Sunucu `LAN_TLS_MODE=dual` ile açılmışsa: kimlik ucu `tls` ilan eder; HTTPS dinleyicisi ilandaki parmak izli
 * sertifikayı sunar; aynı uygulama (aynı kurulum kimliği, aynı oturum belirteci) HTTPS'ten cevap verir; HSTS basılmaz;
 * HTTP aynı anda çalışmaya devam eder (eski istemci). Sunucu TLS kipinde değilse bölüm BEYANLA atlanır.
 *
 * Koşum: cd Teks-Erp && LAN_TLS_MODE=dual LAN_TLS_PORT=<boş port> LAN_TLS_DIR=<geçici> \
 *          DATABASE_URL='…_test' node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts lan_tls_http
 */
import https from "node:https";
import { createHash } from "node:crypto";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const ATLAMA = atlamaDefteri(() => fail++);
const BASE = process.env.TEST_API_URL ?? "http://localhost:4000";
const HTTP_KONTROL = 7;

interface PinnedResponse {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  fingerprint: string;
}

/** Sertifikayı kabul eder, parmak izini döner — karşılaştırma çağıranda (istemcideki sabitlemenin aynası). */
function pinnedGet(host: string, port: number, path: string, token?: string): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, port, path, method: "GET", rejectUnauthorized: false, headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (res) => {
        const der = (res.socket as import("node:tls").TLSSocket).getPeerCertificate(false).raw;
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers, fingerprint: createHash("sha256").update(der).digest("hex") }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("zaman aşımı")));
    req.end();
  });
}

async function main(): Promise<void> {
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
  if (kapi.kirmizi) {
    check("HTTP ayağı ölçülebildi", false, kapi.kirmizi);
  } else if (!kapi.token) {
    ATLAMA.atla("LAN TLS HTTP turu", kapi.atlaSebebi ?? "ölçüm yapılamadı", HTTP_KONTROL);
  } else {
    const token = kapi.token;
    const idRes = await fetch(`${BASE}/api/discovery/identity`);
    const identity = (await idRes.json()) as { installationId: string | null; tls: { port: number; fingerprint: string } | null };
    if (!identity.tls) {
      ATLAMA.atla("LAN TLS HTTP turu", "sunucu LAN_TLS_MODE=dual ile açılmamış (kimlik ucu tls=null)", HTTP_KONTROL);
    } else {
      const host = new URL(BASE).hostname;
      const { port, fingerprint } = identity.tls;
      check("§1 HTTP kimlik ucu tls ilanı taşır (dual)", /^[0-9a-f]{64}$/.test(fingerprint) && port > 0, `port ${port}`);
      const viaTls = await pinnedGet(host, port, "/api/discovery/identity");
      check("§2 HTTPS sertifikası ilandaki parmak izini taşır", viaTls.fingerprint === fingerprint);
      const tlsIdentity = JSON.parse(viaTls.body) as { installationId: string | null };
      check("§3 HTTPS'ten aynı kurulum kimliği", tlsIdentity.installationId === identity.installationId, String(tlsIdentity.installationId));
      check("§4 HTTPS'te HSTS YOK (dual'de HTTP'ye dönüş kilitlenmez)", viaTls.headers["strict-transport-security"] === undefined);
      const me = await pinnedGet(host, port, "/api/auth/me", token);
      check("§5 HTTP'de alınan oturum HTTPS'te geçerli (aynı uygulama)", me.status === 200, `status ${me.status}`);
      const anon = await pinnedGet(host, port, "/api/auth/me");
      check("§6 HTTPS'te kimliksiz istek yine 401 (kapılar aynı)", anon.status === 401, `status ${anon.status}`);
      const health = await fetch(`${BASE}/health`);
      check("§7 HTTP dinleyicisi dual'de çalışmaya devam eder (eski istemci)", health.status === 200);
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
