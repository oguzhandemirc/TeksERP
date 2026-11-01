/**
 * Bekçi: onaysız tabletten yalnız parola girişi (`device.unpairedPasswordLogin`, 2026-10-19).
 * Bayrak açık + eşleştirme etkin zorunluyken PENDING + aktif cihaz `req.device`siz geçer: parola girişi
 * ve o oturumun uçları çalışır; hızlı PIN, kart, personel listesi, indirme belirteci KAPALI kalır;
 * pasif/kayıtsız cihaz ve kanıtsız onaylı kimlik yine kesilir. Varsayılan KAPALI = bugünkü davranış.
 * Matris: fabrika (eşleştirme kapalı/açık) × barındırılan × bayrak × cihaz durumu (plan §3).
 * Gerçek HTTP: app aynı süreçte 127.0.0.1:<boş port>. Yalnız fikstür DB.
 * Koşum: `cd Teks-Erp && npx tsx scripts/test_onaysiz_parola_girisi.ts`
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService } from "../src/services/auth.service";
import { ShortCredentialService } from "../src/services/short-credential.service";
import { DeviceService } from "../src/services/device.service";
import {
  SETTING_KEYS, invalidateFeatureFlagsCache, SystemSettingService, readDeviceUnpairedPasswordLogin,
} from "../src/services/system-setting.service";
import { resetLoginLockout, flushLoginLockoutPersistence } from "../src/middlewares/login-lockout";
import { buildDeviceProof } from "../src/lib/device-proof";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
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
/** Hata kodu: AppError `details.code`; device.middleware'in elle yazdığı 401'ler (tablet sözleşmesi) kök `code`. */
const kod = (c: Cevap): string =>
  // eslint-disable-next-line no-restricted-syntax -- device.middleware 401 gövdesi kök `code` taşır (AppError değil)
  String((c.body.details as { code?: string } | undefined)?.code ?? (c.body.code as string | undefined) ?? "");
const data = (c: Cevap): Record<string, unknown> => (c.body.data as Record<string, unknown> | undefined) ?? {};
const ozet = (c: Cevap): string => `HTTP ${c.status} ${kod(c)}`;

async function main(): Promise<void> {
  const engel = fixtureHedefEngeli();
  if (engel) {
    console.error(`HEDEF RED: ${engel}`);
    process.exit(2);
  }
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "onaysiz-parola-halka-")));
  delete process.env[INSTALL_CLASS_ENV];
  delete process.env.RATE_LIMIT_ENABLED;

  const kayitli = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN } });
  if (!kayitli) check("§0 device.unpairedPasswordLogin kayıt yokken KAPALI (bugünkü davranış)", (await readDeviceUnpairedPasswordLogin()) === false);

  const { default: app } = await import("../src/app");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const ts = Date.now();
  const AYARLAR = [
    SETTING_KEYS.AUTH_LOGIN_METHODS, SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
    SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, SETTING_KEYS.DEVICE_PROOF_REQUIRED,
    SETTING_KEYS.DEVICE_PAIRING_REQUIRED, SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN,
    SETTING_KEYS.AUTH_WEB_TOTP_POLICY,
  ];
  const once = new Map<string, unknown>();
  for (const k of AYARLAR) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    once.set(k, row ? row.value : undefined);
  }
  const parola = `Onaysiz-${ts}-x`;
  const kisi = await prisma.user.create({
    data: { username: `test-onaysiz-u-${ts}`, passwordHash: await AuthService.hashPassword(parola), fullName: "Onaysız Parola Bekçisi", webTotpOptOut: true },
    select: { id: true, username: true },
  });
  const set = async (key: string, value: unknown): Promise<void> => {
    await prisma.systemSetting.upsert({
      where: { key }, create: { key, value: value as never, updatedById: kisi.id }, update: { value: value as never, updatedById: kisi.id },
    });
    invalidateFeatureFlagsCache();
  };
  const kilitTemizle = async (): Promise<void> => {
    for (const k of ["127.0.0.1", "::ffff:127.0.0.1"]) resetLoginLockout(k);
    await flushLoginLockoutPersistence();
  };
  const onek = `test-onaysiz-${ts}`;
  const ID = { bekleyen: `${onek}-bekleyen`, pasif: `${onek}-pasif`, onayli: `${onek}-onayli`, yok: `${onek}-yok` };

  try {
    await set(SETTING_KEYS.AUTH_LOGIN_METHODS, { enabled: ["list", "pin", "card"], primary: "list" });
    await set(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off");
    await set(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, false);
    await set(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, false);
    await set(SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN, false);
    // Ölçülen cihaz kapısı; onaysız cihazdan barındırılan girişin 2FA'sı test_barindirma_ikinci_faktor §2'de.
    await set(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "USER_CHOICE");
    await kilitTemizle();
    const pin = await ShortCredentialService.assignQuickPin(kisi.id); // değer basılmaz
    await prisma.device.createMany({
      data: [
        { deviceId: ID.bekleyen, name: "TEST onaysız bekleyen", status: "PENDING", isActive: true },
        { deviceId: ID.pasif, name: "TEST onaysız pasif", status: "PENDING", isActive: false },
        { deviceId: ID.onayli, name: "TEST onaysız onaylı", status: "APPROVED", isActive: true },
      ],
    });
    const cihaz = (id: string | null): Record<string, string> => (id ? { "x-device-id": id } : {});
    const parolaGiris = (id: string | null) =>
      istek(port, "POST", "/api/auth/login", { username: kisi.username, password: parola, clientType: "mobile" }, cihaz(id));
    const pinGiris = (id: string | null, ek: Record<string, string> = {}) =>
      istek(port, "POST", "/api/auth/login-quick-pin", { pin, clientType: "mobile" }, { ...cihaz(id), ...ek });
    const kartGiris = (id: string | null) =>
      istek(port, "POST", "/api/auth/login-card", { cardCode: `TEKSU:${kisi.id}:${"ab".repeat(32)}`, clientType: "mobile" }, cihaz(id));
    const liste = (id: string | null) => istek(port, "GET", "/api/auth/mobile-users", undefined, cihaz(id));
    const yontem = (id: string | null) => istek(port, "GET", "/api/auth/login-methods", undefined, cihaz(id));
    const belirtec = (id: string | null, token?: string) =>
      istek(port, "GET", "/api/license/indirme-belirteci?urun=mobil", undefined, {
        ...cihaz(id), ...(token ? { authorization: `Bearer ${token}` } : {}),
      });
    const tokenOf = (c: Cevap): string | null => (c.status === 200 && typeof data(c).token === "string" ? String(data(c).token) : null);

    // ─── §1 fabrika, eşleştirme KAPALI: bayrak açık/kapalı fark etmez (bugünkü davranış) ───
    console.log("\n=== §1 fabrika, eşleştirme kapalı ===");
    for (const bayrak of [false, true]) {
      await set(SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN, bayrak);
      const e = `§1${bayrak ? "b" : "a"} bayrak ${bayrak ? "AÇIK" : "KAPALI"}`;
      check(`${e}: PENDING cihaz parola 200`, tokenOf(await parolaGiris(ID.bekleyen)) !== null);
      const p = await pinGiris(ID.bekleyen);
      check(`${e}: PENDING cihaz PIN 200 (kısa kimlik kuralı kapalı)`, tokenOf(p) !== null, ozet(p));
      check(`${e}: personel listesi açık`, (await liste(ID.bekleyen)).status === 200);
      const y = await yontem(ID.bekleyen);
      check(`${e}: login-methods unpairedPasswordOnly=false`, y.status === 200 && data(y).unpairedPasswordOnly === false, ozet(y));
      const st = await DeviceService.getStatus(ID.bekleyen);
      check(`${e}: status unpairedPasswordLogin=false`, st.unpairedPasswordLogin === false);
    }

    // ─── §2 fabrika, eşleştirme AÇIK, bayrak KAPALI → bugünkü 401 ───
    console.log("\n=== §2 fabrika, eşleştirme açık, bayrak kapalı ===");
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, true);
    await set(SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN, false);
    const k2 = await parolaGiris(ID.bekleyen);
    check("§2a PENDING parola → 401 DEVICE_INACTIVE", k2.status === 401 && kod(k2) === "DEVICE_INACTIVE", ozet(k2));
    check("§2b status unpairedPasswordLogin=false", (await DeviceService.getStatus(ID.bekleyen)).unpairedPasswordLogin === false);

    // ─── §3 fabrika, eşleştirme AÇIK, bayrak AÇIK ───
    console.log("\n=== §3 fabrika, eşleştirme açık, bayrak açık ===");
    await set(SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN, true);
    await kilitTemizle();
    const g = await parolaGiris(ID.bekleyen);
    const tok = tokenOf(g);
    check("⭐ §3a PENDING cihaz parolayla girer (200 + token)", tok !== null, ozet(g));
    const me = await istek(port, "GET", "/api/auth/me", undefined, { ...cihaz(ID.bekleyen), authorization: `Bearer ${tok}` });
    check("§3b parola oturumunun mobil ucu çalışır (/auth/me 200)", me.status === 200, ozet(me));
    const p3 = await pinGiris(ID.bekleyen);
    check("⭐ §3c PENDING PIN → 403 DEVICE_NOT_APPROVED (kısa kimlik kuralı kapalıyken de)", p3.status === 403 && kod(p3) === "DEVICE_NOT_APPROVED", ozet(p3));
    const k3 = await kartGiris(ID.bekleyen);
    check("§3d PENDING kart → 403 DEVICE_NOT_APPROVED", k3.status === 403 && kod(k3) === "DEVICE_NOT_APPROVED", ozet(k3));
    const l3 = await liste(ID.bekleyen);
    check("⭐ §3e PENDING personel listesi → 401 DEVICE_REQUIRED", l3.status === 401 && kod(l3) === "DEVICE_REQUIRED", ozet(l3));
    const b3 = await belirtec(ID.bekleyen);
    check("§3f PENDING kimliksiz indirme belirteci → 403 DEVICE_NOT_APPROVED", b3.status === 403 && kod(b3) === "DEVICE_NOT_APPROVED", ozet(b3));
    const b3o = await belirtec(ID.bekleyen, tok ?? "");
    check("⭐ §3g PENDING + parola oturumu indirme belirteci → 403 DEVICE_NOT_APPROVED", b3o.status === 403 && kod(b3o) === "DEVICE_NOT_APPROVED", ozet(b3o));
    const b3k = await belirtec(null, tok ?? "");
    check("§3h karşı-kanıt: aynı oturum cihaz başlığı OLMADAN belirteçte DEVICE_NOT_APPROVED almaz", kod(b3k) !== "DEVICE_NOT_APPROVED", ozet(b3k));
    const y3 = await yontem(ID.bekleyen);
    check("⭐ §3i login-methods unpairedPasswordOnly=true", y3.status === 200 && data(y3).unpairedPasswordOnly === true, ozet(y3));
    const st3 = await istek(port, "GET", "/api/devices/status", undefined, cihaz(ID.bekleyen));
    check("⭐ §3j status: PENDING + pairingRequired + unpairedPasswordLogin=true",
      data(st3).status === "PENDING" && data(st3).pairingRequired === true && data(st3).unpairedPasswordLogin === true, JSON.stringify(data(st3)));
    const ps = await parolaGiris(ID.pasif);
    check("⭐ §3k pasif cihaz parola → 401 DEVICE_INACTIVE (yasak kalır)", ps.status === 401 && kod(ps) === "DEVICE_INACTIVE", ozet(ps));
    check("§3l pasif cihaz status unpairedPasswordLogin=false", (await DeviceService.getStatus(ID.pasif)).unpairedPasswordLogin === false);
    const yk = await parolaGiris(ID.yok);
    check("§3m kayıtsız cihaz parola → 401 DEVICE_INACTIVE", yk.status === 401 && kod(yk) === "DEVICE_INACTIVE", ozet(yk));
    check("§3n kayıtsız cihaz status UNKNOWN + false", (await DeviceService.getStatus(ID.yok)).unpairedPasswordLogin === false);
    const o3 = await pinGiris(ID.onayli);
    check("§3o onaylı cihaz PIN 200 (etkilenmez)", tokenOf(o3) !== null, ozet(o3));
    const oy = await yontem(ID.onayli);
    check("§3p onaylı cihazda unpairedPasswordOnly=false", data(oy).unpairedPasswordOnly === false);
    check("§3q onaylı cihaz status unpairedPasswordLogin=false", (await DeviceService.getStatus(ID.onayli)).unpairedPasswordLogin === false);
    const ann = await DeviceService.announce({ deviceId: `${onek}-yeni` });
    check("§3r bayrak açıkken yeni cihaz yine PENDING doğar (otomatik onay YOK) ve alanı taşır",
      ann.status === "PENDING" && ann.unpairedPasswordLogin === true, `${ann.status}/${String(ann.unpairedPasswordLogin)}`);

    // ─── §4 barındırılan sınıf ───
    console.log("\n=== §4 barındırılan sınıf ===");
    await set(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, false); // barındırılan zaten zorunlu kılar
    process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN";
    try {
      await set(SETTING_KEYS.DEVICE_UNPAIRED_PASSWORD_LOGIN, false);
      const h1 = await parolaGiris(ID.bekleyen);
      check("§4a bayrak KAPALI: PENDING parola → 401 DEVICE_INACTIVE (bugünkü)", h1.status === 401 && kod(h1) === "DEVICE_INACTIVE", ozet(h1));
      const svc = new SystemSettingService();
      await svc.setFeatureFlags({ deviceUnpairedPasswordLogin: true } as never, kisi.id);
      check("§4b barındırılanda bayrak AÇILABİLİR", (await readDeviceUnpairedPasswordLogin()) === true);
      invalidateFeatureFlagsCache();
      await kilitTemizle();
      const h2 = await parolaGiris(ID.bekleyen);
      check("⭐ §4c bayrak AÇIK: PENDING parolayla girer", tokenOf(h2) !== null, ozet(h2));
      const h3 = await pinGiris(ID.bekleyen);
      check("§4d PENDING PIN → 403 DEVICE_NOT_APPROVED", h3.status === 403 && kod(h3) === "DEVICE_NOT_APPROVED", ozet(h3));
      check("§4e PENDING liste → 401", (await liste(ID.bekleyen)).status === 401);
      const h4 = await parolaGiris(ID.onayli);
      check("⭐ §4f onaylı kimlik KANITSIZ → 401 DEVICE_PROOF_INVALID (onaysız kipe DÜŞMEZ)", h4.status === 401 && kod(h4) === "DEVICE_PROOF_INVALID", ozet(h4));
      // §3q'nun getStatus'u teyitsiz bir sır verdi; 30 sn yeniden verim penceresi (D1) dolmuş sayılır.
      await prisma.device.updateMany({ where: { deviceId: ID.onayli }, data: { proofIssuedAt: new Date(Date.now() - 31_000) } });
      const s = await istek(port, "GET", "/api/devices/status", undefined, cihaz(ID.onayli));
      const sir = String(data(s).deviceSecret ?? "");
      const h5 = await pinGiris(ID.onayli, { "x-device-proof": buildDeviceProof(sir, Date.now(), "POST", "/api/auth/login-quick-pin") });
      check("§4g onaylı + kanıt PIN 200", tokenOf(h5) !== null, ozet(h5));
      let red = "";
      try { await svc.setFeatureFlags({ devicePairingRequired: false } as never, kisi.id); } catch (e) {
        red = String((e as { details?: { code?: string } }).details?.code ?? "");
      }
      check("§4h barındırılanda eşleştirme yine kapatılamaz (409 PAIRING_FORCED)", red === "PAIRING_FORCED", red || "kabul edildi");
      await svc.setFeatureFlags({ deviceUnpairedPasswordLogin: false } as never, kisi.id);
      invalidateFeatureFlagsCache();
      const h6 = await parolaGiris(ID.bekleyen);
      check("§4i bayrak kapatılınca onaysız cihaz ANINDA kesilir", h6.status === 401 && kod(h6) === "DEVICE_INACTIVE", ozet(h6));
    } finally {
      delete process.env[INSTALL_CLASS_ENV];
    }
  } finally {
    for (const [k, v] of once) {
      if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k, updatedById: kisi.id } });
      else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as never } });
    }
    invalidateFeatureFlagsCache();
    await kilitTemizle();
    await prisma.user.updateMany({ where: { id: kisi.id }, data: { isActive: false, quickPinDigest: null } });
    await prisma.device.deleteMany({ where: { deviceId: { startsWith: onek } } });
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = kaldi === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
