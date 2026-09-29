// Motorun lisans çekirdeğine KÖPRÜSÜ: HAK/kira doğrulaması ve bağı `getLicenseCore()`den geçer
// (üretimde native, geliştirmede TS). Çekirdek görünümleri anahtar nesnesi taşımaz; motorun
// kuralları (`state-rules.ts`) protokolün doğrulanmış biçimini ister — alt sertifikanın açık
// anahtarı imzası doğrulanmış belgeden yeniden kurulur.
import {
  ROOT_PUBLIC_KEYS,
  publicKeyFromX,
  type RootKey,
  type VerifiedEntitlement,
  type VerifiedLease,
} from "./protocol";
import type { CoreResult, EntitlementView, LeaseView, LicenseCore } from "./license-core";
import { getLicenseCore } from "./native";

/**
 * Üretim çapası (`ROOT_PUBLIC_KEYS`) çekirdeğe VERİLMEZ — çekirdek gömülü çapasını kullanır (native
 * dışarıdan çapayı yalnız test derlemesinde kabul eder). Başka bir çapa yalnız testlerden gelir.
 */
export function anchorArgument(roots: readonly RootKey[]): readonly RootKey[] | undefined {
  return roots === ROOT_PUBLIC_KEYS ? undefined : roots;
}

function entitlementOf(v: EntitlementView): VerifiedEntitlement {
  return { document: v.document, signer: { ...v.signer } };
}

function leaseOf(v: LeaseView): CoreResult<VerifiedLease> {
  const key = publicKeyFromX(v.subCertificate.document.x);
  if (!key) return { ok: false, code: "BELGE_SEMA", message: "Sertifikadaki açık anahtar biçimsiz" };
  const sub = v.subCertificate;
  return {
    ok: true,
    value: { document: v.document, subCertificate: { document: sub.document, rootKid: sub.rootKid, allowedClasses: [...sub.allowedClasses], key } },
  };
}

export function coreVerifyEntitlement(
  token: unknown,
  roots: readonly RootKey[],
  core: LicenseCore = getLicenseCore(),
): CoreResult<VerifiedEntitlement> {
  const r = core.verifyEntitlement(token, anchorArgument(roots));
  return r.ok ? { ok: true, value: entitlementOf(r.value) } : r;
}

export function coreVerifyLease(token: unknown, roots: readonly RootKey[], core: LicenseCore = getLicenseCore()): CoreResult<VerifiedLease> {
  const r = core.verifyLease(token, anchorArgument(roots));
  return r.ok ? leaseOf(r.value) : r;
}

/** İki belgeyi çekirdekte yeniden doğrular VE bağlar (doğrulanmış görünüm girdisine güvenilmez). */
export function coreCheckLeaseBinding(
  leaseJws: unknown,
  entitlementJws: unknown,
  roots: readonly RootKey[],
  core: LicenseCore = getLicenseCore(),
): CoreResult<true> {
  return core.checkLeaseBinding(leaseJws, entitlementJws, anchorArgument(roots));
}
