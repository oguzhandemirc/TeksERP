// =============================================================================
// Bekçi: TOTP sırrı DB'de SARILI (denetim B1c) — 2026-10-12
// Çalıştır: npx tsx scripts/test_kimlik_totp_sifreleme.ts [--sonda=duz-yaz]
// =============================================================================
// İddia: düz .dump açık TOTP sırrı taşımaz. Kurulum penceresi ve kullanıcı sırrı DB'ye yalnız
// `enc1:` sarmalıyla iner (anahtar LICENSE_DIR halkasından); okuma yolları açık değerle çalışır;
// G1 mühür özeti saklama biçiminden BAĞIMSIZDIR (açık sırdan doğar); açılış işi düz sırları bir kez
// sarar ve ikinci koşumda dokunmaz; sır açılamıyorsa 2FA sessizce KAPANMAZ (503).
// Negatif sonda `--sonda=duz-yaz`: yazıcı düz yazar → §1/§3 kırmızı (ölçüm saklanan değere kör değil).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import bcrypt from "bcryptjs";
import prisma, { pool } from "../src/lib/prisma";
import { generateTotpSecret, totpCodeForStep, totpStep } from "../src/services/totp.service";
import { TotpAccountService } from "../src/services/totp-account.service";
import { openStoredTotpSecret, setTotpSecretSealerForTest, storeTotpSecret } from "../src/services/helpers/totp-state.helper";
import { credentialDigest, SEAL_ROW_SELECT } from "../src/services/helpers/system-account-seal.helper";
import { wrapPlainTotpSecrets } from "../src/jobs/totp-secret.job";
import { getShortCredentialKeyRing, setShortCredentialKeyDirForTests } from "../src/lib/short-credential/keyring";
import { TOTP_SECRET_ENC_PREFIX } from "../src/lib/short-credential/totp-crypto";

const SONDA = (process.argv.find((a) => a.startsWith("--sonda=")) ?? "").slice("--sonda=".length);
const KOK = path.join(__dirname, "..");
const TAG = `bekci.totp-sifre.${process.pid}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const sealed = (v: string | null | undefined): boolean => typeof v === "string" && v.startsWith(TOTP_SECRET_ENC_PREFIX);

async function kullanici(ad: string): Promise<{ id: string; username: string }> {
  return prisma.user.create({
    data: { username: `${TAG}.${ad}`, passwordHash: await bcrypt.hash("Bekci-123456", 10), fullName: `Bekçi ${ad}` },
    select: { id: true, username: true },
  });
}

// ── §5 statik ───────────────────────────────────────────────────────────────
function statik(): void {
  console.log("\n=== §5) Statik: sır DB'ye yalnız `storeTotpSecret` ile iner, ham değer doğrulamaya girmez ===");
  const yol = "src/services/totp-account.service.ts";
  const metin = fs.readFileSync(path.join(KOK, yol), "utf8");
  const olc = (m: string): string[] => {
    const ih: string[] = [];
    for (const c of m.matchAll(/totpEnrollment\.create\(\s*\{[\s\S]*?\}\s*\)/g)) {
      if (!/secret:\s*storeTotpSecret\(/.test(c[0])) ih.push("create: secret sarmalsız");
    }
    if (/verifyTotp\(\s*row\.secret\b/.test(m)) ih.push("verifyTotp(row.secret) — saklanan değerle doğrulama");
    if (/secretBase32:\s*row\.secret\b/.test(m)) ih.push("otpauth saklanan değerle");
    if (/secret:\s*user\.totpSecret\b/.test(m)) ih.push("kanıt eşleşmesi saklanan değer üzerinden");
    return ih;
  };
  const ih = olc(metin);
  check("§5 pencere create yalnız `storeTotpSecret` ile ve okuma yolları saklanan değeri ham kullanmıyor", ih.length === 0, ih.join("; "));
  const sondaMetin = metin.replace(/secret:\s*storeTotpSecret\(secret\)/, "secret") + "\nconst x = verifyTotp(row.secret, code);\n";
  const sondaIh = olc(sondaMetin);
  check("§5 sonda: sarmalsız create + ham verifyTotp → KIRMIZI", sondaIh.length >= 2, sondaIh.join("; "));

  const sema = fs.readFileSync(path.join(KOK, "prisma/schema.prisma"), "utf8");
  check("§5 şema: iki sır kolonu sarılı değeri taşır (≥ VarChar(120))",
    /totpSecret\s+String\?\s+@db\.VarChar\((\d+)\)/.exec(sema)?.[1] !== undefined && Number(/totpSecret\s+String\?\s+@db\.VarChar\((\d+)\)/.exec(sema)![1]) >= 120 &&
    Number(/secret\s+String\s+@db\.VarChar\((\d+)\)/.exec(sema)?.[1] ?? 0) >= 120);
}

// ── DB bölümleri ────────────────────────────────────────────────────────────
async function db(): Promise<void> {
  const ids: string[] = [];
  const admin = await kullanici("admin");
  ids.push(admin.id);
  try {
    console.log("\n=== §1) Pencere + kullanıcı sırrı DB'de sarılı; okuma yolları açık değerle ===");
    const u = await kullanici("u1");
    ids.push(u.id);
    const w = await TotpAccountService.openWindow({ userId: u.id, openedById: admin.id });
    const pencere = await prisma.totpEnrollment.findUniqueOrThrow({ where: { token: w.token }, select: { secret: true } });
    check("§1 pencere satırı `enc1:` sarmalı, düz sır DB'de değil", sealed(pencere.secret) && pencere.secret !== w.secret, pencere.secret.slice(0, 24));
    check("§1 sarılı değer tek okuyucuyla açılır = verilen açık sır", openStoredTotpSecret(pencere.secret) === w.secret);
    const okunan = await TotpAccountService.readWindow(w.token);
    check("§1 readWindow açık sırrı ve otpauth'u verir", okunan.secret === w.secret && okunan.otpauthUri.includes(w.secret));
    const sonuc = await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
    check("§1 pencere açık sırla üretilen kodla tüketildi", sonuc.recoveryCodes.length === 10);
    const satir = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true } });
    check("§1 kullanıcı sırrı `enc1:` sarmalı, açılınca aynı", sealed(satir.totpSecret) && openStoredTotpSecret(satir.totpSecret) === w.secret);
    check("§1 durum AÇIK (kanıt eşleşmesi açık değer üzerinden)", (await TotpAccountService.getStatus(u.id)).enabled);
    const adim = totpStep() + 1;
    check("§1 ikinci faktör açık sırla doğrulanır", await TotpAccountService.verifySecondFactor(u.id, totpCodeForStep(w.secret, adim)));
    const ham = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM users WHERE "totpSecret" = ${w.secret}
      UNION ALL SELECT count(*) FROM totp_enrollments WHERE secret = ${w.secret}`;
    check("§1 düz sır hiçbir tabloda yok (dump taşımaz)", ham.every((r) => Number(r.n) === 0));

    console.log("\n=== §2) G1: mühür özeti saklama biçiminden bağımsız (açık sırdan doğar) ===");
    const sarili = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: SEAL_ROW_SELECT });
    const ozetSarili = credentialDigest(sarili);
    const kanit = await prisma.totpEnrollment.findFirstOrThrow({ where: { token: w.token }, select: { id: true } });
    await prisma.user.update({ where: { id: u.id }, data: { totpSecret: w.secret } });
    await prisma.totpEnrollment.update({ where: { id: kanit.id }, data: { secret: w.secret } });
    const duz = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: SEAL_ROW_SELECT });
    const ozetDuz = credentialDigest(duz);
    check("§2 ⭐ düz saklanan ve sarılı saklanan satır AYNI özeti verir", ozetDuz === ozetSarili);
    check("§2 sonda: başka açık sır farklı özet (ölçüm sırra kör değil)",
      credentialDigest({ ...duz, totpSecret: generateTotpSecret() }) !== ozetDuz);

    console.log("\n=== §3) Açılış işi: düz sırlar bir kez sarılır, ikinci koşum dokunmaz ===");
    const once = await wrapPlainTotpSecrets();
    const s3 = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true, updatedAt: true } });
    const p3 = await prisma.totpEnrollment.findUniqueOrThrow({ where: { id: kanit.id }, select: { secret: true, updatedAt: true } });
    check("§3 geçiş işi düz kullanıcı + pencere sırrını sardı", once.durum === "TAMAM" && once.kullanici >= 1 && once.pencere >= 1 && sealed(s3.totpSecret) && sealed(p3.secret),
      JSON.stringify(once));
    check("§3 sarılan değer açılınca eski açık sır", openStoredTotpSecret(s3.totpSecret) === w.secret && openStoredTotpSecret(p3.secret) === w.secret);
    check("§3 geçişten sonra 2FA hâlâ AÇIK (kanıt korunur)", (await TotpAccountService.getStatus(u.id)).enabled);
    const iki = await wrapPlainTotpSecrets();
    const s3b = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { totpSecret: true, updatedAt: true } });
    check("§3 ikinci koşum idempotent: 0 satır, değer ve updatedAt değişmedi",
      iki.kullanici === 0 && iki.pencere === 0 && s3b.totpSecret === s3.totpSecret && s3b.updatedAt.getTime() === s3.updatedAt.getTime(), JSON.stringify(iki));

    console.log("\n=== §4) Fail-closed: anahtar halkası başka makinede → 2FA sessizce kapanmaz ===");
    const baska = fs.mkdtempSync(path.join(os.tmpdir(), "bekci-totp-halka-"));
    setShortCredentialKeyDirForTests(baska);
    try {
      check("§4 ön koşul: başka dizinde yeni (farklı) halka doğdu", getShortCredentialKeyRing().ok);
      check("§4 sarılı sır bu halkayla açılamaz → null", openStoredTotpSecret(s3.totpSecret) === null);
      let kod = "";
      try {
        await TotpAccountService.getStatus(u.id);
      } catch (e) {
        kod = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
      }
      check("§4 ⭐ durum okuması 503 TOTP_SECRET_UNREADABLE (kapalı sayılmaz)", kod === "TOTP_SECRET_UNREADABLE", kod);
      const satir4 = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: SEAL_ROW_SELECT });
      check("§4 mühür özeti açılamayan sır için farklı (t:! — mühür geçersiz kalır)", credentialDigest(satir4) !== ozetSarili);
    } finally {
      setShortCredentialKeyDirForTests(null);
      fs.rmSync(baska, { recursive: true, force: true });
    }
    check("§4 halka geri gelince aynı özet", credentialDigest(await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: SEAL_ROW_SELECT })) === ozetSarili);
  } finally {
    await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } });
    // Pencere/kanıt satırları kullanıcıya FK'lı — önce onlar.
    await prisma.totpEnrollment.deleteMany({ where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main(): Promise<void> {
  console.log("=== TOTP sırrı sarılı saklama (B1c) ===");
  if (SONDA === "duz-yaz") {
    console.log("⚠️ SONDA duz-yaz: yazıcı düz yazar — §1/§3 kırmızı beklenir");
    setTotpSecretSealerForTest((p) => p);
  }
  check("ön koşul: anahtar halkası hazır", getShortCredentialKeyRing().ok, JSON.stringify(getShortCredentialKeyRing()).slice(0, 120));
  check("ön koşul: `storeTotpSecret` sarmal üretir", SONDA === "duz-yaz" ? !sealed(storeTotpSecret("ABCD")) : sealed(storeTotpSecret("ABCD")));
  statik();
  await db();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
