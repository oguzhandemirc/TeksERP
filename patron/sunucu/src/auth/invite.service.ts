// DAVET — hesap kimliksiz DOĞAR (durum DAVETLI); davetli kendi cihazında iki adımda etkinleşir: ① kabul
// (parola belirler → merkez KİMLİK DAVETLI doğar, TOTP sırrı BİR KEZ gösterilir) ② onay (ilk TOTP kodu → kimlik +
// hesap AKTİF, üyelik yazılır). Onaysız hesap giriş YAPAMAZ (DB CHECK: AKTİF kimlik ⇒ parola + TOTP; AKTİF hesap ⇒ kimlik).
// E-posta başka tesiste ETKİN bir kimliğe bağlıysa onay genel 409 ile reddedilir (kimliğin varlığı söylenmez).
// Davet belirteci düz saklanmaz (sha256), süreli ve tek kullanımlık (onayda düşer). İlk tesis
// yöneticisini satıcı CLI'si davet eder; sonrakileri tesis yöneticisi (kurtarma kodu YOK — kayıpta
// yönetici sıfırlar, yönetici yoksa satıcı CLI'si).
import { randomUUID } from "node:crypto";
import type { Identity } from "@prisma/client";
import type { Tx } from "../lib/db";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError } from "../lib/errors";
import { uniqueViolationOn } from "../lib/prisma-errors";
import { withCentral, withLookup, withTesis } from "../lib/tenant";
import type { InviteAccepted, InviteConfirmed, InviteInfo } from "../wire/api";
import type { CloudContext } from "../services/context";
import { assertPasswordStrength, hashPassword } from "./password";
import { newToken, tokenDigest, tokenTesis } from "./session.service";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

export function createInvite(tesisId: string, nowMs: number, validHours: number): { token: string; digest: string; expiresAt: Date } {
  const { token, digest } = newToken(tesisId);
  return { token, digest, expiresAt: new Date(nowMs + validHours * 3_600_000) };
}

class InviteClaimLost extends Error {}

/** Üyeliğin gösterdiği hesap kendi tesis DB'sinde hâlâ ETKİN (AKTIF · KILITLI) ve aynı kimliğe bağlı mı? Tesis DB'si yoksa (imha) değil. */
async function routeTargetActive(ctx: CloudContext, route: { identityId: string; tesisId: string; accountId: string }): Promise<boolean> {
  try {
    const a = await withTesis(ctx.app, { tesisId: route.tesisId }, (tx) => tx.account.findUnique({ where: { id: route.accountId }, select: { status: true, identityId: true } }));
    return (a?.status === "AKTIF" || a?.status === "KILITLI") && a.identityId === route.identityId;
  } catch (err) {
    if (err instanceof CloudError && err.status === 404) return false;
    throw err;
  }
}

/** Kimlik bu hesabın kabulüyle yeniden sırlanabilir mi: bu hesap DIŞINDA hiçbir etkin üyeliği yoksa. */
async function identityReclaimable(ctx: CloudContext, central: Tx, identity: Identity, accountId: string): Promise<boolean> {
  const routes = await central.loginRoute.findMany({ where: { identityId: identity.id, NOT: { accountId } }, select: { identityId: true, tesisId: true, accountId: true } });
  for (const r of routes) if (await routeTargetActive(ctx, r)) return false;
  return true;
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
      } else if (await identityReclaimable(ctx, central, existing, account.id)) {
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
      await central.loginRoute.deleteMany({ where: { OR: [{ accountId: account.id }, { identityId: identity.id, tesisId: account.tesisId }] } });
      await central.loginRoute.create({ data: { identityId: identity.id, tesisId: account.tesisId, accountId: account.id } });
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
