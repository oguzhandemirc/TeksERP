// PORTAL KULLANICILARI — yönetici açar (ilk yönetici CLI'dan: scripts/portal-kullanici.ts).
// TOTP kurulumunu kullanıcının kendisi DEĞİL, hesabı açan yönetici yapar: sır yalnız açılış/sıfırlama
// yanıtında BİR KEZ görünür (saklanan yanıta ve denetime girmez); parola sızsa bile saldırgan 2FA'yı
// kendi telefonuna bağlayamaz. Pasife alma / TOTP sıfırlama / parola değişimi açık oturumları kapatır.
import { randomUUID } from "node:crypto";
import type { PortalKullanici, PortalRolu } from "@prisma/client";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { prisma, type Db } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { requireReason } from "../services/sanction.service";
import { normalizeUsername } from "./auth.service";
import { hashPortalPassword, verifyPortalPassword } from "./password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,59}$/;

export interface TotpEnrollment {
  readonly sir: string;
  readonly otpauthUri: string;
}

/** Yanıta giden kullanıcı görünümü: parola özeti ve şifreli sır ASLA. */
export function userView(u: PortalKullanici) {
  return {
    id: u.id,
    kullaniciAdi: u.kullaniciAdi,
    adSoyad: u.adSoyad,
    rol: u.rol,
    bayiId: u.bayiId,
    aktif: u.aktif,
    kilitli: u.kilitBitis !== null && u.kilitBitis.getTime() > Date.now(),
    kilitBitis: u.kilitBitis,
    sonGiris: u.sonGiris,
    parolaDegisim: u.parolaDegisim,
    createdAt: u.createdAt,
  };
}

export async function closeUserSessions(db: Db, userId: string, reason: string, exceptSessionId?: string): Promise<number> {
  const r = await db.portalOturumu.updateMany({
    where: { kullaniciId: userId, kapanisZamani: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { kapanisZamani: new Date(), kapanisNedeni: reason },
  });
  return r.count;
}

export interface CreatePortalUserInput {
  readonly username: string;
  readonly fullName: string;
  readonly role: PortalRolu;
  readonly dealerId?: string | null;
  /** Önceden özetlenmiş parola (özetleme tx dışında — scrypt pahalı). */
  readonly passwordHash: string;
}

export async function createPortalUserTx(db: Db, ctx: VendorContext, g: CreatePortalUserInput): Promise<{ user: PortalKullanici; totp: TotpEnrollment }> {
  const username = normalizeUsername(g.username);
  if (!USERNAME_PATTERN.test(username)) throw badRequest("Kullanıcı adı 3–60 karakter: küçük harf, rakam, nokta, alt çizgi, tire");
  const fullName = g.fullName.trim();
  if (!fullName || fullName.length > 120) throw badRequest("Ad soyad 1–120 karakter olmalı");
  if (g.role === "BAYI") {
    if (!g.dealerId) throw badRequest("Bayi hesabı bir bayiye bağlanmalı");
    const dealer = await db.bayi.findUnique({ where: { id: g.dealerId } });
    if (!dealer || !dealer.aktif) throw badRequest("Bayi bulunamadı ya da pasif");
  } else if (g.dealerId) {
    throw badRequest("Satıcı rolleri bayiye bağlanamaz");
  }
  const taken = await db.portalKullanici.findUnique({ where: { kullaniciAdi: username }, select: { id: true } });
  if (taken) throw stateConflict("Bu kullanıcı adı alınmış");
  const id = randomUUID();
  const secret = generateTotpSecret();
  const user = await db.portalKullanici.create({
    data: {
      id,
      kullaniciAdi: username,
      adSoyad: fullName,
      rol: g.role,
      bayiId: g.role === "BAYI" ? (g.dealerId ?? null) : null,
      parolaOzeti: g.passwordHash,
      totpSirSifreli: ctx.portalSecrets.seal(secret, id),
      parolaDegisim: new Date(),
    },
  });
  return { user, totp: { sir: secret, otpauthUri: otpauthUri(username, secret) } };
}

export async function findPortalUser(db: Db, userId: string): Promise<PortalKullanici> {
  const user = await db.portalKullanici.findUnique({ where: { id: userId } });
  if (!user) throw notFoundError("Kullanıcı");
  return user;
}

/** Kendini pasife alma yasak: son yöneticinin kendini kilitlemesi portalı sahipsiz bırakırdı. */
export async function setPortalUserActiveTx(db: Db, g: { userId: string; active: boolean; reason: string; byUserId: string }): Promise<PortalKullanici> {
  requireReason(g.reason, g.active ? "Hesabı aktife almak" : "Hesabı pasife almak");
  if (!g.active && g.userId === g.byUserId) throw badRequest("Kendi hesabınızı pasife alamazsınız");
  const claim = await db.portalKullanici.updateMany({ where: { id: g.userId, aktif: !g.active }, data: { aktif: g.active } });
  if (claim.count === 0) {
    await findPortalUser(db, g.userId);
    throw stateConflict(g.active ? "Hesap zaten aktif" : "Hesap zaten pasif");
  }
  if (!g.active) await closeUserSessions(db, g.userId, "HESAP_PASIF");
  return findPortalUser(db, g.userId);
}

/** Yeni TOTP sırrı (kayıp telefon): eski kod anında geçersiz, oturumlar kapanır; sır yalnız bu yanıtta. */
export async function resetPortalUserTotpTx(db: Db, ctx: VendorContext, g: { userId: string; reason: string }): Promise<{ user: PortalKullanici; totp: TotpEnrollment }> {
  requireReason(g.reason, "TOTP sıfırlama");
  const user = await findPortalUser(db, g.userId);
  const secret = generateTotpSecret();
  const updated = await db.portalKullanici.update({
    where: { id: user.id },
    data: { totpSirSifreli: ctx.portalSecrets.seal(secret, user.id), totpSonAdim: null },
  });
  await closeUserSessions(db, user.id, "TOTP_SIFIRLANDI");
  return { user: updated, totp: { sir: secret, otpauthUri: otpauthUri(user.kullaniciAdi, secret) } };
}

export async function unlockPortalUserTx(db: Db, g: { userId: string }): Promise<PortalKullanici> {
  await findPortalUser(db, g.userId);
  return db.portalKullanici.update({ where: { id: g.userId }, data: { kilitBitis: null, basarisizGiris: 0 } });
}

/** Yönetici parola atar (unutulmuş parola): oturumlar kapanır. */
export async function setPortalUserPasswordTx(db: Db, g: { userId: string; passwordHash: string; reason: string }): Promise<PortalKullanici> {
  requireReason(g.reason, "Parola sıfırlama");
  await findPortalUser(db, g.userId);
  const user = await db.portalKullanici.update({ where: { id: g.userId }, data: { parolaOzeti: g.passwordHash, parolaDegisim: new Date() } });
  await closeUserSessions(db, g.userId, "PAROLA_SIFIRLANDI");
  return user;
}

/**
 * Kullanıcının kendi parola değişimi: mevcut parola + TOTP yeniden istenir (açık kalmış bir oturum
 * tek başına hesabı ele geçiremesin). Diğer oturumlar kapanır, bu oturum sürer.
 */
export async function changeOwnPassword(
  ctx: VendorContext,
  g: { userId: string; sessionId: string; currentPassword: string; newPassword: string; totp: string; nowMs?: number },
): Promise<void> {
  const nowMs = g.nowMs ?? Date.now();
  const user = await findPortalUser(prisma, g.userId);
  const secret = ctx.portalSecrets.open(user.totpSirSifreli, user.id);
  const passwordOk = await verifyPortalPassword(g.currentPassword, user.parolaOzeti);
  const totp = secret === null ? null : verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: user.totpSonAdim });
  if (!passwordOk || !totp || !totp.ok) throw new VendorError(401, "GIRIS_BASARISIZ", "Mevcut parola ya da doğrulama kodu hatalı");
  const hash = await hashPortalPassword(g.newPassword);
  const claim = await prisma.portalKullanici.updateMany({
    where: { id: user.id, OR: [{ totpSonAdim: null }, { totpSonAdim: { lt: totp.step } }] },
    data: { parolaOzeti: hash, parolaDegisim: new Date(nowMs), totpSonAdim: totp.step },
  });
  if (claim.count === 0) throw new VendorError(401, "GIRIS_BASARISIZ", "Mevcut parola ya da doğrulama kodu hatalı");
  await closeUserSessions(prisma, user.id, "PAROLA_DEGISTI", g.sessionId);
}
