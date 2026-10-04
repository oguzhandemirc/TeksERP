// PORTAL GİRİŞİ — tek adım: kullanıcı adı + parola + TOTP (TOTP ZORUNLU; TOTP'siz oturum yoktur).
// Kapılar (sırayla): hesap bu dinleyicide girebilir mi (satıcı rolleri yalnız ERİŞİM, BAYI yalnız
// GENEL; uymayan hesap BİLİNMEYEN hesap gibi davranır — sayaç değişmez, eşdeğer iş harcanır) →
// kilit (kilitli hesap da BİLİNMEYEN hesap gibi: aynı yanıt, aynı scrypt işi — kilit hesabın varlığını
// sızdırmasın) → parola + TOTP (tekrar oynatma kilidi) → oturum. Hata iletisi tek: hangi faktörün
// tutmadığı ya da kilit söylenmez. Ardışık başarısızlık eşiği hesabı süreli kilitler.
// Oturum belirteci düz saklanmaz (sha256); oturum doğduğu dinleyiciye bağlıdır.
import { createHash, randomBytes } from "node:crypto";
import type { PortalKullanici } from "@prisma/client";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { burnPasswordCheck, verifyPortalPassword } from "./password";
import { actorOf, roleAllowedOn, type PortalListener, type PortalRole } from "./roles";
import { verifyTotp } from "./totp";

// Oturumu ayıran DB'deki dinleyicidir: emekli TAILNET satırı hiçbir dinleyiciye eşit olmadığından çözülmez.
export const SESSION_COOKIE: Readonly<Record<PortalListener, string>> = { GENEL: "bayi_oturum", ERISIM: "satici_oturum" };
export const SESSION_COOKIE_PATH: Readonly<Record<PortalListener, string>> = { GENEL: "/bayi", ERISIM: "/portal" };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOUCH_INTERVAL_MS = 60_000;

export interface PortalSessionUser {
  readonly id: string;
  readonly kullaniciAdi: string;
  readonly adSoyad: string;
  readonly rol: PortalRole;
  readonly bayiId: string | null;
}

export interface PortalSession {
  readonly id: string;
  readonly listener: PortalListener;
  readonly user: PortalSessionUser;
  readonly actor: string;
  readonly expiresAt: Date;
}

export function normalizeUsername(name: string): string {
  return name.normalize("NFC").trim().toLowerCase();
}

export function sessionTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const loginFailed = (): VendorError =>
  new VendorError(401, "GIRIS_BASARISIZ", "Kullanıcı adı, parola ya da doğrulama kodu hatalı (art arda hatalı denemede hesap bir süre kilitlenir)");

function publicUser(u: Pick<PortalKullanici, "id" | "kullaniciAdi" | "adSoyad" | "rol" | "bayiId">): PortalSessionUser {
  return { id: u.id, kullaniciAdi: u.kullaniciAdi, adSoyad: u.adSoyad, rol: u.rol, bayiId: u.bayiId };
}

async function registerFailure(ctx: VendorContext, user: PortalKullanici, nowMs: number, listener: PortalListener): Promise<void> {
  const bumped = await prisma.portalKullanici.update({ where: { id: user.id }, data: { basarisizGiris: { increment: 1 } }, select: { basarisizGiris: true } });
  await recordAudit({ event: "PORTAL_GIRIS_BASARISIZ", entity: "PortalKullanici", entityId: user.id, actor: "portal", summary: { dinleyici: listener, ardisik: bumped.basarisizGiris } });
  if (bumped.basarisizGiris < ctx.config.PORTAL_GIRIS_ESIGI) return;
  const until = new Date(nowMs + ctx.config.PORTAL_KILIT_DK * 60_000);
  const locked = await prisma.portalKullanici.updateMany({
    where: { id: user.id, basarisizGiris: { gte: ctx.config.PORTAL_GIRIS_ESIGI } },
    data: { kilitBitis: until, basarisizGiris: 0 },
  });
  if (locked.count > 0) {
    await recordAudit({ event: "PORTAL_HESAP_KILITLENDI", entity: "PortalKullanici", entityId: user.id, actor: "portal", summary: { kilitBitis: until.toISOString() } });
  }
}

export interface LoginInput {
  readonly listener: PortalListener;
  readonly username: string;
  readonly password: string;
  readonly totp: string;
  readonly nowMs?: number;
}

export async function login(ctx: VendorContext, g: LoginInput): Promise<{ token: string; session: PortalSession }> {
  const nowMs = g.nowMs ?? Date.now();
  const username = normalizeUsername(g.username);
  const user = await prisma.portalKullanici.findUnique({ where: { kullaniciAdi: username }, include: { bayi: true } });
  const eligible =
    user !== null && user.aktif && roleAllowedOn(user.rol, g.listener) && (user.rol !== "BAYI" || (user.bayi !== null && user.bayi.aktif));
  if (!user || !eligible) {
    await burnPasswordCheck(g.password);
    if (user) {
      await recordAudit({ event: "PORTAL_GIRIS_REDDEDILDI", entity: "PortalKullanici", entityId: user.id, actor: "portal", summary: { dinleyici: g.listener, neden: user.aktif ? "DINLEYICI_YA_DA_BAYI" : "PASIF" } });
    }
    throw loginFailed();
  }
  if (user.kilitBitis && user.kilitBitis.getTime() > nowMs) {
    await burnPasswordCheck(g.password);
    await recordAudit({ event: "PORTAL_GIRIS_REDDEDILDI", entity: "PortalKullanici", entityId: user.id, actor: "portal", summary: { dinleyici: g.listener, neden: "KILITLI" } });
    throw loginFailed();
  }
  const passwordOk = await verifyPortalPassword(g.password, user.parolaOzeti);
  const secret = ctx.portalSecrets.open(user.totpSirSifreli, user.id);
  if (secret === null) {
    console.error(`[satici] portal: ${user.kullaniciAdi} TOTP sırrı çözülemedi (portal anahtarı değişmiş olabilir — CLI ile TOTP sıfırlayın)`);
    throw new VendorError(500, "SUNUCU_HATASI", "Doğrulama kodu denetlenemedi; yöneticiye başvurun");
  }
  const totp = verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: user.totpSonAdim });
  if (!passwordOk || !totp.ok) {
    await registerFailure(ctx, user, nowMs, g.listener);
    throw loginFailed();
  }
  // Adım iddiası atomik: aynı kodla eşzamanlı iki giriş ikisi de geçemez.
  const claim = await prisma.portalKullanici.updateMany({
    where: { id: user.id, aktif: true, OR: [{ totpSonAdim: null }, { totpSonAdim: { lt: totp.step } }] },
    data: { totpSonAdim: totp.step, basarisizGiris: 0, kilitBitis: null, sonGiris: new Date(nowMs) },
  });
  if (claim.count === 0) {
    await registerFailure(ctx, user, nowMs, g.listener);
    throw loginFailed();
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(nowMs + ctx.config.PORTAL_OTURUM_AZAMI_SAAT * 3_600_000);
  const row = await prisma.portalOturumu.create({
    data: { kullaniciId: user.id, belirtecOzeti: sessionTokenDigest(token), dinleyici: g.listener, sonKullanim: new Date(nowMs), bitis: expiresAt },
  });
  const session: PortalSession = { id: row.id, listener: g.listener, user: publicUser(user), actor: actorOf(user), expiresAt };
  await recordAudit({ event: "PORTAL_GIRIS", entity: "PortalKullanici", entityId: user.id, actor: session.actor, summary: { dinleyici: g.listener, oturumId: row.id } });
  return { token, session };
}

/** Çerezdeki belirteçten oturum: kapalı · süresi dolmuş · başka dinleyici · pasif/yanlış rol → null. */
export async function resolveSession(ctx: VendorContext, g: { listener: PortalListener; token: string | undefined; nowMs?: number }): Promise<PortalSession | null> {
  if (!g.token || !TOKEN_PATTERN.test(g.token)) return null;
  const nowMs = g.nowMs ?? Date.now();
  const row = await prisma.portalOturumu.findUnique({
    where: { belirtecOzeti: sessionTokenDigest(g.token) },
    include: { kullanici: { include: { bayi: true } } },
  });
  if (!row || row.kapanisZamani || row.dinleyici !== g.listener) return null;
  const idleLimit = row.sonKullanim.getTime() + ctx.config.PORTAL_OTURUM_BOSTA_DK * 60_000;
  if (row.bitis.getTime() <= nowMs || idleLimit <= nowMs) {
    await prisma.portalOturumu.updateMany({ where: { id: row.id, kapanisZamani: null }, data: { kapanisZamani: new Date(nowMs), kapanisNedeni: "SURE_DOLDU" } });
    return null;
  }
  const u = row.kullanici;
  if (!u.aktif || !roleAllowedOn(u.rol, g.listener) || (u.rol === "BAYI" && (!u.bayi || !u.bayi.aktif))) return null;
  if (nowMs - row.sonKullanim.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.portalOturumu.updateMany({ where: { id: row.id, kapanisZamani: null }, data: { sonKullanim: new Date(nowMs) } });
  }
  return { id: row.id, listener: g.listener, user: publicUser(u), actor: actorOf(u), expiresAt: row.bitis };
}

export async function logout(session: PortalSession): Promise<void> {
  const closed = await prisma.portalOturumu.updateMany({ where: { id: session.id, kapanisZamani: null }, data: { kapanisZamani: new Date(), kapanisNedeni: "CIKIS" } });
  if (closed.count > 0) await recordAudit({ event: "PORTAL_CIKIS", entity: "PortalKullanici", entityId: session.user.id, actor: session.actor, summary: { oturumId: session.id } });
}
