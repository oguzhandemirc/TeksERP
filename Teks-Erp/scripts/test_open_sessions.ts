// =============================================================================
// BEKÇİ: açık oturumlar listesi + yönetici sonlandırması (Sistem → Bağlı İstemciler)
// =============================================================================
// §1 kapı (kaynak): router.use verifyToken + clients çifti; sonlandırma `admin:users`; app.ts mount.
// §2 liste: yalnız açık (iptal/süresi geçmiş yok), sıra lastSeenAt desc nulls last, jti/belirteç yok,
//    isCurrent, cihaz adı Device'tan, kimlik öneki 8, arama sunucuda.
// §3 sonlandırma: atomik claim (ikinci kez 409 SESSION_NOT_OPEN), kendi oturumu 400, yok 404,
//    audit SESSION_REVOKED_BY_ADMIN (jti yükte yok), en yetkili hesap koruması claim'den ÖNCE.
// Sunucusuz: servis doğrudan çağrılır; HTTP katmanı kaynaktan ölçülür.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config()
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClientType } from "@prisma/client";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { OpenSessionService, ADMIN_REVOKE_REASON } from "../src/services/open-session.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
}

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function sourceChecks(): void {
  const routes = read("src/routes/open-session.routes.ts");
  check(
    "§1a router düzeyi kapı: verifyToken + (admin:settings ∨ system:clients)",
    /router\.use\(\s*verifyToken\s*,\s*requireAnyPermission\(\s*"admin:settings"\s*,\s*"system:clients"\s*\)\s*\)/.test(routes),
  );
  check("§1b sonlandırma ucu admin:users ister", /router\.post\(\s*"\/:id\/revoke"\s*,\s*requirePermission\(\s*"admin:users"\s*\)/.test(routes));
  check("§1c clients izni sonlandırmaya girmez", !/revoke[\s\S]{0,120}system:clients/.test(routes));
  const app = read("src/app.ts");
  check("§1d app.ts mount /api/admin/open-sessions", /app\.use\(\s*"\/api\/admin\/open-sessions"\s*,\s*openSessionRoutes\s*\)/.test(app));
  const svc = read("src/services/open-session.service.ts");
  const select = svc.match(/const SESSION_LIST_SELECT = \{([\s\S]*?)\} as const/)?.[1] ?? "";
  check("§1e liste projeksiyonunda jti yok", select.length > 0 && !/\bjti\b/.test(select), select);
  const revoke = svc.slice(svc.indexOf("async revoke("));
  const guard = revoke.indexOf("isSystemAccountAuthorized(");
  const claim = revoke.indexOf("SessionRegistryService.revokeOpenById(");
  check("§1f en yetkili hesap koruması claim'den ÖNCE", guard > 0 && claim > guard);
  const reg = read("src/services/session-registry.service.ts");
  const regBody = reg.slice(reg.indexOf("static async revokeOpenById("), reg.indexOf("static async revokeAllForUser("));
  check(
    "§1g claim açık-oturum yüklemini kullanır + count===0 → 409",
    /revokeOpenById\(target\.id, openSessionWhere\(now\)/.test(revoke) && /where: \{ id, \.\.\.open \}/.test(regBody) && /claim\.count === 0/.test(revoke),
  );
  const payload = revoke.match(/action: "SESSION_REVOKED_BY_ADMIN"[\s\S]*?payload: \{([^}]*)\}/)?.[1] ?? "";
  check("§1h audit yükünde jti yok", payload.length > 0 && !/jti/.test(payload), payload);
}

async function expectAppError(fn: () => Promise<unknown>): Promise<{ status: number; code: unknown }> {
  try {
    await fn();
    return { status: 0, code: null };
  } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: (e.details as { code?: unknown } | undefined)?.code ?? null };
    throw e;
  }
}

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) {
    console.error(block);
    process.exitCode = 1;
    return;
  }
  sourceChecks();

  const TAG = `TEST-OS-${Date.now().toString(36)}`;
  const userIds: string[] = [];
  const sessionIds: string[] = [];
  let deviceRowId: string | null = null;
  try {
    const mk = async (suffix: string) => {
      const u = await prisma.user.create({
        data: { username: `${TAG}-${suffix}`.toLowerCase(), fullName: `${TAG} ${suffix}`, passwordHash: "x", isActive: true },
        select: { id: true },
      });
      userIds.push(u.id);
      return u.id;
    };
    const adminId = await mk("yon");
    const targetId = await mk("hedef");
    const deviceId = `${TAG}-tab`.toLowerCase();
    const dev = await prisma.device.create({ data: { deviceId, name: `${TAG} Tablet`, status: "APPROVED", isActive: true }, select: { id: true } });
    deviceRowId = dev.id;

    const now = Date.now();
    const ses = async (userId: string, deviceType: ClientType, extra: Record<string, unknown>) => {
      const jti = randomUUID();
      const s = await prisma.session.create({
        data: { userId, deviceType, jti, expiresAt: new Date(now + 3_600_000), ...extra },
        select: { id: true, jti: true },
      });
      sessionIds.push(s.id);
      return s;
    };
    const mine = await ses(adminId, "ELECTRON", { lastSeenAt: new Date(now - 10_000), clientVersion: "1.2.3" });
    const tablet = await ses(targetId, "MOBILE", { lastSeenAt: new Date(now - 5_000), clientVersion: "1.0.1", deviceId });
    const never = await ses(targetId, "WEB", { lastSeenAt: null });
    const revoked = await ses(targetId, "ELECTRON", { revokedAt: new Date(now - 1000), revokeReason: "LOGOUT" });
    const expired = await ses(targetId, "PATRON", { expiresAt: new Date(now - 1000) });

    const list = await OpenSessionService.list({ search: TAG, limit: 500, currentJti: mine.jti });
    const ids = list.sessions.map((s) => s.id);
    check("§2a açık oturumlar listede (3)", [mine.id, tablet.id, never.id].every((id) => ids.includes(id)), JSON.stringify(ids));
    check("§2b iptal ve süresi geçmiş oturum listede YOK", !ids.includes(revoked.id) && !ids.includes(expired.id));
    check("§2c sıra: son görülen önce, hiç görülmeyen sonda", ids.indexOf(tablet.id) < ids.indexOf(mine.id) && ids.indexOf(mine.id) < ids.indexOf(never.id), JSON.stringify(ids));
    const raw = JSON.stringify(list);
    check("§2d yanıtta jti yok", ![mine.jti, tablet.jti, never.jti].some((j) => raw.includes(j)) && !raw.includes('"jti"'));
    const t = list.sessions.find((s) => s.id === tablet.id);
    check("§2e cihaz adı Device'tan + kimlik öneki 8", t?.deviceName === `${TAG} Tablet` && t?.deviceIdPrefix === deviceId.slice(0, 8), JSON.stringify(t));
    check("§2f isCurrent yalnız kendi oturumunda", list.sessions.find((s) => s.id === mine.id)?.isCurrent === true && t?.isCurrent === false);
    check("§2g sürüm aynen döner", t?.clientVersion === "1.0.1");
    const byDevice = await OpenSessionService.list({ search: `${TAG} Tablet`, currentJti: null });
    check("§2h arama cihaz adına uyar (sunucuda)", byDevice.sessions.some((s) => s.id === tablet.id));
    const none = await OpenSessionService.list({ search: `${TAG}-yok-zzz`, currentJti: null });
    check("§2i eşleşmeyen arama boş döner", none.sessions.length === 0, String(none.sessions.length));
    const lim = await OpenSessionService.list({ search: TAG, limit: 1, currentJti: null });
    check("§2j sınır + truncated", lim.sessions.length === 1 && lim.truncated === true);

    const base = { actorUserId: adminId, actorIsSystemAccount: false, actorJti: mine.jti, ipAddress: null };
    const cur = await expectAppError(() => OpenSessionService.revoke({ ...base, sessionId: mine.id }));
    check("§3a kendi oturumu 400 SESSION_IS_CURRENT", cur.status === 400 && cur.code === "SESSION_IS_CURRENT", JSON.stringify(cur));
    const nf = await expectAppError(() => OpenSessionService.revoke({ ...base, sessionId: randomUUID() }));
    check("§3b olmayan oturum 404", nf.status === 404, JSON.stringify(nf));
    const ok = await OpenSessionService.revoke({ ...base, sessionId: tablet.id });
    const after = await prisma.session.findUnique({ where: { id: tablet.id }, select: { revokedAt: true, revokeReason: true } });
    check("§3c sonlandırma: revokedAt + ADMIN_REVOKE", ok.id === tablet.id && !!after?.revokedAt && after.revokeReason === ADMIN_REVOKE_REASON, JSON.stringify(after));
    const again = await expectAppError(() => OpenSessionService.revoke({ ...base, sessionId: tablet.id }));
    check("§3d ikinci kez 409 SESSION_NOT_OPEN (atomik claim)", again.status === 409 && again.code === "SESSION_NOT_OPEN", JSON.stringify(again));
    const exp = await expectAppError(() => OpenSessionService.revoke({ ...base, sessionId: expired.id }));
    check("§3e süresi geçmiş oturum 409", exp.status === 409, JSON.stringify(exp));
    const audit = await prisma.systemLog.findFirst({
      where: { action: "SESSION_REVOKED_BY_ADMIN", recordId: tablet.id },
      select: { userId: true, newData: true },
    });
    check("§3f audit SESSION_REVOKED_BY_ADMIN (yapan yönetici)", audit?.userId === adminId, JSON.stringify(audit));
    check("§3g audit yükünde jti yok", !!audit && !JSON.stringify(audit.newData).includes(tablet.jti));
    const listAfter = await OpenSessionService.list({ search: TAG, currentJti: null });
    check("§3h sonlandırılan oturum listeden düşer", !listAfter.sessions.some((s) => s.id === tablet.id));
  } finally {
    if (sessionIds.length) {
      await prisma.systemLog.deleteMany({ where: { action: "SESSION_REVOKED_BY_ADMIN", recordId: { in: sessionIds } } }).catch(() => undefined);
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => undefined);
    }
    if (deviceRowId) await prisma.device.update({ where: { id: deviceRowId }, data: { isActive: false } }).catch(() => undefined);
    // Bekçi kullanıcısı sert silinmez (sözleşme): pasif + silinmiş damgası.
    for (const id of userIds) {
      await prisma.user.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }).catch(() => undefined);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
  }
}

void main();
