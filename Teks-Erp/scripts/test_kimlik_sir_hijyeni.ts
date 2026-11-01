// =============================================================================
// BEKÇİ — KİMLİK SIR HİJYENİ: bcrypt turu · silinen kullanıcının sırları · audit derin maske
// Çalıştır: npx tsx scripts/test_kimlik_sir_hijyeni.ts [--sonda=bcrypt|--sonda=b5|--sonda=b2]
// =============================================================================
// NEDEN (güvenlik denetimi B4, B5, B2 — 2026-10-13): döküm sızarsa
//   • parola özetleri bcrypt 10 ile çevrimdışı ucuz kırılıyordu → tek kaynak PASSWORD_BCRYPT_COST=12,
//     eski özet başarılı girişte yükseltilir;
//   • silinen kullanıcının parola özeti/TOTP sırrı/kurtarma kodları satırda kalıyordu;
//   • audit `oldData`/`newData`/`payload` HAM yazılıyordu (maske yalnız `changes`te).
//
// §1 bcrypt AST: src/prisma/scripts (test dışı) `bcrypt.hash(x, n)`in turu PASSWORD_BCRYPT_COST;
//    beyanlı muaflar: kurtarma kodu RECOVERY_CODE_BCRYPT_COST (10), varsayılan süperadmin üreticisi (13)
// §2 yeni özet tur 12 · tur-10 kullanıcı girişte 12'ye yükselir · mühürlü sistem hesabında mühür geçerli kalır
// §3 deleteUser: satır DURUR, sır kolonları boş, parola özeti hiçbir parolayla eşleşmez, kurtarma kodu yok
// §4 audit: iç içe sır maskeli (birim + gerçek system_logs satırı) · system_logs/arşiv genel taraması
//    (bcrypt özeti `$2x$NN$`, sarılı TOTP `enc1:`) = 0
// SONDA (kalıcı): --sonda=bcrypt → §1 bellek içi kaynağa `bcrypt.hash(p, 10)` eklenir (KIRMIZI olmalı)
//                 --sonda=b5     → §3 eski silme yükü (yalnız PIN/kart temizler) (KIRMIZI olmalı)
//                 --sonda=b2     → §4 ham `systemLog.create` ile özet yazılır (KIRMIZI olmalı)
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import bcrypt from "bcryptjs";
import prisma from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { AuditService } from "../src/services/audit.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { totpCodeForStep, totpStep } from "../src/services/totp.service";
import { PASSWORD_BCRYPT_COST } from "../src/constants/password-policy";
import { maskAuditPayload } from "../src/services/helpers/audit-diff.helper";
import { setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { loadLicenseStoreSync } from "../src/lib/license/store";
import {
  SEAL_ROW_SELECT,
  isSystemAccountAuthorized,
  resetSystemAccountSealCacheForTest,
  sealStatus,
  writeSeal,
} from "../src/services/helpers/system-account-seal.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const SONDA = process.argv.find((a) => a.startsWith("--sonda="))?.slice("--sonda=".length) ?? null;
const KOK = path.resolve(__dirname, "..");

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// ── §1 ────────────────────────────────────────────────────────────────────────
/** Beyanlı muaflar: dosya → izinli tur ifadesi (gerekçe sabitin yorumunda). */
const BCRYPT_MUAF: Record<string, string> = {
  "src/services/totp-account.service.ts": "RECOVERY_CODE_BCRYPT_COST",
  "scripts/varsayilan-superadmin-ozet.ts": "maliyet",
  // Tek boğaz (K1): tur çağırandan gelir; çağıranların `hashPassword(x, tur)`u aşağıda ayrıca taranır.
  "src/services/helpers/password-hasher.helper.ts": "job.cost",
};
function tsDosyalari(dizin: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dizin, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dizin, e.name);
    if (e.isDirectory()) tsDosyalari(p, out);
    else if (/\.ts$/.test(e.name) && !/^test[_-]/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
/** `bcrypt.hash(…)`/`hashSync(…)` ve tek boğaz `hashPassword(x, tur)` çağrılarının ikinci argüman metni. */
export function bcryptTurlari(kaynak: string, ad = "x.ts"): string[] {
  const sf = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const gez = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        /^bcrypt/i.test(n.expression.expression.getText(sf)) && /^hash(Sync)?$/.test(n.expression.name.text)) {
      out.push(n.arguments[1]?.getText(sf) ?? "<yok>");
    }
    // Tek argümanlı `hashPassword(x)` helper varsayılanı PASSWORD_BCRYPT_COST'tur (ya da yerel sarmalayıcı, iç çağrısı taranır).
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "hashPassword" && n.arguments.length >= 2) {
      out.push(n.arguments[1]!.getText(sf));
    }
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return out;
}
function bcryptAst() {
  console.log("\n=== §1 bcrypt turu tek kaynaktan ===");
  const dosyalar = ["src", "prisma", "scripts"].flatMap((d) => tsDosyalari(path.join(KOK, d)));
  const ihlal: string[] = [];
  let toplam = 0;
  for (const f of dosyalar) {
    const rel = path.relative(KOK, f).split(path.sep).join("/");
    let metin = fs.readFileSync(f, "utf8");
    if (SONDA === "bcrypt" && rel === "src/services/auth.service.ts") metin += "\nconst sonda = () => bcrypt.hash(p, 10);\n";
    for (const tur of bcryptTurlari(metin, rel)) {
      toplam++;
      if (tur !== "PASSWORD_BCRYPT_COST" && tur !== BCRYPT_MUAF[rel]) ihlal.push(`${rel}: ${tur}`);
    }
  }
  check("§1a ⭐ her bcrypt.hash turu PASSWORD_BCRYPT_COST (ya da beyanlı muaf)", ihlal.length === 0 && toplam >= 8,
    ihlal.length ? ihlal.join(" · ") : `${toplam} çağrı`);
  check("§1b PASSWORD_BCRYPT_COST = 12", PASSWORD_BCRYPT_COST === 12);
  const totp = fs.readFileSync(path.join(KOK, "src/services/totp.service.ts"), "utf8");
  check("§1c kurtarma kodu turu beyanlı (RECOVERY_CODE_BCRYPT_COST = 10)", /export const RECOVERY_CODE_BCRYPT_COST = 10;/.test(totp));
  check("§1s sentetik: literal tur yakalanır, sabit geçer",
    JSON.stringify(bcryptTurlari("bcrypt.hash(a, 10); bcrypt.hashSync(b, PASSWORD_BCRYPT_COST); hashPassword(c, 9)")) === JSON.stringify(["10", "PASSWORD_BCRYPT_COST", "9"]));
}

// ── fikstür ──────────────────────────────────────────────────────────────────
const ids: string[] = [];
const dizinler: string[] = [];
let aktorId = "";
async function kullanici(ek: string, passwordHash: string, isSystemAccount = false) {
  const u = await prisma.user.create({
    data: { username: `TEST-sirhij-${ek}-${Date.now()}`, passwordHash, fullName: `TEST sır hijyeni ${ek}`, isSystemAccount },
    select: { id: true, username: true },
  });
  ids.push(u.id);
  return u;
}

// ── §2 ────────────────────────────────────────────────────────────────────────
async function yukseltme() {
  console.log("\n=== §2 parola özeti turu ve girişte yükseltme ===");
  const PAROLA = "Deneme-sirhij-12345";
  check("§2a yeni özet tur 12 (hashPassword)", bcrypt.getRounds(await AuthService.hashPassword(PAROLA)) === 12);
  const eski = await kullanici("tur10", await bcrypt.hash(PAROLA, 10));
  await AuthService.login(eski.username, PAROLA, { clientType: "mobile" });
  const r1 = await prisma.user.findUniqueOrThrow({ where: { id: eski.id }, select: { passwordHash: true } });
  check("§2b ⭐ tur-10 kullanıcı başarılı girişte tur 12'ye yükseldi", bcrypt.getRounds(r1.passwordHash) === 12);
  check("§2c yükseltilen özet aynı parolayı doğrular", await bcrypt.compare(PAROLA, r1.passwordHash));
  const yanlis = await AuthService.login(eski.username, "yanlis-parola-xx", { clientType: "mobile" }).then(() => "200", () => "red");
  check("§2d yanlış parola hâlâ reddedilir", yanlis === "red");

  // Mühürlü sistem hesabı: yükseltme mührü aynı yazımda yenilemeli (G1 parola özetini kapsar).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bekci-sirhij-lisans-"));
  dizinler.push(dir);
  const eskiDir = process.env.LICENSE_DIR;
  loadLicenseStoreSync({ dir });
  process.env.LICENSE_DIR = dir;
  resetSystemAccountSealCacheForTest();
  try {
    const sa = await kullanici("sa", await bcrypt.hash(PAROLA, 10), true);
    const yaz = await writeSeal(prisma, sa.id);
    await AuthService.login(sa.username, PAROLA, { clientType: "electron" });
    resetSystemAccountSealCacheForTest();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: sa.id }, select: { ...SEAL_ROW_SELECT, passwordHash: true } });
    check("§2e ⭐ mühürlü sistem hesabı: özet 12'ye yükseldi VE mühür GECERLI kaldı",
      yaz.durum === "MUHURLENDI" && bcrypt.getRounds(row.passwordHash) === 12 && sealStatus(row) === "GECERLI" && isSystemAccountAuthorized(row),
      `${yaz.durum} tur=${bcrypt.getRounds(row.passwordHash)} mühür=${sealStatus(row)}`);
  } finally {
    if (eskiDir === undefined) delete process.env.LICENSE_DIR; else process.env.LICENSE_DIR = eskiDir;
    loadLicenseStoreSync();
    resetSystemAccountSealCacheForTest();
  }
}

// ── §3 ────────────────────────────────────────────────────────────────────────
async function silinenKullanici() {
  console.log("\n=== §3 silinen kullanıcı sır taşımaz (B5) ===");
  const PAROLA = "Deneme-sirhij-silme1";
  const u = await kullanici("silinen", await AuthService.hashPassword(PAROLA));
  await AuthService.setQuickPin(u.id, {}, aktorId);
  await AuthService.rotateCardToken(u.id, aktorId);
  const w = await TotpAccountService.openWindow({ userId: u.id, openedById: aktorId });
  await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
  const acik = await TotpAccountService.openWindow({ userId: u.id, openedById: aktorId }).catch(() => null);
  const once = await prisma.userRecoveryCode.count({ where: { userId: u.id, usedAt: null } });

  if (SONDA === "b5") {
    // Eski silme yükü: yalnız PIN/kart temizlenir, parola özeti ve TOTP satırda kalır.
    await prisma.user.update({
      where: { id: u.id },
      data: { isActive: false, deletedAt: new Date(), username: `del_${u.username}`, quickPin: null, cardToken: null, quickPinDigest: null, cardTokenDigest: null },
    });
  } else {
    await PermissionManagementService.deleteUser(u.id, aktorId);
  }
  const r = await prisma.user.findUnique({
    where: { id: u.id },
    select: { deletedAt: true, passwordHash: true, totpSecret: true, totpEnabledAt: true, totpLastStep: true,
      quickPin: true, quickPinDigest: true, cardToken: true, cardTokenDigest: true },
  });
  check("§3a satır DURUR, deletedAt damgalı (hard delete yok)", r !== null && r.deletedAt !== null);
  check("§3b ⭐ TOTP sırrı/açılışı/adımı boş", r !== null && r.totpSecret === null && r.totpEnabledAt === null && r.totpLastStep === null,
    `secret=${r?.totpSecret ? "DOLU" : "null"}`);
  check("§3c PIN/kart özetleri boş", r !== null && !r.quickPin && !r.quickPinDigest && !r.cardToken && !r.cardTokenDigest);
  check("§3d ⭐ parola özeti bcrypt değil ve hiçbir parolayla eşleşmez",
    r !== null && !/^\$2[aby]\$/.test(r.passwordHash) && !(await bcrypt.compare(PAROLA, r.passwordHash)), r?.passwordHash.slice(0, 4));
  const sonra = await prisma.userRecoveryCode.count({ where: { userId: u.id, usedAt: null } });
  check("§3e kullanılmamış kurtarma kodu kalmadı", once > 0 && sonra === 0, `önce=${once} sonra=${sonra}`);
  if (acik) {
    const p = await prisma.totpEnrollment.findFirst({ where: { userId: u.id, consumedAt: null }, select: { expiresAt: true } });
    check("§3f açık 2FA kurulum penceresi kapatıldı", !p || p.expiresAt.getTime() <= Date.now());
  }
}

// ── §4 ────────────────────────────────────────────────────────────────────────
const OZET = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
async function auditMaske(kayitId: string) {
  console.log("\n=== §4 audit yükü derin maskeli (B2) ===");
  const m = maskAuditPayload({ a: { passwordHash: OZET, liste: [{ totpSecret: "enc1:k:x" }] }, mustChangePassword: true, ad: "x" });
  check("§4a birim: iç içe nesne/dizideki sır maskeli, boolean ve düz alan dokunulmaz",
    m.a.passwordHash !== OZET && m.a.liste[0].totpSecret !== "enc1:k:x" && m.mustChangePassword === true && m.ad === "x", JSON.stringify(m));
  const yuk = { ad: "x" };
  check("§4b birim: sırsız yük aynı referans (bayt-eşit)", maskAuditPayload(yuk) === yuk);

  await AuditService.log({ userId: aktorId, action: "UPDATE", tableName: "users", recordId: kayitId,
    oldData: { nested: { passwordHash: OZET } }, newData: { cardTokenDigest: "abc", list: [{ settingsPassword: "Gizli-123456" }] } });
  await AuditService.logEvent({ category: "SYSTEM", userId: aktorId, action: "TOTP_SECRET_WRAPPED", tableName: "AUTH", recordId: kayitId,
    payload: { deep: { recoveryCodeHash: OZET } } });
  if (SONDA === "b2") {
    await prisma.systemLog.create({ data: { userId: aktorId, action: "TEST_SONDA", tableName: "users", recordId: kayitId, newData: { passwordHash: OZET } } });
  }
  const satirlar = await prisma.systemLog.findMany({ where: { recordId: kayitId }, select: { oldData: true, newData: true, changes: true } });
  const metin = JSON.stringify(satirlar);
  check("§4c ⭐ gerçek system_logs satırları özet/sır değeri taşımaz",
    satirlar.length >= 2 && !metin.includes(OZET) && !metin.includes("Gizli-123456") && !metin.includes('"abc"'), `${satirlar.length} satır`);

  const desen = String.raw`\$2[aby]\$[0-9]{2}\$`;
  const tara = async (tablo: "system_logs" | "system_log_archives") => {
    const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM ${tablo}
        WHERE concat("oldData"::text, "newData"::text, changes::text) ~ $1
           OR concat("oldData"::text, "newData"::text, changes::text) LIKE '%enc1:%'`, desen);
    return Number(r[0]?.n ?? 0);
  };
  const n1 = await tara("system_logs");
  const n2 = await tara("system_log_archives");
  check("§4d ⭐ system_logs genel tarama: bcrypt özeti / sarılı TOTP = 0", n1 === 0, `${n1}`);
  check("§4e system_log_archives genel tarama = 0", n2 === 0, `${n2}`);
}

async function main() {
  const engel = hedefDbEngeli();
  if (engel) { check("§0 hedef DB yazılabilir", false, engel); process.exit(1); }
  bcryptAst();
  const halka = fs.mkdtempSync(path.join(os.tmpdir(), "bekci-sirhij-halka-"));
  dizinler.push(halka);
  setShortCredentialKeyDirForTests(halka);
  aktorId = (await kullanici("aktor", "x")).id;
  const kayitId = `TEST-sirhij-${Date.now()}`;
  try {
    await yukseltme();
    await silinenKullanici();
    await auditMaske(kayitId);
  } finally {
    await prisma.systemLog.deleteMany({ where: { OR: [{ recordId: kayitId }, { userId: { in: ids } }, { recordId: { in: ids } }] } }).catch(() => undefined);
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { isSystemAccount: false, systemAccountSeal: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch((e) => check("fikstür temizliği", false, String(e)));
    setShortCredentialKeyDirForTests(null);
    for (const d of dizinler) fs.rmSync(d, { recursive: true, force: true });
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
