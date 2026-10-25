// =============================================================================
// KÜP `hata` — dönemde GÖRÜLEN kumaş hataları (R1-SEMKUP)
// =============================================================================
// Evren Fire Karnesi'nin tespit tablosudur: çıpa `RollError.detectedAt`, her kayıt bir tespit
// (hurda metresiyle aynı birimde toplanmaz). K4P muayene satırları (`origin = INSPECTION`) DAHİL —
// kaynak karne kökeni süzmez; ayırmak için `kaynak` boyutu var. Hata grubu `DefectType.defectGroup`
// (R1-BOYUT, tek kaynak `hata-gruplari.ts`); tezgah, topun indiği doff olayından (dokuma açıkken).
// "Çözgü hatası × vardiya" korelasyonunun B yolu bu küptür (plan §3.8): hataGrubu × vardiya.
// =============================================================================
import { Prisma } from "@prisma/client";
import { loadShiftRules, type ShiftRule } from "../../../helpers/vardiya-takvimi.helper";
import { getScrapScorecard } from "../../scrap-scorecard.report.service";
import {
  SHIFT_NOTE, colorDimension, defectGroupDimension, entityDimension, enumDimension, hourDimension, itemDimension,
  machineDimension, shiftDimension, stationDimension, timeDimensions,
} from "../boyutlar";
import { totalOnly } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube } from "../tipler";

const QUALITY_PERMISSION = "report:quality";
const PRODUCTION_MODULE = "productionEnabled";

export const DEFECT_ORIGIN_LABELS = { PROCESS: "Saha tespiti", INSPECTION: "Muayene" } as const;

function detectionsSql(range: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`(
    SELECT re."detectedAt" AS at, re."defectTypeId", dt."defectGroup", re.origin::text AS origin,
           wos."stationId", r."itemId", r."colorId", dv."machineId" AS "loomId"
    FROM roll_errors re
    JOIN rolls r                   ON r.id = re."rollId"
    LEFT JOIN defect_types dt      ON dt.id = re."defectTypeId"
    LEFT JOIN work_order_steps wos ON wos.id = re."detectedAtStepId"
    LEFT JOIN doff_events dv       ON dv.id = r."doffEventId"
    WHERE re."detectedAt" >= ${range.from} AND re."detectedAt" <= ${range.to}
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
      enumDimension({ id: "kaynak", name: "Tespit yeri", column: "p.origin", labels: DEFECT_ORIGIN_LABELS, nullLabel: "Saha tespiti" }),
      stationDimension(`p."stationId"`),
      machineDimension(`p."loomId"`),
      itemDimension(`p."itemId"`),
      colorDimension(`p."colorId"`),
    ],
    notes: ["Hata, bulunduğu ana yazılır; aynı hata sonradan hurdaya dönüşse de burada bir kez sayılır."],
    prepare: async () => {
      const cube = defectCubeOf(await loadShiftRules());
      return { ...cube, notes: [...(cube.notes ?? []), SHIFT_NOTE] };
    },
  };
}

export const defectCube: SemanticCube = defectCubeOf([]);
