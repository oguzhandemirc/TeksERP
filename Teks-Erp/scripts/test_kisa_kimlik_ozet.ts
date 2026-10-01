// =============================================================================
// BEKÇİ — KISA KİMLİKLER (hızlı PIN + QR kart) ÖZETLİ SAKLAMA (G21)
// Çalıştır: npx tsx scripts/run-all-tests.ts kisa_kimlik_ozet
//           npx tsx scripts/test_kisa_kimlik_ozet.ts --sonda=<ad>   (KALICI sondalar, aşağıda)
// =============================================================================
// Korunan değişmezler:
//   §1 yeni PIN/kart DB'ye yalnız "<kid>:<HMAC>" özet olarak yazılır; düz kolon boş, değer
//      ne özette ne audit yükünde geçer; kart 256 bit
//   §2 STATİK: src'de `quickPin`/`cardToken` kolonuna `data` içinde null DIŞINDA değer yazan yok
//   §3 toplu dönüşüm: önizleme HER kullanıcıyı listeler, --apply düz kolonu boşaltır, ikinci
//      koşum 0 (idempotent); dönüşen PIN ve ESKİ 128 bit kart çalışır, kart "eski biçim" işaretli
//   §4 tembel dönüşüm: yalnız BAŞARILI girişte; başarısız girişte düz kalır; eşzamanlı iki
//      girişte TEK dönüşüm (atomik claim) ve tek ayak izi
//   §5 deneme kilidi KALICI: yeniden başlatma kilidi sıfırlamaz; anahtar SHA-256 (düz IP DB'de
//      yok); kart kullanıcı kovası farklı IP'lerden dağıtılmış denemeyi kilitler + LOGIN_LOCKED izi
//   §6 "yalnız onaylı cihaz": cihazsız PIN/kart 403 DEVICE_NOT_APPROVED (kilide sayılmaz),
//      eşleştirme ETKİN zorunlu, personel listesi kapalı; barındırılan sınıfta kapatılamaz
//   §7 YEDEK → YENİ MAKİNE benzetimi: anahtar yedek alıcılarına mühürlü emanette; yeni makinede
//      PIN/kart 401 SHORT_CREDENTIAL_KEY_MISMATCH; yanlış anahtar açamaz; yerel anahtar (yedek
//      parolası) ve kâğıt müşteri anahtarı geri koyar → PIN/kart çalışır; toplu PIN sıfırlama
//      emaneti olmayan makinede yeni PIN verir; yedek şifrelemesi kapalıyken emanet doğmaz
//   §8 sızıntı: audit yüklerinde verilen PIN/kart sırrı yok
//
// KALICI sondalar (her biri ilgili ⭐ kontrolü kırmızıya çevirmeli):
//   duz-kalir      §3 dönüşümden sonra bir düz değeri geri yazar
//   cift-donusum   §4 yarıştan sonra düzü geri koyup ikinci kez dönüştürür (iz sayısı 2)
//   kilit-bellekte §5 yeniden başlatmadan önce kalıcı kovaları siler (eski bellek-içi davranış)
//   cihaz-var      §6 cihazsız isteğe sahte cihaz takar
//   emanetsiz      §7 emaneti mühürlemeden yeni makineye geçer
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv → JWT_SECRET/DATABASE_URL
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import ts from "typescript";
import { AuthController } from "../src/controllers/auth.controller";
import { AuthService } from "../src/services/auth.service";
import { ShortCredentialService } from "../src/services/short-credential.service";
import { ShortCredentialAdminService } from "../src/services/short-credential-admin.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import {
  SETTING_KEYS,
  invalidateFeatureFlagsCache,
  readDevicePairingRequired,
  readShortCredentialApprovedDeviceOnly,
  systemSettingService,
} from "../src/services/system-setting.service";
import {
  getShortCredentialKeyRing,
  setShortCredentialKeyDirForTests,
} from "../src/lib/short-credential/keyring";
import { digestKid } from "../src/lib/short-credential/digest";
import { forgetIssuedPin } from "../src/services/helpers/credential-reveal.helper";
import {
  reserveLoginAttempt,
  simulateLockoutRestartForTests,
  flushLoginLockoutPersistence,
} from "../src/middlewares/login-lockout";
import {
  encodePublicKey,
  encodeSecretKey,
  generateRawKeyPair,
  privateKeyFromRaw,
  decodeSecretKey,
  readBackupCryptoConfig,
  unlockLocalKey,
  wrapSecretKey,
} from "../src/lib/backup-crypto";
import { AppError } from "../src/utils/app-error";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";

const SONDA = (process.argv.find((a) => a.startsWith("--sonda=")) ?? "").slice("--sonda=".length);
const KOK = path.join(__dirname, "..");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

function errCode(e: unknown): { status?: number; code?: string } {
  if (!(e instanceof AppError)) return {};
  return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code };
}

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, err };
  }
}

/** Controller'ı sahte req/res/next ile koştur. */
async function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  opts: { body?: unknown; ip: string; device?: Request["device"] },
): Promise<{ statusCode?: number; jsonBody?: unknown; nextError?: unknown }> {
  const req = { body: opts.body ?? {}, ip: opts.ip, headers: {}, device: opts.device } as unknown as Request;
  let statusCode: number | undefined;
  let jsonBody: unknown;
  const res = {
    status(c: number) { statusCode = c; return res; },
    json(b: unknown) { jsonBody = b; return res; },
  } as unknown as Response;
  let nextError: unknown;
  const next = ((e?: unknown) => { if (e) nextError = e; }) as unknown as NextFunction;
  await handler(req, res, next);
  return { statusCode, jsonBody, nextError };
}

const AYARLAR = [
  SETTING_KEYS.AUTH_LOGIN_METHODS,
  SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN,
  SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY,
  SETTING_KEYS.DEVICE_PAIRING_REQUIRED,
] as const;

/** §2 — `data` nesnesinde `quickPin`/`cardToken`e null DIŞINDA değer yazan atamalar. SAF. */
export function duzKolonYazimlari(kaynak: string, dosya: string): { ihlal: string[]; nullYazim: number } {
  const sf = ts.createSourceFile(dosya, kaynak, ts.ScriptTarget.Latest, true);
  const ihlal: string[] = [];
  let nullYazim = 0;
  const veriNesnesi = (n: ts.Node): boolean => {
    const p = n.parent;
    return !!p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && ["data", "create", "update"].includes(p.name.text);
  };
  const gez = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && ["quickPin", "cardToken"].includes(n.name.text)) {
      if (veriNesnesi(n.parent)) {
        if (n.initializer.kind === ts.SyntaxKind.NullKeyword) nullYazim++;
        else ihlal.push(`${dosya}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} ${n.getText(sf)}`);
      }
    }
    n.forEachChild(gez);
  };
  gez(sf);
  return { ihlal, nullYazim };
}

async function bosPin(haric: Set<string>): Promise<string> {
  const st = getShortCredentialKeyRing();
  if (!st.ok) throw new Error("halka yok");
  const { isQuickPinTaken } = await import("../src/services/short-credential.service");
  for (let i = 0; i < 500; i++) {
    const aday = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    if (haric.has(aday)) continue;
    if (!(await isQuickPinTaken(st.ring, aday, null))) return aday;
  }
  throw new Error("boş PIN bulunamadı");
}

async function main(): Promise<void> {
  console.log("=== KISA KİMLİK ÖZETİ (G21) ===");
  const engel = fixtureHedefEngeli();
  if (engel) {
    check("§0 hedef DB fixture kalıbında", false, engel);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  if (SONDA) console.log(`🧪 SONDA: ${SONDA}`);

  const t0 = new Date();
  const stamp = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g21-kisa-kimlik-"));
  const makine = (ad: string): string => path.join(tmp, `lisans-${ad}`);
  const eskiYedekAnahtarDizini = process.env.BACKUP_KEY_DIR;
  const eskiSinif = process.env.TEKSERP_KURULUM_SINIFI;
  delete process.env.TEKSERP_KURULUM_SINIFI;
  setShortCredentialKeyDirForTests(makine("A"));

  const orijinal = new Map<string, { value: Prisma.JsonValue; updatedById: string | null } | null>();
  for (const k of AYARLAR) {
    orijinal.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true, updatedById: true } }));
  }
  const kullanicilar: string[] = [];
  const yeniKullanici = async (etiket: string, legacy?: { pin?: string; card?: string }): Promise<{ id: string; username: string }> => {
    const u = await prisma.user.create({
      data: {
        username: `TEST-g21-${etiket}-${stamp}`.slice(0, 50),
        passwordHash: await AuthService.hashPassword("test-parola-1"),
        fullName: `TEST G21 ${etiket}`,
        // ESKİ dönem benzetimi: düz değerler YALNIZ fikstürde, doğrudan DB'ye yazılır.
        ...(legacy?.pin ? { quickPin: legacy.pin } : {}),
        ...(legacy?.card ? { cardToken: legacy.card } : {}),
      },
      select: { id: true, username: true },
    });
    kullanicilar.push(u.id);
    return u;
  };
  const verilenDegerler: string[] = [];
  const kidler = new Set<string>();

  const rawSet = async (key: string, value: Prisma.InputJsonValue, actor: string): Promise<void> => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value, updatedById: actor }, update: { value, updatedById: actor } });
    invalidateFeatureFlagsCache();
  };

  try {
    const aktor = await yeniKullanici("aktor");
    await rawSet(SETTING_KEYS.AUTH_LOGIN_METHODS, { enabled: ["list", "pin", "card"], primary: "list" }, aktor.id);
    await rawSet(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off", aktor.id);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, true, aktor.id);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, 3, aktor.id);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC, 60, aktor.id);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER, 2, aktor.id);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN, 15, aktor.id);
    await rawSet(SETTING_KEYS.AUTH_SHORT_CREDENTIAL_APPROVED_DEVICE_ONLY, false, aktor.id);
    await rawSet(SETTING_KEYS.DEVICE_PAIRING_REQUIRED, false, aktor.id);

    const halkaA = getShortCredentialKeyRing();
    check("§0 makine A anahtar halkası LICENSE_DIR benzetiminde doğdu", halkaA.ok, halkaA.ok ? halkaA.ring.active.kid : "");
    if (!halkaA.ok) throw new Error("halka yok");
    const kidA = halkaA.ring.active.kid;
    kidler.add(kidA);

    // ═══ §1 YENİ PIN / KART ÖZET OLARAK YAZILIR ═══
    console.log("\n=== §1 yeni PIN/kart özet olarak yazılır ===");
    const u1 = await yeniKullanici("u1");
    const pin1 = (await AuthService.setQuickPin(u1.id, {}, aktor.id)).pin!;
    const kart1 = await AuthService.rotateCardToken(u1.id, aktor.id);
    const sir1 = kart1.cardCode.split(":")[2]!;
    verilenDegerler.push(pin1, sir1);
    const s1 = await prisma.user.findUnique({ where: { id: u1.id } });
    check("⭐ §1a düz PIN kolonu BOŞ, özet '<kid>:<64hex>'", s1?.quickPin === null && /^[0-9a-f]{16}:[0-9a-f]{64}$/.test(s1?.quickPinDigest ?? ""));
    check("⭐ §1b düz kart kolonu BOŞ, özet '<kid>:<64hex>'", s1?.cardToken === null && /^[0-9a-f]{16}:[0-9a-f]{64}$/.test(s1?.cardTokenDigest ?? ""));
    check("§1c özet değeri İÇERMİYOR", !(s1?.quickPinDigest ?? "").includes(pin1) && !(s1?.cardTokenDigest ?? "").includes(sir1));
    check("§1d kart 256 bit (64 hex) ve eski-biçim değil", sir1.length === 64 && s1?.cardTokenLegacy === false);
    check("§1e özet etkin anahtarla (kid A)", digestKid(s1?.quickPinDigest) === kidA);
    const g1 = await attempt(() => AuthService.loginWithQuickPin(pin1));
    check("§1f özetli PIN ile giriş", g1.ok && g1.value.user.userId === u1.id);
    const g1k = await attempt(() => AuthService.loginWithCard(kart1.cardCode));
    check("§1g özetli kartla giriş", g1k.ok && g1k.value.user.userId === u1.id);
    forgetIssuedPin(u1.id);
    const cred1 = await AuthService.getUserCredentials(u1.id);
    check("§1h basım penceresi kapandıktan sonra düz PIN DÖNMEZ (yer tutucu)", cred1.quickPin === "••••••" && cred1.quickPinSet && !cred1.quickPinRevealed);
    // createUser yolu da özet yazar
    const yeni = await PermissionManagementService.createUser(
      { username: `TEST-g21-cu-${stamp}`.slice(0, 50), fullName: "TEST G21 CU", password: "test-parola-1" },
      aktor.id,
    );
    kullanicilar.push(yeni.id);
    const scu = await prisma.user.findUnique({ where: { id: yeni.id } });
    check("§1i createUser (pin+card etkin) → özet var, düz yok", scu?.quickPin === null && scu?.cardToken === null && !!scu?.quickPinDigest && !!scu?.cardTokenDigest);

    // ═══ §2 STATİK: düz kolona null dışında yazım yok ═══
    console.log("\n=== §2 statik: düz kolona yazım ===");
    let toplamNull = 0;
    const ihlaller: string[] = [];
    const dosyalar = [...walkTs(path.join(KOK, "src")), path.join(KOK, "scripts/superadmin-olustur.ts"), path.join(KOK, "scripts/kisa-kimlik.ts")];
    for (const f of dosyalar) {
      const r = duzKolonYazimlari(fs.readFileSync(f, "utf8"), path.relative(KOK, f));
      toplamNull += r.nullYazim;
      ihlaller.push(...r.ihlal);
    }
    check("§2a körlük zemini: ≥ 6 `quickPin/cardToken: null` yazımı bulundu", toplamNull >= 6, `${toplamNull} null yazım · ${dosyalar.length} dosya`);
    check("⭐ §2b src/araçlarda düz kolona null DIŞINDA değer yazan YOK", ihlaller.length === 0, ihlaller.join(" · "));
    const sonda2 = duzKolonYazimlari("prisma.user.update({ where: { id }, data: { quickPin: pin } });", "sonda.ts");
    check("§2c tarayıcı sondası: `data: { quickPin: pin }` yakalanır", sonda2.ihlal.length === 1);

    // ═══ §3 TOPLU DÖNÜŞÜM ═══
    console.log("\n=== §3 toplu dönüşüm ===");
    const lpin = await bosPin(new Set(verilenDegerler));
    const lsir = createHash("md5").update(`g21-${stamp}`).digest("hex"); // 32 hex = eski 128 bit kart
    verilenDegerler.push(lpin, lsir);
    const leg = await yeniKullanici("legacy", { pin: lpin, card: lsir });
    const onizleme = await ShortCredentialAdminService.previewConversion();
    const satir = onizleme.find((r) => r.userId === leg.id);
    check("§3a önizleme etkilenen kullanıcıyı listeler (değer basmaz)", !!satir && satir.pin && satir.card && !JSON.stringify(satir).includes(lpin));
    const d1 = await ShortCredentialAdminService.applyConversion(aktor.id);
    if (SONDA === "duz-kalir") await prisma.user.update({ where: { id: leg.id }, data: { quickPin: lpin } });
    const sl = await prisma.user.findUnique({ where: { id: leg.id } });
    check("⭐ §3b dönüşüm sonrası düz kolonlar BOŞ, özetler dolu", sl?.quickPin === null && sl?.cardToken === null && !!sl?.quickPinDigest && !!sl?.cardTokenDigest, `${d1.pin} PIN · ${d1.card} kart`);
    check("§3c kart eski-biçim işaretli (panel 'yeniden bas' önerir)", sl?.cardTokenLegacy === true);
    const d2 = await ShortCredentialAdminService.applyConversion(aktor.id);
    check("⭐ §3d ikinci koşum 0 değişiklik (idempotent)", d2.pin === 0 && d2.card === 0, JSON.stringify({ pin: d2.pin, card: d2.card }));
    check("§3e kalan düz değer yok", d2.remaining.pin === 0 && d2.remaining.card === 0);
    const g3 = await attempt(() => AuthService.loginWithQuickPin(lpin));
    check("⭐ §3f dönüşen PIN kullanıcıdan yeni PIN istemeden çalışır", g3.ok && g3.value.user.userId === leg.id);
    const g3k = await attempt(() => AuthService.loginWithCard(`TEKSU:${leg.id}:${lsir}`));
    check("⭐ §3g ESKİ 128 bit kart çalışmaya devam eder", g3k.ok && g3k.value.user.userId === leg.id);
    const credL = await AuthService.getUserCredentials(leg.id);
    check("§3h kimlik durumu kartı eski-biçim gösterir", credL.cardLegacy === true && credL.cardSet);

    // ═══ §4 TEMBEL DÖNÜŞÜM + YARIŞ ═══
    console.log("\n=== §4 tembel dönüşüm ===");
    const tpin = await bosPin(new Set(verilenDegerler));
    verilenDegerler.push(tpin);
    const tem = await yeniKullanici("tembel", { pin: tpin });
    const yanlis = await bosPin(new Set([...verilenDegerler, tpin]));
    const gy = await attempt(() => AuthService.loginWithQuickPin(yanlis));
    const st0 = await prisma.user.findUnique({ where: { id: tem.id } });
    check("⭐ §4a başarısız girişte dönüşüm YOK", !gy.ok && st0?.quickPin === tpin && st0?.quickPinDigest === null);
    const gt = await attempt(() => AuthService.loginWithQuickPin(tpin));
    const st1 = await prisma.user.findUnique({ where: { id: tem.id } });
    check("⭐ §4b başarılı girişte düz → özet (kullanıcı eylemi yok)", gt.ok && st1?.quickPin === null && !!st1?.quickPinDigest);
    const izSay = async (uid: string): Promise<number> =>
      prisma.systemLog.count({ where: { recordId: uid, tableName: "USER_QUICK_PIN", createdAt: { gte: t0 }, newData: { path: ["converted"], equals: "LAZY_LOGIN" } } });
    check("§4c tembel dönüşümün ayak izi var", (await izSay(tem.id)) === 1);
    const ypin = await bosPin(new Set(verilenDegerler));
    verilenDegerler.push(ypin);
    const yar = await yeniKullanici("yaris", { pin: ypin });
    const [r1, r2] = await Promise.all([
      attempt(() => AuthService.loginWithQuickPin(ypin)),
      attempt(() => AuthService.loginWithQuickPin(ypin)),
    ]);
    if (SONDA === "cift-donusum") {
      await prisma.user.update({ where: { id: yar.id }, data: { quickPin: ypin, quickPinDigest: null } });
      await ShortCredentialService.convertOnLogin(yar.id, "pin", ypin);
    }
    const sy = await prisma.user.findUnique({ where: { id: yar.id } });
    check("§4d eşzamanlı iki giriş de başarılı", r1.ok && r2.ok);
    check("⭐ §4e yarışta TEK dönüşüm (atomik claim) ve tek ayak izi", sy?.quickPin === null && !!sy?.quickPinDigest && (await izSay(yar.id)) === 1, `iz=${await izSay(yar.id)}`);

    // ═══ §5 DENEME KİLİDİ KALICI ═══
    console.log("\n=== §5 kalıcı kilit ===");
    const kilitAnahtari = `TEST-g21-kilit-${stamp}`;
    for (let i = 0; i < 3; i++) await reserveLoginAttempt(kilitAnahtari);
    const kilitli = await reserveLoginAttempt(kilitAnahtari);
    check("§5a eşikte kilit kuruldu", kilitli.blocked);
    await flushLoginLockoutPersistence();
    const hash = createHash("sha256").update(kilitAnahtari, "utf8").digest("hex");
    if (SONDA === "kilit-bellekte") await prisma.loginLockoutBucket.deleteMany({ where: { keyHash: hash } });
    await simulateLockoutRestartForTests();
    const sonra = await reserveLoginAttempt(kilitAnahtari);
    check("⭐ §5b yeniden başlatma kilidi SIFIRLAMADI", sonra.blocked, JSON.stringify(sonra));
    const duzSatir = await prisma.loginLockoutBucket.count({ where: { keyHash: kilitAnahtari } });
    check("§5c DB'de anahtar SHA-256 (düz anahtar yok)", duzSatir === 0 && (SONDA === "kilit-bellekte" || (await prisma.loginLockoutBucket.count({ where: { keyHash: hash } })) === 1));
    // Kart kullanıcı kovası: aynı kişinin kartına FARKLI IP'lerden dağıtılmış deneme.
    const hedef = await yeniKullanici("kartkova");
    await AuthService.rotateCardToken(hedef.id, aktor.id);
    const yanlisKart = `TEKSU:${hedef.id}:${"ab".repeat(32)}`;
    for (let i = 0; i < 3; i++) await invoke(AuthController.loginCard, { body: { cardCode: yanlisKart }, ip: `198.18.${stamp % 200}.${i + 1}` });
    const dagitik = await invoke(AuthController.loginCard, { body: { cardCode: yanlisKart }, ip: `198.18.${stamp % 200}.99` });
    check("⭐ §5d kart kullanıcı kovası farklı IP'lerden denemeyi kilitler", errCode(dagitik.nextError).code === "LOGIN_LOCKED", JSON.stringify(errCode(dagitik.nextError)));
    const kilitIzi = await prisma.systemLog.count({ where: { action: "LOGIN_LOCKED", recordId: "card", createdAt: { gte: t0 } } });
    check("§5e kart kilidi kurulduğu AN denetime yazıldı", kilitIzi >= 1);

    // ═══ §6 YALNIZ ONAYLI CİHAZ ═══
    console.log("\n=== §6 yalnız onaylı cihaz ===");
    const cpin = await bosPin(new Set(verilenDegerler));
    verilenDegerler.push(cpin);
    const cu = await yeniKullanici("cihaz");
    await AuthService.setQuickPin(cu.id, { pin: cpin }, aktor.id);
    await systemSettingService.setFeatureFlags({ shortCredentialApprovedDeviceOnly: true }, aktor.id);
    check("§6a kural açıkken eşleştirme ETKİN zorunlu", (await readDevicePairingRequired()) === true);
    const ipC = `198.19.${stamp % 200}.7`;
    const sahte = { id: "00000000-0000-0000-0000-000000000000", deviceId: "SONDA", name: "SONDA", machineId: null, kind: "TABLET" } as unknown as Request["device"];
    let hepsi403 = true;
    for (let i = 0; i < 5; i++) {
      const r = await invoke(AuthController.loginQuickPin, { body: { pin: cpin }, ip: ipC, device: SONDA === "cihaz-var" ? sahte : undefined });
      const c = errCode(r.nextError);
      if (!(c.status === 403 && c.code === "DEVICE_NOT_APPROVED")) hepsi403 = false;
    }
    check("⭐ §6b cihazsız hızlı PIN → 403 DEVICE_NOT_APPROVED", hepsi403);
    const rk = await invoke(AuthController.loginCard, { body: { cardCode: kart1.cardCode }, ip: ipC });
    check("§6c cihazsız kart → 403 DEVICE_NOT_APPROVED", errCode(rk.nextError).code === "DEVICE_NOT_APPROVED");
    const cihaz = { id: "00000000-0000-0000-0000-0000000000aa", deviceId: `TEST-g21-${stamp}`, name: "TEST", machineId: null, kind: "TABLET" } as unknown as Request["device"];
    const ok6 = await invoke(AuthController.loginQuickPin, { body: { pin: cpin }, ip: ipC, device: cihaz });
    check("§6d onaylı cihazdan giriş — reddedilen denemeler kilide SAYILMADI", ok6.statusCode === 200, JSON.stringify(errCode(ok6.nextError)));
    const liste = await invoke(AuthController.mobileUsers, { ip: ipC });
    check("§6e personel listesi kimliksiz cihaza KAPALI", liste.statusCode === 401);
    const kapat = await attempt(() => systemSettingService.setFeatureFlags({ devicePairingRequired: false }, aktor.id));
    check("§6f kural açıkken eşleştirmeyi kapatmak 409 PAIRING_FORCED", !kapat.ok && errCode(kapat.err).code === "PAIRING_FORCED");
    await systemSettingService.setFeatureFlags({ shortCredentialApprovedDeviceOnly: false }, aktor.id);
    check("§6g kural kapalı + eşleştirme kapalı → bugünkü davranış (cihazsız PIN)", (await invoke(AuthController.loginQuickPin, { body: { pin: cpin }, ip: `198.19.${stamp % 200}.8` })).statusCode === 200);
    process.env.TEKSERP_KURULUM_SINIFI = "BARINDIRILAN";
    check("§6h barındırılan sınıfta kural ZORUNLU (kayıt kapalıyken bile)", (await readShortCredentialApprovedDeviceOnly()) && (await readDevicePairingRequired()));
    const hk = await attempt(() => systemSettingService.setFeatureFlags({ shortCredentialApprovedDeviceOnly: false }, aktor.id));
    check("⭐ §6i barındırılan sınıfta kapatma 409 HOSTED_CLASS_FORCED", !hk.ok && errCode(hk.err).code === "HOSTED_CLASS_FORCED");
    delete process.env.TEKSERP_KURULUM_SINIFI;

    // ═══ §7 YEDEK → YENİ MAKİNE ═══
    console.log("\n=== §7 yedek → yeni makine benzetimi ===");
    const anahtarDizini = path.join(tmp, "yedek-anahtar");
    fs.mkdirSync(anahtarDizini, { recursive: true });
    const PAROLA = `g21-yedek-parolasi-${stamp}`;
    const yerel = generateRawKeyPair();
    const musteri = generateRawKeyPair();
    fs.writeFileSync(path.join(anahtarDizini, "yerel.tkkey"), `${JSON.stringify(await wrapSecretKey("yerel", yerel.privateRaw, PAROLA), null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(anahtarDizini, "yerel.tkpub"), `${encodePublicKey(yerel.publicRaw)}\n`);
    fs.writeFileSync(path.join(anahtarDizini, "musteri.tkpub"), `${encodePublicKey(musteri.publicRaw)}\n`);
    const musteriKagit = encodeSecretKey(musteri.privateRaw);
    process.env.BACKUP_KEY_DIR = anahtarDizini;
    const dr = await yeniKullanici("dr");
    const pinD = (await AuthService.setQuickPin(dr.id, {}, aktor.id)).pin!;
    const kartD = await AuthService.rotateCardToken(dr.id, aktor.id);
    verilenDegerler.push(pinD, kartD.cardCode.split(":")[2]!);
    if (SONDA !== "emanetsiz") {
      const es = await ShortCredentialAdminService.syncEscrow();
      check("§7a anahtar yedek alıcılarına mühürlendi (emanet DB'de, düz anahtar değil)", es.state === "acik" && [...es.sealed, ...es.current].includes(kidA));
      const satirE = await prisma.shortCredentialKeyEscrow.findUnique({ where: { kid: kidA } });
      const anahtarB64 = halkaA.ring.active.key.toString("base64url");
      check("§7b emanet satırı anahtarı DÜZ taşımıyor", !!satirE && !satirE.sealed.includes(anahtarB64));
    }
    // "Yeni makine": boş LICENSE_DIR — yedekten dönen DB aynı.
    setShortCredentialKeyDirForTests(makine("B"));
    const halkaB = getShortCredentialKeyRing();
    if (halkaB.ok) kidler.add(halkaB.ring.active.kid);
    check("§7c yeni makinede FARKLI anahtar doğdu", halkaB.ok && halkaB.ring.active.kid !== kidA);
    const gB = await attempt(() => AuthService.loginWithQuickPin(pinD));
    check("⭐ §7d yeni makinede PIN 401 SHORT_CREDENTIAL_KEY_MISMATCH (açık TR mesaj)", !gB.ok && errCode(gB.err).status === 401 && errCode(gB.err).code === "SHORT_CREDENTIAL_KEY_MISMATCH" && String((gB.err as Error).message).includes("yedek parolasıyla"));
    const gBk = await attempt(() => AuthService.loginWithCard(kartD.cardCode));
    check("§7e yeni makinede kart 401 SHORT_CREDENTIAL_KEY_MISMATCH", !gBk.ok && errCode(gBk.err).code === "SHORT_CREDENTIAL_KEY_MISMATCH");
    const durumB = await ShortCredentialService.status();
    check("§7f durum yabancı anahtarı ve emaneti bildirir", durumB.foreignKids.some((f) => f.kid === kidA && (SONDA === "emanetsiz" || f.escrow)));
    const yanlisAnahtar = privateKeyFromRaw(generateRawKeyPair().privateRaw);
    const rw = await ShortCredentialAdminService.restoreKeysFromEscrow([yanlisAnahtar], aktor.id);
    check("§7g yanlış anahtar emaneti AÇAMAZ", !rw.restored.includes(kidA));
    const cfg = await readBackupCryptoConfig();
    const yerelKimlik = await unlockLocalKey(cfg, PAROLA);
    const rr = await ShortCredentialAdminService.restoreKeysFromEscrow([yerelKimlik], aktor.id);
    check("⭐ §7h yerel anahtar (yedek parolası) emanetten geri koydu", rr.restored.includes(kidA), JSON.stringify(rr));
    const gB2 = await attempt(() => AuthService.loginWithQuickPin(pinD));
    check("⭐ §7i geri konan anahtarla PIN ÇALIŞIYOR", gB2.ok && gB2.value.user.userId === dr.id);
    const gB2k = await attempt(() => AuthService.loginWithCard(kartD.cardCode));
    check("§7j geri konan anahtarla kart ÇALIŞIYOR", gB2k.ok && gB2k.value.user.userId === dr.id);
    const halkaB2 = getShortCredentialKeyRing();
    check("§7k halka büyüdü, etkin anahtar DEĞİŞMEDİ (üstüne yazılmadı)", halkaB2.ok && halkaB.ok && halkaB2.ring.active.kid === halkaB.ring.active.kid && halkaB2.ring.keys.some((k) => k.kid === kidA));
    const dr2 = await yeniKullanici("dr2");
    const pinD2 = (await AuthService.setQuickPin(dr2.id, {}, aktor.id)).pin!;
    verilenDegerler.push(pinD2);
    const sd2 = await prisma.user.findUnique({ where: { id: dr2.id } });
    check("§7l yeni makinede verilen PIN yeni makinenin anahtarıyla", halkaB.ok && digestKid(sd2?.quickPinDigest) === halkaB.ring.active.kid);
    // Üçüncü makine: kâğıt MÜŞTERİ anahtarıyla (yerel anahtar dosyası kayıp).
    setShortCredentialKeyDirForTests(makine("C"));
    const halkaC = getShortCredentialKeyRing();
    if (halkaC.ok) kidler.add(halkaC.ring.active.kid);
    const rc = await ShortCredentialAdminService.restoreKeysFromEscrow([privateKeyFromRaw(decodeSecretKey(musteriKagit))], aktor.id);
    check("⭐ §7m kâğıt müşteri anahtarı da geri koyar (A + B)", rc.restored.includes(kidA) && halkaB.ok && rc.restored.includes(halkaB.ring.active.kid), JSON.stringify(rc));
    const gC = await attempt(() => AuthService.loginWithQuickPin(pinD2));
    check("§7n üçüncü makinede B döneminin PIN'i de çalışır", gC.ok && gC.value.user.userId === dr2.id);
    // Emaneti hiç geri konmayan makine: toplu sıfırlama.
    setShortCredentialKeyDirForTests(makine("E"));
    const halkaE = getShortCredentialKeyRing();
    if (halkaE.ok) kidler.add(halkaE.ring.active.kid);
    const on = await ShortCredentialAdminService.bulkResetPreview("uyusmayan");
    check("§7o toplu sıfırlama önizlemesi uyuşmayan PIN'i ve basılacak kartı listeler", on.pins.some((p) => p.userId === dr.id && p.reason === "ANAHTAR_UYUSMUYOR") && on.cardsToReprint.some((c) => c.userId === dr.id));
    const ap = await ShortCredentialAdminService.bulkResetApply([dr.id], aktor.id);
    const yeniPin = ap.results.find((r) => r.userId === dr.id)?.pin ?? "";
    verilenDegerler.push(yeniPin);
    const gE = await attempt(() => AuthService.loginWithQuickPin(yeniPin));
    check("⭐ §7p toplu sıfırlanan PIN ÇALIŞIYOR", gE.ok && gE.value.user.userId === dr.id);
    delete process.env.BACKUP_KEY_DIR;
    const kapali = await ShortCredentialAdminService.syncEscrow();
    check("§7r yedek şifrelemesi kapalıyken emanet DOĞMAZ (durum bildirilir)", kapali.state === "kapali" && kapali.sealed.length === 0);
    const bsrc = fs.readFileSync(path.join(KOK, "src/services/backup.service.ts"), "utf8");
    check("§7s gece yedeği emaneti tazeliyor ve tabloyu dökümden DIŞLAMIYOR", bsrc.includes("ShortCredentialAdminService.syncEscrow()") && !/exclude-table|--exclude-table-data|short_credential_key_escrows/.test(bsrc));

    // ═══ §8 SIZINTI ═══
    console.log("\n=== §8 sızıntı ===");
    const loglar = await prisma.$queryRaw<Array<{ t: string }>>`
      SELECT coalesce("newData"::text, '') || ' ' || coalesce("oldData"::text, '') AS t FROM system_logs WHERE "createdAt" >= ${t0}`;
    const sizan = verilenDegerler.filter((v) => v && loglar.some((l) => l.t.includes(`"${v}"`) || (v.length > 6 && l.t.includes(v))));
    check("§8a körlük zemini: denetim satırı okundu", loglar.length >= 10, `${loglar.length} satır`);
    check("⭐ §8b audit yüklerinde verilen PIN/kart sırrı YOK", sizan.length === 0, sizan.length ? `${sizan.length} değer sızdı` : "");
  } finally {
    await temizle(kullanicilar, [...kidler], orijinal);
    setShortCredentialKeyDirForTests(null);
    if (eskiYedekAnahtarDizini === undefined) delete process.env.BACKUP_KEY_DIR;
    else process.env.BACKUP_KEY_DIR = eskiYedekAnahtarDizini;
    if (eskiSinif === undefined) delete process.env.TEKSERP_KURULUM_SINIFI;
    else process.env.TEKSERP_KURULUM_SINIFI = eskiSinif;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function temizle(
  kullanicilar: string[],
  kidler: string[],
  orijinal: Map<string, { value: Prisma.JsonValue; updatedById: string | null } | null>,
): Promise<void> {
  for (const [key, row] of orijinal) {
    if (row) {
      await prisma.systemSetting.update({ where: { key }, data: { value: row.value as Prisma.InputJsonValue, updatedById: row.updatedById } }).catch(() => { fail++; });
    } else {
      await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => { fail++; });
    }
  }
  invalidateFeatureFlagsCache();
  await prisma.session.deleteMany({ where: { userId: { in: kullanicilar } } }).catch(() => undefined);
  // Kullanıcı sert silinmez (audit FK) — pasif + kimlikler boş.
  await prisma.user.updateMany({
    where: { id: { in: kullanicilar } },
    data: { isActive: false, quickPin: null, cardToken: null, quickPinDigest: null, cardTokenDigest: null },
  }).catch(() => undefined);
  await prisma.shortCredentialKeyEscrow.deleteMany({ where: { kid: { in: kidler } } }).catch(() => undefined);
  await flushLoginLockoutPersistence().catch(() => undefined);
}

main()
  .catch((e) => {
    fail++;
    console.error("Beklenmeyen hata:", e);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
