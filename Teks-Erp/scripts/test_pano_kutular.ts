// =============================================================================
// Test: Açılış panosu KUTU mimarisi (`GET /pano/kutular` + `GET /pano?kutular=…`) servis bekçisi
// Çalıştır: npx tsx scripts/test_pano_kutular.ts
// =============================================================================
// §1 KATALOG: '*' → kapısı açık her kutu, alanlar tam; yalnız `report:sales` → yalnız satış kutuları;
//    kapalı modülün kutusu listede YOK (modül durumu ölçülerek beklenti kurulur).
// §2 FAIL-CLOSED: tanınmayan anahtar 400 `PANO_BOX_UNKNOWN`, boş liste 400, sorgu şeması (gun/ay yalnız
//    kutularla, geçersiz gün, bilinmeyen parametre).
// §3 SIFIR SORGU: izinsiz kutu yalnız erişim bağlamı kadar sorgu atar; tek kutu yalnız kendi kaynağını
//    okur (isEmriDurum = 1, uretim = 2 sorgu). Negatif sonda: kapı kontrolü kaldırılınca KIRMIZI.
// §4 ÖLÇÜM: varsayılan kutular TEK istekte vs kutu başına ayrı istek — sorgu sayıları basılır;
//    toplu istek ≤ ayrı isteklerin toplamı ve bütçe tavanı.
// §5 FİKSTÜR (2099-03-15, `now` parametresiyle): ciro (fiyatsız satır sayılmaz), tahsilat (iptal düşer),
//    nakit (virman hariç), en çok müşteri, stok giriş–çıkış (transfer/TRANSFORM hariç), iplik kg,
//    ajanda (kapalı alış siparişi dışarıda), açık iş emri / planlı sevkiyat DELTA ile.
// §6 FABRİKA DİLİMİ: yerel 00:30 (UTC dün 21:30) hareketi BUGÜN "00" kovasında ve ajanda 15 Mart'ında.
//    Negatif sonda: kova ifadesi UTC'ye çevrilince KIRMIZI.
// §7 KARNE EŞİTLİĞİ: istasyon kutusu = WIP karnesi, kalite kutusu = Kalite + Fire karnesi alanları;
//    eski `GET /pano` yanıtı = aynı kutuların seçimli yanıtı (bayt-aynı).
// =============================================================================
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { panoQuerySchema } from "../src/routes/dashboard.routes";
import { getPanoSummary } from "../src/services/dashboard/pano.service";
import { getPanoBoxCatalog, getPanoBoxes, parseBoxKeys } from "../src/services/dashboard/pano-kutular.service";
import { findPanoBox, PANO_BOXES } from "../src/services/dashboard/pano-kutu-katalog";
import { PanoSources, panoGates, type PanoGates } from "../src/services/dashboard/pano-kaynak";
import { resolvePanoPencere, type PanoDonem } from "../src/services/dashboard/pano-donem";
import { defaultAgendaParams, type AgendaParams } from "../src/services/dashboard/pano-kutu-ajanda";
import { loadAccessContext } from "../src/services/reports/semantik/izin";
import { getWipScorecard } from "../src/services/reports/wip-scorecard.report.service";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../src/services/reports/scrap-scorecard.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

let queries = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => { if (capture) queries++; return orig(...args); };
});
async function counted<T>(f: () => Promise<T>): Promise<{ v: T; q: number }> {
  capture = true; queries = 0;
  try { return { v: await f(), q: queries }; } finally { capture = false; }
}

const ALL = { userId: "test-pano-kutu", permissions: ["*"] };
const NONE = { userId: "test-pano-kutu", permissions: [] as string[] };
const SALES = { userId: "test-pano-kutu", permissions: ["report:sales"] };
const TAG = `TEST-PANOK-${Date.now()}`;
const NOW = new Date("2099-03-15T12:00:00.000Z"); // yerel 15:00
const AGENDA: AgendaParams = { gun: "2099-03-15", ay: "2099-03" };
/** Varsayılan kutuların tek istekteki sorgu tavanı (eski panonun 32'si + erişim + kutu payı). */
const BATCH_BUDGET = 45;

const ids = {
  rolls: [] as string[], shipments: [] as string[], orders: [] as string[], items: [] as string[], customers: [] as string[], sacks: [] as string[],
  payments: [] as string[], cashTx: [] as string[], cashBoxes: [] as string[], caris: [] as string[], whMoves: [] as string[], yarnMoves: [] as string[],
  warehouses: [] as string[], pos: [] as string[], wos: [] as string[],
};

const boxes = (donem: PanoDonem, keys: string[], user = ALL, agenda = AGENDA) => getPanoBoxes(donem, keys, { user, agenda, now: NOW });
const allGates = async (): Promise<PanoGates> => {
  const g = panoGates(await loadAccessContext(ALL));
  return Object.fromEntries(Object.keys(g).map((k) => [k, true])) as PanoGates;
};
/** Modül kapısından bağımsız kutu hesabı — sayı doğruluğu ölçümü için (kapı §1'de ayrı ölçülür). */
async function forced<T = Record<string, unknown>>(key: string, donem: PanoDonem = "bugun", agenda = AGENDA): Promise<T> {
  const src = new PanoSources(resolvePanoPencere(donem, NOW), NOW);
  return (await findPanoBox(key)!.compute({ src, can: await allGates(), user: ALL, agenda })) as T;
}
function status400(f: () => unknown, code: string): boolean {
  try { f(); return false; } catch (e) { return e instanceof AppError && e.statusCode === 400 && (e.details as { code?: string } | undefined)?.code === code; }
}

async function fixtures() {
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-Y`, name: `${TAG} İPLİK`, itemType: "YARN" }, select: { id: true } });
  ids.items.push(item.id, yarn.id);
  const cust = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} MÜŞTERİ` }, select: { id: true } });
  ids.customers.push(cust.id);
  const order = await prisma.order.create({
    data: { orderNumber: `${TAG}-O`, customerId: cust.id, orderDate: new Date("2099-03-15T07:00:00.000Z"), status: "APPROVED",
      lines: { create: [{ itemId: item.id, quantity: 200, unitPrice: 10 }, { itemId: item.id, quantity: 30 }] } },
    select: { id: true, lines: { select: { id: true, unitPrice: true } } },
  });
  ids.orders.push(order.id);
  const sh = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S1`, customerId: cust.id, status: "DISPATCHED", dispatchedAt: new Date("2099-03-15T09:00:00.000Z") }, select: { id: true } });
  const planned = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S2`, customerId: cust.id, status: "PLANNED" }, select: { id: true } });
  ids.shipments.push(sh.id, planned.id);
  const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-K`, shipmentId: sh.id, customerId: cust.id }, select: { id: true } });
  ids.sacks.push(sack.id);
  const priced = order.lines.find((l) => l.unitPrice !== null)!;
  const unpriced = order.lines.find((l) => l.unitPrice === null)!;
  await prisma.sackAllocation.createMany({ data: [{ sackId: sack.id, orderLineId: priced.id, qty: 70 }, { sackId: sack.id, orderLineId: unpriced.id, qty: 30 }] });
  const mk = async (qty: number, status: "WAREHOUSE" | "SHIPPED", finalizedAt: Date | null, shipmentId: string | null) => {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${ids.rolls.length}`, itemId: item.id, initialQty: qty, currentQty: qty, status, entrySource: "SUPPLIER_RECEIPT", shipmentId }, select: { id: true } });
    ids.rolls.push(r.id);
    await prisma.$executeRaw`UPDATE "rolls" SET "finalizedAt" = ${finalizedAt} WHERE "id" = ${r.id}::uuid`;
    return r.id;
  };
  const r1 = await mk(100, "WAREHOUSE", new Date("2099-03-15T08:00:00.000Z"), null);
  await mk(100, "SHIPPED", null, sh.id);

  // Depo defteri: giriş 100 (yerel 00:30), çıkış 40; transfer 30 ve TRANSFORM 25 sayılmaz.
  const wh = (await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } }))!;
  const wh2 = await prisma.warehouse.create({ data: { code: `${TAG}-W2`, name: `${TAG} DEPO 2` }, select: { id: true } });
  ids.warehouses.push(wh2.id);
  const mv = async (eventType: "ENTRY" | "SHIPMENT" | "TRANSFER" | "TRANSFORM", qty: number, at: string, from: string | null, to: string | null) => {
    const m = await prisma.warehouseMovement.create({ data: { rollId: r1, eventType, qty, fromWarehouseId: from, toWarehouseId: to, createdAt: new Date(at) }, select: { id: true } });
    ids.whMoves.push(m.id);
  };
  await mv("ENTRY", 100, "2099-03-14T21:30:00.000Z", null, wh.id);
  await mv("SHIPMENT", 40, "2099-03-15T09:00:00.000Z", wh.id, null);
  await mv("TRANSFER", 30, "2099-03-15T09:10:00.000Z", wh.id, wh2.id);
  await mv("TRANSFORM", 25, "2099-03-15T09:20:00.000Z", wh.id, null);
  for (const [kind, qtyKg] of [["IN", 50], ["OUT", 20]] as const) {
    const y = await prisma.yarnMovement.create({ data: { itemId: yarn.id, warehouseId: wh.id, kind, qtyKg, createdAt: new Date("2099-03-15T10:00:00.000Z") }, select: { id: true } });
    ids.yarnMoves.push(y.id);
  }

  // Kasa: tahsilat 1000 + iptal edilen 200 (ters satır aynı gün) + virman 50 (nakit akışına girmez).
  const box = await prisma.cashBox.create({ data: { code: `${TAG}-KS`, name: `${TAG} KASA` }, select: { id: true } });
  ids.cashBoxes.push(box.id);
  let cari = await prisma.cariAccount.findUnique({ where: { customerId: cust.id }, select: { id: true } });
  if (!cari) { cari = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: cust.id }, select: { id: true } }); ids.caris.push(cari.id); }
  const pay = async (n: number, amount: number, cancelled: boolean) => {
    const p = await prisma.payment.create({ data: {
      docNo: `${TAG}-TH${n}`, direction: "IN", method: "CASH", cariId: cari.id, amount, amountTry: amount, cashBoxId: box.id,
      paymentDate: new Date("2099-03-15T06:00:00.000Z"), ...(cancelled ? { status: "CANCELLED", cancelledAt: new Date("2099-03-15T07:00:00.000Z") } : {}),
    }, select: { id: true } });
    ids.payments.push(p.id);
  };
  await pay(1, 1000, false);
  await pay(2, 200, true);
  const tx = await prisma.cashTransaction.create({ data: { docNo: `${TAG}-KH`, kind: "TRANSFER_OUT", transferGroupId: randomUUID(), direction: "OUT", amount: 50, amountTry: 50, cashBoxId: box.id, txnDate: new Date("2099-03-15T06:30:00.000Z") }, select: { id: true } });
  ids.cashTx.push(tx.id);

  // Ajanda: açık alış 15 Mart yerel 00:30 + 16 Mart; KAPALI alış 15 Mart (dışarıda); iş emri 15 Mart.
  const po = async (n: number, expected: string, status: "OPEN" | "CLOSED") => {
    const p = await prisma.purchaseOrder.create({ data: { orderNo: `${TAG}-PO${n}`, orderDate: NOW, expectedDate: new Date(expected), status }, select: { id: true } });
    ids.pos.push(p.id);
  };
  await po(1, "2099-03-14T21:30:00.000Z", "OPEN");
  await po(2, "2099-03-16T08:00:00.000Z", "OPEN");
  await po(3, "2099-03-15T08:00:00.000Z", "CLOSED");
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, plannedStartDate: new Date("2099-03-15T08:00:00.000Z") }, select: { id: true } });
  ids.wos.push(wo.id);
  return { custId: cust.id };
}

async function cleanup(): Promise<void> {
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: ids.sacks } } });
  await prisma.sack.deleteMany({ where: { id: { in: ids.sacks } } });
  await prisma.warehouseMovement.deleteMany({ where: { id: { in: ids.whMoves } } });
  await prisma.yarnMovement.deleteMany({ where: { id: { in: ids.yarnMoves } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  await prisma.cashTransaction.deleteMany({ where: { id: { in: ids.cashTx } } });
  await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
  await prisma.cashBox.deleteMany({ where: { id: { in: ids.cashBoxes } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: ids.caris } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: ids.pos } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
  await prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouses } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

async function catalogAndContract(): Promise<void> {
  console.log("── §1 katalog ──");
  const all = (await getPanoBoxCatalog(ALL)).kutular;
  const can = panoGates(await loadAccessContext(ALL));
  const expected = PANO_BOXES.filter((b) => b.visible(can)).map((b) => b.key);
  check("§1 '*' katalogu = kapısı açık kutular (sıra korunur)", JSON.stringify(all.map((k) => k.anahtar)) === JSON.stringify(expected), `${all.length} kutu`);
  check("§1 her tanım 7 alanlı, boyut/grup sözlükte", all.every((k) => typeof k.baslik === "string" && k.baslik.length > 0 && typeof k.aciklama === "string" && typeof k.donemli === "boolean"
    && typeof k.varsayilan === "boolean" && ["kpi", "kucuk", "orta", "genis"].includes(k.boyut) && ["uretim", "satis", "stok", "fason", "finans", "genel"].includes(k.grup)));
  check("§1 anahtarlar tekil", new Set(PANO_BOXES.map((b) => b.key)).size === PANO_BOXES.length);
  const sales = (await getPanoBoxCatalog(SALES)).kutular.map((k) => k.anahtar);
  check("§1 yalnız report:sales → satış kutuları", JSON.stringify(sales) === JSON.stringify(["sevk", "siparis", "ciro", "egilim", "enCok", "enCokMusteri"]), sales.join(","));
  check("§1 izinsiz kullanıcı → boş katalog", (await getPanoBoxCatalog(NONE)).kutular.length === 0);
  const finOpen = can.finans;
  const hasFin = all.some((k) => k.anahtar === "finans") && all.some((k) => k.anahtar === "nakitAkisi") && all.some((k) => k.anahtar === "tahsilat");
  check(`§1 finans modülü ${finOpen ? "açık → finans kutuları var" : "kapalı → finans kutuları YOK"}`, finOpen ? hasFin : !all.some((k) => k.grup === "finans"));

  console.log("── §2 fail-closed ──");
  check("§2 tanınmayan anahtar 400 PANO_BOX_UNKNOWN", status400(() => parseBoxKeys("uretim,yokBoyleKutu"), "PANO_BOX_UNKNOWN"));
  check("§2 boş liste 400 PANO_BOX_EMPTY", status400(() => parseBoxKeys(" , "), "PANO_BOX_EMPTY"));
  check("§2 tekrar eden anahtar tekilleşir", JSON.stringify(parseBoxKeys("uretim,uretim,sevk")) === JSON.stringify(["uretim", "sevk"]));
  check("§2 gun kutusuz → şema reddeder", !panoQuerySchema.safeParse({ gun: "2099-03-15" }).success);
  check("§2 geçersiz gün (30 Şubat) reddedilir", !panoQuerySchema.safeParse({ kutular: "ajanda", gun: "2099-02-30" }).success);
  check("§2 bilinmeyen parametre reddedilir", !panoQuerySchema.safeParse({ kutular: "uretim", foo: "1" }).success);
  check("§2 geçerli kutulu sorgu kabul", panoQuerySchema.safeParse({ donem: "hafta", kutular: "ajanda", gun: "2099-03-15", ay: "2099-03" }).success);
  const hidden = await boxes("bugun", ["finans", "uretim"], NONE);
  check("§2 bilinen ama izinsiz kutu null (hata değil)", hidden.kutular.finans === null && hidden.kutular.uretim === null);
}

async function queryBudget(): Promise<void> {
  console.log("── §3 sıfır sorgu · §4 ölçüm ──");
  await boxes("bugun", ["uretim"]); // erişim bağlamı önbelleğini ısıt
  const ctxOnly = (await counted(() => boxes("bugun", ["uretim", "finans", "stokHareket"], NONE))).q;
  const wo = (await counted(() => boxes("bugun", ["isEmriDurum"]))).q;
  const prod = (await counted(() => boxes("bugun", ["uretim"]))).q;
  check("§3 izinsiz kutular kutu sorgusu atmaz (yalnız erişim bağlamı)", ctxOnly <= 1, `sorgu=${ctxOnly}`);
  check("§3 isEmriDurum yalnız kendi tek sorgusunu atar", wo - ctxOnly === 1, `${wo}-${ctxOnly}`);
  check("§3 uretim yalnız iki toplamı okur (bu dönem + önceki)", prod - ctxOnly === 2, `${prod}-${ctxOnly}`);
  const defaults = PANO_BOXES.filter((b) => b.byDefault).map((b) => b.key);
  const batch = await counted(() => boxes("bugun", defaults));
  let separate = 0;
  for (const k of defaults) separate += (await counted(() => boxes("bugun", [k]))).q;
  console.log(`   varsayılan ${defaults.length} kutu: tek istek sorgu=${batch.q} · kutu başına ayrı istek toplam sorgu=${separate}`);
  check("§4 toplu istek ayrı isteklerden hafif (kaynak paylaşımı)", batch.q < separate, `${batch.q} < ${separate}`);
  check(`§4 toplu istek bütçesi ≤ ${BATCH_BUDGET}`, batch.q > 0 && batch.q <= BATCH_BUDGET, `sorgu=${batch.q}`);
}

async function fixtureNumbers(custId: string, base: { wo: number; planned: number }): Promise<void> {
  console.log("── §5 fikstür · §6 dilim ──");
  const ciro = await forced<{ tutarlar: Array<{ paraBirimi: string; deger: number; onceki: number; degisimYuzde: number | null }>; fiyatsizSatir: number }>("ciro");
  check("§5 ciro TRY 700 (70 m × 10), önceki 0 → yüzde null", ciro.tutarlar.length === 1 && ciro.tutarlar[0]!.paraBirimi === "TRY" && ciro.tutarlar[0]!.deger === 700 && ciro.tutarlar[0]!.degisimYuzde === null, JSON.stringify(ciro.tutarlar));
  check("§5 fiyatsız satır sıfır sayılmaz, sayılır (1)", ciro.fiyatsizSatir === 1);
  const th = await forced<{ tutarlar: Array<{ paraBirimi: string; deger: number }> }>("tahsilat");
  check("§5 tahsilat net TRY 1000 (iptal edilen 200 düşer)", th.tutarlar.length === 1 && th.tutarlar[0]!.deger === 1000, JSON.stringify(th.tutarlar));
  const nk = await forced<{ paraBirimleri: Array<{ paraBirimi: string; toplamGiris: number; toplamCikis: number; noktalar: Array<{ anahtar: string; giris: number }> }> }>("nakitAkisi");
  const tr = nk.paraBirimleri.find((p) => p.paraBirimi === "TRY");
  check("§5 nakit TRY giriş 1200 / çıkış 200 (virman 50 hariç)", tr?.toplamGiris === 1200 && tr.toplamCikis === 200, JSON.stringify(tr && { g: tr.toplamGiris, c: tr.toplamCikis }));
  check("§6 nakit yerel 09:00 tahsilatı '09' kovasında", tr?.noktalar.find((n) => n.anahtar === "09")?.giris === 1200);
  const mc = await forced<{ siparis: Array<{ musteriId: string; metre: number; siparisAdet: number }>; sevk: Array<{ musteriId: string; metre: number }> }>("enCokMusteri");
  check("§5 en çok sipariş veren: fikstür müşteri 230 m / 1 sipariş", mc.siparis[0]?.musteriId === custId && mc.siparis[0]?.metre === 230 && mc.siparis[0]?.siparisAdet === 1, JSON.stringify(mc.siparis[0]));
  check("§5 en çok sevk edilen: fikstür müşteri 100 m (brüt)", mc.sevk[0]?.musteriId === custId && mc.sevk[0]?.metre === 100, JSON.stringify(mc.sevk[0]));
  const sf = await forced<{ toplam: { girisMetre: number; cikisMetre: number }; turler: Array<{ tur: string }>; iplik: { girisKg: number; cikisKg: number }; noktalar: Array<{ anahtar: string; girisMetre: number }> }>("stokHareket");
  check("§5 stok giriş 100 / çıkış 40 (transfer + TRANSFORM hariç)", sf.toplam.girisMetre === 100 && sf.toplam.cikisMetre === 40, JSON.stringify(sf.toplam));
  check("§5 tür kırılımı yalnız ENTRY + SHIPMENT", JSON.stringify(sf.turler.map((t) => t.tur).sort()) === JSON.stringify(["ENTRY", "SHIPMENT"]));
  check("§5 iplik giriş 50 / çıkış 20 kg (yarnMovementSign)", sf.iplik.girisKg === 50 && sf.iplik.cikisKg === 20, JSON.stringify(sf.iplik));
  check("§6 yerel 00:30 girişi BUGÜN '00' kovasında (UTC'de dün)", sf.noktalar.find((n) => n.anahtar === "00")?.girisMetre === 100, JSON.stringify(sf.noktalar[0]));
  const ag = await forced<{ isler: { alisTeslim: { toplam: number }; isEmriBaslangic: { toplam: number } }; ayGunleri: Array<{ gun: string; alis: number; isEmri: number }>; planliSevkiyat: { toplam: number } }>("ajanda");
  check("§5 ajanda 15 Mart: açık alış 1 (kapalı dışarıda), iş emri 1", ag.isler.alisTeslim.toplam === 1 && ag.isler.isEmriBaslangic.toplam >= 1, JSON.stringify(ag.isler));
  const d15 = ag.ayGunleri.find((d) => d.gun === "2099-03-15");
  const d16 = ag.ayGunleri.find((d) => d.gun === "2099-03-16");
  check("§6 ajanda ay görünümü: 31 gün, 15'inde alış 1 (UTC 14 21:30), 16'sında alış 1", ag.ayGunleri.length === 31 && d15?.alis === 1 && d16?.alis === 1 && ag.ayGunleri.find((d) => d.gun === "2099-03-14")?.alis === 0);
  const other = await forced<{ isler: { alisTeslim: { toplam: number } } }>("ajanda", "bugun", { gun: "2099-03-16", ay: "2099-04" });
  check("§5 ajanda gün ayın dışında → ayrı gün sorgusu (16 Mart alış 1)", other.isler.alisTeslim.toplam === 1);
  check("§5 ajanda planlı sevkiyat +1 (tarihsiz liste)", ag.planliSevkiyat.toplam - base.planned === 1);
  const wo = await forced<{ toplam: number; durumlar: Array<{ durum: string; adet: number }> }>("isEmriDurum");
  check("§5 açık iş emri PLANNED +1", (wo.durumlar.find((d) => d.durum === "PLANNED")?.adet ?? 0) - base.wo === 1);
  check("§1 ajanda varsayılanı fabrika günü", defaultAgendaParams(new Date("2099-03-14T21:30:00.000Z")).gun === "2099-03-15");
}

async function parity(): Promise<void> {
  console.log("── §7 karne eşitliği ──");
  const range = resolvePanoPencere("bugun", NOW).aralik;
  const st = await forced<{ toplam: { metre: number; top: number } }>("uretimIstasyon");
  const wip = await getWipScorecard(range);
  check("§7 istasyon kutusu toplamı = WIP karnesi geçen metre/top", st.toplam.metre === wip.summary.passedQty && st.toplam.top === wip.summary.passedCount);
  const kq = await forced<{ bitenMetre: number; fire: { hurdaYuzde: number } }>("kalite");
  const [q, s] = await Promise.all([getQualityScorecard(range), getScrapScorecard(range)]);
  check("§7 kalite kutusu = Kalite Karnesi biten metre (100) + Fire Karnesi hurda %", kq.bitenMetre === q.summary.totalQty && kq.bitenMetre === 100 && kq.fire.hurdaYuzde === s.summary.scrapPct, `${kq.bitenMetre}`);
  const legacy = await getPanoSummary("hafta", ALL, NOW);
  const sel = (await boxes("hafta", ["uretim", "sevk", "egilim", "stokOzeti", "bekleyen"])).kutular;
  check("§7 eski yanıt = seçimli kutu yanıtı (uretim · sevk · egilim · stokOzeti · bekleyen)",
    JSON.stringify([legacy.kpi.uretim, legacy.kpi.sevk, legacy.egilim, legacy.stokOzeti, legacy.bekleyen]) === JSON.stringify([sel.uretim, sel.sevk, sel.egilim, sel.stokOzeti, sel.bekleyen]));
}

async function main(): Promise<void> {
  console.log("\n=== Açılış panosu kutu bekçisi ===\n");
  await catalogAndContract();
  const baseWo = await forced<{ durumlar: Array<{ durum: string; adet: number }> }>("isEmriDurum");
  const baseAg = await forced<{ planliSevkiyat: { toplam: number } }>("ajanda");
  const { custId } = await fixtures();
  await queryBudget();
  await fixtureNumbers(custId, { wo: baseWo.durumlar.find((d) => d.durum === "PLANNED")?.adet ?? 0, planned: baseAg.planliSevkiyat.toplam });
  await parity();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    try { await cleanup(); } catch (e) { fail++; console.error("temizlik:", e); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
