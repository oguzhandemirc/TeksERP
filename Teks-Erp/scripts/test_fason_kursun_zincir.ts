// =============================================================================
// FASON (MÜŞTERİ MALI) ZİNCİRİ — belge → fason İE → kurşun → sonraki istasyon → tambur → sevk → dönem sonu faturası
// =============================================================================
// Çalıştırma: npx tsx scripts/test_fason_kursun_zincir.ts
//
// NEDEN (Gülkesim provası 2026-11-06 §1 adım 3–7): fason İE kurşunda "takıldı", tambur listesine düşmedi, dönem sonu
// hizmet faturası "0 iş" dedi. Halkalar tek tek bekçili (`test_senaryo_hizmet_veren` hızlı İE ile), ama
// `CUSTOMER_GOODS_SERVICE` türünün GELEN BELGE FORMUNDAN doğduğu ve tabletin AYNI uçlarıyla yürüdüğü zincir yoktu.
// Kurulum (ana veri, ayar) Prisma ile; akışın HER adımı HTTP (tabletin çağırdığı uçlar).
//
// ADIMLAR:
//   §1 Fason İE: `POST /gelen-belge/irsaliyeler/:id/is-emri` type=CUSTOMER_GOODS_SERVICE, rota KURŞUN → TAMBUR
//   §2 Kurşun: open-cards'ta; `complete-qc2` (gramaj 50 + çıkış metresi) SONRA bile tambur listesinde YOK (adım açık);
//      `finish-step` → adım COMPLETED, top tambur adımında, `tambur/open-cards` kartı gösterir
//   §3 Rota KURŞUN → DETAYLI KK → TAMBUR: kurşun kapanınca kart DETAYLI KK listesinde (kursun-qc/open-cards?stationId)
//      ve tamburda YOK; DETAYLI KK kapanınca tamburda
//   §4 Tambur: `tambur/finalize` 50 m kesim → iki çocuk, ikisi de müşterinin emaneti
//   §5 Sevk: `shipping/shipments/from-rolls` (dökme, siparişsiz) → DISPATCHED
//   §6 Dönem sonu önizlemesi: ≥1 iş, metre = kurşun çıkış metresi, birim fiyat = müşterinin 50 gr fiyatı
// Negatif sondalar (2026-11-06 koşuldu, geri alındı):
//   · `finishStep`'te sonraki adımın `recomputeStepStatus`u kapatılınca §2 "tambur ACTIVE" kırmızı (22/1)
//   · `finishStep`'te sonraki adım hareketi (`rollMovement.createMany`) yazılmayınca §2 adım durumu + §3 tambur listesi kırmızı (21/2)
//   · `collectServiceBillingDraft` boş taslak döndürünce §6 iş sayısı + satır kırmızı (21/2)
// =============================================================================
import { randomUUID, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Currency, ItemType, Prisma, PriceKind } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { factoryYmd } from "../src/constants/time";
import { ensureTestAdmin } from "./fixture-test-user";
import { roleGrade } from "./fixture-quality-grade";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
const eq = (a: Prisma.Decimal.Value | null | undefined, b: Prisma.Decimal.Value, tol = 0.001) => D(a).minus(b).abs().lte(tol);

const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-FKZ-${STAMP}`;
const fx = {
  itemIds: [] as string[], propIds: [] as string[], valueIds: [] as string[], stationIds: [] as string[], routeIds: [] as string[],
  customerId: null as string | null, kursunCreated: null as string | null, noteIds: [] as string[], scanIds: [] as string[], shipmentIds: [] as string[],
};
const priorSettings = new Map<string, unknown>();
let snapshotTaken = false;

type Res = { status: number; body: { data?: unknown; message?: string; details?: { code?: string }; warnings?: string[] } };
let base = "";
let token = "";
async function api(method: string, path: string, body?: unknown): Promise<Res> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: Res["body"] = {};
  try { parsed = (await r.json()) as Res["body"]; } catch { /* boş gövde */ }
  return { status: r.status, body: parsed };
}
const short = (r: Res): string => `${r.status} ${r.body.details?.code ?? ""} ${r.body.message ?? ""}`.trim();
function must<T>(r: Res, label: string, okStatus = [200, 201]): T {
  if (!okStatus.includes(r.status)) throw new Error(`${label}: ${short(r)} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body.data as T;
}
async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

type OpenCard = { workOrderId: string; stepId: string | null };
const tamburCards = async (stationId: string) => must<OpenCard[]>(await api("GET", `/api/tambur/open-cards?stationId=${stationId}`), "tambur listesi");
const flowCards = async (stationId: string) => must<OpenCard[]>(await api("GET", `/api/kursun-qc/open-cards?stationId=${stationId}`), "kurşun/KK listesi");
const has = (cards: OpenCard[], woId: string) => cards.some((c) => c.workOrderId === woId);

async function main(): Promise<void> {
  console.log("=== Fason zinciri: belge → fason İE → kurşun → sonraki istasyon → tambur → sevk → dönem sonu faturası ===");
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) { check("hedef DB test DB'si", false, engel); return; }
  for (const s of await prisma.systemSetting.findMany({ select: { key: true, value: true } })) priorSettings.set(s.key, s.value);
  snapshotTaken = true;
  const server = app.listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await scenario(); } finally { await new Promise<void>((res) => server.close(() => res())); }
}

async function scenario(): Promise<void> {
  const cred = await ensureTestAdmin();
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cred.username, password: cred.password }) });
  token = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
  check("giriş: test yöneticisi token aldı", login.status === 200 && token.length > 0, String(login.status));
  if (!token) return;

  // ── Kurulum: Gülkesim ayarları (demo DB'deki değerler) ─────────────────────
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, SETTING_KEYS.TAMBUR_LIST_BY_STATION_ENABLED, SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, "WITH_WORK_ORDER");
  await setSetting(SETTING_KEYS.KURSUN_METER_CAPTURE, "OUT");
  await setSetting(SETTING_KEYS.FINANCE_SERVICE_BILLING_TRIGGER, "PERIOD_END");
  await setSetting(SETTING_KEYS.PRODUCTION_ROUTE_MODE, "SEQUENTIAL");

  const cust = must<{ id: string }>(await api("POST", "/api/customers", { code: `${P}-C`.slice(0, 32), name: `TEST FKZ müşteri ${STAMP}` }), "müşteri");
  fx.customerId = cust.id;
  const mkItem = async (suffix: string, itemType: ItemType): Promise<string> => {
    const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST FKZ ${suffix} ${STAMP}`, itemType, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    return it.id;
  };
  const FABRIC = await mkItem("KUM", ItemType.FABRIC);
  const HZM = await mkItem("K50", ItemType.SERVICE);
  for (const [customerId, price] of [[null, 10], [cust.id, 7.5]] as const) {
    must(await api("POST", "/api/item-prices", { itemId: HZM, customerId, kind: PriceKind.SALE, currency: Currency.TRY, price }), "hizmet fiyatı");
  }
  let kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (!kursun) {
    kursun = await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
    fx.kursunCreated = kursun.id;
  }
  const variant = await prisma.fabricProperty.create({ data: { code: `${P}-GR`.slice(0, 32), name: `TEST FKZ gramaj ${STAMP}`, valueType: "CHOICE", variantOfPropertyId: kursun.id }, select: { id: true } });
  fx.propIds.push(variant.id);
  const V50 = await prisma.fabricPropertyValue.create({ data: { propertyId: variant.id, code: `50GR${STAMP}`.slice(0, 32), name: "50 gr", sortOrder: 50, serviceItemId: HZM }, select: { id: true, code: true } });
  fx.valueIds.push(V50.id);
  const mkStation = async (suffix: string, kind: "PROCESS_QC" | "TAMBUR", props: Array<{ propertyId: string; mode: "AUTO" | "REQUIRED" }>): Promise<string> => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST FKZ ${suffix} ${STAMP}`, type: "INTERNAL", kind, appliesProperty: props.length > 0 }, select: { id: true } });
    fx.stationIds.push(s.id);
    if (props.length > 0) must(await api("PUT", `/api/station-capabilities/${s.id}`, { properties: props }), `istasyon yeteneği ${suffix}`);
    return s.id;
  };
  const ST_K = await mkStation("K", "PROCESS_QC", [{ propertyId: kursun.id, mode: "AUTO" }, { propertyId: variant.id, mode: "REQUIRED" }]);
  const ST_D = await mkStation("DKK", "PROCESS_QC", []);
  const ST_T = await mkStation("T", "TAMBUR", []);
  const mkRoute = async (name: string, stations: string[]): Promise<string> => {
    const r = await prisma.route.create({ data: { name: `${P} ${name}`, steps: { create: stations.map((stationId, i) => ({ stationId, sequence: i + 1 })) } }, select: { id: true } });
    fx.routeIds.push(r.id);
    return r.id;
  };
  const R_KT = await mkRoute("KURŞUN & TAMBUR", [ST_K, ST_T]);
  const R_KDT = await mkRoute("KURŞUN & DETAYLI KK & TAMBUR", [ST_K, ST_D, ST_T]);

  /** Tabletin "Fason Belge Okut" akışı: taslak + okunmuş sayfa → form → fason İE (tek istek). */
  const fasonWo = async (meters: number, routeTemplateId: string, tag: string) => {
    const note = must<{ id: string }>(await api("POST", "/api/gelen-belge/irsaliyeler", {
      clientToken: randomUUID(), sourceKind: "MANUAL", senderCustomerId: cust.id, senderDocNo: `${STAMP}-${tag}`,
      lines: [{ senderRollNo: `${tag}-1`, meters, itemId: FABRIC }],
    }), `taslak ${tag}`);
    fx.noteIds.push(note.id);
    const content = Buffer.from(`${P}-${tag}`);
    const scan = await prisma.documentScan.create({ data: { noteId: note.id, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: { ocr: { text: `${P} ${tag}` } } }, select: { id: true } });
    fx.scanIds.push(scan.id);
    const wo = must<{ workOrderId: string; rollId: string }>(await api("POST", `/api/gelen-belge/irsaliyeler/${note.id}/is-emri`, {
      clientToken: randomUUID(), ownerCustomerId: cust.id, ourBatchNo: `${P}-${tag}`, kursunMeters: String(meters), routeTemplateId,
      targetValues: [{ propertyId: variant.id, valueId: V50.id }], type: "CUSTOMER_GOODS_SERVICE", targetItemId: FABRIC,
    }), `fason İE ${tag}`);
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: wo.workOrderId }, orderBy: { stepSequence: "asc" }, select: { id: true, status: true } });
    return { ...wo, steps };
  };
  /** Tabletin Kurşun ekranı: gramaj düğmesi (KK2 Tamamla) + çıkış metresi. */
  const kursunTap = (rollId: string, stepId: string, meters: number) => api("POST", "/api/kursun-qc/complete-qc2", {
    rollId, stepId, properties: [{ propertyId: variant.id, valueCode: V50.code }],
    meterOut: { meters, source: "OPERATOR", clientToken: randomUUID() },
  });

  // ── §1 FASON İE ───────────────────────────────────────────────────────────
  console.log("\n§1 Fason İE (gelen belge formu, rota KURŞUN & TAMBUR)");
  const A = await fasonWo(240, R_KT, "A");
  const woA = await prisma.workOrder.findUniqueOrThrow({ where: { id: A.workOrderId }, select: { type: true, customerId: true } });
  const rollA = await prisma.roll.findUniqueOrThrow({ where: { id: A.rollId }, select: { ownerCustomerId: true, currentStepId: true } });
  check("§1 İE türü CUSTOMER_GOODS_SERVICE, müşterisi = belge carisi", woA.type === "CUSTOMER_GOODS_SERVICE" && woA.customerId === cust.id, JSON.stringify(woA));
  check("§1 iki adım; top müşterinin emaneti ve kurşun adımında", A.steps.length === 2 && rollA.ownerCustomerId === cust.id && rollA.currentStepId === A.steps[0]!.id, JSON.stringify({ steps: A.steps.length, cur: rollA.currentStepId === A.steps[0]?.id }));
  check("§1 kurşun listesinde kart var", has(await flowCards(ST_K), A.workOrderId));

  // ── §2 KURŞUN → TAMBUR ────────────────────────────────────────────────────
  console.log("\n§2 Kurşun tamamla → adım kapanır → tambur listesi");
  const q = await kursunTap(A.rollId, A.steps[0]!.id, 240);
  check("§2 KK2 + gramaj 50 + çıkış 240 m → 201", q.status === 201, short(q));
  check("§2 adım KAPATILMADAN kart tamburda YOK (provada görülen durum: kapanış ayrı eylem)", !has(await tamburCards(ST_T), A.workOrderId));
  const fin = await api("POST", "/api/kursun-qc/finish-step", { stepId: A.steps[0]!.id });
  check("§2 finish-step 200", fin.status === 200, short(fin));
  const stA = await prisma.workOrderStep.findMany({ where: { workOrderId: A.workOrderId }, orderBy: { stepSequence: "asc" }, select: { status: true } });
  check("§2 kurşun COMPLETED, tambur ACTIVE", stA[0]?.status === "COMPLETED" && stA[1]?.status === "ACTIVE", stA.map((s) => s.status).join(","));
  check("§2 ⭐ kart tambur listesinde (tablet `tambur/open-cards`)", has(await tamburCards(ST_T), A.workOrderId));
  check("§2 kart kurşun listesinden düştü", !has(await flowCards(ST_K), A.workOrderId));

  // ── §3 KURŞUN → DETAYLI KK → TAMBUR ───────────────────────────────────────
  console.log("\n§3 Rota KURŞUN & DETAYLI KK & TAMBUR");
  const B = await fasonWo(120, R_KDT, "B");
  check("§3 üç adım", B.steps.length === 3, String(B.steps.length));
  check("§3 KK2 201", (await kursunTap(B.rollId, B.steps[0]!.id, 120)).status === 201);
  check("§3 kurşun finish-step 200", (await api("POST", "/api/kursun-qc/finish-step", { stepId: B.steps[0]!.id })).status === 200);
  check("§3 ⭐ kart DETAYLI KK listesinde, tamburda değil", has(await flowCards(ST_D), B.workOrderId) && !has(await tamburCards(ST_T), B.workOrderId));
  const qd = await api("POST", "/api/kursun-qc/complete-qc2", { rollId: B.rollId, stepId: B.steps[1]!.id });
  check("§3 DETAYLI KK tamamla 201", qd.status === 201, short(qd));
  check("§3 DETAYLI KK finish-step 200", (await api("POST", "/api/kursun-qc/finish-step", { stepId: B.steps[1]!.id })).status === 200);
  check("§3 ⭐ kart tambur listesinde", has(await tamburCards(ST_T), B.workOrderId));

  // ── §4 TAMBUR ─────────────────────────────────────────────────────────────
  console.log("\n§4 Tambur: 50 m kesim");
  const grade = await roleGrade("FIRST");
  const fA = await api("POST", "/api/tambur/finalize", { rollId: A.rollId, decisions: [], cuts: [{ length: 50, qualityGrade: grade.code, relatedErrorIds: [], measure: { source: "OPERATOR" } }] });
  check("§4 tambur kararı 200", fA.status === 200, short(fA));
  const kids = await prisma.roll.findMany({ where: { parentRollId: A.rollId }, select: { id: true, currentQty: true, ownerCustomerId: true, status: true } });
  check("§4 iki çocuk (50 + 190), ikisi de müşterinin emaneti, depoda", kids.length === 2 && kids.some((k) => eq(k.currentQty, 50)) && kids.some((k) => eq(k.currentQty, 190)) && kids.every((k) => k.ownerCustomerId === cust.id && k.status === "WAREHOUSE"), JSON.stringify(kids.map((k) => [k.currentQty.toString(), k.status])));

  // ── §5 SEVK ───────────────────────────────────────────────────────────────
  console.log("\n§5 Sevk (dökme, siparişsiz)");
  const kidIds = kids.map((k) => k.id);
  const sh = must<{ id: string }>(await api("POST", "/api/shipping/shipments/from-rolls", { rollIds: kidIds, customerId: cust.id, orderless: true, loadUnits: [{ kind: "BULK", rollIds: kidIds }], clientToken: randomUUID() }), "sevk");
  fx.shipmentIds.push(sh.id);
  // Gülkesim'de sevk onayı açık: tablet "Çıkışı Onayla" = dispatch ucu (plaka/şoför).
  const dp = await api("POST", `/api/shipping/shipments/${sh.id}/dispatch`, { plateNumber: "34TST01", driverName: "Bekçi" });
  check("§5 çıkış onayı 200", dp.status === 200, short(dp));
  const shRow = await prisma.shipment.findUniqueOrThrow({ where: { id: sh.id }, select: { status: true } });
  check("§5 sevk DISPATCHED", shRow.status === "DISPATCHED", shRow.status);

  // ── §6 DÖNEM SONU ─────────────────────────────────────────────────────────
  console.log("\n§6 Dönem sonu hizmet faturası önizlemesi");
  const cari = await prisma.cariAccount.findFirst({ where: { customerId: cust.id }, select: { id: true } });
  const period = factoryYmd(new Date()).slice(0, 7);
  const pv = must<{ workCount: number; totalMeters: string; shipmentCount: number; lines: Array<{ itemId: string; qty: string; unitPrice: string; amount: string }> }>(
    await api("GET", `/api/finance/invoices/service-period-draft/preview?cariId=${cari?.id}&period=${period}`), "önizleme");
  check("§6 ⭐ önizleme ≥1 iş (provada 0 iş)", pv.workCount >= 1, JSON.stringify({ works: pv.workCount, ships: pv.shipmentCount }));
  const line = pv.lines.find((l) => l.itemId === HZM);
  check("§6 kurşun satırı: 240 m (çıkış metresi) × 7,5 (müşterinin 50 gr fiyatı) = 1800", !!line && eq(line.qty, 240) && eq(line.unitPrice, 7.5) && eq(line.amount, 1800), JSON.stringify(pv.lines));
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n").slice(-1)[0]}`); }
  };
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: fx.noteIds } }, select: { rollId: true } })).map((l) => l.rollId).filter((v): v is string => v !== null);
  const kidIds = (await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, select: { id: true } })).map((r) => r.id);
  const ids = [...kidIds, ...rollIds];
  const custIds = fx.customerId ? [fx.customerId] : [];
  const woIds = (await prisma.workOrder.findMany({ where: { customerId: { in: custIds } }, select: { id: true } })).map((w) => w.id);
  const invIds = (await prisma.invoice.findMany({ where: { OR: [{ shipmentId: { in: fx.shipmentIds } }, { cari: { customerId: { in: custIds } } }] }, select: { id: true } })).map((i) => i.id);
  await del("link", () => prisma.serviceBillingLink.deleteMany({ where: { OR: [{ invoiceId: { in: invIds } }, { rollId: { in: ids } }] } }));
  await del("invoiceLine", () => prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invIds } } }));
  await del("invoice", () => prisma.invoice.deleteMany({ where: { id: { in: invIds } } }));
  if (custIds.length > 0) {
    const cari = (await prisma.cariAccount.findMany({ where: { customerId: { in: custIds } }, select: { id: true } })).map((c) => c.id);
    await del("cariBalance", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cariTx", () => prisma.cariTransaction.deleteMany({ where: { cariId: { in: cari } } }));
    await del("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: cari } } }));
  }
  await del("sackAlloc", () => prisma.sackAllocation.deleteMany({ where: { sack: { shipmentId: { in: fx.shipmentIds } } } }));
  await del("meterAck", () => prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: ids } } } }));
  await del("meterReading", () => prisma.rollMeterReading.deleteMany({ where: { rollId: { in: ids } } }));
  await del("roll unlink", () => prisma.roll.updateMany({ where: { id: { in: ids } }, data: { sackId: null, shipmentId: null, parentRollId: null } }));
  await del("noteLine unlink", () => prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: fx.noteIds } }, data: { rollId: null } }));
  for (const [ad, model] of [["whMove", "warehouseMovement"], ["rollOperation", "rollOperation"], ["rollMovement", "rollMovement"], ["rollVariance", "rollVariance"], ["rollProperty", "rollProperty"], ["rollError", "rollError"], ["stockLedger", "stockLedgerEntry"]] as const) {
    const m = (prisma as unknown as Record<string, { deleteMany?: (a: unknown) => Promise<unknown> }>)[model];
    if (m?.deleteMany) await del(ad, () => m.deleteMany!({ where: { rollId: { in: ids } } }));
  }
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: ids } } }));
  await del("scan", () => prisma.documentScan.deleteMany({ where: { id: { in: fx.scanIds } } }));
  await del("noteLine", () => prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: fx.noteIds } } }));
  await del("note", () => prisma.customerDeliveryNote.deleteMany({ where: { id: { in: fx.noteIds } } }));
  await del("shipmentEvent", () => prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: fx.shipmentIds } } }));
  // Dökme yük birimi sevkten ayrılıp havuza dönemez (DB seddi) → önce birim, sonra sevk.
  await del("sack", () => prisma.sack.deleteMany({ where: { OR: [{ shipmentId: { in: fx.shipmentIds } }, { customerId: { in: custIds } }] } }));
  await del("shipment", () => prisma.shipment.deleteMany({ where: { id: { in: fx.shipmentIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await del("targetValue", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await del("batch", () => prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }));
  await del("routeStep", () => prisma.routeStep.deleteMany({ where: { routeId: { in: fx.routeIds } } }));
  await del("route", () => prisma.route.deleteMany({ where: { id: { in: fx.routeIds } } }));
  await del("stationProperty", () => prisma.stationProperty.deleteMany({ where: { stationId: { in: fx.stationIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("value", () => prisma.fabricPropertyValue.deleteMany({ where: { id: { in: fx.valueIds } } }));
  await del("variant bağı", () => prisma.fabricProperty.updateMany({ where: { id: { in: fx.propIds } }, data: { variantOfPropertyId: null } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  if (fx.kursunCreated) { const k = fx.kursunCreated; await del("KURSUN", () => prisma.fabricProperty.deleteMany({ where: { id: k } })); }
  await del("itemPrice", () => prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("customer", () => prisma.customer.deleteMany({ where: { id: { in: custIds } } }));
}

async function restoreSettings(): Promise<void> {
  const now = await prisma.systemSetting.findMany({ select: { key: true } });
  for (const { key } of now) if (!priorSettings.has(key)) await prisma.systemSetting.deleteMany({ where: { key } });
  for (const [key, value] of priorSettings) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    if (snapshotTaken) {
      await restoreSettings().catch((e) => { fail++; console.error("❌ ayar geri alma:", e); });
      await cleanup().catch((e) => { fail++; console.error(e); });
    }
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
