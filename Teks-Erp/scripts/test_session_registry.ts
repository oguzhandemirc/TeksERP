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
import { resetSessionTouchCacheForTest, verifyToken } from "../src/middlewares/auth.middleware";
import { AppError } from "../src/utils/app-error";
import { randomUUID } from "crypto";
import { CLIENT_INFO_HEADERS } from "../src/constants/client-info";
import fs from "fs";
import path from "path";

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

/* ---------------------------------------------------------------------- *
 * FIRE-AND-FORGET YAZIMI NASIL BEKLENİR
 * ---------------------------------------------------------------------- *
 * ⚠️ SABİT UYKU İLE ÖLÇMEK, MAKİNENİN HIZINI ÖLÇMEKTİR. `await sleep(250)`
 * yazan bir sonda "yazım 250 ms'de biter" diye BİLİNMEYEN bir şey iddia eder;
 * yavaş bir runner'da aralıklı kırmızı verir ve kimse sondanın mı ürünün mü
 * bozuk olduğunu bilemez. İki yön AYRI ele alınır:
 *   · BEKLENEN yazım → YOKLA (kısa aralık, beyanlı ÜST SINIR). Erken biterse
 *     hemen döner; sınır dolarsa ❌ ve mesaj ne kadar beklendiğini SÖYLER.
 *   · BEKLENMEYEN yazım → ÜST SINIRIN TAMAMINI bekle, sonra bak. Bu yönde
 *     yavaş makine sondayı GEVŞETMEZ, SIKAR: istenmeyen yazıma daha çok süre
 *     tanınmış olur.
 */
const YAZIM_UST_SINIRI_MS = 500;
const YOKLAMA_ARALIGI_MS = 50;

/** Beklenen değere ulaşana kadar yokla; ulaşamazsa son okunan değeri döndür. */
async function yoklaBekle<T>(oku: () => Promise<T>, hedef: (v: T) => boolean): Promise<T> {
  const bitis = Date.now() + YAZIM_UST_SINIRI_MS;
  let son = await oku();
  while (!hedef(son) && Date.now() < bitis) {
    await new Promise((r) => setTimeout(r, YOKLAMA_ARALIGI_MS));
    son = await oku();
  }
  return son;
}

/** "Olmaması gereken" yazım için: bütçenin TAMAMINI bekle, sonra oku. */
async function butceyiTuket(): Promise<void> {
  await new Promise((r) => setTimeout(r, YAZIM_UST_SINIRI_MS));
}

async function openSession(
  userId: string,
  deviceType: ClientType,
  policy: "kick" | "notify" | "off",
  opts: { confirmKick?: boolean; deviceId?: string | null; clientVersion?: string | null } = {},
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
    clientVersion: opts.clientVersion,
  });
  return jti;
}

/** auth.middleware'i sahte req/res/next ile koştur → { err, userSet }. */
async function runMiddleware(
  token: string,
  ekBaslik: Record<string, string> = {},
): Promise<{ err: unknown; userSet: boolean }> {
  let err: unknown = null;
  let userSet = false;
  const req = { headers: { authorization: `Bearer ${token}`, ...ekBaslik } } as unknown as Request;
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
    // --- 9) İSTEMCİ SÜRÜMÜ (`Session.clientVersion`) — GÖZLEM, KAPI DEĞİL ---
    // ⚠️ Bu alanın tek amacı "sahada hangi sürümler görülüyor" sorusunu
    // cevaplamaktır (`test_rol_modeli_kalinti` ④). Sessizce DÜŞMESİ, kaldırma
    // fazı kapısına ölçülmemiş bir zemini "temiz" gösterirdi.
    const uSurum = await mkUser("surum");
    const sV = await openSession(uSurum.id, ClientType.ELECTRON, "off", { clientVersion: "1.3.2" });
    const rowV = need(await prisma.session.findUnique({ where: { jti: sV }, select: { clientVersion: true } }), "sV");
    check("9a clientVersion oturum satırına YAZILDI", rowV.clientVersion === "1.3.2", String(rowV.clientVersion));
    const sN = await openSession(uSurum.id, ClientType.MOBILE, "off");
    const rowN = need(await prisma.session.findUnique({ where: { jti: sN }, select: { clientVersion: true } }), "sN");
    check("9b sürüm verilmeyince NULL (uydurulmuyor)", rowN.clientVersion === null, String(rowN.clientVersion));
    // Politika kararına GİRMEDİĞİ: sürümü farklı iki 'kick' oturumu, sürümden
    // bağımsız olarak birbirini düşürür (sürüm bir ayrım ekseni DEĞİL).
    const sK1 = await openSession(uSurum.id, ClientType.WEB, "kick", { clientVersion: "1.0.0" });
    const sK2 = await openSession(uSurum.id, ClientType.WEB, "kick", { clientVersion: "9.9.9" });
    check("9c sürüm politikaya girmiyor: eski sürümlü oturum yine de düştü",
      !(await SessionRegistryService.isSessionValid(sK1)) && (await SessionRegistryService.isSessionValid(sK2)));

    // 9d STATİK — "dört kapı" sınıfı: login uçlarından biri alanı unutursa o
    // istemci sahada GÖRÜNMEZ olur ve kimse kırmızı görmez. Her `LoginContext`
    // nesnesi sürümü taşımak ZORUNDA.
    const ctrl = fs.readFileSync(path.resolve(__dirname, "../src/controllers/auth.controller.ts"), "utf-8");
    const ctxSayisi = (ctrl.match(/const ctx: LoginContext = \{/g) ?? []).length;
    const surumSayisi = (ctrl.match(/clientVersion: resolveClientVersion\(req\),/g) ?? []).length;
    check("9d HER login ucu (LoginContext) istemci sürümünü taşıyor",
      ctxSayisi > 0 && ctxSayisi === surumSayisi, `${ctxSayisi} ctx / ${surumSayisi} sürüm`);

    // 9e SONRAKİ İSTEKLERDE DOLMA — login'e bağlı kalamaz.
    // ⚠️ SAHA ÖLÇÜMÜ (01, 2026-09-17): panel künye sürümünü main process'ten
    // ASENKRON okuyor; İLK istek (login) çoğu kez sürümsüz gidiyor. Yazım yalnız
    // login'de olsaydı panel oturumlarının büyük kısmı kalıcı NULL kalır ve
    // kaldırma fazı kapısı sonsuza kadar "ÖLÇÜLEMEDİ" görürdü.
    const uGec = await mkUser("gecikmeli");
    const jGec = await openSession(uGec.id, ClientType.ELECTRON, "off"); // sürümsüz login
    const tokGec = jwt.sign(
      { userId: uGec.id, username: uGec.username, permissions: [], tokenVersion: uGec.tokenVersion },
      secret, { jwtid: jGec, expiresIn: "1h" },
    );
    const oku = async (): Promise<string | null> =>
      (await prisma.session.findUnique({ where: { jti: jGec }, select: { clientVersion: true } }))
        ?.clientVersion ?? null;
    check("9e login sürümsüzse satır NULL başlar", (await oku()) === null);
    // ⚠️ ÖNCE SÜRÜMSÜZ BİR İSTEK: `lastSeenAt` kısıtlaması (60 sn) böyle kurulur.
    // Sürüm yazımı o kısıtlamaya TABİ OLSAYDI, panelin sürümü çözdüğü ikinci
    // istek bir dakika boyunca satırı dolduramazdı. Bu sıra olmadan sonda
    // kısıtlamayı HİÇ ölçmüyordu (ölçüldü 2026-09-17: sonda tutmadı).
    const mwSurumsuz = await runMiddleware(tokGec);
    check("9e körlük zemini: middleware isteği KABUL etti (dokunuş yolu koştu)",
      mwSurumsuz.err === null && mwSurumsuz.userSet === true,
      String((mwSurumsuz.err as Error)?.message ?? ""));
    await butceyiTuket(); // BEKLENMEYEN yazım — bütçenin tamamı beklenir
    check("9e sürümsüz istek satırı doldurmaz", (await oku()) === null, String(await oku()));
    await runMiddleware(tokGec, { [CLIENT_INFO_HEADERS.version]: "1.3.4" });
    const dolan = await yoklaBekle(oku, (v) => v !== null);
    check(`9e ARDINDAN gelen sürümlü istek satırı DOLDURUR (kısıtlamaya takılmaz, ≤${YAZIM_UST_SINIRI_MS} ms)`,
      dolan === "1.3.4",
      dolan === null ? `sürüm doldurma ${YAZIM_UST_SINIRI_MS} ms'de GERÇEKLEŞMEDİ (satır hâlâ NULL)` : String(dolan));
    // ⚠️ Dolu satır DEĞİŞMEZ: bir oturum TEK istemciye aittir. İKİ sed var —
    // bellek-içi `versionWrites` ve `updateMany`nin `clientVersion: null`
    // koşulu — ve önbellek TEMİZLENMEDEN ikincisi ölçülemez.
    resetSessionTouchCacheForTest();
    await runMiddleware(tokGec, { [CLIENT_INFO_HEADERS.version]: "0.0.1" });
    await butceyiTuket(); // BEKLENMEYEN yazım — bütçenin tamamı beklenir
    check("9e dolu satır İKİNCİ (farklı) sürümle DEĞİŞMEZ — önbellek sıfırlanmışken de",
      (await oku()) === "1.3.4", String(await oku()));

    // Sonlanmış oturuma yazılmaz.
    const jRev = await openSession(uGec.id, ClientType.WEB, "off");
    const tokRev = jwt.sign(
      { userId: uGec.id, username: uGec.username, permissions: [], tokenVersion: uGec.tokenVersion },
      secret, { jwtid: jRev, expiresIn: "1h" },
    );
    await SessionRegistryService.revokeSession(jRev, "LOGOUT");
    const mwRev = await runMiddleware(tokRev, { [CLIENT_INFO_HEADERS.version]: "1.3.4" });
    await butceyiTuket(); // BEKLENMEYEN yazım — bütçenin tamamı beklenir
    const rowRev = await prisma.session.findUnique({ where: { jti: jRev }, select: { clientVersion: true } });
    // ⚠️ BU KOL DAVRANIŞSAL OLARAK YALNIZ ①'İ ÖLÇEBİLİR: middleware iptal edilmiş
    // oturumu 401 ile keser ve dokunuş yoluna HİÇ girilmez. `updateMany`nin
    // `revokedAt: null` koşulu (②) bu yoldan ERİŞİLEMEZ — ölçüldü 2026-09-17:
    // koşul kaldırıldığında sonda kırmızı VERMEDİ. İkisi aynı şey değildir ve
    // beyan edilmezse yarın middleware gevşediğinde kol ②'yi ölçtüğünü sanır.
    check("9e sonlanmış oturuma sürüm YAZILMAZ (middleware 401 keser)",
      rowRev?.clientVersion === null && mwRev.err !== null, String(rowRev?.clientVersion));
    // ⇒ ② ayrıca STATİK ölçülür: ikinci sed kodda DURUYOR mu. Davranışsal sonda
    //   göremediği için, koşulu silen bir düzenleme başka türlü sessiz geçerdi.
    const mwKaynak = fs.readFileSync(path.resolve(__dirname, "../src/middlewares/auth.middleware.ts"), "utf-8");
    check("9e ikinci sed KODDA: sürüm yazımı `revokedAt: null` + `clientVersion: null` koşullu",
      /where:\s*\{\s*jti,\s*clientVersion:\s*null,\s*revokedAt:\s*null\s*\}/.test(mwKaynak));

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
      // ⚠️ RESTRICT FK (2026-08-29 / K6): `system_logs."userId"` artık kullanıcıyı
      // KİLİTLİYOR — audit izi, izi bırakan kişi silinerek anonimleştirilemez.
      // Test kendi yarattığı kullanıcıyı sert siliyorsa ONUN audit satırlarını da
      // silmek zorunda (sapma defteri `rollVariance` dersinin birebir ikizi).
      await prisma.systemLog.deleteMany({ where: { userId: { in: createdUserIds } } });
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
