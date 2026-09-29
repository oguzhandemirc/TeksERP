// DAVET — hesap parolasız ve TOTP'siz DOĞAR (durum DAVETLI); davetli kendi cihazında iki adımda
// etkinleşir: ① kabul (parola belirler → TOTP sırrı BİR KEZ gösterilir) ② onay (ilk TOTP kodu →
// AKTİF). Onaysız hesap giriş YAPAMAZ (DB CHECK: AKTİF ⇒ parola + TOTP sırrı + son adım dolu).
// Davet belirteci düz saklanmaz (sha256), süreli ve tek kullanımlık (onayda düşer). İlk tesis
// yöneticisini satıcı CLI'si davet eder; sonrakileri tesis yöneticisi (kurtarma kodu YOK — kayıpta
// yönetici sıfırlar, yönetici yoksa satıcı CLI'si).
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError } from "../lib/errors";
import { withLookup, withTesis } from "../lib/tenant";
import type { InviteAccepted, InviteConfirmed, InviteInfo } from "../wire/api";
import type { CloudContext } from "../services/context";
import { assertPasswordStrength, hashPassword } from "./password";
import { newToken, tokenDigest } from "./session.service";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

const INVITE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createInvite(nowMs: number, validHours: number): { token: string; digest: string; expiresAt: Date } {
  const { token, digest } = newToken();
  return { token, digest, expiresAt: new Date(nowMs + validHours * 3_600_000) };
}

const invalidInvite = (): CloudError => new CloudError(404, "DAVET_GECERSIZ", "Davet bağlantısı geçersiz ya da süresi dolmuş");

async function findInvited(ctx: CloudContext, token: string, nowMs: number) {
  if (!INVITE_PATTERN.test(token)) throw invalidInvite();
  const digest = tokenDigest(token);
  const account = await withLookup(ctx.app, { kind: "davet", value: digest }, (tx) => tx.account.findUnique({ where: { inviteTokenHash: digest } }));
  if (!account || account.status !== "DAVETLI" || !account.inviteExpiresAt || account.inviteExpiresAt.getTime() <= nowMs) throw invalidInvite();
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
    totpKurulumuBekliyor: account.totpSecretSealed !== null,
  };
}

/** ① Kabul: parola belirlenir, TOTP sırrı üretilir ve YALNIZ bu yanıtta döner (tekrar kabul yeni sır üretir). */
export async function acceptInvite(ctx: CloudContext, g: { token: string; password: string }): Promise<InviteAccepted> {
  assertPasswordStrength(g.password);
  const nowMs = ctx.now();
  const { account, digest } = await findInvited(ctx, g.token, nowMs);
  const passwordHash = await hashPassword(g.password);
  const secret = generateTotpSecret();
  const sealed = ctx.secrets.seal(secret, account.id);
  const claimed = await withTesis(ctx.app, { tesisId: account.tesisId, lock: { name: "ACCOUNT_ADMIN", key: account.tesisId } }, (tx) =>
    tx.account.updateMany({
      where: { id: account.id, status: "DAVETLI", inviteTokenHash: digest, inviteExpiresAt: { gt: new Date(nowMs) } },
      data: { passwordHash, totpSecretSealed: sealed, totpLastStep: null },
    }),
  );
  if (claimed.count === 0) throw invalidInvite();
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "DAVET_KABUL", entity: "Account", entityId: account.id });
  return { eposta: account.email, totpSirri: secret, otpauth: otpauthUri(account.email, secret) };
}

/** ② Onay: ilk TOTP kodu doğrulanır → AKTİF; davet belirteci düşer (tek kullanımlık). */
export async function confirmInvite(ctx: CloudContext, g: { token: string; totp: string }): Promise<InviteConfirmed> {
  const nowMs = ctx.now();
  const { account, digest } = await findInvited(ctx, g.token, nowMs);
  if (!account.totpSecretSealed || !account.passwordHash) {
    throw new CloudError(409, "DURUM_CAKISMASI", "Önce daveti kabul edip parola belirleyin");
  }
  const secret = ctx.secrets.open(account.totpSecretSealed, account.id);
  const totp = secret ? verifyTotp(secret, g.totp, { atMs: nowMs, lastUsedStep: null }) : null;
  if (!totp?.ok) throw new CloudError(400, "GIRIS_BASARISIZ", "Doğrulama kodu hatalı; kimlik doğrulayıcı uygulamadaki güncel kodu girin");
  const claimed = await withTesis(ctx.app, { tesisId: account.tesisId, lock: { name: "ACCOUNT_ADMIN", key: account.tesisId } }, (tx) =>
    tx.account.updateMany({
      where: { id: account.id, status: "DAVETLI", inviteTokenHash: digest, totpSecretSealed: account.totpSecretSealed },
      data: { status: "AKTIF", inviteTokenHash: null, inviteExpiresAt: null, totpLastStep: totp.step, failedLogins: 0, lockedUntil: null },
    }),
  );
  if (claimed.count === 0) throw invalidInvite();
  await recordAudit(ctx.app, { tesisId: account.tesisId, actor: accountActor(account.id), event: "HESAP_ETKINLESTI", entity: "Account", entityId: account.id });
  return { eposta: account.email, durum: "AKTIF" as const };
}
