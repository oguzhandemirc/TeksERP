// =============================================================================
// KÜP `muayene` — dönemde yapılan 4 puan muayeneleri (K4P-RAPOR)
// =============================================================================
// Kaynak `roll_inspections`, yalnız AKTİF muayene (revize/iptal tarihtir — `ACTIVE_INSPECTION_SQL`);
// çıpa `inspectedAt`. Sayılar Muayeneler ekranının özet şeridiyle (`listInspections` summary) aynı
// where'den gelir: top durumu süzülmez, ortalama puanı hesaplanamayan (en bilinmeyen) muayeneyi saymaz.
// =============================================================================
import { Prisma } from "@prisma/client";
import { ACTIVE_INSPECTION_SQL } from "../../../helpers/inspection-active.helper";
import { entityDimension, enumDimension, itemDimension, stationDimension, timeDimensions } from "../boyutlar";
import type { SemanticCube } from "../tipler";

const INSPECTION_PERMISSION = "inspection:read";
const QUALITY_MODULE = "kaliteGuvenceEnabled";
const LIST = { report: "quality/inspections" } as const;
const RATIO_PART = "Ortalama puanın hesap parçası; kaynak ekran yalnız ortalamayı verir, eşitlik kalite.muayeneOrtalamaPuan'da ölçülür.";

function inspectionsSql(range: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`(
    SELECT ri."inspectedAt" AS at, ri."pointsPer100M2"::float AS score, ri.phase::text AS phase,
           ri."stationId", ri."inspectedById", ri."suggestedQualityGradeId", r."itemId"
    FROM roll_inspections ri
    JOIN rolls r ON r.id = ri."rollId"
    WHERE ri."inspectedAt" >= ${range.from} AND ri."inspectedAt" <= ${range.to}
      AND ${ACTIVE_INSPECTION_SQL}
  ) p`;
}

const base = { permission: INSPECTION_PERMISSION, module: QUALITY_MODULE };

export const inspectionCube: SemanticCube = {
  id: "muayene",
  name: "4 puan muayeneleri",
  ...base,
  source: inspectionsSql,
  timeColumn: "p.at",
  measures: [
    { ...base, id: "kalite.muayeneAdedi", kind: "sum", sql: Prisma.sql`COUNT(*)`, parity: { ...LIST, field: "summary.total" } },
    { ...base, id: "kalite.muayenePuanToplami", kind: "sum", sql: Prisma.sql`SUM(p.score)`, parity: { exempt: RATIO_PART } },
    { ...base, id: "kalite.puanliMuayeneAdedi", kind: "sum", sql: Prisma.sql`COUNT(p.score)`, parity: { exempt: RATIO_PART } },
    { ...base, id: "kalite.muayeneOrtalamaPuan", kind: "ratio", numerator: "kalite.muayenePuanToplami", denominator: "kalite.puanliMuayeneAdedi",
      parity: { ...LIST, field: "summary.avgPointsPer100M2" } },
  ],
  dimensions: [
    ...timeDimensions("p.at"),
    itemDimension(`p."itemId"`),
    stationDimension(`p."stationId"`),
    entityDimension({ id: "derece", name: "Önerilen derece", keyColumn: `p."suggestedQualityGradeId"`, table: "quality_grades", alias: "dm_qg" }),
    enumDimension({ id: "asama", name: "Muayene aşaması", column: "p.phase", labels: { RAW: "Ham", FINAL: "Mamul" }, nullLabel: "Bilinmiyor" }),
    entityDimension({ id: "operator", name: "Muayene eden", keyColumn: `p."inspectedById"`, table: "users", alias: "dm_us", labelColumn: `"fullName"`, personName: true }),
  ],
  notes: [
    "Her top için yalnız geçerli muayene sayılır; düzeltilen ya da iptal edilen muayene sayılmaz.",
    "Ortalama puan, eni bilinmediği için puanı hesaplanamayan muayeneleri dışarıda bırakır.",
  ],
};
