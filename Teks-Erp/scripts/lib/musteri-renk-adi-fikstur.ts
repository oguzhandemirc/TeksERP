// =============================================================================
// MÜŞTERİ RENK ADI — DB'li altın fikstürü (`test_shipment_doc_customer_name` §0)
// =============================================================================
// Tasarım: docs/design/MUSTERI-KUMAS-RENK-ADI.md §6 "Ölçü". Vaat: "kumaşa özel ad
// girilmedikçe hiçbir çıktı değişmez". Bu dosya o vaadin ölçüsünü kurar: çözücüyü
// GERÇEKTEN koşan her yüzeyin yanıtı, kimlikleri sembole çevrilmiş olarak
// `musteri-renk-adi-altin.json`daki altınla bayt bayt karşılaştırılır.
//
// Fikstür (kumaşa özel satır YOK): A carisi, renk EKRU'ya GENEL adı var; X, Y, Z
// kumaşları aynı renkte. Sipariş satırı: X/EKRU "ABC" · Y/EKRU adsız · Z'nin satırı
// yok. Böylece bugünkü GENİŞ kademe (Y ve Z, X'in satır adını alır) altına girer.
// =============================================================================
import prisma from "../../src/lib/prisma";
import { ItemType, Prisma, PrintedDocType, RollStatus, ShipmentStatus } from "@prisma/client";
import { shippingService } from "../../src/services/shipping.service";
import { printedDocumentService } from "../../src/services/printed-document.service";
import { LabelService } from "../../src/services/label.service";
import { sackSearchService } from "../../src/services/sack-search.service";
import { detectMismatchesForSacks } from "../../src/services/helpers/sack-content-mismatch.helper";
import { CustomerAliasService } from "../../src/services/customer-alias.service";

export interface AltinFikstur {
  P: string;
  id: Record<string, string>;
}

/** Sembol → gerçek id. Normalleştirici tersini kullanır. */
function kaydet(f: AltinFikstur, ad: string, id: string): string {
  f.id[ad] = id;
  return id;
}

async function kurAnaVeri(f: AltinFikstur): Promise<void> {
  const { P } = f;
  for (const c of ["A", "B"]) {
    const r = await prisma.customer.create({ data: { code: `${P}-C${c}`, name: `${P} MUSTERI ${c}` }, select: { id: true } });
    kaydet(f, `C_${c}`, r.id);
  }
  const renk = await prisma.color.create({ data: { code: `${P}-K`, name: `${P} EKRU` }, select: { id: true } });
  kaydet(f, "K", renk.id);
  for (const i of ["X", "Y", "Z"]) {
    const r = await prisma.item.create({
      data: { code: `${P}-I${i}`, name: `${P} KUMAS ${i}`, itemType: ItemType.FABRIC },
      select: { id: true },
    });
    kaydet(f, `I_${i}`, r.id);
  }
  await prisma.customerColorAlias.create({ data: { customerId: f.id.C_A, colorId: f.id.K, alias: "GENEL-EKRU" } });
  await prisma.customerItemAlias.create({ data: { customerId: f.id.C_A, itemId: f.id.I_X, alias: "MASTER-X" } });
}

async function kurSiparisSevk(f: AltinFikstur): Promise<void> {
  const { P } = f;
  const order = await prisma.order.create({
    data: { orderNumber: `${P}-O`, customerId: f.id.C_A, orderDate: new Date() },
    select: { id: true },
  });
  kaydet(f, "O", order.id);
  // Satırlar AYRI yaratılır, createdAt açık: aynı ifadede doğan satırlar eşit
  // damga alır ve çözücünün sırası id'ye (rastgele) düşerdi.
  const t0 = Date.now() - 60_000;
  const lx = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: f.id.I_X, colorId: f.id.K, quantity: new Prisma.Decimal(100), customerColorName: "ABC", createdAt: new Date(t0) },
    select: { id: true },
  });
  kaydet(f, "L_X", lx.id);
  const ly = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: f.id.I_Y, colorId: f.id.K, quantity: new Prisma.Decimal(100), createdAt: new Date(t0 + 1000) },
    select: { id: true },
  });
  kaydet(f, "L_Y", ly.id);
  const sh = await prisma.shipment.create({
    data: { shipmentNo: `${P}-S`, customerId: f.id.C_A, status: ShipmentStatus.PLANNED, orders: { create: [{ orderId: order.id }] } },
    select: { id: true },
  });
  kaydet(f, "S", sh.id);
  const sk = await prisma.sack.create({ data: { sackNo: `${P}-CV1`, seq: 1, shipmentId: sh.id, customerId: f.id.C_A }, select: { id: true } });
  kaydet(f, "SK", sk.id);
  const sk2 = await prisma.sack.create({ data: { sackNo: `${P}-CV2`, seq: 2, customerId: f.id.C_B }, select: { id: true } });
  kaydet(f, "SK2", sk2.id);
}

async function kurToplar(f: AltinFikstur): Promise<void> {
  const toplar: Array<[string, string, string, string | null, string | null]> = [
    ["R_X", "I_X", "SK", "C_A", "S"],
    ["R_Y", "I_Y", "SK", null, "S"],
    ["R_Z", "I_Z", "SK", "C_B", "S"],
    ["R_W", "I_X", "SK2", "C_A", null],
  ];
  let n = 0;
  for (const [ad, item, sack, labelC, sh] of toplar) {
    n++;
    const r = await prisma.roll.create({
      data: {
        barcode: `${f.P}-R${n}`,
        itemId: f.id[item],
        colorId: f.id.K,
        initialQty: new Prisma.Decimal(50 + n),
        currentQty: new Prisma.Decimal(50 + n),
        width: new Prisma.Decimal(150),
        status: RollStatus.WAREHOUSE,
        sackId: f.id[sack],
        shipmentId: sh ? f.id[sh] : null,
        labelCustomerId: labelC ? f.id[labelC] : null,
      },
      select: { id: true },
    });
    kaydet(f, ad, r.id);
  }
}

export async function kurAltinFikstur(onEk: string): Promise<AltinFikstur> {
  const f: AltinFikstur = { P: onEk, id: {} };
  await kurAnaVeri(f);
  await kurSiparisSevk(f);
  await kurToplar(f);
  return f;
}

// ── Normalleştirici ────────────────────────────────────────────────────────
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** `colorNameScope` altın DIŞIDIR (yeni alan): çıkarılır, değeri ayrıca toplanır. */
export function normalize(f: AltinFikstur, v: unknown, scopes: unknown[]): unknown {
  const bySym = new Map(Object.entries(f.id).map(([k, id]) => [id, `<${k}>`]));
  const walk = (x: unknown): unknown => {
    if (x instanceof Date) return "<T>";
    if (x instanceof Prisma.Decimal) return x.toString();
    if (typeof x === "string") {
      if (ISO.test(x)) return "<T>";
      return x.split(f.P).join("P").replace(UUID, (m) => bySym.get(m) ?? "<uuid>");
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
        if (k === "colorNameScope") {
          scopes.push(val);
          continue;
        }
        out[k] = walk(val);
      }
      return out;
    }
    return x;
  };
  return walk(v);
}

const labels = new LabelService();
const aliases = new CustomerAliasService();

type Dokum = { sackNo: string; rolls: Array<{ barcode: string; musterideki: unknown; etiket: unknown }> };

async function etiketler(f: AltinFikstur): Promise<Record<string, unknown>> {
  const { id } = f;
  const out: Record<string, unknown> = {};
  const baglamlar: Array<[string, string, { orderLineId?: string; customerId?: string; stock?: boolean }]> = [
    ["X+L_X", id.R_X, { orderLineId: id.L_X }],
    ["Y+L_Y", id.R_Y, { orderLineId: id.L_Y }],
    ["Y+L_X", id.R_Y, { orderLineId: id.L_X }],
    ["Z+C_A", id.R_Z, { customerId: id.C_A }],
    ["X+C_A", id.R_X, { customerId: id.C_A }],
    ["X+stok", id.R_X, { stock: true }],
  ];
  for (const [ad, rollId, opts] of baglamlar) {
    const { printedAt: _p, ...payload } = (await labels.getRollLabel(rollId, opts)).data;
    out[`etiket:${ad}`] = payload;
  }
  const onizlemeler: Array<[string, { rollId: string; orderLineId?: string; customerId?: string }]> = [
    ["X+L_X", { rollId: id.R_X, orderLineId: id.L_X }],
    ["Y+L_Y", { rollId: id.R_Y, orderLineId: id.L_Y }],
    ["Z+C_A", { rollId: id.R_Z, customerId: id.C_A }],
    ["Y+C_A", { rollId: id.R_Y, customerId: id.C_A }],
  ];
  for (const [ad, input] of onizlemeler) {
    out[`onizleme:${ad}`] = (await labels.previewCustomerNames(input)).data;
  }
  return out;
}

async function cuvallar(f: AltinFikstur): Promise<Record<string, unknown>> {
  const { id } = f;
  const icerik = (await sackSearchService.getSackContents(id.SK)).data as {
    rolls: Array<{ barcode: string; musterideki: unknown; etiket: unknown }>;
  };
  const dokum = (await sackSearchService.getContentDump([id.SK, id.SK2])).data as Dokum[];
  const uyusmaz = await detectMismatchesForSacks([id.SK, id.SK2]);
  const topla = (rs: Array<{ barcode: string; musterideki: unknown; etiket: unknown }>) =>
    [...rs].sort((a, b) => a.barcode.localeCompare(b.barcode)).map((r) => ({ barcode: r.barcode, musterideki: r.musterideki, etiket: r.etiket }));
  return {
    cuvalIcerik: topla(icerik.rolls),
    dokum: [...dokum].sort((a, b) => a.sackNo.localeCompare(b.sackNo)).map((s) => ({ sackNo: s.sackNo, rolls: topla(s.rolls) })),
    uyusmazlik: [id.SK, id.SK2].map((s) => [...(uyusmaz.get(s) ?? [])].sort((a, b) => (a.barcode ?? "").localeCompare(b.barcode ?? ""))),
  };
}

async function sevkYuzeyleri(f: AltinFikstur): Promise<Record<string, unknown>> {
  const { id } = f;
  const taslak = (await shippingService.getDispatchReport(id.S)).data as { products: unknown; cekiRows: unknown };
  const sevk = (await shippingService.getShipmentById(id.S)).data as { orders: unknown };
  const acik = (await shippingService.listOpenOrdersWithCoverage({ customerId: id.C_A })).data as Array<{
    order: { id: string };
    lines: unknown;
  }>;
  const oneri: Record<string, unknown> = {};
  for (const [ad, item, color] of [["X", id.I_X, id.K], ["Y", id.I_Y, id.K], ["Z", id.I_Z, id.K], ["Z-renksiz", id.I_Z, null]] as const) {
    oneri[`oneri:${ad}`] = await aliases.lookupAlias(id.C_A, item, color);
  }
  return {
    taslak: { products: taslak.products, cekiRows: taslak.cekiRows },
    sevkiyat: sevk.orders,
    acikSiparis: acik.find((o) => o.order.id === id.O)?.lines ?? null,
    ...oneri,
  };
}

/** Sevkiyatı DISPATCHED'e çekip irsaliyeyi dondurur ve donmuş çekirdeği döner. */
export async function dondurVeOku(f: AltinFikstur): Promise<{ products: unknown; cekiRows: unknown }> {
  await prisma.shipment.update({ where: { id: f.id.S }, data: { status: ShipmentStatus.DISPATCHED, dispatchedAt: new Date() } });
  await prisma.$transaction(async (tx) => {
    await printedDocumentService.freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, f.id.S);
  });
  const cur = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, f.id.S)).data as {
    snapshot: { doc: { products: unknown; cekiRows: unknown } };
  };
  return { products: cur.snapshot.doc.products, cekiRows: cur.snapshot.doc.cekiRows };
}

/** Bütün yüzeyleri toplar (sevkiyat PLANNED iken) — dondurma EN SON. */
export async function toplaYuzeyler(f: AltinFikstur): Promise<Record<string, unknown>> {
  return {
    ...(await sevkYuzeyleri(f)),
    ...(await etiketler(f)),
    ...(await cuvallar(f)),
    donmus: await dondurVeOku(f),
  };
}

/** Fikstürün yarattığı her satırı kimliğiyle siler (hatırlanan id; tarama yok). */
export async function teardownAltinFikstur(f: AltinFikstur | null): Promise<void> {
  if (!f) return;
  const { id } = f;
  const rolls = ["R_X", "R_Y", "R_Z", "R_W"].map((k) => id[k]).filter(Boolean);
  const hepsi = <T>(p: Promise<T>) => p.catch(() => undefined);
  if (id.S) await hepsi(prisma.printedDocument.deleteMany({ where: { sourceId: id.S } }));
  if (rolls.length) await hepsi(prisma.roll.deleteMany({ where: { id: { in: rolls } } }));
  for (const s of [id.SK, id.SK2].filter(Boolean)) {
    await hepsi(prisma.sackAllocation.deleteMany({ where: { sackId: s } }));
    await hepsi(prisma.sack.deleteMany({ where: { id: s } }));
  }
  if (id.S) {
    await hepsi(prisma.shipmentOrder.deleteMany({ where: { shipmentId: id.S } }));
    await hepsi(prisma.shipment.deleteMany({ where: { id: id.S } }));
  }
  if (id.O) {
    await hepsi(prisma.orderLine.deleteMany({ where: { orderId: id.O } }));
    await hepsi(prisma.order.deleteMany({ where: { id: id.O } }));
  }
  for (const c of [id.C_A, id.C_B].filter(Boolean)) {
    await hepsi(prisma.customerItemAlias.deleteMany({ where: { customerId: c } }));
    await hepsi(prisma.customerColorAlias.deleteMany({ where: { customerId: c } }));
  }
  for (const i of [id.I_X, id.I_Y, id.I_Z].filter(Boolean)) await hepsi(prisma.item.deleteMany({ where: { id: i } }));
  if (id.K) await hepsi(prisma.color.deleteMany({ where: { id: id.K } }));
  for (const c of [id.C_A, id.C_B].filter(Boolean)) await hepsi(prisma.customer.deleteMany({ where: { id: c } }));
}
