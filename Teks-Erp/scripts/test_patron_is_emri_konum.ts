// =============================================================================
// BEKÇİ — PATRON İŞ EMRİ "NEREDE" (is-emri v3: aşama kırılımı · fason firmaları · sipariş bağı · ERP süzgeçleri)
// =============================================================================
//   §1 katalog — v3 alanları is-emri'de, catalogVersion ≥ 3; akış panosu kuyruk yüklemi ortak helper'dan
//   §2 ⭐ canlı tel satırı — Kurşun 2 top · Tambur 1 · fason 2 (firma A 1, kalemsiz 1) · depo 1 · sevk 1 · ölü top SAYILMAZ;
//      topSayisi/metre = kırılım toplamı; fason firma payı toplamı "fason" satırına eşit; sipariş no/müşteri adı; acik
//   §3 ⭐ süzgeç ↔ sayım ikizi — her süzülebilir aşamada `workOrderStageWhere` İE'yi bulur ⇔ `asamalar` içerir;
//      `workOrderFirmWhere` ⇔ `fasonFirmaIdleri`; `workOrderOrderWhere` ⇔ `siparisIdleri`
//   §4 ERP okuma ucu — `listSet("is-emri")` üyelik süzgeçleri (asama · fasonFirmaId · siparisId · cariKartId) +
//      arama (sipariş no) + ACIK/KAPALI; biçimsiz değer 400, üyelik beyanı olmayan kümede fasonFirmaId 400
// ⭐ NEGATİF SONDA (2026-11-19): `ROLL_STAGE_WHERE.tambur`dan kart akışı dışlaması kaldırıldı → §3b + §4b ❌ (depoya inen topun ikili-istasyon adımı Tambur'da kalır);
//    `rollAtFirm`ten `outstandingItemOfOpenDispatch` firma süzgeci kaldırıldı → §3c ❌; geri alındı → yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { RollStatus, StationKind, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { FILTERABLE_STAGES, workOrderFirmWhere, workOrderOrderWhere, workOrderStageWhere } from "../src/cloud-sync/work-order-facts";
import { listSet } from "../src/services/patron-read/patron-read.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-PIK-${process.pid}`;
const V3 = ["acik", "musteriAdi", "musteriAdlari", "siparisIdleri", "siparisNolari", "urunAdi", "renkAdi", "asamaTop", "asamalar", "topSayisi", "metre", "fasonFirmaIdleri", "fasonFirmalari"];

async function telSatiri(woId: string): Promise<Record<string, unknown> | undefined> {
  const p = RECORD_PROJECTIONS.find((x) => x.name === "is-emri")!;
  const built = await buildRecords(p, [woId], Date.now());
  for (const [, rows] of built.rows) for (const r of rows) if (r.id === woId && "isEmriNo" in r) return r as Record<string, unknown>;
  return undefined;
}

const USER = { userId: "00000000-0000-4000-8000-000000000000", username: "bekci", permissions: ["patron-app:login", "workorder:read", "order:read"] };
async function erpIds(q: Record<string, unknown>): Promise<string[] | string> {
  try {
    const page = await listSet(USER, "is-emri", { limit: 200, kimlik: {}, anahtar: {}, ...q });
    return page.kayitlar.map((r) => r.id);
  } catch (e) {
    return e instanceof AppError ? `HATA ${e.statusCode} ${e.message}` : String(e);
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== PATRON İŞ EMRİ NEREDE BEKÇİSİ ===\n");
  console.log("── §1 Katalog ──");
  const p = RECORD_PROJECTIONS.find((x) => x.name === "is-emri")!;
  const wires = new Set(p.derived.map((d) => d.wire));
  check("§1a v3 türetilmiş alanları is-emri kataloğunda, catalogVersion ≥ 3", V3.every((w) => wires.has(w)) && (p.catalogVersion ?? 0) >= 3, V3.filter((w) => !wires.has(w)).join(","));
  const flow = readFileSync(path.resolve(__dirname, "../src/services/inventory/production-flow.ts"), "utf8");
  check("§1b akış panosu Kurşun/Tambur kolonları ortak yüklemi kullanır (ikinci tanım yok)",
    flow.includes("...KURSUN_FLOW_STEP_WHERE") && flow.includes("...TAMBUR_FLOW_STEP_WHERE") && !/kind: StationKind\.TAMBUR/.test(flow));

  const ids = { item: "", customer: "", order: "", line: "", wo: "", woClosed: "", stations: [] as string[], steps: [] as string[], rolls: [] as string[], firm: "", dispatch: "", batch: "" };
  try {
    ids.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
    ids.customer = (await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} Müşteri` }, select: { id: true } })).id;
    ids.order = (await prisma.order.create({ data: { orderNumber: `${TAG}-SP`, customerId: ids.customer }, select: { id: true } })).id;
    ids.line = (await prisma.orderLine.create({ data: { orderId: ids.order, itemId: ids.item, quantity: 500 }, select: { id: true } })).id;
    ids.wo = (await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, type: "ORDER_PRODUCTION", targetItemId: ids.item, targetQuantity: 500, status: WorkOrderStatus.IN_PROGRESS }, select: { id: true } })).id;
    ids.woClosed = (await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WK`, type: "STOCK_PRODUCTION", targetItemId: ids.item, targetQuantity: 10, status: WorkOrderStatus.COMPLETED }, select: { id: true } })).id;
    await prisma.workOrderToOrderLine.create({ data: { workOrderId: ids.wo, orderLineId: ids.line } });
    const st = async (n: string, kind: StationKind, appliesQuality = false) =>
      (await prisma.station.create({ data: { code: `${TAG}-${n}`.slice(0, 32), name: `${TAG} ${n}`, type: "INTERNAL", kind, appliesQuality }, select: { id: true } })).id;
    const sKursun = await st("KQ", StationKind.PROCESS_QC, true);
    const sTambur = await st("TB", StationKind.TAMBUR);
    const sTamburQ = await st("TQ", StationKind.TAMBUR, true);
    ids.stations.push(sKursun, sTambur, sTamburQ);
    const step = async (stationId: string, seq: number) =>
      (await prisma.workOrderStep.create({ data: { workOrderId: ids.wo, stationId, stepSequence: seq, status: StepStatus.ACTIVE }, select: { id: true } })).id;
    const stK = await step(sKursun, 1), stT = await step(sTambur, 2), stTQ = await step(sTamburQ, 3);
    ids.steps.push(stK, stT, stTQ);
    let seq = 0;
    const mk = async (status: RollStatus, qty: number, currentStepId: string | null): Promise<string> => {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-R${++seq}`, itemId: ids.item, status, initialQty: qty, currentQty: qty, entrySource: "SEMI_FINISHED", currentStepId, producedInStepId: stK },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    await mk(RollStatus.IN_PRODUCTION, 100, stK);
    await mk(RollStatus.IN_PRODUCTION, 50.5, stTQ); // Tambur türü + kart akışı → Kurşun (kümeler ayrık)
    await mk(RollStatus.IN_PRODUCTION, 70, stT);
    const fasonA = await mk(RollStatus.AT_SUBCONTRACTOR, 40, null);
    await mk(RollStatus.AT_SUBCONTRACTOR, 30, null); // açık kalemsiz fason topu → firmasız satır
    await mk(RollStatus.WAREHOUSE, 20, null);
    await mk(RollStatus.SHIPPED, 10, null);
    await mk(RollStatus.CANCELLED, 999, stK); // ölü: sayılmaz
    const sFason = await st("FS", StationKind.SUBCONTRACTOR);
    ids.stations.push(sFason);
    const stF = (await prisma.workOrderStep.create({ data: { workOrderId: ids.wo, stationId: sFason, stepSequence: 4 }, select: { id: true } })).id;
    ids.steps.push(stF);
    ids.batch = (await prisma.batch.create({ data: { batchNumber: `${TAG}-B`, workOrderId: ids.wo }, select: { id: true } })).id;
    ids.firm = (await prisma.subcontractor.create({ data: { code: `${TAG}-F`.slice(0, 32), name: `${TAG} Boyahane` }, select: { id: true } })).id;
    ids.dispatch = (await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-D`, subcontractorId: ids.firm, workOrderId: ids.wo, stepId: stF, batchId: ids.batch }, select: { id: true } })).id;
    await prisma.subcontractorDispatchItem.create({ data: { dispatchId: ids.dispatch, rollId: fasonA, dispatchedQty: 40 } });

    console.log("\n── §2 Canlı tel satırı ──");
    const t = await telSatiri(ids.wo);
    const asama = Object.fromEntries(((t?.asamaTop ?? []) as Array<{ anahtar: string; top: number; metre: string }>).map((a) => [a.anahtar, `${a.top}/${a.metre}`]));
    check("§2a ⭐ aşama kırılımı: Kurşun 2 · Tambur 1 · fason 2 · depo 1 · sevk 1, ölü top yok",
      JSON.stringify(asama) === JSON.stringify({ fason: "2/70.000", kursun: "2/150.500", tambur: "1/70.000", depo: "1/20.000", sevkEdildi: "1/10.000" }), JSON.stringify(asama));
    check("§2b topSayisi/metre kırılım toplamı (7 top · 320.500)", t?.topSayisi === 7 && t?.metre === "320.500", `${String(t?.topSayisi)} / ${String(t?.metre)}`);
    check("§2c asamalar = kırılım anahtarları (diger hariç, sabit sıra)", JSON.stringify(t?.asamalar) === JSON.stringify(["fason", "kursun", "tambur", "depo", "sevkEdildi"]), JSON.stringify(t?.asamalar));
    const firms = (t?.fasonFirmalari ?? []) as Array<{ fasonFirmaId: string | null; ad: string | null; top: number; metre: string; enEskiGonderim: string | null }>;
    check("§2d ⭐ fason firma payı: firma 1 top + firmasız 1 top; toplam fason satırına eşit",
      firms.length === 2 && firms[0]!.fasonFirmaId === ids.firm && firms[0]!.ad === `${TAG} Boyahane` && firms[0]!.top === 1 && firms[0]!.enEskiGonderim !== null
      && firms[1]!.fasonFirmaId === null && firms.reduce((a, f) => a + f.top, 0) === 2, JSON.stringify(firms));
    check("§2e fasonFirmaIdleri yalnız açık kalemli firma", JSON.stringify(t?.fasonFirmaIdleri) === JSON.stringify([ids.firm]), JSON.stringify(t?.fasonFirmaIdleri));
    check("§2f sipariş bağı + müşteri + ürün adı + açık",
      JSON.stringify(t?.siparisIdleri) === JSON.stringify([ids.order]) && JSON.stringify(t?.siparisNolari) === JSON.stringify([`${TAG}-SP`])
      && t?.musteriAdi === `${TAG} Müşteri` && t?.urunAdi === `${TAG} Kumaş` && t?.acik === true, JSON.stringify({ m: t?.musteriAdi, s: t?.siparisNolari, a: t?.acik }));
    const k = await telSatiri(ids.woClosed);
    check("§2g topsuz kapalı İE: acik=false, boş kırılım, 0 top", k?.acik === false && JSON.stringify(k?.asamaTop) === "[]" && k?.topSayisi === 0 && JSON.stringify(k?.fasonFirmalari) === "[]");

    console.log("\n── §3 Süzgeç ↔ sayım ikizi ──");
    const scope = { id: { in: [ids.wo, ids.woClosed] } };
    const found = async (w: object) => (await prisma.workOrder.findMany({ where: { AND: [scope, w] }, select: { id: true } })).map((r) => r.id);
    const twin: string[] = [];
    for (const s of FILTERABLE_STAGES) {
      const hit = (await found(workOrderStageWhere(s))).includes(ids.wo);
      if (hit !== ((t?.asamalar as string[]) ?? []).includes(s)) twin.push(s);
    }
    check("§3a ⭐ her aşamada süzgeç ⇔ asamalar", twin.length === 0, twin.join(",") || "5 aşama");
    await prisma.roll.updateMany({ where: { id: { in: ids.rolls }, currentStepId: stT }, data: { status: RollStatus.WAREHOUSE } });
    const t2 = await telSatiri(ids.wo);
    const tamburHit = (await found(workOrderStageWhere("tambur"))).includes(ids.wo);
    check("§3b Tambur topu depoya inince süzgeç de sayım da düşer", !tamburHit && !((t2?.asamalar as string[]) ?? []).includes("tambur"), JSON.stringify(t2?.asamalar));
    const other = (await prisma.subcontractor.create({ data: { code: `${TAG}-G`.slice(0, 32), name: `${TAG} Başka` }, select: { id: true } })).id;
    check("§3c ⭐ firma süzgeci ⇔ fasonFirmaIdleri (kendi firması bulur, başka firma bulmaz)",
      (await found(workOrderFirmWhere(ids.firm))).includes(ids.wo) && !(await found(workOrderFirmWhere(other))).includes(ids.wo));
    await prisma.subcontractor.deleteMany({ where: { id: other } });
    check("§3d sipariş süzgeci ⇔ siparisIdleri", JSON.stringify(await found(workOrderOrderWhere(ids.order))) === JSON.stringify([ids.wo]));

    console.log("\n── §4 ERP okuma ucu ──");
    const has = (r: string[] | string, id: string) => Array.isArray(r) && r.includes(id);
    check("§4a asama=kursun · fasonFirmaId · siparisId · cariKartId İE'yi bulur",
      has(await erpIds({ uyelik: { asama: "kursun" } }), ids.wo) && has(await erpIds({ uyelik: { fasonFirmaId: ids.firm } }), ids.wo)
      && has(await erpIds({ uyelik: { siparisId: ids.order } }), ids.wo) && has(await erpIds({ uyelik: { cariKartId: ids.customer } }), ids.wo));
    const r4b = await erpIds({ uyelik: { asama: "tambur" } });
    check("§4b asama=tambur artık bulmaz", Array.isArray(r4b) && !r4b.includes(ids.wo), String(r4b));
    check("§4c arama sipariş no ile + ACIK; KAPALI kapalı İE'yi verir",
      has(await erpIds({ ara: `${TAG}-SP`, suzgec: "ACIK" }), ids.wo) && has(await erpIds({ ara: TAG, suzgec: "KAPALI" }), ids.woClosed)
      && !has(await erpIds({ ara: TAG, suzgec: "KAPALI" }), ids.wo));
    const bad1 = await erpIds({ uyelik: { asama: "diger" } });
    const bad2 = await listSet(USER, "siparis", { limit: 5, kimlik: {}, anahtar: {}, uyelik: { fasonFirmaId: ids.firm } }).then(() => "geçti", (e: unknown) => (e instanceof AppError ? `HATA ${e.statusCode}` : String(e)));
    check("§4d biçimsiz aşama 400; üyelik beyanı olmayan kümede fasonFirmaId 400 (fail-closed)", String(bad1).startsWith("HATA 400") && bad2 === "HATA 400", `${String(bad1)} · ${bad2}`);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    if (ids.dispatch) await prisma.subcontractorDispatch.deleteMany({ where: { id: ids.dispatch } });
    if (ids.firm) await prisma.subcontractor.deleteMany({ where: { id: ids.firm } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: ids.wo || undefined } });
    if (ids.batch) await prisma.batch.deleteMany({ where: { id: ids.batch } });
    await prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: [ids.wo, ids.woClosed].filter(Boolean) } } });
    await prisma.station.deleteMany({ where: { id: { in: ids.stations.filter(Boolean) } } });
    if (ids.line) await prisma.orderLine.deleteMany({ where: { id: ids.line } });
    if (ids.order) await prisma.order.deleteMany({ where: { id: ids.order } });
    if (ids.customer) await prisma.customer.deleteMany({ where: { id: ids.customer } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
