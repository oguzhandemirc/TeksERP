// =============================================================================
// AĞ SERTLEŞTİRME (güvenlik denetimi Bölge 5 kapanışı) — DB'siz, HTTP'siz.
// Koşum (Teks-Erp/ içinden): npx tsx scripts/test_ag_sertlestirme.ts
//   §1 web sertleştirme varsayılanları: giriş/PIN/kart/TOTP/lisans kovası değişkensiz AÇIK (60/dk),
//      RATE_LIMIT_ENABLED=false kapatır; barındırılanda TRUST_PROXY=true açılışı durdurur.
//   §2 cihaz çözücü: eşleştirme zorunluyken DB hatasında fail-closed, muaf yol kümesi dar.
//   §3 LAN TLS: yeni kurulum required, pm2→hizmet geçişi satırsız kurulumda dual, required'da HTTP döngüde.
//   §4 panel sabiti: lan-tls-pin hostname'i karara geçirir, -2 reddi Electron vitest'inde iddialı.
//   §5 dağıtım: korumalı compose döngü varsayılanı, digest'li FROM, üst düzey CI izni yazmasız.
//   §6 olumlu iddialar (imzalı kanal nonce/saat, güncelleyici sürüm/özet kapısı).
// Her dedektör bozuk sentetik metinle in-file sondalanır (✓K); kapsam dışı maddeler yalnız ÖLÇÜ basar.
// HTTP davranışı test_web_hardening'te (61. lisans yazması 429, TRUST_PROXY=1 XFF kovaları).
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWebHardeningConfig,
  classifyRateLimitRequest,
  trustProxyHostedRefusal,
  hostedBootRefusal,
  parseTrustProxy,
} from "../src/middlewares/web-hardening";
import { readLanTlsConfig } from "../src/lib/lan-tls/config";

const KOK = join(__dirname, "..", "..");
const oku = (rel: string): string => readFileSync(join(KOK, rel), "utf8");
const sessiz = (): void => {};

let gecti = 0;
let kaldi = 0;
function check(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
}
/** Dedektör gerçek metinde geçmeli, bozuk sentetik metinde KALMALI (kör dedektör kapısızlıktır). */
function dedektor(etiket: string, d: (s: string) => boolean, gercek: string, bozuk: string): void {
  check(etiket, d(gercek));
  check(`${etiket} [sonda: bozuk metinde kırmızı]`, !d(bozuk));
}
const yorumsuz = (s: string): string => s.replace(/^\s*\/\/.*$/gm, "");

// ─── §1 web sertleştirme ───
function s1(): void {
  console.log("\n=== §1 web sertleştirme varsayılanları ===");
  const bos = readWebHardeningConfig({} as NodeJS.ProcessEnv, sessiz);
  check("§1a değişkensiz: giriş kovası AÇIK, örtük, 60/dk; yazma kovası sayılmaz",
    bos.rateLimit.enabled && bos.rateLimit.implicit && bos.rateLimit.loginMax === 60 && !bos.rateLimit.writeEnabled,
    JSON.stringify(bos.rateLimit));
  const kapali = readWebHardeningConfig({ RATE_LIMIT_ENABLED: "false" } as NodeJS.ProcessEnv, sessiz);
  check("§1b RATE_LIMIT_ENABLED=false tamamen kapatır", !kapali.rateLimit.enabled && !kapali.rateLimit.writeEnabled);
  const acik = readWebHardeningConfig({ RATE_LIMIT_ENABLED: "true" } as NodeJS.ProcessEnv, sessiz);
  check("§1c RATE_LIMIT_ENABLED=true eski açık davranış (yazma sayılır, giriş 10)",
    acik.rateLimit.enabled && acik.rateLimit.writeEnabled && !acik.rateLimit.implicit && acik.rateLimit.loginMax === 10);
  const girisKova = [
    ["POST", "/api/auth/login"], ["POST", "/api/auth/login-quick-pin"], ["POST", "/api/auth/login-card"],
    ["POST", "/api/auth/totp/enroll"], ["POST", "/api/license/activate"], ["POST", "/api/License/Poll/?x=1"],
  ] as const;
  const kacan = girisKova.filter(([m, p]) => classifyRateLimitRequest(m, p) !== "login").map(([, p]) => p);
  check("§1d giriş/PIN/kart/TOTP/lisans yazma uçları giriş kovasında", kacan.length === 0, kacan.join(", "));
  check("§1e lisans OKUMASI giriş kovasına girmez", classifyRateLimitRequest("GET", "/api/license/status") === null);
  check("§1f BARINDIRILAN + TRUST_PROXY=true → açılış reddi", trustProxyHostedRefusal(parseTrustProxy("true", sessiz), true) !== null);
  check("§1g fabrika + TRUST_PROXY=true → red yok (uyarı kalır)", trustProxyHostedRefusal(true, false) === null);
  check("§1h BARINDIRILAN + TRUST_PROXY=1 → red yok", trustProxyHostedRefusal(parseTrustProxy("1", sessiz), true) === null);
  check("§1j açılış reddi (hostedBootRefusal) TRUST_PROXY reddini kapsar", hostedBootRefusal(parseTrustProxy("true", sessiz), true) !== null);
  const serverOlc = (s: string): boolean =>
    /const hosted = isHostedInstallation\(\);\s*const red = hostedBootRefusal\(tp, hosted\);(?:[ \t]*\/\/[^\n]*)?\s*if \(red\) \{\s*hata\([^)]*\);\s*process\.exit\(1\);/.test(yorumsuz(s));
  const server = oku("Teks-Erp/src/server.ts");
  dedektor("§1i server.ts reddi açılışı durdurur (process.exit(1))", serverOlc, server,
    server.replace(/process\.exit\(1\);(\s*\}\s*if \(hosted && tp === null\))/, "/* devam */$1"));
}

// ─── §2 cihaz çözücü ───
function s2(): void {
  console.log("\n=== §2 device.middleware ===");
  const dm = oku("Teks-Erp/src/middlewares/device.middleware.ts");
  const failClosed = (s: string): boolean =>
    /if \(pairingRequired\) \{\s*res\.status\(503\)[\s\S]{0,200}DEVICE_CHECK_UNAVAILABLE[\s\S]{0,40}return;/.test(yorumsuz(s));
  dedektor("§2a eşleştirme zorunluyken DB hatası → 503 (fail-closed)", failClosed, dm,
    dm.replace("res.status(503)", "res.status(200)"));
  const muaf = (s: string): boolean => {
    const m = s.match(/const EXEMPT_PATHS = new Set\(\[([\s\S]*?)\]\)/);
    const yollar = (m?.[1] ?? "").match(/"[^"]+"/g) ?? [];
    // Eşleme v2 (D1): yerinde onay kayıtsız localId'den gelir; kimliği gövdedeki yönetici girişi taşır.
    return yollar.length === 4
      && yollar.every((y) => /^"\/api\/devices\/(announce|status|pairing-required|rebind-requests\/onsite-approve)"$/.test(y));
  };
  dedektor("§2b muaf yol kümesi yalnız announce/status/pairing-required/rebind-requests/onsite-approve", muaf, dm,
    dm.replace('"/api/devices/status",', '"/api/devices/status",\n  "/api/auth/login-quick-pin",'));
  console.log(`   ÖLÇÜ (kapsam dışı — G5-B3, 1e): cihaz kimliği başlık dışında kanıt okuyor mu: ${/proof|signature|hmac/i.test(yorumsuz(dm))}`);
}

// ─── §3 LAN TLS ───
function s3(): void {
  console.log("\n=== §3 LAN TLS ===");
  const r = readLanTlsConfig({ LICENSE_DIR: "/tmp/x", LAN_TLS_MODE: "required" } as NodeJS.ProcessEnv, "0.0.0.0", sessiz);
  check("§3a required'da şifresiz HTTP yalnız döngüde", r.mode === "required" && /^(127\.0\.0\.1|::1)$/.test(r.httpHost), r.httpHost);
  const ortak = oku("deploy/kurulum/kurulum-ortak.ps1");
  const yeniKur = (s: string): boolean => /function LanTlsYeniKurulum[\s\S]{0,300}satirlar = @\("LAN_TLS_MODE=required"\)/.test(s);
  dedektor("§3b yeni kurulum LAN_TLS_MODE=required yazar", yeniKur, ortak, ortak.replace('"LAN_TLS_MODE=required"', '"LAN_TLS_MODE=off"'));
  const gy = oku("deploy/gecis/gecis-yardimci.cjs");
  const dual = (s: string): boolean =>
    /kanalEkler\.push\("LAN_TLS_MODE=dual"\)/.test(s) && /const LAN_TLS_VARSAYILAN_PORT = 4443;/.test(s);
  dedektor("§3c pm2→hizmet geçişi satırsız kurulumda dual + HTTPS 4443 yazar", dual, gy, gy.replace('"LAN_TLS_MODE=dual"', '"LAN_TLS_MODE=off"'));
  check("§3d geçiş HTTPS portu için güvenlik duvarı kalemi taşır", /DUVAR_TLS/.test(oku("deploy/gecis/gecis.ps1")));
}

// ─── §4 panel sabiti ───
function s4(): void {
  console.log("\n=== §4 panel / tablet sertifika sabiti ===");
  const pin = oku("Electron/electron/security/lan-tls-pin.ts");
  const host = (s: string): boolean => /certVerifyDecision\(readTlsPins\(\), fingerprintOf\(request\.certificate\), request\.hostname\)/.test(yorumsuz(s));
  dedektor("§4a panel doğrulayıcısı hostname'i karara geçirir", host, pin, pin.replace(", request.hostname)", ")"));
  const vt = oku("Electron/src/test/lan-tls.test.ts");
  check("§4b Electron vitest -2 reddini yerel adreste iddia eder",
    /certVerifyDecision\(\[pin\(\)\], OTHER, host\)\)\.toBe\(-2\)/.test(vt) && /"192\.168\.1\.50"/.test(vt));
  const kt = oku("mobil/modules/teks-erp-lan-tls/android/src/main/java/com/tekserp/lantls/LanTlsPolicy.kt");
  check("§4c tablet politikası sabitli uçta REJECT", /isPinnedEndpoint\(host, port\)\s*->\s*TlsVerdict\.REJECT/.test(kt));
}

// ─── §5 dağıtım ───
function s5(): void {
  console.log("\n=== §5 dağıtım (compose / Dockerfile / workflow) ===");
  const kc = oku("Teks-Erp/docker/korumali/docker-compose.yml");
  check("§5a korumalı compose API yayını varsayılan 127.0.0.1", /"\$\{TEKSERP_DINLE:-127\.0\.0\.1\}:/.test(kc));
  const fromOlc = (s: string): boolean => {
    const f = s.split("\n").filter((l) => /^FROM\s/.test(l) && !/\bscratch\b/.test(l));
    return f.length > 0 && f.every((l) => /@sha256:[0-9a-f]{64}/.test(l));
  };
  const df = oku("Teks-Erp/docker/korumali/Dockerfile");
  dedektor("§5b korumalı Dockerfile dış FROM'ları digest'li (tam tarama: test_dagitim_sabitleme)", fromOlc, df,
    df.replace(/@sha256:[0-9a-f]{64}/, ""));
  const ustIzin = (s: string): boolean => {
    const m = s.match(/^permissions:[^\n]*\n((?:[ \t]+[^\n]*\n)*)/m);
    return !m || !/write/.test(m[0]);
  };
  const ci = oku(".github/workflows/ci.yml");
  dedektor("§5c ci.yml üst düzey permissions yazma vermez", ustIzin, ci,
    ci.replace(/^permissions:\n/m, "permissions:\n  pull-requests: write\n"));
  console.log(`   ÖLÇÜ (açık — G5-B8): korumalı compose sırları secrets:/_FILE ile mi: ${/^secrets:/m.test(kc) || /_FILE:/.test(kc)}`);
  console.log(`   ÖLÇÜ (kapsam dışı — G5-B5, 1e): korumasız compose port satırı: ${oku("Teks-Erp/docker-compose.yml").match(/^\s*-\s*"[^"]*4000:4000"/m)?.[0]?.trim() ?? "(yok)"}`);
}

// ─── §6 olumlu ───
function s6(): void {
  console.log("\n=== §6 olumlu iddialar ===");
  const sa = oku("satici/sunucu/src/services/installation-auth.ts");
  const pa = oku("patron/sunucu/src/services/installation-auth.ts");
  check("§6a satıcı nonce DB create + UNIQUE → 409 ISTEK_TEKRAR", /nonceDefteri\.create[\s\S]{0,400}isUniqueViolation[\s\S]{0,80}409, "ISTEK_TEKRAR"/.test(sa));
  check("§6b patron nonce DB create + UNIQUE → 409 ISTEK_TEKRAR", /requestNonce\.create[\s\S]{0,400}isUniqueViolation[\s\S]{0,80}409, "ISTEK_TEKRAR"/.test(pa));
  check("§6c CLOCK_SKEW_MS = 10 dk (satıcı/patron)", ["satici/sunucu", "patron/sunucu"].every((d) => /CLOCK_SKEW_MS = 10 \* 60 \* 1000/.test(oku(`${d}/src/lisans-protokol/ortak.ts`))));
  const dec = oku("Teks-Erp/native/tekserp-guncelleyici/src/decision.rs");
  const dl = oku("Teks-Erp/native/tekserp-guncelleyici/src/download.rs");
  check("§6d güncelleyici aday ≤ kurulu → SURUM_GUNCEL", /!= Ordering::Greater \{\s*return decision\(Kind::UpToDate, Some\("SURUM_GUNCEL"\)\)/.test(dec));
  check("§6e güncelleyici sha256 eşitsiz → PAKET_OZETI red", /if got != spec\.sha256_hex \{\s*let _ = env\.fs\.remove_file[\s\S]{0,60}PAKET_OZETI/.test(dl));
}

s1();
s2();
s3();
s4();
s5();
s6();
console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exitCode = kaldi === 0 ? 0 : 1;
