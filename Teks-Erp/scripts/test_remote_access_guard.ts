// =============================================================================
// Test: UZAKTAN ERİŞİM KAPISI (Cloudflare Tunnel + Access) — 2026-09-01
// Çalıştır: npx tsx scripts/test_remote_access_guard.ts
// =============================================================================
// ⭐ ASIL İDDİA — LAN YOLU DEĞİŞMEDİ. Bu paketin tamamı fabrikaya SIFIR-FARK
// vaadi üzerine kurulu: `REMOTE_PORT` yokken tek satır davranış değişmemeli,
// `REMOTE_PORT` VARKEN de LAN dinleyicisi (0.0.0.0:PORT) bugünküyle aynı
// kalmalı. Bu yüzden ölçümün merkezi "uzak yolda ne oluyor" değil, **aynı
// süreçte LAN portuna gelen isteğin etkilenmediğidir**.
//
// Bu, bekçinin en kolay kaybedilen özelliği: yalnız uzak yolu test etmek
// vakumen yeşil kalır (uzak yol zaten yeni kod). Negatif taraf olmadan bu dosya
// hiçbir şey kanıtlamaz.
//
// ÖLÇÜM GERÇEK SÜREÇTE. `app.ts` modül yüklenme anında ortamı okur; env'i
// process içinde değiştirip yeniden import etmek "app.ts nasıl kurulmuş"u değil
// "test ne kurmuş"u ölçerdi. Bu yüzden aynı dosya `--serve` bayrağıyla kendini
// sunucu olarak çalıştırır ve parent onu FARKLI env ile spawn eder
// (`test_web_hardening.ts` deseninin aynısı).
//
// KÖRLÜK ZEMİNİ: her bölümün alt sınırı var. Bir refactor sondaları boşa
// düşürürse "ihlal bulunamadı" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın.
// =============================================================================

import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { createServer } from "net";
import type { AddressInfo } from "net";
import type { Express, Request } from "express";
import {
  isRemoteDeniedPath,
  isRemoteRequest,
  readRemoteAccessConfig,
} from "../src/middlewares/remote-access.middleware";
import {
  readWebHardeningConfig,
  resolveClientIp,
  resolveRateLimitKey,
} from "../src/middlewares/web-hardening";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const silent = (): void => {};
/** Sahte istek — yalnız bu bekçinin okuduğu alanlar doldurulur.
 *  Soket, gerçek `net.Socket` değil; `localPort` tek ilgilendiğimiz alan. */
const fakeReq = (over: Record<string, unknown>): Request =>
  ({ headers: {}, ...over }) as unknown as Request;

// -----------------------------------------------------------------------------
// 1) YAPILANDIRMA — eksik ayar = KAPALI, "yarı açık" değil
// -----------------------------------------------------------------------------
function sectionConfig(): void {
  console.log("\n[1] Yapılandırma çözümleyicisi");

  const off = readRemoteAccessConfig({}, silent);
  check("REMOTE_PORT yok → uzaktan erişim KAPALI", off.remotePort === null);

  // ⭐ En kritik kural: kimlik duvarı olmadan tünel dinleyicisi AÇILMAZ.
  const noAccess = readRemoteAccessConfig({ REMOTE_PORT: "4001" }, silent);
  check(
    "REMOTE_PORT var ama CF_ACCESS_* yok → KAPALI (kimlik duvarsız tünel açılmaz)",
    noAccess.remotePort === null,
  );

  const partial = readRemoteAccessConfig(
    { REMOTE_PORT: "4001", CF_ACCESS_TEAM_DOMAIN: "firma.cloudflareaccess.com" },
    silent,
  );
  check("CF_ACCESS_AUD eksik → yine KAPALI", partial.remotePort === null);

  const full = readRemoteAccessConfig(
    {
      REMOTE_PORT: "4001",
      CF_ACCESS_TEAM_DOMAIN: "https://firma.cloudflareaccess.com/",
      CF_ACCESS_AUD: "abc123",
    },
    silent,
  );
  check("Üçü de verildi → AÇIK", full.remotePort === 4001);
  check(
    "Team domain şemadan/eğik çizgiden arındırılır",
    full.accessTeamDomain === "firma.cloudflareaccess.com",
    String(full.accessTeamDomain),
  );

  const clash = readRemoteAccessConfig(
    { PORT: "4000", REMOTE_PORT: "4000", CF_ACCESS_TEAM_DOMAIN: "a.b", CF_ACCESS_AUD: "x" },
    silent,
  );
  check("REMOTE_PORT === PORT → KAPALI (ayrım çökerdi)", clash.remotePort === null);

  const bad = readRemoteAccessConfig(
    { REMOTE_PORT: "abc", CF_ACCESS_TEAM_DOMAIN: "a.b", CF_ACCESS_AUD: "x" },
    silent,
  );
  check("Geçersiz REMOTE_PORT → KAPALI", bad.remotePort === null);
}

// -----------------------------------------------------------------------------
// 2) UZAKLIK SOKETTEN ÇÖZÜLÜR — başlıktan/gövdeden DEĞİL
// -----------------------------------------------------------------------------
function sectionRemoteDetection(): void {
  console.log("\n[2] Uzaklık tespiti (soket portu)");

  check(
    "localPort === REMOTE_PORT → uzak",
    isRemoteRequest(fakeReq({ socket: { localPort: 4001 } }), 4001),
  );
  check(
    "localPort === PORT (LAN) → uzak DEĞİL",
    !isRemoteRequest(fakeReq({ socket: { localPort: 4000 } }), 4001),
  );
  check(
    "uzaktan erişim kapalıyken (null) hiçbir istek uzak sayılmaz",
    !isRemoteRequest(fakeReq({ socket: { localPort: 4001 } }), null),
  );
  // ⭐ Fail-closed yönü: bilinmeyen taşıma LAN sayılır, çünkü LAN kuralları DAHA DAR.
  check(
    "soket yok → uzak DEĞİL (fail-closed yönü)",
    !isRemoteRequest(fakeReq({}), 4001),
  );
  // ⭐ Başlıkla uydurulamaz: bu, tüm tasarımın dayandığı iddia.
  check(
    "başlıklar uzaklığı ETKİLEMEZ",
    !isRemoteRequest(
      fakeReq({
        socket: { localPort: 4000 },
        headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "1.2.3.4" },
      }),
      4001,
    ),
  );
}

// -----------------------------------------------------------------------------
// 3) DENYLIST — uzakta kapalı yollar
// -----------------------------------------------------------------------------
const MUST_DENY = [
  "/api/auth/login-quick-pin",
  "/api/auth/login-card",
  "/api/auth/mobile-users",
  "/api/devices/announce",
  "/api/devices/status",
  "/api/discovery/identity",
  "/api/mobile/updates/manifest",
  "/api-docs",
  "/api-docs/swagger-ui.css",
];
const MUST_ALLOW = [
  "/api/auth/login",
  "/api/auth/login-methods",
  "/api/auth/totp/enroll",
  "/api/rolls",
  "/api/orders",
  "/api/client-policy/web",
  "/health",
];

function sectionDenylist(): void {
  console.log("\n[3] Uzakta kapalı yollar");
  check("körlük zemini: sonda sayısı", MUST_DENY.length >= 9 && MUST_ALLOW.length >= 7);

  for (const p of MUST_DENY) check(`kapalı: ${p}`, isRemoteDeniedPath(p));
  for (const p of MUST_ALLOW) check(`açık: ${p}`, !isRemoteDeniedPath(p));

  // Sorgu dizesi ve büyük harf yolu atlatmamalı.
  check(
    "sorgu dizesi denylist'i atlatamaz",
    isRemoteDeniedPath("/api/auth/login-quick-pin?x=1"),
  );
  check("büyük harf denylist'i atlatamaz", isRemoteDeniedPath("/API/DEVICES/announce"));
  // ⭐ Ön ek eşleşmesi KELİME sınırında olmalı: "/api/devices" kapalı ama
  // "/api/devices-report" gibi bir uç ileride açılırsa sessizce kapanmasın.
  check(
    "ön ek yalnız yol sınırında eşleşir",
    !isRemoteDeniedPath("/api/devicesreport"),
  );
}

// -----------------------------------------------------------------------------
// 4) İSTEMCİ IP BAŞLIĞI — karışık modda YALNIZ uzakta güvenilir
// -----------------------------------------------------------------------------
function sectionClientIp(): void {
  console.log("\n[4] İstemci IP başlığı güveni");

  const H = "cf-connecting-ip";
  const lanReq = fakeReq({
    ip: "192.168.1.44",
    isRemote: false,
    headers: { [H]: "9.9.9.9" },
  });
  const remoteReq = fakeReq({
    ip: "127.0.0.1",
    isRemote: true,
    headers: { [H]: "9.9.9.9" },
  });

  // Eski davranış (uzaktan erişim KAPALI): başlık her yerde okunur.
  check(
    "remoteOnly=false → LAN'da da başlık okunur (demo kurulumunun bugünkü davranışı)",
    resolveClientIp(lanReq, H, false) === "9.9.9.9",
  );

  // ⭐ ASIL AÇIK: karışık modda LAN'daki biri başlığı uydurup kilidi atlayabilirdi.
  check(
    "remoteOnly=true → LAN'da başlık YOK SAYILIR (uydurma engellenir)",
    resolveClientIp(lanReq, H, true) === "192.168.1.44",
    String(resolveClientIp(lanReq, H, true)),
  );
  check(
    "remoteOnly=true → uzakta başlık OKUNUR (gerçek ziyaretçi IP'si)",
    resolveClientIp(remoteReq, H, true) === "9.9.9.9",
  );

  // Hız sınırı anahtarı aynı kaynaktan beslenmeli — ayrışırsa iki koruma
  // farklı kişileri sınırlar.
  check(
    "hız sınırı anahtarı da aynı kuralı uygular",
    resolveRateLimitKey(lanReq, "login", H, true) === "login|192.168.1.44" &&
      resolveRateLimitKey(remoteReq, "login", H, true) === "login|9.9.9.9",
  );

  // Bayrak REMOTE_PORT'tan türetilir.
  check(
    "REMOTE_PORT yok → clientIpHeaderRemoteOnly false (davranış değişmez)",
    readWebHardeningConfig({ NODE_ENV: "development" }, silent).clientIpHeaderRemoteOnly ===
      false,
  );
  check(
    "REMOTE_PORT var → clientIpHeaderRemoteOnly true",
    readWebHardeningConfig(
      { NODE_ENV: "development", REMOTE_PORT: "4001" },
      silent,
    ).clientIpHeaderRemoteOnly === true,
  );
}

// -----------------------------------------------------------------------------
// 5) UÇTAN UCA — aynı süreç, iki port, farklı davranış
// -----------------------------------------------------------------------------
type Spawned = { child: ChildProcess; lan: number; remote: number };

/**
 * Boşta bir TCP portu bul.
 *
 * ⚠️ `REMOTE_PORT=0` YAZILAMAZ: `app.ts` uzak portu ortamdan MODÜL YÜKLENİRKEN
 * okur ve `markRemote` onu soket portuyla karşılaştırır. 0 verilirse çözümleyici
 * onu geçersiz sayar (kapalı) — yani bekçi hiçbir şey ölçmezdi. Bu yüzden port
 * ÖNCEDEN seçilip hem env'e hem `listen`e AYNI değer verilir.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function spawnApp(env: Record<string, string>): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", __filename, "--serve"],
      {
        cwd: join(__dirname, ".."),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buf = "";
    let errBuf = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`sunucu 60sn'de hazır olmadı. stderr: ${errBuf.slice(-500)}`));
    }, 60_000);
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/READY (\d+) (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, lan: Number(m[1]), remote: Number(m[2]) });
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      errBuf += d.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`çocuk süreç ${code} ile çıktı. stderr: ${errBuf.slice(-500)}`));
    });
    child.on("error", reject);
  });
}

async function probe(
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, headers: res.headers };
}

async function sectionEndToEnd(): Promise<void> {
  console.log("\n[5] Uçtan uca — aynı süreç, iki dinleyici");

  let s: Spawned | null = null;
  try {
    const remotePort = await freePort();
    s = await spawnApp({
      NODE_ENV: "development",
      REMOTE_PORT: String(remotePort),
      CF_ACCESS_TEAM_DOMAIN: "sonda.cloudflareaccess.com",
      CF_ACCESS_AUD: "sonda-aud",
    });
  } catch (err) {
    check("sunucu ayağa kalktı", false, err instanceof Error ? err.message : String(err));
    return;
  }
  const { child, lan, remote } = s;
  check("iki dinleyici ayrı portta", lan !== remote, `lan=${lan} remote=${remote}`);

  try {
    // ── 5a) DENYLIST ────────────────────────────────────────────────────────
    const lanPin = await probe(lan, "/api/auth/login-quick-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    const remotePin = await probe(remote, "/api/auth/login-quick-pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    // ⭐ NEGATİF TARAF: LAN'da uç HÂLÂ ULAŞILABİLİR (401/403 olabilir ama 404 DEĞİL).
    check(
      "LAN: PIN girişi hâlâ ulaşılabilir (404 DEĞİL)",
      lanPin.status !== 404,
      `status=${lanPin.status}`,
    );
    check("UZAK: PIN girişi 404", remotePin.status === 404, `status=${remotePin.status}`);

    const lanDev = await probe(lan, "/api/devices/status");
    const remoteDev = await probe(remote, "/api/devices/status");
    check("LAN: cihaz ucu ulaşılabilir", lanDev.status !== 404, `status=${lanDev.status}`);
    check("UZAK: cihaz ucu 404", remoteDev.status === 404, `status=${remoteDev.status}`);

    // ── 5b) ACCESS JWT — fail-closed ───────────────────────────────────────
    const remoteApi = await probe(remote, "/api/auth/login-methods");
    check(
      "UZAK: Access başlığı yokken /api 403 (FAIL-CLOSED)",
      remoteApi.status === 403,
      `status=${remoteApi.status}`,
    );
    const remoteBadJwt = await probe(remote, "/api/auth/login-methods", {
      headers: { "cf-access-jwt-assertion": "gecersiz.token.dizisi" },
    });
    check(
      "UZAK: geçersiz Access JWT → 403",
      remoteBadJwt.status === 403,
      `status=${remoteBadJwt.status}`,
    );
    // ⭐ NEGATİF TARAF: aynı uç LAN'da Access başlığı OLMADAN çalışmaya devam eder.
    const lanApi = await probe(lan, "/api/auth/login-methods");
    check(
      "LAN: aynı uç Access başlığı olmadan ÇALIŞIR (200)",
      lanApi.status === 200,
      `status=${lanApi.status}`,
    );

    // ── 5c) GÜVENLİK BAŞLIKLARI — LAN'a HSTS/CSP-upgrade SIZMAZ ────────────
    const lanRoot = await probe(lan, "/health");
    const remoteRoot = await probe(remote, "/health");
    const lanHsts = lanRoot.headers.get("strict-transport-security");
    const remoteHsts = remoteRoot.headers.get("strict-transport-security");
    check("LAN: HSTS başlığı YOK", lanHsts === null, String(lanHsts));
    check("UZAK: HSTS başlığı VAR", remoteHsts !== null, String(remoteHsts));

    const lanCsp = lanRoot.headers.get("content-security-policy") ?? "";
    const remoteCsp = remoteRoot.headers.get("content-security-policy") ?? "";
    check(
      "LAN: CSP upgrade-insecure-requests YOK (panel kırılmaz)",
      !lanCsp.includes("upgrade-insecure-requests"),
    );
    check(
      "UZAK: CSP upgrade-insecure-requests VAR",
      remoteCsp.includes("upgrade-insecure-requests"),
    );
    check("körlük zemini: CSP başlığı gerçekten basılıyor", lanCsp.length > 20);
  } finally {
    child.kill("SIGKILL");
  }
}

// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== UZAKTAN ERİŞİM KAPISI ===");
  sectionConfig();
  sectionRemoteDetection();
  sectionDenylist();
  sectionClientIp();
  await sectionEndToEnd();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

// `--serve`: bu dosya app'i iki portta ayağa kaldıran bir sunucu olur.
// `require` bilinçli — üst seviye `import` parent süreçte de app'i yüklerdi.
if (process.argv.includes("--serve")) {
  const mod = require("../src/app") as { default: Express };
  const app = mod.default;
  // Uzak dinleyici, env'deki REMOTE_PORT'un TA KENDİSİ olmak zorunda — `markRemote`
  // soket portunu o değerle karşılaştırıyor. LAN dinleyicisi serbest port alır.
  const remotePort = Number(process.env.REMOTE_PORT);
  const lanSrv = app.listen(0, "127.0.0.1", () => {
    const remoteSrv = app.listen(remotePort, "127.0.0.1", () => {
      process.stdout.write(
        `READY ${(lanSrv.address() as AddressInfo).port} ${(remoteSrv.address() as AddressInfo).port}\n`,
      );
    });
  });
} else {
  void main();
}
