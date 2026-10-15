// KENDİ HESABINI SİLME (Google Play hesap silme politikası) — oturumdaki merkez kimlik ve BÜTÜN tesis üyelikleri MEVCUT
// arşiv yolundan kapanır: üyelik hesabı `archiveAccountTx` (PASİF + kapanış anı, oturumlar, cihazlar), kimlik
// `closeIdentityClaim` (PASİF + kapanış anı). Kişisel veri kapanıştan IDENTITY_PURGE_DAYS sonra bakımın mevcut silmesiyle
// gider — burada silme YOK. Onay: parola + güncel TOTP (`verifyOwnFactors`, parola değişimiyle aynı kapı). Kimliğin son
// AKTİF yöneticisi olduğu tesis varsa hiçbir şey değişmez: 409 SON_YONETICI (`details.tesisler`). Kilit sırası: merkez
// LOGIN_ROUTE (İLK ifade) → tesis başına ACCOUNT_ADMIN (her tesis kendi DB'sinde, kendi tx'inde). Tesisler ayrı DB olduğundan
// kilit altındaki yarış reddi önceki tesislerin arşivini geri almaz; bağsız kalan kimliği bakım tiki kapatır (yakınsar).
import { accountEngagedTo, type MembershipRoute } from "../auth/membership";
import { ipSummary, totpStepClaim, verifyOwnFactors, wrongFactors, type SessionContext } from "../auth/session.service";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError, stateConflict } from "../lib/errors";
import { withCentral, withTesis } from "../lib/tenant";
import type { AccountDeletion } from "../wire/api";
import { archiveAccountTx, isLastActiveAdmin } from "./account.service";
import type { CloudContext } from "./context";
import { closeIdentityClaim } from "./identity-purge";
import { IDENTITY_PURGE_DAYS } from "./maintenance";

const DAY_MS = 86_400_000;

/** İmha edilmiş tesis (404) üyelik değildir, atlanır; hazır olmayan tesis (503) FIRLAR — karar verilemiyorsa silme yapılmaz. */
async function inFacility<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CloudError && err.status === 404) return null;
    throw err;
  }
}

export const lastAdminOf = (tesisler: readonly { id: string; ad: string }[]): CloudError =>
  new CloudError(
    409,
    "SON_YONETICI",
    `Şu tesisin son aktif hesap yöneticisisiniz: ${tesisler.map((t) => t.ad || t.id).join(", ")}. Hesabınızı silmeden önce o tesiste başka bir kişiyi hesap yöneticisi yapın.`,
    { tesisler },
  );

/** Ön ölçüm (kilitsiz): kimliğin son aktif yöneticisi olduğu tesisler. Karar kilit altında `archiveAccountTx`te yinelenir. */
async function lastAdminFacilities(ctx: CloudContext, identityId: string, routes: readonly MembershipRoute[]) {
  const out: { id: string; ad: string }[] = [];
  for (const r of routes) {
    const hit = await inFacility(() =>
      withTesis(ctx.app, { tesisId: r.tesisId }, async (tx) => {
        const a = await tx.account.findUnique({ where: { id: r.accountId } });
        if (!a || !accountEngagedTo(a, identityId) || !(await isLastActiveAdmin(tx, a))) return null;
        const f = await tx.facility.findUnique({ where: { tesisId: r.tesisId }, select: { name: true } });
        return { id: r.tesisId, ad: f?.name ?? "" };
      }),
    );
    if (hit) out.push(hit);
  }
  return out;
}

export async function deleteOwnAccount(ctx: CloudContext, s: SessionContext, g: { password: string; totp: string; ip: string | null }): Promise<AccountDeletion> {
  const { identity, step, nowMs } = await verifyOwnFactors(ctx, s, g);
  const routes = await withCentral(ctx.app, {}, (tx) => tx.loginRoute.findMany({ where: { identityId: identity.id }, select: { tesisId: true, accountId: true }, orderBy: { tesisId: "asc" } }));
  const blocked = await lastAdminFacilities(ctx, identity.id, routes);
  if (blocked.length > 0) throw lastAdminOf(blocked);
  const closed: MembershipRoute[] = [];
  try {
    await withCentral(ctx.app, { lock: { name: "LOGIN_ROUTE", key: identity.emailDigest } }, async (central) => {
      // Adım iddiası aynı tx'te: sonraki bir ret tx'i geri alınca kod da yanmamış olur.
      if ((await central.identity.updateMany(totpStepClaim(identity.id, step))).count === 0) throw wrongFactors();
      const live = await central.loginRoute.findMany({ where: { identityId: identity.id }, select: { tesisId: true, accountId: true }, orderBy: { tesisId: "asc" } });
      for (const r of live) {
        const done = await inFacility(() =>
          withTesis(ctx.app, { tesisId: r.tesisId, lock: { name: "ACCOUNT_ADMIN", key: r.tesisId } }, async (tx) => {
            const a = await tx.account.findUnique({ where: { id: r.accountId } });
            if (!a || !accountEngagedTo(a, identity.id)) return false;
            await archiveAccountTx(tx, a, nowMs);
            return true;
          }),
        );
        if (done) closed.push(r);
      }
      if ((await closeIdentityClaim(ctx, central, identity.id, { nowMs, expected: { status: "AKTIF" } })) === 0) throw stateConflict("Hesap bu arada değişti; yeniden giriş yapıp tekrar deneyin");
    });
  } finally {
    // Ayak izi kapananı yazar (yarış reddinde de: o tesislerin arşivi geri alınmadı).
    for (const r of closed) {
      await recordAudit(ctx.app, { tesisId: r.tesisId, actor: accountActor(r.accountId), event: "HESAP_KENDINI_SILDI", entity: "Account", entityId: r.accountId, summary: { tesisSayisi: closed.length, ...ipSummary(g.ip) } });
    }
  }
  return { kapanis: new Date(nowMs).toISOString(), silinme: new Date(nowMs + IDENTITY_PURGE_DAYS * DAY_MS).toISOString(), tesisSayisi: closed.length };
}
