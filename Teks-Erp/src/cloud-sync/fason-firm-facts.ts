// `fason-acik` firma kırılımı (patron fason ekranı, 2026-11-19): firmada duran top · iş emri · müşteri · ürün·renk.
// Top kümesi İE firma süzgeciyle AYNI parça (`firmRollWhere`): firmanın `acikTop`u = konum listesinin top kümesi.
// Müşteri İE satırının `musteriAdi`'yla aynı çözüm (`withProductionMeters.customers` ilki); İE'siz top sahibine düşer.
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { ACTIVE_ORDER_LINK } from "../services/helpers/order-link.helper";
import { outstandingItemOfOpenDispatch } from "../services/helpers/fason-open-dispatch.helper";
import { WorkOrderService, WO_LIST_CUSTOMER_LINKS } from "../services/workorder.service";
import { firmRollWhere, ROLL_WO_SELECT, workOrdersOfRoll } from "./work-order-facts";

export interface FirmCustomerRow { cariKartId: string | null; ad: string | null; top: number; metre: string }
export interface FirmProductRow { urunId: string; urunAdi: string | null; renkId: string | null; renkAdi: string | null; top: number; metre: string }
export interface FirmRollFacts {
  acikTop: number;
  enEskiGonderim: string | null;
  isEmriSayisi: number;
  musteriler: FirmCustomerRow[];
  urunler: FirmProductRow[];
}
export interface SubcontractRollFacts {
  acikTop: number;
  isEmriSayisi: number;
  musteriSayisi: number;
  firmalar: Map<string, FirmRollFacts>;
}

type Bucket = { top: number; qty: Prisma.Decimal };
type FirmAcc = { rolls: number; oldest: Date | null; wos: Set<string>; customers: Map<string, Bucket>; products: Map<string, Bucket> };

const bump = (m: Map<string, Bucket>, k: string, qty: Prisma.Decimal): void => {
  const b = m.get(k) ?? { top: 0, qty: new Prisma.Decimal(0) };
  b.top++;
  b.qty = b.qty.plus(qty);
  m.set(k, b);
};
/** Sıra fabrikada: top ↓ · metre ↓ · ad. */
const byTop = <T extends { top: number; metre: string }>(label: (r: T) => string) => (a: T, b: T): number =>
  b.top - a.top || new Prisma.Decimal(b.metre).comparedTo(a.metre) || label(a).localeCompare(label(b), "tr");

/** İE → ilk müşteri (İE listesinin "Müşteri" kolonuyla aynı çözüm). */
async function firstCustomerOfWorkOrders(woIds: string[]): Promise<Map<string, { id: string; name: string }>> {
  if (woIds.length === 0) return new Map();
  const wos = await prisma.workOrder.findMany({
    where: { id: { in: woIds } },
    select: { id: true, steps: { select: { id: true, stepSequence: true } }, orderLinks: { ...WO_LIST_CUSTOMER_LINKS, where: ACTIVE_ORDER_LINK }, customer: { select: { id: true, name: true } } },
  });
  const withMeters = await new WorkOrderService().withProductionMeters(wos);
  return new Map(withMeters.flatMap((w) => (w.customers[0] ? [[w.id, w.customers[0]] as const] : [])));
}

function toFirmFacts(f: FirmAcc, customerNames: Map<string, string>, items: Map<string, string>, colors: Map<string, string>): FirmRollFacts {
  return {
    acikTop: f.rolls,
    enEskiGonderim: f.oldest?.toISOString() ?? null,
    isEmriSayisi: f.wos.size,
    musteriler: [...f.customers.entries()]
      .map(([id, b]) => ({ cariKartId: id || null, ad: id ? customerNames.get(id) ?? null : null, top: b.top, metre: b.qty.toFixed(3) }))
      .sort(byTop((r) => r.ad ?? "")),
    urunler: [...f.products.entries()]
      .map(([k, b]) => {
        const [urunId, renkId] = k.split("|") as [string, string];
        return { urunId, urunAdi: items.get(urunId) ?? null, renkId: renkId || null, renkAdi: renkId ? colors.get(renkId) ?? null : null, top: b.top, metre: b.qty.toFixed(3) };
      })
      .sort(byTop((r) => `${r.urunAdi ?? ""} ${r.renkAdi ?? ""}`)),
  };
}

/** Firmada duran topların kırılımı; bir top birden çok firmada açık kalemliyse her birinde sayılır (süzgeç ikizi). */
export async function loadSubcontractRollFacts(): Promise<SubcontractRollFacts> {
  const rolls = await prisma.roll.findMany({
    where: firmRollWhere(),
    select: {
      id: true, currentQty: true, itemId: true, colorId: true, ownerCustomerId: true, ...ROLL_WO_SELECT,
      dispatchItems: { where: outstandingItemOfOpenDispatch(), select: { dispatch: { select: { subcontractorId: true, dispatchedAt: true } } } },
    },
  });
  const woOfRoll = new Map(rolls.map((r) => [r.id, workOrdersOfRoll(r)]));
  const firstCustomer = await firstCustomerOfWorkOrders([...new Set([...woOfRoll.values()].flat())]);
  const names = new Map<string, string>();
  for (const c of firstCustomer.values()) names.set(c.id, c.name);
  const owners = [...new Set(rolls.map((r) => r.ownerCustomerId).filter((x): x is string => !!x && !names.has(x)))];
  for (const c of owners.length ? await prisma.customer.findMany({ where: { id: { in: owners } }, select: { id: true, name: true } }) : []) names.set(c.id, c.name);

  const firms = new Map<string, FirmAcc>();
  const allWos = new Set<string>();
  const allCustomers = new Set<string>();
  for (const r of rolls) {
    const wos = woOfRoll.get(r.id) ?? [];
    const customer = (wos[0] ? firstCustomer.get(wos[0])?.id : undefined) ?? r.ownerCustomerId ?? "";
    for (const w of wos) allWos.add(w);
    if (customer) allCustomers.add(customer);
    const seen = new Set<string>();
    for (const it of r.dispatchItems) {
      const id = it.dispatch.subcontractorId;
      const f = firms.get(id) ?? { rolls: 0, oldest: null, wos: new Set<string>(), customers: new Map(), products: new Map() };
      if (!f.oldest || it.dispatch.dispatchedAt < f.oldest) f.oldest = it.dispatch.dispatchedAt;
      firms.set(id, f);
      if (seen.has(id)) continue;
      seen.add(id);
      f.rolls++;
      for (const w of wos) f.wos.add(w);
      bump(f.customers, customer, r.currentQty);
      bump(f.products, `${r.itemId}|${r.colorId ?? ""}`, r.currentQty);
    }
  }
  const items = new Map((await prisma.item.findMany({ where: { id: { in: [...new Set(rolls.map((r) => r.itemId))] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const colorIds = [...new Set(rolls.map((r) => r.colorId).filter((x): x is string => !!x))];
  const colors = new Map((colorIds.length ? await prisma.color.findMany({ where: { id: { in: colorIds } }, select: { id: true, name: true } }) : []).map((x) => [x.id, x.name]));
  return {
    acikTop: rolls.length,
    isEmriSayisi: allWos.size,
    musteriSayisi: allCustomers.size,
    firmalar: new Map([...firms.entries()].map(([id, f]) => [id, toFirmFacts(f, names, items, colors)])),
  };
}
