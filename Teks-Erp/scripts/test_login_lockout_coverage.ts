// =============================================================================
// Test: HER giriş yolu deneme kilidine bağlı + kilit bcrypt'ten ÖNCE (2026-08-09)
// Çalıştır: npx tsx scripts/test_login_lockout_coverage.ts
// =============================================================================
// Denetim bulgusu F-KIM-GUV-001: `AuthController.login` (klasik kullanıcı adı +
// şifre) `reserveLoginAttempt`i ÇAĞIRMIYORDU — çağıranlar yalnız `loginCard` ve
// `loginQuickPin` idi. Aynı boşluk İKİ ayrı yol açıyordu:
//   (a) sınırsız şifre denemesi → hesap ele geçirme,
//   (b) her denemenin bcryptjs (maliyet 10) hesabını TEK event loop'ta koşturması
//       → kimlik doğrulamasız DoS (tüm ERP yanıt veremez hale gelir).
//
// Bu bekçi ÜÇ şeyi kilitler:
//   1. KAPSAMA — `login`, `loginCard`, `loginQuickPin`ın ÜÇÜ de rezervasyon +
//      başarıda reset + kimlik-dışı hatada release çağırıyor.
//   2. SIRA (load-bearing) — rezervasyon `AuthService.*` çağrısından ÖNCE gelmeli.
//      Ters sırada kilitli anahtar da bcrypt harcar, yani (b) hiç kapanmaz.
//   3. DAVRANIŞ — `reserveLoginAttempt` gerçekten eşikte bloklar ve `resetLoginLockout`
//      onu geri alır (saf birim; DB'den yalnız ayar okur).
//
// + KÖRLÜK ZEMİNİ: taranan handler sayısı 3'ün altına düşerse KIRMIZI — regex
// bozulduğunda "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın.
// =============================================================================
import { readFileSync } from "fs";
import { join } from "path";
import prisma, { pool } from "../src/lib/prisma";
import {
  reserveLoginAttempt,
  resetLoginLockout,
  releaseLoginAttempt,
} from "../src/middlewares/login-lockout";
import { readPinLockoutConfig } from "../src/services/system-setting.service";

const CTRL = join(__dirname, "../src/controllers/auth.controller.ts");
/** Kilit gerektiren giriş handler'ları — yeni bir giriş yolu eklenirse buraya yaz. */
const LOGIN_HANDLERS = ["login", "loginCard", "loginQuickPin"] as const;

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

/** `static async <ad>(` ile başlayan handler gövdesini bir sonraki handler'a kadar alır. */
function handlerBody(src: string, name: string): string | null {
  const start = src.indexOf(`static async ${name}(`);
  if (start === -1) return null;
  const next = src.slice(start + 1).search(/\n  static async \w+\(/);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

async function main(): Promise<void> {
  console.log("=== Giriş kilidi kapsaması ===\n");
  const src = readFileSync(CTRL, "utf8");

  // ── 1) KAPSAMA + SIRA ──────────────────────────────────────────────────────
  let scanned = 0;
  for (const name of LOGIN_HANDLERS) {
    const body = handlerBody(src, name);
    if (!body) {
      check(`${name}: handler bulundu`, false, "gövde ayrıştırılamadı");
      continue;
    }
    scanned++;
    const reserveAt = body.indexOf("reserveLoginAttempt(");
    check(`${name}: reserveLoginAttempt çağırıyor`, reserveAt !== -1);
    check(`${name}: başarıda resetLoginLockout çağırıyor`, body.includes("resetLoginLockout("));
    check(
      `${name}: kimlik-dışı hatada releaseLoginAttempt çağırıyor`,
      body.includes("releaseLoginAttempt("),
    );

    // SIRA: rezervasyon, kimlik doğrulayan AuthService çağrısından ÖNCE olmalı.
    const authAt = body.search(/await AuthService\.(login|loginWithCard|loginWithQuickPin)\(/);
    check(
      `${name}: kilit AuthService çağrısından (bcrypt) ÖNCE`,
      reserveAt !== -1 && authAt !== -1 && reserveAt < authAt,
      reserveAt === -1 || authAt === -1 ? "konum çözülemedi" : `reserve@${reserveAt} < auth@${authAt}`,
    );
  }

  // ── KÖRLÜK ZEMİNİ ──────────────────────────────────────────────────────────
  check(
    `körlük zemini: ${LOGIN_HANDLERS.length} handler'ın hepsi tarandı`,
    scanned === LOGIN_HANDLERS.length,
    `taranan: ${scanned}`,
  );

  // ── 2) DAVRANIŞ — eşikte bloklar, reset geri alır ─────────────────────────
  const cfg = await readPinLockoutConfig();
  console.log(
    `\n(ayar: enabled=${cfg.enabled} attempts=${cfg.attempts} penaltySec=${cfg.penaltySec})`,
  );
  // ⚠️ Kilit AYAR ile kapanabilir (auth.pinLockoutEnabled). Kapalıysa davranış
  // sondası anlamsızdır — atlanır ama SESSİZ DEĞİL: kapalı olduğu ekrana yazılır.
  if (!cfg.enabled) {
    console.log("⚠️  auth.pinLockoutEnabled=false → davranış sondası atlandı (üç yol da korumasız).");
  } else {
    const key = `TEST-LOCKOUT-${Date.now()}`;
    let blockedAt = -1;
    for (let i = 1; i <= cfg.attempts + 1; i++) {
      const r = await reserveLoginAttempt(key);
      if (r.blocked && blockedAt === -1) blockedAt = i;
    }
    check(
      `${cfg.attempts} hatalı denemeden SONRA blok kuruluyor`,
      blockedAt === cfg.attempts + 1,
      `blok ${blockedAt}. denemede`,
    );
    resetLoginLockout(key);
    const after = await reserveLoginAttempt(key);
    check("resetLoginLockout bloğu kaldırıyor (başarılı giriş sonrası)", !after.blocked);
    releaseLoginAttempt(key);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
