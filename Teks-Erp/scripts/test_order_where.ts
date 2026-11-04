// =============================================================================
// Test: Siparişler ekranı "Nerede?" — türetme + süzgeç ikizi + sorgu bütçesi (2026-11-04)
// Çalıştır: npx tsx scripts/test_order_where.ts
// Kaynak: `src/services/helpers/order-where.helper.ts` + `order-where-filter.helper.ts` (OrderService.findAll · extraWhere · getOrderWhereDetail).
// Kurulum: kendi müşterisi + 2 TEST istasyonu (Kalite iç · Boyahane dış) + TEST fasoncu; on bir sipariş:
//   IPT (iptal) · TAM (tamam) · YOK (İE yok) · BAS (PLANNED İE, topsuz) · ASM (3 top Kalite'de) ·
//   FAS (2 top fasonda, gönderim 5 gün önce) · HAZ (2 top depoda, producedInStep yolu) ·
//   COK (PARTIAL_SHIPPED + termin geçmiş: 3 Kalite · 1 firmasız fason · 1 depoda batch yolu) ·
//   GIT (topları gönderilmiş) · ORT (ASM'nin İE'sine bağlı ikinci sipariş) · CNC (yalnız İPTAL İE'li).
// Doğrulananlar:
//   §1 türetme: her durum + yer listesi + gün + termin; ortak İE iki siparişte aynı yer.
//   §2 BOĞAZ İKİZİ: her sekme süzgecinin döndürdüğü küme == türetmede o yeri/durumu taşıyanlar == beklenen.
//   §3 firma / gün süzgeci == bellekte FASON yeri (firma, gün > X).
//   §4 fail-closed: tanınmayan sekme · bozuk firma id · bozuk gün → 400 INVALID_FILTER_VALUE; çıplak ad → 400 BARE_FILTER_PARAM.
//   §5 tek where: her sekmede liste total == özet totalCount.
//   §6 sorgu bütçesi: 2 satırlık ve 11 satırlık sayfa aynı sorgu sayısı (N+1 yok).
//   §7 yan panel ucu: adım ilerlemesi (GECTI/BURADA/SIRADA), fason firma + gün.
//   §8 üretim kapalı: `nerede` null; FASONDA/firma süzgeci (liste + özet) 403 MODULE_DISABLED; BEKLEYEN serbest.
// NEGATİF SONDA (2026-11-04, kırmızı görüldü, tek tek): FASONDA sekmesi yalnız açık sipariş → §2 FASONDA ❌ ·
//   firmasız fason yeri düştü → §1f §2 FASONDA ❌ · hazır topun batch yolu SQL'den düştü → §1f §2 SEVKE_HAZIR ❌ ·
//   gün eşiği bir gün kaydı → §3b(5) ❌ · sipariş başına `loadWorkOrderFacts` (N+1) → §6 ❌ (28 vs 58 sorgu).
// =============================================================================
import { Request } from "express";
import { RollStatus, StationKind, StationType, WorkOrderStatus, type OrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import type { OrderWhere } from "../src/services/helpers/order-where.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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

const makeReq = (query: Record<string, string>): Request => ({ query }) as unknown as Request;
type Row = { id: string; orderNumber: string; status: OrderStatus; nerede: OrderWhere | null };
type ListResult = { data: Row[]; pagination: { total?: number } };
const DAY = 86_400_000;

async function errOf(fn: () => Promise<unknown>): Promise<{ status?: number; code?: unknown }> {
  try {
    await fn();
    return {};
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: unknown } };
    return { status: err.statusCode, code: err.details?.code };
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`Bekçi koşulmadı — ${engel}`);
    process.exitCode = 1;
    return;
  }
  const ts = Date.now();
  const TAG = `TEST-OWHERE-${ts}`;
  const short = String(ts).slice(-8);
  const dye = await ensureTestDyeHouse();
  const created = { stations: [] as string[], wos: [] as string[], rolls: [] as string[], dispatches: [] as string[], batches: [] as string[] };
  const prodRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.PRODUCTION_ENABLED } });

  try {
    const customer = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` }, select: { id: true } });
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    const mkStation = async (s: string, name: string, type: StationType, kind: StationKind) => {
      const st = await prisma.station.create({ data: { code: `TOW-${s}-${short}`, name: `${name} ${short}`, type, kind }, select: { id: true, name: true } });
      created.stations.push(st.id);
      return st;
    };
    const sK = await mkStation("K", "TEST Kalite", StationType.INTERNAL, StationKind.PROCESS_QC);
    const sB = await mkStation("B", "TEST Boyahane", StationType.EXTERNAL, StationKind.SUBCONTRACTOR);

    const orders: Record<string, { id: string; lineId: string }> = {};
    const mkOrder = async (no: string, status: OrderStatus, deadline?: Date) => {
      const o = await prisma.order.create({
        data: {
          orderNumber: `${TAG}-${no}`,
          customerId: customer.id,
          status,
          ...(deadline ? { deadline } : {}),
          lines: { create: [{ itemId: item.id, quantity: 1000 }] },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      orders[no] = { id: o.id, lineId: o.lines[0].id };
    };
    const mkWo = async (suffix: string, status: WorkOrderStatus, linkTo: string[]) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `${TAG}-${suffix}`,
          status,
          steps: { create: [{ stationId: sK.id, stepSequence: 1 }, { stationId: sB.id, stepSequence: 2 }] },
        },
        select: { id: true, steps: { select: { id: true, stationId: true } } },
      });
      created.wos.push(wo.id);
      for (const no of linkTo) {
        await prisma.workOrderToOrderLine.create({ data: { workOrderId: wo.id, orderLineId: orders[no].lineId, allocatedQty: 100 } });
      }
      const step = (st: { id: string }) => wo.steps.find((x) => x.stationId === st.id)!.id;
      return { id: wo.id, k: step(sK), b: step(sB) };
    };
    let seq = 0;
    const mkRolls = async (n: number, status: RollStatus, at: { currentStepId?: string; producedInStepId?: string; batchId?: string }) => {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await prisma.roll.create({
          data: { barcode: `${TAG}-R${++seq}`, itemId: item.id, initialQty: 100, currentQty: 100, status, ...at },
          select: { id: true },
        });
        created.rolls.push(r.id);
        ids.push(r.id);
      }
      return ids;
    };

    await mkOrder("IPT", "CANCELLED");
    await mkOrder("TAM", "COMPLETED");
    await mkOrder("YOK", "APPROVED");
    await mkOrder("BAS", "APPROVED");
    await mkOrder("ASM", "APPROVED");
    await mkOrder("FAS", "APPROVED");
    await mkOrder("HAZ", "APPROVED");
    await mkOrder("COK", "PARTIAL_SHIPPED", new Date(Date.now() - 3 * DAY));
    await mkOrder("GIT", "APPROVED");
    await mkOrder("ORT", "APPROVED");
    await mkOrder("CNC", "APPROVED");

    await mkWo("BAS", WorkOrderStatus.PLANNED, ["BAS"]);
    const wAsm = await mkWo("ASM", WorkOrderStatus.IN_PROGRESS, ["ASM", "ORT"]);
    await mkRolls(3, RollStatus.IN_PRODUCTION, { currentStepId: wAsm.k });
    const wFas = await mkWo("FAS", WorkOrderStatus.IN_PROGRESS, ["FAS"]);
    const fasRolls = await mkRolls(2, RollStatus.AT_SUBCONTRACTOR, { currentStepId: wFas.b });
    const batch = await prisma.batch.create({ data: { batchNumber: `${TAG}-P1`, workOrderId: wFas.id }, select: { id: true } });
    created.batches.push(batch.id);
    const d = await prisma.subcontractorDispatch.create({
      data: {
        dispatchNo: `${TAG}-SD1`, workOrderId: wFas.id, batchId: batch.id, stepId: wFas.b, subcontractorId: dye.id,
        totalQty: 200, dispatchedAt: new Date(Date.now() - 5 * DAY),
      },
      select: { id: true },
    });
    created.dispatches.push(d.id);
    for (const rollId of fasRolls) await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d.id, rollId, dispatchedQty: 100 } });
    const wHaz = await mkWo("HAZ", WorkOrderStatus.IN_PROGRESS, ["HAZ"]);
    await mkRolls(2, RollStatus.WAREHOUSE, { producedInStepId: wHaz.k });
    const wCok = await mkWo("COK", WorkOrderStatus.IN_PROGRESS, ["COK"]);
    await mkRolls(3, RollStatus.IN_PRODUCTION, { currentStepId: wCok.k });
    await mkRolls(1, RollStatus.AT_SUBCONTRACTOR, { currentStepId: wCok.b });
    const bCok = await prisma.batch.create({ data: { batchNumber: `${TAG}-P2`, workOrderId: wCok.id }, select: { id: true } });
    created.batches.push(bCok.id);
    await mkRolls(1, RollStatus.WAREHOUSE, { batchId: bCok.id });
    const wGit = await mkWo("GIT", WorkOrderStatus.COMPLETED, ["GIT"]);
    await mkRolls(2, RollStatus.SHIPPED, { producedInStepId: wGit.k });
    const wCnc = await mkWo("CNC", WorkOrderStatus.CANCELLED, ["CNC"]);
    await mkRolls(1, RollStatus.AT_SUBCONTRACTOR, { currentStepId: wCnc.b });

    const C = { "filter[customerId]": customer.id, pageSize: "50" };
    const list = async (q: Record<string, string>) => (await orderService.findAll(makeReq({ ...C, ...q }))) as unknown as ListResult;
    const nosOf = (r: ListResult) => new Set(r.data.map((o) => o.orderNumber.slice(TAG.length + 1)));
    const setEq = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));
    const fmt = (s: Set<string>) => [...s].sort().join(",");

    // ── §1 türetme ──────────────────────────────────────────────────────────
    const all = await list({});
    const by = new Map(all.data.map((o) => [o.orderNumber.slice(TAG.length + 1), o.nerede as OrderWhere]));
    const st = (no: string) => by.get(no)?.durum;
    check("§1a İPTAL / TAMAM / İE yok / başlanmadı / gönderildi durumları",
      st("IPT") === "IPTAL" && st("TAM") === "TAMAM" && st("YOK") === "IE_YOK" && st("BAS") === "BASLANMADI" && st("GIT") === "GONDERILDI",
      ["IPT", "TAM", "YOK", "BAS", "GIT"].map((n) => `${n}=${st(n)}`).join(" "));
    check("§1b yalnız iptal edilmiş İE'li sipariş → İE yok (fasondaki topu sayılmaz)", st("CNC") === "IE_YOK", `CNC=${st("CNC")}`);
    const asm = by.get("ASM");
    check("§1c aşama: Kalite'de 3 top 300 m", asm?.durum === "YERLER" && asm.yerler.length === 1 && asm.yerler[0].tur === "ASAMA" &&
      asm.yerler[0].id === sK.id && asm.yerler[0].topSayisi === 3 && asm.yerler[0].metre === 300, JSON.stringify(asm?.yerler));
    const fas = by.get("FAS");
    check("§1d fason: firma + 2 top + 5 fabrika günü", fas?.yerler.length === 1 && fas.yerler[0].tur === "FASON" && fas.yerler[0].id === dye.id &&
      fas.yerler[0].ad === dye.name && fas.yerler[0].topSayisi === 2 && fas.yerler[0].gun === 5, JSON.stringify(fas?.yerler));
    const haz = by.get("HAZ");
    check("§1e sevke hazır: 2 top (producedInStep yolu)", haz?.yerler.length === 1 && haz.yerler[0].tur === "HAZIR" && haz.yerler[0].topSayisi === 2, JSON.stringify(haz?.yerler));
    const cok = by.get("COK");
    check("§1f çok yer: en çok top önce (Kalite 3) + firmasız fason 1 + hazır 1 (batch yolu)",
      cok?.yerler.length === 3 && cok.yerler[0].tur === "ASAMA" && cok.yerler[0].topSayisi === 3 &&
        cok.yerler.some((y) => y.tur === "FASON" && y.id === null && y.topSayisi === 1) && cok.yerler.some((y) => y.tur === "HAZIR" && y.topSayisi === 1),
      JSON.stringify(cok?.yerler));
    check("§1g termin geçti yalnız açık + termini geçmiş siparişte", cok?.terminGecti === true && [...by.entries()].filter(([, v]) => v.terminGecti).length === 1);
    check("§1h ortak İE: ORT, ASM ile aynı yer", JSON.stringify(by.get("ORT")?.yerler) === JSON.stringify(asm?.yerler));
    check("§1i son hareket dolu (statusChangedAt trigger'ı)", !!asm?.sonHareket && !!fas?.sonHareket);

    // ── §2 boğaz ikizi ──────────────────────────────────────────────────────
    const mem = (pred: (o: Row) => boolean) => new Set(all.data.filter(pred).map((o) => o.orderNumber.slice(TAG.length + 1)));
    const tabs: Array<[string, string[], (o: Row) => boolean]> = [
      ["BEKLEYEN", ["YOK", "BAS", "ASM", "FAS", "HAZ", "COK", "GIT", "ORT", "CNC"], (o) => o.status !== "COMPLETED" && o.status !== "CANCELLED"],
      ["FASONDA", ["FAS", "COK"], (o) => !!o.nerede?.yerler.some((y) => y.tur === "FASON")],
      ["SEVKE_HAZIR", ["HAZ", "COK"], (o) => !!o.nerede?.yerler.some((y) => y.tur === "HAZIR")],
      ["KISMEN", ["COK"], (o) => o.status === "PARTIAL_SHIPPED"],
      ["GECIKEN", ["COK"], (o) => !!o.nerede?.terminGecti],
    ];
    for (const [tab, expected, pred] of tabs) {
      const got = nosOf(await list({ "filter[nerede]": tab }));
      const m = mem(pred);
      check(`§2 ${tab}: süzgeç == bellek == beklenen`, setEq(got, expected) && setEq(m, expected), `süzgeç=${fmt(got)} bellek=${fmt(m)}`);
    }
    const csv = nosOf(await list({ "filter[nerede]": "KISMEN,SEVKE_HAZIR" }));
    check("§2b CSV = VEYA", setEq(csv, ["HAZ", "COK"]), fmt(csv));

    // ── §3 firma / gün ──────────────────────────────────────────────────────
    const firmMem = mem((o) => !!o.nerede?.yerler.some((y) => y.tur === "FASON" && y.id === dye.id));
    const firm = nosOf(await list({ "filter[fasonFirmaId]": dye.id }));
    check("§3a firma süzgeci == bellek (yalnız FAS; firmasız fason eşleşmez)", setEq(firm, ["FAS"]) && setEq(firmMem, ["FAS"]), fmt(firm));
    for (const [x, exp] of [["4", ["FAS"]], ["5", []]] as const) {
      const got = nosOf(await list({ "filter[fasondaGunden]": x }));
      const m = mem((o) => !!o.nerede?.yerler.some((y) => y.tur === "FASON" && y.id !== null && (y.gun ?? -1) > Number(x)));
      check(`§3b fasonda ${x} günden uzun == bellek`, setEq(got, [...exp]) && setEq(m, [...exp]), `süzgeç=${fmt(got)} bellek=${fmt(m)}`);
    }
    const combo = nosOf(await list({ "filter[nerede]": "FASONDA", "filter[fasonFirmaId]": dye.id, "filter[fasondaGunden]": "4" }));
    check("§3c sekme + firma + gün birlikte (VE)", setEq(combo, ["FAS"]), fmt(combo));

    // ── §4 fail-closed ──────────────────────────────────────────────────────
    for (const [label, q, code] of [
      ["tanınmayan sekme", { "filter[nerede]": "HEPSI" }, "INVALID_FILTER_VALUE"],
      ["bozuk firma id", { "filter[fasonFirmaId]": "abc" }, "INVALID_FILTER_VALUE"],
      ["negatif gün", { "filter[fasondaGunden]": "-1" }, "INVALID_FILTER_VALUE"],
      ["ondalık gün", { "filter[fasondaGunden]": "2.5" }, "INVALID_FILTER_VALUE"],
      ["çıplak nerede", { nerede: "FASONDA" }, "BARE_FILTER_PARAM"],
      ["çıplak fasondaGunden", { fasondaGunden: "3" }, "BARE_FILTER_PARAM"],
    ] as const) {
      const e = await errOf(() => list(q));
      check(`§4 ${label} → 400 ${code}`, e.status === 400 && e.code === code, `${e.status} ${String(e.code)}`);
    }
    const se = await errOf(() => orderService.getOrderStats(makeReq({ ...C, "filter[nerede]": "HEPSI" })));
    check("§4b özet de aynı 400", se.status === 400 && se.code === "INVALID_FILTER_VALUE");

    // ── §5 tek where ────────────────────────────────────────────────────────
    for (const q of <Record<string, string>[]>[{}, ...tabs.map(([t]) => ({ "filter[nerede]": t })), { "filter[fasonFirmaId]": dye.id }]) {
      const l = await list(q);
      const s = await orderService.getOrderStats(makeReq({ ...C, ...q }));
      check(`§5 liste total == özet (${JSON.stringify(q)})`, l.pagination.total === s.data.totalCount, `${l.pagination.total} / ${s.data.totalCount}`);
    }

    // ── §6 sorgu bütçesi ────────────────────────────────────────────────────
    const measure = async (q: Record<string, string>) => {
      total = 0;
      capture = true;
      try {
        await orderService.findAll(makeReq({ "filter[customerId]": customer.id, ...q }));
      } finally {
        capture = false;
      }
      return total;
    };
    await measure({ pageSize: "2" });
    const q2 = await measure({ pageSize: "2" });
    const q11 = await measure({ pageSize: "50" });
    check("§6 sorgu sayısı sayfa boyundan bağımsız (2 satır == 11 satır)", q2 > 0 && q2 === q11, `2 satır=${q2} · 11 satır=${q11}`);

    // ── §7 yan panel ucu ────────────────────────────────────────────────────
    const det = (await orderService.getOrderWhereDetail(orders.FAS.id)).data as {
      isEmirleri: Array<{ adimlar: Array<{ asama: string; topSayisi: number; fasonTop: number }>; fason: Array<{ firmaId: string; gun: number }> }>;
    };
    const card = det.isEmirleri[0];
    check("§7a fason İE: Kalite GECTI · Boyahane BURADA (2 top, 2 fasonda) · firma 5 gün",
      det.isEmirleri.length === 1 && card.adimlar[0].asama === "GECTI" && card.adimlar[1].asama === "BURADA" && card.adimlar[1].fasonTop === 2 &&
        card.fason.length === 1 && card.fason[0].firmaId === dye.id && card.fason[0].gun === 5,
      JSON.stringify(card));
    const detBas = (await orderService.getOrderWhereDetail(orders.BAS.id)).data as typeof det;
    check("§7b başlanmamış İE: bütün adımlar SIRADA", detBas.isEmirleri[0].adimlar.every((a) => a.asama === "SIRADA"));
    const detOrt = (await orderService.getOrderWhereDetail(orders.CNC.id)).data as typeof det;
    check("§7c iptal İE kart üretmez", detOrt.isEmirleri.length === 0);

    // ── §8 üretim kapalı ────────────────────────────────────────────────────
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.PRODUCTION_ENABLED },
      create: { key: SETTING_KEYS.PRODUCTION_ENABLED, value: false },
      update: { value: false },
    });
    const off = await list({});
    check("§8a üretim kapalı: nerede null", off.data.length === 11 && off.data.every((o) => o.nerede === null));
    for (const q of <Record<string, string>[]>[{ "filter[nerede]": "FASONDA" }, { "filter[nerede]": "SEVKE_HAZIR" }, { "filter[fasonFirmaId]": dye.id }, { "filter[fasondaGunden]": "1" }]) {
      const e = await errOf(() => list(q));
      const s = await errOf(() => orderService.getOrderStats(makeReq({ ...C, ...q })));
      check(`§8b üretim kapalı ${JSON.stringify(q)} → liste + özet 403 MODULE_DISABLED`,
        e.status === 403 && e.code === "MODULE_DISABLED" && s.status === 403 && s.code === "MODULE_DISABLED", `${e.status}/${String(e.code)} ${s.status}`);
    }
    const kismen = nosOf(await list({ "filter[nerede]": "KISMEN" }));
    check("§8c üretim kapalı: KISMEN serbest", setEq(kismen, ["COK"]));
  } finally {
    if (prodRow) await prisma.systemSetting.update({ where: { key: prodRow.key }, data: { value: prodRow.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.PRODUCTION_ENABLED } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: created.dispatches } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: created.dispatches } } });
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: created.batches } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: created.wos } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: created.wos } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: created.wos } } });
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.station.deleteMany({ where: { id: { in: created.stations } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
