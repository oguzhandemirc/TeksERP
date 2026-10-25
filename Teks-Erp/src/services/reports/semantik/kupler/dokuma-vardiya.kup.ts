// =============================================================================
// KÜP `dokuma-vardiya` — tezgah × vardiya randımanı ve levent dengesi (R1-SEMKUP)
// =============================================================================
// Randıman TEK orandır ve ortalanmaz: grubun satırlarının süre/atkı terimleri toplanıp
// `aggregateMachineKpis` ile YENİDEN hesaplanır (Randıman raporunun `toplam`ıyla aynı fonksiyon).
// Levent ölçüleri Levent Sonucu'nun kapanan levent satırlarından: ölçülemeyen levent (çekme payı yok)
// orana 0 metre olarak girmez (`beamBalance`), fark metresi yalnız ölçülebilenlerden.
// =============================================================================
import { aggregateMachineKpis } from "../../../helpers/loom-efficiency.helper";
import { roundM } from "../../../helpers/dokuma-levent-rapor.helper";
import { loadShiftRules } from "../../../helpers/vardiya-takvimi.helper";
import { beamResultReport, type BeamResultRow } from "../../levent-sonucu.report.service";
import { beamBalance } from "../../temel/levent-dengesi.temel";
import { helperOnlyDimension, helperOnlySource } from "../boyutlar";
import { helperFromRows } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube } from "../tipler";
import { collectLoomRows, dayKeyOf, loomDayDimension, loomDays, machineLabel, type LoomShiftRow } from "./dokuma-satir";

const PRODUCTION_PERMISSION = "report:production";
const DOKUMA_MODULE = "dokumaEnabled";
const DEVERE_MODULE = "devereEnabled";

function loomKey(dimensionId: string, r: LoomShiftRow): string | null {
  if (dimensionId === "gun") return dayKeyOf(r);
  if (dimensionId === "vardiya") return r.shiftInstance.shiftDefinition.code;
  return r.machineId;
}

function loomLabel(dimensionId: string, r: LoomShiftRow): string | null {
  if (dimensionId === "gun") return dayKeyOf(r);
  if (dimensionId === "vardiya") return r.shiftInstance.shiftDefinition.name;
  return machineLabel(r);
}

async function computeEfficiency(input: HelperInput): Promise<HelperResult> {
  return helperFromRows(input, await collectLoomRows(input.range), {
    key: loomKey,
    label: loomLabel,
    weight: (r) => r.terms.potSec,
    aggregate: (rows) => aggregateMachineKpis(rows.map((r) => r.terms)).effectivenessPct,
  });
}

async function closedBeams(input: HelperInput): Promise<BeamResultRow[]> {
  return (await beamResultReport(loomDays(input.range))).data.kapananlar;
}

const beamKey = (_d: string, r: BeamResultRow): string => r.warpSpec.id;
const beamLabel = (_d: string, r: BeamResultRow): string => `${r.warpSpec.code} · ${r.warpSpec.name}`;
const UNMEASURED_NOTE = "Çekme payı girilmemiş leventin beklenen kumaşı hesaplanamaz; orana ve farka katılmaz.";

async function computeBeamBalance(input: HelperInput): Promise<HelperResult> {
  return helperFromRows(input, await closedBeams(input), {
    key: beamKey, label: beamLabel, weight: (r) => r.beklenenKumasM ?? 0,
    aggregate: (rows) => beamBalance(rows).balancePct,
  }, [UNMEASURED_NOTE]);
}

async function computeBeamLoss(input: HelperInput): Promise<HelperResult> {
  return helperFromRows(input, await closedBeams(input), {
    key: beamKey, label: beamLabel, weight: (r) => r.beklenenKumasM ?? 0,
    aggregate: (rows) => roundM(rows.filter((r) => r.beklenenKumasM !== null).reduce((a, r) => a + (r.fireM ?? 0), 0)),
  }, [UNMEASURED_NOTE]);
}

function loomCubeOf(shiftCodes: readonly string[]): SemanticCube {
  const base = { permission: PRODUCTION_PERMISSION, module: DOKUMA_MODULE };
  const beam = { permission: PRODUCTION_PERMISSION, module: DEVERE_MODULE };
  return {
    id: "dokuma-vardiya",
    name: "Dokuma: tezgah, vardiya ve levent",
    ...base,
    source: helperOnlySource,
    timeColumn: "p.at",
    measures: [
      { ...base, id: "dokuma.randimanYuzde", kind: "helper",
        helper: { dimensions: ["gun", "vardiya", "tezgah"], perCurrency: false, compute: computeEfficiency },
        parity: { report: "dokuma/tezgah-randimani", field: "anaSayi", legacy: "dokuma/randiman" } },
      { ...beam, id: "levent.dengeYuzde", kind: "helper",
        helper: { dimensions: ["cozguKarti"], perCurrency: false, compute: computeBeamBalance },
        parity: { report: "dokuma/levent-dengesi", field: "anaSayi", legacy: "dokuma/levent-sonucu" } },
      { ...beam, id: "fire.leventMetre", kind: "helper",
        helper: { dimensions: ["cozguKarti"], perCurrency: false, compute: computeBeamLoss },
        parity: { report: "dokuma/levent-sonucu", field: "ozet.fireM" } },
    ],
    dimensions: [
      loomDayDimension,
      helperOnlyDimension("vardiya", "Vardiya", "enum", shiftCodes),
      helperOnlyDimension("tezgah", "Tezgah", "uuid"),
      helperOnlyDimension("cozguKarti", "Çözgü kartı", "uuid"),
    ],
    notes: ["Randıman tezgah × vardiya satırlarından yeniden hesaplanır; satır oranlarının ortalaması alınmaz."],
    prepare: async () => loomCubeOf((await loadShiftRules()).map((r) => r.code)),
  };
}

export const loomShiftCube: SemanticCube = loomCubeOf([]);
