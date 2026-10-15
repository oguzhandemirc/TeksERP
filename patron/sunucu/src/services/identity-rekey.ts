// KİMLİK E-POSTA ÖZETİ YENİLEME (PATRON-TESIS-DB §6) — tesis DB anahtarı değişince merkez `identities.email_digest`
// değerleri bayatlar (giriş yeni anahtarla arar, bulamaz). Merkez düz e-posta tutmaz: özet üyelik satırından → tesis
// DB'sindeki BAĞLI hesabın e-postasından → geçerli anahtarla yeniden hesaplanır. Bağsız kimlik bayat kalır (bakım
// kapatır/siler). Parmak izi kaydı yok: "anahtar değişti" = bağlı kimliğin saklı özeti ≠ hesaplanan özet; aynı ölçüm
// ikinci koşumu no-op yapar. Çıktı/denetim e-posta ya da özet taşımaz.
import { Prisma } from "@prisma/client";
import type { FacilityDbKey } from "../auth/facility-db-key";
import { accountEngagedTo } from "../auth/membership";
import { normalizeEmail } from "../auth/session.service";
import { recordAudit } from "../lib/audit";
import type { Tx } from "../lib/db";
import { CloudError } from "../lib/errors";
import { withCentral, withTesis } from "../lib/tenant";
import type { TesisDbRouter } from "../lib/tesis-db";

export const REKEY_ACTOR = "satici-cli";
export const REKEY_AUDIT_EVENT = "KIMLIK_OZETI_YENILENDI";

export type RekeyConflict = "OZET_BASKA_KIMLIKTE" | "OZET_CIFT" | "EPOSTA_TUTARSIZ";
export type RekeyStatus = "yenilenecek" | "guncel" | "bagsiz" | "okunamadi" | "cakisma";

export interface RekeyItem {
  readonly identityId: string;
  readonly status: RekeyStatus;
  readonly conflict?: RekeyConflict;
  /** Bağlı üyelik sayısı (yalnız sayı basılır). */
  readonly linked: number;
  /** Bellekte kalır, BASILMAZ: uygula adımının kilit anahtarı ve beklenen değeri. */
  readonly newDigest?: string;
  readonly accounts?: readonly { tesisId: string; accountId: string }[];
}

export interface RekeyPlan {
  readonly items: readonly RekeyItem[];
  readonly counts: Readonly<Record<RekeyStatus, number>>;
}

type Route = { tesisId: string; accountId: string };
type Resolved =
  | { kind: "bagsiz" }
  | { kind: "okunamadi" }
  | { kind: "tutarsiz"; linked: number }
  | { kind: "bagli"; newDigest: string; accounts: Route[] };

/** Kimliğin bağlı hesaplarının e-postasından yeni özet. 404 (imha) bağ değildir; 503 (hazır değil) okunamadı. */
async function resolveLinked(router: TesisDbRouter, key: FacilityDbKey, identityId: string, routes: readonly Route[]): Promise<Resolved> {
  const emails = new Set<string>();
  const accounts: Route[] = [];
  for (const r of [...routes].sort((x, y) => x.tesisId.localeCompare(y.tesisId))) {
    let a: { status: string; identityId: string | null; email: string } | null;
    try {
      a = await withTesis(router, { tesisId: r.tesisId }, (tx) => tx.account.findUnique({ where: { id: r.accountId }, select: { status: true, identityId: true, email: true } }));
    } catch (err) {
      if (err instanceof CloudError && err.status === 404) continue;
      if (err instanceof CloudError && err.status === 503) return { kind: "okunamadi" };
      throw err;
    }
    if (!accountEngagedTo(a, identityId)) continue;
    emails.add(normalizeEmail(a!.email));
    accounts.push(r);
  }
  if (accounts.length === 0) return { kind: "bagsiz" };
  if (emails.size !== 1) return { kind: "tutarsiz", linked: accounts.length };
  return { kind: "bagli", newDigest: key.emailDigest([...emails][0]!), accounts };
}

const routesOf = (central: Tx, identityId: string): Promise<Route[]> =>
  central.loginRoute.findMany({ where: { identityId }, select: { tesisId: true, accountId: true }, orderBy: { tesisId: "asc" } });

/** Kuru ölçüm: hiçbir şey yazmaz. Silinmiş (tombstone) kimlik kapsam dışıdır. Sıra kimlik kimliğine göre (belirlenimli). */
export async function planDigestRekey(router: TesisDbRouter, key: FacilityDbKey): Promise<RekeyPlan> {
  const identities = await withCentral(router, {}, (tx) =>
    tx.identity.findMany({ where: { identityPurgedAt: null }, select: { id: true, emailDigest: true }, orderBy: { id: "asc" } }),
  );
  const draft: { id: string; current: string; r: Resolved }[] = [];
  for (const i of identities) {
    const routes = await withCentral(router, {}, (tx) => routesOf(tx, i.id));
    draft.push({ id: i.id, current: i.emailDigest, r: routes.length === 0 ? { kind: "bagsiz" } : await resolveLinked(router, key, i.id, routes) });
  }
  const targets = new Map<string, number>();
  for (const d of draft) if (d.r.kind === "bagli") targets.set(d.r.newDigest, (targets.get(d.r.newDigest) ?? 0) + 1);
  const holders = new Map(identities.map((i) => [i.emailDigest, i.id]));
  const items: RekeyItem[] = draft.map((d) => {
    switch (d.r.kind) {
      case "bagsiz":
      case "okunamadi":
        return { identityId: d.id, status: d.r.kind, linked: 0 };
      case "tutarsiz":
        return { identityId: d.id, status: "cakisma", conflict: "EPOSTA_TUTARSIZ", linked: d.r.linked };
      case "bagli": {
        const linked = d.r.accounts.length;
        if ((targets.get(d.r.newDigest) ?? 0) > 1) return { identityId: d.id, status: "cakisma", conflict: "OZET_CIFT", linked };
        if (d.r.newDigest === d.current) return { identityId: d.id, status: "guncel", linked };
        const holder = holders.get(d.r.newDigest);
        if (holder !== undefined && holder !== d.id) return { identityId: d.id, status: "cakisma", conflict: "OZET_BASKA_KIMLIKTE", linked };
        return { identityId: d.id, status: "yenilenecek", linked, newDigest: d.r.newDigest, accounts: d.r.accounts };
      }
    }
  });
  const counts = { yenilenecek: 0, guncel: 0, bagsiz: 0, okunamadi: 0, cakisma: 0 };
  for (const it of items) counts[it.status]++;
  return { items, counts };
}

export type RekeyStop = { readonly identityId: string; readonly reason: RekeyConflict | "DEGISTI" };
export type RekeyResult =
  | { readonly kind: "reddedildi"; readonly conflicts: number }
  | { readonly kind: "tamam"; readonly changed: number }
  | { readonly kind: "durdu"; readonly changed: number; readonly stop: RekeyStop };

class Stop extends Error {
  constructor(readonly stop: RekeyStop) {
    super(stop.reason);
    Object.setPrototypeOf(this, Stop.prototype);
  }
}

/**
 * Uygula: planda tek çakışma varsa HİÇ yazmaz (fail-closed). Kimlik başına tek merkez tx'i; İLK ifadesi LOGIN_ROUTE
 * kilidi YENİ özet üzerinde — geçerli anahtarla yazan her yol (davet kabul/onay/bağla, satıcı sıfırlaması) aynı
 * anahtarı kilitler; eski özetle yazan bakım kapanışı/silmesi atomik claim'le (`{id, emailDigest: eski}`) ayrışır.
 * Kilit altında bağ yeniden ölçülür; plan bayatsa (DEGISTI) ya da yeni özet başka kimlikte ise DURUR, rapor eder.
 */
export async function applyDigestRekey(router: TesisDbRouter, key: FacilityDbKey, plan: RekeyPlan): Promise<RekeyResult> {
  if (plan.counts.cakisma > 0) return { kind: "reddedildi", conflicts: plan.counts.cakisma };
  let changed = 0;
  const todo = plan.items.filter((i) => i.status === "yenilenecek").sort((x, y) => x.identityId.localeCompare(y.identityId));
  for (const item of todo) {
    const newDigest = item.newDigest!;
    let accounts: Route[] | null;
    try {
      accounts = await withCentral(router, { lock: { name: "LOGIN_ROUTE", key: newDigest } }, async (central) => {
        const identity = await central.identity.findUnique({ where: { id: item.identityId }, select: { emailDigest: true, identityPurgedAt: true } });
        if (!identity || identity.identityPurgedAt) throw new Stop({ identityId: item.identityId, reason: "DEGISTI" });
        if (identity.emailDigest === newDigest) return null;
        const r = await resolveLinked(router, key, item.identityId, await routesOf(central, item.identityId));
        if (r.kind === "tutarsiz") throw new Stop({ identityId: item.identityId, reason: "EPOSTA_TUTARSIZ" });
        if (r.kind !== "bagli" || r.newDigest !== newDigest) throw new Stop({ identityId: item.identityId, reason: "DEGISTI" });
        const holder = await central.identity.findUnique({ where: { emailDigest: newDigest }, select: { id: true } });
        if (holder && holder.id !== item.identityId) throw new Stop({ identityId: item.identityId, reason: "OZET_BASKA_KIMLIKTE" });
        const u = await central.identity.updateMany({ where: { id: item.identityId, emailDigest: identity.emailDigest, identityPurgedAt: null }, data: { emailDigest: newDigest } });
        if (u.count === 0) throw new Stop({ identityId: item.identityId, reason: "DEGISTI" });
        return r.accounts;
      });
    } catch (err) {
      if (err instanceof Stop) return { kind: "durdu", changed, stop: err.stop };
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { kind: "durdu", changed, stop: { identityId: item.identityId, reason: "OZET_BASKA_KIMLIKTE" } };
      throw err;
    }
    if (accounts === null) continue;
    changed++;
    // Ayak izi tx DIŞINDA, yüksüz: e-posta ve özet denetime girmez.
    for (const a of accounts) await recordAudit(router, { tesisId: a.tesisId, actor: REKEY_ACTOR, event: REKEY_AUDIT_EVENT, entity: "Account", entityId: a.accountId });
  }
  return { kind: "tamam", changed };
}

/** CLI raporu: yalnız kimlik kimliği, durum, sebep kodu ve sayılar (e-posta/özet YOK). */
export function describePlan(plan: RekeyPlan): string[] {
  const out: string[] = [];
  for (const it of plan.items) {
    if (it.status === "yenilenecek") out.push(`  yenilenecek ${it.identityId} üyelik=${it.linked}`);
    else if (it.status === "cakisma") out.push(`  ⛔ çakışma ${it.identityId} sebep=${it.conflict} üyelik=${it.linked}`);
    else if (it.status === "okunamadi") out.push(`  ⚠️ okunamadı ${it.identityId} (tesis DB'si hazır değil)`);
  }
  const c = plan.counts;
  out.push(`kimlik=${plan.items.length} yenilenecek=${c.yenilenecek} guncel=${c.guncel} bagsiz=${c.bagsiz} okunamadi=${c.okunamadi} cakisma=${c.cakisma}`);
  return out;
}
