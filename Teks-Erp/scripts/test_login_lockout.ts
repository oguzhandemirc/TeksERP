// =============================================================================
// Test: Hızlı PIN + kart giriş deneme kilidi (login-lockout)
// Çalıştır: npx tsx scripts/test_login_lockout.ts
// Doğrulananlar:
//   1. N ardışık yanlış PIN → eşik aşılınca sonraki istek 429 (LOGIN_LOCKED + retryAfterSec).
//   2. Başarılı giriş sayacı SIFIRLAR (reset) — sonraki yanlışlar baştan sayılır.
//   3. Escalate: ceza turu escalateAfter'a varınca KISA ceza yerine UZUN ceza uygulanır.
//   4. Kart girişi de aynı kilide tabi (N yanlış kart → 429).
//   5. pinLockoutEnabled=false → reserveLoginAttempt hep {blocked:false} (kilit uygulanmaz).
// İzolasyon: dedicated TEST kullanıcısı; ayarlar test içinde set + finally'de restore;
// her senaryo AYRI anahtar (IP) kullanır + finally resetLoginLockout ile bellek temizlenir.
// =============================================================================
import prisma from "../src/lib/prisma"; // İLK import: dotenv → JWT_SECRET/DATABASE_URL
import type { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { AuthController } from "../src/controllers/auth.controller";
import { AuthService } from "../src/services/auth.service";
import { AppError } from "../src/utils/app-error";
import {
  reserveLoginAttempt,
  resetLoginLockout,
} from "../src/middlewares/login-lockout";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";

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

/** Controller handler'ı sahte req/res/next ile koştur → { statusCode, jsonBody, nextError }. */
async function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  opts: { body: unknown; ip: string },
): Promise<{ statusCode?: number; jsonBody?: unknown; nextError?: unknown }> {
  const req = { body: opts.body, ip: opts.ip, headers: {}, device: undefined } as unknown as Request;
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

function is429Locked(nextError: unknown): { ok: boolean; retryAfterSec?: number } {
  const ae = nextError instanceof AppError ? nextError : null;
  const details = ae?.details as { code?: string; retryAfterSec?: number } | undefined;
  return {
    ok: ae?.statusCode === 429 && details?.code === "LOGIN_LOCKED",
    retryAfterSec: details?.retryAfterSec,
  };
}
function is401(nextError: unknown): boolean {
  return nextError instanceof AppError && nextError.statusCode === 401;
}

const KEYS = [
  SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER,
  SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN,
  SETTING_KEYS.AUTH_LOGIN_METHODS,
  SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY,
] as const;

async function main() {
  const ts = Date.now();

  // --- Ayar snapshot (value + updatedById → FK Restrict için) ---
  type Snap = { value: Prisma.JsonValue; updatedById: string | null };
  const originals = new Map<string, Snap | undefined>();
  for (const k of KEYS) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true, updatedById: true } });
    originals.set(k, row ? { value: row.value, updatedById: row.updatedById } : undefined);
  }

  const user = await prisma.user.create({
    data: {
      username: `TEST-lock-${ts}`,
      passwordHash: await AuthService.hashPassword("test123"),
      fullName: "TEST Kilit Kullanıcı",
    },
    select: { id: true },
  });

  const rawSet = async (key: string, value: Prisma.InputJsonValue) => {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, updatedById: user.id },
      update: { value, updatedById: user.id },
    });
    invalidateFeatureFlagsCache();
  };

  /** Kimseyi doğrulamayan 6-haneli PIN bul (realPin ve DB'deki hiçbir PIN'e eşit değil). */
  async function findNonexistentPin(exclude: string): Promise<string> {
    for (let i = 0; i < 1000; i++) {
      const cand = String((424242 + i) % 1_000_000).padStart(6, "0");
      if (cand === exclude) continue;
      const hit = await prisma.user.findFirst({ where: { quickPin: cand, isActive: true }, select: { id: true } });
      if (!hit) return cand;
    }
    throw new Error("Boş PIN bulunamadı");
  }

  const usedKeys: string[] = [];
  try {
    // Deterministik ayarlar: attempts=3, kısa 60sn, escalateAfter=2, uzun 15dk.
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, true);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ATTEMPTS, 3);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC, 60);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ESCALATE_AFTER, 2);
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_LONG_PENALTY_MIN, 15);
    // pin + card giriş açık olmalı (yoksa 403 "kapalı" önce döner).
    await rawSet(SETTING_KEYS.AUTH_LOGIN_METHODS, { enabled: ["list", "pin", "card"], primary: "list" });
    // Çoklu başarılı login'de kick sürprizi olmasın.
    await rawSet(SETTING_KEYS.AUTH_SAME_TYPE_SESSION_POLICY, "off");

    // Test kullanıcısına gerçek PIN ata (başarı senaryosu için) + çakışmayan yanlış PIN.
    const realPin = need((await AuthService.setQuickPin(user.id, {}, undefined)).pin, "realPin");
    const wrongPin = await findNonexistentPin(realPin);

    // =====================================================================
    // 1) N yanlış PIN → 429 blok
    // =====================================================================
    const ipA = `10.9.0.1-${ts}`; usedKeys.push(ipA);
    for (let i = 1; i <= 3; i++) {
      const r = await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipA });
      check(`1.${i} yanlış PIN #${i} → 401 (henüz blok yok)`, is401(r.nextError), String(r.nextError));
    }
    const blocked = await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipA });
    const bl = is429Locked(blocked.nextError);
    check("1.4 eşik aşıldı → 429 LOGIN_LOCKED", bl.ok, `retryAfterSec=${bl.retryAfterSec}`);
    check("1.5 retryAfterSec ≈ 60 (kısa ceza)", (bl.retryAfterSec ?? 0) > 0 && (bl.retryAfterSec ?? 0) <= 60, `${bl.retryAfterSec}`);

    // =====================================================================
    // 2) Başarılı giriş sayacı SIFIRLAR
    // =====================================================================
    const ipB = `10.9.0.2-${ts}`; usedKeys.push(ipB);
    // 2 yanlış (fails=2, henüz blok yok) → sonra DOĞRU pin → reset.
    await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipB });
    await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipB });
    const okLogin = await invoke(AuthController.loginQuickPin, { body: { pin: realPin }, ip: ipB });
    const okData = okLogin.jsonBody as { success?: boolean; data?: { token?: string } } | undefined;
    check("2a doğru PIN → 200 + token", okLogin.statusCode === 200 && typeof okData?.data?.token === "string", `status=${okLogin.statusCode}`);
    // Reset çalıştıysa: sıfırdan 2 yanlış hâlâ blok DEĞİL (eşik 3). Reset olmasaydı
    // pre=2 + 1. yanlış = 3 → blok kurulur, 2. yanlış → 429 olurdu.
    const afterReset1 = await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipB });
    const afterReset2 = await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipB });
    check("2b başarı SONRASI 1. yanlış → 401 (sayaç sıfırlandı)", is401(afterReset1.nextError));
    check("2c başarı SONRASI 2. yanlış → 429 DEĞİL (401)", is401(afterReset2.nextError) && !is429Locked(afterReset2.nextError).ok);

    // =====================================================================
    // 3) Escalate → uzun ceza (modül-seviye: rounds escalateAfter'a varınca)
    // =====================================================================
    const ipEsc = `escalate-${ts}`; usedKeys.push(ipEsc);
    // Reserve modeli: reserve check+increment'i atomik yapar. Kısa cezayı 5sn'ye
    // (MIN sınır) çekip turlar arası bekleyerek escalation'ı gözlemle (bloklu reserve
    // read-only, sayaç artırmaz → turu ilerletmek için bloğun bitmesi gerekir).
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_PENALTY_SEC, 5);
    // Round 1: 3 reserve → penaltyRounds=1 (1>=2? hayır) → KISA (5sn).
    for (let i = 0; i < 3; i++) await reserveLoginAttempt(ipEsc);
    const round1 = await reserveLoginAttempt(ipEsc);
    check("3a round1 → blok + KISA ceza (≤60sn)", round1.blocked && round1.retryAfterSec > 0 && round1.retryAfterSec <= 60, `${round1.retryAfterSec}`);
    // Kısa blok bitsin, sonra 3 reserve daha → penaltyRounds=2 (2>=2) → UZUN (15dk=900sn).
    await sleep(5200);
    for (let i = 0; i < 3; i++) await reserveLoginAttempt(ipEsc);
    const round2 = await reserveLoginAttempt(ipEsc);
    check("3b round2 → UZUN ceza (>>kısa; ≈900sn)", round2.blocked && round2.retryAfterSec > 300, `${round2.retryAfterSec}`);

    // =====================================================================
    // 4) Kart girişi de aynı kilide tabi
    // =====================================================================
    const ipCard = `10.9.0.3-${ts}`; usedKeys.push(ipCard);
    for (let i = 1; i <= 3; i++) {
      const r = await invoke(AuthController.loginCard, { body: { cardCode: "WRONG-CARD" }, ip: ipCard });
      check(`4.${i} yanlış kart #${i} → 401`, is401(r.nextError), String(r.nextError));
    }
    const cardBlocked = await invoke(AuthController.loginCard, { body: { cardCode: "WRONG-CARD" }, ip: ipCard });
    check("4.4 kart eşik aşıldı → 429 LOGIN_LOCKED", is429Locked(cardBlocked.nextError).ok);

    // =====================================================================
    // 5) pinLockoutEnabled=false → checkLoginLockout hep blocked:false
    // =====================================================================
    const ipDis = `disabled-${ts}`; usedKeys.push(ipDis);
    // Önce (açıkken) bloke et: 3 reserve eşiği kurar, 4. reserve bloklu döner.
    for (let i = 0; i < 3; i++) await reserveLoginAttempt(ipDis);
    const disBefore = await reserveLoginAttempt(ipDis);
    check("5a kilit AÇIK → anahtar bloklu", disBefore.blocked);
    // Kapat → aynı anahtar artık bloklu değil.
    await rawSet(SETTING_KEYS.AUTH_PIN_LOCKOUT_ENABLED, false);
    const disAfter = await reserveLoginAttempt(ipDis);
    check("5b kilit KAPALI → blocked:false (bellek dolu olsa da)", !disAfter.blocked);
    // reserveLoginAttempt de kapalıyken no-op → controller da bloklamaz.
    const disLogin = await invoke(AuthController.loginQuickPin, { body: { pin: wrongPin }, ip: ipDis });
    check("5c kilit KAPALI → controller 429 vermez (401)", is401(disLogin.nextError));
  } finally {
    for (const k of usedKeys) resetLoginLockout(k);
    // Oturum + audit temizliği (başarılı login'ler session/log yazdı).
    await prisma.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { userId: user.id } }).catch(() => {});
    // Ayarları eski haline getir (updatedById dahil — FK Restrict).
    for (const k of KEYS) {
      const orig = originals.get(k);
      if (orig === undefined) {
        await prisma.systemSetting.deleteMany({ where: { key: k } }).catch(() => {});
      } else {
        await prisma.systemSetting.upsert({
          where: { key: k },
          create: { key: k, value: orig.value as Prisma.InputJsonValue, updatedById: orig.updatedById },
          update: { value: orig.value as Prisma.InputJsonValue, updatedById: orig.updatedById },
        }).catch(() => {});
      }
    }
    invalidateFeatureFlagsCache();
    await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
