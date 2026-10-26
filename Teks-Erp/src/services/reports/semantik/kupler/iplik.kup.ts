// =============================================================================
// KÜP `iplik` — açık siparişlerin iplik ihtiyacı, KESİT (MAL-7)
// =============================================================================
// İplik İhtiyaç Planı'na (`maliyet/iplik-ihtiyaci`) bağlı helper ölçüler: tarih aralığından BAĞIMSIZ,
// bugünkü açık siparişlerin durumudur. Servis compute İÇİNDE dinamik import edilir — statik kenar,
// semantik route'u maliyet rejim kapısına bağlardı (`test_maliyet_regime_gate`).
// =============================================================================
import { helperOnlyDimension, helperOnlySource } from "../boyutlar";
import { helperFromRows } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube, SemanticMeasure } from "../tipler";

const YARN_NEED_PERMISSION = "report:yarn-need";
const YARN_NEED_MODULE = "maliyetEnabled";
const SNAPSHOT_NOTE = "İplik ihtiyacı bugünkü açık siparişlerin durumudur; seçilen tarih aralığından bağımsızdır.";
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

function rowsMeasure(pick: "ihtiyacKg" | "eksikKg") {
  return async (input: HelperInput): Promise<HelperResult> => {
    const { yarnNeedReport } = await import("../../yarn-need.report.service");
    const r = await yarnNeedReport();
    return helperFromRows(input, r.satirlar, {
      key: (_d, row) => row.iplikId,
      label: (_d, row) => row.iplik,
      weight: (row) => Number(row[pick]),
      aggregate: (rows) => round3(rows.reduce((a, row) => a + Number(row[pick]), 0)),
    }, [SNAPSHOT_NOTE]);
  };
}

function measure(id: string, pick: "ihtiyacKg" | "eksikKg"): SemanticMeasure {
  return {
    id, permission: YARN_NEED_PERMISSION, module: YARN_NEED_MODULE, kind: "helper",
    helper: { dimensions: ["iplik"], perCurrency: false, compute: rowsMeasure(pick) },
    parity: { report: "maliyet/iplik-ihtiyaci", field: `ozet.${pick}` },
  };
}

export const yarnNeedCube: SemanticCube = {
  id: "iplik",
  name: "İplik ihtiyacı",
  permission: YARN_NEED_PERMISSION,
  module: YARN_NEED_MODULE,
  source: helperOnlySource,
  timeColumn: "p.at",
  measures: [measure("iplik.ihtiyacKg", "ihtiyacKg"), measure("iplik.eksikKg", "eksikKg")],
  dimensions: [helperOnlyDimension("iplik", "İplik", "uuid")],
  notes: [SNAPSHOT_NOTE],
};
