// Lisans adı — ağda (keşif, mDNS) ve giriş ekranında görünen firma adının TEK kaynağı.
// Ad kodda ve sihirbazda değil, kabul edilmiş HAK'ın `musteri.ad`ındadır (portaldaki müşteri kartı).
// Belge/etiket unvanı (`company.name`) ayrıdır: ilk değeri buradan bir kez gelir, sonra fabrika düzenler.
import { DEFAULT_COMPANY_NAME } from "../../constants/company";
import type { EntitlementDoc } from "./protocol";
import { getLicenseSnapshot } from "./runtime";

type EntitlementName = Pick<EntitlementDoc, "musteri"> | null | undefined;

/** Saf türetim: belgeden lisans adı; belge yoksa ya da ad boşsa null. */
export function licenseeNameFrom(doc: EntitlementName): string | null {
  const ad = doc?.musteri?.ad;
  return typeof ad === "string" && ad.trim() ? ad.trim() : null;
}

let readEntitlement: () => EntitlementName = () => getLicenseSnapshot().entitlement?.document ?? null;

/** Bu kuruluma bağlı, doğrulanmış HAK'ın adı; etkinleşmemiş ya da motor hazır değilse null (fail-closed → nötr ad). */
export function currentLicenseeName(): string | null {
  try {
    return licenseeNameFrom(readEntitlement());
  } catch {
    return null;
  }
}

/** Ekranda/ağda görünen ad: lisans adı, yoksa nötr ürün adı. `company.name`e BAKMAZ. */
export function screenCompanyName(): string {
  return currentLicenseeName() ?? DEFAULT_COMPANY_NAME;
}

/** Test-only: lisans görüntüsünü imzalı belge kurmadan taklit eder. */
export function __setEntitlementReaderForTests(fn: (() => EntitlementName) | null): void {
  readEntitlement = fn ?? (() => getLicenseSnapshot().entitlement?.document ?? null);
}
