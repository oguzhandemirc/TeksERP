// =============================================================================
// SEVKE HAZIR İŞLER BEKÇİSİ (D4-J1; DALGA4 §11.5/§11.8, §13 D4-J1 kabul satırı)
// =============================================================================
// Koşum: npx tsx scripts/test_sevke_hazir.ts            (DB'li; TEST- fikstürü; ayarlar fotoğrafa döner)
//        SEVKE_HAZIR_PERF=1 npx tsx scripts/test_sevke_hazir.ts   (+ 500 belge / 30.000 top süre ölçümü; kabul eşiği DALGA4 §13, 2026-10-30)
//
// Ölçer:
//   §0 sınıf kümeleri — her RollStatus TEK sınıfta; canlı küme dışı = K18_DEAD_STATUSES ∪ {RETURNED_FROM_SUBCONTRACTOR};
//      bellek `readinessClassOf` ↔ SQL `readinessClassSql` her statüde aynı (boğaz-ikiz)
//   §1 AST — hazırlık yüklemi TEK: helper dışında hazırlık sınıflayıcı/kural okuyucu tanımı ya da çağrısı yok
//   §2 müşteri partisi (aynı customerBatchNo — biri boşluklu — iki irsaliye, 10 top: 9 hazır 1 işlemde, bir hazır
//      top tambur bölmesinin çocukları) → ayar yokken ALL_DONE ve PARTIAL
//   §3 METER_THRESHOLD %2 → metre eşiğe ulaşınca READY, hazır metre düşünce PARTIAL
//   §4 hedef yok (müşteri birimi) → METER seçiliyken ALL_DONE'a düşer (appliedRule ALL_DONE, PARTIAL)
//   §5 top geri açılınca READY → PARTIAL (ALL_DONE)
//   §6 dört groupBy, tanınmayan/eksik groupBy 400, tanınmayan state 400; tamamı GİTTİ birim listede yok
//   §7 liste + cursor + özet tek where: limit=1 sayfalama ↔ özet birebir; state/customer süzgeci özete de uyar
//   §8 gelen belge modülü kapalı → deliveryNote/customerBatch 403 MODULE_DISABLED, workOrder geçer
//   §9 birim topları ucu: sınıflar, rollClass süzgeci, tanınmayan birim 400
//   §P (SEVKE_HAZIR_PERF=1) 500 belge / 30.000 top: uç süresi (hedef ≤ 300 ms; aşarsa yalnız rapor)
//
// NEGATİF SONDA (kırmızı görülerek, 2026-10-30): bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Request, Response } from "express";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { K18_DEAD_STATUSES } from "../src/services/batch.service";
import {
  SHIP_READY_GONE_STATUSES,
  SHIP_READY_IN_PROCESS_STATUSES,
  SHIP_READY_OUT_OF_SET_STATUSES,
  SHIP_READY_READY_STATUSES,
  SHIP_READY_SCRAP_STATUSES,
  readinessClassOf,
  readinessClassSql,
} from "../src/services/helpers/ship-readiness.helper";
import { listReadyWorks, type ReadyWorkRow, type ReadyWorkUnit } from "../src/services/ready-works.service";
import { listReadyWorkRolls } from "../src/services/ready-work-rolls.service";
import { ShippingController } from "../src/controllers/shipping.controller";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.join(__dirname, "..");
const HELPER = "src/services/helpers/ship-readiness.helper.ts";
const TAG = `TEST-SHR-${Date.now().toString(36)}`;
const SETTING_SNAPSHOT_KEYS = [
  SETTING_KEYS.SHIPPING_READY_RULE,
  SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT,
  SETTING_KEYS.EMANET_ENABLED,
  SETTING_KEYS.GELEN_BELGE_ENABLED,
];

async function setSetting(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function catchErr(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}

// ---------------------------------------------------------------------------
// §0 sınıf kümeleri + boğaz-ikiz
// ---------------------------------------------------------------------------
async function classSets(): Promise<void> {
  const sets = [SHIP_READY_READY_STATUSES, SHIP_READY_IN_PROCESS_STATUSES, SHIP_READY_GONE_STATUSES, SHIP_READY_SCRAP_STATUSES, SHIP_READY_OUT_OF_SET_STATUSES];
  const all = Object.values(RollStatus);
  const multi = all.filter((s) => sets.filter((set) => set.includes(s)).length !== 1);
  check("§0a her RollStatus tam BİR sınıfta (HAZIR/İŞLEMDE/GİTTİ/FİRE/canlı dışı)", multi.length === 0, multi.join(","));
  const expectedOut = new Set<RollStatus>([...K18_DEAD_STATUSES, RollStatus.RETURNED_FROM_SUBCONTRACTOR]);
  check("§0b canlı küme dışı = K18_DEAD_STATUSES ∪ {RETURNED_FROM_SUBCONTRACTOR}",
    SHIP_READY_OUT_OF_SET_STATUSES.length === expectedOut.size && SHIP_READY_OUT_OF_SET_STATUSES.every((s) => expectedOut.has(s)),
    SHIP_READY_OUT_OF_SET_STATUSES.join(","));
  const rows = await prisma.$queryRaw<Array<{ status: string; cls: string | null }>>(Prisma.sql`
    SELECT r.status, ${readinessClassSql("r")} AS cls FROM (VALUES ${Prisma.join(all.map((s) => Prisma.sql`(${s})`))}) AS r(status)`);
  const mismatch = rows.filter((r) => (readinessClassOf(r.status as RollStatus) ?? null) !== r.cls).map((r) => `${r.status}:${r.cls}`);
  check("§0c readinessClassOf ↔ readinessClassSql her statüde aynı", rows.length === all.length && mismatch.length === 0, mismatch.join(","));
}

// ---------------------------------------------------------------------------
// §1 AST — tek hazırlık yüklemi
// ---------------------------------------------------------------------------
const PREDICATE_NAME_RE = /(shipready|shipreadiness|readytoship|sevkehazir|readinessclass)/i;
const SETTING_READERS = new Set(["readShippingReadyRule", "readShippingReadyTolerancePct"]);

function walkSrc(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkSrc(p, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}

export function astViolations(): string[] {
  const files: string[] = [];
  walkSrc(path.join(ROOT, "src"), files);
  const out: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (rel === HELPER) continue;
    const text = readFileSync(f, "utf8");
    if (!PREDICATE_NAME_RE.test(text) && ![...SETTING_READERS].some((r) => text.includes(r))) continue;
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      // (a) helper dışında hazırlık adlı fonksiyon/değişken TANIMI (tip/arayüz adları serbest).
      if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n) || ts.isPropertyDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
        const isFn = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
          || (n.initializer !== undefined && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)));
        if (isFn && PREDICATE_NAME_RE.test(n.name.text)) out.push(`${rel}: tanım ${n.name.text}`);
      }
      // (b) kural okuyucusunu helper ve kendi dosyası dışında çağırmak.
      if (ts.isCallExpression(n) && rel !== "src/services/system-setting.service.ts") {
        const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : "";
        if (SETTING_READERS.has(callee)) out.push(`${rel}: çağrı ${callee}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

function astCheck(): void {
  const v = astViolations();
  check("§1 AST: hazırlık yüklemi/kural okuyucusu yalnız ship-readiness.helper'da", v.length === 0, v.join(" · "));
  const helper = readFileSync(path.join(ROOT, HELPER), "utf8");
  check("§1b AST körlük zemini: helper sınıflayıcıyı tanımlıyor", /export function classifyShipReadiness\(/.test(helper) && /export function readinessClassSql\(/.test(helper));
}

// ---------------------------------------------------------------------------
async function list(groupBy: ReadyWorkUnit | string, extra: Record<string, unknown> = {}) {
  return (await listReadyWorks({ groupBy, ...extra })).data;
}
async function listAll(groupBy: ReadyWorkUnit, extra: Record<string, unknown> = {}): Promise<ReadyWorkRow[]> {
  const out: ReadyWorkRow[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 500; i++) {
    const d = await list(groupBy, { ...extra, cursor, limit: "1" });
    out.push(...d.items);
    if (!d.nextCursor) break;
    cursor = d.nextCursor;
  }
  return out;
}
const find = (rows: ReadyWorkRow[], id: string) => rows.find((r) => r.id === id);

async function gate(unit: string, viaParams: boolean): Promise<AppError | null | "next"> {
  const c = new ShippingController();
  const req = (viaParams ? { params: { unit, id: "x" }, query: {} } : { params: {}, query: { groupBy: unit } }) as unknown as Request;
  return new Promise((resolve) => {
    c.readyWorksModuleGate(req, {} as Response, (e?: unknown) => resolve(e === undefined ? "next" : e instanceof AppError ? e : null));
  });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 2; await pool.end(); return; }
  console.log("=== SEVKE HAZIR İŞLER BEKÇİSİ ===\n");
  await classSets();
  astCheck();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: SETTING_SNAPSHOT_KEYS } }, select: { key: true, value: true } });
  const ids = { item: "", custA: "", custB: "", wo: "", batch: "", notes: [] as string[], rolls: [] as string[] };
  try {
    await setSetting(SETTING_KEYS.SHIPPING_READY_RULE, null);
    await setSetting(SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT, null);
    await setSetting(SETTING_KEYS.EMANET_ENABLED, true);
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, true);

    ids.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
    ids.custA = (await prisma.customer.create({ data: { code: `${TAG}-A`, name: `${TAG} Sahip A` }, select: { id: true } })).id;
    ids.custB = (await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Sahip B` }, select: { id: true } })).id;
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", targetItemId: ids.item, targetQuantity: 500 }, select: { id: true } });
    ids.wo = wo.id;
    ids.batch = (await prisma.batch.create({ data: { batchNumber: `${TAG}-B1`, workOrderId: wo.id }, select: { id: true } })).id;

    let seq = 0;
    const mk = async (owner: string | null, status: RollStatus, qty: number, extra: Partial<Prisma.RollUncheckedCreateInput> = {}) => {
      const r = await prisma.roll.create({
        data: { barcode: `${TAG}-R${++seq}`, itemId: ids.item, status, initialQty: qty + 100, currentQty: qty, entrySource: "SEMI_FINISHED", ownerCustomerId: owner, ...extra },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    const mkNote = async (no: string, owner: string | null, batchNo: string | null, lines: Array<{ rollId: string; meters: number }>) => {
      const n = await prisma.customerDeliveryNote.create({
        data: {
          noteNo: `${TAG}-${no}`.slice(0, 32), status: "APPROVED", sourceKind: "MANUAL", ownerCustomerId: owner, customerBatchNo: batchNo,
          lines: { create: lines.map((l, i) => ({ lineNo: i + 1, meters: l.meters, rollId: l.rollId, status: "ENTERED" as const })) },
        },
        select: { id: true },
      });
      ids.notes.push(n.id);
      return n.id;
    };

    // Müşteri partisi P-77: irsaliye 1 (5 satır) + irsaliye 2 (5 satır, parti no boşluklu). 9 hazır + 1 işlemde.
    // İrsaliye 1'in ilk topu tamburda bölündü (TAMBUR_CONSUMED) → iki WAREHOUSE çocuk (50+50): aşağı soy sayılır.
    const parent = await mk(ids.custA, RollStatus.TAMBUR_CONSUMED, 0);
    const kidA = await mk(ids.custA, RollStatus.WAREHOUSE, 50, { parentRollId: parent });
    const kidB = await mk(ids.custA, RollStatus.WAREHOUSE, 50, { parentRollId: parent });
    const n1Rolls = [parent];
    for (let i = 0; i < 4; i++) n1Rolls.push(await mk(ids.custA, RollStatus.WAREHOUSE, 100));
    const n2Rolls: string[] = [];
    for (let i = 0; i < 4; i++) n2Rolls.push(await mk(ids.custA, RollStatus.WAREHOUSE, 100));
    const openRoll = await mk(ids.custA, RollStatus.IN_PRODUCTION, 15);
    n2Rolls.push(openRoll);
    const note1 = await mkNote("N1", ids.custA, "P-77", n1Rolls.map((r) => ({ rollId: r, meters: 100 })));
    const note2 = await mkNote("N2", ids.custA, "  P-77 ", n2Rolls.map((r, i) => ({ rollId: r, meters: i === 4 ? 15 : 100 })));
    // Tamamı gitmiş belge (B): listede görünmemeli.
    const gone1 = await mk(ids.custB, RollStatus.SHIPPED, 100);
    const gone2 = await mk(ids.custB, RollStatus.SHIPPED, 100);
    const noteGone = await mkNote("NG", ids.custB, "P-99", [{ rollId: gone1, meters: 100 }, { rollId: gone2, meters: 100 }]);
    // İş emri: hedef 500 m; 4 hazır × 100 + 1 işlemde 100 (+1 fire 50 → payda 450).
    for (let i = 0; i < 4; i++) await mk(ids.custA, RollStatus.WAREHOUSE, 100, { batchId: ids.batch });
    const woOpen = await mk(ids.custA, RollStatus.IN_PRODUCTION, 100, { batchId: ids.batch });
    await mk(ids.custA, RollStatus.SCRAP, 50, { batchId: ids.batch });
    const batchId = `${ids.custA}:P-77`;
    const onlyA = { customerId: ids.custA };

    // §2 ayar yokken ALL_DONE → PARTIAL
    let cb = await list("customerBatch", onlyA);
    let unitP = find(cb.items, batchId);
    check("§2a ayar yazılmamışken kural ALL_DONE", cb.policy.rule === "ALL_DONE", cb.policy.rule);
    check("§2b müşteri partisi iki irsaliyeyi (trim) TEK birimde toplar: 10 hazır top (tambur çocukları dahil) + 1 işlemde",
      !!unitP && unitP.readyCount === 10 && unitP.inProcessCount === 1, JSON.stringify(unitP && { r: unitP.readyCount, i: unitP.inProcessCount }));
    check("§2c ALL_DONE'da PARTIAL", unitP?.state === "PARTIAL", unitP?.state);
    check("§2d hedef = iki belgenin Σ satır metresi (9×100 + 15 = 915)", unitP?.targetMeters === 915, String(unitP?.targetMeters));
    check("§2e hazır metre currentQty'den (tüketilen ata sayılmaz): 900", unitP?.readyMeters === 900, String(unitP?.readyMeters));

    // §3 METER_THRESHOLD %2: eşik 915 × 0,98 = 896,7 → 900 ≥ → READY; bir top 80'e inince 880 → PARTIAL
    await setSetting(SETTING_KEYS.SHIPPING_READY_RULE, "METER_THRESHOLD");
    await setSetting(SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT, 2);
    cb = await list("customerBatch", onlyA);
    unitP = find(cb.items, batchId);
    check("§3a METER_THRESHOLD %2: 900 m ≥ 896,7 → READY (1 top işlemdeyken)", unitP?.state === "READY" && unitP.appliedRule === "METER_THRESHOLD", `${unitP?.state}/${unitP?.appliedRule}`);
    await prisma.roll.update({ where: { id: n2Rolls[0]! }, data: { currentQty: 80 } });
    unitP = find((await list("customerBatch", onlyA)).items, batchId);
    check("§3b hazır metre 880 < 896,7 → PARTIAL", unitP?.state === "PARTIAL", unitP?.state);
    await setSetting(SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT, 5);
    unitP = find((await list("customerBatch", onlyA)).items, batchId);
    check("§3c tolerans %5 → eşik 869,25 → READY", unitP?.state === "READY", unitP?.state);
    await setSetting(SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT, 2);
    await prisma.roll.update({ where: { id: n2Rolls[0]! }, data: { currentQty: 100 } });
    const wo1 = find((await list("workOrder", onlyA)).items, ids.wo);
    check("§3d İE hedefi targetQuantity, fire paydadan düşer: (500−50)×0,98 = 441 ≤ 400? hayır → PARTIAL",
      wo1?.state === "PARTIAL" && wo1.targetMeters === 500 && wo1.scrapMeters === 50, JSON.stringify(wo1 && { s: wo1.state, t: wo1.targetMeters, f: wo1.scrapMeters }));
    await prisma.roll.update({ where: { id: woOpen }, data: { currentQty: 30 } });
    await prisma.roll.update({ where: { id: ids.rolls[ids.rolls.length - 3]! }, data: { currentQty: 145 } });
    const wo2 = find((await list("workOrder", onlyA)).items, ids.wo);
    check("§3e İE hazır 445 ≥ 441 → READY", wo2?.state === "READY", `${wo2?.state} ${wo2?.readyMeters}`);

    // §4 hedef yok → ALL_DONE'a düşer (METER seçiliyken)
    const custRow = find((await list("customer", onlyA)).items, ids.custA);
    check("§4 müşteri birimi hedefsiz: METER seçili ama appliedRule ALL_DONE, işlemde top var → PARTIAL",
      custRow?.appliedRule === "ALL_DONE" && custRow.state === "PARTIAL" && custRow.targetMeters === null, `${custRow?.appliedRule}/${custRow?.state}`);

    // §5 geri açılış (ALL_DONE)
    await setSetting(SETTING_KEYS.SHIPPING_READY_RULE, "ALL_DONE");
    await prisma.roll.update({ where: { id: openRoll }, data: { status: RollStatus.WAREHOUSE } });
    unitP = find((await list("customerBatch", onlyA)).items, batchId);
    check("§5a son işlemdeki top depoya inince READY", unitP?.state === "READY", unitP?.state);
    await prisma.roll.update({ where: { id: kidA }, data: { status: RollStatus.IN_PRODUCTION } });
    unitP = find((await list("customerBatch", onlyA)).items, batchId);
    check("§5b bir hazır top (tambur çocuğu) geri açılınca READY → PARTIAL", unitP?.state === "PARTIAL", unitP?.state);
    await prisma.roll.update({ where: { id: kidA }, data: { status: RollStatus.WAREHOUSE } });
    await prisma.roll.update({ where: { id: openRoll }, data: { status: RollStatus.IN_PRODUCTION } });

    // §6 groupBy
    const dn = await list("deliveryNote", { customerId: [ids.custA, ids.custB].join(",") });
    check("§6a deliveryNote: iki belge ayrı birim, tamamı GİTTİ belge listede YOK",
      !!find(dn.items, note1) && !!find(dn.items, note2) && !find(dn.items, noteGone), dn.items.map((r) => r.label).join(","));
    check("§6b deliveryNote N1 aşağı soyu: 6 hazır (4 + 2 çocuk), hedef 500", find(dn.items, note1)?.readyCount === 6 && find(dn.items, note1)?.targetMeters === 500);
    check("§6c müşteri B (yalnız SHIPPED) customer birimi listede YOK", !find((await list("customer", { customerId: ids.custB })).items, ids.custB));
    const e400 = await catchErr(() => list("parti"));
    check("§6d tanınmayan groupBy 400 (Türkçe, READY_WORKS_BAD_GROUP)", e400?.statusCode === 400 && e400.details?.code === "READY_WORKS_BAD_GROUP" && /Gruplama/.test(e400.message), `${e400?.statusCode}`);
    const eMissing = await catchErr(() => listReadyWorks({}));
    check("§6e groupBy yoksa 400", eMissing?.statusCode === 400);
    const eState = await catchErr(() => list("customer", { state: "HAZIR" }));
    check("§6f tanınmayan state 400", eState?.statusCode === 400);

    // §7 tek where: sayfalama ↔ özet
    for (const g of ["workOrder", "deliveryNote", "customerBatch", "customer"] as const) {
      const full = await list(g, onlyA);
      const paged = await listAll(g, onlyA);
      const ok = paged.length === full.summary.units
        && paged.filter((r) => r.state === "PARTIAL").length === full.summary.partial
        && paged.filter((r) => r.state === "READY").length === full.summary.ready
        && Math.abs(paged.reduce((s, r) => s + r.readyMeters, 0) - full.summary.readyMeters) < 0.001
        && new Set(paged.map((r) => r.id)).size === paged.length;
      check(`§7 ${g}: limit=1 sayfalama ↔ özet birebir (mükerrer yok)`, ok && paged.length > 0, `sayfa=${paged.length} özet=${full.summary.units}`);
    }
    const onlyPartial = await list("deliveryNote", { ...onlyA, state: "PARTIAL" });
    check("§7b state süzgeci özete de uygulanır", onlyPartial.summary.units === onlyPartial.items.length && onlyPartial.items.every((r) => r.state === "PARTIAL") && onlyPartial.summary.ready === 0,
      `units=${onlyPartial.summary.units}`);

    // §8 modül kapısı
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
    const g1 = await gate("deliveryNote", false);
    const g2 = await gate("customerBatch", true);
    const g3 = await gate("workOrder", false);
    check("§8a gelen belge KAPALI: deliveryNote 403 MODULE_DISABLED", g1 instanceof AppError && g1.statusCode === 403 && g1.details?.code === "MODULE_DISABLED");
    check("§8b gelen belge KAPALI: customerBatch top ucu 403 MODULE_DISABLED", g2 instanceof AppError && g2.statusCode === 403 && g2.details?.code === "MODULE_DISABLED");
    check("§8c workOrder kapıdan geçer", g3 === "next");
    await setSetting(SETTING_KEYS.GELEN_BELGE_ENABLED, true);

    // §9 top ucu
    const rolls = (await listReadyWorkRolls("customerBatch", batchId, {})).data.items;
    check("§9a parti topları: 11 canlı (tüketilen ata yok), sınıflı", rolls.length === 11 && !rolls.some((r) => r.id === parent)
      && rolls.filter((r) => r.readinessClass === "READY").length === 10, `n=${rolls.length}`);
    const onlyOpen = (await listReadyWorkRolls("customerBatch", batchId, { rollClass: "IN_PROCESS" })).data.items;
    check("§9b rollClass=IN_PROCESS süzgeci", onlyOpen.length === 1 && onlyOpen[0]?.id === openRoll);
    const e9 = await catchErr(() => listReadyWorkRolls("parti", ids.custA, {}));
    check("§9c top ucunda tanınmayan birim 400", e9?.statusCode === 400);
    const kidsSeen = rolls.filter((r) => r.id === kidA || r.id === kidB).length;
    check("§9d tambur çocukları aşağı soydan gelir", kidsSeen === 2);

    if (process.env.SEVKE_HAZIR_PERF === "1") await perf(ids);
  } finally {
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: ids.notes } } });
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: ids.notes } } });
    await prisma.roll.updateMany({ where: { id: { in: ids.rolls } }, data: { parentRollId: null } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.batch) await prisma.batch.deleteMany({ where: { id: ids.batch } });
    if (ids.wo) await prisma.workOrder.deleteMany({ where: { id: ids.wo } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    await prisma.customer.deleteMany({ where: { id: { in: [ids.custA, ids.custB].filter(Boolean) } } });
    for (const key of SETTING_SNAPSHOT_KEYS) {
      const f = foto.find((x) => x.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

/** 500 belge × 60 top = 30.000 top (her belgenin yarısı tambur çocuğu), müşteri partisi 50 belgede bir. */
async function perf(ids: { item: string; custA: string; notes: string[]; rolls: string[] }): Promise<void> {
  const NOTES = 500;
  const PER = 60;
  const t0 = Date.now();
  for (let n = 0; n < NOTES; n++) {
    const parents = Array.from({ length: PER / 2 }, () => crypto.randomUUID());
    const kids = parents.map(() => crypto.randomUUID());
    await prisma.roll.createMany({
      data: [
        ...parents.map((id, i) => ({ id, barcode: `${TAG}-P${n}-${i}`, itemId: ids.item, status: i % 3 === 0 ? RollStatus.IN_PRODUCTION : RollStatus.TAMBUR_CONSUMED, initialQty: 100, currentQty: 100, entrySource: "SEMI_FINISHED" as const, ownerCustomerId: ids.custA })),
        ...kids.map((id, i) => ({ id, barcode: `${TAG}-K${n}-${i}`, itemId: ids.item, status: RollStatus.WAREHOUSE, initialQty: 98, currentQty: 98, entrySource: "SEMI_FINISHED" as const, ownerCustomerId: ids.custA, parentRollId: parents[i] })),
      ],
    });
    ids.rolls.push(...parents, ...kids);
    const note = await prisma.customerDeliveryNote.create({
      data: {
        noteNo: `${TAG}-PF${n}`.slice(0, 32), status: "APPROVED", sourceKind: "MANUAL", ownerCustomerId: ids.custA, customerBatchNo: `PF-${Math.floor(n / 50)}`,
        lines: { create: parents.map((rollId, i) => ({ lineNo: i + 1, meters: 100, rollId, status: "ENTERED" as const })) },
      },
      select: { id: true },
    });
    ids.notes.push(note.id);
  }
  console.log(`   ⏱ fikstür: ${NOTES} belge / ${NOTES * PER} top — ${Date.now() - t0} ms`);
  for (const g of ["deliveryNote", "customerBatch", "customer", "workOrder"] as const) {
    await list(g); // ısınma
    const times: number[] = [];
    for (let i = 0; i < 3; i++) { const s = performance.now(); await list(g); times.push(performance.now() - s); }
    const med = times.sort((a, b) => a - b)[1]!;
    console.log(`   ⏱ ready-works groupBy=${g}: medyan ${med.toFixed(0)} ms (hedef ≤ 300 ms${med > 300 ? " — AŞTI, rapora" : ""})`);
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
