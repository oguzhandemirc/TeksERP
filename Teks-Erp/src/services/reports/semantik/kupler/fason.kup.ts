// =============================================================================
// KÜP `fason` — fasona giden ve dönen kumaş (R1-SEMKUP)
// =============================================================================
// Fason Karnesi'ne bağlı helper ölçüler. Fire YALNIZ kapanmış kalemden (gönderilen − dönen;
// açık kalem fireye girmez, "bekleyen"de sayılır) — üç kova kuralı kaynak serviste kalır.
// Ortalama dönüş süresi ortalanmaz: birden çok fasoncunun grubu ("Diğer", süzgeçli toplam) için
// kaynak servis o fasoncu kümesiyle YENİDEN koşulur (servisin kendi `subcontractorId` süzgeci).
// =============================================================================
import { getSubcontractScorecard, type SubcontractScorecard, type SubcontractScorecardRow } from "../../subcontract-scorecard.report.service";
import { applyMemoryFilters, capMemoryGroups } from "../bellek-kirilim";
import { helperOnlyDimension, helperOnlySource } from "../boyutlar";
import type { HelperInput, HelperResult, HelperRow, SemanticCube, SemanticMeasure } from "../tipler";

const SUBCONTRACT_PERMISSION = "report:subcontract";
/** Katalogdaki `subcontract/scorecard` satırının modülü; kaynak uç bugün modül kapısız (ölçüldü). */
const SUBCONTRACT_MODULE = "planlanan:fason";

type Figures = Pick<SubcontractScorecardRow, "fireQty" | "dispatchedQty" | "openQty" | "avgTurnaroundDays">;
type Pick1 = (f: Figures) => number | null;

const subKey = (_d: string, r: SubcontractScorecardRow): string => r.key;

async function figuresOf(input: HelperInput, ids: string[], base: SubcontractScorecard): Promise<Figures | null> {
  if (ids.length === 0) return null;
  if (ids.length === base.bySubcontractor.length) return base.summary;
  return (await getSubcontractScorecard(input.range, null, { subcontractorId: ids })).summary;
}

function subcontractHelper(pick: Pick1, empty: number | null) {
  return async (input: HelperInput): Promise<HelperResult> => {
    const base = await getSubcontractScorecard(input.range);
    const rows = input.filters.length ? applyMemoryFilters(base.bySubcontractor, input.filters, subKey) : base.bySubcontractor;
    const valueOf = async (rs: SubcontractScorecardRow[]): Promise<number | null> => {
      if (rs.length === 1) return pick(rs[0]!);
      const f = await figuresOf(input, rs.map((r) => r.key), base);
      return f ? pick(f) : empty;
    };
    const total = input.filters.length ? await valueOf(rows) : pick(base.summary);
    if (input.dimensions.length === 0) return { rows: [{ keys: {}, value: total }], totals: [{ value: total }], notes: [] };
    const out: HelperRow[] = [];
    for (const g of capMemoryGroups(rows, { dimensions: input.dimensions, key: subKey, weight: (r) => r.dispatchedQty, cap: input.cap })) {
      const other = g.keys.fasoncu!.other === true;
      out.push({
        keys: { fasoncu: other ? { value: null, label: "Diğer", other: true } : { value: g.rows[0]!.key, label: g.rows[0]!.label } },
        value: await valueOf(g.rows),
      });
    }
    return { rows: out, totals: [{ value: total }], notes: [] };
  };
}

function measure(id: string, pick: Pick1, empty: number | null, parity: SemanticMeasure["parity"]): SemanticMeasure {
  return {
    id, permission: SUBCONTRACT_PERMISSION, module: SUBCONTRACT_MODULE, kind: "helper",
    helper: { dimensions: ["fasoncu"], perCurrency: false, compute: subcontractHelper(pick, empty) }, parity,
  };
}

export const subcontractCube: SemanticCube = {
  id: "fason",
  name: "Fason",
  permission: SUBCONTRACT_PERMISSION,
  module: SUBCONTRACT_MODULE,
  source: helperOnlySource,
  timeColumn: "p.at",
  measures: [
    measure("fason.ortalamaDonusGun", (f) => f.avgTurnaroundDays, null, { report: "subcontract/fasoncular", field: "anaSayi", legacy: "subcontract/scorecard" }),
    measure("fire.fasonMetre", (f) => f.fireQty, 0, { report: "subcontract/scorecard", field: "summary.fireQty" }),
    measure("fason.gonderilenMetre", (f) => f.dispatchedQty, 0, { report: "subcontract/scorecard", field: "summary.dispatchedQty" }),
    measure("fason.bekleyenMetre", (f) => f.openQty, 0, { report: "subcontract/scorecard", field: "summary.openQty" }),
  ],
  dimensions: [helperOnlyDimension("fasoncu", "Fasoncu", "uuid")],
  notes: ["Fason farkı yalnız işi kapanmış kalemlerden hesaplanır; dönmemiş kalem \"fasonda bekleyen\"de sayılır."],
};
