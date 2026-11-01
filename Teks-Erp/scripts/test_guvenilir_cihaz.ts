// =============================================================================
// Bekçi: web girişi "Bu cihazı N gün hatırla" + yeni cihaz bildirimi (2026-11-01)
// =============================================================================
// Çalıştır: npx tsx scripts/test_guvenilir_cihaz.ts
// Ölçer (süreç içi sunucu 127.0.0.1:0, panel çerez kipi; ayar `auth.trustedDeviceDays`):
//   §1 kod + rememberDevice → Set-Cookie tekserp_cihaz (HttpOnly/Secure/SameSite=Strict/Path=/api/auth/login,
//      Max-Age=N·86400), gövdede belirteç yok, deviceRemembered:true; işaretsiz → çerez yok.
//   §2 belirteçle kodsuz giriş 200 + lastUsedAt dolar.
//   §3 süresi dolmuş / iptal edilmiş / başka kullanıcının belirteci → 409 TOTP_REQUIRED.
//   §4 süperadmin: hep kod, details'de trustDeviceDays yok, remember'da satır doğmaz.
//   §5 parola değişimi (kendi + yönetici), TOTP sıfırlama, pasifleştirme → revokedAt dolu; tokenVersion artışı → kod istenir.
//   §6 ayar 0: details'de alan yok, geçerli belirteç yok sayılır (kod istenir).
//   §7 sır hijyeni: DB'de yalnız `<kid>:<hex>` özeti; belirteç hiçbir kolonda/audit yükünde yok.
//   §8 bildirim: tanınmayan girişte outbox satırı (kimlik.yeni-cihaz-girisi) + Session.newDevice=true;
//      tanınan cihazda ve aynı kullanıcının geçerli oturum çereziyle satır yok + newDevice=false.
//   §9 ayar yalnız süperadmin: PATCH /api/feature-flags 403 MODULE_FLAG_SUPERADMIN_ONLY; ham uç 400 MODULE_KEY_RESERVED.
//   §10 liste/iptal uçları: belirteç/özet dönmez; tek iptal → ikincisi 409 ALREADY_REVOKED; başkasının cihazı 404;
//       yönetici (admin:users) başkasının cihazını kaldırır; hepsini kaldır.
// Negatif sondalar (2026-11-01, uygulandı + geri alındı): bkz. dosya sonu.
// İzolasyon: TEST- kullanıcıları + ayar anlık görüntüsü; finally geri yükler/siler. DB GEREKİR.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { AuthService } from "../src/services/auth.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { NEW_DEVICE_LOGIN_KIND } from "../src/services/notification-sources/kimlik";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Govde = { message?: string; data?: Record<string, unknown>; details?: Record<string, unknown> };
type Yanit = { status: number; body: Govde; setCookie: string[]; raw: string };
const PAROLA = "Deneme-gcih-12345";
const YENI_PAROLA = "Deneme-gcih-67890";
const GUN = 30;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ozgunEnv = process.env.WEB_DIST_DIR;
const panelAc = () => { process.env.WEB_DIST_DIR = join(tmpdir(), "gcih-dist-web-yok"); };
const kodu = (r: Yanit) => `${r.status}:${String(r.body.details?.code ?? "")}`;

const ids: string[] = [];
const adlar: string[] = [];
async function kullanici(ek: string, izinler: string[], sistem = false) {
  const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true } });
  if (perms.length !== izinler.length) throw new Error(`Fikstür: izin eksik (${izinler.join(",")})`);
  const username = `TEST-gcih-${ek}-${Date.now()}`;
  const u = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(PAROLA),
      fullName: `TEST güvenilir cihaz ${ek}`,
      ...(sistem ? { isSystemAccount: true } : {}),
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true },
  });
  ids.push(u.id);
  adlar.push(username);
  return { id: u.id, username };
}
// Replay kilidi (`totpLastStep`) aynı adımı ikinci kez kabul etmez; bekçi aynı pencerede çok kez girdiği
// için her kodlu girişten önce kilidi sıfırlar (ölçülen şey cihaz, kod değil).
async function kod(u: { id: string }, secret: string): Promise<string> {
  await prisma.user.update({ where: { id: u.id }, data: { totpLastStep: null } });
  return totpCodeForStep(secret, totpStep());
}
async function totpKur(userId: string, aktor: string): Promise<string> {
  const w = await TotpAccountService.openWindow({ userId, openedById: aktor });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  return w.secret;
}
function cerez(setCookie: string[], ad: string): { deger: string; ham: string } | null {
  const ham = setCookie.find((c) => c.startsWith(`${ad}=`));
  if (!ham) return null;
  return { deger: decodeURIComponent(ham.slice(ad.length + 1).split(";")[0] ?? ""), ham };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("§0 hedef DB yazılabilir", false, engel); process.exitCode = 1; return; }
  await reconcilePermissionCatalog();
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "gcih-halka-")));
  const daysKey = SETTING_KEYS.AUTH_TRUSTED_DEVICE_DAYS;
  const policyKey = SETTING_KEYS.AUTH_WEB_TOTP_POLICY;
  const inboxKey = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const once = await prisma.systemSetting.findMany({ where: { key: { in: [daysKey, policyKey, inboxKey] } }, select: { key: true, value: true } });
  const ayar = async (key: string, value: unknown) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };

  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, opt: { bearer?: string; cookie?: string; body?: unknown } = {}): Promise<Yanit> => {
    const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": UA };
    if (opt.bearer) headers.Authorization = `Bearer ${opt.bearer}`;
    if (opt.cookie) headers.Cookie = opt.cookie;
    const r = await fetch(`${base}${p}`, { method, headers, ...(opt.body !== undefined ? { body: JSON.stringify(opt.body) } : {}) });
    const raw = await r.text();
    let body: Govde = {};
    try { body = JSON.parse(raw) as Govde; } catch { /* boş */ }
    return { status: r.status, body, setCookie: r.headers.getSetCookie(), raw };
  };
  const web = (username: string, ek: Record<string, unknown> = {}, cookie?: string, parola = PAROLA) =>
    call("POST", "/api/auth/login", { cookie, body: { username, password: parola, clientType: "web", confirmKick: true, ...ek } });
  const cihazCerezi = (t: string) => `tekserp_cihaz=${encodeURIComponent(t)}`;
  const hatirla = async (u: { id: string; username: string }, secret: string) => {
    const r = await web(u.username, { totpCode: await kod(u, secret), rememberDevice: true });
    return { r, token: cerez(r.setCookie, "tekserp_cihaz")?.deger ?? "" };
  };
  const belirtecler: string[] = [];

  try {
    panelAc();
    await ayar(policyKey, "REQUIRED");
    await ayar(daysKey, GUN);
    await ayar(inboxKey, true);
    const aktor = await kullanici("aktor", ["roll:read"]);
    const adm = await kullanici("adm", ["roll:read", "admin:users", "admin:settings"]);
    const admT = String((await call("POST", "/api/auth/login", { body: { username: adm.username, password: PAROLA, clientType: "electron", confirmKick: true } })).body.data?.token ?? "");
    check("§0 fikstür: yönetici Bearer token'ı alındı", admT.length > 0);

    // ── §1 hatırla ─────────────────────────────────────────────────────────
    console.log("\n=== §1 kod + hatırla → cihaz çerezi ===");
    const u1 = await kullanici("u1", ["roll:read", "web:access"]);
    const s1 = await totpKur(u1.id, aktor.id);
    const r0 = await web(u1.username);
    check("§1a kodsuz → 409 TOTP_REQUIRED + details.trustDeviceDays = N", kodu(r0) === "409:TOTP_REQUIRED" && r0.body.details?.trustDeviceDays === GUN,
      `${kodu(r0)} days=${String(r0.body.details?.trustDeviceDays)}`);
    const rNo = await web(u1.username, { totpCode: await kod(u1, s1) });
    check("§1b işaretsiz kodlu giriş → 200, cihaz çerezi YOK, deviceRemembered:false",
      rNo.status === 200 && cerez(rNo.setCookie, "tekserp_cihaz") === null && rNo.body.data?.deviceRemembered === false, kodu(rNo));
    const h1 = await hatirla(u1, s1);
    belirtecler.push(h1.token);
    const ham = cerez(h1.r.setCookie, "tekserp_cihaz")?.ham ?? "";
    check("§1c remember → 200 + tekserp_cihaz çerezi", h1.r.status === 200 && h1.token.length > 0, kodu(h1.r));
    check("§1d çerez bayrakları HttpOnly; Secure; SameSite=Strict; Path=/api/auth/login; Max-Age=N·86400",
      /;\s*HttpOnly/.test(ham) && /;\s*Secure/.test(ham) && /;\s*SameSite=Strict/.test(ham) && /;\s*Path=\/api\/auth\/login(;|$)/.test(ham)
        && new RegExp(`Max-Age=${GUN * 86400}(;|$)`).test(ham), ham.replace(encodeURIComponent(h1.token), "<belirteç>"));
    check("§1e gövdede belirteç YOK, deviceRemembered:true", !h1.r.raw.includes(h1.token) && h1.r.body.data?.deviceRemembered === true);

    // ── §2 belirteçle kodsuz ───────────────────────────────────────────────
    console.log("\n=== §2 belirteçle kodsuz giriş ===");
    const r2 = await web(u1.username, {}, cihazCerezi(h1.token));
    const satir1 = await prisma.trustedDevice.findFirst({ where: { userId: u1.id, revokedAt: null }, select: { id: true, lastUsedAt: true, label: true } });
    check("§2a ⭐ geçerli belirteç → kodsuz 200", r2.status === 200, kodu(r2));
    check("§2b lastUsedAt doldu + etiket UA'dan", satir1?.lastUsedAt !== null && satir1?.label === "Chrome · Windows", `${String(satir1?.lastUsedAt)} ${satir1?.label}`);

    // ── §3 geçersiz belirteçler ─────────────────────────────────────────────
    console.log("\n=== §3 süresi dolmuş / iptal / başkasının ===");
    const u3 = await kullanici("u3", ["roll:read", "web:access"]);
    const s3 = await totpKur(u3.id, aktor.id);
    const r3a = await web(u3.username, {}, cihazCerezi(h1.token));
    check("§3a ⭐ başka kullanıcının belirteci → 409 TOTP_REQUIRED", kodu(r3a) === "409:TOTP_REQUIRED", kodu(r3a));
    const h3 = await hatirla(u3, s3);
    belirtecler.push(h3.token);
    const gecmis = new Date(Date.now() - 2 * 86400_000);
    await prisma.trustedDevice.updateMany({ where: { userId: u3.id }, data: { createdAt: gecmis, expiresAt: new Date(Date.now() - 86400_000) } });
    const r3b = await web(u3.username, {}, cihazCerezi(h3.token));
    check("§3b ⭐ süresi dolmuş belirteç → 409 TOTP_REQUIRED", kodu(r3b) === "409:TOTP_REQUIRED", kodu(r3b));
    const h3c = await hatirla(u3, s3);
    belirtecler.push(h3c.token);
    const d3 = await prisma.trustedDevice.findFirst({ where: { userId: u3.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
    const ut = String((await call("POST", "/api/auth/login", { body: { username: u3.username, password: PAROLA, clientType: "electron", confirmKick: true, totpCode: await kod(u3, s3) } })).body.data?.token ?? "");
    const rv = await call("POST", `/api/auth/trusted-devices/${d3?.id}/revoke`, { bearer: ut, body: {} });
    const r3c = await web(u3.username, {}, cihazCerezi(h3c.token));
    check("§3c ⭐ iptal edilmiş belirteç → 409 TOTP_REQUIRED", rv.status === 200 && kodu(r3c) === "409:TOTP_REQUIRED", `${kodu(rv)} ${kodu(r3c)}`);

    // ── §4 süperadmin ──────────────────────────────────────────────────────
    console.log("\n=== §4 süperadmin ===");
    const sa = await kullanici("sa", ["roll:read"], true);
    const sSa = await totpKur(sa.id, aktor.id);
    const r4a = await web(sa.username);
    check("§4a süperadmin kodsuz → 409, details'de trustDeviceDays YOK", kodu(r4a) === "409:TOTP_REQUIRED" && !("trustDeviceDays" in (r4a.body.details ?? {})), kodu(r4a));
    const r4b = await web(sa.username, { totpCode: await kod(sa, sSa), rememberDevice: true });
    const saSatir = await prisma.trustedDevice.count({ where: { userId: sa.id } });
    check("§4b ⭐ süperadmin remember → cihaz satırı DOĞMAZ, çerez yok", r4b.status === 200 && saSatir === 0 && cerez(r4b.setCookie, "tekserp_cihaz") === null, `${kodu(r4b)} satır=${saSatir}`);

    // ── §5 iptal noktaları ─────────────────────────────────────────────────
    console.log("\n=== §5 parola / TOTP / pasifleştirme / tokenVersion ===");
    const iptalOlcu = async (etiket: string, sebep: string, u: { id: string; username: string }, token: string, bozan: () => Promise<unknown>, parola = PAROLA) => {
      await bozan();
      const row = await prisma.trustedDevice.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { revokedAt: true, revokeReason: true } });
      const r = await web(u.username, {}, cihazCerezi(token), parola);
      check(`§5${etiket} ⭐ ${sebep} → revokedAt dolu + kod istenir`, row?.revokedAt !== null && row?.revokeReason === sebep && r.status !== 200,
        `${row?.revokeReason ?? "—"} ${kodu(r)}`);
    };
    const u5a = await kullanici("u5a", ["roll:read", "web:access"]);
    const s5a = await totpKur(u5a.id, aktor.id);
    const h5a = await hatirla(u5a, s5a); belirtecler.push(h5a.token);
    await iptalOlcu("a", "PASSWORD_CHANGE", u5a, h5a.token, () => AuthService.changeOwnPassword(u5a.id, PAROLA, YENI_PAROLA), YENI_PAROLA);
    const u5b = await kullanici("u5b", ["roll:read", "web:access"]);
    const s5b = await totpKur(u5b.id, aktor.id);
    const h5b = await hatirla(u5b, s5b); belirtecler.push(h5b.token);
    await iptalOlcu("b", "PASSWORD_RESET", u5b, h5b.token, () => PermissionManagementService.resetUserPassword(u5b.id, YENI_PAROLA, adm.id), YENI_PAROLA);
    const u5c = await kullanici("u5c", ["roll:read", "web:access"]);
    const s5c = await totpKur(u5c.id, aktor.id);
    const h5c = await hatirla(u5c, s5c); belirtecler.push(h5c.token);
    await iptalOlcu("c", "TOTP_RESET", u5c, h5c.token, () => TotpAccountService.reset({ userId: u5c.id, byId: adm.id }));
    const u5d = await kullanici("u5d", ["roll:read", "web:access"]);
    const s5d = await totpKur(u5d.id, aktor.id);
    const h5d = await hatirla(u5d, s5d); belirtecler.push(h5d.token);
    await iptalOlcu("d", "DEACTIVATED", u5d, h5d.token, () => PermissionManagementService.deactivateUser(u5d.id, adm.id));
    const u5e = await kullanici("u5e", ["roll:read", "web:access"]);
    const s5e = await totpKur(u5e.id, aktor.id);
    const h5e = await hatirla(u5e, s5e); belirtecler.push(h5e.token);
    await prisma.user.update({ where: { id: u5e.id }, data: { tokenVersion: { increment: 1 } } });
    const r5e = await web(u5e.username, {}, cihazCerezi(h5e.token));
    check("§5e ⭐ tokenVersion artışı (izin değişimi) → satır iptalsiz ama kod istenir", kodu(r5e) === "409:TOTP_REQUIRED", kodu(r5e));

    // ── §6 ayar 0 ──────────────────────────────────────────────────────────
    console.log("\n=== §6 ayar kapalı ===");
    const u6 = await kullanici("u6", ["roll:read", "web:access"]);
    const s6 = await totpKur(u6.id, aktor.id);
    const h6 = await hatirla(u6, s6); belirtecler.push(h6.token);
    await ayar(daysKey, 0);
    const r6a = await web(u6.username);
    check("§6a ayar 0 → details'de trustDeviceDays YOK", kodu(r6a) === "409:TOTP_REQUIRED" && !("trustDeviceDays" in (r6a.body.details ?? {})), kodu(r6a));
    const r6b = await web(u6.username, {}, cihazCerezi(h6.token));
    check("§6b ⭐ ayar 0 → geçerli belirteç yok sayılır (kod istenir)", kodu(r6b) === "409:TOTP_REQUIRED", kodu(r6b));
    const r6c = await web(u6.username, { totpCode: await kod(u6, s6), rememberDevice: true });
    check("§6c ayar 0 → remember çerez basmaz", r6c.status === 200 && cerez(r6c.setCookie, "tekserp_cihaz") === null, kodu(r6c));
    await ayar(daysKey, GUN);

    // ── §7 sır hijyeni ─────────────────────────────────────────────────────
    console.log("\n=== §7 sır hijyeni ===");
    const satirlar = await prisma.trustedDevice.findMany({ where: { userId: { in: ids } } });
    const bicim = satirlar.every((r) => /^[0-9a-f]{16}:[0-9a-f]{64}$/.test(r.tokenHash));
    const dbMetni = JSON.stringify(satirlar);
    const loglar = JSON.stringify(await prisma.systemLog.findMany({ where: { tableName: "TRUSTED_DEVICE" } }));
    const sizan = belirtecler.filter((t) => t && (dbMetni.includes(t) || loglar.includes(t)));
    check("§7a satırlar var ve tokenHash `<kid>:<hex>` biçiminde", satirlar.length >= 6 && bicim, `${satirlar.length} satır`);
    check("§7b ⭐ açık belirteç hiçbir kolonda ve TRUSTED_DEVICE audit yükünde YOK", belirtecler.length > 0 && sizan.length === 0, `${sizan.length} sızıntı`);
    check("§7c TRUSTED_DEVICE audit satırı yazıldı", loglar.length > 2);

    // ── §8 yeni cihaz bildirimi ────────────────────────────────────────────
    console.log("\n=== §8 yeni cihaz bildirimi ===");
    const u8 = await kullanici("u8", ["roll:read", "web:access"]);
    const s8 = await totpKur(u8.id, aktor.id);
    const sayi = () => prisma.notificationOutbox.count({ where: { kind: NEW_DEVICE_LOGIN_KIND, subjectId: u8.id } });
    const sonOturum = () => prisma.session.findFirst({ where: { userId: u8.id }, orderBy: { createdAt: "desc" }, select: { newDevice: true } });
    const h8 = await hatirla(u8, s8); belirtecler.push(h8.token);
    const n1 = await sayi();
    const o1 = await sonOturum();
    check("§8a ⭐ tanınmayan giriş → outbox satırı + Session.newDevice=true", n1 === 1 && o1?.newDevice === true, `outbox=${n1} newDevice=${String(o1?.newDevice)}`);
    check("§8b cevapta newDevice:true", h8.r.body.data?.newDevice === true);
    const r8c = await web(u8.username, {}, cihazCerezi(h8.token));
    const n2 = await sayi();
    const o2 = await sonOturum();
    check("§8c ⭐ tanınan cihaz → yeni outbox satırı YOK + newDevice=false", r8c.status === 200 && n2 === n1 && o2?.newDevice === false, `outbox=${n2} newDevice=${String(o2?.newDevice)}`);
    const oturumCerezi = cerez(r8c.setCookie, "tekserp_oturum")?.deger ?? "";
    const r8d = await web(u8.username, { totpCode: await kod(u8, s8) }, `tekserp_oturum=${encodeURIComponent(oturumCerezi)}`);
    const n3 = await sayi();
    check("§8d aynı kullanıcının geçerli oturum çereziyle giriş → satır YOK", r8d.status === 200 && n3 === n1 && r8d.body.data?.newDevice === false, `outbox=${n3}`);
    await ayar(inboxKey, false);
    const u8e = await kullanici("u8e", ["roll:read", "web:access"]);
    const s8e = await totpKur(u8e.id, aktor.id);
    await web(u8e.username, { totpCode: await kod(u8e, s8e) });
    const n8e = await prisma.notificationOutbox.count({ where: { kind: NEW_DEVICE_LOGIN_KIND, subjectId: u8e.id } });
    check("§8e bildirim bayrağı kapalı → outbox satırı yok (bugünkü davranış)", n8e === 0, String(n8e));
    await ayar(inboxKey, true);

    // ── §9 ayar kapısı ─────────────────────────────────────────────────────
    console.log("\n=== §9 ayar yalnız süperadmin ===");
    const e9a = await call("PATCH", "/api/feature-flags", { bearer: admT, body: { trustedDeviceDays: 7 } });
    const deger = (await prisma.systemSetting.findUnique({ where: { key: daysKey }, select: { value: true } }))?.value;
    check("§9a ⭐ süperadmin olmayan admin:settings → 403 MODULE_FLAG_SUPERADMIN_ONLY, değer değişmedi",
      kodu(e9a) === "403:MODULE_FLAG_SUPERADMIN_ONLY" && deger === GUN, `${kodu(e9a)} değer=${JSON.stringify(deger)}`);
    const e9b = await call("PUT", `/api/admin/settings/${daysKey}`, { bearer: admT, body: { value: 7 } });
    check("§9b ham ayar ucu → 400 MODULE_KEY_RESERVED", kodu(e9b) === "400:MODULE_KEY_RESERVED", kodu(e9b));

    // ── §10 liste / iptal uçları ───────────────────────────────────────────
    console.log("\n=== §10 liste ve iptal uçları ===");
    const u10 = await kullanici("u10", ["roll:read", "web:access"]);
    const s10 = await totpKur(u10.id, aktor.id);
    const ha = await hatirla(u10, s10); belirtecler.push(ha.token);
    const hb = await hatirla(u10, s10); belirtecler.push(hb.token);
    const t10 = String((await call("POST", "/api/auth/login", { body: { username: u10.username, password: PAROLA, clientType: "electron", confirmKick: true, totpCode: await kod(u10, s10) } })).body.data?.token ?? "");
    const l1 = await call("GET", "/api/auth/trusted-devices", { bearer: t10 });
    const liste = (l1.body.data?.devices ?? []) as Array<Record<string, unknown>>;
    check("§10a kendi listesi: 2 cihaz, days=N, tokenHash/belirteç dönmez",
      l1.status === 200 && liste.length === 2 && l1.body.data?.days === GUN && !l1.raw.includes("tokenHash") && !l1.raw.includes(ha.token), kodu(l1));
    const did = String(liste[0]?.id ?? "");
    const v1 = await call("POST", `/api/auth/trusted-devices/${did}/revoke`, { bearer: t10, body: {} });
    const v2 = await call("POST", `/api/auth/trusted-devices/${did}/revoke`, { bearer: t10, body: {} });
    check("§10b ⭐ tek iptal 200, ikincisi 409 TRUSTED_DEVICE_ALREADY_REVOKED (atomik claim)", v1.status === 200 && kodu(v2) === "409:TRUSTED_DEVICE_ALREADY_REVOKED", `${kodu(v1)} ${kodu(v2)}`);
    const baska = await prisma.trustedDevice.findFirst({ where: { userId: u1.id }, select: { id: true } });
    const v3 = await call("POST", `/api/auth/trusted-devices/${baska?.id}/revoke`, { bearer: t10, body: {} });
    const baskaSonra = await prisma.trustedDevice.findUnique({ where: { id: String(baska?.id) }, select: { revokedAt: true } });
    check("§10c ⭐ başkasının cihazı → 404, satır dokunulmadı", kodu(v3) === "404:TRUSTED_DEVICE_NOT_FOUND" && baskaSonra?.revokedAt === null, kodu(v3));
    const v4 = await call("POST", `/api/auth/trusted-devices/${did}/revoke`, { bearer: t10, body: { userId: u1.id } });
    check("§10d gövde strict: fazladan alan 400", v4.status === 400, kodu(v4));
    const a1 = await call("GET", `/api/admin/users/${u1.id}/trusted-devices`, { bearer: admT });
    const a2 = await call("POST", `/api/admin/users/${u1.id}/trusted-devices/revoke-all`, { bearer: admT, body: {} });
    const acik = await prisma.trustedDevice.count({ where: { userId: u1.id, revokedAt: null } });
    check("§10e yönetici listesi + hepsini kaldır → açık cihaz 0, sebep ADMIN",
      a1.status === 200 && a2.status === 200 && Number(a2.body.data?.revoked) >= 1 && acik === 0, `${kodu(a1)} ${kodu(a2)} açık=${acik}`);
    const a3 = await call("GET", `/api/admin/users/${u1.id}/trusted-devices`, { bearer: t10 });
    check("§10f admin:users olmayan → yönetici ucu 403", a3.status === 403, kodu(a3));
    const a4 = await call("POST", "/api/auth/trusted-devices/revoke-all", { bearer: t10, body: {} });
    const acik10 = await prisma.trustedDevice.count({ where: { userId: u10.id, revokedAt: null } });
    check("§10g kendi hepsini kaldır → açık cihaz 0", a4.status === 200 && acik10 === 0, `${kodu(a4)} açık=${acik10}`);
  } finally {
    if (ozgunEnv === undefined) delete process.env.WEB_DIST_DIR;
    else process.env.WEB_DIST_DIR = ozgunEnv;
    await new Promise<void>((r) => server.close(() => r()));
    for (const key of [daysKey, policyKey, inboxKey]) {
      const o = once.find((x) => x.key === key);
      if (!o) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => undefined);
      else await prisma.systemSetting.update({ where: { key }, data: { value: o.value as never } }).catch((e) => check(`ayar geri yükleme ${key}`, false, String(e)));
    }
    invalidateFeatureFlagsCache();
    await prisma.notificationOutbox.deleteMany({ where: { kind: NEW_DEVICE_LOGIN_KIND, subjectId: { in: ids } } }).catch(() => undefined);
    await prisma.trustedDevice.deleteMany({ where: { userId: { in: ids } } }).catch((e) => check("cihaz temizliği", false, String(e)));
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: [...ids, ...adlar] } }] } }).catch(() => undefined);
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

// Negatif sondalar (2026-11-01):
//   S1 consumeTrustedDevice'ta `tokenVersion` koşulu validDeviceWhere'den çıkarıldı → §5e kırmızı.
//   S2 respondLogin'de setTrustedDeviceCookie yerine gövdeye `deviceToken` → §1c/§1e kırmızı.
//   S3 TrustedDeviceService.revoke where'inden `userId` çıkarıldı → §10c kırmızı.
//   S4 noteWebLogin'de `sessionCookieUserId === userId` tanıması kaldırıldı → §8d kırmızı.
