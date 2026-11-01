// =============================================================================
// İŞ KOŞUL KAYNAKLARI — bildirim kataloğu tür 6–12 (plan §4, §7 N1-KOSUL-IS)
// =============================================================================
// Her kaynak "şu an doğru olan konu kümesini" döner; aç/kapa, tekrar bastırma ve 8040 kilidi
// `notification-condition.job.ts`te. Rapor/ekranla AYNI soruyu soran yüklem kopyalanmaz, TEK helper'dan
// okunur: termin `order-deadline.helper` · KK1 oranı `quality-first-share.helper` (karne `byItem`) ·
// fason açık kalem `subcontract-scorecard-query.helper` · levent kalan gün `finishForecastReport`.
// Eşikler katalog `paramSemasi` ⊕ fabrika varsayılanı (`notification-params.helper`); payload'da tutar ve kişi adı yok.
// Modülü kapalı türün kümesi boştur. Ölçülemeyen kaynak (1. kalite rolü yok) açık koşulu KORUR.
// =============================================================================
import { ShipmentStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { TERIM } from "../../constants/terim";
import { factoryDateTr, factoryDayStart, factoryYmd } from "../../constants/time";
import { fmtCalendarDate } from "../document-render/fmt-date";
import { DEADLINE_OPEN_ORDER_STATUSES, daysPastDeadline, isDeadlineApproaching } from "../helpers/order-deadline.helper";
import { collectPeriod, firstQualityCode, qualityByItem, type ScorecardBreakdownRow } from "../helpers/quality-first-share.helper";
import { queryOpenDispatchAges, type OpenDispatchAgeRow } from "../helpers/subcontract-scorecard-query.helper";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { finishForecastReport, type FinishForecastRow } from "../reports/levent-bitis-tahmini.report.service";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";
import { computeReadyWorks, NOTIFY_UNIT_READY_UNIT, notifyUnitNeedsIncomingDoc, type ReadyWorkUnit } from "../ready-works.service";
import { READY_WORK_KIND as READY_WORK_KIND_CODE } from "../../constants/notification-catalog-sevkiyat";
import { effectiveShipReadyPolicy } from "../helpers/ship-readiness.helper";
import { effectiveIncomingDocsEnabled, readShippingReadyNotifyUnits, readShippingReadyScanMinutes, type ShipReadyNotifyUnit } from "../system-setting.service";

export const WORK_CONDITION_PERIOD_MS = 300_000;
const DAY_MS = 86_400_000;

export const WORK_CONDITION_KINDS = [
  "siparis.termin-yaklasti",
  "siparis.termin-gecti",
  "isemri.gecikti",
  "kalite.kk1-oran-dusuk",
  "fason.donus-gecikti",
  "sevkiyat.onay-bekliyor",
  "dokuma.levent-bitiyor",
] as const satisfies readonly NotificationKind[];
export type WorkConditionKind = (typeof WORK_CONDITION_KINDS)[number];

export interface DeadlineOrderRow { id: string; orderNumber: string; deadline: Date | null; customerName: string }
export interface LateWorkOrderRow { id: string; workOrderNumber: string; plannedEndDate: Date | null }
export interface PlannedShipmentRow { id: string; shipmentNo: string; customerName: string }
export interface ReadyUnitRow { id: string; label: string; customerName: string | null; state: string; readyCount: number; readyMeters: number }
export interface QualityDay { topCode: string | null; byItem: ScorecardBreakdownRow[] }

/** Okuyucuların dar yüzü — bekçi sahteyle değiştirir; karar (eşik, pencere) bu dosyada. */
export interface WorkSourceDeps {
  moduleOpen: (kind: NotificationKind) => Promise<boolean>;
  /** Açık durumdaki ve termini `untilMs`ten önce olan siparişler (geçmişler dahil). */
  deadlineOrders: (untilMs: number) => Promise<DeadlineOrderRow[]>;
  lateWorkOrders: (nowMs: number) => Promise<LateWorkOrderRow[]>;
  /** Karne yüklemi: [gün başı, şimdi] aralığında kumaş kırılımı. */
  qualityBetween: (from: Date, to: Date) => Promise<QualityDay>;
  openDispatchAges: () => Promise<OpenDispatchAgeRow[]>;
  plannedShipments: () => Promise<PlannedShipmentRow[]>;
  beamForecast: () => Promise<FinishForecastRow[]>;
  /** Sevke hazır (D4-J2): ayar okuyucuları + birim satırları — yüklem `computeReadyWorks` → `ship-readiness.helper`. */
  notifyUnits: () => Promise<ShipReadyNotifyUnit[]>;
  scanMinutes: () => Promise<number>;
  incomingDocOpen: () => Promise<boolean>;
  readyUnits: (unit: ReadyWorkUnit) => Promise<ReadyUnitRow[]>;
  params: (kind: NotificationKind) => Record<string, unknown>;
  now: () => number;
}

async function moduleOpen(kind: NotificationKind): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [kind]);
  // `cekirdek:*`/`planlanan:*` okuyucusuz → anahtar yok → açık; ModulKey okunmuş boolean taşır.
  return env.modules[getNotificationEntry(kind).modul as ModulKey] !== false;
}

export const WORK_SOURCE_REAL_DEPS: Readonly<WorkSourceDeps> = {
  moduleOpen,
  deadlineOrders: async (untilMs) => {
    const rows = await prisma.order.findMany({
      where: { status: { in: [...DEADLINE_OPEN_ORDER_STATUSES] }, deadline: { not: null, lte: new Date(untilMs) } },
      select: { id: true, orderNumber: true, deadline: true, customer: { select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, orderNumber: r.orderNumber, deadline: r.deadline, customerName: r.customer.name }));
  },
  lateWorkOrders: (nowMs) =>
    prisma.workOrder.findMany({
      where: { status: { in: [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS] }, plannedEndDate: { lt: new Date(nowMs) } },
      select: { id: true, workOrderNumber: true, plannedEndDate: true },
    }),
  qualityBetween: async (from, to) => {
    const topCode = await firstQualityCode();
    return { topCode, byItem: qualityByItem(await collectPeriod({ from, to }), topCode) };
  },
  openDispatchAges: queryOpenDispatchAges,
  plannedShipments: async () => {
    const rows = await prisma.shipment.findMany({
      where: { status: ShipmentStatus.PLANNED },
      select: { id: true, shipmentNo: true, customer: { select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, shipmentNo: r.shipmentNo, customerName: r.customer.name }));
  },
  beamForecast: async () => (await finishForecastReport({})).data.satirlar,
  notifyUnits: () => readShippingReadyNotifyUnits(),
  scanMinutes: () => readShippingReadyScanMinutes(),
  incomingDocOpen: () => effectiveIncomingDocsEnabled(),
  readyUnits: async (unit) => computeReadyWorks(unit, await effectiveShipReadyPolicy()),
  params: effectiveNotificationParams,
  now: Date.now,
};

let deps: WorkSourceDeps = { ...WORK_SOURCE_REAL_DEPS };

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideWorkSourceDeps(p: Partial<WorkSourceDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

const num = (kind: NotificationKind, key: string): number => Number(deps.params(kind)[key]);
const tr1 = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });

// ── 6–7 · Sipariş termini yaklaştı / geçti (aynı okuma, ayrık yüklemler) ─────────────────────────
export async function deadlineApproachingSubjects(): Promise<ConditionSubject[]> {
  const kind = "siparis.termin-yaklasti";
  if (!(await deps.moduleOpen(kind))) return [];
  const now = deps.now();
  const days = num(kind, "gun");
  const rows = await deps.deadlineOrders(now + days * DAY_MS);
  return rows
    .filter((r) => isDeadlineApproaching(r.deadline, now, days))
    .map((r) => orderSubject(r));
}

export async function deadlinePassedSubjects(): Promise<ConditionSubject[]> {
  const kind = "siparis.termin-gecti";
  if (!(await deps.moduleOpen(kind))) return [];
  const now = deps.now();
  const rows = await deps.deadlineOrders(now);
  return rows.filter((r) => daysPastDeadline(r.deadline, now) !== null).map((r) => orderSubject(r));
}

function orderSubject(r: DeadlineOrderRow): ConditionSubject {
  return {
    key: r.id, type: "siparis", id: r.id,
    payload: { siparisId: r.id, siparisNo: r.orderNumber, musteriAd: r.customerName, termin: fmtCalendarDate(r.deadline?.toISOString()) },
  };
}

// ── 8 · İş emri gecikti ─────────────────────────────────────────────────────────────────────────
export async function lateWorkOrderSubjects(): Promise<ConditionSubject[]> {
  const kind = "isemri.gecikti";
  if (!(await deps.moduleOpen(kind))) return [];
  const now = deps.now();
  const rows = await deps.lateWorkOrders(now);
  return rows
    .filter((r) => r.plannedEndDate !== null && r.plannedEndDate.getTime() < now)
    .map((r) => ({
      key: r.id, type: "isemri", id: r.id,
      payload: { isEmriId: r.id, isEmriNo: r.workOrderNumber, planlananBitis: fmtCalendarDate(r.plannedEndDate?.toISOString()) },
    }));
}

// ── 9 · KK1 1. kalite oranı düşük (bugünkü fabrika günü; gün dönünce konu kendiliğinden kapanır) ──
export async function lowFirstQualitySubjects(): Promise<ConditionSubject[]> {
  const kind = "kalite.kk1-oran-dusuk";
  if (!(await deps.moduleOpen(kind))) return [];
  const at = new Date(deps.now());
  const day = await deps.qualityBetween(factoryDayStart(at), at);
  if (day.topCode === null) {
    // 1. kalite rolü atanmamış: oran ölçülemez → açık koşul KORUNUR (sahte "düzeldi" yok).
    const open = await prisma.notificationCondition.findMany({ where: { kind, resolvedAt: null }, select: { subjectKey: true, subjectType: true, subjectId: true, payload: true } });
    return open.map((r) => ({ key: r.subjectKey, type: r.subjectType, id: r.subjectId, payload: (r.payload ?? {}) as Record<string, unknown> }));
  }
  const threshold = num(kind, "oranYuzde");
  const minQty = num(kind, "minMetre");
  const ymd = factoryYmd(at);
  return day.byItem
    .filter((r) => r.totalQty >= minQty && r.topGradePct < threshold)
    .map((r) => ({
      key: `${r.key}:${ymd}`, type: "kumas", id: r.key,
      payload: { kumasId: r.key, kumasAd: r.label, gun: factoryDateTr(at), oran: `%${tr1(r.topGradePct)}`, esik: `%${tr1(threshold)}` },
    }));
}

// ── 10 · Fason dönüşü gecikti (firma kırılımı) ─────────────────────────────────────────────────
export async function lateSubcontractSubjects(): Promise<ConditionSubject[]> {
  const kind = "fason.donus-gecikti";
  if (!(await deps.moduleOpen(kind))) return [];
  const days = num(kind, "gun");
  const byFirm = new Map<string, { name: string; items: number; oldest: number }>();
  for (const r of await deps.openDispatchAges()) {
    if (!(r.daysOpen > days)) continue;
    const acc = byFirm.get(r.subcontractorId) ?? { name: r.subcontractorName, items: 0, oldest: 0 };
    acc.items += r.openItems;
    acc.oldest = Math.max(acc.oldest, Math.floor(r.daysOpen));
    byFirm.set(r.subcontractorId, acc);
  }
  return [...byFirm].map(([id, a]) => ({
    key: id, type: "fason-firma", id,
    payload: { firmaId: id, firmaAd: a.name, acikKalem: String(a.items), enEskiGun: String(a.oldest) },
  }));
}

// ── 11 · Sevkiyat onay bekliyor ────────────────────────────────────────────────────────────────
export async function pendingShipmentSubjects(): Promise<ConditionSubject[]> {
  const kind = "sevkiyat.onay-bekliyor";
  if (!(await deps.moduleOpen(kind))) return [];
  return (await deps.plannedShipments()).map((r) => ({
    key: r.id, type: "sevkiyat", id: r.id,
    payload: { sevkiyatId: r.id, sevkiyatNo: r.shipmentNo, musteriAd: r.customerName },
  }));
}

// ── 12 · Levent bitiyor (bitiş tahmini raporunun kalan günü) ───────────────────────────────────
export async function beamEndingSubjects(): Promise<ConditionSubject[]> {
  const kind = "dokuma.levent-bitiyor";
  if (!(await deps.moduleOpen(kind))) return [];
  const limit = num(kind, "kalanGun");
  return (await deps.beamForecast())
    .filter((r) => r.kalanGun !== null && r.kalanGun <= limit)
    .map((r) => ({
      key: r.beamId, type: "levent", id: r.beamId,
      payload: { leventId: r.beamId, leventNo: r.beamNo, tezgahNo: r.machine.code, kalanGun: tr1(r.kalanGun ?? 0) },
    }));
}

// ── 13 · İş sevke hazır (D4-J2) — birim türü başına tek toplu okuma; hazırlık kararı helper'ın `state`i ──────
export const READY_WORK_KIND = READY_WORK_KIND_CODE satisfies NotificationKind;
/** Kaynak dakikada bir uyanır; tarama `shipping.ready.scanMinutes`te bir koşar (ayar yeniden başlatmasız değişir). */
const MINUTE_MS = 60_000;
const READY_UNIT_OF: Record<ShipReadyNotifyUnit, { unit: ReadyWorkUnit; label: string; type: string }> = {
  IE: { unit: NOTIFY_UNIT_READY_UNIT.IE, label: TERIM.terbiyeIsEmri.tekil, type: "isemri" },
  GB: { unit: NOTIFY_UNIT_READY_UNIT.GB, label: "Gelen belge", type: "gelen-belge" },
  PARTI: { unit: NOTIFY_UNIT_READY_UNIT.PARTI, label: "Parti", type: "musteri-parti" },
};
let lastReadyScanAt: number | null = null;

/** Bekçi: tarama saatini sıfırlar (bir sonraki tur periyodu beklemeden tarar). */
export function resetReadyWorkScanClock(): void {
  lastReadyScanAt = null;
}

export async function readyWorkSubjects(): Promise<ConditionSubject[]> {
  const kind = READY_WORK_KIND;
  const units = await deps.notifyUnits();
  if (units.length === 0 || !(await deps.moduleOpen(kind))) return [];
  const now = deps.now();
  if (lastReadyScanAt !== null && now - lastReadyScanAt < (await deps.scanMinutes()) * MINUTE_MS) {
    // Periyot dolmadı: açık konular KORUNUR (boş küme dönmek hepsini "çözüldü" yapardı). Bilinçli seçim: periyot motorda
    // kayıt anında sabit olduğundan kaynak kendi saatini tutar ve açık konuları koşul tablosundan okur (tek süreç).
    const open = await prisma.notificationCondition.findMany({ where: { kind, resolvedAt: null }, select: { subjectKey: true, subjectType: true, subjectId: true, payload: true } });
    return open.map((r) => ({ key: r.subjectKey, type: r.subjectType, id: r.subjectId, payload: (r.payload ?? {}) as Record<string, unknown> }));
  }
  const docOpen = units.some(notifyUnitNeedsIncomingDoc) ? await deps.incomingDocOpen() : false;
  const out: ConditionSubject[] = [];
  for (const u of units) {
    const def = READY_UNIT_OF[u];
    if (notifyUnitNeedsIncomingDoc(u) && !docOpen) continue; // panel ucu kapısıyla (readyWorksModuleGate) aynı liste
    for (const r of await deps.readyUnits(def.unit)) {
      if (r.state !== "READY") continue;
      out.push({
        key: `${def.unit}:${r.id}`, type: def.type, id: def.unit === "customerBatch" ? null : r.id,
        payload: { birim: def.label, sekme: def.unit, id: r.id, no: r.label, musteriAd: r.customerName ?? "—", hazirTop: r.readyCount, hazirMetre: r.readyMeters },
      });
    }
  }
  lastReadyScanAt = now;
  return out;
}

export function registerReadyWorkConditionSource(): void {
  registerConditionSource({ kind: READY_WORK_KIND, periodMs: MINUTE_MS, evaluate: readyWorkSubjects });
}

export const WORK_SOURCE_EVALUATORS: Record<WorkConditionKind, () => Promise<ConditionSubject[]>> = {
  "siparis.termin-yaklasti": deadlineApproachingSubjects,
  "siparis.termin-gecti": deadlinePassedSubjects,
  "isemri.gecikti": lateWorkOrderSubjects,
  "kalite.kk1-oran-dusuk": lowFirstQualitySubjects,
  "fason.donus-gecikti": lateSubcontractSubjects,
  "sevkiyat.onay-bekliyor": pendingShipmentSubjects,
  "dokuma.levent-bitiyor": beamEndingSubjects,
};

/** Yedi kaynağı tarayıcıya kaydeder (tekrar çağrı aynı kaydı yeniler). */
export function registerWorkConditionSources(): void {
  for (const kind of WORK_CONDITION_KINDS) {
    registerConditionSource({ kind, periodMs: WORK_CONDITION_PERIOD_MS, evaluate: () => WORK_SOURCE_EVALUATORS[kind]() });
  }
}
