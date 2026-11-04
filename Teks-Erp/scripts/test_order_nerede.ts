// =============================================================================
// SİPARİŞ "NEREDE?" BEKÇİSİ (backend 2.11.4)
// =============================================================================
// Korunan davranış (tek kaynak `src/services/helpers/order-nerede*.helper.ts`):
//   §1 Saf türetme: her "Nerede?" dalı + "Sevk" dört durumu + termin sınırı.
//   §2 Liste zenginleştirme: fixture siparişlerinin cümlesi (aşama, fason firma+gün,
//      yalnız parti yoluyla bağlı sevke hazır top, eşitlik kırıcı, +K yer, çok İE'li sipariş).
//   §3 Süzgeçler: her sekme + fason firma + gün; liste = /stats sayımı; 400'ler.
//   §4 Sorgu bütçesi: zenginleştirme ve yan panel sorgu sayısı sipariş/İE sayısından bağımsız.
//   §5 Yan panel ucu şekli.
// Temizlik finally'de, yalnız kendi ürettiklerini siler (FK sırası).
// =============================================================================
import type { Request } from "express";
import { Client } from "pg";
import prisma from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";
import { deriveOrderNerede, deriveOrderSevk, type NeredePlace } from "../src/services/helpers/order-nerede.helper";
import { attachNerede } from "../src/services/helpers/order-nerede-load.helper";
import { factoryDayStart } from "../src/constants/time";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "hata yok";
  } catch (err) {
    const e = err as { statusCode?: number; details?: { code?: unknown } };
    return `${e.statusCode} ${String(e.details?.code)}`;
  }
}

// pg sorgu sayacı: Prisma adapter'ı her sorguyu `Client.prototype.query`den geçirir.
let queryCount = 0;
const origQuery = Client.prototype.query;
(Client.prototype as unknown as { query: (...a: unknown[]) => unknown }).query = function (
  this: Client,
  ...args: unknown[]
) {
  queryCount++;
  return (origQuery as unknown as (...a: unknown[]) => unknown).apply(this, args);
};
async function countQueries(fn: () => Promise<unknown>): Promise<number> {
  const start = queryCount;
  await fn();
  return queryCount - start;
}

interface Row {
  id: string;
  nerede?: { kind: string; tone: string; text: string; extraPlaces: number; overdue: boolean; overdueText: string | null };
  sevk?: { kind: string; text: string; shipped: number; requested: number | null; unit: string | null };
}

function pureChecks(): void {
  const now = new Date();
  const open = { status: "APPROVED" as const, manualClosedById: null, deadline: null };
  const none = { activeWoCount: 0, places: [], anyRoll: false };
  const one = { activeWoCount: 1, places: [], anyRoll: false };
  check("§1 iptal", deriveOrderNerede({ ...open, status: "CANCELLED" }, one).text === "Sipariş iptal edildi");
  check("§1 otomatik kapanış → Hepsi gönderildi", deriveOrderNerede({ ...open, status: "COMPLETED" }, one).kind === "ALL_SHIPPED");
  const closed = { ...open, status: "COMPLETED" as const, manualClosedById: "u" };
  check("§1 elle kapatılan → Sipariş kapatıldı", deriveOrderNerede(closed, one).text === "Sipariş kapatıldı");
  check("§1 İE yok", deriveOrderNerede(open, none).text === "İş emri açılmadı");
  check("§1 İE var top yok", deriveOrderNerede(open, one).text === "İşe başlanmadı");
  check("§1 toplar gitmiş", deriveOrderNerede(open, { ...one, anyRoll: true }).text === "Üretilen toplar gönderildi");
  const pl = (kind: NeredePlace["kind"], name: string, rollCount: number, sequence: number, days: number | null = null): NeredePlace => ({
    kind, key: `${kind}:${name}`, name, rollCount, sequence, days,
  });
  const fason = deriveOrderNerede(open, { ...one, places: [pl("FASON", "Akın Boya", 8, 2, 3)] });
  check("§1 fason cümlesi", fason.text === "Fasonda – Akın Boya · 8 top · 3 gündür" && fason.tone === "orange", fason.text);
  const today = deriveOrderNerede(open, { ...one, places: [pl("FASON", "Akın Boya", 1, 2, 0)] });
  check("§1 fason bugün", today.text === "Fasonda – Akın Boya · 1 top · bugün gönderildi", today.text);
  const tie = deriveOrderNerede(open, {
    ...one,
    places: [pl("STEP", "Tambur", 2, 5), pl("FASON", "X", 2, 2, 1), pl("READY", "", 2, Number.MAX_SAFE_INTEGER)],
  });
  check("§1 eşitlikte hazır önde + K", tie.text === "Sevke hazır · 2 top · +2 yerde daha" && tie.extraPlaces === 2, tie.text);
  const tie2 = deriveOrderNerede(open, { ...one, places: [pl("STEP", "Ham kontrol", 3, 1), pl("STEP", "Tambur", 3, 4)] });
  check("§1 aynı türde büyük rota sırası önde", tie2.text === "Tambur aşamasında · 3 top · +1 yerde daha", tie2.text);

  const start = factoryDayStart(now);
  check("§1 termin bugün → geçmedi", !deriveOrderNerede({ ...open, deadline: start }, none, now).overdue);
  const late = deriveOrderNerede({ ...open, deadline: new Date(start.getTime() - 1) }, none, now);
  check("§1 termin dün → Termini geçti", late.overdue && late.overdueText === "Termini geçti");
  check("§1 kapanmış siparişte termin rozeti yok", !deriveOrderNerede({ ...open, status: "COMPLETED", deadline: new Date(0) }, none, now).overdue);

  const L = (q: number, s: number, unit: "MT" | "KG" = "MT", cancelled = false) => ({
    quantity: q, shippedQty: s, unit, cancelledAt: cancelled ? new Date() : null,
  });
  check("§1 sevk yok", deriveOrderSevk(open, [L(100, 0)]).text === "Henüz gönderilmedi");
  const part = deriveOrderSevk(open, [L(2000, 1200), L(400, 0)]);
  check("§1 kısmi sevk", part.text === "Bir kısmı gönderildi (1.200 / 2.400 m)", part.text);
  check("§1 sevk ≥ istenen", deriveOrderSevk(open, [L(100, 100)]).kind === "ALL");
  const cancelLine = deriveOrderSevk(open, [L(100, 50), L(500, 30, "MT", true)]);
  check("§1 iptal kalemin yalnız sevk edileni istenene girer", cancelLine.requested === 130 && cancelLine.text === "Bir kısmı gönderildi (80 / 130 m)", cancelLine.text);
  const mixed = deriveOrderSevk({ ...open, status: "PARTIAL_SHIPPED" }, [L(100, 50), L(10, 0, "KG")]);
  check("§1 karışık birimde sayı yok", mixed.text === "Bir kısmı gönderildi" && mixed.unit === null, mixed.text);
  const cl = deriveOrderSevk(closed, [L(2400, 1200)]);
  check("§1 elle kapatılan sevk", cl.kind === "CLOSED" && cl.text === "Sipariş kapatıldı (1.200 / 2.400 m gönderildi)", cl.text);
}

async function main(): Promise<void> {
  pureChecks();

  const ts = Date.now();
  const P = `TEST-NRD-${ts}`;
  const ids = { customers: [] as string[], items: [] as string[], stations: [] as string[], orders: [] as string[], wos: [] as string[], batches: [] as string[], rolls: [] as string[], dispatches: [] as string[] };
  const DAY = 86_400_000;

  try {
    const dye = await ensureTestDyeHouse();
    const customer = await prisma.customer.create({ data: { code: `TNRD${ts}`, name: `${P} MUSTERI` }, select: { id: true } });
    ids.customers.push(customer.id);
    const item = await prisma.item.create({
      data: { code: `${P}-IT`, name: `${P} KUMAS`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    ids.items.push(item.id);
    const inSt = await prisma.station.create({
      data: { code: `${P}-IC`, name: `${P} Ham kontrol`, type: "INTERNAL", kind: "OTHER" },
      select: { id: true, name: true },
    });
    const exSt = await prisma.station.create({
      data: { code: `${P}-FS`, name: `${P} Boyahane`, type: "EXTERNAL", kind: "SUBCONTRACTOR" },
      select: { id: true },
    });
    ids.stations.push(inSt.id, exSt.id);

    let n = 0;
    const mkOrder = async (status: "APPROVED" | "PARTIAL_SHIPPED" | "COMPLETED" | "CANCELLED", qty: number, shipped: number, deadline: Date | null = null) => {
      n++;
      const o = await prisma.order.create({
        data: {
          orderNumber: `${P}-${n}`,
          customerId: customer.id,
          status,
          deadline,
          shippedQty: shipped,
          lines: { create: [{ itemId: item.id, quantity: qty, shippedQty: shipped, unit: "MT" }] },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      ids.orders.push(o.id);
      return { id: o.id, lineId: o.lines[0]!.id };
    };
    const mkWo = async (status: "PLANNED" | "IN_PROGRESS" | "COMPLETED", lineIds: string[]) => {
      n++;
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${P}-IE-${n}`,
          status,
          type: "ORDER_PRODUCTION",
          targetItemId: item.id,
          width: 300,
          steps: { create: [{ stationId: inSt.id, stepSequence: 1 }, { stationId: exSt.id, stepSequence: 2 }] },
        },
        select: { id: true, steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
      });
      ids.wos.push(wo.id);
      for (const l of lineIds) await prisma.workOrderToOrderLine.create({ data: { workOrderId: wo.id, orderLineId: l } });
      const b = await prisma.batch.create({ data: { batchNumber: `${P}-B${n}`.slice(0, 60), workOrderId: wo.id }, select: { id: true } });
      ids.batches.push(b.id);
      return { id: wo.id, s1: wo.steps[0]!.id, s2: wo.steps[1]!.id, batchId: b.id };
    };
    type RS = "IN_PRODUCTION" | "AT_SUBCONTRACTOR" | "WAREHOUSE" | "SHIPPED";
    const mkRoll = async (status: RS, opts: { batchId?: string; stepId?: string; qty?: number }) => {
      const r = await prisma.roll.create({
        data: {
          itemId: item.id, initialQty: opts.qty ?? 100, currentQty: opts.qty ?? 100, width: 300, status,
          batchId: opts.batchId ?? null, currentStepId: opts.stepId ?? null,
        },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    const mkDispatch = async (wo: { id: string; batchId: string }, stepId: string, at: Date, rollIds: string[]) => {
      n++;
      const d = await prisma.subcontractorDispatch.create({
        data: {
          dispatchNo: `${P}-SD${n}`, subcontractorId: dye.id, workOrderId: wo.id, batchId: wo.batchId, stepId, dispatchedAt: at,
          items: { create: rollIds.map((rollId) => ({ rollId, dispatchedQty: 100 })) },
        },
        select: { id: true },
      });
      ids.dispatches.push(d.id);
    };

    const now = new Date();
    const oCancel = await mkOrder("CANCELLED", 100, 0);
    const oDone = await mkOrder("COMPLETED", 100, 100);
    const oNoWo = await mkOrder("APPROVED", 100, 0, new Date(now.getTime() - 3 * DAY));
    const oPlanned = await mkOrder("APPROVED", 100, 0);
    const oShipped = await mkOrder("PARTIAL_SHIPPED", 200, 120);
    const oMulti = await mkOrder("APPROVED", 500, 0);
    const oReady = await mkOrder("APPROVED", 200, 0);
    const oTie = await mkOrder("APPROVED", 200, 0);

    await mkWo("PLANNED", [oPlanned.lineId]);
    const woShipped = await mkWo("COMPLETED", [oShipped.lineId]);
    await mkRoll("SHIPPED", { batchId: woShipped.batchId });
    const woMulti = await mkWo("IN_PROGRESS", [oMulti.lineId]);
    for (let i = 0; i < 3; i++) await mkRoll("IN_PRODUCTION", { batchId: woMulti.batchId, stepId: woMulti.s1 });
    const sub1 = [await mkRoll("AT_SUBCONTRACTOR", { batchId: woMulti.batchId, stepId: woMulti.s2 }), await mkRoll("AT_SUBCONTRACTOR", { batchId: woMulti.batchId, stepId: woMulti.s2 })];
    await mkDispatch(woMulti, woMulti.s2, new Date(now.getTime() - 5 * DAY), sub1);
    // Hazır toplar YALNIZ parti yoluyla bağlı (currentStep/producedInStep yok) — sahadaki WAREHOUSE şekli.
    const woReady = await mkWo("COMPLETED", [oReady.lineId]);
    await mkRoll("WAREHOUSE", { batchId: woReady.batchId });
    await mkRoll("WAREHOUSE", { batchId: woReady.batchId });
    const woTie = await mkWo("IN_PROGRESS", [oTie.lineId]);
    await mkRoll("WAREHOUSE", { batchId: woTie.batchId });
    const subTie = await mkRoll("AT_SUBCONTRACTOR", { batchId: woTie.batchId, stepId: woTie.s2 });
    await mkDispatch(woTie, woTie.s2, now, [subTie]);
    // Çok İE'li sipariş: üç İE'nin toplarını birlikte görür (paylaşılan İE bilgisi her siparişte).
    const oThree = await mkOrder("APPROVED", 900, 0);
    for (const w of [woMulti, woReady, woTie]) await prisma.workOrderToOrderLine.create({ data: { workOrderId: w.id, orderLineId: oThree.lineId } });

    // ── §2 liste ──────────────────────────────────────────────────────────
    const list = async (q: Record<string, string> = {}) =>
      (await orderService.findAll({ query: { "filter[customerId]": customer.id, pageSize: "50", ...q } } as unknown as Request)) as unknown as {
        data: Row[];
        pagination: { total: number };
      };
    const stats = async (q: Record<string, string> = {}) =>
      ((await orderService.getOrderStats({ query: { "filter[customerId]": customer.id, ...q } } as unknown as Request)).data as { totalCount: number }).totalCount;

    const all = await list();
    const by = new Map(all.data.map((r) => [r.id, r]));
    const t = (o: { id: string }) => by.get(o.id)?.nerede?.text ?? "(yok)";
    check("§2 tüm satırlarda nerede+sevk", all.data.length === 9 && all.data.every((r) => r.nerede && r.sevk), String(all.data.length));
    check("§2 iptal", t(oCancel) === "Sipariş iptal edildi", t(oCancel));
    check("§2 hepsi gönderildi", t(oDone) === "Hepsi gönderildi" && by.get(oDone.id)?.sevk?.kind === "ALL", t(oDone));
    check("§2 İE yok + Termini geçti", t(oNoWo) === "İş emri açılmadı" && by.get(oNoWo.id)?.nerede?.overdueText === "Termini geçti", t(oNoWo));
    check("§2 işe başlanmadı", t(oPlanned) === "İşe başlanmadı", t(oPlanned));
    check("§2 üretilen toplar gönderildi", t(oShipped) === "Üretilen toplar gönderildi", t(oShipped));
    check("§2 kısmi sevk metni", by.get(oShipped.id)?.sevk?.text === "Bir kısmı gönderildi (120 / 200 m)", by.get(oShipped.id)?.sevk?.text);
    check("§2 aşama + fason ikinci yer", t(oMulti) === `${inSt.name} aşamasında · 3 top · +1 yerde daha`, t(oMulti));
    check("§2 parti yoluyla bağlı hazır toplar", t(oReady) === "Sevke hazır · 2 top", t(oReady));
    check("§2 eşitlikte hazır > fason", t(oTie) === "Sevke hazır · 1 top · +1 yerde daha", t(oTie));
    check("§2 çok İE'li sipariş birleşik sayım", t(oThree) === "Sevke hazır · 3 top · +2 yerde daha", t(oThree));
    const cur = (await orderService.findAll({ query: { "filter[customerId]": customer.id, mode: "cursor", limit: "50" } } as unknown as Request)) as unknown as { data: Row[] };
    check("§2 cursor modunda da zenginleşir", cur.data.length === 9 && cur.data.every((r) => r.nerede?.text === by.get(r.id)?.nerede?.text));

    // ── §3 süzgeçler ──────────────────────────────────────────────────────
    const expectSet = async (label: string, q: Record<string, string>, want: { id: string }[]) => {
      const r = await list(q);
      const got = r.data.map((x) => x.id).sort();
      const exp = want.map((x) => x.id).sort();
      const st = await stats(q);
      check(`§3 ${label}`, JSON.stringify(got) === JSON.stringify(exp) && r.pagination.total === exp.length && st === exp.length, `liste=${got.length} beklenen=${exp.length} stats=${st}`);
    };
    const openAll = [oNoWo, oPlanned, oShipped, oMulti, oReady, oTie, oThree];
    await expectSet("BEKLEYEN", { "filter[nerede]": "BEKLEYEN" }, openAll);
    await expectSet("FASONDA", { "filter[nerede]": "FASONDA" }, [oMulti, oTie, oThree]);
    await expectSet("SEVKE_HAZIR", { "filter[nerede]": "SEVKE_HAZIR" }, [oReady, oTie, oThree]);
    await expectSet("KISMEN", { "filter[nerede]": "KISMEN" }, [oShipped]);
    await expectSet("GECIKEN", { "filter[nerede]": "GECIKEN" }, [oNoWo]);
    await expectSet("fasonFirma", { "filter[fasonFirma]": dye.id }, [oMulti, oTie, oThree]);
    await expectSet("fasonGun=3 (5 gündür olan)", { "filter[fasonGun]": "3" }, [oMulti, oThree]);
    await expectSet("fasonGun=0 (bugün gönderilen hariç)", { "filter[fasonGun]": "0", "filter[nerede]": "FASONDA" }, [oMulti, oThree]);
    await expectSet("fasonGun=10", { "filter[fasonGun]": "10" }, []);
    await expectSet("boş değer = süzgeç yok", { "filter[nerede]": "" }, all.data);
    for (const [k, v] of [["nerede", "x"], ["nerede", "fasonda"], ["fasonGun", "-1"], ["fasonGun", "abc"], ["fasonGun", "2.5"], ["fasonGun", "3651"], ["fasonFirma", "abc"]] as const) {
      const code = await errorCode(() => list({ [`filter[${k}]`]: v }));
      check(`§3 400 filter[${k}]=${v}`, code === "400 INVALID_FILTER_VALUE", code);
    }
    const sc = await errorCode(() => stats({ "filter[nerede]": "x" }));
    check("§3 /stats da 400", sc === "400 INVALID_FILTER_VALUE", sc);

    // ── §4 sorgu bütçesi ──────────────────────────────────────────────────
    const rows = all.data as unknown as Record<string, unknown>[];
    const small = rows.filter((r) => r.id === oMulti.id || r.id === oShipped.id);
    const q2 = await countQueries(() => attachNerede(small));
    const q9 = await countQueries(() => attachNerede(rows));
    check("§4 zenginleştirme: 2 sipariş = 9 sipariş sorgu sayısı", q2 === q9 && q9 > 0 && q9 <= 12, `${q2} / ${q9}`);
    const d1 = await countQueries(() => orderService.getNerede(oMulti.id));
    const d3 = await countQueries(() => orderService.getNerede(oThree.id));
    check("§4 yan panel: 1 İE = 3 İE sorgu sayısı", d1 === d3 && d1 > 0, `${d1} / ${d3}`);

    // ── §5 yan panel ──────────────────────────────────────────────────────
    const det = (await orderService.getNerede(oMulti.id)).data as {
      nerede: { text: string };
      workOrders: Array<{ steps: Array<{ state: string; rollCount: number; text: string; fason: Array<{ days: number; text: string }> }>; ready: { rollCount: number }; lastMovementText: string | null }>;
    };
    check("§5 detay nerede = liste", det.nerede.text === t(oMulti));
    const w = det.workOrders[0];
    check("§5 tek İE kartı", det.workOrders.length === 1);
    check("§5 aşama adımı CURRENT + 3 top", w?.steps[0]?.state === "CURRENT" && w.steps[0].rollCount === 3, w?.steps[0]?.text);
    check("§5 fason adımı firma + 5 gün", w?.steps[1]?.fason[0]?.days === 5 && w.steps[1].fason[0].text === `${dye.name} · 2 top · 5 gündür`, w?.steps[1]?.fason[0]?.text);
    check("§5 son hareket fabrika saatiyle", typeof w?.lastMovementText === "string" && /^\d\d\.\d\d\.\d{4} \d\d:\d\d$/.test(w.lastMovementText ?? ""), String(w?.lastMovementText));
    const det3 = (await orderService.getNerede(oThree.id)).data as { workOrders: Array<{ ready: { rollCount: number } }> };
    check("§5 üç İE kartı, hazır toplam 3", det3.workOrders.length === 3 && det3.workOrders.reduce((a, x) => a + x.ready.rollCount, 0) === 3);
    const nf = await errorCode(() => orderService.getNerede("00000000-0000-4000-8000-000000000000"));
    check("§5 olmayan sipariş 404", nf.startsWith("404"), nf);
  } finally {
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: ids.dispatches } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.wos, ...ids.rolls] } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: ids.wos } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: ids.wos } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids.wos } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
    await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
