// =============================================================================
// ÜRETİM KOŞUL KAYNAKLARI — S2: `uretim.istasyon-durdu` · `dokuma.tezgah-durdu` · `bakim.uzun-durus` (KOSUL)
// =============================================================================
// Konu = AÇIK duruş satırı (`endedAt IS NULL ∧ revokedAt IS NULL`; `one_open_per_machine` seddiyle makine başına tek).
// Kapsam duruş listesiyle AYNI parçadan (`machineStopScopeWhere`, dokumasız rejimde tezgah dışı); arıza kümesi
// `isBreakdownReason`. Duruş kapanınca/geri alınınca konu kümeden düşer → motor "çözüldü" yazar. Rejim/modül kapalıyken
// küme boştur. Aç/kapa, taban ve 8040 kilidi `notification-condition.job.ts`te; okuma hatası YAKALANMAZ (fail-closed).
// =============================================================================
import { StationKind, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { factoryDateTimeTr } from "../../constants/time";
import { BREAKDOWN_STOP_REASON_CODES } from "../../constants/reason-presets";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { machineStopRegime, machineStopRegimeOpen, machineStopScopeWhere, type MachineStopRegime } from "../helpers/machine-stop-regime.helper";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const STOP_CONDITION_PERIOD_MS = 120_000;
export const STOP_CONDITION_KINDS = ["uretim.istasyon-durdu", "dokuma.tezgah-durdu", "bakim.uzun-durus"] as const satisfies readonly NotificationKind[];
type StopKind = (typeof STOP_CONDITION_KINDS)[number];

export interface OpenStopRow {
  id: string;
  startedAt: Date;
  reasonCode: string | null;
  reasonLabel: string | null;
  machineName: string;
  stationName: string;
}

export interface StopSourceDeps {
  moduleOpen: (kind: NotificationKind) => Promise<boolean>;
  regime: () => Promise<MachineStopRegime>;
  /** `startedAt ≤ before` açık duruşlar, verilen ek süzgeçle. */
  openStops: (before: Date, where: Prisma.MachineStopEventWhereInput) => Promise<OpenStopRow[]>;
  params: (kind: NotificationKind) => Record<string, unknown>;
  now: () => number;
}

async function moduleOpen(kind: NotificationKind): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [kind]);
  return env.modules[getNotificationEntry(kind).modul as ModulKey] !== false;
}

export const STOP_SOURCE_REAL_DEPS: Readonly<StopSourceDeps> = {
  moduleOpen,
  regime: () => machineStopRegime(),
  openStops: async (before, where) => {
    const rows = await prisma.machineStopEvent.findMany({
      where: { AND: [{ endedAt: null, revokedAt: null, startedAt: { lte: before } }, where] },
      select: { id: true, startedAt: true, reasonCode: true, machine: { select: { name: true, station: { select: { name: true } } } } },
    });
    const codes = [...new Set(rows.map((r) => r.reasonCode).filter((c): c is string => !!c))];
    const presets = codes.length
      ? await prisma.reasonPreset.findMany({ where: { kind: "MACHINE_STOP", code: { in: codes } }, select: { code: true, label: true } })
      : [];
    const label = new Map(presets.map((p) => [p.code, p.label]));
    return rows.map((r) => ({
      id: r.id, startedAt: r.startedAt, reasonCode: r.reasonCode, reasonLabel: r.reasonCode ? (label.get(r.reasonCode) ?? r.reasonCode) : null,
      machineName: r.machine.name, stationName: r.machine.station.name,
    }));
  },
  params: effectiveNotificationParams,
  now: Date.now,
};

let deps: StopSourceDeps = { ...STOP_SOURCE_REAL_DEPS };

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideStopSourceDeps(p: Partial<StopSourceDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

const sebepOf = (r: OpenStopRow): string => r.reasonLabel ?? "sebep girilmedi";

/** Bir duruş KOSUL türünün "şu an doğru" konu kümesi. */
export async function openStopSubjects(kind: StopKind): Promise<ConditionSubject[]> {
  if (!(await deps.moduleOpen(kind))) return [];
  const regime = await deps.regime();
  if (!machineStopRegimeOpen(regime)) return [];
  const p = deps.params(kind);
  const now = deps.now();
  const scope = machineStopScopeWhere(regime);
  if (kind === "dokuma.tezgah-durdu") {
    if (!regime.weaving) return [];
    const rows = await deps.openStops(new Date(now - Number(p.dakika) * 60_000), { AND: [scope, { machine: { station: { kind: StationKind.WEAVING } } }] });
    return rows.map((r) => ({
      key: r.id, type: "machine_stop", id: r.id,
      payload: { durusId: r.id, tezgahAd: r.machineName, baslangic: factoryDateTimeTr(r.startedAt), sebep: sebepOf(r) },
    }));
  }
  const before = kind === "bakim.uzun-durus" ? new Date(now - Number(p.saat) * 3_600_000) : new Date(now - Number(p.dakika) * 60_000);
  const extra: Prisma.MachineStopEventWhereInput = kind === "bakim.uzun-durus"
    ? { reasonCode: { in: [...BREAKDOWN_STOP_REASON_CODES] } }
    : { machine: { station: { kind: { not: StationKind.WEAVING } } } };
  const rows = await deps.openStops(before, { AND: [scope, extra] });
  return rows.map((r) => ({
    key: r.id, type: "machine_stop", id: r.id,
    payload: kind === "bakim.uzun-durus"
      ? { durusId: r.id, makineAd: r.machineName, baslangic: factoryDateTimeTr(r.startedAt), sebep: sebepOf(r) }
      : { durusId: r.id, makineAd: r.machineName, istasyonAd: r.stationName, baslangic: factoryDateTimeTr(r.startedAt), sebep: sebepOf(r) },
  }));
}

export function registerProductionConditionSources(): void {
  // Tür literal (tek-yayma/koşul tarayıcıları kaynağı tür adından bulur).
  registerConditionSource({ kind: "uretim.istasyon-durdu", periodMs: STOP_CONDITION_PERIOD_MS, evaluate: () => openStopSubjects("uretim.istasyon-durdu") });
  registerConditionSource({ kind: "dokuma.tezgah-durdu", periodMs: STOP_CONDITION_PERIOD_MS, evaluate: () => openStopSubjects("dokuma.tezgah-durdu") });
  registerConditionSource({ kind: "bakim.uzun-durus", periodMs: STOP_CONDITION_PERIOD_MS, evaluate: () => openStopSubjects("bakim.uzun-durus") });
}
