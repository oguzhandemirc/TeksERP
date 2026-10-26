// =============================================================================
// BEKÇİ — PIN / KART GİRİŞİNDE İKİNCİ FAKTÖR (güvenlik denetimi Y-02)
// Çalıştır: npx tsx scripts/test_kimlik_kisa_yol_totp.ts [--sonda=y02|--sonda=statik]
// =============================================================================
// NEDEN: salt-PIN girişinde PIN tek başına kimliktir; süperadmin 2FA açsa da tablette
// PIN/kartla kodsuz giriyordu (ikinci faktör yalnız parolalı yolda soruluyordu). Artık
// üç giriş yolu TEK boğazdan (`assertSecondFactor`) geçer:
//   • süperadmin PIN/kart: HER ZAMAN kod; 2FA kurulmamışsa 403 TOTP_ENROLLMENT_REQUIRED
//   • diğerleri PIN/kart: TOTP açık ∧ `auth.shortCredentialTotpRequired` (varsayılan kapalı)
//
// §1 süperadmin PIN: 2FA yok → 403 · kodsuz 409 · yanlış 401 · doğru 200 · reddedilen oturum açmaz
// §2 süperadmin kart: aynı dört durum
// §3 normal kullanıcı: bayrak kapalı → PIN/kart kodsuz 200 (bugünkü davranış); açık → 409, kodla 200;
//    2FA kapalı kullanıcıya bayrak açıkken de sorulmaz
// §4 ileti: eski tablet (`totpCapable` yok) "güncelleyin" duyar, yeni tablet kısa ileti
// §5 statik: loginWithCard/loginWithQuickPin kapıyı issueToken'dan ÖNCE çağırır; bayrak varsayılanı false
// SONDA (kalıcı): --sonda=y02    → kapı no-op'a çevrilir (kapıyı atlayan eski yol) — §1–§3 KIRMIZI olmalı
//                 --sonda=statik → §5 metninden PIN yolundaki kapı çağrısı silinir — KIRMIZI olmalı
// =============================================================================
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import prisma from "../src/lib/prisma";
import { AuthService, type LoginContext } from "../src/services/auth.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const SONDA = process.argv.find((a) => a.startsWith("--sonda="))?.slice("--sonda=".length) ?? null;
const KOK = resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** "200" ya da "<status>:<code>" — kırmızı kontrol olur, koşum düşmez. */
async function sonuc(fn: () => Promise<unknown>): Promise<{ r: string; message: string }> {
  try {
    await fn();
    return { r: "200", message: "" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { r: `${err.statusCode ?? "?"}:${err.details?.code ?? ""}`, message: err.message ?? String(e) };
  }
}

const ozgun = new Map<string, { value: unknown } | null>();
async function ayarYaz(key: string, value: unknown) {
  if (!ozgun.has(key)) {
    const r = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    ozgun.set(key, r ? { value: r.value } : null);
  }
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: "TEST kimlik-3 Y-02" },
    update: { value: value as never },
  });
  invalidateFeatureFlagsCache();
}
async function ayarGeriYukle() {
  for (const [key, row] of ozgun) {
    if (row === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: row.value as never } });
  }
  invalidateFeatureFlagsCache();
}

const ids: string[] = [];
let adminId = "";
async function kullanici(ek: string, isSystemAccount = false) {
  const u = await prisma.user.create({
    data: {
      username: `TEST-y02-${ek}-${Date.now()}`,
      passwordHash: await AuthService.hashPassword("Deneme-y02-12345"),
      fullName: `TEST Y-02 ${ek}`,
      isSystemAccount,
    },
    select: { id: true },
  });
  ids.push(u.id);
  return u.id;
}
/** 2FA'yı meşru yoldan (pencere) kurar; sırrı döner — kod üretimi için. */
async function totpKur(userId: string): Promise<string> {
  const w = await TotpAccountService.openWindow({ userId, openedById: adminId });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  return w.secret;
}
// Kurulum şimdiki adımı tüketti (replay kilidi); her sır bir kez doğru kodla girer → bir sonraki adım (pencere ±1).
const kod = (secret: string) => totpCodeForStep(secret, totpStep() + 1);

const yeniTablet: LoginContext = { clientType: "mobile", totpCapable: true };

type Giris = (ctx: LoginContext) => Promise<unknown>;
async function dortDurum(baslik: string, userId: string, giris: Giris, secretAl: () => Promise<string>) {
  const kurulumsuz = await sonuc(() => giris(yeniTablet));
  check(`${baslik}a ⭐ süperadmin 2FA kurulmamış → 403 TOTP_ENROLLMENT_REQUIRED`, kurulumsuz.r === "403:TOTP_ENROLLMENT_REQUIRED", kurulumsuz.r);
  check(`${baslik}a' ileti parolalı girişe yönlendirir`, /parola/i.test(kurulumsuz.message), kurulumsuz.message);
  const secret = await secretAl();
  const kodsuz = await sonuc(() => giris(yeniTablet));
  check(`${baslik}b ⭐ 2FA açık süperadmin kodsuz → 409 TOTP_REQUIRED`, kodsuz.r === "409:TOTP_REQUIRED", kodsuz.r);
  const yanlis = await sonuc(() => giris({ ...yeniTablet, totpCode: "000000" }));
  check(`${baslik}c yanlış kod → 401 TOTP_INVALID`, yanlis.r === "401:TOTP_INVALID", yanlis.r);
  const oturum = await prisma.session.count({ where: { userId } });
  check(`${baslik}d reddedilen denemeler oturum AÇMADI (kapı issueToken'dan önce)`, oturum === 0, `${oturum}`);
  const dogru = await sonuc(() => giris({ ...yeniTablet, totpCode: kod(secret) }));
  check(`${baslik}e doğru kod → 200`, dogru.r === "200", dogru.r);
  return secret;
}

async function superadmin() {
  console.log("\n=== §1–§2 süperadmin PIN / kart ===");
  const sa = await kullanici("sa", true);
  const pin = (await AuthService.setQuickPin(sa, {}, adminId)).pin!;
  let secret = "";
  secret = await dortDurum("§1", sa, (ctx) => AuthService.loginWithQuickPin(pin, ctx), () => totpKur(sa));
  // Kart yolu: 2FA'yı geri kapatıp aynı dört durumu ölç.
  await TotpAccountService.reset({ userId: sa, byId: adminId });
  await prisma.session.deleteMany({ where: { userId: sa } });
  const kart = await AuthService.rotateCardToken(sa, adminId);
  secret = await dortDurum("§2", sa, (ctx) => AuthService.loginWithCard(kart.cardCode, ctx), () => totpKur(sa));
  // §4 eski tablet iletisi (totpCapable yok) — kod soramayan tablet "güncelleyin" duyar.
  const eski = await sonuc(() => AuthService.loginWithQuickPin(pin, { clientType: "mobile" }));
  check("§4a eski tablet (totpCapable yok) → 409 + 'güncelleyin'", eski.r === "409:TOTP_REQUIRED" && /güncelleyin/.test(eski.message), eski.message);
  const yeni = await sonuc(() => AuthService.loginWithQuickPin(pin, yeniTablet));
  check("§4b yeni tablet → kısa ileti", yeni.r === "409:TOTP_REQUIRED" && yeni.message === "Doğrulama kodu gerekli.", yeni.message);
  void secret;
}

async function normalKullanici() {
  console.log("\n=== §3 normal kullanıcı — bayrak auth.shortCredentialTotpRequired ===");
  const u = await kullanici("normal");
  const kapali2fa = await kullanici("2fa-yok");
  const pin = (await AuthService.setQuickPin(u, {}, adminId)).pin!;
  const pinYok = (await AuthService.setQuickPin(kapali2fa, {}, adminId)).pin!;
  const kart = await AuthService.rotateCardToken(u, adminId);
  const secret = await totpKur(u);

  await ayarYaz(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_TOTP_REQUIRED, false);
  const p0 = await sonuc(() => AuthService.loginWithQuickPin(pin, yeniTablet));
  const c0 = await sonuc(() => AuthService.loginWithCard(kart.cardCode, yeniTablet));
  check("§3a bayrak kapalı → 2FA açık kullanıcı PIN ile kodsuz 200 (bugünkü davranış)", p0.r === "200", p0.r);
  check("§3b bayrak kapalı → kartla kodsuz 200", c0.r === "200", c0.r);

  await ayarYaz(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_TOTP_REQUIRED, true);
  const p1 = await sonuc(() => AuthService.loginWithQuickPin(pin, yeniTablet));
  check("§3c ⭐ bayrak açık → PIN kodsuz 409 TOTP_REQUIRED", p1.r === "409:TOTP_REQUIRED", p1.r);
  const p2 = await sonuc(() => AuthService.loginWithQuickPin(pin, { ...yeniTablet, totpCode: kod(secret) }));
  check("§3d bayrak açık → PIN + doğru kod 200", p2.r === "200", p2.r);
  const c1 = await sonuc(() => AuthService.loginWithCard(kart.cardCode, yeniTablet));
  check("§3e ⭐ bayrak açık → kart kodsuz 409 TOTP_REQUIRED", c1.r === "409:TOTP_REQUIRED", c1.r);
  const c2 = await sonuc(() => AuthService.loginWithCard(kart.cardCode, { ...yeniTablet, totpCode: "000000" }));
  check("§3f bayrak açık → kart + yanlış kod 401 TOTP_INVALID", c2.r === "401:TOTP_INVALID", c2.r);
  const y = await sonuc(() => AuthService.loginWithQuickPin(pinYok, yeniTablet));
  check("§3g bayrak açık ama 2FA kapalı kullanıcı → kodsuz 200 (açmayana sorulmaz)", y.r === "200", y.r);
}

function statik() {
  console.log("\n=== §5 statik ===");
  let auth = readFileSync(resolve(KOK, "src/services/auth.service.ts"), "utf8");
  if (SONDA === "statik") auth = auth.replace(`await this.assertSecondFactor(target.id, ctx, "quick-pin");`, "");
  const govde = (ad: string) => {
    const i = auth.indexOf(`static async ${ad}(`);
    const j = auth.indexOf("\n  static async ", i + 1);
    return i < 0 ? "" : auth.slice(i, j < 0 ? undefined : j);
  };
  for (const [ad, via] of [["loginWithCard", "card"], ["loginWithQuickPin", "quick-pin"], ["login", "password"]] as const) {
    let g = govde(ad);
    // D1: parolalı giriş doğrulamayı ortak `authenticatePassword`e devreder (yerinde onayla aynı doğrulayıcı);
    // kapı o gövdede aranır, devir çağrısı issueToken'dan ÖNCE olmalı.
    const devir = g.indexOf("this.authenticatePassword(");
    if (ad === "login" && devir >= 0) {
      const i = auth.indexOf("private static async authenticatePassword(");
      const j = auth.slice(i + 1).search(/\n {2}(private )?static async /);
      const yardimci = i < 0 ? "" : auth.slice(i, j < 0 ? undefined : i + 1 + j);
      g = g.slice(0, devir) + (yardimci.search(new RegExp(`assertSecondFactor\\([^)]*"${via}"\\)`)) >= 0 ? `assertSecondFactor(x, "${via}")` : "") + g.slice(devir);
    }
    const k = g.search(new RegExp(`assertSecondFactor\\([^)]*"${via}"\\)`));
    const t = g.indexOf("this.issueToken(");
    check(`§5a ${ad}: assertSecondFactor(…, "${via}") issueToken'dan ÖNCE`, g !== "" && k >= 0 && t > k, `kapı=${k} token=${t}`);
  }
  const svc = readFileSync(resolve(KOK, "src/services/system-setting.service.ts"), "utf8");
  check("§5b bayrak okuyucusu varsayılan false (asBoolean, yok=false)",
    /readShortCredentialTotpRequired[\s\S]{0,400}return asBoolean\(setting\?\.value\);/.test(svc));
}

async function main() {
  const engel = hedefDbEngeli();
  if (engel) { check("§0 hedef DB yazılabilir", false, engel); process.exit(1); }
  statik();
  setShortCredentialKeyDirForTests(mkdtempSync(join(tmpdir(), "bekci-y02-halka-")));
  if (SONDA === "y02") {
    // Kapıyı atlayan eski kısa yol: PIN/kart doğrudan token alırdı.
    Object.defineProperty(AuthService, "assertSecondFactor", { value: async () => undefined });
  }
  adminId = await kullanici("aktor");
  await ayarYaz(SETTING_KEYS.AUTH_LOGIN_METHODS, { enabled: ["list", "pin", "card"], primary: "list" });
  try {
    await superadmin();
    await normalKullanici();
  } finally {
    await ayarGeriYukle().catch((e) => check("ayar geri yükleme", false, String(e)));
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { OR: [{ userId: { in: ids } }, { recordId: { in: ids } }] } }).catch(() => undefined);
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
