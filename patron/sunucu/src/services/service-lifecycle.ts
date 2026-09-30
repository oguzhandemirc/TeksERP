// HİZMET AŞAMASI — tek kaynak (Ek-6/A §4.1–4.3; sözleşme §9.5). Bir tesis üç aşamadan birindedir:
//   ACIK        — sözleşme açık: tesis AKTİF ∧ en az bir aktif kurulumda `patron-bulut` hakkı ve bitişi gelecekte.
//   SALT_OKUNUR — hizmet bitti: bitişten itibaren 90 gün giriş, okuma ve dışa aktarma açık; eşitleme, gelen
//                 kutusu ve rapor isteği kapalı.
//   KAPALI      — 90 gün doldu: giriş ve okuma kapalı, veri imha bekler (satıcı CLI'si `tesis.ts imha`).
// Sınıf (URETIM) ve devir (DR) İŞLETME durumudur, sözleşme değil: eşitleme kapısı ayrıca onları ister
// (`installation-auth.ts`), ama DR'ye devredilen tesisin hizmeti bitmiş sayılmaz.
// Bitiş anı DONAR (`facilities.service_ended_at`): satıcı kipinde hak donunca bitiş tarihi NULL gelir ve damga
// olmasa süre hiç dolmazdı. Damganın tek yazarı `refreshServiceEnd` (bakım tiki); okuyucular damga henüz
// yazılmamışsa aynı türetmeyi (`observedEnd`) kullanır.
import type { Facility, Installation } from "@prisma/client";
import { recordAudit } from "../lib/audit";
import type { Tx } from "../lib/db";
import { withMaintenanceList, withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";

export const CLOUD_MODULE_KEY = "patron-bulut";
/** Hizmet bitişinden sonra salt okuma + dışa aktarma süresi (Ek-6/A §4.2). */
export const READ_ONLY_DAYS = 90;
const DAY_MS = 86_400_000;

export type ServicePhase = "ACIK" | "SALT_OKUNUR" | "KAPALI";

export interface ServiceFacts {
  readonly status: Facility["status"];
  readonly serviceEndedAt: Date | null;
  readonly installations: readonly Pick<Installation, "active" | "modules" | "cloudUntil">[];
}

export interface ServiceState {
  readonly phase: ServicePhase;
  /** Hizmetin bittiği an (ACIK'ta null). */
  readonly endedAt: Date | null;
  /** Salt okuma süresinin bittiği an = bitiş + 90 gün (ACIK'ta null). */
  readonly readOnlyUntil: Date | null;
}

const hasCloudRight = (i: Pick<Installation, "modules">): boolean => i.modules.includes(CLOUD_MODULE_KEY);

/** Sözleşme açık mı: tesis AKTİF ∧ ∃ aktif kurulum (hak ∧ bitiş gelecekte). */
export function contractOpen(f: ServiceFacts, nowMs: number): boolean {
  return f.status === "AKTIF" && f.installations.some((i) => i.active && hasCloudRight(i) && (i.cloudUntil?.getTime() ?? 0) > nowMs);
}

/** Damgasız kapanışın anı: hakkı olan kurulumların GEÇMİŞ bitişlerinin en genci; yoksa (hak düştü, tesis kapandı) şimdi. */
export function observedEnd(f: ServiceFacts, nowMs: number): Date {
  const past = f.installations.filter((i) => hasCloudRight(i) && i.cloudUntil !== null && i.cloudUntil.getTime() <= nowMs).map((i) => i.cloudUntil!.getTime());
  return new Date(past.length > 0 ? Math.max(...past) : nowMs);
}

export function serviceState(f: ServiceFacts, nowMs: number): ServiceState {
  if (contractOpen(f, nowMs)) return { phase: "ACIK", endedAt: null, readOnlyUntil: null };
  const endedAt = f.serviceEndedAt ?? observedEnd(f, nowMs);
  const readOnlyUntil = new Date(endedAt.getTime() + READ_ONLY_DAYS * DAY_MS);
  return { phase: nowMs < readOnlyUntil.getTime() ? "SALT_OKUNUR" : "KAPALI", endedAt, readOnlyUntil };
}

/** Çağıranın kiracı tx'inde tesis + kurulumları okur; tesis yoksa null. */
export async function loadServiceFacts(tx: Tx, tesisId: string): Promise<ServiceFacts | null> {
  const facility = await tx.facility.findUnique({ where: { tesisId }, select: { status: true, serviceEndedAt: true } });
  if (!facility) return null;
  const installations = await tx.installation.findMany({ where: { tesisId }, select: { active: true, modules: true, cloudUntil: true } });
  return { status: facility.status, serviceEndedAt: facility.serviceEndedAt, installations };
}

/** Tesisin şu anki aşaması (kendi kiracı tx'inde); tesis yoksa null. */
export async function facilityServiceState(ctx: CloudContext, tesisId: string, nowMs: number): Promise<ServiceState | null> {
  const facts = await withTesis(ctx.sync, { tesisId }, (tx) => loadServiceFacts(tx, tesisId));
  return facts ? serviceState(facts, nowMs) : null;
}

/**
 * Bitiş damgasının TEK yazarı (bakım tiki): hizmet kapandıysa ve damga yoksa türetilen anı yazar; yeniden
 * açıldıysa damgayı siler. İkisi de atomik claim (`WHERE damga IS [NOT] NULL`); geçiş ayak izine düşer.
 */
export async function refreshServiceEnd(ctx: CloudContext, tesisId: string, nowMs: number): Promise<"DAMGALANDI" | "ACILDI" | null> {
  const change = await withTesis(ctx.sync, { tesisId }, async (tx) => {
    const facts = await loadServiceFacts(tx, tesisId);
    if (!facts) return null;
    const open = contractOpen(facts, nowMs);
    if (open && facts.serviceEndedAt) {
      const r = await tx.facility.updateMany({ where: { tesisId, serviceEndedAt: { not: null } }, data: { serviceEndedAt: null } });
      return r.count > 0 ? { kind: "ACILDI" as const, endedAt: null } : null;
    }
    if (!open && !facts.serviceEndedAt) {
      const endedAt = observedEnd(facts, nowMs);
      const r = await tx.facility.updateMany({ where: { tesisId, serviceEndedAt: null }, data: { serviceEndedAt: endedAt } });
      return r.count > 0 ? { kind: "DAMGALANDI" as const, endedAt } : null;
    }
    return null;
  });
  if (!change) return null;
  if (change.kind === "DAMGALANDI") {
    const until = new Date(change.endedAt.getTime() + READ_ONLY_DAYS * DAY_MS);
    await recordAudit(ctx.app, { tesisId, actor: "sistem", event: "HIZMET_SONA_ERDI", entity: "Facility", entityId: tesisId, summary: { bitis: change.endedAt.toISOString(), saltOkunurBitis: until.toISOString() } });
  } else {
    await recordAudit(ctx.app, { tesisId, actor: "sistem", event: "HIZMET_YENIDEN_ACILDI", entity: "Facility", entityId: tesisId });
  }
  return change.kind;
}

/** Bakım tiki: her tesisin damgası tazelenir; salt okuma süresi dolmuş (imha bekleyen) tesisler döner. */
export async function refreshAllServiceEnds(ctx: CloudContext, nowMs: number): Promise<{ stamped: number; reopened: number; awaitingDestruction: string[] }> {
  const ids = await withMaintenanceList(ctx.sync, (tx) => tx.facility.findMany({ select: { tesisId: true }, orderBy: { tesisId: "asc" } }));
  const out = { stamped: 0, reopened: 0, awaitingDestruction: [] as string[] };
  for (const { tesisId } of ids) {
    const change = await refreshServiceEnd(ctx, tesisId, nowMs);
    if (change === "DAMGALANDI") out.stamped++;
    if (change === "ACILDI") out.reopened++;
    if ((await facilityServiceState(ctx, tesisId, nowMs))?.phase === "KAPALI") out.awaitingDestruction.push(tesisId);
  }
  return out;
}
