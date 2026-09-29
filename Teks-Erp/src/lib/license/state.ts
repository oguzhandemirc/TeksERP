// Lisans durumu — SAF tek kaynak (I/O yok). Girdi: doğrulanmış belgeler + saat + ölçümler;
// çıktı: geçerlilik, kademe, etki. Gözlem kipinde her şey HESAPLANIR ama UYGULANAN etki
// bugünkü davranıştır (sıfır fark) — iki alan ayrı tutulur ki gözlem ölçülebilsin.
import {
  STATE_TIERS,
  verifyEntitlement,
  verifyLease,
  type VerifiedEntitlement,
  type VerifiedLease,
  type StateTier,
  type Validity,
  type RootKey,
  type LicenseMode,
  type Result,
  type SanctionLevel,
} from "./protocol";
import {
  REASON_VALIDITY,
  evaluateMaintenance,
  evaluateEntitlement,
  evaluateLease,
  evaluateMeasurements,
  computeClock,
  evaluateGrace,
  evaluateSanction,
  sanctionSnapshotOf,
  type Banner,
  type DocResult,
  type Finding,
  type LicenseStateInput,
  type ReasonCode,
} from "./state-rules";
import type { ClockResult, SanctionSnapshot } from "./saat";

export type { Banner, DocResult, LicenseStateInput, ReasonCode } from "./state-rules";
export { REASON_CODES, REASON_VALIDITY, DEFAULT_GRACE_DAYS, sanctionSnapshotOf } from "./state-rules";

/**
 * `allowed` HAK'ın satın alınmış modül listesidir (null = HAK tavanı uygulanmıyor);
 * `denied` sunucunun dondurduğu modüller (K2) — belirsizlikte de, ek sürede de kalıcı.
 */
export type ModuleCeiling =
  | { readonly applies: false }
  | { readonly applies: true; readonly allowed: readonly string[] | null; readonly denied: readonly string[] };

export interface LicenseEffect {
  readonly bant: Banner | null;
  readonly guncellemeIzni: boolean;
  /** HAK tavanı yalnız BELİRSİZLİKTE (ölçülemedi / HAK yok) açılır; dondurulan modül her hâlde kapalı. */
  readonly modulTavani: ModuleCeiling;
}

export interface StateReason {
  readonly kod: ReasonCode;
  readonly ayrinti: string | null;
}

export interface LicenseState {
  readonly gecerlilik: Validity;
  readonly nedenler: readonly StateReason[];
  readonly kip: LicenseMode;
  readonly hesaplananKademe: StateTier;
  /** Zorlamada hesaplananla aynı; gözlemde daima NORMAL. */
  readonly uygulananKademe: StateTier;
  readonly hesaplanan: LicenseEffect;
  readonly uygulanan: LicenseEffect;
  readonly ekSureKalanGun: number | null;
  readonly kisitlamaKalanGun: number | null;
  readonly devredildi: boolean;
  readonly yaptirimKademesi: SanctionLevel | null;
  readonly saat: ClockResult;
}

/** Gözlem kipinde uygulanan etki: bugünkü davranış — bant yok, güncelleme serbest, tavan yok. */
export const OBSERVE_EFFECT: LicenseEffect = Object.freeze({
  bant: null,
  guncellemeIzni: true,
  modulTavani: Object.freeze({ applies: false }),
});

const SEVERITY: ReadonlyMap<StateTier, number> = new Map(STATE_TIERS.map((k, i) => [k, i]));
function severity(k: StateTier | undefined): number {
  return SEVERITY.get(k ?? "NORMAL") ?? 0;
}

export function toDocResult<T>(s: Result<T> | null): DocResult<T> {
  if (s === null) return { status: "YOK" };
  return s.ok ? { status: "GECERLI", value: s.value } : { status: "GECERSIZ", code: s.code };
}

/** Diskten okunan HAK ve kirayı çapaya karşı doğrular (dosya yoksa `null` verilir). */
export function verifyLicenseDocuments(g: {
  readonly entitlementJws: string | null;
  readonly leaseJws: string | null;
  readonly roots: readonly RootKey[];
}): { readonly hak: DocResult<VerifiedEntitlement>; readonly kira: DocResult<VerifiedLease> } {
  return {
    hak: toDocResult(g.entitlementJws === null ? null : verifyEntitlement(g.entitlementJws, g.roots)),
    kira: toDocResult(g.leaseJws === null ? null : verifyLease(g.leaseJws, g.roots)),
  };
}

function computeValidity(findings: readonly Finding[]): Validity {
  const effects = findings.map((f) => REASON_VALIDITY[f.code]);
  if (effects.includes("GECERSIZ")) return "GECERSIZ";
  return effects.includes("OLCULEMEDI") ? "OLCULEMEDI" : "GECERLI";
}

function computeTier(findings: readonly Finding[], validity: Validity): StateTier {
  let tier: StateTier = validity === "GECERLI" ? "NORMAL" : "UYARI";
  for (const f of findings) if (severity(f.tier) > severity(tier)) tier = f.tier ?? tier;
  return tier;
}

/** En şiddetli bulgunun bandı; eşitlikte ilk yazılan. */
function pickBanner(findings: readonly Finding[]): Banner | null {
  let chosen: Finding | null = null;
  for (const f of findings) {
    if (f.banner && (!chosen || severity(f.tier) > severity(chosen.tier))) chosen = f;
  }
  return chosen?.banner ?? null;
}

/** Kira varsa onun kararı; yoksa son kiranın kararı (silinen kira kipi gevşetmesin); o da yoksa derleme. */
function computeMode(g: LicenseStateInput, lease: VerifiedLease | null): LicenseMode {
  if (lease) return lease.document.zorlama ? "zorla" : "gozlem";
  if (g.sonKiraZorlamasi !== null) return g.sonKiraZorlamasi ? "zorla" : "gozlem";
  return g.varsayilanKip;
}

const UPDATE_BLOCKERS: ReadonlySet<ReasonCode> = new Set(["GUNCELLEME_DONDURULDU", "BAKIM_BITTI", "BAKIM_IHLALI"]);

/** Sunucu kararlarının kaynağı: kullanılabilir kira; yoksa son kiranın anlık görüntüsü (silmek gevşetmez). */
function sanctionSource(g: LicenseStateInput, lease: VerifiedLease | null): SanctionSnapshot | null {
  return lease ? sanctionSnapshotOf(lease.document) : g.sonYaptirim;
}

function computeEffect(x: {
  readonly validity: Validity;
  readonly tier: StateTier;
  readonly entitlement: VerifiedEntitlement | null;
  readonly lease: VerifiedLease | null;
  readonly sanction: SanctionSnapshot | null;
  readonly findings: readonly Finding[];
}): LicenseEffect {
  const allowed = x.entitlement !== null && x.validity !== "OLCULEMEDI" ? x.entitlement.document.moduller : null;
  const denied = x.sanction ? x.sanction.donmusModuller : [];
  const ceiling: ModuleCeiling = allowed !== null || denied.length > 0 ? { applies: true, allowed, denied } : { applies: false };
  const updateAllowed =
    x.lease !== null && x.tier !== "DURDURULMUS" && !x.findings.some((f) => UPDATE_BLOCKERS.has(f.code));
  return { bant: pickBanner(x.findings), guncellemeIzni: updateAllowed, modulTavani: ceiling };
}

function reasonList(findings: readonly Finding[]): StateReason[] {
  const seen = new Set<ReasonCode>();
  const list: StateReason[] = [];
  for (const f of findings) {
    if (seen.has(f.code)) continue;
    seen.add(f.code);
    list.push({ kod: f.code, ayrinti: f.detail ?? null });
  }
  return list;
}

export function computeLicenseState(g: LicenseStateInput): LicenseState {
  const findings: Finding[] = [];
  const entitlement = evaluateEntitlement(g, findings);
  const lease = evaluateLease(g, entitlement, findings);
  const clock = computeClock(g, lease?.document ?? null, findings);
  const now = clock.trustedMs;
  evaluateMeasurements(g, lease?.document ?? null, findings);
  evaluateGrace(g, { entitlement, lease: lease?.document ?? null }, now, findings);
  const sanction = sanctionSource(g, lease);
  const restrictionDaysLeft = sanction ? evaluateSanction(sanction, now, findings) : null;
  if (entitlement) evaluateMaintenance(g, entitlement.document, now, findings);

  const validity = computeValidity(findings);
  const computedTier = computeTier(findings, validity);
  const mode = computeMode(g, lease);
  const computed = computeEffect({ validity, tier: computedTier, entitlement, lease, sanction, findings });
  const graceDays = findings.filter((f) => f.tier === "EK_SURE" && f.daysLeft !== undefined).map((f) => f.daysLeft ?? 0);
  return {
    gecerlilik: validity,
    nedenler: reasonList(findings),
    kip: mode,
    hesaplananKademe: computedTier,
    uygulananKademe: mode === "zorla" ? computedTier : "NORMAL",
    hesaplanan: computed,
    uygulanan: mode === "zorla" ? computed : OBSERVE_EFFECT,
    ekSureKalanGun: computedTier === "EK_SURE" && graceDays.length > 0 ? Math.min(...graceDays) : null,
    kisitlamaKalanGun: restrictionDaysLeft,
    devredildi: sanction?.devredildi ?? false,
    yaptirimKademesi: sanction?.kademe ?? null,
    saat: clock,
  };
}

export function ceilingAllows(cap: ModuleCeiling, key: string): boolean {
  if (!cap.applies) return true;
  return (cap.allowed === null || cap.allowed.includes(key)) && !cap.denied.includes(key);
}

/** Modül okuyucusunun lisans ayağı: `readX = readXRaw ∧ isModuleLicensed(state, key)`. */
export function isModuleLicensed(state: LicenseState, key: string): boolean {
  return ceilingAllows(state.uygulanan.modulTavani, key);
}
