// =============================================================================
// MÜŞTERİ RENK ADI — kumaşa özel ad (§11) ve §1-i onarımı (§12) bölümleri
// =============================================================================
// `test_shipment_doc_customer_name`in parçası; tasarım MUSTERI-KUMAS-RENK-ADI.md.
// §11: kumaşa özel ad girilince etiket = önizleme = irsaliye = çeki = belge
//      Excel'i (snapshot) = ekranlar aynı adı ve `colorNameScope='ITEM'` verir;
//      donmuş belge değişmez, yeniden basım yeni adı alır; izinsiz sipariş
//      detayı ana veri kademesini taşımaz.
// §12: aynı sevk + aynı renk + iki kumaşta FARKLI satır adı — her kumaş kendi
//      satır adını alır, irsaliye etiketle hizalanır (karar 3).
// =============================================================================
import prisma from "../../src/lib/prisma";
import { ItemType, Prisma, PrintedDocType, RollStatus, ShipmentStatus } from "@prisma/client";
import type { Request, Response } from "express";
import { shippingService } from "../../src/services/shipping.service";
import { printedDocumentService } from "../../src/services/printed-document.service";
import { LabelService } from "../../src/services/label.service";
import { sackSearchService } from "../../src/services/sack-search.service";
import { CustomerAliasService } from "../../src/services/customer-alias.service";
import { orderDetailHandler } from "../../src/routes/order.routes";
import type { AltinFikstur } from "./musteri-renk-adi-fikstur";
import { hedefDbEngeli } from "./hedef-db-kapisi";

export type Check = (label: string, ok: boolean, extra?: string) => void;

const labels = new LabelService();
const aliases = new CustomerAliasService();

type Satir = { lineId: string; customerColorName: string | null; colorNameScope?: string | null };
type DocCore = {
  products: Array<{ name: string; customerColorOnly?: string | null }>;
  cekiRows: Array<{ rollId: string; customerVaryant?: string | null }>;
};

async function belgeCekirdegi(shipmentId: string): Promise<DocCore> {
  const cur = (await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, shipmentId)).data as {
    snapshot: { doc: DocCore };
  };
  return cur.snapshot.doc;
}

const urunRengi = (d: DocCore, kumasAdi: string): string | null =>
  d.products.find((p) => p.name.includes(kumasAdi))?.customerColorOnly ?? null;
const cekiRengi = (d: DocCore, rollId: string): string | null =>
  d.cekiRows.find((r) => r.rollId === rollId)?.customerVaryant ?? null;

/** Sipariş detayı ucunu sunucusuz koşar (izin dalı route handler'ında yaşar). */
async function siparisDetayi(orderId: string, permissions: string[]): Promise<Array<Satir & { resolvedCustomerColorName?: string | null }>> {
  let govde: unknown = null;
  let hata: unknown = null;
  const req = { params: { id: orderId }, user: { permissions } } as unknown as Request;
  const res = { status: () => res, json: (b: unknown) => { govde = b; return res; } } as unknown as Response;
  await orderDetailHandler(req, res, (e?: unknown) => { hata = e; });
  if (hata) throw hata;
  return ((govde as { data: { lines: Array<Satir & { id: string }> } }).data.lines).map((l) => ({ ...l, lineId: l.id }));
}

async function ozelYuzeyler(f: AltinFikstur, check: Check): Promise<void> {
  const { id } = f;
  const onz = (await labels.previewCustomerNames({ rollId: id.R_Y, orderLineId: id.L_Y })).data;
  const etk = (await labels.getRollLabel(id.R_Y, { orderLineId: id.L_Y })).data;
  const sevk = ((await shippingService.getShipmentById(id.S)).data as { orders: Array<{ lines: Satir[] }> }).orders
    .flatMap((o) => o.lines).find((l) => l.lineId === id.L_Y);
  const acik = ((await shippingService.listOpenOrdersWithCoverage({ customerId: id.C_A })).data as Array<{ lines: Satir[] }>)
    .flatMap((o) => o.lines).find((l) => l.lineId === id.L_Y);
  const sip = (await siparisDetayi(id.O, ["order:read", "customer-alias:read"])).find((l) => l.lineId === id.L_Y);
  const adlar = [onz.colorName, etk.colorName, sevk?.customerColorName, acik?.customerColorName, sip?.resolvedCustomerColorName];
  const kapsamlar = [onz.colorNameScope, etk.colorNameScope, sevk?.colorNameScope, acik?.colorNameScope, sip?.colorNameScope];
  check("⭐ name-preview = rolls/:id = shipments/:id = open-orders = orders/:id aynı kumaşa özel adı verir",
    adlar.every((a) => a === "Y-OZEL"), JSON.stringify(adlar));
  check("⭐ …ve beşi de colorNameScope='ITEM'", kapsamlar.every((k) => k === "ITEM"), JSON.stringify(kapsamlar));
  check("colorNameSource='MASTER' ⇔ colorNameScope≠null (önizleme + etiket)",
    onz.colorNameSource === "MASTER" && etk.colorNameSource === "MASTER");

  const x = (await labels.getRollLabel(id.R_X, { orderLineId: id.L_X })).data;
  const z = (await labels.previewCustomerNames({ rollId: id.R_Z, customerId: id.C_A })).data;
  check("başka kumaş etkilenmez: X satır adı (OVERRIDE, scope null)", x.colorName === "ABC" && x.colorNameScope === null,
    `${x.colorName}/${String(x.colorNameScope)}`);
  check("başka kumaş etkilenmez: Z genel ad (scope CUSTOMER)", z.colorName === "GENEL-EKRU" && z.colorNameScope === "CUSTOMER",
    `${z.colorName}/${String(z.colorNameScope)}`);

  const oneriY = await aliases.lookupAlias(id.C_A, id.I_Y, id.K);
  const oneriZ = await aliases.lookupAlias(id.C_A, id.I_Z, id.K);
  check("/aliases/suggest önce kumaşa özeli verir, başka kumaşta genel", oneriY.colorAlias === "Y-OZEL" && oneriZ.colorAlias === "GENEL-EKRU");

  const icerik = (await sackSearchService.getSackContents(id.SK)).data as { rolls: Array<{ id: string; musterideki: { colorName: string | null } }> };
  const dokum = (await sackSearchService.getContentDump([id.SK])).data as Array<{ rolls: Array<{ id: string; musterideki: { colorName: string | null } }> }>;
  check("çuval içeriği + döküm kumaşa özel kademeyi görür",
    icerik.rolls.find((r) => r.id === id.R_Y)?.musterideki.colorName === "Y-OZEL" &&
      dokum[0]?.rolls.find((r) => r.id === id.R_Y)?.musterideki.colorName === "Y-OZEL");
}

async function izinDali(f: AltinFikstur, check: Check): Promise<void> {
  const { id } = f;
  const izinsiz = await siparisDetayi(id.O, ["order:read"]);
  const ly = izinsiz.find((l) => l.lineId === id.L_Y);
  const lx = izinsiz.find((l) => l.lineId === id.L_X);
  check("⭐ izinsiz sipariş detayı ana veri kademesini TAŞIMAZ (Y: null, scope null)",
    ly?.resolvedCustomerColorName === null && ly?.colorNameScope === null,
    `${String(ly?.resolvedCustomerColorName)}/${String(ly?.colorNameScope)}`);
  check("izinsiz: satır adı yine taşınır (X: ABC = line.customerColorName)",
    lx?.resolvedCustomerColorName === lx?.customerColorName && lx?.resolvedCustomerColorName === "ABC");
  const joker = (await siparisDetayi(id.O, ["*"])).find((l) => l.lineId === id.L_Y);
  check("süperadmin '*' ana veri kademesini alır", joker?.resolvedCustomerColorName === "Y-OZEL");
}

async function donmaVeReissue(f: AltinFikstur, check: Check): Promise<void> {
  const { id, P } = f;
  const donmus = await belgeCekirdegi(id.S);
  check("⭐ donmuş irsaliye kumaşa özel ad girilince DEĞİŞMEZ (Y hâlâ geniş kademe ABC)",
    urunRengi(donmus, `${P} KUMAS Y`) === "ABC" && cekiRengi(donmus, id.R_Y) === "ABC",
    `${urunRengi(donmus, `${P} KUMAS Y`)}/${cekiRengi(donmus, id.R_Y)}`);
  await printedDocumentService.reissue(PrintedDocType.SHIPMENT_DISPATCH, id.S, "kumaşa özel ad bekçisi");
  const yeni = await belgeCekirdegi(id.S);
  check("⭐ yeniden basım yeni adı alır: irsaliye ürün satırı + çeki = etiket (Y-OZEL)",
    urunRengi(yeni, `${P} KUMAS Y`) === "Y-OZEL" && cekiRengi(yeni, id.R_Y) === "Y-OZEL",
    `${urunRengi(yeni, `${P} KUMAS Y`)}/${cekiRengi(yeni, id.R_Y)}`);
  check("…X satır adını, Z geniş kademeyi korur (kumaşa özel adı yok)",
    urunRengi(yeni, `${P} KUMAS X`) === "ABC" && urunRengi(yeni, `${P} KUMAS Z`) === "ABC");
}

export async function ozelAdBolumu(f: AltinFikstur, check: Check): Promise<void> {
  console.log("\n§11 — KUMAŞA ÖZEL AD: bütün yüzeyler aynı adı ve kademeyi verir");
  const { id } = f;
  await aliases.upsertItemColorAlias({ customerId: id.C_A, itemId: id.I_Y, colorId: id.K }, "y-ozel");
  await ozelYuzeyler(f, check);
  await izinDali(f, check);
  await donmaVeReissue(f, check);
}

// ── §12 — §1-i: aynı sevk + aynı renk + iki kumaşta farklı satır adı ─────────
const BIRI: Record<string, string> = {};

async function kurBirI(onEk: string): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const cust = await prisma.customer.create({ data: { code: `${onEk}-C`, name: `${onEk} MUSTERI` }, select: { id: true } });
  BIRI.C = cust.id;
  BIRI.K = (await prisma.color.create({ data: { code: `${onEk}-K`, name: `${onEk} EKRU` }, select: { id: true } })).id;
  for (const i of ["X", "Y"]) {
    BIRI[`I_${i}`] = (await prisma.item.create({ data: { code: `${onEk}-I${i}`, name: `${onEk} KUMAS ${i}`, itemType: ItemType.FABRIC }, select: { id: true } })).id;
  }
  BIRI.O = (await prisma.order.create({ data: { orderNumber: `${onEk}-O`, customerId: BIRI.C, orderDate: new Date() }, select: { id: true } })).id;
  const t0 = Date.now() - 60_000;
  const satir = async (i: string, ad: string, dt: number) =>
    (await prisma.orderLine.create({
      data: { orderId: BIRI.O, itemId: BIRI[`I_${i}`], colorId: BIRI.K, quantity: new Prisma.Decimal(10), customerColorName: ad, createdAt: new Date(t0 + dt) },
      select: { id: true },
    })).id;
  BIRI.L_X = await satir("X", "ABC", 0);
  BIRI.L_Y = await satir("Y", "CBA", 1000);
  BIRI.S = (await prisma.shipment.create({
    data: { shipmentNo: `${onEk}-S`, customerId: BIRI.C, status: ShipmentStatus.PLANNED, orders: { create: [{ orderId: BIRI.O }] } },
    select: { id: true },
  })).id;
  BIRI.SK = (await prisma.sack.create({ data: { sackNo: `${onEk}-CV`, seq: 1, shipmentId: BIRI.S, customerId: BIRI.C }, select: { id: true } })).id;
  for (const [n, i] of [[1, "X"], [2, "Y"]] as const) {
    BIRI[`R_${i}`] = (await prisma.roll.create({
      data: {
        barcode: `${onEk}-R${n}`, itemId: BIRI[`I_${i}`], colorId: BIRI.K, initialQty: new Prisma.Decimal(10), currentQty: new Prisma.Decimal(10),
        width: new Prisma.Decimal(150), status: RollStatus.WAREHOUSE, sackId: BIRI.SK, shipmentId: BIRI.S,
      },
      select: { id: true },
    })).id;
  }
}

export async function birIBolumu(onEk: string, check: Check): Promise<void> {
  console.log("\n§12 — §1-i: aynı sevkte aynı renkte iki kumaşın FARKLI satır adı — irsaliye etiketle hizalı");
  await kurBirI(onEk);
  const taslak = (await shippingService.getDispatchReport(BIRI.S)).data as DocCore;
  const etiketY = (await labels.getRollLabel(BIRI.R_Y, { orderLineId: BIRI.L_Y })).data;
  check("⭐ Y ürün satırı kendi satır adını basar (CBA; eskiden X'in ABC'si)",
    urunRengi(taslak, "KUMAS Y") === "CBA", String(urunRengi(taslak, "KUMAS Y")));
  check("⭐ Y çeki satırı = Y etiketi (CBA)", cekiRengi(taslak, BIRI.R_Y) === "CBA" && etiketY.colorName === "CBA",
    `${cekiRengi(taslak, BIRI.R_Y)} / etiket ${etiketY.colorName}`);
  check("X kendi satır adını korur (ABC)", urunRengi(taslak, "KUMAS X") === "ABC" && cekiRengi(taslak, BIRI.R_X) === "ABC");
}

export async function teardownBirI(): Promise<void> {
  const sus = <T>(p: Promise<T>) => p.catch(() => undefined);
  const rolls = [BIRI.R_X, BIRI.R_Y].filter(Boolean);
  if (BIRI.S) await sus(prisma.printedDocument.deleteMany({ where: { sourceId: BIRI.S } }));
  if (rolls.length) await sus(prisma.roll.deleteMany({ where: { id: { in: rolls } } }));
  if (BIRI.SK) await sus(prisma.sack.deleteMany({ where: { id: BIRI.SK } }));
  if (BIRI.S) {
    await sus(prisma.shipmentOrder.deleteMany({ where: { shipmentId: BIRI.S } }));
    await sus(prisma.shipment.deleteMany({ where: { id: BIRI.S } }));
  }
  if (BIRI.O) {
    await sus(prisma.orderLine.deleteMany({ where: { orderId: BIRI.O } }));
    await sus(prisma.order.deleteMany({ where: { id: BIRI.O } }));
  }
  for (const i of [BIRI.I_X, BIRI.I_Y].filter(Boolean)) await sus(prisma.item.deleteMany({ where: { id: i } }));
  if (BIRI.K) await sus(prisma.color.deleteMany({ where: { id: BIRI.K } }));
  if (BIRI.C) await sus(prisma.customer.deleteMany({ where: { id: BIRI.C } }));
}
