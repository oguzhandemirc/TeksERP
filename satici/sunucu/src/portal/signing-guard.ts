// İMZA PAROLASI KAPISI (D11) — kök ve bayi parolası portal formundan gelir ve tek başına lisans imzalar:
// tahmin denemesi kullanıcı başına sayılır. Ardışık IMZA_PAROLA_ESIGI hatada hesap IMZA_KILIT_DK dakika
// imza atamaz (girişten AYRI kilit — portalı okumaya devam eder); her başarısız deneme denetime satır yazar
// (parola hiçbir satıra girmez). Başarılı imza sayacı sıfırlar. Kilit, parola alt sürece GİTMEDEN denetlenir.
// İmza kapsamı (dinleyici) sayaçlardan ÖNCE: izinsiz yoldan gelen deneme sayaca da denetime de dokunmaz.
import { assertSigningScope, type SigningKeyKind } from "../keys/signing-scope";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "../services/context";

export type { SigningKeyKind };

export interface SigningActor {
  readonly userId: string;
  readonly actor: string;
}

async function registerFailure(ctx: VendorContext, who: SigningActor, kind: SigningKeyKind, nowMs: number): Promise<void> {
  const bumped = await prisma.portalKullanici.update({ where: { id: who.userId }, data: { imzaBasarisiz: { increment: 1 } }, select: { imzaBasarisiz: true } });
  await recordAudit({ event: "IMZA_PAROLASI_BASARISIZ", entity: "PortalKullanici", entityId: who.userId, actor: who.actor, summary: { anahtar: kind, ardisik: bumped.imzaBasarisiz } });
  if (bumped.imzaBasarisiz < ctx.config.IMZA_PAROLA_ESIGI) return;
  const until = new Date(nowMs + ctx.config.IMZA_KILIT_DK * 60_000);
  const locked = await prisma.portalKullanici.updateMany({
    where: { id: who.userId, imzaBasarisiz: { gte: ctx.config.IMZA_PAROLA_ESIGI } },
    data: { imzaKilitBitis: until, imzaBasarisiz: 0 },
  });
  if (locked.count > 0) {
    await recordAudit({ event: "IMZA_PAROLASI_KILITLENDI", entity: "PortalKullanici", entityId: who.userId, actor: who.actor, summary: { anahtar: kind, kilitBitis: until.toISOString() } });
  }
}

// Aynı kullanıcının denemeleri SIRAYLA (tek süreç): eşzamanlı N deneme kilit denetimini birlikte geçip
// eşiği aşan sayıda parola tahmini yaptıramasın — sayaç ve kilit her denemeden önce taze okunur.
const userQueues = new Map<string, Promise<unknown>>();

async function serializedPerUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = userQueues.get(userId) ?? Promise.resolve();
  const current = previous.then(work, work);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  userQueues.set(userId, settled);
  try {
    return await current;
  } finally {
    if (userQueues.get(userId) === settled) userQueues.delete(userId);
  }
}

/** `sign` kök/bayi parolasını imza alt sürecine götüren iştir; yanlış parola `IMZA_PAROLASI_HATALI` fırlatır. */
export function withSigningPasswordGuard<T>(
  ctx: VendorContext,
  g: SigningActor & { readonly kind: SigningKeyKind; readonly nowMs?: number },
  sign: () => Promise<T>,
): Promise<T> {
  try {
    assertSigningScope(g.kind);
  } catch (err) {
    return Promise.reject(err);
  }
  const startedAt = Date.now();
  // Sırada beklenen süre de "şimdi"ye eklenir: kilit denetimi sıra gelince yapılır.
  return serializedPerUser(g.userId, () => guardedSign(ctx, g, (g.nowMs ?? startedAt) + (Date.now() - startedAt), sign));
}

async function guardedSign<T>(ctx: VendorContext, g: SigningActor & { readonly kind: SigningKeyKind }, nowMs: number, sign: () => Promise<T>): Promise<T> {
  const user = await prisma.portalKullanici.findUnique({ where: { id: g.userId }, select: { imzaKilitBitis: true, imzaBasarisiz: true } });
  if (!user) throw new VendorError(403, "YETKISIZ", "Bu işlem için yetkiniz yok");
  if (user.imzaKilitBitis && user.imzaKilitBitis.getTime() > nowMs) {
    const minutes = Math.ceil((user.imzaKilitBitis.getTime() - nowMs) / 60_000);
    throw new VendorError(429, "IMZA_PAROLASI_KILITLI", `Çok sayıda hatalı imza parolası: imza ${minutes} dakika kilitli`);
  }
  let result: T;
  try {
    result = await sign();
  } catch (err) {
    if (err instanceof VendorError && err.code === "IMZA_PAROLASI_HATALI") await registerFailure(ctx, g, g.kind, nowMs);
    throw err;
  }
  if (user.imzaBasarisiz > 0) await prisma.portalKullanici.updateMany({ where: { id: g.userId, imzaBasarisiz: { gt: 0 } }, data: { imzaBasarisiz: 0 } });
  return result;
}
