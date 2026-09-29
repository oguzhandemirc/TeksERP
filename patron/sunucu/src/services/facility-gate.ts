// Tesisin patron bulutu kanalı açık mı — hesap yazmaları (gelen kutusu, rapor isteği) için. Fabrika
// hakkı yoksa mesaj BEKLIYOR'da çürür ⇒ yazma baştan 403. Okuma (veri API'si) abonelik bitse de açık
// kalır: veri sözleşme süresi sonunda imha edilir, öncesinde dışa aktarma sunulur (sözleşme §9.5).
import { CloudError } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import type { CloudContext } from "./context";
import { cloudEntitlementError } from "./installation-auth";

export async function assertFacilityCloudOpen(ctx: CloudContext, tesisId: string, nowMs: number): Promise<void> {
  const installations = await withTesis(ctx.app, { tesisId }, (tx) => tx.installation.findMany({ where: { tesisId, active: true } }));
  const open = installations.some((i) => cloudEntitlementError({ ...i, stale: false }, nowMs) === null);
  if (!open) throw new CloudError(403, "PATRON_BULUT_KAPALI", "Tesisin patron bulutu aboneliği açık değil; fabrika bu isteği alamaz");
}
