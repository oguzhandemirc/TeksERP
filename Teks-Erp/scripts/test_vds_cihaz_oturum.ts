/**
 * VDS barındırma sertleştirmesi — cihaz duyurusu, oturum, bilgi yüzeyi, etiket test ucu
 * (denetim 2026-11-01: O3 · O2 kısmi · D1 · D3; D7 `test_jwt_sir_kapisi` §5h–j).
 *
 *   §1 O3 kaynak tavanı: barındırılanda aynı kaynaktan 6. bekleyen duyuru 429
 *      PENDING_DEVICE_SOURCE_LIMIT; başka kaynak açılır; LAN'da tavan yok; doğuş olayında `ip`.
 *   §2 O3 süre aşımı: 24 saati geçmiş, hiç onaylanmamış PENDING pasife düşer (satır kalır);
 *      geri alınmış (REVOKED) ve taze cihaz düşmez; LAN'da no-op.
 *   §3 O3 toplu reddet: yalnız bekleyenleri pasife alır; liste `announcedFrom` taşır.
 *   §4 O3 PIN cihaz geneli kova yalnız barındırılanda; hızlı PIN akışı bağlı.
 *   §5 O2: barındırılanda autoLogoutOnExpiry okunuşu true, false yazımı 409; masaüstü/tarayıcı
 *      oturumu ≤ 24 saat, mobil ve LAN dokunulmaz.
 *   §6 D1: discovery barındırılanda firma/makine adı ve sürüm vermez, LAN'da bayt-aynı;
 *      login-methods kimliksize lisans bayrağı ve firma adı vermez, onaylı cihaza tam.
 *   §7 D3: test ucu hedef süzgeci (döngü, metadata, dış IP, ad, izinsiz port ret; LAN yazıcısı geçer);
 *      barındırılanda nativeSendEnabled okunuşu false, true yazımı 409.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { DeviceService } from "../src/services/device.service";
import {
  expireStalePendingDevices, rejectPendingDevices, MAX_PENDING_DEVICES_PER_SOURCE, PENDING_DEVICE_TTL_MS,
} from "../src/services/helpers/device-pending-guard.helper";
import { INSTALL_CLASS_ENV } from "../src/services/helpers/install-class.helper";
import {
  SETTING_KEYS, readAutoLogoutOnExpiry, readLabelNativeSendEnabled, systemSettingService,
} from "../src/services/system-setting.service";
import { hostedDesktopSessionMinutes, HOSTED_DESKTOP_SESSION_MAX_MINUTES } from "../src/services/auth.service";
import { buildDiscoveryIdentity } from "../src/services/discovery.service";
import { redactLoginMethods } from "../src/services/helpers/hosted-public-surface.helper";
import { printerTestTargetRefusal } from "../src/services/helpers/printer-target-guard.helper";
import { pinDeviceLockoutKeys } from "../src/middlewares/login-lockout";
import { APP_VERSION } from "../src/lib/app-version";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}
const ROOT = join(__dirname, "..");
const src = (p: string): string => readFileSync(join(ROOT, p), "utf8");
const codeOf = (e: unknown): unknown => (e instanceof AppError ? e.details?.code : undefined);

const savedClass = process.env[INSTALL_CLASS_ENV];
function setHosted(on: boolean): void {
  if (on) process.env[INSTALL_CLASS_ENV] = "BARINDIRILAN";
  else delete process.env[INSTALL_CLASS_ENV];
}

// Kapı yazmadan ÖNCE reddeder; gerilemede yazılan ayar satırı `finally`de birebir geri konur.
const PROBE_USER = randomUUID();
const GUARDED_KEYS = [SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY, SETTING_KEYS.LABEL_NATIVE_SEND_ENABLED];
const PREFIX = `TEST-VDSO3-${Date.now().toString(36)}`;
const SRC_A = "203.0.113.7";
const SRC_B = "2001:db8:1:2::/64";

async function announceErr(deviceId: string, source: string): Promise<unknown> {
  try {
    await DeviceService.announce({ deviceId, source });
    return null;
  } catch (e) {
    return e;
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exitCode = 1;
    return;
  }
  const savedSettings = await prisma.systemSetting.findMany({ where: { key: { in: GUARDED_KEYS } } });
  try {
    // ---------------------------------------------------------------- §1
    setHosted(true);
    const ids: string[] = [];
    for (let i = 0; i < MAX_PENDING_DEVICES_PER_SOURCE; i++) {
      const id = `${PREFIX}-a${i}`;
      ids.push(id);
      const e = await announceErr(id, SRC_A);
      if (e) check(`§1 hazırlık duyurusu ${i + 1}`, false, String(e));
    }
    const sixth = await announceErr(`${PREFIX}-a9`, SRC_A);
    check(
      `§1a ⭐ barındırılanda aynı kaynaktan ${MAX_PENDING_DEVICES_PER_SOURCE + 1}. bekleyen duyuru 429 PENDING_DEVICE_SOURCE_LIMIT`,
      sixth instanceof AppError && sixth.statusCode === 429 && codeOf(sixth) === "PENDING_DEVICE_SOURCE_LIMIT",
      String(sixth),
    );
    check("§1b başka kaynak (IPv6 /64) etkilenmez", (await announceErr(`${PREFIX}-b0`, SRC_B)) === null);
    const known = await announceErr(ids[0], SRC_A);
    check("§1c bilinen cihazın canlılık duyurusu tavana takılmaz", known === null, String(known));
    const ev = await prisma.deviceBindingEvent.findFirst({ where: { localId: ids[0], event: "REGISTERED" }, select: { meta: true } });
    check("§1d doğuş olayı kaynağı taşır (meta.ip)", (ev?.meta as Record<string, unknown> | null)?.ip === SRC_A);
    setHosted(false);
    check("§1e LAN'da kaynak tavanı yok (6. duyuru açılır)", (await announceErr(`${PREFIX}-l0`, SRC_A)) === null);

    // ---------------------------------------------------------------- §2
    setHosted(true);
    const old = new Date(Date.now() - PENDING_DEVICE_TTL_MS - 60_000);
    await prisma.device.updateMany({ where: { deviceId: { in: [ids[0], ids[1]] } }, data: { createdAt: old, lastSeenAt: old } });
    const usedId = `${PREFIX}-s0`; // eski doğuş ama taze görülme: onaysız parola girişiyle kullanılan tablet
    await announceErr(usedId, SRC_B);
    await prisma.device.updateMany({ where: { deviceId: usedId }, data: { createdAt: old, lastSeenAt: new Date() } });
    const revoked = await prisma.device.findUniqueOrThrow({ where: { deviceId: ids[1] }, select: { id: true } });
    await DeviceService.revoke(revoked.id); // REVOKED olayı → "hiç onaylanmamış" değil
    setHosted(false);
    check("§2a LAN'da süre aşımı turu no-op", (await expireStalePendingDevices()) === 0);
    setHosted(true);
    const n = await expireStalePendingDevices();
    const rows = await prisma.device.findMany({ where: { deviceId: { in: [ids[0], ids[1], ids[2]] } }, select: { deviceId: true, isActive: true, status: true } });
    const by = new Map(rows.map((r) => [r.deviceId, r]));
    check("§2b ⭐ 24 saati geçmiş PENDING pasife düştü (satır silinmedi, durum PENDING kaldı)", n >= 1 && by.get(ids[0])?.isActive === false && by.get(ids[0])?.status === "PENDING", `n=${n}`);
    check("§2c geri alınmış (REVOKED) cihaz süre aşımına düşmez", by.get(ids[1])?.isActive === true);
    check("§2d taze PENDING düşmez", by.get(ids[2])?.isActive === true);
    const used = await prisma.device.findUnique({ where: { deviceId: usedId }, select: { isActive: true } });
    check("§2g ⭐ son görülmesi taze (kullanılan) PENDING düşmez", used?.isActive === true);
    check("§2e ikinci tur aynı satırı yeniden saymaz", (await prisma.device.count({ where: { deviceId: ids[0], isActive: false } })) === 1 && (await expireStalePendingDevices()) === 0);
    check("§2f süre aşımı kaynağın tavanını boşaltır (yeni duyuru açılır)", (await announceErr(`${PREFIX}-a10`, SRC_A)) === null);

    // ---------------------------------------------------------------- §3
    const r2 = await prisma.device.findUniqueOrThrow({ where: { deviceId: ids[2] }, select: { id: true } });
    const r3 = await prisma.device.findUniqueOrThrow({ where: { deviceId: ids[3] }, select: { id: true } });
    const gone = await prisma.device.findUniqueOrThrow({ where: { deviceId: ids[0] }, select: { id: true } });
    const res = await rejectPendingDevices([r2.id, r3.id, gone.id]);
    check("§3a ⭐ toplu reddet yalnız bekleyenleri pasife alır", res.rejected.length === 2 && res.rejected.includes(r2.id) && !res.rejected.includes(gone.id), JSON.stringify(res));
    const list = await DeviceService.list();
    const row = list.find((d) => d.deviceId === ids[4]) as { announcedFrom?: string | null; createdAt?: Date; hwSource?: string | null } | undefined;
    check("§3b liste duyuru kaynağını, ilk görülmeyi ve donanım kaynağını taşır", row?.announcedFrom === SRC_A && row?.createdAt instanceof Date && row !== undefined && "hwSource" in row);
    check("§3c liste ham olay satırı taşımaz", list.every((d) => !("bindingEvents" in d)));
    // Pasif PENDING çöpü (süre aşımı/red birikimi) liste tavanını doldurunca onaylı cihaz düşmemeli.
    const approvedId = `${PREFIX}-ok`;
    await prisma.device.create({ data: { deviceId: approvedId, name: "VDS onaylı", status: "APPROVED", createdAt: new Date(Date.now() - 7 * PENDING_DEVICE_TTL_MS) } });
    await prisma.device.createMany({ data: Array.from({ length: 510 }, (_, i) => ({ deviceId: `${PREFIX}-z${i}`, name: "çöp", isActive: false })) });
    check("§3e ⭐ 500+ pasif PENDING varken onaylı cihaz listede kalır", (await DeviceService.list()).some((d) => d.deviceId === approvedId));
    const routes = src("src/routes/device.routes.ts");
    check("§3d toplu reddet ucu admin:settings ister", /deviceAdminRouter\.post\("\/pending\/reject", verifyToken, requirePermission\("admin:settings"\)/.test(routes));

    // ---------------------------------------------------------------- §4
    check("§4a PIN cihaz geneli kova barındırılanda var", JSON.stringify(pinDeviceLockoutKeys("dev-1", true).map((k) => k.key)) === '["pin-dev:dev-1"]');
    check("§4b LAN'da ve cihazsız istekte kova yok", pinDeviceLockoutKeys("dev-1", false).length === 0 && pinDeviceLockoutKeys(null, true).length === 0);
    check("§4c hızlı PIN kilidi cihaz kovasını onaylı cihazdan bağlar", /\.\.\.pinDeviceLockoutKeys\(req\.device\?\.deviceId\)/.test(src("src/controllers/auth.controller.ts")));
    check("§4d duyuru ucu kaynağı servise geçirir", /DeviceService\.announce\(\{ \.\.\.body, source: resolveRequestSourceKey\(req\) \}\)/.test(src("src/controllers/device.controller.ts")));
    check("§4e süre aşımı zamanlayıcısı açılışta kurulur", /startPendingDeviceExpiryScheduler\(\)/.test(src("src/server.ts")));

    // ---------------------------------------------------------------- §5
    setHosted(true);
    check("§5a barındırılanda autoLogoutOnExpiry okunuşu true", (await readAutoLogoutOnExpiry()) === true);
    let e5: unknown = null;
    try {
      await systemSettingService.setFeatureFlags({ autoLogoutOnExpiry: false }, PROBE_USER);
    } catch (e) {
      e5 = e;
    }
    check("§5b ⭐ barındırılanda autoLogoutOnExpiry=false yazılamaz (409 HOSTED_CLASS_FORCED)", e5 instanceof AppError && e5.statusCode === 409 && codeOf(e5) === "HOSTED_CLASS_FORCED", String(e5));
    check("§5c barındırılanda masaüstü ve tarayıcı oturumu ≤ 24 saat",
      hostedDesktopSessionMinutes(43200, "electron", true) === HOSTED_DESKTOP_SESSION_MAX_MINUTES && hostedDesktopSessionMinutes(43200, "web", true) === 1440 && hostedDesktopSessionMinutes(480, "web", true) === 480);
    check("§5d mobil ve LAN dokunulmaz", hostedDesktopSessionMinutes(43200, "mobile", true) === 43200 && hostedDesktopSessionMinutes(43200, "electron", false) === 43200);
    check("§5e giriş oturum süresini tavandan geçirir", /hostedDesktopSessionMinutes\(await readSessionDurationMinutes\(\), ctx\?\.clientType\)/.test(src("src/services/auth.service.ts")));

    // ---------------------------------------------------------------- §6
    const lan = buildDiscoveryIdentity(null, false);
    const hosted = buildDiscoveryIdentity(null, true);
    check("§6a ⭐ barındırılan discovery firma adı, makine adı ve sürüm vermez",
      hosted.companyName === "TeksERP" && hosted.serverName === "TeksERP" && hosted.version === "" && hosted.etkin === false, JSON.stringify(hosted));
    check("§6b barındırılan discovery kurulum kimliğini korur (tablet donanım özeti anahtarı)", hosted.installationId === lan.installationId && hosted.product === "TeksERP");
    check("§6c LAN discovery bugünkü alanlarla (sürüm dolu)", lan.version === APP_VERSION && Object.keys(lan).join() === Object.keys(hosted).join());
    const lm = { enabled: ["list", "pin"], primary: "list", companyName: "Örnek Tekstil", lisansDurduruldu: false, lisansEtkinlesmedi: false, unpairedPasswordOnly: false };
    const anon = redactLoginMethods(lm, { hosted: true, approvedDevice: false }) as Record<string, unknown>;
    check("§6d ⭐ barındırılanda kimliksiz login-methods lisans bayrağı ve firma adı vermez",
      !("lisansDurduruldu" in anon) && !("lisansEtkinlesmedi" in anon) && anon.companyName === "TeksERP" && Array.isArray(anon.enabled), JSON.stringify(anon));
    check("§6e onaylı cihaza ve LAN'a yanıt bayt-aynı",
      redactLoginMethods(lm, { hosted: true, approvedDevice: true }) === lm && redactLoginMethods(lm, { hosted: false, approvedDevice: false }) === lm);
    check("§6f login-methods ucu daraltmadan geçer", /redactLoginMethods\([\s\S]{0,200}approvedDevice: Boolean\(req\.device\)/.test(src("src/controllers/auth.controller.ts")));

    // ---------------------------------------------------------------- §7
    for (const [host, port] of [["127.0.0.1", 9100], ["169.254.169.254", 9100], ["8.8.8.8", 9100], ["yazici.local", 9100], ["192.168.1.50", 5432], ["172.32.0.5", 9100], ["0.0.0.0", 9100]] as const) {
      check(`§7a ⭐ test ucu hedefi reddedilir: ${host}:${port}`, printerTestTargetRefusal(host, port) !== null);
    }
    check("§7b LAN yazıcısı geçer (192.168.1.50:9100 · 10.0.0.9 · 172.16.4.2:9101)",
      printerTestTargetRefusal("192.168.1.50", 9100) === null && printerTestTargetRefusal("10.0.0.9", undefined) === null && printerTestTargetRefusal("172.16.4.2", 9101) === null);
    check("§7c test ucu şeması süzgeci çağırır", /printerTestTargetRefusal\(v\.printerIp, v\.port\)/.test(src("src/controllers/label.controller.ts")));
    setHosted(true);
    check("§7d barındırılanda nativeSendEnabled okunuşu false", (await readLabelNativeSendEnabled()) === false);
    let e7: unknown = null;
    try {
      await systemSettingService.setFeatureFlags({ nativeSendEnabled: true }, PROBE_USER);
    } catch (e) {
      e7 = e;
    }
    check("§7e barındırılanda nativeSendEnabled=true yazılamaz (409 HOSTED_CLASS_FORCED)", e7 instanceof AppError && e7.statusCode === 409 && codeOf(e7) === "HOSTED_CLASS_FORCED", String(e7));
  } finally {
    if (savedClass === undefined) delete process.env[INSTALL_CLASS_ENV];
    else process.env[INSTALL_CLASS_ENV] = savedClass;
    await prisma.systemSetting.deleteMany({ where: { key: { in: GUARDED_KEYS.filter((k) => !savedSettings.some((r) => r.key === k)) } } }).catch(() => undefined);
    for (const r of savedSettings) {
      await prisma.systemSetting.update({ where: { key: r.key }, data: { value: r.value ?? false, description: r.description } }).catch(() => undefined);
    }
    const mine = (await prisma.device.findMany({ where: { deviceId: { startsWith: PREFIX } }, select: { deviceId: true } })).map((d) => d.deviceId);
    if (mine.length > 0) await prisma.deviceBindingEvent.deleteMany({ where: { localId: { in: mine } } }).catch(() => undefined);
    await prisma.device.deleteMany({ where: { deviceId: { startsWith: PREFIX } } }).catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
