// MERKEZ KİMLİĞİNİN YAŞAM SONU (tek kimlik, çok tesis) — bakım tikinden (`maintenance.ts` `purgeCentralIdentities`).
// Kimlik verisi defter değildir; satır KALIR (tombstone), yalnız sır + e-posta özeti silinir; üyelik satırlarının
// silmesi beyanlı yerde (`auth/membership.ts` `dropMemberships`, `PRUNED_TABLES.login_routes`).
import { createHash } from "node:crypto";
import { ENGAGED_ACCOUNT_STATUSES, accountEngagedTo, dropMemberships, identityEngagedOutside } from "../auth/membership";
import { CloudError } from "../lib/errors";
import { withCentral, withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";

/** Silinen kimliğin e-posta özeti: anlamsız ve benzersiz (biçim CHECK'i hex 64); e-posta yeni kimliğe serbest kalır. */
export const tombstoneDigest = (identityId: string): string => createHash("sha256").update(`silinmis-kimlik:${identityId}`, "utf8").digest("hex");

/** Toplu ön ölçüm: üyeliği bağlı (AKTİF · KİLİTLİ · satıcı sıfırlamasıyla DAVETLİ) kimlikler; okunamayan tesis bağlı sayılır (kapatmaz). */
async function engagedIdentities(ctx: CloudContext, routes: readonly { identityId: string; tesisId: string; accountId: string }[]): Promise<Set<string>> {
  const out = new Set<string>();
  const byTesis = new Map<string, typeof routes>();
  for (const r of routes) byTesis.set(r.tesisId, [...(byTesis.get(r.tesisId) ?? []), r]);
  for (const [tesisId, rs] of byTesis) {
    try {
      const rows = await withTesis(ctx.app, { tesisId }, (tx) =>
        tx.account.findMany({ where: { tesisId, id: { in: rs.map((r) => r.accountId) }, status: { in: [...ENGAGED_ACCOUNT_STATUSES] } }, select: { id: true, identityId: true, status: true } }),
      );
      for (const r of rs) if (rows.some((a) => a.id === r.accountId && accountEngagedTo(a, r.identityId))) out.add(r.identityId);
    } catch (err) {
      if (err instanceof CloudError && err.status === 404) continue;
      for (const r of rs) out.add(r.identityId);
    }
  }
  return out;
}

/**
 * Merkez kimliği: bağlı üyeliği kalmayan AKTİF kimlik (ve davet süresi geçmiş, onaylanmamış DAVETLİ kimlik) PASİF'e
 * çekilir (kapanış anı aynı claim'de, CHECK); kapanıştan `purgeDays` (maintenance.ts `IDENTITY_PURGE_DAYS`) sonra tombstone: parola + TOTP NULL, e-posta
 * özeti anlamsız benzersiz değere, üyelik satırları silinir; satır KALIR. Karar her kimlikte LOGIN_ROUTE kilidi (İLK
 * ifade) altında yeniden ölçülür — bağla/onay aynı kilitle üyelik yazar, kapanışla yarışamaz.
 */
export async function closeAndPurgeIdentities(ctx: CloudContext, nowMs: number, purgeDays: number): Promise<{ closed: number; purged: number }> {
  const inviteCutoff = new Date(nowMs - ctx.config.DAVET_GECERLILIK_SAAT * 3_600_000);
  const open = await withCentral(ctx.app, {}, (tx) =>
    tx.identity.findMany({ where: { OR: [{ status: "AKTIF" }, { status: "DAVETLI", updatedAt: { lt: inviteCutoff } }] }, select: { id: true, emailDigest: true } }),
  );
  const routes = open.length === 0 ? [] : await withCentral(ctx.app, {}, (tx) => tx.loginRoute.findMany({ where: { identityId: { in: open.map((i) => i.id) } }, select: { identityId: true, tesisId: true, accountId: true } }));
  const engaged = await engagedIdentities(ctx, routes);
  let closed = 0;
  for (const i of open.filter((x) => !engaged.has(x.id))) {
    closed += await withCentral(ctx.app, { lock: { name: "LOGIN_ROUTE", key: i.emailDigest } }, async (central) => {
      if (await identityEngagedOutside(ctx, i.id, { central })) return 0;
      const r = await central.identity.updateMany({
        where: { id: i.id, OR: [{ status: "AKTIF" }, { status: "DAVETLI", updatedAt: { lt: inviteCutoff } }] },
        data: { status: "PASIF", closedAt: new Date(nowMs) },
      });
      return r.count;
    });
  }
  const cutoff = new Date(nowMs - purgeDays * 86_400_000);
  const due = { status: "PASIF" as const, identityPurgedAt: null, closedAt: { lte: cutoff } };
  const purgeable = await withCentral(ctx.app, {}, (tx) => tx.identity.findMany({ where: due, select: { id: true, emailDigest: true } }));
  let purged = 0;
  for (const i of purgeable) {
    purged += await withCentral(ctx.app, { lock: { name: "LOGIN_ROUTE", key: i.emailDigest } }, async (central) => {
      const r = await central.identity.updateMany({
        where: { ...due, id: i.id },
        data: { passwordHash: null, totpSecretSealed: null, totpLastStep: null, emailDigest: tombstoneDigest(i.id), identityPurgedAt: new Date(nowMs) },
      });
      if (r.count === 0) return 0;
      await dropMemberships(central, i.id);
      return 1;
    });
  }
  return { closed, purged };
}
