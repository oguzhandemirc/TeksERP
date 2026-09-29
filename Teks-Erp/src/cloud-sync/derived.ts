// TÜRETİLMİŞ ALANLAR — fabrika hesaplar, bulut saklar (§1.1). Her alan katalogda adı geçen
// TEK KAYNAK yardımcıyı çağırır; formül burada yeniden yazılmaz (liste ekranı ile
// projeksiyon aynı sayıyı basmak zorunda — "ayrışan yüzey" sınıfı).
import { ItemUnit, OrderStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { isActiveLine, isMeasuredLine } from "../services/helpers/order-line-scope.helper";
import { daysPastDeadline } from "../services/helpers/order-deadline.helper";
import { grossRollCount, loadShipmentGrossTotals, LIVE_RETURN_WHERE } from "../services/helpers/shipment-gross-totals.helper";
import { loadSackContentTotals } from "../services/helpers/sack-content-totals.helper";
import { currentWorkOrderStep } from "../services/helpers/work-order-current-step.helper";
import { ACTIVE_ORDER_LINK } from "../services/helpers/order-link.helper";
import { invoiceOpenAmount, unallocatedAmount } from "../services/helpers/finance.helper";
import {
  bucketOfDaysOverdue,
  collectAgingRows,
  daysOverdueAt,
  isOverdueBucket,
  resolveEffectiveDue,
} from "../services/reports/finance-aging.report";
import { WorkOrderService, WO_LIST_CUSTOMER_LINKS } from "../services/workorder.service";

type RawRow = Record<string, unknown> & { id: string };
export type DerivedValues = Map<string, Record<string, unknown>>;
type Deriver = (rows: readonly RawRow[], nowMs: number) => Promise<DerivedValues>;

const D0 = (): Prisma.Decimal => new Prisma.Decimal(0);
const dec = (v: unknown): Prisma.Decimal => new Prisma.Decimal(v as Prisma.Decimal.Value);
const ids = (rows: readonly RawRow[]): string[] => rows.map((r) => r.id);

/** Açık sipariş durumları — "gecikmiş" yalnız hâlâ karşılanmayı bekleyen siparişte anlamlıdır. */
const OPEN_ORDER_STATUSES: ReadonlySet<string> = new Set<OrderStatus>([OrderStatus.PENDING, OrderStatus.APPROVED, OrderStatus.PARTIAL_SHIPPED]);

async function orderDerived(rows: readonly RawRow[], nowMs: number): Promise<DerivedValues> {
  const lines = await prisma.orderLine.findMany({
    where: { orderId: { in: ids(rows) } },
    select: { orderId: true, quantity: true, shippedQty: true, unit: true, cancelledAt: true },
  });
  const byOrder = new Map<string, { open: Prisma.Decimal; count: number }>();
  for (const l of lines) {
    const acc = byOrder.get(l.orderId) ?? { open: D0(), count: 0 };
    if (isActiveLine(l)) {
      acc.count++;
      if (isMeasuredLine(l) && dec(l.quantity).gt(dec(l.shippedQty))) acc.open = acc.open.plus(dec(l.quantity).minus(dec(l.shippedQty)));
    }
    byOrder.set(l.orderId, acc);
  }
  const out: DerivedValues = new Map();
  for (const r of rows) {
    const acc = byOrder.get(r.id) ?? { open: D0(), count: 0 };
    const late = OPEN_ORDER_STATUSES.has(String(r.status)) && daysPastDeadline(r.deadline as Date | null, nowMs) !== null;
    out.set(r.id, { acikMiktar: acc.open, kalemSayisi: acc.count, gecikmis: late });
  }
  return out;
}

async function orderLineDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  const out: DerivedValues = new Map();
  for (const r of rows) {
    const line = { cancelledAt: r.cancelledAt as Date | null, unit: r.unit as ItemUnit };
    if (!isMeasuredLine(line)) {
      out.set(r.id, { acikMiktar: null });
      continue;
    }
    const open = dec(r.quantity).minus(dec(r.shippedQty));
    out.set(r.id, { acikMiktar: isActiveLine(line) && open.gt(0) ? open : D0() });
  }
  return out;
}

async function shipmentDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  const shipIds = ids(rows);
  const totals = await loadShipmentGrossTotals(shipIds);
  const counts = await prisma.shipment.findMany({
    where: { id: { in: shipIds } },
    select: { id: true, _count: { select: { sacks: true, rolls: true, returns: { where: LIVE_RETURN_WHERE } } } },
  });
  const countById = new Map(counts.map((c) => [c.id, c._count]));
  const links = await prisma.shipmentOrder.findMany({
    where: { shipmentId: { in: shipIds } },
    select: { shipmentId: true, orderId: true },
    orderBy: [{ shipmentId: "asc" }, { orderId: "asc" }],
  });
  const ordersById = new Map<string, string[]>();
  for (const l of links) ordersById.set(l.shipmentId, [...(ordersById.get(l.shipmentId) ?? []), l.orderId]);
  const out: DerivedValues = new Map();
  for (const id of shipIds) {
    const t = totals.get(id);
    const c = countById.get(id);
    out.set(id, {
      toplamMetre: t?.grossMeters ?? D0(),
      toplamKg: t?.kg ?? D0(),
      cuvalSayisi: c?.sacks ?? 0,
      topSayisi: grossRollCount(c?.rolls ?? 0, c?.returns ?? 0),
      siparisIdleri: ordersById.get(id) ?? [],
    });
  }
  return out;
}

async function sackDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  const totals = await loadSackContentTotals(ids(rows));
  const out: DerivedValues = new Map();
  for (const r of rows) {
    const t = totals.get(r.id);
    out.set(r.id, { topSayisi: t?.rollCount ?? 0, metre: t?.totalQty ?? D0() });
  }
  return out;
}

async function workOrderDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  const wos = await prisma.workOrder.findMany({
    where: { id: { in: ids(rows) } },
    select: {
      id: true,
      steps: { select: { id: true, stepSequence: true, status: true, stationId: true, station: { select: { name: true } } }, orderBy: { stepSequence: "asc" } },
      // Seçim listeyle aynı; aktif bağ yüklemi tek kaynaktan çağrı yerinde (koparılmış bağ projeksiyona girmez).
      orderLinks: { ...WO_LIST_CUSTOMER_LINKS, where: ACTIVE_ORDER_LINK },
    },
  });
  const withMeters = await new WorkOrderService().withProductionMeters(wos);
  const out: DerivedValues = new Map();
  for (const w of withMeters) {
    out.set(w.id, {
      uretilenMetre: new Prisma.Decimal(w.producedMeters),
      girenMetre: new Prisma.Decimal(w.inputMeters),
      siparisMetre: new Prisma.Decimal(w.orderedMeters),
      cariKartIdleri: w.customers.map((c) => c.id),
      aktifIstasyonId: currentWorkOrderStep(w.steps)?.stationId ?? null,
    });
  }
  return out;
}

async function cariAccountDerived(rows: readonly RawRow[], nowMs: number): Promise<DerivedValues> {
  const cariIds = ids(rows);
  const balances = await prisma.cariBalance.findMany({
    where: { cariId: { in: cariIds } },
    select: { cariId: true, currency: true, balance: true },
    orderBy: [{ cariId: "asc" }, { currency: "asc" }],
  });
  // Liste ekranıyla aynı: sıfır bakiyeli para birimi satırı gösterilmez.
  const balanceBy = new Map<string, Array<{ doviz: string; bakiye: Prisma.Decimal }>>();
  for (const b of balances) {
    if (dec(b.balance).isZero()) continue;
    balanceBy.set(b.cariId, [...(balanceBy.get(b.cariId) ?? []), { doviz: b.currency, bakiye: dec(b.balance) }]);
  }
  // Gecikmiş: cari listesinin `withOverdue`u ile AYNI çekirdek (`collectAgingRows`, asOf = şimdi).
  const aging = await collectAgingRows({ asOf: new Date(nowMs), cariIds });
  const overdueBy = new Map<string, Array<{ doviz: string; tutar: string }>>();
  for (const a of aging) {
    if (dec(a.overdueTotal).isZero()) continue;
    overdueBy.set(a.cariId, [...(overdueBy.get(a.cariId) ?? []), { doviz: a.currency, tutar: a.overdueTotal }]);
  }
  for (const list of overdueBy.values()) list.sort((a, b) => a.doviz.localeCompare(b.doviz));
  const out: DerivedValues = new Map();
  for (const id of cariIds) out.set(id, { bakiyeler: balanceBy.get(id) ?? [], gecikmis: overdueBy.get(id) ?? [] });
  return out;
}

async function invoiceDerived(rows: readonly RawRow[], nowMs: number): Promise<DerivedValues> {
  const cariIds = [...new Set(rows.map((r) => r.cariId as string))];
  const terms = await prisma.cariAccount.findMany({ where: { id: { in: cariIds } }, select: { id: true, paymentTermDays: true } });
  const termBy = new Map(terms.map((t) => [t.id, t.paymentTermDays]));
  const asOf = new Date(nowMs);
  const out: DerivedValues = new Map();
  for (const r of rows) {
    const open = invoiceOpenAmount(r.grandTotal as Prisma.Decimal.Value, r.paidTotal as Prisma.Decimal.Value);
    const { effectiveDue } = resolveEffectiveDue({
      dueDate: r.dueDate as Date | null,
      issueDate: r.issueDate as Date,
      paymentTermDays: termBy.get(r.cariId as string) ?? null,
    });
    const overdue = r.status === "CONFIRMED" && !open.isZero() && isOverdueBucket(bucketOfDaysOverdue(daysOverdueAt(asOf, effectiveDue)));
    out.set(r.id, { acikTutar: open, vadesiGecti: overdue });
  }
  return out;
}

async function paymentDerived(rows: readonly RawRow[]): Promise<DerivedValues> {
  const out: DerivedValues = new Map();
  for (const r of rows) {
    out.set(r.id, { eslesmemis: unallocatedAmount(r.amount as Prisma.Decimal.Value, r.allocatedTotal as Prisma.Decimal.Value) });
  }
  return out;
}

/** Projeksiyon → türetici. Katalogdaki `derived` tel adları ile BİREBİR (bekçi ölçer). */
export const DERIVERS: Readonly<Record<string, Deriver>> = {
  siparis: orderDerived,
  "siparis-kalemi": orderLineDerived,
  sevkiyat: shipmentDerived,
  cuval: sackDerived,
  "is-emri": workOrderDerived,
  "cari-hesap": cariAccountDerived,
  fatura: invoiceDerived,
  "tahsilat-odeme": paymentDerived,
};

/**
 * Türeticinin ham satırdan okuduğu kök kolonları — opt-in tel kolonu OLMASALAR da
 * kurucu bunları seçer (ör. fatura vadesi için `cariId` zaten tel kolonudur).
 */
export const DERIVER_ROW_FIELDS: Readonly<Record<string, readonly string[]>> = {
  siparis: ["status", "deadline"],
  "siparis-kalemi": ["quantity", "shippedQty", "unit", "cancelledAt"],
  fatura: ["grandTotal", "paidTotal", "dueDate", "issueDate", "cariId", "status"],
  "tahsilat-odeme": ["amount", "allocatedTotal"],
};

