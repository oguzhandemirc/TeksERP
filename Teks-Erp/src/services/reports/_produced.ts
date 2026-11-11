// =============================================================================
// "DÖNEMDE BİTEN KUMAŞ" — TEK TANIM (`_shipped.ts`in üretim ikizi)
// =============================================================================
// Kalite Karnesi ile Fire Karnesi'nin ORTAK evreni: çıpa `Roll.finalizedAt`, `K18_DEAD_STATUSES`
// DIŞLANIR, SCRAP DIŞLANMAZ. Semantik `uretim` küpü ve açılış panosu bu gövdeyi sarar; ikinci
// bir "üretilen metre" tanımı yazılmasın diye burada yaşar (eskiden `uretim.kup.ts` içindeydi).
// =============================================================================
import { Prisma } from "@prisma/client";
import { K18_DEAD_STATUSES } from "../batch.service";

/** Biten kumaş satırları, `p` takma adıyla (`at` · `qty` · `status` · kumaş · renk · kalite · köken · tezgah). */
export function producedRollsSql(range: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`(
    SELECT r."finalizedAt" AS at, r."currentQty"::float AS qty, r.status::text AS status,
           r."itemId", r."colorId", r."qualityGradeId", qg.code AS "gradeCode",
           sr."subcontractorId",
           (CASE WHEN sr."subcontractorId" IS NOT NULL THEN 'FASON'
                 WHEN r."entrySource" = 'SUBCONTRACTOR_RETURN' THEN 'FASON_BELIRSIZ'
                 ELSE 'FABRIKA' END) AS origin,
           dv."machineId" AS "loomId"
    FROM rolls r
    LEFT JOIN quality_grades qg         ON qg.id = r."qualityGradeId"
    LEFT JOIN subcontractor_receipts sr ON sr.id = r."parentReceiptId"
    LEFT JOIN doff_events dv            ON dv.id = r."doffEventId"
    WHERE r."finalizedAt" >= ${range.from} AND r."finalizedAt" <= ${range.to}
      AND r.status <> ALL(${K18_DEAD_STATUSES}::"RollStatus"[])
  ) p`;
}
