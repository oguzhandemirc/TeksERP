/**
 * Bekçi: fabrika ağında TLS — backend dilimi (docs/design/LAN-TLS.md).
 *
 * §1 kip okuma: varsayılan `off` = bugünkü davranış; tanınmayan değer `off`a düşer; `required`da HTTP döngü adresinde.
 * §2 sertifika: kendi DER kurucumuzun çıktısı Node'un X.509 okuyucusundan ve imza doğrulamasından geçer.
 * §3 depo: yok → üret · ikinci açılış aynı parmak izi · bozuk/tutarsız → kenara al + üret · okunamıyor → ÜRETME.
 * §4 dinleyici: gerçek TLS el sıkışması doğru parmak iziyle geçer, yanlış parmak iziyle düşer; `tls` ilanı yalnız dinlerken.
 * §5 bağlantı: server.ts HTTP'yi kipin adresine bağlar, doğrulama kipinde TLS kapalı; LAN TLS HSTS açmaz.
 *
 * DB'siz. Koşum: `npx tsx scripts/test_lan_tls.ts`
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import net from "node:net";
import { generateKeyPairSync, X509Certificate, createHash } from "node:crypto";
import { readLanTlsConfig, LAN_TLS_DEFAULT_PORT } from "../src/lib/lan-tls/config";
import { buildSelfSignedCertificate, certificateFingerprint, derToPem } from "../src/lib/lan-tls/x509";
import { loadOrCreateLanTlsStore, LAN_TLS_FILES, formatFingerprintGroups } from "../src/lib/lan-tls/store";
import { startLanTlsListener, stopLanTlsListener, getLanTlsAdvert } from "../src/lib/lan-tls/listener";
import { readWebHardeningConfig } from "../src/middlewares/web-hardening";
import { buildAdvertisedTxt } from "../src/lib/discovery-txt";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lan-tls-bekci-"));
const LIC = path.join(TMP, "lisans");
const baseEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({ PORT: "4000", LICENSE_DIR: LIC, ...extra }) as NodeJS.ProcessEnv;

function cfg(extra: Record<string, string> = {}) {
  const warns: string[] = [];
  const c = readLanTlsConfig(baseEnv(extra), "0.0.0.0", (m) => warns.push(m));
  return { c, warns };
}

function section1(): void {
  const def = cfg();
  check("§1 LAN_TLS_MODE verilmemiş → off (bugünkü davranış)", def.c.mode === "off", def.c.mode);
  check("§1 off'ta HTTP adresi değişmez", def.c.httpHost === "0.0.0.0", def.c.httpHost);
  check("§1 varsayılan TLS portu 4443", def.c.port === LAN_TLS_DEFAULT_PORT && LAN_TLS_DEFAULT_PORT === 4443);
  check("§1 varsayılan depo <LICENSE_DIR>/lan-tls", def.c.dir === path.join(LIC, "lan-tls"), String(def.c.dir));

  const dual = cfg({ LAN_TLS_MODE: "dual" });
  check("§1 dual → HTTP LAN'da kalır", dual.c.mode === "dual" && dual.c.httpHost === "0.0.0.0");
  const req = cfg({ LAN_TLS_MODE: "zorunlu" });
  check("§1 zorunlu (required) → HTTP yalnız 127.0.0.1", req.c.mode === "required" && req.c.httpHost === "127.0.0.1", req.c.httpHost);

  const typo = cfg({ LAN_TLS_MODE: "requred" });
  check("§1 tanınmayan kip → off + uyarı", typo.c.mode === "off" && typo.c.httpHost === "0.0.0.0" && typo.warns.length === 1, typo.warns.join(" | "));
  const badPort = cfg({ LAN_TLS_MODE: "dual", LAN_TLS_PORT: "99999" });
  check("§1 geçersiz port → varsayılan + uyarı", badPort.c.port === 4443 && badPort.warns.length === 1);
  const clash = cfg({ LAN_TLS_MODE: "required", LAN_TLS_PORT: "4000" });
  check("§1 HTTP portuyla çakışan TLS portu → off (HTTP LAN'dan kopmaz)", clash.c.mode === "off" && clash.c.httpHost === "0.0.0.0");
  const custom = cfg({ LAN_TLS_DIR: path.join(TMP, "ozel") });
  check("§1 LAN_TLS_DIR açıkça verilirse o kullanılır", custom.c.dir === path.join(TMP, "ozel"));
  const inApp = readLanTlsConfig({ PORT: "4000", LICENSE_DIR: process.cwd() } as NodeJS.ProcessEnv, "0.0.0.0", () => {});
  check("§1 lisans dizini program içindeyse depo YOK (güncelleyici silerdi)", inApp.dir === null && !!inApp.dirProblem, String(inApp.dirProblem));
}

function section2(): void {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = new Date("2026-10-06T00:00:00Z");
  const der = buildSelfSignedCertificate({
    privateKey,
    commonName: "TeksERP BEKCI",
    altNames: ["BEKCI-PC", "localhost", "127.0.0.1", "kötü ad"],
    notBefore: now,
    notAfter: new Date("2060-01-01T00:00:00Z"),
  });
  const cert = new X509Certificate(der);
  check("§2 sertifika X.509 okuyucusundan geçer ve kendi imzası doğrulanır", cert.verify(publicKey));
  check("§2 SAN: ad + localhost + 127.0.0.1, ASCII olmayan ad atılır",
    cert.subjectAltName === "DNS:BEKCI-PC, DNS:localhost, IP Address:127.0.0.1", String(cert.subjectAltName));
  check("§2 2050 sonrası bitiş (GeneralizedTime) doğru okunur", new Date(cert.validTo).getUTCFullYear() === 2060, cert.validTo);
  check("§2 CA değil", cert.ca === false);
  const fp = certificateFingerprint(der);
  check("§2 parmak izi = DER SHA-256 = Node fingerprint256", fp === cert.fingerprint256.replace(/:/g, "").toLowerCase() && /^[0-9a-f]{64}$/.test(fp));
  check("§2 PEM gidiş-dönüş aynı DER", new X509Certificate(derToPem(der)).raw.equals(der));
  let threw = false;
  try {
    const ed = generateKeyPairSync("ed25519").privateKey;
    buildSelfSignedCertificate({ privateKey: ed, commonName: "x", altNames: [], notBefore: now, notAfter: now });
  } catch {
    threw = true;
  }
  check("§2 P-256 dışı anahtar REDDEDİLİR (Chromium Ed25519 sertifikayı kabul etmez)", threw);
  check("§2 gözle karşılaştırma biçimi 16×4", formatFingerprintGroups(fp).split(" ").length === 16);
}

function section3(): void {
  const dir = path.join(TMP, "depo");
  const first = loadOrCreateLanTlsStore(dir);
  check("§3 dosya yok → üretildi", first.ok && first.generated && first.setAside.length === 0);
  if (!first.ok) return;
  const keyFile = path.join(dir, LAN_TLS_FILES.KEY);
  const certFile = path.join(dir, LAN_TLS_FILES.CERT);
  if (process.platform !== "win32") {
    check("§3 özel anahtar 0600", (fs.statSync(keyFile).mode & 0o777) === 0o600, (fs.statSync(keyFile).mode & 0o777).toString(8));
  }
  const second = loadOrCreateLanTlsStore(dir);
  check("§3 ikinci açılış AYNI parmak izi, üretim yok", second.ok && !second.generated && second.fingerprint === first.fingerprint);

  // Tutarsız çift: başka anahtarın sertifikası.
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  fs.writeFileSync(certFile, derToPem(buildSelfSignedCertificate({
    privateKey: other, commonName: "yabancı", altNames: [], notBefore: new Date(), notAfter: new Date(Date.now() + 864e5),
  })));
  const mismatch = loadOrCreateLanTlsStore(dir);
  check("§3 anahtar/sertifika uyuşmuyor → ikisi kenara, yeni parmak izi",
    mismatch.ok && mismatch.generated && mismatch.setAside.length === 2 && mismatch.fingerprint !== first.fingerprint);

  fs.writeFileSync(certFile, "bozuk");
  const corrupt = loadOrCreateLanTlsStore(dir);
  check("§3 bozuk sertifika → kenara + üret", corrupt.ok && corrupt.generated && corrupt.setAside.some((f) => f.includes(".bozuk-")));

  // Okunamıyor: anahtarın yerinde dizin var — üretilmez, mevcut dosyaya dokunulmaz.
  const blocked = path.join(TMP, "okunamaz");
  fs.mkdirSync(path.join(blocked, LAN_TLS_FILES.KEY), { recursive: true });
  const unreadable = loadOrCreateLanTlsStore(blocked);
  check("§3 okunamayan anahtar → ÜRETİLMEZ", !unreadable.ok && !fs.existsSync(path.join(blocked, LAN_TLS_FILES.CERT)),
    unreadable.ok ? "üretti" : unreadable.problem);
}

function handshake(port: number, expectFp: string): Promise<{ ok: boolean; body: string; err: string }> {
  return new Promise((resolve) => {
    const sock = tls.connect({
      host: "127.0.0.1",
      port,
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    });
    let body = "";
    sock.once("secureConnect", () => {
      const der = sock.getPeerCertificate(false).raw;
      const fp = createHash("sha256").update(der).digest("hex");
      if (fp !== expectFp) {
        sock.destroy();
        resolve({ ok: false, body: "", err: "PIN_MISMATCH" });
        return;
      }
      sock.write("GET /x HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    sock.on("data", (c) => (body += c.toString()));
    sock.on("end", () => resolve({ ok: true, body, err: "" }));
    sock.on("error", (e) => resolve({ ok: false, body, err: e.message }));
  });
}

async function section4(): Promise<void> {
  const logs: string[] = [];
  const log = { info: (m: string) => logs.push(`i:${m}`), warn: (m: string) => logs.push(`w:${m}`), error: (m: string) => logs.push(`e:${m}`) };
  const app = (_req: unknown, res: { end: (s: string) => void }) => res.end("merhaba-tls");

  const offCfg = { ...cfg().c, port: 0 };
  check("§4 off → dinleyici açılmaz, ilan yok", startLanTlsListener(app as never, offCfg, "127.0.0.1", log) === null && getLanTlsAdvert() === null);

  const dualCfg = { ...cfg({ LAN_TLS_MODE: "dual", LAN_TLS_DIR: path.join(TMP, "dinleyici") }).c, port: 0 };
  const srv = startLanTlsListener(app as never, dualCfg, "127.0.0.1", log);
  check("§4 dual → HTTPS dinleyici", srv !== null);
  check("§4 dinleme başlamadan ilan YOK (kapalı portu duyurmaz)", getLanTlsAdvert() === null);
  if (!srv) return;
  await new Promise<void>((r) => (srv.listening ? r() : srv.once("listening", () => r())));
  const advert = getLanTlsAdvert();
  check("§4 ilan dinlerken dolu (gerçek port + parmak izi)", !!advert && advert.port > 0 && /^[0-9a-f]{64}$/.test(advert.fingerprint));
  if (!advert) return;
  const good = await handshake(advert.port, advert.fingerprint);
  check("§4 sunulan sertifika ilandaki parmak izini taşır + aynı uygulama yanıtı", good.ok && good.body.includes("merhaba-tls"), good.err);
  const stored = loadOrCreateLanTlsStore(path.join(TMP, "dinleyici"));
  check("§4 ilandaki parmak izi depodaki sertifikanınki", stored.ok && stored.fingerprint === advert.fingerprint);
  const strict = await new Promise<string>((resolve) => {
    const s = tls.connect({ host: "127.0.0.1", port: advert.port }, () => { s.destroy(); resolve("KABUL"); });
    s.on("error", (e) => resolve((e as NodeJS.ErrnoException).code ?? e.message));
  });
  check("§4 sabitsiz varsayılan doğrulama kendinden imzalıyı REDDEDER", strict !== "KABUL", strict);
  stopLanTlsListener();
  check("§4 durunca ilan boşalır", getLanTlsAdvert() === null);

  // Port dolu: dinleyici hata verir, ilan doğmaz, süreç düşmez.
  const blocker = net.createServer().listen(0, "127.0.0.1");
  await new Promise<void>((r) => blocker.once("listening", () => r()));
  const busyPort = (blocker.address() as net.AddressInfo).port;
  const busy = startLanTlsListener(app as never, { ...dualCfg, port: busyPort }, "127.0.0.1", log);
  await new Promise<void>((r) => busy?.once("error", () => r()) ?? r());
  check("§4 port doluyken ilan YOK + hata log'u", getLanTlsAdvert() === null && logs.some((l) => l.includes("açılamadı")));
  stopLanTlsListener();
  blocker.close();

  const broken = { ...dualCfg, dir: null, dirProblem: "deneme" };
  const none = startLanTlsListener(app as never, broken, "127.0.0.1", log);
  check("§4 depo yoksa dinleyici açılmaz + hata log'u", none === null && logs.some((l) => l.startsWith("e:TLS deposu")));
}

function section5(): void {
  const src = fs.readFileSync(path.resolve(__dirname, "../src/server.ts"), "utf8");
  check("§5 HTTP dinleyici kipin adresine bağlanır (HOST = LAN_TLS.httpHost)", /const HOST = LAN_TLS\.httpHost;/.test(src));
  check("§5 app.listen HOST ile", /app\.listen\(Number\(PORT\), HOST,/.test(src));
  check("§5 doğrulama kipinde TLS kapalı", /readLanTlsConfig\(VERIFYING \? \{ \.\.\.process\.env, LAN_TLS_MODE: "off" \}/.test(src));
  check("§5 kapanışta TLS dinleyicisi de kapanır", /stopLanTlsListener\(\);\s*\n\s*server\.close\(/.test(src));
  const base = { discoveryVersion: 1, installationId: null, serverName: "S", companyName: "C", version: "1", apiBasePath: "/api" };
  check("§5 mDNS TXT: TLS yokken `tp` HİÇ konmaz", !("tp" in buildAdvertisedTxt(base)));
  check("§5 mDNS TXT: TLS varken `tp` = port", buildAdvertisedTxt({ ...base, tlsPort: 4443 }).tp === "4443");
  const wh = readWebHardeningConfig({ LAN_TLS_MODE: "required" } as NodeJS.ProcessEnv, () => {});
  check("§5 LAN TLS HSTS açmaz (HTTPS_ENABLED'den bağımsız)", wh.httpsEnabled === false);
  const whSrc = fs.readFileSync(path.resolve(__dirname, "../src/middlewares/web-hardening.ts"), "utf8");
  check("§5 web sertleştirmesi LAN_TLS_* okumaz", !/LAN_TLS/.test(whSrc));
}

async function main(): Promise<void> {
  try {
    section1();
    section2();
    section3();
    await section4();
    section5();
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
