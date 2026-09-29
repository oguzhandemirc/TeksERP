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
  type Banner,
  type DocResult,
  type Finding,
  type LicenseStateInput,
  type ReasonCode,
} from "./state-rules";
import type { ClockResult } from "./saat";

export type { Banner, DocResult, LicenseStateInput, ReasonCode } from "./state-rules";
export { REASON_CODES, REASON_VALIDITY, DEFAULT_GRACE_DAYS } from "./state-rules";

export type ModuleCeiling =
  | { readonly applies: false }
  | { readonly applies: true; readonly allowed: readonly string[] };

export interface LicenseEffect {
  readonly bant: Banner | null;
  readonly guncellemeIzni: boolean;
  /** Tavan YALNIZ kullanılabilir bir HAK varken uygulanır; ölçülemedi ve ek süre ham değere düşer. */
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

function computeEffect(x: {
  readonly tier: StateTier;
  readonly validity: Validity;
  readonly docs: { readonly entitlement: VerifiedEntitlement | null; readonly lease: VerifiedLease | null };
  readonly findings: readonly Finding[];
}): LicenseEffect {
  const { entitlement, lease } = x.docs;
  const ceilingApplies = entitlement !== null && x.validity !== "OLCULEMEDI" && x.tier !== "EK_SURE";
  const frozen = lease ? lease.document.yaptirim.donmusModuller : [];
  const ceiling: ModuleCeiling =
    ceilingApplies && entitlement ? { applies: true, allowed: entitlement.document.moduller.filter((m) => !frozen.includes(m)) } : { applies: false };
  const updateAllowed =
    lease !== null && x.tier !== "DURDURULMUS" && !x.findings.some((f) => UPDATE_BLOCKERS.has(f.code));
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
  const restrictionDaysLeft = lease ? evaluateSanction(lease.document, now, findings) : null;
  if (entitlement) evaluateMaintenance(g, entitlement.document, now, findings);

  const validity = computeValidity(findings);
  const computedTier = computeTier(findings, validity);
  const mode = computeMode(g, lease);
  const computed = computeEffect({ tier: computedTier, validity, docs: { entitlement, lease }, findings });
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
    devredildi: lease?.document.devredildi ?? false,
    yaptirimKademesi: lease?.document.yaptirim.kademe ?? null,
    saat: clock,
  };
}

export function ceilingAllows(cap: ModuleCeiling, key: string): boolean {
  return !cap.applies || cap.allowed.includes(key);
}

/** Modül okuyucusunun lisans ayağı: `readX = readXRaw ∧ isModuleLicensed(state, key)`. */
export function isModuleLicensed(state: LicenseState, key: string): boolean {
  return ceilingAllows(state.uygulanan.modulTavani, key);
}
