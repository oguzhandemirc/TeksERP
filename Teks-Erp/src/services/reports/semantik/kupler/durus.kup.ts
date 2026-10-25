// =============================================================================
// KÜP `durus` — tezgah duruşları (R1-SEMKUP; plan §3.8 "çözgü × vardiya" A yolu)
// =============================================================================
// Satırlar Duruş Pareto'nun satırlarıdır (`dokuma-satir.ts`); süre ve adet oradaki kırılımdan
// toplanır. Sebep anahtarı Pareto'nun üç bloğudur: sebep kodu · "MIKRO" (kısa duruş — süre sınıfı,
// sebep değil) · NULL (sınıflandırılmamış). Hata grubu duruş sebebinden `hata-gruplari.ts`
// eşlemesiyle türer (`COZGU_KOPUSU → COZGU`); planlı/dış etken duruşu grupsuzdur.
// =============================================================================
import { DEFECT_GROUPS, STOP_REASON_DEFECT_GROUP, defectGroupLabel, stopReasonToDefectGroup } from "../../../../constants/hata-gruplari";
import { loadShiftRules } from "../../../helpers/vardiya-takvimi.helper";
import { secondsToMinutes } from "../../temel/duruslar.temel";
import { helperOnlyDimension, helperOnlySource } from "../boyutlar";
import { helperFromRows } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube, SemanticDimension } from "../tipler";
import { collectLoomRows, dayKeyOf, loomDayDimension, machineLabel } from "./dokuma-satir";

const PRODUCTION_PERMISSION = "report:production";
const DOKUMA_MODULE = "dokumaEnabled";
export const MINOR_STOP_KEY = "MIKRO";
const STOP_DIMENSIONS = ["gun", "vardiya", "tezgah", "sebep", "hataGrubu"] as const;

interface StopRow {
  day: string;
  shift: string;
  shiftName: string;
  machineId: string;
  machine: string;
  reason: string | null;
  reasonLabel: string;
  group: string | null;
  count: number;
  sec: number;
}

async function collectStops(input: HelperInput): Promise<StopRow[]> {
  const out: StopRow[] = [];
  for (const r of await collectLoomRows(input.range)) {
    for (const b of r.breakdown) {
      const minor = b.lossClass === "MINOR";
      out.push({
        day: dayKeyOf(r), shift: r.shiftInstance.shiftDefinition.code, shiftName: r.shiftInstance.shiftDefinition.name,
        machineId: r.machineId, machine: machineLabel(r),
        reason: minor ? MINOR_STOP_KEY : b.reasonCode,
        reasonLabel: minor ? "Kısa duruşlar" : b.reasonCode === null ? "Sınıflandırılmamış" : (b.reasonLabel ?? b.reasonCode),
        group: stopReasonToDefectGroup(b.reasonCode), count: b.stopCount, sec: b.stopSec,
      });
    }
  }
  return out;
}

function stopKey(dimensionId: string, r: StopRow): string | null {
  if (dimensionId === "gun") return r.day;
  if (dimensionId === "vardiya") return r.shift;
  if (dimensionId === "tezgah") return r.machineId;
  if (dimensionId === "sebep") return r.reason;
  return r.group;
}

function stopLabel(dimensionId: string, r: StopRow): string | null {
  if (dimensionId === "gun") return r.day;
  if (dimensionId === "vardiya") return r.shiftName;
  if (dimensionId === "tezgah") return r.machine;
  if (dimensionId === "sebep") return r.reasonLabel;
  return defectGroupLabel(r.group);
}

function stopHelper(pick: (rows: readonly StopRow[]) => number | null) {
  return async (input: HelperInput): Promise<HelperResult> =>
    helperFromRows(input, await collectStops(input), { key: stopKey, label: stopLabel, weight: (r) => r.sec, aggregate: pick });
}

const sumSec = (rows: readonly StopRow[]): number => rows.reduce((a, r) => a + r.sec, 0);

function stopDimensions(shiftCodes: readonly string[]): SemanticDimension[] {
  return [
    loomDayDimension,
    helperOnlyDimension("vardiya", "Vardiya", "enum", shiftCodes),
    helperOnlyDimension("tezgah", "Tezgah", "uuid"),
    helperOnlyDimension("sebep", "Duruş sebebi", "enum", [...Object.keys(STOP_REASON_DEFECT_GROUP), MINOR_STOP_KEY]),
    helperOnlyDimension("hataGrubu", "Hata grubu", "enum", DEFECT_GROUPS),
  ];
}

function stopCubeOf(shiftCodes: readonly string[]): SemanticCube {
  const base = { permission: PRODUCTION_PERMISSION, module: DOKUMA_MODULE };
  return {
    id: "durus",
    name: "Tezgah duruşları",
    ...base,
    source: helperOnlySource,
    timeColumn: "p.at",
    measures: [
      { ...base, id: "dokuma.durusSure", kind: "helper",
        helper: { dimensions: STOP_DIMENSIONS, perCurrency: false, compute: stopHelper((rs) => secondsToMinutes(sumSec(rs))) },
        parity: { report: "dokuma/duruslar", field: "anaSayi", legacy: "dokuma/durus-pareto" } },
      { ...base, id: "dokuma.durusSayisi", kind: "helper",
        helper: { dimensions: STOP_DIMENSIONS, perCurrency: false, compute: stopHelper((rs) => rs.reduce((a, r) => a + r.count, 0)) },
        parity: { report: "dokuma/durus-pareto", field: "toplam.stopCount" } },
    ],
    dimensions: stopDimensions(shiftCodes),
    notes: ["Duruş süresi, durduğu vardiyaya ve tezgaha yazılır; birkaç dakikalık kısa duruşlar tek \"Kısa duruşlar\" satırında toplanır."],
    prepare: async () => stopCubeOf((await loadShiftRules()).map((r) => r.code)),
  };
}

export const stopCube: SemanticCube = stopCubeOf([]);
