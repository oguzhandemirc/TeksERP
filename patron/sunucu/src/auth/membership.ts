// ÜYELİK — tek bulut kimliği (merkez `identities`: e-posta özeti + parola + TOTP) birden çok tesise üyelikle
// (`login_routes`: kimlik → tesis + hesap) erişir. Üyeliğin ETKİNLİĞİ tesis DB'sinde sorulur: hesap AKTİF ve aynı
// kimliğe bağlı olmalı (dizin bayatlayabilir; tesis DB'si tek doğruluk kaynağıdır). KİLİTLİ üyelik listede yoktur.
// Tesis DB'si yoksa (imha) ya da hazır değilse üyelik görünmez — bir tesisin arızası öbürlerine girişi kesmez.
import type { Identity, SessionCloseReason } from "@prisma/client";
import { CloudError } from "../lib/errors";
import { withCentral, withTesis } from "../lib/tenant";
import type { CloudContext } from "../services/context";
import { loadServiceFacts, serviceState, type ServicePhase } from "../services/service-lifecycle";

export interface MembershipRoute {
  readonly tesisId: string;
  readonly accountId: string;
}

export interface ActiveMembership extends MembershipRoute {
  readonly ad: string;
  readonly hizmet: ServicePhase;
}

/** Normalleşmiş e-postanın kimliği (merkez; özet anahtarlı); yoksa null. */
export async function identityByEmail(ctx: CloudContext, normalizedEmail: string): Promise<Identity | null> {
  const emailDigest = ctx.app.key.emailDigest(normalizedEmail);
  return withCentral(ctx.app, {}, (tx) => tx.identity.findUnique({ where: { emailDigest } }));
}

/** Kimliğin bütün üyelik satırları (etkinlik sorulmadan). */
export async function membershipRoutes(ctx: CloudContext, identityId: string): Promise<MembershipRoute[]> {
  return withCentral(ctx.app, {}, (tx) => tx.loginRoute.findMany({ where: { identityId }, select: { tesisId: true, accountId: true }, orderBy: { tesisId: "asc" } }));
}

/** Kimliğin o tesisteki üyelik satırı (tesis başına en çok bir). */
export async function membershipRoute(ctx: CloudContext, identityId: string, tesisId: string): Promise<MembershipRoute | null> {
  return withCentral(ctx.app, {}, (tx) => tx.loginRoute.findUnique({ where: { identityId_tesisId: { identityId, tesisId } }, select: { tesisId: true, accountId: true } }));
}

const unreachable = (err: unknown): boolean => err instanceof CloudError && (err.status === 404 || err.status === 503);

/** Üyelik tesisinde etkin mi: hesap AKTİF ∧ aynı kimlik; tesis adı ve hizmet aşamasıyla. Değilse/ulaşılamıyorsa null. */
export async function activeMembershipIn(ctx: CloudContext, identityId: string, route: MembershipRoute, nowMs: number): Promise<ActiveMembership | null> {
  try {
    return await withTesis(ctx.app, { tesisId: route.tesisId }, async (tx) => {
      const a = await tx.account.findUnique({ where: { id: route.accountId }, select: { status: true, identityId: true } });
      if (!a || a.status !== "AKTIF" || a.identityId !== identityId) return null;
      const facts = await loadServiceFacts(tx, route.tesisId);
      if (!facts) return null;
      const f = await tx.facility.findUnique({ where: { tesisId: route.tesisId }, select: { name: true } });
      return { tesisId: route.tesisId, accountId: route.accountId, ad: f?.name ?? "", hizmet: serviceState(facts, nowMs).phase };
    });
  } catch (err) {
    if (unreachable(err)) return null;
    throw err;
  }
}

/** Kimliğin AKTİF üyelikleri, tesis adına göre sıralı (eşitlikte tesis kimliği). */
export async function activeMemberships(ctx: CloudContext, identityId: string, nowMs: number): Promise<ActiveMembership[]> {
  const out: ActiveMembership[] = [];
  for (const r of await membershipRoutes(ctx, identityId)) {
    const m = await activeMembershipIn(ctx, identityId, r, nowMs);
    if (m) out.push(m);
  }
  return out.sort((x, y) => x.ad.localeCompare(y.ad, "tr") || x.tesisId.localeCompare(y.tesisId));
}

/** Girişte etkin üyelik yoksa ayak izinin yeri: kimliğin KİLİTLİ üyeliği (yalnız ret kaydı içindir; yanıtı değiştirmez). */
export async function lockedMembership(ctx: CloudContext, identityId: string): Promise<MembershipRoute | null> {
  for (const r of await membershipRoutes(ctx, identityId)) {
    try {
      const a = await withTesis(ctx.app, { tesisId: r.tesisId }, (tx) => tx.account.findUnique({ where: { id: r.accountId }, select: { status: true, identityId: true } }));
      if (a?.status === "KILITLI" && a.identityId === identityId) return r;
    } catch (err) {
      if (!unreachable(err)) throw err;
    }
  }
  return null;
}

/** Kimliğin bütün üyeliklerindeki açık oturumları kapatır (`exceptSessionId` hariç); tesis başına kapanan sayı. */
export async function closeIdentitySessions(
  ctx: CloudContext,
  identityId: string,
  g: { readonly nowMs: number; readonly reason: SessionCloseReason; readonly exceptSessionId?: string },
): Promise<{ tesisId: string; accountId: string; count: number }[]> {
  const out: { tesisId: string; accountId: string; count: number }[] = [];
  for (const r of await membershipRoutes(ctx, identityId)) {
    try {
      const closed = await withTesis(ctx.app, { tesisId: r.tesisId }, (tx) =>
        tx.session.updateMany({
          where: { accountId: r.accountId, closedAt: null, ...(g.exceptSessionId ? { id: { not: g.exceptSessionId } } : {}) },
          data: { closedAt: new Date(g.nowMs), closeReason: g.reason },
        }),
      );
      out.push({ tesisId: r.tesisId, accountId: r.accountId, count: closed.count });
    } catch (err) {
      if (!unreachable(err)) throw err;
    }
  }
  return out;
}
