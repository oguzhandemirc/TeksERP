// =============================================================================
// Test: kimlik ucu ters vekil arkasında + kalıcı sunucu adı
// Çalıştır: npx tsx scripts/test_discovery_identity_vekil.ts   (DB'ye bağlanmaz)
// =============================================================================
// İddialar:
//   • Vekil yokken ya da istek güvenilmeyen kaynaktan gelirken yük BUGÜNKÜ gibidir
//     (protocol "http", apiPort dinleme portu, tls LAN ilanı) — sahte X-Forwarded-* yok sayılır.
//   • TRUST_PROXY kapsamındaki vekilden gelen istekte protocol/apiPort istemcinin gördüğüdür,
//     tls null'dur (vekilin sertifikası LAN parmak izi değildir, LAN portu vekilin adresinde yoktur).
//   • Başlık değeri doğrulanır: şema yalnız http|https, port yalnız 1–65535.
//   • serverName: TEKSERP_SUNUCU_ADI geçerliyse o, değilse makine adı.
// Gerçek router (`routes/discovery.routes.ts`) 127.0.0.1'de geçici bir Express uygulamasına
// takılır; güven ayarı app.ts ile aynı ayrıştırıcıdan (`parseTrustProxy`) geçer.
// Negatif sondalar: güven denetimi silinince §4a/§4d ❌ · şema doğrulaması silinince §1/§4e ❌ ·
// route `null` geçince §4b/§4e/§4f ❌ · vekilde tls ilanı korununca §3/§4b ❌.
// =============================================================================

import os from "os";
import express from "express";
import type { AddressInfo } from "net";
import { parseForwardedView } from "../src/lib/forwarded-view";
import { parseServerName, resolveServerName, SERVER_NAME_ENV, SERVER_NAME_MAX } from "../src/lib/server-name";
import { buildDiscoveryIdentity, __resetDiscoveryCacheForTests } from "../src/services/discovery.service";
import { __setLanTlsAdvertForTests } from "../src/lib/lan-tls/listener";
import { parseTrustProxy } from "../src/middlewares/web-hardening";
import discoveryRoutes from "../src/routes/discovery.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TLS_ADVERT = { port: 4443, fingerprint: "ab".repeat(32) };

// --- §1 başlık ayrıştırma (saf) -------------------------------------------------
function section1(): void {
  const v = (proto?: string, port?: string, host?: string) => JSON.stringify(parseForwardedView({ proto, port, host }));
  const cases: Array<[string, string, string]> = [
    ["https, port yok → 443", v("https"), '{"protocol":"https","port":443}'],
    ["http, port yok → 80", v("http"), '{"protocol":"http","port":80}'],
    ["büyük harf + boşluk", v(" HTTPS "), '{"protocol":"https","port":443}'],
    ["çok değerli → ilk değer", v("https, http"), '{"protocol":"https","port":443}'],
    ["X-Forwarded-Port 8443", v("https", "8443"), '{"protocol":"https","port":8443}'],
    ["port 0 yok sayılır", v("https", "0"), '{"protocol":"https","port":443}'],
    ["port 70000 yok sayılır", v("https", "70000"), '{"protocol":"https","port":443}'],
    ["port 'abc' yok sayılır", v("https", "abc"), '{"protocol":"https","port":443}'],
    ["port '-1' yok sayılır", v("https", "-1"), '{"protocol":"https","port":443}'],
    ["X-Forwarded-Host portu", v("https", undefined, "deneme.example.com:8443"), '{"protocol":"https","port":8443}'],
    ["X-Forwarded-Port önce gelir", v("https", "9443", "a.example.com:8443"), '{"protocol":"https","port":9443}'],
    ["[v6]:port", v("https", undefined, "[::1]:8443"), '{"protocol":"https","port":8443}'],
    ["parantezsiz v6 port sayılmaz", v("https", undefined, "::1"), '{"protocol":"https","port":443}'],
    ["şema yok → null", v(undefined, "443"), "null"],
    ["şema boş → null", v(""), "null"],
    ["şema ftp → null", v("ftp"), "null"],
    ["şema javascript → null", v("javascript"), "null"],
    ["şema 'https:' → null", v("https:"), "null"],
  ];
  for (const [label, got, want] of cases) check(`§1 ${label}`, got === want, got);
  check("§1 körlük zemini: ≥18 vaka", cases.length >= 18, String(cases.length));
}

// --- §2 sunucu adı ----------------------------------------------------------------
function section2(): void {
  const host = () => "fb24e6f515bd";
  const r = (val: string | undefined) => resolveServerName(val === undefined ? {} : { [SERVER_NAME_ENV]: val }, host);
  check("§2 değişken yok → makine adı", r(undefined) === "fb24e6f515bd", r(undefined));
  check("§2 boş → makine adı", r("") === "fb24e6f515bd");
  check("§2 yalnız boşluk → makine adı", r("   ") === "fb24e6f515bd");
  check("§2 geçerli ad (Türkçe harf, boşluk) → o ad", r("  Deneme Sunucusu-1 ") === "Deneme Sunucusu-1", r("  Deneme Sunucusu-1 "));
  check("§2 Türkçe harf", r("Şahin Dokuma") === "Şahin Dokuma");
  check(`§2 ${SERVER_NAME_MAX} karakter kabul`, r("a".repeat(SERVER_NAME_MAX)) === "a".repeat(SERVER_NAME_MAX));
  check(`§2 ${SERVER_NAME_MAX + 1} karakter → makine adı`, r("a".repeat(SERVER_NAME_MAX + 1)) === "fb24e6f515bd");
  check("§2 denetim karakteri → makine adı", r("ad\u0007") === "fb24e6f515bd");
  check("§2 satır sonu → makine adı", r("ad\nikinci") === "fb24e6f515bd");
  check("§2 HTML işareti → makine adı", r("<b>x</b>") === "fb24e6f515bd");
  check("§2 noktalama ile başlayan → makine adı", r("-ad") === "fb24e6f515bd");
  check("§2 parseServerName(undefined) null", parseServerName(undefined) === null);
  check("§2 varsayılan makine adı os.hostname()", resolveServerName({}) === os.hostname());
}

// --- §3 yük kurucu ----------------------------------------------------------------
function section3(): void {
  __resetDiscoveryCacheForTests();
  __setLanTlsAdvertForTests(TLS_ADVERT);
  const direct = buildDiscoveryIdentity();
  check("§3 vekilsiz: protocol http", direct.protocol === "http");
  check("§3 vekilsiz: apiPort dinleme portu", direct.apiPort === (Number(process.env.PORT) || 4000), String(direct.apiPort));
  check("§3 vekilsiz: tls LAN ilanı aynen", direct.tls?.fingerprint === TLS_ADVERT.fingerprint && direct.tls?.port === 4443);
  const viaProxy = buildDiscoveryIdentity({ protocol: "https", port: 443 });
  check("§3 vekilli: protocol https", viaProxy.protocol === "https");
  check("§3 vekilli: apiPort 443", viaProxy.apiPort === 443);
  check("§3 vekilli: tls null (LAN TLS açıkken bile)", viaProxy.tls === null, JSON.stringify(viaProxy.tls));
  check(
    "§3 vekilli ile vekilsiz yükün alan kümesi aynı",
    Object.keys(direct).sort().join(",") === Object.keys(viaProxy).sort().join(","),
  );
  __setLanTlsAdvertForTests(null);
}

// --- §4 gerçek router, gerçek HTTP ------------------------------------------------
type Identity = { protocol: string; apiPort: number; tls: unknown; serverName: string };

async function probe(trustProxyEnv: string | undefined, headers: Record<string, string>): Promise<Identity> {
  const app = express();
  const trust = parseTrustProxy(trustProxyEnv, () => {});
  if (trust !== null) app.set("trust proxy", trust); // app.ts ile aynı kural
  app.use("/api/discovery", discoveryRoutes);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise<void>((ok) => srv.once("listening", () => ok()));
  try {
    const { port } = srv.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/discovery/identity`, { headers });
    return (await res.json()) as Identity;
  } finally {
    await new Promise<void>((ok) => srv.close(() => ok()));
  }
}

async function section4(): Promise<void> {
  __resetDiscoveryCacheForTests();
  __setLanTlsAdvertForTests(TLS_ADVERT);
  const lanPort = Number(process.env.PORT) || 4000;
  const fake = { "X-Forwarded-Proto": "https", "X-Forwarded-Port": "443", "X-Forwarded-Host": "kotu.example.com:9999" };
  const kisa = (r: Identity) => `${r.protocol}/${r.apiPort} tls=${r.tls === null ? "null" : "var"}`;
  const isToday = (r: Identity) => r.protocol === "http" && r.apiPort === lanPort && (r.tls as { port?: number } | null)?.port === 4443;

  const a = await probe(undefined, fake);
  check("§4a TRUST_PROXY yok + sahte X-Forwarded-* → bugünkü yük", isToday(a), kisa(a));
  const a2 = await probe("false", fake);
  check("§4a TRUST_PROXY=false + sahte başlık → bugünkü yük", isToday(a2), kisa(a2));

  const b = await probe("loopback", { "X-Forwarded-Proto": "https" });
  check("§4b güvenilen vekil (loopback) + https → https/443", b.protocol === "https" && b.apiPort === 443, kisa(b));
  check("§4b güvenilen vekil → tls null", b.tls === null);
  const b1 = await probe("1", { "X-Forwarded-Proto": "https" });
  check("§4b TRUST_PROXY=1 (bulut örneği) + https → https/443", b1.protocol === "https" && b1.apiPort === 443, kisa(b1));

  const c = await probe("loopback", {});
  check("§4c güvenilen kaynak ama vekil başlığı yok → bugünkü yük", isToday(c), kisa(c));

  const d = await probe("10.0.0.0/8", fake);
  check("§4d güvenilmeyen kaynak (127.0.0.1 ∉ 10/8) + sahte başlık → bugünkü yük", isToday(d), kisa(d));

  const e = await probe("loopback", { "X-Forwarded-Proto": "gopher" });
  check("§4e güvenilen vekil + geçersiz şema → bugünkü yük", isToday(e), kisa(e));
  const e2 = await probe("loopback", { "X-Forwarded-Proto": "https", "X-Forwarded-Port": "70000" });
  check("§4e geçersiz port yok sayılır → 443", e2.protocol === "https" && e2.apiPort === 443, kisa(e2));

  const f = await probe("loopback", { "X-Forwarded-Proto": "https", "X-Forwarded-Port": "8443" });
  check("§4f X-Forwarded-Port 8443 → 8443", f.protocol === "https" && f.apiPort === 8443, kisa(f));

  const prev = process.env[SERVER_NAME_ENV];
  process.env[SERVER_NAME_ENV] = "Deneme Sunucusu";
  try {
    const g = await probe(undefined, {});
    check("§4g TEKSERP_SUNUCU_ADI uçta görünür", g.serverName === "Deneme Sunucusu", g.serverName);
  } finally {
    if (prev === undefined) delete process.env[SERVER_NAME_ENV];
    else process.env[SERVER_NAME_ENV] = prev;
  }
  const h = await probe(undefined, {});
  check("§4g ad yokken makine adı", h.serverName === os.hostname(), h.serverName);
  __setLanTlsAdvertForTests(null);
}

async function main(): Promise<void> {
  section1();
  section2();
  section3();
  await section4();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
