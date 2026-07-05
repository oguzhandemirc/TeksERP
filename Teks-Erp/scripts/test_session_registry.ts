// =============================================================================
// Test: Session Registry (oturum defteri) + aynı-tip politika + middleware iptal
// Çalıştır: npx tsx scripts/test_session_registry.ts
// Doğrulananlar:
//   1. kick: aynı-tip önceki oturumu revoke eder, cross-type'a dokunmaz
//   2. notify: aktif same-type varsa 409 SESSION_EXISTS; confirmKick=true ikisini açar
//   3. off: çoklu same-type oturum serbest
//   4. revokeAllForUser: kullanıcının tüm aktif oturumlarını düşürür
//   5. revokeSession: idempotent (2. çağrı revoked:false)
//   6. isSessionValid: revoke sonrası false
//   7. auth.middleware: geçerli jti kabul; jti'siz token 401; revoke edilmiş jti 401
//   8. WorkSession "bir operatör = tek yer": aynı user başka cihazda oturum açınca
//      önceki cihazdaki açık iş oturumu NEW_LOGIN ile kapanır
// İzolasyon: dedicated TEST kullanıcıları/cihazları — dev verisine karışmaz; finally temizler.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config() → JWT_SECRET/DATABASE_URL yüklenir
import jwt from "jsonwebtoken";
import { ClientType } from "@prisma/client";
import type { Request, Response } from "express";
import { SessionRegistryService } from "../src/services/session-registry.service";
import { WorkSessionService } from "../src/services/work-session.service";
import { verifyToken } from "../src/middlewares/auth.middleware";
import { AppError } from "../src/utils/app-error";
import { randomUUID } from "crypto";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000);

async function openSession(
  userId: string,
  deviceType: ClientType,
  policy: "kick" | "notify" | "off",
  opts: { confirmKick?: boolean; deviceId?: string | null } = {},
): Promise<string> {
  const jti = randomUUID();
  await SessionRegistryService.openLoginSession({
    userId,
    deviceType,
    deviceId: opts.deviceId ?? null,
    jti,
    expiresAt: FUTURE(),
    policy,
    confirmKick: opts.confirmKick,
  });
  return jti;
}

/** auth.middleware'i sahte req/res/next ile koştur → { err, userSet }. */
async function runMiddleware(token: string): Promise<{ err: unknown; userSet: boolean }> {
  let err: unknown = null;
  let userSet = false;
  const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
  const res = {} as Response;
  await verifyToken(req, res, ((e?: unknown) => {
    if (e) err = e;
    else userSet = !!req.user;
  }) as unknown as import("express").NextFunction);
  return { err, userSet };
}

async function main() {
  const ts = Date.now();
  const secret = need(process.env.JWT_SECRET, "JWT_SECRET (.env)");

  const createdUserIds: string[] = [];
  const createdDeviceIds: string[] = [];

  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: { username: `TEST-sess-${tag}-${ts}`, passwordHash: "x", fullName: `TEST Oturum ${tag}` },
      select: { id: true, username: true, tokenVersion: true },
    });
    createdUserIds.push(u.id);
    return u;
  };

  try {
    // --- 1) kick: same-type revoke + cross-type dokunulmaz ---
    const uKick = await mkUser("kick");
    const kA = await openSession(uKick.id, ClientType.ELECTRON, "kick");
    const kB = await openSession(uKick.id, ClientType.ELECTRON, "kick");
    check("1a kick: önceki electron oturumu revoke", !(await SessionRegistryService.isSessionValid(kA)));
    check("1b kick: yeni electron oturumu geçerli", await SessionRegistryService.isSessionValid(kB));
    const rowA = need(await prisma.session.findUnique({ where: { jti: kA }, select: { revokeReason: true } }), "kA");
    check("1c kick: revokeReason=NEW_LOGIN", rowA.revokeReason === "NEW_LOGIN");
    const kMobile = await openSession(uKick.id, ClientType.MOBILE, "kick");
    check("1d cross-type: electron oturumu MOBILE login'den etkilenmez", await SessionRegistryService.isSessionValid(kB));
    check("1e cross-type: mobile oturumu geçerli", await SessionRegistryService.isSessionValid(kMobile));

    // --- 2) notify: 409 SESSION_EXISTS → confirmKick ikisini açar ---
    const uNotify = await mkUser("notify");
    const nA = await openSession(uNotify.id, ClientType.MOBILE, "notify");
    let conflictErr: AppError | null = null;
    try {
      await openSession(uNotify.id, ClientType.MOBILE, "notify");
    } catch (e) {
      conflictErr = e instanceof AppError ? e : null;
    }
    check("2a notify: 2. aynı-tip giriş 409", conflictErr?.statusCode === 409);
    check("2b notify: code=SESSION_EXISTS", conflictErr?.details?.code === "SESSION_EXISTS");
    const existing = conflictErr?.details?.existingSession as { deviceType?: string } | undefined;
    check("2c notify: existingSession bilgisi döner", !!existing && existing.deviceType === "MOBILE");
    const nB = await openSession(uNotify.id, ClientType.MOBILE, "notify", { confirmKick: true });
    check("2d notify+confirmKick: eski oturum AÇIK kalır", await SessionRegistryService.isSessionValid(nA));
    check("2e notify+confirmKick: yeni oturum da açık", await SessionRegistryService.isSessionValid(nB));

    // --- 3) off: çoklu same-type serbest ---
    const uOff = await mkUser("off");
    const oA = await openSession(uOff.id, ClientType.MOBILE, "off");
    const oB = await openSession(uOff.id, ClientType.MOBILE, "off");
    const oC = await openSession(uOff.id, ClientType.MOBILE, "off");
    check(
      "3a off: üç same-type oturum da geçerli",
      (await SessionRegistryService.isSessionValid(oA)) &&
        (await SessionRegistryService.isSessionValid(oB)) &&
        (await SessionRegistryService.isSessionValid(oC)),
    );

    // --- 4) revokeAllForUser ---
    const revAll = await SessionRegistryService.revokeAllForUser(uOff.id, "DEACTIVATED");
    check("4a revokeAllForUser: 3 oturum düşer", revAll.count === 3);
    check("4b revokeAllForUser sonrası hepsi geçersiz", !(await SessionRegistryService.isSessionValid(oA)) && !(await SessionRegistryService.isSessionValid(oC)));

    // --- 5) revokeSession idempotent ---
    const uLogout = await mkUser("logout");
    const lJti = await openSession(uLogout.id, ClientType.MOBILE, "off");
    const r1 = await SessionRegistryService.revokeSession(lJti, "LOGOUT");
    const r2 = await SessionRegistryService.revokeSession(lJti, "LOGOUT");
    check("5a revokeSession ilk çağrı revoked:true", r1.revoked === true);
    check("5b revokeSession 2. çağrı revoked:false (idempotent)", r2.revoked === false);
    check("5c revokeSession null jti → false", (await SessionRegistryService.revokeSession(null, "LOGOUT")).revoked === false);

    // --- 6/7) middleware: geçerli / jti'siz / revoke edilmiş ---
    const uMw = await mkUser("mw");
    const mwJti = await openSession(uMw.id, ClientType.MOBILE, "off");
    const signPayload = { userId: uMw.id, username: uMw.username, permissions: [], tokenVersion: uMw.tokenVersion };
    const goodToken = jwt.sign(signPayload, secret, { expiresIn: 3600, jwtid: mwJti });
    const noJtiToken = jwt.sign(signPayload, secret, { expiresIn: 3600 });

    const mwGood = await runMiddleware(goodToken);
    check("7a middleware: geçerli jti kabul (next hatasız)", mwGood.err === null && mwGood.userSet === true);

    const mwNoJti = await runMiddleware(noJtiToken);
    check("7b middleware: jti'siz token 401 (fail-closed)", mwNoJti.err instanceof AppError && (mwNoJti.err as AppError).statusCode === 401);

    await SessionRegistryService.revokeSession(mwJti, "LOGOUT");
    const mwRevoked = await runMiddleware(goodToken);
    check("7c middleware: revoke edilmiş jti 401", mwRevoked.err instanceof AppError && (mwRevoked.err as AppError).statusCode === 401);

    // 7d/7e: kick (NEW_LOGIN) → 401 + doğru bildirim için details.code/reason
    // (client "süresi doldu" değil "başka cihazdan giriş yapıldı" göstersin).
    const uKickMw = await mkUser("kickmw");
    const kickJti = await openSession(uKickMw.id, ClientType.MOBILE, "off");
    const kickTok = jwt.sign(
      { userId: uKickMw.id, username: uKickMw.username, permissions: [], tokenVersion: uKickMw.tokenVersion },
      secret,
      { expiresIn: 3600, jwtid: kickJti },
    );
    await SessionRegistryService.revokeSession(kickJti, "NEW_LOGIN");
    const mwKick = await runMiddleware(kickTok);
    const kickErr = mwKick.err instanceof AppError ? mwKick.err : null;
    check(
      "7d kick 401 + details.code=SESSION_REVOKED",
      kickErr?.statusCode === 401 && kickErr?.details?.code === "SESSION_REVOKED",
    );
    check(
      "7e kick reason=NEW_LOGIN (doğru bildirim)",
      (kickErr?.details as { reason?: string } | undefined)?.reason === "NEW_LOGIN",
    );

    // --- 8) WorkSession bir-operatör-tek-yer ---
    const sevk = need(
      await prisma.station.findFirst({ where: { code: "SEVK_1", isActive: true }, select: { id: true } }),
      "SEVK_1 (makinesiz SHIPPING istasyonu)",
    );
    const uWs = await mkUser("ws");
    const devA = await prisma.device.create({
      data: { deviceId: `TEST-sess-devA-${ts}`, name: "TEST Oturum Cihaz A", status: "APPROVED" },
      select: { id: true },
    });
    createdDeviceIds.push(devA.id);
    const devB = await prisma.device.create({
      data: { deviceId: `TEST-sess-devB-${ts}`, name: "TEST Oturum Cihaz B", status: "APPROVED" },
      select: { id: true },
    });
    createdDeviceIds.push(devB.id);

    const wsA = (await WorkSessionService.open({ userId: uWs.id, deviceRowId: devA.id, stationId: sevk.id })).data as { id: string };
    const beforeB = need(await prisma.workSession.findUnique({ where: { id: wsA.id }, select: { endedAt: true } }), "wsA");
    check("8a cihaz A oturumu B açılmadan önce AÇIK", beforeB.endedAt === null);

    const wsB = (await WorkSessionService.open({ userId: uWs.id, deviceRowId: devB.id, stationId: sevk.id })).data as { id: string };
    const afterA = need(await prisma.workSession.findUnique({ where: { id: wsA.id }, select: { endedAt: true, endReason: true } }), "wsA2");
    const afterB = need(await prisma.workSession.findUnique({ where: { id: wsB.id }, select: { endedAt: true } }), "wsB");
    check("8b cihaz B açılınca cihaz A oturumu KAPANIR", afterA.endedAt !== null);
    check("8c kapanış nedeni NEW_LOGIN", afterA.endReason === "NEW_LOGIN");
    check("8d cihaz B oturumu açık kalır", afterB.endedAt === null);
  } finally {
    // Cleanup — FK Restrict sırası: workSessions → sessions → devices → users.
    if (createdUserIds.length) {
      await prisma.workSession.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    }
    if (createdDeviceIds.length) {
      await prisma.device.deleteMany({ where: { id: { in: createdDeviceIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
