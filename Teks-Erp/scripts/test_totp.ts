// =============================================================================
// Test: TOTP (RFC 6238) + kurulum penceresi + kurtarma kodları — 2026-09-01
// Çalıştır: npx tsx scripts/test_totp.ts
// =============================================================================
// ⭐ ASIL İDDİA — ÜRETTİĞİMİZ KODLAR STANDARDA UYUYOR. Kendi HMAC'imizi yazdık
// (yeni npm paketi yok); bunun tek dürüst kanıtı RFC'nin KENDİ test
// vektörleridir. "Kod üretiliyor ve doğrulanıyor" turu kendi kendini onaylardı:
// hatalı bir uygulama da kendi ürettiğini doğrular — ama Google Authenticator
// asla aynı kodu göstermez ve bunu ancak sahada, girişte fark ederdik.
//
// İkinci iddia: replay penceresi gerçekten kapalı. TOTP kodu 30 sn geçerlidir;
// kabul edilen adım saklanmazsa aynı kod ikinci kez kullanılabilir.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  normalizeRecoveryCode,
  totpCodeForStep,
  totpStep,
  verifyTotp,
  TOTP_STEP_SEC,
} from "../src/services/totp.service";
import { TotpAccountService } from "../src/services/totp-account.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** RFC 4226 / 6238 referans sırrı: ASCII "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

// -----------------------------------------------------------------------------
// 1) BASE32 — authenticator uygulamalarının okuduğu biçim
// -----------------------------------------------------------------------------
function sectionBase32(): void {
  console.log("\n[1] Base32 kodlama");
  check(
    "RFC sırrı beklenen base32'ye kodlanıyor",
    RFC_SECRET === "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    RFC_SECRET,
  );
  const round = base32Decode(RFC_SECRET).toString("ascii");
  check("çözme geri dönüşü kayıpsız", round === "12345678901234567890", round);
  check("dolgu/boşluk/tire toleranslı", base32Decode("GEZD GNBV-GY3T=").length > 0);
  const secret = generateTotpSecret();
  check("üretilen sır 20 bayt (160 bit, RFC 4226 §4)", base32Decode(secret).length === 20);
  check("üretilen sır dolgusuz", !secret.includes("="));
}

// -----------------------------------------------------------------------------
// 2) RFC 4226 HOTP TEST VEKTÖRLERİ — dış referansla ölçüm
// -----------------------------------------------------------------------------
const HOTP_VECTORS = [
  "755224", "287082", "359152", "969429", "338314",
  "254676", "287922", "162583", "399871", "520489",
];

function sectionHotpVectors(): void {
  console.log("\n[2] RFC 4226 HOTP test vektörleri");
  check("körlük zemini: vektör sayısı", HOTP_VECTORS.length === 10);
  HOTP_VECTORS.forEach((expected, counter) => {
    const got = hotp(RFC_SECRET, counter);
    check(`HOTP(sayaç=${counter}) = ${expected}`, got === expected, got);
  });
}

// -----------------------------------------------------------------------------
// 3) RFC 6238 TOTP TEST VEKTÖRLERİ
// -----------------------------------------------------------------------------
// RFC tablosu 8 haneliktir; 6 hanelik değer aynı kırpmanın mod 10^6'sıdır, yani
// 8 hanelinin son 6 hanesi. Yorum burada duruyor çünkü tabloyu RFC ile
// karşılaştıran bir sonraki kişi "sayılar tutmuyor" diye düşünecektir.
const TOTP_VECTORS: Array<[number, string, string]> = [
  [59, "94287082", "287082"],
  [1111111109, "07081804", "081804"],
  [1111111111, "14050471", "050471"],
  [1234567890, "89005924", "005924"],
  [2000000000, "69279037", "279037"],
  [20000000000, "65353130", "353130"],
];

function sectionTotpVectors(): void {
  console.log("\n[3] RFC 6238 TOTP test vektörleri");
  check("körlük zemini: vektör sayısı", TOTP_VECTORS.length === 6);
  for (const [unixSec, rfc8, expected6] of TOTP_VECTORS) {
    const step = totpStep(unixSec * 1000);
    const got = totpCodeForStep(RFC_SECRET, step);
    check(`t=${unixSec} → ${expected6} (RFC 8 hane: ${rfc8})`, got === expected6, got);
  }
  check("adım süresi 30 sn", TOTP_STEP_SEC === 30);
}

// -----------------------------------------------------------------------------
// 4) DOĞRULAMA — kayma · biçim · replay
// -----------------------------------------------------------------------------
function sectionVerify(): void {
  console.log("\n[4] Doğrulama: kayma, biçim, replay");
  const now = 1_700_000_000_000;
  const step = totpStep(now);

  check("güncel kod kabul", verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step), { atMs: now }).ok);
  check(
    "bir önceki adım kabul (telefon saati geride)",
    verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 1), { atMs: now }).ok,
  );
  check(
    "bir sonraki adım kabul (telefon saati ileride)",
    verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + 1), { atMs: now }).ok,
  );
  // ⭐ Pencere GENİŞLEMEMELİ: her ek adım kaba kuvvet şansını artırır.
  check(
    "iki adım geride REDDEDİLİR (pencere ±1)",
    !verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 2), { atMs: now }).ok,
  );
  check(
    "iki adım ileride REDDEDİLİR",
    !verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + 2), { atMs: now }).ok,
  );

  const bad = verifyTotp(RFC_SECRET, "12345", { atMs: now });
  check("5 hane → biçim hatası", !bad.ok && bad.reason === "format");
  const bad2 = verifyTotp(RFC_SECRET, "abcdef", { atMs: now });
  check("harf → biçim hatası", !bad2.ok && bad2.reason === "format");
  check(
    "boşluklu kod kabul (kullanıcı '123 456' yazabilir)",
    verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step).replace(/^(\d{3})/, "$1 "), {
      atMs: now,
    }).ok,
  );

  // ⭐ REPLAY: aynı kod ikinci kez geçmemeli.
  const code = totpCodeForStep(RFC_SECRET, step);
  const first = verifyTotp(RFC_SECRET, code, { atMs: now });
  check("ilk kullanım kabul, adım döner", first.ok && first.step === step);
  const replay = verifyTotp(RFC_SECRET, code, { atMs: now, lastUsedStep: step });
  check("AYNI kod ikinci kez REDDEDİLİR (replay)", !replay.ok && replay.reason === "replay");
  check(
    "eski adım da reddedilir (lastUsedStep ilerideyse)",
    !verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step - 1), {
      atMs: now,
      lastUsedStep: step,
    }).ok,
  );
  check(
    "SONRAKİ adım replay kilidinden sonra da kabul",
    verifyTotp(RFC_SECRET, totpCodeForStep(RFC_SECRET, step + 1), {
      atMs: now,
      lastUsedStep: step,
    }).ok,
  );
}

// -----------------------------------------------------------------------------
// 5) otpauth URI + kurtarma kodları
// -----------------------------------------------------------------------------
function sectionUriAndRecovery(): void {
  console.log("\n[5] otpauth URI + kurtarma kodları");
  const uri = buildOtpauthUri({ username: "ali", secretBase32: RFC_SECRET, issuer: "TeksERP" });
  check("şema doğru", uri.startsWith("otpauth://totp/"));
  check("issuer ve secret parametreleri var", uri.includes("issuer=TeksERP") && uri.includes(`secret=${RFC_SECRET}`));
  check("algoritma SHA1 (authenticator uyumu)", uri.includes("algorithm=SHA1"));
  check("6 hane / 30 sn", uri.includes("digits=6") && uri.includes("period=30"));
  // ⭐ Kaçırma: ':' içeren kullanıcı adı URI'yi parçalarsa telefon "geçersiz QR" der.
  const tricky = buildOtpauthUri({
    username: "ali:veli&x",
    secretBase32: RFC_SECRET,
    issuer: "TeksERP",
  });
  check(
    "kullanıcı adındaki ':' ve '&' kaçırılır",
    tricky.includes("TeksERP%3Aali%3Aveli%26x"),
    tricky.split("?")[0],
  );

  const codes = generateRecoveryCodes();
  check("10 kurtarma kodu", codes.length === 10);
  check("biçim XXXX-XXXX", codes.every((c) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)));
  // ⭐ Karışan karakterler dışarıda: kod kâğıda yazılıp elle giriliyor.
  check("I/L/O/U kullanılmaz (elle girişte karışır)", codes.every((c) => !/[ILOU]/.test(c)));
  check("kodlar benzersiz", new Set(codes).size === 10);
  check(
    "normalize: küçük harf/tiresiz/boşluklu giriş kabul",
    normalizeRecoveryCode(" ab3d ef4h ") === "AB3D-EF4H",
    normalizeRecoveryCode(" ab3d ef4h "),
  );
}

// -----------------------------------------------------------------------------
// 6) DB — kurulum penceresi yaşam döngüsü
// -----------------------------------------------------------------------------
const TAG = `TEST-TOTP-${Date.now()}`;

async function sectionEnrollment(): Promise<void> {
  console.log("\n[6] Kurulum penceresi (DB)");

  const hash = await bcrypt.hash("test123", 10);
  const [user, admin] = await Promise.all([
    prisma.user.create({
      data: { username: `${TAG}-u`, passwordHash: hash, fullName: "Totp Sonda" },
      select: { id: true, username: true },
    }),
    prisma.user.create({
      data: { username: `${TAG}-a`, passwordHash: hash, fullName: "Totp Admin" },
      select: { id: true },
    }),
  ]);

  try {
    const before = await TotpAccountService.getStatus(user.id);
    check("başlangıçta TOTP kapalı", !before.enabled);

    const w = await TotpAccountService.openWindow({ userId: user.id, openedById: admin.id });
    check("pencere açıldı (token + otpauth)", Boolean(w.token && w.otpauthUri));
    check("pencere ~15 dk ömürlü", w.expiresAt.getTime() - Date.now() > 14 * 60_000);

    const read = await TotpAccountService.readWindow(w.token);
    check("pencere okunabiliyor (QR gösterimi)", read.username === user.username);

    // ⭐ Yanlış kod kurulumu tamamlamamalı.
    let rejected = false;
    try {
      await TotpAccountService.consumeWindow(w.token, "000000");
    } catch {
      rejected = true;
    }
    check("yanlış kod ile kurulum REDDEDİLİR", rejected);
    check(
      "reddedilen kurulumdan sonra TOTP hâlâ KAPALI",
      !(await TotpAccountService.getStatus(user.id)).enabled,
    );

    const code = totpCodeForStep(w.secret, totpStep());
    const out = await TotpAccountService.consumeWindow(w.token, code);
    check("doğru kod ile kurulum tamamlandı", out.recoveryCodes.length === 10);

    const after = await TotpAccountService.getStatus(user.id);
    check("TOTP artık AÇIK", after.enabled);
    check("10 kurtarma kodu kayıtlı", after.remainingRecoveryCodes === 10);

    // ⭐ Pencere TEK KULLANIMLIK.
    let reused = false;
    try {
      await TotpAccountService.consumeWindow(w.token, totpCodeForStep(w.secret, totpStep()));
    } catch {
      reused = true;
    }
    check("aynı pencere İKİNCİ KEZ kullanılamaz", reused);

    // ── Giriş doğrulaması ──────────────────────────────────────────────────
    // ⚠️ Kurulumda `totpLastStep` yazıldığı için AYNI adımın kodu artık replay'dir.
    // Bir SONRAKİ adımın kodu ile ölçülür (gerçek girişte de en az 30 sn geçer).
    const nextStep = totpStep() + 1;
    check(
      "geçerli kod ile ikinci faktör doğrulanıyor",
      await TotpAccountService.verifySecondFactor(user.id, totpCodeForStep(w.secret, nextStep)),
    );
    check(
      "AYNI kod ikinci kez REDDEDİLİR (DB replay kilidi)",
      !(await TotpAccountService.verifySecondFactor(user.id, totpCodeForStep(w.secret, nextStep))),
    );
    check(
      "rastgele kod reddedilir",
      !(await TotpAccountService.verifySecondFactor(user.id, "000000")),
    );

    // ── Kurtarma kodu ──────────────────────────────────────────────────────
    const rc = out.recoveryCodes[0] as string;
    check("kurtarma kodu kabul", await TotpAccountService.verifySecondFactor(user.id, rc));
    check(
      "AYNI kurtarma kodu ikinci kez REDDEDİLİR",
      !(await TotpAccountService.verifySecondFactor(user.id, rc)),
    );
    check(
      "kalan kurtarma kodu 9'a düştü",
      (await TotpAccountService.getStatus(user.id)).remainingRecoveryCodes === 9,
    );
    check(
      "tire/küçük harf toleranslı kurtarma kodu",
      await TotpAccountService.verifySecondFactor(
        user.id,
        (out.recoveryCodes[1] as string).toLowerCase().replace("-", " "),
      ),
    );

    // ── Süresi dolmuş pencere ──────────────────────────────────────────────
    const w2 = await TotpAccountService.openWindow({ userId: user.id, openedById: admin.id });
    await prisma.totpEnrollment.update({
      where: { token: w2.token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    let expired = false;
    try {
      await TotpAccountService.readWindow(w2.token);
    } catch {
      expired = true;
    }
    check("süresi dolmuş pencere okunamaz", expired);

    // ⭐ Yeni pencere açmak ÖNCEKİNİ iptal eder (iki geçerli bağlantı dolaşmasın).
    const w3 = await TotpAccountService.openWindow({ userId: user.id, openedById: admin.id });
    const w4 = await TotpAccountService.openWindow({ userId: user.id, openedById: admin.id });
    let w3dead = false;
    try {
      await TotpAccountService.readWindow(w3.token);
    } catch {
      w3dead = true;
    }
    check("yeni pencere öncekini geçersiz kılar", w3dead);
    check("en son pencere geçerli", Boolean(await TotpAccountService.readWindow(w4.token)));

    // ── Yönetici sıfırlaması ───────────────────────────────────────────────
    const beforeTv = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    await TotpAccountService.reset({ userId: user.id, byId: admin.id });
    const reset = await TotpAccountService.getStatus(user.id);
    check("sıfırlama sonrası TOTP kapalı", !reset.enabled);
    check("kullanılmamış kurtarma kodları silindi", reset.remainingRecoveryCodes === 0);
    const afterTv = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    // ⭐ Sıfırlama güvenlik duruşunu DÜŞÜRÜR → açık oturumlar yeniden doğrulanmalı.
    check(
      "sıfırlama tokenVersion'ı BUMP eder (açık oturumlar düşer)",
      (afterTv?.tokenVersion ?? 0) === (beforeTv?.tokenVersion ?? 0) + 1,
    );
  } finally {
    const ids = [user.id, admin.id];
    await prisma.userRecoveryCode.deleteMany({ where: { userId: { in: ids } } });
    await prisma.totpEnrollment.deleteMany({
      where: { OR: [{ userId: { in: ids } }, { openedById: { in: ids } }] },
    });
    await prisma.systemLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("=== TOTP (RFC 6238) ===");
  sectionBase32();
  sectionHotpVectors();
  sectionTotpVectors();
  sectionVerify();
  sectionUriAndRecovery();
  await sectionEnrollment();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

void main();
