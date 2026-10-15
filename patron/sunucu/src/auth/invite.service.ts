// DAVET — hesap kimliksiz DOĞAR (durum DAVETLI); davetli kendi cihazında etkinleşir. İki yol:
//   · Yeni hesap: ① kabul (parola belirler → merkez KİMLİK DAVETLI doğar, TOTP sırrı BİR KEZ gösterilir) ② onay (ilk
//     TOTP kodu → kimlik + hesap AKTİF, üyelik yazılır). E-posta başka tesiste ETKİN bir kimliğe bağlıysa onay genel
//     409 ile reddedilir (kimliğin varlığı söylenmez).
//   · Mevcut hesabımla bağlan (`linkInvite`): e-posta + parola + TOTP girişle AYNI doğrulamadan geçer; her ret girişle
//     AYNI 401'dir (davet yok/süresi geçmiş, e-posta uyuşmazlığı, kimlik yok, yanlış faktör ayırt edilmez).
// Onaysız hesap giriş YAPAMAZ (DB CHECK: AKTİF kimlik ⇒ parola + TOTP; AKTİF hesap ⇒ kimlik). Davet belirteci düz
// saklanmaz (sha256), süreli ve tek kullanımlık. İlk tesis yöneticisini satıcı CLI'si davet eder; sonrakileri tesis
// yöneticisi (kurtarma kodu YOK — kayıpta yönetici sıfırlar, paylaşımlı kimlikte satıcı CLI'si).
import { randomUUID } from "node:crypto";
import type { Identity } from "@prisma/client";
import type { Tx } from "../lib/db";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError } from "../lib/errors";
import { uniqueViolationOn } from "../lib/prisma-errors";
import { withCentral, withLookup, withTesis } from "../lib/tenant";
import type { InviteAccepted, InviteConfirmed, InviteInfo } from "../wire/api";
import type { CloudContext } from "../services/context";
import { loginThrottleFor } from "./login-throttle";
import { bindMembership, identityByEmail, identityEngagedOutside } from "./membership";
import { assertPasswordStrength, burnPasswordCheck, hashPassword, verifyPassword } from "./password";
import { failAfterFloor, ipSummary, newToken, normalizeEmail, tokenDigest, tokenTesis } from "./session.service";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export function createInvite(tesisId: string, nowMs: number, validHours: number): { token: string; digest: string; expiresAt: Date } {
  const { token, digest } = newToken(tesisId);
  return { token, digest, expiresAt: new Date(nowMs + validHours * 3_600_000) };
}

class InviteClaimLost extends Error {}

/**
 * Kimlik bu hesabın kabulüyle yeniden sırlanabilir mi: (a) bu hesap DIŞINDA bağlı üyeliği yoksa, ya da (b) satıcı kimlik
 * sıfırlamasıyla bu hesap belirlendiyse (kimlik DAVETLİ, hesap kimliğe bağlı ve üyelik satırı var — satır ancak onayla doğar).
 */
async function identityReclaimable(ctx: CloudContext, central: Tx, identity: Identity, account: { id: string; identityId: string | null }): Promise<boolean> {
  if (identity.status === "DAVETLI" && account.identityId === identity.id) {
    if (await central.loginRoute.findFirst({ where: { identityId: identity.id, accountId: account.id }, select: { id: true } })) return true;
  }
  return !(await identityEngagedOutside(ctx, identity.id, { exceptAccountId: account.id, central }));
}

const invalidInvite = (): CloudError => new CloudError(404, "DAVET_GECERSIZ", "Davet bağlantısı geçersiz ya da süresi dolmuş");

async function findInvited(ctx: CloudContext, token: string, nowMs: number) {
  const tesisId = tokenTesis(token);
  if (!tesisId) throw invalidInvite();
  const digest = tokenDigest(token);
  const account = await withLookup(ctx.app, { kind: "davet", value: digest, tesisId }, (tx) => tx.account.findUnique({ where: { inviteTokenHash: digest } }));
  if (!account || account.tesisId !== tesisId || account.status !== "DAVETLI" || !account.inviteExpiresAt || account.inviteExpiresAt.getTime() <= nowMs) throw invalidInvite();
  return { account, digest };
}

export async function inspectInvite(ctx: CloudContext, token: string): Promise<InviteInfo> {
  const { account } = await findInvited(ctx, token, ctx.now());
  const facility = await withTesis(ctx.app, { tesisId: account.tesisId }, (tx) => tx.facility.findUnique({ where: { tesisId: account.tesisId } }));
  return {
    eposta: account.email,
    ad: account.name,
    tesisAd: facility?.name ?? null,
    bitis: account.inviteExpiresAt!.toISOString(),
    totpKurulumuBekliyor: account.identityId !== null,
  };
}

/**
 * ① Kabul: kimlik DAVETLI doğar (ya da bu hesap dışında etkin üyeliği olmayan kimlik yeniden sırlanır); TOTP sırrı
 * YALNIZ bu yanıtta döner (tekrar kabul yeni sır üretir). Kimlik başka tesiste etkinse sırrına DOKUNULMAZ: hesap ona
 * bağlanır, onay genel 409 verir (yanıt şekli aynı — varlık söylenmez). Kilit sırası: merkez LOGIN_ROUTE → tesis ACCOUNT_ADMIN.
 */
export async function acceptInvite(ctx: CloudContext, g: { token: string; password: string }): Promise<InviteAccepted> {
  assertPasswordStrength(g.password);
  const nowMs = ctx.now();
  const { account, digest } = await findInvited(ctx, g.token, nowMs);
  const passwordHash = await hashPassword(g.password);
  const secret = generateTotpSecret();
  const emailDigest = ctx.app.key.emailDigest(account.email);
  try {
    await withCentral(ctx.app, { lock: { name: "LOGIN_ROUTE", key: emailDigest } }, async (central) => {
      const existing = await central.identity.findUnique({ where: { emailDigest } });
      let identityId = existing?.id ?? randomUUID();
      if (!existing) {
        await central.identity.create({ data: { id: identityId, emailDigest, passwordHash, totpSecretSealed: ctx.secrets.seal(secret, identityId), status: "DAVETLI" } });
      } else if (await identityReclaimable(ctx, central, existing, account)) {
        const r = await central.identity.updateMany({
          where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
          data: { status: "DAVETLI", passwordHash, totpSecretSealed: ctx.secrets.seal(secret, existing.id), totpLastStep: null, closedAt: null, identityPurgedAt: null },
        });
        if (r.count === 0) throw new InviteClaimLost();
      } else identityId = existing.id;
      const claimed = await withTesis(ctx.app, { tesisId: account.tesisId, lock: { name: "ACCOUNT_ADMIN", key: account.tesisId } }, (tx) =>
        tx.account.updateMany({ where: { id: account.id, status: "DAVETLI", inviteTokenHash: digest, inviteExpiresAt: { gt: new Date(nowMs) } }, data: { identityId } }),
      );
      if (claimed.count === 0) throw new InviteClaimLost();
    });
  } catch (err) {
    if (err instanceof InviteClaimLost) throw invalidInvite();
    throw err;
  }
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "DAVET_KABUL", entity: "Account", entityId: account.id });
  return { eposta: account.email, totpSirri: secret, otpauth: otpauthUri(account.email, secret) };
}

/** ② Onay: ilk TOTP kodu doğrulanır → kimlik + hesap AKTİF, üyelik yazılır; davet belirteci düşer (tek kullanımlık). */
export async function confirmInvite(ctx: CloudContext, g: { token: string; totp: string }): Promise<InviteConfirmed> {
  const nowMs = ctx.now();
  const { account, digest } = await findInvited(ctx, g.token, nowMs);
  const identityId = account.identityId;
  const identity = identityId ? await withCentral(ctx.app, {}, (tx) => tx.identity.findUnique({ where: { id: identityId } })) : null;
  if (!identity) throw new CloudError(409, "DURUM_CAKISMASI", "Önce daveti kabul edip parola belirleyin");
  const notActivated = async (): Promise<never> => {
    // E-posta başka bir ETKİN kimlikte: hangi tesiste olduğu (ve var olduğu) söylenmez, ayak izi sebepsiz.
    await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "DAVET_ETKINLESTIRILEMEDI", entity: "Account", entityId: account.id });
    throw new CloudError(409, "DAVET_ETKINLESTIRILEMEDI", "Davet etkinleştirilemedi; tesis yöneticinize başvurun (farklı bir e-posta adresiyle yeniden davet gerekebilir)");
  };
  if (identity.status !== "DAVETLI" || !identity.totpSecretSealed) return notActivated();
  const secret = ctx.secrets.open(identity.totpSecretSealed, identity.id);
  const totp = secret ? verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: null }) : null;
  if (!totp?.ok) throw new CloudError(400, "GIRIS_BASARISIZ", "Doğrulama kodu hatalı; kimlik doğrulayıcı uygulamadaki güncel kodu girin");
  try {
    // Merkez (kimlik + üyelik) önce, tesis claim'i İÇİNDE: claim tutmazsa merkez tx'i geri alınır, üyelik kalmaz.
    await withCentral(ctx.app, { lock: { name: "LOGIN_ROUTE", key: identity.emailDigest } }, async (central) => {
      const ir = await central.identity.updateMany({ where: { id: identity.id, status: "DAVETLI", totpSecretSealed: identity.totpSecretSealed }, data: { status: "AKTIF", totpLastStep: totp.step } });
      if (ir.count === 0) throw new InviteClaimLost();
      // Bu hesabın ya da bu kimliğin bu tesisteki bayat üyeliği (tesis içi e-posta tekilliği: o hesap PASİF) devredilir.
      await bindMembership(central, { identityId: identity.id, tesisId: account.tesisId, accountId: account.id });
      const r = await withTesis(ctx.app, { tesisId: account.tesisId, lock: { name: "ACCOUNT_ADMIN", key: account.tesisId } }, (tx) =>
        tx.account.updateMany({ where: { id: account.id, status: "DAVETLI", inviteTokenHash: digest, identityId: identity.id }, data: { status: "AKTIF", inviteTokenHash: null, inviteExpiresAt: null } }),
      );
      if (r.count === 0) throw new InviteClaimLost();
    });
  } catch (err) {
    if (err instanceof InviteClaimLost) throw invalidInvite();
    if (!uniqueViolationOn(err, "email_etkin")) throw err;
    return notActivated();
  }
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "HESAP_ETKINLESTI", entity: "Account", entityId: account.id });
  return { eposta: account.email, durum: "AKTIF" as const };
}

/**
 * "Mevcut hesabımla bağlan": davetin e-postası verilen e-postayla eşleşir, kimlik AKTİF ve parola + TOTP doğrudur ⇒
 * hesap DAVETLI → AKTİF bu kimliğe bağlanır, üyelik yazılır; davet düşer. Girişle AYNI kurallar: tek scrypt işi, kimlik +
 * kaynak kısması, TOTP adımı merkezde atomik claim, her ret aynı 401 + süre tabanı. Ret ayak izi tek tiptir (sebepsiz):
 * davetin tesis yöneticisi denetimden kimliğin varlığını okuyamaz. Kilit sırası: merkez LOGIN_ROUTE → tesis ACCOUNT_ADMIN.
 */
export async function linkInvite(ctx: CloudContext, g: { token: string; email: string; password: string; totp: string; ip: string | null }): Promise<InviteConfirmed> {
  const startedMs = Date.now();
  const nowMs = ctx.now();
  let invited: Awaited<ReturnType<typeof findInvited>> | null = null;
  try {
    invited = await findInvited(ctx, g.token, nowMs);
  } catch (err) {
    if (!(err instanceof CloudError && err.status === 404)) throw err;
  }
  const account = invited?.account ?? null;
  const fail = async (): Promise<never> => {
    if (account) await recordAudit(ctx.app, { tesisId: account.tesisId, actor: "giris", event: "DAVET_BAGLAMA_REDDEDILDI", entity: "Account", entityId: account.id, summary: ipSummary(g.ip) });
    return failAfterFloor(startedMs);
  };
  const email = normalizeEmail(g.email);
  const found = account && email === account.email ? await identityByEmail(ctx, email) : null;
  const identity = found?.status === "AKTIF" && found.passwordHash && found.totpSecretSealed ? { ...found, passwordHash: found.passwordHash, totpSecretSealed: found.totpSecretSealed } : null;
  if (!account || !invited || !identity) {
    await burnPasswordCheck(g.password);
    return fail();
  }
  const throttle = loginThrottleFor(ctx);
  const sourceLocked = throttle.isLocked(identity.id, g.ip, nowMs);
  const passwordOk = await verifyPassword(g.password, identity.passwordHash);
  if (sourceLocked) return fail();
  const secret = ctx.secrets.open(identity.totpSecretSealed, identity.id);
  const totp = secret ? verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: identity.totpLastStep }) : null;
  const claimed =
    passwordOk && totp?.ok
      ? await withCentral(ctx.app, {}, (tx) => tx.identity.updateMany({ where: { id: identity.id, status: "AKTIF", OR: [{ totpLastStep: null }, { totpLastStep: { lt: totp.step } }] }, data: { totpLastStep: totp.step } }))
      : { count: 0 };
  if (claimed.count === 0) {
    throttle.registerFailure(identity.id, g.ip, nowMs);
    return fail();
  }
  const digest = invited.digest;
  try {
    await withCentral(ctx.app, { lock: { name: "LOGIN_ROUTE", key: identity.emailDigest } }, async (central) => {
      // Kilit altında yeniden: bakım kimliği bu arada kapatmış olabilir (üyeliği kalmayan kimlik PASİF'e çekilir).
      const live = await central.identity.findUnique({ where: { id: identity.id }, select: { status: true } });
      if (live?.status !== "AKTIF") throw new InviteClaimLost();
      await bindMembership(central, { identityId: identity.id, tesisId: account.tesisId, accountId: account.id });
      const r = await withTesis(ctx.app, { tesisId: account.tesisId, lock: { name: "ACCOUNT_ADMIN", key: account.tesisId } }, (tx) =>
        tx.account.updateMany({
          where: { id: account.id, status: "DAVETLI", inviteTokenHash: digest, inviteExpiresAt: { gt: new Date(nowMs) } },
          data: { status: "AKTIF", identityId: identity.id, inviteTokenHash: null, inviteExpiresAt: null },
        }),
      );
      if (r.count === 0) throw new InviteClaimLost();
    });
  } catch (err) {
    if (err instanceof InviteClaimLost || uniqueViolationOn(err, "email_etkin")) return fail();
    throw err;
  }
  throttle.clear(identity.id, g.ip);
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "DAVET_BAGLANDI", entity: "Account", entityId: account.id, summary: ipSummary(g.ip) });
  return { eposta: account.email, durum: "AKTIF" as const };
}
