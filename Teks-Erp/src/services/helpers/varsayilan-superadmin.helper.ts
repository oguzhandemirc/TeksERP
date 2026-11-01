// =============================================================================
// VARSAYILAN SATICI HESABI (süperadmin) — kullanıcı kararı 2026-10-11
// =============================================================================
// Kurulumda HİÇ sistem hesabı yoksa boot, ORTAK kullanıcı adı + ORTAK parolayla bir kez hesap
// doğurur (Linux kurulumunda parolayı gösterecek arayüz yok). Hesap `mustChangePassword` ile
// doğar: parola değişene dek yalnız me/logout/change-password açıktır.
//
// MALZEME REPODA YOK: `{kullaniciAdi, ozet}` (bcrypt, maliyet ≥12) derleme anında
// `__TEKSERP_VARSAYILAN_SA__` sabitine gömülür (`scripts/lib/varsayilan-superadmin-derleme.mjs`;
// kaynak GitHub Actions sırrı ya da `~/.tekserp/sirlar/`). Gömülmemiş derlemede (geliştirme,
// test, malzemesiz paket) hesap DOĞMAZ — çalışma zamanı ortamından okunmaz (eski `.env`
// doğuş yolu geri gelmez). Düz parola hiçbir katmanda yoktur.
//
// TEK `isSystemAccount` YAZARI src/ altında budur (öteki `scripts/superadmin-olustur.ts`);
// yalnız `jobs/superadmin.job.ts` çağırır — route/controller/Zod yolu yok (`test_superadmin_visible` §4).
// =============================================================================
import { verifyPassword } from "./password-hasher.helper";
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { SYSTEM_ACCOUNT_FULLNAME } from "../../constants/system-account";
import { malzemeCoz, type VarsayilanMalzeme } from "../../constants/varsayilan-superadmin";
import { writeLatch, writeSeal, type WriteSealResult } from "./system-account-seal.helper";

/** Derleme anı sabiti; gömülmemiş derlemede tanımsızdır (typeof ile okunur). */
declare const __TEKSERP_VARSAYILAN_SA__: string | undefined;

/** Satıcı hesabı doğuşu/devri — `provisionSuperadmin` ile boot yarışını tek hesaba indirir. */
export const SYSTEM_ACCOUNT_LOCK_NS: number = 8038;

/** Kurulum aracının (src dışı) kilidi: raw SQL betikte durmasın diye buradan alınır. */
export async function lockSystemAccount(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYSTEM_ACCOUNT_LOCK_NS}::int, 0)`;
}

/** Pakete gömülü malzeme; yoksa ya da bozuksa `null`. */
export function gomuluMalzeme(): VarsayilanMalzeme | null {
  const ham = typeof __TEKSERP_VARSAYILAN_SA__ === "undefined" ? null : __TEKSERP_VARSAYILAN_SA__;
  return ham ? malzemeCoz(ham) : null;
}

/** Verilen parola ortak varsayılan parola mı (malzeme yoksa false). */
export async function varsayilanParolaMi(
  parola: string,
  malzeme: VarsayilanMalzeme | null = gomuluMalzeme(),
): Promise<boolean> {
  if (!malzeme) return false;
  return verifyPassword(parola, malzeme.ozet);
}

export type DefaultBirthResult =
  | { action: "malzeme-yok" }
  | { action: "var" }
  | { action: "ad-dolu" }
  | { action: "dogdu"; id: string; muhur: WriteSealResult["durum"]; kid?: string };

/**
 * Hiç sistem hesabı yoksa varsayılan hesabı doğurur (idempotent). Kilit tx'in İLK ifadesi:
 * eşzamanlı iki çağrı (ya da kurulum aracı) tek hesap bırakır. Mevcut kullanıcı YÜKSELTİLMEZ —
 * ad başka bir kullanıcıdaysa doğmaz.
 */
export async function ensureVarsayilanSuperadmin(
  malzeme: VarsayilanMalzeme | null = gomuluMalzeme(),
  now: () => Date = () => new Date(),
): Promise<DefaultBirthResult> {
  if (!malzeme) return { action: "malzeme-yok" };
  const result = await prisma.$transaction(async (tx): Promise<DefaultBirthResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYSTEM_ACCOUNT_LOCK_NS}::int, 0)`;
    const existing = await tx.user.findFirst({ where: { isSystemAccount: true }, select: { id: true } });
    if (existing) return { action: "var" };
    const cakisan = await tx.user.findFirst({
      where: { username: { equals: malzeme.kullaniciAdi, mode: "insensitive" } },
      select: { id: true },
    });
    if (cakisan) return { action: "ad-dolu" };
    const an = now();
    const yeni = await tx.user.create({
      data: {
        username: malzeme.kullaniciAdi,
        fullName: SYSTEM_ACCOUNT_FULLNAME,
        passwordHash: malzeme.ozet,
        isSystemAccount: true,
        isActive: true,
        mustChangePassword: true,
        defaultPasswordIssuedAt: an,
      },
      select: { id: true },
    });
    // Doğuşta mühürlenir (G1): mühürlenemezse hesap yine doğar, mandal yazılmaz (bugünkü davranış + bant).
    const seal = await writeSeal(tx, yeni.id);
    return { action: "dogdu", id: yeni.id, muhur: seal.durum, ...(seal.durum === "MUHURLENDI" ? { kid: seal.kid } : {}) };
  });
  if (result.action === "dogdu") {
    if (result.kid) writeLatch(result.kid);
    // Sır ve kullanıcı adı yük'e girmez (yalnız durum).
    await AuditService.logEvent({
      category: "SYSTEM",
      action: "SUPERADMIN_DEFAULT_PROVISIONED",
      tableName: "users",
      recordId: result.id,
      payload: { fullName: SYSTEM_ACCOUNT_FULLNAME, mustChangePassword: true },
    }).catch(() => undefined);
  }
  return result;
}

/** Sistem hesabı hâlâ ortak varsayılan parolayla mı duruyor (panel bandı + portal). */
export async function varsayilanParolaBekliyor(): Promise<boolean> {
  const n = await prisma.user.count({
    where: { isSystemAccount: true, defaultPasswordIssuedAt: { not: null }, defaultPasswordChangedAt: null },
  });
  return n > 0;
}
