// =============================================================================
// Sevk muayene özeti — sevk detayı "Muayene" sekmesi + Muayene raporu belgesinin TEK kaynağı
// =============================================================================
// Her sevk topu için KENDİ aktif muayenesi (FINAL > RAW); ebeveyn (Tambur öncesi) muayenesi
// çocuğa mal edilmez — sorgu yalnız sevk topunun kimliğiyle yapılır. Müşteri spesifikasyonu
// yalnız GÖRÜNÜMDÜR (`resolveFourPointRule` + `resolveBand`): muayene satırına ve topun
// kalitesine yazılmaz (plan §8 md. 5). Toplamlar burada; istemci ve şablon hesap yapmaz.
// =============================================================================
import { Prisma, PrintedDocType, type InspectionWidthSource, type RunningCap, type RuleScope, type ScoreUnit } from "@prisma/client";
import { licenseModuleError } from "../lib/license/module-ceiling";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { renderInspectionReportHtml, renderInspectionReportTables } from "./document-render/inspection-report.html";
import { registerPrintedDocBuilder, type PrintedDocDb } from "./printed-document.service";
import { readKaliteGuvenceEnabled, SETTING_KEYS } from "./system-setting.service";
import { ACTIVE_INSPECTION_WHERE } from "./helpers/inspection-active.helper";
import { resolveFourPointRule, type ResolvedRuleSet } from "./helpers/four-point-resolve.helper";
import { resolveBand, round2, toUnit } from "./helpers/four-point.helper";
import { SACK_ABSENT_STATUSES } from "./helpers/sack-invariants.helper";

type Db = Prisma.TransactionClient;

/** Satır sonucu — metni belge tek sözlükten basar (`INSPECTION_RESULT_TEXT`, renderer). */
export type InspectionResult = "PASS" | "FAIL" | "NONE" | "NO_SCORE";

export interface ShipmentInspectionRow {
  sequence: number;
  rollId: string;
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  /** Sevk edilen (brüt) metre — topun çuvaldaki miktarı. */
  meters: number;
  inspectionId: string | null;
  phase: "RAW" | "FINAL" | null;
  inspectedAt: string | null;
  widthCm: number | null;
  widthSource: InspectionWidthSource | null;
  inspectedLengthM: number | null;
  defectCount: number | null;
  unplacedDefectCount: number | null;
  totalPoints: number | null;
  pointsPer100M2: number | null;
  /** Müşteri kuralının biriminde puan/100 (kâğıttaki sayı = kararın sayısı). */
  score: number | null;
  scoreUnit: ScoreUnit | null;
  label: string | null;
  accepted: boolean | null;
  result: InspectionResult;
  /** Fabrika derecesi önerisi (muayenede donmuş). */
  factoryGrade: string | null;
  ruleKey: string | null;
  // İç alanlar — belgede opt-in.
  inspectorName: string | null;
  stationName: string | null;
  deviceName: string | null;
}

export interface ShipmentInspectionRule {
  key: string;
  name: string;
  scope: RuleScope;
  unit: ScoreUnit;
  runningCap: RunningCap;
  bands: Array<{ maxScore: number | null; label: string; accepted: boolean }>;
}

export interface ShipmentInspectionSummary {
  header: {
    shipmentId: string;
    shipmentNo: string;
    customerId: string;
    customerName: string;
    customerCode: string | null;
    date: string;
    orderNos: string;
  };
  rules: ShipmentInspectionRule[];
  rows: ShipmentInspectionRow[];
  totals: {
    rollCount: number;
    inspectedCount: number;
    uninspectedCount: number;
    passCount: number;
    failCount: number;
    noScoreCount: number;
    totalMeters: number;
    defectCount: number;
    totalPoints: number;
    unplacedDefectCount: number;
    avgPointsPer100M2: number | null;
  };
  /** Dipnot sayıları — metin renderer'da (konumsuz hata, en kaynağı). */
  notes: { unplacedRollCount: number; widthSources: Partial<Record<InspectionWidthSource, number>> };
}

const INSPECTION_SELECT = {
  id: true, rollId: true, phase: true, inspectedAt: true, widthCm: true, widthSource: true, inspectedLengthM: true,
  defectCount: true, unplacedDefectCount: true, totalPoints: true, pointsPer100M2: true, gradeScore: true, ruleSetId: true,
  suggestedGradeCode: true,
  inspectedBy: { select: { fullName: true } },
  station: { select: { name: true } },
  device: { select: { name: true } },
} satisfies Prisma.RollInspectionSelect;
type InspectionPick = Prisma.RollInspectionGetPayload<{ select: typeof INSPECTION_SELECT }>;

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));

/** FINAL > RAW: finalize sonrası muayene topun sevk edilen hâlini anlatır. */
function pickActive(list: readonly InspectionPick[]): InspectionPick | null {
  return list.find((i) => i.phase === "FINAL") ?? list.find((i) => i.phase === "RAW") ?? null;
}

/** Kuralın biriminde skor: muayene aynı setle yapıldıysa donmuş skor, değilse birim çevirisi. */
function scoreFor(ins: InspectionPick, rule: ResolvedRuleSet): Prisma.Decimal | null {
  if (ins.ruleSetId === rule.id && ins.gradeScore != null) return ins.gradeScore;
  return ins.pointsPer100M2 == null ? null : round2(toUnit(ins.pointsPer100M2, rule.unit));
}

function ruleView(rule: ResolvedRuleSet): ShipmentInspectionRule {
  return {
    key: rule.id, name: rule.name, scope: rule.scope, unit: rule.unit, runningCap: rule.runningCap,
    bands: rule.bands.map((b) => ({ maxScore: num(b.maxScore), label: b.label, accepted: b.accepted })),
  };
}

/** Toplamlar backend'de (istemci hesap yapmaz); ortalama yalnız puanlı muayenelerden. */
function summarizeRows(rows: ShipmentInspectionRow[]): ShipmentInspectionSummary["totals"] {
  const inspected = rows.filter((r) => r.inspectionId);
  const scored = inspected.filter((r) => r.pointsPer100M2 != null);
  const sumDec = (vals: Array<number | null>) => vals.reduce<Prisma.Decimal>((s, v) => s.plus(v ?? 0), new Prisma.Decimal(0));
  const avg = scored.length
    ? sumDec(scored.map((r) => r.pointsPer100M2)).div(scored.length).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : null;

  return {
    rollCount: rows.length,
    inspectedCount: inspected.length,
    uninspectedCount: rows.length - inspected.length,
    passCount: rows.filter((r) => r.result === "PASS").length,
    failCount: rows.filter((r) => r.result === "FAIL").length,
    noScoreCount: rows.filter((r) => r.result === "NO_SCORE").length,
    totalMeters: Number(sumDec(rows.map((r) => r.meters))),
    defectCount: inspected.reduce((s, r) => s + (r.defectCount ?? 0), 0),
    totalPoints: inspected.reduce((s, r) => s + (r.totalPoints ?? 0), 0),
    unplacedDefectCount: inspected.reduce((s, r) => s + (r.unplacedDefectCount ?? 0), 0),
    avgPointsPer100M2: avg == null ? null : Number(avg),
  };
}

export async function buildShipmentInspectionSummary(db: Db, shipmentId: string): Promise<ShipmentInspectionSummary | null> {
  const sh = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true, shipmentNo: true, dispatchedAt: true, createdAt: true, customerId: true,
      customer: { select: { name: true, code: true } },
      orders: { select: { order: { select: { orderNumber: true } } } },
      // Sevk belgeleriyle AYNI top kümesi ve sırası (çuval sırası → topun doğuşu).
      sacks: {
        orderBy: { seq: "asc" },
        select: {
          rolls: {
            where: { status: { notIn: SACK_ABSENT_STATUSES } },
            orderBy: { createdAt: "asc" },
            select: { id: true, barcode: true, currentQty: true, itemId: true, item: { select: { name: true } }, color: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!sh) return null;

  const rolls = sh.sacks.flatMap((s) => s.rolls);
  const inspections = rolls.length
    ? await db.rollInspection.findMany({ where: { ...ACTIVE_INSPECTION_WHERE, rollId: { in: rolls.map((r) => r.id) } }, select: INSPECTION_SELECT })
    : [];
  const byRoll = new Map<string, InspectionPick[]>();
  for (const i of inspections) byRoll.set(i.rollId, [...(byRoll.get(i.rollId) ?? []), i]);

  const ruleByItem = new Map<string, ResolvedRuleSet | null>();
  for (const itemId of new Set(rolls.map((r) => r.itemId))) {
    ruleByItem.set(itemId, await resolveFourPointRule(db, { customerId: sh.customerId, itemId }));
  }
  const rulesUsed = new Map<string, ShipmentInspectionRule>();

  const widthSources: Partial<Record<InspectionWidthSource, number>> = {};
  let unplacedRollCount = 0;
  const rows: ShipmentInspectionRow[] = rolls.map((r, idx) => {
    const ins = pickActive(byRoll.get(r.id) ?? []);
    const rule = ruleByItem.get(r.itemId) ?? null;
    const base = {
      sequence: idx + 1, rollId: r.id, barcode: r.barcode, itemName: r.item.name, colorName: r.color?.name ?? null,
      meters: Number(r.currentQty),
    };
    if (!ins) {
      return {
        ...base, inspectionId: null, phase: null, inspectedAt: null, widthCm: null, widthSource: null, inspectedLengthM: null,
        defectCount: null, unplacedDefectCount: null, totalPoints: null, pointsPer100M2: null, score: null, scoreUnit: null,
        label: null, accepted: null, result: "NONE", factoryGrade: null, ruleKey: null,
        inspectorName: null, stationName: null, deviceName: null,
      };
    }
    widthSources[ins.widthSource] = (widthSources[ins.widthSource] ?? 0) + 1;
    if (ins.unplacedDefectCount > 0) unplacedRollCount += 1;
    const score = rule ? scoreFor(ins, rule) : null;
    const band = rule && score ? resolveBand(rule.bands, score) : null;
    if (rule && band) rulesUsed.set(rule.id, ruleView(rule));
    return {
      ...base,
      inspectionId: ins.id, phase: ins.phase, inspectedAt: ins.inspectedAt.toISOString(),
      widthCm: num(ins.widthCm), widthSource: ins.widthSource, inspectedLengthM: num(ins.inspectedLengthM),
      defectCount: ins.defectCount, unplacedDefectCount: ins.unplacedDefectCount, totalPoints: ins.totalPoints,
      pointsPer100M2: num(ins.pointsPer100M2), score: num(band ? score : null), scoreUnit: band ? rule!.unit : null,
      label: band?.label ?? null, accepted: band?.accepted ?? null,
      result: band ? (band.accepted ? "PASS" : "FAIL") : "NO_SCORE",
      factoryGrade: ins.suggestedGradeCode, ruleKey: band ? rule!.id : null,
      inspectorName: ins.inspectedBy.fullName, stationName: ins.station?.name ?? null, deviceName: ins.device?.name ?? null,
    };
  });

  return {
    header: {
      shipmentId: sh.id, shipmentNo: sh.shipmentNo, customerId: sh.customerId, customerName: sh.customer.name, customerCode: sh.customer.code,
      date: (sh.dispatchedAt ?? sh.createdAt).toISOString(),
      orderNos: [...new Set(sh.orders.map((o) => o.order.orderNumber))].join(", "),
    },
    rules: [...rulesUsed.values()],
    rows,
    totals: summarizeRows(rows),
    notes: { unplacedRollCount, widthSources },
  };
}

/** `GET /api/quality-inspections/shipment/:id/summary`. */
export async function getShipmentInspectionSummary(shipmentId: string): Promise<ShipmentInspectionSummary> {
  const s = await buildShipmentInspectionSummary(prisma, shipmentId);
  if (!s) throw AppError.notFound("Sevkiyat bulunamadı.", { code: "SHIPMENT_NOT_FOUND" });
  return s;
}

/** İptal önizlemesi: bu muayeneyi basmış donmuş Muayene raporu numaraları (sürümle). */
export async function printedReportsOfInspection(inspectionId: string, rollId: string): Promise<string[]> {
  const roll = await prisma.roll.findUnique({ where: { id: rollId }, select: { sack: { select: { shipmentId: true } } } });
  const shipmentId = roll?.sack?.shipmentId;
  if (!shipmentId) return [];
  const docs = await prisma.printedDocument.findMany({
    where: { docType: "INSPECTION_REPORT", sourceId: shipmentId },
    orderBy: { version: "asc" },
    select: { documentNo: true, version: true, snapshot: true },
  });
  return docs
    .filter((d: { snapshot: Prisma.JsonValue }) => {
      const rows = (d.snapshot as { doc?: { rows?: Array<{ inspectionId?: string | null }> } } | null)?.doc?.rows ?? [];
      return rows.some((r) => r.inspectionId === inspectionId);
    })
    .map((d: { documentNo: string; version: number }) => `${d.documentNo} (sürüm ${d.version})`);
}

// Muayene raporu (`INSPECTION_REPORT`) — kaynak Shipment, ilk basımda donar. Modül kapalıyken
// yeni basım 403 (fail-closed); donmuş belgenin yeniden basımı builder'a uğramaz.
registerPrintedDocBuilder(PrintedDocType.INSPECTION_REPORT, {
  fresh: async (db: PrintedDocDb, shipmentId: string) => {
    if (!(await readKaliteGuvenceEnabled())) {
      throw licenseModuleError(SETTING_KEYS.KALITE_GUVENCE_ENABLED, "Kalite Güvence")
        ?? AppError.forbidden("Kalite Güvence modülü kapalı.", { code: "MODULE_DISABLED", module: "kaliteGuvence" });
    }
    const doc = await buildShipmentInspectionSummary(db as Db, shipmentId);
    return doc ? { documentNo: doc.header.shipmentNo, doc: doc as unknown as Record<string, unknown> } : null;
  },
  renderHtml: renderInspectionReportHtml,
  renderTables: renderInspectionReportTables,
  resolveProfileId: async (db: PrintedDocDb, shipmentId: string) => {
    const s = await db.shipment.findUnique({ where: { id: shipmentId }, select: { customer: { select: { documentProfileId: true } } } });
    return s?.customer?.documentProfileId ?? null;
  },
});
