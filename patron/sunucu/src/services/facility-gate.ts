// Tesisin patron bulutu kanalı açık mı — hesap yazmaları (gelen kutusu, rapor isteği) için. Fabrika
// hakkı yoksa mesaj BEKLIYOR'da çürür ⇒ yazma baştan 403. Hizmet bitince (SALT_OKUNUR) yazma kapalı,
// okuma ve dışa aktarma 90 gün açık; sonra giriş de kapanır (Ek-6/A §4.2 — aşama `service-lifecycle.ts`).
import { CloudError } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";
import { cloudEntitlementError } from "./installation-auth";
import { loadServiceFacts, serviceState } from "./service-lifecycle";

export async function assertFacilityCloudOpen(ctx: CloudContext, tesisId: string, nowMs: number): Promise<void> {
  const { facts, installations } = await withTesis(ctx.app, { tesisId }, async (tx) => ({
    facts: await loadServiceFacts(tx, tesisId),
    installations: await tx.installation.findMany({ where: { tesisId, active: true } }),
  }));
  const state = facts ? serviceState(facts, nowMs) : null;
  if (state && state.phase !== "ACIK") {
    throw new CloudError(403, "PATRON_BULUT_KAPALI", "Patron bulutu hizmeti sona erdi; veriler salt okunur, yeni kayıt girilemez", {
      asama: state.phase,
      saltOkunurBitis: state.readOnlyUntil?.toISOString() ?? null,
    });
  }
  const open = installations.some((i) => cloudEntitlementError({ ...i, stale: false }, nowMs) === null);
  if (!state || !open) throw new CloudError(403, "PATRON_BULUT_KAPALI", "Tesisin patron bulutu aboneliği açık değil; fabrika bu isteği alamaz");
}
