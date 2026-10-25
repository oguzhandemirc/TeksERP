// =============================================================================
// KÜP `hata` — dönemde GÖRÜLEN kumaş hataları (R1-SEMKUP)
// =============================================================================
// Evren Fire Karnesi'nin tespit tablosudur: çıpa `RollError.detectedAt`, her kayıt bir tespit
// (hurda metresiyle aynı birimde toplanmaz). Yalnız saha tespiti (`origin = PROCESS`, K4P #148 —
// kaynak karne `ACTIONABLE_ROLL_ERROR_SQL` ile süzer; muayene satırı ayrı dünya). Hata grubu `DefectType.defectGroup`
// (R1-BOYUT, tek kaynak `hata-gruplari.ts`); tezgah, topun indiği doff olayından (dokuma açıkken).
// "Çözgü hatası × vardiya" korelasyonunun B yolu bu küptür (plan §3.8): hataGrubu × vardiya.
// =============================================================================
import { Prisma } from "@prisma/client";
import { loadShiftRules, type ShiftRule } from "../../../helpers/vardiya-takvimi.helper";
import { getScrapScorecard } from "../../scrap-scorecard.report.service";
import { ACTIONABLE_ROLL_ERROR_SQL } from "../../../helpers/roll-error-scope.helper";
import {
  SHIFT_NOTE, colorDimension, defectGroupDimension, entityDimension, hourDimension, itemDimension,
  machineDimension, shiftDimension, stationDimension, timeDimensions,
} from "../boyutlar";
import { totalOnly } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube } from "../tipler";

const QUALITY_PERMISSION = "report:quality";
const PRODUCTION_MODULE = "productionEnabled";

function detectionsSql(range: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`(
    SELECT re."detectedAt" AS at, re."defectTypeId", dt."defectGroup",
           wos."stationId", r."itemId", r."colorId", dv."machineId" AS "loomId"
    FROM roll_errors re
    JOIN rolls r                   ON r.id = re."rollId"
    LEFT JOIN defect_types dt      ON dt.id = re."defectTypeId"
    LEFT JOIN work_order_steps wos ON wos.id = re."detectedAtStepId"
    LEFT JOIN doff_events dv       ON dv.id = r."doffEventId"
    WHERE re."detectedAt" >= ${range.from} AND re."detectedAt" <= ${range.to}
      AND ${ACTIONABLE_ROLL_ERROR_SQL}
  ) p`;
}

async function computeDefectsPerThousand(input: HelperInput): Promise<HelperResult> {
  const scrap = await getScrapScorecard(input.range);
  return totalOnly(scrap.summary.defectsPerThousandM, ["Hata sayısı dönemde bulunan hatalardan, metre dönemde biten kumaştan gelir."]);
}

function defectCubeOf(rules: readonly ShiftRule[]): SemanticCube {
  const base = { permission: QUALITY_PERMISSION, module: PRODUCTION_MODULE };
  return {
    id: "hata",
    name: "Kumaş hataları",
    ...base,
    source: detectionsSql,
    timeColumn: "p.at",
    measures: [
      { ...base, id: "kalite.hataAdedi", kind: "sum", sql: Prisma.sql`COUNT(*)`,
        parity: { report: "quality/scrap-scorecard", field: "summary.defectsDetected" } },
      { ...base, id: "kalite.binMetredeHata", kind: "helper", helper: { dimensions: [], perCurrency: false, compute: computeDefectsPerThousand },
        parity: { report: "quality/scrap-scorecard", field: "summary.defectsPerThousandM" } },
    ],
    dimensions: [
      ...timeDimensions("p.at"),
      hourDimension("p.at"),
      shiftDimension("p.at", rules),
      defectGroupDimension(`p."defectGroup"`),
      entityDimension({ id: "hataTuru", name: "Hata türü", keyColumn: `p."defectTypeId"`, table: "defect_types", alias: "dm_dt" }),
      stationDimension(`p."stationId"`),
      machineDimension(`p."loomId"`),
      itemDimension(`p."itemId"`),
      colorDimension(`p."colorId"`),
    ],
    notes: ["Hata, bulunduğu ana yazılır; aynı hata sonradan hurdaya dönüşse de burada bir kez sayılır. 4 puan muayene kayıtları burada sayılmaz."],
    prepare: async () => {
      const cube = defectCubeOf(await loadShiftRules());
      return { ...cube, notes: [...(cube.notes ?? []), SHIFT_NOTE] };
    },
  };
}

export const defectCube: SemanticCube = defectCubeOf([]);
