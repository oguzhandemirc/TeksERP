// Lisans BÜTÜNLÜK turu: imzalı pakete karşı denetim (açılışta + günlük; yoklama işi çağırır) ve
// yeni HAK kabul edilince ANINDA yeniden denetim — hazırlık PAKET anahtarının sınıf kararı HAK'a
// bağlı, günlük turu beklerse yanlış sınıf bir gün sürer.
import { uyari } from "../lib/logger";
import { decideForClass, runIntegrityCheck } from "../lib/license/integrity-check";
import { getIntegrityOutcome, integrityCheckTarget, setIntegrityOutcome } from "../lib/license/integrity-state";
import { NATIVE_REQUIRED, getLicenseCore } from "../lib/license/native";
import { getLicenseSnapshot, invalidateLicenseSnapshot } from "../lib/license/runtime";
import { saveEntitlement } from "../lib/license/store";
import { evaluateLicenseTransitions } from "./license-trail.service";

/** Kullanılabilir HAK'ın sınıfı (hazırlık PAKET anahtarının sınıf kuralı); HAK yoksa null. */
function entitlementClassNow(): string | null {
  return getLicenseSnapshot().entitlement?.document.sinif ?? null;
}

/**
 * İmzalı dosya listesine karşı bütünlük. Paket kökü süreç kökü (`app/`). Karar BİTİŞTEKİ HAK sınıfıyla
 * verilir (denetim sürerken kabul edilen HAK eski sınıfın kararıyla ezilmesin); sonuç durumu hemen değerlendirilir.
 */
export async function refreshLicenseIntegrity(): Promise<void> {
  const { root, keys } = integrityCheckTarget();
  const o = await runIntegrityCheck({ root, keys, required: NATIVE_REQUIRED, core: getLicenseCore(), entitlementClass: entitlementClassNow() });
  setIntegrityOutcome(decideForClass(o, entitlementClassNow()) ?? o);
  evaluateLicenseTransitions();
}

let integrityRefresh: Promise<void> | null = null;

/**
 * Doğrulanmış yeni HAK'ı yazar; bütünlük KARARI son ölçümle hemen yeni sınıfa göre verilir (eski sınıfın
 * kararı yanıta, banda ve ilk yoklamaya girmesin), dosyalar bir sonraki turda yeniden denetlenir —
 * kabul bekletilmez; denetim hatası ölçümü düşürür, kabulü değil.
 */
export function acceptNewEntitlement(entitlementJws: string): void {
  saveEntitlement(entitlementJws);
  invalidateLicenseSnapshot();
  const prior = getIntegrityOutcome();
  const decided = prior ? decideForClass(prior, entitlementClassNow()) : null;
  if (decided) setIntegrityOutcome(decided);
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
