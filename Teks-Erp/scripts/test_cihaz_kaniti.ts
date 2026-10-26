/**
 * Bekçi: cihaz kanıtı (güvenlik Bölge 5 B3). `x-device-id` tek başına bir BEYAN; onaylı cihaz
 * sayılmak için `x-device-proof` (sunucunun verdiği sırla HMAC, ±5 dk, yöntem+yol bağlı) gerekir —
 * `device.proofRequired` açıkken ya da barındırılan sınıfta. Kapalıyken bugünkü davranış.
 * Gerçek HTTP: app aynı süreçte 127.0.0.1:<boş port> (ikinci süreç yok). Yalnız `_test` DB.
 * Koşum: `cd Teks-Erp && npx tsx scripts/test_cihaz_kaniti.ts`
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import http from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService } from "../src/services/auth.service";
import { ShortCredentialService } from "../src/services/short-credential.service";
import { DeviceService } from "../src/services/device.service";
import {
  SETTING_KEYS, invalidateFeatureFlagsCache, SystemSettingService, readDeviceProofRequired,
} from "../src/services/system-setting.service";
import { resetLoginLockout, flushLoginLockoutPersistence } from "../src/middlewares/login-lockout";
import {
  buildDeviceProof, verifyDeviceProof, deriveDeviceSecret, newProofSalt, DEVICE_PROOF_SKEW_MS,
} from "../src/lib/device-proof";
import { getShortCredentialKeyRing, setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";

let gecti = 0;
let kaldi = 0;
function check(etiket: string, ok: boolean, ayrinti = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${etiket}${ayrinti ? ` — ${ayrinti}` : ""}`);
}

type Cevap = { status: number; body: Record<string, unknown> };
function istek(port: number, method: string, yol: string, govde: unknown, basliklar: Record<string, string> = {}): Promise<Cevap> {
  const veri = govde === undefined ? "" : JSON.stringify(govde);
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "127.0.0.1", port, path: yol, method,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(veri), ...basliklar } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          let j: Record<string, unknown> = {};
          try { j = JSON.parse(b); } catch { /* düz metin */ }
          resolve({ status: res.statusCode ?? 0, body: j });
        });
      },
    );
    r.on("error", reject);
    if (veri) r.write(veri);
    r.end();
  });
}
const kod = (c: Cevap): string => String((c.body.details as { code?: string } | undefined)?.code ?? "");
const data = (c: Cevap): Record<string, unknown> => (c.body.data as Record<string, unknown> | undefined) ?? {};

// ─── §1 saf kanıt (DB'siz) ───
function sSaf(): void {
  console.log("\n=== §1 kanıt biçimi ve doğrulama (saf) ===");
  const st = getShortCredentialKeyRing();
  check("§1a anahtar halkası okunur (LICENSE_DIR)", st.ok, st.ok ? "" : st.detail);
  if (!st.ok) return;
  const salt = newProofSalt(st.ring.active);
  const sir = deriveDeviceSecret(st.ring, "cihaz-A", salt)!;
  check("§1b sır 32 bayt (64 hex) ve tuzdan FARKLI", /^[0-9a-f]{64}$/.test(sir) && !salt.includes(sir));
  check("§1c aynı tuz, başka cihaz kimliği → başka sır", deriveDeviceSecret(st.ring, "cihaz-B", salt) !== sir);
  const t = Date.now();
  const p = buildDeviceProof(sir, t, "POST", "/api/auth/login-quick-pin");
  check("§1d doğru kanıt OK", verifyDeviceProof(sir, p, { method: "POST", path: "/api/auth/login-quick-pin" }, t) === "OK");
  check("§1e başlıksız EKSIK", verifyDeviceProof(sir, undefined, { method: "POST", path: "/x" }, t) === "EKSIK");
  check("§1f biçimsiz BICIM", verifyDeviceProof(sir, "v1.abc.def", { method: "POST", path: "/x" }, t) === "BICIM");
  check("§1g başka yol IMZA (yol bağlı)", verifyDeviceProof(sir, p, { method: "POST", path: "/api/auth/login-card" }, t) === "IMZA");
  check("§1h başka yöntem IMZA", verifyDeviceProof(sir, p, { method: "GET", path: "/api/auth/login-quick-pin" }, t) === "IMZA");
  check("§1i ±5 dk dışı SAAT", verifyDeviceProof(sir, p, { method: "POST", path: "/api/auth/login-quick-pin" }, t + DEVICE_PROOF_SKEW_MS + 1) === "SAAT");
  const yanlis = buildDeviceProof("00".repeat(32), t, "POST", "/api/auth/login-quick-pin");
  check("§1j yanlış sırla IMZA", verifyDeviceProof(sir, yanlis, { method: "POST", path: "/api/auth/login-quick-pin" }, t) === "IMZA");
}

function sStatik(): void {
  console.log("\n=== §6 statik ===");
  const kok = join(__dirname, "..", "..");
  const dm = readFileSync(join(kok, "Teks-Erp/src/middlewares/device.middleware.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  check("§6a cihaz çözücü başlık dışında kanıt doğrular", /verifyDeviceProof\(/.test(dm));
  // Tek kurucu `clientHeaders.ts` (N4-TABLET): axios kesicisi ve zil SSE'si başlığı oradan alır.
  const api = readFileSync(join(kok, "mobil/src/services/api.ts"), "utf8");
  const baslik = readFileSync(join(kok, "mobil/src/services/clientHeaders.ts"), "utf8");
  check(
    "§6b tablet istek katmanı kanıt başlığını ekler (tek yer: clientHeaders, api istemcisi onu kullanır)",
    /DEVICE_PROOF_HEADER\]\s*=\s*proof/.test(baslik) && /buildDeviceHeaders\(/.test(api) && !/DEVICE_PROOF_HEADER\]\s*=/.test(api),
  );
  const ikiz = readFileSync(join(kok, "mobil/src/lib/device-proof.ts"), "utf8");
  check("§6c istemci ikizi aynı ileti biçimini kurar", ikiz.includes("`v1\\n${ts}\\n${method.toUpperCase()}\\n${path}`"));
}

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exit(2);
  }
  // CI'da LICENSE_DIR yok: halka geçici dizinde doğar (fabrikanın halkasına dokunulmaz).
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "cihaz-kaniti-halka-")));
  delete process.env[INSTALL_CLASS_ENV];
  delete process.env.RATE_LIMIT_ENABLED;

  sSaf();

  // Varsayılan = bugünkü davranış (kayıt yokken) — ölçülerek.
  const kayitli = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVICE_PROOF_REQUIRED } });
  if (!kayitli) check("§0 device.proofRequired kayıt yokken KAPALI (bugünkü davranış)", (await readDeviceProofRequired()) === false);

  const { default: app } = await import("../src/app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const ts = Date.now();
  const AYARLAR = [
    SETTING_KEYS.AUTH_LOGIN_METHODS, SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
    SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, SETTING_KEYS.DEVICE_PROOF_REQUIRED,
    SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
  ];
  const once = new Map<string, unknown>();
  for (const k of AYARLAR) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    once.set(k, row ? row.value : undefined);
  }
  const pinSahibi = await prisma.user.create({
    data: { username: `ckn-pin-${ts}`, passwordHash: await AuthService.hashPassword(`x-${ts}`), fullName: "Cihaz Kanıtı PIN" },
    select: { id: true },
  });
  const set = async (key: string, value: unknown): Promise<void> => {
    await prisma.systemSetting.upsert({
      where: { key }, create: { key, value: value as never, updatedById: pinSahibi.id }, update: { value: value as never, updatedById: pinSahibi.id },
    });
    invalidateFeatureFlagsCache();
  };
  const kilitTemizle = async (): Promise<void> => {
    for (const k of ["127.0.0.1", "::ffff:127.0.0.1"]) resetLoginLockout(k);
    await flushLoginLockoutPersistence();
  };
  const cihazId = `ckn-cihaz-${ts}`;
  let cihazDbId: string | null = null;
  const PIN_YOL = "/api/auth/login-quick-pin";

  try {
    await set(SETTING_KEYS.AUTH_LOGIN_METHODS, { enabled: ["list", "pin"], primary: "list" });
    await set(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off");
    await set(SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, false);
    await set(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, true);
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);
    await kilitTemizle();
    const pin = await ShortCredentialService.assignQuickPin(pinSahibi.id); // değer basılmaz
    const cihaz = await prisma.device.create({
      data: { deviceId: cihazId, name: "Kanıt bekçisi tableti", status: "APPROVED", isActive: true },
      select: { id: true },
    });
    cihazDbId = cihaz.id;
    const pinGiris = (h: Record<string, string>) => istek(port, "POST", PIN_YOL, { pin, clientType: "mobile" }, h);
    const tokenVar = (c: Cevap) => c.status === 200 && typeof data(c).token === "string";
    const kanit = (sir: string, yol = PIN_YOL, method = "POST") => buildDeviceProof(sir, Date.now(), method, yol);

    // ─── §2 fabrika sınıfı, bayrak KAPALI → bugünkü davranış ───
    console.log("\n=== §2 fabrika sınıfı, device.proofRequired KAPALI (eski tablet kırılmaz) ===");
    const eski = await pinGiris({ "x-device-id": cihazId });
    check("§2a sırsız eski tablet (yalnız x-device-id) PIN'le girer", tokenVar(eski), `HTTP ${eski.status} ${kod(eski)}`);
    const cop = await pinGiris({ "x-device-id": cihazId, "x-device-proof": "v1.1.00" });
    check("§2b bayrak kapalıyken çöp kanıt yok sayılır", tokenVar(cop), `HTTP ${cop.status}`);
    const cihazsiz = await pinGiris({});
    check("§2c karşı-kanıt: cihazsız PIN 403 DEVICE_NOT_APPROVED", cihazsiz.status === 403 && kod(cihazsiz) === "DEVICE_NOT_APPROVED",
      `HTTP ${cihazsiz.status} ${kod(cihazsiz)}`);

    // ─── §3 sır verimi (TOFU, bir kez) ───
    console.log("\n=== §3 sır verimi ===");
    const s1 = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": cihazId });
    const sir1 = String(data(s1).deviceSecret ?? "");
    check("§3a sırsız ONAYLI cihaz ilk status'ta sır alır", /^[0-9a-f]{64}$/.test(sir1), `HTTP ${s1.status}`);
    const satir = await prisma.device.findUnique({ where: { id: cihaz.id }, select: { proofSalt: true, proofConfirmedAt: true } });
    check("§3b DB'de sır YOK (yalnız tuz)", !!satir?.proofSalt && !satir.proofSalt.includes(sir1));
    const iz = await prisma.systemLog.count({ where: { recordId: cihaz.id, newData: { path: ["event"], equals: "DEVICE_PROOF_SECRET_ISSUED" } } });
    check("§3c verim audit'e düşer", iz >= 1, `${iz} satır`);
    // 30 sn pencere (D1): aynı andaki announce/status turları tek sır alır; pencere dolunca teyitsiz sır yeniden verilir.
    const sPencere = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": cihazId });
    check("§3d1 pencere içinde ikinci status sır ALMAZ (eşzamanlı turlar tek verim)", sPencere.status === 200 && data(sPencere).deviceSecret === undefined,
      `HTTP ${sPencere.status}`);
    await prisma.device.update({ where: { id: cihaz.id }, data: { proofIssuedAt: new Date(Date.now() - 31_000) } });
    const s2 = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": cihazId });
    const sir2 = String(data(s2).deviceSecret ?? "");
    check("§3d teyitsiz sır (cevap yolda kaybolmuş olabilir) pencere dolunca yeniden verilir, eskisi geçersizleşir", /^[0-9a-f]{64}$/.test(sir2) && sir2 !== sir1);
    const teyit = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir2) });
    check("§3e geçerli kanıtla giriş", tokenVar(teyit), `HTTP ${teyit.status}`);
    const teyitli = await prisma.device.findUnique({ where: { id: cihaz.id }, select: { proofConfirmedAt: true } });
    check("§3f ilk geçerli kanıt sırrı TEYİT eder", !!teyitli?.proofConfirmedAt);
    const s3 = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": cihazId });
    check("§3g teyitli sır bir daha VERİLMEZ (kimliği bilen başkası sır alamaz)", s3.status === 200 && data(s3).deviceSecret === undefined);
    const liste = await DeviceService.list();
    const listede = liste.find((d) => d.id === cihaz.id) as Record<string, unknown> | undefined;
    check("§3h yönetici listesi tuzu taşımaz", !!listede && !("proofSalt" in listede));

    // ─── §4 bayrak AÇIK (fabrika) ───
    console.log("\n=== §4 device.proofRequired AÇIK ===");
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, true);
    await kilitTemizle();
    const sahte = await pinGiris({ "x-device-id": cihazId });
    check("§4a onaylı kimliği başlıkta tekrarlayan başka istemci (kanıtsız) PIN → 401", sahte.status === 401 && kod(sahte) === "DEVICE_PROOF_INVALID",
      `HTTP ${sahte.status} ${kod(sahte)}`);
    const yanlis = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit("11".repeat(32)) });
    check("§4b yanlış kanıt → 401", yanlis.status === 401 && kod(yanlis) === "DEVICE_PROOF_INVALID", `HTTP ${yanlis.status}`);
    const eskiSir = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir1) });
    check("§4c geçersizleşmiş eski sır → 401", eskiSir.status === 401, `HTTP ${eskiSir.status}`);
    const baskaYol = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir2, "/api/auth/login-card") });
    check("§4d başka yola atılmış kanıt tekrar kullanılamaz → 401", baskaYol.status === 401, `HTTP ${baskaYol.status}`);
    const dogru = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir2) });
    check("§4e doğru kanıtla PIN → 200 + token", tokenVar(dogru), `HTTP ${dogru.status} ${kod(dogru)}`);
    const st = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": cihazId });
    check("§4f status ucu kanıtsız açık kalır (sır alma yolu)", st.status === 200, `HTTP ${st.status}`);

    // ─── §5 barındırılan sınıf: kayıt KAPALI olsa da zorunlu ───
    console.log("\n=== §5 barındırılan sınıf ===");
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);
    process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN";
    try {
      await kilitTemizle();
      const h1 = await pinGiris({ "x-device-id": cihazId });
      check("§5a barındırılan + kanıtsız → 401", h1.status === 401 && kod(h1) === "DEVICE_PROOF_INVALID", `HTTP ${h1.status} ${kod(h1)}`);
      const h2 = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir2) });
      check("§5b barındırılan + doğru kanıt → 200", tokenVar(h2), `HTTP ${h2.status} ${kod(h2)}`);
      let red = "";
      try {
        await new SystemSettingService().setFeatureFlags({ deviceProofRequired: false } as never, pinSahibi.id);
      } catch (e) {
        red = String((e as { details?: { code?: string } }).details?.code ?? "");
      }
      check("§5c barındırılan sınıfta kural kapatılamaz (409 HOSTED_CLASS_FORCED)", red === "HOSTED_CLASS_FORCED", red || "kabul edildi");
    } finally {
      delete process.env[INSTALL_CLASS_ENV];
    }

    // ─── §7 revoke sırrı geri çağırır ───
    console.log("\n=== §7 revoke → yeniden onay → yeni sır ===");
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, true);
    await DeviceService.revoke(cihaz.id, pinSahibi.id);
    await prisma.device.update({ where: { id: cihaz.id }, data: { status: "APPROVED" } });
    const r1 = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir2) });
    check("§7a revoke edilen sırla kanıt → 401", r1.status === 401, `HTTP ${r1.status}`);
    const r2 = await istek(port, "GET", "/api/devices/status", undefined, { "x-device-id": cihazId });
    const sir3 = String(data(r2).deviceSecret ?? "");
    check("§7b yeniden onaylanan cihaz YENİ sır alır", /^[0-9a-f]{64}$/.test(sir3) && sir3 !== sir2);
    await kilitTemizle();
    const r3 = await pinGiris({ "x-device-id": cihazId, "x-device-proof": kanit(sir3) });
    check("§7c yeni sırla giriş", tokenVar(r3), `HTTP ${r3.status}`);
  } finally {
    for (const [k, v] of once) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k, updatedById: pinSahibi.id } });
      else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as never } });
    }
    invalidateFeatureFlagsCache();
    await kilitTemizle();
    await prisma.user.updateMany({ where: { id: pinSahibi.id }, data: { isActive: false, quickPinDigest: null } });
    if (cihazDbId) await prisma.device.update({ where: { id: cihazDbId }, data: { isActive: false } });
    await new Promise<void>((r) => server.close(() => r()));
  }

  sStatik();
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = kaldi === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
