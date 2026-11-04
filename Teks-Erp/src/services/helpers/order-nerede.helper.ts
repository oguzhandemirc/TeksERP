// =============================================================================
// SİPARİŞ "NEREDE?" — TEK KAYNAK (2026-11-04, sözleşme ~/.tekserp NEREDE-SOZLESME)
// =============================================================================
// Sipariş listesinin "Nerede?" + "Sevk" cümleleri, hızlı sekme süzgeçleri ve yan
// panel ucu BURADAN türer. Yeni kolon/tablo YOK: top durumu + adımı + parti, fason
// sevk kaydı ve kalem sevk denormu okunur. Türkçe cümleyi SUNUCU kurar; panel,
// Excel ve PDF aynı `text`i basar (iki yerde kurulan cümle ayrışır).
//
// Sorgu bütçesi: sayfa başına SABİT (İE/sipariş sayısından bağımsız) — canlı
// toplar · fasondaki topların açık sevki · canlı topu olmayan İE'lerin top
// varlığı. Bekçi: scripts/test_order_nerede.ts (sorgu sayısı sayfa boyundan bağımsız).
// =============================================================================
import { ItemUnit, OrderStatus, Prisma, RollStatus, StationType, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { validate as isUuidString } from "uuid";
import { factoryDateTimeTr, factoryDayKeyUtcMidnight, factoryDayStart } from "../../constants/time";
import { isActiveLine, isMeasuredLine } from "./order-line-scope.helper";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { rollAtFasonWhere } from "./roll-place.helper";
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";
import { whereRollsOfWorkOrders, workOrderHasRollWhere } from "./workorder-rolls.helper";

// ── Kümeler ──────────────────────────────────────────────────────────────────
/** Siparişe bağlı sayılan İE durumları (iptal/yerini-alan hariç; liste rozetiyle aynı). */
export const NEREDE_ACTIVE_WO: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.COMPLETED,
];
/** Sevke hazır = depoda / 2. kalite stokta duran top. */
export const NEREDE_READY: RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK];
/** "Bir yerde duran" top: üretimde, fasonda, sevke hazır. Diğerleri (gönderildi/tüketildi/iptal) yer değildir. */
export const NEREDE_LIVE: RollStatus[] = [RollStatus.IN_PRODUCTION, RollStatus.AT_SUBCONTRACTOR, ...NEREDE_READY];

const OPEN_ORDER: Prisma.OrderWhereInput = { status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] } };
const DAY_MS = 86_400_000;

// ── Tipler (sözleşme §1, §3) ──────────────────────────────────────────────────
export type NeredeKind =
  | "CANCELLED" | "ALL_SHIPPED" | "CLOSED" | "NO_WORK_ORDER" | "NOT_STARTED"
  | "PRODUCED_SHIPPED" | "STEP" | "FASON" | "READY";
export type NeredeTone = "gray" | "blue" | "orange" | "green";
export interface Nerede {
  kind: NeredeKind;
  tone: NeredeTone;
  text: string;
  extraPlaces: number;
  overdue: boolean;
  overdueText: string | null;
}
export interface Sevk {
  kind: "NONE" | "PARTIAL" | "ALL" | "CLOSED";
  text: string;
  shipped: number;
  requested: number | null;
  unit: ItemUnit | null;
}
/** Bir yerdeki top kümesi. `key` yer kimliği: READY · FASON:<firma> · STEP:<aşama adı>. */
export interface NeredePlace {
  kind: "READY" | "FASON" | "STEP";
  key: string;
  name: string;
  rollCount: number;
  /** Rota sırası (eşitlik kırıcı); hazır toplarda en büyük. */
  sequence: number;
  /** FASON: en eski gönderimden bugüne fabrika günü. */
  days: number | null;
}

// ── Biçim ────────────────────────────────────────────────────────────────────
const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
export const fmtQty = (n: number): string => NUM.format(n);
const UNIT_SHORT: Record<ItemUnit, string> = { MT: "m", KG: "kg", ADET: "adet" };

/** İki an arasındaki FABRİKA günü farkı (takvim günü; saat değil). */
export function factoryDaysBetween(from: Date, now: Date): number {
  return Math.max(0, Math.round((factoryDayKeyUtcMidnight(now).getTime() - factoryDayKeyUtcMidnight(from).getTime()) / DAY_MS));
}

export const daysText = (d: number): string => (d === 0 ? "bugün gönderildi" : `${d} gündür`);

export function placeText(p: NeredePlace): string {
  if (p.kind === "READY") return `Sevke hazır · ${p.rollCount} top`;
  if (p.kind === "FASON") {
    return p.name
      ? `Fasonda – ${p.name} · ${p.rollCount} top · ${daysText(p.days ?? 0)}`
      : `Fasonda · ${p.rollCount} top`;
  }
  return `${p.name} aşamasında · ${p.rollCount} top`;
}

const KIND_RANK: Record<NeredePlace["kind"], number> = { READY: 3, FASON: 2, STEP: 1 };
/** Belirlenimli sıra: çok top > hazır > fason > aşama > büyük rota sırası > ad. */
export function comparePlaces(a: NeredePlace, b: NeredePlace): number {
  return (
    b.rollCount - a.rollCount ||
    KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
    b.sequence - a.sequence ||
    a.name.localeCompare(b.name, "tr")
  );
}

// ── Saf türetme ──────────────────────────────────────────────────────────────
export interface NeredeOrderInput {
  status: OrderStatus;
  manualClosedById: string | null;
  deadline: Date | null;
}

/** "Nerede?" cümlesi — öncelik sırası sözleşme §1 tablosundadır. */
export function deriveOrderNerede(
  order: NeredeOrderInput,
  ctx: { activeWoCount: number; places: NeredePlace[]; anyRoll: boolean },
  now: Date = new Date(),
): Nerede {
  const open = order.status !== OrderStatus.COMPLETED && order.status !== OrderStatus.CANCELLED;
  const overdue = open && order.deadline !== null && order.deadline.getTime() < factoryDayStart(now).getTime();
  const base = { extraPlaces: 0, overdue, overdueText: overdue ? "Termini geçti" : null };
  const gray = (kind: NeredeKind, text: string): Nerede => ({ kind, tone: "gray", text, ...base });

  if (order.status === OrderStatus.CANCELLED) return gray("CANCELLED", "Sipariş iptal edildi");
  if (order.status === OrderStatus.COMPLETED) {
    return order.manualClosedById
      ? gray("CLOSED", "Sipariş elle kapatıldı")
      : { kind: "ALL_SHIPPED", tone: "green", text: "Hepsi gönderildi", ...base };
  }
  if (ctx.activeWoCount === 0) return gray("NO_WORK_ORDER", "İş emri açılmadı");
  if (ctx.places.length > 0) {
    const sorted = [...ctx.places].sort(comparePlaces);
    const top = sorted[0]!;
    const extra = sorted.length - 1;
    const tone: NeredeTone = top.kind === "READY" ? "green" : top.kind === "FASON" ? "orange" : "blue";
    return {
      kind: top.kind,
      tone,
      text: placeText(top) + (extra > 0 ? ` · +${extra} yerde daha` : ""),
      extraPlaces: extra,
      overdue,
      overdueText: base.overdueText,
    };
  }
  return ctx.anyRoll
    ? gray("PRODUCED_SHIPPED", "Üretilen toplar gönderildi")
    : gray("NOT_STARTED", "İşe başlanmadı");
}

export interface NeredeLineInput {
  quantity: Prisma.Decimal | number | string;
  shippedQty: Prisma.Decimal | number | string;
  unit: ItemUnit;
  cancelledAt: Date | null;
}

/** "Sevk" cümlesi — BRÜT sevk; istenen = aktif kalem + iptal kalemin sevk edilen kısmı. */
export function deriveOrderSevk(order: NeredeOrderInput, lines: NeredeLineInput[]): Sevk {
  let shipped = new Prisma.Decimal(0);
  let requested = new Prisma.Decimal(0);
  for (const l of lines) {
    const s = new Prisma.Decimal(l.shippedQty);
    shipped = shipped.plus(s);
    requested = requested.plus(isActiveLine(l) ? new Prisma.Decimal(l.quantity) : s);
  }
  // Sayı yalnız bütün kalemler metre defterinden ölçülüyorsa (KG/ADET sevki yazılmaz).
  const measured = lines.length > 0 && lines.every((l) => isMeasuredLine(l));
  const unit = measured ? lines[0]!.unit : null;
  const sh = shipped.toNumber();
  const rq = measured ? requested.toNumber() : null;
  const pair = unit ? `${fmtQty(sh)} / ${fmtQty(rq ?? 0)} ${UNIT_SHORT[unit]}` : null;
  const out = (kind: Sevk["kind"], text: string): Sevk => ({ kind, text, shipped: sh, requested: rq, unit });

  if (order.status === OrderStatus.COMPLETED && order.manualClosedById) {
    return out("CLOSED", pair ? `Sipariş elle kapatıldı (${pair} gönderildi)` : "Sipariş elle kapatıldı");
  }
  if (order.status === OrderStatus.COMPLETED || (rq !== null && rq > 0 && sh >= rq)) return out("ALL", "Hepsi gönderildi");
  if (sh <= 0 && order.status !== OrderStatus.PARTIAL_SHIPPED) return out("NONE", "Henüz gönderilmedi");
  return out("PARTIAL", pair ? `Bir kısmı gönderildi (${pair})` : "Bir kısmı gönderildi");
}

// ── Süzgeçler (sözleşme §2) ──────────────────────────────────────────────────
export const NEREDE_TABS = ["BEKLEYEN", "FASONDA", "SEVKE_HAZIR", "KISMEN", "GECIKEN"] as const;
export type NeredeTab = (typeof NEREDE_TABS)[number];

const badFilter = (msg: string): AppError => AppError.badRequest(msg, { code: "INVALID_FILTER_VALUE" });

/** Sipariş → aktif bağlı bir İE `woWhere`e uyar. */
function orderHasActiveWo(woWhere: Prisma.WorkOrderWhereInput): Prisma.OrderWhereInput {
  return {
    lines: {
      some: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrder: { status: { in: NEREDE_ACTIVE_WO }, ...woWhere } } } },
    },
  };
}

/** `fasonGun=X` kesimi: G > X ⇔ gönderim, (bugün − X) fabrika gününün başından önce. */
export function fasonDayCutoff(days: number, now: Date = new Date()): Date {
  const key = factoryDayKeyUtcMidnight(now).getTime() - days * DAY_MS;
  return factoryDayStart(new Date(key + 12 * 3_600_000)); // öğlen: dilim ofseti gün sınırını aşmaz
}

const readRaw = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) throw badFilter("Süzgeç değeri tek olmalıdır.");
  const s = String(v).trim();
  return s === "" ? undefined : s;
};

/**
 * `filter[nerede]`, `filter[fasonFirma]`, `filter[fasonGun]` → sipariş where parçaları.
 * Tanınmayan değer 400 `INVALID_FILTER_VALUE` (fail-closed). Liste, cursor ve /stats
 * aynı `extraWhere`den geçer → üçü aynı kümeyi görür.
 */
export function buildNeredeWhere(filters: Record<string, unknown>, now: Date = new Date()): Prisma.OrderWhereInput[] {
  const conds: Prisma.OrderWhereInput[] = [];

  const tab = readRaw(filters.nerede);
  if (tab !== undefined) {
    if (!(NEREDE_TABS as readonly string[]).includes(tab)) {
      throw badFilter(`Geçersiz 'nerede' süzgeç değeri; geçerli değerler: ${NEREDE_TABS.join(", ")}.`);
    }
    conds.push(OPEN_ORDER);
    switch (tab as NeredeTab) {
      case "FASONDA":
        conds.push(orderHasActiveWo(workOrderHasRollWhere({ status: RollStatus.AT_SUBCONTRACTOR })));
        break;
      case "SEVKE_HAZIR":
        conds.push(orderHasActiveWo(workOrderHasRollWhere({ status: { in: NEREDE_READY } })));
        break;
      case "KISMEN":
        conds.push({ shippedQty: { gt: 0 } });
        break;
      case "GECIKEN":
        conds.push({ deadline: { lt: factoryDayStart(now) } });
        break;
      case "BEKLEYEN":
        break;
    }
  }

  const firmIds = readFilterList(filters.fasonFirma as string | string[] | undefined);
  const dayRaw = readRaw(filters.fasonGun);
  if (firmIds.length > 0 || dayRaw !== undefined) {
    const dispatch: Prisma.SubcontractorDispatchWhereInput = {};
    if (firmIds.length > 0) {
      const ids = firmIds;
      if (ids.some((id) => !isUuidString(id))) {
        throw badFilter("Geçersiz 'fasonFirma' süzgeç değeri; firma kimlikleri virgülle ayrılmış UUID olmalıdır.");
      }
      dispatch.subcontractorId = { in: ids };
    }
    if (dayRaw !== undefined) {
      if (!/^\d{1,4}$/.test(dayRaw) || Number(dayRaw) > 3650) {
        throw badFilter("Geçersiz 'fasonGun' süzgeç değeri; 0 ile 3650 arasında tam sayı olmalıdır.");
      }
      dispatch.dispatchedAt = { lt: fasonDayCutoff(Number(dayRaw), now) };
    }
    // AYNI top iki koşulu birlikte sağlar: fasonda + açık sevki (firma, gün).
    conds.push(OPEN_ORDER, orderHasActiveWo(workOrderHasRollWhere(rollAtFasonWhere(dispatch))));
  }
  return conds;
}
