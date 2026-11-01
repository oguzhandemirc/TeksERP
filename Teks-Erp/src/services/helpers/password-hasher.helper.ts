// =============================================================================
// PAROLA ÖZETİ — TEK BOĞAZ (VDS denetimi K1 + D2, 2026-11-01)
// =============================================================================
// src/ altında bcryptjs YALNIZ burada çağrılır (`test_parola_havuzu` §1 içe aktarma taraması): giriş, yerinde
// onay, parola değişimi, ayar şifresi, kurtarma kodu, varsayılan süperadmin. Hepsi aynı semafor +
// worker havuzundan geçer; doğrulama kuyruğu dolunca 503 AUTH_BUSY (yalnız parola uçları).
// =============================================================================
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PASSWORD_BCRYPT_COST } from "../../constants/password-policy";
import { AppError } from "../../utils/app-error";
import { PasswordHashBusyError, PasswordHashPool, readPoolConfig, type HashOp } from "./password-hash-pool.helper";

export const AUTH_BUSY_CODE = "AUTH_BUSY";
export const AUTH_BUSY_RETRY_AFTER_SEC = 2;

function inline(job: HashOp): Promise<string | boolean> {
  return job.op === "compare" ? bcrypt.compare(job.plain, job.hash) : bcrypt.hash(job.plain, job.cost);
}

let pool: PasswordHashPool | null = null;
function getPool(): PasswordHashPool {
  pool ??= new PasswordHashPool(readPoolConfig(), inline);
  return pool;
}

/** Yalnız bekçi: havuzu verilen ortamla yeniden kur (eskisini kapatır). */
export async function resetPasswordHashPoolForTests(env: NodeJS.ProcessEnv = process.env): Promise<PasswordHashPool> {
  await pool?.close();
  pool = new PasswordHashPool(readPoolConfig(env), inline);
  return pool;
}

function toBusy(err: unknown): never {
  if (err instanceof PasswordHashBusyError) {
    throw new AppError("Sunucu şu an çok yoğun. Birkaç saniye sonra tekrar deneyin.", 503, true, {
      code: AUTH_BUSY_CODE,
      retryAfterSec: AUTH_BUSY_RETRY_AFTER_SEC,
    });
  }
  throw err;
}

/** 503 AUTH_BUSY mı — kimlik denemesi değildir: kilit sayacı geri alınır, audit satırı yazılmaz. */
export function isAuthBusyError(err: unknown): boolean {
  return err instanceof AppError && err.statusCode === 503 && err.details?.code === AUTH_BUSY_CODE;
}

/** Parola ↔ özet. Kuyruk doluysa 503 AUTH_BUSY (AppError) fırlatır. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return (await getPool().run({ op: "compare", plain, hash })) === true;
  } catch (err) {
    return toBusy(err);
  }
}

/** Parola özeti üretir (kimlikli uçlar; kuyruk tavanına takılmaz, sırasını bekler). */
export async function hashPassword(plain: string, cost: number = PASSWORD_BCRYPT_COST): Promise<string> {
  return (await getPool().run({ op: "hash", plain, cost })) as string;
}

let dummyHash: Promise<string> | null = null;

/**
 * D2: bilinmeyen/pasif kullanıcıda da aynı maliyetli doğrulama — yanıt süresi kullanıcı adının
 * varlığını ele vermesin. Aynı semafordan geçer (K1 yüzeyini büyütmez); sonuç hep false.
 */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(18).toString("base64"), PASSWORD_BCRYPT_COST).catch((err: unknown) => {
    dummyHash = null;
    throw err;
  });
  await verifyPassword(plain, await dummyHash);
  return false;
}

/** Özetin bcrypt tur sayısı (saf ayrıştırma, CPU yok). */
export function passwordHashRounds(hash: string): number {
  return bcrypt.getRounds(hash);
}

/** bcrypt 72 baytı aşan girdiyi sessizce kırpar mı (saf ölçüm). */
export function passwordTruncates(plain: string): boolean {
  return bcrypt.truncates(plain);
}
