// =============================================================================
// Bekçi: zorunlu parola değişimi + ilk kurulum parolası (G20 — FAB-3 · SIR-2)
// =============================================================================
// Ölçer:
//   §1 Değişim bekleyen hesap: panel girişi token + `mustChangePassword:true` alır; tablet
//      (parola ve hızlı PIN) 403 PASSWORD_CHANGE_REQUIRED; token yalnız /auth/me ·
//      /auth/logout · /auth/change-password'e geçer, başka her uç 403.
//   §2 POST /auth/change-password: yanlış mevcut 400 CURRENT_PASSWORD_INVALID · politika
//      (10 karakter) 400 · aynı parola PASSWORD_UNCHANGED · başarı → bayrak iner, tokenVersion
//      +1, bütün oturumlar PASSWORD_RESET, audit satırı parola taşımaz, eski token 401.
//   §3 Satıcı (sistem) hesabı kendi parolasını bu uçtan değiştiremez (403).
//   §4 İlk yönetici parolası: verilmezse 16 karakter rastgele + zorunlu değişim; politika
//      dışı değer reddedilir; geçerli değer zorunlu değişimle doğar.
//   §5 Statik: beyanlı uç kümesi tam üç · admin uçlarında 6 karakter kuralı yok · panel
//      politika aynası backend'e eşit · kurulum betiklerinde sabit parola yok · iki compose
//      ILK_YONETICI_PAROLASI geçirir · sabit geliştirme parolası yalnız `--gelistirme`le.
// İzolasyon: TEST kullanıcıları + giriş yöntemi ayarı anlık görüntüsü; `temizle()` geri
// yükler/siler. Sunucu bu süreçte 127.0.0.1:0'da açılır. DB GEREKİR.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Prisma } from "@prisma/client";
import app from "../src/app";
import { AuthService, PASSWORD_CHANGE_REQUIRED_CODE } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordPolicyViolation } from "../src/constants/password-policy";
import { ilkYoneticiParolasi } from "../src/lib/ilk-yonetici-parolasi";

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

const BACKEND = join(__dirname, "..");
const KOK = join(BACKEND, "..");
const oku = (p: string): string => readFileSync(p, "utf8");
const METHODS_KEY = SETTING_KEYS.AUTH_LOGIN_METHODS;
type Govde = { message?: string; data?: Record<string, unknown>; details?: { code?: string } };
type Yanit = { status: number; body: Govde };
type Hata = { statusCode?: number; details?: { code?: string } };

async function hataYakala(fn: () => Promise<unknown>): Promise<Hata | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Hata;
  }
}

function tsDosyalari(dizin: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dizin)) {
    const yol = join(dizin, ad);
    if (statSync(yol).isDirectory()) out.push(...tsDosyalari(yol));
    else if (ad.endsWith(".ts")) out.push(yol);
  }
  return out;
}

async function dinamik(): Promise<void> {
  const ts = Date.now();
  const rollRead = await prisma.permission.findUnique({ where: { code: "roll:read" }, select: { id: true } });
  if (!rollRead) throw new Error("Fikstür bulunamadı: izin roll:read");
  const methodsOnce = await prisma.systemSetting.findUnique({
    where: { key: METHODS_KEY },
    select: { value: true, updatedById: true },
  });

  const username = `TEST-pdz-${ts}`;
  const ilkParola = `Ilk-Parola-${ts}`;
  const yeniParola = `Yeni-Parola-${ts}`;
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await AuthService.hashPassword(ilkParola),
      fullName: "TEST Zorunlu Parola",
      mustChangePassword: true,
      permissions: { create: { permissionId: rollRead.id } },
    },
    select: { id: true, tokenVersion: true },
  });
  const sistem = await prisma.user.create({
    data: {
      username: `TEST-pdz-sis-${ts}`,
      passwordHash: await AuthService.hashPassword(ilkParola),
      fullName: "TEST Sistem Hesabı",
      isSystemAccount: true,
    },
    select: { id: true },
  });
  const userIds = [user.id, sistem.id];

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<Yanit> => {
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

  async function temizle(): Promise<void> {
    await new Promise<void>((r) => server.close(() => r()));
    if (methodsOnce === null) await prisma.systemSetting.deleteMany({ where: { key: METHODS_KEY } });
    else
      await prisma.systemSetting.update({
        where: { key: METHODS_KEY },
        data: { value: methodsOnce.value as Prisma.InputJsonValue, updatedById: methodsOnce.updatedById },
      });
    invalidateFeatureFlagsCache();
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.systemLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { recordId: { in: [...userIds, username] } }] },
    });
    await prisma.userPermission.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  try {
    // ── §1 değişim bekleyen hesap ──────────────────────────────────────────────
    const panel = await call("POST", "/api/auth/login", null, { username, password: ilkParola, clientType: "electron" });
    const panelToken = String(panel.body.data?.token ?? "");
    check(
      "§1a panel girişi 200 + mustChangePassword:true + token",
      panel.status === 200 && panel.body.data?.mustChangePassword === true && panelToken.length > 0,
      `status=${panel.status}`,
    );
    const tablet = await call("POST", "/api/auth/login", null, { username, password: ilkParola, clientType: "mobile" });
    check(
      "§1b tablet parola girişi 403 PASSWORD_CHANGE_REQUIRED (Türkçe mesaj)",
      tablet.status === 403 &&
        tablet.body.details?.code === PASSWORD_CHANGE_REQUIRED_CODE &&
        /parola/i.test(tablet.body.message ?? ""),
      `status=${tablet.status} code=${String(tablet.body.details?.code)}`,
    );
    await prisma.systemSetting.upsert({
      where: { key: METHODS_KEY },
      create: { key: METHODS_KEY, value: { enabled: ["list", "pin"], primary: "list" }, updatedById: user.id },
      update: { value: { enabled: ["list", "pin"], primary: "list" }, updatedById: user.id },
    });
    invalidateFeatureFlagsCache();
    const { pin } = await AuthService.setQuickPin(user.id, {}, undefined);
    const pinHata = await hataYakala(() => AuthService.loginWithQuickPin(pin ?? "", { clientType: "mobile" }));
    check(
      "§1c tablet hızlı PIN girişi 403 PASSWORD_CHANGE_REQUIRED",
      pinHata?.statusCode === 403 && pinHata?.details?.code === PASSWORD_CHANGE_REQUIRED_CODE,
      JSON.stringify(pinHata?.details ?? null),
    );
    const me = await call("GET", "/api/auth/me", panelToken);
    check(
      "§1d /auth/me geçer ve mustChangePassword:true döner",
      me.status === 200 && me.body.data?.mustChangePassword === true,
      `status=${me.status}`,
    );
    const pref = await call("GET", "/api/auth/preferences", panelToken);
    check(
      "§1e beyansız uç (/auth/preferences) 403 PASSWORD_CHANGE_REQUIRED",
      pref.status === 403 && pref.body.details?.code === PASSWORD_CHANGE_REQUIRED_CODE,
      `status=${pref.status}`,
    );
    const rolls = await call("GET", "/api/rolls?limit=1", panelToken);
    check(
      "§1f izinli iş ucu (/api/rolls) da 403 PASSWORD_CHANGE_REQUIRED",
      rolls.status === 403 && rolls.body.details?.code === PASSWORD_CHANGE_REQUIRED_CODE,
      `status=${rolls.status}`,
    );

    // ── §2 kendi parolasını değiştirme ─────────────────────────────────────────
    const yanlis = await call("POST", "/api/auth/change-password", panelToken, {
      currentPassword: "yanlis-parola-x",
      newPassword: yeniParola,
    });
    check(
      "§2a yanlış mevcut parola 400 CURRENT_PASSWORD_INVALID (401 değil)",
      yanlis.status === 400 && yanlis.body.details?.code === "CURRENT_PASSWORD_INVALID",
      `status=${yanlis.status}`,
    );
    const kisa = await call("POST", "/api/auth/change-password", panelToken, {
      currentPassword: ilkParola,
      newPassword: "x".repeat(PASSWORD_MIN_LENGTH - 1),
    });
    check(
      `§2b ${PASSWORD_MIN_LENGTH - 1} karakter 400 + politika mesajı`,
      kisa.status === 400 && JSON.stringify(kisa.body).includes(`${PASSWORD_MIN_LENGTH} karakter`),
      `status=${kisa.status}`,
    );
    const servisKisa = await hataYakala(() =>
      AuthService.changeOwnPassword(user.id, ilkParola, "x".repeat(PASSWORD_MIN_LENGTH - 1)),
    );
    check("§2c servis katmanı da politikayı uygular (PASSWORD_POLICY)", servisKisa?.details?.code === "PASSWORD_POLICY");
    const ayni = await call("POST", "/api/auth/change-password", panelToken, {
      currentPassword: ilkParola,
      newPassword: ilkParola,
    });
    check(
      "§2d aynı parola 400 PASSWORD_UNCHANGED",
      ayni.status === 400 && ayni.body.details?.code === "PASSWORD_UNCHANGED",
      `status=${ayni.status}`,
    );
    const once = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenVersion: true } });
    const ok = await call("POST", "/api/auth/change-password", panelToken, {
      currentPassword: ilkParola,
      newPassword: yeniParola,
    });
    check("§2e doğru istek 200", ok.status === 200, `status=${ok.status}`);
    const sonra = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { tokenVersion: true, mustChangePassword: true },
    });
    check("§2f bayrak indi + tokenVersion +1", !sonra.mustChangePassword && sonra.tokenVersion === once.tokenVersion + 1);
    const acik = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    const sifirlanan = await prisma.session.count({ where: { userId: user.id, revokeReason: "PASSWORD_RESET" } });
    check("§2g bütün oturumlar PASSWORD_RESET ile kapandı", acik === 0 && sifirlanan >= 1, `açık=${acik} sıfırlanan=${sifirlanan}`);
    let audit: { newData: Prisma.JsonValue } | null = null;
    for (let i = 0; i < 20 && !audit; i++) {
      audit = await prisma.systemLog.findFirst({
        where: { tableName: "USER_PASSWORD", recordId: user.id },
        select: { newData: true },
      });
      if (!audit) await new Promise((r) => setTimeout(r, 100));
    }
    const auditMetni = JSON.stringify(audit?.newData ?? null);
    check(
      "§2h audit satırı yazıldı ve parola taşımıyor",
      audit !== null && !auditMetni.includes(yeniParola) && !auditMetni.includes(ilkParola) && !auditMetni.includes("$2"),
      auditMetni,
    );
    const eskiToken = await call("GET", "/api/auth/me", panelToken);
    check("§2i eski token 401", eskiToken.status === 401, `status=${eskiToken.status}`);
    const tabletYeni = await call("POST", "/api/auth/login", null, { username, password: yeniParola, clientType: "mobile" });
    check("§2j yeni parolayla tablet girişi 200", tabletYeni.status === 200, `status=${tabletYeni.status}`);

    // ── §3 satıcı hesabı ───────────────────────────────────────────────────────
    const sis = await hataYakala(() => AuthService.changeOwnPassword(sistem.id, ilkParola, yeniParola));
    check(
      "§3 satıcı hesabı kendi parolasını bu uçtan değiştiremez (403)",
      sis?.statusCode === 403 && sis?.details?.code === "SYSTEM_ACCOUNT_PASSWORD",
      JSON.stringify(sis?.details ?? null),
    );
  } finally {
    await temizle();
  }
}

function birim(): void {
  // ── §4 ilk yönetici parolası ─────────────────────────────────────────────────
  for (const verilen of [undefined, ""]) {
    const r = ilkYoneticiParolasi(verilen);
    check(
      `§4a verilmeyen (${JSON.stringify(verilen)}) → 16 karakter rastgele, üretildi, zorunlu değişim`,
      r.parola.length === 16 && r.uretildi && r.mustChangePassword && passwordPolicyViolation(r.parola) === null,
    );
  }
  check("§4b iki üretim farklı", ilkYoneticiParolasi(undefined).parola !== ilkYoneticiParolasi(undefined).parola);
  let red = false;
  try {
    ilkYoneticiParolasi("kisa");
  } catch {
    red = true;
  }
  check("§4c politika dışı ILK_YONETICI_PAROLASI reddedilir", red);
  const gecerli = ilkYoneticiParolasi("Gecerli-Parola-1");
  check(
    "§4d geçerli değer aynen + zorunlu değişim",
    gecerli.parola === "Gecerli-Parola-1" && gecerli.mustChangePassword && !gecerli.uretildi,
  );
}

function statik(): void {
  // ── §5 statik sözleşmeler ────────────────────────────────────────────────────
  const kullanimlar: string[] = [];
  for (const f of tsDosyalari(join(BACKEND, "src"))) {
    const metin = oku(f);
    if (!metin.includes("verifyTokenAllowPasswordChange")) continue;
    if (f.endsWith(join("middlewares", "auth.middleware.ts"))) continue;
    const ad = f.slice(BACKEND.length + 1);
    for (const m of metin.matchAll(/router\.(\w+)\(\s*"([^"]+)",\s*verifyTokenAllowPasswordChange\b/g)) {
      kullanimlar.push(`${ad} ${m[1]} ${m[2]}`);
    }
    const ham = (metin.match(/verifyTokenAllowPasswordChange\b/g) ?? []).length;
    const rota = [...metin.matchAll(/router\.\w+\(\s*"[^"]+",\s*verifyTokenAllowPasswordChange\b/g)].length;
    const importlu = /import \{[^}]*verifyTokenAllowPasswordChange[^}]*\} from/.test(metin) ? 1 : 0;
    if (ham !== rota + importlu) kullanimlar.push(`${ad} BEYANSIZ kullanım (${ham - rota - importlu})`);
  }
  const beklenen = [
    "src/routes/auth.routes.ts get /me",
    "src/routes/auth.routes.ts post /change-password",
    "src/routes/auth.routes.ts post /logout",
  ];
  check(
    "§5a değişim bekleyen hesabın geçtiği uç kümesi TAM üç (me · logout · change-password)",
    JSON.stringify([...kullanimlar].sort()) === JSON.stringify(beklenen),
    kullanimlar.join(" | "),
  );
  const admin = oku(join(BACKEND, "src/routes/admin.routes.ts"));
  check("§5b admin uçlarında eski 6 karakter kuralı yok, politika tek kaynaktan", !/min\(6\b/.test(admin) && admin.includes("passwordPolicyViolation("));
  const panel = oku(join(KOK, "Electron/src/lib/password-policy.ts"));
  check(
    "§5c panel politika aynası backend'e eşit",
    panel.includes(`PASSWORD_MIN_LENGTH = ${PASSWORD_MIN_LENGTH};`) && panel.includes(`PASSWORD_MAX_BYTES = ${PASSWORD_MAX_BYTES};`),
  );
  // setup.exe sihirbazı satıcı parolasını politikadan önce süzer: kısa eşik kurulumu en sonda (hesap aşamasında) düşürürdü.
  const sihirbaz = oku(join(KOK, "deploy/kurulum/tekserp-kurulum.iss"));
  check(
    "§5c2 kurulum sihirbazının satıcı parolası eşiği politikaya eşit",
    sihirbaz.includes(`Length(SaticiSayfasi.Values[1]) < ${PASSWORD_MIN_LENGTH} then`) &&
      sihirbaz.includes(`Utf8Bayt(SaticiSayfasi.Values[1]) > ${PASSWORD_MAX_BYTES} then`) &&
      (sihirbaz.match(/Length\(SaticiSayfasi\.Values\[1\]\) < \d+/g) ?? []).length === 1,
  );
  const betikler = ["installer/docker/yonet.ps1", "baslat.sh", "docker/entrypoint.sh"];
  const sabitli = betikler.filter((b) => oku(join(BACKEND, b)).includes("123123"));
  check("§5d kurulum betiklerinde sabit parola yok", sabitli.length === 0, sabitli.join(", "));
  const composeEksik = ["docker-compose.yml", "docker/korumali/docker-compose.yml"].filter(
    (c) => !oku(join(BACKEND, c)).includes("ILK_YONETICI_PAROLASI"),
  );
  check("§5e iki compose ILK_YONETICI_PAROLASI geçirir", composeEksik.length === 0, composeEksik.join(", "));
  const seed = oku(join(BACKEND, "prisma/seed.ts"));
  const config = oku(join(BACKEND, "prisma.config.ts"));
  const entry = oku(join(BACKEND, "docker/entrypoint.sh"));
  check(
    "§5f sabit geliştirme parolası yalnız `--gelistirme`le (prisma.config), Docker seed'i bayraksız",
    /gelistirme\s*\n?\s*\?\s*\{ parola: "123123"/.test(seed) &&
      seed.includes("ilkYoneticiParolasi(process.env.ILK_YONETICI_PAROLASI)") &&
      /seed:.*--gelistirme/.test(config) &&
      !entry.includes("--gelistirme"),
  );
}

async function main(): Promise<void> {
  birim();
  statik();
  await dinamik();
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
