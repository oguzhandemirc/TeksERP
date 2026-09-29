// Lisans BÜTÜNLÜK turu: imzalı pakete karşı denetim (açılışta + günlük; yoklama işi çağırır) ve
// yeni HAK kabul edilince ANINDA yeniden denetim — hazırlık PAKET anahtarının sınıf kararı HAK'a
// bağlı, günlük turu beklerse yanlış sınıf bir gün sürer.
import { uyari } from "../lib/logger";
import { runIntegrityCheck } from "../lib/license/integrity-check";
import { integrityCheckTarget, setIntegrityOutcome } from "../lib/license/integrity-state";
import { NATIVE_REQUIRED, getLicenseCore } from "../lib/license/native";
import { getLicenseSnapshot } from "../lib/license/runtime";
import { saveEntitlement } from "../lib/license/store";

/**
 * İmzalı dosya listesine karşı bütünlük. Paket kökü süreç kökü (`app/`); hazırlık PAKET
 * anahtarının sınıf kuralı için doğrulanmış HAK'ın sınıfı verilir.
 */
export async function refreshLicenseIntegrity(): Promise<void> {
  const entitlementClass = getLicenseSnapshot().entitlement?.document.sinif ?? null;
  const { root, keys } = integrityCheckTarget();
  setIntegrityOutcome(await runIntegrityCheck({ root, keys, required: NATIVE_REQUIRED, core: getLicenseCore(), entitlementClass }));
}

let integrityRefresh: Promise<void> | null = null;

/**
 * Doğrulanmış yeni HAK'ı yazar ve bütünlüğü yeniden denetletir. Denetim bir sonraki tura ertelenir
 * (çağıranın anlık görüntüyü tazelemesi beklenir, kabul bekletilmez); hata ölçümü düşürür, kabulü değil.
 */
export function acceptNewEntitlement(entitlementJws: string): void {
  saveEntitlement(entitlementJws);
  integrityRefresh = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => refreshLicenseIntegrity())
    .catch((err: unknown) => {
      uyari("lisans", "yeni HAK sonrası bütünlük denetlenemedi (günlük turda yeniden)", err instanceof Error ? err.message : err);
    });
}

/** Test-only: son HAK kabulünün tetiklediği bütünlük denetimi bitene kadar bekler. */
export function awaitIntegrityRefreshForTests(): Promise<void> {
  return integrityRefresh ?? Promise.resolve();
}
