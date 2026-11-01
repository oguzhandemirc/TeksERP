// =============================================================================
// Test: parola doğrulama kapasite koruması (VDS denetimi K1 + D2, 2026-11-01)
// =============================================================================
// §1 src/ altında bcryptjs YALNIZ password-hasher.helper'da (tek boğaz).
// §2 20 eşzamanlı yanlış parola (süreç içi HTTP, gerçek errorHandler): aynı anda ≤ N doğrulama,
//    fazlası 503 + Retry-After + details.code AUTH_BUSY + success:false; eşzamanlı sağlık isteği
//    zamanında döner; worker kipinde ana iş parçacığı kullanımı (ELU) eşik altında.
// §3 özet üretimi kuyruk tavanına takılmaz.
// §4 IPv6 /64 kovası (::ffff: IPv4 kalır; LAN bayt-aynı) + giriş kilidi anahtarı aynı kaynaktan.
// §5 D2: bilinmeyen kullanıcıda doğrulama koşar.  §6 yerinde onay: kaynak (/64) başına tavan.
// §7 boşta worker süreci ayakta tutmaz (her bekçi/betik doğal çıkmalı).
// §8 worker düşerse iş ana iş parçacığında biter (500 yok); hazır olmadan düşen → kalıcı düşüş;
//    varsayılan eşzamanlılık tek çekirdekte 1.
// Sonda: `--sonda=inline` worker'sız kip → §2 ELU ❌ (ölçümün ayırt ettiğini kanıtlar).
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import express, { type Request } from "express";
import { spawnSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { AddressInfo } from "net";
import { monitorEventLoopDelay, performance } from "perf_hooks";
import { errorHandler } from "../src/middlewares/error.middleware";
import { resolveClientIp } from "../src/middlewares/web-hardening";
import { resolveLoginLockoutKeys } from "../src/middlewares/login-lockout";
import { clientIpBucket } from "../src/lib/client-ip-prefix";
import { AuthService } from "../src/services/auth.service";
import { onsiteSourceRateLimited, resetOnsiteRebindRateForTests } from "../src/controllers/device.controller";
import { hashPassword, resetPasswordHashPoolForTests, verifyPassword } from "../src/services/helpers/password-hasher.helper";
import { AppError } from "../src/utils/app-error";
import bcrypt from "bcryptjs";
import { defaultConcurrency, PasswordHashPool, type HashOp } from "../src/services/helpers/password-hash-pool.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const PROBE_INLINE = process.argv.includes("--sonda=inline");
const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function section1(): void {
  console.log("\n§1 bcryptjs tek boğaz");
  const offenders = walk(join(ROOT, "src"))
    .filter((f) => /from\s+["']bcrypt(js)?["']|(require|import)\(\s*["']bcrypt(js)?["']\s*\)/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length + 1));
  check("§1a bcryptjs yalnız password-hasher.helper.ts'te içe aktarılır",
    offenders.length === 1 && offenders[0] === "src/services/helpers/password-hasher.helper.ts", offenders.join(", "));
}

async function section2(): Promise<void> {
  console.log("\n§2 20 eşzamanlı yanlış parola — semafor + worker");
  const pool = await resetPasswordHashPoolForTests({
    PASSWORD_HASH_CONCURRENCY: "2", PASSWORD_VERIFY_QUEUE: "8", PASSWORD_HASH_MODE: PROBE_INLINE ? "inline" : "worker",
  });
  const hash = await hashPassword("TEST-dogru-parola-K1", 12);
  check("§2a havuz kipi beklenen", pool.mode === (PROBE_INLINE ? "inline" : "worker"), pool.mode);
  pool.peakActive = 0;

  const app = express();
  app.use(express.json());
  app.post("/login", (req, res, next) => {
    verifyPassword(String(req.body?.password ?? ""), hash)
      .then((ok) => (ok ? res.json({ success: true }) : next(AppError.unauthorized("Geçersiz kullanıcı adı veya şifre"))))
      .catch(next);
  });
  app.get("/health", (_req, res) => { res.json({ success: true }); });
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const elu0 = performance.eventLoopUtilization();
  try {
    const logins = Array.from({ length: 20 }, (_, i) =>
      fetch(`${base}/login`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: `yanlis-${i}` }) }));
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const health = await fetch(`${base}/health`);
    const healthMs = Date.now() - t0;
    const responses = await Promise.all(logins);
    const elu = performance.eventLoopUtilization(elu0);
    lag.disable();
    const busy = responses.filter((r) => r.status === 503);
    const denied = responses.filter((r) => r.status === 401);
    const body = busy[0] ? ((await busy[0].json()) as { success?: boolean; details?: { code?: string } }) : null;
    const lagMaxMs = Math.round(lag.max / 1e6);
    console.log(`   ölçüm: 401=${denied.length} 503=${busy.length} tepe=${pool.peakActive} sağlık=${healthMs}ms ELU=${elu.utilization.toFixed(3)} gecikme(max)=${lagMaxMs}ms`);
    check("§2b aynı anda en çok 2 doğrulama koşar", pool.peakActive <= 2 && pool.peakActive >= 1, `tepe=${pool.peakActive}`);
    check("§2c fazlası 503 alır (401 ≤ N+kuyruk, toplam 20)", busy.length >= 1 && denied.length <= 10 && busy.length + denied.length === 20,
      `401=${denied.length} 503=${busy.length}`);
    check("§2d 503 Retry-After + details.code AUTH_BUSY + success:false",
      busy.every((r) => r.headers.get("retry-after") === "2") && body?.success === false && body?.details?.code === "AUTH_BUSY");
    check("§2e eşzamanlı sağlık isteği zamanında döner (< 1500 ms)", health.status === 200 && healthMs < 1500, `${healthMs}ms`);
    check("§2f worker kipinde ana iş parçacığı kullanımı (ELU) < 0,5", elu.utilization < 0.5, elu.utilization.toFixed(3));
    check("§2g olay döngüsü gecikmesi (max) < 400 ms", lagMaxMs < 400, `${lagMaxMs}ms`);
  } finally {
    server.close();
  }
}

async function section3(): Promise<void> {
  console.log("\n§3 özet üretimi kuyruk tavanına takılmaz");
  await resetPasswordHashPoolForTests({ PASSWORD_HASH_CONCURRENCY: "1", PASSWORD_VERIFY_QUEUE: "1" });
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => hashPassword(`TEST-ozet-${i}`, 4)));
  check("§3a 6 eşzamanlı özet (N=1, kuyruk=1) hepsi üretilir", results.every((r) => r.status === "fulfilled"));
}

function fakeReq(ip: string, headers: Record<string, string> = {}): Request {
  return { ip, headers } as unknown as Request;
}

function section4(): void {
  console.log("\n§4 IPv6 /64 kovası");
  check("§4a aynı /64'ten iki adres aynı kova",
    clientIpBucket("2001:db8:aa:bb:1::5") === clientIpBucket("2001:0db8:00aa:00bb:ffff:1:2:3"), clientIpBucket("2001:db8:aa:bb:1::5"));
  check("§4b farklı /64 farklı kova", clientIpBucket("2001:db8:aa:bb::1") !== clientIpBucket("2001:db8:aa:bc::1"));
  check("§4c ::ffff: IPv4 olduğu gibi kalır", clientIpBucket("::ffff:192.168.1.20") === "::ffff:192.168.1.20");
  check("§4d IPv4 olduğu gibi kalır", clientIpBucket("10.0.0.7") === "10.0.0.7");
  check("§4e kısaltmalı / köşeli / bölgeli biçimler", clientIpBucket("[2001:db8::1%eth0]") === "2001:db8:0:0::/64"
    && clientIpBucket("::1") === "0:0:0:0::/64", clientIpBucket("[2001:db8::1%eth0]"));
  const hdr = "cf-connecting-ip";
  const a = resolveClientIp(fakeReq("172.68.1.1", { [hdr]: "2001:db8:1:2:aaaa::1" }), hdr);
  const b = resolveClientIp(fakeReq("172.68.1.1", { [hdr]: "2001:db8:1:2:bbbb::9" }), hdr);
  check("§4f kenar başlığıyla iki IPv6 aynı istemci anahtarı", a === b && a === "2001:db8:1:2::/64", String(a));
  check("§4g LAN (başlık yok, barındırılan değil) IPv6 ham kalır — bayt-aynı",
    resolveClientIp(fakeReq("fe80::1234:5678"), null, () => false) === "fe80::1234:5678");
  check("§4h barındırılan sınıfta başlıksız IPv6 da /64",
    resolveClientIp(fakeReq("2001:db8:5:6::7"), null, () => true) === "2001:db8:5:6::/64");
  const env = { CLIENT_IP_HEADER: hdr, LOGIN_LOCKOUT_SCOPE: "ip" } as NodeJS.ProcessEnv;
  const k1 = resolveLoginLockoutKeys(fakeReq("172.68.1.1", { [hdr]: "2001:db8:1:2:aaaa::1" }), "u:x", env);
  const k2 = resolveLoginLockoutKeys(fakeReq("172.68.1.1", { [hdr]: "2001:db8:1:2:cccc::2" }), "u:x", env);
  check("§4i giriş kilidi anahtarı aynı /64 kaynağından beslenir", k1.map((k) => k.key).join() === k2.map((k) => k.key).join(),
    k1.map((k) => k.key).join());
}

async function section5(): Promise<void> {
  console.log("\n§5 D2 bilinmeyen kullanıcıda doğrulama koşar");
  const pool = await resetPasswordHashPoolForTests({});
  const name = `TEST-yok-${Date.now()}`;
  const run = async (): Promise<number> => {
    const before = pool.started;
    const err = await AuthService.verifyPasswordForApproval(name, "yanlis").then(() => null, (e: unknown) => e);
    check("§5 bilinmeyen kullanıcı 401", err instanceof AppError && err.statusCode === 401);
    return pool.started - before;
  };
  const first = await run();
  const second = await run();
  check("§5a ilk çağrı doğrulama yapar (sahte özet + karşılaştırma)", first >= 1, `iş=${first}`);
  check("§5b sonraki çağrı tam bir karşılaştırma yapar", second === 1, `iş=${second}`);
}

function section6(): void {
  console.log("\n§6 yerinde onay kaynak tavanı");
  resetOnsiteRebindRateForTests();
  const src = clientIpBucket("2001:db8:9:9::1");
  let limited = 0;
  for (let i = 0; i < 30; i++) if (onsiteSourceRateLimited(src, `TEST-local-${i}`)) limited++;
  check("§6a aynı kaynaktan 30 farklı localId geçer", limited === 0, `limitli=${limited}`);
  check("§6b 31. deneme (yeni localId) sınırlanır", onsiteSourceRateLimited(src, "TEST-local-yeni") === true);
  check("§6c başka kaynak etkilenmez", onsiteSourceRateLimited(clientIpBucket("2001:db8:9:a::1"), "TEST-local-0") === false);
  resetOnsiteRebindRateForTests();
}

function section7(): void {
  console.log("\n§7 boşta worker süreci ayakta tutmaz (betik/bekçi doğal çıkar)");
  const code = 'require("./src/services/helpers/password-hasher.helper").hashPassword("x", 4).then((h) => console.log("OZET", h.length))';
  const t0 = Date.now();
  const r = spawnSync("npx", ["tsx", "-e", code], { cwd: ROOT, timeout: 90_000, encoding: "utf8" });
  const ms = Date.now() - t0;
  check("§7a özet üretip 90 sn içinde kendiliğinden çıkar", r.status === 0 && !r.error && /OZET 60/.test(r.stdout ?? ""),
    `status=${r.status} ${r.error ? "zaman aşımı" : ""} ${ms}ms`);
}

async function section8(): Promise<void> {
  console.log("\n§8 worker düşüşü — ana iş parçacığına dönüş");
  const inline = (j: HashOp): Promise<string | boolean> => (j.op === "compare" ? bcrypt.compare(j.plain, j.hash) : bcrypt.hash(j.plain, j.cost));
  const hash = await bcrypt.hash("TEST-dusus", 4);
  const broken = new PasswordHashPool({ concurrency: 1, verifyQueue: 8, mode: "worker", bcryptPath: "/yok/bcryptjs.js" }, inline);
  const r1 = await broken.run({ op: "compare", plain: "TEST-dusus", hash }).then((v) => v, (e: unknown) => e);
  const r2 = await broken.run({ op: "compare", plain: "yanlis", hash }).then((v) => v, (e: unknown) => e);
  check("§8a bozuk worker modülü: doğrulama yine doğru sonuç (500 yok)", r1 === true && r2 === false, `${String(r1)} / ${String(r2)}`);
  check("§8b hazır olmadan düşen worker → kalıcı ana iş parçacığı kipi", broken.mode === "inline", broken.mode);
  await broken.close();

  const pool = new PasswordHashPool({ concurrency: 1, verifyQueue: 8, mode: "worker" }, inline);
  await pool.run({ op: "compare", plain: "isinma", hash }); // worker hazır
  const pending = pool.run({ op: "hash", plain: "TEST-uzun", cost: 12 });
  await pool.killFirstWorkerForTests();
  const out = await pending.then((v) => v, (e: unknown) => e);
  check("§8c iş sürerken ölen worker: iş ana iş parçacığında tamamlanır", typeof out === "string" && out.startsWith("$2"), String(out).slice(0, 40));
  check("§8d tek düşüşte worker kipi sürer (yeniden kurulur)", pool.mode === "worker", pool.mode);
  await pool.close();

  check("§8e varsayılan eşzamanlılık: 1 çekirdek→1, 2→1, 4→2, 16→2",
    [1, 2, 4, 16].map((c) => defaultConcurrency(c)).join() === "1,1,2,2");
}

async function main(): Promise<void> {
  try {
    section1();
    await section2();
    await section3();
    section4();
    await section5();
    section6();
    section7();
    await section8();
  } finally {
    await resetPasswordHashPoolForTests({}).then((p) => p.close());
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
