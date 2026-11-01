// =============================================================================
// Bekçi: barındırılan kurulumda parolalı girişin ikinci faktörü KANALDAN BAĞIMSIZ (Y1, 2026-11-01)
// =============================================================================
// Çalıştır: npx tsx scripts/test_barindirma_ikinci_faktor.ts
// Ölçer (süreç içi sunucu 127.0.0.1:0, Bearer yolu; panel çerez kipi KAPALI):
//   §1 LAN: dört kanal (electron / mobile / boş / web) bugünkü davranış — TOTP'siz kodsuz 200, cevap anahtarları
//      {token,user,mustChangePassword}; TOTP'li 409 ve gövde belirteci yok sayılır.
//   §2 barındırılan + REQUIRED: TOTP'siz → 403 TOTP_ENROLLMENT_REQUIRED, TOTP'li → 409 TOTP_REQUIRED (üç kanal);
//      masaüstünde details.trustDeviceDays, mobilde yok.
//   §3 USER_CHOICE + webTotpOptOut: kodsuz 200; tercihsiz kullanıcı 409.
//   §4 onaylı + kanıtlı tablet: mobil/boş kodsuz 200; aynı cihazdan electron beyanı 409; kanıtsız 401;
//      kanıtlı DESKTOP kaydı + mobile beyanı 409 (muafiyet cihaz türüne bağlı).
//   §5 süperadmin: üç kanal + onaylı tablet → 409 (opt-out ve cihaz muafiyeti yok).
//   §6 masaüstü güvenilir cihaz: kod + rememberDevice → gövdede belirteç + yeni cihaz bildirimi; ikinci giriş
//      kodsuz (bildirim yok); başka kullanıcı / iptal sonrası 409; belirteç audit yükünde yok.
//   §7 tablette yerinde yeniden bağlama onayı (verifyPasswordForApproval) barındırılanda aynı kurala bağlı:
//      TOTP'siz 403 enrollment, TOTP'li kodsuz 409, kodla geçer; LAN'da parola yeter (bugünkü davranış).
// Negatif sondalar: dosya sonu. İzolasyon: TEST- kullanıcıları + ayar anlık görüntüsü; finally geri yükler.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/services/auth.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { getShortCredentialKeyRing, setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { buildDeviceProof, deriveDeviceSecret, newProofSalt } from "../src/lib/device-proof";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";
import { NEW_DEVICE_LOGIN_KIND } from "../src/services/notification-sources/kimlik";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Body = { data?: Record<string, unknown>; details?: Record<string, unknown> };
type Reply = { status: number; body: Body };
const PASSWORD = "Deneme-bif-12345";
const DAYS = 30;
const LOGIN = "/api/auth/login";
const UA = "Mozilla/5.0 (Windows NT 10.0) TeksERP-Electron";
const codeOf = (r: Reply) => `${r.status}:${String(r.body.details?.code ?? "")}`;
const CHANNELS: Array<string | undefined> = ["electron", "mobile", undefined];
const label = (c: string | undefined) => c ?? "boş";

const ids: string[] = [];
const names: string[] = [];
async function makeUser(tag: string, system = false) {
  const perms = await prisma.permission.findMany({ where: { code: { in: ["roll:read"] } }, select: { id: true } });
  const username = `TEST-bif-${tag}-${Date.now()}`;
  const u = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(PASSWORD),
      fullName: `TEST barındırma 2FA ${tag}`,
      ...(system ? { isSystemAccount: true } : {}),
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true },
  });
  ids.push(u.id);
  names.push(username);
  return { id: u.id, username };
}
async function enrollTotp(userId: string, actor: string): Promise<string> {
  const w = await TotpAccountService.openWindow({ userId, openedById: actor });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  return w.secret;
}
// Replay kilidi aynı adımı ikinci kez kabul etmez; ölçülen şey kanal, kod değil.
async function freshCode(userId: string, secret: string): Promise<string> {
  await prisma.user.update({ where: { id: userId }, data: { totpLastStep: null } });
  return totpCodeForStep(secret, totpStep());
}

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); process.exitCode = 1; return; }
  await reconcilePermissionCatalog();
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "bif-halka-")));
  const originalClass = process.env[INSTALL_CLASS_ENV];
  const originalWeb = process.env.WEB_DIST_DIR;
  delete process.env[INSTALL_CLASS_ENV];
  delete process.env.WEB_DIST_DIR; // çerez kipi kapalı: "web" beyanı da Bearer yolundan geçer
  const keys = [SETTING_KEYS.AUTH_WEB_TOTP_POLICY, SETTING_KEYS.AUTH_TRUSTED_DEVICE_DAYS, SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED,
    SETTING_KEYS.DEVICE_PROOF_REQUIRED, SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY];
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const setting = async (key: string, value: unknown) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };

  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = async (username: string, clientType: string | undefined, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Reply> => {
    const body = { username, password: PASSWORD, confirmKick: true, ...(clientType ? { clientType } : {}), ...extra };
    const r = await fetch(`${base}${LOGIN}`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA, ...headers }, body: JSON.stringify(body) });
    let parsed: Body = {};
    try { parsed = JSON.parse(await r.text()) as Body; } catch { /* boş */ }
    return { status: r.status, body: parsed };
  };
  let deviceRowId: string | null = null;
  let deskRowId: string | null = null;
  const hosted = (on: boolean) => { if (on) process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN"; else delete process.env[INSTALL_CLASS_ENV]; invalidateFeatureFlagsCache(); };

  try {
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "REQUIRED");
    await setting(SETTING_KEYS.AUTH_TRUSTED_DEVICE_DAYS, DAYS);
    await setting(SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, true);
    await setting(SETTING_KEYS.DEVICE_PROOF_REQUIRED, false);
    await setting(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off");
    const actor = await makeUser("aktor");
    const plain = await makeUser("totpsuz");
    const withTotp = await makeUser("totplu");
    const sTotp = await enrollTotp(withTotp.id, actor.id);
    const optOut = await makeUser("tercih");
    const sOpt = await enrollTotp(optOut.id, actor.id);
    await prisma.user.update({ where: { id: optOut.id }, data: { webTotpOptOut: true } });
    const sa = await makeUser("sa", true);
    await enrollTotp(sa.id, actor.id);

    // Onaylı + kanıt tuzlu tablet (sır DB'de yok, yalnız tuz).
    const ring = getShortCredentialKeyRing();
    if (!ring.ok) throw new Error("anahtar halkası okunamadı");
    const devId = `TEST-bif-tablet-${Date.now()}`;
    const salt = newProofSalt(ring.ring.active);
    const secret = deriveDeviceSecret(ring.ring, devId, salt)!;
    deviceRowId = (await prisma.device.create({ data: { deviceId: devId, name: "TEST bif tablet", status: "APPROVED", isActive: true, kind: "TABLET", proofSalt: salt }, select: { id: true } })).id;
    const proven = () => ({ "x-device-id": devId, "x-device-proof": buildDeviceProof(secret, Date.now(), "POST", LOGIN) });

    // ── §1 LAN ────────────────────────────────────────────────────────────
    console.log("\n=== §1 LAN (barındırılmayan): bugünkü davranış ===");
    hosted(false);
    for (const c of [...CHANNELS, "web"]) {
      const r = await login(plain.username, c);
      const keysOf = Object.keys(r.body.data ?? {}).sort().join(",");
      check(`§1a LAN ${label(c)}: TOTP'siz hesap kodsuz girer, cevap anahtarları aynı`, r.status === 200 && keysOf === "mustChangePassword,token,user", `${codeOf(r)} [${keysOf}]`);
      const t = await login(withTotp.username, c, { trustedDeviceToken: "x".repeat(40) });
      check(`§1b LAN ${label(c)}: TOTP'li hesap 409, trustDeviceDays yok`, codeOf(t) === "409:TOTP_REQUIRED" && t.body.details?.trustDeviceDays === undefined, codeOf(t));
    }
    const lanOpt = await login(optOut.username, "electron");
    check("§1c LAN: web tercihi masaüstünü etkilemez (TOTP'li → 409)", codeOf(lanOpt) === "409:TOTP_REQUIRED", codeOf(lanOpt));

    // ── §2 barındırılan, REQUIRED ─────────────────────────────────────────
    console.log("\n=== §2 barındırılan + REQUIRED: kanal beyanı atlatmaz ===");
    hosted(true);
    for (const c of CHANNELS) {
      const r = await login(plain.username, c);
      check(`§2a ⭐ ${label(c)}: TOTP'siz → 403 TOTP_ENROLLMENT_REQUIRED (token yok)`, codeOf(r) === "403:TOTP_ENROLLMENT_REQUIRED" && r.body.data?.token === undefined, codeOf(r));
      const t = await login(withTotp.username, c);
      check(`§2b ⭐ ${label(c)}: TOTP'li → 409 TOTP_REQUIRED`, codeOf(t) === "409:TOTP_REQUIRED", codeOf(t));
      const days = t.body.details?.trustDeviceDays;
      check(`§2c ${label(c)}: hatırla kutusu yalnız masaüstünde`, c === "electron" ? days === DAYS : days === undefined, String(days));
    }
    const coded = await login(withTotp.username, "mobile", { totpCode: await freshCode(withTotp.id, sTotp) });
    check("§2d mobil kodla 200", coded.status === 200 && typeof coded.body.data?.token === "string", codeOf(coded));

    // ── §3 USER_CHOICE ────────────────────────────────────────────────────
    console.log("\n=== §3 USER_CHOICE + kullanıcı tercihi ===");
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "USER_CHOICE");
    for (const c of CHANNELS) {
      const r = await login(optOut.username, c);
      check(`§3a ${label(c)}: tercihi kapalı kullanıcı kodsuz 200`, r.status === 200, codeOf(r));
    }
    const noPref = await login(withTotp.username, "electron");
    check("§3b tercihsiz kullanıcı yine 409", codeOf(noPref) === "409:TOTP_REQUIRED", codeOf(noPref));
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "REQUIRED");
    const reqAgain = await login(optOut.username, "mobile");
    check("§3c REQUIRED'a dönünce tercih etkisiz (409)", codeOf(reqAgain) === "409:TOTP_REQUIRED", codeOf(reqAgain));

    // ── §4 onaylı + kanıtlı tablet ────────────────────────────────────────
    console.log("\n=== §4 onaylı + kanıtlı tablet cihazı ikinci faktör ===");
    for (const c of ["mobile", undefined]) {
      const r = await login(withTotp.username, c, {}, proven());
      check(`§4a ⭐ ${label(c)} + kanıtlı cihaz: kodsuz 200`, r.status === 200 && typeof r.body.data?.token === "string", codeOf(r));
      const p = await login(plain.username, c, {}, proven());
      check(`§4b ${label(c)} + kanıtlı cihaz: TOTP'siz hesap da girer (cihaz faktör)`, p.status === 200, codeOf(p));
    }
    const desk = await login(withTotp.username, "electron", {}, proven());
    check("§4c ⭐ aynı cihazdan electron beyanı muafiyet almaz (409)", codeOf(desk) === "409:TOTP_REQUIRED", codeOf(desk));
    const bare = await login(withTotp.username, "mobile", {}, { "x-device-id": devId });
    check("§4d ⭐ kanıtsız x-device-id → 401 DEVICE_PROOF_INVALID (barındırılanda kanıt zorunlu)", codeOf(bare) === "401:DEVICE_PROOF_INVALID", codeOf(bare));
    const wrong = await login(withTotp.username, "mobile", {}, { "x-device-id": devId, "x-device-proof": buildDeviceProof("11".repeat(32), Date.now(), "POST", LOGIN) });
    check("§4e yanlış kanıt → 401", wrong.status === 401, codeOf(wrong));
    // Muafiyet cihaz kaydının türüne bağlı: kanıtlı DESKTOP kaydı mobil beyanıyla da kod ister.
    const deskDevId = `TEST-bif-masa-${Date.now()}`;
    const deskSalt = newProofSalt(ring.ring.active);
    const deskSecret = deriveDeviceSecret(ring.ring, deskDevId, deskSalt)!;
    deskRowId = (await prisma.device.create({ data: { deviceId: deskDevId, name: "TEST bif masaüstü", status: "APPROVED", isActive: true, kind: "DESKTOP", proofSalt: deskSalt }, select: { id: true } })).id;
    const deskProven = { "x-device-id": deskDevId, "x-device-proof": buildDeviceProof(deskSecret, Date.now(), "POST", LOGIN) };
    const deskMobile = await login(withTotp.username, "mobile", {}, deskProven);
    check("§4f ⭐ kanıtlı DESKTOP kaydı + mobile beyanı muafiyet almaz (409)", codeOf(deskMobile) === "409:TOTP_REQUIRED", codeOf(deskMobile));

    // ── §5 süperadmin ─────────────────────────────────────────────────────
    console.log("\n=== §5 süperadmin her kanalda kod ===");
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "USER_CHOICE");
    for (const c of CHANNELS) {
      const r = await login(sa.username, c);
      check(`§5a ⭐ süperadmin ${label(c)} → 409`, codeOf(r) === "409:TOTP_REQUIRED", codeOf(r));
    }
    const saDev = await login(sa.username, "mobile", {}, proven());
    check("§5b ⭐ süperadmin onaylı tabletten de 409 (cihaz muafiyeti yok)", codeOf(saDev) === "409:TOTP_REQUIRED", codeOf(saDev));
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "REQUIRED");

    // ── §6 masaüstü güvenilir cihaz ───────────────────────────────────────
    console.log("\n=== §6 masaüstü 'bu cihazı hatırla' (gövde belirteci) ===");
    const notes = () => prisma.notificationOutbox.count({ where: { kind: NEW_DEVICE_LOGIN_KIND, subjectId: withTotp.id } });
    const n0 = await notes();
    const first = await login(withTotp.username, "electron", { totpCode: await freshCode(withTotp.id, sTotp), rememberDevice: true });
    const token = String(first.body.data?.trustedDeviceToken ?? "");
    check("§6a ⭐ kod + hatırla → gövdede belirteç + deviceRemembered + newDevice", first.status === 200 && token.length >= 40 && first.body.data?.deviceRemembered === true && first.body.data?.newDevice === true, codeOf(first));
    check("§6b ⭐ yeni cihaz bildirimi yazıldı", (await notes()) === n0 + 1);
    const second = await login(withTotp.username, "electron", { trustedDeviceToken: token });
    check("§6c ⭐ belirteçle ikinci giriş kodsuz 200, bildirim yok", second.status === 200 && second.body.data?.newDevice === false && (await notes()) === n0 + 1, codeOf(second));
    const other = await login(optOut.username, "electron", { trustedDeviceToken: token });
    check("§6d ⭐ belirteç başka kullanıcıyla geçmez (409)", codeOf(other) === "409:TOTP_REQUIRED", codeOf(other));
    const plainRemember = await login(withTotp.username, "electron", { totpCode: await freshCode(withTotp.id, sTotp) });
    check("§6e işaretsiz kodlu giriş belirteç döndürmez", plainRemember.status === 200 && plainRemember.body.data?.trustedDeviceToken === undefined && plainRemember.body.data?.deviceRemembered === false, codeOf(plainRemember));
    await prisma.trustedDevice.updateMany({ where: { userId: withTotp.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "SELF" } });
    const revoked = await login(withTotp.username, "electron", { trustedDeviceToken: token });
    check("§6f ⭐ iptal sonrası belirteç geçmez (409)", codeOf(revoked) === "409:TOTP_REQUIRED", codeOf(revoked));
    const logs = await prisma.systemLog.findMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: [...ids, ...names] } }] }, });
    check("§6g belirteç hiçbir audit/log satırında yok", !JSON.stringify(logs).includes(token), `satır=${logs.length}`);
    const rows = await prisma.trustedDevice.findMany({ where: { userId: withTotp.id }, select: { tokenHash: true } });
    check("§6h DB'de yalnız özet", rows.length === 1 && !rows[0]!.tokenHash.includes(token));

    // ── §7 tablette yerinde yeniden bağlama onayı (bilerek kabul edilen yan etki) ──
    // device.controller onsite-approve aynı bağlamla çağırır: cihaz muafiyeti yok (uç EXEMPT_PATHS'te).
    console.log("\n=== §7 yerinde onay (verifyPasswordForApproval) aynı kurala bağlı ===");
    const approve = async (username: string, totp?: string): Promise<string> => {
      try {
        await AuthService.verifyPasswordForApproval(username, PASSWORD, { clientType: "mobile", totpCode: totp, totpCapable: true });
        return "200:";
      } catch (e) {
        const err = e as { statusCode?: number; details?: { code?: string } };
        return `${err.statusCode ?? "?"}:${String(err.details?.code ?? "")}`;
      }
    };
    hosted(true);
    await setting(SETTING_KEYS.AUTH_WEB_TOTP_POLICY, "REQUIRED");
    const a1 = await approve(plain.username);
    check("§7a ⭐ barındırılan REQUIRED: TOTP'siz yönetici onayda 403 TOTP_ENROLLMENT_REQUIRED", a1 === "403:TOTP_ENROLLMENT_REQUIRED", a1);
    const a2 = await approve(withTotp.username);
    check("§7b ⭐ barındırılan REQUIRED: TOTP'li yönetici kodsuz 409", a2 === "409:TOTP_REQUIRED", a2);
    const a3 = await approve(withTotp.username, await freshCode(withTotp.id, sTotp));
    check("§7c barındırılan: kodla onay geçer", a3 === "200:", a3);
    hosted(false);
    const a4 = await approve(plain.username);
    check("§7d LAN: TOTP'siz yönetici yalnız parolayla onaylar (bugünkü davranış)", a4 === "200:", a4);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    if (originalClass === undefined) delete process.env[INSTALL_CLASS_ENV]; else process.env[INSTALL_CLASS_ENV] = originalClass;
    if (originalWeb === undefined) delete process.env.WEB_DIST_DIR; else process.env.WEB_DIST_DIR = originalWeb;
    for (const key of keys) {
      const o = before.find((x) => x.key === key);
      if (!o) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => undefined);
      else await prisma.systemSetting.update({ where: { key }, data: { value: o.value as never } }).catch((e) => check(`ayar geri yükleme ${key}`, false, String(e)));
    }
    invalidateFeatureFlagsCache();
    if (deviceRowId) await prisma.device.deleteMany({ where: { id: deviceRowId } }).catch(() => undefined);
    if (deskRowId) await prisma.device.deleteMany({ where: { id: deskRowId } }).catch(() => undefined);
    await prisma.notificationOutbox.deleteMany({ where: { kind: NEW_DEVICE_LOGIN_KIND, subjectId: { in: ids } } }).catch(() => undefined);
    await prisma.trustedDevice.deleteMany({ where: { userId: { in: ids } } }).catch((e) => check("cihaz temizliği", false, String(e)));
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: [...ids, ...names] } }] } }).catch(() => undefined);
    await prisma.userPermission.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => check("fikstür temizliği", false, String(e)));
    setShortCredentialKeyDirForTests(null);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("BEKÇİ ÇÖKTÜ:", e);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 3;
});

// Negatif sondalar (2026-11-01, uygulandı + geri alındı):
//   S1 appliesHostedBearerRule hep false → §2a/§2b/§2c (15 kırmızı): kanal beyanı kuralı atlatır.
//   S2 cihaz muafiyetinden `!desktop` çıkarıldı → §4c kırmızı.
//   S3 cihaz muafiyetinden `!systemAccount` çıkarıldı → §5b kırmızı.
//   S4 hostedBearerLoginContext belirteci çerezden okur → §6c kırmızı.
//   S5 approvedDeviceProven'dan cihaz türü koşulu çıkarıldı → §4f kırmızı (kanıtlı DESKTOP kaydı mobil beyanıyla 200).
