// =============================================================================
// SİPARİŞ SATIRI ÜRETİM DURUMU BEKÇİSİ (SY-K2; tasarım §12.5 madde 2–3, §16.1 SY-K2 kabul satırı)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_order_line_production_state.ts
//   §1 AST — renk tek kaynaktan: helper hazırlığı `computeReadyWorks`ten okur, top statüsü/hazırlık sınıfı
//      okumaz (yerel yüklem yok); helper dışında üretim-durumu adlı fonksiyon tanımı yok
//   §2 dört renk fikstürü: BEYAZ (bağ yok · yalnız iptal İE bağı) · SARI (işlemde İE · yalnız dokuma işi) ·
//      YEŞİL (bağlı İE sevke hazır · tamamı sevk edilmiş) · KIRMIZI (termin geçti, hazır değil); termin geçmiş
//      ama hazır satır YEŞİL; iptal satır haritada yok
//   §3 plan listesi: liste + cursor + özet tek süzgeçten (limit=1 sayfalama ↔ özet), renk süzgeci sunucuda,
//      tanınmayan renk/durum 400
//   §4 toplu sorgu: 1000 satırda sorgu sayısı küçük kümeyle EŞİT (N+1 yok)
// NEGATİF SONDA (kırmızı görülerek, 2026-10-31): bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { orderLineProductionState } from "../src/services/helpers/order-line-production-state.helper";
import { listOrderPlan, type OrderPlanRow } from "../src/services/order-plan.service";
import { AppError } from "../src/utils/app-error";
import { factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.join(__dirname, "..");
const HELPER = "src/services/helpers/order-line-production-state.helper.ts";
const TAG = `TEST-OLPS-${Date.now().toString(36)}`;
const SETTING_SNAPSHOT_KEYS = [SETTING_KEYS.SHIPPING_READY_RULE, SETTING_KEYS.SHIPPING_READY_TOLERANCE_PCT];
const DAY = 86_400_000;

// --- Sorgu sayacı: pg istemcisini sarmala (yalnız ölçüm penceresinde sayar) ---
let total = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) total++;
    return orig(...args);
  };
});
async function measure(fn: () => Promise<unknown>): Promise<number> {
  total = 0;
  capture = true;
  try { await fn(); } finally { capture = false; }
  return total;
}

async function catchErr(fn: () => Promise<unknown>): Promise<AppError | null> {
  try { await fn(); return null; } catch (e) { return e instanceof AppError ? e : null; }
}

// ---------------------------------------------------------------------------
// §1 AST
// ---------------------------------------------------------------------------
/** Helper'da yerel hazırlık yüklemi belirtisi: top statüsü / hazırlık sınıfı / top tablosu okuması. */
const LOCAL_PREDICATE_TOKENS = ["RollStatus", "READY_STATUSES", "SHIP_READY_", "readinessClass", "classifyShipReadiness", "currentQty", "roll"];
const STATE_FN_RE = /(productionstate|planstate|linestate)/i;

function walkSrc(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkSrc(p, out);
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
}

export function astViolations(): string[] {
  const out: string[] = [];
  const helperText = readFileSync(path.join(ROOT, HELPER), "utf8");
  const sf = ts.createSourceFile(HELPER, helperText, ts.ScriptTarget.Latest, true);
  let callsReadyWorks = false;
  const visitHelper = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      if (n.text === "computeReadyWorks" && ts.isCallExpression(n.parent)) callsReadyWorks = true;
      if (LOCAL_PREDICATE_TOKENS.some((t) => (t === "roll" ? /^roll/i.test(n.text) : n.text.includes(t)))) out.push(`${HELPER}: yerel hazırlık belirtisi ${n.text}`);
    }
    if (ts.isStringLiteral(n) && /rolls|"status"/i.test(n.text)) out.push(`${HELPER}: ham top sorgusu`);
    ts.forEachChild(n, visitHelper);
  };
  visitHelper(sf);
  if (!callsReadyWorks) out.push(`${HELPER}: hazırlık computeReadyWorks'ten okunmuyor`);

  const files: string[] = [];
  walkSrc(path.join(ROOT, "src"), files);
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    if (rel === HELPER) continue;
    const text = readFileSync(f, "utf8");
    if (!STATE_FN_RE.test(text)) continue;
    const src = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
        const isFn = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
          || (ts.isVariableDeclaration(n) && n.initializer !== undefined && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)));
        if (isFn && STATE_FN_RE.test(n.name.text)) out.push(`${rel}: tanım ${n.name.text}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return out;
}

function astCheck(): void {
  const v = astViolations();
  check("§1a AST: renk tek kaynaktan (helper computeReadyWorks okur, yerel yüklem yok, ikinci tanım yok)", v.length === 0, v.join(" · "));
  const helper = readFileSync(path.join(ROOT, HELPER), "utf8");
  check("§1b AST körlük zemini: helper tek kaynak fonksiyonu tanımlıyor", /export async function orderLineProductionState\(/.test(helper));
}

// ---------------------------------------------------------------------------
async function listAll(extra: Record<string, unknown>): Promise<OrderPlanRow[]> {
  const out: OrderPlanRow[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const d = (await listOrderPlan({ ...extra, cursor, limit: "1" })).data;
    out.push(...d.items);
    if (!d.nextCursor) break;
    cursor = d.nextCursor;
  }
  return out;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 2; await pool.end(); return; }
  console.log("=== SİPARİŞ SATIRI ÜRETİM DURUMU BEKÇİSİ ===\n");
  astCheck();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: SETTING_SNAPSHOT_KEYS } }, select: { key: true, value: true } });
  const ids = { item: "", cust: "", orders: [] as string[], wos: [] as string[], batches: [] as string[], weaving: "", rolls: [] as string[] };
  try {
    // Kural varsayılan (ALL_DONE): ayar satırları yokken.
    await prisma.systemSetting.deleteMany({ where: { key: { in: SETTING_SNAPSHOT_KEYS } } });
    ids.item = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
    ids.cust = (await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} Müşteri` }, select: { id: true } })).id;
    const now = new Date();
    const future = new Date(now.getTime() + 10 * DAY);
    const past = new Date(now.getTime() - 3 * DAY);

    let seq = 0;
    const mkOrder = async (deadline: Date, n: number, status: "APPROVED" | "COMPLETED" = "APPROVED") => {
      const o = await prisma.order.create({
        data: {
          orderNumber: `${TAG}-O${++seq}`, customerId: ids.cust, deadline, status, orderDate: new Date(now.getTime() - (100 - seq) * 60_000),
          lines: { create: Array.from({ length: n }, () => ({ itemId: ids.item, quantity: 100 })) },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      ids.orders.push(o.id);
      return o.lines.map((l) => l.id);
    };
    const mkWo = async (statuses: RollStatus[], woStatus: "IN_PROGRESS" | "CANCELLED" = "IN_PROGRESS") => {
      const wo = await prisma.workOrder.create({
        data: { workOrderNumber: `${TAG}-W${++seq}`, type: "ORDER_PRODUCTION", targetItemId: ids.item, targetQuantity: 100, status: woStatus },
        select: { id: true },
      });
      ids.wos.push(wo.id);
      const b = await prisma.batch.create({ data: { batchNumber: `${TAG}-B${seq}`, workOrderId: wo.id }, select: { id: true } });
      ids.batches.push(b.id);
      for (const st of statuses) {
        const r = await prisma.roll.create({
          data: { barcode: `${TAG}-R${++seq}`, itemId: ids.item, status: st, initialQty: 60, currentQty: 50, entrySource: "SEMI_FINISHED", batchId: b.id },
          select: { id: true },
        });
        ids.rolls.push(r.id);
      }
      return wo.id;
    };
    const link = (workOrderId: string, orderLineId: string) => prisma.workOrderToOrderLine.create({ data: { workOrderId, orderLineId, allocatedQty: 100 } });

    const [white] = await mkOrder(future, 1);
    const [whiteCancelledWo] = await mkOrder(future, 1);
    await link(await mkWo([RollStatus.IN_PRODUCTION], "CANCELLED"), whiteCancelledWo);
    const [yellow] = await mkOrder(future, 1);
    await link(await mkWo([RollStatus.WAREHOUSE, RollStatus.IN_PRODUCTION]), yellow);
    const [yellowWeaving] = await mkOrder(future, 1);
    const wv = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-DK`, itemId: ids.item, executionKind: "IN_HOUSE" }, select: { id: true } });
    ids.weaving = wv.id;
    await prisma.weavingOrderToOrderLine.create({ data: { weavingOrderId: wv.id, orderLineId: yellowWeaving } });
    const [green] = await mkOrder(future, 1);
    const readyWo = await mkWo([RollStatus.WAREHOUSE, RollStatus.WAREHOUSE]);
    await link(readyWo, green);
    const [greenShipped] = await mkOrder(future, 1);
    await prisma.orderLine.update({ where: { id: greenShipped }, data: { shippedQty: 100 } });
    const [red] = await mkOrder(past, 1);
    await link(await mkWo([RollStatus.IN_PRODUCTION]), red);
    const [redWhite] = await mkOrder(past, 1);
    const [greenPast] = await mkOrder(past, 1);
    await link(readyWo, greenPast);
    const [cancelled] = await mkOrder(future, 1);
    // Panel termini takvim günüdür (UTC gece yarısı): bugünün termini henüz geçmedi, dünün geçti.
    const todayKey = factoryYmd(now);
    const [dueToday] = await mkOrder(new Date(`${todayKey}T00:00:00.000Z`), 1);
    const [dueYesterday] = await mkOrder(new Date(new Date(`${todayKey}T00:00:00.000Z`).getTime() - DAY), 1);
    await prisma.orderLine.update({ where: { id: cancelled }, data: { cancelledAt: now } });

    const all = [white, whiteCancelledWo, yellow, yellowWeaving, green, greenShipped, red, redWhite, greenPast, cancelled];
    const m = await orderLineProductionState(all, now);
    const expect: Array<[string, string, string]> = [
      ["§2a bağ yok → BEYAZ", white, "WHITE"],
      ["§2b yalnız iptal İE bağı → BEYAZ", whiteCancelledWo, "WHITE"],
      ["§2c işlemde top olan bağlı İE → SARI", yellow, "YELLOW"],
      ["§2d yalnız dokuma işi bağı → SARI", yellowWeaving, "YELLOW"],
      ["§2e bağlı İE sevke hazır (ship-readiness READY) → YEŞİL", green, "GREEN"],
      ["§2f satırın tamamı sevk edilmiş → YEŞİL", greenShipped, "GREEN"],
      ["§2g termin geçti ∧ hazır değil → KIRMIZI", red, "RED"],
      ["§2h termin geçti ∧ bağ yok → KIRMIZI", redWhite, "RED"],
      ["§2i termin geçti ama hazır → YEŞİL", greenPast, "GREEN"],
    ];
    for (const [label, id, st] of expect) check(label, m.get(id) === st, String(m.get(id)));
    check("§2j iptal satır haritada yok", !m.has(cancelled));
    const md = await orderLineProductionState([dueToday, dueYesterday], now);
    check("§2l takvim günü termini: bugün BEYAZ, dün KIRMIZI", md.get(dueToday) === "WHITE" && md.get(dueYesterday) === "RED", `${md.get(dueToday)}/${md.get(dueYesterday)}`);
    // Hazırlık kuralı tek kaynaktan: İE topu işleme geri dönünce YEŞİL → SARI.
    const readyRoll = await prisma.roll.findFirst({ where: { batch: { workOrderId: readyWo } }, select: { id: true } });
    await prisma.roll.update({ where: { id: readyRoll!.id }, data: { status: RollStatus.IN_PRODUCTION } });
    const m2 = await orderLineProductionState([green, greenPast], now);
    check("§2k hazır top işleme dönünce YEŞİL → SARI / termin geçmişte KIRMIZI", m2.get(green) === "YELLOW" && m2.get(greenPast) === "RED", `${m2.get(green)}/${m2.get(greenPast)}`);
    await prisma.roll.update({ where: { id: readyRoll!.id }, data: { status: RollStatus.WAREHOUSE } });

    // §3 plan listesi
    const scope = { customerId: ids.cust };
    const full = (await listOrderPlan({ ...scope, limit: "200" })).data;
    check("§3a varsayılan açık siparişler; iptal satır listede yok", full.items.length === 11 && !full.items.some((r) => r.lineId === cancelled), `n=${full.items.length}`);
    check("§3b özet şeridi listeyle aynı küme", full.summary.lines === 11 && full.summary.white === 3 && full.summary.yellow === 2 && full.summary.green === 3 && full.summary.red === 3,
      JSON.stringify(full.summary));
    const paged = await listAll(scope);
    check("§3c limit=1 imleç sayfalaması özetle birebir, sıra tarih sırası", paged.length === 11 && paged.map((r) => r.lineId).join() === full.items.map((r) => r.lineId).join());
    const reds = (await listOrderPlan({ ...scope, state: "RED,WHITE" })).data;
    check("§3d renk süzgeci sunucuda ve özete de uyar", reds.items.length === 6 && reds.items.every((r) => r.state === "RED" || r.state === "WHITE") && reds.summary.lines === 6 && reds.summary.green === 0);
    const e1 = await catchErr(() => listOrderPlan({ state: "PURPLE" }));
    check("§3e tanınmayan renk 400 ORDER_PLAN_BAD_STATE", e1?.statusCode === 400 && e1.details?.code === "ORDER_PLAN_BAD_STATE");
    const e2 = await catchErr(() => listOrderPlan({ status: "CANCELLED" }));
    check("§3f iptal/tanınmayan sipariş durumu 400", e2?.statusCode === 400 && e2.details?.code === "ORDER_PLAN_BAD_STATUS");
    const e3 = await catchErr(() => listOrderPlan({ customerId: "x" }));
    check("§3g geçersiz müşteri kimliği 400", e3?.statusCode === 400);

    // §4 toplu sorgu: küçük küme ↔ 1000 satır sorgu sayısı EŞİT
    const small = [white, yellow, green, red];
    const qSmall = await measure(() => orderLineProductionState(small, now));
    const big = await prisma.order.create({ data: { orderNumber: `${TAG}-BIG`, customerId: ids.cust, deadline: future }, select: { id: true } });
    ids.orders.push(big.id);
    await prisma.orderLine.createMany({ data: Array.from({ length: 1000 }, () => ({ orderId: big.id, itemId: ids.item, quantity: 10 })) });
    const bigLines = (await prisma.orderLine.findMany({ where: { orderId: big.id }, select: { id: true } })).map((l) => l.id);
    const bigWos: string[] = [];
    for (let i = 0; i < 5; i++) bigWos.push(await mkWo([RollStatus.WAREHOUSE]));
    await prisma.workOrderToOrderLine.createMany({ data: bigLines.map((id, i) => ({ workOrderId: bigWos[i % 5], orderLineId: id, allocatedQty: 10 })) });
    let bigMap = new Map<string, string>();
    const qBig = await measure(async () => { bigMap = await orderLineProductionState(bigLines, now); });
    check("§4 körlük zemini: 1000 satır gerçekten çözüldü ve sorgu atıldı", bigMap.size === 1000 && qSmall > 0, `n=${bigMap.size} q=${qSmall}`);
    check("§4 1000 satırda sorgu sayısı küçük kümeyle EŞİT (toplu, N+1 yok)", qSmall === qBig, `küçük=${qSmall} · 1000=${qBig}`);
  } finally {
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: ids.wos } } });
    if (ids.weaving) {
      await prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: ids.weaving } });
      await prisma.weavingOrder.deleteMany({ where: { id: ids.weaving } });
    }
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    if (ids.cust) await prisma.customer.deleteMany({ where: { id: ids.cust } });
    for (const key of SETTING_SNAPSHOT_KEYS) {
      const f = foto.find((x) => x.key === key);
      if (f) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: f.value as Prisma.InputJsonValue }, update: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
