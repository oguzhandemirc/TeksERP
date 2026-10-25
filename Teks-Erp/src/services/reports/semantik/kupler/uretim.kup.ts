// =============================================================================
// KÜPLER `uretim` (biten kumaş) ve `istasyon` (top hareketi) — R1-SEMKUP
// =============================================================================
// `uretim`: Kalite Karnesi ile Fire Karnesi'nin ORTAK evreni — çıpa `Roll.finalizedAt`,
// `K18_DEAD_STATUSES` DIŞLANIR, SCRAP DIŞLANMAZ (tüketilen ebeveyn metrajını çocuğuna devretti;
// ikisini saymak aynı kumaşı iki kez saymaktır). "1. kalite" sıradan değil ROLDEN çözülür
// (`loadQualityRoles`), fason atfı karnedeki üç kovadır (fasoncu · firma belirsiz · fabrika içi).
// `istasyon`: Nerede Takıldı (WIP) evreni — kapanan ve geri alınmamış hareketler, `qtyIn`.
// Akış ölçüsüdür: top sonradan kesilip tüketilse de istasyondan GEÇMİŞTİR (K18 süzülmez; ölçüldü).
// =============================================================================
import { Prisma, QualityGradeRole } from "@prisma/client";
import prisma from "../../../../lib/prisma";
import { K18_DEAD_STATUSES } from "../../../batch.service";
import { loadQualityRoles } from "../../../helpers/quality-role.helper";
import { loadShiftRules, type ShiftRule } from "../../../helpers/vardiya-takvimi.helper";
import { getWipScorecard } from "../../wip-scorecard.report.service";
import { collectLossSources, totalLoss } from "../../temel/kayip.temel";
import {
  SHIFT_NOTE, colorDimension, entityDimension, enumDimension, hourDimension, itemDimension, machineDimension,
  shiftDimension, stationDimension, subcontractorDimension, timeDimensions,
} from "../boyutlar";
import { helperFromRows, totalOnly } from "../satir-helper";
import type { HelperInput, HelperResult, SemanticCube, SemanticDimension, SemanticMeasure } from "../tipler";

const QUALITY_PERMISSION = "report:quality";
const PRODUCTION_PERMISSION = "report:production";
const PRODUCTION_MODULE = "productionEnabled";

/** Üretim yeri kovaları — Kalite Karnesi `bySubcontractor` üçlüsünün kodları. */
export const PRODUCTION_ORIGIN_LABELS = { FASON: "Fason", FASON_BELIRSIZ: "Fason (firma belirsiz)", FABRIKA: "Fabrika içi" } as const;

function producedRollsSql(range: { from: Date; to: Date }): Prisma.Sql {
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
      AND r.status::text NOT IN (${Prisma.join(K18_DEAD_STATUSES.map((s) => s as string))})
  ) p`;
}

function productionDimensions(rules: readonly ShiftRule[]): SemanticDimension[] {
  return [
    ...timeDimensions("p.at"),
    itemDimension(`p."itemId"`),
    colorDimension(`p."colorId"`),
    entityDimension({ id: "kalite", name: "Kalite", keyColumn: `p."qualityGradeId"`, table: "quality_grades", alias: "dm_qg" }),
    enumDimension({ id: "uretimYeri", name: "Üretim yeri", column: "p.origin", labels: PRODUCTION_ORIGIN_LABELS, nullLabel: "Fabrika içi" }),
    subcontractorDimension(`p."subcontractorId"`),
    machineDimension(`p."loomId"`),
    shiftDimension("p.at", rules),
    hourDimension("p.at"),
  ];
}

async function computeLoss(input: HelperInput): Promise<HelperResult> {
  const { sources } = await collectLossSources(input.range, null);
  const notes = sources.filter((s) => s.qty === null && s.note).map((s) => s.note!);
  return totalOnly(totalLoss(sources, (s) => s.qty), notes);
}

function productionMeasures(firstGradeCode: string | null): SemanticMeasure[] {
  const base = { permission: QUALITY_PERMISSION, module: PRODUCTION_MODULE };
  return [
    { ...base, id: "kalite.bitenMetre", kind: "sum", sql: Prisma.sql`SUM(p.qty)`,
      parity: { report: "quality/scorecard", field: "summary.totalQty" } },
    { ...base, id: "kalite.birinciMetre", kind: "sum",
      sql: firstGradeCode === null ? Prisma.sql`NULL::float` : Prisma.sql`SUM(p.qty) FILTER (WHERE p."gradeCode" = ${firstGradeCode})`,
      parity: { report: "quality/scorecard", field: "summary.topGrade.qty" } },
    { ...base, id: "kalite.birinciYuzde", kind: "ratio", numerator: "kalite.birinciMetre", denominator: "kalite.bitenMetre", percent: true,
      parity: { report: "quality/kalite", field: "anaSayi", legacy: "quality/scorecard" } },
    { ...base, id: "fire.hurdaMetre", kind: "sum", sql: Prisma.sql`SUM(p.qty) FILTER (WHERE p.status = 'SCRAP')`,
      parity: { report: "quality/scrap-scorecard", field: "summary.scrapQty" } },
    { ...base, id: "fire.metre", kind: "helper", helper: { dimensions: [], perCurrency: false, compute: computeLoss },
      parity: { report: "quality/kayip", field: "anaSayi" } },
  ];
}

const PRODUCTION_NOTES = [
  "Biten kumaş, kalite kararının verildiği güne yazılır; iptal edilen ya da başka toplara bölünerek tükenen toplar sayılmaz, hurdaya ayrılanlar sayılır.",
];

function productionCubeOf(rules: readonly ShiftRule[], firstGradeCode: string | null, extraNotes: string[]): SemanticCube {
  return {
    id: "uretim",
    name: "Üretim ve kalite",
    permission: QUALITY_PERMISSION,
    module: PRODUCTION_MODULE,
    source: producedRollsSql,
    timeColumn: "p.at",
    measures: productionMeasures(firstGradeCode),
    dimensions: productionDimensions(rules),
    notes: [...PRODUCTION_NOTES, ...extraNotes],
    prepare: prepareProductionCube,
  };
}

async function prepareProductionCube(): Promise<SemanticCube> {
  const [roles, rules] = await Promise.all([loadQualityRoles(prisma), loadShiftRules()]);
  const first = roles.find(QualityGradeRole.FIRST);
  const notes = [SHIFT_NOTE];
  if (!first) notes.push("Kalite kataloğunda 1. kalite rolü atanmamış; birinci kalite ölçülemiyor.");
  return productionCubeOf(rules, first?.code ?? null, notes);
}

export const productionCube: SemanticCube = productionCubeOf([], null, []);

// ── İSTASYON (top hareketi) ──────────────────────────────────────────────────

function passedMovesSql(range: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`(
    SELECT rm."exitedAt" AS at, rm."qtyIn"::float AS qty, wos."stationId", rm."operatorId", r."itemId", r."colorId"
    FROM roll_movements rm
    JOIN work_order_steps wos ON wos.id = rm."workOrderStepId"
    JOIN rolls r              ON r.id = rm."rollId"
    WHERE rm."exitedAt" IS NOT NULL AND rm."revokedAt" IS NULL
      AND rm."exitedAt" >= ${range.from} AND rm."exitedAt" <= ${range.to}
  ) p`;
}

interface WaitingRow { stationId: string; label: string; waiting: number }

async function computeWaiting(input: HelperInput): Promise<HelperResult> {
  const wip = await getWipScorecard(input.range);
  const rows: WaitingRow[] = wip.byStation.map((s) => ({ stationId: s.key, label: s.label, waiting: s.waitingCount }));
  return helperFromRows(input, rows, {
    key: (_d, r) => r.stationId,
    label: (_d, r) => r.label,
    weight: (r) => r.waiting,
    aggregate: (rs) => rs.reduce((a, r) => a + r.waiting, 0),
  }, ["Bekleyen top bugünün durumudur; tarih aralığından bağımsızdır."]);
}

function stationCubeOf(rules: readonly ShiftRule[]): SemanticCube {
  const base = { permission: PRODUCTION_PERMISSION, module: PRODUCTION_MODULE };
  return {
    id: "istasyon",
    name: "İstasyon akışı",
    ...base,
    source: passedMovesSql,
    timeColumn: "p.at",
    measures: [
      { ...base, id: "uretim.gecenMetre", kind: "sum", sql: Prisma.sql`SUM(p.qty)`,
        parity: { report: "production/wip", field: "summary.passedQty" } },
      { ...base, id: "uretim.gecenTop", kind: "sum", sql: Prisma.sql`COUNT(*)`,
        parity: { report: "production/wip", field: "summary.passedCount" } },
      { ...base, id: "uretim.bekleyenTop", kind: "helper", helper: { dimensions: ["istasyon"], perCurrency: false, compute: computeWaiting },
        parity: { report: "production/uretim-akisi", field: "anaSayi", legacy: "production/wip" } },
    ],
    dimensions: [
      ...timeDimensions("p.at"),
      stationDimension(`p."stationId"`),
      entityDimension({ id: "operator", name: "Operatör", keyColumn: `p."operatorId"`, table: "users", alias: "dm_us", labelColumn: `"fullName"`, personName: true }),
      itemDimension(`p."itemId"`),
      colorDimension(`p."colorId"`),
      shiftDimension("p.at", rules),
      hourDimension("p.at"),
    ],
    notes: ["İstasyondan geçen, işi kapanan hareketin çıkış anına yazılır; geri alınan hareket sayılmaz."],
    prepare: async () => {
      const cube = stationCubeOf(await loadShiftRules());
      return { ...cube, notes: [...(cube.notes ?? []), SHIFT_NOTE] };
    },
  };
}

export const stationCube: SemanticCube = stationCubeOf([]);
