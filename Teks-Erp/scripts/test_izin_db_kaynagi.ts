// =============================================================================
// Bekçi: istek yetkisi DB'den — token claim'i karar kaynağı değil (G20 — FAB-4 · FAB-9)
// =============================================================================
// Ölçer:
//   §1 Sızan sırla yeniden imzalanmış token (`permissions:["*"]`, sahte kullanıcı adı,
//      kendi jti'si) yetki KAZANMAZ: req.user.permissions = DB kümesi, kullanıcı adı DB'den,
//      `requirePermission("admin:users")` 403; başkasının userId'siyle kendi jti'si 401.
//   §2 Önbellek TTL tazeliktir: DB'de bump'sız değişen izin TTL içinde önbellekten,
//      önbellek sıfırlanınca ya da yeni girişte taze kümeden okunur.
//   §3 İzin yazıcısı (PermissionManagementService.grantPermission) tokenVersion'ı artırır →
//      eski token 401; yeni giriş yeni izni taşır.
//   §4 Mutlak tavan 0 + zaman aşımı kapalı → yeni token EXP'Lİ (en uzun tavan, 365 gün).
//   §5 Geçiş: exp'siz eski token (canlı Session'lı) KABUL edilir, oturum başına TEK uyarı.
// İzolasyon: TEST kullanıcısı + iki oturum ayarı anlık görüntüsü; `temizle()` hepsini
// geri yükler/siler. DB GEREKİR (`tekserp_<oturum>_test`).
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv.config() → JWT_SECRET/DATABASE_URL
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { AuthService, resetRequestPermissionCacheForTest } from "../src/services/auth.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { resetSessionTouchCacheForTest, verifyToken } from "../src/middlewares/auth.middleware";
import { RBAC_DENIED_CODE, requirePermission } from "../src/middlewares/rbac.middleware";
import {
  MAX_ABSOLUTE_SESSION_CAP_DAYS,
  SETTING_KEYS,
  invalidateFeatureFlagsCache,
} from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fikstür bulunamadı: ${what}`);
  return v;
}

const AUTO_KEY = SETTING_KEYS.AUTH_AUTO_LOGOUT_ON_EXPIRY;
const CAP_KEY = SETTING_KEYS.AUTH_ABSOLUTE_SESSION_CAP_DAYS;
type Hata = { statusCode?: number; details?: { code?: string } } | null;

async function rawSet(key: string, value: Prisma.InputJsonValue, userId: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, updatedById: userId },
    update: { value, updatedById: userId },
  });
  invalidateFeatureFlagsCache();
}

/** auth.middleware'i sahte req ile koştur → { err, req }. */
async function kimlikDogrula(token: string): Promise<{ err: Hata; req: Request }> {
  let err: Hata = null;
  const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
  await verifyToken(req, {} as Response, ((e?: unknown) => {
    if (e) err = e as Hata;
  }) as NextFunction);
  return { err, req };
}

function izinKapisi(req: Request, kod: string): Hata {
  let err: Hata = null;
  requirePermission(kod)(req, {} as Response, ((e?: unknown) => {
    if (e) err = e as Hata;
  }) as NextFunction);
  return err;
}

function jtiOf(token: string): string {
  return need((jwt.decode(token) as { jti?: string } | null)?.jti, "token jti");
}

async function main(): Promise<void> {
  const ts = Date.now();
  const secret = need(process.env.JWT_SECRET, "JWT_SECRET (.env)");
  const rollRead = need(await prisma.permission.findUnique({ where: { code: "roll:read" } }), "izin roll:read");
  const orderRead = need(await prisma.permission.findUnique({ where: { code: "order:read" } }), "izin order:read");

  type Snap = { value: Prisma.JsonValue; updatedById: string | null } | undefined;
  const originals = new Map<string, Snap>();
  for (const k of [AUTO_KEY, CAP_KEY]) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true, updatedById: true } });
    originals.set(k, row ? { value: row.value, updatedById: row.updatedById } : undefined);
  }

  const username = `TEST-izdb-${ts}`;
  const password = `Izdb-${ts}-x`;
  const user = await prisma.user.create({
    data: { username, passwordHash: await AuthService.hashPassword(password), fullName: "TEST İzin DB Kaynağı" },
    select: { id: true },
  });
  const userId = user.id;
  const baskasi = await prisma.user.create({
    data: { username: `TEST-izdb-b-${ts}`, passwordHash: user.id, fullName: "TEST İzin DB Başkası" },
    select: { id: true },
  });
  const origWarn = console.warn;

  async function temizle(): Promise<void> {
    console.warn = origWarn;
    for (const k of [AUTO_KEY, CAP_KEY]) {
      const orig = originals.get(k);
      if (orig === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } });
      else
        await prisma.systemSetting.update({
          where: { key: k },
          data: { value: orig.value as Prisma.InputJsonValue, updatedById: orig.updatedById },
        });
    }
    invalidateFeatureFlagsCache();
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId }, { recordId: userId }] } });
    await prisma.userPermission.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, baskasi.id] } } });
  }

  try {
    // Zaman aşımı AÇIK + varsayılan tavan: §1–§3 kısa ömürlü token'la koşar (ortam ayarından bağımsız).
    await rawSet(AUTO_KEY, true, userId);
    await prisma.userPermission.create({ data: { userId, permissionId: rollRead.id } });
    resetRequestPermissionCacheForTest();
    resetSessionTouchCacheForTest();

    // ── §1 yeniden imzalanmış token ────────────────────────────────────────────
    const giris = await AuthService.login(username, password);
    const jti = jtiOf(giris.token);
    const tokenVersion = need(
      await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }),
      "tokenVersion",
    ).tokenVersion;
    const sahte = jwt.sign(
      { userId, username: "sahte-yonetici", permissions: ["*"], tokenVersion },
      secret,
      { jwtid: jti, expiresIn: 3600 },
    );
    const r1 = await kimlikDogrula(sahte);
    check("§1a sahte claim'li token kimlik doğrulamasından geçer (imza + oturum geçerli)", r1.err === null, JSON.stringify(r1.err));
    const izinler = r1.req.user?.permissions ?? [];
    check(
      "§1b req.user.permissions = DB kümesi (claim'deki '*' değil)",
      izinler.length === 1 && izinler[0] === "roll:read",
      JSON.stringify(izinler),
    );
    check("§1c kullanıcı adı DB'den (claim'deki sahte ad değil)", r1.req.user?.username === username, String(r1.req.user?.username));
    const yasak = izinKapisi(r1.req, "admin:users");
    check(
      "§1d requirePermission('admin:users') → 403 PERMISSION_DENIED",
      yasak?.statusCode === 403 && yasak?.details?.code === RBAC_DENIED_CODE,
      JSON.stringify(yasak),
    );
    check("§1e DB'de olan izin geçer (roll:read)", izinKapisi(r1.req, "roll:read") === null);
    const baskasininKimligi = jwt.sign(
      { userId: baskasi.id, username: "baskasi", permissions: ["*"], tokenVersion: 0 },
      secret,
      { jwtid: jti, expiresIn: 3600 },
    );
    const r1f = await kimlikDogrula(baskasininKimligi);
    check("§1f başkasının userId'si + kendi jti'si → 401", r1f.err?.statusCode === 401, JSON.stringify(r1f.err));

    // ── §2 önbellek TTL tazeliktir ─────────────────────────────────────────────
    await prisma.userPermission.updateMany({
      where: { userId, permissionId: rollRead.id },
      data: { validUntil: new Date(Date.now() - 1000) },
    });
    const r2a = await kimlikDogrula(giris.token);
    check(
      "§2a bump'sız DB değişikliği TTL içinde önbellekten (bayat küme döner)",
      r2a.err === null && (r2a.req.user?.permissions ?? []).includes("roll:read"),
      JSON.stringify(r2a.req.user?.permissions),
    );
    resetRequestPermissionCacheForTest();
    const r2b = await kimlikDogrula(giris.token);
    check(
      "§2b önbellek sıfırlanınca taze küme (süresi dolan izin düşer)",
      r2b.err === null && (r2b.req.user?.permissions ?? []).length === 0,
      JSON.stringify(r2b.req.user?.permissions),
    );
    await prisma.userPermission.updateMany({
      where: { userId, permissionId: rollRead.id },
      data: { validUntil: null },
    });
    const girisTaze = await AuthService.login(username, password);
    const r2c = await kimlikDogrula(girisTaze.token);
    check(
      "§2c yeni giriş önbelleği tazeler (bump'sız değişiklik TTL beklemeden görünür)",
      r2c.err === null && (r2c.req.user?.permissions ?? []).includes("roll:read"),
      JSON.stringify(r2c.req.user?.permissions),
    );

    // ── §3 izin yazıcısı tokenVersion'ı artırır ────────────────────────────────
    await PermissionManagementService.grantPermission(userId, { permissionId: orderRead.id }, undefined);
    const r3a = await kimlikDogrula(girisTaze.token);
    check("§3a grant sonrası eski token 401 (tokenVersion arttı)", r3a.err?.statusCode === 401, JSON.stringify(r3a.err));
    const giris2 = await AuthService.login(username, password);
    const r3b = await kimlikDogrula(giris2.token);
    const izinler3 = r3b.req.user?.permissions ?? [];
    check(
      "§3b yeni giriş yeni izni taşır (roll:read + order:read)",
      r3b.err === null && izinler3.includes("order:read") && izinler3.includes("roll:read"),
      JSON.stringify(izinler3),
    );

    // ── §4 tavan 0 + zaman aşımı kapalı → exp'li token ─────────────────────────
    await rawSet(AUTO_KEY, false, userId);
    await rawSet(CAP_KEY, 0, userId);
    const giris4 = await AuthService.login(username, password);
    const d4 = jwt.verify(giris4.token, secret) as { iat: number; exp?: number };
    const beklenen = MAX_ABSOLUTE_SESSION_CAP_DAYS * 86_400;
    check("§4a token exp claim'i TAŞIR", typeof d4.exp === "number", `exp=${String(d4.exp)}`);
    check(
      `§4b exp - iat ≈ ${MAX_ABSOLUTE_SESSION_CAP_DAYS} gün`,
      typeof d4.exp === "number" && Math.abs(d4.exp - d4.iat - beklenen) <= 5,
      `fark=${typeof d4.exp === "number" ? d4.exp - d4.iat : "yok"}s`,
    );
    const oturum4 = await prisma.session.findUnique({ where: { jti: jtiOf(giris4.token) }, select: { expiresAt: true } });
    check(
      "§4c Session.expiresAt token exp'iyle hizalı",
      !!oturum4?.expiresAt && typeof d4.exp === "number" && Math.abs(oturum4.expiresAt.getTime() / 1000 - d4.exp) <= 2,
    );

    // ── §5 exp'siz eski token kabul + tek uyarı ────────────────────────────────
    const tv5 = need(
      await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } }),
      "tokenVersion",
    ).tokenVersion;
    const eski = jwt.sign(
      { userId, username, permissions: ["roll:read"], tokenVersion: tv5 },
      secret,
      { jwtid: jtiOf(giris4.token) },
    );
    check("§5a fikstür: elle imzalı token exp'siz", (jwt.decode(eski) as { exp?: number }).exp === undefined);
    const uyarilar: string[] = [];
    console.warn = (...args: unknown[]) => {
      uyarilar.push(args.map(String).join(" "));
    };
    const r5a = await kimlikDogrula(eski);
    const r5b = await kimlikDogrula(eski);
    console.warn = origWarn;
    check("§5b exp'siz eski token KABUL (iki istek)", r5a.err === null && r5b.err === null, JSON.stringify(r5a.err ?? r5b.err));
    const expUyarisi = uyarilar.filter((u) => u.includes("exp'siz") && u.includes(username));
    check("§5c oturum başına TEK uyarı", expUyarisi.length === 1, `uyarı=${expUyarisi.length}`);
    check("§5d uyarı token ya da sır taşımaz", !uyarilar.some((u) => u.includes(eski) || u.includes(secret)));
  } finally {
    await temizle();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("💥", e);
  await prisma.$disconnect();
  process.exit(1);
});
