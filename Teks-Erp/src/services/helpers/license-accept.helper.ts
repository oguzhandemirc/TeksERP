// Satıcı yanıtının KABULÜNE yardımcılar: kira + HAK doğrulaması (seçilen iptal belgesiyle zincir, kurulum/anahtar bağı, kira ↔ HAK
// bağı; HAK'ın "şimdi"si gelen kiranın imzalı sunucu saatini de kapsar — saati geri fabrika taze HAK'ı reddetmesin) ve ayak izi.
import { isoToMs, type LeaseDoc, type LicenseResponse, type SanctionLevel, type VerifiedEntitlement, type VerifiedLease } from "../../lib/license/protocol";
import { coreCheckLeaseBinding, coreVerifyEntitlement, coreVerifyLease } from "../../lib/license/core-bridge";
import { getLedgerHighWaterMs, getLicenseConfig, getLicenseSnapshot, type LicenseSnapshot } from "../../lib/license/runtime";
import { currentAccumulation, verificationFloorOf } from "../../lib/license/accumulation";
import { AuditService } from "../audit.service";
import { invalidResponse, type ReadyContext } from "./license-wire.helper";

export interface VerifiedLicenseResponse {
  readonly lease: VerifiedLease;
  readonly entitlement: VerifiedEntitlement;
  readonly licenseId: string;
}

/** Atar (`LICENSE_RESPONSE_INVALID`): kira/HAK doğrulanamaz, başka kuruluma/anahtara ait ya da birbirine bağlı değil. */
export function verifyResponseDocuments(resp: LicenseResponse, ctx: ReadyContext, revocation: string | null): VerifiedLicenseResponse {
  const roots = getLicenseConfig().roots;
  const lease = coreVerifyLease(resp.kira, roots, undefined, { revocation });
  if (!lease.ok) throw invalidResponse(`Kira doğrulanamadı: ${lease.message}`, lease.code);
  const leaseDoc = lease.value.document;
  if (leaseDoc.kurulumAnahtarKimligi !== ctx.key.kid) throw invalidResponse("Kira bu kurulum anahtarına ait değil.");
  if (resp.kurulumId !== undefined && resp.kurulumId !== leaseDoc.kurulumId) {
    throw invalidResponse("Yanıttaki kurulum kimliği imzalı kirayla uyuşmuyor.");
  }
  if (ctx.licenseId !== null && leaseDoc.kurulumId !== ctx.licenseId) throw invalidResponse("Kira bu kuruluma ait değil.");
  const licenseId = leaseDoc.kurulumId;
  const entitlementJws = resp.hak ?? ctx.store.entitlementJws;
  if (!entitlementJws) throw invalidResponse("Yanıt HAK belgesi taşımıyor ve kurulumda HAK yok.");
  const nowMs = Math.max(verificationFloorOf(Date.now(), getLedgerHighWaterMs(), currentAccumulation()), isoToMs(leaseDoc.sunucuSaati));
  const entitlement = coreVerifyEntitlement(entitlementJws, roots, undefined, { revocation, nowMs });
  if (!entitlement.ok) throw invalidResponse(`HAK doğrulanamadı: ${entitlement.message}`, entitlement.code);
  if (entitlement.value.document.kurulumId !== licenseId) throw invalidResponse("HAK bu kuruluma ait değil.");
  const binding = coreCheckLeaseBinding(resp.kira, entitlementJws, roots);
  if (!binding.ok) throw invalidResponse(`Kira HAK'a bağlı değil: ${binding.message}`, binding.code);
  return { lease: lease.value, entitlement: entitlement.value, licenseId };
}

export interface SanctionView {
  readonly kademe: SanctionLevel | null;
  readonly donmusModuller: readonly string[];
  readonly guncellemeDonuk: boolean;
  readonly devredildi: boolean;
}

export function sanctionView(snap: LicenseSnapshot): SanctionView | null {
  const l = snap.lease?.document;
  if (!l) return null;
  return { kademe: l.yaptirim.kademe, donmusModuller: [...l.yaptirim.donmusModuller].sort(), guncellemeDonuk: l.yaptirim.guncellemeDonuk, devredildi: l.devredildi };
}

/** Kabulün ayak izi: kira kabulü + (değiştiyse) yaptırım değişimi. Karar kaynağı değildir. */
export function logLeaseAccepted(g: {
  readonly resp: LicenseResponse;
  readonly leaseDoc: LeaseDoc;
  readonly source: string;
  readonly userId: string | null;
  readonly firstActivation: boolean;
  readonly priorSanction: SanctionView | null;
}): void {
  const { leaseDoc } = g;
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "LICENSE_LEASE_ACCEPTED",
    userId: g.userId,
    recordId: leaseDoc.kiraId,
    payload: {
      kaynak: g.source,
      kodTuru: g.resp.kodTuru ?? null,
      hakSurum: leaseDoc.hakSurum,
      bitis: leaseDoc.bitis,
      zorlama: leaseDoc.zorlama,
      yaptirimKademesi: leaseDoc.yaptirim.kademe,
      ilkEtkinlestirme: g.firstActivation,
    },
  });
  const nextSanction = sanctionView(getLicenseSnapshot());
  if (JSON.stringify(g.priorSanction) !== JSON.stringify(nextSanction)) {
    void AuditService.logEvent({
      category: "SYSTEM",
      action: "LICENSE_SANCTION_CHANGED",
      recordId: leaseDoc.kiraId,
      payload: { onceki: g.priorSanction, yeni: nextSanction },
    });
  }
}
