// =============================================================================
// Bekçi: fabrikanın kendi yöneticisi (K4) — "yönetici var mı" yüklemi + açma ucu
// =============================================================================
// Ölçer:
//   §1 Yüklem (`factoryAdminWhere`): aktif + geçerli `admin:users`/`admin:*` sayılır; satıcı
//      (sistem) hesabı, pasif, silinmiş, süresi geçmiş, henüz başlamamış ve yalnız
//      `admin:settings` taşıyan hesap SAYILMAZ.
//   §2 POST /api/admin/factory-admin + /auth/me `factoryAdminExists`: yönetici varken 409;
//      gövdede parola/bayrak 400; başarı 201 + geçici parola bir kez, hesap zorunlu parola
//      değişimiyle, mobil izin/kimlik yok, sistem hesabı değil; audit parola taşımaz; ikinci
//      deneme (eşzamanlı dahil) ikinci hesap açamaz; izinsiz kullanıcı 403.
//   §3 Statik: /auth/me ve son-admin guard'ları ölçütü yüklemden okur (kopya yok).
// İzolasyon: TEST kullanıcıları silinir; §2 süresince mevcut fabrika yöneticileri pasife
// alınır ve `finally`de geri açılır. Sunucu bu süreçte 127.0.0.1:0'da açılır. DB GEREKİR.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import app from "../src/app";
import { AuthService } from "../src/services/auth.service";
import { factoryAdminWhere } from "../src/services/helpers/factory-admin.helper";
import { passwordPolicyViolation } from "../src/constants/password-policy";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console[ok ? "log" : "error"](`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Govde = { message?: string; data?: Record<string, unknown>; details?: { code?: string } };
type Yanit = { status: number; body: Govde };
const TS = Date.now();
const PAROLA = `Test-Parola-${TS}`;
const userIds: string[] = [];
const DAY = 86_400_000;

async function permId(code: string): Promise<string> {
  const p = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
  if (!p) throw new Error(`Fikstür bulunamadı: izin ${code}`);
  return p.id;
}

async function kullanici(
  ad: string,
  opts: { code?: string; isActive?: boolean; deleted?: boolean; sys?: boolean; from?: Date; until?: Date },
): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: `TEST-fy-${ad}-${TS}`,
      fullName: `TEST ${ad}`,
      passwordHash: await AuthService.hashPassword(PAROLA),
      isActive: opts.isActive ?? true,
      deletedAt: opts.deleted ? new Date() : null,
      isSystemAccount: opts.sys ?? false,
      ...(opts.code
        ? { permissions: { create: { permissionId: await permId(opts.code), validFrom: opts.from, validUntil: opts.until } } }
        : {}),
    },
    select: { id: true },
  });
  userIds.push(u.id);
  return u.id;
}

async function sayilirMi(id: string): Promise<boolean> {
  return (await prisma.user.count({ where: { AND: [factoryAdminWhere(new Date()), { id }] } })) === 1;
}

async function yuklem(): Promise<void> {
  const now = Date.now();
  const durumlar: Array<[string, Parameters<typeof kullanici>[1], boolean]> = [
    ["aktif admin:users", { code: "admin:users" }, true],
    ["aktif admin:*", { code: "admin:*" }, true],
    ["satıcı (sistem) hesabı + admin:users", { code: "admin:users", sys: true }, false],
    ["pasif admin:users", { code: "admin:users", isActive: false }, false],
    ["silinmiş admin:users", { code: "admin:users", deleted: true }, false],
    ["süresi geçmiş admin:users", { code: "admin:users", until: new Date(now - DAY) }, false],
    ["henüz başlamamış admin:users", { code: "admin:users", from: new Date(now + DAY) }, false],
    ["yalnız admin:settings", { code: "admin:settings" }, false],
  ];
  for (const [i, [ad, opts, beklenen]] of durumlar.entries()) {
    const id = await kullanici(`y${i}`, opts);
    check(`§1 ${ad} → ${beklenen ? "sayılır" : "SAYILMAZ"}`, (await sayilirMi(id)) === beklenen);
  }
}

function istemci(base: string) {
  return async (method: string, p: string, token: string | null, body?: unknown): Promise<Yanit> => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: Govde = {};
    try {
      parsed = (await r.json()) as Govde;
    } catch {
      /* boş gövde */
    }
    return { status: r.status, body: parsed };
  };
}
type Call = ReturnType<typeof istemci>;

async function giris(call: Call, username: string, password: string): Promise<Yanit> {
  return call("POST", "/api/auth/login", null, { username, password, clientType: "electron" });
}

async function yokkenAcma(call: Call, sysToken: string): Promise<void> {
  const me0 = await call("GET", "/api/auth/me", sysToken);
  check("§2c yönetici yokken /auth/me factoryAdminExists:false", me0.body.data?.factoryAdminExists === false);
  const yol = "/api/admin/factory-admin";
  for (const fazla of [{ password: PAROLA }, { mustChangePassword: false }, { permissions: ["*"] }]) {
    const r = await call("POST", yol, sysToken, { username: `TESTfyx${TS}`, fullName: "TEST X", ...fazla });
    check(`§2d gövdede ${Object.keys(fazla)[0]} → 400`, r.status === 400, `status=${r.status}`);
  }
  const username = `TESTfyA${TS}`;
  const [a, b] = await Promise.all([
    call("POST", yol, sysToken, { username, fullName: "TEST Fabrika Yöneticisi" }),
    call("POST", yol, sysToken, { username: `TESTfyB${TS}`, fullName: "TEST İkinci" }),
  ]);
  const basari = [a, b].filter((r) => r.status === 201);
  const red = [a, b].filter((r) => r.status === 409 && r.body.details?.code === "FACTORY_ADMIN_EXISTS");
  check("§2e eşzamanlı iki deneme → tam bir 201 + bir 409 FACTORY_ADMIN_EXISTS", basari.length === 1 && red.length === 1);
  const sonuc = basari[0]?.body.data as { user?: { id?: string; username?: string }; temporaryPassword?: string } | undefined;
  const parola = String(sonuc?.temporaryPassword ?? "");
  const yeniId = String(sonuc?.user?.id ?? "");
  if (yeniId) userIds.push(yeniId);
  check("§2f geçici parola döndü ve politikaya uyuyor", parola.length >= 10 && passwordPolicyViolation(parola) === null);
  if (yeniId) await hesapDurumu(yeniId, parola);
  else check("§2g-i hesap açılmadığı için ölçülemedi", false);
  const me1 = await call("GET", "/api/auth/me", sysToken);
  check("§2j açıldıktan sonra /auth/me factoryAdminExists:true", me1.body.data?.factoryAdminExists === true);
  const ucuncu = await call("POST", yol, sysToken, { username: `TESTfyC${TS}`, fullName: "TEST Üçüncü" });
  check("§2k ardışık ikinci deneme → 409 FACTORY_ADMIN_EXISTS", ucuncu.body.details?.code === "FACTORY_ADMIN_EXISTS");
  const login = await giris(call, String(sonuc?.user?.username ?? ""), parola);
  check("§2l geçici parolayla panel girişi → mustChangePassword:true", login.body.data?.mustChangePassword === true);
}

async function hesapDurumu(id: string, parola: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      mustChangePassword: true, isSystemAccount: true, quickPinDigest: true, cardTokenDigest: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  const kodlar = (u?.permissions ?? []).map((p) => p.permission.code);
  check("§2g hesap mustChangePassword:true, sistem hesabı DEĞİL", u?.mustChangePassword === true && u.isSystemAccount === false);
  check("§2h Admin (Tam Yetki) uygulandı, hızlı PIN/kart üretilmedi", kodlar.includes("admin:users") && !u?.quickPinDigest && !u?.cardTokenDigest, `${kodlar.length} izin`);
  let audit: { newData: unknown } | null = null;
  for (let i = 0; i < 20 && !audit; i++) {
    audit = await prisma.systemLog.findFirst({ where: { tableName: "users", recordId: id, action: "CREATE" }, select: { newData: true } });
    if (!audit) await new Promise((r) => setTimeout(r, 100));
  }
  const metin = JSON.stringify(audit?.newData ?? null);
  check("§2i audit satırı yazıldı ve geçici parolayı taşımıyor", audit !== null && !metin.includes(parola) && !metin.includes("$2"), metin);
}

async function uc(): Promise<void> {
  // Satıcı hesabı §1'in sistem hesabıdır (y2) — ikinci bir sistem hesabı doğurulmaz.
  await kullanici("oku", { code: "roll:read" });
  const mevcut = await prisma.user.findMany({ where: { AND: [factoryAdminWhere(new Date()), { id: { notIn: userIds } }] }, select: { id: true } });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const call = istemci(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const yoneticiler = mevcut.map((m) => m.id);
  try {
    const sysToken = String((await giris(call, `TEST-fy-y2-${TS}`, PAROLA)).body.data?.token ?? "");
    const okuToken = String((await giris(call, `TEST-fy-oku-${TS}`, PAROLA)).body.data?.token ?? "");
    check("§2a izinsiz (roll:read) kullanıcı → 403", (await call("POST", "/api/admin/factory-admin", okuToken, { username: `TESTfyz${TS}`, fullName: "TEST Z" })).status === 403);
    if (yoneticiler.length > 0) {
      const r = await call("POST", "/api/admin/factory-admin", sysToken, { username: `TESTfyv${TS}`, fullName: "TEST V" });
      check("§2b yönetici varken → 409 FACTORY_ADMIN_EXISTS", r.body.details?.code === "FACTORY_ADMIN_EXISTS", `status=${r.status}`);
    }
    // §1'in kendi yöneticileri de (y0, y1) susturulur; geri açılan yalnız fabrikanınkiler.
    await prisma.user.updateMany({ where: { id: { in: [...yoneticiler, ...userIds] } }, data: { isActive: false } });
    await prisma.user.updateMany({ where: { id: { in: userIds }, isSystemAccount: true }, data: { isActive: true } });
    await yokkenAcma(call, sysToken);
  } finally {
    await prisma.user.updateMany({ where: { id: { in: yoneticiler } }, data: { isActive: true } });
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function statik(): void {
  const oku = (p: string): string => readFileSync(join(__dirname, "..", p), "utf8");
  const me = oku("src/controllers/auth.controller.ts");
  check("§3a /auth/me ölçütü yüklemden okur", /factoryAdminExists\s*=\s*await factoryAdminExistsCheck\(\)/.test(me));
  const pms = oku("src/services/permission-management.service.ts");
  check(
    "§3b son-admin guard penceresi ve kodlar yüklemden (kopya yok)",
    pms.includes("return effectiveUserAdminGrantWhere(now);") && pms.includes("ADMIN_CODES = USER_ADMIN_CODES") && !pms.includes('"admin:users", "admin:*"'),
  );
}

async function temizle(): Promise<void> {
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { recordId: { in: userIds } }] } });
  await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main(): Promise<void> {
  try {
    statik();
    await yuklem();
    await uc();
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("💥", e);
  await prisma.$disconnect();
  process.exit(1);
});
